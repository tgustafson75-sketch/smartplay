/**
 * utils/distance.ts
 *
 * Haversine distance calculation and GPS yardage smoothing utilities.
 * Pure functions — no React, no Expo, no side effects.
 * Used by useGpsEngine.ts and directly by PlayScreenClean.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface GreenTargets {
  front:  LatLng | null;
  middle: LatLng | null;
  back:   LatLng | null;
}

export interface FMBYardages {
  front:  number | null;
  middle: number | null;
  back:   number | null;
}

// ─── Haversine ───────────────────────────────────────────────────────────────

/**
 * Great-circle distance in yards.
 * Matches Garmin to ±1 yard at golf distances (< 700 yards).
 */
export function haversineYards(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R  = 6_371_000; // Earth radius in metres
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a  =
    Math.sin(df / 2) ** 2 +
    Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  const metres = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(metres * 1.09361);
}

/**
 * Shorthand: metres between two LatLng points (for accuracy comparisons).
 */
export function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R  = 6_371_000;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a  =
    Math.sin(df / 2) ** 2 +
    Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Yardage computation ─────────────────────────────────────────────────────

/**
 * Compute front / middle / back yardages from a player position to green targets.
 *
 * Returns null for any target whose coordinates are missing or produce a
 * physically implausible distance (< 1 yard, or > maxYards).
 */
export function computeFMB(
  playerLat: number,
  playerLon: number,
  targets: GreenTargets,
  maxYards = 900,
): FMBYardages {
  const safe = (t: LatLng | null): number | null => {
    if (!t || (t.latitude === 0 && t.longitude === 0)) return null;
    const y = haversineYards(playerLat, playerLon, t.latitude, t.longitude);
    return y > 0 && y <= maxYards ? y : null;
  };
  return {
    front:  safe(targets.front),
    middle: safe(targets.middle),
    back:   safe(targets.back),
  };
}

/**
 * Compute F/M/B from a single calibrated middle pin.
 * Infers front/back from the green depth (4% of hole distance, min 12 yards).
 */
export function computeFMBFromCalibrated(
  playerLat: number,
  playerLon: number,
  pinLat: number,
  pinLon: number,
  holeDistance: number,
): FMBYardages {
  const mid   = haversineYards(playerLat, playerLon, pinLat, pinLon);
  const depth = Math.max(12, Math.round(holeDistance * 0.04));
  return {
    front:  Math.max(1, mid - depth),
    middle: mid,
    back:   mid + depth,
  };
}

// ─── Rolling average smoothing ────────────────────────────────────────────────

const MAX_READINGS = 5;

/** Sliding window of up to MAX_READINGS middle-yardage readings */
export type ReadingBuffer = number[];

/**
 * Add a new reading to the buffer, capped at MAX_READINGS.
 * Returns the new buffer (immutable-style — caller may store via useRef).
 */
export function pushReading(buffer: ReadingBuffer, value: number): ReadingBuffer {
  const next = [...buffer, value];
  return next.length > MAX_READINGS ? next.slice(next.length - MAX_READINGS) : next;
}

/**
 * Return the average of the buffer, rounded to the nearest yard.
 * Returns the raw value if the buffer has only one entry.
 */
export function averageBuffer(buffer: ReadingBuffer): number | null {
  if (buffer.length === 0) return null;
  const sum = buffer.reduce((a, b) => a + b, 0);
  return Math.round(sum / buffer.length);
}

/**
 * Apply rolling-average smoothing to a fresh F/M/B reading.
 *
 * Smooths only the middle yardage and derives front/back by keeping the same
 * offsets as the raw reading.  This prevents the three values from drifting
 * out of sync with each other.
 */
export function smoothFMB(
  raw: FMBYardages,
  buffer: ReadingBuffer,
): { smoothed: FMBYardages; updatedBuffer: ReadingBuffer } {
  if (raw.middle == null) {
    return { smoothed: raw, updatedBuffer: buffer };
  }
  const updatedBuffer = pushReading(buffer, raw.middle);
  const smoothedMiddle = averageBuffer(updatedBuffer) ?? raw.middle;

  // Keep the same F-M and M-B offsets as the raw reading
  const fOffset = raw.front  != null ? raw.middle - raw.front  : 15;
  const bOffset = raw.back   != null ? raw.back   - raw.middle : 15;

  return {
    smoothed: {
      front:  raw.front  != null ? smoothedMiddle - fOffset : null,
      middle: smoothedMiddle,
      back:   raw.back   != null ? smoothedMiddle + bOffset : null,
    },
    updatedBuffer,
  };
}

// ─── Noise / spike filters ────────────────────────────────────────────────────

/**
 * Returns true if the new middle reading should be discarded.
 *
 * Two rules:
 *   1. Noise gate  — ignore sub-3-yard changes (GPS drift on a stationary device).
 *   2. Jump clamp  — reject > 50-yard leaps unless `holeChanged` is true.
 */
export function shouldDiscard(
  prevMiddle: number | null,
  newMiddle:  number | null,
  holeChanged = false,
): boolean {
  if (prevMiddle == null || newMiddle == null) return false;
  const delta = Math.abs(newMiddle - prevMiddle);
  if (delta < 3)  return true;  // noise gate
  if (delta > 50 && !holeChanged) return true;  // spike / GPS anomaly
  return false;
}

// ─── GPS accuracy ─────────────────────────────────────────────────────────────

/**
 * GPS confidence threshold in metres.
 * Accuracy (horizontal error radius) > this value → "weak" signal.
 * 20 m  ≈ ±22 yards.  Fine for flagging unreliable signals.
 */
export const GPS_ACCURACY_THRESHOLD_M = 20;

/**
 * Returns true when the GPS fix is below our confidence threshold.
 * `accuracy` is the value from `LocationObject.coords.accuracy` (in metres).
 */
export function isWeakAccuracy(accuracy: number | null | undefined): boolean {
  if (accuracy == null) return false; // unknown → optimistic, let watchdog decide
  return accuracy > GPS_ACCURACY_THRESHOLD_M;
}
