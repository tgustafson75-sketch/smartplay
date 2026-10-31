/**
 * 2026-10-29 (Brain review S1-1) — A LATE NETWORK DROP IS NOT A FAST FAILURE.
 *
 * followUpBrainTurn retried ONCE on any 'failed' outcome. 'failed' covers a dropped socket, and a socket
 * can drop ~25s into a 30s warm window. The retry then called ask() again with a fresh full window, so
 * the first request (which the server already received and is billing) was paid for twice, and the
 * player waited up to another whole window. The comment promised "fast failures only"; nothing measured
 * time. Only the client's own timeout and a 'refused' were excluded.
 *
 * BEHAVIOURAL: the real askCaddie → followUpBrainTurn chain against a fetch that drops the socket, with
 * a controlled clock so "late" and "fast" are real elapsed time.
 */
jest.mock('../../services/caddieFailureReply', () => ({
  ...jest.requireActual('../../services/caddieFailureReply'),
  caddieFailureReply: jest.fn(async () => ({ text: 'Say that again?', source: 'on_us', verdict: null })),
}));
jest.mock('../../services/unifiedVisionContext', () => ({ getUnifiedVisionContext: async () => ({ promptBlock: null }) }));
jest.mock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
jest.mock('../../services/apiBase', () => ({
  getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: jest.fn(),
}));

describe('a follow-up whose connection dropped late', () => {
  const realFetch = global.fetch;
  const realNow = Date.now;
  let clock = 1_000_000;
  let kevinPosts = 0;

  beforeEach(() => {
    clock = 1_000_000;
    Date.now = () => clock;
    kevinPosts = 0;
  });
  afterEach(() => {
    global.fetch = realFetch;
    Date.now = realNow;
  });

  /** A fetch whose socket dies after `dropAfterMs` of the server's time, as a real network would. */
  const dropAfter = (dropAfterMs: number) => {
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).endsWith('/api/kevin')) {
        kevinPosts += 1;
        clock += dropAfterMs;
        throw new TypeError('Network request failed');
      }
      throw new TypeError('unexpected url');
    }) as unknown as typeof fetch;
  };

  it('THE BUG: a drop ~25s into the window is NOT retried, so the question is not paid for twice', async () => {
    const { followUpBrainTurn } = require('../../services/voice/followUpBrainTurn') as typeof import('../../services/voice/followUpBrainTurn');
    dropAfter(25_000);
    const r = await followUpBrainTurn('how far is the pin', { language: 'en' });
    expect(kevinPosts).toBe(1);
    expect(r.fallback).toBe(true);
  });

  it('a fast drop (a blip) still gets the one retry', async () => {
    const { followUpBrainTurn } = require('../../services/voice/followUpBrainTurn') as typeof import('../../services/voice/followUpBrainTurn');
    dropAfter(500);
    await followUpBrainTurn('how far is the pin', { language: 'en' });
    expect(kevinPosts).toBe(2);
  });
});
