/**
 * features/smartCaddie/hooks/useRoundStore.ts
 *
 * Lightweight in-memory store for caddie shots in the CURRENT round only.
 * Module-level array ensures state persists across re-renders without Zustand.
 * Designed for the TodaySwing engine — reset on each new round.
 */

import { useState } from 'react';
import type { ShotResult } from './useShotTracking';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RoundShot {
  recommended: string;
  selected:    string;
  distance:    number;
  result:      ShotResult;
  timestamp:   number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state (survives re-renders, resets only via resetRound)
// ─────────────────────────────────────────────────────────────────────────────

let _roundShots: RoundShot[] = [];

/** Read the current round shots outside React — safe to call before resetRound. */
export function getRoundShotsSnapshot(): RoundShot[] {
  return [..._roundShots];
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export const useRoundStore = () => {
  const [roundShots, setRoundShots] = useState<RoundShot[]>(_roundShots);

  const addRoundShot = (shot: RoundShot) => {
    _roundShots = [..._roundShots, shot];
    setRoundShots(_roundShots);
  };

  const resetRound = () => {
    _roundShots = [];
    setRoundShots([]);
  };

  return { roundShots, addRoundShot, resetRound };
};
