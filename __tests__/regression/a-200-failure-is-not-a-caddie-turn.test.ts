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
 * The tap mic's follow-up loop (useVoiceCaddie.sendToBrain) is a second transport to /api/kevin. On a
 * 200-with-error and no local answer it spoke the server's "having trouble connecting" (data.text) as
 * the reply, and its catch ended in its own "Give me one sec and ask me again." — both bypassing the
 * failure owner. The hook cannot be loaded under jest (its import chain pulls native modules — tried,
 * endRoundFlow fails to load), so this is a structural pin of the wiring; the owner's behaviour is
 * tested in a-turn-failure-says-what-is-true.
 */
describe('the follow-up loop hands every failed turn to caddieFailureReply', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../hooks/useVoiceCaddie.ts'), 'utf8') as string;
  const fn = src.slice(src.indexOf('const sendToBrain = async'), src.indexOf('// ── SPEAK RESPONSE'));
  it('no failure line of its own, and the server canned text is never the reply', () => {
    expect(fn.length).toBeGreaterThan(1000);
    expect(fn).not.toMatch(/'Give me one sec and ask me again\.'/);
    expect(fn).toMatch(/if \(isFallback\) return failedTurn\(\);/);
    expect(fn).toMatch(/if \(d\.error \|\| d\.errorType\) return failedTurn\(\);/);
    expect(fn).toMatch(/const failedTurn = async[\s\S]{0,600}caddieFailureReply\(\{ heard,/); // 2026-10-28 — his words, before the reshape
  });
});
