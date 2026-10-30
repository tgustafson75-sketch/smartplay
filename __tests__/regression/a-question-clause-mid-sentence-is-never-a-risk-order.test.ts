/**
 * 2026-10-29 (Brain recheck r13) — A QUESTION CLAUSE ANYWHERE IN THE SENTENCE IS A QUESTION.
 *
 * isQuestionShaped read only a leading interrogative and a trailing "?". So a risk-mode order with a
 * question tacked on mid-sentence went down as the order: "I'll go for it, should I" set risk mode to
 * aggressive and the caddie answered "Aggressive it is", and Kevin was never asked. The posture then
 * nudged club picks at near-ties for the rest of the round.
 *
 * BEHAVIOURAL: the real precheckLocalIntent on each phrase. A question must come back 'conversational'
 * (the route straight to the brain), and the plain orders and statements must keep their own reads.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { isQuestionShaped } from '../../services/utteranceIsCommand';

describe('a question clause mid-sentence reaches the caddie, never a risk-mode order', () => {
  it.each([
    "I'll go for it, should I",
    "I'm going to play it safe, what would you do",
    'Kevin, I want to go for it, is that smart',
    'I want to go for it, should I',
  ])('"%s" is a question and goes to the brain', (t) => {
    expect(isQuestionShaped(t)).toBe(true);
    expect(precheckLocalIntent(t)?.intent_type).toBe('conversational');
  });

  it.each([
    ["I'll go for it", 'change_setting'],
    ['I want to go for it', 'change_setting'],
    ["I'm going to play it safe", 'change_setting'],
    ['The pin is short, should be an easy putt', null],
  ])('"%s" is not swallowed by the question guard', (t, want) => {
    const hit = precheckLocalIntent(t);
    expect(hit?.intent_type === 'conversational' ? 'conversational' : hit?.intent_type ?? null).toBe(want);
  });
});
