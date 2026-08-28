/**
 * 2026-08-27 — the swing-metric trend, and mostly the ways it is allowed to STAY QUIET.
 *
 * The engine's job is to show progress AND regression across the swing library. The failure mode
 * that matters is not a missing trend — it is a CONFIDENT one drawn from too little, or a quiet week
 * rendered as a collapse. Every honesty rule in the module gets a test here, and the regression
 * cases get the same coverage as the improvement cases, because a rail that only speaks up on good
 * news is a rail nobody believes when it goes quiet.
 */

import {
  computeSwingMetricTrend,
  bandCloseness,
  type TrendSwing,
} from '../../services/practice/swingMetricTrend';
import { getBenchmarkMetric } from '../../services/swingBenchmarks';

const NOW = 1_700_000_000_000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Swings in the week `weeksAgo` back, all carrying the same hip-turn reading.
 *
 * 2026-08-28 — the default count is ONE, deliberately. `setShotBiomechanics` is called for exactly
 * one swing per session, so one readable value per range session is what the real data looks like;
 * a helper defaulting to four would have let these tests keep certifying a gate the app cannot feed.
 */
function week(weeksAgo: number, hipTurnDeg: number, count = 1, club = '7 iron'): TrendSwing[] {
  // Mid-week so a boundary rounding change cannot silently move a swing between buckets.
  const date = NOW - weeksAgo * WEEK + WEEK / 2;
  return Array.from({ length: count }, () => ({ date, club, metrics: { hipTurnDeg } }));
}

describe('bandCloseness — one axis where higher is always better', () => {
  it('scores anything inside the tour band as 100', () => {
    const m = getBenchmarkMetric('hipTurnDeg', 'iron');
    expect(m).toBeTruthy();
    expect(bandCloseness('hipTurnDeg', m!.range.ideal, '7 iron')).toBe(100);
    expect(bandCloseness('hipTurnDeg', m!.range.low, '7 iron')).toBe(100);
    expect(bandCloseness('hipTurnDeg', m!.range.high, '7 iron')).toBe(100);
  });

  it('falls off with distance outside the band, in both directions', () => {
    const m = getBenchmarkMetric('hipTurnDeg', 'iron')!;
    const halfWidth = (m.range.high - m.range.low) / 2;
    const under = bandCloseness('hipTurnDeg', m.range.low - halfWidth, '7 iron');
    const over = bandCloseness('hipTurnDeg', m.range.high + halfWidth, '7 iron');
    expect(under).toBeLessThan(100);
    expect(over).toBeLessThan(100);
    // Equidistant misses score the same — the axis measures distance, not direction.
    expect(under).toBe(over);
  });

  it('never goes negative, however far off the read is', () => {
    expect(bandCloseness('hipTurnDeg', -10_000, '7 iron')).toBe(0);
    expect(bandCloseness('hipTurnDeg', 10_000, '7 iron')).toBe(0);
  });
});

describe('quiet until it can say something honest', () => {
  it('says nothing with no swings at all', () => {
    const r = computeSwingMetricTrend({ swings: [], nowMs: NOW });
    expect(r.hasEnough).toBe(false);
    expect(r.trends).toHaveLength(0);
  });

  it('refuses a trend from one big session — the reads must be SPREAD OUT', () => {
    // 30 swings, all on one day. Plenty of data, one week, no trend.
    const r = computeSwingMetricTrend({ swings: week(1, 40, 30), nowMs: NOW });
    expect(r.hasEnough).toBe(false);
    // And it says so in the unit the player can act on: weeks, not swings.
    expect(r.headline).toMatch(/week/i);
  });

  it('refuses three weeks — two endpoints are not a trend', () => {
    const swings = [...week(3, 40), ...week(2, 40), ...week(1, 40)];
    expect(computeSwingMetricTrend({ swings, nowMs: NOW }).hasEnough).toBe(false);
  });

  /**
   * THE CASE THE FIRST VERSION MADE IMPOSSIBLE. One range session a week is what a real golfer does,
   * and it yields one readable swing per week. The original gate wanted three per week for three
   * weeks, so this player would have been told "not enough data" forever while holding eight real
   * measurements spanning two months.
   */
  it('opens up for one session a week — the way people actually practise', () => {
    const swings = [8, 7, 6, 5, 4, 3, 2, 1].flatMap((w) => week(w, 40));
    const r = computeSwingMetricTrend({ swings, nowMs: NOW });
    expect(r.hasEnough).toBe(true);
    expect(r.trends.length).toBeGreaterThan(0);
  });

  it('opens up at exactly four weeks with data', () => {
    const swings = [...week(4, 40), ...week(3, 40), ...week(2, 40), ...week(1, 40)];
    expect(computeSwingMetricTrend({ swings, nowMs: NOW }).hasEnough).toBe(true);
  });
});

describe('a quiet week is NO DATA, never a zero', () => {
  it('marks the empty week absent instead of plotting a collapse', () => {
    // Weeks 5, 4, 3 and 1 have swings; week 2 the player did not practise.
    const swings = [...week(5, 40), ...week(4, 40), ...week(3, 40), ...week(1, 40)];
    const r = computeSwingMetricTrend({ swings, nowMs: NOW });
    const hip = r.trends.find((t) => t.key === 'hipTurnDeg')!;
    expect(hip).toBeTruthy();
    // Exactly the four weeks that had reads are marked as data.
    expect(hip.weekHasData.filter(Boolean)).toHaveLength(4);
    // The gap week reads as no-data, so the graph skips it rather than drawing 0°.
    hip.weekHasData.forEach((has, i) => {
      if (!has) expect(hip.rawSeries[i]).toBe(0); // the placeholder...
    });
    // ...and the surface is told which weeks the placeholder covers, which is what stops it
    // being rendered as a real reading.
    expect(hip.weekHasData).toContain(false);
  });

  it('excludes an unreadable metric entirely rather than defaulting it to zero', () => {
    // Hip turn reads fine; shoulder turn was never readable.
    const swings = [...week(4, 40), ...week(3, 40), ...week(2, 40), ...week(1, 40)];
    const r = computeSwingMetricTrend({ swings, nowMs: NOW });
    expect(r.trends.some((t) => t.key === 'hipTurnDeg')).toBe(true);
    expect(r.trends.some((t) => t.key === 'shoulderTurnDeg')).toBe(false);
  });

  it('a null reading is absent, not a zero that drags the median down', () => {
    const withNulls: TrendSwing[] = [
      ...week(4, 40), ...week(3, 40), ...week(2, 40), ...week(1, 40),
      { date: NOW - WEEK / 2, club: '7 iron', metrics: { hipTurnDeg: null } },
    ];
    const r = computeSwingMetricTrend({ swings: withNulls, nowMs: NOW });
    const hip = r.trends.find((t) => t.key === 'hipTurnDeg')!;
    const last = hip.rawSeries[hip.weekHasData.lastIndexOf(true)];
    expect(last).toBe(40);
  });
});

describe('progress and regression are reported the same way', () => {
  const m = getBenchmarkMetric('hipTurnDeg', 'iron')!;
  const inBand = m.range.ideal;
  const wayOff = m.range.low - (m.range.high - m.range.low);

  it('calls a move toward the band improving', () => {
    const swings = [...week(4, wayOff), ...week(3, wayOff), ...week(2, inBand), ...week(1, inBand)];
    const hip = computeSwingMetricTrend({ swings, nowMs: NOW }).trends.find((t) => t.key === 'hipTurnDeg')!;
    expect(hip.direction).toBe('improving');
    expect(hip.deltaBandScore).toBeGreaterThan(0);
    expect(hip.inBandNow).toBe(true);
  });

  it('calls a move away from the band regressing, and says so out loud', () => {
    const swings = [...week(4, inBand), ...week(3, inBand), ...week(2, wayOff), ...week(1, wayOff)];
    const hip = computeSwingMetricTrend({ swings, nowMs: NOW }).trends.find((t) => t.key === 'hipTurnDeg')!;
    expect(hip.direction).toBe('regressing');
    expect(hip.deltaBandScore).toBeLessThan(0);
    // Named plainly — no euphemism, and the same sentence shape the good news gets.
    expect(hip.headline).toMatch(/drifted away/i);
  });

  it('calls a flat trend steady rather than inventing a direction from noise', () => {
    const swings = [...week(4, inBand), ...week(3, inBand), ...week(2, inBand), ...week(1, inBand)];
    const hip = computeSwingMetricTrend({ swings, nowMs: NOW }).trends.find((t) => t.key === 'hipTurnDeg')!;
    expect(hip.direction).toBe('steady');
  });

  /**
   * THE PROPERTY THE HALF-VS-HALF COMPARISON EXISTS FOR. At one read per week, comparing the first
   * data week against the last is one pose read deciding a verdict against another — so a single
   * soft read at either end would invent a trend. Here the swing is genuinely FLAT and the most
   * recent week is a bad read; the verdict must not flip on it.
   */
  it('a single bad read at the end does not invent a regression', () => {
    const swings = [
      ...week(6, inBand), ...week(5, inBand), ...week(4, inBand),
      ...week(3, inBand), ...week(2, inBand), ...week(1, wayOff),
    ];
    const hip = computeSwingMetricTrend({ swings, nowMs: NOW }).trends.find((t) => t.key === 'hipTurnDeg')!;
    expect(hip.direction).not.toBe('regressing');
  });

  it('leads with the WORST trend — the drift a player cannot feel', () => {
    const swings: TrendSwing[] = [];
    for (const w of [4, 3, 2, 1]) {
      const hip = w <= 2 ? wayOff : inBand;             // hip turn falling apart
      const shoulderIdeal = getBenchmarkMetric('shoulderTurnDeg', 'iron')!.range.ideal;
      const date = NOW - w * WEEK + WEEK / 2;
      swings.push({ date, club: '7 iron', metrics: { hipTurnDeg: hip, shoulderTurnDeg: shoulderIdeal } });
    }
    const r = computeSwingMetricTrend({ swings, nowMs: NOW });
    expect(r.trends[0].key).toBe('hipTurnDeg');
    expect(r.trends[0].direction).toBe('regressing');
    // The overall headline surfaces the regression, not the metric that held steady.
    expect(r.headline).toMatch(/drifted away/i);
  });
});

describe('it measures, it does not diagnose', () => {
  it('carries the tour-range framing so no surface can render a number without it', () => {
    const swings = [...week(4, 40), ...week(3, 40), ...week(2, 40), ...week(1, 40)];
    const r = computeSwingMetricTrend({ swings, nowMs: NOW });
    expect(r.framing).toBeTruthy();
    expect(r.framing.length).toBeGreaterThan(20);
  });

  it('never claims a named pro or a cause', () => {
    const swings = [...week(4, 20), ...week(3, 25), ...week(2, 30), ...week(1, 40)];
    const r = computeSwingMetricTrend({ swings, nowMs: NOW });
    for (const t of r.trends) {
      expect(t.headline).not.toMatch(/because|caused|proves/i);
      // "vs the tour RANGE", never "you are X off [somebody]".
      expect(t.headline).not.toMatch(/\bvs\.? [A-Z][a-z]+ [A-Z]/);
    }
  });

  it('grades a mixed-club week against each swing\'s OWN band', () => {
    /**
     * The same hip turn is not equally on-plan with every club — the bank's driver band sits higher
     * than its wedge band — so the engine must score each swing against its own club category before
     * taking the week's median.
     *
     * Asserted at a hip turn that is INSIDE one band and OUTSIDE the other, derived from the bank at
     * runtime rather than hardcoded. The first version of this test compared the driver's ideal
     * against the iron band and expected them to differ; those two ranges OVERLAP, so the ideal
     * scored 100 on both and the test failed on an assumption I had made about the bank instead of
     * reading it. [[my-measurement-is-the-least-reliable-part]]
     */
    const driver = getBenchmarkMetric('hipTurnDeg', 'driver')!;
    const wedge = getBenchmarkMetric('hipTurnDeg', 'wedge')!;
    expect(driver.range.high).toBeGreaterThan(wedge.range.high);
    const between = (driver.range.high + wedge.range.high) / 2; // in the driver band, past the wedge's
    expect(bandCloseness('hipTurnDeg', between, 'driver')).toBe(100);
    expect(bandCloseness('hipTurnDeg', between, 'lob wedge')).toBeLessThan(100);
  });
});

describe('never throws, whatever the store hands it', () => {
  it('survives malformed entries instead of taking the dashboard down', () => {
    const junk = [
      null, undefined,
      { date: 'yesterday', club: null, metrics: {} },
      { date: NOW, club: null, metrics: { hipTurnDeg: NaN } },
      { date: NOW, club: null, metrics: { hipTurnDeg: Infinity } },
      { date: NOW + 10 * WEEK, club: null, metrics: { hipTurnDeg: 40 } }, // in the future
    ] as unknown as TrendSwing[];
    expect(() => computeSwingMetricTrend({ swings: junk, nowMs: NOW })).not.toThrow();
    const r = computeSwingMetricTrend({ swings: junk, nowMs: NOW });
    expect(r.hasEnough).toBe(false);
  });

  it('ignores reads older than the window rather than piling them onto week one', () => {
    const ancient = Array.from({ length: 40 }, () => ({
      date: NOW - 60 * WEEK, club: '7 iron', metrics: { hipTurnDeg: 10 },
    }));
    const r = computeSwingMetricTrend({ swings: ancient, nowMs: NOW });
    expect(r.totalGradedSwings).toBe(0);
    expect(r.hasEnough).toBe(false);
  });
});
