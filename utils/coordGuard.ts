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
 *  - either axis EXACTLY zero — the {0,0} pair and the half-null shape
 *    ({37.4, 0}) golfcourseapi returns for a malformed record
 *  - BOTH axes within 0.001° of zero — the null-island neighbourhood.
 *    An AND, not an OR: a course on the prime meridian or the equator
 *    is a real course. (Corrected 2026-09-10.)
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
  /**
   * 2026-09-10 — A NEAR-ZERO BAND REJECTED REAL PLACES ON THE PRIME MERIDIAN.
   *
   * This was `Math.abs(lat) < 0.001 || Math.abs(lng) < 0.001` — an OR, so a longitude within
   * ~111m of Greenwich disqualified a coordinate however valid its latitude. The prime meridian
   * runs through eastern England (Cambridgeshire, Lincolnshire, East Sussex), France, Spain,
   * Algeria, Mali, Burkina Faso, Togo and Ghana; the equator through Ecuador, Colombia, Brazil,
   * Kenya and Indonesia. On a hole straddling it, EVERY fix was dropped at the OS boundary
   * (processFix applies this first), so lastFix froze, degraded at 60s, hard-cleared at 300s, and
   * the app reported no signal on a perfect satellite lock. Production is live in 176 countries.
   *
   * What the band was actually defending against is a PLACEHOLDER, and a placeholder is exactly
   * zero — either the {0,0} pair or the half-null shape golfcourseapi produces for a malformed
   * record ({37.4, 0}). `0.0004` is not a placeholder; it is a real place in London. Testing for
   * the sentinel instead of a neighbourhood around it keeps every placeholder rejected and stops
   * discarding coordinates that are merely near an arbitrary line. [[overstrict-gate-lens]]
   */
  // Either axis EXACTLY zero: the {0,0} pair and the half-null shape ({37.4, 0}).
  if (lat === 0 || lng === 0) return false;
  /**
   * BOTH axes near zero: the null-island neighbourhood. This is an AND, and the `||` it replaced is
   * the whole defect — {51.4769, 0.0004} is a real place in London and {0.0004, 36.8219} is a real
   * place in Kenya, while {0.0001, 0.0001} is eleven metres from the Gulf of Guinea sentinel and is
   * nobody's golf course.
   *
   * 2026-09-10 — my first cut dropped this band entirely and two existing regression guards caught
   * it immediately, which was correct of them: a near-zero PAIR is a placeholder and must still be
   * rejected. Only the axis-by-axis form was wrong.
   */
  if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

export function safeLatLng(lat: number | null | undefined, lng: number | null | undefined): LatLng | null {
  if (!isValidGolfCoord(lat, lng)) return null;
  return { lat: lat as number, lng: lng as number };
}
