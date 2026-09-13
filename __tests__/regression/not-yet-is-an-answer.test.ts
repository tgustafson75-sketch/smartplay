import * as fs from 'fs';
import * as path from 'path';
import { PRACTICE_FLOOR } from '../../services/practice/practiceImpact';
import { TRAINING_FLOOR } from '../../services/practice/workoutPerformance';
import { MENTAL_FLOOR } from '../../services/mentalPatterns';
import { SWING_TREND_FLOOR } from '../../services/practice/swingMetricTrend';

const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * 2026-09-12 (Tim) — "We don't want to say nothing. A caddie would be able to say what needs to
 * happen to get a better sense of the player. A new golf coach giving a first lesson lets the player
 * swing — okay, let me let you swing, and again, so that I can get a sense of it. We don't wanna
 * just fall silent in any case. That is an unnatural response… There are logical floors, and if
 * there is a floor you can't see, silence does look broken."
 *
 * Every coach block shipped earlier the same day returned NULL below its gate. The gates are honest
 * — below them there is nothing true to say about a trend — but null means the caddie says nothing,
 * and a coach who goes quiet on a straight question reads as broken rather than careful. The floor
 * was invisible, so the silence was unexplainable.
 */
describe('below the floor, the caddie says what he needs — not nothing', () => {
  const body = strip(read('services/caddieRequestBody.ts'));

  /** The floors have to be readable, or the block cannot name them. */
  it('every floor is exported rather than private to its module', () => {
    expect(PRACTICE_FLOOR.sessions).toBeGreaterThan(0);
    expect(PRACTICE_FLOOR.rounds).toBeGreaterThan(0);
    expect(TRAINING_FLOOR.workouts).toBeGreaterThan(0);
    expect(TRAINING_FLOOR.rounds).toBeGreaterThan(0);
    expect(MENTAL_FLOOR.rounds).toBeGreaterThan(0);
    expect(MENTAL_FLOOR.reports).toBeGreaterThan(0);
    expect(SWING_TREND_FLOOR.weeks).toBeGreaterThan(0);
  });

  /**
   * THE FIRST-LESSON CASE, and the one Tim named. No captured swings meant a player describing a
   * feel got a coach with no opinion and no explanation. A coach asks to see it.
   */
  it('with no swings ever captured, it asks to watch him hit a few', () => {
    const at = body.indexOf('measuredSwingBlock: safe(');
    expect(at).toBeGreaterThan(-1);
    const fn = body.slice(at, body.indexOf('}, null),', at));
    expect(fn).toMatch(/YOU HAVE NEVER SEEN THIS PLAYER SWING/);
    expect(fn).toMatch(/ASK TO SEE IT/);
    // It must NOT read as an error or a feature pitch.
    expect(fn).toMatch(/not as an error, an apology, or a feature pitch/);
    expect(fn).not.toMatch(/return null;/);
  });

  /** Seen him swing, but one session is a reading, not a trend — and it must say which. */
  it('distinguishes a reading from a trend', () => {
    const at = body.indexOf('measuredSwingBlock: safe(');
    const fn = body.slice(at, body.indexOf('}, null),', at));
    expect(fn).toMatch(/CANNOT CALL A TREND YET/);
    expect(fn).toMatch(/A single session is a reading, not a trend/);
  });

  /**
   * Each of the three count-based blocks must state WHAT IS IN THE BOOKS and WHAT IS STILL NEEDED —
   * "we've only got the one session; couple more and I can compare". A bare "not enough data" is the
   * same as no answer.
   */
  // Fragments deliberately chosen NOT to straddle a string-concatenation boundary: the block text is
  // built from several quoted pieces, so "in the books" is literally `in ' + \`the books` in source
  // and a regex for the phrase matches nothing. The first version of this test failed for exactly
  // that reason — the assertion was wrong, not the code.
  it.each([
    ['practiceImpactBlock', /NOT MEASURABLE YET/, /logged practice session/],
    ['trainingImpactBlock', /NOT MEASURABLE YET/, /logged workout/],
    ['mentalPatternBlock', /NOT ENOUGH YET/, /moment\$\{m\.totalReports === 1/],
  ])('%s says what it has and what it still needs', (block, notYet, books) => {
    const at = body.indexOf(`${block}: safe(`);
    expect(at).toBeGreaterThan(-1);
    const fn = body.slice(at, body.indexOf('}, null),', at));
    expect(fn).toMatch(notYet);
    expect(fn).toMatch(books);
    // and it states what is STILL NEEDED, not merely that there is not enough
    expect(fn).toMatch(/more session|more round|more workout|a couple more rounds/);
    // It names the floor from the exported constant, never a hardcoded number that can drift.
    expect(fn).toMatch(/_FLOOR\./);
  });

  /** None of the four may return null on the not-enough path any more. */
  it.each([
    ['practiceImpactBlock'], ['trainingImpactBlock'], ['mentalPatternBlock'], ['measuredSwingBlock'],
  ])('%s has no silent exit below its floor', (block) => {
    const at = body.indexOf(`${block}: safe(`);
    const fn = body.slice(at, body.indexOf('}, null),', at));
    expect(fn.length).toBeGreaterThan(300);
    // The only permitted `return null` is the outer safe() fallback, not a gate.
    expect(fn).not.toMatch(/if \(![^)]*\) return null;/);
  });

  /**
   * AND THE RULE THAT KEEPS IT FROM BECOMING NAGGING, which is the risk Tim named himself: "this
   * will bite me because if I don't have the data, then it'll get bombed."
   */
  it('the prompt forbids volunteering it, and forbids the apology voice', () => {
    const k = read('api/kevin.ts');
    expect(k).toMatch(/NEVER GO SILENT ON A MEASURE YOU ARE KEEPING/);
    expect(k).toMatch(/NEVER volunteer it/);
    expect(k).toMatch(/never twice in a conversation/);
    expect(k).toMatch(/Never dress it up as an error, a limitation or a feature pitch/);
    expect(k).toMatch(/Answer the actual question FIRST/);
  });
});
