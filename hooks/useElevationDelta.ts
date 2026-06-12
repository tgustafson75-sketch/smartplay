/**
 * 2026-06-11 — Live plays-like elevation delta (target − player) in feet.
 *
 * Bridges the async, cached elevationService into a sync render value so call
 * sites can pass it straight to playsLikeDistance(..., elevationDeltaFeet).
 * Returns 0 (flat) until BOTH points resolve and whenever either is missing or
 * a lookup fails — so it is ALWAYS safe to pass through, never blocking or
 * corrupting a yardage. Deps are rounded to the elevation cache grid (~11m) so
 * GPS jitter doesn't thrash the effect; small moves hit the cache instantly.
 */

import { useEffect, useState } from 'react';
import { getPlaysLikeElevationDeltaFeet } from '../services/elevationService';

type Coord = { lat: number; lng: number } | null | undefined;

function gridded(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4;
}

export function useElevationDelta(player: Coord, target: Coord): number {
  const [delta, setDelta] = useState(0);
  const pLat = gridded(player?.lat);
  const pLng = gridded(player?.lng);
  const tLat = gridded(target?.lat);
  const tLng = gridded(target?.lng);

  useEffect(() => {
    if (pLat == null || pLng == null || tLat == null || tLng == null) {
      setDelta(0);
      return;
    }
    let active = true;
    getPlaysLikeElevationDeltaFeet({ lat: pLat, lng: pLng }, { lat: tLat, lng: tLng })
      .then((d) => { if (active) setDelta(d); })
      .catch(() => { if (active) setDelta(0); });
    return () => { active = false; };
  }, [pLat, pLng, tLat, tLng]);

  return delta;
}
