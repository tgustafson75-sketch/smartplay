/**
 * utils/gpsMapping.ts
 *
 * GPS ↔ pixel mapping utilities for the interactive hole map.
 * Enables GPS-accurate distances when the user taps anywhere on the hole image.
 *
 * Coordinate model:
 *   - Hole image y-axis: start.y (≈0.88, bottom) = tee, target.y (≈0.12, top) = green
 *   - GPS lat increases northward; GPS lng decreases westward
 *   - Tee and green GPS act as two anchor points for bilinear interpolation
 */

export type LatLng = { lat: number; lng: number };

/** Earth radius in meters */
const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance in yards between two GPS points */
export const haversineYards = (a: LatLng, b: LatLng): number => {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const sinHalfΔφ = Math.sin(Δφ / 2);
  const sinHalfΔλ = Math.sin(Δλ / 2);
  const x = sinHalfΔφ * sinHalfΔφ + Math.cos(φ1) * Math.cos(φ2) * sinHalfΔλ * sinHalfΔλ;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return EARTH_RADIUS_M * c * 1.09361; // meters → yards
};

/**
 * Convert a pixel tap on the hole image to a GPS coordinate.
 *
 * Uses the tee and green GPS as anchor points. Projects the tap pixel onto the
 * tee→green axis (in normalized image space), then linearly interpolates GPS
 * between the two anchors. Works for both straight and dogleg holes because
 * the distance error only arises from the non-linear part of the fairway, which
 * is minor at normal tap-to-distance ranges.
 *
 * @param px       Tap x in pixels within the rendered image
 * @param py       Tap y in pixels within the rendered image
 * @param mapW     Width of the rendered image in pixels
 * @param mapH     Height of the rendered image in pixels
 * @param teeNorm  Normalized (0–1) image position of the tee (from HOLE_OVERLAYS start)
 * @param pinNorm  Normalized (0–1) image position of the pin (from HOLE_OVERLAYS target)
 * @param teeGPS   GPS coordinates of the tee box
 * @param greenGPS GPS coordinates of the green center (middle)
 * @returns        Approximate GPS coordinates of the tapped point
 */
export const pixelToGPS = (
  px: number,
  py: number,
  mapW: number,
  mapH: number,
  teeNorm: { x: number; y: number },
  pinNorm: { x: number; y: number },
  teeGPS: LatLng,
  greenGPS: LatLng,
): LatLng => {
  if (mapW < 2 || mapH < 2) return greenGPS;

  // Normalize tap position to 0–1
  const tnx = px / mapW;
  const tny = py / mapH;

  // Direction vector tee → pin in normalized image space
  const rawDX = pinNorm.x - teeNorm.x;
  const rawDY = pinNorm.y - teeNorm.y;
  const dirLen = Math.sqrt(rawDX * rawDX + rawDY * rawDY) || 1;
  const dirX = rawDX / dirLen;
  const dirY = rawDY / dirLen;

  // Project tap onto tee→pin axis; t ∈ [0, 1] where 0 = tee, 1 = green
  const vecX = tnx - teeNorm.x;
  const vecY = tny - teeNorm.y;
  const t = Math.max(0, Math.min(1, (vecX * dirX + vecY * dirY) / dirLen));

  return {
    lat: teeGPS.lat + t * (greenGPS.lat - teeGPS.lat),
    lng: teeGPS.lng + t * (greenGPS.lng - teeGPS.lng),
  };
};

/**
 * Convert a GPS coordinate to a pixel position on the hole image.
 * Inverse of pixelToGPS.
 */
export const gpsToPixel = (
  gps: LatLng,
  mapW: number,
  mapH: number,
  teeNorm: { x: number; y: number },
  pinNorm: { x: number; y: number },
  teeGPS: LatLng,
  greenGPS: LatLng,
): { px: number; py: number } => {
  const latRange = greenGPS.lat - teeGPS.lat;
  const t = latRange !== 0 ? (gps.lat - teeGPS.lat) / latRange : 0;
  const tClamped = Math.max(0, Math.min(1, t));

  const normX = teeNorm.x + tClamped * (pinNorm.x - teeNorm.x);
  const normY = teeNorm.y + tClamped * (pinNorm.y - teeNorm.y);

  return { px: normX * mapW, py: normY * mapH };
};
