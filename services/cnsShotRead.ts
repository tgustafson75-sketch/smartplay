/**
 * 2026-06-13 — CNS Shot Read (the SmartFinder moat).
 *
 * "This is exactly what the caddie brain is for." (Tim) — SmartFinder shouldn't
 * compute its own recommendation; it asks the BRAIN, and the brain composes one
 * answer-first read from the signals the CNS already holds: distance, wind,
 * elevation/plays-like, the player's real bag, miss tendency, and hazards.
 *
 * This function is the composition layer. It is PURE, SYNC, OFFLINE-SAFE, and
 * never throws — no React, no hooks, no network, no store access (the caller
 * passes the player's bag in). That keeps it unit-testable AND usable with no
 * signal (exactly when the course connection dies). SmartFinder is just the
 * display surface for what this returns.
 *
 * The output discipline is Tim's "don't beat up the user" rule: lead with the
 * ANSWER (club + plays-like), one short line of WHY (wind + slope), hazard +
 * tendency as light single lines, and past-performance ONLY in competitive/ghost
 * mode. See memory: smartfinder-unified-brain-read, caddie-brain-lens.
 */

import type { WeatherSnapshot } from './weatherService';
import { STANDARD_LADDER as SHARED_LADDER, CLUB_LABEL as SHARED_CLUB_LABEL, personalBagScale } from './standardBag';
import { playsLikeDistance } from '../utils/playsLike';

export interface ShotRead {
  /** The answer: which club. */
  club: string | null;
  /** Raw GPS yards to the target. */
  rawYards: number | null;
  /** What it plays like after wind + elevation + temp. */
  playsLikeYards: number | null;
  /** Yards added/removed by plays-like (playsLike − raw). */
  deltaYards: number;
  /** Short "why" factor lines, in priority order (wind, slope, learned carry). */
  why: string[];
  /** One light hazard line, or null. */
  hazardNote: string | null;
  /** One light tendency/line note, or null. */
  tendencyNote: string | null;
  /** Past-performance line — populated ONLY when isCompetition. */
  pastPerfNote: string | null;
}

// Standard carry ladder — the honest fallback when the player hasn't logged a
// real bag yet. Used only when `bag` is empty so we never go silent on club.
// 2026-08-12 — was a private copy that disagreed with the other two standard tables (Driver 250 here
// vs 245 in clubStatsStore vs 230 in equipment_intelligence). Now derived from THE standard bag, so
// what the caddie SAYS a club goes and what the swing card reports for that club are one number.
const STANDARD_LADDER = SHARED_LADDER;

/**
 * 2026-08-11 — ClubName (the stores' vocabulary) → the STANDARD_LADDER's label. Without this the
 * merge produces duplicates ('7I' AND '7 Iron') and the caddie speaks a store key at the player.
 */
const LADDER_LABEL: Record<string, string> = {
  Driver: 'Driver', '3W': '3 Wood', '5W': '5 Wood', '7W': '5 Wood',
  '2H': 'Hybrid', '3H': 'Hybrid', '4H': 'Hybrid', '5H': 'Hybrid',
  '3I': '4 Iron', '4I': '4 Iron', '5I': '5 Iron', '6I': '6 Iron',
  '7I': '7 Iron', '8I': '8 Iron', '9I': '9 Iron',
  PW: 'PW', AW: 'GW', GW: 'GW', SW: 'SW', LW: 'LW',
};

/** Closest club to the plays-like number — prefers the player's real bag, falls
 *  back to the standard ladder. Pushes a learned-carry "why" line when real. */
/**
 * 2026-08-12 (Tim — "a huge part of the app is mental state and mental coaching, hence the dynamics
 * being in play") — RISK POSTURE, the point where that becomes an actual club.
 *
 * A posture that only tints the caddie's wording is decoration. This is where safe / normal /
 * aggressive changes the recommendation itself, in the way a real caddie would: when you're between
 * clubs, safe takes the one that comfortably covers and aggressive takes the one that just reaches.
 * Normal is unchanged — nearest club wins, exactly as before.
 *
 * Deliberately only breaks TIES rather than shifting the target yardage. Nudging the number would
 * make a 150-yard shot secretly a 158-yard shot, and every downstream line ("your 7 iron carries
 * ~155") would then be quoting a distance the player never faced. [[illustration-data-points]]
 */
export type ShotRiskMode = 'safe' | 'normal' | 'aggressive';

function pickClub(playsLikeYards: number, bag: Partial<Record<string, number>>, why: string[], risk: ShotRiskMode = 'normal'): string | null {
  /**
   * 2026-08-11 (Tim — "the caddie suggestion in SmartVision is STILL showing a gap wedge for a 324
   * yard shot") — THE THIRD instance of the same defect, and the one actually on his screen.
   *
   * This built its ladder from `bag` ALONE whenever the player had logged anything at all. With a
   * single logged club — say a gap wedge at 95 — `real.length` is 1, so `longest` and `shortest` are
   * both that wedge, and a 324-yard shot takes the "past your longest" branch and returns the GAP
   * WEDGE with the line "past your gap wedge — lay up and leave a wedge". That is verbatim the
   * "324y to pin · past you…" chip in his screenshot.
   *
   * Same fix as clubStatsStore.inferClub and equipment_distance_modifier, and the same principle he
   * stated: the STANDARD LADDER IS ALWAYS PRESENT, and the player's real numbers override it club by
   * club. A sparse bag can then never collapse the ladder, and the bag-extreme lines ("past your
   * driver", "less than a full lob wedge") stay honest because they're measured against a real bag
   * instead of against the one club we happen to have seen.
   */
  /**
   * 2026-08-12 (Tim's Arccos bag vs our chart) — scale the chart to THIS player.
   *
   * His measured wedges sat 30 yards above our defaults while his driver was within 8, so a 130-yard
   * shot got him a gap wedge from a chart that thought GW went 98 when he hits it 128. Any club he
   * HAS logged still wins outright below; this only fills the ones he hasn't, using the ratio his
   * own clubs prove. See services/standardBag.personalBagScale.
   */
  const bagScale = personalBagScale(bag as Partial<Record<string, number>>) ?? 1;
  const merged = new Map<string, number>();
  for (const [club, yds] of STANDARD_LADDER) merged.set(club, Math.round(yds * bagScale));
  // Track which clubs are the PLAYER'S OWN number vs. the chart, so the spoken "why" can't claim a
  // standard-ladder figure as his measured carry ([[illustration-data-points]] — real signals only).
  const measured = new Set<string>();
  for (const [club, d] of Object.entries(bag)) {
    if (typeof d === 'number' && d > 0) {
      // 2026-08-11 (re-check) — TWO VOCABULARIES. bagDistances() keys are ClubName ('7I', '3W'),
      // the ladder is labelled ('7 Iron', '3 Wood'). Merging raw would ADD '7I':165 next to the
      // chart's '7 Iron':155 — the same club twice, skewing the bag extremes and letting the
      // spoken line read "7I" instead of "7 iron". Map onto the ladder's label so a measured club
      // REPLACES its chart counterpart, which is what "override club by club" has to mean.
      const label = LADDER_LABEL[club] ?? club;
      merged.set(label, d);
      measured.add(label);
    }
  }
  const real = [...merged.entries()] as [string, number][];
  if (real.length > 0) {
    let best: [string, number] | null = null;
    let longest = real[0];
    let shortest = real[0];
    for (const entry of real) {
      /**
       * 2026-08-11 — the player's OWN club wins a tie against a chart club.
       *
       * Merging the standard ladder in (so a sparse bag can't collapse it) introduced a subtle
       * regression the sim caught: at 165 yards a CHART 6-iron (165) tied his MEASURED 7-iron (165)
       * and won on iteration order. A chart average must never outrank a number the player has
       * actually produced — that is the whole point of learning his bag. Ties, and near-ties within
       * a yard, go to the measured club.
       */
      const dNew = Math.abs(entry[1] - playsLikeYards);
      const dBest = best ? Math.abs(best[1] - playsLikeYards) : Infinity;
      const newIsMeasured = measured.has(entry[0]);
      const bestIsMeasured = best ? measured.has(best[0]) : false;
      // Posture only speaks on a NEAR-TIE (within a yard): safe prefers the club that covers the
      // number, aggressive the one that just reaches. Outside a tie the closest club still wins —
      // a posture must never hand you a club that doesn't fit the shot.
      const postureBreak =
        risk === 'safe' ? (entry[1] > (best?.[1] ?? -Infinity) ? true : false)
        : risk === 'aggressive' ? (entry[1] < (best?.[1] ?? Infinity) ? true : false)
        : null;
      const better =
        dNew < dBest - 1 ? true
        : dNew > dBest + 1 ? false
        : newIsMeasured && !bestIsMeasured ? true      // near-tie: measured beats chart
        : !newIsMeasured && bestIsMeasured ? false
        : postureBreak !== null ? postureBreak         // near-tie, same provenance: posture decides
        : dNew < dBest;                                 // same provenance: closest wins
      if (!best || better) best = entry;
      if (entry[1] > longest[1]) longest = entry;
      if (entry[1] < shortest[1]) shortest = entry;
    }
    if (best) {
      // 2026-06-27 — honest read at the BAG EXTREMES. The closest club to a
      // too-big / too-small number is already `longest` / `shortest`, so the club
      // returned is unchanged; only the "why" is more honest. Lead with it
      // (unshift) so it survives the voice responder's first-two-lines trim.
      const BEYOND_MARGIN = 8;   // matches localStatusResponder.clubBeyond
      const PARTIAL_MARGIN = 12; // under the shortest = a partial, not a full carry
      if (playsLikeYards > longest[1] + BEYOND_MARGIN) {
        // "past your driver" is only true of a club he's actually shown us. Against a chart value it
        // would be a guess dressed as a fact, so the line drops to a neutral one.
        why.unshift(measured.has(longest[0])
          ? `past your ${longest[0].toLowerCase()} (${Math.round(longest[1])}) — lay up and leave a wedge`
          : `that's past a full ${longest[0].toLowerCase()} — lay up and leave a wedge`);
        return longest[0];
      }
      if (playsLikeYards < shortest[1] - PARTIAL_MARGIN) {
        why.unshift(`less than a full ${shortest[0].toLowerCase()} — partial swing`);
        return shortest[0];
      }
      void measured;
      // Only call it HIS carry when it actually is; otherwise stay silent on the number rather than
      // passing a chart average off as measured.
      if (measured.has(best[0])) why.push(`your ${best[0].toLowerCase()} carries ~${Math.round(best[1])}`);
      return best[0];
    }
  }
  let bestStd: readonly [string, number] | null = null;
  for (const entry of STANDARD_LADDER) {
    if (!bestStd || Math.abs(entry[1] - playsLikeYards) < Math.abs(bestStd[1] - playsLikeYards)) bestStd = entry;
  }
  return bestStd ? bestStd[0] : null;
}

export function composeShotRead(input: {
  rawYards: number | null;
  weather: WeatherSnapshot | null;
  shotBearingDeg: number | null;
  elevationDeltaFeet?: number;
  /** Player's REAL measured bag (from shotStrategy.bagDistances()). Empty → ladder. */
  bag?: Partial<Record<string, number>>;
  /** CNS-learned dominant miss (e.g. "right"). */
  dominantMiss?: string | null;
  /** Hole-specific learned line note (beats the generic miss when present). */
  holeLineNote?: string | null;
  /** Nearest hazard ahead + its yards from the player. */
  nearestHazard?: { label: string; yards: number } | null;
  /**
   * The caddie's risk posture for this shot (roundStore.riskMode). Only breaks near-ties between
   * clubs — see pickClub. Omitted → 'normal', so every existing caller is unchanged.
   */
  risk?: ShotRiskMode;
  /** Competitive/ghost round → surface past performance; otherwise hide it. */
  isCompetition?: boolean;
  /** Past-performance one-liner for this hole (only used when isCompetition). */
  pastScoreNote?: string | null;
}): ShotRead | null {
  const {
    rawYards, weather, shotBearingDeg, elevationDeltaFeet = 0,
    bag = {}, dominantMiss, holeLineNote, nearestHazard, isCompetition, pastScoreNote,
  } = input;
  if (rawYards == null || !Number.isFinite(rawYards)) return null;

  const why: string[] = [];

  // 1) Plays-like. With weather we get the full wind+temp+elevation model; with
  //    no weather we still honor elevation (so uphill/downhill never goes dark).
  let playsLikeYards = rawYards;
  if (weather) {
    const b = playsLikeDistance(rawYards, weather, shotBearingDeg, elevationDeltaFeet);
    playsLikeYards = b.plays_like_yards;
    if (b.along_wind_mph != null && Math.abs(b.along_wind_mph) >= 3) {
      why.push(b.along_wind_mph < 0
        ? `${Math.abs(b.along_wind_mph)} into the wind`
        : `${b.along_wind_mph} downwind`);
    }
    if (b.cross_wind_mph != null && Math.abs(b.cross_wind_mph) >= 5) {
      why.push(`${Math.abs(b.cross_wind_mph)} cross ${b.cross_wind_mph > 0 ? 'off the right' : 'off the left'}`);
    }
  } else if (elevationDeltaFeet !== 0) {
    playsLikeYards = Math.round(rawYards + elevationDeltaFeet / 3);
  }

  // Elevation "why" line (independent of weather presence).
  const elevYds = Math.round(elevationDeltaFeet / 3);
  if (Math.abs(elevYds) >= 2) why.push(`${Math.abs(elevYds)} ${elevYds > 0 ? 'uphill' : 'downhill'}`);

  // 2) Club — the answer. Pushes a learned-carry why line when the bag is real.
  const club = pickClub(playsLikeYards, bag, why, input.risk ?? 'normal');

  // 3) Hazard — only when it's actually in play for this shot (ahead, within reach).
  let hazardNote: string | null = null;
  if (nearestHazard && nearestHazard.yards > 0 && nearestHazard.yards <= playsLikeYards + 25) {
    hazardNote = `${nearestHazard.label} ${nearestHazard.yards}y`;
  }

  // 4) Tendency — hole-specific learned line beats the generic miss.
  let tendencyNote: string | null = null;
  if (holeLineNote && holeLineNote.trim()) tendencyNote = holeLineNote.trim();
  else if (dominantMiss && dominantMiss.trim()) tendencyNote = `you miss ${dominantMiss.trim()} — favor the safe side`;

  // 5) Past performance — competitive/ghost only (don't nag a casual round).
  const pastPerfNote = isCompetition ? (pastScoreNote ?? null) : null;

  return {
    club,
    rawYards,
    playsLikeYards,
    deltaYards: playsLikeYards - rawYards,
    why,
    hazardNote,
    tendencyNote,
    pastPerfNote,
  };
}
