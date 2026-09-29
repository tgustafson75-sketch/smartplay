/**
 * 2026-09-29 — /api/swing-analysis, driven through its real handler with the three provider SDKs
 * replaced by recorders. Two properties, on EVERY provider path (Gemini speed path, OpenAI
 * escalation, Anthropic last resort):
 *
 *  1. every image is preceded by "Frame i — N ms into the clip", so the model reads a timed sequence
 *     and cites the same index fault_frame_index uses;
 *  2. phase coverage is enforced in code — a fault defined at a phase the model says it did not see
 *     is refused, and a read that saw neither the top nor impact cannot be more than low confidence.
 *
 * The provider ORDER and MODELS are asserted unchanged, because this change must not move them.
 */
process.env.GOOGLE_API_KEY = 'test-google';
process.env.OPENAI_API_KEY = 'test-openai';
process.env.ANTHROPIC_API_KEY = 'test-anthropic';

const geminiCalls: { model: string; contents: { parts: Record<string, unknown>[] }[] }[] = [];
const openaiCalls: { model: string; messages: { role: string; content: unknown }[] }[] = [];
const anthropicCalls: { model: string; messages: { role: string; content: Record<string, unknown>[] }[] }[] = [];
let geminiReply: () => Promise<{ text: string }>;
let openaiReply: () => Promise<unknown>;
let anthropicReply: () => Promise<unknown>;

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: (req: (typeof geminiCalls)[number]) => { geminiCalls.push(req); return geminiReply(); },
    },
  })),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER', ARRAY: 'ARRAY', NUMBER: 'NUMBER' },
}));
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (req: (typeof openaiCalls)[number]) => { openaiCalls.push(req); return openaiReply(); } } },
  })),
}));
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: (req: (typeof anthropicCalls)[number]) => { anthropicCalls.push(req); return anthropicReply(); } },
  })),
}));

import handler from '../../api/swing-analysis';
import { __resetInMemory } from '../../api/_rateLimit';

const TIMES = [1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800];
const FRAMES = TIMES.map((t, i) => ({ b64: `IMG${i}`, media_type: 'image/jpeg', t_ms: t }));

const read = (over: Record<string, unknown> = {}) => JSON.stringify({
  valid_swing: true, validity_reason: null,
  detected_issue: 'over_the_top', severity: 'moderate', confidence: 'high',
  primary_fault: 'over_the_top', fault_frame_index: 4,
  observation: 'Your club drops over the plane from the top.',
  cause: 'Shoulders start the downswing.', fix: 'Start down with the lower body.', drill: 'Pump drill.',
  evidence: 'Frame 4: shaft outside the hands.', layman_explanation: 'You come over it.',
  strengths: [], contact_read: 'unknown',
  phases_visible: { address: true, top: true, impact: true, finish: true },
  ...over,
});

async function post(body: Record<string, unknown>) {
  const state: { code: number | null; body: Record<string, unknown> | null } = { code: null, body: null };
  const res = {
    status(c: number) { state.code = c; return res; },
    json(b: Record<string, unknown>) { state.body = b; return res; },
    setHeader() { return res; },
    end() { return res; },
  };
  await handler({ method: 'POST', headers: { 'x-forwarded-for': '10.0.0.1' }, socket: {}, body } as never, res as never);
  return state;
}

beforeEach(() => {
  __resetInMemory();
  geminiCalls.length = 0;
  openaiCalls.length = 0;
  anthropicCalls.length = 0;
  geminiReply = async () => ({ text: read() });
  openaiReply = async () => ({ choices: [{ message: { content: read() } }] });
  anthropicReply = async () => ({ content: [{ type: 'text', text: read() }] });
});

/** Every image in `parts` is immediately preceded by its label, in order. */
function expectLabelled(parts: Record<string, unknown>[], isImage: (p: Record<string, unknown>) => boolean, textOf: (p: Record<string, unknown>) => unknown) {
  const imageAt = parts.map((p, i) => (isImage(p) ? i : -1)).filter((i) => i >= 0);
  expect(imageAt).toHaveLength(9);
  imageAt.forEach((at, n) => {
    expect(textOf(parts[at - 1])).toBe(`Frame ${n} — ${TIMES[n]} ms into the clip`);
  });
}

describe('every provider path labels every frame with its index and time', () => {
  it('Gemini (the speed path)', async () => {
    const r = await post({ frames: FRAMES, context: { tier: 'quick', club: '7i' } });
    expect(r.code).toBe(200);
    expect(geminiCalls).toHaveLength(1);
    expect(geminiCalls[0].model).toBe('gemini-2.5-flash');
    expectLabelled(geminiCalls[0].contents[0].parts, (p) => 'inlineData' in p, (p) => p.text);
  });

  it('OpenAI (the full-tier escalation)', async () => {
    geminiReply = async () => ({ text: '' });
    const r = await post({ frames: FRAMES, context: { tier: 'full', club: '7i' } });
    expect(r.code).toBe(200);
    expect(openaiCalls).toHaveLength(1);
    expect(openaiCalls[0].model).toBe('gpt-4o');
    const user = openaiCalls[0].messages.find((m) => m.role === 'user')!;
    expectLabelled(user.content as Record<string, unknown>[], (p) => p.type === 'image_url', (p) => p.text);
  });

  it('Anthropic (the last resort)', async () => {
    geminiReply = async () => ({ text: '' });
    openaiReply = async () => { throw new Error('openai down'); };
    const r = await post({ frames: FRAMES, context: { tier: 'full', club: '7i' } });
    expect(r.code).toBe(200);
    expect(anthropicCalls).toHaveLength(1);
    expect(anthropicCalls[0].model).toBe('claude-haiku-4-5-20251001');
    expectLabelled(anthropicCalls[0].messages[0].content, (p) => p.type === 'image', (p) => p.text);
  });

  it('an older client with no times still gets indexed labels', async () => {
    await post({ frames: FRAMES.map(({ b64, media_type }) => ({ b64, media_type })), context: { tier: 'quick' } });
    const parts = geminiCalls[0].contents[0].parts;
    expect(parts.filter((p) => typeof p.text === 'string' && /^Frame \d+$/.test(p.text as string))).toHaveLength(9);
  });
});

describe('phase coverage is enforced, not merely requested', () => {
  it('over-the-top without the top in frame is refused as inconclusive — on the card AND in detected_issue', async () => {
    geminiReply = async () => ({ text: read({ phases_visible: { address: true, top: false, impact: true, finish: true } }) });
    const r = await post({ frames: FRAMES, context: { tier: 'quick' } });
    expect(r.body!.primary_fault).toBe('inconclusive');
    expect(r.body!.detected_issue).toBe('none');
    expect(r.body!.fix).toBe('');
    expect(r.body!.phase_gate).toEqual({ refused: 'over_the_top', missing: ['top'] });
    expect(r.body!.confidence).toBe('low');
    expect(String(r.body!.observation)).toMatch(/top of your swing/);
    expect(String(r.body!.observation)).not.toMatch(/drops over the plane/);
  });

  it('neither the top nor impact seen → confidence capped at low (the beta medium→high relabel cannot lift it)', async () => {
    geminiReply = async () => ({ text: read({
      primary_fault: 'no_dominant_fault', detected_issue: 'none', severity: 'none',
      phases_visible: { address: true, top: false, impact: false, finish: true },
    }) });
    const r = await post({ frames: FRAMES, context: { tier: 'quick' } });
    expect(r.body!.confidence).toBe('low');
  });

  it('early extension needs impact; chicken wing accepts the follow-through', async () => {
    geminiReply = async () => ({ text: read({
      primary_fault: 'early_extension', detected_issue: 'early_extension',
      phases_visible: { address: true, top: true, impact: false, finish: true },
    }) });
    expect((await post({ frames: FRAMES, context: { tier: 'quick' } })).body!.primary_fault).toBe('inconclusive');

    geminiReply = async () => ({ text: read({
      primary_fault: 'chicken_wing', detected_issue: 'chicken_wing',
      phases_visible: { address: true, top: true, impact: false, finish: true },
    }) });
    const cw = await post({ frames: FRAMES, context: { tier: 'quick' } });
    expect(cw.body!.primary_fault).toBe('chicken_wing');
    expect(cw.body!.phase_gate).toBeNull();
  });

  it('a fault whose phase WAS seen is untouched', async () => {
    const r = await post({ frames: FRAMES, context: { tier: 'quick' } });
    expect(r.body!.primary_fault).toBe('over_the_top');
    expect(r.body!.confidence).toBe('high');
    expect(r.body!.phases_visible).toEqual({ address: true, top: true, impact: true, finish: true });
  });

  it('a response with no phases_visible is not punished for a field it did not send', async () => {
    geminiReply = async () => ({ text: read({ phases_visible: undefined }) });
    const r = await post({ frames: FRAMES, context: { tier: 'quick' } });
    expect(r.body!.primary_fault).toBe('over_the_top');
    expect(r.body!.confidence).toBe('high');
    expect(r.body!.phases_visible).toBeNull();
  });

  it('a SETUP check (one address frame by design) is never capped for missing the top', async () => {
    geminiReply = async () => ({ text: read({
      primary_fault: 'no_dominant_fault', detected_issue: 'none', severity: 'none', confidence: 'high',
      phases_visible: { address: true, top: false, impact: false, finish: false },
    }) });
    const r = await post({ frames: [FRAMES[0]], context: { tier: 'quick', swing_tag: 'setup' } });
    expect(r.body!.confidence).toBe('high');
    expect(r.body!.phases_visible).toBeNull();
  });

  it('the schema asks every structured provider for phases_visible', async () => {
    await post({ frames: FRAMES, context: { tier: 'quick' } });
    const cfg = (geminiCalls[0] as unknown as { config: { responseSchema: { required: string[] } } }).config;
    expect(cfg.responseSchema.required).toContain('phases_visible');
    geminiReply = async () => ({ text: '' });
    await post({ frames: FRAMES, context: { tier: 'full' } });
    const fmt = (openaiCalls[0] as unknown as { response_format: { json_schema: { schema: { required: string[] } } } }).response_format;
    expect(fmt.json_schema.schema.required).toContain('phases_visible');
  });
});
