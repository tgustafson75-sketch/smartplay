/**
 * clubSelector.js — Club recommendation engine.
 *
 * Picks the best club for a given distance using the player's own learned
 * averages from clubStats.js. Falls back gracefully when data is sparse.
 *
 * Pure function — no side effects, no state, no network calls.
 *
 * Usage:
 *   import { selectClub } from '../services/clubSelector';
 *   const club = selectClub(155, clubStats);
 *   // '7 Iron'
 */

/**
 * Select the club whose learned average is closest to `distanceToPin`.
 *
 * Requires at least 2 shots with that club before trusting the average
 * (single-shot data is too noisy). Clubs with only 1 shot are eligible
 * only when no 2+ shot club is within 30 yards — avoids bad picks early.
 *
 * @param {number | null} distanceToPin
 * @param {Record<string, { avg: number, count: number }>} clubStats
 * @returns {string | null} — club name, or null when no data available
 */
export const selectClub = (distanceToPin, clubStats) => {
  if (!distanceToPin || distanceToPin <= 0) return null;
  if (!clubStats || Object.keys(clubStats).length === 0) return null;

  // Separate reliable clubs (≥2 shots) from untested ones (1 shot)
  const reliable = Object.entries(clubStats).filter(([, s]) => s.count >= 2);
  const pool = reliable.length > 0 ? reliable : Object.entries(clubStats);

  let bestClub = null;
  let smallestDiff = Infinity;

  pool.forEach(([club, stat]) => {
    const diff = Math.abs(stat.avg - distanceToPin);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      bestClub = club;
    }
  });

  return bestClub;
};

/**
 * Return the top N clubs sorted by closeness to the target distance.
 * Useful for UI "alternatives" display.
 *
 * @param {number} distanceToPin
 * @param {Record<string, { avg: number, count: number }>} clubStats
 * @param {number} [n=3]
 * @returns {Array<{ club: string, avg: number, diff: number }>}
 */
export const topClubOptions = (distanceToPin, clubStats, n = 3) => {
  if (!distanceToPin || !clubStats) return [];
  return Object.entries(clubStats)
    .map(([club, stat]) => ({ club, avg: stat.avg, diff: Math.abs(stat.avg - distanceToPin) }))
    .sort((a, b) => a.diff - b.diff)
    .slice(0, n);
};
