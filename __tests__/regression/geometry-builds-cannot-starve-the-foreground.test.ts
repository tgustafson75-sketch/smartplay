/**
 * 2026-09-02 — BACKGROUND MAP-BUILDING MUST NOT STARVE THE PLAYER'S PATH.
 *
 * From Tim's harness run (C22). `inflight` dedupes per courseId, which stops several surfaces racing
 * on the SAME course but does nothing about several DIFFERENT courses at once — and that is the
 * normal case, since the release model pulls 3-5 nearby courses on demand. Each build holds a
 * request against OUR OWN origin for up to 85s, and Android keeps only a handful of connections per
 * host, so a bare GET of /api/health?lite=1 (a static return, ~0.2s off-device) took 71 SECONDS on
 * his phone and 301ms once things drained.
 *
 * That is not cosmetic: armDeadHostGuard probes that exact URL to decide whether to abort a swing
 * analysis, so background map-building could kill the swing the player just recorded.
 *
 * These lock the cap and the two ways a hand-off semaphore usually breaks: a slot leaked on the
 * error path (the cap silently ratchets to zero and NOTHING ever builds again), and waiters
 * stranded by a purge.
 */
import { fetchCourseGeometry, geometryBuildLoad, purgeCourseGeometry, _seedGeometry } from '../../services/courseGeometryService';
import { useRoundStore } from '../../store/roundStore';

/**
 * Hold every network call open until the test lets it go, so concurrency is observable. Once opened
 * it STAYS open — builds released from the queue fetch again, and a one-shot gate would deadlock
 * them (which is exactly what the first draft of this test did).
 */
function gate() {
  const pending: (() => void)[] = [];
  let open = false;
  let calls = 0;
  const respond = () => ({ ok: true, status: 200, json: async () => ({ holes: [] }) } as unknown as Response);
  const fn = jest.fn(() => {
    calls++;
    if (open) return Promise.resolve(respond());
    return new Promise<Response>((resolve) => { pending.push(() => resolve(respond())); });
  });
  return {
    fn,
    openAll() { open = true; pending.splice(0).forEach((r) => r()); },
    get calls() { return calls; },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('at most two course-geometry builds hold the origin at once', () => {
  const realFetch = global.fetch;
  afterEach(async () => { global.fetch = realFetch; await purgeCourseGeometry(); });

  it('caps concurrent builds and queues the rest', async () => {
    const g = gate();
    global.fetch = g.fn as unknown as typeof fetch;

    // Five nearby courses, exactly what opening the app can trigger.
    const runs = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => fetchCourseGeometry(id));
    await settle();

    const load = geometryBuildLoad();
    expect(load.max).toBe(2);
    expect(load.active).toBeLessThanOrEqual(2);
    // The rest must be WAITING, not in flight — that is the whole point.
    expect(g.calls).toBeLessThanOrEqual(2);

    g.openAll();
    await Promise.all(runs).catch(() => undefined);
  }, 15_000);

  it('a build that THROWS still gives its slot back', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
    await Promise.all(['e1', 'e2', 'e3'].map((id) => fetchCourseGeometry(id).catch(() => null)));
    // The failure mode this guards: a leaked slot ratchets the cap down until nothing builds, ever.
    const load = geometryBuildLoad();
    expect(load.active).toBe(0);
    expect(load.queued).toBe(0);
  }, 15_000);

  it('a purge does not strand builds waiting for a slot', async () => {
    const g = gate();
    global.fetch = g.fn as unknown as typeof fetch;
    const runs = ['p1', 'p2', 'p3', 'p4'].map((id) => fetchCourseGeometry(id));
    await settle();
    expect(geometryBuildLoad().queued).toBeGreaterThan(0);

    await purgeCourseGeometry();          // clears inflight — the waiters must not be orphaned
    expect(geometryBuildLoad().queued).toBe(0);
    expect(geometryBuildLoad().active).toBe(0);

    g.openAll();
    await Promise.all(runs).catch(() => undefined);
  }, 15_000);
});


/**
 * 2026-09-03 — THE CAP MUST NOT BECOME THE STARVATION.
 *
 * The first version of this cap acquired the slot in the wrapper, so the WHOLE of
 * fetchCourseGeometryInner ran inside it — including the memCache hit. `holeDetection` calls
 * fetchCourseGeometry for the active course on every GPS fix, so during a round a CACHED read could
 * sit behind two 85-second network builds of courses nobody is playing. A cap written to stop
 * background work starving the foreground was doing precisely that, and its three original tests all
 * passed because they measured concurrency, not cache-hit latency.
 *
 * The slot now scopes to the network call only, and the active round's course skips the queue
 * outright — it IS the foreground.
 */
describe('the cap protects the foreground instead of becoming it', () => {
  const realFetch = global.fetch;
  afterEach(async () => {
    global.fetch = realFetch;
    try { useRoundStore.setState({ isRoundActive: false, activeCourseId: null }); } catch { /* noop */ }
    await purgeCourseGeometry();
  });

  /** Hold every network call open forever, so both slots stay occupied for the whole test. */
  function blockedFetch() {
    return jest.fn(() => new Promise<Response>(() => { /* never settles */ }));
  }

  it('a CACHED read returns instantly while both slots are held by other courses', async () => {
    global.fetch = blockedFetch() as unknown as typeof fetch;
    // Occupy both slots with builds that will never finish.
    void fetchCourseGeometry('busy-1');
    void fetchCourseGeometry('busy-2');
    void fetchCourseGeometry('busy-3'); // and one queued behind them
    await new Promise((r) => setTimeout(r, 0));
    expect(geometryBuildLoad().active).toBe(2);

    // A course whose geometry is already in the cache must not touch the queue at all.
    // Servable means: current pipeline_version, at least one hole with a green, and fresh.
    _seedGeometry({
      course_id: 'cached-course',
      fetched_at: Date.now(),
      pipeline_version: 3,
      holes: [{ hole: 1, green: { lat: 33.6, lng: -117.1 } }],
    } as never);
    const t0 = Date.now();
    const got = await Promise.race([
      fetchCourseGeometry('cached-course'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CACHED READ QUEUED BEHIND A BUILD')), 1500)),
    ]);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(got).not.toBeUndefined();
  }, 15_000);

  it("the ACTIVE round's course never queues behind background builds", async () => {
    const f = blockedFetch();
    global.fetch = f as unknown as typeof fetch;
    void fetchCourseGeometry('bg-1');
    void fetchCourseGeometry('bg-2');
    await new Promise((r) => setTimeout(r, 0));
    expect(geometryBuildLoad().active).toBe(2);
    const callsBefore = f.mock.calls.length;

    // The player is ON this course. Its build must reach the network immediately.
    useRoundStore.setState({ isRoundActive: true, activeCourseId: 'the-round' });
    void fetchCourseGeometry('the-round');
    await new Promise((r) => setTimeout(r, 20));

    expect(f.mock.calls.length).toBeGreaterThan(callsBefore); // it fetched; it did not wait
    // And it did so WITHOUT consuming a slot — the cap is still exactly 2 for background work.
    expect(geometryBuildLoad().active).toBe(2);
  }, 15_000);
});
