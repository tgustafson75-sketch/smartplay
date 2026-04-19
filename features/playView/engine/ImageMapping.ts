/**
 * features/playView/engine/ImageMapping.ts
 *
 * Unified GPS ↔ pixel mapping for hole images.
 *
 * DESIGN
 * ──────
 * Uses the multi-point fairway path as a spine. For any pixel tap:
 *   1. Find the path segment whose pixel midpoint is nearest to the tap.
 *   2. Project the tap pixel onto that segment axis (clamped 0–1).
 *   3. Interpolate GPS along the segment to get the on-spine GPS.
 *   4. Compute lateral offset (pixels) from the segment perpendicular.
 *   5. Convert lateral offset to GPS using local px-per-degree scale.
 *
 * For GPS → pixel (player dot), delegate to PathProjection (unchanged).
 *
 * ALL distances are GPS Haversine — never pixel arithmetic.
 */

import type { PathPoint }   from '../data/holeMapping';
import { haversineYards }   from '../../palmsCourse/engine/DistanceEngine';
import { mapToFairwayPath } from './PathProjection';

// ─── Re-export GPS → pixel (for external callers) ─────────────────────────────

export { mapToFairwayPath as gpsToPixel };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PixelCoord {
  x: number;
  y: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GreenAnchors {
  /** GPS of the front edge of the green */
  front: LatLng;
  /** GPS of the center of the green (pin) */
  center: LatLng;
  /** GPS of the back edge of the green */
  back: LatLng;
}

export interface GreenDistances {
  front:  number;
  center: number;
  back:   number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Squared pixel distance (avoids sqrt — comparison only) */
function px2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

/** Dot product of two 2-D vectors */
function dot2(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

/**
 * Project point P onto the segment AB.
 * Returns t ∈ [0,1] — the parametric position along AB.
 */
function projectOntoSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return 0;
  return Math.max(0, Math.min(1, dot2(px - ax, py - ay, abx, aby) / len2));
}

// ─── Core: pixel → GPS ────────────────────────────────────────────────────────

/**
 * Convert a pixel tap on a hole image to an approximate GPS coordinate.
 *
 * Unlike the previous nearest-anchor snap, this interpolates along the
 * closest path segment and applies a lateral offset so off-fairway taps
 * (rough, hazards) return a plausible GPS position.
 *
 * Accuracy: ±3–8 yards depending on path density and image alignment.
 * (Equivalent or better than a 3–5 anchor snap-to-path approach.)
 *
 * @param tap         Pixel coordinate of the user's tap
 * @param path        Ordered path points (tee → green)
 * @param imageWidth  Rendered image width in pixels
 * @param imageHeight Rendered image height in pixels
 */
export function pixelToGPS(
  tap:         PixelCoord,
  path:        PathPoint[],
  imageWidth:  number,
  imageHeight: number,
): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (path.length === 1) return { lat: path[0].lat, lng: path[0].lng };

  // ── Step 1: find the segment closest to the tap ───────────────────────────
  let bestSegIdx  = 0;
  let bestDistSq  = Infinity;
  let bestT       = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i].pixel;
    const p2 = path[i + 1].pixel;
    const t  = projectOntoSegment(tap.x, tap.y, p1.x, p1.y, p2.x, p2.y);
    // Closest point on segment
    const cx = p1.x + t * (p2.x - p1.x);
    const cy = p1.y + t * (p2.y - p1.y);
    const d2 = px2(tap.x, tap.y, cx, cy);

    if (d2 < bestDistSq) {
      bestDistSq  = d2;
      bestSegIdx  = i;
      bestT       = t;
    }
  }

  // ── Step 2: interpolate GPS along the best segment ────────────────────────
  const segP1 = path[bestSegIdx];
  const segP2 = path[bestSegIdx + 1];

  const spineLat = segP1.lat + bestT * (segP2.lat - segP1.lat);
  const spineLng = segP1.lng + bestT * (segP2.lng - segP1.lng);

  // ── Step 3: compute lateral offset in pixels ──────────────────────────────
  const segDxPx = segP2.pixel.x - segP1.pixel.x;
  const segDyPx = segP2.pixel.y - segP1.pixel.y;
  const segLenPx = Math.sqrt(segDxPx ** 2 + segDyPx ** 2);

  if (segLenPx < 1) return { lat: spineLat, lng: spineLng };

  // Unit perpendicular to the segment (left-hand normal)
  const perpUx =  segDyPx / segLenPx;  // left-normal x
  const perpUy = -segDxPx / segLenPx;  // left-normal y

  // Tap offset from spine point
  const spineX = segP1.pixel.x + bestT * segDxPx;
  const spineY = segP1.pixel.y + bestT * segDyPx;
  const offPx  = dot2(tap.x - spineX, tap.y - spineY, perpUx, perpUy);

  // ── Step 4: convert pixel offset to GPS offset ────────────────────────────
  // px-per-degree: use segment GPS span vs pixel span for scale
  const dLat = segP2.lat - segP1.lat;
  const dLng = segP2.lng - segP1.lng;

  // Degrees per pixel along the spine
  const degPerPxLat = segLenPx > 0 ? Math.abs(dLat) / segLenPx : 0;
  const degPerPxLng = segLenPx > 0 ? Math.abs(dLng) / segLenPx : 0;

  // Assume image is north-up so lateral offset maps mostly to lng change.
  // Use image diagonal as fallback scale if segment is too short.
  const fallbackDegPerPx = 0.000005; // ~0.5 yd/px fallback
  const scale = (degPerPxLat > 0 || degPerPxLng > 0)
    ? Math.sqrt(degPerPxLat ** 2 + degPerPxLng ** 2)
    : fallbackDegPerPx;

  // The perpendicular direction in GPS space (rotate spine GPS vector by 90°)
  const spineGpsLen = Math.sqrt(dLat ** 2 + dLng ** 2) || 1e-9;
  const perpGpsLat  =  dLng / spineGpsLen;   // left-normal lat component
  const perpGpsLng  = -dLat / spineGpsLen;   // left-normal lng component

  const offDeg = offPx * scale;

  return {
    lat: spineLat + offDeg * perpGpsLat,
    lng: spineLng + offDeg * perpGpsLng,
  };
}

// ─── Distance to target ───────────────────────────────────────────────────────

/**
 * GPS distance (yards) from the player to a tapped pixel.
 * This is the ONLY supported way to measure distance — never use pixel math.
 */
export function distanceToTapYards(
  tap:        PixelCoord,
  path:       PathPoint[],
  imageWidth: number,
  imageHeight: number,
  playerLat:  number,
  playerLng:  number,
): number {
  const target = pixelToGPS(tap, path, imageWidth, imageHeight);
  return Math.round(haversineYards(playerLat, playerLng, target.lat, target.lng));
}

// ─── Green front / center / back distances ───────────────────────────────────

/**
 * Compute front / center / back green distances from player GPS.
 * Green anchors should come from the course data (HoleData.front/middle/back).
 * Falls back to ±14 yd offsets around center if front/back are null.
 */
export function greenDistances(
  playerLat:  number,
  playerLng:  number,
  center:     LatLng,
  front?:     LatLng | null,
  back?:      LatLng | null,
): GreenDistances {
  const cDist = Math.round(haversineYards(playerLat, playerLng, center.lat, center.lng));

  const fDist = front
    ? Math.round(haversineYards(playerLat, playerLng, front.lat, front.lng))
    : Math.max(1, cDist - 14);

  const bDist = back
    ? Math.round(haversineYards(playerLat, playerLng, back.lat, back.lng))
    : cDist + 14;

  return { front: fDist, center: cDist, back: bDist };
}

// ─── Jitter guard ─────────────────────────────────────────────────────────────

/**
 * Returns true only when the new distance differs from the previous by
 * more than `threshold` yards (default 1).  Use this to suppress re-renders
 * caused by GPS noise.
 */
export function isSignificantDistanceChange(
  prev:      number,
  next:      number,
  threshold = 1,
): boolean {
  return Math.abs(next - prev) > threshold;
}
