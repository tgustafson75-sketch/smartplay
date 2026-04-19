/**
 * features/playView/hooks/useRangefinder.ts
 *
 * Derives front / center / back green distances from the player's live
 * GPS position and the hole's green GPS anchor.
 *
 * Wraps the shared haversine implementation from DistanceEngine so this
 * hook stays pure and testable without React Native GPS dependencies.
 */

import { useMemo } from 'react';
import { getDistance } from '../../palmsCourse/engine/DistanceEngine';

export interface RangefinderInput {
  user: {
    lat: number;
    lng: number;
  };
  hole: {
    green: {
      lat: number;
      lng: number;
    };
    /** Green depth in yards — split evenly front / back. */
    greenDepth?: number;
  };
}

export interface RangefinderResult {
  front:  number;
  center: number;
  back:   number;
}

export function useRangefinder({ user, hole }: RangefinderInput): RangefinderResult {
  return useMemo(() => {
    const center = getDistance(user.lat, user.lng, hole.green.lat, hole.green.lng);
    const half   = (hole.greenDepth ?? 20) / 2;

    return {
      front:  Math.round(center - half),
      center: Math.round(center),
      back:   Math.round(center + half),
    };
  }, [user.lat, user.lng, hole.green.lat, hole.green.lng, hole.greenDepth]);
}
