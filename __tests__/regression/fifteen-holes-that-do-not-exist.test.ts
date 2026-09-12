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

  it('falls back to the played RANGE, not to the constant eighteen', () => {
    // This asserted `r.nineHoleMode ? 9 : 18` until the audit found that nine-hole mode keeps the
    // whole eighteen-hole card. The range owners answer both cases, so the fallback is derived.
    expect(src).toMatch(/Math\.max\(1, last - first \+ 1\)/);
    expect(src).not.toMatch(/r\.nineHoleMode \? 9 : 18/);
  });
});

describe('a nine-hole round on an EIGHTEEN-hole course', () => {
  /**
   * 2026-09-11, found by the full-app audit an hour after the first fix shipped.
   *
   * `courseHoles` is the WHOLE card and stays the whole card in nine-hole mode — startRound stores
   * the full hole list, and roundLastHole works the range out as `roundStartHole + 8` rather than
   * from the array's length. So the first fix, which summed every row and counted every row, was
   * right on a genuinely nine-hole course and wrong on the COMMON nine-hole case: nine holes of an
   * eighteen-hole course. Par 72 and eighteen holes, for a round of nine.
   */
  const { roundFirstHole, roundLastHole } = require('../../store/roundStore');
  const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));
  const range = (s: object) => {
    const f = roundFirstHole(s), l = roundLastHole(s);
    const rows = card.filter((h) => h.hole >= f && h.hole <= l);
    return { holes: rows.length, par: rows.reduce((a, h) => a + h.par, 0) };
  };

  it('the back nine is nine holes of par 36, not eighteen of par 72', () => {
    expect(range({ nineHoleMode: true, roundStartHole: 10, activeCourseId: null, courseHoles: card }))
      .toEqual({ holes: 9, par: 36 });
  });

  it('so is the front nine', () => {
    expect(range({ nineHoleMode: true, roundStartHole: 1, activeCourseId: null, courseHoles: card }))
      .toEqual({ holes: 9, par: 36 });
  });

  it('and the full round is still eighteen of par 72', () => {
    expect(range({ nineHoleMode: false, roundStartHole: 1, activeCourseId: null, courseHoles: card }))
      .toEqual({ holes: 18, par: 72 });
  });

  it('budgets that nine as a nine — bogey golf on a par 36 is 45', () => {
    const p = composePlayProfile({ level: 'simple', goal: 'break_90', coursePar: 36, courseHoles: 9 });
    expect(p.targetScore).toBe(45);
    expect(p.holeCount).toBe(9);
    expect(bogeyBudgetLine(p, 2, 4)).toContain('5 holes');
  });

  it('the composer filters the card to the holes being played, through the range owners', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/caddieDecision.ts'), 'utf8',
    ) as string;
    expect(src).toMatch(/roundFirstHole, roundLastHole/);
    expect(src).toMatch(/\(h\.hole \?\? 0\) >= first && \(h\.hole \?\? 0\) <= last/);
    // and it must NOT go back to counting the whole array
    expect(src).not.toMatch(/const holeRows = \(r\.courseHoles \?\? \[\]\)\.filter\(\s*\(h: \{ par\?: number \}\)/);
  });
});
