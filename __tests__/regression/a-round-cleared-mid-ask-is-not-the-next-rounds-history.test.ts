/**
 * 2026-10-29 (Brain recheck r13) — AN ANSWER THAT ARRIVES AFTER THE THREAD WAS CLEARED IS NOT THE NEW ROUND'S.
 *
 * askCaddie appended its exchange to the shared history after the await, with no check that the thread
 * was still the one he asked in. Start Round clears that history, so a question sent before the tap and
 * answered after it landed in the new round's thread, and the new round's first turns read last round's
 * exchange as current context. The putt-ask note at the same seam could mark the new hole as awaiting putts.
 *
 * BEHAVIOURAL: the real askCaddie, with the fetch held open until the test releases it, and the same
 * clear that startRound makes between the send and the answer.
 */
describe('an answer that arrives after the thread was cleared is not filed into the new one', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
    jest.doMock('../../services/unifiedVisionContext', () => ({ getUnifiedVisionContext: async () => ({ promptBlock: null }) }));
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.dontMock('../../services/featureAccess');
    jest.dontMock('../../services/unifiedVisionContext');
  });

  it('the thread stays empty when Start Round clears it while the question is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    global.fetch = jest.fn(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => ({ text: 'Smooth 8-iron.', audioBase64: null, toolAction: null }) };
    }) as unknown as typeof fetch;

    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    const { askCaddie } = require('../../services/caddieBrain') as typeof import('../../services/caddieBrain');
    hist.setConversationHistory([]);

    const pending = askCaddie({ message: 'what club from 150', language: 'en', timeoutMs: 5_000 });
    hist.clearConversationHistory(); // startRound's clear, between the send and the answer
    release();
    const turn = await pending;

    expect(turn?.text).toBe('Smooth 8-iron.'); // the player still hears his answer
    expect(hist.getConversationHistory()).toEqual([]);
  });

  it('control: with no clear in between, the exchange is filed as before', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    global.fetch = jest.fn(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => ({ text: 'Smooth 8-iron.', audioBase64: null, toolAction: null }) };
    }) as unknown as typeof fetch;

    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    const { askCaddie } = require('../../services/caddieBrain') as typeof import('../../services/caddieBrain');
    hist.setConversationHistory([]);

    const pending = askCaddie({ message: 'what club from 150', language: 'en', timeoutMs: 5_000 });
    release();
    await pending;

    expect(hist.getConversationHistory().map((m) => m.content)).toEqual(['what club from 150', 'Smooth 8-iron.']);
  });
});
