/**
 * features/palmsCourse/hooks/usePalmsPlayScreen.ts
 *
 * Orchestration hook for the Palms play screen.
 *
 * Combines GPS, hole mapping, image-pixel projection, green distances,
 * and smart caddie advice into a single object consumed by the play screen UI.
 *
 * Usage:
 *   const { playerDot, distances, caddie, gps, holeMap, holeMeta } =
 *     usePalmsPlayScreen(currentHole);
 */

import { useMemo }             from 'react';
import { usePalmsGPS }         from './usePalmsGPS';
import { palmsMapping }        from '../data/palmsMapping';
import { palmsHoles }          from '../data/palmsHoles';
import { mapGPSToImage }       from '../engine/GPSCalibrator';
import { useGreenDistances }   from './useRangefinder';
import { useSmartCaddie }      from '../../smartCaddie/hooks/useSmartCaddie';
import type { PalmsHoleMapping } from '../data/palmsMapping';
import type { PalmsHoleMeta }    from '../data/palmsHoles';
import type { GreenDistances }   from './useRangefinder';
import type { SmartCaddieState } from '../../smartCaddie/hooks/useSmartCaddie';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlayerDot {
  /** Pixel x coordinate in the play-view image's logical pixel space. */
  x: number;
  /** Pixel y coordinate in the play-view image's logical pixel space. */
  y: number;
}

export interface UsePalmsPlayScreenResult {
  /** Pixel position of the player on the play-view image. null = no GPS fix. */
  playerDot:  PlayerDot | null;
  /** Front / center / back green distances in yards. null = no GPS fix. */
  distances:  GreenDistances | null;
  /** Smart caddie club recommendation and strategy advice. */
  caddie:     SmartCaddieState;
  /** Raw GPS result from usePalmsGPS. */
  gps:        ReturnType<typeof usePalmsGPS>;
  /** GPS + pixel mapping for the current hole. undefined if hole out of range. */
  holeMap:    PalmsHoleMapping | undefined;
  /** Static hole metadata (par, yardage, type, etc.). */
  holeMeta:   PalmsHoleMeta | undefined;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePalmsPlayScreen(currentHole: number): UsePalmsPlayScreenResult {
  const gps     = usePalmsGPS(currentHole);
  const holeMap = palmsMapping[currentHole];
  const holeMeta = palmsHoles[currentHole];

  const lat = gps.coords?.latitude ?? null;
  const lng = gps.coords?.longitude ?? null;

  // Map GPS coordinates to image pixel space.
  const playerDot = useMemo<PlayerDot | null>(() => {
    if (lat == null || lng == null || !holeMap) return null;
    return mapGPSToImage(lat, lng, holeMap);
  }, [lat, lng, holeMap]);

  // Green distances require a green GPS anchor from holeMap.
  const holeForDistances = useMemo(() => {
    if (!holeMap || !holeMeta) return null;
    return {
      green:      holeMap.green,
      greenDepth: holeMeta.greenDepth,
    };
  }, [holeMap, holeMeta]);

  const distances = useGreenDistances(
    lat,
    lng,
    holeForDistances ?? { green: { lat: 0, lng: 0 }, greenDepth: 0 },
  );

  const caddie = useSmartCaddie({
    holeNumber: currentHole,
    distance:   distances?.center ?? 0,
  });

  return {
    playerDot,
    distances: holeForDistances ? distances : null,
    caddie,
    gps,
    holeMap,
    holeMeta,
  };
}
