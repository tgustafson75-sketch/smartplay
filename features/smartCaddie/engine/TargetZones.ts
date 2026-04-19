/**
 * features/smartCaddie/engine/TargetZones.ts
 *
 * Generates a set of candidate landing targets around the given distance.
 * Three zones: safe (lay back), standard (normal play), aggressive (go for it).
 */

export type TargetLabel = 'safe' | 'standard' | 'aggressive';

export interface TargetZone {
  label:   TargetLabel;
  yardage: number;
}

/**
 * Returns three candidate targets relative to the center distance.
 * @param distance  Yards to center of green
 */
export function generateTargets(distance: number): TargetZone[] {
  return [
    { label: 'safe',       yardage: distance - 30 },
    { label: 'standard',   yardage: distance - 10 },
    { label: 'aggressive', yardage: distance + 10 },
  ];
}
