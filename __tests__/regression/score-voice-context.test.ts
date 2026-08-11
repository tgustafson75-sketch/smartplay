/**
 * 2026-08-10 (Tim, from the course) — "if I say I got a par on hole with two putt, the stupid
 * caddie goes 'oh, you got a two, a fucking eagle.' No motherfucker. Read the whole context. I got
 * a double bogey and two putt."
 *
 * TWO compounding defects produced that:
 *   1. Number parsing ran BEFORE the score-name parser and unconditionally won, so any digit in the
 *      sentence beat the spoken score — "two" from "two putts" became a 2, an eagle on a par 4.
 *   2. The number-word loop iterated its map in VALUE order (one, two, three…) returning the first
 *      word merely PRESENT, so the LOWEST number word won regardless of position:
 *      "a five with three putts" logged a 3.
 *
 * Neither was catchable before now: the logic lived in logScoreHandler, which imports roundStore →
 * bundled image assets, so jest could never load it. Moving the parsing to a pure module is part of
 * the fix, not incidental to it.
 */
import { resolveStrokes, parseStrokes, parsePutts, stripNonScoreClauses } from '../../services/intents/scoreParse';

const PAR = 4;
const said = (text: string, param?: unknown) => resolveStrokes(param, text, PAR);

describe("Tim's exact complaint — a putt count is not a score", () => {
  it('"I got a par on this hole with two putts" → PAR (4), not 2', () => {
    expect(said('I got a par on this hole with two putts')).toBe(PAR);
  });

  it('"I got a double bogey and two putt" → DOUBLE BOGEY (6), not 2', () => {
    expect(said('I got a double bogey and two putt')).toBe(PAR + 2);
  });

  it('"birdie, one putt" → BIRDIE (3), not 1', () => {
    expect(said('birdie, one putt')).toBe(PAR - 1);
  });

  it('"bogey, three putted" → BOGEY (5), not 3', () => {
    expect(said('bogey, three putted')).toBe(PAR + 1);
  });

  it('"I made par, took two putts" → PAR, not 2', () => {
    expect(said('I made par, took two putts')).toBe(PAR);
  });
});

describe('the position defect — the lowest number word must not win', () => {
  it('"I made a five with three putts" → 5, not 3', () => {
    expect(said('I made a five with three putts')).toBe(5);
  });

  it('"I had a seven, two putts" → 7, not 2', () => {
    expect(said('I had a seven, two putts')).toBe(7);
  });

  it('"took a 6 from 20 feet" → 6 (the distance is not a score)', () => {
    expect(said('took a 6 from 20 feet')).toBe(6);
  });

  it('parseStrokes alone takes the EARLIEST number, not the smallest', () => {
    expect(parseStrokes('nine then three')).toBe(9);
  });
});

describe('no regression on plain score reports', () => {
  it.each([
    ['I made a five', 5],
    ['I shot a 7', 7],
    ['put me down for a 4', 4],
    ['I had a five', 5],
  ])('%s → %i', (text, expected) => {
    expect(said(text)).toBe(expected);
  });

  it('classifier numeric strokes still wins when no score is named', () => {
    expect(resolveStrokes(5, 'score me', PAR)).toBe(5);
  });

  it('classifier canonical "double_bogey" still resolves against par', () => {
    expect(resolveStrokes('double_bogey', 'score me', PAR)).toBe(PAR + 2);
  });

  it('an unparsable utterance still returns null so the caddie asks', () => {
    expect(said('score me')).toBeNull();
  });
});

describe('reading the WHOLE context — the putts get logged too', () => {
  it.each([
    ['I got a par with two putts', 2],
    ['double bogey and two putt', 2],
    ['birdie, one putt', 1],
    ['bogey, three putted', 3],
    ['made par, no putts', 0],
  ])('%s → %i putts', (text, expected) => {
    expect(parsePutts(text)).toBe(expected);
  });

  it('returns null when no putt count was spoken', () => {
    expect(parsePutts('I made a five')).toBeNull();
  });
});

describe('clause stripping', () => {
  it('removes the whole putt clause, connector included, and keeps the score word', () => {
    // The leading "with"/"and"/"took" is part of the clause being removed — leaving it behind would
    // be harmless but the point is that "par" survives and "two" does not.
    expect(stripNonScoreClauses('i got a par with two putts')).toBe('i got a par');
  });
  it('removes pin distances', () => {
    expect(stripNonScoreClauses('made it from 20 feet')).toBe('made it');
  });
});
