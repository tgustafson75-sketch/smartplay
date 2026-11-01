/**
 * 2026-11-01 — THE GOLF WORKOUT IS REACHABLE FROM THE PRACTICE LIST AND FEEDS THE LEDGER.
 *
 * A screen nothing links to, or a session that never reaches the workout history, is built but not
 * reachable. This pins the path: the Swing Lab card, the screen, the paywall seam it calls, the
 * ledger write it makes, and the translation keys it reads. Comments are stripped before matching.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) =>
  fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:\w])\/\/[^\n]*/g, '');

const swinglab = code('app/(tabs)/swinglab.tsx');
const screen = code('app/golf-workout.tsx');
const store = code('store/golfWorkoutStore.ts');
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/locales/en.json'), 'utf8'));

describe('the golf workout is reachable', () => {
  it('has a card on the Swing Lab practice list that routes to the screen', () => {
    expect(swinglab).toMatch(/route:\s*'\/golf-workout'/);
  });

  it('the route exists as a screen file', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/golf-workout.tsx'))).toBe(true);
  });
});

describe('the screen uses the paywall seam and the shared ledger', () => {
  it('asks the paywall seam before rendering', () => {
    expect(screen).toMatch(/golfWorkoutUnlocked\(\)/);
  });

  it('completes a session through the store, which writes the workout history', () => {
    expect(screen).toMatch(/completeSession\(\{/);
    expect(store).toMatch(/useWorkoutStore\.getState\(\)\.logCompleted\(\{\s*kind: 'golf_workout'/);
  });

  it('logs each working set and computes Rx progress from the logged sets', () => {
    expect(screen).toMatch(/logSet\(\{ exerciseId, weight, reps \}\)/);
    expect(screen).toMatch(/computeRxProgress\(activeRx, loggedSets\)/);
  });

  it('the Swing Rx block is a session you can log, built from the prescription', () => {
    expect(screen).toMatch(/buildRxSession\(activeRx, undefined\)/);
    expect(screen).toMatch(/openSession\(RX_KEY\)/);
  });

  it('shows sets per performance quality, from the golf block and Rx movements', () => {
    expect(screen).toMatch(/QUALITY_BY_MOVEMENT\[set\.payload\.exerciseId\] \?\? RX_EXTRA_MOVEMENT_QUALITY/);
    expect(screen).toMatch(/QUALITY_ORDER\.map\(/);
  });

  it('explains a rejected Swing Rx import instead of a generic message', () => {
    expect(screen).toMatch(/parseFailureMessage\(res\.result\.reason, res\.result\.detail\)/);
  });

  it('never logs warm-up sets', () => {
    expect(screen).toMatch(/if \(s\.isWarmup\) \{/);
  });
});

describe('every translation key the screen reads exists', () => {
  it('all t(golf_workout.*) keys are in en.json', () => {
    const golf = en.golf_workout;
    const used = [...screen.matchAll(/t\('golf_workout\.(\w+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(5);
    for (const key of used) expect(typeof golf[key]).toBe('string');
  });
});
