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
  const pLat = gridded(player?.lat);
  const pLng = gridded(player?.lng);
  const tLat = gridded(target?.lat);
  const tLng = gridded(target?.lng);
  const targetKey = `${tLat},${tLng}`;
  /**
   * 2026-10-15 (review #10) — the result is stamped with the TARGET it was measured to.
   *
   * It used to be a bare value, so after a hole change (new green) the PREVIOUS hole's slope was
   * returned — badged as real data and fed to plays-like — until the new lookup resolved, up to the
   * service's 8 s timeout. A slope to another green is not a slope to this one: until this target
   * resolves it is flat with no data, which is what the initial state already says. Keyed on the
   * target only, so walking (the player point moving) keeps the current read rather than flickering.
   */
  const [state, setState] = useState<StampedDelta>({ targetKey: '', value: NO_ELEVATION_DATA });

  useEffect(() => {
    if (pLat == null || pLng == null || tLat == null || tLng == null) {
      setState({ targetKey, value: NO_ELEVATION_DATA });
      return;
    }
    let active = true;
    getPlaysLikeElevation({ lat: pLat, lng: pLng }, { lat: tLat, lng: tLng })
      .then((r) => { if (active) setState({ targetKey, value: r }); })
      .catch(() => { if (active) setState({ targetKey, value: NO_ELEVATION_DATA }); });
    return () => { active = false; };
  }, [pLat, pLng, tLat, tLng, targetKey]);

  return elevationForTarget(state, targetKey);
}

type StampedDelta = { targetKey: string; value: ElevationDelta };
const NO_ELEVATION_DATA: ElevationDelta = { deltaFeet: 0, hasData: false };

/** A measured delta only answers for the target it was measured to. Exported for the test. */
export function elevationForTarget(state: StampedDelta, targetKey: string): ElevationDelta {
  return state.targetKey === targetKey ? state.value : NO_ELEVATION_DATA;
}

/** Back-compat: just the delta (0 when missing/flat). */
export function useElevationDelta(player: Coord, target: Coord): number {
  return useElevationDeltaStatus(player, target).deltaFeet;
}
