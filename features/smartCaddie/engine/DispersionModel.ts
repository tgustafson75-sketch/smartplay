/**
 * features/smartCaddie/engine/DispersionModel.ts
 *
 * Builds a shot-dispersion profile from the last 10 tracked shots.
 * Requires ≥5 shots before the model is considered reliable.
 */

import type { RoundShot } from '../hooks/useRoundStore';

export interface Dispersion {
  left:  number;
  right: number;
  short: number;
  long:  number;
  /** true once ≥5 shots recorded */
  hasData: boolean;
}

const MIN_SHOTS = 5;
const WINDOW    = 10;

export const buildDispersion = (shots: RoundShot[]): Dispersion => {
  const hasData = shots.length >= MIN_SHOTS;
  const window  = shots.slice(-WINDOW);

  let left = 0, right = 0, short = 0, long = 0;
  for (const s of window) {
    if (s.result === 'left')  left++;
    if (s.result === 'right') right++;
    if (s.result === 'short') short++;
    if (s.result === 'long')  long++;
  }

  return { left, right, short, long, hasData };
};
