/**
 * Phase Q.5b — Simulated GPS test harness.
 *
 * Drives the smartFinderService cached fix from a pre-built waypoint
 * walk path so holeDetection / lie analysis / SmartFinder distance
 * calculations can be verified end-to-end without needing real GPS or
 * an actual course visit.
 *
 * Architecture: services/smartFinderService exposes setSimulatedFix +
 * clearSimulatedFix + isSimulatedActive. This service drives the
 * waypoint progression on a setInterval, interpolating between
 * consecutive waypoints at realistic walking pace. All other services
 * (holeDetection, courseGeometry, SmartFinder) read GPS from the same
 * source and don't know they're being fed simulated data.
 */

import { setSimulatedFix, clearSimulatedFix, isSimulatedActive } from './smartFinderService';
import type { SimulatedWalk, SimulatedWalkPoint } from '../data/simulatedWalks';
import { SIMULATED_WALKS } from '../data/simulatedWalks';

const TICK_MS = 1_000; // 1Hz fix updates — matches a real-world GPS poll cadence
const METERS_PER_DEG_LAT = 111_111;

export type SimulatedWalkState = {
  walk_id: string;
  waypoint_index: number;
  fraction_through: number;
  current_lat: number;
  current_lng: number;
  next_label: string | null;
  pace_mps: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let activeWalk: SimulatedWalk | null = null;
let waypointIdx = 0;
let segmentStartTs = 0;
let listeners = new Set<(s: SimulatedWalkState | null) => void>();

function metersBetween(a: SimulatedWalkPoint, b: SimulatedWalkPoint): number {
  const dLat = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * METERS_PER_DEG_LAT * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function emit(s: SimulatedWalkState | null): void {
  listeners.forEach(l => { try { l(s); } catch (e) { console.log('[simGPS] listener err', e); } });
}

/** Subscribe to walk progress for UI rendering. */
export function subscribeToWalk(cb: (s: SimulatedWalkState | null) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getAvailableWalks(): SimulatedWalk[] {
  return SIMULATED_WALKS;
}

export function getActiveWalk(): SimulatedWalk | null {
  return activeWalk;
}

/**
 * Start a simulated walk by id. Cancels any in-progress walk first.
 * Logs progress to console.
 */
export function startSimulatedWalk(walkId: string): boolean {
  const walk = SIMULATED_WALKS.find(w => w.id === walkId);
  if (!walk) {
    console.log('[simGPS] unknown walk id:', walkId);
    return false;
  }
  stopSimulatedWalk();

  activeWalk = walk;
  waypointIdx = 0;
  segmentStartTs = Date.now();
  // Drop the first waypoint immediately so listeners see something.
  setSimulatedFix(walk.points[0]);
  emit({
    walk_id: walk.id,
    waypoint_index: 0,
    fraction_through: 0,
    current_lat: walk.points[0].lat,
    current_lng: walk.points[0].lng,
    next_label: walk.points[1]?.label ?? null,
    pace_mps: walk.pace_mps ?? 1.4,
  });
  console.log('[simGPS] start:', walk.id, '·', walk.points.length, 'waypoints');

  timer = setInterval(tick, TICK_MS);
  return true;
}

export function stopSimulatedWalk(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (activeWalk) console.log('[simGPS] stop:', activeWalk.id);
  activeWalk = null;
  waypointIdx = 0;
  clearSimulatedFix();
  emit(null);
}

function tick(): void {
  if (!activeWalk) return;
  const points = activeWalk.points;
  if (waypointIdx >= points.length - 1) {
    console.log('[simGPS] walk complete');
    stopSimulatedWalk();
    return;
  }

  const a = points[waypointIdx];
  const b = points[waypointIdx + 1];
  const segmentMeters = metersBetween(a, b);
  const pace = activeWalk.pace_mps ?? 1.4;
  const segmentMs = (segmentMeters / pace) * 1000;
  const elapsed = Date.now() - segmentStartTs;
  const t = Math.min(1, elapsed / Math.max(segmentMs, 1));

  const lat = a.lat + (b.lat - a.lat) * t;
  const lng = a.lng + (b.lng - a.lng) * t;
  setSimulatedFix({ lat, lng });

  if (t >= 1) {
    waypointIdx += 1;
    segmentStartTs = Date.now();
    const reached = b.label ?? `wp ${waypointIdx}`;
    console.log('[simGPS] reached:', reached);
  }

  emit({
    walk_id: activeWalk.id,
    waypoint_index: waypointIdx,
    fraction_through: t,
    current_lat: lat,
    current_lng: lng,
    next_label: points[waypointIdx + 1]?.label ?? null,
    pace_mps: pace,
  });
}

export { isSimulatedActive };

// 2026-05-17 — JSON-driven synthetic round playback.
//
// Loads __mocks__/mockRound.json and converts each hole into a 4-point
// waypoint trace (tee → 1/3 fairway → 2/3 fairway → green). Time
// between waypoints is compressed by the JSON's compressionRatio so a
// real 4-hour round plays in ~4 minutes by default. Pure dev tool —
// production builds can call this too (no native deps) but the entry
// point is hidden behind Settings → Owner Tools → "Simulate Round".

interface MockRoundHole {
  holeNumber: number;
  par: number;
  expectedYardage: number;
  computedYardage: number;
  bearingDeg: number;
  tee: { lat: number; lng: number; timestampMs: number };
  green: { lat: number; lng: number; timestampMs: number };
  hazards: string[];
  shotsPlanned: number;
}

export interface MockRound {
  schemaVersion: number;
  courseName: string;
  courseId: string;
  totalHoles: number;
  compressionRatio: number;
  shotIntervalMs: number;
  betweenHoleWalkMs: number;
  holes: MockRoundHole[];
}

/** Convert a MockRound JSON object into a SimulatedWalk that
 *  startSimulatedWalk understands. Each hole expands to:
 *    [tee] → [1/3 fairway] → [2/3 fairway] → [green] → [next hole tee]
 *  with the last hole's green capped (no next-tee continuation). */
export function buildWalkFromMockRound(round: MockRound): SimulatedWalk {
  const points: SimulatedWalkPoint[] = [];
  for (let i = 0; i < round.holes.length; i++) {
    const h = round.holes[i];
    const { tee, green } = h;
    // Tee position
    points.push({ lat: tee.lat, lng: tee.lng, label: `H${h.holeNumber} tee` });
    // Fairway interpolations to seed sustained-position windows
    points.push({
      lat: tee.lat + (green.lat - tee.lat) * 0.34,
      lng: tee.lng + (green.lng - tee.lng) * 0.34,
      label: `H${h.holeNumber} mid-fairway`,
    });
    points.push({
      lat: tee.lat + (green.lat - tee.lat) * 0.67,
      lng: tee.lng + (green.lng - tee.lng) * 0.67,
      label: `H${h.holeNumber} approach`,
    });
    // Green
    points.push({ lat: green.lat, lng: green.lng, label: `H${h.holeNumber} green` });
  }
  // Pace tuned so the whole round completes in ~ totalHoles * 2s at
  // the default compression. Effective: speed-up walking pace so the
  // simulator interpolates each segment in ~250ms instead of ~5min.
  const segmentMeters = 60; // rough mean per segment
  const targetSegmentMs = 250;
  const pace = (segmentMeters * 1000) / targetSegmentMs; // m/s — much faster than real walking
  return {
    id: `mock-round-${round.courseId}`,
    display_name: `Synthetic: ${round.courseName} (${round.totalHoles} holes)`,
    course_name_hint: round.courseName.toLowerCase(),
    description: 'Synthetic 18-hole round from __mocks__/mockRound.json. Compressed time.',
    pace_mps: pace,
    points,
  };
}

/** 2026-05-18 — Start a synthetic round end-to-end:
 *   1. Build CourseHole[] from the mock JSON and call roundStore.startRound
 *      so isRoundActive flips true, courseHoles populates, and downstream
 *      subscribers (holeDetection, orchestrator, SmartFinder) wake up.
 *   2. Suppress the real GPS watcher (otherwise the device's actual fix
 *      fights the simulator and yardages snap back to real coords).
 *   3. Feed the simulated walk so the cached fix marches tee→green for
 *      every hole.
 *  Returns the walk_id so callers can subscribe / stop. */
export function startSyntheticRound(round: MockRound): string {
  // 1. Build CourseHole records from the mock holes. The mock JSON only
  //    has tee + green coords, so middle/front/back all collapse onto
  //    the green centroid — fine for a synthetic test (yardages won't
  //    be 3-decimal accurate but the hole-progression / Kevin firing /
  //    auto-detect paths all exercise correctly).
  const courseHoles = round.holes.map(h => ({
    hole: h.holeNumber,
    par: h.par,
    distance: h.expectedYardage,
    front: Math.max(0, h.expectedYardage - 10),
    back: h.expectedYardage + 10,
    teeLat: h.tee.lat,
    teeLng: h.tee.lng,
    middleLat: h.green.lat,
    middleLng: h.green.lng,
    frontLat: h.green.lat,
    frontLng: h.green.lng,
    backLat: h.green.lat,
    backLng: h.green.lng,
    note: '',
    estimated: true,
  }));

  // 1b. Seed the geometry cache so holeDetection.detectCurrentHole()
  //     can find tee + green coords and auto-advance the hole as the
  //     simulator walks. Without this, holeDetection short-circuits
  //     with "no current-hole green geometry" and the round sits on
  //     hole 1 forever.
  try {
    const { _seedGeometry } = require('./courseGeometryService');
    _seedGeometry({
      course_id: round.courseId,
      course_name: round.courseName,
      fetched_at: Date.now(),
      holes: round.holes.map(h => ({
        hole_number: h.holeNumber,
        par: h.par,
        yardage: h.expectedYardage,
        tee: { lat: h.tee.lat, lng: h.tee.lng },
        green: { lat: h.green.lat, lng: h.green.lng },
        green_front: { lat: h.green.lat, lng: h.green.lng },
        green_back: { lat: h.green.lat, lng: h.green.lng },
        bearing_deg: h.bearingDeg,
        hazards: [],
        fairway_centerline: [],
        green_outline: [],
      })),
    });
    console.log('[simGPS] seeded synthetic geometry for', round.holes.length, 'holes');
  } catch (e) {
    console.log('[simGPS] geometry seed failed (non-fatal):', e);
  }

  // 2. Start the round in the store. Lazy require dodges any circular
  //    import risk and matches the pattern used elsewhere for cycle-prone
  //    stores. Includes our synthetic course id so geometry pre-warm
  //    will no-op gracefully (no record in the geometry service).
  try {
    const { useRoundStore } = require('../store/roundStore');
    useRoundStore.getState().startRound(round.courseName, courseHoles, {
      nineHole: false,
      isCompetition: false,
      notes: 'Synthetic round playback (dev harness)',
      goal: null,
      courseId: round.courseId,
      mode: 'free_play',
    });
    console.log('[simGPS] synthetic round started in store:', round.courseName, courseHoles.length, 'holes');
  } catch (e) {
    console.log('[simGPS] startRound failed:', e);
  }

  // 3. Kill the real GPS watcher AFTER startRound's async GPS boot has
  //    had a chance to fire. The 600ms delay lets startRound's
  //    requestForegroundPermissionsAsync → startGpsManager() chain run,
  //    then we tear it down so simulated coords own the fix cache.
  setTimeout(() => {
    try {
      const { stopGpsManager } = require('./gpsManager');
      stopGpsManager();
      console.log('[simGPS] real GPS watcher suppressed — simulator owns the fix');
    } catch (e) {
      console.log('[simGPS] stopGpsManager failed (non-fatal):', e);
    }
  }, 600);

  // 4. Register and start the simulated walk.
  const walk = buildWalkFromMockRound(round);
  const existingIdx = SIMULATED_WALKS.findIndex(w => w.id === walk.id);
  if (existingIdx >= 0) SIMULATED_WALKS[existingIdx] = walk;
  else SIMULATED_WALKS.push(walk);
  startSimulatedWalk(walk.id);
  return walk.id;
}

/** 2026-05-18 — Stop the synthetic round end-to-end. Mirrors
 *  startSyntheticRound: discards the round in the store, clears the
 *  simulated fix, and stops the walk timer. */
export function stopSyntheticRound(): void {
  stopSimulatedWalk();
  try {
    const { useRoundStore } = require('../store/roundStore');
    const s = useRoundStore.getState();
    if (s.isRoundActive) {
      s.discardRound();
      console.log('[simGPS] synthetic round discarded from store');
    }
  } catch (e) {
    console.log('[simGPS] discardRound failed:', e);
  }
}
