/**
 * 2026-10-28 (Brain recheck R7) — "THE BRAIN IS DOWN" IS AN ANSWER, ON EVERY ROUTE.
 *
 * When api/kevin's model ladder (Sonnet, its retry, the Gemini fallback) has all failed it answers 200
 * with error/errorType, and askCaddie reports that as 'refused'. Round 5 taught followUpBrainTurn not
 * to retry it, and only that route learned it:
 *   • conversationalBrainTurn dropped 'refused' into a plain NO_ANSWER, so the earbud / badge /
 *     hands-free branch of services/listeningSession ran the whole server ladder again (that half is
 *     in an-earbud-turn-we-timed-out-is-not-billed-twice.test.ts);
 *   • inRoundDiagnosticHandler answered only a timeout itself; a refused read came back success:false,
 *     so every route handed the same words to /api/kevin for a second full turn.
 *
 * BEHAVIOURAL: the real askCaddie → conversationalBrainTurn chain against a fetch that answers the
 * 200-with-error shape, and the real diagnostic handler.
 */
jest.mock('../../services/caddieFailureReply', () => ({
  caddieFailureReply: jest.fn(async () => ({ text: 'My brain is offline for a second — ask me again.', source: 'on_us', verdict: 'internet_ok' })),
}));
jest.mock('../../services/unifiedVisionContext', () => ({ getUnifiedVisionContext: async () => ({ promptBlock: null }) }));
jest.mock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));

import type { VoiceIntent, AppContext } from '../../types/voiceIntent';

describe('a turn the server refused', () => {
  const realFetch = global.fetch;
  let posts = 0;

  beforeEach(() => {
    posts = 0;
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).endsWith('/api/kevin')) posts += 1;
      return { ok: true, status: 200, json: async () => ({ text: "I'm having trouble connecting — try that again.", error: 'overloaded', errorType: 'overloaded_error' }) };
    }) as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = realFetch; });

  it('THE BUG: conversationalBrainTurn says it was refused, so its caller can skip the retry', async () => {
    const { conversationalBrainTurn } = require('../../services/conversationalBrain') as typeof import('../../services/conversationalBrain');
    const r = await conversationalBrainTurn('tell me about this hole');
    expect(r.text).toBeNull();
    expect(r.refused).toBe(true);
    expect(r.timedOut).toBeFalsy();
    expect(posts).toBe(1);
  });

  it('THE BUG: the in-round diagnostic answers a refusal itself, so no route asks the brain again', async () => {
    const { inRoundDiagnosticHandler } = require('../../services/intents/inRoundDiagnosticHandler') as typeof import('../../services/intents/inRoundDiagnosticHandler');
    const { resultWantsBrain } = require('../../services/voiceCommandRouter') as typeof import('../../services/voiceCommandRouter');
    const intent = {
      intent_type: 'in_round_diagnostic',
      confidence: 'high',
      raw_text: 'why am I slicing it',
      parameters: { pattern_text: 'slicing the driver' },
    } as unknown as VoiceIntent;
    const r = await inRoundDiagnosticHandler.execute(intent, { language: 'en' } as unknown as AppContext);
    expect(r.success).toBe(true);
    expect(r.voice_response).toBe('My brain is offline for a second — ask me again.');
    expect(resultWantsBrain(r)).toBe(false);
    expect(r.side_effects).toContain('in_round_diagnostic:refused:on_us');
    expect(posts).toBe(1);
  });
});
