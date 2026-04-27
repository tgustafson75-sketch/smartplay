import * as FileSystem from 'expo-file-system/legacy';
import type { CageSession, CageClip } from '../types/cage';

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

// In-memory pending events per session — survives the session lifecycle, cleared on finalize
const _pendingEvents = new Map<
  string,
  Array<{ offset: number; method: 'audio_transient' | 'manual' }>
>();

export async function createSession(): Promise<CageSession> {
  const sessions = await readIndex();
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
  sessions.push(session);
  await writeIndex(sessions);
  _pendingEvents.set(id, []);
  return session;
}

export async function endSession(
  session_id: string,
  master_video_path: string,
): Promise<void> {
  const sessions = await readIndex();
  const idx = sessions.findIndex((s) => s.id === session_id);
  if (idx === -1) return;
  const now = Date.now();
  sessions[idx].ended_at = now;
  sessions[idx].duration_seconds = Math.round(
    (now - sessions[idx].started_at) / 1000,
  );
  sessions[idx].master_video_path = master_video_path;
  await writeIndex(sessions);
}

export function addClipEvent(
  session_id: string,
  offset_seconds: number,
  method: 'audio_transient' | 'manual',
): void {
  const events = _pendingEvents.get(session_id) ?? [];
  events.push({ offset: offset_seconds, method });
  _pendingEvents.set(session_id, events);
}

export async function finalizeClips(
  session_id: string,
  duration_seconds: number,
): Promise<void> {
  const events = _pendingEvents.get(session_id) ?? [];
  const sessions = await readIndex();
  const idx = sessions.findIndex((s) => s.id === session_id);
  if (idx === -1) return;

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

  await writeIndex(sessions);
  _pendingEvents.delete(session_id);
}

export async function listSessions(): Promise<CageSession[]> {
  return readIndex();
}

export async function getSession(session_id: string): Promise<CageSession | null> {
  const sessions = await readIndex();
  return sessions.find((s) => s.id === session_id) ?? null;
}

export async function deleteSession(session_id: string): Promise<void> {
  const sessions = await readIndex();
  const session = sessions.find((s) => s.id === session_id);
  if (session?.master_video_path) {
    const info = await FileSystem.getInfoAsync(session.master_video_path);
    if (info.exists) {
      await FileSystem.deleteAsync(session.master_video_path, { idempotent: true });
    }
    // Also attempt to delete the session directory
    const sessionDir = BASE + session_id + '/';
    const dirInfo = await FileSystem.getInfoAsync(sessionDir);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(sessionDir, { idempotent: true });
    }
  }
  await writeIndex(sessions.filter((s) => s.id !== session_id));
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
  const sessions = await readIndex();
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
  sessions.push(session);
  await writeIndex(sessions);
  return session;
}
