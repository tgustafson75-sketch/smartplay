/**
 * features/palmsCourse/hooks/useRangefinder.ts
 *
 * Virtual rangefinder for the Palms course.
 *
 * Given a player's GPS position and a tap point on the play-view image,
 * computes the distance (in yards) from the player to that tapped target.
 *
 * Workflow:
 *   1. Player has a GPS fix (from usePalmsGPS).
 *   2. Player taps a point on the play-view image (normalised x,y from RangefinderOverlay).
 *   3. useRangefinder back-projects that image point to GPS coords via GPSCalibrator.
 *   4. Haversine distance from player → target is returned in yards.
 */

import { useState, useCallback, useMemo } from 'react';
import { getPalmsHoleMapping }             from '../data/palmsMapping';
import { imageToGPS }                      from '../engine/GPSCalibrator';
import { getDistance, haversineYards }     from '../engine/DistanceEngine';
import type { PalmsHoleMeta }              from '../data/palmsHoles';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TapPoint {
  /** Normalised x coord — 0 (left) to 1 (right) */
  x: number;
  /** Normalised y coord — 0 (tee) to 1 (pin) */
  y: number;
}

export interface UseRangefinderResult {
  /** Distance in yards from player to the tapped target. null until a tap. */
  distanceToTarget: number | null;
  /** The last tapped image point. null = no active target. */
  tapPoint: TapPoint | null;
  /** Record a tap at normalised image coords. */
  setTapPoint: (tap: TapPoint) => void;
  /** Clear the active target. */
  clearTarget: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRangefinder(
  holeNumber: number,
  playerLat:  number | null | undefined,
  playerLng:  number | null | undefined,
): UseRangefinderResult {
  const [tapPoint, setTapPointState] = useState<TapPoint | null>(null);
  const mapping = getPalmsHoleMapping(holeNumber);

  const setTapPoint = useCallback((tap: TapPoint) => {
    setTapPointState(tap);
  }, []);

  const clearTarget = useCallback(() => {
    setTapPointState(null);
  }, []);

  const distanceToTarget = useMemo<number | null>(() => {
    if (!tapPoint || playerLat == null || playerLng == null || !mapping) return null;

    const targetLatLng = imageToGPS(tapPoint.x, tapPoint.y, mapping);
    return haversineYards(
      playerLat,         playerLng,
      targetLatLng.lat,  targetLatLng.lng,
    );
  }, [tapPoint, playerLat, playerLng, mapping]);

  return {
    distanceToTarget,
    tapPoint,
    setTapPoint,
    clearTarget,
  };
}

// ─── Green distances ─────────────────────────────────────────────────────────

export interface GreenDistances {
  /** Yards to front edge of the green. */
  front:  number;
  /** Yards to green center. */
  center: number;
  /** Yards to back edge of the green. */
  back:   number;
}

/**
 * Returns front / center / back distances to the green based on the player's
 * live GPS position and the hole's GPS-verified green center + greenDepth.
 *
 * `greenDepth` is split evenly front/back around the center.
 */
export function useGreenDistances(
  userLat:  number | null | undefined,
  userLng:  number | null | undefined,
  hole: Pick<PalmsHoleMeta, 'greenDepth'> & { green: { lat: number; lng: number } },
): GreenDistances | null {
  return useMemo(() => {
    if (userLat == null || userLng == null) return null;
    const center = getDistance(userLat, userLng, hole.green.lat, hole.green.lng);
    const half   = hole.greenDepth / 2;
    return {
      front:  Math.round(center - half),
      center: Math.round(center),
      back:   Math.round(center + half),
    };
  }, [userLat, userLng, hole.green.lat, hole.green.lng, hole.greenDepth]);
}
