/**
 * 2026-10-31 (Brain recheck r28, BRAIN-R27-A) — A SCORE VERB WITH "THE" AND A WORD ORDINAL NAMES THE HOLE.
 *
 * "I bogeyed the twelfth" carried no hole: the score set accepted "the <word ordinal>" only after on/at, so the
 * precheck emitted log_score with no hole_number. The score then fell to voiceScoreHole (the hole he stands on,
 * 14 with 1-13 scored) and the bogey landed on a hole he had not played. The r24 cut removed the bare form to stop
 * "the first bogey of the day" naming hole 1; a count noun after the ordinal is the guard that keeps that a count.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { namedSpokenHole, parseSpokenHole } from '../../services/spokenHole';

describe('a score verb with "the" and a word ordinal names that hole (r28)', () => {
  it.each([
    ['I bogeyed the twelfth', 12],
    ['I birdied the first', 1],
    ['I parred the second', 2],
    ['I double-bogeyed the eighteenth', 18],
    ['I bogeyed the seventh', 7],
  ])('"%s" names hole %i for a score', (utterance, hole) => {
    expect(parseSpokenHole(utterance, true)).toBe(hole);
    expect(namedSpokenHole(utterance, true)).toBe(hole);
  });

  it.each([
    ['I bogeyed the twelfth', 12],
    ['I birdied the first', 1],
    ['I parred the second', 2],
    ['I double-bogeyed the eighteenth', 18],
  ])('"%s" carries hole %i into log_score from the precheck', (utterance, hole) => {
    const i = precheckLocalIntent(utterance);
    expect(i?.intent_type).toBe('log_score');
    expect(i?.parameters?.hole_number).toBe(hole);
  });

  it.each([
    'I made a bogey, the first bogey of the day',
    'I made a birdie, the first birdie of the day',
    'I made an eagle, the second eagle of the day',
    'I made a double, the third double of the round',
    'I shot a 5 in the first round',
    'I made a 5, the second best score this year',
    'I shot a 78, the first ever round under 80',
    'I got a 4 on the second shot',
  ])('"%s" still names no hole for a score (a count, not a hole)', (utterance) => {
    expect(parseSpokenHole(utterance, true)).toBeNull();
    expect(namedSpokenHole(utterance, true)).toBeNull();
  });
});
