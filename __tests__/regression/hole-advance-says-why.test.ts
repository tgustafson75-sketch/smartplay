import * as fs from 'fs';
import * as path from 'path';
const src = fs.readFileSync(path.resolve(__dirname, '../../store/roundStore.ts'), 'utf-8');

/**
 * 2026-08-23 (Tim — "I'll log the score for this hole, and then I'm sitting next to the next hole,
 * but it hasn't detected").
 *
 * Four separate conditions hold the score-driven advance and they have four different fixes. The
 * else branch was silent, so every report of "it didn't advance" was another round of guessing.
 */
describe('a skipped hole advance names its reason', () => {
  it('reports which of the four gates held it', () => {
    expect(src).toMatch(/hole_advance_skipped/);
    for (const r of ['setting_off', 'round_not_active', 'scored_a_different_hole', 'already_last_hole']) {
      expect(src).toContain(`'${r}'`);
    }
  });

  it('carries the numbers needed to tell them apart', () => {
    expect(src).toMatch(/scoredHole: hole/);
    expect(src).toMatch(/currentHole: st\.currentHole/);
    expect(src).toMatch(/lastHole: holesN/);
  });

  it('is a diag breadcrumb, not a mailed error', () => {
    // A skipped advance is usually correct behaviour (editing an old hole). It must not read as a
    // failure the player has to act on, but it must be visible when they say it misbehaved.
    const at = src.indexOf('hole_advance_skipped');
    expect(src.slice(at, at + 700)).toMatch(/'diag'/);
  });

  it('the advance itself still goes through the canonical seam', () => {
    // A raw set({currentHole}) would bypass closeHoleEndLocation, the nineHole clamp and the
    // yardage reset — the 2026-07-01 audit finding.
    expect(src).toMatch(/get\(\)\.setCurrentHole\(hole \+ 1\)/);
    expect(src).toMatch(/const holesN = roundLastHole\(st\)/);
  });
});
