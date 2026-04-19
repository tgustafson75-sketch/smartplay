/**
 * features/smartCaddie/hooks/useSmartCaddie.ts
 *
 * Orchestrating hook — composes usePlayerModel + SmartCaddieEngine
 * into a single usable output for the caddie UI.
 */

import { SmartCaddieEngine } from '../SmartCaddieEngine';
import { usePlayerModel } from './usePlayerModel';
import type { SmartCaddieEngineResult } from '../SmartCaddieEngine';
import type { HazardDistance } from '../engine/RiskEngine';
import type { RoundShot } from './useRoundStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UseSmartCaddieInput {
  holeNumber:  number;
  distance:    number;
  /** Optional player-behaviour adjustment from PlayerAdaptation (+1/0/-1). */
  adjustment?: number;
  /** Active hazards with their distance from the player (yards). */
  hazards?: HazardDistance[];
  /** Current-round shots for confidence + pressure detection. */
  roundShots?: RoundShot[];
}

// SmartCaddieState is now the direct engine result — no extra wrapping needed.
export type SmartCaddieState = SmartCaddieEngineResult;

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export const useSmartCaddie = ({ holeNumber, distance, adjustment = 0, hazards = [], roundShots = [] }: UseSmartCaddieInput): SmartCaddieState => {
  const player = usePlayerModel();

  return SmartCaddieEngine({ holeNumber, distance, player, adjustment, hazards, roundShots });
};

