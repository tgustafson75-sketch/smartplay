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
