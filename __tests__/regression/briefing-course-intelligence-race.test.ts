/**
 * 2026-08-13 — the pre-round briefing was generated WITHOUT course grounding, silently.
 *
 * roundPrefetch fires fetchCourseIntelligence fire-and-forget at round start. It is a web search
 * plus an LLM pass — the slowest call on that path. app/round/briefing.tsx then mounted and read the
 * result SYNCHRONOUSLY out of the service's in-memory mirror, so it almost always arrived first, got
 * null, and generated the briefing with no course intelligence at all. Once, with no retry. Nothing
 * looked broken: the player got a normal-reading briefing that simply didn't know the course, on the
 * one surface whose entire job is knowing the course.
 *
 * The briefing couldn't just await the fetch, either: it had no in-flight dedupe, so asking for the
 * result would have started a SECOND web search alongside the prefetch's. Both halves are the fix,
 * and these are behavioural tests rather than lexical ones — the dedupe is only worth anything if it
 * actually collapses concurrent callers into one network call.
 */
import {
  fetchCourseIntelligence,
  awaitCourseIntelligence,
} from '../../services/courseIntelligenceService';

const API = 'http://test.local';

/** A slow, successful intelligence response, counting how many real calls were made. */
function mockFetch(delayMs: number, body: unknown = { intelligence: 'Wachusett plays uphill.', source: 'fresh' }) {
  const state = { calls: 0 };
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => {
    state.calls += 1;
    await new Promise((r) => setTimeout(r, delayMs));
    return { ok: true, json: async () => body } as unknown as Response;
  });
  return state;
}

describe('course intelligence: one fetch per course, and the briefing waits for it', () => {
  it('concurrent callers share ONE web search rather than each starting their own', async () => {
    const state = mockFetch(25);
    const input = { courseId: 'race-1', courseName: 'Wachusett CC', location: '', apiUrl: API };

    const [a, b, c] = await Promise.all([
      fetchCourseIntelligence(input),
      fetchCourseIntelligence(input),
      fetchCourseIntelligence(input),
    ]);

    // The expensive call is the point: three callers, one web search + LLM pass.
    expect(state.calls).toBe(1);
    expect(a.intelligence).toBe('Wachusett plays uphill.');
    expect(b.intelligence).toBe(a.intelligence);
    expect(c.intelligence).toBe(a.intelligence);
  });

  it('the briefing JOINS a prefetch already in flight instead of racing it to null', async () => {
    const state = mockFetch(30);
    // roundPrefetch's fire-and-forget call at round start — deliberately not awaited, exactly as
    // services/roundPrefetch.ts issues it.
    void fetchCourseIntelligence({ courseId: 'race-2', courseName: 'Berlin CC', location: '', apiUrl: API });

    // The briefing screen mounts while that is still running. This is the read that used to be a
    // synchronous mirror lookup returning null.
    const intel = await awaitCourseIntelligence('race-2', 2_000);

    expect(intel).toBe('Wachusett plays uphill.');
    expect(state.calls).toBe(1); // joined the prefetch — did not start a second search
  });

  it('gives up at the timeout rather than holding the briefing on a slow search', async () => {
    mockFetch(400);
    const slow = fetchCourseIntelligence({ courseId: 'race-3', courseName: 'Slow GC', location: '', apiUrl: API });

    const started = Date.now();
    const intel = await awaitCourseIntelligence('race-3', 60);
    const waited = Date.now() - started;
    await slow; // let the abandoned search settle so it isn't left running past the test

    // Ungrounded-but-prompt is the old behaviour, and it stays the fallback: a spinner on the
    // pre-round briefing is worse than a briefing that doesn't know the course.
    expect(intel).toBeNull();
    expect(waited).toBeLessThan(300);
  });

  it('never STARTS a fetch — a consumer of the result is not a reason to run a web search', async () => {
    const state = mockFetch(10);

    const intel = await awaitCourseIntelligence('never-prefetched', 100);

    expect(intel).toBeNull();
    expect(state.calls).toBe(0);
  });
});
