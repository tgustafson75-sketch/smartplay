/**
 * 2026-10-31 (Brain recheck r24, BRAIN-R24-1) — A WORD ORDINAL IN A SCORE STATEMENT IS A COUNT, NOT A HOLE.
 *
 * "I made a bogey, the first bogey of the day" was written to hole 1 while he stood on 13: SCORE_VERB_RX
 * sent the words to log_score, and the bare "the first" read as hole 1, overwriting his real hole-1 score.
 * The offline writer read the same words through the same regex set. A score statement names a hole only
 * by an explicit form ("hole 1", "the first hole", "the 12th", "on 12"); a bare word ordinal is not one.
 * A QUESTION may still name a hole by a word ordinal ("what's the par on the twelfth"), so that reader is
 * unchanged.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { namedSpokenHole, parseSpokenHole } from '../../services/spokenHole';

const type = (t: string) => precheckLocalIntent(t)?.intent_type ?? null;

describe('a score statement does not read a bare word ordinal as a hole (r24)', () => {
  it.each([
    'I made a bogey, the first bogey of the day',
    "I got a 5, that's the first time I've hit that green",
    'I got a 4 on the second shot',
    'I got a 6 on the first try',
  ])('"%s" names no hole for a score', (utterance) => {
    expect(parseSpokenHole(utterance, true)).toBeNull();
    expect(namedSpokenHole(utterance, true)).toBeNull();
  });

  it.each([
    'I made a bogey, the first bogey of the day',
    "I got a 5, that's the first time I've hit that green",
  ])('"%s" is logged to the hole he stands on, not hole 1', (utterance) => {
    const i = precheckLocalIntent(utterance);
    expect(i?.intent_type).toBe('log_score');
    expect(i?.parameters?.hole_number).toBeUndefined();
  });

  it.each([
    ['I got a 6 on the first hole', 1],
    ['I got a 6 on the 12th', 12],
    ['I got a 4 on the 2nd', 2],
    ['I made a 5 on hole 13', 13],
    ['I made a 5 on number 7', 7],
  ])('"%s" still names hole %i for a score', (utterance, hole) => {
    expect(parseSpokenHole(utterance, true)).toBe(hole);
    expect(namedSpokenHole(utterance, true)).toBe(hole);
  });
});

describe('a question still names a hole by a word ordinal (r24)', () => {
  it('reads "on the twelfth" as hole 12 when asked', () => {
    expect(parseSpokenHole('what is the par on the twelfth')).toBe(12);
  });

  it('a hole-scoped question about a word-ordinal hole reaches the caddie, not the current hole', () => {
    expect(type("what's the par on the twelfth")).toBe('conversational');
  });
});
