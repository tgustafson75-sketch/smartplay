/**
 * 2026-08-31 (Tim, from the field: "swing trace is a little off", logged alongside
 * `clubpath_arc_too_sparse ... windowMs: 11640`) — WHICH SECONDS OF THE CLIP CONTAIN THE SWING.
 *
 * A detected swing segment is 4,000ms. His window was ELEVEN AND A HALF SECONDS, because when no
 * segment is stored the swing screen falls through to the whole clip duration — so the club path
 * hunted a clubhead across eleven seconds of walk-up, waggle and follow-through and assembled an arc
 * out of everything it found. Same shape as two other defects fixed the same day: sampling the CLIP
 * instead of the SWING.
 *
 * WHY THIS IS A MODULE. The first fix lived inline in the screen and its test re-implemented the
 * arithmetic beside it, which is a test that cannot fail when the screen changes. The rule and the
 * numbers now have one owner, and the pre/post come from the segmenter itself.
 * [[two-owners-is-the-root-cause]] [[break-test-every-guard-you-write]]
 */
import { PRE_STRIKE_MS, POST_STRIKE_MS } from './swingSegmentation';

/** Wider than any real swing (4,000ms segment + headroom for a slow, wide capture). */
export const MAX_SWING_WINDOW_MS = 6000;

export type ImpactAnchorInput = {
  /** 'audio_transient' is a heard strike; 'manual' is video-located OR synthesized. */
  detectionMethod?: string | null;
  /** Seconds into the clip. NOT always a measurement — see below. */
  detectionOffsetSeconds?: number | null;
  /** timestampMs of the pose frame labelled P6_impact, if the pose pipeline labelled one. */
  poseImpactMs?: number | null;
  rawStartMs: number;
  rawEndMs: number;
};

/**
 * The best HONEST impact time, or null.
 *
 * Order matters and each tier is a different quality of evidence:
 *   1. A heard strike — frame-accurate, from the microphone.
 *   2. The pose-labelled impact frame — measured from the picture. This is the only anchor a range
 *      or uploaded swing can have, and it is what makes the narrowing fire on the swings that
 *      actually need it.
 *   3. Nothing.
 *
 * What is deliberately NOT a tier: `detectionOffsetSeconds` on a 'manual' shot. When SmartMotion
 * detects no swing it synthesizes a whole-clip segment whose strike is `0.6 x duration` — a
 * placeholder so the analysis can run bounded — and persists it in that same field. Re-centring on
 * it would point the club path with total confidence at the wrong four seconds, which is worse than
 * searching wide: a wide search finds a smeared arc, a confident wrong window finds someone's
 * backswing and calls it impact. [[illustration-data-points]]
 *
 * The pose anchor is accepted only INSIDE the raw window: a per-shot biomech read on a carved
 * session could be on a different clock, and the bounds check makes that mismatch self-detecting.
 */
export function impactAnchorMs(input: ImpactAnchorInput): number | null {
  const { detectionMethod, detectionOffsetSeconds, poseImpactMs, rawStartMs, rawEndMs } = input;
  const heard =
    detectionMethod === 'audio_transient' &&
    typeof detectionOffsetSeconds === 'number' &&
    Number.isFinite(detectionOffsetSeconds) &&
    detectionOffsetSeconds > 0
      ? detectionOffsetSeconds * 1000
      : null;
  if (heard != null) return heard;
  if (
    typeof poseImpactMs === 'number' &&
    Number.isFinite(poseImpactMs) &&
    poseImpactMs >= rawStartMs &&
    poseImpactMs <= rawEndMs
  ) {
    return poseImpactMs;
  }
  return null;
}

/**
 * Narrow an implausibly wide window onto the swing. Never widens; with no anchor the window is
 * returned untouched, because a smeared arc beats an invented centre.
 */
export function narrowClubPathWindow(
  rawStartMs: number,
  rawEndMs: number,
  anchorMs: number | null,
): { startMs: number; endMs: number } {
  const tooWide = rawEndMs - rawStartMs > MAX_SWING_WINDOW_MS;
  if (!tooWide || anchorMs == null) return { startMs: rawStartMs, endMs: rawEndMs };
  return {
    startMs: Math.max(rawStartMs, anchorMs - PRE_STRIKE_MS),
    endMs: Math.min(rawEndMs, anchorMs + POST_STRIKE_MS),
  };
}
