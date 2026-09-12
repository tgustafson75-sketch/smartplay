/**
 * 2026-09-11 (full-app audit) — ONE GRAPH, TWO DIFFERENT TIMELINES.
 *
 * Tim asked for one chart showing how practice, warm-ups and scoring intertwine, and for it to have
 * a timeline. It had both, and the two lines on it were plotted against DIFFERENT TIME BASES: the
 * effort line was six weekly buckets, the score line was the last eight ROUNDS, whenever those
 * happened. TrendChart stretches each series across the same width, so point `i` of one was not the
 * same moment as point `i` of the other — and the axis label was computed from the ROUND count while
 * being written in weeks.
 *
 * Measured, not argued: a player with eight rounds inside seven days and practice going back six
 * weeks got an axis reading "7 weeks ago → this week". Wrong for the practice line (6 weeks), wrong
 * for the score line (1 week), on the one chart whose whole job is letting you read them against
 * each other. That is the Arccos problem Tim described, reproduced in our own app.
 */
import { computePracticeImpact, type PracticeImpact } from '../../services/practice/practiceImpact';
import { WEEKS, weeklyScoreSeries, weeksWithData } from '../../services/practice/weeklyBuckets';

const DAY = 86400000;
const now = 1757600000000;
const weeklySessions = Array.from({ length: 6 }, (_, i) => ({ startedAt: now - i * 7 * DAY, balls: 50 }));
const impact = (rounds: { endedAt: number; startedAt: number; scoreVsPar: number }[]): PracticeImpact =>
  computePracticeImpact({ sessions: weeklySessions, rounds, nowMs: now } as never);

describe('both lines are on the same clock', () => {
  const eightInAWeek = Array.from({ length: 8 }, (_, i) => ({
    endedAt: now - i * DAY, startedAt: now - i * DAY, scoreVsPar: 10 + i,
  }));

  it('the chart series are the same length, so slot i is the same week on both', () => {
    const out = impact(eightInAWeek);
    expect(out.practiceSeries).toHaveLength(WEEKS);
    expect(out.scoreWeekly).toHaveLength(WEEKS);
  });

  it('eight rounds inside one week fill ONE week, not eight slots of history', () => {
    const out = impact(eightInAWeek);
    // Rounds spanning 7 days land in at most two weekly buckets.
    expect(weeksWithData(out.scoreWeekly)).toBeLessThanOrEqual(2);
    // and the weeks he did not play are empty, not invented
    expect(out.scoreWeekly[0]).toBeNull();
  });

  it('a week with no round is null, never a zero — zero on a vs-par axis means LEVEL PAR', () => {
    const out = impact([{ endedAt: now, startedAt: now, scoreVsPar: 7 }]);
    expect(out.scoreWeekly.filter((v) => v === 0)).toHaveLength(0);
    expect(out.scoreWeekly[WEEKS - 1]).toBe(7);
    expect(out.scoreWeekly.slice(0, WEEKS - 1).every((v) => v === null)).toBe(true);
  });

  it('a genuine gap in the middle stays a gap', () => {
    const spread = Array.from({ length: 5 }, (_, i) => ({
      endedAt: now - i * 9 * DAY, startedAt: now - i * 9 * DAY, scoreVsPar: 12 + i,
    }));
    const out = impact(spread);
    expect(out.scoreWeekly).toContain(null);
    expect(weeksWithData(out.scoreWeekly)).toBeGreaterThan(1);
  });

  it('several rounds in one week average, rather than the last one winning', () => {
    const two = [
      { endedAt: now, startedAt: now, scoreVsPar: 10 },
      { endedAt: now - DAY, startedAt: now - DAY, scoreVsPar: 20 },
    ];
    expect(impact(two).scoreWeekly[WEEKS - 1]).toBe(15);
  });

  it('the per-round series is UNCHANGED — the trend maths still reads rounds', () => {
    const out = impact(eightInAWeek);
    expect(out.scoreSeries).toHaveLength(8);
    expect(out.roundsCounted).toBe(8);
  });
});

describe('the bucketer itself', () => {
  it('ignores a round outside the window instead of clamping it into the oldest bucket', () => {
    const old = [{ endedAt: now - 200 * DAY, scoreVsPar: 30 }];
    expect(weeklyScoreSeries(old, now).every((v) => v === null)).toBe(true);
  });

  it('ignores a round with no vs-par rather than counting it as zero', () => {
    const s = weeklyScoreSeries([{ endedAt: now, scoreVsPar: null }], now);
    expect(s.every((v) => v === null)).toBe(true);
  });

  it('never throws on junk', () => {
    expect(() => weeklyScoreSeries(null, now)).not.toThrow();
    expect(() => weeklyScoreSeries([{}] as never, now)).not.toThrow();
  });
});

describe('the three progress cards cannot drift onto different buckets', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').join(__dirname, '../../', p), 'utf8') as string;

  it('none of them declares its own WEEKS / WEEK_MS any more', () => {
    for (const f of ['practiceImpact', 'pointsPerformance', 'workoutPerformance']) {
      const src = read(`services/practice/${f}.ts`);
      expect(src).not.toMatch(/^const WEEKS = \d+;/m);
      expect(src).not.toMatch(/^const WEEK_MS = /m);
      expect(src).toMatch(/require\('\.\/weeklyBuckets'\)/);
    }
  });

  it('all three expose the weekly score the chart plots', () => {
    for (const f of ['practiceImpact', 'pointsPerformance', 'workoutPerformance']) {
      expect(read(`services/practice/${f}.ts`)).toMatch(/scoreWeekly/);
    }
  });

  it('and the dashboard hands the chart the WEEKLY series, not the per-round one', () => {
    const dash = read('app/(tabs)/dashboard.tsx');
    expect(dash).toMatch(/score: practiceImpact\.scoreWeekly/);
    expect(dash).toMatch(/score: pointsPerf\.scoreWeekly/);
    expect(dash).toMatch(/score: workoutPerf\.scoreWeekly/);
    expect(dash).not.toMatch(/score: practiceImpact\.scoreSeries/);
  });
});

describe('the chart keeps a gap as a slot', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../components/charts/TrendChart.tsx'), 'utf8',
  ) as string;

  it('does not filter missing values OUT — that collapsed the series and moved every later point', () => {
    expect(src).not.toMatch(/data\.filter\(\(v\) => typeof v === 'number'/);
    expect(src).toMatch(/data\.map\(\(v\) => \(typeof v === 'number' && Number\.isFinite\(v\) \? v : null\)\)/);
  });

  it('breaks the path into contiguous runs rather than bridging the gap', () => {
    expect(src).toMatch(/function contiguousRuns/);
    expect(src).toMatch(/const runs = contiguousRuns\(slots\)/);
  });

  it('markers index the SLOTS, so a gap cannot move which week a warm-up dot sits on', () => {
    expect(src).toMatch(/const markerHost: \(Pt \| null\)\[\]/);
  });

  it('the end-of-line tag shows the last value SEEN, not a trailing null', () => {
    expect(src).toMatch(/push\('primary', endLabel, present\[present\.length - 1\]/);
  });
});
