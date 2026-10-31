/**
 * 2026-10-31 (Brain recheck r18, BRAIN-7) — A SCORE SAID WITH A QUESTION IS A QUESTION TOO.
 *
 * "I got a 4, how far is the water" and "I got a 5 and I hit it in the water, what's my play" logged
 * the score and dropped the question. QUESTION_CLAUSE only knew should/can/is/what-would/how-would
 * after the comma, so the order half read as a plain score, log_score fired, and the caddie never
 * heard "how far is the water". Any wh-question after the comma or "and" is a question clause.
 *
 * BEHAVIOURAL: the real precheckLocalIntent and isQuestionShaped. The mixed utterances must come back
 * 'conversational' (the route straight to the brain), and a plain score must still log.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { isQuestionShaped } from '../../services/utteranceIsCommand';

describe('a score said with a question reaches the caddie, not just the score log', () => {
  it.each([
    'I got a 4, how far is the water',
    "I got a 5 and I hit it in the water, what's my play",
    'I made a 6, where did my ball end up',
  ])('"%s" is a question and goes to the brain', (t) => {
    expect(isQuestionShaped(t)).toBe(true);
    expect(precheckLocalIntent(t)?.intent_type).toBe('conversational');
  });

  it.each([
    'I got a 4',
    'I got a 5 and I hit it in the water',
    'I made a 6, my second went in the bunker',
  ])('"%s" is still a plain score and logs', (t) => {
    expect(isQuestionShaped(t)).toBe(false);
    expect(precheckLocalIntent(t)?.intent_type).toBe('log_score');
  });
});
