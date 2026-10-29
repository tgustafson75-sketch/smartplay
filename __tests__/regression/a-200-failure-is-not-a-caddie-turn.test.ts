/**
 * 2026-10-15 (review) — A FAILURE THAT ARRIVES AS HTTP 200 IS NOT THE CADDIE TALKING.
 *
 * api/kevin's outer catch answers 200 with "I'm having trouble connecting — try that again." plus
 * `error` / `errorType`. askCaddie returned it as a real turn, so every surface spoke it as Kevin's
 * answer, appendConversationTurn filed it in the shared history, and proactive lines (which have a
 * designed fallback for a brain that cannot answer) read the failure out unprompted instead.
 *
 * BEHAVIOURAL: the real askCaddie / conversationalBrain against a mocked fetch.
 */
const FAILURE_BODY = {
  text: "I'm having trouble connecting — try that again.",
  audioBase64: null,
  toolAction: null,
  error: 'provider exploded',
  errorType: 'Error',
};

describe('a 200 carrying error/errorType is no answer', () => {
  const realFetch = global.fetch;
  let body: unknown;

  beforeEach(() => {
    jest.resetModules();
    // The plan gate is not under test; with it closed every turn is null and the failure assertions
    // would pass for the wrong reason.
    jest.doMock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = realFetch; jest.dontMock('../../services/featureAccess'); });

  it('askCaddie returns null and writes NOTHING into the shared conversation', async () => {
    body = FAILURE_BODY;
    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    const { askCaddie } = require('../../services/caddieBrain') as typeof import('../../services/caddieBrain');
    hist.setConversationHistory([]);
    const turn = await askCaddie({ message: 'what club from 150', language: 'en', timeoutMs: 5_000 });
    expect(turn).toBeNull();
    expect(hist.getConversationHistory()).toEqual([]);
  });

  it('a real answer is still a turn, and still filed in the history', async () => {
    body = { text: 'Smooth 8-iron.', audioBase64: null, toolAction: null };
    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    const { askCaddie } = require('../../services/caddieBrain') as typeof import('../../services/caddieBrain');
    hist.setConversationHistory([]);
    const turn = await askCaddie({ message: 'what club from 150', language: 'en', timeoutMs: 5_000 });
    expect(turn?.text).toBe('Smooth 8-iron.');
    expect(hist.getConversationHistory().map((m) => m.content)).toEqual(['what club from 150', 'Smooth 8-iron.']);
  });

  it('a proactive line never reads the failure out — it gets the designed fallback', async () => {
    body = FAILURE_BODY;
    const brain = require('../../services/conversationalBrain') as typeof import('../../services/conversationalBrain');
    const line = await brain.proactiveLineOrFallback('Introduce hole 4.', 'Hole 4, par 4, 380.', { timeoutMs: 5_000 });
    expect(line?.text).toBe('Hole 4, par 4, 380.');
    const opener = await brain.generateProactiveOpener({ timeoutMs: 5_000 });
    expect(opener.text).toBeNull();
  });

  it('the typed/earbud brain turn reports no answer, so the caller owns the failure line', async () => {
    body = FAILURE_BODY;
    const brain = require('../../services/conversationalBrain') as typeof import('../../services/conversationalBrain');
    const r = await brain.conversationalBrainTurn('what club from 150', { timeoutMs: 5_000 });
    expect(r.text).toBeNull();
  });
});

/**
 * The tap mic's follow-up loop (useVoiceCaddie.sendToBrain) was a second transport to /api/kevin. On a
 * 200-with-error and no local answer it spoke the server's "having trouble connecting" (data.text) as
 * the reply, and its catch ended in its own "Give me one sec and ask me again." — both bypassing the
 * failure owner.
 *
 * 2026-10-28 (Brain review r5) — it now asks through askCaddie (services/voice/followUpBrainTurn), so
 * this is BEHAVIOURAL: the real follow-up turn against the same 200-with-error body.
 */
describe('the follow-up loop hands every failed turn to caddieFailureReply', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
    jest.doMock('../../services/unifiedVisionContext', () => ({ getUnifiedVisionContext: async () => ({ promptBlock: null }) }));
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => FAILURE_BODY })) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.dontMock('../../services/featureAccess');
    jest.dontMock('../../services/unifiedVisionContext');
  });

  it('the server canned text is never the reply, and the failed turn is a fallback', async () => {
    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    hist.setConversationHistory([]);
    const { followUpBrainTurn } = require('../../services/voice/followUpBrainTurn') as typeof import('../../services/voice/followUpBrainTurn');
    const r = await followUpBrainTurn('what club from 150', { language: 'en' });
    expect(r.text).not.toMatch(/trouble connecting/i);
    expect(r.text).not.toBe('Give me one sec and ask me again.');
    expect(r.text.length).toBeGreaterThan(0);
    expect(hist.getConversationHistory()).toEqual([]);
  });
});
