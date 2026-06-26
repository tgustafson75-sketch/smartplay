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
import { getPlaysLikeElevation } from '../services/elevationService';

type Coord = { lat: number; lng: number } | null | undefined;

/** `hasData` is false until BOTH points resolve OR when a lookup fails — so the
 *  UI can honestly show "flat (no data)" vs a real ~level read. `deltaFeet` is
 *  always 0 in that case, so it is still safe to pass straight to playsLike. */
export type ElevationDelta = { deltaFeet: number; hasData: boolean };

function gridded(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4;
}

/** Honesty-aware: returns the delta AND whether it's backed by a real read. */
export function useElevationDeltaStatus(player: Coord, target: Coord): ElevationDelta {
  const [state, setState] = useState<ElevationDelta>({ deltaFeet: 0, hasData: false });
  const pLat = gridded(player?.lat);
  const pLng = gridded(player?.lng);
  const tLat = gridded(target?.lat);
  const tLng = gridded(target?.lng);

  useEffect(() => {
    if (pLat == null || pLng == null || tLat == null || tLng == null) {
      setState({ deltaFeet: 0, hasData: false });
      return;
    }
    let active = true;
    getPlaysLikeElevation({ lat: pLat, lng: pLng }, { lat: tLat, lng: tLng })
      .then((r) => { if (active) setState(r); })
      .catch(() => { if (active) setState({ deltaFeet: 0, hasData: false }); });
    return () => { active = false; };
  }, [pLat, pLng, tLat, tLng]);

  return state;
}

/** Back-compat: just the delta (0 when missing/flat). */
export function useElevationDelta(player: Coord, target: Coord): number {
  return useElevationDeltaStatus(player, target).deltaFeet;
}
