/**
 * features/smartCaddie/hooks/useShotTracking.ts
 *
 * Local session-scoped shot log. Tracks recommended vs selected club
 * per shot so PlayerAdaptation can detect user tendencies.
 *
 * State is intentionally local — no backend, no Zustand.
 */

import { useState } from 'react';
import type { ClubName } from '../types/club';

export type ShotResult = 'short' | 'long' | 'left' | 'right' | 'good';

export interface TrackedShot {
  recommended: ClubName;
  selected:    ClubName;
  distance:    number;
  result?:     ShotResult;
  timestamp:   number;
}

export interface UseShotTrackingResult {
  shots:      TrackedShot[];
  logShot:    (shot: Omit<TrackedShot, 'timestamp'>) => void;
  recordResult: (timestamp: number, result: ShotResult) => void;
  clearShots: () => void;
}

export function useShotTracking(): UseShotTrackingResult {
  const [shots, setShots] = useState<TrackedShot[]>([]);

  const logShot = ({ recommended, selected, distance, result }: Omit<TrackedShot, 'timestamp'>) => {
    setShots((prev) => [
      ...prev,
      { recommended, selected, distance, result, timestamp: Date.now() },
    ]);
  };

  const recordResult = (timestamp: number, result: ShotResult) => {
    setShots((prev) =>
      prev.map((s) => s.timestamp === timestamp ? { ...s, result } : s)
    );
  };

  const clearShots = () => setShots([]);

  return { shots, logShot, recordResult, clearShots };
}
