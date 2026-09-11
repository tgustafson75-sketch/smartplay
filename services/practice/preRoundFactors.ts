/**
 * WHAT ACTUALLY HELPS BEFORE A ROUND — BALLS, STRETCHING, BOTH, OR NEITHER.
 *
 * 2026-09-11 (Tim). "One of the questions I'm personally trying to answer is, I always feel like
 * sometimes if I hit a bucket, it's very mixed. If I hit a bucket pre-round it's very mixed on the
 * results and especially how I feel about it. But definitely some differences on whether I stretch
 * before I play, because I showed up just before, like most golfers like me will. I just really want
 * the dashboard to have one comprehensive set of data that shows how all these factors intertwine."
 *
 * ─── AND THIS IS WHY HE COULD NOT ANSWER IT ────────────────────────────────────────────────────
 *
 * Earlier today the dashboard's two warm-up cards were found to disagree — different events,
 * different windows, different anchors — and the fix merged them into ONE list of warm-up events. It
 * made them agree, and it FLATTENED the exact distinction he is asking about. A bucket and a stretch
 * both became "a warm-up", so "does hitting balls help me?" and "does stretching help me?" collapsed
 * into one question he never asked.
 *
 * One rule and one event list was right. Throwing away the KIND was not. They are kept apart here
 * and still share the window that morning gave them.
 *
 * ─── FOUR BUCKETS, NOT A SCORE ─────────────────────────────────────────────────────────────────
 *
 * Every round lands in exactly one of: neither, balls only, stretch only, both. That is a paired
 * comparison a golfer can act on — "the stretch is worth two shots, the bucket is a coin flip" — and
 * it is the honest shape, because "warmed up" was hiding two different behaviours with possibly
 * opposite effects.
 *
 * HONESTY BAR, same as its siblings: pure, synchronous, never throws, and SILENT until enough rounds
 * sit in the buckets being compared. Association, never causation — a golfer who stretched is often
 * also the one who arrived early enough to, and this cannot separate those.
 */
import { wasRoundWarmed, WARMUP_WINDOW_MS } from './warmupPerformance';

export type PreRoundKind = 'none' | 'balls' | 'stretch' | 'both';

export interface PreRoundBucket {
  kind: PreRoundKind;
  n: number;
  /** Mean score-vs-par. Null when the bucket is empty. */
  avgVsPar: number | null;
  /** What he SAID those rounds felt like, most common answer. His words, not a score. */
  topVibe: string | null;
}

export interface PreRoundFactors {
  buckets: PreRoundBucket[];
  /** False → say nothing. Not enough rounds in enough buckets to compare. */
  enough: boolean;
  /** The kind with the best average, once there is enough to say. */
  best: PreRoundKind | null;
  /** One answer-first line for the card. */
  headline: string;
  /** Short supporting lines, each a real comparison. */
  detail: string[];
}

export interface PreRoundRound {
  startedAt?: number | null;
  scoreVsPar?: number | null;
  postRoundFeelings?: { vibe?: string; energy?: string; focus?: string; weather?: string } | null;
}

export interface PreRoundInput {
  rounds: readonly PreRoundRound[];
  /** Start times of pre-round PRACTICE sessions — the bucket. */
  ballTimes: readonly number[];
  /** Completion times of pre-round STRETCH / warm-up workouts. */
  stretchTimes: readonly number[];
}

/** Rounds needed in a bucket before it is compared at all. */
const MIN_PER_BUCKET = 3;
/** Below this the buckets are the same — golf scores swing on nothing. */
const MEANINGFUL_STROKES = 1.0;

const LABEL: Record<PreRoundKind, string> = {
  none: 'straight to the tee',
  balls: 'a bucket only',
  stretch: 'a stretch only',
  both: 'a bucket and a stretch',
};

const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

function commonest(xs: string[]): string | null {
  if (xs.length === 0) return null;
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Which bucket a round falls in. The window is warmupPerformance's — one owner, shared. */
export function preRoundKindFor(
  roundStartedAt: number | null | undefined,
  ballTimes: readonly number[],
  stretchTimes: readonly number[],
  windowMs: number = WARMUP_WINDOW_MS,
): PreRoundKind {
  const balls = wasRoundWarmed(roundStartedAt, ballTimes, windowMs);
  const stretch = wasRoundWarmed(roundStartedAt, stretchTimes, windowMs);
  if (balls && stretch) return 'both';
  if (balls) return 'balls';
  if (stretch) return 'stretch';
  return 'none';
}

export function composePreRoundFactors(input: PreRoundInput): PreRoundFactors {
  const rounds = (input.rounds ?? []).filter(
    (r) => r && typeof r.startedAt === 'number' && typeof r.scoreVsPar === 'number' && Number.isFinite(r.scoreVsPar),
  );

  const byKind = new Map<PreRoundKind, { scores: number[]; vibes: string[] }>();
  for (const k of ['none', 'balls', 'stretch', 'both'] as PreRoundKind[]) byKind.set(k, { scores: [], vibes: [] });
  for (const r of rounds) {
    const k = preRoundKindFor(r.startedAt, input.ballTimes ?? [], input.stretchTimes ?? []);
    const b = byKind.get(k)!;
    b.scores.push(r.scoreVsPar as number);
    const v = r.postRoundFeelings?.vibe;
    if (typeof v === 'string' && v.trim()) b.vibes.push(v.trim());
  }

  const buckets: PreRoundBucket[] = (['both', 'balls', 'stretch', 'none'] as PreRoundKind[]).map((kind) => {
    const b = byKind.get(kind)!;
    return {
      kind, n: b.scores.length,
      avgVsPar: b.scores.length ? avg(b.scores) : null,
      topVibe: commonest(b.vibes),
    };
  });

  const usable = buckets.filter((b) => b.n >= MIN_PER_BUCKET && b.avgVsPar != null);
  if (usable.length < 2) {
    return {
      buckets, enough: false, best: null,
      // Says what is missing, so it reads as "keep going" rather than "nothing here".
      headline: 'Keep logging — a few more rounds and this will show what actually helps you.',
      detail: [],
    };
  }

  const sorted = [...usable].sort((a, b) => (a.avgVsPar as number) - (b.avgVsPar as number));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const spread = Math.round(((worst.avgVsPar as number) - (best.avgVsPar as number)) * 10) / 10;

  /**
   * The detail lines are the answer to his actual question, and each is a PAIR — this kind against
   * that one. A list of averages is a table; a pair is a finding.
   */
  const detail: string[] = [];
  for (const b of sorted) {
    const vibe = b.topVibe ? `, and you mostly called those rounds "${b.topVibe.toLowerCase()}"` : '';
    detail.push(`${LABEL[b.kind]}: ${b.avgVsPar} over, ${b.n} round${b.n === 1 ? '' : 's'}${vibe}`);
  }

  const headline = spread < MEANINGFUL_STROKES
    ? `No real difference yet — ${usable.map((b) => LABEL[b.kind]).join(' and ')} are scoring within a stroke of each other.`
    : `Your best rounds come after ${LABEL[best.kind]} — ${spread} strokes better than ${LABEL[worst.kind]}.`;

  return { buckets, enough: true, best: spread < MEANINGFUL_STROKES ? null : best.kind, headline, detail };
}
