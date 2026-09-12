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

/**
 * 2026-09-12 (Tim) — "do the putting baseline, it's kind of fundamental to smart strategy."
 *
 * Until now a player with fewer than nine recorded holes got NEUTRAL: a flat two-putt assumption and
 * no lean, identical for a scratch player and a 30-handicap. That is not neutrality, it is a guess
 * that happens to be wrong for most people — and it is the same cold-start wall the club distances
 * already solved by baselining off the industry table scaled by handicap.
 *
 * EXPECTED PUTTING BY HANDICAP, from published shot-tracking datasets. Both relationships are close
 * to linear across the amateur range:
 *
 *     putts per round   ≈ 29.5 + 0.20 × index      (scratch ≈ 29.5, 18 ≈ 33.1, 30 ≈ 35.5)
 *     three-putt rate   ≈ 0.03 + 0.005 × index     (scratch ≈ 3%, 18 ≈ 12%, 30 ≈ 18%)
 *
 * HONEST ABOUT WHAT THIS IS. It is an expectation, not a measurement, and it is labelled
 * `confidence: 'baseline'` so nothing downstream can mistake it. It deliberately runs through the
 * SAME lean thresholds as measured data rather than getting its own softer ones — which means it
 * only moves the strategy at the extremes (a genuinely good putter, or a player whose expected
 * three-putt rate is already costly). An assumption SHOULD move the plan less than evidence does.
 * [[illustration-data-points]]
 */
export function baselinePuttingFromHandicap(
  handicapIndex: number | null | undefined,
): { puttsPerHole: number; threePuttRate: number } | null {
  if (handicapIndex == null || !Number.isFinite(handicapIndex)) return null;
  // Plus-handicaps putt like scratch for this purpose; 36 is the practical ceiling of the fit.
  const h = Math.max(0, Math.min(36, handicapIndex));
  return {
    puttsPerHole: (29.5 + 0.2 * h) / 18,
    threePuttRate: 0.03 + 0.005 * h,
  };
}

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
  /**
   * 'baseline' = derived from their handicap with no putts recorded yet. A real expectation, and
   * explicitly not a measurement — kept distinct from 'forming' (some of their own putts, not yet
   * enough) so a caller can never read an assumption as evidence.
   */
  confidence: 'none' | 'baseline' | 'forming' | 'measured';
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
export function composePuttingRead(
  holes: PuttHole[],
  opts?: { handicapIndex?: number | null },
): PuttingRead {
  const rows = (Array.isArray(holes) ? holes : []).filter(
    (h) => h && typeof h.putts === 'number' && Number.isFinite(h.putts) && h.putts > 0,
  ) as { par: number | null; putts: number }[];
  const n = rows.length;
  const baseline = baselinePuttingFromHandicap(opts?.handicapIndex);

  // No putts of his own, but we know his handicap — an expectation beats a flat two for everyone.
  if (n === 0) {
    if (!baseline) return NEUTRAL;
    return finishRead({
      holes: 0,
      puttsPerHole: baseline.puttsPerHole,
      three: baseline.threePuttRate,
      one: null,
      confidence: 'baseline',
      baseline,
    });
  }

  const total = rows.reduce((a, h) => a + h.putts, 0);
  const observedPerHole = total / n;
  const observedThree = rows.filter((h) => h.putts >= 3).length / n;
  const one = rows.filter((h) => h.putts === 1).length / n;
  const confidence: PuttingRead['confidence'] = n >= MIN_PUTT_HOLES ? 'measured' : 'forming';

  /**
   * BELOW THE BAR, HIS OWN PUTTS AND THE EXPECTATION ARE BLENDED, weighted by how many holes he has
   * actually given us. Three holes of putting is real information and should count for something —
   * but a single bad green should not swing the plan, and a hard switch at hole nine would lurch the
   * strategy on a stroke that told us nothing new. The weight reaches 1 exactly at MIN_PUTT_HOLES,
   * where the blend becomes his own record and the baseline drops out entirely.
   */
  const w = confidence === 'measured' ? 1 : Math.min(1, n / MIN_PUTT_HOLES);
  const puttsPerHole = baseline ? observedPerHole * w + baseline.puttsPerHole * (1 - w) : observedPerHole;
  const three = baseline ? observedThree * w + baseline.threePuttRate * (1 - w) : observedThree;

  return finishRead({ holes: n, puttsPerHole, three, one, confidence, baseline });
}

/**
 * ONE place that turns a putts-per-hole and a three-putt rate into a budget, a lean and a line —
 * whether those numbers came from his own putts, from his handicap, or from a blend of both.
 *
 * Split out on 2026-09-12 so the baseline could not quietly acquire its own softer thresholds. The
 * lean rules below are the SAME ones measured data goes through; an assumption earns no special
 * treatment, which is why a baseline only moves the strategy at the extremes.
 */
function finishRead(args: {
  holes: number;
  puttsPerHole: number;
  three: number;
  one: number | null;
  confidence: PuttingRead['confidence'];
  /** The handicap expectation, kept separate so a THIN sample cannot drive the lean. */
  baseline?: { puttsPerHole: number; threePuttRate: number } | null;
}): PuttingRead {
  const { holes: n, puttsPerHole, three, one, confidence } = args;

  /**
   * THE BUDGET IS ROUNDED, AND IT ROUNDS TOWARDS TWO.
   *
   * A 2.4 average does not mean "assume three" — most of his holes are still two-putts and a plan
   * built on three would quietly concede a shot on every green. Three is only assumed when the
   * average genuinely sits nearer three than two, which is a man in real trouble on the greens and
   * who deserves to be told the plan is a bogey plan rather than sold a par.
   *
   * 2026-09-12 — a BASELINE never moves this. Expected putting spans about 1.64 to 2.04 across the
   * whole handicap range, and every one of those rounds to two, so the budget was never the place a
   * handicap baseline could help. Saying so here stops someone "fixing" it with a fractional budget
   * the plan would only round away again (holePlan does Math.round on it).
   */
  const assumedPutts = confidence !== 'measured'
    ? 2
    : Math.min(3, Math.max(1, Math.round(puttsPerHole)));

  /**
   * WHAT THE LEAN IS ALLOWED TO COME FROM, and the distinction is the whole of this design.
   *
   * A THIN SAMPLE NEVER DRIVES IT. Four holes of three-putts is noise, and the original rule —
   * "the plan keeps neutral rather than swinging a player's whole strategy off a bad front nine" —
   * is right. Blending does not make four holes less noisy, so the blended average is reported as
   * the best NUMBER while the strategy holds.
   *
   * A HANDICAP EXPECTATION IS NOT A THIN SAMPLE. It is a population figure and is far more stable
   * than four holes of anybody's putting, so it is allowed to lean — which is what stops a
   * 30-handicap getting a proximity plan on hole zero, losing it on hole one, and getting it back on
   * hole nine. The basis only switches to his own record once there is enough of it to be measured.
   */
  const leanBasis = confidence === 'measured'
    ? { puttsPerHole, threePuttRate: three }
    : (args.baseline ?? null);

  const lean: PuttingLean = !leanBasis
    ? 'neutral'
    : (leanBasis.puttsPerHole >= POOR_PUTTS_PER_HOLE || leanBasis.threePuttRate >= COSTLY_THREE_PUTT_RATE)
        ? 'proximity'
        : (leanBasis.puttsPerHole <= GOOD_PUTTS_PER_HOLE && leanBasis.threePuttRate <= 0.06)
            ? 'aggressive'
            : 'neutral';

  const per18 = puttsPerHole * 18;
  const strategy = lean === 'proximity'
    ? ' — the strokes go from distance, so the plan gets you closer.'
    : lean === 'aggressive'
      ? ' — you two-putt from anywhere, so there is no need to pay a shot avoiding a long one.'
      : '.';

  /**
   * The line never claims a measurement it does not have. A baseline says out loud that it came from
   * the handicap and will be replaced; a blend says how many holes it has actually seen.
   */
  const line = confidence === 'measured'
    ? (lean === 'proximity'
        ? `${per18.toFixed(0)} putts a round, ${Math.round(three * 100)}% three-putts${strategy}`
        : `${per18.toFixed(0)} putts a round${strategy}`)
    : confidence === 'baseline'
      ? `Going off your handicap until I have watched you putt — about ${per18.toFixed(0)} a round${strategy}`
      : `${n} hole${n === 1 ? '' : 's'} of your putting so far, leaning on your handicap for the rest — about ${per18.toFixed(0)} a round${strategy}`;

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

    /**
     * 2026-09-12 — the handicap rides along so a player with no recorded putts still gets a real
     * expectation rather than a flat two. Read here, at the ONE live reader, so the plan, the
     * profile and the brain cannot end up holding three different answers.
     * [[two-owners-is-the-root-cause]]
     */
    const handicapIndex = (() => {
      try {
        const { usePlayerProfileStore } = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
        const h = usePlayerProfileStore.getState().handicap;
        return typeof h === 'number' && Number.isFinite(h) ? h : null;
      } catch { return null; }
    })();

    return composePuttingRead(rows, { handicapIndex });
  } catch {
    return NEUTRAL;
  }
}
