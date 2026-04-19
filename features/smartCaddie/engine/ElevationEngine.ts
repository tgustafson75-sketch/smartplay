/**
 * ElevationEngine.ts
 *
 * Lightweight elevation adjustment for effective playing distance.
 * Rule of thumb: every 10 ft of elevation change ≈ 1 yd of distance.
 * V1 uses a simple 3-step toggle (up / flat / down) with fixed multipliers:
 *   uphill   → ball plays LONGER (club up) → multiply by 1.05 (+5%)
 *   downhill → ball plays SHORTER (club down) → multiply by 0.95 (−5%)
 *   flat     → no change
 */

export type ElevationState = 'up' | 'flat' | 'down';

/**
 * Adjust a distance for elevation change.
 * Returns rounded yards.
 */
export function adjustForElevation(
  distance:  number,
  elevation: ElevationState,
): number {
  if (elevation === 'up')   return Math.round(distance * 1.05);
  if (elevation === 'down') return Math.round(distance * 0.95);
  return Math.round(distance);
}

/** Human-readable label */
export function elevationLabel(elevation: ElevationState): string {
  if (elevation === 'up')   return '↑ Uphill';
  if (elevation === 'down') return '↓ Downhill';
  return '— Flat';
}
