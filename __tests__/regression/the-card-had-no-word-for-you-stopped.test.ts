/**
 * 2026-09-13 (Tim, reviewing the dashboard) — the PROGRESS card read
 *
 *     "Steady stretch — a bump in focused practice tends to move the scoring line."
 *
 * while the label on its own practice line read PRACTICE 0 balls.
 *
 * THREE SERVICES, ONE MISSING BRANCH. practiceImpact, pointsPerformance and workoutPerformance each
 * ended their headline switch the same way: four branches about effort going UP, then a bare `else`.
 * That `else` therefore absorbed two completely different situations — effort genuinely flat, and
 * effort that fell off a cliff — and reported both as a steady stretch, recommending a bump in the
 * very thing the player had stopped doing. All three had already computed both halves of the window
 * and could see the drop. None of them had a sentence for it.
 *
 * It is the same failure as a stat with no source, run backwards: the card asserted something it had
 * not measured and declined to say the thing it had. The one number that could have contradicted the
 * headline was the 0 at the end of the line directly beneath it.
 *
 * services/practice/effortScoreVerdict owns all nine outcomes, and its copy map is a
 * `Record<EffortScoreVerdict, …>` — an unwritten case is a compile error, so the fall-through cannot
 * come back. [[two-owners-is-the-root-cause]]
 */
import fs from 'fs';
import path from 'path';
import {
  effortDirection,
  effortScoreHeadline,
  verdictOf,
  EFFORT_DEADBAND,
  type EffortVoice,
} from '../../services/practice/effortScoreVerdict';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const VOICE: EffortVoice = {
  subject: 'Your practice',
  noun: 'focused practice',
  unit: 'balls',
  holdAdvice: 'keep stacking the reps',
  transferNote: 'give the work time to transfer',
};

describe('the card has a word for "you stopped"', () => {
  it('practice that fell to zero is NOT called a steady stretch', () => {
    const h = effortScoreHeadline(
      { effortEarly: 240, effortLate: 0, scoreImproving: false, scoreWorse: false },
      VOICE,
    );
    expect(h).not.toMatch(/steady stretch/i);
    expect(h).not.toMatch(/a bump in/i); // do not prescribe more of what he already stopped
    expect(h).toMatch(/dropped off/i);
  });

  it('and it quotes the two numbers it measured the drop from', () => {
    const h = effortScoreHeadline(
      { effortEarly: 240, effortLate: 0, scoreImproving: false, scoreWorse: false },
      VOICE,
    );
    expect(h).toContain('240 balls');
    expect(h).toContain('0 balls');
  });

  it('a drop WITH worsening scores is named as the clearest signal on the card', () => {
    const h = effortScoreHeadline(
      { effortEarly: 300, effortLate: 40, scoreImproving: false, scoreWorse: true },
      VOICE,
    );
    expect(h).toMatch(/dropped off/i);
    expect(h).toMatch(/went with it/i);
  });

  it('a drop with scores HOLDING never claims the reps were wasted', () => {
    const h = effortScoreHeadline(
      { effortEarly: 300, effortLate: 40, scoreImproving: true, scoreWorse: false },
      VOICE,
    );
    expect(h).toMatch(/dropped off/i);
    expect(h).not.toMatch(/wasted|pointless|didn't help/i);
  });

  it('a genuinely flat window still gets the steady line — that sentence was never wrong, just overused', () => {
    const h = effortScoreHeadline(
      { effortEarly: 200, effortLate: 200, scoreImproving: false, scoreWorse: false },
      VOICE,
    );
    expect(h).toMatch(/steady stretch/i);
  });

  it('effort up still reads as effort up', () => {
    expect(effortScoreHeadline({ effortEarly: 50, effortLate: 300, scoreImproving: true, scoreWorse: false }, VOICE))
      .toMatch(/showing up on the course/i);
  });
});

describe('the direction is measured, with a deadband so a wobble is not a trend', () => {
  it('a change inside the deadband is flat', () => {
    expect(effortDirection(100, 100 + 100 * EFFORT_DEADBAND)).toBe('flat');
    expect(effortDirection(100, 100 - 100 * EFFORT_DEADBAND)).toBe('flat');
  });

  it('a change past it is named', () => {
    expect(effortDirection(100, 200)).toBe('up');
    expect(effortDirection(200, 100)).toBe('down');
    expect(effortDirection(240, 0)).toBe('down');
  });

  it('nothing on either side is flat, not a collapse', () => {
    // A player with no logged effort at all has not "dropped off" — he has not started.
    expect(effortDirection(0, 0)).toBe('flat');
  });

  it('junk never produces a direction claim', () => {
    expect(effortDirection(Number.NaN, 50)).toBe('up');
    expect(effortDirection(50, Number.NaN)).toBe('down');
    expect(effortDirection(Number.NaN, Number.NaN)).toBe('flat');
  });

  it('all nine verdicts are reachable and distinct', () => {
    const seen = new Set<string>();
    for (const [early, late] of [[10, 100], [100, 10], [100, 100]] as const) {
      for (const [imp, worse] of [[true, false], [false, true], [false, false]] as const) {
        const v = verdictOf({ effortEarly: early, effortLate: late, scoreImproving: imp, scoreWorse: worse });
        seen.add(v);
        expect(effortScoreHeadline({ effortEarly: early, effortLate: late, scoreImproving: imp, scoreWorse: worse }, VOICE))
          .toEqual(expect.stringMatching(/\S/));
      }
    }
    expect(seen.size).toBe(9);
  });
});

describe('all three PROGRESS sources ask the owner', () => {
  const SOURCES = [
    'services/practice/practiceImpact.ts',
    'services/practice/pointsPerformance.ts',
    'services/practice/workoutPerformance.ts',
  ];

  it.each(SOURCES)('%s builds its headline through effortScoreHeadline', (f) => {
    expect(code(f)).toMatch(/effortScoreHeadline\(/);
  });

  it.each(SOURCES)('%s no longer keeps a local fall-through that swallows a drop', (f) => {
    const src = code(f);
    // The shape of the bug: a bare `else` assigning the steady-stretch sentence.
    expect(src).not.toMatch(/else\s+headline = 'Steady stretch/);
    expect(src).not.toMatch(/headline = 'Steady stretch/);
    // and no source may author its own "a bump in …" advice any more
    expect(src).not.toMatch(/a bump in [^']*tends to move the scoring line/);
  });

  it('the CADDIE reads the same three-way direction the card does', () => {
    /**
     * 2026-09-13, triple-check. The card was fixed and services/caddieRequestBody was not: it told the
     * brain `practiceUp ? 'UP' : 'down or flat'` — the same two-way collapse that produced "steady
     * stretch" over a 0-ball practice line. So the dashboard could say "your practice dropped off, 240
     * balls down to 0" while the caddie answered the same question with "down or flat". The screen had
     * got smarter than the brain. Both read effortDirection now.
     * [[two-owners-is-the-root-cause]]
     */
    const body = code('services/caddieRequestBody.ts');
    expect(body).toMatch(/effortDirection\(c\.practiceEarlyBalls, c\.practiceLateBalls\)/);
    expect(body).toMatch(/effortDirection\(c\.trainingEarly, c\.trainingLate\)/);
    // the collapsed phrasing is gone from BOTH blocks
    expect(body).not.toMatch(/'down or flat'/);
    // and the caddie can name all three states, not two
    expect(body).toMatch(/down: 'DOWN'/);
    expect(body).toMatch(/flat: 'essentially FLAT'/);
  });

  it('no source keeps a second local copy of "which way did effort go"', () => {
    // pointsPerformance's `pointsUp` and workoutPerformance's destructured `trainingUp` were both
    // left dangling behind a `void` after the refactor. A second copy of the direction is how the
    // card and the caddie drifted apart in the first place.
    for (const f of ['services/practice/pointsPerformance.ts', 'services/practice/workoutPerformance.ts']) {
      const src = code(f);
      expect(src).not.toMatch(/void (?:pointsUp|trainingUp);/);
      expect(src).not.toMatch(/const pointsUp = /);
    }
    // trainingUp stays on the EXPORTED connection, because caddieRequestBody reads it.
    expect(code('services/practice/workoutPerformance.ts')).toMatch(/trainingUp: lastHalf > firstHalf,/);
  });

  it('the one place that still says it is the owner, on the flat case only', () => {
    const owner = code('services/practice/effortScoreVerdict.ts');
    expect(owner).toMatch(/flat_holding: \(v\) => `Steady stretch/);
    expect(owner).not.toMatch(/down_\w+: \(v[^`]*`Steady stretch/);
  });
});
