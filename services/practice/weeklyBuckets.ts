/**
 * 2026-09-11 (full-app audit) — ONE OWNER OF "WHICH WEEK DID THIS HAPPEN IN".
 *
 * Tim asked for one graph that shows how practice, warm-ups and scoring intertwine, and for it to
 * have a timeline. It had both — and the two lines on it were plotted against DIFFERENT TIME BASES.
 * The effort line was six weekly buckets; the score line was the last eight ROUNDS, whenever those
 * happened. TrendChart stretches each series across the same width, so point `i` of one was not the
 * same moment as point `i` of the other, and the axis label was derived from the ROUND count while
 * being written in weeks.
 *
 * Measured rather than argued: a player with eight rounds inside seven days and practice going back
 * six weeks got an axis reading "7 weeks ago → this week" — wrong for the practice line (6 weeks)
 * and wrong for the score line (1 week), on the one chart whose entire job is letting you read the
 * two against each other. That is the Arccos problem Tim described, reproduced in our own app.
 *
 * So the score goes on the SAME weekly buckets as the effort, and a week with no round is `null`
 * rather than a fabricated zero — a zero on a vs-par axis means "level par", which is the opposite
 * of "did not play". [[illustration-data-points]] [[two-owners-is-the-root-cause]]
 *
 * The three progress sources each declared their own identical WEEKS / WEEK_MS / ROUNDS. They now
 * import them, so the buckets cannot drift apart between the cards on one screen.
 */

/** How many weekly buckets every progress chart shows. */
export const WEEKS = 6;
/** How many recent rounds the trend maths reads (NOT the chart's x-axis). */
export const ROUNDS = 8;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Newest bucket is last. Returns null when the timestamp falls outside the window. */
export function weekIndexFor(ts: number, nowMs: number, weeks = WEEKS): number | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  const ageWeeks = Math.floor((nowMs - ts) / WEEK_MS);
  if (ageWeeks < 0 || ageWeeks >= weeks) return null;
  return weeks - 1 - ageWeeks;
}

export interface WeeklyScoreRound {
  endedAt?: number;
  startedAt?: number;
  scoreVsPar?: number | null;
}

/**
 * Average score-vs-par per weekly bucket, oldest→newest, `null` for a week with no round.
 *
 * Averaged rather than "last round of the week" so a week he played three times is represented by
 * how he actually scored that week, which is the quantity the practice line is being compared to.
 */
export function weeklyScoreSeries(
  rounds: WeeklyScoreRound[] | null | undefined,
  nowMs: number,
  weeks = WEEKS,
): (number | null)[] {
  const sums = new Array(weeks).fill(0) as number[];
  const counts = new Array(weeks).fill(0) as number[];
  for (const r of rounds ?? []) {
    if (typeof r?.scoreVsPar !== 'number' || !Number.isFinite(r.scoreVsPar)) continue;
    const ts = typeof r.endedAt === 'number' ? r.endedAt : r.startedAt;
    if (typeof ts !== 'number') continue;
    const i = weekIndexFor(ts, nowMs, weeks);
    if (i == null) continue;
    sums[i] += r.scoreVsPar;
    counts[i] += 1;
  }
  return sums.map((s, i) => (counts[i] > 0 ? Math.round((s / counts[i]) * 10) / 10 : null));
}

/** How many of the weekly buckets actually carry a round — the honest "is there a line to draw". */
export function weeksWithData(series: (number | null)[]): number {
  return series.filter((v) => v != null).length;
}
