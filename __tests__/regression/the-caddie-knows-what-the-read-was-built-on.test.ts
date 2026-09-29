/**
 * 2026-09-29 — "DID IT SEE MY WHOLE SWING?" IS A QUESTION THE CADDIE CAN ANSWER.
 *
 * The nine-frame read records where its frames came from (sample_coverage), which phases the model
 * actually saw (phases_visible) and caps confidence when it saw neither the top nor impact. The review
 * SHOWS all of that; none of it reached the brain, so the caddie could only guess at why a read was
 * low confidence. This builds the real request body after an analysis and reads what it carries.
 */
import fs from 'fs';
import path from 'path';
import handler from '../../api/kevin';
import { useCaptureEngineStore } from '../../store/captureEngineStore';
import { buildCaddieRequestBody, CADDIE_REQUEST_KEYS } from '../../services/caddieRequestBody';

const seen: { system: string; user: string } = { system: '', user: '' };

// The model and TTS are stubbed at the provider boundary (as book-me-a-tee-time-reaches-the-brain does);
// everything between the request body and the prompt the model would receive is the shipped handler.
jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (_provider: string, _tier: string, system: string, user: string) => {
      seen.system = system;
      seen.user = user;
      return { text: 'It saw address and the finish, not the top.', provider: 'anthropic', rounds: 1, usage: null };
    }),
  };
});
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })) } },
  chat: { completions: { create: jest.fn(async () => ({ choices: [{ message: { content: '' } }] })) } },
})));
jest.mock('../../api/_inferLimit', () => ({ allowInference: () => true }));
jest.mock('../../api/_cors', () => ({ applyCors: () => false }));

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

/**
 * The body of api/kevin's cached system prompt: `const systemPrompt = \`` to its closing backtick,
 * tracking ${} depth — the same boundary scripts/simulations/run-sim.ts's cached-prompt RATCHET parses.
 * Throws rather than returning '' so a moved/renamed declaration can never pass vacuously.
 */
function cachedSystemPromptSource(k: string): string {
  const marker = 'const systemPrompt = `';
  const open = k.indexOf(marker);
  if (open < 0) throw new Error('api/kevin.ts: `const systemPrompt = \`` not found — the cached-block boundary moved');
  let i = open + marker.length;
  let depth = 0;
  while (i < k.length) {
    const c = k[i];
    if (c === '\\') { i += 2; continue; }
    if (depth === 0 && c === '`') return k.slice(open + marker.length, i);
    if (c === '$' && k[i + 1] === '{') { depth++; i += 2; continue; }
    if (depth > 0) { if (c === '{') depth++; else if (c === '}') depth--; }
    i++;
  }
  throw new Error('api/kevin.ts: cached system prompt template never closed');
}

/** The message-side live facts block: the liveFactsBlock IIFE, up to its WHAT YOU CAN SEE RIGHT NOW return. */
function liveFactsBlockSource(k: string): string {
  const start = k.indexOf('const liveFactsBlock = (() => {');
  const end = k.indexOf('WHAT YOU CAN SEE RIGHT NOW', start);
  if (start < 0 || end < 0) throw new Error('api/kevin.ts: liveFactsBlock boundary not found');
  return k.slice(start, end);
}

const body = () => buildCaddieRequestBody({ message: 'did it see my whole swing?', language: 'en' });
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

afterEach(() => useCaptureEngineStore.getState().setReviewingClip(null));

describe('the request body built after an analysis carries what the read was built on', () => {
  it('coverage, phases seen and missed, the capped confidence and why, and the captured fps', () => {
    useCaptureEngineStore.getState().setReviewingClip({
      fps: 60,
      read: {
        coverage: { start_sec: 1.2, end_sec: 2.8, frames: 9, whole_clip: false },
        phases_visible: { address: true, top: false, impact: false, finish: true },
        confidence: 'low',
      },
    });
    const line = body().swing_read as string;
    expect(typeof line).toBe('string');
    expect(line).toContain('9 frames from 1.2-2.8 s, where the swing was found');
    expect(line).toContain('phases seen: address, finish; NOT seen: top, impact');
    expect(line).toContain('confidence LOW because neither the top nor impact was in the frames');
    expect(line).toContain('captured at 60 fps');
  });

  it('a whole-clip spread says the swing was not pinned; an unknown rate says so', () => {
    useCaptureEngineStore.getState().setReviewingClip({
      fps: null,
      read: {
        coverage: { start_sec: 0.3, end_sec: 5.2, frames: 9, whole_clip: true },
        phases_visible: { address: true, top: true, impact: true, finish: true },
        confidence: 'high',
      },
    });
    const line = body().swing_read as string;
    expect(line).toContain('the swing was NOT pinned');
    expect(line).toContain('all four phases seen');
    expect(line).toContain('confidence high');
    expect(line).toContain('capture frame rate unknown');
  });

  it('nothing under review sends nothing', () => {
    expect(body().swing_read).toBeNull();
    expect(CADDIE_REQUEST_KEYS).toContain('swing_read');
  });
});

describe('both ends are wired', () => {
  const root = path.join(__dirname, '../..');
  it('SmartMotion publishes the analysis it is showing with the clip', () => {
    const sm = strip(fs.readFileSync(path.join(root, 'app/swinglab/smartmotion.tsx'), 'utf8'));
    expect(sm).toMatch(/coverage: analysis\.sample_coverage \?\? null, phases_visible: analysis\.phases_visible \?\? null, confidence: analysis\.confidence \?\? null/);
    expect(sm).toMatch(/setReviewingClip\(reviewing \? \{ fps: clipFps, read \} : null\)/);
    expect(sm).toMatch(/\}, \[clipUri, phase, clipFps, analysis\]\);/);
  });

  it('the brain renders it in the message-side live facts block, and NOT in the cached system block', () => {
    const k = strip(fs.readFileSync(path.join(root, 'api/kevin.ts'), 'utf8'));
    expect(k).toMatch(/swing_read = null,/);
    const push = /if \(typeof swing_read === 'string' && swing_read\.trim\(\)\) \{\s*lines\.push\(`- The swing read on their screen was built from: \$\{swing_read\.trim\(\)/;
    expect(liveFactsBlockSource(k)).toMatch(push);
    const cached = cachedSystemPromptSource(k);
    expect(cached.length).toBeGreaterThan(1000);           // the parse found the real prompt
    expect(cached).not.toMatch(/swing_read/);
    expect(cached).not.toMatch(/The swing read on their screen was built from/);
    expect(cached).not.toMatch(/\$\{\s*liveFactsBlock/);  // the block itself stays out of the cache
  });

  it('through the real handler: the line reaches the model in the MESSAGE and never the system prompt', async () => {
    const marker = '9 frames from 1.2-2.8 s, where the swing was found; phases seen: address, finish; NOT seen: top, impact';
    const status = await callKevin({ message: 'did it see my whole swing?', swing_read: marker });
    expect(status).toBe(200);
    expect(seen.user).toContain(`The swing read on their screen was built from: ${marker}`);
    expect(seen.system).not.toContain(marker);
    expect(seen.system).not.toContain('The swing read on their screen was built from');
  });
});
