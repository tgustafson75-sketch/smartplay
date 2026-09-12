/**
 * 2026-09-12 (Tim) — WHICH BALL ACTUALLY SCORES BETTER FOR YOU.
 *
 * "I've been actually using different balls and seeing different results. And so being able to say,
 *  listen, I'm gonna tee off here with a Chromesoft, and just ingest that data."
 *
 * `playerProfileStore.currentBall` has existed for a while, set by typing into a field on the
 * ball-fit screen. It is ONE global string with no history, and nothing read it — not even the
 * caddie. So the app could record which ball he was using and still could not answer the only
 * question worth asking about it.
 *
 * With the ball stamped on each RoundRecord, it can. This is deliberately a COMPARISON and not a
 * recommendation: ball choice is a real fitting question that services/cnsBallFitting already
 * answers from spin and speed. What this adds is the other half — what actually happened on the
 * card — which is the half a player trusts.
 *
 * THE HONESTY RULES, because this is the kind of number people repeat to their friends:
 *  - vs-par only, never raw total, or a nine-hole round makes a ball look brilliant.
 *  - a ball needs MIN_ROUNDS before it is reported at all, and the comparison needs two such balls.
 *  - the gap must clear MEANINGFUL_STROKES, because three rounds either way is noise and telling
 *    someone to switch balls on half a stroke is exactly the fake precision this app exists not to
 *    do. Under that we say they are level, which is usually the true answer.
 */
import type { RoundRecord } from '../store/roundStore';

/** Below this, one good round carries the whole average. */
export const MIN_ROUNDS_PER_BALL = 3;

/** Under this the difference is noise and we say so rather than picking a winner. */
export const MEANINGFUL_STROKES = 1.0;

export interface BallSplit {
  ball: string;
  rounds: number;
  avgVsPar: number;
}

export interface BallComparison {
  /** Every ball with enough rounds, best first. */
  splits: BallSplit[];
  /** The better ball, only when the gap is big enough to mean something. */
  better: BallSplit | null;
  /** Plain-language answer, ready to be spoken. Never fabricates a winner. */
  say: string;
}

/** Normalised so "chromesoft", "Chrome Soft" and "CHROMESOFT" are one ball. */
function key(ball: string): string {
  return ball.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Compare scoring by ball across tracked rounds.
 *
 * Only rounds with BOTH a stamped ball and a known scoreVsPar count — a round with no par data has
 * no comparable score, and including it as a zero would quietly favour whichever ball it used.
 */
export function compareBalls(history: RoundRecord[]): BallComparison {
  const buckets = new Map<string, { label: string; vsPar: number[] }>();

  for (const r of history) {
    const ball = (r.ball ?? '').trim();
    if (!ball) continue;
    if (r.scoreVsPar == null) continue;
    const k = key(ball);
    const bucket = buckets.get(k);
    if (bucket) bucket.vsPar.push(r.scoreVsPar);
    // Keep the first spelling seen as the label, so we echo his words back rather than a slug.
    else buckets.set(k, { label: ball, vsPar: [r.scoreVsPar] });
  }

  const splits: BallSplit[] = [...buckets.values()]
    .filter((b) => b.vsPar.length >= MIN_ROUNDS_PER_BALL)
    .map((b) => ({
      ball: b.label,
      rounds: b.vsPar.length,
      avgVsPar: Math.round((b.vsPar.reduce((a, v) => a + v, 0) / b.vsPar.length) * 10) / 10,
    }))
    .sort((a, b) => a.avgVsPar - b.avgVsPar);

  if (splits.length < 2) {
    const tracked = [...buckets.values()].length;
    return {
      splits,
      better: null,
      say: tracked === 0
        ? 'I have not got a ball recorded on any of your rounds yet. Tell me what you are playing on the first tee and I will start tracking it.'
        : `I need about ${MIN_ROUNDS_PER_BALL} rounds on each ball before I compare them. Keep telling me what you are playing.`,
    };
  }

  const [best, second] = splits;
  const gap = Math.round((second.avgVsPar - best.avgVsPar) * 10) / 10;

  if (gap < MEANINGFUL_STROKES) {
    return {
      splits,
      better: null,
      say: `Honestly, level. ${best.ball} is ${best.avgVsPar > 0 ? '+' : ''}${best.avgVsPar} and ${second.ball} is ${second.avgVsPar > 0 ? '+' : ''}${second.avgVsPar} — that is inside the noise. Play whichever you like the feel of.`,
    };
  }

  return {
    splits,
    better: best,
    say: `${best.ball}, by about ${gap} a round — ${best.avgVsPar > 0 ? '+' : ''}${best.avgVsPar} over ${best.rounds} rounds against ${second.avgVsPar > 0 ? '+' : ''}${second.avgVsPar} on the ${second.ball}.`,
  };
}
