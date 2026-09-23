/**
 * 2026-09-23 — THE DELIBERATE RETRIES NEVER RAN.
 *
 * A timed-out geometry build armed the 90s empty-build cooldown. The 30s re-ask scheduled for exactly
 * that case landed inside the cooldown, returned the (empty) cache without building, and — because
 * only a real build schedules the next re-ask — the 90s one was never scheduled at all. roundPrefetch's
 * "retry once on zero greens" hit the same wall and reached the network once, not twice. A slow course
 * (Pinehurst No. 2 measured >100s live) stayed unloaded until the player reselected it.
 *
 * Behavioural, through the real service with only fetch stubbed — the source-text checks that stood
 * beside this asserted both constants and so certified the conflict instead of catching it.
 *
 * The other direction is asserted too: the tick-driven caller (no bypass) is STILL held back, which is
 * what the cooldown exists for (the MAPPING…/STATIC flicker, 09-10).
 */
import * as geo from '../../services/courseGeometryService';

const GOOD = {
  course_id: 'X',
  course_name: 'x',
  holes: Array.from({ length: 18 }, (_, i) => ({
    hole_number: i + 1, par: 4, yardage: 380,
    tee: { lat: 42 + i * 1e-3, lng: -71 }, green: { lat: 42.003 + i * 1e-3, lng: -71 },
  })),
};
const EMPTY = {
  course_id: 'X',
  course_name: 'x',
  holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 380, tee: null, green: null })),
};
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) });

describe('course geometry: deliberate retries reach the network; the tick does not', () => {
  let calls = 0;
  beforeEach(() => { calls = 0; geo._clearGeometryCache(); });
  afterEach(() => { jest.useRealTimers(); });

  it('a TIMED-OUT build is re-asked by the scheduled recheck', async () => {
    jest.useFakeTimers();
    (global as { fetch: unknown }).fetch = jest.fn(async () => {
      calls++;
      if (calls === 1) { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; }
      return ok(GOOD);
    });
    const first = await geo.fetchCourseGeometry('apiTimeout', { courseLocation: { lat: 42, lng: -71 } });
    expect(first).toBeNull();
    for (let i = 0; i < 130; i++) await jest.advanceTimersByTimeAsync(1000);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(geo.mappedHoleCount(geo.getCachedGeometry('apiTimeout'))).toBe(18);
  });

  it('a retry that asks to bypass the cooldown (roundPrefetch after zero greens) reaches the network', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async () => { calls++; return ok(calls === 1 ? EMPTY : GOOD); });
    const g1 = await geo.fetchCourseGeometry('apiZero', { courseLocation: { lat: 42, lng: -71 } });
    const g2 = await geo.fetchCourseGeometry('apiZero', { courseLocation: { lat: 42, lng: -71 }, bypassCooldown: true });
    expect(geo.mappedHoleCount(g1)).toBe(0);
    expect(calls).toBe(2);
    expect(geo.mappedHoleCount(g2)).toBe(18);
  });

  it('the tick-driven caller (no bypass) is still held back right after an empty build', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async () => { calls++; return ok(EMPTY); });
    await geo.fetchCourseGeometry('apiTick', { courseLocation: { lat: 42, lng: -71 } });
    await geo.fetchCourseGeometry('apiTick', { courseLocation: { lat: 42, lng: -71 } });
    await geo.fetchCourseGeometry('apiTick', { courseLocation: { lat: 42, lng: -71 } });
    expect(calls).toBe(1);
  });

  /**
   * 2026-09-23 (triple-check) — a FALLBACK is not a build that worked. Echo Hills' bundled coords fail
   * their own scorecard, so the app asks the engine; when the engine answers with nothing (a zero-green
   * 200, or a 503) the bundled copy is served — and that copy, having greens, used to clear the
   * cooldown, so every GPS tick started another full build. Both answers must hold the next ask off.
   */
  it.each([
    ['a zero-green 200', () => ok({ course_id: 'x', course_name: 'x', holes: [] })],
    ['a 503', () => ({ ok: false, status: 503, json: async () => ({}) })],
  ])('after %s on a bundled course, the next tick does not rebuild', async (_label, answer) => {
    (global as { fetch: unknown }).fetch = jest.fn(async () => { calls++; return answer(); });
    const first = await geo.fetchCourseGeometry('local:echo-hills');
    await geo.fetchCourseGeometry('local:echo-hills');
    await geo.fetchCourseGeometry('local:echo-hills');
    expect(calls).toBe(1);
    expect(geo.mappedHoleCount(first)).toBeGreaterThan(0);
  });
});
