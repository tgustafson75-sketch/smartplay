/**
 * features/smartCaddie/engine/TargetSelector.ts
 *
 * Selects the best landing target by scoring each candidate zone against
 * the active hazards, incorporating player tendencies.
 * Also generates personalised caddie advice.
 */

import { generateTargets, type TargetZone, type TargetLabel } from './TargetZones';
import { scoreRisk, type HazardDistance, type PlayerProfile }  from './RiskEngine';

export interface ScoredTarget extends TargetZone {
  risk: number;
}

/**
 * Returns the safest landing target given the current distance, hazards,
 * and optional player profile.
 */
export function selectBestTarget(
  distance: number,
  hazards:  HazardDistance[],
  player?:  PlayerProfile,
): ScoredTarget {
  const labelOrder: TargetLabel[] = ['standard', 'safe', 'aggressive'];

  const scored: ScoredTarget[] = generateTargets(distance).map((t) => ({
    ...t,
    risk: scoreRisk(t.yardage, hazards, player),
  }));

  scored.sort((a, b) => {
    if (a.risk !== b.risk) return a.risk - b.risk;
    return labelOrder.indexOf(a.label) - labelOrder.indexOf(b.label);
  });

  return scored[0];
}

/** Converts a best-target label into a caddie voice line. */
export function generateDecisionText(label: TargetLabel): string {
  if (label === 'safe')       return 'Play safe. Avoid trouble and set up your next shot.';
  if (label === 'aggressive') return 'Aggressive line is available. Commit fully if confident.';
  return 'Standard play. Favor the center and commit to the shot.';
}

/**
 * Generates a personalised advice string based on the player's tendencies
 * and the active hazards on the hole.
 */
export function generatePersonalAdvice(
  label:   TargetLabel,
  player:  PlayerProfile,
  hazards: HazardDistance[],
): string {
  const hasWater = hazards.some((h) => h.type === 'water');

  // Miss + hazard on same side
  if (player.miss === 'right') {
    const rightWater = hazards.some((h) => h.type === 'water' && h.side === 'right');
    if (rightWater) return 'Favor left. Your miss is right and water is in play.';
    return 'Favor left side. Your miss tendency is right.';
  }

  if (player.miss === 'left') {
    const leftWater = hazards.some((h) => h.type === 'water' && h.side === 'left');
    if (leftWater) return 'Favor right. Your miss is left and water is in play.';
    return 'Favor right side. Your miss tendency is left.';
  }

  if (player.distanceBias === 'short') {
    if (hasWater) return 'Take one extra club. You tend to come up short and water is in play.';
    return 'Take one extra club. You tend to come up short.';
  }

  // Generic fallback keyed to label
  return generateDecisionText(label);
}
