/**
 * The Wi-Fi bridge that needs no native module.
 *
 * 2026-08-21. Tim asked for a Wi-Fi gate on course pre-download and pushed back when I said it needed
 * a native module. He was right. The LABEL needs NetInfo/expo-network (native, breaks OTA for the
 * frozen TestFlight build) — but the label is not what the app wants to know. It wants: can this
 * connection comfortably carry a full course download right now? That is throughput and latency, and
 * both are measurable in JavaScript.
 *
 * These tests pin the ASYMMETRY that shapes the thresholds: starting a multi-megabyte pull on a weak
 * link burns a tester's data and battery on a download that may not finish, while wrongly declining
 * costs one tap later. Err toward declining.
 */
import { measureConnection, mayPullCourseNow, lastConnectionReading } from '../../services/connectionClass';

const realFetch = global.fetch;
/** A body big enough to time, delivered after `ms`. */
const respondIn = (ms: number, bytes = 4096) => jest.fn(async () => {
  await new Promise(r => setTimeout(r, ms));
  return { ok: true, text: async () => 'x'.repeat(bytes) } as unknown as Response;
});

afterEach(() => { global.fetch = realFetch; jest.useRealTimers(); });

describe('a fast link is allowed to pull a course', () => {
  it('classifies a quick, fat response as fast and opens the gate', async () => {
    global.fetch = respondIn(5, 8192) as never;           // ~1.6 MB/s
    const r = await measureConnection({ force: true });
    expect(r.klass).toBe('fast');
    expect(r.goodForBulk).toBe(true);
    expect(r.kbps).toBeGreaterThan(400);
  });
});

describe('anything less does NOT get to spend the player\'s data', () => {
  it('a slow link is poor, and the gate stays shut', async () => {
    global.fetch = respondIn(1200, 4096) as never;         // ~3 KB/s
    const r = await measureConnection({ force: true });
    expect(r.klass).toBe('poor');
    expect(r.goodForBulk).toBe(false);
  });

  it('a middling link is usable but still not unattended-download material', async () => {
    global.fetch = respondIn(20, 4096) as never;           // ~200 KB/s
    const r = await measureConnection({ force: true });
    expect(r.klass).toBe('usable');
    expect(r.goodForBulk).toBe(false);
  });

  it('UNKNOWN does not pass the gate — the whole point is not to guess', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as never;
    // Force past the cache: mayPullCourseNow deliberately reuses a recent reading (measuring costs a
    // request), so without this the assertion would test the PREVIOUS test's connection, not this one.
    const measured = await measureConnection({ force: true });
    expect(measured.klass).toBe('unknown');
    expect(measured.goodForBulk).toBe(false);
    const { ok } = await mayPullCourseNow();
    expect(ok).toBe(false);
  });

  it('a response too small to time is not treated as infinitely fast', async () => {
    // Dividing a handful of bytes by a millisecond produces a huge, meaningless number. Guard it,
    // or every tiny reply looks like fibre.
    global.fetch = respondIn(1, 8) as never;
    const r = await measureConnection({ force: true });
    expect(r.kbps).toBeNull();
    expect(r.goodForBulk).toBe(false);
  });
});

describe('it does not re-measure on every call', () => {
  it('caches, because measuring costs a request', async () => {
    const f = respondIn(5, 8192);
    global.fetch = f as never;
    await measureConnection({ force: true });
    const callsAfterFirst = f.mock.calls.length;
    await measureConnection();
    await measureConnection();
    expect(f.mock.calls.length).toBe(callsAfterFirst);
    expect(lastConnectionReading()).not.toBeNull();
  });
});
