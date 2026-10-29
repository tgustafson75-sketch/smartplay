/**
 * 2026-10-28 (Brain review r5) — A SCENE READ IS RENDERED ONCE AND REMEMBERED.
 *
 * SmartFinder's scene read (services/sceneReadService) POSTed /api/kevin with its own body:
 *   • no skip_tts — the server rendered the persona's voice for every read, and both callers
 *     (app/smartfinder) then speak `text` through speak(), which renders it again. Paid twice, one
 *     thrown away, on a 60s Sonnet turn.
 *   • it bypassed askCaddie, so the read never joined the shared conversation history: "so what
 *     club?" right after the read reached a caddie with no idea he had just read the shot.
 *
 * BEHAVIOURAL: the real readScene → askCaddie against a mocked fetch.
 */
jest.mock('../../services/sceneReadContext', () => ({
  buildSceneSensorContext: () => ({
    block: 'SENSOR TRUTH (measured — ground the scene read in these):\nMeasured wind: 12 mph from the NW.',
    caption: 'Scene the player is looking at from their position.',
    hasWind: true,
  }),
}));

describe('a scene read', () => {
  const realFetch = global.fetch;
  let posts: Record<string, unknown>[] = [];

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
    posts = [];
    global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith('/api/kevin')) posts.push(JSON.parse(init?.body ?? '{}'));
      return { ok: true, status: 200, json: async () => ({ text: 'Water right, wind into you off the left. Hold it left-center, one more club.', audioBase64: null }) };
    }) as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = realFetch; jest.dontMock('../../services/featureAccess'); });

  it('asks the server for text only — the caller renders the voice', async () => {
    const { readScene } = require('../../services/sceneReadService') as typeof import('../../services/sceneReadService');
    const r = await readScene({ imageBase64: 'abc', targetYards: 152 });
    expect(r?.text).toMatch(/Water right/);
    expect(posts).toHaveLength(1);
    expect(posts[0].skip_tts).toBe(true);
    // Still the multimodal read, grounded in the measured wind.
    expect(posts[0].image_base64).toBe('abc');
    expect(String(posts[0].unified_context_block)).toContain('Measured wind: 12 mph');
  });

  it('joins the shared conversation, so the next question has the read in context', async () => {
    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    hist.setConversationHistory([]);
    const { readScene } = require('../../services/sceneReadService') as typeof import('../../services/sceneReadService');
    await readScene({ imageBase64: 'abc' });
    const h = hist.getConversationHistory();
    expect(h).toHaveLength(2);
    expect(h[0].role).toBe('user');
    expect(h[1].content).toMatch(/Water right/);
  });
});
