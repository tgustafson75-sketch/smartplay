/**
 * 2026-08-25 (release hardening) — A WEDGED DECODE MUST NOT TAKE THE APP WITH IT.
 *
 * Every native media read is serialized app-wide through one promise chain, because concurrent
 * MediaMetadataRetriever instances crash the process. The cost of that design was an unbounded
 * shared resource: `chain.then(fn)` never settles if `fn` never settles, so a single wedged decode
 * on one bad clip stopped frame extraction for the ENTIRE session — this analysis and every one
 * after it — with no recovery short of killing the app.
 *
 * This is the test with teeth: the wedge must be abandoned, and the NEXT caller must still get its
 * frame. If the chain is ever made unbounded again, the second expectation below hangs.
 */
import { serializeMediaRead, wedgedDecodeCount } from '../../utils/videoThumbnail';

describe('the media chain survives a wedged native read', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('abandons a read that never answers, and the next read still completes', async () => {
    const before = wedgedDecodeCount();

    // A native call that never comes back — the real-world case is a corrupt clip.
    const wedgedCaller = serializeMediaRead(() => new Promise<string>(() => {}));
    const wedgedOutcome = wedgedCaller.then(() => 'resolved', () => 'rejected');

    // Queued BEHIND the wedge. Under the old unbounded chain this could never run.
    const nextCaller = serializeMediaRead(async () => 'frame-2');

    await jest.advanceTimersByTimeAsync(25_000);

    expect(await wedgedOutcome).toBe('rejected');
    await expect(nextCaller).resolves.toBe('frame-2');
    expect(wedgedDecodeCount()).toBe(before + 1);
  });

  it('the clock starts when a link RUNS, not when it is queued', async () => {
    /**
     * The load-bearing subtlety of the whole design. Frame extraction enqueues many decodes at once
     * and they run one at a time, so a later link can sit in the queue far longer than the timeout
     * before its turn arrives. The bound must apply to a link's own EXECUTION.
     *
     * Written as `bounded(chain.then(fn))` instead of `chain.then(() => bounded(fn))`, this test
     * fails: every queued decode past the first would be abandoned as "wedged" while perfectly
     * healthy, and long extractions would break on exactly the devices that need them most.
     */
    const before = wedgedDecodeCount();
    const slowButHealthy = () => new Promise<string>((r) => setTimeout(() => r('slow'), 15_000));

    const first = serializeMediaRead(slowButHealthy);
    const second = serializeMediaRead(slowButHealthy);   // waits 15s in the queue, then runs 15s

    await jest.advanceTimersByTimeAsync(40_000);

    await expect(first).resolves.toBe('slow');
    await expect(second).resolves.toBe('slow');          // total age 30s > the 20s per-link bound
    expect(wedgedDecodeCount()).toBe(before);
  });

  it('a healthy read is never abandoned and never counted as wedged', async () => {
    const before = wedgedDecodeCount();
    const p = serializeMediaRead(async () => 'fast');
    await jest.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toBe('fast');
    expect(wedgedDecodeCount()).toBe(before);
  });
});
