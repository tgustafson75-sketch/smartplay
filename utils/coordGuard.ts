/**
 * 2026-06-01 — Fix GL: single source of truth for "is this a valid
 * round-of-golf coordinate?"
 *
 * The full GPS audit (2026-06-01) found that the same WGS84-validation
 * pattern was either inlined ad-hoc (smartFinderService.safeLoc,
 * smartvision.isValidWgs84, hole-view.isValidWgs84) or MISSING
 * ENTIRELY at every other coordinate-consuming site. The biggest gap
 * was offCourseDetector iterating roundStore.courseHoles with no
 * guard — half the bundled courses (Westlake NJ, Sunnyvale, San Jose
 * Muni, Mariners) ship with placeholder {0,0} coords for some of
 * the F/M/B fields. haversine(playerOnPlanet, {0,0}) returns ~10M
 * yards, which passes a "finite but huge" check, never trips the
 * Infinity-fallback in Fix GF.1, and pegs off-course ON forever.
 *
 * isValidGolfCoord rejects:
 *  - null / undefined
 *  - non-finite (NaN, Infinity)
 *  - exact {0,0} pair (placeholder sentinel)
 *  - near-zero values (|val| < 0.001°, ~110m near origin — anything
 *    that close to the equator/Greenwich is a placeholder, not a
 *    real course)
 *  - out-of-WGS84 (|lat| > 90 or |lng| > 180 — the 246yd-artifact
 *    root cause, where meters leaked into degree slots)
 *
 * Apply this guard at EVERY boundary where coordinates enter the
 * pipeline: OS location callbacks, ingestExternalFix, mark events,
 * background task deliveries, course-geometry lookups, and the
 * haversine input on every distance consumer (off-course, hole
 * detection, smartFinder cascade).
 */

export type LatLng = { lat: number; lng: number };

export function isValidGolfCoord(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (Math.abs(lat) < 0.001 || Math.abs(lng) < 0.001) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

export function safeLatLng(lat: number | null | undefined, lng: number | null | undefined): LatLng | null {
  if (!isValidGolfCoord(lat, lng)) return null;
  return { lat: lat as number, lng: lng as number };
}
