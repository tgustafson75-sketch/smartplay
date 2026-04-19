/**
 * features/palmsCourse/hooks/useHoleMapping.ts
 *
 * Converts a live GPS position into normalised (x, y) image coordinates
 * for the current Palms hole's play-view image.
 *
 * (0, 0) = tee end of the image  (top)
 * (1, 1) = pin end of the image  (bottom)
 *
 * Values outside [0, 1] indicate the player is off-image (e.g. behind tee
 * or past the green) — callers should clamp or hide the dot in that case.
 */

import { useMemo } from 'react';
import { getPalmsHoleMapping } from '../data/palmsMapping';
import { projectToImage } from '../engine/GPSCalibrator';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormalisedPosition {
  /** 0 = left edge, 1 = right edge of the play-view image */
  x: number;
  /** 0 = tee (top), 1 = pin (bottom) of the play-view image */
  y: number;
}

export interface UseHoleMappingResult {
  /** Player position as normalised image coords. null when GPS unavailable. */
  position: NormalisedPosition | null;
  /** True when position is within the image bounds [0,1] on both axes. */
  inFrame: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHoleMapping(
  holeNumber: number,
  gpsLat:     number | null | undefined,
  gpsLng:     number | null | undefined,
): UseHoleMappingResult {
  const mapping = getPalmsHoleMapping(holeNumber);

  const position = useMemo<NormalisedPosition | null>(() => {
    if (gpsLat == null || gpsLng == null || !mapping) return null;
    return projectToImage(gpsLat, gpsLng, mapping);
  }, [gpsLat, gpsLng, mapping]);

  const inFrame = position !== null &&
    position.x >= 0 && position.x <= 1 &&
    position.y >= 0 && position.y <= 1;

  return { position, inFrame };
}
