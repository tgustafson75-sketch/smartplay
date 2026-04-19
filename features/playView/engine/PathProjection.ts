/**
 * features/playView/engine/PathProjection.ts
 *
 * Projects a player's GPS position onto the hole image using a multi-point
 * fairway path rather than a straight tee-to-green line.
 *
 * Algorithm:
 *   1. Find the path segment whose endpoints are collectively closest to the
 *      player (sum of distances to p1 and p2).
 *   2. Interpolate along that segment using the player's distance from p1
 *      relative to the full segment length.
 *   3. Return the interpolated pixel position.
 *
 * Performance: O(n) where n = path points (keep to 3–5 per hole).
 */

import { distanceBetween } from '../utils/distance';
import type { PathPoint }  from '../data/holeMapping';

export interface ProjectionResult {
  x: number;
  y: number;
}

// ─── Segment helpers ──────────────────────────────────────────────────────────

interface Segment {
  p1: PathPoint;
  p2: PathPoint;
}

function findClosestSegment(
  user: { lat: number; lng: number },
  path: PathPoint[],
): Segment | null {
  if (path.length < 2) return null;

  let minDist  = Infinity;
  let closest: Segment | null = null;

  for (let i = 0; i < path.length - 1; i++) {
    const p1   = path[i];
    const p2   = path[i + 1];
    const dist = distanceBetween(user, p1) + distanceBetween(user, p2);

    if (dist < minDist) {
      minDist = dist;
      closest = { p1, p2 };
    }
  }

  return closest;
}

function interpolatePosition(
  user: { lat: number; lng: number },
  p1:   PathPoint,
  p2:   PathPoint,
): ProjectionResult {
  const totalDist = distanceBetween(p1, p2);
  const userDist  = distanceBetween(p1, user);

  const ratio = totalDist > 0
    ? Math.max(0, Math.min(1, userDist / totalDist))
    : 0;

  return {
    x: p1.pixel.x + (p2.pixel.x - p1.pixel.x) * ratio,
    y: p1.pixel.y + (p2.pixel.y - p1.pixel.y) * ratio,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Maps a player GPS coordinate to pixel coordinates by projecting along
 * the nearest fairway path segment.
 */
export function mapToFairwayPath(
  user: { lat: number; lng: number },
  path: PathPoint[],
): ProjectionResult {
  const segment = findClosestSegment(user, path);
  if (!segment) return { x: 0, y: 0 };
  return interpolatePosition(user, segment.p1, segment.p2);
}
