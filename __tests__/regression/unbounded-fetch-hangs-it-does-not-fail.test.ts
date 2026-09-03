/**
 * 2026-09-03 — AN UNBOUNDED fetch DOES NOT FAIL, IT HANGS.
 *
 * React Native's fetch has no default timeout. Both fetches in swingReviewEndpoint were unbounded AND
 * had no try around them, and the locate call in ballDeparture was unbounded behind a try — which is
 * the more deceptive shape, because it cannot crash, so instead the promise simply never settles.
 *
 * The reason this is not merely "a feature didn't load": a held connection to our own origin is what
 * starves armDeadHostGuard's probe, and the guard then reads a starved origin as a dead one and
 * aborts a real swing analysis. An optional upgrade must never be able to cost the player a swing.
 * [[our-own-traffic-starves-the-foreground]]
 *
 * Retry policy is Tim's: "don't build error states. Make it work." — so the connection is retried and
 * a REAL ANSWER is returned immediately rather than hammered.
 */
import { isTransientFailure, isTransientStatus, isInfraStatus } from '../../utils/transientRetry';
import { fetchSwingReview, _resetResolvedPath } from '../../services/swingReviewEndpoint';

const okRes = (status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({}) } as Response);

describe('the transient policy separates the wire from the answer', () => {
  it('treats connection shapes as transient', () => {
    for (const r of ['timed_out', 'Network request failed', 'ECONNRESET', 'socket hang up', 'http_503', 'http_429']) {
      expect(isTransientFailure(r)).toBe(true);
    }
  });

  it('treats a real answer as final — never hammered', () => {
    // A wrong passphrase, a 400, a payload over the cap: the server MEANT these.
    for (const r of ['bad_passphrase', 'payload_too_large', 'http_400', 'http_404', '']) {
      expect(isTransientFailure(r)).toBe(false);
    }
    expect(isTransientStatus(404)).toBe(false);
    expect(isTransientStatus(400)).toBe(false);
    expect(isTransientStatus(503)).toBe(true);
    // The narrower form used by the 45s review route: infra says retry, a handler 500 does not.
    expect(isInfraStatus(503)).toBe(true);
    expect(isInfraStatus(429)).toBe(true);
    expect(isInfraStatus(500)).toBe(false);
    expect(isTransientStatus(429)).toBe(true);
  });
});

describe('fetchSwingReview is bounded and retries only the connection', () => {
  const realFetch = global.fetch;
  beforeEach(() => { _resetResolvedPath(); });
  afterEach(() => { global.fetch = realFetch; });

  it('every request carries an abort signal — the hang is impossible now', async () => {
    const seen: (AbortSignal | undefined)[] = [];
    global.fetch = jest.fn(async (_u, init?: RequestInit) => {
      seen.push(init?.signal as AbortSignal | undefined);
      return okRes(200);
    }) as unknown as typeof fetch;
    await fetchSwingReview('https://x', { method: 'POST' });
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeDefined();
    expect(typeof seen[0]!.aborted).toBe('boolean');
  });

  it('retries a 503 and returns the answer when it arrives', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => { n++; return n < 3 ? okRes(503) : okRes(200); }) as unknown as typeof fetch;
    const res = await fetchSwingReview('https://x', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(n).toBe(3);
  }, 15_000);

  it('does NOT retry a 400 — the server meant it', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => { n++; return okRes(400); }) as unknown as typeof fetch;
    const res = await fetchSwingReview('https://x', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(n).toBe(1);
  });

  it('still falls back to the legacy path on 404 — the reason this module exists', async () => {
    const urls: string[] = [];
    global.fetch = jest.fn(async (u: string) => {
      urls.push(String(u));
      return String(u).includes('/api/swing-review') ? okRes(404) : okRes(200);
    }) as unknown as typeof fetch;
    const res = await fetchSwingReview('https://x', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(urls[0]).toContain('/api/swing-review');   // 404 is an ANSWER, not retried 3x
    expect(urls[1]).toContain('/api/cage-review');
    expect(urls.length).toBe(2);
  });

  it('surfaces a dead connection as a rejection instead of hanging forever', async () => {
    global.fetch = jest.fn(async () => { throw new Error('Network request failed'); }) as unknown as typeof fetch;
    await expect(fetchSwingReview('https://x', { method: 'POST' })).rejects.toThrow(/swing review request failed/);
  }, 15_000);
});
