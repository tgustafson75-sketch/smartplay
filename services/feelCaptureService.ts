/**
 * 2026-05-24 — Feel-capture dataset (owner-only, dev tooling).
 *
 * For each captured cage swing, transcribe the clip's audio via the
 * existing /api/transcribe (Whisper) endpoint and write the result back
 * onto the shot record as `feel_narration_transcript`. Paired with the
 * existing `perShotAnalysis`, this forms the labeled tuple set
 * {clip, transcript, analysis} that:
 *   (a) fuels a future feel-vs-real feature (compare what the user
 *       narrated they FELT vs. what the analysis actually SHOWS), and
 *   (b) serves as a calibration set for the analysis right now (owner
 *       reviews paired tuples and spot-checks whether observations
 *       align with the player's felt experience).
 *
 * No user-facing UI today. The only consumer surface is the owner
 * debug panel at /cage-debug. NO extraction / NLP — store the raw
 * transcript exactly as Whisper returns it.
 *
 * Gating (defense-in-depth):
 *   1. settingsStore.feelCaptureEnabled === true (owner explicitly
 *      flipped the toggle in Settings → Owner Tools)
 *   2. isOwnerEmail(playerProfile.email) === true (re-check at call
 *      time; defends against a leaked persisted-flag from a previous
 *      account)
 *   3. clipUri is present (no transcription without an audio source)
 *   4. perShotAnalysis is present (we only want pairs)
 *   5. feel_narration_transcript is not already set (idempotent)
 *
 * Cost note: each Whisper call is ~$0.006/minute. A 12s clip ≈ $0.0012.
 * Owner-only by design — never fires on a production user's audio.
 *
 * Audio source: cage clips are mp4 with embedded audio. Whisper accepts
 * mp4 / mp3 / m4a / wav / webm directly, so we POST the clip file as-is
 * without an ffmpeg extract step. The /api/transcribe endpoint forwards
 * straight to OpenAI Whisper which extracts the audio internally.
 */

import { useCageStore, type CageShot, type CageSession } from '../store/cageStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore, isOwnerEmail } from '../store/playerProfileStore';
import { track } from './analytics';
import { getApiBaseUrl } from './apiBase';

// Track shot IDs that have already been kicked off so the subscribe
// doesn't double-fire when the store mutates for other reasons (next
// shot lands, session ends, analysis populates, etc.).
const inflight = new Set<string>();
const done = new Set<string>();

/**
 * One-shot transcription for a specific shot. Posts the clip's mp4 to
 * /api/transcribe and writes the transcript back via the cage store.
 * Non-throwing: failures are logged and skipped (the empty transcript
 * stays empty; another swing's capture isn't blocked by this one).
 */
async function transcribeShotClip(sessionId: string, shot: CageShot): Promise<void> {
  if (!shot.clipUri) return;
  if (inflight.has(shot.id) || done.has(shot.id)) return;
  if ((shot.feel_narration_transcript ?? '').trim().length > 0) {
    done.add(shot.id);
    return;
  }
  inflight.add(shot.id);
  try {
    const formData = new FormData();
    formData.append('audio', {
      uri: shot.clipUri,
      type: 'video/mp4',
      name: 'clip.mp4',
    } as unknown as Blob);
    // Language stays default — Whisper auto-detects per the Option A
    // hybrid fix at app/api/transcribe+api.ts. Same call shape the
    // voice-intent capture path uses.
    formData.append('language', 'en');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(getApiBaseUrl() + '/api/transcribe', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      console.log('[feelCapture] transcribe failed:', res.status);
      track('feel_capture_transcribe_error', { status: res.status });
      return;
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? '').trim();
    if (text.length === 0) {
      // Empty transcript is a valid result (silent clip). Mark done
      // anyway so we don't retry on every subscribe tick.
      done.add(shot.id);
      track('feel_capture_transcribe_empty');
      return;
    }
    useCageStore.getState().setShotFeelTranscript(sessionId, shot.id, text);
    done.add(shot.id);
    track('feel_capture_transcribe_ok', { chars: text.length });
    console.log(`[feelCapture] ok shot=${shot.id} chars=${text.length}`);
  } catch (e) {
    console.log('[feelCapture] exception:', e);
    track('feel_capture_transcribe_exception');
  } finally {
    inflight.delete(shot.id);
  }
}

/**
 * Walk every reachable shot (active session + sessionHistory) and
 * transcribe any that meet the criteria. Called on each cageStore
 * mutation by the subscribe wire below.
 */
function processPendingShots(): void {
  const cage = useCageStore.getState();
  const sessions: { sessionId: string; shot: CageShot }[] = [];
  const active = cage.activeSession;
  if (active) {
    for (const shot of active.shots) sessions.push({ sessionId: active.id, shot });
  }
  for (const sess of cage.sessionHistory as CageSession[]) {
    for (const shot of sess.shots) sessions.push({ sessionId: sess.id, shot });
  }
  for (const { sessionId, shot } of sessions) {
    // Only pair shots that have both an analysis AND a clip — that's
    // the {clip, transcript, analysis} tuple the dataset wants.
    if (!shot.clipUri) continue;
    if (!shot.perShotAnalysis) continue;
    if ((shot.feel_narration_transcript ?? '').trim().length > 0) {
      done.add(shot.id);
      continue;
    }
    void transcribeShotClip(sessionId, shot);
  }
}

/**
 * Init wire — call once on app boot. Returns a teardown function.
 * Subscribes to cageStore changes when both gates pass; bails on
 * mount when the owner hasn't enabled the flag (no perf cost on
 * normal users). Re-checks the gate inside the subscriber so a
 * mid-session flip is honored without an app restart.
 */
export function initFeelCapture(): () => void {
  const isEnabled = (): boolean => {
    try {
      if (!useSettingsStore.getState().feelCaptureEnabled) return false;
      const email = usePlayerProfileStore.getState().email;
      return isOwnerEmail(email);
    } catch {
      return false;
    }
  };

  if (!isEnabled()) {
    // Subscribe anyway so a future enable picks up without restart.
    // Cheap: no transcription kicked off until the gate clears.
  } else {
    // First pass on boot — catch any shots already saved with analysis.
    processPendingShots();
  }

  const unsubCage = useCageStore.subscribe(() => {
    if (!isEnabled()) return;
    processPendingShots();
  });
  const unsubSettings = useSettingsStore.subscribe((s) => {
    if (s.feelCaptureEnabled && isEnabled()) processPendingShots();
  });
  return () => {
    unsubCage();
    unsubSettings();
  };
}

/** Owner-debug accessor — returns every shot with a non-empty
 *  transcript, paired with its session id + analysis + clip URI for
 *  the /cage-debug review surface. Cheap, no allocation in the
 *  fast path (returns [] when feel capture has produced nothing). */
export interface FeelCaptureTuple {
  sessionId: string;
  shotId: string;
  date: number;
  club: string;
  clipUri: string | null;
  transcript: string;
  observation: string | null;
  detected_issue: string | null;
  severity: string | null;
}
export function listFeelCaptureTuples(limit = 50): FeelCaptureTuple[] {
  const cage = useCageStore.getState();
  const out: FeelCaptureTuple[] = [];
  const push = (sessionId: string, sess: CageSession) => {
    for (const shot of sess.shots) {
      const transcript = (shot.feel_narration_transcript ?? '').trim();
      if (transcript.length === 0) continue;
      out.push({
        sessionId,
        shotId: shot.id,
        date: shot.timestamp,
        club: shot.club,
        clipUri: shot.clipUri,
        transcript,
        observation: shot.perShotAnalysis?.observation ?? null,
        detected_issue: shot.perShotAnalysis?.detected_issue ?? null,
        severity: shot.perShotAnalysis?.severity ?? null,
      });
    }
  };
  if (cage.activeSession) push(cage.activeSession.id, cage.activeSession);
  for (const sess of cage.sessionHistory as CageSession[]) push(sess.id, sess);
  out.sort((a, b) => b.date - a.date);
  return out.slice(0, limit);
}
