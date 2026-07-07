import * as FileSystem from 'expo-file-system/legacy';
import type { CageSession, CageClip } from '../types/cage';
import { cageLog } from './cageTelemetry';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const BASE = (FileSystem.documentDirectory ?? '') + 'cage_sessions/';
const INDEX_PATH = BASE + 'index.json';

async function ensureBase(): Promise<void> {
  const info = await FileSystem.getInfoAsync(BASE);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(BASE, { intermediates: true });
  }
}

async function readIndex(): Promise<CageSession[]> {
  await ensureBase();
  const info = await FileSystem.getInfoAsync(INDEX_PATH);
  if (!info.exists) return [];
  try {
    const raw = await FileSystem.readAsStringAsync(INDEX_PATH);
    return JSON.parse(raw) as CageSession[];
  } catch {
    return [];
  }
}

async function writeIndex(sessions: CageSession[]): Promise<void> {
  await ensureBase();
  await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(sessions));
}

// 2026-07-06 (persistence audit H2) — SERIALIZE every index read-modify-write.
// Before this, each writer did readIndex() → mutate → writeIndex() with no lock,
// so two overlapping operations (e.g. endSession attaching the master video while
// a clip finalize or a new createSession runs) both read the SAME on-disk snapshot
// and the later writeIndex overwrote the whole array — silently dropping an entire
// recorded session or its master_video_path. That is the most likely cause of
// "a round's data was lost at the course." This mutex chains all mutations so each
// reads the freshest index INSIDE the lock and writes before the next one reads.
let _indexChain: Promise<unknown> = Promise.resolve();

function mutateIndex<T>(
  mutator: (sessions: CageSession[]) => { sessions: CageSession[]; result: T },
): Promise<T> {
  const run = async (): Promise<T> => {
    const current = await readIndex();
    const { sessions, result } = mutator(current);
    await writeIndex(sessions);
    return result;
  };
  // Chain onto the prior op regardless of whether it resolved or rejected, so one
  // failed mutation can't wedge the queue. Keep _indexChain error-swallowed; return
  // the real (possibly-rejecting) promise to the caller.
  const next = _indexChain.then(run, run);
  _indexChain = next.then(() => undefined, () => undefined);
  return next;
}

// In-memory pending events per session — survives the session lifecycle, cleared on finalize
const _pendingEvents = new Map<
  string,
  Array<{ offset: number; method: 'audio_transient' | 'manual' }>
>();

export async function createSession(): Promise<CageSession> {
  const id = uuid();
  const session: CageSession = {
    id,
    player_id: 'primary',
    started_at: Date.now(),
    ended_at: null,
    duration_seconds: 0,
    master_video_path: '',
    clips: [],
    distance_to_target_meters: null,
    notes: null,
    player_roster: ['primary'],
  };
  const created = await mutateIndex((sessions) => {
    sessions.push(session);
    return { sessions, result: session };
  });
  _pendingEvents.set(id, []);
  cageLog('storage-create-session', 'ok', { session_id: id });
  return created;
}

export async function endSession(
  session_id: string,
  master_video_path: string,
): Promise<void> {
  const duration = await mutateIndex((sessions) => {
    const idx = sessions.findIndex((s) => s.id === session_id);
    if (idx === -1) {
      cageLog('storage-end-session', 'fail', { session_id, reason: 'not-found-in-index' });
      return { sessions, result: null as number | null };
    }
    const now = Date.now();
    sessions[idx].ended_at = now;
    sessions[idx].duration_seconds = Math.round((now - sessions[idx].started_at) / 1000);
    sessions[idx].master_video_path = master_video_path;
    return { sessions, result: sessions[idx].duration_seconds };
  });
  if (duration !== null) {
    cageLog('storage-end-session', 'ok', {
      session_id,
      duration_seconds: duration,
      has_master_video: master_video_path.length > 0,
    });
  }
}

export function addClipEvent(
  session_id: string,
  offset_seconds: number,
  method: 'audio_transient' | 'manual',
): void {
  const events = _pendingEvents.get(session_id) ?? [];
  events.push({ offset: offset_seconds, method });
  _pendingEvents.set(session_id, events);
  cageLog('storage-add-clip-event', 'ok', {
    session_id,
    method,
    offset_seconds: Number(offset_seconds.toFixed(2)),
    pending_count: events.length,
  });
}

export async function finalizeClips(
  session_id: string,
  duration_seconds: number,
): Promise<void> {
  const events = _pendingEvents.get(session_id) ?? [];
  const ok = await mutateIndex((sessions) => {
    const idx = sessions.findIndex((s) => s.id === session_id);
    if (idx === -1) {
      cageLog('storage-finalize-clips', 'fail', { session_id, reason: 'not-found-in-index' });
      return { sessions, result: false };
    }
    sessions[idx].clips = events.map((ev) => ({
      id: uuid(),
      session_id,
      detected_at_session_offset_seconds: ev.offset,
      detection_method: ev.method,
      start_time_seconds: Math.max(0, ev.offset - 2),
      end_time_seconds: Math.min(duration_seconds, ev.offset + 3),
      speaker_id: 'primary',
      labels: {},
      raw_transcript: null,
    }));
    return { sessions, result: true };
  });
  if (ok) {
    _pendingEvents.delete(session_id);
    cageLog('storage-finalize-clips', 'ok', {
      session_id,
      clip_count: events.length,
      duration_seconds,
    });
  }
}

export async function listSessions(): Promise<CageSession[]> {
  return readIndex();
}

export async function getSession(session_id: string): Promise<CageSession | null> {
  const sessions = await readIndex();
  return sessions.find((s) => s.id === session_id) ?? null;
}

export async function deleteSession(session_id: string): Promise<void> {
  // Remove from the index atomically first (returns the removed session's video
  // path), THEN clean up the files it referenced. Doing the index write through the
  // mutex prevents a concurrent createSession/endSession from resurrecting or
  // clobbering the delete.
  const removedPath = await mutateIndex((sessions) => {
    const session = sessions.find((s) => s.id === session_id);
    const path = session?.master_video_path ?? null;
    return { sessions: sessions.filter((s) => s.id !== session_id), result: path };
  });
  if (removedPath) {
    const info = await FileSystem.getInfoAsync(removedPath);
    if (info.exists) {
      await FileSystem.deleteAsync(removedPath, { idempotent: true });
    }
    // Also attempt to delete the session directory
    const sessionDir = BASE + session_id + '/';
    const dirInfo = await FileSystem.getInfoAsync(sessionDir);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(sessionDir, { idempotent: true });
    }
  }
}

export async function getSessionDir(session_id: string): Promise<string> {
  const dir = BASE + session_id + '/';
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

export async function createSyntheticSession(): Promise<CageSession> {
  const id = uuid();
  const now = Date.now();
  const clips: CageClip[] = [
    { id: uuid(), session_id: id, detected_at_session_offset_seconds: 10, detection_method: 'audio_transient', start_time_seconds: 8, end_time_seconds: 13, speaker_id: 'primary', labels: {}, raw_transcript: null },
    { id: uuid(), session_id: id, detected_at_session_offset_seconds: 25, detection_method: 'audio_transient', start_time_seconds: 23, end_time_seconds: 28, speaker_id: 'primary', labels: {}, raw_transcript: null },
    { id: uuid(), session_id: id, detected_at_session_offset_seconds: 42, detection_method: 'manual', start_time_seconds: 40, end_time_seconds: 45, speaker_id: 'primary', labels: {}, raw_transcript: null },
    { id: uuid(), session_id: id, detected_at_session_offset_seconds: 61, detection_method: 'audio_transient', start_time_seconds: 59, end_time_seconds: 64, speaker_id: 'primary', labels: {}, raw_transcript: null },
    { id: uuid(), session_id: id, detected_at_session_offset_seconds: 88, detection_method: 'audio_transient', start_time_seconds: 86, end_time_seconds: 91, speaker_id: 'primary', labels: {}, raw_transcript: null },
  ];
  const session: CageSession = {
    id,
    player_id: 'primary',
    started_at: now - 120_000,
    ended_at: now,
    duration_seconds: 120,
    master_video_path: '',
    clips,
    distance_to_target_meters: null,
    notes: 'SYNTHETIC TEST — no real video',
    player_roster: ['primary'],
  };
  return mutateIndex((sessions) => {
    sessions.push(session);
    return { sessions, result: session };
  });
}
