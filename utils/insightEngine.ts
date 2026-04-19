/**
 * insightEngine.ts
 *
 * Lightweight local aggregation and pattern-detection engine.
 * Operates entirely on the last 5 shots — no external calls, no global state.
 *
 * Note: uses the app's native ShotResult type where 'center' === straight.
 */

import type { Shot } from '../store/roundStore';

// ── Distance bucketing ────────────────────────────────────────────────────────
const getDistanceBucket = (distance?: number): string => {
  if (!distance) return 'unknown';
  if (distance < 50) return '0-50';
  if (distance < 100) return '50-100';
  if (distance < 150) return '100-150';
  if (distance < 200) return '150-200';
  return '200+';
};

// ── Return type ───────────────────────────────────────────────────────────────
export type ShotInsight = {
  type: 'trend' | 'neutral';
  message: string;
  context: string;
  confidence: number;
};

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Analyse the last 5 shots and return a caddie message, or null if there
 * aren't enough shots yet (< 3).
 */
export const generateInsight = (shots: Shot[]): ShotInsight | null => {
  if (!shots || shots.length < 3) return null;

  const lastShots = shots.slice(-5);

  const contextKey = `${lastShots[0]?.hole ?? 'any'}-${getDistanceBucket(lastShots[0]?.distance)}`;

  let left = 0;
  let right = 0;

  for (const s of lastShots) {
    if (s.result === 'left') left++;
    else if (s.result === 'right') right++;
  }

  const total = lastShots.length;
  const leftPct  = left  / total;
  const rightPct = right / total;

  if (rightPct >= 0.6) {
    return {
      type:       'trend',
      message:    "You're trending right. Aim left edge.",
      context:    contextKey,
      confidence: rightPct,
    };
  }

  if (leftPct >= 0.6) {
    return {
      type:       'trend',
      message:    "You're trending left. Favor right side.",
      context:    contextKey,
      confidence: leftPct,
    };
  }

  return {
    type:       'neutral',
    message:    'Shots are balanced. Stay aggressive.',
    context:    contextKey,
    confidence: 0.5,
  };
};
