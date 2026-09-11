/**
 * IT ASKED HOW IT FELT AND NEVER USED THE ANSWER.
 *
 * 2026-09-11 (Tim). "Does all post-round data feed correctly? It asks feel, weather, mindset etc but
 * I have a suspicion that does not feed information for future rounds and situations and data."
 *
 * It did not. app/recap/feelings.tsx asks four questions at the end of every round — energy, focus,
 * vibe, weather — and writes them to the round record as `postRoundFeelings`. The ONLY thing that
 * ever read them was services/recapGenerator, which posts them into the recap of THAT SAME ROUND.
 * Nothing has ever looked at them again. A player answered the same four questions after every round
 * for months and the app learned nothing from any of it.
 *
 * That is worse than not asking. Asking implies the answer matters.
 *
 * ─── WHAT AN HONEST ANSWER LOOKS LIKE ──────────────────────────────────────────────────────────
 *
 * A PAIRED COMPARISON, not a correlation, and in strokes — the only unit a golfer feels. Every round
 * with an answer lands in exactly one bucket for that question, and the question is: did you score
 * better on the rounds you said you were locked in than on the ones you said you were off?
 *
 * The honesty bar is the one its siblings already keep (warmupPerformance, practiceImpact):
 *   - pure, synchronous, never throws
 *   - SILENT until there are enough rounds on BOTH sides; a one-round "improvement" is noise
 *   - describes ASSOCIATION, never causation. A golfer who felt locked in is often also the golfer
 *     who slept well and played an easy course, and this cannot separate those. The copy says
 *     "on the rounds you said you were locked in", never "focus lowered your score".
 *
 * PURE. No stores, no network — the caller passes the rounds in.
 */

/** The four things the post-round screen asks. Its own option lists, not a new vocabulary. */
export type ConditionKey = 'energy' | 'focus' | 'vibe' | 'weather';

export interface ConditionRound {
  scoreVsPar?: number | null;
  postRoundFeelings?: {
    energy?: string; focus?: string; vibe?: string; weather?: string;
  } | null;
}

export interface ConditionFinding {
  key: ConditionKey;
  /** The answer this bucket is about, in the player's own words ("Locked In", "Windy"). */
  value: string;
  /** Rounds where they answered this. */
  n: number;
  /** Rounds where they answered the SAME question differently — the comparison group. */
  otherN: number;
  /** Their average score-vs-par on those rounds, minus the average on the others. */
  deltaStrokes: number;
  /** One line, in strokes, stated as association. */
  text: string;
}

/**
 * Rounds needed on EACH side before this says anything at all.
 *
 * Three, matching warmupPerformance. Two is a coin flip dressed as a finding, and this one gets
 * spoken to the player by the caddie rather than sitting on a chart.
 */
const MIN_ROUNDS_PER_SIDE = 3;

/**
 * Below this the two buckets are the same. Golf scores swing several strokes on nothing at all, so
 * a difference under a stroke and a half is not a pattern — it is a Tuesday.
 */
const MEANINGFUL_STROKES = 1.5;

const LABEL: Record<ConditionKey, (v: string) => string> = {
  energy: (v) => `your energy was ${v.toLowerCase()}`,
  focus:  (v) => `you were ${v.toLowerCase()}`,
  vibe:   (v) => `it felt ${v.toLowerCase()}`,
  weather: (v) => `it was ${v.toLowerCase()}`,
};

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * What the post-round answers have actually been worth, across rounds.
 *
 * Returns only the findings that clear BOTH bars, strongest first. An empty array is the normal
 * state early on and is the honest one — it means nothing has repeated enough to be worth saying.
 */
export function conditionFindings(rounds: readonly ConditionRound[] | null | undefined): ConditionFinding[] {
  const rs = (rounds ?? []).filter(
    (r) => r && typeof r.scoreVsPar === 'number' && Number.isFinite(r.scoreVsPar) && r.postRoundFeelings,
  );
  if (rs.length < MIN_ROUNDS_PER_SIDE * 2) return [];

  const out: ConditionFinding[] = [];
  for (const key of ['energy', 'focus', 'vibe', 'weather'] as ConditionKey[]) {
    // Every round that answered THIS question, bucketed by its answer.
    const answered = rs.filter((r) => {
      const v = r.postRoundFeelings?.[key];
      return typeof v === 'string' && v.trim().length > 0;
    });
    if (answered.length < MIN_ROUNDS_PER_SIDE * 2) continue;

    const byValue = new Map<string, number[]>();
    for (const r of answered) {
      const v = (r.postRoundFeelings![key] as string).trim();
      const arr = byValue.get(v);
      if (arr) arr.push(r.scoreVsPar as number);
      else byValue.set(v, [r.scoreVsPar as number]);
    }

    for (const [value, scores] of byValue) {
      if (scores.length < MIN_ROUNDS_PER_SIDE) continue;
      // The comparison is every OTHER answer to the same question — not every other round, which
      // would quietly compare against rounds where the question was skipped.
      const others = answered
        .filter((r) => (r.postRoundFeelings![key] as string).trim() !== value)
        .map((r) => r.scoreVsPar as number);
      if (others.length < MIN_ROUNDS_PER_SIDE) continue;

      const delta = Math.round((avg(scores) - avg(others)) * 10) / 10;
      if (Math.abs(delta) < MEANINGFUL_STROKES) continue;

      const better = delta < 0;
      const n = Math.abs(delta);
      out.push({
        key, value, n: scores.length, otherN: others.length, deltaStrokes: delta,
        // "On the rounds where…" — the round is the subject, never the player's mood. That phrasing
        // is what keeps it an association rather than a diagnosis.
        text: `on the rounds where ${LABEL[key](value)}, you averaged ${n} ${n === 1 ? 'stroke' : 'strokes'} ${better ? 'better' : 'worse'} (${scores.length} v ${others.length})`,
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.deltaStrokes) - Math.abs(a.deltaStrokes));
}

/**
 * The line the caddie is given. Silent when nothing has repeated enough — never filler.
 *
 * Capped, because this is a prior about the player and not the shot in front of them: two findings
 * is context, six is a lecture.
 */
export function describeConditions(findings: ConditionFinding[], max = 2): string | null {
  if (findings.length === 0) return null;
  return findings.slice(0, max).map((f) => f.text).join('; ');
}

/**
 * TODAY'S ANSWER, when it is one we have seen before.
 *
 * The other half of Tim's question — "future rounds AND SITUATIONS". A finding about wind is worth
 * far more standing on a windy tee than it is in a season summary, so this picks out the findings
 * that match the conditions of the round being played RIGHT NOW.
 *
 * `current` is what we know about today, which for weather the app measures itself rather than
 * waiting to be told.
 */
export function findingsForToday(
  findings: ConditionFinding[],
  current: Partial<Record<ConditionKey, string | null | undefined>>,
): ConditionFinding[] {
  return findings.filter((f) => {
    const now = current[f.key];
    return typeof now === 'string' && now.trim().toLowerCase() === f.value.trim().toLowerCase();
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

export interface ConditionPlay {
  /** The condition this is about, in the post-round screen's own words. */
  value: string;
  /** How many strokes worse this player has actually averaged in it. Positive = worse. */
  costStrokes: number;
  /** What the app has ALREADY done to the numbers, so the player does not do it twice. */
  alreadyHandled: string | null;
  /** What is worth doing, in plain golf. One or two, never a list. */
  mitigations: string[];
  /** How to think about the round. The half Tim asked for. */
  mindset: string;
}

/**
 * MITIGATION AND MINDSET FOR A CONDITION THAT ACTUALLY COSTS THIS PLAYER.
 *
 * 2026-09-11 (Tim). "Sunny and hot should factor vs rainy and/or cold. Helps qualify the tie in. I
 * know a lot of people that can't play well or consistently cold, especially in California. Maybe
 * there are mitigation or at least mindset strategies we can derive."
 *
 * ─── TWO DIFFERENT THINGS, AND THE APP ONLY KNEW ONE ───────────────────────────────────────────
 *
 * Cold does two separate things to a round. It makes the BALL fly shorter — physics, and
 * utils/playsLike has modelled it correctly for months (~0.5% per 10°F below 70). And it makes the
 * PLAYER worse: cold hands, no turn through the ball, four layers on, and in California nobody is
 * adapted to it because it almost never happens.
 *
 * The app knew the first and nothing about the second. So a golfer in the cold got a correctly
 * lengthened yardage and no acknowledgement that the whole round was going to be harder.
 *
 * ─── THE MOST USEFUL THING IT CAN SAY IS "I ALREADY DID THAT" ──────────────────────────────────
 *
 * A golfer in the cold clubs up by feel. The app has ALREADY added the yards. Saying so stops the
 * double-count, which is a real shot saved and something no generic tip sheet can tell you.
 *
 * ─── AND IT ONLY SPEAKS ON EVIDENCE ────────────────────────────────────────────────────────────
 *
 * Returns null unless THIS player has a measured penalty in THIS condition. Generic cold-weather
 * advice for someone who plays fine in the cold is the filler this app refuses.
 */
export function conditionPlay(finding: ConditionFinding | null | undefined): ConditionPlay | null {
  if (!finding || finding.key !== 'weather' || finding.deltaStrokes <= 0) return null;
  const v = finding.value.trim().toLowerCase();
  const cost = Math.abs(finding.deltaStrokes);

  const shared = {
    value: finding.value,
    costStrokes: cost,
    /**
     * The mindset line is the same shape every time on purpose: the target MOVES. Smart bogey golf
     * measures a round against what is achievable today, and a player grinding against a fair-weather
     * number in the cold is the spiral this app exists to interrupt. [[smartplay-core-ethos]]
     */
    mindset: `You average ${cost} ${cost === 1 ? 'stroke' : 'strokes'} worse in this. That is not today going wrong — that is what this costs you. Play to a number ${Math.round(cost)} higher and it is a good round, not a bad one.`,
  };

  if (v === 'cold') {
    return {
      ...shared,
      alreadyHandled: 'The yardages already have the cold in them — the ball flies shorter and the plays-like number accounts for it. Do not club up twice.',
      mitigations: [
        'Keep your hands warm between shots — grip is the first thing cold takes.',
        'Swing smoother, not harder. Cold muscles do not turn as far, and trying to make up the distance is where the miss comes from.',
      ],
    };
  }
  if (v === 'rainy') {
    return {
      ...shared,
      alreadyHandled: null,
      mitigations: [
        'Take one more club and swing easier — wet grooves spin less and the ball comes off dead.',
        'There is no roll. Every number is a carry number today.',
      ],
    };
  }
  if (v === 'hot') {
    return {
      ...shared,
      alreadyHandled: 'The ball is flying further in this heat and the plays-like number already has it.',
      mitigations: [
        'Drink before you are thirsty — the back nine is where heat shows up in the score, not the front.',
      ],
    };
  }
  if (v === 'windy') {
    return {
      ...shared,
      alreadyHandled: 'The wind is already in the number — it is measured off your shot direction, not guessed.',
      mitigations: [
        'Swing easier into it. Hard swings add spin and the wind eats them.',
        'Take the low side of every number and let it run.',
      ],
    };
  }
  return null;
}

/** The play for TODAY, when today is a condition that has cost this player before. */
export function playForToday(
  findings: ConditionFinding[],
  current: Partial<Record<ConditionKey, string | null | undefined>>,
): ConditionPlay | null {
  for (const f of findingsForToday(findings, current)) {
    const p = conditionPlay(f);
    if (p) return p;
  }
  return null;
}
