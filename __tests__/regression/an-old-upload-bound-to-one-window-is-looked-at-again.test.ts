/**
 * 2026-10-27 (Phase SB8, recheck E-R12-1 of the SB3/SB4 work).
 *
 * AN OLD UPLOAD BOUND TO ONE WINDOW NEVER MET TODAY'S FINDER AGAIN. When the finder found one swing it bound
 * the single uploaded shot to that window — and before SB5 it did so without a whole look, so one finder pass
 * alone (the other failed) could hide the second swing. The bound shot keeps its ingest id
 * (`uid('uploaded_shot')`), and the re-split only looked at carved ids (`${id}_shot_i`): the swing stayed
 * hidden for good, and Re-analyze only re-read the old window.
 *
 * Now a single upload the finder bound (practiceSwings.resplitEligible) is looked at again, and a whole look
 * that binds or keeps one window stamps the finder so the look is not paid for on every Re-analyze.
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
const s1 = () => useSwingSessionStore.getState().sessionHistory[0] as unknown as {
  swings_split_version?: number;
  shots: { id: string; clipStartSeconds?: number; clipEndSeconds?: number; locatedImpactSec?: number }[];
};

/** A 60s upload as ingested (its own uid shot id), with `shot` laid over it. */
function seedUpload(shot: Record<string, unknown>) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i', date: 1, upload: { duration_sec: 60, uploaded_at: 1 },
      shots: [{
        id: UID, club: '7i', clipUri: 'file:///range60.mp4', timestamp: 1,
        feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null, ...shot,
      }],
    }] as never,
  });
}
/** The old finder's bind around one impact (2.5s before, 1.5s after). */
const bound = (t: number) => ({ clipStartSeconds: t - 2.5, clipEndSeconds: t + 1.5, locatedImpactSec: t });

afterAll(() => { require('../../services/analytics').teardownAnalytics(); });

describe('an old upload the finder bound to one window is looked at again', () => {
  it('THE REPORT: half a look bound swing 2 alone — Re-analyze finds both, and does not look again', async () => {
    seedUpload({ ...bound(35), clipWindowSource: 'auto' });
    expect(resplitEligible(s1() as never)).toBe(true);
    stubFinder([15, 35]);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual([15, 35]);
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);                                    // stamped: not asked again
  });

  it('a bind made before window sources (10-04) is the finder\'s when it carries its impact', async () => {
    seedUpload({ ...bound(35) });
    expect(resplitEligible(s1() as never)).toBe(true);
    stubFinder([15, 35]);
    await _runPhaseKRead('s1');
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual([15, 35]);
  });

  it('an old bind on a practice swing is replaced by today\'s one swing, stamped', async () => {
    seedUpload({ ...bound(20), clipWindowSource: 'auto' });
    stubFinder([35]);
    await _runPhaseKRead('s1');
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual([35]);
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);
  });

  it('today\'s whole look that binds one window stamps it: the next Re-analyze does not look again', async () => {
    seedUpload({});
    stubFinder([35]);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);
    expect(s1().shots[0]).toMatchObject({ id: UID, locatedImpactSec: 35 });
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);
  });

  it('guard: his trim, a pre-10-04 trim (no impact), or anything he put on the swing — no look', async () => {
    for (const shot of [
      { ...bound(35), clipWindowSource: 'user' },
      { clipStartSeconds: 33, clipEndSeconds: 36 },
      { ...bound(35), clipWindowSource: 'auto', userNotes: 'felt great' },
      { ...bound(35), clipWindowSource: 'auto', isGoodRep: true },
    ]) {
      seedUpload(shot);
      expect(resplitEligible(s1() as never)).toBe(false);
      stubFinder([15, 35]);
      await _runPhaseKRead('s1');
      expect(locateCalls).toBe(0);
      expect(s1().shots.map((x) => x.id)).toEqual([UID]);
    }
  });
});
