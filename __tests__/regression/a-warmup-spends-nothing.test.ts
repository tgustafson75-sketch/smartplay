/**
 * 2026-10-27 (security audit Critical #2) — a warmup must spend $0.
 *
 * Six routes answered `{ mode: 'warmup' }` by making a real paid call (a 1-token LLM ping, a TTS
 * clip, a Gemini ping), and four of them did it BEFORE the rate limiter, so anyone could loop the
 * warmup and run up the provider bill with no limit at all. Warmup exists for cold start only: the
 * Lambda is up the moment the request lands. Each handler is called here with the provider SDKs
 * mocked, and every provider entry point must stay untouched.
 */
const providerCalls: string[] = [];
const hit = (name: string) => jest.fn(async () => { providerCalls.push(name); return { text: '', json: {} }; });

jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: hit('completeText'),
    completeJSON: hit('completeJSON'),
    completeVision: hit('completeVision'),
    completeWithTools: hit('completeWithTools'),
    runAgenticLoop: hit('runAgenticLoop'),
  };
});
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: jest.fn(async () => { providerCalls.push('openai.tts'); return { arrayBuffer: async () => new ArrayBuffer(0) }; }) } },
  chat: { completions: { create: jest.fn(async () => { providerCalls.push('openai.chat'); return { choices: [{ message: { content: '' } }] }; }) } },
})));
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: jest.fn(async () => { providerCalls.push('gemini'); return { text: '' }; }) },
  })),
  Type: new Proxy({}, { get: (_t, k) => String(k) }),
}));
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: jest.fn(async () => { providerCalls.push('anthropic'); return { content: [] }; }) },
})));
jest.mock('../../api/_cors', () => ({ applyCors: () => false }));

process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

type Handler = (req: unknown, res: unknown) => unknown;

function call(handler: Handler, query: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      setHeader: () => res,
      status(code: number) { status = code; return res; },
      json() { resolve(status); return res; },
      send() { resolve(status); return res; },
      end() { resolve(status); return res; },
    };
    void handler({ method: 'POST', headers: {}, query, body: { mode: 'warmup' } } as never, res as never);
  });
}

const ROUTES = ['kevin', 'voice', 'voice-intent', 'kevin-read', 'briefing', 'swing-analysis'] as const;

describe('a warmup answers 200 and calls no paid provider', () => {
  beforeEach(() => { providerCalls.length = 0; });

  for (const route of ROUTES) {
    it(`/api/${route}`, async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const handler = (require(`../../api/${route}`) as { default: Handler }).default;
      expect(await call(handler)).toBe(200);
      expect(providerCalls).toEqual([]);
    });
  }
});
