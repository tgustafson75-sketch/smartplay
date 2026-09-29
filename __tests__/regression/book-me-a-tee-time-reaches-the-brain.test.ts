/**
 * 2026-09-29 (Tim — "I still use GolfNow only for tee times"; "we don't have to verify Vet status,
 * pro shop will check the accuracy of the pricing category").
 *
 * BEHAVIOURAL, through the real api/kevin handler: the model and TTS are stubbed at the provider
 * boundary, everything between the request body and the response is the shipped code.
 *
 *   1. The profile's rate category reaches the caddie on the MESSAGE side of the prompt — and NOT the
 *      cached system block, where a value a player can change would bust the cache every turn (the
 *      2026-08-24 defect the sim ratchet guards).
 *   2. A find_tee_time call is a real tool: its result states the hand-off (nothing booked), and the
 *      action reaches the phone with every detail the player gave.
 */

const seen: { system: string; user: string; toolResult: string | null } = { system: '', user: '', toolResult: null };
let toolInput: Record<string, unknown> | null = null;

jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (
      _provider: string, _tier: string, system: string, user: string, _images: unknown[], _tools: unknown[],
      onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>,
    ) => {
      seen.system = system;
      seen.user = user;
      seen.toolResult = toolInput ? await onToolCall('find_tee_time', toolInput) : null;
      return { text: "I've opened their booking page — tell the shop you're after the veteran rate.", provider: 'anthropic', rounds: 1, usage: null };
    }),
  };
});
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    audio: { speech: { create: jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })) } },
    chat: { completions: { create: jest.fn(async () => ({ choices: [{ message: { content: '' } }] })) } },
  }));
});
jest.mock('../../api/_inferLimit', () => ({ allowInference: () => true }));
jest.mock('../../api/_cors', () => ({ applyCors: () => false }));

import handler from '../../api/kevin';

function call(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      setHeader: () => res,
      status(code: number) { status = code; return res; },
      json(payload: Record<string, unknown>) { resolve({ status, json: payload }); return res; },
      end() { resolve({ status, json: {} }); return res; },
    };
    void handler({ method: 'POST', headers: {}, query: {}, body } as never, res as never);
  });
}

beforeEach(() => {
  seen.system = ''; seen.user = ''; seen.toolResult = null; toolInput = null;
});

describe('the rate category reaches the caddie, per turn', () => {
  it('a veteran/military profile is said on the message side, never in the cached block', async () => {
    const r = await call({ message: 'book me a tee time Saturday morning at Menifee Lakes', rateCategory: 'veteran_military' });
    expect(r.status).toBe(200);
    expect(seen.user).toMatch(/veteran\/military rate/);
    expect(seen.system).not.toMatch(/veteran\/military rate/);
  });

  it('says nothing about a rate for a player who has none, or a value that is not a category', async () => {
    await call({ message: 'book me a tee time', rateCategory: 'none' });
    expect(seen.user).not.toMatch(/rate they ask for/);
    await call({ message: 'book me a tee time', rateCategory: 'platinum' });
    expect(seen.user).not.toMatch(/rate they ask for/);
  });

  it('"what\'s the pro shop number?" has an answer — per turn, not cached', async () => {
    await call({ message: "what's the pro shop number", proShop: { course: 'Menifee Lakes Country Club', phone: '(951) 672-3090' } });
    expect(seen.user).toMatch(/pro shop at Menifee Lakes Country Club: \(951\) 672-3090/);
    expect(seen.system).not.toMatch(/672-3090/);
  });

  it('the system prompt teaches the hand-off (static doctrine — safe in the cached block)', async () => {
    await call({ message: 'hi' });
    expect(seen.system).toMatch(/find_tee_time/);
    expect(seen.system).toMatch(/never "you're booked"/);
  });
});

describe('find_tee_time is a real tool, and it never claims a booking', () => {
  it('the tool result states the hand-off, and the action reaches the phone intact', async () => {
    toolInput = { course: 'Menifee Lakes', date: 'Saturday', time_window: 'morning', players: 2, transport: 'walking' };
    const r = await call({ message: 'book me a tee time Saturday morning at Menifee Lakes, two of us walking' });
    expect(seen.toolResult).toMatch(/NOTHING IS BOOKED/);
    expect(seen.toolResult).toMatch(/booking page/);
    expect(r.json.toolAction).toEqual({
      type: 'find_tee_time', course: 'Menifee Lakes', date: 'Saturday', time_window: 'morning', players: 2, transport: 'walking',
    });
  });
});
