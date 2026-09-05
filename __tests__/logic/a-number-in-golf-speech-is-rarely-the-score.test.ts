/**
 * 2026-09-05 (Tim, from the course) — "Still have a sensitivity to saying numbers. If I say I am
 * going to use a 2 iron or got a bogey with 2 putt, it still may say Eagle and score the 2."
 *
 * Golf speech is full of numbers and almost none of them are the score. Clubs, putt counts, pin
 * distances, hole numbers — all spoken in the same breath as scoring, all previously fair game for
 * the stroke parser. Putts and distances were stripped on 2026-08-10 after an earlier report from
 * the same course. CLUBS were not, and a club number is the most common number in golf speech after
 * the score itself.
 *
 * The second defect was quieter. Score names are par-relative, so when par is unknown
 * (course holes not loaded, off-book hole) parseScoreName returns null — and the resolver then fell
 * through to the numeric path and took whatever digit was in the sentence. The player says "bogey",
 * the sentence contains "2 putt", and a 2 goes on the card as an eagle.
 *
 * The rule this encodes: THE PLAYER NAMING A SCORE IS EVIDENCE THAT NO OTHER NUMBER IN THAT
 * SENTENCE IS THE SCORE. One short clarifier beats a wrong scorecard written silently.
 */
import { parseStrokes, resolveStrokes, stripNonScoreClauses, parsePutts } from '../../services/intents/scoreParse';

describe('a club number is never the score', () => {
  it("THE REPORT: 'going to use a 2 iron' does not log a 2", () => {
    expect(parseStrokes('I am going to use a 2 iron')).toBeNull();
    expect(resolveStrokes(undefined, 'I am going to use a 2 iron', 4)).toBeNull();
  });

  it('every club form people actually say', () => {
    for (const u of [
      'hit a 2 iron', 'hit a 7-iron', 'going with the 3 wood', 'take the 5 wood',
      'my 4 hybrid', 'the 56 degree', '60 deg', 'gap wedge', 'sand wedge', 'pitching wedge',
    ]) {
      expect([u, parseStrokes(u)]).toEqual([u, null]);
    }
  });

  it('a club mentioned ALONGSIDE a real score still logs the score', () => {
    // The strip must remove the club, not the sentence.
    expect(parseStrokes('I made a 5, hit 7 iron in')).toBe(5);
    expect(resolveStrokes(undefined, 'took a 6 with the 3 wood off the tee', 4)).toBe(6);
  });

  it('a hole number is not the score', () => {
    expect(parseStrokes('on hole 7 I had a 5')).toBe(5);
    expect(parseStrokes('hole 12')).toBeNull();
  });
});

describe('a named score outranks every number beside it', () => {
  it("THE REPORT: 'bogey with 2 putt' is a bogey, never a 2", () => {
    expect(resolveStrokes(undefined, 'got a bogey with 2 putt', 4)).toBe(5);
    expect(resolveStrokes(undefined, 'got a bogey with two putts', 3)).toBe(4);
  });

  it('...and when par is UNKNOWN it asks rather than taking the putt count', () => {
    // The quiet half. par null → the name cannot resolve → the old code took the 2.
    expect(resolveStrokes(undefined, 'got a bogey with 2 putt', null)).toBeNull();
    expect(resolveStrokes(undefined, 'made par, two putts', null)).toBeNull();
  });

  it('a classifier-supplied number does NOT override a spoken score name', () => {
    // The classifier emitting strokes=2 for "bogey with 2 putt" was the other way in.
    expect(resolveStrokes(2, 'got a bogey with 2 putt', 4)).toBe(5);
  });

  it('a bare number report is untouched — no name, nothing to prefer', () => {
    expect(resolveStrokes(undefined, 'I made a five', 4)).toBe(5);
    expect(resolveStrokes(undefined, 'I got a 7', 4)).toBe(7);
    expect(resolveStrokes(6, undefined, 4)).toBe(6);
  });

  it('putts are still read out of the same sentence, so we do not re-ask', () => {
    expect(parsePutts('got a bogey with 2 putt')).toBe(2);
    expect(parsePutts('made a 5, two putts')).toBe(2);
  });
});

describe('the stripper removes clauses, not sentences', () => {
  it('leaves the score words behind', () => {
    expect(stripNonScoreClauses('bogey with 2 putt')).toContain('bogey');
    expect(stripNonScoreClauses('a 5 with the 7 iron')).toMatch(/\b5\b/);
  });
});
