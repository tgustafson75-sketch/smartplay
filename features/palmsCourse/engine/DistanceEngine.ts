/**
 * features/palmsCourse/engine/DistanceEngine.ts
 *
 * Pure distance calculations for the Palms course feature.
 *
 * All functions are stateless and unit-testable — no React imports.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const EARTH_RADIUS_YARDS = 6_371_000 * 1.09361; // metres → yards

// ─── Haversine ────────────────────────────────────────────────────────────────

/**
 * Great-circle distance in yards between two GPS coordinates.
 * Uses the Haversine formula — accurate to within ~0.1% over golf distances.
 */
export function haversineYards(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLng  = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_YARDS * Math.asin(Math.sqrt(a));
}

/**
 * Same as haversineYards but returns a whole number (rounded).
 * Preferred for display in the UI.
 */
export function haversineYardsRounded(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  return Math.round(haversineYards(lat1, lng1, lat2, lng2));
}

// ─── Elevation adjustment ─────────────────────────────────────────────────────

/**
 * Adjusts a flat-ground yardage for an elevation change.
 *
 * Rule of thumb: every 1 ft of uphill adds ~1 yard of play distance;
 * every 1 ft of downhill subtracts ~0.7 yards.
 *
 * Returns an integer rounded to the nearest yard.
 */
export function elevationAdjustedYards(
  flatYards:    number,
  elevationFt:  number, // positive = uphill, negative = downhill
): number {
  const factor = elevationFt >= 0 ? 1.0 : 0.7;
  return Math.round(flatYards + elevationFt * factor);
}

// ─── Wind adjustment ──────────────────────────────────────────────────────────

/**
 * Adjusts carry distance for a headwind / tailwind component.
 *
 * windMph > 0 = headwind (play more club)
 * windMph < 0 = tailwind (play less club)
 *
 * Approximation: 1 mph headwind ≈ +1 yard of play distance.
 */
export function windAdjustedYards(flatYards: number, windMph: number): number {
  return Math.round(flatYards + windMph);
}

// ─── Combined adjustment ─────────────────────────────────────────────────────

export interface DistanceAdjustmentInput {
  rawYards:     number;
  elevationFt?: number;
  windMph?:     number;
}

/**
 * Applies elevation and wind adjustments together.
 * Returns a whole number, rounded to the nearest 5 yards for easy club selection.
 */
export function adjustedPlayingYards({
  rawYards,
  elevationFt = 0,
  windMph     = 0,
}: DistanceAdjustmentInput): number {
  const withElev = elevationAdjustedYards(rawYards, elevationFt);
  const withWind = windAdjustedYards(withElev, windMph);
  return Math.round(withWind / 5) * 5;
}

// ─── Bearing ─────────────────────────────────────────────────────────────────

/**
 * Forward bearing in degrees (0° = north, clockwise) from point A to point B.
 * Used by the play-view image to orient the flag / target line.
 */
export function bearingDegrees(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng  = toRad(lng2 - lng1);
  const y     = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x     =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ─── Alias ────────────────────────────────────────────────────────────────────

/**
 * Alias for `haversineYards` using the conventional (lat1, lon1, lat2, lon2)
 * signature. Returned value is in yards.
 */
export const getDistance = (
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number => haversineYards(lat1, lon1, lat2, lon2);
