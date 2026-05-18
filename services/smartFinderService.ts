import * as Location from 'expo-location';
import { useRoundStore, type ShotLocation } from '../store/roundStore';
import { haversineYards } from '../utils/geoDistance';
import { getOneShotFix, bumpToActive, subscribe as subscribeGps } from './gpsManager';
// 2026-05-19 — fall back to courseGeometryService cache when the local
// courseHoles record has zeroed coords. data/courses.ts ships placeholder
// zeros for courses we haven't hand-coded (Sunnyvale, SJ Muni). When the
// round starts, fetchCourseGeometry pulls real coords from golfcourseapi
// and caches them; without this fallback the live API result was being
// ignored and yardages stayed null forever.
import { getHoleGeometry } from './courseGeometryService';

/**
 * Phase D-2 — SmartFinder data layer.
 *
 * Computes front / middle / back yardages from the player's current GPS position
 * to the green of the current (or specified) hole, plus a GPS-quality classification
 * for the indicator dot.
 *
 * Data source: courseHoles records on the round store (frontLat/Lng, middleLat/Lng,
 * backLat/Lng populated by golfcourseapi when available). When upstream lacks
 * green coordinates — the typical case today per Phase B field findings — every
 * yardage returns null and consumers render a graceful empty state.
 */

/**
 * Phase 400-followup — `reason` surfaces *why* a yardage triplet is null
 * so the UI can show actionable error messaging instead of an empty state:
 *   - 'ok'           — at least one of front/middle/back is populated.
 *   - 'no_fix'       — GPS has no fix yet (waiting for first watch tick).
 *   - 'no_hole'      — round store has no record for this hole number.
 *   - 'no_geometry'  — hole exists but green coordinates are missing
 *                       (typical when golfcourseapi hasn't been populated
 *                       for this course). Caller should show "Green
 *                       coordinates unavailable for this course."
 */
export type GreenYardagesReason = 'ok' | 'no_fix' | 'no_hole' | 'no_geometry';

export type GreenYardages = {
  front: number | null;
  middle: number | null;
  back: number | null;
  hole_number: number;
  reason: GreenYardagesReason;
};

export type GPSQualityLevel = 'strong' | 'moderate' | 'weak' | 'none';

export type GPSQualityReading = {
  level: GPSQualityLevel;
  accuracy_m: number | null;
  accuracy_ft: number | null;
};

export type LastFix = {
  location: ShotLocation;
  accuracy_m: number | null;
  timestamp: number;
};

let lastFix: LastFix | null = null;
// Phase Q.5b — sim override flag. When true, refreshFix() returns the
// caller-set lastFix instead of calling Location. Only set by the
// services/simulatedGPS.ts test harness; production code never touches.
let simulatedActive = false;

// Phase 107 / B1 — listeners notified whenever lastFix changes so consumers
// can react to live GPS updates (yardage strip auto-refresh while walking).
type FixChangeListener = (fix: LastFix) => void;
const fixChangeListeners = new Set<FixChangeListener>();

function notifyFixChange(): void {
  if (!lastFix) return;
  for (const cb of fixChangeListeners) {
    try { cb(lastFix); } catch (e) { console.warn('[smartFinder] fix listener threw:', e); }
  }
}

export function subscribeFixChange(cb: FixChangeListener): () => void {
  fixChangeListeners.add(cb);
  return () => { fixChangeListeners.delete(cb); };
}

// Phase 107 / B1 — wire the live gpsManager subscription so yardages
// auto-update as the player walks. gpsManager publishes 1Hz fixes during
// active mode and 10s fixes during walking; either way smartFinder's
// lastFix stays current and consumers see real-time yardages without
// requiring Mark or screen-open to refresh.
let gpsUnsub: (() => void) | null = null;
export function startSmartFinderGpsTracking(): void {
  if (gpsUnsub) return;
  gpsUnsub = subscribeGps((fix) => {
    // Sim override wins.
    if (simulatedActive) return;
    lastFix = {
      location: { lat: fix.lat, lng: fix.lng },
      accuracy_m: fix.accuracy_m,
      timestamp: fix.timestamp,
    };
    notifyFixChange();
  });
}
export function stopSmartFinderGpsTracking(): void {
  if (gpsUnsub) { gpsUnsub(); gpsUnsub = null; }
}

export function getLastFix(): LastFix | null {
  return lastFix;
}

/**
 * Phase Q.5b — set the cached fix directly. Used by the simulated GPS
 * test harness to feed waypoint coordinates without going through the
 * device geolocation API. Idempotent.
 */
export function setSimulatedFix(loc: ShotLocation, accuracy_m = 3): void {
  lastFix = { location: loc, accuracy_m, timestamp: Date.now() };
  simulatedActive = true;
}

/** Stop simulation and clear the cached fix so next refreshFix() hits real GPS. */
export function clearSimulatedFix(): void {
  simulatedActive = false;
  lastFix = null;
}

export function isSimulatedActive(): boolean {
  return simulatedActive;
}

/**
 * Phase AL — public seeder used by the position Mark bus. Forces the
 * cached lastFix to the user-marked coordinates so SmartFinder yardages
 * (front/middle/back) render against the marked spot immediately,
 * without waiting for the next watch tick. Subscribed in app/_layout.
 */
export function setMarkedFix(lat: number, lng: number, accuracy_m: number | null): void {
  lastFix = {
    location: { lat, lng },
    accuracy_m,
    timestamp: Date.now(),
  };
  // Phase 107 / B1 — notify subscribers so all yardage consumers refresh.
  notifyFixChange();
}

/**
 * Pulls a high-accuracy GPS fix and stores accuracy alongside the location for
 * use by the GPS quality indicator. Returns null on permission denial / failure
 * (callers should show the GPS-weak state).
 */
export async function refreshFix(): Promise<LastFix | null> {
  // Sim override: just return whatever the harness set.
  if (simulatedActive) return lastFix;
  // SmartFinder being open is a shot-intent signal — bump GPS to active.
  bumpToActive('smartfinder_refresh');
  try {
    const fix = await getOneShotFix();
    if (!fix) return lastFix;
    lastFix = {
      location: { lat: fix.lat, lng: fix.lng },
      accuracy_m: fix.accuracy_m ?? null,
      timestamp: fix.timestamp,
    };
    notifyFixChange();
    return lastFix;
  } catch (e) {
    console.log('[smartFinder] refreshFix failed:', e);
    return null;
  }
}

export function classifyAccuracy(accuracy_m: number | null): GPSQualityReading {
  if (accuracy_m == null) {
    return { level: 'none', accuracy_m: null, accuracy_ft: null };
  }
  const accuracy_ft = Math.round(accuracy_m * 3.281);
  if (accuracy_m < 5) return { level: 'strong', accuracy_m, accuracy_ft };
  if (accuracy_m < 15) return { level: 'moderate', accuracy_m, accuracy_ft };
  return { level: 'weak', accuracy_m, accuracy_ft };
}

function safeLoc(lat: number, lng: number): ShotLocation | null {
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * 2026-05-19 — Resolve front/middle/back for a hole, preferring the
 * roundStore courseHoles record (which is what golfcourseapi populates
 * for fully-coded courses) but falling back to the geometry cache for
 * local courses we ship with placeholder zeros (Sunnyvale, SJ Muni).
 *
 * Returns { front, middle, back, source } so callers can log which
 * path produced the coords. source='none' when no usable coords exist
 * in either place.
 */
function resolveGreenCoords(holeNumber: number): {
  front: ShotLocation | null;
  middle: ShotLocation | null;
  back: ShotLocation | null;
  source: 'courseHoles' | 'geometryCache' | 'none';
} {
  const round = useRoundStore.getState();
  const hData = round.courseHoles.find(h => h.hole === holeNumber);
  let front = hData ? safeLoc(hData.frontLat, hData.frontLng) : null;
  let middle = hData ? safeLoc(hData.middleLat, hData.middleLng) : null;
  let back = hData ? safeLoc(hData.backLat, hData.backLng) : null;
  if (front || middle || back) {
    return { front, middle, back, source: 'courseHoles' };
  }
  // courseHoles record is all-zero — try the geometry cache. The cache
  // is populated by fetchCourseGeometry which fires at round start. If
  // the API returned real coords for Sunnyvale / SJ Muni this is where
  // they live.
  const courseId = round.activeCourseId ?? null;
  if (courseId) {
    const geo = getHoleGeometry(courseId, holeNumber);
    if (geo) {
      front = geo.green_front ?? null;
      middle = geo.green ?? null;
      back = geo.green_back ?? null;
      if (front || middle || back) {
        return { front, middle, back, source: 'geometryCache' };
      }
    }
  }
  return { front: null, middle: null, back: null, source: 'none' };
}

/**
 * Returns front/middle/back yardages to the green of `holeNumber` (defaults to
 * the round's current hole). Each is null when either the player's location or
 * that green-point's coordinates are unknown.
 */
export async function getGreenYardages(holeNumber?: number): Promise<GreenYardages> {
  const round = useRoundStore.getState();
  const hole = holeNumber ?? round.currentHole;
  const hData = round.courseHoles.find(h => h.hole === hole);
  const fix = lastFix ?? (await refreshFix());

  if (!hData) {
    return { front: null, middle: null, back: null, hole_number: hole, reason: 'no_hole' };
  }
  if (!fix) {
    return { front: null, middle: null, back: null, hole_number: hole, reason: 'no_fix' };
  }

  const { front, middle, back, source } = resolveGreenCoords(hole);

  if (!front && !middle && !back) {
    return { front: null, middle: null, back: null, hole_number: hole, reason: 'no_geometry' };
  }

  const yards = {
    front: front ? Math.round(haversineYards(fix.location, front)) : null,
    middle: middle ? Math.round(haversineYards(fix.location, middle)) : null,
    back: back ? Math.round(haversineYards(fix.location, back)) : null,
    hole_number: hole,
    reason: 'ok' as const,
  };
  logYardageCalc(hole, fix, { front, middle, back }, yards);
  void source;
  return yards;
}

/**
 * Synchronous variant for render paths. Uses the cached lastFix without
 * awaiting; returns nulls if no fix yet. Pair with refreshFix() in a useEffect.
 */
export function getGreenYardagesSync(holeNumber?: number): GreenYardages {
  const round = useRoundStore.getState();
  const hole = holeNumber ?? round.currentHole;
  const hData = round.courseHoles.find(h => h.hole === hole);
  if (!hData) {
    return { front: null, middle: null, back: null, hole_number: hole, reason: 'no_hole' };
  }
  if (!lastFix) {
    return { front: null, middle: null, back: null, hole_number: hole, reason: 'no_fix' };
  }
  const { front, middle, back, source } = resolveGreenCoords(hole);
  if (!front && !middle && !back) {
    return { front: null, middle: null, back: null, hole_number: hole, reason: 'no_geometry' };
  }
  const yards = {
    front: front ? Math.round(haversineYards(lastFix.location, front)) : null,
    middle: middle ? Math.round(haversineYards(lastFix.location, middle)) : null,
    back: back ? Math.round(haversineYards(lastFix.location, back)) : null,
    hole_number: hole,
    reason: 'ok' as const,
  };
  logYardageCalc(hole, lastFix, { front, middle, back }, yards);
  void source;
  return yards;
}

/** Yardage from the player's current location to a tapped/known target point. */
export async function distanceToPoint(target: ShotLocation): Promise<number | null> {
  const fix = lastFix ?? (await refreshFix());
  if (!fix) return null;
  const yards = Math.round(haversineYards(fix.location, target));
  logYardageCalc(null, fix, { middle: target, front: null, back: null }, {
    front: null, middle: yards, back: null,
    hole_number: -1, reason: 'ok',
  });
  return yards;
}

// ─── Empirical validation telemetry ──────────────────────────────────────────
/**
 * Phase 400-followup — in-memory ring buffer of every yardage calculation
 * performed during a round, so Tim can correlate computed SmartFinder
 * yardages against a real rangefinder on a Z Fold testing pass.
 *
 * Captured per call: timestamp, hole, GPS accuracy, source coords, target
 * coords (F/M/B), computed yards. Buffered to 500 entries (≈ a full round
 * at 4s polling) then oldest entries drop. Exported via getYardageCalcLog()
 * for the GPS debug overlay or to dump to AsyncStorage on round-end.
 *
 * NOT persisted — round-scoped only. If the buffer needs to survive a
 * crash, callers must snapshot it themselves.
 */
export type YardageCalcEntry = {
  ts: number;
  hole: number | null;
  gps_accuracy_m: number | null;
  src_lat: number;
  src_lng: number;
  front_lat: number | null;
  front_lng: number | null;
  middle_lat: number | null;
  middle_lng: number | null;
  back_lat: number | null;
  back_lng: number | null;
  front_yards: number | null;
  middle_yards: number | null;
  back_yards: number | null;
};

const CALC_LOG_MAX = 500;
let calcLog: YardageCalcEntry[] = [];

function logYardageCalc(
  hole: number | null,
  fix: LastFix,
  targets: { front: ShotLocation | null; middle: ShotLocation | null; back: ShotLocation | null },
  result: GreenYardages,
): void {
  const entry: YardageCalcEntry = {
    ts: Date.now(),
    hole,
    gps_accuracy_m: fix.accuracy_m,
    src_lat: fix.location.lat,
    src_lng: fix.location.lng,
    front_lat: targets.front?.lat ?? null,
    front_lng: targets.front?.lng ?? null,
    middle_lat: targets.middle?.lat ?? null,
    middle_lng: targets.middle?.lng ?? null,
    back_lat: targets.back?.lat ?? null,
    back_lng: targets.back?.lng ?? null,
    front_yards: result.front,
    middle_yards: result.middle,
    back_yards: result.back,
  };
  calcLog.push(entry);
  if (calcLog.length > CALC_LOG_MAX) {
    calcLog = calcLog.slice(-CALC_LOG_MAX);
  }
}

export function getYardageCalcLog(): YardageCalcEntry[] {
  return calcLog.slice();
}

export function clearYardageCalcLog(): void {
  calcLog = [];
}
