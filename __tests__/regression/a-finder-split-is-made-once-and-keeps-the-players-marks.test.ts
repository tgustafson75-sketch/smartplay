/**
 * 2026-10-27 (Phase SB4x — review of SB3, findings "practice #1, #2, #5").
 *
 * 1. EVERY RE-ANALYZE SPLIT A FINDER-SPLIT UPLOAD AGAIN. A split carries no player content, so it stayed
 *    eligible for good: each Re-analyze ran the finder again, dropped every practice mark and paid to read
 *    the demoted swing again (its "skip a demoted swing" rule never applied to Tim's common case). The split
 *    is now stamped with the finder that made it; only an older finder's split is looked at again.
 * 2. A RE-SPLIT IGNORED THE PLAYER'S TAGS AND DELETES. Feel / shape / contact / direction tags did not
 *    count as the player's content, the carve copied swing 1's tags onto every swing, and deleting the last
 *    swing left ids a re-split took for untouched — so it came back.
 * 3. A DEMOTED SWING HEADLINED THE TENTATIVE FALLBACK. When the demotion left no counted read (one swing
 *    'no ball', the other's read failed), the tentative read was paid for on the practice swing and became
 *    the headline.
 *
 * Driven through the real read (videoUpload._runPhaseKRead) on the real store.
 */
type Read = { ball_struck?: 'yes' | 'no' | 'unknown'; primary_fault?: string; detected_issue?: string };
let mockReads: Record<number, Read | 'fail'> = {};
const mockReadCalls: number[] = [];
let mockLocate: { timeSec: number; confidence: 'high' | 'low' }[] = [];
let mockLocateCalls = 0;
const mockTentativeCalls: string[] = [];

jest.mock('../../services/poseDetection', () => ({
  analyzeSwing: async (_uri: string, opts: { swing_number: number }, b?: { startSec: number }) => {
    mockReadCalls.push(b?.startSec ?? -1);
    const r = mockReads[opts.swing_number - 1] ?? {};
    if (r === 'fail') return { kind: 'error', message: 'analyzer 500' };
    return {
      kind: 'ok',
      analysis: {
        detected_issue: 'over_the_top', primary_fault: 'over_the_top', severity: 'moderate', confidence: 'high',
        observation: 'o', fault_frame_index: -1, contact_read: 'unknown', ...r,
      },
      frame_timestamps_sec: [],
    };
  },
  analyzeSwingTentative: async (uri: string) => {
    mockTentativeCalls.push(uri);
    return { kind: 'ok', analysis: { observation: `tentative of ${uri}`, follow_up_question: null } };
  },
  probeDurationMs: async () => 40_000,
  locateSwings: async (_u: string, _d: number, coverage?: { complete: boolean }) => {
    mockLocateCalls++;
    if (coverage) coverage.complete = true;   // both finder passes answered
    return mockLocate;
  },
}));
jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  lastReachability: () => null,
  probeReachability: async () => ({ verdict: 'internet_ok', via: 'apple', controlMs: 100, at: Date.now() }),
}));
jest.mock('../../services/swingCommentaryService', () => ({ getTranscriptionStatus: () => 'done' }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../services/contextSynthesizer', () => ({ synthesizeCageInsight: async () => undefined }));

import { useSwingSessionStore } from '../../store/swingSessionStore';
import { _runPhaseKRead } from '../../services/videoUpload';
import { countedShots } from '../../services/swing/practiceSwings';

const s1 = () => useSwingSessionStore.getState().sessionHistory[0];
const shots = () => s1().shots as unknown as Record<string, unknown>[];

function seedFreshUpload() {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'pending', club: '7i', date: 1, upload: { duration_sec: 40, uploaded_at: 1 },
      shots: [{ id: 'up_shot', club: '7i', clipUri: 'file:///range.mp4', timestamp: 1, feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null }],
    }] as never,
  });
}

/** An upload split by an older build (no split stamp). */
function seedOldUpload(patch: (i: number) => Record<string, unknown> = () => ({})) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i', date: 1, upload: { duration_sec: 40, uploaded_at: 1 },
      shots: [2, 14, 28].map((start, i) => ({
        id: `s1_shot_${i}`, club: '7i', clipUri: 'file:///range.mp4', clipStartSeconds: start, clipEndSeconds: start + 4, locatedImpactSec: start + 2.5,
        detectionMethod: 'manual', timestamp: 1, feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null,
        ...patch(i),
      })),
    }] as never,
  });
}

function seedLiveCapture(patch: (i: number) => Record<string, unknown> = () => ({})) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'live_capture', analysis_status: 'ok', club: '7i', date: 1, upload: { uploaded_at: 1 },
      shots: [0, 1].map((i) => ({
        id: `s1_shot_${i}`, club: '7i', clipUri: `file:///cap${i}.mp4`, clipStartSeconds: 2 + i * 6, clipEndSeconds: 6 + i * 6,
        detectionMethod: 'manual', timestamp: 1, feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null,
        ...patch(i),
      })),
    }] as never,
  });
}

const THREE = [{ timeSec: 6, confidence: 'high' as const }, { timeSec: 16, confidence: 'high' as const }, { timeSec: 30, confidence: 'high' as const }];

afterAll(() => { require('../../services/analytics').teardownAnalytics(); });
beforeEach(() => {
  mockReads = {}; mockReadCalls.length = 0; mockLocate = []; mockLocateCalls = 0; mockTentativeCalls.length = 0;
});

describe('a finder split is made once per finder', () => {
  it('THE REPORT: an old upload re-split on Re-analyze is not split again by the next Re-analyze; its demoted swing is not paid for again', async () => {
    seedOldUpload();
    mockLocate = THREE;
    mockReads = { 1: { ball_struck: 'no' } };
    await _runPhaseKRead('s1');
    expect(mockLocateCalls).toBe(1);
    expect(shots()[1].practice).toEqual({ reason: 'no_ball_seen' });
    mockReadCalls.length = 0;
    await _runPhaseKRead('s1');
    expect(mockLocateCalls).toBe(1);                                  // the finder is not asked again
    expect(shots()[1].practice).toEqual({ reason: 'no_ball_seen' });  // the demotion stands
    expect(mockReadCalls).toHaveLength(2);                            // and that swing is not read again
    expect(countedShots(shots())).toHaveLength(2);
  });

  it('a fresh upload split on its first read is not split again on Re-analyze', async () => {
    seedFreshUpload();
    mockLocate = THREE;
    await _runPhaseKRead('s1');
    expect(mockLocateCalls).toBe(1);
    expect(shots()).toHaveLength(3);
    await _runPhaseKRead('s1');
    expect(mockLocateCalls).toBe(1);
  });

  it('guard: an older finder\'s split (no stamp) is still looked at again', async () => {
    seedOldUpload();
    mockLocate = THREE;
    await _runPhaseKRead('s1');
    expect(mockLocateCalls).toBe(1);
  });
});

describe('a re-split never overrides what the player did', () => {
  it('a feel / shape / contact / direction tag on any swing blocks the re-split', async () => {
    for (const tag of [{ feel: 'pure' }, { shape: 'draw' }, { contact: 'thin' }, { direction: 'left' }]) {
      seedOldUpload((i) => (i === 2 ? tag : {}));
      mockLocate = [{ timeSec: 16, confidence: 'high' }];
      mockLocateCalls = 0;
      await _runPhaseKRead('s1');
      expect(mockLocateCalls).toBe(0);
      expect(shots()).toHaveLength(3);
      expect(shots()[2]).toMatchObject(tag);
    }
  });

  it('a first split does not copy swing 1\'s per-swing tags onto a swing the player never tagged… unless the player tagged the whole clip', () => {
    seedFreshUpload();
    useSwingSessionStore.getState().updateShotTags('s1', 'up_shot', { feel: 'pure' });
    useSwingSessionStore.getState().expandUploadIntoSwings('s1', [{ startSec: 1, endSec: 4 }, { startSec: 10, endSec: 13 }], true);
    // the single upload's tag was on the whole clip: it rides on every swing, as the clip's notes do
    expect(shots().map((x) => x.feel)).toEqual(['pure', 'pure']);
    // a RE-split never moves a tag onto another swing: the store refuses to replace a list carrying his tags (SB6)
    useSwingSessionStore.getState().replaceUploadSwings('s1', [{ startSec: 1, endSec: 4 }, { startSec: 10, endSec: 13 }, { startSec: 20, endSec: 23 }]);
    expect(shots().map((x) => x.feel ?? null)).toEqual(['pure', 'pure']);
  });

  it('THE REPORT: deleting the last swing of an upload — the next Re-analyze does not bring it back', async () => {
    seedOldUpload();
    useSwingSessionStore.getState().deleteShot('s1', 's1_shot_2');
    mockLocate = THREE;
    await _runPhaseKRead('s1');
    expect(mockLocateCalls).toBe(0);
    expect(shots().map((x) => x.id)).toEqual(['s1_shot_0', 's1_shot_1']);
  });
});

describe('the tentative fallback never reads or headlines a demoted swing', () => {
  it('THE REPORT: swing 1 read "no ball", swing 2\'s read failed — the tentative reads swing 2, not the practice swing', async () => {
    seedLiveCapture();
    mockReads = { 0: { ball_struck: 'no' }, 1: 'fail' };
    await _runPhaseKRead('s1');
    expect(shots()[0].practice).toEqual({ reason: 'no_ball_seen' });
    expect(mockTentativeCalls).toEqual(['file:///cap1.mp4']);
    expect((s1().primary_issue as { detected_in_shots?: string[] } | null)?.detected_in_shots).toEqual(['s1_shot_1']);
  });

  it('a Re-analyze with swing 1 already demoted and swing 2\'s read failing: the fallback is swing 2', async () => {
    seedLiveCapture((i) => (i === 0 ? { practice: { reason: 'no_ball_seen' } } : {}));
    mockReads = { 1: 'fail' };
    await _runPhaseKRead('s1');
    expect(mockTentativeCalls).toEqual(['file:///cap1.mp4']);
  });

  it('every counted read inconclusive: the tentative is the counted swing\'s', async () => {
    seedLiveCapture();
    mockReads = { 0: { ball_struck: 'no', primary_fault: 'inconclusive', detected_issue: 'none' }, 1: { ball_struck: 'yes', primary_fault: 'inconclusive', detected_issue: 'none' } };
    await _runPhaseKRead('s1');
    expect(shots()[0].practice).toEqual({ reason: 'no_ball_seen' });
    expect(mockTentativeCalls).toEqual(['file:///cap1.mp4']);
    expect((s1().primary_issue as { detected_in_shots?: string[] } | null)?.detected_in_shots).toEqual(['s1_shot_1']);
  });
});
