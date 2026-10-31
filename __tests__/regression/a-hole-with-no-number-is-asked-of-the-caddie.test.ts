/**
 * 2026-10-31 (Brain recheck r19, BRAIN-E) — "THE HOLE" WITH NO NUMBER IS THIS HOLE, NOT THE ROUND.
 *
 * DEICTIC_HOLE_RX (r18, BRAIN-4) knew only "this / that / the current / last / previous / present hole".
 * "What's my score on the hole", "how many putts on the hole I'm on" and "the hole I just finished" named
 * no number and matched none of those, so queryStatusHandler answered the ROUND total as the hole.
 * Any hole reference without a number now goes to the brain, which has the current hole.
 *
 * BEHAVIOURAL: the real precheckLocalIntent. Par and the distances still answer locally for any hole.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

describe('a hole named only by "the hole" reaches the caddie for the per-hole stats', () => {
  it.each([
    "what's my score on the hole",
    'how many putts on the hole I\'m on',
    "what's my score on the hole I just finished",
    'how many greens did I hit on the one before',
    'how many putts did I take on the hole',
  ])('"%s" → conversational', (said) => {
    expect(precheckLocalIntent(said)?.intent_type).toBe('conversational');
  });
});

describe('the round-level and current-hole asks keep their local answer', () => {
  it.each([
    ["what's my score", 'score'],
    ['how many putts today', 'putt_stats'],
    ["what's the par on the hole", 'par'],
    ['how far to the pin on the hole', 'green_middle'],
  ])('"%s" → query_status %s', (said, topic) => {
    const r = precheckLocalIntent(said);
    expect([r?.intent_type, r?.parameters?.query_topic]).toEqual(['query_status', topic]);
  });
});
