/**
 * features/smartCaddie/engine/ConfidenceEngine.ts
 *
 * Measures player confidence based on their last 5 shot results
 * in the current round.  Requires ≥3 shots before leaving 'neutral'.
 */

import type { RoundShot } from '../hooks/useRoundStore';

export type ConfidenceLevel = 'high' | 'neutral' | 'low';

const MIN_SHOTS  = 3;
const WINDOW     = 5;
const GOOD_THRESHOLD = 4;   // ≥4 good in last 5 → high
const BAD_THRESHOLD  = 4;   // ≥4 bad  in last 5 → low

export const calculateConfidence = (roundShots: RoundShot[]): ConfidenceLevel => {
  if (roundShots.length < MIN_SHOTS) return 'neutral';

  const window = roundShots.slice(-WINDOW);
  let good = 0;
  let bad  = 0;

  for (const s of window) {
    if (s.result === 'good') good++;
    else                     bad++;
  }

  if (good >= GOOD_THRESHOLD) return 'high';
  if (bad  >= BAD_THRESHOLD)  return 'low';
  return 'neutral';
};
