import { useRoundStore, type ShotLocation } from '../store/roundStore';
import { haversineYards } from '../utils/geoDistance';
import {
  getOneShotFix,
  bumpToActive,
  subscribe as subscribeGps,
  getLastFix as getGpsLastFix,
  setSimulatedFix as setGpsSimulatedFix,
  clearSimulatedFix as clearGpsSimulatedFix,
  setMarkedFix as setGpsMarkedFix,
  isSimulatedActive as isGpsSimulatedActive,
} from './gpsManager';
// 2026-05-19 — fall back to courseGeometryService cache when the local
// courseHoles record has zeroed coords. data/courses.ts ships placeholder
// zeros for courses we haven't hand-coded (Sunnyvale, SJ Muni). When the
// round starts, fetchCourseGeometry pulls real coords from golfcourseapi
// and caches them; without this fallback the live API result was being
// ignored and yardages stayed null forever.
import { getHoleGeometry } from './courseGeometryService';
// 2026-05-19 — user-captured green overrides win over EVERYTHING.
// Captured via the Mark Green tool when the user is standing at the
// center of an actual green. Persists per (courseId, hole) so the
// next round on the same course gets accurate yardages out of the
// gate without depending on golfcourseapi data.
import { getGreenOverride } from './courseGreenOverrides';
// 2026-05-23 — Mark Tee mirror. Tee overrides take the same
// player-marked-wins precedence as green overrides; resolveTeeCoords
// below mirrors resolveGreenCoords. The pair powers the "anchored
// hole length" computation (marked tee → marked green).
import { getTeeOverride } from './courseTeeOverrides';
import { getCourseTruthSync } from './courseTruth';

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

// 2026-05-20 — Day 1 / Fix 4: smartFinderService no longer holds its
// own position cache. The single source of truth is gpsManager.lastFix.
// All public read paths below derive from getGpsLastFix() and all write
// paths (sim / mark) proxy to gpsManager so every consumer sees the
// same fix.

/** Map gpsManager's GpsFix to the local LastFix shape used by yardage callers. */
function getLastFixInternal(): LastFix | null {
  const fix = getGpsLastFix();
  if (!fix) return null;
  return {
    location: { lat: fix.lat, lng: fix.lng },
    accuracy_m: fix.accuracy_m,
    timestamp: fix.timestamp,
  };
}

// Phase 107 / B1 — listeners notified whenever the fix changes so consumers
// can react to live GPS updates (yardage strip auto-refresh while walking).
// After Day 1 / Fix 4 these listeners are driven directly by the gpsManager
// subscription wired in startSmartFinderGpsTracking — sim and mark writes
// no longer notify locally because gpsManager fans those out to ALL
// subscribers including this service.
type FixChangeListener = (fix: LastFix) => void;
const fixChangeListeners = new Set<FixChangeListener>();

function notifyFixChange(fix: LastFix): void {
  for (const cb of fixChangeListeners) {
    try { cb(fix); } catch (e) { console.warn('[smartFinder] fix listener threw:', e); }
  }
}

export function subscribeFixChange(cb: FixChangeListener): () => void {
  fixChangeListeners.add(cb);
  return () => { fixChangeListeners.delete(cb); };
}

// Phase 107 / B1 — wire the live gpsManager subscription so yardages
// auto-update as the player walks. The subscriber maps gpsManager's
// GpsFix into smartFinder's LastFix shape and fans out to local
// subscribeFixChange listeners.
let gpsUnsub: (() => void) | null = null;
export function startSmartFinderGpsTracking(): void {
  if (gpsUnsub) return;
  gpsUnsub = subscribeGps((fix) => {
    notifyFixChange({
      location: { lat: fix.lat, lng: fix.lng },
      accuracy_m: fix.accuracy_m,
      timestamp: fix.timestamp,
    });
  });
}
export function stopSmartFinderGpsTracking(): void {
  if (gpsUnsub) { gpsUnsub(); gpsUnsub = null; }
  // 2026-05-17 — reset the calc-log ring buffer at round end so it
  // doesn't accumulate across rounds. fixChangeListeners is
  // intentionally NOT cleared — subscribers (cockpit data strip,
  // smartfinder) remain mounted across rounds and should keep their
  // subscriptions. The position cache is owned by gpsManager and gets
  // cleared by stopGpsManager() in the round-end teardown.
  calcLog = [];
}

export function getLastFix(): LastFix | null {
  return getLastFixInternal();
}

/**
 * Phase Q.5b — sim seed proxied to gpsManager.setSimulatedFix. Pre-Day 1 /
 * Fix 4 this wrote a local cache; now it routes through gpsManager so
 * every consumer (shotLocationService, GPS quality overlay, etc.)
 * sees the same fix.
 */
export function setSimulatedFix(loc: ShotLocation, accuracy_m = 3): void {
  setGpsSimulatedFix(loc, accuracy_m);
}

/** Stop simulation. Proxies to gpsManager. */
export function clearSimulatedFix(): void {
  clearGpsSimulatedFix();
}

export function isSimulatedActive(): boolean {
  return isGpsSimulatedActive();
}

/**
 * Phase AL — public seeder for the position Mark bus. Proxies to
 * gpsManager.setMarkedFix so the marked coords become the single
 * source of truth across SmartFinder, shotLocationService, and any
 * other GPS-reading surface.
 */
export function setMarkedFix(lat: number, lng: number, accuracy_m: number | null): void {
  setGpsMarkedFix(lat, lng, accuracy_m);
}

/**
 * Pulls a high-accuracy GPS fix via gpsManager.getOneShotFix and returns
 * the mapped LastFix shape. Returns null on permission denial / failure.
 */
export async function refreshFix(): Promise<LastFix | null> {
  // SmartFinder being open is a shot-intent signal — bump GPS to active.
  bumpToActive('smartfinder_refresh');
  try {
    const fix = await getOneShotFix();
    if (!fix) return getLastFixInternal();
    return {
      location: { lat: fix.lat, lng: fix.lng },
      accuracy_m: fix.accuracy_m ?? null,
      timestamp: fix.timestamp,
    };
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
// 2026-05-24 — Exported for the voice yardage handler (Flow A,
// queryStatusHandler.ts `distance_to_green` case). The handler needs
// raw pin coords through the same Mark-Green-override-aware cascade
// the visual yardage strip uses, so the spoken number agrees with the
// on-screen number. Resolver itself unchanged.
export function resolveGreenCoords(holeNumber: number): {
  front: ShotLocation | null;
  middle: ShotLocation | null;
  back: ShotLocation | null;
  source: 'truth' | 'override' | 'courseHoles' | 'geometryCache' | 'none';
} {
  const round = useRoundStore.getState();
  const courseId = round.activeCourseId ?? null;
  // 2026-05-24 — Surveyed ground truth wins over EVERYTHING. The dev
  // screen at app/dev/CourseTruth.tsx captures on-foot GPS at the
  // green center; getCourseTruthSync reads from a cache hydrated at
  // boot (services/courseTruth.ts → hydrateCourseTruthCache in
  // app/_layout.tsx). TRUTH only carries a center coord; F/B stay
  // null unless the user also has a Mark Green override (handled
  // below — but truth short-circuits so override F/B is preserved
  // only via that branch's own flow when truth is absent).
  if (courseId) {
    const truth = getCourseTruthSync(courseId, holeNumber);
    if (truth) {
      return {
        front: null,
        middle: { lat: truth.lat, lng: truth.lng },
        back: null,
        source: 'truth',
      };
    }
  }
  // 2026-05-19 — user-captured Mark Green override wins. F/B are
  // approximated as middle ± 12 yards along the bearing axis only if
  // we have a tee anchor to compute bearing from; otherwise F/B stay
  // null and the smartFinder strip just shows middle.
  if (courseId) {
    const ov = getGreenOverride(courseId, holeNumber);
    if (ov) {
      const middleLoc: ShotLocation = { lat: ov.lat, lng: ov.lng };
      let front: ShotLocation | null = null;
      let back: ShotLocation | null = null;
      // Optional F/B if user marked them
      if (ov.frontLat != null && ov.frontLng != null) front = { lat: ov.frontLat, lng: ov.frontLng };
      if (ov.backLat != null && ov.backLng != null) back = { lat: ov.backLat, lng: ov.backLng };
      return { front, middle: middleLoc, back, source: 'override' };
    }
  }
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
 * 2026-05-23 — Resolve TEE coordinates with the same player-marked-wins
 * precedence as resolveGreenCoords. Decision order:
 *   1. Mark Tee override (player walked to the tee and tapped) → override
 *   2. roundStore.courseHoles[i].teeLat/teeLng (golfcourseapi) → courseHoles
 *   3. None — tee unknown
 *
 * No geometry-cache fallback yet because the cache today carries only
 * green centroids; if/when courseGeometryService starts caching tee
 * boxes a third branch will land here.
 */
export function resolveTeeCoords(holeNumber: number): {
  tee: ShotLocation | null;
  source: 'override' | 'courseHoles' | 'none';
} {
  const round = useRoundStore.getState();
  const courseId = round.activeCourseId ?? null;
  if (courseId) {
    const ov = getTeeOverride(courseId, holeNumber);
    if (ov) {
      return { tee: { lat: ov.lat, lng: ov.lng }, source: 'override' };
    }
  }
  const hData = round.courseHoles.find(h => h.hole === holeNumber);
  if (hData) {
    const tee = safeLoc(hData.teeLat, hData.teeLng);
    if (tee) return { tee, source: 'courseHoles' };
  }
  return { tee: null, source: 'none' };
}

/**
 * 2026-05-23 — Anchored hole length in yards. Returns the haversine
 * distance between the marked tee and marked green when BOTH are
 * captured for this hole. Null otherwise — callers should fall back
 * to the scorecard distance (roundStore.courseHoles[i].distance) when
 * the anchor pair isn't complete.
 *
 * This is the "closes the yardage loop" payoff of marking both ends:
 * a verified hole length the player can trust over the static
 * scorecard number AND over GPS course geometry that may not match
 * the tee box the player is actually playing from.
 */
export function getAnchoredHoleLengthYards(holeNumber: number): number | null {
  const round = useRoundStore.getState();
  const courseId = round.activeCourseId ?? null;
  if (!courseId) return null;
  const teeOv = getTeeOverride(courseId, holeNumber);
  const greenOv = getGreenOverride(courseId, holeNumber);
  if (!teeOv || !greenOv) return null;
  return Math.round(
    haversineYards(
      { lat: teeOv.lat, lng: teeOv.lng },
      { lat: greenOv.lat, lng: greenOv.lng },
    ),
  );
}

/**
 * Returns front/middle/back yardages to the green of `holeNumber` (defaults to
 * the round's current hole). Each is null when either the player's location or
 * that green-point's coordinates are unknown.
 */
// 2026-05-17 — Resolve the hole data with a bundled-courses fallback
// so pre-round previews (no active round → roundStore.courseHoles is
// empty) still surface real scorecard yardages. Active round wins
// when populated; otherwise fall back to bundled per-slug data from
// data/courses.ts. activeCourseId | pendingStartCourseId | previewCourseId
// is the preview courseId for slug resolution.
function resolveHoleDataWithFallback(hole: number): import('../store/roundStore').CourseHole | null {
  const round = useRoundStore.getState();
  const live = round.courseHoles.find(h => h.hole === hole);
  if (live) return live;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getBundledHoles } = require('../data/courses') as typeof import('../data/courses');
  const previewId = round.activeCourseId ?? round.pendingStartCourseId ?? round.previewCourseId ?? null;
  const bundled = getBundledHoles(previewId);
  return bundled.find(h => h.hole === hole) ?? null;
}

// 2026-05-17 — Static yardages from the bundled scorecard (h.front /
// h.distance / h.back are tee→green distances). Used pre-round AND
// during active-round when GPS hasn't landed yet, so the user sees
// real numbers immediately instead of dashes. Per Tim: "pre-round in
// static, would adjust to GPS once active."
//
// 2026-05-21 — Consolidation 5: returns reason: 'no_geometry' (was
// 'ok'). The fallback is the scorecard's tee→green TOTAL, not a
// live GPS read — it doesn't decrease as the player walks toward
// the green. Returning 'ok' previously masqueraded the static
// number as live; UI consumers had no signal to downgrade
// confidence. Same no-fake-precision principle as the Phase 418
// validation gate and the SmartFinder GPS-quality framing. The
// number is still useful as a reference; just labelled honestly.
function staticYardages(hData: import('../store/roundStore').CourseHole, hole: number): GreenYardages {
  return {
    front: typeof hData.front === 'number' ? hData.front : null,
    middle: typeof hData.distance === 'number' ? hData.distance : null,
    back: typeof hData.back === 'number' ? hData.back : null,
    hole_number: hole,
    reason: 'no_geometry',
  };
}

export async function getGreenYardages(holeNumber?: number): Promise<GreenYardages> {
  const round = useRoundStore.getState();
  const hole = holeNumber ?? round.currentHole;
  const hData = resolveHoleDataWithFallback(hole);
  const fix = getLastFixInternal() ?? (await refreshFix());

  if (!hData) {
    return { front: null, middle: null, back: null, hole_number: hole, reason: 'no_hole' };
  }
  if (!fix) {
    // No GPS yet (pre-round, cold-start, indoor) — render the
    // bundled scorecard yardages so the user has SOMETHING.
    return staticYardages(hData, hole);
  }

  const { front, middle, back, source } = resolveGreenCoords(hole);

  if (!front && !middle && !back) {
    // GPS available but no green coords — still better to show
    // scorecard yardages than blanks.
    return staticYardages(hData, hole);
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
  // 2026-05-18 — Sanity clamp. If any computed yardage exceeds 800y the
  // GPS fix is in a different city than the green coord (Tim hit
  // "80,000 yards" on Standard's F/M/B strip when his real-GPS fix
  // didn't match the active course geometry). Fall back to the
  // scorecard yardage rather than showing absurd numbers that will
  // mislead a user reaching for a club.
  if ((yards.middle ?? 0) > 800 || (yards.front ?? 0) > 800 || (yards.back ?? 0) > 800) {
    console.log('[smartFinder] yardages out of range — falling back to scorecard:', yards);
    return staticYardages(hData, hole);
  }
  return yards;
}

/**
 * Synchronous variant for render paths. Uses the cached lastFix without
 * awaiting; returns nulls if no fix yet. Pair with refreshFix() in a useEffect.
 */
export function getGreenYardagesSync(holeNumber?: number): GreenYardages {
  const round = useRoundStore.getState();
  const hole = holeNumber ?? round.currentHole;
  const hData = resolveHoleDataWithFallback(hole);
  if (!hData) {
    return { front: null, middle: null, back: null, hole_number: hole, reason: 'no_hole' };
  }
  const syncFix = getLastFixInternal();
  if (!syncFix) {
    return staticYardages(hData, hole);
  }
  const { front, middle, back, source } = resolveGreenCoords(hole);
  if (!front && !middle && !back) {
    return staticYardages(hData, hole);
  }
  const yards = {
    front: front ? Math.round(haversineYards(syncFix.location, front)) : null,
    middle: middle ? Math.round(haversineYards(syncFix.location, middle)) : null,
    back: back ? Math.round(haversineYards(syncFix.location, back)) : null,
    hole_number: hole,
    reason: 'ok' as const,
  };
  logYardageCalc(hole, syncFix, { front, middle, back }, yards);
  void source;
  // 2026-05-18 — same sanity clamp as the async path above. See note.
  if ((yards.middle ?? 0) > 800 || (yards.front ?? 0) > 800 || (yards.back ?? 0) > 800) {
    console.log('[smartFinder:sync] yardages out of range — falling back to scorecard:', yards);
    return staticYardages(hData, hole);
  }
  return yards;
}

/** Yardage from the player's current location to a tapped/known target point. */
export async function distanceToPoint(target: ShotLocation): Promise<number | null> {
  const fix = getLastFixInternal() ?? (await refreshFix());
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
