/**
 * 2026-10-27 (Phase SB5 — recheck round 4 of SB3/SB4). THE REPORT: Re-analyze on an old 60s range upload
 * an older finder split into 6 swings. The range finder asks two passes (full step, half step) because each
 * alone misses swings (the 27.5s swing the full pass missed on every run). On a weak link one pass came back
 * 5xx — or the dead-host guard aborted it after the other had answered — and the finder returned the 5
 * swings the other pass saw. The re-split only treated "found nothing" as a failed look, so it replaced the
 * 6 stored swings with those 5 and stamped the finder version: the 6th real swing, its read and its mark
 * were gone, and no later Re-analyze could look again.
 *
 * The rule: a look only one pass answered is half a look. It never replaces stored swings, never stamps a
 * split as final, and never binds a single found swing as the whole clip — the next Re-analyze looks again.
 *
 * Driven through the real locateSwings (native edges + fetch stubbed) and the real read
 * (videoUpload._runPhaseKRead) on the real store.
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
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
let mockVerdict: 'internet_ok' | 'offline' = 'internet_ok';
jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  lastReachability: () => null,
  probeReachability: async () => ({ verdict: mockVerdict, via: mockVerdict === 'offline' ? null : 'apple', controlMs: 100, at: Date.now() }),
}));
// The real finder; only the per-swing read is stubbed (its own tests cover it).
jest.mock('../../services/poseDetection', () => ({
  ...jest.requireActual('../../services/poseDetection'),
  analyzeSwing: async () => ({
    kind: 'ok',
    analysis: {
      detected_issue: 'over_the_top', primary_fault: 'over_the_top', severity: 'moderate', confidence: 'high',
      observation: 'o', fault_frame_index: -1, contact_read: 'unknown', ball_struck: 'yes',
    },
    frame_timestamps_sec: [],
  }),
  analyzeSwingTentative: async () => ({ kind: 'error', message: 'unused' }),
  probeDurationMs: async () => 60_000,
}));
jest.mock('../../services/swingCommentaryService', () => ({ getTranscriptionStatus: () => 'done' }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../services/contextSynthesizer', () => ({ synthesizeCageInsight: async () => undefined }));

import { locateSwings, type LocateSwingsCoverage } from '../../services/poseDetection';
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { _runPhaseKRead } from '../../services/videoUpload';
import { UPLOAD_FINDER_VERSION } from '../../services/swing/practiceSwings';

/** Tim's six real swings. The full-step pass misses 25s; the half-step pass sees all six. */
const SIX = [5, 15, 25, 35, 45, 55];
const FULL_PASS = [5, 15, 35, 45, 55];

type Pass = number[] | 502 | 'hang';
let locateCalls = 0;
/** Each locate round asks the full pass first, then the half pass: answer each per `passes`. */
function stubFinder(full: Pass, half: Pass) {
  locateCalls = 0;
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
    if (/\/api\/health/.test(url)) {
      if (mockVerdict === 'offline') throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    const mode = init?.body ? (JSON.parse(init.body) as { mode?: string }).mode : undefined;
    if (mode !== 'locate_swings') return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const pass = locateCalls++ % 2 === 0 ? full : half;
    if (pass === 502) return { ok: false, status: 502, json: async () => ({}), text: async () => '' };
    if (pass === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      });
    }
    return { ok: true, status: 200, json: async () => ({ swings: pass.map((t) => ({ time_sec: t, confidence: 'high' })) }), text: async () => '' };
  });
}

const s1 = () => useSwingSessionStore.getState().sessionHistory[0] as unknown as { swings_split_version?: number; shots: Record<string, unknown>[] };

/** An upload split into six by an older build (no split stamp): Re-analyze may split it again. */
function seedOldUpload() {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i', date: 1, upload: { duration_sec: 60, uploaded_at: 1 },
      shots: SIX.map((t, i) => ({
        id: `s1_shot_${i}`, club: '7i', clipUri: 'file:///range60.mp4', clipStartSeconds: t - 2, clipEndSeconds: t + 2,
        locatedImpactSec: t, detectionMethod: 'manual', clipWindowSource: 'auto', timestamp: 1,
        feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null,
      })),
    }] as never,
  });
}

function seedFreshUpload() {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'pending', club: '7i', date: 1, upload: { duration_sec: 60, uploaded_at: 1 },
      shots: [{ id: 'up_shot', club: '7i', clipUri: 'file:///range60.mp4', timestamp: 1, feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null }],
    }] as never,
  });
}

afterAll(() => { require('../../services/analytics').teardownAnalytics(); });
beforeEach(() => { mockVerdict = 'internet_ok'; });

describe('the finder says whether its look was whole', () => {
  it('both passes answer → complete', async () => {
    stubFinder(FULL_PASS, SIX);
    const cov: LocateSwingsCoverage = { complete: false };
    const found = await locateSwings('file:///a.mp4', 60_000, cov);
    expect(found).toHaveLength(6);
    expect(cov.complete).toBe(true);
  });

  it('the half pass 502s → the full pass\'s swings come back, NOT complete', async () => {
    stubFinder(FULL_PASS, 502);
    const cov: LocateSwingsCoverage = { complete: true };
    const found = await locateSwings('file:///b.mp4', 60_000, cov);
    expect(found).toHaveLength(5);
    expect(cov.complete).toBe(false);
  });

  it('the half pass is aborted by the dead-host guard after the full pass answered → NOT complete', async () => {
    mockVerdict = 'offline';
    stubFinder(FULL_PASS, 'hang');
    const cov: LocateSwingsCoverage = { complete: true };
    const found = await locateSwings('file:///c.mp4', 60_000, cov);
    expect(found).toHaveLength(5);
    expect(cov.complete).toBe(false);
  });
});

describe('a half look never deletes a stored swing', () => {
  it('THE REPORT: Re-analyze on an old 6-swing upload, one pass 502s — all 6 swings stay, the split is not stamped, the next Re-analyze looks again', async () => {
    seedOldUpload();
    stubFinder(FULL_PASS, 502);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);                                     // the finder was asked
    expect(s1().shots.map((x) => x.clipStartSeconds)).toEqual(SIX.map((t) => t - 2));
    expect(s1().swings_split_version).toBeUndefined();

    stubFinder(FULL_PASS, SIX);                                      // a whole look this time
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);                                     // looked again
    expect(s1().shots).toHaveLength(6);
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);
  });

  it('Re-analyze where the half pass is aborted after the full pass answered — all 6 swings stay', async () => {
    seedOldUpload();
    mockVerdict = 'offline';
    stubFinder(FULL_PASS, 'hang');
    await _runPhaseKRead('s1');
    expect(s1().shots).toHaveLength(6);
    expect(s1().swings_split_version).toBeUndefined();
  });

  it('guard: a whole look still re-splits an old upload (and may find fewer)', async () => {
    seedOldUpload();
    stubFinder(FULL_PASS, FULL_PASS);
    await _runPhaseKRead('s1');
    expect(s1().shots).toHaveLength(5);
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);
  });
});

describe('a first split made from a half look stays open', () => {
  it('a fresh upload split by half a look is carved but not stamped — the next Re-analyze finds the missed swing', async () => {
    seedFreshUpload();
    stubFinder(FULL_PASS, 502);
    await _runPhaseKRead('s1');
    expect(s1().shots).toHaveLength(5);
    expect(s1().swings_split_version).toBeUndefined();

    stubFinder(FULL_PASS, SIX);
    await _runPhaseKRead('s1');
    expect(s1().shots).toHaveLength(6);
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);
  });

  it('one swing found by half a look is not bound as the whole clip — the next Re-analyze looks again', async () => {
    seedFreshUpload();
    stubFinder([25], 502);
    await _runPhaseKRead('s1');
    expect(s1().shots).toHaveLength(1);
    expect(s1().shots[0].clipStartSeconds).toBeUndefined();

    stubFinder([25], [25, 45]);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);
    expect(s1().shots).toHaveLength(2);
  });

  it('guard: a whole look still expands and stamps a fresh upload, and binds a single swing', async () => {
    seedFreshUpload();
    stubFinder(FULL_PASS, SIX);
    await _runPhaseKRead('s1');
    expect(s1().shots).toHaveLength(6);
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);

    seedFreshUpload();
    stubFinder([25], [25]);
    await _runPhaseKRead('s1');
    expect(s1().shots).toHaveLength(1);
    expect(typeof s1().shots[0].clipStartSeconds).toBe('number');
  });
});
