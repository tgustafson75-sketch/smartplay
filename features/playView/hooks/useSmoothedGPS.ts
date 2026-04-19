/**
 * features/playView/hooks/useSmoothedGPS.ts
 *
 * Applies a low-pass exponential moving average to raw GPS readings.
 * This removes the jitter caused by GPS noise without adding noticeable lag.
 *
 * Formula (per axis):
 *   smoothed = previous * (1 - α) + raw * α
 *
 * α = 0.2 keeps 80% of the last position and blends in 20% of the new fix.
 * Increase α (→ 1.0) for faster response; decrease (→ 0) for smoother motion.
 */

import { useRef } from 'react';

export interface GPSCoord {
  lat: number;
  lng: number;
}

const ALPHA = 0.2; // smoothing factor

/**
 * Returns a smoothed GPS coordinate updated on every render.
 * Call this hook with the raw GPS result before passing to mapGPSToImage().
 */
export function useSmoothedGPS(gps: GPSCoord): GPSCoord {
  const last = useRef<GPSCoord>(gps);

  const smooth: GPSCoord = {
    lat: last.current.lat * (1 - ALPHA) + gps.lat * ALPHA,
    lng: last.current.lng * (1 - ALPHA) + gps.lng * ALPHA,
  };

  last.current = smooth;

  return smooth;
}
