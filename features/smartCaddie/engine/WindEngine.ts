/**
 * WindEngine.ts
 *
 * Lightweight wind adjustment for effective playing distance.
 * No physics model — empirical coefficients chosen to match
 * common tour-caddie rules of thumb:
 *   headwind: ~1 club per 10 mph (+8 yds / 10 mph)
 *   tailwind: ~0.5 club per 10 mph (-5 yds / 10 mph)
 *   crosswind: no distance change, only lateral dispersion shift
 *
 * All values are in yards and mph.
 */

export type WindDirection = 'head' | 'tail' | 'left' | 'right';

export interface WindState {
  speed:     number;         // mph, 0–40
  direction: WindDirection;
}

export interface WindAdjustResult {
  /** Adjusted distance in yards (rounded) */
  adjusted:      number;
  /**
   * Pixel shift to apply to the target lateral axis.
   * Positive = shift right on screen, negative = shift left.
   * Caller must scale to map pixel density.
   */
  lateralShiftPx: number;
  /** True when this is a crosswind that affects dispersion */
  isCrosswind:   boolean;
}

/**
 * Adjust a raw playing distance for wind.
 *
 * @param distance  Raw GPS / yardage distance in yards
 * @param wind      Current wind speed + direction
 * @param pxPerYd   Pixels per yard on the current map (used to compute lateral shift).
 *                  Pass 0 when not in a map context — lateralShiftPx will be 0.
 */
export function adjustForWind(
  distance: number,
  wind:     WindState,
  pxPerYd  = 0,
): WindAdjustResult {
  const speed = Math.max(0, wind.speed);
  let yardageAdjust = 0;
  let lateralShiftPx = 0;
  let isCrosswind = false;

  switch (wind.direction) {
    case 'head':
      // Into the wind: add ~0.8 yd per mph
      yardageAdjust = speed * 0.8;
      break;
    case 'tail':
      // Downwind: subtract ~0.5 yd per mph
      yardageAdjust = -(speed * 0.5);
      break;
    case 'left':
      // Wind from left → ball drifts right → aim left (shift target left in pixel space)
      isCrosswind    = true;
      lateralShiftPx = pxPerYd > 0 ? -(speed * 1.5) : 0;
      break;
    case 'right':
      // Wind from right → ball drifts left → aim right (shift target right in pixel space)
      isCrosswind    = true;
      lateralShiftPx = pxPerYd > 0 ? (speed * 1.5) : 0;
      break;
  }

  return {
    adjusted:      Math.round(distance + yardageAdjust),
    lateralShiftPx,
    isCrosswind,
  };
}

/** Human-readable label for a wind state, e.g. "10 mph headwind" */
export function windLabel(wind: WindState): string {
  if (wind.speed === 0) return 'No wind';
  const dir = wind.direction === 'head' ? 'headwind'
            : wind.direction === 'tail' ? 'tailwind'
            : wind.direction === 'left' ? '← crosswind'
            : '→ crosswind';
  return `${wind.speed} mph ${dir}`;
}
