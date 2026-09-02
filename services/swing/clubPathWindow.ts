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
  /**
   * 2026-09-01 — HOW that P6_impact label was arrived at (PoseFrame.positionSource).
   *
   * 'strike' means the pose sampler anchored the phases to a heard strike, so the label IS an impact
   * time. 'estimated' means it was placed at a fixed FRACTION of the clip or window — P6_impact at
   * 0.65 — and nothing was detected at all.
   *
   * This tier existed to be "the only anchor a range or uploaded swing can have… measured from the
   * picture". For a strike-anchored read that is true. For a fraction it is not measured from
   * anything, and accepting it re-admits by another name the exact fabrication the tier below
   * refuses: the synthesized 0.6*duration offset. Two placeholders, one rule.
   * [[a-field-that-is-sometimes-a-placeholder]]
   */
  poseImpactSource?: 'strike' | 'estimated' | null;
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
  // A pose label placed at a fraction of the clip is not a measurement — see poseImpactSource.
  if (input.poseImpactSource === 'estimated') return null;
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
 * 2026-09-01 (Tim — "a strike confirmation or kind of acoustic pickup can help confirm. It's just a
 * silent, thin confirmation level of that strike point, and you can work around that. Right?") —
 * HOW MUCH TO TRUST THE STRIKE WE HEARD.
 *
 * Right, and it is the difference between two usable anchors and one. The strike detector already
 * grades every hit `high | medium | low` from its headroom over the local floor and its attack time
 * (services/swing/strikeDetector.ts), and that grade was being thrown away: everything downstream
 * asked only "was there a strike, yes or no".
 *
 * Treating a low-confidence pickup as no strike at all is the expensive half of that. A thin
 * transient still says the ball was struck at ROUGHLY this moment, and roughly is a great deal better
 * than a fraction of the clip — which is the only alternative. So it stays an anchor and the samplers
 * WIDEN around it: the same frames, spread over a window big enough to absorb how wrong the timing
 * could be.
 *
 * The numbers are the detector's own error, not a guess about golf: a high-confidence transient has a
 * sharp attack and lands within a frame or two of the real strike; a low one can be a scuff, a
 * neighbouring bay or a late reflection and is worth ~a quarter second either side.
 *
 * WHERE YOU ARE STANDING CHANGES WHAT 'LOW' MEANS. Tim: "on the course, even a low detection is
 * probably accurate because you're not standing close to anyone."
 *
 * That is the whole reason a low grade is distrusted. The detector marks a transient down for thin
 * headroom over the local floor — and the reason a thin transient is dangerous is that it might be
 * SOMEBODY ELSE'S: the next bay over, a mat behind you, a reflection off a sim enclosure. On a
 * course, alone in a fairway, that entire failure mode is absent. The only ball being struck near the
 * microphone is yours, and a quiet reading means a quiet strike — distance, wind, a soft contact —
 * not a foreign one. Same number out of the detector, materially different meaning.
 *
 * So COURSE keeps a low grade close to the strike; RANGE and SIM, where the neighbouring-bay problem
 * is real, keep the wide window. This is 'context matters' doing actual work rather than sitting in a
 * principles list. [[nobody-chose-cage-the-default-did]] — modes are course / range / sim.
 */
export function anchorToleranceMs(
  confidence: 'high' | 'medium' | 'low' | null | undefined,
  environment?: 'course' | 'range' | 'sim' | null,
): number {
  if (confidence === 'high') return 0;
  if (confidence === 'medium') return environment === 'course' ? 40 : 80;
  // 'low', or an ungraded anchor whose provenance we cannot see from here.
  return environment === 'course' ? 90 : 240;
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
