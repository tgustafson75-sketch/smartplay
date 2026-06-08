/**
 * 2026-06-07 — Shot tracking via cart-mark verification.
 *
 * Tim's spec: the player hits a shot, drives the cart to the ball, and
 * taps the cart at the correct location to VERIFY — which then auto-logs
 * the shot to the scorecard with its distance, and the approach (remaining
 * to the green) for the next shot. Works as a GPS fallback (no signal →
 * cart mark stamps location) AND as a good-signal verification gesture.
 *
 * Built on the existing round model (store/roundStore.logShot): logging a
 * shot at a resting location back-fills the PREVIOUS shot's end_location,
 * so that shot's distance becomes measurable; the new entry is the start
 * of the next shot. Distance fallback chain when a GPS start point is
 * missing: real positions (haversine) → change in known to-green hole
 * yardage (resolveYardage / static card).
 *
 * Additive + reusable — see memory shot-tracking-cart-gps. No existing
 * flow is modified; callers opt in by calling verifyShotAtLocation.
 */

import { useRoundStore, type ShotResult } from '../store/roundStore';
import { getGreenCentroid } from './shotLocationService';
import { resolveYardage } from './yardageResolver';
import { haversineYards, type ShotLocation } from '../utils/geoDistance';
import { useClubStatsStore, type ClubName } from '../store/clubStatsStore';

export interface ShotTrackResult {
  ok: boolean;
  /** Distance of the shot that just came to rest at this location (yds). */
  shotDistanceYards: number | null;
  /** Remaining distance to the green from here — the next shot's approach. */
  approachYards: number | null;
  /** How shotDistanceYards was derived. */
  distanceSource: 'gps' | 'hole_yardage' | 'none';
  /** The club attributed to the shot (default-inferred from distance when
   *  not provided; the UI shows it as a tap-to-scroll chip to correct). */
  club: ClubName | null;
  /** Id of the shot just logged — so a club correction can edit it. */
  shotId: string | null;
  reason?: string;
}

/** Remaining-to-green from a location: GPS green centroid first, then the
 *  resolver's known hole yardage when we only have static data. */
function approachFromLocation(hole: number, loc: ShotLocation): number | null {
  const green = getGreenCentroid(hole);
  if (green) return Math.round(haversineYards(loc, green));
  return null;
}

/**
 * Verify + log a shot at a known resting location (the cart mark).
 * Returns the just-hit shot's distance + the new approach. Safe no-op
 * (ok:false) when no round is active.
 */
export function verifyShotAtLocation(loc: ShotLocation, opts?: { club?: ClubName | null }): ShotTrackResult {
  const round = useRoundStore.getState();
  if (!round.isRoundActive) {
    return { ok: false, shotDistanceYards: null, approachYards: null, distanceSource: 'none', club: null, shotId: null, reason: 'no_round' };
  }
  const hole = round.currentHole;
  const holeShots = round.shots.filter((s) => (s.hole_number ?? s.hole) === hole);
  const prev = holeShots[holeShots.length - 1] ?? null;

  // Distance of the shot that just landed here.
  let shotDistanceYards: number | null = null;
  let distanceSource: ShotTrackResult['distanceSource'] = 'none';
  if (prev?.start_location) {
    // Real positions on both ends → haversine (most accurate).
    shotDistanceYards = Math.round(haversineYards(prev.start_location, loc));
    distanceSource = 'gps';
  } else if (prev) {
    // GPS-down fallback: change in known to-green hole yardage.
    const prevApproach = prev.start_location ? approachFromLocation(hole, prev.start_location) : null;
    const hereApproach = approachFromLocation(hole, loc);
    if (prevApproach != null && hereApproach != null) {
      shotDistanceYards = Math.max(0, prevApproach - hereApproach);
      distanceSource = 'hole_yardage';
    }
  }

  // Approach (remaining) from here: GPS green → resolver fallback (static card).
  let approachYards = approachFromLocation(hole, loc);
  if (approachYards == null) {
    const r = resolveYardage(hole);
    approachYards = r.value;
  }

  // Club: explicit → default-inferred from the shot distance (closest
  // learned/standard club). Null only when we have no distance to infer
  // from; the UI shows a tap-to-scroll chip so the user can always set it.
  const clubStats = useClubStatsStore.getState();
  const club: ClubName | null =
    opts?.club ?? (shotDistanceYards != null ? clubStats.inferClub(shotDistanceYards) : null);

  const shotId = `track-${Date.now()}`;
  const shot: ShotResult = {
    id: shotId,
    feel: null,
    direction: null,
    shape: null,
    club,
    hole,
    hole_number: hole,
    timestamp: Date.now(),
    acousticContact: null,
    logged_via: 'tap',
    start_location: loc,
    end_location: null,
    gps_location: loc,
    distance_yards: shotDistanceYards,
  };
  round.logShot(shot);

  // Feed the real bag model: this club carried this distance.
  if (club && shotDistanceYards != null && shotDistanceYards > 0) {
    clubStats.record(club, shotDistanceYards);
  }

  return { ok: true, shotDistanceYards, approachYards, distanceSource, club, shotId };
}

/**
 * Correct the club on a just-tracked shot (from the tap-to-scroll chip).
 * Patches the round shot and re-points the bag model to the new club.
 */
export function correctShotClub(shotId: string, newClub: ClubName): void {
  const round = useRoundStore.getState();
  const shot = round.shots.find((s) => s.id === shotId);
  if (!shot) return;
  const yards = shot.distance_yards ?? null;
  round.editShot(shotId, { club: newClub });
  if (yards != null && yards > 0) {
    useClubStatsStore.getState().record(newClub, yards);
  }
}
