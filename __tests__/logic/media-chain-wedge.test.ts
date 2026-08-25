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

  it('a healthy read is never abandoned and never counted as wedged', async () => {
    const before = wedgedDecodeCount();
    const p = serializeMediaRead(async () => 'fast');
    await jest.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toBe('fast');
    expect(wedgedDecodeCount()).toBe(before);
  });
});
