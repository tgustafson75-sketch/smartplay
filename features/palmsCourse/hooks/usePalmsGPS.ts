/**
 * features/palmsCourse/hooks/usePalmsGPS.ts
 *
 * Palms-specific GPS hook.
 * Wraps the shared useGolfGPS hook and derives Palms-specific yardages:
 *   - distToMiddle  — GPS metres → yards to middle tee of current hole
 *   - distToFront   — GPS metres → yards to front tee
 *   - distToBack    — GPS metres → yards to back tee
 *
 * Uses the Haversine formula via DistanceEngine for accuracy.
 */

import { useMemo } from 'react';
import { useGolfGPS } from '../../../hooks/useGolfGPS';
import type { UseGolfGPSResult } from '../../../hooks/useGolfGPS';
import { getPalmsHole } from '../data/palmsHoles';
import { haversineYards } from '../engine/DistanceEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UsePalmsGPSResult extends UseGolfGPSResult {
  /** Yards to the middle of the current hole's green. null until GPS fix. */
  distToMiddle: number | null;
  /** Yards to the front of the green. */
  distToFront:  number | null;
  /** Yards to the back of the green. */
  distToBack:   number | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePalmsGPS(holeNumber: number): UsePalmsGPSResult {
  const gps   = useGolfGPS();
  const hole  = getPalmsHole(holeNumber);

  const activeCoords = gps.isManual ? gps.manualPosition : gps.coords;

  const distToMiddle = useMemo(() => {
    if (!activeCoords || !hole?.middle) return null;
    return haversineYards(
      activeCoords.latitude, activeCoords.longitude,
      hole.middle.lat,       hole.middle.lng,
    );
  }, [activeCoords, hole]);

  const distToFront = useMemo(() => {
    if (!activeCoords || !hole?.front) return null;
    return haversineYards(
      activeCoords.latitude, activeCoords.longitude,
      hole.front.lat,        hole.front.lng,
    );
  }, [activeCoords, hole]);

  const distToBack = useMemo(() => {
    if (!activeCoords || !hole?.back) return null;
    return haversineYards(
      activeCoords.latitude, activeCoords.longitude,
      hole.back.lat,         hole.back.lng,
    );
  }, [activeCoords, hole]);

  return {
    ...gps,
    distToMiddle,
    distToFront,
    distToBack,
  };
}
