/**
 * 2026-09-10 — MARK GREEN ON THE BACK NINE OF A NINE PLAYED TWICE WENT NOWHERE.
 *
 * A nine-hole course played twice presents holes 1-18 over nine physical greens. Hole 12's green IS
 * hole 3's green. Three different answers to "which hole does a player's own mark live under"
 * coexisted:
 *   - every WRITER used the raw round hole (mark-green, gpsMarkOverride, openToolHandler,
 *     declareHoleHandler, smartvision, CourseTruth) — so Mark Green on 12 stored hole 12;
 *   - smartFinderService.resolveGreenCoords / resolveTeeCoords WRAPPED — they looked under hole 3
 *     and never found it;
 *   - getAnchoredHoleLengthYards did NOT wrap — it looked under 12 and did.
 *
 * The player walked to the green, tapped Mark Green, got "Green marked: hole 12", and the yardage
 * did not move. And a mark made on hole 3 in loop one silently answered for hole 12 with no way to
 * correct it.
 *
 * The rule now lives inside the override storage, so writers and readers agree by construction.
 */
import { personalHoleKey } from '../../services/personalHoleKey';
import { useRoundStore } from '../../store/roundStore';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

describe('a mark on the second loop is a mark on the same green', () => {
  afterEach(() => useRoundStore.setState({ twiceAround: false }));

  it('wraps the back nine onto the physical hole when the round is a nine played twice', () => {
    useRoundStore.setState({ twiceAround: true });
    expect(personalHoleKey(12)).toBe(3);
    expect(personalHoleKey(10)).toBe(1);
    expect(personalHoleKey(18)).toBe(9);
  });

  it('leaves the front nine alone', () => {
    useRoundStore.setState({ twiceAround: true });
    expect(personalHoleKey(1)).toBe(1);
    expect(personalHoleKey(9)).toBe(9);
  });

  it('does NOT wrap a real eighteen', () => {
    useRoundStore.setState({ twiceAround: false });
    expect(personalHoleKey(12)).toBe(12);
    expect(personalHoleKey(18)).toBe(18);
  });

  it('is idempotent, so a caller that already wrapped cannot be broken by this', () => {
    useRoundStore.setState({ twiceAround: true });
    expect(personalHoleKey(personalHoleKey(12))).toBe(3);
  });

  it('never throws when there is no round', () => {
    // A storage module must not depend on a round being in progress.
    expect(() => personalHoleKey(12)).not.toThrow();
    expect(Number.isFinite(personalHoleKey(12))).toBe(true);
  });

  it('both override stores normalise at their entry points', () => {
    for (const f of ['services/courseGreenOverrides.ts', 'services/courseTeeOverrides.ts']) {
      const src = read(f);
      expect(src).toContain("import { personalHoleKey } from './personalHoleKey'");
      // get, set, clear and the hook all take a hole and all must agree
      const normalised = (src.match(/hole = (?:hole == null \? null : )?personalHoleKey\(hole\)/g) ?? []).length;
      expect(normalised).toBeGreaterThanOrEqual(4);
    }
  });

  it('smartFinderService no longer keeps its own copy of the rule', () => {
    const src = read('services/smartFinderService.ts');
    expect(src).toContain("import { personalHoleKey } from './personalHoleKey'");
    expect(src).not.toMatch(/twiceAround === true && holeNumber >= 10\) \? holeNumber - 9/);
  });
});
