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
