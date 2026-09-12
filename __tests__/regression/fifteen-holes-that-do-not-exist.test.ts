/**
 * 2026-09-11 (Tim) — "You're gonna have a three-club bag on, like, a par three nine hole course. So
 * that should in and of itself have its own kind of logic."
 *
 * IT HAD NONE, AND THE CADDIE SAID SO OUT LOUD.
 *
 * composePlayProfile budgeted `targetScore - coursePar` off an absolute 89, and bogeyBudgetLine
 * counted the holes left as `18 - holesPlayed`. On a nine-hole par-27 course that is 89 − 27 = 62
 * strokes in hand, and after three holes the caddie offered "58 shots in hand for 15 holes" — a
 * budget nobody could spend, over fifteen holes that were never going to be played.
 *
 * Both halves were the same mistake: the round's own card was sitting right there and neither
 * reader asked it anything.
 */
import { composePlayProfile, bogeyBudgetLine } from '../../services/playProfile';

const profile = (over: Partial<Parameters<typeof composePlayProfile>[0]>) =>
  composePlayProfile({ level: 'simple', goal: 'break_90', ...over });

describe('a nine-hole par-3 course', () => {
  const p = profile({ coursePar: 27, courseHoles: 9 });

  it('does not hand him sixty-two shots in hand', () => {
    expect(p.strokeBudget).toBeGreaterThan(0);
    expect(p.strokeBudget).toBeLessThanOrEqual(12);
  });

  it('targets a score for THIS round, not an eighteen-hole milestone', () => {
    expect(p.targetScore).toBeGreaterThan(27);
    expect(p.targetScore).toBeLessThan(45);
  });

  it('counts the holes that exist', () => {
    expect(p.holeCount).toBe(9);
    const line = bogeyBudgetLine(p, 2, 3);
    expect(line).toContain('6 holes');
    expect(line).not.toContain('15 holes');
  });

  it('says nothing at all once the nine is done, rather than offering nine more', () => {
    expect(bogeyBudgetLine(p, 4, 9)).toBeNull();
    expect(bogeyBudgetLine(p, 4, 12)).toBeNull();   // past the card entirely
  });
});

describe('a nine-hole round on a regulation course', () => {
  const p = profile({ coursePar: 36, courseHoles: 9 });

  it('is half the standard, because the standard is about dropping shots per hole', () => {
    expect(p.strokeBudget).toBe(9);        // half of seventeen, rounded
    expect(p.targetScore).toBe(45);
  });
});

describe('and a full eighteen is completely unchanged', () => {
  it('keeps the literal goal — a man who shoots 89 on a par 70 has broken ninety', () => {
    // Scaling every round to a standard would have moved his goalposts on any course that is not
    // par 72, which is most of them. The shorter round is the only one with no literal reading.
    expect(profile({ coursePar: 72, courseHoles: 18 }).targetScore).toBe(89);
    expect(profile({ coursePar: 70, courseHoles: 18 }).targetScore).toBe(89);
    expect(profile({ coursePar: 71 }).targetScore).toBe(89);            // no hole count given
    expect(profile({ coursePar: 72, courseHoles: 18 }).strokeBudget).toBe(17);
    expect(profile({ coursePar: 70, courseHoles: 18 }).strokeBudget).toBe(19);
  });

  it('still counts eighteen holes when nothing says otherwise', () => {
    const p = profile({ coursePar: 72 });
    expect(p.holeCount).toBe(18);
    expect(bogeyBudgetLine(p, 5, 6)).toContain('12 holes');
  });
});

describe('free play invents no target on any card', () => {
  for (const [par, holes] of [[27, 9], [36, 9], [72, 18]] as [number, number][]) {
    it(`par ${par} over ${holes}`, () => {
      const p = composePlayProfile({ level: 'simple', goal: 'free_play', coursePar: par, courseHoles: holes });
      expect(p.targetScore).toBeNull();
      expect(p.strokeBudget).toBeNull();
      expect(bogeyBudgetLine(p, 3, 4)).toBeNull();
    });
  }
});

describe('the round hands over its own card', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../services/caddieDecision.ts'), 'utf8',
  ) as string;

  it('counts the par and the holes from the SAME rows', () => {
    // Par from courseHoles and the count from the constant 18 is exactly how this broke.
    expect(src).toMatch(/const holeRows = \(r\.courseHoles \?\? \[\]\)\.filter/);
    expect(src).toMatch(/const coursePar = holeRows\.reduce/);
    expect(src).toMatch(/const courseHoles = holeRows\.length > 0/);
    expect(src).toMatch(/courseHoles,/);
  });

  it('falls back to the round’s own nine-hole flag, not to eighteen', () => {
    expect(src).toMatch(/r\.nineHoleMode \? 9 : 18/);
  });
});
