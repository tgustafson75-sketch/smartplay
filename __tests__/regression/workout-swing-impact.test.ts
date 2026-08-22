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

describe('the rail is owner-only and actually rendered', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const settings = fs.readFileSync(path.resolve(__dirname, '../../app/settings.tsx'), 'utf-8');

  it('renders inside Owner Tools, not on a tester-facing surface', () => {
    expect(settings).toMatch(/<WorkoutSwingImpactRow colors=\{colors\} \/>/);
    // It must sit AFTER the isOwnerEmail gate that opens the Owner Tools section, so testers --
    // none of whom have SmartPump -- never see a card that can only say "no data".
    const gate = settings.indexOf('const showOwner = isOwnerEmail(profile.email)');
    expect(gate).toBeGreaterThan(-1);
    expect(settings.indexOf('<WorkoutSwingImpactRow')).toBeGreaterThan(gate);
  });

  it('counts only the account holder’s own swings', () => {
    // A student's swings land in the same sessionHistory in Family/Coach mode; crediting Tim's gym
    // work with someone else's strike rate would be worse than showing nothing.
    expect(settings).toMatch(/resolvePlayerName\(sess\.player_id, '__self__'\) === '__self__'/);
  });

  it('excludes ungraded swings rather than scoring them as misses', () => {
    expect(settings).toMatch(/c === 'unknown'/);
  });

  it('does not appear on the dashboard, which every tester sees', () => {
    const dash = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/dashboard.tsx'), 'utf-8');
    expect(dash).not.toMatch(/computeWorkoutSwingImpact/);
  });
});
