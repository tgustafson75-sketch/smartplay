/**
 * 2026-09-12 (Tim — the day-one concept) — "this is where the sports coach, swing coach, caddy,
 * MENTAL GAME coach concept originally came from — to be able to talk to them."
 *
 * THE MENTAL COACH HAD A JOB DESCRIPTION AND NO EVIDENCE.
 *
 * `mentalGameBlock()` in api/_brain tells the caddie he is also a sports psychologist, always-on
 * "on the course AND off it". What he was handed to work with: the CURRENT round's last five
 * self-reports (services/caddieRequestBody), plus a distress-spiral trip that also reads only the
 * current round. And `endRound` resets `emotionalLog` to `[]` after snapshotting it into
 * `roundHistory` — so the moment a round ends, the always-on mental coach has nothing, which is
 * exactly the off-course conversation the concept was about.
 *
 * Meanwhile every one of those reports is PERSISTED, for the most recent fifty rounds
 * (compactHistoryForPersist keeps `emotionalLog` for those and strips it only from older rounds).
 * Read by nothing. Not by the caddie, and — unlike practiceImpact or swingMetricTrend before them —
 * not by a screen either: there is no mental surface anywhere in the app. Written, kept, and never
 * looked at again. [[sweep-the-missing-half-not-the-unused-export]]
 *
 * WHAT THIS IS HONEST ABOUT. These are not a mood record. `log_emotional_state` fires only when the
 * caddie NOTICED a shift and chose to log it, so the data is sparse and biased towards the moments
 * that stood out — which makes it useful for "has this come up before?" and useless for "how does he
 * usually feel". The block built from this says so, because a model handed counts will otherwise
 * reason about them as though they were a complete record. [[illustration-data-points]]
 */

export interface MentalReport {
  state: string;
  valence?: 'positive' | 'neutral' | 'negative' | null;
  hole?: number | null;
}

export interface MentalRoundInput {
  endedAt: number;
  simulated?: boolean;
  emotionalLog?: MentalReport[] | null;
}

export interface MentalPattern {
  roundsWithReports: number;
  totalReports: number;
  negative: number;
  positive: number;
  /** The state named most often, with its count. Ties resolve to the first seen. */
  topState: { state: string; count: number } | null;
  /** Where the negative reports land. Holes 1-9 vs 10-18; a report with no hole counts in neither. */
  negFront: number;
  negBack: number;
  /**
   * Share of reports that were negative, earlier half of the counted rounds vs later half. A SHARE,
   * not a count — a round he talked through twice and a round he talked through ten times would
   * otherwise look like different moods rather than different amounts of conversation.
   */
  negShareEarly: number;
  negShareLate: number;
  direction: 'settling' | 'tightening' | 'steady';
  hasEnough: boolean;
}

/** Enough to say "this has come up before" without one bad afternoon speaking for him. */
const MIN_ROUNDS = 3;
const MIN_REPORTS = 6;
/** Most recent rounds considered. Older than this is a different golfer. */
const WINDOW_ROUNDS = 10;
/** Either side of level, so a single extra grumble cannot declare a direction. */
const DEADBAND = 0.12;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeMentalPattern(input: { rounds: readonly MentalRoundInput[] }): MentalPattern {
  const empty: MentalPattern = {
    roundsWithReports: 0, totalReports: 0, negative: 0, positive: 0, topState: null,
    negFront: 0, negBack: 0, negShareEarly: 0, negShareLate: 0, direction: 'steady', hasEnough: false,
  };

  // Simulated rounds are narrated demos — their emotional beats are scripted, not his.
  const counted = (input.rounds ?? [])
    .filter((r) => r != null && !r.simulated && typeof r.endedAt === 'number')
    .filter((r) => Array.isArray(r.emotionalLog) && r.emotionalLog.length > 0)
    .sort((a, b) => a.endedAt - b.endedAt)
    .slice(-WINDOW_ROUNDS);

  if (counted.length === 0) return empty;

  const all: MentalReport[] = [];
  for (const r of counted) for (const e of r.emotionalLog ?? []) if (e && typeof e.state === 'string') all.push(e);
  if (all.length === 0) return empty;

  const isNeg = (e: MentalReport) => e.valence === 'negative';
  const negative = all.filter(isNeg).length;
  const positive = all.filter((e) => e.valence === 'positive').length;

  const stateCounts = new Map<string, number>();
  for (const e of all) {
    const k = e.state.trim().toLowerCase();
    if (k) stateCounts.set(k, (stateCounts.get(k) ?? 0) + 1);
  }
  let topState: MentalPattern['topState'] = null;
  for (const [state, count] of stateCounts) if (!topState || count > topState.count) topState = { state, count };

  const negWithHole = all.filter((e) => isNeg(e) && typeof e.hole === 'number' && (e.hole as number) > 0);
  const negFront = negWithHole.filter((e) => (e.hole as number) <= 9).length;
  const negBack = negWithHole.filter((e) => (e.hole as number) > 9).length;

  const half = Math.ceil(counted.length / 2);
  const shareOf = (rounds: readonly MentalRoundInput[]): number => {
    const es = rounds.flatMap((r) => (r.emotionalLog ?? []).filter((e) => e && typeof e.state === 'string'));
    return es.length === 0 ? 0 : es.filter(isNeg).length / es.length;
  };
  const negShareEarly = round2(shareOf(counted.slice(0, half)));
  const negShareLate = round2(shareOf(counted.slice(half)));
  const direction: MentalPattern['direction'] =
    negShareLate < negShareEarly - DEADBAND ? 'settling'
      : negShareLate > negShareEarly + DEADBAND ? 'tightening'
        : 'steady';

  return {
    roundsWithReports: counted.length,
    totalReports: all.length,
    negative,
    positive,
    topState,
    negFront,
    negBack,
    negShareEarly,
    negShareLate,
    direction,
    hasEnough: counted.length >= MIN_ROUNDS && all.length >= MIN_REPORTS,
  };
}
