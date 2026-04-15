/**
 * strokesGained.js — Lightweight strokes-gained estimator.
 *
 * Uses simple heuristics on the shot log to estimate relative
 * performance in driving, approach, and putting. No external API
 * or lookup tables — purpose is trend detection, not tour-level math.
 *
 * Pure function — no side effects, no state.
 *
 * Usage:
 *   import { calculateStrokesGained } from '../services/strokesGained';
 *   const sg = calculateStrokesGained(shots);
 *   // { driving: 0.4, approach: -0.2, putting: 0.6, total: 0.8 }
 */

/**
 * Estimate strokes gained across three categories.
 *
 * Shot classification:
 *   - Driving:  club === 'Driver', straight = +0.2, miss = -0.2
 *   - Approach: non-driver AND distance > 100 yds; miss === 'green' → +0.2, else -0.2
 *   - Putting:  club === 'Putter' OR type === 'putt'; result === 'made' → +0.3, miss → -0.3
 *
 * @param {Array<{
 *   club?: string,
 *   distance?: number,
 *   miss?: string,
 *   result?: string,
 *   type?: string
 * }>} shots
 * @returns {{ driving: number, approach: number, putting: number, total: number }}
 */
export const calculateStrokesGained = (shots = []) => {
  let driving  = 0;
  let approach = 0;
  let putting  = 0;

  shots.forEach((shot) => {
    const club   = (shot.club   ?? '').toLowerCase();
    const miss   = (shot.miss   ?? '').toLowerCase();
    const result = (shot.result ?? '').toLowerCase();
    const type   = (shot.type   ?? '').toLowerCase();
    const dist   = shot.yardsCarried ?? shot.distance ?? 0;

    if (club === 'driver') {
      // Driving: reward straight shots, penalise misses
      if (miss === 'straight' || result === 'straight' || miss === 'fairway') {
        driving += 0.2;
      } else if (miss === 'left' || miss === 'right' || result === 'left' || result === 'right') {
        driving -= 0.2;
      }
      return;
    }

    if (club === 'putter' || type === 'putt') {
      // Putting: made putts gain, misses lose
      if (result === 'made' || result === 'straight') {
        putting += 0.3;
      } else {
        putting -= 0.3;
      }
      return;
    }

    if (dist > 100) {
      // Approach: green hit = gain, miss = lose
      if (miss === 'green' || result === 'straight') {
        approach += 0.2;
      } else if (miss === 'left' || miss === 'right' || result === 'left' || result === 'right') {
        approach -= 0.2;
      }
    }
  });

  return {
    driving:  Math.round(driving  * 10) / 10,
    approach: Math.round(approach * 10) / 10,
    putting:  Math.round(putting  * 10) / 10,
    total:    Math.round((driving + approach + putting) * 10) / 10,
  };
};
