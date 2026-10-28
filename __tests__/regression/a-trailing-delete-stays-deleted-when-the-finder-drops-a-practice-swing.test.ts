/**
 * 2026-10-27 (Phase SB7, recheck round 11 "E-R10-1") — RE-ANALYZE CARVED BACK A TRAILING SWING DELETED BEFORE
 * SB4x WHEN TODAY'S FINDER DROPS A PRACTICE SWING.
 *
 * An old finder split 5 windows, one of them a practice swing (shot_2). Before SB4x a delete set no flag and
 * kept the ids, so deleting the last real swing (shot_4) left an unbroken shot_0..shot_3 that still looked
 * untouched. Today's finder drops the practice swing (that is its job) and finds the 4 real swings — the
 * deleted one among them. The only guard left compared COUNTS (4 > 4 is false), so replaceUploadSwings carved
 * the deleted swing back, with a new paid read. Now a found swing past the end of the last stored window holds
 * the stored swings back as well.
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
import { resplitEligible, resplitWouldRestoreRemoved, UPLOAD_FINDER_VERSION } from '../../services/swing/practiceSwings';


type Seed = { clipStartSeconds: number; clipEndSeconds: number; locatedImpactSec: number };
const s1 = () => useSwingSessionStore.getState().sessionHistory[0] as unknown as {
  swings_split_version?: number; swings_edited_by_user?: boolean;
  shots: { id: string; clipStartSeconds?: number; clipEndSeconds?: number; locatedImpactSec?: number }[];
};
let locateCalls = 0;
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
/** The old finder's window around each impact (2.5s before, 1.5s after), ids shot_0.. in order. */
const finderWindows = (impacts: number[]): Seed[] => impacts.map((t) => ({ clipStartSeconds: t - 2.5, clipEndSeconds: t + 1.5, locatedImpactSec: t }));
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
const impacts = () => s1().shots.map((x) => x.locatedImpactSec);

afterAll(() => { require('../../services/analytics').teardownAnalytics(); });

describe('a trailing swing deleted before SB4x stays deleted', () => {
  it('THE REPORT: 5 old windows (20 = practice), the last real swing (45) deleted — the finder drops 20 and finds 45: kept', async () => {
    seedOldSplit(finderWindows([5, 15, 20, 35]));                    // shot_4 (45) was deleted: ids still 0..3
    expect(resplitEligible(s1() as never)).toBe(true);               // the delete left no trace
    stubFinder([5, 15, 35, 45]);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);                                     // one whole look
    expect(impacts()).toEqual([5, 15, 20, 35]);                      // 45 not carved back
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);   // and not looked for again
  });

  it('guard: the finder drops the practice swing and finds nothing past the last window — the re-split runs', async () => {
    seedOldSplit(finderWindows([5, 15, 20, 35]));
    stubFinder([5, 15, 35]);
    await _runPhaseKRead('s1');
    expect(impacts()).toEqual([5, 15, 35]);
  });

  it('positions, not counts: same count with a swing past the end holds back; inside the stored span does not', () => {
    const session = { shots: finderWindows([5, 15, 20, 35]).map((w, i) => ({ id: `s1_shot_${i}`, ...w })) };
    const win = (t: number) => ({ startSec: t - 2.5, endSec: t + 1.5, impactSec: t });
    expect(resplitWouldRestoreRemoved(session as never, [5, 15, 35, 45].map(win))).toBe(true);
    expect(resplitWouldRestoreRemoved(session as never, [5, 15, 25, 35].map(win))).toBe(false);
    // Today's 'auto' split is not held back (SB5: a half look's split stays open).
    const auto = { shots: session.shots.map((sh) => ({ ...sh, clipWindowSource: 'auto' as const })) };
    expect(resplitWouldRestoreRemoved(auto as never, [5, 15, 35, 45].map(win))).toBe(false);
  });
});
