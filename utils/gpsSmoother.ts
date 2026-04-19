/**
 * utils/gpsSmoother.ts
 *
 * Lightweight GPS smoothing for data-layer use (outside React hooks).
 *
 * Rules:
 *  • Exponential smoothing (70/30) to reduce jitter.
 *  • Jump filter: ignores positions that move > 30 yards (~27.4 m) in one
 *    update — these are GPS errors, not real movement.
 *  • Caller should throttle invocations to once every 1–2 s; this module
 *    does no internal scheduling.
 */

export interface GpsPoint {
  lat: number;
  lng: number;
}

/** Haversine distance in metres between two GPS points. */
function haversineMetres(a: GpsPoint, b: GpsPoint): number {
  const R   = 6_371_000;
  const φ1  = (a.lat * Math.PI) / 180;
  const φ2  = (b.lat * Math.PI) / 180;
  const Δφ  = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ  = ((b.lng - a.lng) * Math.PI) / 180;
  const sin = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(sin), Math.sqrt(1 - sin));
}

/** 30 yards in metres — positions that jump further than this are rejected. */
const MAX_JUMP_METRES = 27.4;

/**
 * Returns a smoothed GPS point from `prev` → `next`.
 *
 * - If `prev` is null, returns `next` unchanged (first reading).
 * - If the jump exceeds 30 yards the reading is treated as noise and `prev`
 *   is returned unchanged (i.e. position is frozen until it settles).
 * - Otherwise applies 70/30 exponential smoothing.
 */
export function smoothGPS(prev: GpsPoint | null, next: GpsPoint): GpsPoint {
  if (!prev) return next;

  const distance = haversineMetres(prev, next);

  // Reject GPS jumps that exceed 30 yards — likely a bad fix.
  if (distance > MAX_JUMP_METRES) return prev;

  return {
    lat: prev.lat * 0.7 + next.lat * 0.3,
    lng: prev.lng * 0.7 + next.lng * 0.3,
  };
}

/** Module-level cache of the last stable position (cleared on app restart). */
let _lastStable: GpsPoint | null = null;

/**
 * Returns the last stable GPS position cached by this module.
 * Useful as an offline fallback when live GPS is unavailable.
 */
export function getLastStablePosition(): GpsPoint | null {
  return _lastStable;
}

/**
 * Convenience wrapper: smooth and cache in one call.
 * Returns the new smoothed position and updates the internal cache.
 */
export function smoothAndCache(next: GpsPoint): GpsPoint {
  const smoothed = smoothGPS(_lastStable, next);
  _lastStable = smoothed;
  return smoothed;
}
