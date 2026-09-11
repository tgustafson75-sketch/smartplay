/**
 * 2026-09-11 — PATTERN INSIGHTS SCORED SHOTS AGAINST THE WRONG COURSE.
 *
 * `generatePatternInsights(shots, { courseHoles, scores, … })` decides which shots were played under
 * pressure by comparing each hole's score to its PAR. Commit 8d84ac50 ("one truth for the hole")
 * replaced the caller-supplied lookup
 *     courseHoles.find(h => h.hole === shot.hole)?.par
 * with `smartFinderService.holePar(shot.hole)`, which resolves against `useRoundStore.getState()` —
 * the round happening RIGHT NOW.
 *
 * All five callers pass `courseHoles`. After that change the parameter was declared, destructured,
 * and never read, so pressure detection used whatever course the player was standing on, and `?? 4`
 * when no round was live. It reaches the brain: services/caddieRequestBody is the single payload
 * builder, so the caddie's read on "where you miss under pressure" came from the wrong hole.
 *
 * It also broke `npm run user-sim` outright — patternDetection is pure analysis, and the new import
 * dragged the round store (and React Native) in behind it, so the 100-player harness could not even
 * load. A diagnostic that cannot run is not a diagnostic that passes.
 *
 * Two guards: the par must come from the shots' OWN course, and this module must stay loadable
 * outside React Native.
 */
import fs from 'fs';
import path from 'path';
import { generatePatternInsights } from '../../services/patternDetection';
import type { ShotResult, CourseHole } from '../../store/roundStore';

/**
 * COMMENT-STRIPPED. The first version of this file asserted against raw source and passed by
 * matching the explanatory comment inside patternDetection that QUOTES the old expression — a guard
 * satisfied by its own documentation, which is the failure mode this very bug was found alongside.
 */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
const src = code(fs.readFileSync(path.join(__dirname, '../../services/patternDetection.ts'), 'utf8'));

describe('pattern insights read the shots\' own course', () => {
  it('resolves par through the pure owner, not the live-round service', () => {
    expect(src).not.toMatch(/from '\.\/smartFinderService'/);
    expect(src).toMatch(/from '\.\/holeParLookup'/);
    expect(src).toMatch(/parForHole\(courseHoles, shot\.hole\)/);
  });

  it('never invents a par for a hole it has no data for', () => {
    // `?? 4` is how an unknown hole becomes a fact three layers downstream.
    expect(src).not.toMatch(/\?\?\s*4/);
    expect(src).toMatch(/if \(par == null\) return false;/);
  });

  it('stays free of React-Native-only imports, so the harness can load it', () => {
    // patternDetection is pure analysis. An import that reaches react-native/AsyncStorage makes
    // `npm run user-sim` fail to transform before a single player is simulated.
    expect(src).not.toMatch(/from 'react-native'/);
    expect(src).not.toMatch(/@react-native-async-storage/);
  });

  /** A par-3 where the player made 5 is pressure; the same 5 on a par-5 is not. */
  const shots = (holes: number[]): ShotResult[] =>
    holes.map((h, i) => ({ hole: h, direction: i % 2 === 0 ? 'right' : 'left' } as unknown as ShotResult));

  it('uses the SUPPLIED par, so the same score reads differently on a par 3 and a par 5', () => {
    const holes = [1, 2, 3, 4, 5, 6];
    const scores = Object.fromEntries(holes.map(h => [h, 7]));   // a 7 on every hole

    const asPar3 = generatePatternInsights(shots(holes), {
      currentRoundMode: 'free_play', scores,
      courseHoles: holes.map(h => ({ hole: h, par: 3 } as CourseHole)),
    });
    const asPar5 = generatePatternInsights(shots(holes), {
      currentRoundMode: 'free_play', scores,
      courseHoles: holes.map(h => ({ hole: h, par: 5 } as CourseHole)),
    });

    // free_play counts a hole as pressure when (score - par) > 2.
    // 7 on a par 3 is +4 → pressure on all six holes, so a direction can be read.
    // 7 on a par 5 is +2 → NOT pressure (the comparison is strict), so there are none.
    expect(asPar3.raw_stats.miss_tendency_under_pressure).not.toBe('insufficient_data');
    expect(asPar5.raw_stats.miss_tendency_under_pressure).toBe('insufficient_data');
  });

  it('is not silently rescued by the ?? 4 fallback when courseHoles is supplied', () => {
    const holes = [1, 2, 3, 4, 5, 6];
    const scores = Object.fromEntries(holes.map(h => [h, 6]));   // a 6 on every hole
    // Par 4 would make these +2 (not > 2, so not pressure). Par 3 makes them +3 → pressure.
    const supplied = generatePatternInsights(shots(holes), {
      currentRoundMode: 'free_play', scores,
      courseHoles: holes.map(h => ({ hole: h, par: 3 } as CourseHole)),
    });
    expect(supplied.raw_stats.miss_tendency_under_pressure).not.toBe('insufficient_data');
  });
});
