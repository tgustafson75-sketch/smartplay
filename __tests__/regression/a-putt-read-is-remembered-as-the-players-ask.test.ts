/**
 * 2026-10-28 (Brain recheck R7) — THE PUTT READ'S INSTRUCTIONS ARE FOR THE MODEL, NOT THE HISTORY.
 *
 * readPutt called askCaddie with no `heard`, so askCaddie saved composeInstruction() — PUTT + FLAG
 * (+ GRAZING), ~1.8KB — as the PLAYER's turn in the shared history and fed it to the style learner.
 * For the next exchanges Kevin read "ask me to lay the phone on the green… tell me to re-tap it" as
 * things Tim had asked of him, and every later turn carried the text as input tokens. The scene read
 * (a-scene-read-is-one-voice-in-one-conversation.test.ts) was fixed in 7bfcb2d1; this twin was missed.
 *
 * BEHAVIOURAL: the real readPutt → askCaddie against a mocked fetch.
 */
jest.mock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));

describe('a putt read', () => {
  const realFetch = global.fetch;
  let posts: Record<string, unknown>[] = [];

  beforeEach(() => {
    posts = [];
    global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith('/api/kevin')) posts.push(JSON.parse(init?.body ?? '{}'));
      return { ok: true, status: 200, json: async () => ({ text: 'Firm pace, start it a cup outside left.', audioBase64: null }) };
    }) as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = realFetch; });

  const measured = {
    distanceFeet: 18, ground: null, groundConfidence: null, groundSpots: 0,
    imageBase64: 'abc', frameFromGround: true, targetPoint: { xNorm: 0.5, yNorm: 0.4 },
  };

  it('THE BUG: the history keeps a short ask as the player turn, not the model instructions', async () => {
    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    hist.setConversationHistory([]);
    const { readPutt } = require('../../services/puttReadService') as typeof import('../../services/puttReadService');
    await readPutt(measured);
    const h = hist.getConversationHistory();
    expect(h).toHaveLength(2);
    expect(h[0].role).toBe('user');
    expect(h[0].content).toBe('Read this putt for me.');
    expect(h[0].content).not.toMatch(/lay the phone|re-tap|flagstick/i);
    // The model still gets every instruction.
    expect(String(posts[0].message)).toMatch(/lay the phone on the green/);
    expect(String(posts[0].message)).toMatch(/re-tap it/);
  });

  it('his own spoken read is his words, so the history keeps it', async () => {
    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    hist.setConversationHistory([]);
    const { readPutt } = require('../../services/puttReadService') as typeof import('../../services/puttReadService');
    await readPutt({ ...measured, spokenRead: 'left edge, firm' });
    expect(hist.getConversationHistory()[0].content).toBe('Read this putt for me. My read: left edge, firm');
  });
});
