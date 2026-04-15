/**
 * clubStats.js — Distance learning engine for club selection AI.
 *
 * Aggregates per-club carry distances from the shot history and produces
 * per-club averages/min/max so the caddie can recommend based on real
 * player data rather than defaults.
 *
 * Pure function — no side effects, no state, no network calls.
 *
 * Usage:
 *   import { getClubStats } from '../services/clubStats';
 *   const stats = getClubStats(shots);
 *   // { '7 Iron': { avg: 143, min: 132, max: 158, count: 6 }, ... }
 */

/**
 * Build a per-club stats map from the shot history.
 *
 * Uses `yardsCarried` when available (GPS-enriched shots) and falls back to
 * `distance` (distance-to-pin at time of shot) so it works even without live
 * GPS tracking.
 *
 * @param {Array<{ club?: string, distance?: number, yardsCarried?: number }>} shots
 * @returns {Record<string, { avg: number, min: number, max: number, count: number }>}
 */
export const getClubStats = (shots = []) => {
  const clubMap = {};

  shots.forEach((shot) => {
    if (!shot.club) return;
    // Prefer GPS-measured carry; fall back to distance-to-pin
    const dist = shot.yardsCarried ?? shot.distance;
    if (!dist || dist <= 0 || dist > 700) return; // sanity gate

    if (!clubMap[shot.club]) {
      clubMap[shot.club] = [];
    }
    clubMap[shot.club].push(dist);
  });

  const stats = {};

  Object.keys(clubMap).forEach((club) => {
    const distances = clubMap[club];

    const avg = distances.reduce((a, b) => a + b, 0) / distances.length;

    stats[club] = {
      avg:   Math.round(avg),
      min:   Math.min(...distances),
      max:   Math.max(...distances),
      count: distances.length,
    };
  });

  return stats;
};

/**
 * Produce a human-readable summary string for a single club's stats.
 * Used in caddie-brain prompts so the AI gets concise context.
 *
 * @param {string} club
 * @param {{ avg: number, min: number, max: number, count: number }} stat
 * @returns {string}
 */
export const formatClubStat = (club, stat) =>
  `${club}: avg ${stat.avg}y (${stat.min}–${stat.max}y, ${stat.count} shot${stat.count !== 1 ? 's' : ''})`;
