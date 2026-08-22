import { computeWorkoutSwingImpact } from '../../services/practice/workoutSwingImpact';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const NOW = 1_700_000_000_000;
const weeksAgo = (n: number, offsetDays = 1) => NOW - n * WEEK - offsetDays * DAY;

/**
 * 2026-08-22 (Tim — "a data point to see if working out towards that swing is also touching or
 * helping"). Owner-only rail. Association, never causation, and quiet until both sides are real.
 */
describe('does the gym work show up in the strike', () => {
  it('says nothing at all on thin data, and says WHAT is missing', () => {
    const r = computeWorkoutSwingImpact({ workouts: [], sessions: [], nowMs: NOW });
    expect(r.hasEnough).toBe(false);
    // A blank card reads as broken; "not enough data" with no number is the same as no answer.
    expect(r.headline).toMatch(/3 more workouts/);
    expect(r.headline).toMatch(/20 more graded swings/);
  });

  it('needs both sides present in the SAME weeks, not just present somewhere', () => {
    // Plenty of both, but the training and the range time never overlap.
    const r = computeWorkoutSwingImpact({
      workouts: [0, 1, 2].map(i => ({ date: weeksAgo(i), durationMin: 60 })),
      sessions: [3, 4, 5].map(i => ({ date: weeksAgo(i), clean: 8, graded: 10 })),
      nowMs: NOW,
    });
    expect(r.weeksWithBoth).toBe(0);
    expect(r.hasEnough).toBe(false);
  });

  it('pools by week so a 3-swing session cannot outweigh a 60-swing one', () => {
    const r = computeWorkoutSwingImpact({
      workouts: [{ date: weeksAgo(0), durationMin: 60 }],
      sessions: [
        { date: weeksAgo(0), clean: 3, graded: 3 },   // 100%, tiny
        { date: weeksAgo(0), clean: 27, graded: 60 }, // 45%, real
      ],
      nowMs: NOW,
    });
    // Pooled: 30/63 = 48%. Averaging the two sessions would have said 72%.
    expect(r.strikeSeries[5]).toBe(48);
  });

  it('a week with almost no swings is marked no-data, not a 0% strike rate', () => {
    const r = computeWorkoutSwingImpact({
      workouts: [{ date: weeksAgo(0), durationMin: 60 }],
      sessions: [{ date: weeksAgo(0), clean: 0, graded: 2 }],
      nowMs: NOW,
    });
    expect(r.strikeWeekHasData[5]).toBe(false);
    expect(r.weeksWithBoth).toBe(0);
  });

  it('unknown reads lower neither the rate nor the confidence in it', () => {
    // 10 swings, only 6 gradeable, 5 of those clean → 83%, not 50%.
    const r = computeWorkoutSwingImpact({
      workouts: [{ date: weeksAgo(0), durationMin: 60 }],
      sessions: [{ date: weeksAgo(0), clean: 5, graded: 6 }],
      nowMs: NOW,
    });
    expect(r.strikeSeries[5]).toBe(83);
  });

  it('reports training up + striking up without claiming one caused the other', () => {
    const r = computeWorkoutSwingImpact({
      workouts: [
        ...[5, 4, 3].map(i => ({ date: weeksAgo(i), durationMin: 30 })),
        ...[2, 1, 0].map(i => ({ date: weeksAgo(i), durationMin: 90 })),
      ],
      sessions: [
        ...[5, 4, 3].map(i => ({ date: weeksAgo(i), clean: 10, graded: 20 })), // 50%
        ...[2, 1, 0].map(i => ({ date: weeksAgo(i), clean: 15, graded: 20 })), // 75%
      ],
      nowMs: NOW,
    });
    expect(r.hasEnough).toBe(true);
    expect(r.headline).toMatch(/showing in the contact/);
    expect(r.headline).not.toMatch(/caused|because of|proves/i);
  });

  it('reads a drop under heavier training as fatigue, not a broken swing', () => {
    const r = computeWorkoutSwingImpact({
      workouts: [
        ...[5, 4, 3].map(i => ({ date: weeksAgo(i), durationMin: 20 })),
        ...[2, 1, 0].map(i => ({ date: weeksAgo(i), durationMin: 120 })),
      ],
      sessions: [
        ...[5, 4, 3].map(i => ({ date: weeksAgo(i), clean: 16, graded: 20 })), // 80%
        ...[2, 1, 0].map(i => ({ date: weeksAgo(i), clean: 10, graded: 20 })), // 50%
      ],
      nowMs: NOW,
    });
    expect(r.headline).toMatch(/fatigue/);
  });

  it('counts sessions when durations are missing rather than inventing minutes', () => {
    const r = computeWorkoutSwingImpact({
      workouts: [0, 1, 2].map(i => ({ date: weeksAgo(i), durationMin: null })),
      sessions: [0, 1, 2].map(i => ({ date: weeksAgo(i), clean: 10, graded: 20 })),
      nowMs: NOW,
    });
    expect(r.metric).toBe('sessions');
    expect(r.workoutSeries[5]).toBe(1);
  });

  it('never throws on junk', () => {
    const junk = {
      workouts: [{ date: NaN, durationMin: -5 }, null as never],
      sessions: [{ date: NaN, clean: 5, graded: 0 }, null as never],
      nowMs: NOW,
    };
    expect(() => computeWorkoutSwingImpact(junk)).not.toThrow();
  });

  it('clamps a clean count that exceeds the graded count', () => {
    const r = computeWorkoutSwingImpact({
      workouts: [{ date: weeksAgo(0), durationMin: 60 }],
      sessions: [{ date: weeksAgo(0), clean: 999, graded: 20 }],
      nowMs: NOW,
    });
    expect(r.strikeSeries[5]).toBe(100);
  });
});

describe('it is a GRAPH, owner-only, read the way a player reads it', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');
  const dash = read('app/(tabs)/dashboard.tsx');

  /**
   * 2026-08-22 (Tim) — "owner only is me seeing it graphically and seeing it how they would see it,
   * not a text line. That's not gonna let me compare anything." A text strip cannot answer whether
   * two lines move together, which is the entire question.
   */
  it('is a source on the PROGRESS graph, not a text readout in Settings', () => {
    expect(dash).toMatch(/computeWorkoutSwingImpact/);
    expect(dash).toMatch(/key: 'strike', tab: 'Strike'/);
    expect(read('app/settings.tsx')).not.toMatch(/WorkoutSwingImpactRow/);
  });

  it('is owner-gated, so testers without SmartPump never see the tab', () => {
    expect(dash).toMatch(/if \(isOwner && workoutHistory\.length > 0\)/);
  });

  it('plots strike rate with HIGHER as better — the axis is per-source now', () => {
    // It was hardcoded to score-vs-par (lower is better) in the JSX. On a percentage that would have
    // drawn a rising strike rate as a decline.
    expect(dash).toMatch(/scoreLabel: 'STRIKE RATE'/);
    expect(dash).toMatch(/scoreHigherIsBetter: true/);
    expect(dash).toMatch(/higherIsBetter=\{activeProgress\.scoreHigherIsBetter\}/);
    expect(dash).toMatch(/label=\{activeProgress\.scoreLabel\}/);
  });

  it('leaves the three existing sources judged the way they always were', () => {
    const vsPar = dash.match(/scoreLabel: 'SCORE VS PAR'/g) ?? [];
    expect(vsPar.length).toBe(3);
    expect(dash).not.toMatch(/scoreHigherIsBetter: false,\s*\n\s*\}\);\s*\n\s*\}\s*\n\s*return list/);
  });

  it('plots only weeks that carry a strike rate, and aligns training to the SAME weeks', () => {
    // A week with no range time is not a 0% strike week; drawing it as one invents a collapse.
    expect(dash).toMatch(/const keep = workoutSwing\.strikeWeekHasData;/);
    expect(dash).toMatch(/strikeSeries\.filter\(\(_, i\) => keep\[i\]\)/);
    expect(dash).toMatch(/workoutSeries\.filter\(\(_, i\) => keep\[i\]\)/);
  });

  it('counts only the account holder’s own swings', () => {
    expect(dash).toMatch(/resolvePlayerName\(sess\.player_id, '__self__'\) === '__self__'/);
  });

  it('excludes ungraded swings rather than scoring them as misses', () => {
    expect(dash).toMatch(/c === 'unknown'/);
  });
});
