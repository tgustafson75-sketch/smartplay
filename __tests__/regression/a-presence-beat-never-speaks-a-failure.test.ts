/**
 * 2026-10-27 (Brain review B9 / F9) — A PRESENCE BEAT NEVER SPEAKS THE SERVER'S FAILURE LINE.
 *
 * presenceCaddie and sceneReadService talked to /api/kevin with their own raw fetch (a presence beat
 * must not enter the shared history; the scene read has gone through askCaddie since 10-28). Both
 * read only res.ok + data.text, so kevin's outer-catch 200 — "I'm having trouble connecting — try
 * that again." plus error/errorType — came back as THE answer: "how far to the green" with no GPS
 * fix during a brain outage spoke the trouble line (cached 60s) instead of localPresenceFallback,
 * and a SmartFinder scene read handed back the failure line as the read. The presence call also
 * hard-coded language 'en' and never sent skip_tts, so it paid for server TTS it threw away.
 *
 * BEHAVIOURAL: the real presenceFill / readScene against a mocked fetch.
 */
const FAILURE_BODY = {
  text: "I'm having trouble connecting — try that again.",
  audioBase64: null,
  toolAction: null,
  error: 'provider exploded',
  errorType: 'Error',
};

describe('presence and scene reads treat a 200 carrying error/errorType as no answer', () => {
  const realFetch = global.fetch;
  let reply: unknown;
  let sent: Array<Record<string, unknown>>;

  beforeEach(() => {
    jest.resetModules();
    // The plan gate is not under test; closed, every call is null and the assertions pass for the wrong reason.
    jest.doMock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
    // markEndpointWarmed: the scene read goes through askCaddie since 2026-10-28 (Brain review r5).
    jest.doMock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'https://example.test', markEndpointWarmed: () => undefined }));
    sent = [];
    global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
      sent.push(init?.body ? JSON.parse(init.body) : {});
      return { ok: true, status: 200, json: async () => reply };
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.dontMock('../../services/featureAccess');
    jest.dontMock('../../services/apiBase');
  });

  it('a failed brain turn during a GPS drought gets the local presence line, not the trouble line', async () => {
    reply = FAILURE_BODY;
    const { presenceFill } = require('../../services/presenceCaddie') as typeof import('../../services/presenceCaddie');
    const line = await presenceFill({ trigger: 'gps_unready', context: { holeNumber: 4, par: 4, teeYardage: 380 } });
    expect(sent.length).toBe(1); // it DID ask the brain — the fallback is not reached by skipping the call
    expect(line).not.toMatch(/trouble connecting/i);
    expect(line).toBe('Still finding you. Hole 4, par 4, plays 380 from the tees. Yardage right back when signal sharpens.');
  });

  it('and the failure line is not what gets cached for the next re-ask', async () => {
    reply = FAILURE_BODY;
    const { presenceFill } = require('../../services/presenceCaddie') as typeof import('../../services/presenceCaddie');
    await presenceFill({ trigger: 'analysis_failed', context: { club: '7i' } });
    const again = await presenceFill({ trigger: 'analysis_failed', context: { club: '7i' } });
    expect(again).not.toMatch(/trouble connecting/i);
  });

  it('a real presence line is still used', async () => {
    reply = { text: 'Hole 4 plays long into the breeze — number in a sec.', audioBase64: null };
    const { presenceFill } = require('../../services/presenceCaddie') as typeof import('../../services/presenceCaddie');
    const line = await presenceFill({ trigger: 'gps_unready', context: { holeNumber: 4 } });
    expect(line).toBe('Hole 4 plays long into the breeze — number in a sec.');
  });

  it("the presence call asks in the player's language and asks for no server voice", async () => {
    reply = { text: 'Un momento.', audioBase64: null };
    const { useSettingsStore } = require('../../store/settingsStore') as typeof import('../../store/settingsStore');
    useSettingsStore.setState({ language: 'es' } as never);
    const { presenceFill } = require('../../services/presenceCaddie') as typeof import('../../services/presenceCaddie');
    await presenceFill({ trigger: 'mic_blocked', context: {} });
    expect(sent.length).toBe(1);
    expect(sent[0].language).toBe('es');
    expect(sent[0].skip_tts).toBe(true);
  });

  it('a failed scene read is no read', async () => {
    reply = FAILURE_BODY;
    const { readScene } = require('../../services/sceneReadService') as typeof import('../../services/sceneReadService');
    const r = await readScene({ imageBase64: 'AAAA', targetYards: 150 });
    expect(sent.length).toBe(1);
    expect(r).toBeNull();
  });

  it('a real scene read still comes back', async () => {
    reply = { text: 'Flag is back-left, bunker short-right.', audioBase64: null };
    const { readScene } = require('../../services/sceneReadService') as typeof import('../../services/sceneReadService');
    const r = await readScene({ imageBase64: 'AAAA', targetYards: 150 });
    expect(r?.text).toBe('Flag is back-left, bunker short-right.');
  });
});
