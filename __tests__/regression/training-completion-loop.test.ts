/**
 * 2026-08-12 (Tim) — "Of course build the completion loop. I asked multiple times to tie in exercise
 * tracking and warm ups pre round to performance metrics."
 *
 * He had asked repeatedly, and the reason it never landed is worth naming: the pieces all existed and
 * none of them touched. The dashboard has prescribed fault-targeted exercises since July. The workout
 * ledger has existed since July. computeWorkoutPerformance has charted training volume against
 * score-vs-par since July. But the ledger could ONLY be filled by importing a SmartPump export
 * document — so the correlation rail was structurally unable to see the training the app itself
 * prescribed, and nothing you did in the app could ever reach it. The loop wasn't missing a feature,
 * it was missing a WRITE.
 *
 * Same for warm-ups: completing one already awarded points and recorded a practice session, but
 * neither of those can answer "did I score better on the rounds I warmed up for" — points aren't
 * timestamped against a tee time, and practice sessions aren't strokes.
 */
import { computeWarmupPerformance, WARMUP_WINDOW_MS } from '../../services/practice/warmupPerformance';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const t0 = 1_760_000_000_000;

/** n rounds, alternating warmed/cold by the caller's predicate. */
const rounds = (specs: { day: number; score: number }[]) =>
  specs.map(s => ({ startedAt: t0 + s.day * DAY, scoreVsPar: s.score }));

describe('warm-up vs score is a paired comparison, not a trend', () => {
  it('says nothing until there are enough rounds on BOTH sides', () => {
    const r = computeWarmupPerformance({
      warmups: [{ completedAt: t0 - HOUR }],
      rounds: rounds([{ day: 0, score: 8 }, { day: 1, score: 9 }, { day: 2, score: 10 }, { day: 3, score: 11 }]),
    });
    expect(r.enough).toBe(false);
    expect(r.headline).toBeNull();
  });

  it('reports the difference in STROKES once both sides have 3+ rounds', () => {
    const warmDays = [0, 1, 2];
    const coldDays = [10, 11, 12];
    const r = computeWarmupPerformance({
      warmups: warmDays.map(d => ({ completedAt: t0 + d * DAY - HOUR })),
      rounds: rounds([
        ...warmDays.map(d => ({ day: d, score: 6 })),
        ...coldDays.map(d => ({ day: d, score: 10 })),
      ]),
    });
    expect(r.enough).toBe(true);
    expect(r.withCount).toBe(3);
    expect(r.withoutCount).toBe(3);
    expect(r.deltaStrokes).toBe(4); // 10 - 6, positive = better warmed up
    expect(r.headline).toContain('4 strokes better');
  });

  it('a warm-up AFTER the first tee belongs to no round', () => {
    // Otherwise a mid-round tap could rewrite that round's history.
    const r = computeWarmupPerformance({
      warmups: [0, 1, 2].map(d => ({ completedAt: t0 + d * DAY + HOUR })), // an hour AFTER each tee
      rounds: rounds([0, 1, 2, 3, 4, 5].map(d => ({ day: d, score: 8 }))),
    });
    expect(r.withCount).toBe(0);
  });

  it('a warm-up from yesterday does not count for today', () => {
    const r = computeWarmupPerformance({
      warmups: [{ completedAt: t0 - (WARMUP_WINDOW_MS + HOUR) }],
      rounds: rounds([{ day: 0, score: 8 }]),
    });
    expect(r.withCount).toBe(0);
  });

  it('drops rounds with no known par rather than treating them as level', () => {
    const r = computeWarmupPerformance({
      warmups: [0, 1, 2].map(d => ({ completedAt: t0 + d * DAY - HOUR })),
      rounds: [
        ...rounds([0, 1, 2].map(d => ({ day: d, score: 6 }))),
        ...rounds([10, 11, 12].map(d => ({ day: d, score: 10 }))),
        { startedAt: t0 + 20 * DAY, scoreVsPar: null },
      ],
    });
    expect(r.withCount + r.withoutCount).toBe(6);
  });

  it('calls a rounding-level difference what it is, rather than a finding', () => {
    const r = computeWarmupPerformance({
      warmups: [0, 1, 2].map(d => ({ completedAt: t0 + d * DAY - HOUR })),
      rounds: rounds([
        ...[0, 1, 2].map(d => ({ day: d, score: 8 })),
        ...[10, 11, 12].map(d => ({ day: d, score: 8 })),
      ]),
    });
    expect(r.headline).toContain('No scoring difference yet');
  });

  it('never claims causation', () => {
    const r = computeWarmupPerformance({
      warmups: [0, 1, 2].map(d => ({ completedAt: t0 + d * DAY - HOUR })),
      rounds: rounds([
        ...[0, 1, 2].map(d => ({ day: d, score: 6 })),
        ...[10, 11, 12].map(d => ({ day: d, score: 10 })),
      ]),
    });
    for (const word of ['because', 'caused', 'improves your', 'will lower']) {
      expect((r.headline ?? '').toLowerCase()).not.toContain(word);
    }
  });
});

describe('the write that was missing', () => {
  const store = read('store/workoutStore.ts');

  it('the ledger accepts in-app completions, not just imports', () => {
    expect(store).toContain("source: 'smartpump' | 'manual' | 'in_app_exercise' | 'preround_warmup';");
    expect(store).toContain('logCompleted: (entry: {');
  });

  it('two warm-ups in one day both survive — that is a 36-hole day, not a double-count', () => {
    // Day-granular dedupe is right for overlapping EXPORTS and wrong for in-app entries; collapsing
    // them would silently lose the second round's warm-up, the exact thing being measured.
    expect(store).toContain("if (source === 'smartpump' || source === 'manual') {");
    expect(store).toContain('return `${dateMs}::${t}`;');
  });

  it('reports whether it actually stored, so a double-tap cannot claim two sessions', () => {
    expect(store).toContain('return added > 0;');
  });
});

describe('both surfaces actually write', () => {
  it('the dashboard exercise card can be marked done', () => {
    const dash = read('app/(tabs)/dashboard.tsx');
    expect(dash).toContain("kind: 'in_app_exercise'");
    expect(dash).toContain('MARK DONE');
    // Confirmation only on a real write.
    expect(dash).toContain('if (ok) {');
  });

  it('completing a pre-round warm-up reaches the ledger with its real time', () => {
    const pre = read('app/practice/preround.tsx');
    expect(pre).toContain("kind: 'preround_warmup'");
    expect(pre).toContain('at: now,');
  });

  it('the dashboard reads the comparison back and stays quiet without evidence', () => {
    const dash = read('app/(tabs)/dashboard.tsx');
    expect(dash).toContain('computeWarmupPerformance({');
    expect(dash).toContain("w.source === 'preround_warmup'");
    expect(dash).toContain('{warmupPerf.enough && !!warmupPerf.headline && (');
  });

  it('in-app training feeds the existing volume rail too — one ledger, not a parallel one', () => {
    // logCompleted writes WorkoutRecords, so computeWorkoutPerformance picks them up unchanged.
    expect(read('store/workoutStore.ts')).toContain('const added = get().addWorkouts([{');
  });
});
