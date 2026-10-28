/**
 * 2026-10-27 (Phase SB8, recheck E-R13-1 of the SB3/SB4 work).
 *
 * AN OLD "ANALYZE AT THIS MOMENT" AT THE CLIP'S END WAS RE-SPLIT AWAY. Before 10-04 Analyze-at-this-moment
 * wrote its moment less 2.5s to its moment plus 3s — cut at the clip's end — with its moment as the impact and
 * no window source. A moment within 1.5s of the clip's end left exactly the finder's shape (impact less 2.5s
 * to at most 1.5s after it), so the single upload looked finder-bound (and a carved last swing finder-carved):
 * Re-analyze ran the finder again and replaced the swing he pointed at with the finder's, new paid reads too.
 *
 * Now a pre-10-04 window that ends at the clip's end and starts its moment less 2.5s before is his
 * (practiceSwings.finderShapedWindow); one the finder narrowed at its start is still the finder's.
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
import { resplitEligible } from '../../services/swing/practiceSwings';

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

const UID = '1700000000000_ab12cd_uploaded_shot';
const CLIP_SEC = 20;
const s1 = () => useSwingSessionStore.getState().sessionHistory[0] as unknown as {
  shots: { id: string; clipStartSeconds?: number; clipEndSeconds?: number; locatedImpactSec?: number }[];
};

/** A 20s upload as ingested (its own uid shot id), with `shot` laid over it. */
function seedUpload(shot: Record<string, unknown>, durationSec: number | null = CLIP_SEC) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i', date: 1, upload: { duration_sec: durationSec, uploaded_at: 1 },
      shots: [{
        id: UID, club: '7i', clipUri: 'file:///range20.mp4', timestamp: 1,
        feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null, ...shot,
      }],
    }] as never,
  });
}
/** The old onAnalyzeAtPosition: moment less 2.5s to moment plus 3s, cut at the clip's end; no window source. */
const atMoment = (c: number, dur = CLIP_SEC) => ({ clipStartSeconds: Math.max(0, c - 2.5), clipEndSeconds: Math.min(dur, c + 3), locatedImpactSec: c });

/** An old carved split (`${id}_shot_i`, one clip, 'manual', no window source). */
const carved = (windows: { clipStartSeconds: number; clipEndSeconds: number; locatedImpactSec: number }[], durationSec: number | null = CLIP_SEC) => ({
  id: 's1', source: 'uploaded_video', upload: { duration_sec: durationSec },
  shots: windows.map((w, i) => ({ id: `s1_shot_${i}`, clipUri: 'file:///range20.mp4', detectionMethod: 'manual', ...w })),
});

afterAll(() => { require('../../services/analytics').teardownAnalytics(); });

describe('an old Analyze-at-this-moment at the clip\'s end stays his', () => {
  it('THE REPORT: a single upload, his moment 1s before the clip\'s end — Re-analyze keeps his window', async () => {
    seedUpload(atMoment(19));
    expect(s1().shots[0]).toMatchObject({ clipStartSeconds: 16.5, clipEndSeconds: 20 });   // the finder's shape
    expect(resplitEligible(s1() as never)).toBe(false);
    stubFinder([8]);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(0);
    expect(s1().shots).toEqual([expect.objectContaining({ id: UID, clipStartSeconds: 16.5, clipEndSeconds: 20, locatedImpactSec: 19 })]);
  });

  it('with no stored clip length, a single window cut short of 1.5s after its moment is his too', () => {
    seedUpload(atMoment(19), null);
    expect(resplitEligible(s1() as never)).toBe(false);
  });

  it('a carved last swing, his moment 1s before the clip\'s end, holds the split', () => {
    const finder = { clipStartSeconds: 5.5, clipEndSeconds: 9.5, locatedImpactSec: 8 };
    expect(resplitEligible(carved([finder, atMoment(19)]) as never)).toBe(false);
    expect(resplitEligible(carved([finder, atMoment(19)], null) as never)).toBe(false);
  });

  it('guard: the finder\'s own windows away from the clip\'s end, or narrowed at the start, are still looked at', async () => {
    expect(resplitEligible(carved([{ clipStartSeconds: 5.5, clipEndSeconds: 9.5, locatedImpactSec: 8 }, { clipStartSeconds: 12.5, clipEndSeconds: 16.5, locatedImpactSec: 15 }]) as never)).toBe(true);
    // the last swing's start was narrowed by its neighbour (Analyze-at-this-moment never narrowed it)
    expect(resplitEligible(carved([{ clipStartSeconds: 14.5, clipEndSeconds: 17.4, locatedImpactSec: 16 }, { clipStartSeconds: 17.4, clipEndSeconds: 20, locatedImpactSec: 19 }]) as never)).toBe(true);
    seedUpload({ clipStartSeconds: 5.5, clipEndSeconds: 9.5, locatedImpactSec: 8 });
    expect(resplitEligible(s1() as never)).toBe(true);
    stubFinder([4, 8]);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual([4, 8]);
  });
});
