/**
 * features/playView/engine/pixelToGPS.ts
 *
 * Backward-compatible re-export. All logic now lives in ImageMapping.ts.
 *
 * New consumers should import directly from ImageMapping for the full API
 * (bilinear interpolation + lateral offset + imageWidth/imageHeight args).
 * This module keeps the old 2-arg signature working for existing call-sites
 * by supplying default image dimensions and delegating to ImageMapping.
 */

import { pixelToGPS as bilinearPixelToGPS } from './ImageMapping';
import type { PathPoint } from '../data/holeMapping';

export interface PixelCoord {
  x: number;
  y: number;
}

export interface LatLngResult {
  lat: number;
  lng: number;
}

/**
 * @deprecated Pass imageWidth + imageHeight for accurate bilinear mapping.
 *   Use `pixelToGPS` from `ImageMapping.ts` directly for new call-sites.
 *
 * Falls back to 1000×2000 default dimensions when called without them —
 * accurate enough as a drop-in replacement for the old nearest-anchor snap.
 */
export function pixelToGPS(
  tap:         PixelCoord,
  path:        PathPoint[],
  imageWidth  = 1000,
  imageHeight = 2000,
): LatLngResult {
  return bilinearPixelToGPS(tap, path, imageWidth, imageHeight);
}
