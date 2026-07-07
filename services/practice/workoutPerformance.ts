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
  /** 'minutes' when most workouts had a duration, else 'sessions'. */
  metric: 'minutes' | 'sessions';
  totalWorkouts: number;
  totalMinutes: number;
  roundsCounted: number;
  /** Enough on BOTH sides to say anything honest. */
  hasEnough: boolean;
  headline: string;
}

const WEEKS = 6;
const ROUNDS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_WORKOUTS = 3;
const MIN_ROUNDS = 4;
/** Per-session fallback weight when a workout has no stated duration (assumed ~45 min). */
const ASSUMED_SESSION_MIN = 45;

export function computeWorkoutPerformance(input: WorkoutPerformanceInput): WorkoutPerformance {
  const { workouts, rounds, nowMs } = input;

  const valid = (workouts ?? []).filter((w) => typeof w.date === 'number' && Number.isFinite(w.date));
  const withDuration = valid.filter((w) => typeof w.durationMin === 'number' && w.durationMin! > 0).length;
  // Use minutes only when we actually have durations for most of the workouts —
  // otherwise a couple of stray durations would skew a mostly-count series.
  const metric: 'minutes' | 'sessions' = valid.length > 0 && withDuration >= Math.ceil(valid.length / 2) ? 'minutes' : 'sessions';

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

  const roundsCounted = scoreSeries.length;
  const hasEnough = totalWorkouts >= MIN_WORKOUTS && roundsCounted >= MIN_ROUNDS;

  let headline: string;
  if (!hasEnough) {
    headline = 'Import your SmartPump golf workouts and log a few rounds — once there\'s enough, I\'ll show whether your training tracks your scoring.';
  } else {
    const firstHalf = workoutSeries.slice(0, Math.ceil(WEEKS / 2)).reduce((a, b) => a + b, 0);
    const lastHalf = workoutSeries.slice(Math.ceil(WEEKS / 2)).reduce((a, b) => a + b, 0);
    const trainingUp = lastHalf > firstHalf;
    const half = Math.ceil(scoreSeries.length / 2);
    const earlyAvg = scoreSeries.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const lateAvg = scoreSeries.slice(half).reduce((a, b) => a + b, 0) / (scoreSeries.length - half);
    const scoreImproving = lateAvg < earlyAvg - 0.5; // lower vs-par = better
    const scoreWorse = lateAvg > earlyAvg + 0.5;

    if (trainingUp && scoreImproving) headline = 'Your training volume is up and your scores are trending down — the work off the course is showing up on it.';
    else if (trainingUp && scoreWorse) headline = 'Training volume is up but scores ticked the wrong way — give the strength gains time to transfer to the swing.';
    else if (trainingUp) headline = 'Training volume is up; scores are holding — keep building the engine.';
    else if (scoreImproving) headline = 'Scores are trending down — nice. Steadier training would help hold the gains.';
    else headline = 'Steady stretch — a bump in golf-specific training tends to move the scoring line over time.';
  }

  return { workoutSeries, scoreSeries, metric, totalWorkouts, totalMinutes, roundsCounted, hasEnough, headline };
}
