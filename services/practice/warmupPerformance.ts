/**
 * 2026-08-12 (Tim — "I asked multiple times to tie in exercise tracking and warm ups pre round to
 * performance metrics").
 *
 * The training-volume rail (workoutPerformance.ts) asks a WEEKLY question: does gym volume track the
 * scoring line over time. A warm-up asks a sharper one, and it's the one a golfer actually feels:
 *
 *   did I score better on the rounds I warmed up for than the ones I walked straight onto the tee?
 *
 * That's a paired comparison, not a correlation, and it's honest in a way a trend line isn't — every
 * round lands in exactly one bucket, and the answer is in strokes, the only unit that matters.
 *
 * HONESTY BAR, same as its siblings ([[points-practice-correlation]]):
 *   - pure, synchronous, never throws
 *   - stays QUIET until there are enough rounds on BOTH sides; a 1-round "improvement" is noise
 *   - describes ASSOCIATION, never causation. A golfer who warms up is often also the golfer who
 *     slept well and cared more that day, and this can't separate those. The copy says "on the
 *     rounds you warmed up", never "warming up lowered your score".
 */

/**
 * How long before the first tee a warm-up still counts as belonging to that round.
 *
 * 2026-09-11 — THE ONE OWNER. services/practice/practiceImpact declared its own copy at FOUR hours
 * and anchored it on the warm-up's START rather than its completion, so the same round could be
 * "warmed" in one dashboard card and "cold" in the other — and both cards render on the SAME screen,
 * both phrased to the player as "when you warm up". [[two-owners-is-the-root-cause]]
 */
export const WARMUP_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Did a warm-up belong to this round? The single answer, for every surface that asks.
 *
 * A warm-up logged AFTER the round started belongs to no round — counting it would let a mid-round
 * tap rewrite history. Times are warm-up events (a pre-round practice session or a pre-round
 * workout); the two record slightly different instants and that imprecision is real and stated
 * rather than papered over, but it must at least be the SAME imprecision everywhere.
 */
export function wasRoundWarmed(
  roundStartedAt: number | null | undefined,
  warmupTimes: readonly number[],
  windowMs: number = WARMUP_WINDOW_MS,
): boolean {
  if (typeof roundStartedAt !== 'number' || !Number.isFinite(roundStartedAt)) return false;
  return warmupTimes.some((t) => typeof t === 'number' && t <= roundStartedAt && roundStartedAt - t <= windowMs);
}

/** Rounds needed on EACH side before we'll show a comparison at all. */
const MIN_ROUNDS_PER_SIDE = 3;

export interface WarmupPerformanceInput {
  /** Completion timestamps of pre-round warm-ups. */
  warmups: { completedAt: number }[];
  /** Completed rounds. scoreVsPar null = no known par; excluded rather than guessed. */
  rounds: { startedAt: number; scoreVsPar: number | null }[];
}

export interface WarmupPerformance {
  /** False → say nothing. Not enough evidence on one or both sides. */
  enough: boolean;
  withCount: number;
  withoutCount: number;
  /** Mean score-vs-par for each bucket (lower is better). Null until `enough`. */
  withAvg: number | null;
  withoutAvg: number | null;
  /** Strokes better when warmed up. Positive = warmed-up rounds scored lower. Null until `enough`. */
  deltaStrokes: number | null;
  /** One honest sentence, or null when there's nothing to say yet. */
  headline: string | null;
}

const NOT_ENOUGH = (withCount: number, withoutCount: number): WarmupPerformance => ({
  enough: false, withCount, withoutCount, withAvg: null, withoutAvg: null, deltaStrokes: null, headline: null,
});

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function computeWarmupPerformance(input: WarmupPerformanceInput): WarmupPerformance {
  const warmups = (input.warmups ?? [])
    .map(w => w.completedAt)
    .filter(t => typeof t === 'number' && Number.isFinite(t))
    .sort((a, b) => a - b);

  // A round with no known par can't contribute a vs-par number. Dropping it is the honest move;
  // treating a missing par as level would quietly pull both averages toward zero.
  const rounds = (input.rounds ?? []).filter(
    r => typeof r.startedAt === 'number' && Number.isFinite(r.startedAt) && typeof r.scoreVsPar === 'number',
  ) as { startedAt: number; scoreVsPar: number }[];

  const withWarmup: number[] = [];
  const withoutWarmup: number[] = [];
  for (const r of rounds) {
    // Warmed up = a completion in the window BEFORE the first tee. A warm-up logged after the round
    // started belongs to no round; counting it would let a mid-round tap rewrite history.
    const warmed = wasRoundWarmed(r.startedAt, warmups);
    (warmed ? withWarmup : withoutWarmup).push(r.scoreVsPar);
  }

  if (withWarmup.length < MIN_ROUNDS_PER_SIDE || withoutWarmup.length < MIN_ROUNDS_PER_SIDE) {
    return NOT_ENOUGH(withWarmup.length, withoutWarmup.length);
  }

  const withAvg = mean(withWarmup);
  const withoutAvg = mean(withoutWarmup);
  // Lower vs-par is better, so a POSITIVE delta means the warmed-up rounds scored better.
  const deltaStrokes = withoutAvg - withAvg;
  const abs = Math.abs(deltaStrokes);
  const rounded = Math.round(abs * 10) / 10;

  // Under a tenth of a stroke isn't a finding, it's rounding. Say so plainly rather than dressing
  // up noise as a result.
  const headline =
    rounded < 0.1
      ? `No scoring difference yet between your warmed-up and cold rounds (${withWarmup.length} vs ${withoutWarmup.length}).`
      : deltaStrokes > 0
        ? `You average ${rounded} strokes better on the rounds you warm up for (${withWarmup.length} warmed up, ${withoutWarmup.length} not).`
        : `Your cold rounds are averaging ${rounded} strokes better so far (${withWarmup.length} warmed up, ${withoutWarmup.length} not) — worth a few more rounds before reading anything into it.`;

  return {
    enough: true,
    withCount: withWarmup.length,
    withoutCount: withoutWarmup.length,
    withAvg: Math.round(withAvg * 10) / 10,
    withoutAvg: Math.round(withoutAvg * 10) / 10,
    deltaStrokes: Math.round(deltaStrokes * 10) / 10,
    headline,
  };
}
