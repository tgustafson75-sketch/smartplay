import * as Location from 'expo-location';
import { useRoundStore, type ShotLocation, type CourseHole } from '../store/roundStore';
import { getHoleGeometry } from './courseGeometryService';
import { getOneShotFix, getLastFix as getGpsLastFix } from './gpsManager';
import { safeLatLng } from '../utils/coordGuard';

/**
 * Phase B — GPS location capture for shots.
 *
 * Two surfaces:
 *
 * 1. `getCurrentLocation()` — fetch a single high-accuracy GPS fix to populate a shot's
 *    start_location at the moment of detection. Used by the conversational logging
 *    orchestrator and any manual logging path.
 *
 * 2. `closeHoleAtTransition(holeNumber)` — called when the player advances past a hole.
 *    Sets the just-finished hole's last shot end_location to the green centroid (taken from
 *    the CourseHole record's middle-of-green coordinates). For the next hole's first shot,
 *    no special handling is needed: shotDetectionService already supplies start_location
 *    from the GPS anchor.
 *
 * The end_location of intermediate shots is back-filled by the roundStore.logShot action
 * when the next shot lands.
 */

// 2026-05-20 — Day 1 / Fix 4: shotLocationService no longer holds a
// local lastLocation cache. The single source of truth is gpsManager.
// Reads go through getOneShotFix (which now respects simulator + mark
// state per the gpsManager-side change), and the only fallback when
// that returns null is gpsManager's existing cache via getGpsLastFix —
// no shadow copy that could diverge from the canonical position.

/**
 * Returns a fresh GPS fix when possible. Falls through to gpsManager's
 * existing cache when a fresh pulse fails (e.g. permission denied, out
 * of signal). Returns null if no fix is available anywhere.
 */
export async function getCurrentLocation(): Promise<ShotLocation | null> {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) {
      const req = await Location.requestForegroundPermissionsAsync();
      if (!req.granted) {
        const cached = getGpsLastFix();
        return cached ? { lat: cached.lat, lng: cached.lng } : null;
      }
    }
    // Prefer cached fix from gpsManager (<10s old) before firing a
    // redundant high-accuracy pulse. getOneShotFix also short-circuits
    // to the cached fix when the simulator is active.
    const fix = await getOneShotFix();
    if (fix) return { lat: fix.lat, lng: fix.lng };
    const cached = getGpsLastFix();
    return cached ? { lat: cached.lat, lng: cached.lng } : null;
  } catch (e) {
    console.log('[shotLocation] getCurrentLocation failed:', e);
    const cached = getGpsLastFix();
    return cached ? { lat: cached.lat, lng: cached.lng } : null;
  }
}

/**
 * Returns the green centroid for a hole. Phase B refinement (bundle, item 3) —
 * prefers courseGeometryService as the authoritative source; falls back to the
 * CourseHole record (the legacy data path) when geometry is unavailable. The
 * fallback also handles (front+back)/2 averaging when middle is missing.
 *
 * Single source of truth for "where is the green for this hole" — used by
 * SmartFinder distance queries, hole-transition end_location closure, and the
 * distance_to_green voice query.
 */
export function getGreenCentroid(holeNumber: number): ShotLocation | null {
  // 2026-07-01 (re-audit) — consult the canonical green resolver FIRST
  // (truth → Mark-Green override → golfbert → courseHoles → geometryCache). This is
  // the same cascade the SmartFinder strip uses, so the consumers of getGreenCentroid
  // (club recommendation via queryStatusHandler, lie-analysis brain context, shot-
  // distance logging) stop diverging from the strip after the user marks a green.
  // Lazy require avoids any import cycle with smartFinderService.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveGreenCoords } = require('./smartFinderService') as typeof import('./smartFinderService');
    const resolved = resolveGreenCoords(holeNumber);
    if (resolved.middle) return resolved.middle;
  } catch { /* fall through to the geometry path below */ }

  const round = useRoundStore.getState();
  const courseId = round.activeCourseId;

  // Geometry-service path (preferred)
  if (courseId) {
    const geo = getHoleGeometry(courseId, holeNumber);
    if (geo?.green) return geo.green;
    if (geo?.green_front && geo?.green_back) {
      return {
        lat: (geo.green_front.lat + geo.green_back.lat) / 2,
        lng: (geo.green_front.lng + geo.green_back.lng) / 2,
      };
    }
  }

  // Legacy CourseHole-record fallback
  // 2026-06-02 — Fix GM: replaced loose `!== 0` truthy-style checks
  // with safeLatLng (full WGS84 guard). The old check rejected exact
  // {0,0} but accepted near-zero (0.0001°) and out-of-range garbage —
  // same root cause class as the offCourseDetector pattern Fix GL
  // closed.
  const holes: CourseHole[] = round.courseHoles;
  const h = holes.find(x => x.hole === holeNumber);
  if (!h) return null;
  const mid = safeLatLng(h.middleLat, h.middleLng);
  if (mid) return mid;
  // Front/back midpoint fallback. Both pairs must be valid for the
  // midpoint to be meaningful — one bad coord poisons the average.
  const front = safeLatLng(h.frontLat, h.frontLng);
  const back = safeLatLng(h.backLat, h.backLng);
  if (front && back) {
    return {
      lat: (front.lat + back.lat) / 2,
      lng: (front.lng + back.lng) / 2,
    };
  }
  return null;
}

/** Returns the tee centroid for a hole. */
export function getTeeCentroid(holeNumber: number): ShotLocation | null {
  // 2026-06-02 — Fix GM: same WGS84 guard as getGreenCentroid above.
  const holes: CourseHole[] = useRoundStore.getState().courseHoles;
  const h = holes.find(x => x.hole === holeNumber);
  if (!h) return null;
  return safeLatLng(h.teeLat, h.teeLng);
}

/**
 * Called when the player transitions away from `holeNumber`. Closes the last shot's
 * end_location to the green centroid of that hole. No-op if green centroid is unknown
 * or the last shot already has an end_location.
 */
export function closeHoleAtTransition(holeNumber: number): void {
  const green = getGreenCentroid(holeNumber);
  if (!green) return;
  useRoundStore.getState().closeHoleEndLocation(holeNumber, green);
}

/**
 * Test seam — pre-Day-1-fix-4 this set a local cache. Now that
 * shotLocationService has no local cache, this proxies to gpsManager's
 * sim-fix path so tests still produce a known position. Existing
 * callers (none in production code, only test files) keep working.
 */
export function _setLastLocationForTest(loc: ShotLocation | null): void {
  if (!loc) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { clearSimulatedFix } = require('./gpsManager') as typeof import('./gpsManager');
    clearSimulatedFix();
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setSimulatedFix } = require('./gpsManager') as typeof import('./gpsManager');
  setSimulatedFix(loc, 3);
}
