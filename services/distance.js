/**
 * distance.js — Haversine distance calculator (yards)
 *
 * Computes the great-circle distance between two GPS coordinates and returns
 * the result in yards. Used by the hole-strategy engine and any module that
 * needs raw distance without the full yardage-band (front/middle/back) logic
 * that lives in PlayScreenClean.tsx's startGpsWatch helper.
 *
 * Usage:
 *   import { getDistanceToTarget } from '../services/distance';
 *   const yards = getDistanceToTarget(
 *     { latitude: 40.123, longitude: -74.456 },  // player
 *     { latitude: 40.124, longitude: -74.451 }   // target (e.g. green centre)
 *   );
 */

/**
 * Returns the distance between two lat/lng points in yards.
 *
 * @param {{ latitude: number; longitude: number }} player
 * @param {{ latitude: number; longitude: number }} target
 * @returns {number} Distance in yards, rounded to nearest whole yard.
 */
export const getDistanceToTarget = (player, target) => {
  const toRad = (val) => (val * Math.PI) / 180;

  const R = 6371e3; // Earth radius in metres
  const φ1 = toRad(player.latitude);
  const φ2 = toRad(target.latitude);
  const Δφ = toRad(target.latitude - player.latitude);
  const Δλ = toRad(target.longitude - player.longitude);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const metres = R * c;
  return Math.round(metres * 1.09361); // convert metres → yards
};
