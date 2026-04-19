/**
 * features/smartCaddie/engine/ShotPrediction.ts
 *
 * Predicts the most likely shot outcome from a dispersion profile and
 * converts it into a yardage target offset.
 *
 * Direction logic (counter the miss):
 *   miss right → aim left  (-10 yds offset applied by engine)
 *   miss left  → aim right (+10 yds)
 *   miss short → add 5 yds to carry target
 *   miss long  → subtract 5 yds
 */

import type { Dispersion } from './DispersionModel';

export type PredictedMiss = 'left' | 'right' | 'short' | 'long' | 'center';

export interface ShotPredictionResult {
  predictedMiss:  PredictedMiss;
  targetOffset:   number;   // yards to add to base target
  /** true only when dispersion.hasData is true */
  isReliable:     boolean;
}

export const predictShot = (dispersion: Dispersion): ShotPredictionResult => {
  if (!dispersion.hasData) {
    return { predictedMiss: 'center', targetOffset: 0, isReliable: false };
  }

  const entries: [PredictedMiss, number][] = [
    ['left',  dispersion.left],
    ['right', dispersion.right],
    ['short', dispersion.short],
    ['long',  dispersion.long],
  ];

  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const [topMiss, topCount] = sorted[0];

  // Need at least 2 occurrences to call it a pattern
  if (topCount < 2) {
    return { predictedMiss: 'center', targetOffset: 0, isReliable: false };
  }

  let targetOffset = 0;
  if (topMiss === 'right') targetOffset = -10;  // counter: aim left
  if (topMiss === 'left')  targetOffset = +10;  // counter: aim right
  if (topMiss === 'short') targetOffset = +5;   // add carry
  if (topMiss === 'long')  targetOffset = -5;   // reduce carry

  return { predictedMiss: topMiss, targetOffset, isReliable: true };
};
