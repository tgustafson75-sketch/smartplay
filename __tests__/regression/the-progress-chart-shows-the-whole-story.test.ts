/**
 * 2026-11-01 (Tim) — "the data bar in Caddie needs to scroll left and right so you can see all history
 * timelines. Yes there will be drop offs in activity but those tell a story too."
 *
 * The progress chart (dashboard) was six weekly buckets. The DRAWN series now reach back to the first
 * activity, idle weeks included, and the chart scrolls; the VERDICTS still read only the last WEEKS, so
 * a long history cannot change what "is the work helping lately" means.
 */
import fs from 'fs';
import path from 'path';
import { WEEKS, WEEK_MS, HISTORY_MAX_WEEKS, historyWeeks } from '../../services/practice/weeklyBuckets';
import { computePracticeImpact } from '../../services/practice/practiceImpact';
import { computeWorkoutPerformance } from '../../services/practice/workoutPerformance';
import { computePointsPerformance } from '../../services/practice/pointsPerformance';

const NOW = Date.UTC(2026, 10, 1);
const weeksAgo = (w: number) => NOW - w * WEEK_MS - 3_600_000;   // an hour inside week w
const round = (w: number, scoreVsPar: number) => ({ endedAt: weeksAgo(w), startedAt: weeksAgo(w), scoreVsPar });

describe('how far back the timeline reaches', () => {
  it('to the first activity, never less than the verdict window, never more than three years', () => {
    expect(historyWeeks([], NOW)).toBe(WEEKS);
    expect(historyWeeks([weeksAgo(20)], NOW)).toBe(21);
    expect(historyWeeks([weeksAgo(1000)], NOW)).toBe(HISTORY_MAX_WEEKS);
    expect(historyWeeks([null, undefined, NaN, weeksAgo(9)], NOW)).toBe(10);
  });
});

describe('the drawn history includes every week, the quiet ones too', () => {
  // Practiced 20 weeks ago, then nothing for months, then back in the last few weeks.
  const sessions = [
    { startedAt: weeksAgo(20), balls: 80 },
    { startedAt: weeksAgo(2), balls: 50 }, { startedAt: weeksAgo(1), balls: 60 }, { startedAt: weeksAgo(0), balls: 70 },
  ];
  const rounds = [round(19, 14), round(5, 12), round(3, 11), round(1, 9), round(0, 8)];
  const out = computePracticeImpact({ sessions, rounds, nowMs: NOW } as never);

  it('reaches back to week 20 and keeps both lines the same length (slot i is the same week)', () => {
    expect(out.practiceSeries).toHaveLength(21);
    expect(out.scoreWeekly).toHaveLength(21);
    expect(out.practiceSeries[0]).toBe(80);
  });

  it('the drop-off is on the axis: zero practice, and no round is a gap (never a fabricated score)', () => {
    expect(out.practiceSeries.slice(2, 15).every((v) => v === 0)).toBe(true);
    expect(out.scoreWeekly[10]).toBeNull();
  });
});

describe('a long history never changes a verdict', () => {
  const recentSessions = [
    { startedAt: weeksAgo(5), balls: 30 }, { startedAt: weeksAgo(4), balls: 30 },
    { startedAt: weeksAgo(1), balls: 90 }, { startedAt: weeksAgo(0), balls: 90 },
  ];
  const rounds = [round(5, 14), round(4, 13), round(1, 10), round(0, 9)];
  const ancient = [{ startedAt: weeksAgo(40), balls: 500 }, { startedAt: weeksAgo(30), balls: 500 }];

  it('practice: the same connection and headline with or without old history', () => {
    const recent = computePracticeImpact({ sessions: recentSessions, rounds, nowMs: NOW } as never);
    const long = computePracticeImpact({ sessions: [...ancient, ...recentSessions], rounds, nowMs: NOW } as never);
    expect(long.practiceSeries.length).toBeGreaterThan(recent.practiceSeries.length);
    expect(long.connection).toEqual(recent.connection);
    expect(long.headline).toBe(recent.headline);
    expect(long.hasEnough).toBe(recent.hasEnough);
  });

  it('training: the same connection and headline with or without old history', () => {
    const w = (wk: number) => ({ date: weeksAgo(wk), durationMin: 45 });
    const recentW = [w(5), w(4), w(1), w(0), w(0)];
    const recent = computeWorkoutPerformance({ workouts: recentW, rounds, nowMs: NOW });
    const long = computeWorkoutPerformance({ workouts: [w(50), w(40), ...recentW], rounds, nowMs: NOW });
    expect(long.workoutSeries.length).toBeGreaterThan(recent.workoutSeries.length);
    expect(long.connection).toEqual(recent.connection);
    expect(long.headline).toBe(recent.headline);
  });

  it('points: the same headline with or without old history', () => {
    const s = (wk: number) => ({ startedAt: weeksAgo(wk), swings: 40 });
    const recentS = [s(5), s(4), s(1), s(0)];
    const recent = computePointsPerformance({ sessions: recentS, rounds, nowMs: NOW } as never);
    const long = computePointsPerformance({ sessions: [s(60), ...recentS], rounds, nowMs: NOW } as never);
    expect(long.pointsSeries.length).toBeGreaterThan(recent.pointsSeries.length);
    expect(long.headline).toBe(recent.headline);
  });
});

describe('the dashboard scrolls the chart and opens on this week', () => {
  const dash = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/dashboard.tsx'), 'utf8');
  it('the chart sits in a horizontal ScrollView that scrolls to the end, as wide as its weeks', () => {
    expect(dash).toMatch(/<ScrollView\s+horizontal[\s\S]{0,200}ref=\{progressScrollRef\}[\s\S]{0,200}scrollToEnd\(\{ animated: false \}\)[\s\S]{0,400}<TrendChart/);
    expect(dash).toMatch(/width=\{Math\.max\(chartW, Math\.round\(\(chartW \/ WEEKS\) \* activeProgress\.score\.length\)\)\}/);
  });
});
