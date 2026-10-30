/**
 * 2026-10-29 (Brain review r14) — A CLUB QUESTION WITH A DECISION IN IT IS THE CADDIE'S.
 *
 * "What's my 7 iron, should I go for the green?" took the whole tail as the club phrase, and the bag
 * readout answered "Your seven iron goes about 165 yards." on every route, so the caddie never heard
 * the decision. club_distance was missing from the status-lookup guard that B1 added for exactly this
 * shape. The bag questions themselves must keep their fast path: "how far do I HIT my 7 iron" carries
 * "do I hit", which a whole-utterance decision test would wrongly send to the brain.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const intentOf = (t: string) => precheckLocalIntent(t);
const topic = (t: string) =>
  (intentOf(t)?.parameters as { query_topic?: string } | undefined)?.query_topic ?? null;

describe('a club question with a decision goes to the caddie', () => {
  it.each([
    "What's my 7 iron, should I go for the green?",
    'how far do I hit my driver, should I lay up?',
    "what's my 7 iron should I go for it",
  ])('"%s" is conversational, not a bare yardage', (t) => {
    expect(intentOf(t)?.intent_type).toBe('conversational');
  });

  it.each([
    "what's my 7 iron",
    'how far do I hit my 7 iron',
    'how far do I carry my 3 wood',
    'how many yards do I hit a pitching wedge',
  ])('"%s" stays the bag read', (t) => {
    expect(intentOf(t)?.intent_type).toBe('query_status');
    expect(topic(t)).toBe('club_distance');
  });
});
