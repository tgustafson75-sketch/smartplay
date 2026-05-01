import type { ShotResult } from '../store/roundStore';

export type ShotLocation = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_YARD = 0.9144;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance between two GPS points in yards. */
export function haversineYards(loc1: ShotLocation, loc2: ShotLocation): number {
  const dLat = toRad(loc2.lat - loc1.lat);
  const dLng = toRad(loc2.lng - loc1.lng);
  const lat1 = toRad(loc1.lat);
  const lat2 = toRad(loc2.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const meters = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
  return meters / METERS_PER_YARD;
}

/** Distance from a shot's start_location to its end_location, in yards. Null if either missing. */
export function shotDistance(shot: ShotResult): number | null {
  if (!shot.start_location || !shot.end_location) return null;
  return haversineYards(shot.start_location, shot.end_location);
}

/** Total yardage covered by the supplied shots on a hole. Skips shots with missing locations. */
export function holeProgressYards(shots: ShotResult[]): number {
  let total = 0;
  for (const s of shots) {
    const d = shotDistance(s);
    if (d != null) total += d;
  }
  return total;
}

/**
 * Initial bearing in degrees (0 = north, clockwise) from loc1 to loc2.
 * Used by HoleShotMap to orient the tee→green axis.
 */
export function bearingDegrees(loc1: ShotLocation, loc2: ShotLocation): number {
  const lat1 = toRad(loc1.lat);
  const lat2 = toRad(loc2.lat);
  const dLng = toRad(loc2.lng - loc1.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Project a GPS location into a 2D plane with `origin` at (0,0) and the
 * `axisTo` direction along +Y. Returns yards-units (x = right of axis, y = forward).
 * Useful for top-down rendering oriented tee→green.
 */
export function projectToAxis(
  loc: ShotLocation,
  origin: ShotLocation,
  axisTo: ShotLocation,
): { x: number; y: number } {
  const dist = haversineYards(origin, loc);
  const bAxis = bearingDegrees(origin, axisTo);
  const bPoint = bearingDegrees(origin, loc);
  const rel = toRad(bPoint - bAxis);
  return {
    x: dist * Math.sin(rel),
    y: dist * Math.cos(rel),
  };
}
