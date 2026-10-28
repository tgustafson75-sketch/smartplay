/**
 * 2026-10-27 (Phase SB6 — recheck round 6 of the SB3/SB4 work).
 *
 * E-R6-1. Re-analyze of an old finder split decided "may I split this again?" BEFORE the finder's two network
 * passes, and the swing list stays live through them (each row's ••• sheet). A good-rep mark, a tag, a note
 * or a delete Tim made during the look was wiped when replaceUploadSwings carved every swing afresh — the
 * deleted swing came back and was read (paid for) again. Now the split is judged again on the session as it
 * is when the look answers, and the store itself refuses to replace a list the player edited.
 *
 * E-R6-2. A swing trimmed (or Analyze-at-this-moment-ed) before 10-04 wrote no window source, so it kept the
 * pre-10-26 "finder carved it" shape and Re-analyze replaced his window with the finder's. Now a pre-10-26
 * window must also be the finder's shape (impact less 2.5s .. at most 1.5s after it).
 *
 * Driven through the real finder (fetch stubbed) and the real read (videoUpload._runPhaseKRead) on the real
 * store.
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
import { UPLOAD_FINDER_VERSION } from '../../services/swing/practiceSwings';

/** Tim's swings: four carved by an older finder; the look today sees three (one was a practice swing). */
const FOUR = [5, 15, 25, 35];
const THREE = [5, 15, 25];

let locateCalls = 0;
/** The finder answers `times` on both passes; `during` runs inside the first pass — Tim using the list meanwhile. */
function stubFinder(times: number[], during?: () => void) {
  locateCalls = 0;
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    if (/\/api\/health/.test(url)) return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    const mode = init?.body ? (JSON.parse(init.body) as { mode?: string }).mode : undefined;
    if (mode !== 'locate_swings') return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    if (locateCalls++ === 0) during?.();
    return { ok: true, status: 200, json: async () => ({ swings: times.map((t) => ({ time_sec: t, confidence: 'high' })) }), text: async () => '' };
  });
}

type Shot = { id: string; clipStartSeconds?: number; clipEndSeconds?: number; locatedImpactSec?: number; isGoodRep?: boolean | null; userNotes?: string | null; feel?: string | null };
const s1 = () => useSwingSessionStore.getState().sessionHistory[0] as unknown as { swings_split_version?: number; shots: Shot[] };
const store = () => useSwingSessionStore.getState();

/** An old upload split by an older finder (no stamp, no window source); `patch` reshapes one swing. */
function seedOldUpload(patch: (i: number, t: number) => Record<string, unknown> = () => ({})) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i', date: 1, upload: { duration_sec: 45, uploaded_at: 1 },
      shots: FOUR.map((t, i) => ({
        id: `s1_shot_${i}`, club: '7i', clipUri: 'file:///range45.mp4', clipStartSeconds: t - 2.5, clipEndSeconds: t + 1.5,
        locatedImpactSec: t, detectionMethod: 'manual', timestamp: 1,
        feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null,
        ...patch(i, t),
      })),
    }] as never,
  });
}

afterAll(() => { require('../../services/analytics').teardownAnalytics(); });

describe('E-R6-1: what Tim does to the swing list while the finder looks survives the look', () => {
  it('THE REPORT: he marks swing 3 a good rep during the look — the mark stays on swing 3, the list is not re-split', async () => {
    seedOldUpload();
    stubFinder(THREE, () => store().markShotGoodRep('s1', 's1_shot_2', true));
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);                                     // the look happened
    expect(s1().shots.map((x) => x.id)).toEqual(['s1_shot_0', 's1_shot_1', 's1_shot_2', 's1_shot_3']);
    expect(s1().shots[2].isGoodRep).toBe(true);
    expect(s1().swings_split_version).toBeUndefined();               // not stamped: the list is his
  });

  it('a tag or a note written during the look stays on its swing', async () => {
    seedOldUpload();
    stubFinder(THREE, () => {
      store().updateShotTags('s1', 's1_shot_1', { feel: 'pure' });
      store().setShotNotes('s1', 's1_shot_3', 'felt late');
    });
    await _runPhaseKRead('s1');
    expect(s1().shots.map((x) => x.feel ?? null)).toEqual([null, 'pure', null, null]);
    expect(s1().shots[3].userNotes).toBe('felt late');
  });

  it('THE REPORT: he deletes the practice swing at the end during the look — it is not carved back', async () => {
    seedOldUpload();
    stubFinder(FOUR, () => store().deleteShot('s1', 's1_shot_3'));
    await _runPhaseKRead('s1');
    expect(s1().shots.map((x) => x.id)).toEqual(['s1_shot_0', 's1_shot_1', 's1_shot_2']);
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual(THREE);
  });

  it('the store refuses too: replaceUploadSwings leaves a list the player edited as it is', () => {
    seedOldUpload();
    store().setShotNotes('s1', 's1_shot_0', 'mine');
    store().replaceUploadSwings('s1', [{ startSec: 2.5, endSec: 6.5, impactSec: 5 }]);
    expect(s1().shots).toHaveLength(4);
    expect(s1().shots[0].userNotes).toBe('mine');
  });

  it('guard: an untouched old split is still split again when the look answers', async () => {
    seedOldUpload();
    stubFinder(THREE);
    await _runPhaseKRead('s1');
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual(THREE);
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);
  });
});

describe('E-R6-2: a window Tim chose before 10-04 is never re-split away', () => {
  it('THE REPORT: swing 2 trimmed by hand before 10-04 (no source, impact cleared) — his window stands, no look', async () => {
    seedOldUpload((i) => (i === 1 ? { clipStartSeconds: 11, clipEndSeconds: 17, locatedImpactSec: undefined } : {}));
    stubFinder(THREE);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(0);
    expect(s1().shots).toHaveLength(4);
    expect(s1().shots[1]).toMatchObject({ clipStartSeconds: 11, clipEndSeconds: 17 });
  });

  it('Analyze-at-this-moment before 10-04 (centre 14.2: window -2.5s / +3s, impact at the centre) — his window stands', async () => {
    seedOldUpload((i) => (i === 1 ? { clipStartSeconds: 11.7, clipEndSeconds: 17.2, locatedImpactSec: 14.2 } : {}));
    stubFinder(THREE);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(0);
    expect(s1().shots[1]).toMatchObject({ clipStartSeconds: 11.7, clipEndSeconds: 17.2, locatedImpactSec: 14.2 });
  });

  it('guard: a finder window narrowed by its neighbour or the clip end is still the finder\'s', async () => {
    seedOldUpload((i, t) => (i === 3 ? { clipStartSeconds: t - 1.2, clipEndSeconds: t + 0.4 } : {}));
    stubFinder(THREE);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual(THREE);
  });
});
