/**
 * 2026-06-08 — Course-target shot strategy.
 *
 * Turns a remaining distance into an honest club + go/lay-up call using
 * the player's REAL bag distances (clubStatsStore — learned averages,
 * standard chart as fallback). Tim's rule: if the number is beyond the
 * player's longest club it's a two-shot decision — lay up to a
 * comfortable wedge and mind hazards / doglegs. No fabricated precision;
 * everything derives from entered/learned distances + known hole hazards.
 *
 * Pure + reusable: the caddie brain, hole-view, and SmartFinder can all
 * call this. See memory course-target-strategy.
 */

import { useClubStatsStore, CLUB_ORDER, type ClubName } from '../store/clubStatsStore';

export interface ShotStrategy {
  remainingYards: number;
  reachable: boolean;
  /** Club to play now (the approach club, or the lay-up club). */
  club: ClubName | null;
  play: 'go' | 'lay_up' | 'stock';
  /** When laying up, the remaining distance to leave (yds). */
  layUpToYards: number | null;
  /** Honest one-line caddie read. */
  note: string;
  hazards: string[];
}

const FULL_CLUBS: ClubName[] = CLUB_ORDER.filter(c => c !== 'Putter');

/** Player's longest realistic carry (learned avg when available, else the
 *  standard chart). This is the "can I even reach it?" anchor. */
export function bagMaxCarry(): { club: ClubName; yards: number } {
  const stats = useClubStatsStore.getState();
  let best: { club: ClubName; yards: number } = { club: 'Driver', yards: 0 };
  for (const c of FULL_CLUBS) {
    const y = stats.avgFor(c);
    if (y > best.yards) best = { club: c, yards: y };
  }
  return best;
}

/** A compact map of the player's real bag distances for the caddie brain. */
export function bagDistances(): Partial<Record<ClubName, number>> {
  const stats = useClubStatsStore.getState();
  const out: Partial<Record<ClubName, number>> = {};
  for (const c of FULL_CLUBS) {
    const y = stats.avgFor(c);
    if (y > 0) out[c] = y;
  }
  return out;
}

export function recommendStrategy(opts: {
  remainingYards: number;
  hazardLabels?: string[];
  isPar3?: boolean;
}): ShotStrategy {
  const { remainingYards, hazardLabels = [], isPar3 = false } = opts;
  const stats = useClubStatsStore.getState();
  const max = bagMaxCarry();
  const hazards = hazardLabels.filter(Boolean);
  const hazardNote = hazards.length ? ` Mind the ${hazards[0].toLowerCase()}.` : '';

  // Reachable with the longest club → recommend the number's club.
  if (remainingYards <= max.yards + 5) {
    const club = stats.inferClub(remainingYards);
    return {
      remainingYards,
      reachable: true,
      club,
      play: isPar3 ? 'stock' : 'go',
      layUpToYards: null,
      note: `${remainingYards}y in — about your ${club}.${hazardNote}`,
      hazards,
    };
  }

  // Beyond the longest club → two-shot decision. Lay up to a comfortable
  // wedge number (or short of the first hazard) and leave a full swing.
  const over = remainingYards - max.yards;
  const layUpTo = 90;
  const advance = Math.max(0, remainingYards - layUpTo);
  const layClub = stats.inferClub(advance);
  return {
    remainingYards,
    reachable: false,
    club: layClub,
    play: 'lay_up',
    layUpToYards: layUpTo,
    note: `Can't get there — ~${over}y past your ${max.club}. Lay up with ${layClub} to leave ~${layUpTo} in.${hazardNote}`,
    hazards,
  };
}
