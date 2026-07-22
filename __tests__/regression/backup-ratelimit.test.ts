/**
 * REGRESSION — QA audit, finding H6 (backup passphrase brute-force).
 *
 * The backup read path's only throttle was a DB-backed per-IP counter that fails OPEN when
 * migration 0005 is absent and is keyed on the spoofable X-Forwarded-For. hitInMemory() adds a
 * migration-independent, per-email (spoof-proof) layer. These verify it throttles a flood but
 * never blocks the handful of requests a legitimate restore makes, and that the window resets.
 */
import { hitInMemory, __resetInMemory } from '../../api/_rateLimit';

beforeEach(() => __resetInMemory());

describe('hitInMemory — brute-force throttle (H6)', () => {
  it('allows normal use up to the limit, blocks beyond it', () => {
    const limit = 12;
    const t0 = 1_000_000;
    let blocked = false;
    for (let i = 1; i <= limit; i++) {
      blocked = hitInMemory('email:victim:1', limit, 60_000, t0);
      expect(blocked).toBe(false); // the first `limit` attempts pass
    }
    // The next attempt in the same window is throttled.
    expect(hitInMemory('email:victim:1', limit, 60_000, t0)).toBe(true);
  });

  it('does NOT block a legitimate restore (a few reads well under the limit)', () => {
    const limit = 12;
    for (let i = 0; i < 4; i++) {
      expect(hitInMemory('email:realuser:1', limit, 60_000, 5_000)).toBe(false);
    }
  });

  it('resets after the window elapses', () => {
    const limit = 3;
    const w = 60_000;
    for (let i = 0; i < limit; i++) hitInMemory('k', limit, w, 0);
    expect(hitInMemory('k', limit, w, 0)).toBe(true);          // over limit within window
    expect(hitInMemory('k', limit, w, w + 1)).toBe(false);      // new window → allowed again
  });

  it('tracks distinct keys independently (per-email isolation)', () => {
    const limit = 2;
    hitInMemory('email:a', limit, 60_000, 0);
    hitInMemory('email:a', limit, 60_000, 0);
    expect(hitInMemory('email:a', limit, 60_000, 0)).toBe(true);  // a is throttled
    expect(hitInMemory('email:b', limit, 60_000, 0)).toBe(false); // b is unaffected
  });
});
