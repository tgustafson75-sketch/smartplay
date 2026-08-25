/**
 * WHAT ARE YOU AIMING AT? — SmartFinder's reticle, answered from the map instead of the camera.
 *
 * 2026-08-24 (Tim's call, after reporting the reticle three times: 08-19, 08-22, 08-24 — "the moving
 * around of the aperture to get yardage still isn't very reactive in terms of accuracy").
 *
 * WHY THE TILT READ COULD NEVER DO THIS. SmartFinder ranges by camera tilt: distance = eyeHeight /
 * tan(angle). At a phone height of ~1.6 m a 150-yard target sits at 0.67 DEGREES of down-angle,
 * below the 2-degree floor where services/rangefinder correctly calls a read `unmeasurable`. Its own
 * header has said since 2026-07-22 that the method "physically caps at ~50 yds". So at every real
 * golf distance the reticle CANNOT move the number — the screen holds the GPS green-middle baseline
 * until a known-height AI scan comes back. Two earlier passes at this complaint widened a
 * plausibility gate; a gate was never the problem. The method has no resolution to gate.
 *
 * SO ASK A DIFFERENT QUESTION. The app already knows where the player is, which way the phone is
 * pointing, and where the real things on this hole are — green front/middle/back, every mapped
 * hazard. Swinging the reticle changes a BEARING, and a bearing is enough to say which known thing
 * lies along it and exactly how far away it is. That answer is GPS-accurate rather than a tilt
 * estimate, needs no scan round-trip, and moves the instant the reticle does — which is what
 * "reactive" meant. [[the-app-usually-already-knows]]
 *
 * Pure and dependency-light on purpose: the caller supplies the candidates, so this file has no
 * opinion about where a green or a bunker comes from and can be tested directly.
 */
import { bearingDegrees, haversineYards } from '../utils/geoDistance';

export type LatLng = { lat: number; lng: number };

export type AimCandidate = {
  /** What the player hears/sees — "green", "front bunker", "water right". */
  label: string;
  location: LatLng;
  /**
   * How close the aim has to be, in yards of LATERAL offset, for this candidate to count as aimed
   * at. A green is a big target; a pot bunker is not. Defaults to DEFAULT_TOLERANCE_YARDS.
   */
  toleranceYards?: number;
};

export type AimedFeature = {
  label: string;
  /** Straight-line distance from the player, GPS-derived — not a tilt estimate. */
  yards: number;
  /** How far off the aim line it sits. Small = squarely aimed at; near the tolerance = grazing it. */
  offsetYards: number;
  /** Where it is — so the caller can drive an elevation lookup off the real point, not a projection. */
  location: LatLng;
};

/** Roughly a green's half-width. Wide enough that a hand-held phone still resolves the green, tight
 *  enough that two features on different lines don't both claim the reticle. */
export const DEFAULT_TOLERANCE_YARDS = 22;

/** Normalise a bearing difference into [-180, 180]. */
function bearingDelta(aimDeg: number, targetDeg: number): number {
  let d = ((targetDeg - aimDeg) % 360 + 540) % 360 - 180;
  if (Object.is(d, -180)) d = 180;
  return d;
}

/**
 * The known feature the player is aiming at, or null when the aim line hits nothing we know about —
 * which is an honest answer and must stay one. Inventing a target because the reticle has to say
 * SOMETHING is how a rangefinder loses trust.
 *
 * Selection is by smallest LATERAL OFFSET, not by nearest: the question is "which of these am I
 * pointing at", and the most precisely aimed-at answer is the one that changes as the reticle moves.
 * Nearest-wins would make a bunker permanently shadow the green behind it.
 */
export function featureOnAimLine(
  from: LatLng | null | undefined,
  aimBearingDeg: number,
  candidates: readonly AimCandidate[],
): AimedFeature | null {
  if (!from || !Number.isFinite(from.lat) || !Number.isFinite(from.lng)) return null;
  if (!Number.isFinite(aimBearingDeg)) return null;

  let best: (AimedFeature & { offset: number }) | null = null;

  for (const c of candidates ?? []) {
    if (!c?.location || !Number.isFinite(c.location.lat) || !Number.isFinite(c.location.lng)) continue;
    const yards = haversineYards(from, c.location);
    if (!Number.isFinite(yards) || yards <= 0) continue;

    const delta = bearingDelta(aimBearingDeg, bearingDegrees(from, c.location));
    // Behind the player, or off to the side past square — not aimed at, whatever the arithmetic says.
    if (Math.abs(delta) >= 90) continue;

    // Perpendicular distance from the aim line. This is the honest measure of "am I pointing at it":
    // an angular tolerance alone would be far too generous close in and far too strict at range.
    const offset = Math.abs(yards * Math.sin((delta * Math.PI) / 180));
    const tolerance = Number.isFinite(c.toleranceYards as number) && (c.toleranceYards as number) > 0
      ? (c.toleranceYards as number)
      : DEFAULT_TOLERANCE_YARDS;
    if (offset > tolerance) continue;

    if (!best || offset < best.offset || (offset === best.offset && yards < best.yards)) {
      best = { label: c.label, yards: Math.round(yards), offsetYards: Math.round(offset), location: c.location, offset };
    }
  }

  if (!best) return null;
  return { label: best.label, yards: best.yards, offsetYards: best.offsetYards, location: best.location };
}
