/**
 * features/smartCaddie/engine/PressureEngine.ts
 *
 * Detects pressure situations: late-round holes and consecutive bad shots.
 */

import type { RoundShot } from '../hooks/useRoundStore';

export type PressureLevel = 'high' | 'normal';

const LATE_HOLE_THRESHOLD  = 15;   // holes 15–18 count as late round
const BAD_STREAK_WINDOW    = 3;    // look at last 3 shots

export const calculatePressure = ({
  holeNumber,
  roundShots,
}: {
  holeNumber:  number;
  roundShots:  RoundShot[];
}): PressureLevel => {
  // Late-round pressure
  if (holeNumber >= LATE_HOLE_THRESHOLD) return 'high';

  // Three consecutive non-good shots = bad streak
  if (roundShots.length >= BAD_STREAK_WINDOW) {
    const last = roundShots.slice(-BAD_STREAK_WINDOW);
    if (last.every((s) => s.result !== 'good')) return 'high';
  }

  return 'normal';
};
