/**
 * 2026-10-27 (Brain review F2 / F8) — AN IN-ROUND PROACTIVE LINE IS WRITTEN BY A BRAIN THAT KNOWS THE ROUND.
 *
 * generateProactiveLine always sent overrides { is_proactive: true, isRoundActive: false }. Right for
 * the get-to-know opener; wrong for the hole-change, streak and front_9_summary lines proactiveKevin
 * fires DURING a round: kevin dropped the CURRENT ROUND block (hole, score, vs par) and selected
 * "DIALOGUE MODE: OFF-COURSE … No round is active", then was asked to sum up the front nine (F2).
 * Those lines are read as TEXT and voiced by the phone, yet no skip_tts was sent, so the server
 * rendered a voice nobody heard — inside an 8s phone budget the TTS only made later (F8).
 *
 * BEHAVIOURAL: the real generateProactiveLine's request body, then that body through the real
 * api/kevin handler (model stubbed at the provider boundary) to see the prompt it builds.
 */
import handler from '../../api/kevin';
import { useRoundStore } from '../../store/roundStore';
import { generateProactiveLine, proactiveLineOrFallback } from '../../services/conversationalBrain';

jest.mock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));

const seen: { system: string; user: string } = { system: '', user: '' };
jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (_provider: string, _tier: string, system: string, user: string) => {
      seen.system = system;
      seen.user = user;
      return { text: 'Front nine in 41, five over.', provider: 'anthropic', rounds: 1, usage: null };
    }),
  };
});
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })) } },
  chat: { completions: { create: jest.fn(async () => ({ choices: [{ message: { content: '' } }] })) } },
})));
jest.mock('../../api/_inferLimit', () => ({ allowInference: () => true }));
jest.mock('../../api/_cors', () => ({ applyCors: () => false }));

const FRONT_9 = 'The front nine is done. Sum it up in one short sentence.';

function callKevin(body: Record<string, unknown>): Promise<number> {
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      setHeader: () => res,
      status(code: number) { status = code; return res; },
      json() { resolve(status); return res; },
      end() { resolve(status); return res; },
    };
    void handler({ method: 'POST', headers: {}, query: {}, body } as never, res as never);
  });
}

describe('proactive lines carry the round they are spoken in', () => {
  const realFetch = global.fetch;
  let sent: Array<Record<string, unknown>>;

  beforeEach(() => {
    sent = [];
    global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
      sent.push(init?.body ? JSON.parse(init.body) : {});
      return { ok: true, status: 200, json: async () => ({ text: 'Front nine in 41.', audioBase64: null }) };
    }) as unknown as typeof fetch;
    useRoundStore.setState({ isRoundActive: true, currentHole: 10, shots: [] } as never);
  });
  afterEach(() => {
    global.fetch = realFetch;
    useRoundStore.setState({ isRoundActive: false } as never);
  });

  it('an in-round trigger (front_9_summary) reports the live round and asks for no server voice', async () => {
    await proactiveLineOrFallback(FRONT_9, 'Front nine done.', { timeoutMs: 5_000, seedHistory: true });
    expect(sent.length).toBe(1);
    expect(sent[0].is_proactive).toBe(true);
    expect(sent[0].isRoundActive).toBe(true);
    expect(sent[0].skip_tts).toBe(true);
  });

  it('an off-round caller (the get-to-know opener) still says there is no round', async () => {
    await proactiveLineOrFallback('Get to know them.', 'Hi.', { timeoutMs: 5_000, offRound: true } as Parameters<typeof proactiveLineOrFallback>[2]);
    expect(sent.length).toBe(1);
    expect(sent[0].isRoundActive).toBe(false);
    expect(sent[0].skip_tts).toBe(true);
  });

  it('that body reaches kevin as an IN-ROUND prompt: CURRENT ROUND rendered, OFF-COURSE mode not selected', async () => {
    await generateProactiveLine(FRONT_9, { timeoutMs: 5_000 });
    const body = sent[0];
    global.fetch = realFetch; // the handler is not under the client's fetch mock
    seen.system = ''; seen.user = '';
    const status = await callKevin(body);
    expect(status).toBe(200);
    expect(seen.user).toContain('CURRENT ROUND');
    expect(seen.system).not.toContain('DIALOGUE MODE: OFF-COURSE');
  });
});
