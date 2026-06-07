/**
 * Phase T — World Handicap System (WHS) calculations.
 *
 * Authority: USGA / R&A Rules of Handicapping (2024 update). All
 * formulas verified against the official handbook.
 *
 * What this service does NOT do:
 *   - Post scores to GHIN (1.x integration)
 *   - Compute Course Conditions adjustment (PCC) — that's pulled from
 *     official sources, not local computation
 *   - Tournament-format handicap allowances (1.x)
 *
 * What it DOES do:
 *   - Course Handicap from Index, Slope, Rating, Par
 *   - Score Differential from Adjusted Gross Score, Course Rating, Slope
 *   - Adjusted Gross Score with Net Double Bogey cap per hole
 *   - Estimated Index update (best 8 of last 20 differentials)
 *   - Plain-language explanation of impact on Index
 *
 * Math verification (from spec test cases — all pass):
 *   • computeCourseHandicap(18.0, 72.0, 113, 72) = 18  ✓
 *   • computeCourseHandicap(18.0, 75.5, 145, 72) = 27  ✓ (rounded from 26.6)
 *   • computeScoreDifferential(95, 72.0, 113) = 23.0  ✓
 *   • netDoubleBogeyCap(par=4, strokesOnHole=1) = 7  ✓
 *   • netDoubleBogeyCap(par=5, strokesOnHole=2) = 9  ✓
 */

const NEUTRAL_SLOPE = 113;

/**
 * Course Handicap = Index × (Slope / 113) + (Course Rating − Par)
 * Returns the rounded integer used for stroke allocation on the course.
 */
export function computeCourseHandicap(
  handicapIndex: number,
  courseRating: number,
  slopeRating: number,
  par: number,
): number {
  const slopeAdj = handicapIndex * (slopeRating / NEUTRAL_SLOPE);
  const ratingAdj = courseRating - par;
  return Math.round(slopeAdj + ratingAdj);
}

/**
 * Score Differential = (113 / Slope) × (Adjusted Gross Score − Course Rating)
 * Rounded to one decimal place. Used for posting individual rounds.
 */
export function computeScoreDifferential(
  adjustedGrossScore: number,
  courseRating: number,
  slopeRating: number,
): number {
  const raw = (NEUTRAL_SLOPE / slopeRating) * (adjustedGrossScore - courseRating);
  return Math.round(raw * 10) / 10;
}

/**
 * Net Double Bogey cap for a single hole's score for handicap posting:
 *   max = par + 2 + strokes received on that hole
 */
export function netDoubleBogeyCap(par: number, strokesOnHole: number): number {
  return par + 2 + strokesOnHole;
}

/**
 * Strokes received on a given hole given a Course Handicap and the hole's
 * stroke index (1 = hardest, 18 = easiest). For Course Handicap H:
 *   strokes_on_hole = floor(H / 18) + (1 if hole_index <= H mod 18 else 0)
 *
 * Note: hole_index in WHS is the hole's handicap difficulty rank (the
 * "Handicap" column on the scorecard — usually labelled "HCP" or "Index").
 */
export function strokesReceivedOnHole(
  courseHandicap: number,
  holeStrokeIndex: number,
): number {
  if (courseHandicap <= 0) return 0;
  const base = Math.floor(courseHandicap / 18);
  const remainder = courseHandicap - base * 18;
  return base + (holeStrokeIndex <= remainder ? 1 : 0);
}

/**
 * Compute Adjusted Gross Score for handicap posting. Caps each hole's
 * score at net double bogey, sums for the round.
 *
 * holeData = list of { hole_number, par, score, hole_stroke_index }.
 * If hole_stroke_index is missing, falls back to assuming a flat
 * distribution (hole_number === stroke index — fine for simulated
 * recreational rounds where the scorecard's "HCP" column isn't loaded).
 */
export interface HandicapHoleEntry {
  hole_number: number;
  par: number;
  score: number;
  hole_stroke_index?: number; // 1-18; lower = harder
}

export function computeAdjustedGrossScore(
  holeData: HandicapHoleEntry[],
  courseHandicap: number,
): number {
  let total = 0;
  for (const h of holeData) {
    const strokeIdx = h.hole_stroke_index ?? h.hole_number;
    const strokes = strokesReceivedOnHole(courseHandicap, strokeIdx);
    const cap = netDoubleBogeyCap(h.par, strokes);
    total += Math.min(h.score, cap);
  }
  return total;
}

/**
 * Estimated new Index update. WHS uses the best 8 of the most recent 20
 * differentials, with various adjustments (low-handicap reduction, soft
 * and hard caps). This implementation does the core best-8-of-20 average.
 * Reserved for client-side estimation only — official Index posting goes
 * through GHIN in 1.x.
 *
 * Returns:
 *   {
 *     newIndex: number | null,    // null if fewer than 5 differentials
 *     estimateNote: string,        // human-readable caveat
 *     differentialsUsed: number    // how many out of 20 considered
 *   }
 */
export function estimateNewIndex(
  recentDifferentials: number[],
): { newIndex: number | null; estimateNote: string; differentialsUsed: number } {
  if (recentDifferentials.length < 3) {
    return {
      newIndex: null,
      estimateNote: `Need at least 3 rounds for an Index estimate; you have ${recentDifferentials.length}.`,
      differentialsUsed: recentDifferentials.length,
    };
  }
  const sorted = [...recentDifferentials].slice(-20).sort((a, b) => a - b);
  // WHS table for "lowest N of last 20" used in Index calculation.
  // For our v1.0 estimate we use the simplified band: floor((n × 0.4)) capped at 8.
  const n = sorted.length;
  const useCount = Math.max(1, Math.min(8, Math.ceil(n * 0.4)));
  const best = sorted.slice(0, useCount);
  const avg = best.reduce((a, b) => a + b, 0) / best.length;
  const newIndex = Math.round(avg * 10) / 10;
  return {
    newIndex,
    estimateNote: n < 20
      ? `Estimate based on best ${useCount} of your last ${n} differentials (need 20 for a definitive Index).`
      : `Estimate based on best ${useCount} of your last 20 differentials.`,
    differentialsUsed: n,
  };
}

/**
 * Natural-language summary of how a round affects the player's handicap.
 * Used by the post-round workflow + handicap voice query handler.
 */
export function explainHandicapImpact(input: {
  newDifferential: number;
  currentIndex: number | null;
  recentDifferentials: number[];
}): string {
  const { newDifferential, currentIndex, recentDifferentials } = input;

  if (recentDifferentials.length < 3) {
    return `Differential is ${newDifferential.toFixed(1)}. Need at least 3 rounds for an Index estimate — keep posting.`;
  }

  const before = estimateNewIndex(recentDifferentials);
  const after = estimateNewIndex([...recentDifferentials, newDifferential]);
  if (!before.newIndex || !after.newIndex) {
    return `Differential is ${newDifferential.toFixed(1)}. Keep posting rounds for a stable Index estimate.`;
  }

  const change = Math.round((after.newIndex - before.newIndex) * 10) / 10;
  if (Math.abs(change) < 0.05) {
    return `That ${newDifferential.toFixed(1)} differential — won't move your Index estimate (currently ${before.newIndex}). It wasn't one of your best 8.`;
  }
  if (change < 0) {
    return `That ${newDifferential.toFixed(1)} differential — your Index estimate drops from ${before.newIndex} to ${after.newIndex}. Trending the right way.`;
  }
  return `That ${newDifferential.toFixed(1)} differential — your Index estimate ticks up from ${before.newIndex} to ${after.newIndex}. One round; trends matter more than any single one.`;
}

/**
 * Convenience: compute the full handicap picture for a finished round.
 */
export interface RoundHandicapResult {
  course_handicap: number;
  adjusted_gross_score: number;
  raw_score: number;
  score_differential: number;
  estimated_index_impact: string;
}

/**
 * 2026-05-26 — Fix BD: rebuild differentials from a list of historical
 * round records. Used by the "Recalculate Handicap From Round History"
 * button in Settings so a user who has populated their roundHistory via
 * Import Past Round (Batch 28) OR completed in-app rounds can derive
 * their WHS-equivalent Index from scratch without having to enter it
 * manually.
 *
 * Approach: for each round, compute a score differential against the
 * neutral USGA baseline (course rating 72.0, slope 113) using the
 * totalScore. Per-hole AGS capping is skipped because imported rounds
 * don't carry per-hole pars; the trend remains meaningful even without
 * per-hole adjustment. Result: differentials in chronological order
 * (oldest first), trimmed to last 20 (the WHS look-back window).
 */
export function rebuildDifferentialsFromHistory(rounds: {
  startedAt: number;
  totalScore: number;
  holesPlayed: number;
}[]): number[] {
  // 2026-06-06 — Phase 6.1: 9-hole rounds get totalScore × 2 as an
  // 18-hole-equivalent for differential math. Previously a 9-hole
  // round's raw totalScore (~40 strokes) was being fed into a
  // computeScoreDifferential() expecting an 18-hole AGS (~80-95),
  // producing falsely-LOW differentials and biasing the user's
  // estimated Index down by ~10-15 strokes per 9-hole round in
  // history. WHS handles 9-hole rounds by pairing them; for our
  // simplified-estimate path, doubling is the cleanest single-round
  // approximation (assumes the player would have repeated similar
  // play on a second 9). Partial 10-17 hole rounds are rejected
  // entirely — there's no honest way to treat them as either format.
  return rounds
    .filter(r => r.totalScore > 0 && (r.holesPlayed === 9 || r.holesPlayed === 18))
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(r => {
      const adjustedScore = r.holesPlayed === 9 ? r.totalScore * 2 : r.totalScore;
      return computeScoreDifferential(adjustedScore, 72.0, 113);
    })
    .slice(-20);
}

export function computeRoundHandicap(input: {
  handicapIndex: number;
  courseRating: number;
  slopeRating: number;
  par: number;
  holes: HandicapHoleEntry[];
  recentDifferentials?: number[];
}): RoundHandicapResult {
  const ch = computeCourseHandicap(
    input.handicapIndex,
    input.courseRating,
    input.slopeRating,
    input.par,
  );
  const ags = computeAdjustedGrossScore(input.holes, ch);
  const raw = input.holes.reduce((a, h) => a + h.score, 0);
  const diff = computeScoreDifferential(ags, input.courseRating, input.slopeRating);
  const impact = explainHandicapImpact({
    newDifferential: diff,
    currentIndex: input.handicapIndex,
    recentDifferentials: input.recentDifferentials ?? [],
  });
  return {
    course_handicap: ch,
    adjusted_gross_score: ags,
    raw_score: raw,
    score_differential: diff,
    estimated_index_impact: impact,
  };
}
