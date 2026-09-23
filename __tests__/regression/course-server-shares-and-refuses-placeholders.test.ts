/**
 * 2026-09-23 — two server-side halves of "some courses won't load".
 *
 * 1. api/course-proxy cached nothing, so every phone paid golfcourseapi quota for the same search and
 *    the same card, and the key hit "daily usage limit exceeded". A 200 now carries a CDN cache
 *    header, and the quota answer is NAMED so the client can say what happened instead of relaying
 *    "Upstream error 429".
 * 2. Course Cloud checked coordinate RANGES, and {0,0} is inside both. Pebble Beach was served with
 *    tees at 0,0 on holes 12-18, counted as mapped. The reader now refuses the placeholder, so rows
 *    already stored are dropped too.
 */
import handler from '../../api/course-proxy';
import { readSharedGeometry } from '../../api/_courseCloud';

function fakeRes() {
  const headers: Record<string, string> = {};
  const out: { status?: number; body?: unknown; headers: Record<string, string> } = { headers };
  const res = {
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; return res; },
    status: (s: number) => { out.status = s; return res; },
    json: (b: unknown) => { out.body = b; return res; },
  };
  return { res, out };
}
const req = (query: Record<string, string>, ip: string) => ({ query, headers: { 'x-forwarded-for': ip }, socket: {} });

describe('course proxy: shared answers, named limits', () => {
  beforeAll(() => { process.env.GOLFCOURSE_API_KEY = 'test-key'; });

  it('a successful search and detail are CDN-cacheable', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ courses: [] }) }));
    const queries: Record<string, string>[] = [{ action: 'search', q: 'grassy hill' }, { action: 'detail', id: 'abc' }];
    for (const q of queries) {
      const { res, out } = fakeRes();
      await handler(req(q, '10.0.0.1') as never, res as never);
      expect(out.status).toBe(200);
      expect(out.headers['cache-control']).toMatch(/s-maxage=\d+/);
    }
  });

  it('an error is never cached, and the daily quota is named', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async () => ({
      ok: false, status: 429, text: async () => '{\n\t"error": "daily usage limit exceeded"\n}\n',
    }));
    const { res, out } = fakeRes();
    await handler(req({ action: 'search', q: 'pebble' }, '10.0.0.2') as never, res as never);
    expect(out.status).toBe(429);
    expect(out.headers['cache-control']).toBeUndefined();
    expect((out.body as { error: string }).error).toBe('course_db_daily_limit');
  });
});

describe('Course Cloud: a placeholder coordinate is not a location', () => {
  it('a stored 0,0 tee is dropped on read and the hole does not count as mapped', async () => {
    const rows = [
      { hole: 1, par: 4, yardage: 380, tee_lat: 36.568, tee_lng: -121.95, green_lat: 36.571, green_lng: -121.948, source: 'osm', confidence: 0.9 },
      { hole: 12, par: 3, yardage: 200, tee_lat: 0, tee_lng: 0, green_lat: 36.57, green_lng: -121.94, source: 'osm', confidence: 0.9 },
    ];
    const db = { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: rows, error: null }) }) }) }) };
    const out = await readSharedGeometry(db as never, 'pebble');
    const h12 = out?.find((h) => h.hole_number === 12);
    expect(h12?.tee).toBeNull();
    expect(out?.filter((h) => h.tee && h.green).length).toBe(1);
  });
});
