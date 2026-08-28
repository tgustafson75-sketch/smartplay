/**
 * 2026-08-27 (Tim — "auto comparison of swings over time from the swing library… a build feature
 * towards showing PROGRESS AND REGRESSION with everything as part of our graphs and trends").
 *
 * WHY THIS DID NOT ALREADY EXIST, despite the caddie saying it did.
 *
 * services/swingComparisonEngine has done `self_vs_self` since 05-22 and its own header names the
 * use case — "current swing vs personal best / vs 30 days ago". But every caller is a PAIRWISE,
 * MANUAL comparison: the player opens a swing, picks a reference, taps compare. Nothing walks the
 * library on its own, and no swing metric is trended anywhere in the app — the PROGRESS graph's four
 * sources all plot effort against SCORE or strike rate. So the capability was real and the feature
 * was not, which is exactly the shape that let the caddie report it as planned work.
 * [[connected-is-not-the-same-as-used]]
 *
 * THE HARD PART IS NOT THE SERIES, IT IS THE AXIS.
 *
 * Six biomech metrics move in different units and different directions: more hip turn is better up
 * to a point and then it is not, head drift is better near zero, hip slide ratio is better BELOW 1.
 * Plotting raw degrees would draw "improvement" for any change that happened to go up, which is the
 * hardcoded-axis bug the dashboard already had to fix once for strike rate.
 *
 * So the axis is DISTANCE FROM THE TOUR BAND, from the one benchmark bank the comparison engine
 * already grades against (services/swingBenchmarks). Inside the band scores 100; outside it falls
 * off with how far outside, relative to the band's own width. That gives one number where higher is
 * better for every metric, comparable across metrics, and it inherits the app's existing honesty
 * framing: a directional read against a tour-standard RANGE, never "you are X° off [named pro]".
 * BENCHMARK_FRAMING rides along so no surface can render this without saying what it is.
 *
 * HONESTY RULES, each with a test:
 *   - a week is plotted only with MIN_SWINGS_PER_WEEK graded reads; a quiet week is NO DATA, never
 *     a zero. A zero here would draw a collapse that never happened.
 *   - the weekly value is a MEDIAN, not a mean — one bad pose read cannot swing a week.
 *   - a metric the pose pass could not read is absent, never defaulted. Unreadable is not zero.
 *   - REGRESSION IS REPORTED AS PLAINLY AS PROGRESS. Tim asked for both, and a trend rail that only
 *     speaks when the news is good is a rail nobody can trust when it says nothing.
 *   - it describes a MEASUREMENT MOVING, not a cause. A swing metric drifting is worth seeing; it
 *     is not a diagnosis and the copy never makes it one.
 *
 * Pure, sync, never throws — same contract as workoutPerformance / workoutSwingImpact, so the
 * surface can call it during render without a guard.
 */

import {
  clubCategoryFor,
  getBenchmarkMetric,
  BENCHMARK_FRAMING,
  type BenchmarkMetricKey,
} from '../swingBenchmarks';

/** One graded swing: when it happened, what it was hit with, and what the pose pass could read. */
export interface TrendSwing {
  date: number;
  club: string | null;
  /**
   * Readable biomech values for this swing. Deliberately a loose bag rather than SwingBiomechanics:
   * the tempo read lives outside that interface (services/smartTempo) but IS in the benchmark bank,
   * and a trend that could not include tempo would be missing the metric players ask about most.
   */
  metrics: Partial<Record<BenchmarkMetricKey, number | null>>;
}

export interface MetricTrend {
  key: BenchmarkMetricKey;
  label: string;
  /** Closeness to the tour band, 0-100, per week, oldest→newest. Higher is better, always. */
  bandScoreSeries: number[];
  /** The player's actual median reading per week, in the metric's own units. */
  rawSeries: number[];
  /** Which weeks carry enough graded reads to mean anything. A false is NO DATA, not a zero. */
  weekHasData: boolean[];
  /** Graded reads behind the whole trend. */
  gradedReads: number;
  /** Weeks carrying data. */
  weeksWithData: number;
  /** Change in band closeness from the first week with data to the last. */
  deltaBandScore: number;
  /** Change in the raw reading, in the metric's own units. */
  deltaRaw: number;
  direction: 'improving' | 'regressing' | 'steady';
  /** True when the latest reading sits inside the tour band. */
  inBandNow: boolean;
  /** One honest sentence. Says the same thing whether the news is good or bad. */
  headline: string;
}

export interface SwingMetricTrendResult {
  /** Trends we can speak to, worst-first: a regression the player cannot see is the point of this. */
  trends: MetricTrend[];
  /** Graded swings per week, oldest→newest — the EFFORT axis on the PROGRESS graph. */
  swingsPerWeek: number[];
  totalGradedSwings: number;
  /** Enough to say anything at all. */
  hasEnough: boolean;
  /** The mandatory framing for any surface rendering this. */
  framing: string;
  /** What is missing, in counts, when it cannot speak. */
  headline: string;
}

const WEEKS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Below three reads a "median" is one swing wearing a statistic's clothes. This is the gate that
 * stops a single warm-up hack from drawing a regression the player never had.
 */
const MIN_SWINGS_PER_WEEK = 3;
/** Two points make a line; three make a trend worth showing a player. */
const MIN_WEEKS_WITH_DATA = 3;
/** A move smaller than this is noise in a pose read, not a change in a golf swing. */
const STEADY_BAND_SCORE = 5;

const LABELS: Record<BenchmarkMetricKey, string> = {
  hipTurnDeg: 'Hip turn',
  shoulderTurnDeg: 'Shoulder turn',
  shoulderTiltDeg: 'Shoulder tilt',
  weightShiftPct: 'Weight shift',
  spineAngleDeltaDeg: 'Spine angle',
  headDriftPxNorm: 'Head drift',
  hipSlideRatio: 'Hip slide',
  sequencingScore: 'Sequencing',
  tempoRatio: 'Tempo',
};

const UNITS: Record<BenchmarkMetricKey, string> = {
  hipTurnDeg: '°',
  shoulderTurnDeg: '°',
  shoulderTiltDeg: '°',
  weightShiftPct: '%',
  spineAngleDeltaDeg: '°',
  headDriftPxNorm: '',
  hipSlideRatio: '',
  sequencingScore: '',
  tempoRatio: ':1',
};

const TRACKED: BenchmarkMetricKey[] = [
  'hipTurnDeg',
  'shoulderTurnDeg',
  'shoulderTiltDeg',
  'weightShiftPct',
  'spineAngleDeltaDeg',
  'headDriftPxNorm',
  'hipSlideRatio',
  'sequencingScore',
  'tempoRatio',
];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * How close a reading sits to the tour band, 0-100.
 *
 * Inside the band is 100 — the band IS the target, and pretending there is a better spot inside it
 * would invent a precision the bank does not claim. Outside, the score falls off against the band's
 * own half-width, so a metric with a wide honest range is not punished for the same absolute miss
 * that would matter on a tight one. Floored at 0 rather than going negative: "as far off as it gets"
 * is a real state, and a negative closeness is not a thing.
 */
export function bandCloseness(key: BenchmarkMetricKey, value: number, club: string | null): number {
  const m = getBenchmarkMetric(key, clubCategoryFor(club));
  if (!m) return 0;
  const { low, high } = m.range;
  if (value >= low && value <= high) return 100;
  const halfWidth = Math.max((high - low) / 2, 1e-6);
  const outBy = value < low ? low - value : value - high;
  return Math.max(0, Math.round(100 - (outBy / halfWidth) * 50));
}

export function computeSwingMetricTrend(input: {
  swings: TrendSwing[];
  nowMs: number;
}): SwingMetricTrendResult {
  const { swings, nowMs } = input;
  const empty: SwingMetricTrendResult = {
    trends: [],
    swingsPerWeek: new Array(WEEKS).fill(0),
    totalGradedSwings: 0,
    hasEnough: false,
    framing: BENCHMARK_FRAMING,
    headline: 'No graded swings yet — record a few in Smart Motion and this starts tracking.',
  };
  if (!Array.isArray(swings) || swings.length === 0) return empty;

  // Bucket by week, oldest→newest. A swing outside the window is not counted rather than clamped
  // into the edge week, which would pile a year of old reads onto week one.
  const windowStart = nowMs - WEEKS * WEEK_MS;
  const buckets: TrendSwing[][] = Array.from({ length: WEEKS }, () => []);
  for (const s of swings) {
    if (!s || typeof s.date !== 'number' || s.date < windowStart || s.date > nowMs) continue;
    const idx = Math.min(WEEKS - 1, Math.floor((s.date - windowStart) / WEEK_MS));
    buckets[idx].push(s);
  }

  const swingsPerWeek = buckets.map((b) => b.length);
  const totalGradedSwings = swingsPerWeek.reduce((a, b) => a + b, 0);

  const trends: MetricTrend[] = [];
  for (const key of TRACKED) {
    const bandScoreSeries: number[] = [];
    const rawSeries: number[] = [];
    const weekHasData: boolean[] = [];
    let gradedReads = 0;

    for (const week of buckets) {
      // Only readings the pose pass actually produced. A null is absent, never a zero — the
      // difference between "we could not read it" and "it measured nothing" is the whole point.
      const readable = week.filter(
        (s) => typeof s.metrics?.[key] === 'number' && Number.isFinite(s.metrics[key] as number),
      );
      if (readable.length < MIN_SWINGS_PER_WEEK) {
        bandScoreSeries.push(0);
        rawSeries.push(0);
        weekHasData.push(false);
        continue;
      }
      gradedReads += readable.length;
      const raw = median(readable.map((s) => s.metrics[key] as number));
      // Score each swing against ITS OWN club's band, then take the median of the scores — a week
      // mixing driver and wedge swings would otherwise be graded entirely against one of them.
      const score = median(readable.map((s) => bandCloseness(key, s.metrics[key] as number, s.club)));
      bandScoreSeries.push(Math.round(score));
      rawSeries.push(Math.round(raw * 10) / 10);
      weekHasData.push(true);
    }

    const dataIdx = weekHasData.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
    if (dataIdx.length < MIN_WEEKS_WITH_DATA) continue;

    const first = dataIdx[0];
    const last = dataIdx[dataIdx.length - 1];
    const deltaBandScore = bandScoreSeries[last] - bandScoreSeries[first];
    const deltaRaw = Math.round((rawSeries[last] - rawSeries[first]) * 10) / 10;
    const direction: MetricTrend['direction'] =
      Math.abs(deltaBandScore) < STEADY_BAND_SCORE ? 'steady' : deltaBandScore > 0 ? 'improving' : 'regressing';
    const inBandNow = bandScoreSeries[last] === 100;
    const label = LABELS[key];
    const unit = UNITS[key];
    const shown = `${rawSeries[last]}${unit}`;

    /**
     * The same sentence structure whichever way it went. A rail that gets chatty about progress and
     * vague about regression teaches the player to discount it. [[illustration-data-points]]
     */
    const headline =
      direction === 'improving'
        ? `${label} is moving toward the tour range — ${shown} now, ${deltaRaw > 0 ? '+' : ''}${deltaRaw}${unit} over ${dataIdx.length} weeks.`
        : direction === 'regressing'
          ? `${label} has drifted away from the tour range — ${shown} now, ${deltaRaw > 0 ? '+' : ''}${deltaRaw}${unit} over ${dataIdx.length} weeks.`
          : inBandNow
            ? `${label} is holding inside the tour range at ${shown}.`
            : `${label} is holding steady at ${shown}, outside the tour range.`;

    trends.push({
      key,
      label,
      bandScoreSeries,
      rawSeries,
      weekHasData,
      gradedReads,
      weeksWithData: dataIdx.length,
      deltaBandScore,
      deltaRaw,
      direction,
      inBandNow,
      headline,
    });
  }

  if (trends.length === 0) {
    const need = Math.max(0, MIN_SWINGS_PER_WEEK * MIN_WEEKS_WITH_DATA - totalGradedSwings);
    return {
      ...empty,
      swingsPerWeek,
      totalGradedSwings,
      headline: need > 0
        // Says exactly what is missing, in counts — the same contract the other rails hold to.
        ? `${totalGradedSwings} graded swing${totalGradedSwings === 1 ? '' : 's'} so far. About ${need} more, spread over ${MIN_WEEKS_WITH_DATA} weeks, and the trend opens up.`
        : `${totalGradedSwings} graded swings, but not yet ${MIN_SWINGS_PER_WEEK} in each of ${MIN_WEEKS_WITH_DATA} separate weeks — the trend needs them spread out, not in one session.`,
    };
  }

  /**
   * WORST FIRST. The reason to compute this at all is the thing a player cannot feel: a metric that
   * has quietly drifted. Sorting by improvement would bury it under the good news.
   */
  trends.sort((a, b) => a.deltaBandScore - b.deltaBandScore);

  const regressing = trends.filter((t) => t.direction === 'regressing');
  const improving = trends.filter((t) => t.direction === 'improving');
  const headline =
    regressing.length > 0
      ? regressing[0].headline
      : improving.length > 0
        ? improving[improving.length - 1].headline
        : trends[0].headline;

  return {
    trends,
    swingsPerWeek,
    totalGradedSwings,
    hasEnough: true,
    framing: BENCHMARK_FRAMING,
    headline,
  };
}
