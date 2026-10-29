/**
 * 2026-10-28 (Brain recheck) — ANOTHER COURSE'S HOLE IS NOT THE HOME CARD'S HOLE.
 *
 * lookup_hole short-circuited to the request's courseHoles — the active round's card, trimmed to the
 * current hole ±1 — matching on hole number alone. On hole 7 at home, "what's hole 7 like at Torrey
 * South?" got the HOME card's par and yardage tagged source:'round_context', and the caddie spoke them
 * as Torrey's. The prompt only sends lookup_hole to courses that are not loaded, so a foreign
 * course_id is the normal case for this tool, not the edge.
 *
 * BEHAVIOURAL: a real round in the real round store → the real payload builder → the real api/kevin
 * handler, whose tool executor the stubbed model loop calls exactly as the provider would.
 */
import handler from '../../api/kevin';
import { useRoundStore } from '../../store/roundStore';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';

const toolResults: Record<string, string> = {};
jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (
      _p: string, _t: string, _s: string, _u: string, _i: unknown, _tools: unknown,
      onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>,
    ) => {
      toolResults.foreign = await onToolCall('lookup_hole', { course_id: '4242', hole_number: 7 });
      toolResults.home = await onToolCall('lookup_hole', { course_id: '1001', hole_number: 7 });
      return { text: 'Hole 7 there is a long par 3.', provider: 'anthropic', rounds: 2, usage: null };
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

// Home: hole 7 is a 410-yard par 4. Torrey South (id 4242): hole 7 is a 195-yard par 3.
const HOME = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 350 + i * 10 }));
const TORREY = {
  course: {
    id: 4242,
    tees: {
      male: [{
        tee_name: 'Blue',
        holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: i === 6 ? 3 : 4, yardage: i === 6 ? 195 : 400 })),
      }],
    },
  },
};

describe('lookup_hole answers for the course it was asked about', () => {
  const realFetch = global.fetch;
  const courseFetches: string[] = [];

  // beforeEach, not beforeAll: __tests__/setupNoNetwork re-installs its blocking fetch before every test.
  beforeEach(() => {
    process.env.GOLFCOURSE_API_KEY = 'test';
    global.fetch = jest.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('golfcourseapi.com')) {
        courseFetches.push(u);
        return { ok: true, status: 200, json: async () => TORREY } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });
  afterEach(() => { global.fetch = realFetch; });

  it('mid-round on hole 7 at home, hole 7 at another course is that course’s hole', async () => {
    useRoundStore.setState({
      isRoundActive: true,
      activeCourse: 'Home Links',
      activeCourseId: '1001',
      currentHole: 7,
      courseHoles: HOME,
      scores: {},
      nineHoleMode: false,
      roundStartHole: 1,
    } as never);
    const body = buildCaddieRequestBody({ message: "what's hole 7 like at Torrey Pines South?", language: 'en' });
    // The trap: the trimmed card carries a hole 7 — the home one.
    expect((body.courseHoles as Array<{ hole: number }>).map((h) => h.hole)).toEqual([6, 7, 8]);
    expect(body.activeCourseId).toBe('1001');

    await callKevin({ ...body, skip_tts: true });

    const foreign = JSON.parse(toolResults.foreign);
    expect(foreign.source).not.toBe('round_context');
    expect(foreign.par).toBe(3);
    expect(foreign.yardage).toBe(195);
    expect(courseFetches.some((u) => u.includes('/v1/courses/4242'))).toBe(true);

    // The short-circuit still serves the round's own course, without a network call.
    const home = JSON.parse(toolResults.home);
    expect(home).toEqual({ hole_number: 7, par: 4, yardage: 410, source: 'round_context' });
    expect(courseFetches.some((u) => u.includes('/v1/courses/1001'))).toBe(false);
  });
});
