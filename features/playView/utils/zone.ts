/**
 * features/playView/utils/zone.ts
 *
 * GPS zone membership — pure utility, no React.
 */

import { distanceBetween, type LatLng } from './distance';

/** Returns true when user is within `radiusMetres` of a point. */
export function isInZone(
  user:         LatLng,
  point:        LatLng,
  radiusMetres: number = 25,
): boolean {
  return distanceBetween(user, point) <= radiusMetres;
}
