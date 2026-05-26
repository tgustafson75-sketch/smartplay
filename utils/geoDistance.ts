import type { ShotResult } from '../store/roundStore';

export type ShotLocation = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_YARD = 0.9144;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance between two GPS points in meters. */
export function haversineMeters(loc1: ShotLocation, loc2: ShotLocation): number {
  const dLat = toRad(loc2.lat - loc1.lat);
  const dLng = toRad(loc2.lng - loc1.lng);
  const lat1 = toRad(loc1.lat);
  const lat2 = toRad(loc2.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
}

/** Haversine distance between two GPS points in yards. */
export function haversineYards(loc1: ShotLocation, loc2: ShotLocation): number {
  return haversineMeters(loc1, loc2) / METERS_PER_YARD;
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
 * 2026-05-26 — Walk `yards` from `origin` along compass bearing
 * `bearingDeg` (0 = north, clockwise). Inverse of haversineYards +
 * bearingDegrees: given a known anchor (green/pin) and a stated
 * distance + direction, compute the implied GPS position.
 *
 * Used by confirmPositionHandler to derive "where the user actually
 * is" from utterances like "I'm 140 out from hole 2 pin on Palms"
 * (walk 140y from the green back along the green→tee bearing).
 *
 * Spherical-earth formula; accurate to <1y for golf-scale distances.
 */
export function destinationPoint(
  origin: ShotLocation,
  bearingDeg: number,
  yards: number,
): ShotLocation {
  const meters = yards * METERS_PER_YARD;
  const angularDist = meters / EARTH_RADIUS_M;
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);
  const brng = toRad(bearingDeg);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) +
    Math.cos(lat1) * Math.sin(angularDist) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
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
