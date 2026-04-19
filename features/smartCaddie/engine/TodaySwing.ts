/**
 * features/smartCaddie/engine/TodaySwing.ts
 *
 * Detects short-term trends in the CURRENT round from result-tagged shots.
 * Requires ≥3 shots before surfacing a bias (avoids noise on hole 1).
 */

import type { RoundShot } from '../hooks/useRoundStore';
import type { MissSide, DistanceBias } from '../hooks/usePlayerModel';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TodaySwingModel {
  /** +1 = hitting long today, -1 = hitting short, 0 = neutral */
  distanceBias: 1 | -1 | 0;
  /** Dominant miss direction today, or null if not enough data */
  miss: MissSide | null;
  /** Human-readable label for the UI */
  statusLabel: string;
  /** true once ≥3 results recorded */
  hasData: boolean;
}

const MIN_SHOTS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

export const buildTodaySwing = (roundShots: RoundShot[]): TodaySwingModel => {
  const withResult = roundShots.filter((s) => s.result != null);

  if (withResult.length < MIN_SHOTS) {
    return { distanceBias: 0, miss: null, statusLabel: 'Neutral', hasData: false };
  }

  let short = 0, long = 0, left = 0, right = 0;
  for (const s of withResult) {
    if (s.result === 'short') short++;
    if (s.result === 'long')  long++;
    if (s.result === 'left')  left++;
    if (s.result === 'right') right++;
  }

  const distanceBias: 1 | -1 | 0 =
    long > short ? 1 :
    short > long ? -1 : 0;

  // Only report a directional miss if it's meaningfully dominant (>= 40% of shots)
  const total   = withResult.length;
  const missMap: [MissSide, number][] = [
    ['left',   left],
    ['right',  right],
    ['center', total - left - right],
  ];
  const [topMiss, topCount] = missMap.sort((a, b) => b[1] - a[1])[0];
  const miss: MissSide | null = topCount / total >= 0.4 ? topMiss : null;

  const statusLabel =
    distanceBias === 1  ? 'Hitting long' :
    distanceBias === -1 ? 'Hitting short' : 'Neutral';

  return { distanceBias, miss, statusLabel, hasData: true };
};
