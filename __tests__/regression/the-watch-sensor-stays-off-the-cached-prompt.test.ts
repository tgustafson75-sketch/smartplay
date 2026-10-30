/**
 * 2026-10-29 (Brain recheck r16) — THE WATCH SESSION SUMMARY RIDES THE MESSAGE, NOT THE CACHED PROMPT.
 *
 * watchStore.recordSwing appends on every watch swing, so the WATCH SENSOR DATA line changes shot to
 * shot. It was interpolated into the systemPrompt template, the single 1h cache breakpoint, so every
 * in-round turn after a swing rewrote the whole prefix at the 2x write price. The RATCHET passed only
 * because 'wd' was on its ALLOWED list. It now sits in turnContextBlock beside PLAYER PATTERNS.
 *
 * BEHAVIOURAL: the real round store → the real payload builder → the real api/kevin handler with a
 * watch summary in the body → the cached system prompt and the per-turn message, captured at the
 * provider boundary.
 */
import handler from '../../api/kevin';
import { useRoundStore } from '../../store/roundStore';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';

const seen: { system: string; user: string } = { system: '', user: '' };
jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (_provider: string, _tier: string, system: string, user: string) => {
      seen.system = system;
      seen.user = user;
      return { text: 'ok', provider: 'anthropic', rounds: 1, usage: null };
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

const WATCH = { swingCount: 7, averageTempo: '3.1', dominantFault: 'early transition', earlyTransitionRate: 40, averageClubSpeed: 92 };

async function inRoundPrompt(): Promise<void> {
  seen.system = ''; seen.user = '';
  useRoundStore.setState({
    isRoundActive: true,
    activeCourseId: 'local:crane-creek',
    currentHole: 4,
    courseHoles: [{ hole: 4, par: 4, distance: 370 }],
    scores: {},
    shots: [],
  } as never);
  const body = { ...buildCaddieRequestBody({ message: 'what did my swing do', language: 'en' }), watchData: WATCH, skip_tts: true };
  await callKevin(body);
}

describe('the watch summary is per-turn context, not the cached system prompt', () => {
  it('the watch line is absent from the cached system prompt', async () => {
    await inRoundPrompt();
    expect(seen.system).not.toContain('WATCH SENSOR DATA');
    expect(seen.system).not.toContain('Early transition: 40%');
  });

  it('the watch line still reaches the brain, in the per-turn message', async () => {
    await inRoundPrompt();
    expect(seen.user).toContain('WATCH SENSOR DATA');
    expect(seen.user).toContain('Early transition: 40%');
    expect(seen.user).toContain('Swings: 7');
  });
});
