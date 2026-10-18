/**
 * 2026-10-17 (Phase F1a — Tim at a driving range, Fold3). Every SmartMotion capture for 35 minutes:
 * `read 3 — API did not answer (dead connection?) … ms=5034 error=Aborted` ×2, then
 * `API unreachable twice — not sending the read` → no_network. Vercel logged the phone's /api/health and
 * /api/swing-analysis returning 200 in that same window — late. The link was SLOW, not dead, and our
 * own probe timing out was vetoing the read. The range split did the same: `range_locate_fallback ·
 * aborted · dead_host · elapsed_ms 21093 · probe1Ok/2Ok/3Ok false`, three times.
 *
 * The rule (services/reachability): our probe failing proves nothing about the phone's connection.
 * Only a PROVEN offline verdict may skip or abort a request; a slow link gets it, with its full timeout.
 *
 * Driven through the real analyzeSwing / locateSwings with only the native edges and fetch stubbed.
 * The reachability verdict is pinned per test (its own probe is covered by its own tests).
 */
jest.mock('../../utils/videoThumbnail', () => ({
  getThumbnailAsync: jest.fn(async (_uri: string, opts: { time: number }) => ({ uri: `file:///thumb_${opts.time}.jpg`, width: 1080, height: 1920 })),
  serializeMediaRead: (fn: () => unknown) => fn(),
  thumbnailCacheStats: () => ({ hits: 0, misses: 0 }),
  wedgedDecodeCount: () => 0,
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async () => ({ uri: 'file:///small.jpg', width: 432, height: 768, base64: 'QUJDRA==' })),
}));
jest.mock('../../services/swing/sharedClipCopy', () => ({
  acquireClipCopy: jest.fn(async () => ({ uri: 'file:///private-copy.mp4', release: () => {} })),
  acquireExistingClipCopy: jest.fn(async () => null),
  isPooledCopy: () => false,
}));
jest.mock('expo-av', () => ({
  Audio: { Sound: { createAsync: jest.fn(async () => ({ sound: { unloadAsync: async () => {} }, status: { isLoaded: true, durationMillis: 5533 } })) } },
}));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
let mockVerdict: 'internet_ok' | 'slow' | 'offline' | 'captive' = 'slow';
const mockProbeCalls: number[] = [];
jest.mock('../../services/reachability', () => {
  const actual = jest.requireActual('../../services/reachability');
  return {
    ...actual,
    probeReachability: async () => {
      mockProbeCalls.push(Date.now());
      return { verdict: mockVerdict, via: mockVerdict === 'offline' ? null : 'apple', controlMs: 3100, at: Date.now() };
    },
    lastReachability: () => null,
  };
});

import { analyzeSwing, locateSwings } from '../../services/poseDetection';
import { useIssueLogStore } from '../../store/issueLogStore';

const mockEvents: { stage: string; details: Record<string, unknown> }[] = [];
const events = (stage: string) => mockEvents.filter((e) => e.stage === stage);

const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
const OK_READ = {
  detected_issue: 'none', severity: 'none', confidence: 'high', observation: 'ok',
  fault_frame_index: -1, primary_fault: 'no_dominant_fault',
  phases_visible: { address: true, top: true, impact: true, finish: true },
};

type Call = { url: string; mode?: string; signal?: AbortSignal };

/** Our health probe never answers in time (the slow link); the POSTs answer per `post`. */
function stubSlowLink(post: (c: Call) => Promise<unknown>): Call[] {
  const calls: Call[] = [];
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
    const c: Call = { url, signal: init?.signal };
    if (init?.body) c.mode = (JSON.parse(init.body) as { mode?: string }).mode ?? 'read';
    calls.push(c);
    if (/\/api\/health/.test(url)) throw abortError();   // what a 5s AbortSignal.timeout looks like
    return post(c);
  });
  return calls;
}

let timeoutSpy: jest.SpyInstance;
beforeEach(() => {
  mockProbeCalls.length = 0;
  mockEvents.length = 0;
  jest.spyOn(useIssueLogStore.getState(), 'addAppEvent').mockImplementation(((stage: string, details: Record<string, unknown>) => {
    mockEvents.push({ stage, details });
  }) as never);
  timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
});
afterEach(() => timeoutSpy.mockRestore());

describe('the read: our health probe timing out does not veto it', () => {
  for (const verdict of ['slow', 'internet_ok'] as const) {
    it(`health probe silent twice, reachability '${verdict}' → the read IS sent, with the full 63s timeout`, async () => {
      mockVerdict = verdict;
      const calls = stubSlowLink(async () => ({ ok: true, status: 200, json: async () => OK_READ, text: async () => '' }));
      const r = await analyzeSwing('file:///range-slow.mp4', { club: '7i', swing_number: 1, tier: 'quick' }, { startSec: 1, endSec: 3 });
      expect(calls.filter((c) => /\/api\/health/.test(c.url))).toHaveLength(2);
      expect(mockProbeCalls).toHaveLength(1);
      const reads = calls.filter((c) => c.mode === 'read');
      expect(reads).toHaveLength(1);
      expect(r.kind).toBe('ok');
      expect(timeoutSpy).toHaveBeenCalledWith(63_000);
    });
  }

  for (const verdict of ['offline', 'captive'] as const) {
    it(`health probe silent twice, reachability '${verdict}' (proven) → no read sent, no_network, fast`, async () => {
      mockVerdict = verdict;
      const calls = stubSlowLink(async () => { throw new Error('a read must not be sent'); });
      const t0 = Date.now();
      const r = await analyzeSwing('file:///range-offline.mp4', { club: '7i', swing_number: 1, tier: 'quick' }, { startSec: 1, endSec: 3 });
      expect(r.kind).toBe('no_network');
      expect(calls.filter((c) => c.mode === 'read')).toHaveLength(0);
      expect(Date.now() - t0).toBeLessThan(2_000);
    });
  }

  it('the health probe answering never asks reachability at all', async () => {
    mockVerdict = 'offline';
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async (url: string) => {
      if (/\/api\/health/.test(url)) return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      return { ok: true, status: 200, json: async () => OK_READ, text: async () => '' };
    });
    const r = await analyzeSwing('file:///range-ok.mp4', { club: '7i', swing_number: 1, tier: 'quick' }, { startSec: 1, endSec: 3 });
    expect(r.kind).toBe('ok');
    expect(mockProbeCalls).toHaveLength(0);
  });
});

describe('the range split: the dead-host guard aborts only on a proven offline verdict', () => {
  /** The locate POST answers after 150ms unless something aborts it first. */
  const slowLocate = (c: Call) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({
      ok: true, status: 200, json: async () => ({ swings: [{ time_sec: 10, confidence: 'high' }, { time_sec: 30, confidence: 'high' }] }), text: async () => '',
    }), 150);
    c.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); });
  });

  it("three silent health probes but reachability 'slow' → the locate is NOT aborted and its swings come back", async () => {
    mockVerdict = 'slow';
    const calls = stubSlowLink(slowLocate);
    const found = await locateSwings('file:///range-60s-slow.mp4', 60_000);
    expect(calls.filter((c) => /\/api\/health/.test(c.url))).toHaveLength(3);
    expect(mockProbeCalls).toHaveLength(1);
    expect(found.length).toBe(2);
    expect(events('range_locate_fallback')).toHaveLength(0);
  });

  it("three silent health probes and reachability 'offline' → aborted as dead_host, fast", async () => {
    mockVerdict = 'offline';
    stubSlowLink(slowLocate);
    const t0 = Date.now();
    const found = await locateSwings('file:///range-60s-offline.mp4', 60_000);
    expect(found).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(150);   // before the locate itself would have answered
    expect(mockProbeCalls).toHaveLength(1);
    const fb = events('range_locate_fallback');
    expect(fb).toHaveLength(1);
    expect(fb[0].details).toMatchObject({ reason: 'aborted', cause: 'dead_host', net: 'offline' });
  });
});

/**
 * 2026-10-17 — Tim's hybrid range clip (1792271500056): real swings at ~16.4s, 27.5s, 40.8s. The 24-frame
 * pass answered [17, 41.2] on every run (27.5s fell between frames 26.59s and 29.02s); the same frames
 * half a step later answered [10.9, 27.8, 42.3]. These are the production API's real answers. Both passes
 * are asked and merged, so no real swing is lost.
 */
describe('the range locate asks twice, half a step apart, and keeps every swing either pass saw', () => {
  it('hybrid clip: 16.4 / 27.5 / 40.8 all come back', async () => {
    mockVerdict = 'internet_ok';
    const bodies: number[][] = [];
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
      if (/\/api\/health/.test(url)) return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      const times = (JSON.parse(init!.body!) as { frames: { time_sec: number }[] }).frames.map((f) => f.time_sec);
      bodies.push(times);
      const half = times[0] > 3.5;   // the half-step pass starts ~1.2s after the first
      const swings = half ? [10.9, 27.8, 42.3] : [17, 41.2];
      return { ok: true, status: 200, json: async () => ({ swings: swings.map((t) => ({ time_sec: t, confidence: 'high' })) }), text: async () => '' };
    });
    const found = await locateSwings('file:///range-hybrid.mp4', 59_851);
    expect(bodies).toHaveLength(2);
    expect(bodies[1][0] - bodies[0][0]).toBeGreaterThan(1);       // shifted, not the same frames twice
    expect(bodies[1].every((t) => t <= 59.851)).toBe(true);
    const near = (t: number) => found.some((f) => Math.abs(f.timeSec - t) < 1.6);
    expect(near(16.4) && near(27.5) && near(40.8)).toBe(true);
    expect(found.filter((f) => f.timeSec > 39 && f.timeSec < 44)).toHaveLength(1);   // 41.2 + 42.3 are one swing
  });

  it('one pass failing still returns the other pass\'s swings', async () => {
    mockVerdict = 'internet_ok';
    let n = 0;
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async (url: string) => {
      if (/\/api\/health/.test(url)) return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      n += 1;
      if (n === 1) return { ok: false, status: 502, json: async () => ({}), text: async () => '' };
      return { ok: true, status: 200, json: async () => ({ swings: [{ time_sec: 20, confidence: 'high' }] }), text: async () => '' };
    });
    const found = await locateSwings('file:///range-one-fails.mp4', 60_000);
    expect(found.map((f) => f.timeSec)).toEqual([20]);
  });
});

