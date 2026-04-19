/**
 * features/palmsCourse/engine/GPSCalibrator.ts
 *
 * Bidirectional projection between GPS coordinates and normalised
 * play-view image coordinates for a single Palms hole.
 *
 * Coordinate system:
 *   (0, 0)  — tee end of image (top-left)
 *   (1, 1)  — pin end of image (bottom-right)
 *
 * The mapping uses a simple linear interpolation along the tee→pin axis
 * (the primary axis) and a perpendicular cross-axis for x (left/right).
 * This is accurate enough for a 400 yd corridor; a full affine transform
 * can be substituted here if geodetic accuracy is needed later.
 */

import type { HoleBoundsMapping, LatLng } from '../data/palmsMapping';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Signed difference in latitude degrees (tee → green). */
function dLat(m: HoleBoundsMapping): number {
  return m.green.lat - m.tee.lat;
}

/** Signed difference in longitude degrees (tee → green). */
function dLng(m: HoleBoundsMapping): number {
  return m.green.lng - m.tee.lng;
}

/**
 * Length of the tee→green vector in degree-space (not metres).
 * Used as a normalisation denominator.
 */
function holeLength(m: HoleBoundsMapping): number {
  return Math.sqrt(dLat(m) ** 2 + dLng(m) ** 2);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Projects a GPS coordinate onto the normalised image plane for a hole.
 *
 * Returns { x, y } where both axes are in [0, 1] when the position is
 * inside the hole corridor. Values outside [0, 1] are valid (off-screen).
 */
export function projectToImage(
  lat:     number,
  lng:     number,
  mapping: HoleBoundsMapping,
): { x: number; y: number } {
  const len = holeLength(mapping);
  if (len === 0) return { x: 0.5, y: 0.5 };

  // Unit vector along tee→pin axis.
  const ux = dLng(mapping) / len;
  const uy = dLat(mapping) / len;

  // Vector from tee to player.
  const dx = lng - mapping.tee.lng;
  const dy = lat - mapping.tee.lat;

  // Project onto the tee→pin axis (y) and perpendicular axis (x).
  const along = (dx * ux + dy * uy) / len;          // [0,1] tee→pin
  const perp  = (dx * uy - dy * ux) / len;           // signed left/right

  // Centre the x axis: perp=0 is the fairway centre line.
  // Scale by image aspect ratio so the visible field of view feels natural.
  const aspect = mapping.image.width / mapping.image.height;
  const x = 0.5 + (perp / aspect) * 0.5;
  const y = along;

  return { x, y };
}

/**
 * Back-projects normalised image coordinates to GPS.
 * Inverse of `projectToImage`.
 */
export function imageToGPS(
  nx:      number,
  ny:      number,
  mapping: HoleBoundsMapping,
): LatLng {
  const len = holeLength(mapping);
  const ux  = dLng(mapping) / len;
  const uy  = dLat(mapping) / len;

  // Recover perpendicular offset from the x normalised value.
  const aspect = mapping.image.width / mapping.image.height;
  const perp  = ((nx - 0.5) / 0.5) * aspect * len;
  const along = ny * len;

  // Reconstruct the lat/lng offset from tee.
  const dlng = along * ux + perp * uy;
  const dlat = along * uy - perp * ux;

  return {
    lat: mapping.tee.lat + dlat,
    lng: mapping.tee.lng + dlng,
  };
}

/**
 * Maps a GPS coordinate directly to image pixel coordinates using the
 * teePixel / greenPixel anchors stored in the hole mapping.
 *
 * Uses independent linear interpolation on each axis:
 *   x  — driven by longitude ratio (tee.lng → green.lng)
 *   y  — driven by latitude  ratio (tee.lat → green.lat)
 *
 * Returns pixel coordinates in the image's logical pixel space.
 * Values outside [0, image.width/height] mean the position is off-screen.
 */
export function mapGPSToImage(
  userLat: number,
  userLng: number,
  holeMap: HoleBoundsMapping,
): { x: number; y: number } {
  const { tee, green, image } = holeMap;

  const latRange = green.lat - tee.lat;
  const lngRange = green.lng - tee.lng;

  const latRatio = latRange !== 0 ? (userLat - tee.lat) / latRange : 0;
  const lngRatio = lngRange !== 0 ? (userLng - tee.lng) / lngRange : 0;

  return {
    x: image.teePixel.x + (image.greenPixel.x - image.teePixel.x) * lngRatio,
    y: image.teePixel.y + (image.greenPixel.y - image.teePixel.y) * latRatio,
  };
}
