/**
 * 2026-09-11 (Tim, full-app audit) — REPAIRING THE ROUNDS THAT NEVER COUNTED.
 *
 * New rounds post correctly now. Historical ones carry the old basis, and two populations of them
 * are wrong in ways they cannot fix themselves:
 *   - 7-8 and 10-13 hole rounds have NO posting basis, so eligibleHandicapRounds drops them and they
 *     have never contributed to the Index at all;
 *   - 9s and 18s predating the WHS posting score post their RAW total, so a blow-up hole is still
 *     inflating the Index with no net-double-bogey cap.
 *
 * Tim's call: the repair goes behind the explicit Recalculate button, not a silent migration,
 * because it moves a number he may have quoted to a club.
 */
import { repairedPostingBasis } from '../../services/handicapCalculator';

const pars18 = () => Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4]));
const scored = (n: number, v = 5) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, v]));

describe('what gets repaired', () => {
  it('an eleven-hole round gains a NINE-hole basis — it had none at all', () => {
    const b = repairedPostingBasis({ holesPlayed: 11, holePars: pars18(), scores: scored(11) }, 16);
    expect(b).not.toBeNull();
    expect(b!.handicapHoles).toBe(9);
    expect(b!.handicapAgs).toBeGreaterThan(0);
  });

  it('a legacy eighteen gains a CAPPED basis instead of its raw total', () => {
    // Two nines on par 4s. A 16 handicap gets a stroke a hole → net double bogey is 7.
    const sc = { ...scored(18), 3: 9, 14: 9 };
    const raw = Object.values(sc).reduce((a, b2) => a + b2, 0);
    const b = repairedPostingBasis({ holesPlayed: 18, holePars: pars18(), scores: sc }, 16);
    expect(b!.handicapHoles).toBe(18);
    expect(b!.handicapAgs).toBeLessThan(raw);
  });
});

describe('what is left alone', () => {
  it('a round that already carries a basis — overwriting a correct stamp would be a regression', () => {
    expect(repairedPostingBasis(
      { holesPlayed: 18, handicapHoles: 18, handicapAgs: 88, holePars: pars18(), scores: scored(18) }, 16,
    )).toBeNull();
  });

  it('a sim round', () => {
    expect(repairedPostingBasis(
      { simulated: true, holesPlayed: 18, holePars: pars18(), scores: scored(18) }, 16,
    )).toBeNull();
  });

  it('an import, which has a score but no per-hole data to repair from', () => {
    expect(repairedPostingBasis(
      { id: 'imported_123', holesPlayed: 18, holePars: pars18(), scores: scored(18) }, 16,
    )).toBeNull();
  });

  it('a round with no stored pars or scores', () => {
    expect(repairedPostingBasis({ holesPlayed: 18, holePars: null, scores: scored(18) }, 16)).toBeNull();
    expect(repairedPostingBasis({ holesPlayed: 18, holePars: pars18(), scores: null }, 16)).toBeNull();
  });

  it('a round under the WHS minimum — six holes is not a score', () => {
    expect(repairedPostingBasis({ holesPlayed: 6, holePars: pars18(), scores: scored(6) }, 16)).toBeNull();
  });
});

describe('it is deterministic once stamped', () => {
  it('re-running it changes nothing, because the second pass sees a basis', () => {
    const r = { holesPlayed: 11, holePars: pars18(), scores: scored(11) } as Record<string, unknown>;
    const first = repairedPostingBasis(r as never, 16)!;
    const stamped = { ...r, ...first };
    expect(repairedPostingBasis(stamped as never, 16)).toBeNull();
  });
});

describe('the wiring respects the decision', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').join(__dirname, '../../', p), 'utf8') as string;

  it('Settings and Profile repair through the one helper', () => {
    expect(read('app/settings.tsx')).toMatch(/recalculateHandicapRounds\(\)/);
    expect(read('app/profile.tsx')).toMatch(/recalculateHandicapRounds\(\)/);
  });

  it('the automatic post-import recompute does NOT repair — that would be the silent migration', () => {
    /**
     * Comments stripped FIRST. The explanatory note I left in that file names
     * recalculateHandicapRounds, so asserting over raw source failed on my own prose — which is
     * the exact way a guard is defeated by the comment describing it.
     * [[my-own-comment-defeats-my-own-guard]] [[strip-comments-before-a-guard-matches]]
     */
    const imp = read('app/import-rounds-list.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(imp).not.toMatch(/recalculateHandicapRounds/);
    expect(imp).toMatch(/eligibleHandicapRounds\(all\)/);
  });

  it('Settings tells the player what the repair did, so a moved Index is never a mystery', () => {
    const st = read('app/settings.tsx');
    expect(st).toMatch(/repairNote/);
    expect(st).toMatch(/had never counted toward your Index/);
  });

  it('the stale "partial rounds aren’t counted" copy is gone — it is no longer true', () => {
    expect(read('app/settings.tsx')).not.toMatch(/Partial rounds \(10-17 holes\) aren/);
  });
});
