/**
 * 2026-08-31 (Tim's call: "ray-intersect hole geometry") — WHAT THE RETICLE IS ALLOWED TO FIND.
 *
 * THE RAY MATH WAS NEVER THE GAP. `services/aimedFeature.featureOnAimLine` has cast the aim ray and
 * measured lateral offset since 2026-08-24, and it is correct. What limited it was its INPUT: the
 * candidate list built inline in app/smartfinder.tsx held the green, green front, green back and the
 * coarse `hazards` array — and nothing else.
 *
 * So bunkers and water — the two things a golfer most often aims AT or lays up SHORT of — were
 * invisible to the reticle unless a hole happened to duplicate them into `hazards`. Point the
 * reticle at the bunker you are trying to carry and the screen said nothing was there, which reads
 * exactly like the rangefinder being broken. `bunkers` and `water_hazards` were sitting in
 * HoleGeometry the whole time, already traced as polygons, already used by the map overlay.
 *
 * Extracted from the inline `useMemo` for two reasons: a list this load-bearing should be TESTABLE,
 * and it must have ONE owner — a second place that decides what is aimable is how the reticle and
 * the map would start disagreeing about what is on this hole. [[two-owners-is-the-root-cause]]
 *
 * `aimedFeature` stays deliberately geometry-agnostic ("the caller supplies the candidates"), which
 * is why this lives in its own file rather than being folded into it.
 */
import type { AimCandidate, LatLng } from './aimedFeature';
import type { HoleGeometry, Polygon } from './courseGeometryService';

/**
 * Lateral tolerances, in yards. These are half-widths of the real thing, not confidence dials: a
 * green is a big target and a pot bunker is not, and a tolerance wider than the feature would let
 * two features on different lines both claim the reticle.
 */
const TOLERANCE_YARDS = {
  green: 24,
  green_edge: 18,
  water: 16,
  hazard: 14,
  bunker: 12,
} as const;

function usable(p: LatLng | null | undefined): p is LatLng {
  // (0,0) is missing data, not a place in the Atlantic.
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.lat !== 0 || p.lng !== 0);
}

/**
 * Centroid of a traced ring. Preferred over a bare centre point where we have one: the outline is
 * the shape the vision pass actually traced, while `green` can be a coarser or older estimate.
 */
export function centroidOf(poly: Polygon | null | undefined): LatLng | null {
  if (!Array.isArray(poly) || poly.length === 0) return null;
  let lat = 0, lng = 0, n = 0;
  for (const p of poly) {
    if (!usable(p)) continue;
    lat += p.lat; lng += p.lng; n++;
  }
  return n > 0 ? { lat: lat / n, lng: lng / n } : null;
}

/**
 * Everything on this hole the reticle may report, from the geometry we already have.
 *
 * Returns [] when there is no geometry — which makes `featureOnAimLine` return null, which the
 * screen renders as "nothing mapped there". That is the honest chain and every link must keep
 * returning emptiness rather than inventing a target. [[illustration-data-points]]
 */
export function buildAimCandidates(geometry: HoleGeometry | null | undefined): AimCandidate[] {
  const out: AimCandidate[] = [];
  if (!geometry) return out;
  const push = (location: LatLng | null | undefined, label: string, toleranceYards: number) => {
    if (usable(location)) out.push({ label, location, toleranceYards });
  };

  push(centroidOf(geometry.green_polygon) ?? geometry.green, 'green', TOLERANCE_YARDS.green);
  push(geometry.green_front, 'front of green', TOLERANCE_YARDS.green_edge);
  push(geometry.green_back, 'back of green', TOLERANCE_YARDS.green_edge);

  /**
   * 2026-08-31 — THE ACTUAL FIX. Bunkers and water were never offered to the aim line.
   * `side` is already derived relative to the tee→green line, so the label says which one the
   * player is pointing at rather than making them work it out from a bare "bunker".
   */
  for (const b of geometry.bunkers ?? []) {
    push(centroidOf(b.polygon) ?? b.centroid, b.side ? `${b.side} bunker` : 'bunker', TOLERANCE_YARDS.bunker);
  }
  for (const w of geometry.water_hazards ?? []) {
    push(centroidOf(w.polygon) ?? w.centroid, w.side ? `water ${w.side}` : 'water', TOLERANCE_YARDS.water);
  }
  // The coarse list stays LAST and is deduped against what we already added, so a hole that lists
  // its bunker in both places does not offer the reticle the same thing twice under two names.
  for (const h of geometry.hazards ?? []) {
    if (!usable(h?.location)) continue;
    const dupe = out.some((c) =>
      Math.abs(c.location.lat - h.location!.lat) < 1e-5 && Math.abs(c.location.lng - h.location!.lng) < 1e-5);
    if (dupe) continue;
    push(h.location, h.label || 'hazard', TOLERANCE_YARDS.hazard);
  }
  return out;
}
