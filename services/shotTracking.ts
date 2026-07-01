/**
 * 2026-06-07 — Shot tracking via cart-mark verification.
 *
 * Tim's spec: the player hits a shot, drives the cart to the ball, and
 * taps the cart at the resting spot to VERIFY — which logs THAT shot
 * (the one that just came to rest here) with its distance + club, and
 * shows the approach (remaining to the green) for the next shot.
 *
 * Model (corrected after audit): a cart-tap records ONE completed shot.
 * Its START is the previous completed shot's resting spot (its
 * end_location), or the tee for the first shot of the hole; its END is
 * this tap. Distance is attributed to THIS shot (the one just hit), so
 * the tee shot's distance is captured and the club inference matches the
 * shot actually played. Distance chain: real positions (haversine, works
 * offline from stored marks) → known to-green hole-yardage delta when no
 * start position exists.
 *
 * The bag model (clubStatsStore) is fed ONCE, on confirm, with the final
 * (possibly user-corrected) club — never double-recorded. See memory
 * shot-tracking-cart-gps + club-tied-shot-tracking.
 */

import { useRoundStore, type ShotResult } from '../store/roundStore';
import { getGreenCentroid, getTeeCentroid } from './shotLocationService';
import { resolveYardage } from './yardageResolver';
import { haversineYards, type ShotLocation } from '../utils/geoDistance';
import { useClubStatsStore, type ClubName } from '../store/clubStatsStore';

export interface ShotTrackResult {
  ok: boolean;
  /** Distance of the shot that just came to rest at this location (yds). */
  shotDistanceYards: number | null;
  /** Remaining distance to the green from here — the next shot's approach. */
  approachYards: number | null;
  distanceSource: 'gps' | 'hole_yardage' | 'none';
  /** Club attributed to the shot (default-inferred; user can scroll-correct). */
  club: ClubName | null;
  /** Id of the logged shot, so a club correction / confirm can target it. */
  shotId: string | null;
  reason?: string;
}

let shotSeq = 0;

/** Remaining-to-green from a location — requires the GPS green centroid.
 *  2026-06-08 (audit #1): removed the static tee-to-green fallback. The
 *  hole's scorecard yardage is the FULL tee→green distance, not the
 *  remaining from an arbitrary cart-tap; returning it from mid-fairway
 *  reported ~450y at 150y out and corrupted shot-distance deltas. When we
 *  don't have the green location we honestly return null (caller shows
 *  "—" and the tee-shot path still uses resolveYardage explicitly). */
function approachFromLocation(hole: number, loc: ShotLocation): number | null {
  const green = getGreenCentroid(hole);
  if (green) return Math.round(haversineYards(loc, green));
  return null;
}

/**
 * Verify + log the shot that just came to rest at `loc` (the cart mark).
 * Logs ONE completed shot and returns its distance + the next approach.
 * Does NOT feed the bag model — that happens on confirmTrackedShot so a
 * later club correction isn't double-counted. Safe no-op when no round.
 */
export function verifyShotAtLocation(loc: ShotLocation, opts?: { club?: ClubName | null }): ShotTrackResult {
  const round = useRoundStore.getState();
  if (!round.isRoundActive) {
    return { ok: false, shotDistanceYards: null, approachYards: null, distanceSource: 'none', club: null, shotId: null, reason: 'no_round' };
  }
  const hole = round.currentHole;
  const holeShots = round.shots.filter((s) => (s.hole_number ?? s.hole) === hole);
  const prev = holeShots[holeShots.length - 1] ?? null;

  // START of this completed shot = where the previous shot came to REST
  // (its end_location), or the tee for the first shot of the hole.
  // 2026-06-08 (audit M3) — do NOT fall back to prev.start_location: a
  // voice-logged or penalty shot has a start but no end, and chaining
  // from its start over-counted this shot's distance AND made logShot
  // back-fill that prior shot a 0-yard end. With no usable rest anchor we
  // drop to the hole-yardage fallback below instead.
  const startLoc: ShotLocation | null =
    prev?.end_location ?? (holeShots.length === 0 ? getTeeCentroid(hole) : null);

  // Distance of THIS shot.
  let shotDistanceYards: number | null = null;
  let distanceSource: ShotTrackResult['distanceSource'] = 'none';
  if (startLoc) {
    shotDistanceYards = Math.round(haversineYards(startLoc, loc));
    distanceSource = 'gps';
  } else {
    // No start position (e.g. tee shot with no tee coords): estimate from
    // the change in known to-green hole yardage.
    const prevApproach = prev?.end_location ? approachFromLocation(hole, prev.end_location) : resolveYardage(hole).value;
    const hereApproach = approachFromLocation(hole, loc);
    if (prevApproach != null && hereApproach != null && prevApproach > hereApproach) {
      shotDistanceYards = prevApproach - hereApproach;
      distanceSource = 'hole_yardage';
    }
  }

  const approachYards = approachFromLocation(hole, loc);

  const clubStats = useClubStatsStore.getState();
  const club: ClubName | null =
    opts?.club ?? (shotDistanceYards != null && shotDistanceYards > 0 ? clubStats.inferClub(shotDistanceYards) : null);

  shotSeq += 1;
  const shotId = `track-${Date.now()}-${shotSeq}`;
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
    start_location: startLoc,
    end_location: loc, // completed shot — rest position known
    gps_location: startLoc ?? loc,
    distance_yards: shotDistanceYards,
  };
  round.logShot(shot);

  return { ok: true, shotDistanceYards, approachYards, distanceSource, club, shotId };
}

/** Correct the club on a tracked shot (from the tap-to-scroll chip). Edits
 *  the shot only — the bag model is fed once, on confirm. */
export function correctShotClub(shotId: string, newClub: ClubName): void {
  useRoundStore.getState().editShot(shotId, { club: newClub });
}

// 2026-06-08 (audit) — guard against double-record: two rapid taps on the
// sheet's confirm (before it unmounts) would feed the bag model twice for
// one shot and skew the rolling average.
const confirmedShotIds = new Set<string>();

/** Confirm a tracked shot — feeds the real bag model ONCE with the final
 *  club + measured distance. Called when the user dismisses the sheet. */
export function confirmTrackedShot(shotId: string): void {
  if (confirmedShotIds.has(shotId)) return;
  const shot = useRoundStore.getState().shots.find((s) => s.id === shotId);
  if (!shot || !shot.club) return;
  confirmedShotIds.add(shotId);
  // Bound the set so it can't grow unbounded over a long session.
  if (confirmedShotIds.size > 200) {
    confirmedShotIds.delete(confirmedShotIds.values().next().value as string);
  }
  const yards = shot.distance_yards ?? null;
  // 2026-07-01 (whole-app audit) — same >500y guard the longestDrive path got (a corrupt GPS jump
  // must not train the club-bag average with an impossible shot). No single shot exceeds ~500y.
  if (yards != null && yards > 0 && yards <= 500) {
    useClubStatsStore.getState().record(shot.club as ClubName, yards);
  }
}
