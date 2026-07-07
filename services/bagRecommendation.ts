/**
 * 2026-06-13 — Course-specific bag recommendation (Part B1: PLAYED course).
 *
 * Tim's moat: "people pack a stock bag, then amass clubs that solve ONE course
 * and carry dead weight everywhere — too many wedges, not enough hybrids/long
 * irons." The caddie should tell you which clubs to carry for THIS course.
 *
 * B1 handles a course you've PLAYED: it reads what you actually used there and
 * answers two questions honestly —
 *   1. Which clubs do all the work here, and which sit idle (swap candidates)?
 *   2. Where are the DISTANCE GAPS you keep facing with no club that fits?
 *      ("30y gap between your 5I and 3H → put a hybrid back in.")
 *
 * Like cnsShotRead, this is PURE / SYNC / OFFLINE-SAFE / never-throws — no React,
 * no network, no store access (the caller passes the data in). That keeps it
 * unit-testable AND usable with zero signal. It lives in the Caddie Brain layer
 * (caddie-brain-lens): the scorecard is just the display surface.
 *
 * B2 (a NEW, never-played course → recommend from the course profile × your bag)
 * is the phased follow-up; it is NOT built here. See memory:
 * course-specific-bag-optimizer, caddie-brain-lens, smartfinder-unified-brain-read.
 */

import {
  CLUB_ORDER,
  getLearnedClubDistances,
  useClubStatsStore,
  type ClubName,
} from '../store/clubStatsStore';
// Type-only — keeps this module free of roundStore's runtime deps (it pulls in
// RN asset requires) so the pure composer stays node/unit-test importable. The
// store is loaded lazily inside recommendBagForCourse, the only place that needs it.
import type { ShotResult } from '../store/roundStore';

/** Standard amateur carry chart — mirrors clubStatsStore's private table so the
 *  recommendation has a distance for every club even before it's been logged. */
const STANDARD_YARDS: Record<ClubName, number> = {
  Driver: 275, '3W': 255, '5W': 240, '7W': 228,
  '2H': 222, '3H': 216, '4H': 211,
  '3I': 205, '4I': 190, '5I': 175, '6I': 162, '7I': 148, '8I': 135, '9I': 122,
  PW: 110, GW: 98, SW: 86, LW: 74, Putter: 0,
};

/** Fewer than this many rounds at a course → the read is still "forming"; we
 *  surface it as an early estimate rather than a confident recommendation. */
export const MIN_ROUNDS_FOR_CONFIDENCE = 2;
/** A carry gap wider than this (yds) between two adjacent clubs you use is a
 *  real hole in your set — about a club-and-a-half. */
const GAP_YARDS = 25;

export interface ClubUse {
  club: string;
  count: number;
  /** Avg measured carry here, or the club's learned/standard distance. */
  carry: number;
  /** True when every shot for this club was inferred from distance (no tag). */
  estimated: boolean;
}

export interface BagGap {
  /** Shorter club bounding the gap. */
  lowClub: string;
  lowYards: number;
  /** Longer club bounding the gap. */
  highClub: string;
  highYards: number;
  gapYards: number;
  /** Yardage the gap is centred on — what an ideal fill club would carry. */
  centerYards: number;
  /** Honest fill suggestion (a club you own but benched, or a club class). */
  suggestion: string;
}

export interface BagRecommendation {
  courseName: string | null;
  roundsPlayed: number;
  shotCount: number;
  /** True when too few rounds to be confident — show as a forming estimate. */
  forming: boolean;
  /** Clubs that see action here, long → short. */
  carry: ClubUse[];
  /** Clubs in your real (learned) bag that sat idle here — swap candidates. */
  idle: string[];
  /** Distance holes you keep facing with no club that fits. */
  gaps: BagGap[];
  /** One answer-first line. */
  headline: string;
  /** Short supporting lines. */
  rationale: string[];
}

function classOf(club: string): 'wood' | 'hybrid' | 'iron' | 'wedge' | 'other' {
  if (club === 'Driver' || /\dW$/.test(club)) return 'wood';
  if (/\dH$/.test(club)) return 'hybrid';
  if (/\dI$/.test(club)) return 'iron';
  if (club === 'PW' || club === 'GW' || club === 'SW' || club === 'LW') return 'wedge';
  return 'other';
}

const CLASS_LABEL: Record<ReturnType<typeof classOf>, string> = {
  wood: 'fairway wood', hybrid: 'hybrid', iron: 'iron', wedge: 'wedge', other: 'club',
};

export interface BagRecInput {
  courseName: string | null;
  /** Every shot from your in-app rounds at this course (imports excluded). */
  shots: ShotResult[];
  /** How many in-app rounds you've played here. */
  roundsPlayed: number;
  /** club → distance (learned avg where known, else standard chart). */
  clubDistances: Record<string, number>;
  /** Your real bag: clubs you've logged real samples for (may be empty). */
  ownedClubs: string[];
  /** Distance → best club, for attributing clubless shots. */
  inferClub: (yards: number) => string;
}

/**
 * Pure composition. Given the shots you took at a course + your bag distances,
 * return which clubs to carry, which to bench, and the gaps to fill. Never
 * throws; degrades to an empty/forming read when there's no signal.
 */
export function composeBagRecommendation(input: BagRecInput): BagRecommendation {
  const { courseName, shots, roundsPlayed, clubDistances, ownedClubs, inferClub } = input;
  const safeShots = Array.isArray(shots) ? shots : [];

  const distanceFor = (club: string): number =>
    clubDistances[club] ?? STANDARD_YARDS[club as ClubName] ?? 0;

  // Aggregate usage — mirrors the scorecard's aggregateClubs: a clubless shot is
  // attributed by INFERRING the club from its distance, flagged estimated. A shot
  // with neither club nor distance carries no signal and is skipped.
  const map = new Map<string, { count: number; distSum: number; distCount: number; estCount: number }>();
  for (const s of safeShots) {
    const d = (s.distance_yards ?? s.carry_distance ?? null) as number | null;
    let club = s.club;
    let inferred = false;
    if (!club) {
      if (typeof d === 'number' && d > 0) { club = inferClub(d); inferred = true; }
      else continue;
    }
    const cur = map.get(club) ?? { count: 0, distSum: 0, distCount: 0, estCount: 0 };
    cur.count += 1;
    if (inferred) cur.estCount += 1;
    if (typeof d === 'number' && d > 0) { cur.distSum += d; cur.distCount += 1; }
    map.set(club, cur);
  }

  const carry: ClubUse[] = Array.from(map.entries())
    .map(([club, v]) => ({
      club,
      count: v.count,
      carry: v.distCount > 0 ? Math.round(v.distSum / v.distCount) : distanceFor(club),
      // 2026-07-06 (elite audit) — honest flag: ANY inferred use marks the read
      // estimated (was only all-inferred), and a club with zero measured
      // distances falls back to chart/stated carry — that's an estimate too.
      estimated: v.estCount > 0 || v.distCount === 0,
    }))
    // Putter has no carry — keep it in the bag but out of the gap math.
    .sort((a, b) => b.carry - a.carry);

  const usedSet = new Set(carry.map(c => c.club));
  // Idle = clubs in your real (logged) bag you didn't reach for here. Only
  // meaningful once we know your real bag; never fabricates a stock set.
  const idle = ownedClubs.filter(c => c !== 'Putter' && !usedSet.has(c));

  // Gap detection: walk the clubs you USE (full-swing only) longest → shortest;
  // any adjacent carry gap wider than GAP_YARDS is a hole in your set.
  const swingClubs = carry.filter(c => c.club !== 'Putter' && c.carry > 0);
  const gaps: BagGap[] = [];
  for (let i = 0; i < swingClubs.length - 1; i++) {
    const hi = swingClubs[i];
    const lo = swingClubs[i + 1];
    const gapYards = hi.carry - lo.carry;
    if (gapYards <= GAP_YARDS) continue;
    const center = Math.round((hi.carry + lo.carry) / 2);
    // Prefer a club you ALREADY OWN that fills the centre — "put your 4H back in"
    // beats "buy a club". Only when no owned club reasonably fits do we fall back
    // to suggesting a club CLASS to add.
    const ownedFill = ownedClubs
      .filter(c => c !== 'Putter' && !usedSet.has(c))
      .map(c => ({ club: c, diff: Math.abs(distanceFor(c) - center) }))
      .sort((a, b) => a.diff - b.diff)[0];
    let bestFill: string | null = null;
    let bestDiff = Infinity;
    for (const club of CLUB_ORDER) {
      if (club === 'Putter' || usedSet.has(club)) continue;
      const diff = Math.abs(distanceFor(club) - center);
      if (diff < bestDiff) { bestDiff = diff; bestFill = club; }
    }
    let suggestion: string;
    if (ownedFill && ownedFill.diff <= GAP_YARDS) {
      suggestion = `put your ${ownedFill.club} back in (~${distanceFor(ownedFill.club)}y)`;
    } else if (bestFill) {
      suggestion = `add a ${CLASS_LABEL[classOf(bestFill)]} around ${center}y (e.g. ${bestFill})`;
    } else {
      suggestion = `add a club around ${center}y`;
    }
    gaps.push({
      lowClub: lo.club, lowYards: lo.carry,
      highClub: hi.club, highYards: hi.carry,
      gapYards, centerYards: center, suggestion,
    });
  }

  const forming = roundsPlayed < MIN_ROUNDS_FOR_CONFIDENCE;
  const where = courseName ? ` at ${courseName}` : '';
  const nUsed = carry.length;

  let headline: string;
  if (nUsed === 0) {
    headline = `No shots logged${where} yet — play a round and the caddie will learn your bag here.`;
  } else if (forming) {
    headline = `${nUsed} club${nUsed === 1 ? '' : 's'} so far${where} — pattern still forming over ${roundsPlayed} round${roundsPlayed === 1 ? '' : 's'}.`;
  } else {
    const idlePart = idle.length ? `, ${idle.length} ${idle.length === 1 ? 'sits' : 'sit'} idle` : '';
    const gapPart = gaps.length ? ` · ${gaps.length} distance gap${gaps.length === 1 ? '' : 's'} to fill` : '';
    headline = `${nUsed} club${nUsed === 1 ? '' : 's'} do the work${where}${idlePart}${gapPart}.`;
  }

  const rationale: string[] = [];
  if (idle.length) {
    rationale.push(`Idle here: ${idle.join(', ')} — swap candidates for a club that fits a gap.`);
  }
  for (const g of gaps) {
    rationale.push(`${g.gapYards}y gap between your ${g.lowClub} (${g.lowYards}y) and ${g.highClub} (${g.highYards}y) → ${g.suggestion}.`);
  }

  return {
    courseName,
    roundsPlayed,
    shotCount: safeShots.length,
    forming,
    carry,
    idle,
    gaps,
    headline,
    rationale,
  };
}

/**
 * Store-reading wrapper — the Caddie Brain entry point. Reads your in-app rounds
 * at `courseId` (Golfshot imports carry no shots, so they're excluded) plus your
 * learned bag, and composes the recommendation. Safe to call anywhere; returns a
 * forming/empty read when there's nothing to go on.
 */
export function recommendBagForCourse(courseId: string | null): BagRecommendation {
  // Lazy require — see the type-only import note above.
  const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
  const rounds = useRoundStore.getState().roundHistory.filter(
    // 2026-07-06 (elite audit) — sim rounds use the REAL courseId with stated
    // distances, so without this gate they train the course bag optimizer.
    r => r.courseId === courseId && !r.id.startsWith('imported_') && !r.simulated,
  );
  const shots: ShotResult[] = [];
  for (const r of rounds) if (Array.isArray(r.shots)) shots.push(...r.shots);
  const courseName = rounds.find(r => r.courseName)?.courseName ?? null;
  const learned = getLearnedClubDistances();
  const clubStats = useClubStatsStore.getState();
  return composeBagRecommendation({
    courseName,
    shots,
    roundsPlayed: rounds.length,
    clubDistances: learned,
    ownedClubs: Object.keys(learned),
    inferClub: (yards: number) => clubStats.inferClub(yards),
  });
}
