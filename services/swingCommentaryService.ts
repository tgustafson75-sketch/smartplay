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
import { detectCue } from './metaGlassesCueRouter';
import { transcribeVideoAudio, transcribeVideoAudioDetailed } from './videoTranscription';
import { useSettingsStore } from '../store/settingsStore';

const inflight = new Set<string>();
const done = new Set<string>();

/**
 * 2026-05-28 — Fix FU: lets videoUpload's bounded transcript wait
 * (Fix FQ) skip itself when the commentary service has already
 * finished a shot. Returns:
 *   'inflight' — actively transcribing; caller should wait briefly
 *   'done'     — transcription completed (transcript may be empty)
 *   'pending'  — not started yet
 * Empty `done` transcripts are still 'done' — the wait is pointless
 * because the service won't retry. This is the primary signal
 * distinguishing Cage Mode (silent → transcribes to empty quickly
 * → status='done') from a real coach/instructor video upload
 * (transcription takes 5-10s while running → status='inflight').
 */
export function getTranscriptionStatus(shotId: string): 'inflight' | 'done' | 'pending' {
  if (done.has(shotId)) return 'done';
  if (inflight.has(shotId)) return 'inflight';
  return 'pending';
}

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
    // 2026-05-28 — Fix FP: route through the shared transcribeVideoAudio
    // helper which adds:
    //   - file-size pre-check (skips + logs cleanly when > 20MB, where
    //     /api/transcribe would otherwise reject after a long upload —
    //     Tim's repro was Katie's full-body coach clips silently
    //     producing no transcript despite the pipeline existing)
    //   - language threaded from settingsStore (was hardcoded 'en')
    //   - Whisper failure logging with status + body head visible
    //   - elapsed_ms telemetry on every call (success or failure)
    const language = useSettingsStore.getState().language;
    const text = await transcribeVideoAudio(shot.clipUri, { language });

    if (!text) {
      // Could be: no audio, file too large, network failure, empty
      // transcript. Mark done so we don't retry on every subscribe tick
      // (the helper already logged the specific reason).
      done.add(shot.id);
      track('swing_commentary_transcribe_skip_or_empty');
      return;
    }
    useCageStore.getState().setShotCommentaryTranscript(sessionId, shot.id, text);
    done.add(shot.id);
    track('swing_commentary_transcribe_ok', { chars: text.length });
    console.log(`[swingCommentary] ok shot=${shot.id} chars=${text.length}`);

    // 2026-05-26 — Fix AZ: Meta Glasses verbal-cue auto-routing.
    // After the transcript lands, see if the user verbally tagged
    // the clip ("Putt Cam" / "Chip Cam" / "full swing") so the
    // analyzer can route it correctly even though they never
    // tapped the upload screen's pickers. Strict gates:
    //   - Session must have an upload record (no live_cage)
    //   - source_device must be 'meta_glasses' (the async-review
    //     case where verbal cues are most valuable)
    //   - We never override a user-explicit tag/perspective
    //   - Only the FIRST recognized cue per transcript wins
    try {
      const cue = detectCue(text);
      if (cue) {
        const session = (() => {
          const cage = useCageStore.getState();
          if (cage.activeSession?.id === sessionId) return cage.activeSession;
          return cage.sessionHistory.find(x => x.id === sessionId) ?? null;
        })();
        const upload = session?.upload;
        if (upload && upload.source_device === 'meta_glasses') {
          const patch: Record<string, unknown> = {};
          if (upload.tag == null && cue.tag != null) patch.tag = cue.tag;
          if (upload.perspective == null) patch.perspective = cue.perspective;
          if (Object.keys(patch).length > 0) {
            useCageStore.getState().patchSessionUpload(sessionId, patch);
            console.log(
              `[metaGlassesCue] matched="${cue.matched_phrase}" → session=${sessionId} `
              + `tag=${patch.tag ?? '(unchanged)'} perspective=${patch.perspective ?? '(unchanged)'}`,
            );
            track('meta_glasses_cue_routed', {
              phrase: cue.matched_phrase,
              tag: String(patch.tag ?? 'unchanged'),
              perspective: String(patch.perspective ?? 'unchanged'),
            });
          }
        }
      }
    } catch (cueErr) {
      console.log('[metaGlassesCue] non-fatal:', cueErr);
    }
  } catch (e) {
    console.log('[swingCommentary] exception:', e);
    track('swing_commentary_transcribe_exception');
  } finally {
    inflight.delete(shot.id);
  }
}

// 2026-06-29 (Tim — per-swing voice commentary) — a multi-swing session carves N
// shots out of ONE master clip, so transcribe it ONCE and BUCKET each spoken
// utterance onto the swing it belongs to (the swing whose window-start most recently
// precedes the utterance — "that was good" lands on the swing just hit). Single-swing
// sessions keep the existing per-shot path (which also does the Meta-glasses cue route).
async function transcribeMultiSwingCommentary(sessionId: string, clipUri: string, shots: CageShot[]): Promise<void> {
  if (inflight.has(clipUri) || done.has(clipUri)) return;
  inflight.add(clipUri);
  try {
    const language = useSettingsStore.getState().language;
    const detailed = await transcribeVideoAudioDetailed(clipUri, { language });
    if (!detailed) { shots.forEach((s) => done.add(s.id)); done.add(clipUri); track('swing_commentary_multi_skip_or_empty'); return; }
    const store = useCageStore.getState();
    if (detailed.utterances.length === 0) {
      // No timestamps — honest fallback: put the whole transcript on the first swing.
      if (detailed.text) store.setShotCommentaryTranscript(sessionId, shots[0].id, detailed.text);
      shots.forEach((s) => done.add(s.id)); done.add(clipUri);
      track('swing_commentary_multi_no_utterances');
      return;
    }
    const ordered = [...shots].sort(
      (a, b) => (a.clipStartSeconds ?? a.detectionOffsetSeconds ?? 0) - (b.clipStartSeconds ?? b.detectionOffsetSeconds ?? 0),
    );
    const buckets = new Map<string, string[]>();
    for (const u of detailed.utterances) {
      let chosen = ordered[0];
      for (const sh of ordered) {
        const start = sh.clipStartSeconds ?? sh.detectionOffsetSeconds ?? 0;
        if (start <= u.start + 0.25) chosen = sh; else break;
      }
      const arr = buckets.get(chosen.id) ?? [];
      arr.push(u.text);
      buckets.set(chosen.id, arr);
    }
    for (const sh of ordered) {
      const txt = (buckets.get(sh.id) ?? []).join(' ').trim();
      if (txt) store.setShotCommentaryTranscript(sessionId, sh.id, txt);
      done.add(sh.id);
    }
    done.add(clipUri);
    track('swing_commentary_multi_ok', { swings: ordered.length, utterances: detailed.utterances.length });
    console.log(`[swingCommentary] multi-swing ok session=${sessionId} swings=${ordered.length} utterances=${detailed.utterances.length}`);
  } catch (e) {
    console.log('[swingCommentary] multi exception:', e);
    track('swing_commentary_multi_exception');
  } finally {
    inflight.delete(clipUri);
  }
}

function processPendingShots(): void {
  const cage = useCageStore.getState();
  const sessions: { id: string; shots: CageShot[] }[] = [];
  if (cage.activeSession) sessions.push({ id: cage.activeSession.id, shots: cage.activeSession.shots });
  for (const s of cage.sessionHistory) sessions.push({ id: s.id, shots: s.shots });

  for (const session of sessions) {
    const pending = session.shots.filter((sh) => sh.clipUri && !(sh.commentary_transcript ?? '').trim());
    if (pending.length === 0) continue;
    // Group pending shots by the clip they share.
    const byClip = new Map<string, CageShot[]>();
    for (const sh of pending) {
      const k = sh.clipUri as string;
      const arr = byClip.get(k) ?? [];
      arr.push(sh);
      byClip.set(k, arr);
    }
    for (const [clipUri, shots] of byClip) {
      if (shots.length > 1) void transcribeMultiSwingCommentary(session.id, clipUri, shots);
      else void transcribeShotCommentary(session.id, shots[0]);
    }
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
