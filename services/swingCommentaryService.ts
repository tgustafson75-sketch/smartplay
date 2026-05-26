/**
 * 2026-05-25 — Fix AJ Phase 2: spoken-commentary transcription.
 *
 * Tim narrates while shooting:
 *   - "this is Chris's third swing, he's been pulling it left"
 *   - "putt cam — downhill left to right, breaks late"
 *   - "chip cam, soft landing, trying to check it"
 * That narration lives in the video's audio track (the device mic
 * captures it inside the mp4). This service POSTs the mp4 to
 * /api/transcribe (Whisper), gets text back, and persists it on the
 * shot record as `commentary_transcript`. Brain context picks it up
 * when the user later asks about that swing ("what was that one I
 * just hit") so Kevin / Tank / Serena / Harry have the spoken
 * context, not just the silent video frames.
 *
 * Distinct from feelCaptureService (owner-only calibration dataset):
 *   - feelCapture is gated by owner email + feelCaptureEnabled toggle
 *   - this runs for EVERY captured / uploaded swing on every beta tester
 *   - both can coexist; feelCapture is opt-in, commentary is the default
 *
 * Idempotency: in-flight + done Sets keyed by shotId. Won't retry if a
 * transcript already exists on the shot. Logs failures, never throws.
 *
 * Cost: ~$0.006 per Whisper call (≤25MB mp4). Beta-only — when we
 * roll to production, gate behind a Settings toggle if API costs
 * become a concern.
 *
 * NOTE: subscribes to cageStore mutations and walks reachable shots
 * to find unprocessed ones — same shape as feelCaptureService so
 * upload-vs-cage-vs-glasses entry points all trigger naturally.
 */

import { useCageStore, type CageShot } from '../store/cageStore';
import { track } from './analytics';

const inflight = new Set<string>();
const done = new Set<string>();

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const REQUEST_TIMEOUT_MS = 60_000;

async function transcribeShotCommentary(sessionId: string, shot: CageShot): Promise<void> {
  if (!shot.clipUri) return;
  if (inflight.has(shot.id) || done.has(shot.id)) return;
  // Idempotent — if already populated, mark done so we don't retry.
  if ((shot.commentary_transcript ?? '').trim().length > 0) {
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
    formData.append('language', 'en');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(API_URL + '/api/transcribe', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      console.log('[swingCommentary] transcribe failed:', res.status);
      track('swing_commentary_transcribe_error', { status: res.status });
      return;
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? '').trim();
    if (text.length === 0) {
      // Silent clip — mark done so we don't retry on every subscribe tick.
      done.add(shot.id);
      track('swing_commentary_transcribe_empty');
      return;
    }
    useCageStore.getState().setShotCommentaryTranscript(sessionId, shot.id, text);
    done.add(shot.id);
    track('swing_commentary_transcribe_ok', { chars: text.length });
    console.log(`[swingCommentary] ok shot=${shot.id} chars=${text.length}`);
  } catch (e) {
    console.log('[swingCommentary] exception:', e);
    track('swing_commentary_transcribe_exception');
  } finally {
    inflight.delete(shot.id);
  }
}

function processPendingShots(): void {
  const cage = useCageStore.getState();
  const candidates: { sessionId: string; shot: CageShot }[] = [];
  if (cage.activeSession) {
    for (const shot of cage.activeSession.shots) {
      if (shot.clipUri && !shot.commentary_transcript) {
        candidates.push({ sessionId: cage.activeSession.id, shot });
      }
    }
  }
  for (const session of cage.sessionHistory) {
    for (const shot of session.shots) {
      if (shot.clipUri && !shot.commentary_transcript) {
        candidates.push({ sessionId: session.id, shot });
      }
    }
  }
  for (const { sessionId, shot } of candidates) {
    void transcribeShotCommentary(sessionId, shot);
  }
}

/**
 * Mount-once subscription. Call from a top-level effect (app/_layout
 * or similar) so commentary transcription kicks off the moment a clip
 * lands on a session/shot. The subscribe handler is debounced via the
 * in-flight Set — concurrent mutations don't double-fire.
 */
let subscribed = false;
export function startSwingCommentarySubscription(): void {
  if (subscribed) return;
  subscribed = true;
  // Initial sweep — handles shots that landed before this service mounted.
  processPendingShots();
  useCageStore.subscribe(() => {
    processPendingShots();
  });
}
