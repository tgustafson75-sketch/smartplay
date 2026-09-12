/**
 * 2026-09-11 (Tim) — "The hole planner needs to account for user putt stats in strategy."
 *
 * HOW HE PUTTS WAS CAPTURED AND NEVER USED BY THE PLAN.
 *
 * services/holePlan has had a `puttsAssumed` input since it was written, with a comment saying
 * "Two, unless the player's own record says otherwise". Nothing ever passed it. Every plan the app
 * has ever made — for every player, on every hole — assumed exactly two putts.
 *
 * That is not a rounding error, it is the difference between a plan and a wish. A player who takes
 * 36 putts a round is being told a par-4 is "there for par" off a budget he has never once met, and
 * a player who takes 29 is being planned for bogey on holes he birdies. The putt counts were in the
 * scorecard the whole time; the plan just never asked. [[sweep-the-missing-half-not-the-unused-export]]
 *
 * And it is not only the arithmetic. Putting decides STRATEGY:
 *   - A poor lag putter's strokes are lost from forty feet, so the plan should trade a longer
 *     approach for a shorter one and get him a club he can hit close with — proximity is the fix.
 *   - A good putter can take the middle of the green from distance and two-putt, so there is no
 *     reason to pay a stroke avoiding a long first putt.
 *
 * PURE / SYNC / OFFLINE-SAFE / never throws. `composePuttingRead` takes holes; `livePuttingRead`
 * reads the stores once so the plan, the profile and the brain can never hold three different
 * answers to "how does this man putt". [[two-owners-is-the-root-cause]]
 */

/** One hole's putting evidence. `putts` null means it was never recorded — NOT that he holed out. */
export interface PuttHole {
  par: number | null;
  putts: number | null;
}

/** Which way putting should push the strategy. */
export type PuttingLean = 'proximity' | 'neutral' | 'aggressive';

export interface PuttingRead {
  /** Holes with a real recorded putt count — the denominator for everything below. */
  holes: number;
  puttsPerHole: number | null;
  /** Per 18, the number golfers actually talk in. */
  puttsPerRound: number | null;
  /** Share of recorded holes that took three or more. */
  threePuttRate: number | null;
  /** Share that took exactly one — a made putt or a chip-in. */
  onePuttRate: number | null;
  /**
   * What a hole plan should budget. Bounded 1..3: no plan should ever assume four, and a plan that
   * assumes one is planning on holing out, which is not a plan.
   */
  assumedPutts: number;
  lean: PuttingLean;
  confidence: 'none' | 'forming' | 'measured';
  /** One line, or null when there is nothing honest to say yet. */
  line: string | null;
}

/**
 * Evidence bar. Nine holes of recorded putts is one nine and enough to stop assuming two; below it
 * the read stays 'forming' and the plan keeps the neutral two-putt budget rather than swinging a
 * player's whole strategy off a bad front nine. [[illustration-data-points]]
 */
export const MIN_PUTT_HOLES = 9;
/** Above this per hole, distance putting is costing real strokes. */
export const POOR_PUTTS_PER_HOLE = 2.15;
/** At or below this, he is getting the ball in the hole and can be planned aggressively. */
export const GOOD_PUTTS_PER_HOLE = 1.85;
/** Three-putting this often is a lag problem, whatever the average says. */
export const COSTLY_THREE_PUTT_RATE = 0.18;

const NEUTRAL: PuttingRead = {
  holes: 0, puttsPerHole: null, puttsPerRound: null, threePuttRate: null, onePuttRate: null,
  assumedPutts: 2, lean: 'neutral', confidence: 'none', line: null,
};

/**
 * Derive the putting read. A hole counts only when its putt count was actually recorded — an
 * unrecorded hole is silence, and counting it as zero would hand every casual scorer a tour
 * putting average.
 */
export function composePuttingRead(holes: PuttHole[]): PuttingRead {
  const rows = (Array.isArray(holes) ? holes : []).filter(
    (h) => h && typeof h.putts === 'number' && Number.isFinite(h.putts) && h.putts > 0,
  ) as { par: number | null; putts: number }[];
  const n = rows.length;
  if (n === 0) return NEUTRAL;

  const total = rows.reduce((a, h) => a + h.putts, 0);
  const puttsPerHole = total / n;
  const three = rows.filter((h) => h.putts >= 3).length / n;
  const one = rows.filter((h) => h.putts === 1).length / n;
  const confidence: PuttingRead['confidence'] = n >= MIN_PUTT_HOLES ? 'measured' : 'forming';

  /**
   * THE BUDGET IS ROUNDED, AND IT ROUNDS TOWARDS TWO.
   *
   * A 2.4 average does not mean "assume three" — most of his holes are still two-putts and a plan
   * built on three would quietly concede a shot on every green. Three is only assumed when the
   * average genuinely sits nearer three than two, which is a man in real trouble on the greens and
   * who deserves to be told the plan is a bogey plan rather than sold a par.
   */
  const assumedPutts = confidence !== 'measured'
    ? 2
    : Math.min(3, Math.max(1, Math.round(puttsPerHole)));

  const lean: PuttingLean = confidence !== 'measured'
    ? 'neutral'
    : (puttsPerHole >= POOR_PUTTS_PER_HOLE || three >= COSTLY_THREE_PUTT_RATE)
        ? 'proximity'
        : (puttsPerHole <= GOOD_PUTTS_PER_HOLE && three <= 0.06)
            ? 'aggressive'
            : 'neutral';

  const per18 = puttsPerHole * 18;
  const line = confidence === 'measured'
    ? (lean === 'proximity'
        ? `${per18.toFixed(0)} putts a round, ${Math.round(three * 100)}% three-putts — the strokes are going from distance, so the plan gets you closer.`
        : lean === 'aggressive'
          ? `${per18.toFixed(0)} putts a round — you two-putt from anywhere, so there is no need to pay a shot avoiding a long one.`
          : `${per18.toFixed(0)} putts a round.`)
    : `${n} hole${n === 1 ? '' : 's'} of putts recorded — not enough to plan off yet.`;

  return {
    holes: n,
    puttsPerHole,
    puttsPerRound: per18,
    threePuttRate: three,
    onePuttRate: one,
    assumedPutts,
    lean,
    confidence,
    line,
  };
}

/**
 * The read from live state: this round's holes first, then back through history until there is
 * enough to be measured. Recent rounds are what a caddie would go on, and putting moves — a man
 * who fixed his stroke in March should not be planned off January.
 *
 * Never throws; returns the neutral read on any failure, which is exactly what the plan assumed
 * before this existed.
 */
export function livePuttingRead(maxHoles = 90): PuttingRead {
  try {
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    const r = useRoundStore.getState();
    const rows: PuttHole[] = [];

    const parOf = (pars: Record<number, number> | undefined, hole: number): number | null => {
      const v = pars?.[hole];
      return typeof v === 'number' && v > 0 ? v : null;
    };

    // The round in progress, when there is one.
    for (const [holeStr, putts] of Object.entries(r.putts ?? {})) {
      const hole = Number(holeStr);
      const par = (r.courseHoles ?? []).find((h: { hole: number; par: number }) => h.hole === hole)?.par ?? null;
      rows.push({ par, putts: typeof putts === 'number' ? putts : null });
    }

    /**
     * Then history, newest first. Imports carry no putt data and sim rounds are narrated, so neither
     * is evidence about his stroke — the same exclusions bagRecommendation makes, for the same
     * reason: a number learned off a round he did not play is worse than no number.
     */
    const history = [...(r.roundHistory ?? [])]
      .filter((h) => !h.id?.startsWith('imported_') && !h.simulated)
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    for (const round of history) {
      if (rows.length >= maxHoles) break;
      for (const [holeStr, putts] of Object.entries(round.putts ?? {})) {
        if (rows.length >= maxHoles) break;
        rows.push({
          par: parOf(round.holePars, Number(holeStr)),
          putts: typeof putts === 'number' ? putts : null,
        });
      }
    }

    return composePuttingRead(rows);
  } catch {
    return NEUTRAL;
  }
}
