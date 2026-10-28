/**
 * 2026-10-27 (Brain review F1) — THE SCORE TO PAR THE CADDIE IS GIVEN COUNTS THE WHOLE CARD.
 *
 * The payload builder trims courseHoles to the current hole ±1 (the full 18 added 5-15KB per call), and
 * api/kevin worked "Vs par" out by looking each scored hole's par up in that trimmed list. On the 10th
 * tee after 47 on a par-36 front nine, only hole 9 matched, so the prompt read "Score: 47 | Vs par: +1"
 * and "how am I doing?" got "about one over" — the 08-24 "calls 47 even par" defect by another door.
 *
 * BEHAVIOURAL: a real round in the real round store → the real payload builder → the real api/kevin
 * handler (model stubbed at the provider boundary) → the prompt line the model reads.
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
      return { text: 'Eleven over through nine.', provider: 'anthropic', rounds: 1, usage: null };
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

// Par 36 front nine, par 36 back nine.
const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
const HOLES = PARS.map((par, i) => ({ hole: i + 1, par, distance: 300 + i * 10 }));
// 47 on the front: +11, with a bogey on 9 (5 on a par 4).
const FRONT_47: Record<number, number> = { 1: 5, 2: 6, 3: 4, 4: 7, 5: 5, 6: 5, 7: 4, 8: 6, 9: 5 };

function startRoundAt(currentHole: number, scores: Record<number, number>) {
  useRoundStore.setState({
    isRoundActive: true,
    activeCourse: 'Test Links',
    activeCourseId: 'local:test-links',
    currentHole,
    courseHoles: HOLES,
    scores,
    nineHoleMode: false,
    roundStartHole: 1,
  } as never);
}

const vsParLine = (s: string) => (s.match(/Score: [^\n]*\| Vs par: [^|]*\| Holes: \d+/) ?? [''])[0];

describe('the caddie is told the round to par from the whole card', () => {
  beforeEach(() => { seen.system = ''; seen.user = ''; });

  it('sanity: the scores add to 47 on a par-36 front nine', () => {
    expect(Object.values(FRONT_47).reduce((a, b) => a + b, 0)).toBe(47);
    expect(PARS.slice(0, 9).reduce((a, b) => a + b, 0)).toBe(36);
  });

  it('on the 10th tee after 47, the prompt says +11, not +1', async () => {
    startRoundAt(10, FRONT_47);
    const body = buildCaddieRequestBody({ message: 'how am I doing?', language: 'en' });
    // The geometry trim stays — only the holes around the one he is on travel.
    expect((body.courseHoles as Array<{ hole: number }>).map((h) => h.hole)).toEqual([9, 10, 11]);
    await callKevin({ ...body, skip_tts: true });
    const line = vsParLine(seen.system + '\n' + seen.user);
    expect(line).toContain('Score: 47');
    expect(line).toContain('Vs par: +11');
    expect(line).toContain('Holes: 9');
  });

  it('agrees with the round store’s own card number mid-back-nine', async () => {
    startRoundAt(15, { ...FRONT_47, 10: 4, 11: 3, 12: 3, 13: 5, 14: 6 }); // back: 21 on par 20
    expect(useRoundStore.getState().getScoreVsPar()).toBe(12);
    await callKevin({ ...buildCaddieRequestBody({ message: 'how am I doing?', language: 'en' }), skip_tts: true });
    expect(vsParLine(seen.system + '\n' + seen.user)).toContain('Vs par: +12');
  });
});
