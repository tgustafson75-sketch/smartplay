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
const STANDARD_LADDER: readonly (readonly [string, number])[] = [
  ['Driver', 250], ['3 Wood', 225], ['5 Wood', 210], ['Hybrid', 195],
  ['4 Iron', 185], ['5 Iron', 175], ['6 Iron', 165], ['7 Iron', 155],
  ['8 Iron', 145], ['9 Iron', 130], ['PW', 115], ['GW', 100], ['SW', 85], ['LW', 70],
];

/** Closest club to the plays-like number — prefers the player's real bag, falls
 *  back to the standard ladder. Pushes a learned-carry "why" line when real. */
function pickClub(playsLikeYards: number, bag: Partial<Record<string, number>>, why: string[]): string | null {
  const real = Object.entries(bag).filter(([, d]) => typeof d === 'number' && (d as number) > 0) as [string, number][];
  if (real.length > 0) {
    let best: [string, number] | null = null;
    let longest = real[0];
    let shortest = real[0];
    for (const entry of real) {
      if (!best || Math.abs(entry[1] - playsLikeYards) < Math.abs(best[1] - playsLikeYards)) best = entry;
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
        why.unshift(`past your ${longest[0].toLowerCase()} (${Math.round(longest[1])}) — lay up and leave a wedge`);
        return longest[0];
      }
      if (playsLikeYards < shortest[1] - PARTIAL_MARGIN) {
        why.unshift(`less than a full ${shortest[0].toLowerCase()} — partial swing`);
        return shortest[0];
      }
      why.push(`your ${best[0].toLowerCase()} carries ~${Math.round(best[1])}`);
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
  const club = pickClub(playsLikeYards, bag, why);

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
