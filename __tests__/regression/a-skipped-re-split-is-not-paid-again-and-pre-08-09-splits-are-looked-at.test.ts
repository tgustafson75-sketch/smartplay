/**
 * 2026-10-27 (Phase SB6 — recheck round 8 of the SB3/SB4 work).
 *
 * 1. A Re-analyze of an old finder split whose look finds MORE swings than it holds keeps the stored swings
 *    (a swing he deleted before deletes were flagged would come back). That skip stamped nothing, so every
 *    later Re-analyze ran both finder passes again — seconds of wait and a model call — for the same answer.
 *    Now the skip stamps today's finder on the session: the next Re-analyze does not look again.
 * 2. Uploads split before 08-09 stored no locatedImpactSec on any swing, and the finder-shape test needed one:
 *    Re-analyze never looked at them again, so the old finder's practice swings stayed carved and counted.
 *    Now a whole session of impact-less windows is judged by length (the finder's never ran past PRE + POST).
 *
 * Driven through the real finder (fetch stubbed) and the real read (videoUpload._runPhaseKRead) on the real store.
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
jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  lastReachability: () => null,
  probeReachability: async () => ({ verdict: 'internet_ok', via: 'apple', controlMs: 100, at: Date.now() }),
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

import { useSwingSessionStore } from '../../store/swingSessionStore';
import { _runPhaseKRead } from '../../services/videoUpload';
import { resplitEligible, UPLOAD_FINDER_VERSION } from '../../services/swing/practiceSwings';

const SIX = [5, 15, 25, 35, 45, 55];

let locateCalls = 0;
/** Both finder passes answer `times`. */
function stubFinder(times: number[]) {
  locateCalls = 0;
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    if (/\/api\/health/.test(url)) return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    const mode = init?.body ? (JSON.parse(init.body) as { mode?: string }).mode : undefined;
    if (mode !== 'locate_swings') return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    locateCalls++;
    return { ok: true, status: 200, json: async () => ({ swings: times.map((t) => ({ time_sec: t, confidence: 'high' })) }), text: async () => '' };
  });
}

type Seed = { clipStartSeconds: number; clipEndSeconds: number; locatedImpactSec?: number };
const s1 = () => useSwingSessionStore.getState().sessionHistory[0] as unknown as {
  swings_split_version?: number; swings_edited_by_user?: boolean;
  shots: { id: string; clipStartSeconds?: number; clipEndSeconds?: number; locatedImpactSec?: number }[];
};

/** An old upload carved by an older finder (no stamp, no window source), one window per seed. */
function seedOldSplit(windows: Seed[]) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i', date: 1, upload: { duration_sec: 60, uploaded_at: 1 },
      shots: windows.map((w, i) => ({
        id: `s1_shot_${i}`, club: '7i', clipUri: 'file:///range60.mp4', ...w, detectionMethod: 'manual', timestamp: 1,
        feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null,
      })),
    }] as never,
  });
}
/** The finder's window around each impact (2.5s before, 1.5s after); `withImpact` false = a split before 08-09. */
const finderWindows = (impacts: number[], withImpact: boolean): Seed[] =>
  impacts.map((t) => ({ clipStartSeconds: t - 2.5, clipEndSeconds: t + 1.5, ...(withImpact ? { locatedImpactSec: t } : {}) }));

afterAll(() => { require('../../services/analytics').teardownAnalytics(); });

describe('a skipped re-split is not paid for again', () => {
  it('THE REPORT: the look would bring back a deleted swing — the swings stand, and the next Re-analyze does not look again', async () => {
    seedOldSplit(finderWindows(SIX.slice(0, 5), true));
    stubFinder(SIX);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);                                    // one whole look (both passes)
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual(SIX.slice(0, 5));
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);
    expect(s1().swings_edited_by_user).toBeUndefined();             // he did not edit it; the finder judged it
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);                                    // not asked again
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual(SIX.slice(0, 5));
  });

  it('the store stamp touches no swing and is a no-op on a list Re-analyze may not split', () => {
    seedOldSplit(finderWindows(SIX.slice(0, 5), true));
    const before = s1().shots;
    useSwingSessionStore.getState().keepUploadSwings('s1');
    expect(s1().shots).toBe(before);
    useSwingSessionStore.setState({ sessionHistory: [{ ...s1(), swings_split_version: undefined, swings_edited_by_user: true }] as never });
    useSwingSessionStore.getState().keepUploadSwings('s1');
    expect(s1().swings_split_version).toBeUndefined();
  });
});

describe('an upload split before 08-09 (no impact stored on any swing) is looked at again', () => {
  it('THE REPORT: the old finder carved a practice swing — Re-analyze looks again and today\'s finder drops it', async () => {
    seedOldSplit(finderWindows([5, 15, 20, 35], false));            // 20 = the practice swing
    expect(resplitEligible(s1() as never)).toBe(true);
    stubFinder([5, 15, 35]);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual([5, 15, 35]);
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);
  });

  it('a finder window narrowed by its neighbour is still the finder\'s', () => {
    seedOldSplit([{ clipStartSeconds: 2.5, clipEndSeconds: 6.5 }, { clipStartSeconds: 6.5, clipEndSeconds: 8.5 }]);
    expect(resplitEligible(s1() as never)).toBe(true);
  });

  it('guard: Analyze-at-this-moment\'s 5.5s window (no impact before 08-09) is his — no look', async () => {
    seedOldSplit([...finderWindows([5], false), { clipStartSeconds: 12.5, clipEndSeconds: 18 }, ...finderWindows([35], false)]);
    expect(resplitEligible(s1() as never)).toBe(false);
    stubFinder([5, 15, 35]);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(0);
    expect(s1().shots[1]).toMatchObject({ clipStartSeconds: 12.5, clipEndSeconds: 18 });
  });

  it('guard: one impact-less window among impact-carrying ones is a trim, even a short one — no look', () => {
    seedOldSplit([...finderWindows([5], true), { clipStartSeconds: 13, clipEndSeconds: 16 }, ...finderWindows([35], true)]);
    expect(resplitEligible(s1() as never)).toBe(false);
  });
});
