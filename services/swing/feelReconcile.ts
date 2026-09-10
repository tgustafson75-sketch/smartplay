/**
 * Feels engine — 2026-06-09.
 *
 * After a swing is analyzed, the player tells the caddie how it FELT — either
 * mechanical ("felt like I came over the top", "felt thin") or emotional
 * ("felt frustrated", "felt great"). The caddie reconciles that feel against
 * what the camera actually shows AND against a quality swing, then coaches the
 * player back.
 *
 * Tie-in: reuses /api/swing-question (frame-grounded, conversational). We send
 * a few frames from the clip + the feel framed as the player's message + the
 * prior fault/cause/fix as context, so the caddie's reply is grounded in the
 * real swing — never just parroting the feel ("don't take it as gospel").
 *
 * Honest + safe: returns null on any missing input / extraction / network
 * failure. The caller still stores the feel and shows a graceful fallback.
 */

import * as VideoThumbnails from '../../utils/videoThumbnail'; // serialized wrapper (native retriever crash fix)
import * as FileSystem from 'expo-file-system/legacy';
import { getApiBaseUrl } from '../apiBase';

const apiUrl = (): string => getApiBaseUrl();

// Sample a few frames across the swing for the caddie to look at.
const FRAME_FRACTIONS = [0.25, 0.55, 0.85];

export interface FeelReconcileInput {
  videoUri: string;
  /** Player's stated feel (mechanical or emotional). */
  feel: string;
  durationMs: number | null;
  caddieName?: string | null;
  club?: string | null;
  /** From the prior swing-analysis so the reply is grounded in the read. */
  priorFault?: string | null;
  priorCause?: string | null;
  priorFix?: string | null;
  language?: string | null;
}

async function frameB64(videoUri: string, timeMs: number): Promise<string | null> {
  try {
    const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: Math.max(0, Math.round(timeMs)), quality: 0.6 });
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    return b64 && b64.length > 100 ? b64 : null;
  } catch {
    return null;
  }
}

/**
 * 2026-09-09 (triple-check pass — I cleared this file wrongly earlier today).
 *
 * Both readers below sample several frames across the clip, and BOTH are called from SmartMotion's
 * review surface, whose <Video> is `isLooping` + `shouldPlay` (the putt read at smartmotion.tsx:2486,
 * the feel reconcile at :3228). That is a native retriever decoding the same file ExoPlayer is
 * decoding — the documented SIGSEGV, and short of it the reason a sweep comes back empty. The
 * previous commit's scope note claimed nothing here ran against the looping surface. It was wrong.
 *
 * Same remedy as every analysis extractor: read the pooled private copy. Refcounted with an 8s
 * linger, so on the review surface this shares the file pose/arc/tempo already hold rather than
 * making another. No copy → no frames, which both callers already treat as "no frames" (`[]` here,
 * `null` from reconcileFeel), so nothing new can fail.
 */
async function framesFrom(videoUri: string, timesMs: number[]): Promise<string[]> {
  let shared: { uri: string; release: () => void } | null = null;
  try {
    const { acquireClipCopy } = await import('./sharedClipCopy');
    shared = await acquireClipCopy(videoUri);
  } catch { /* acquire failed — refused below */ }
  if (!shared) return [];
  try {
    const frames = await Promise.all(timesMs.map((t) => frameB64(shared!.uri, t)));
    return frames.filter((b): b is string => !!b);
  } finally {
    shared.release();
  }
}

/** Shared helper: extract a few base64 JPEG frames across a clip. Best-effort —
 *  returns whatever it can ([] on total failure). Reused by feel + putt. */
export async function extractFramesB64(
  videoUri: string,
  durationMs: number | null,
  fractions: number[] = FRAME_FRACTIONS,
): Promise<string[]> {
  const dur = durationMs && durationMs > 0 ? durationMs : 3000;
  return framesFrom(videoUri, fractions.map((f) => dur * f));
}

/**
 * Ask the caddie to reconcile the player's feel with the real swing and coach
 * them. Returns the spoken-style answer, or null when it can't run honestly.
 */
export async function reconcileFeel(input: FeelReconcileInput): Promise<string | null> {
  const base = apiUrl();
  const feel = input.feel.trim();
  if (!base || !feel || !input.videoUri) return null;

  const dur = input.durationMs && input.durationMs > 0 ? input.durationMs : 3000;
  const frames = (await framesFrom(input.videoUri, FRAME_FRACTIONS.map((f) => dur * f)))
    .map((b64) => ({ b64, media_type: 'image/jpeg' as const }));
  if (frames.length === 0) return null;

  // Frame the feel as the player's message; the prompt already tells the model
  // to reference what's visible. Cap to the endpoint's 500-char question limit.
  const question = (
    `Here's how that swing FELT to me: "${feel}". ` +
    `Relate my feel to what you actually see and to a solid swing, then give me one clear bit of coaching. ` +
    `Don't just agree with my feel — tell me if it matches the swing or not.`
  ).slice(0, 500);

  try {
    const res = await fetch(base + '/api/swing-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frames: frames.slice(0, 4),
        question,
        context: {
          caddie_name: input.caddieName ?? undefined,
          club: input.club ?? undefined,
          prior_fault: input.priorFault ?? undefined,
          prior_cause: input.priorCause ?? undefined,
          prior_fix: input.priorFix ?? undefined,
          language: input.language ?? undefined,
        },
      }),
      // Server maxDuration is 45s; bound the client a little above it so a
      // stall can't hang the feel reply forever (catch returns null cleanly).
      signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { answer?: string };
    const answer = (data.answer ?? '').trim();
    return answer.length > 0 ? answer : null;
  } catch {
    return null;
  }
}
