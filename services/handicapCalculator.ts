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
/** Neutral 9-hole course rating (half of 72). Used only when a round carries no real rating. */
const NINE_HOLE_CR = 36;

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
 * 2026-06-11 — Expected 9-hole Score Differential for the "second nine" a
 * player didn't play, as a function of their Handicap Index. WHS combines a
 * played-9 differential with this EXPECTED value rather than assuming the
 * player would repeat the exact nine they shot — which, for a strong nine,
 * understates the round and biases the Index down. Linear approximation of
 * the USGA Expected Score Differential table (within ~±0.6 across 0–30).
 */
export function expectedNineDifferential(handicapIndex: number): number {
  const hi = Math.max(0, handicapIndex);
  return Math.round((0.55 * hi + 2.7) * 10) / 10;
}

/**
 * Minimum plausible strokes-per-hole for a COMPLETED round. A finished round
 * cannot average under this (it would be many-under-par on every hole), so a
 * score below `holes × MIN_STROKES_PER_HOLE` is an abandoned/partial round —
 * e.g. an imported "4" from a round quit after one hole.
 */
const MIN_STROKES_PER_HOLE = 3;

/**
 * 2026-05-26 — Fix BD: rebuild differentials from a list of historical
 * round records. Used by the "Recalculate Handicap From Round History"
 * button + the bulk round-list import so a user who has populated their
 * roundHistory can derive their WHS-equivalent Index from scratch.
 *
 * Approach: each round becomes a Score Differential against the neutral USGA
 * baseline (course rating 72.0 for 18 holes / 36.0 for 9, slope 113). Imported
 * rounds don't carry real course ratings, so this is an ESTIMATE that runs a
 * touch under the official WHS Index (which uses each course's true rating).
 * Per-hole AGS capping is skipped (no per-hole pars). Differentials are
 * returned oldest-first, trimmed to the last 20 (the WHS look-back window).
 */
/**
 * 2026-08-08 (Tim's index cratering) — derive the REAL differential baseline for a round record:
 * parTotal from the round's own holePars snapshot (summed over its scored holes, or all keys when the
 * snapshot only covers the posted length), and the course's real rating/slope from the bundled catalog
 * when the round has a bundled courseId. Bundled ratings are 18-HOLE ratings (the card standard), so a
 * 9-hole posting halves the rating; slope is length-independent. Lazy-required so no import cycle.
 */
/**
 * 2026-09-03 — THE POSTED DIFFERENTIAL, IN ONE PLACE.
 *
 * The recap's handicap card computed its own differential with `computeScoreDifferential(gross, 72,
 * 113)` — hardcoded NEUTRAL rating and slope — while the Index posting path used the round's REAL
 * baseRating and baseSlope. Its comment said the card exists to "DISPLAY the same differential the
 * round posts" and that the two matched "by construction". They did not: on a slope-131 course
 * rated 71.4, an AGS of 92 posts (113/131)x(92-71.4) = 17.8 and the card showed
 * (113/113)x(92-72) = 20.0. The card OVERSTATED the differential on any course harder than neutral,
 * so the player read a worse number than the one that actually moved their Index.
 *
 * Two copies of a formula stay identical exactly as long as nobody edits one. These are the copies,
 * merged — the card and rebuildDifferentialsFromHistory now call the same two functions, so they
 * agree by construction rather than by comment. [[two-owners-is-the-root-cause]]
 */
export type PostingInputs = { score: number; posted: 9 | 18; baseRating: number | null; baseSlope: number };

/** Normalize a round record into what the posting path actually feeds the differential. */
export function postingInputsFor(r: {
  totalScore: number;
  handicapAgs?: number | null;
  handicapHoles?: 9 | 18;
  holesPlayed: number;
  holePars?: Record<number, number> | null;
  scores?: Record<number, number> | null;
  courseId?: string | null;
  rating?: number | null;
  slope?: number | null;
  parTotal?: number | null;
}): PostingInputs | null {
  const posted: 9 | 18 | null = r.handicapHoles ?? (r.holesPlayed === 9 ? 9 : r.holesPlayed === 18 ? 18 : null);
  if (posted == null) return null;
  // The CAPPED Adjusted Gross Score when the round has posted; the raw total is only a fallback.
  const score = r.handicapAgs ?? r.totalScore;
  if (!(score > 0)) return null;
  const derived = (r.rating == null && r.parTotal == null && (r.holePars || r.courseId))
    ? postingBaseline(r)
    : { parTotal: r.parTotal ?? null, rating: r.rating ?? null, slope: r.slope ?? null };
  const baseRating = (typeof derived.rating === 'number' && derived.rating > 0)
    ? derived.rating
    : (typeof derived.parTotal === 'number' && derived.parTotal > 0) ? derived.parTotal : null;
  const baseSlope = (typeof derived.slope === 'number' && derived.slope > 0) ? derived.slope : NEUTRAL_SLOPE;
  return { score, posted, baseRating, baseSlope };
}

/** The differential this round contributes to the Index. `handicapIndex` is used only for the
 *  9-hole expected-second-nine term. */
export function postedDifferentialFor(r: PostingInputs, handicapIndex: number): number {
  return r.posted === 9
    ? Math.round((computeScoreDifferential(r.score, r.baseRating ?? NINE_HOLE_CR, r.baseSlope) + expectedNineDifferential(handicapIndex)) * 10) / 10
    : computeScoreDifferential(r.score, r.baseRating ?? 72.0, r.baseSlope);
}

export function postingBaseline(r: {
  holesPlayed: number;
  handicapHoles?: 9 | 18;
  holePars?: Record<number, number> | null;
  scores?: Record<number, number> | null;
  courseId?: string | null;
}): { parTotal: number | null; rating: number | null; slope: number | null } {
  const posted: 9 | 18 | null = r.handicapHoles ?? (r.holesPlayed === 9 ? 9 : r.holesPlayed === 18 ? 18 : null);
  let parTotal: number | null = null;
  if (posted && r.holePars) {
    const parKeys = Object.keys(r.holePars).map(Number).filter(Number.isFinite);
    if (parKeys.length > 0 && parKeys.length <= posted) {
      parTotal = parKeys.reduce((s, k) => s + (r.holePars![k] || 0), 0);
    } else if (parKeys.length > posted && r.scores) {
      // Full-course snapshot but a shorter posting (front/back nine at an 18): sum the SCORED holes' pars.
      const scoredKeys = Object.keys(r.scores).map(Number).filter(k => (r.scores![k] ?? 0) > 0 && r.holePars![k] != null);
      if (scoredKeys.length > 0) {
        const sum = scoredKeys.reduce((s, k) => s + (r.holePars![k] || 0), 0);
        parTotal = scoredKeys.length === posted ? sum : Math.round((sum / scoredKeys.length) * posted);
      }
    }
    if (parTotal != null && parTotal <= 0) parTotal = null;
  }
  let rating: number | null = null;
  let slope: number | null = null;
  try {
    if (r.courseId && r.courseId.startsWith('local:')) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { COURSES } = require('../data/courses') as typeof import('../data/courses');
      const c = COURSES.find(x => x.id === r.courseId!.slice('local:'.length));
      const rr = c ? parseFloat(c.rating) : NaN;
      const ss = c ? parseInt(c.slope, 10) : NaN;
      if (Number.isFinite(rr) && rr > 0) rating = posted === 9 ? Math.round((rr / 2) * 10) / 10 : rr;
      if (Number.isFinite(ss) && ss > 0) slope = ss;
    }
  } catch { /* course data unavailable — par/neutral baseline */ }
  return { parTotal, rating, slope };
}

export function rebuildDifferentialsFromHistory(rounds: {
  startedAt: number;
  totalScore: number;
  holesPlayed: number;
  // 2026-07-24 (M3/M4) — WHS posting basis for a round played IN-APP (per-hole data available):
  //   handicapAgs   = Adjusted Gross Score (each hole capped at NET DOUBLE BOGEY, picked-up/unplayed
  //                   holes filled with NET PAR — the WHS "most likely score" convention).
  //   handicapHoles = the length it posts as (9 or 18), so a round where the player picked up on a
  //                   couple of holes still counts (filled to the intended length).
  // Imported/legacy rounds without per-hole data fall back to the raw total + exact 9/18 count.
  handicapAgs?: number;
  handicapHoles?: 9 | 18;
  // 2026-08-08 (Tim — "my last few 9-hole rounds dropped the index ~2 points, which is incorrect").
  // ROOT CAUSE: the differential baseline was a hardcoded neutral par-36 nine / par-72 eighteen
  // regardless of the course. At par-33 Berlin a 9-hole score read ~3 strokes BETTER than reality
  // every round — artificially-low differentials filled the best-8 and cratered the Index.
  //   parTotal     = REAL total par of the posted holes (round's holePars snapshot).
  //   rating/slope = the course's REAL rating/slope for the POSTED length when known (Berlin 9 =
  //                  62.4/2 = 31.2, slope 98). Baseline preference: real rating+slope → parTotal
  //                  (rating≈par, neutral slope) → the legacy neutral 36/72.
  parTotal?: number | null;
  rating?: number | null;
  slope?: number | null;
  // Full RoundRecords may be passed directly (the Recalculate buttons do) — when the explicit baseline
  // fields above are absent, it is DERIVED from these via postingBaseline, so every caller stays in
  // sync without changes.
  holePars?: Record<number, number> | null;
  scores?: Record<number, number> | null;
  courseId?: string | null;
}[]): number[] {
  const normalized = rounds.map(r => {
    const posted: 9 | 18 | null = r.handicapHoles ?? (r.holesPlayed === 9 ? 9 : r.holesPlayed === 18 ? 18 : null);
    const score = r.handicapAgs ?? r.totalScore;
    const derived = (r.rating == null && r.parTotal == null && (r.holePars || r.courseId))
      ? postingBaseline(r)
      : { parTotal: r.parTotal ?? null, rating: r.rating ?? null, slope: r.slope ?? null };
    const baseRating = (typeof derived.rating === 'number' && derived.rating > 0)
      ? derived.rating
      : (typeof derived.parTotal === 'number' && derived.parTotal > 0) ? derived.parTotal : null;
    const baseSlope = (typeof derived.slope === 'number' && derived.slope > 0) ? derived.slope : NEUTRAL_SLOPE;
    return { startedAt: r.startedAt, score, posted, baseRating, baseSlope };
  });
  const eligible = normalized
    .filter((r): r is { startedAt: number; score: number; posted: 9 | 18; baseRating: number | null; baseSlope: number } => r.posted != null && r.score > 0)
    // 2026-06-11 — Drop INCOMPLETE rounds (under MIN_STROKES_PER_HOLE / hole).
    // An abandoned round (e.g. an imported "4") would otherwise convert into a
    // wildly-negative differential that lands in the "best 8" and craters the
    // Index — the single biggest cause of a too-low imported Index.
    .filter(r => r.score >= MIN_STROKES_PER_HOLE * r.posted)
    .sort((a, b) => a.startedAt - b.startedAt);

  // 2026-06-11 — 9-hole rounds need an 18-hole-EQUIVALENT differential.
  // OLD: double the gross score (score×2 vs 72) — treats a strong nine as if
  // repeated, understating the differential and biasing the Index DOWN (a
  // good 39 became a near-scratch 78). NEW (WHS): played-9 differential + the
  // player's EXPECTED second nine (expectedNineDifferential, a function of the
  // Index). That's circular — the Index depends on the differentials — so we
  // iterate to a fixed point from a neutral seed (converges in 2–3 passes).
  let hi = 14;
  let diffs: number[] = [];
  for (let pass = 0; pass < 8; pass++) {
    diffs = eligible.map(r => postedDifferentialFor(r, hi));
    const est = estimateNewIndex(diffs);
    if (est.newIndex == null) break;
    const converged = Math.abs(est.newIndex - hi) < 0.05;
    hi = est.newIndex;
    if (converged) break;
  }
  return diffs.slice(-20);
}

/**
 * 2026-07-24 (M3/M4) — the WHS posting score for a round PLAYED IN-APP. Builds the full intended-length
 * hole set: each played hole capped at NET DOUBLE BOGEY, each picked-up/unplayed hole filled with NET PAR
 * (the accepted "most likely score" for a hole not completed). Returns the Adjusted Gross Score + the
 * length it posts as, or null when the round is too incomplete to post (below the WHS minimum: 7 of 9 /
 * 14 of 18) or the per-hole pars aren't known.
 *
 * courseHandicap drives the strokes-received (hence the net-par / net-double-bogey caps); pass a real
 * one when slope/rating are known, else the player's rounded Index is a fair recreational estimate.
 */
export function computeWhsPostingScore(input: {
  intendedHoles: 9 | 18;
  courseHandicap: number;
  pars: Record<number, number>;               // hole number → par (must cover 1..intendedHoles)
  scores: Record<number, number>;             // hole number → strokes (missing / 0 = picked up / not played)
  strokeIndexByHole?: Record<number, number>; // optional real HCP column; falls back to hole number
}): { adjustedGrossScore: number; postedHoles: 9 | 18; playedHoles: number } | null {
  const { intendedHoles, courseHandicap, pars, scores, strokeIndexByHole } = input;
  const POST_MIN = intendedHoles === 9 ? 7 : 14;
  // 2026-07-25 (deep audit) — a 9-hole round can be the BACK nine (holes 10–18). The loop assumed
  // 1..intendedHoles, so a back-nine round saw scores[1..9] all empty → played=0 → never posted to the
  // Index. Detect which nine was actually played from where the scores are, and iterate that range.
  let firstHole = 1;
  let lastHole = intendedHoles;
  if (intendedHoles === 9) {
    const scored = Object.keys(scores).map(Number).filter((h) => (scores[h] ?? 0) > 0);
    if (scored.length > 0 && scored.every((h) => h >= 10)) { firstHole = 10; lastHole = 18; }
  }
  let played = 0;
  let ags = 0;
  for (let hole = firstHole; hole <= lastHole; hole++) {
    const par = pars[hole];
    if (par == null || par <= 0) return null; // can't cap without a known par
    const strokeIdx = strokeIndexByHole?.[hole] ?? hole;
    const strokes = strokesReceivedOnHole(courseHandicap, strokeIdx);
    const netPar = par + strokes;                 // hole not completed → net par (most-likely)
    const netDoubleBogey = netDoubleBogeyCap(par, strokes);
    const actual = scores[hole] ?? 0;
    if (actual > 0) { played++; ags += Math.min(actual, netDoubleBogey); }
    else { ags += netPar; }
  }
  if (played < POST_MIN) return null; // too incomplete to post an honest score
  return { adjustedGrossScore: ags, postedHoles: intendedHoles, playedHoles: played };
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
