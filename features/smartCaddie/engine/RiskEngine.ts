/**
 * features/smartCaddie/engine/RiskEngine.ts
 *
 * Scores the risk of a given target yardage based on proximity to hazards.
 * When a player model is provided, risks are amplified when the hazard
 * aligns with the player's miss tendency or distance bias.
 *
 * Also exports helpers for display: getRiskLabel, getRiskColor.
 */

import type { MissSide, DistanceBias } from '../hooks/usePlayerModel';

export interface HazardDistance {
  distance: number; // yards from player to hazard
  type?:    string; // 'water' | 'bunker' | 'ob' | 'tree'
  side?:    string; // 'left' | 'right' | 'center'
  [key: string]: unknown;
}

export interface PlayerProfile {
  miss:         MissSide;
  distanceBias: DistanceBias;
}

/**
 * Returns a numeric risk score (0 = clean, higher = more dangerous).
 * Player tendencies amplify risk when a hazard matches their weakness.
 */
export function scoreRisk(
  targetYardage: number,
  hazards:       HazardDistance[],
  player?:       PlayerProfile,
): number {
  let risk = 0;

  for (const h of hazards) {
    const diff = Math.abs(h.distance - targetYardage);
    let baseRisk = 0;

    if (diff < 20)      baseRisk = 50; // very dangerous
    else if (diff < 40) baseRisk = 20; // moderate

    if (baseRisk > 0 && player) {
      // Amplify if hazard is on the player's miss side
      if (player.miss !== 'center' && h.side === player.miss) {
        baseRisk *= 1.5;
      }
      // Amplify water risk for players who consistently come up short
      if (player.distanceBias === 'short' && h.type === 'water') {
        baseRisk *= 1.2;
      }
    }

    risk += baseRisk;
  }

  return Math.round(risk);
}

/** Human-readable risk tier label. */
export function getRiskLabel(risk: number): string {
  if (risk < 20) return 'LOW';
  if (risk < 50) return 'MODERATE';
  return 'HIGH';
}

/** Color code for risk level. */
export function getRiskColor(risk: number): string {
  if (risk < 20) return '#4ADE80'; // green
  if (risk < 50) return '#FACC15'; // yellow
  return '#F87171';                // red
}
