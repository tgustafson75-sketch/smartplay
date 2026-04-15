/**
 * dispersion.js — Club-specific shot dispersion model.
 *
 * Analyses the player's shot history for a given club and returns:
 *   bias      — 'right' | 'left' | 'neutral'
 *   tendency  — human-readable pattern label for the caddie prompt
 *
 * Unlike dispersionEngine.js (which looks at all recent shots regardless
 * of club), this module filters to the specific club being hit, returning
 * a more accurate miss profile when enough data exists.
 *
 * Usage:
 *   import { getDispersion } from '../services/dispersion';
 *   const d = getDispersion(shots, 'Driver');
 *   // { bias: 'right', tendency: 'miss_right' }
 */

/**
 * @param {Array<{ club?: string; miss?: string; result?: string }>} shots
 * @param {string} club  — exact club name matching the shot log (e.g. 'Driver')
 * @returns {{ bias: 'right'|'left'|'neutral', tendency: string }}
 */
export const getDispersion = (shots = [], club) => {
  // Filter to shots hit with this specific club.
  // Falls back to result field when miss field is absent.
  const clubShots = club
    ? shots.filter((s) => s.club === club)
    : shots;

  if (clubShots.length < 3) {
    return { bias: 'neutral', tendency: 'unknown' };
  }

  const right = clubShots.filter((s) => (s.miss ?? s.result) === 'right').length;
  const left  = clubShots.filter((s) => (s.miss ?? s.result) === 'left').length;

  if (right > left) return { bias: 'right', tendency: 'miss_right' };
  if (left > right) return { bias: 'left',  tendency: 'miss_left' };
  return { bias: 'neutral', tendency: 'tight' };
};
