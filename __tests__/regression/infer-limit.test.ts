/**
 * Per-IP inference throttle. allowInference() is the zero-client-change cost guard on paid-inference
 * routes: legitimate users stay far under the limit, but a hammering loop trips a 429. This test locks
 * that contract — under-limit passes without writing a response, over-limit writes a 429, and buckets
 * are namespaced per route AND per client so one abuser / one route can't throttle another.
 */
import { allowInference } from '../../api/_inferLimit';
import { __resetInMemory } from '../../api/_rateLimit';

const reqFrom = (ip: string) => ({ headers: { 'x-forwarded-for': ip }, socket: {} }) as never;

function fakeRes() {
  const state: { code: number | null; body: unknown } = { code: null, body: null };
  const res = {
    status(c: number) { state.code = c; return res; },
    json(b: unknown) { state.body = b; return res; },
  };
  return { res: res as never, state };
}

beforeEach(() => __resetInMemory());

describe('allowInference — per-IP inference throttle', () => {
  it('lets requests through up to the limit, then 429s', () => {
    const ip = '1.2.3.4';
    // limit 3 → first three pass, fourth throttles
    for (let i = 0; i < 3; i++) {
      const { res, state } = fakeRes();
      expect(allowInference(reqFrom(ip), res, 'bag-scan', 3)).toBe(true);
      expect(state.code).toBeNull(); // nothing written on the happy path
    }
    const { res, state } = fakeRes();
    expect(allowInference(reqFrom(ip), res, 'bag-scan', 3)).toBe(false);
    expect(state.code).toBe(429);
    expect(state.body).toMatchObject({ error: 'rate_limited' });
  });

  it('namespaces buckets per client IP (one abuser does not throttle another user)', () => {
    const { res: r1 } = fakeRes();
    const { res: r2 } = fakeRes();
    expect(allowInference(reqFrom('9.9.9.9'), r1, 'hole-scan', 1)).toBe(true);
    // second hit from the SAME ip trips
    const { res: r1b, state: s1b } = fakeRes();
    expect(allowInference(reqFrom('9.9.9.9'), r1b, 'hole-scan', 1)).toBe(false);
    expect(s1b.code).toBe(429);
    // a DIFFERENT ip is unaffected
    expect(allowInference(reqFrom('8.8.8.8'), r2, 'hole-scan', 1)).toBe(true);
  });

  it('namespaces buckets per route (throttling one endpoint frees another)', () => {
    const ip = '5.5.5.5';
    const a = fakeRes();
    expect(allowInference(reqFrom(ip), a.res, 'swing-analysis', 1)).toBe(true);
    const aOver = fakeRes();
    expect(allowInference(reqFrom(ip), aOver.res, 'swing-analysis', 1)).toBe(false);
    // same IP, different route → its own fresh bucket
    const b = fakeRes();
    expect(allowInference(reqFrom(ip), b.res, 'putting-analysis', 1)).toBe(true);
  });

  it('reads x-real-ip when x-forwarded-for is absent', () => {
    const req = { headers: { 'x-real-ip': '7.7.7.7' }, socket: {} } as never;
    const { res } = fakeRes();
    expect(allowInference(req, res, 'lie-analysis', 1)).toBe(true);
  });
});
