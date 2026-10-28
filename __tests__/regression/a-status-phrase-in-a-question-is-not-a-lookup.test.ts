/**
 * 2026-10-27 (Brain review B1) — A STATUS PHRASE INSIDE A QUESTION IS NOT A STATUS ASK.
 *
 * services/localIntentPrecheck guarded only its ACTING intents against questions. Every lookup
 * pattern (yardage, score, par, handicap, putts, nines) was unguarded, so on every route these came
 * back as a bare-number template at confidence 'high' and the caddie never heard them (measured at
 * HEAD before the fix):
 *
 *   "what should I hit to the pin"                       → green_middle  ("152 to the middle.")
 *   "what club gets me to the back of the green"         → green_back
 *   "I'm worried about my score, should I just lay up"   → score         ("Through 7, you're 38, +3.")
 *   "what's the par-saving play here"                    → par
 *   "how am I doing on my tempo today"                   → score (off-round: "You're not in a round yet")
 *
 * BEHAVIOURAL: the real precheckLocalIntent. A blocked phrase must be 'conversational' — null would
 * hand it to the cloud classifier, which re-steals it — and the bare status asks keep their topic.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

describe('a decision or a reason around a status phrase reaches the caddie', () => {
  it.each([
    'what should I hit to the pin',
    'what club gets me to the back of the green',
    'should I land it on the front edge or fly it',
    "I'm worried about my score, should I just lay up here",
    "what's the par-saving play here",
    'I played terrible on the front nine, what should I change',
    "what's my handicap doing lately and why",
    'my buddy says my yardage is wrong',
    'how many putts should I expect from 30 feet',
    'how am I doing on my tempo today',
  ])('"%s" → conversational', (said) => {
    const r = precheckLocalIntent(said);
    expect(r?.intent_type).toBe('conversational');
  });
});

describe('the bare status asks keep their instant answer', () => {
  it.each([
    ['how far to the pin', 'query_status', 'green_middle'],
    ["what's my score", 'query_status', 'score'],
    ['how am I doing', 'query_status', 'score'],
    ['how far to the front', 'query_status', 'green_front'],
    ['yards to the back', 'query_status', 'green_back'],
    ["what's the par", 'query_status', 'par'],
    ['how many putts today', 'query_status', 'putt_stats'],
    ['how did I do on the front nine', 'query_status', 'nine_split'],
    ['how many holes left to play', 'query_status', 'holes_left'],
    ["what's my yardage", 'query_status', 'distance_to_green'],
  ])('"%s" → %s %s', (said, type, topic) => {
    const r = precheckLocalIntent(said);
    expect([r?.intent_type, r?.parameters?.query_topic]).toEqual([type, topic]);
  });

  it('"what\'s my handicap" stays a handicap lookup', () => {
    expect(precheckLocalIntent("what's my handicap")?.intent_type).toBe('handicap_query');
  });
});
