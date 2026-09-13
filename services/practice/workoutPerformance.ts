/**
 * 2026-07-07 (Tim — SmartPump third rail: does training show up in scoring?).
 *
 * Pairs TRAINING VOLUME per week (from the imported SmartPump golf workouts) against
 * score-vs-par per round, so the dashboard can show whether the gym work tracks the
 * scoring line. Same shape + honesty bar as [[points-practice-correlation]]
 * (services/practice/pointsPerformance.ts): pure / sync / never-throws, stays quiet
 * until there's enough on BOTH sides, and describes ASSOCIATION, never causation.
 *
 * Volume metric = workout MINUTES per week when durations are known, else falls back
 * to a per-session weight so a duration-less export still charts honestly (count of
 * sessions). We surface which metric was used so the card can label it truthfully.
 */

import { effortScoreHeadline } from './effortScoreVerdict';

export interface WorkoutPerformanceInput {
  /** Imported workouts: a date + optional duration. */
  workouts: { date: number; durationMin: number | null }[];
  /** Completed rounds: an end time + score relative to par (lower = better). */
  rounds: { endedAt: number; scoreVsPar: number }[];
  nowMs: number;
}

export interface WorkoutPerformance {
  /** Training volume per week, oldest→newest (last WEEKS weeks). */
  workoutSeries: number[];
  /** score-vs-par per round, oldest→newest (last ROUNDS rounds). */
  scoreSeries: number[];
  /**
   * 2026-09-11 — the score on the SAME weekly buckets as the effort line, `null` for a week with no
   * round. This is what the CHART plots; `scoreSeries` above stays per-round for the trend maths.
   * Before this the two lines on one chart had different time bases and the axis was wrong for both.
   */
  scoreWeekly: (number | null)[];
  /** 'minutes' when most workouts had a duration, else 'sessions'. */
  metric: 'minutes' | 'sessions';
  /** True when the minutes total includes assumed-duration fills (so the UI shows "est."). */
  minutesEstimated: boolean;
  totalWorkouts: number;
  totalMinutes: number;
  roundsCounted: number;
  /** Enough on BOTH sides to say anything honest. */
  hasEnough: boolean;
  headline: string;
  /**
   * 2026-09-12 — the measured DIRECTION of each line, exported rather than left inside the headline
   * switch. `headline` is UI copy addressed to the player ("Your training volume is up…"); the caddie
   * needs the FACTS so he can say it in his own voice instead of reading the card back. Both now read
   * one computation, so the chart and the caddie cannot disagree about which way the lines go. Null
   * until `hasEnough`. Same shape and same reasoning as practiceImpact.connection.
   * [[two-owners-is-the-root-cause]]
   */
  connection: {
    trainingEarly: number;
    trainingLate: number;
    trainingUp: boolean;
    /** Mean score-vs-par, earlier half of the counted rounds vs later. Lower is better. */
    scoreEarlyAvg: number;
    scoreLateAvg: number;
    scoreImproving: boolean;
    scoreWorse: boolean;
  } | null;
}

// 2026-09-11 — WEEKS / ROUNDS / WEEK_MS were declared identically in three files. One owner now,
// so the cards the dashboard renders together cannot drift onto different buckets.
const { WEEKS, ROUNDS, WEEK_MS, weeklyScoreSeries } = require('./weeklyBuckets') as typeof import('./weeklyBuckets');
const MIN_WORKOUTS = 3;
const MIN_ROUNDS = 4;

/**
 * 2026-09-12 (Tim) — "we don't wanna just fall silent in any case. That is an unnatural response…
 * a new golf coach giving a first lesson lets the player swing so he can get a sense of it."
 *
 * THE FLOOR HAS TO BE VISIBLE OR SILENCE LOOKS BROKEN. These gates are honest — below them there is
 * nothing true to say — but returning nothing means the caddie says nothing, and a coach who goes
 * quiet when you ask him a straight question reads as broken, not as careful. Exported so the
 * caddie can say which of these he has and what would make the comparison real.
 */
export const TRAINING_FLOOR = { workouts: MIN_WORKOUTS, rounds: MIN_ROUNDS } as const;
/** Per-session fallback weight when a workout has no stated duration (assumed ~45 min). */
const ASSUMED_SESSION_MIN = 45;

export function computeWorkoutPerformance(input: WorkoutPerformanceInput): WorkoutPerformance {
  const { workouts, rounds, nowMs } = input;

  const valid = (workouts ?? []).filter((w) => typeof w.date === 'number' && Number.isFinite(w.date));
  const withDuration = valid.filter((w) => typeof w.durationMin === 'number' && w.durationMin! > 0).length;
  // Use minutes only when we actually have durations for most of the workouts —
  // otherwise a couple of stray durations would skew a mostly-count series.
  const metric: 'minutes' | 'sessions' = valid.length > 0 && withDuration >= Math.ceil(valid.length / 2) ? 'minutes' : 'sessions';
  // 2026-07-26 (deep audit S3) — when we show minutes, some workouts had no stated duration and got the
  // ASSUMED_SESSION_MIN fill, so the "Xh total" is partly estimated. Surface that so the UI can say "est."
  // instead of presenting a synthesized number as fact (illustration-honesty rule).
  const minutesEstimated = metric === 'minutes' && withDuration < valid.length;

  const workoutSeries = new Array(WEEKS).fill(0) as number[];
  let totalWorkouts = 0;
  let totalMinutes = 0;
  for (const w of valid) {
    totalWorkouts += 1;
    const mins = typeof w.durationMin === 'number' && w.durationMin > 0 ? w.durationMin : ASSUMED_SESSION_MIN;
    totalMinutes += mins;
    const ageWeeks = Math.floor((nowMs - w.date) / WEEK_MS);
    if (ageWeeks < 0 || ageWeeks >= WEEKS) continue; // counts toward totals, not the 6wk chart
    workoutSeries[WEEKS - 1 - ageWeeks] += metric === 'minutes' ? mins : 1;
  }

  const scoreSeries = (rounds ?? [])
    .filter((r) => typeof r.endedAt === 'number' && typeof r.scoreVsPar === 'number')
    .sort((a, b) => a.endedAt - b.endedAt)
    .slice(-ROUNDS)
    .map((r) => r.scoreVsPar);

  /**
   * 2026-09-11 — the score on the SAME weekly buckets the effort line uses, so one timeline is
   * true for both lines and point `i` of each is the same week. `null` for a week with no round;
   * a zero on a vs-par axis would read as level par, which is the opposite of "did not play".
   */
  const scoreWeekly = weeklyScoreSeries(rounds as never, nowMs, WEEKS);
  const roundsCounted = scoreSeries.length;
  const hasEnough = totalWorkouts >= MIN_WORKOUTS && roundsCounted >= MIN_ROUNDS;

  // Direction of each side, computed ONCE. The headline below and the caddie's context block in
  // services/caddieRequestBody both read this.
  let connection: WorkoutPerformance['connection'] = null;
  if (hasEnough) {
    const firstHalf = workoutSeries.slice(0, Math.ceil(WEEKS / 2)).reduce((a, b) => a + b, 0);
    const lastHalf = workoutSeries.slice(Math.ceil(WEEKS / 2)).reduce((a, b) => a + b, 0);
    const half = Math.ceil(scoreSeries.length / 2);
    const earlyAvg = scoreSeries.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const lateAvg = scoreSeries.slice(half).reduce((a, b) => a + b, 0) / (scoreSeries.length - half);
    connection = {
      trainingEarly: firstHalf,
      trainingLate: lastHalf,
      trainingUp: lastHalf > firstHalf,
      scoreEarlyAvg: Math.round(earlyAvg * 10) / 10,
      scoreLateAvg: Math.round(lateAvg * 10) / 10,
      scoreImproving: lateAvg < earlyAvg - 0.5, // lower vs-par = better
      scoreWorse: lateAvg > earlyAvg + 0.5,
    };
  }

  let headline: string;
  if (!connection) {
    headline = 'Import your SmartPump golf workouts and log a few rounds — once there\'s enough, I\'ll show whether your training tracks your scoring.';
  } else {
    // `trainingUp` stays on the exported `connection` (services/caddieRequestBody reads it), but the
    // headline no longer branches on it — effortScoreVerdict derives direction from the two halves.
    const { scoreImproving, scoreWorse } = connection;

    // 2026-09-13 — see services/practice/effortScoreVerdict. Third copy of the same missing branch.
    headline = effortScoreHeadline(
      { effortEarly: connection.trainingEarly, effortLate: connection.trainingLate, scoreImproving, scoreWorse },
      {
        subject: 'Your training volume',
        noun: 'golf-specific training',
        unit: metric === 'minutes' ? 'min' : 'workouts',
        holdAdvice: 'keep building the engine',
        transferNote: 'give the strength gains time to transfer to the swing',
      },
    );
  }

  return { workoutSeries, scoreSeries, scoreWeekly, metric, totalWorkouts, totalMinutes, minutesEstimated, roundsCounted, hasEnough, headline, connection };
}
