/**
 * 2026-09-11 — TWO CARDS ON ONE SCREEN DISAGREED ABOUT WHETHER YOU WARMED UP.
 *
 * Found by sweeping for rules declared in more than one file. app/(tabs)/dashboard renders two
 * warmed-vs-cold comparisons, and they were built from different everything:
 *
 *                        events                          window   anchor
 *   practiceImpact       practice sessions tagged preround   4h    warm-up START
 *   warmupPerformance    workouts tagged preround_warmup     3h    warm-up COMPLETION
 *
 * So the same round could be "warmed" in one card and "cold" in the other, a few hundred pixels
 * apart, both phrased to the player as "when you warm up" — and a golfer who stretches was counted
 * by one and ignored by the other. Neither module was wrong on its own terms. They were two owners
 * of one question. [[two-owners-is-the-root-cause]]
 */
import fs from 'fs';
import path from 'path';
import { wasRoundWarmed, WARMUP_WINDOW_MS } from '../../services/practice/warmupPerformance';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('one rule', () => {
  const HOUR = 60 * 60 * 1000;
  const tee = 1_000_000_000_000;

  it('a warm-up inside the window belongs to the round', () => {
    expect(wasRoundWarmed(tee, [tee - HOUR])).toBe(true);
  });

  it('a warm-up outside it does not', () => {
    expect(wasRoundWarmed(tee, [tee - 5 * HOUR])).toBe(false);
  });

  it('a warm-up logged AFTER the tee belongs to no round — a mid-round tap cannot rewrite history', () => {
    expect(wasRoundWarmed(tee, [tee + 60_000])).toBe(false);
  });

  it('no warm-ups, or no round time, is false rather than a crash', () => {
    expect(wasRoundWarmed(tee, [])).toBe(false);
    expect(wasRoundWarmed(null, [tee - HOUR])).toBe(false);
    expect(wasRoundWarmed(undefined, [tee - HOUR])).toBe(false);
  });

  it('the boundary is inclusive and stated once', () => {
    expect(wasRoundWarmed(tee, [tee - WARMUP_WINDOW_MS])).toBe(true);
    expect(wasRoundWarmed(tee, [tee - WARMUP_WINDOW_MS - 1])).toBe(false);
  });
});

describe('nobody keeps a second copy of it', () => {
  it('practiceImpact no longer declares its own window', () => {
    const src = code('services/practice/practiceImpact.ts');
    expect(src).not.toMatch(/const WARMUP_WINDOW_MS\s*=/);
    expect(src).toMatch(/wasRoundWarmed\(/);
  });

  it('the owner uses its own rule internally, rather than inlining it again', () => {
    const src = code('services/practice/warmupPerformance.ts');
    expect(src).toMatch(/const warmed = wasRoundWarmed\(r\.startedAt, warmups\)/);
    // exactly one place defines the number
    expect((src.match(/WARMUP_WINDOW_MS = /g) || []).length).toBe(1);
  });

  it('no other file in the app declares a warm-up window', () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) {
          if (['node_modules', '.git', 'dist', '.expo', 'ios', 'android', '__tests__'].includes(e.name)) continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name) && p !== './services/practice/warmupPerformance.ts') {
          if (/const WARMUP_WINDOW_MS\s*=/.test(code(p.slice(2)))) offenders.push(p);
        }
      }
    };
    walk('.');
    expect(offenders).toEqual([]);
  });
});

describe('and one set of events — a warm-up is a warm-up', () => {
  const dash = code('app/(tabs)/dashboard.tsx');

  it('the screen builds ONE warm-up list', () => {
    expect(dash).toMatch(/const warmupEvents = useMemo\(/);
    // from BOTH sources: a pre-round practice session AND a pre-round workout
    const at = dash.indexOf('const warmupEvents = useMemo(');
    const block = dash.slice(at, at + 700);
    expect(block).toMatch(/s\.focus === 'preround' \|\| s\.environment === 'preround'/);
    expect(block).toMatch(/w\.source === 'preround_warmup'/);
  });

  it('both cards read that one list', () => {
    expect(dash).toMatch(/warmups: warmupEvents\.map\(\(t\) => \(\{ startedAt: t \}\)\)/);
    expect(dash).toMatch(/warmups: warmupEvents\.map\(\(t\) => \(\{ completedAt: t \}\)\)/);
  });

  it('neither card filters its own events any more', () => {
    // The two hand-rolled filters are what made them different questions.
    expect(dash).not.toMatch(/warmups: practiceHistory\s*\n?\s*\.filter/);
    expect(dash).not.toMatch(/warmups: workoutHistory\.filter/);
  });
});
