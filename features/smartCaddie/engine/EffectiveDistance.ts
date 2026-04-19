/**
 * EffectiveDistance.ts
 *
 * Combines wind and elevation adjustments into a single "plays like" yardage.
 * Chain: base → wind adjustment → elevation adjustment → round.
 */

import { adjustForWind, type WindState } from './WindEngine';
import { adjustForElevation, type ElevationState } from './ElevationEngine';

export interface EffectiveDistanceInput {
  baseDistance: number;
  wind:         WindState;
  elevation:    ElevationState;
}

export interface EffectiveDistanceResult {
  /** Final adjusted yardage (rounded) */
  effective:     number;
  /** Raw distance passed in */
  base:          number;
  /** Net yards added/removed vs base */
  delta:         number;
  /** True when effective !== base */
  isAdjusted:    boolean;
  /** Lateral pixel shift from crosswind (pass pxPerYd when in map context) */
  lateralShiftPx: number;
}

export function getEffectiveDistance(
  input:     EffectiveDistanceInput,
  pxPerYd = 0,
): EffectiveDistanceResult {
  const { baseDistance, wind, elevation } = input;

  // Step 1: wind (may also return lateral shift for crosswind)
  const windResult = adjustForWind(baseDistance, wind, pxPerYd);

  // Step 2: elevation applied to already wind-adjusted distance
  const afterElev = adjustForElevation(windResult.adjusted, elevation);

  const delta = afterElev - baseDistance;

  return {
    effective:      afterElev,
    base:           baseDistance,
    delta,
    isAdjusted:     delta !== 0,
    lateralShiftPx: windResult.lateralShiftPx,
  };
}
