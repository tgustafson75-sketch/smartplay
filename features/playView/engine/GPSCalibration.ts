/**
 * features/playView/engine/GPSCalibration.ts
 *
 * UPGRADED: delegates to PathProjection.mapToFairwayPath for multi-point
 * fairway path projection. The old tee/green/image anchor API is replaced;
 * callers should pass a HoleMapping (which now carries a path array).
 */

import type { HoleMapping } from '../data/holeMapping';
import { mapToFairwayPath }  from './PathProjection';

export interface CalibrationInput {
  userLat: number;
  userLng: number;
  mapping: HoleMapping;
}

export interface CalibrationResult {
  x: number;
  y: number;
}

/**
 * Maps a GPS coordinate to pixel coordinates on the hole image using
 * the multi-point fairway path stored in `mapping.path`.
 */
export function mapGPSToImage({
  userLat,
  userLng,
  mapping,
}: CalibrationInput): CalibrationResult {
  return mapToFairwayPath({ lat: userLat, lng: userLng }, mapping.path);
}