/**
 * 2026-09-17 (Tim — "we have done SO much work on handicap") — and the caddie was never told it.
 *
 * `handicap` has been in the payload and in api/kevin's destructure for months. Every occurrence of
 * the word after `} = body;` was English PROSE inside a template literal — including the
 * course-read rule telling the model "You know this player's carries, their miss, their handicap".
 * It did not. golferModel.describeForPrompt omits it; unifiedVisionContext collects it and renders
 * only the miss. Only coachingAdaptation read it, and only to pick a 3-value bucket, so a 2 and a
 * 28 differed by one word of tone.
 *
 * WHY THE EXISTING GUARD COULD NOT CATCH IT, which is the reusable part. payload-contract-is-closed
 * asserts every destructured field is "used" by testing \bname\b against comment-stripped source —
 * and a sentence inside a template literal is not a comment. The guard matched the very sentence
 * that claimed the model knew the number. A source grep cannot tell a USE from a MENTION.
 *
 * So this pins INTERPOLATION: the value has to appear inside a `${...}` in the prompt, which prose
 * cannot satisfy. [[built-is-not-reachable]]
 */

import fs from 'fs';
import path from 'path';

const kevin = fs.readFileSync(path.join(__dirname, '../../api/kevin.ts'), 'utf8');
const builder = fs.readFileSync(path.join(__dirname, '../../services/caddieRequestBody.ts'), 'utf8');

/** Does `name` appear inside a ${...} interpolation anywhere in the file? */
const isInterpolated = (src: string, name: string): boolean =>
  new RegExp(`\\$\\{[^}]*\\b${name}\\b[^}]*\\}`).test(src);

describe('the number the whole app is built around actually reaches the caddie', () => {
  it('the handicap is INTERPOLATED into the prompt, not merely mentioned in it', () => {
    expect(isInterpolated(kevin, '_handicap')).toBe(true);
  });

  it('and it is a real variable, not the prose that fooled the old guard', () => {
    // `const _handicap =` must exist. The bug was that no such binding did, while six sentences
    // said the word.
    expect(kevin).toMatch(/const _handicap\b/);
  });

  it('prose alone would NOT satisfy this test — proving the assertion can fail', () => {
    // The exact shape that shipped: the word inside a template literal, with no interpolation.
    const proseOnly = 'const p = `You know this player\'s carries, their miss, their handicap.`;';
    expect(isInterpolated(proseOnly, 'handicap')).toBe(false);
    // ...and the old style of check would have passed it, which is why this file exists.
    expect(/\bhandicap\b/.test(proseOnly)).toBe(true);
  });

  it('the client still sends it, so the server half has something to say', () => {
    expect(builder).toMatch(/handicap: safe\(/);
  });
});

describe('home courses reach the caddie too', () => {
  it('are sent by the builder', () => {
    expect(builder).toMatch(/homeCourses: safe\(/);
  });

  it('are destructured and interpolated, not dropped on the floor', () => {
    expect(kevin).toMatch(/homeCourses = \[\]/);
    expect(isInterpolated(kevin, '_homeCourses')).toBe(true);
  });
});
