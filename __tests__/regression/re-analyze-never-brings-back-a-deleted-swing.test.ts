/**
 * 2026-10-27 (Phase SB6 — recheck E2 of the SB3/SB4 work).
 *
 * Before SB4x, Tim deleted the last swing (often a practice swing) of an old finder-split upload. deleteShot
 * set no flag then (swings_edited_by_user is SB4x's), and dropping the LAST swing leaves the ids
 * `${id}_shot_0..n-2` unbroken — so the split still looked untouched, Re-analyze ran the finder again, and
 * replaceUploadSwings carved the swing he deleted back, with a new paid read and a say in the headline.
 *
 * Now, on a split in the pre-10-26 shape, a look that finds more swings than the session holds leaves the
 * stored swings standing; and a headline that names a carved swing no longer in the list marks the list as
 * edited. Driven through the real finder (fetch
 * stubbed) and the real read (videoUpload._runPhaseKRead) on the real store.
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

import { useSwingSessionStore } from '../../store/swingSessionStore';
import { _runPhaseKRead } from '../../services/videoUpload';
import { UPLOAD_FINDER_VERSION } from '../../services/swing/practiceSwings';

/** Tim's six real swings. */
const SIX = [5, 15, 25, 35, 45, 55];

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

const s1 = () => useSwingSessionStore.getState().sessionHistory[0] as unknown as { swings_split_version?: number; shots: { id: string; locatedImpactSec?: number }[] };

/** Tim's old upload: six swings carved by an older finder (no stamp); he deleted the last one before SB4x. */
function seedOldUploadLastDeleted(headlineShots?: string[]) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i', date: 1, upload: { duration_sec: 60, uploaded_at: 1 },
      ...(headlineShots ? { primary_issue: { issue_id: 'over_the_top', detected_in_shots: headlineShots } } : {}),
      shots: SIX.slice(0, 5).map((t, i) => ({
        id: `s1_shot_${i}`, club: '7i', clipUri: 'file:///range60.mp4', clipStartSeconds: t - 2.5, clipEndSeconds: t + 1.5,
        locatedImpactSec: t, detectionMethod: 'manual', timestamp: 1,
        feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null,
      })),
    }] as never,
  });
}

afterAll(() => { require('../../services/analytics').teardownAnalytics(); });
beforeEach(() => { mockVerdict = 'internet_ok'; });

describe('Re-analyze never brings back a swing deleted before deletes were flagged', () => {
  it('THE REPORT: the finder sees all six again — the five he kept stay, the deleted sixth does not come back', async () => {
    seedOldUploadLastDeleted();
    stubFinder(SIX, SIX);
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(2);                                     // the finder was asked (a whole look)
    expect(s1().shots.map((x) => x.id)).toEqual(['s1_shot_0', 's1_shot_1', 's1_shot_2', 's1_shot_3', 's1_shot_4']);
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual(SIX.slice(0, 5));
  });

  it('the headline names a carved swing no longer in the list: the list is his — not looked at again', async () => {
    seedOldUploadLastDeleted(['s1_shot_2', 's1_shot_5']);
    stubFinder(SIX.slice(0, 3), SIX.slice(0, 3));
    await _runPhaseKRead('s1');
    expect(locateCalls).toBe(0);
    expect(s1().shots).toHaveLength(5);
  });

  it('guard: a look inside what he kept still re-splits an old upload (a practice swing dropped)', async () => {
    seedOldUploadLastDeleted(['s1_shot_2']);
    stubFinder([15, 25, 35, 45], [15, 25, 35, 45]);
    await _runPhaseKRead('s1');
    expect(s1().shots.map((x) => x.locatedImpactSec)).toEqual([15, 25, 35, 45]);
    expect(s1().swings_split_version).toBe(UPLOAD_FINDER_VERSION);
  });
});
