/**
 * 2026-10-31 (Brain recheck r18, BRAIN-4) — "WHAT'S MY SCORE ON THIS HOLE" IS THIS HOLE, NOT THE ROUND.
 *
 * HOLE_SCOPED_TOPICS only caught a NAMED hole ("on 7"), so "on this hole" / "on that one" fell through to
 * queryStatusHandler, which answered the round total for score, putts and GIR. A deictic hole now goes to
 * the brain, which has the current hole. Par and the distances already answer for the current hole, so
 * they keep their instant local answer.
 *
 * BEHAVIOURAL: the real precheckLocalIntent.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

describe('a deictic hole reaches the caddie for the per-hole stats', () => {
  it.each([
    "what's my score on this hole",
    'how many putts on that hole',
    'how many putts did I take on this one',
    'how many greens did I hit on this hole',
    'how many greens did I hit on the current hole',
  ])('"%s" → conversational', (said) => {
    expect(precheckLocalIntent(said)?.intent_type).toBe('conversational');
  });
});

describe('the round-level and current-hole asks keep their local answer', () => {
  it.each([
    ["what's my score", 'score'],
    ['how many putts today', 'putt_stats'],
    ["what's the par on this hole", 'par'],
    ['how far to the pin on this hole', 'green_middle'],
  ])('"%s" → query_status %s', (said, topic) => {
    const r = precheckLocalIntent(said);
    expect([r?.intent_type, r?.parameters?.query_topic]).toEqual(['query_status', topic]);
  });
});
