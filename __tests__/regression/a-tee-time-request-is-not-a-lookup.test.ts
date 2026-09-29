/**
 * 2026-09-29 — a tee-time request was intercepted by services/localIntentPrecheck at confidence
 * 'high' before /api/kevin, so the brain's find_tee_time tool was never reached:
 *
 *   "Find a tee time for a round at Menifee Lakes Saturday"        → find_my_data (`find … round`)
 *   "Can you find me a tee time Saturday for a round of golf"      → find_my_data
 *   "Get me a tee time to play Menifee Lakes Palms Saturday"       → open_course (`play <course>`)
 *
 * A question intercepted before the brain is a question the caddie never heard (CLAUDE.md).
 * BEHAVIOURAL: the real precheckLocalIntent runs on each utterance.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

describe('a tee-time request reaches the brain', () => {
  it.each([
    'Find a tee time for a round at Menifee Lakes Saturday',
    'Can you find me a tee time Saturday for a round of golf',
    'Get me a tee time to play Menifee Lakes Palms Saturday',
    'book me a tee time Saturday morning at Menifee Lakes',
    'pull up tee times at Menifee Lakes',
    "let's play Menifee Lakes, find me a tee-time",
    'any teetimes this weekend',
  ])('"%s" is sent to the BRAIN, not a local handler and not the cloud classifier', (t) => {
    // 2026-09-30 (triple-check) — null was not enough: a null precheck is handed to /api/voice-intent,
    // whose enum can turn "tee time to play <course>" into open_course or quick_round.
    expect(precheckLocalIntent(t)?.intent_type).toBe('conversational');
  });

  it('the data and course commands without a tee time keep their fast path', () => {
    expect(precheckLocalIntent('pull up my round at Menifee Lakes')?.intent_type).toBe('find_my_data');
    expect(precheckLocalIntent('show me my last scorecard')?.intent_type).toBe('find_my_data');
    expect(precheckLocalIntent("let's play Menifee Lakes Palms")?.intent_type).toBe('open_course');
  });

});

describe('and the router actually hands it to the brain', () => {
  it('the precheck result dispatches as route_to_brain — no classifier call, no local handler', async () => {
    const { VoiceCommandRouter } = require('../../services/voiceCommandRouter') as typeof import('../../services/voiceCommandRouter');
    const intentOut = precheckLocalIntent('Get me a tee time to play Menifee Lakes Palms Saturday')!;
    const res = await new VoiceCommandRouter().dispatch(intentOut, {} as never);
    expect(res.side_effects).toContain('route_to_brain:conversational');
  });
});
