/**
 * 2026-06-14 (Tim — points phase 3) — practice → course "connection".
 *
 * The honest correlation: pair PRACTICE VOLUME (balls per recent week) against
 * SCORING (score-vs-par per recent round) so the user can SEE whether practice is
 * showing up on the course. Pure / sync / offline-safe / never-throws (cnsShotRead
 * discipline) — callers pass plain arrays so it's trivially testable and has no store
 * deps.
 *
 * HONESTY (project rule): this describes ASSOCIATION, never claims causation, and
 * refuses to assert a connection until there's enough data on BOTH sides. Lower
 * score-vs-par = better; more practice = more. We only say "it's showing up" when
 * practice is up AND scores are genuinely trending down.
 */

export interface PracticeImpactInput {
  /** Practice sessions with a start time + a ball/swing count. */
  sessions: { startedAt: number; balls: number }[];
  /** Completed rounds with an end time + score relative to par. `startedAt` (optional) lets the warm-up
   *  correlation pair a round to a warm-up that ran just before it. */
  rounds: { endedAt: number; scoreVsPar: number; startedAt?: number }[];
  /** Clock injected for testability (defaults to now at the call site). */
  nowMs: number;
  /** 2026-08-06 (Tim — "show when the user warmed up before a round or practice as a data point on the
   *  graph"). Warm-up / pre-round stretch sessions (startedAt only). Bucketed into the same weekly buckets
   *  as practiceSeries and surfaced as `warmupWeekIndices` so the chart can mark those weeks. */
  warmups?: { startedAt: number }[];
}

export interface PracticeImpact {
  /** Balls practiced per week, oldest→newest (last WEEKS weeks). */
  practiceSeries: number[];
  /** score-vs-par per round, oldest→newest (last ROUNDS rounds). */
  scoreSeries: number[];
  /** Indices into practiceSeries (0 = oldest week) that had ≥1 warm-up/pre-round session — the chart marks
   *  these on the practice line so warm-ups read as real data points. */
  warmupWeekIndices: number[];
  /** 2026-08-06 (Tim — "track stretching, warmup... as metrics to judge progress"). Warmed-vs-cold scoring
   *  split: rounds that had a warm-up in the ~4h before them vs those that didn't. Null until there are ≥2
   *  rounds in BOTH cohorts (honest — no claim from one round). deltaStrokes>0 = warming up scores better. */
  warmupOutcome: { warmedAvg: number; coldAvg: number; warmedCount: number; coldCount: number; deltaStrokes: number } | null;
  practiceSessions: number;
  roundsCounted: number;
  /** True once there's enough on both sides to say anything honest. */
  hasEnough: boolean;
  headline: string;
}

const WEEKS = 6;
const ROUNDS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SESSIONS = 3;
const MIN_ROUNDS = 4;

export function computePracticeImpact(input: PracticeImpactInput): PracticeImpact {
  const { sessions, rounds, nowMs } = input;

  // Practice balls bucketed into the last WEEKS weekly buckets (oldest→newest).
  const practiceSeries = new Array(WEEKS).fill(0) as number[];
  let practiceSessions = 0;
  for (const s of sessions ?? []) {
    if (typeof s.startedAt !== 'number') continue;
    const ageWeeks = Math.floor((nowMs - s.startedAt) / WEEK_MS);
    if (ageWeeks < 0 || ageWeeks >= WEEKS) continue;
    practiceSeries[WEEKS - 1 - ageWeeks] += Math.max(0, s.balls || 0);
    practiceSessions += 1;
  }

  // 2026-08-06 (Tim) — which weekly buckets contained a warm-up / pre-round session (same bucketing as
  // practiceSeries). Surfaced so the practice line can mark those weeks.
  const warmupWeeks = new Set<number>();
  for (const w of input.warmups ?? []) {
    if (typeof w.startedAt !== 'number') continue;
    const ageWeeks = Math.floor((nowMs - w.startedAt) / WEEK_MS);
    if (ageWeeks < 0 || ageWeeks >= WEEKS) continue;
    warmupWeeks.add(WEEKS - 1 - ageWeeks);
  }
  const warmupWeekIndices = [...warmupWeeks].sort((a, b) => a - b);

  // 2026-08-06 (Tim) — warmed-vs-cold scoring split. A round is "warmed" if a warm-up session STARTED within
  // the 4h before the round's own start. Honest: only reported when there are ≥2 rounds in BOTH cohorts.
  const WARMUP_WINDOW_MS = 4 * 60 * 60 * 1000;
  const warmupStarts = (input.warmups ?? []).map((w) => w.startedAt).filter((t): t is number => typeof t === 'number');
  const warmed: number[] = [];
  const cold: number[] = [];
  for (const r of rounds ?? []) {
    if (typeof r.scoreVsPar !== 'number') continue;
    const rStart = typeof r.startedAt === 'number' ? r.startedAt : r.endedAt;
    if (typeof rStart !== 'number') continue;
    const wasWarmed = warmupStarts.some((w) => w <= rStart && rStart - w <= WARMUP_WINDOW_MS);
    (wasWarmed ? warmed : cold).push(r.scoreVsPar);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const warmupOutcome = warmed.length >= 2 && cold.length >= 2
    ? { warmedAvg: Math.round(avg(warmed) * 10) / 10, coldAvg: Math.round(avg(cold) * 10) / 10, warmedCount: warmed.length, coldCount: cold.length, deltaStrokes: Math.round((avg(cold) - avg(warmed)) * 10) / 10 }
    : null;

  // Last ROUNDS rounds' score-vs-par, chronological (oldest→newest).
  const scoreSeries = (rounds ?? [])
    .filter((r) => typeof r.endedAt === 'number' && typeof r.scoreVsPar === 'number')
    .sort((a, b) => a.endedAt - b.endedAt)
    .slice(-ROUNDS)
    .map((r) => r.scoreVsPar);

  const roundsCounted = scoreSeries.length;
  const hasEnough = practiceSessions >= MIN_SESSIONS && roundsCounted >= MIN_ROUNDS;

  let headline: string;
  if (!hasEnough) {
    headline = 'Keep logging practice and rounds — I\'ll show how they connect once there\'s enough.';
  } else {
    // Direction of each side (honest, descriptive).
    const firstHalfP = practiceSeries.slice(0, Math.ceil(WEEKS / 2)).reduce((a, b) => a + b, 0);
    const lastHalfP = practiceSeries.slice(Math.ceil(WEEKS / 2)).reduce((a, b) => a + b, 0);
    const practiceUp = lastHalfP > firstHalfP;
    const half = Math.ceil(scoreSeries.length / 2);
    const earlyAvg = scoreSeries.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const lateAvg = scoreSeries.slice(half).reduce((a, b) => a + b, 0) / (scoreSeries.length - half);
    const scoreImproving = lateAvg < earlyAvg - 0.5; // lower vs-par is better, with a small deadband
    const scoreWorse = lateAvg > earlyAvg + 0.5;

    if (practiceUp && scoreImproving) {
      headline = 'Your practice is up and your scores are trending down — it\'s showing up on the course.';
    } else if (practiceUp && scoreWorse) {
      headline = 'Practice is up but scores ticked the wrong way — give the work time to transfer.';
    } else if (practiceUp) {
      headline = 'Practice is up; scores are holding steady — keep stacking the reps.';
    } else if (scoreImproving) {
      headline = 'Scores are trending down — nice. More practice volume would help it stick.';
    } else {
      headline = 'Steady stretch — a bump in focused practice tends to move the scoring line.';
    }
  }

  return { practiceSeries, scoreSeries, warmupWeekIndices, warmupOutcome, practiceSessions, roundsCounted, hasEnough, headline };
}
