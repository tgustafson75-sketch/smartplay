/**
 * 2026-06-15 (Tim — AI club fitting, honest v1) — the FIT PROFILE.
 *
 * The honest, defensible first piece of club fitting ([[ai-club-fitting]]): GAPPING
 * from the player's REAL tracked distances. Reads the club ladder (clubStatsStore)
 * and finds the holes (a gap with no club that fits) + redundancies (two clubs doing
 * the same job). Pure / sync / never-throws.
 *
 * HONESTY (the whole feature depends on this): gaps/overlaps come from real tracked
 * carries; each club is flagged MEASURED vs inferred (standard chart), and overall
 * confidence scales with how much is measured. This is a DATA-GROWN STARTING POINT,
 * never a launch-monitor spec — no fabricated lie°, mph, or smash. The precision
 * fit metrics stay parked until capture supports them ([[face-smash-fps-future]]).
 */

export interface FitClubInput {
  club: string;
  yards: number;
  /** True = average from real tracked shots; false = standard-chart inference. */
  measured: boolean;
}

export interface FitGap {
  lower: string;      // shorter club bounding the gap
  upper: string;      // longer club bounding the gap
  gapYards: number;
  /** Yardage an ideal fill club would carry (centre of the gap). */
  centerYards: number;
}

export interface FitOverlap {
  shorter: string;
  longer: string;
  gapYards: number;   // how close they carry
}

export interface FitProfile {
  /** Full-swing clubs, longest→shortest (Putter / 0-yd excluded). */
  ladder: FitClubInput[];
  gaps: FitGap[];
  overlaps: FitOverlap[];
  measuredCount: number;
  totalCount: number;
  confidence: 'low' | 'medium' | 'high';
  headline: string;
  disclaimer: string;
}

// A gap wider than this between two adjacent clubs is a real hole (~a club-and-a-
// half). Two clubs closer than the overlap are doing the same job.
const GAP_YARDS = 20;
const OVERLAP_YARDS = 7;

const DISCLAIMER =
  'A data-grown starting point from your tracked distances — not a launch-monitor fit. Bring it to a fitter to dial the specs.';

export function composeFitProfile(clubs: FitClubInput[]): FitProfile {
  const ladder = (clubs ?? [])
    .filter((c) => c && typeof c.yards === 'number' && c.yards > 0)
    .sort((a, b) => b.yards - a.yards);

  const gaps: FitGap[] = [];
  const overlaps: FitOverlap[] = [];
  for (let i = 0; i < ladder.length - 1; i++) {
    const longer = ladder[i];
    const shorter = ladder[i + 1];
    const d = Math.round(longer.yards - shorter.yards);
    if (d >= GAP_YARDS) {
      gaps.push({
        lower: shorter.club,
        upper: longer.club,
        gapYards: d,
        centerYards: Math.round((longer.yards + shorter.yards) / 2),
      });
    } else if (d <= OVERLAP_YARDS) {
      overlaps.push({ shorter: shorter.club, longer: longer.club, gapYards: d });
    }
  }

  const measuredCount = ladder.filter((c) => c.measured).length;
  const totalCount = ladder.length;
  const confidence: FitProfile['confidence'] = measuredCount >= 8 ? 'high' : measuredCount >= 4 ? 'medium' : 'low';

  let headline: string;
  if (confidence === 'low') {
    headline = 'Early read — log a few more tracked shots and your fit picture sharpens. So far, here\'s your distance ladder.';
  } else {
    const parts: string[] = [];
    if (gaps.length) parts.push(`${gaps.length} distance ${gaps.length === 1 ? 'gap' : 'gaps'} to fill`);
    if (overlaps.length) parts.push(`${overlaps.length} ${overlaps.length === 1 ? 'overlap' : 'overlaps'} (clubs doing the same job)`);
    headline = parts.length
      ? `Your set: ${parts.join(' · ')}.`
      : 'Your set is evenly gapped — no holes and no redundant clubs from your tracked distances.';
  }

  return { ladder, gaps, overlaps, measuredCount, totalCount, confidence, headline, disclaimer: DISCLAIMER };
}

/**
 * 2026-06-15 (Tim) — FLEX DIRECTION, honestly. From the player's MEASURED driver
 * carry (real) via the standard distance→flex heuristic online fitters use — NOT a
 * fabricated clubhead-speed mph. Returns null when the driver carry isn't measured
 * yet (don't guess flex off a standard-chart number). A starting point, not a spec.
 */
export interface FlexSuggestion { flex: string; note: string }
export function recommendFlex(driverCarryYards: number, measured: boolean): FlexSuggestion | null {
  if (!measured || !(driverCarryYards > 0)) return null;
  const c = Math.round(driverCarryYards);
  const flex = c < 190 ? 'Senior / A flex'
    : c < 215 ? 'Regular flex'
    : c < 245 ? 'Stiff flex'
    : 'X-Stiff flex';
  return {
    flex,
    note: `A sensible starting point from your ~${c} yd driver carry — not a launch-monitor fitting. Tempo and ball speed refine it; confirm with a fitter.`,
  };
}

/**
 * 2026-06-15 (Tim) — BALL FIT, honestly, at the CATEGORY level. From the speed tier
 * (driver carry) + handicap — readable signals. NOT a specific ball/SKU and NO
 * fabricated spin/compression numbers (we don't measure those). Always returns a
 * category as a starting point; handicap null → assume mid.
 */
export interface BallSuggestion { category: string; note: string }
export function recommendBallCategory(driverCarryYards: number, handicap: number | null): BallSuggestion {
  const c = driverCarryYards > 0 ? driverCarryYards : 0;
  const speed: 'slow' | 'moderate' | 'fast' = c >= 250 ? 'fast' : c >= 200 ? 'moderate' : c > 0 ? 'slow' : 'moderate';
  const hcp = typeof handicap === 'number' ? handicap : 18;
  const skilled = hcp <= 12;

  let category: string;
  if (speed === 'slow') category = 'Low-compression soft';
  else if (speed === 'fast') category = skilled ? 'Tour (urethane)' : 'Soft distance';
  else category = skilled ? 'Tour / soft urethane' : 'Soft distance (two-piece)';

  const speedLabel = c > 0 ? `your speed tier (~${Math.round(c)} yd driver)` : 'a typical speed tier';
  return {
    category,
    note: `Category-level from ${speedLabel} + a ${hcp} handicap. We don\'t measure spin/compression yet, so pick the exact ball by feel and greenside control within this category.`,
  };
}
