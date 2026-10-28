/**
 * 2026-10-28 (Brain review r2) — A COURSE HE BUILT HAS ITS CARD ON THE PHONE; A FAILED FETCH IS
 * NOT RETRIED ON EVERY TURN.
 *
 * courseContextCache short-circuited only 'local:' ids. A 'custom:' round missed the card on every
 * payload build, and every miss started a warm: golfCourseApi.getCourse → /api/course-proxy detail
 * (a billed invocation and a paid upstream call) for an id golfcourseapi cannot know. The failure was
 * not remembered, so it repeated every turn, and the caddie never got the card the round store held.
 * The same every-turn refetch hit a real course whose detail fetch failed (offline, say).
 */
const mockRound = {
  roundStartTime: 1 as number | null,
  courseHoles: [] as { hole: number; par: number; distance: number }[],
};
jest.mock('../../store/roundStore', () => ({ useRoundStore: { getState: () => mockRound } }));

describe('the course card the caddie reads', () => {
  const realFetch = global.fetch;
  let calls: string[];

  beforeEach(() => {
    jest.resetModules();
    calls = [];
    mockRound.roundStartTime = 1;
    mockRound.courseHoles = [{ hole: 2, par: 3, distance: 160 }, { hole: 1, par: 4, distance: 380 }];
    global.fetch = jest.fn(async (u: unknown) => {
      calls.push(String(u));
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    }) as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = realFetch; });

  const cache = () => require('../../services/courseContextCache') as typeof import('../../services/courseContextCache');

  it('THE BUG: a custom course gets its card from the round, on the spot', () => {
    expect(cache().getCourseContextSync('custom:home-abc123')).toBe('Hole 1: Par 4, 380 yds. Hole 2: Par 3, 160 yds.');
  });

  it('THE BUG: a custom course never asks golfcourseapi, however many turns', async () => {
    const c = cache();
    for (let i = 0; i < 5; i++) await c.warmCourseContext('custom:home-abc123');
    expect(calls).toEqual([]);
  });

  it('nor does golfCourseApi.getCourse itself, for a bundled or custom id', async () => {
    const api = require('../../services/golfCourseApi') as typeof import('../../services/golfCourseApi');
    expect(await api.getCourse('custom:home-abc123')).toBeNull();
    expect(await api.getCourse('local:some-course')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('THE BUG: a failed warm for a real course is not repeated on every turn of the round', async () => {
    const c = cache();
    const t0 = 10_000_000;
    for (let i = 0; i < 5; i++) await c.warmCourseContext('12345', t0 + i * 20_000);
    expect(calls.filter((u) => /course-proxy/.test(u))).toHaveLength(1);
  });

  it('a real course whose fetch failed still has the round\'s card', async () => {
    const c = cache();
    await c.warmCourseContext('12345', 10_000_000);               // offline / quota spent
    expect(c.getCourseContextSync('12345')).toBe('Hole 1: Par 4, 380 yds. Hole 2: Par 3, 160 yds.');
  });

  it('it tries again after the retry window, and on a new round', async () => {
    const c = cache();
    const t0 = 10_000_000;
    await c.warmCourseContext('12345', t0);
    await c.warmCourseContext('12345', t0 + 6 * 60_000);       // window passed
    expect(calls.filter((u) => /course-proxy/.test(u))).toHaveLength(2);
    mockRound.roundStartTime = 2;                                // a new round
    await c.warmCourseContext('12345', t0 + 6 * 60_000 + 1_000);
    expect(calls.filter((u) => /course-proxy/.test(u))).toHaveLength(3);
  });
});
