/**
 * 2026-09-29 (Tim) — "we need to hide and make user not have to move ball box in smartmotion. No other
 * app seems to make you do a setup and we need reduce friction without reducing analysis."
 *
 * THE BALL REGION IS DERIVED, NOT ASKED FOR. SmartMotion already had every piece: a handedness-aware
 * default rig, a pose proxy under the detected feet (the framing loop), and a one-shot vision locate
 * of the real ball in a setup frame. What it did not have was one rule for which of them wins, and it
 * drew the result as a draggable box in the middle of the one screen that should be a camera and a
 * record button. This file is that rule, pure, so it can be tested without a device.
 *
 * PRECEDENCE, highest first — a lower source never replaces a higher one:
 *   user      the player placed or dragged it (optional, from setup tools — never required)
 *   detected  the ball itself was found in a setup frame
 *   feet      on-device pose put it just below the detected feet
 *   default   nothing could be derived; the static rig for this angle/handedness
 *
 * The precedence closes a live defect as well: the framing loop re-applied the FEET proxy on every
 * framed tick while the box was "still default", so a real detected ball was overwritten by the proxy
 * ~2.6s after it arrived. A detection now outranks the proxy for the rest of the setup.
 *
 * HONESTY. Only `default` is an estimate nobody measured. Consumers that read the ball region treat a
 * `default` region like any other unverified anchor (see isEstimatedBallRegion) instead of as a
 * measurement. Older sessions carry no source at all; that reads as unknown and changes nothing.
 */

export type BallRegionSource = 'user' | 'detected' | 'feet' | 'default';
export type BallRegion = { x: number; y: number; r: number };
export type SourcedBallRegion = { region: BallRegion; source: BallRegionSource };

const RANK: Record<BallRegionSource, number> = { default: 0, feet: 1, detected: 2, user: 3 };

/** Radius used for every auto-derived region (matches the historical DEFAULT_BALL_BOX radius). */
export const AUTO_BALL_RADIUS = 0.08;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Apply a candidate region. Returns the region that should stand: the candidate when its source ranks
 * at least as high as the current one (a same-rank update refines — the feet move as the player
 * shuffles, the player drags again), otherwise the current one unchanged. A USER placement always
 * stands against automation; `reset` (a new setup) is the only way back to `default`.
 */
export function nextBallRegion(current: SourcedBallRegion | null, candidate: SourcedBallRegion): SourcedBallRegion {
  if (!isFiniteRegion(candidate.region)) return current ?? candidate;
  if (!current) return candidate;
  return RANK[candidate.source] >= RANK[current.source] ? candidate : current;
}

/** The pose proxy: just below the midpoint of the detected feet, where the ball sits at address. */
export function ballRegionFromFeet(feetCenter: { x: number; y: number }): SourcedBallRegion {
  return {
    region: { x: clamp01(feetCenter.x), y: Math.min(0.92, clamp01(feetCenter.y + 0.04)), r: AUTO_BALL_RADIUS },
    source: 'feet',
  };
}

/** A ball found in a setup frame (normalized frame coords). */
export function ballRegionFromDetection(found: { x: number; y: number }): SourcedBallRegion {
  return { region: { x: clamp01(found.x), y: clamp01(found.y), r: AUTO_BALL_RADIUS }, source: 'detected' };
}

/** True when the region is the fallback nobody measured — the only case a consumer must discount. */
export function isEstimatedBallRegion(source: BallRegionSource | null | undefined): boolean {
  return source === 'default';
}

/**
 * Whether a camera ball-departure read may stand. A departure off an ACOUSTIC strike and a measured
 * ball region is taken as it comes, exactly as before. When the anchor is loose — the impact time was
 * only video-located, or the ball region is the unmeasured default — a read is kept only when it SAW
 * the ball at address and was not itself low-confidence: the crop was built around a guess, so a
 * low-confidence answer from it is noise dressed as a measurement.
 *
 * The video-located rule is the one smartmotion has applied since 2026-06-29 (and it still also
 * requires the ball to have departed, because a loose TIME can put "after" before the strike). A
 * default REGION with an acoustic time keeps duff detection: a ball seen at rest that never left is a
 * real read wherever the box was.
 */
export function acceptBallDeparture<T extends { departed: boolean; confidence: 'high' | 'medium' | 'low'; ball_present_before: boolean }>(
  r: T | null | undefined,
  opts: { videoLocated: boolean; regionSource: BallRegionSource | null | undefined },
): T | null {
  if (!r) return null;
  if (opts.videoLocated) return r.departed && r.confidence !== 'low' && r.ball_present_before ? r : null;
  if (isEstimatedBallRegion(opts.regionSource)) return r.confidence !== 'low' && r.ball_present_before ? r : null;
  return r;
}

function isFiniteRegion(r: BallRegion | null | undefined): r is BallRegion {
  return !!r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.r) && r.r > 0;
}
