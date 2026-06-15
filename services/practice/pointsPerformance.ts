/**
 * 2026-06-15 (Tim — points from the swing library + the point/performance graph).
 *
 * The swing LIBRARY is full of practice that never earned points (only structured
 * drills/focus sessions did). This ESTIMATES points for those library sessions —
 * honestly labeled "estimated", using the SAME conservative scheme as the tracked
 * ledger (no inflation) — and pairs points-per-week against score-vs-par so you can
 * SEE practice vs performance. Pure / sync / offline-safe / never-throws.
 *
 * HONESTY (project rule): "estimated" because these sessions weren't tracked as
 * points-bearing practice at the time — we reconstruct a conservative figure from
 * the swing count. The graph describes ASSOCIATION, never causation, and stays
 * quiet until there's enough on both sides ([[points-practice-correlation]]).
 */

// Mirror practicePointsStore's conservative scheme so estimated == what a tracked
// session of the same size would have earned (BASE + 1/swing, capped at 5 swings).
const BASE_PER_SESSION = 5;
const PER_SWING = 1;
const MAX_SWINGS_COUNTED = 5;

/** Conservative points for a session of N swings — same math as the tracked ledger. */
export function estimateSessionPoints(swings: number): number {
  const counted = Math.max(0, Math.min(MAX_SWINGS_COUNTED, Math.round(swings || 0)));
  return BASE_PER_SESSION + counted * PER_SWING;
}

export interface PointsPerformanceInput {
  /** Practice sessions (e.g. swing-library captures): a time + a swing count. */
  sessions: { startedAt: number; swings: number }[];
  /** Completed rounds: an end time + score relative to par (lower = better). */
  rounds: { endedAt: number; scoreVsPar: number }[];
  nowMs: number;
  /** 2026-06-15 (Tim — "run live for now, re-estimate clean start later") — count
   *  only sessions on/after this baseline so the graph starts CLEAN and builds live.
   *  Omit/0 to count all-time (the future "re-estimate" path). */
  sinceMs?: number;
}

export interface PointsPerformance {
  /** Estimated practice POINTS per week, oldest→newest (last WEEKS weeks). */
  pointsSeries: number[];
  /** score-vs-par per round, oldest→newest (last ROUNDS rounds). */
  scoreSeries: number[];
  /** Total estimated points across the counted sessions. */
  totalEstimatedPoints: number;
  sessionsCounted: number;
  roundsCounted: number;
  /** Enough on BOTH sides to say anything honest. */
  hasEnough: boolean;
  headline: string;
}

const WEEKS = 6;
const ROUNDS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SESSIONS = 3;
const MIN_ROUNDS = 4;

export function computePointsPerformance(input: PointsPerformanceInput): PointsPerformance {
  const { sessions, rounds, nowMs, sinceMs = 0 } = input;

  const pointsSeries = new Array(WEEKS).fill(0) as number[];
  let totalEstimatedPoints = 0;
  let sessionsCounted = 0;
  for (const s of sessions ?? []) {
    if (typeof s.startedAt !== 'number') continue;
    if (s.startedAt < sinceMs) continue; // before the live baseline — clean start
    const pts = estimateSessionPoints(s.swings);
    totalEstimatedPoints += pts;
    sessionsCounted += 1;
    const ageWeeks = Math.floor((nowMs - s.startedAt) / WEEK_MS);
    if (ageWeeks < 0 || ageWeeks >= WEEKS) continue; // counts toward total, not the 6wk chart
    pointsSeries[WEEKS - 1 - ageWeeks] += pts;
  }

  const scoreSeries = (rounds ?? [])
    .filter((r) => typeof r.endedAt === 'number' && typeof r.scoreVsPar === 'number')
    .sort((a, b) => a.endedAt - b.endedAt)
    .slice(-ROUNDS)
    .map((r) => r.scoreVsPar);

  const roundsCounted = scoreSeries.length;
  const hasEnough = sessionsCounted >= MIN_SESSIONS && roundsCounted >= MIN_ROUNDS;

  let headline: string;
  if (!hasEnough) {
    headline = 'Keep practicing and logging rounds — once there\'s enough, I\'ll show how your points track your scoring.';
  } else {
    const firstHalf = pointsSeries.slice(0, Math.ceil(WEEKS / 2)).reduce((a, b) => a + b, 0);
    const lastHalf = pointsSeries.slice(Math.ceil(WEEKS / 2)).reduce((a, b) => a + b, 0);
    const pointsUp = lastHalf > firstHalf;
    const half = Math.ceil(scoreSeries.length / 2);
    const earlyAvg = scoreSeries.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const lateAvg = scoreSeries.slice(half).reduce((a, b) => a + b, 0) / (scoreSeries.length - half);
    const scoreImproving = lateAvg < earlyAvg - 0.5; // lower vs-par = better
    const scoreWorse = lateAvg > earlyAvg + 0.5;

    if (pointsUp && scoreImproving) headline = 'Your practice points are climbing and your scores are trending down — the work is showing up.';
    else if (pointsUp && scoreWorse) headline = 'Practice points are up but scores ticked the wrong way — give the reps time to transfer.';
    else if (pointsUp) headline = 'Practice points are up; scores are holding — keep stacking the work.';
    else if (scoreImproving) headline = 'Scores are trending down — nice. More practice points would help it stick.';
    else headline = 'Steady stretch — a bump in focused practice tends to move the scoring line.';
  }

  return { pointsSeries, scoreSeries, totalEstimatedPoints, sessionsCounted, roundsCounted, hasEnough, headline };
}
