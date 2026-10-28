/**
 * 2026-10-28 (Brain review r4) — A GOAL OR A STORY IS NOT A STATUS ASK.
 *
 * The round-1 B1 guard sent a status phrase to the caddie only when a DECISION or REASON word was in
 * it. Goals and stories had neither, so "I want to shoot under par today", "My score always balloons
 * on the back nine" and "I was 3 over par through 9 at Menifee yesterday" became query_status{score}
 * ("Through 3, you're 15 — +2." in a round, "You're not in a round yet. Want to start one?" off it),
 * and "My handicap went up after that tournament" / "My goal is to get my handicap under 10 this
 * year" became handicap_query. The status branch never ran the story guard at all — even "yesterday".
 *
 * BEHAVIOURAL: the real precheck. 'conversational' is the route both routers send to the brain.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

describe('a goal, a trend or a story reaches the caddie', () => {
  it.each([
    'I want to shoot under par today',
    'My score always balloons on the back nine',
    'I was 3 over par through 9 at Menifee yesterday',
    'My handicap went up after that tournament',
    'My goal is to get my handicap under 10 this year',
    "I'm trying to break 80, how am I doing",
  ])('"%s"', (u) => {
    expect(precheckLocalIntent(u)?.intent_type).toBe('conversational');
  });
});

describe('the bare status asks keep their instant answer', () => {
  it.each([
    ["what's my score", 'score'],
    ['how am I doing', 'score'],
    ['how many holes left', 'holes_left'],
    ['how did I do here last time', 'last_round_here'],
    ['last time I played here', 'last_round_here'],
  ])('"%s" → %s', (u, topic) => {
    expect(precheckLocalIntent(u)?.parameters?.query_topic).toBe(topic);
  });

  it("what's my handicap → handicap_query", () => {
    expect(precheckLocalIntent("what's my handicap")?.intent_type).toBe('handicap_query');
  });
});
