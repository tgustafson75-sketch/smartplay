/**
 * 2026-10-26 (Tim: "Re-analyze with latest" on an old library reel — swings 2 and 3 kept the skeleton,
 * the club arc and the fault their OLD analysis wrote).
 *
 * Re-analyze forced a new body read and arc for the FIRST swing only. Every other swing kept what an
 * older build had stored, and because it was stored the shot run treated it as final: the body read
 * was skipped, the arc was skipped ("re-tracking gives the same answer"), and the verdict stage minted a
 * fresh "measured" fault for the swing out of the OLD skeleton.
 *
 * Driven through the real run (uploadRun) and the real shot run (shotDetail) on the real store; only
 * the expensive leaves (the cloud read, the pose decode, the tracker) are stubbed. Each stubbed body
 * read is tagged with the code that produced it, so a fault can be traced back to its skeleton.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { runSwingAnalysis, _resetAnalysedForTest } from '../../services/swing/orchestrator/uploadRun';
import { clearAnswered, requestShotDetail, runShotDetail, swingRunKey } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest, liveRun } from '../../services/swing/orchestrator/engine';
import { BODY_READ_VERSION, CLUB_ARC_VERSION } from '../../services/swing/analysisVersion';

type Bio = { frames: { timestampMs: number; keypoints: unknown[]; tag?: string }[]; angle: string };
const bio = (tag: string, at = 1000): Bio => ({ frames: [{ timestampMs: at, keypoints: [], tag }, { timestampMs: at + 1500, keypoints: [], tag }], angle: 'down_the_line' });
const OLD = bio('OLD');
const OLD_ARC = [{ x: 0.1, y: 0.1, tMs: 1 }, { x: 0.2, y: 0.2, tMs: 2 }, { x: 0.3, y: 0.3, tMs: 3 }];
const NEW_ARC = [{ x: 0.6, y: 0.6, tMs: 10 }, { x: 0.7, y: 0.7, tMs: 20 }, { x: 0.8, y: 0.8, tMs: 30 }];

let mockPose: 'new' | 'throw' | 'nobody' = 'new';
const mockPoseCalls: number[] = [];   // the window start (s) each body read was given
let mockArc: 'new' | 'none' = 'new';
let mockArcCalls = 0;
let mockRead: Record<string, unknown> = { primary_issue: { issue_id: 'over_the_top' }, drill_recommendation: null, analyses: {} };

jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/videoUpload', () => ({
  _runPhaseKRead: async () => mockRead,
  resolveClipUri: async (u: string) => u,
}));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 42000, locateSwingWindow: async () => null }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: async (_u: string, _d: number, _a: unknown, _p: unknown, win: { startMs: number } | null) => {
    mockPoseCalls.push(win ? win.startMs / 1000 : -1);
    if (mockPose === 'throw') throw new Error('decoder died');
    if (mockPose === 'nobody') return null;
    const at = win ? win.startMs + 200 : 1000;
    return { frames: [{ timestampMs: at, keypoints: [], tag: 'NEW' }, { timestampMs: at + 1500, keypoints: [], tag: 'NEW' }], angle: 'down_the_line' };
  },
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
// The measured fault names the skeleton it was read from.
jest.mock('../../services/swing/poseSwingRead', () => ({
  buildPoseSwingRead: (b: { frames: { tag?: string }[] }) => ({ tag: b.frames[0]?.tag ?? '?', faults: [{ key: `fault_from_${b.frames[0]?.tag}`, severity: 'moderate', evidence: 'e' }], headline: 'h' }),
}));
jest.mock('../../services/swing/poseReadVerdict', () => ({
  poseReadToPrimaryIssue: (r: { tag: string }) => ({ issue_id: `fault_from_${r.tag}`, primary_fault: `fault_from_${r.tag}`, name: r.tag }),
}));
jest.mock('../../services/swing/clubPath', () => ({
  detectClubPath: async () => {
    mockArcCalls++;
    if (mockArc === 'none') return null;
    return { points: [{ x: 0.6, y: 0.6, tMs: 0 }, { x: 0.7, y: 0.7, tMs: 10 }, { x: 0.8, y: 0.8, tMs: 20 }], source: 'tracker', frameW: 1080, frameH: 1920 };
  },
}));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

const s1 = () => useSwingSessionStore.getState().sessionHistory[0];
const shot = (i: number) => s1().shots[i] as unknown as Record<string, unknown>;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settled = (shotId: string, arc: 'tracker' | false = 'tracker') =>
  new Promise<void>((res) => { requestShotDetail('s1', shotId, { arc, onSettled: res }); });

/** An old 3-swing reel, analyzed by an older build: every swing carries that build's results, unstamped. */
function seedOldReel(status = 'ok') {
  const old = (i: number) => ({
    id: `sh${i}`, club: '7i', clipUri: 'file:///reel.mp4', clipStartSeconds: 2 + i * 10, clipEndSeconds: 6 + i * 10, clipWindowSource: 'auto',
    biomechanics: OLD, club_arc: OLD_ARC, club_arc_frame: { w: 720, h: 1280 }, club_arc_source: 'tracker',
    detected_issue_timestamps_sec: [9.9],
    perShotAnalysis: { detected_issue: 'early_extension', primary_fault: 'early_extension', severity: 'moderate', confidence: 'high', observation: 'old read' },
  });
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: status, club: '7i', upload: { duration_sec: 42 },
      primary_issue: { issue_id: 'early_extension', primary_fault: 'early_extension', name: 'Early extension' },
      drill_recommendation: { drill_id: 'wall' },
      biomechanics: OLD, club_arc: OLD_ARC, club_arc_frame: { w: 720, h: 1280 }, club_arc_source: 'tracker',
      fault_frame_uri: 'file:///old.jpg', fault_frame_index: 2, fault_frame_fraction: 0.5,
      shots: [old(0), old(1), old(2)],
    }] as never,
  });
}

beforeEach(() => {
  _clearRunsForTest();
  _resetAnalysedForTest();
  clearAnswered('s1');   // a new launch: no arc answered yet
  (require('react-native') as { Platform: { OS: string } }).Platform.OS = 'android';
  mockPose = 'new'; mockPoseCalls.length = 0; mockArc = 'new'; mockArcCalls = 0;
  mockRead = { primary_issue: { issue_id: 'over_the_top' }, drill_recommendation: null, analyses: {} };
});
afterEach(() => { _clearRunsForTest(); });

describe('re-analyze runs the current code on EVERY swing of a reel', () => {
  it('a re-analysis clears every swing\'s old body read, arc and fault timing, and the session\'s fault frame', async () => {
    seedOldReel();
    await runSwingAnalysis('s1');
    for (const i of [1, 2]) {
      expect(shot(i).biomechanics).toBeUndefined();
      expect(shot(i).club_arc).toBeUndefined();
      expect(shot(i).club_arc_source).toBeUndefined();
      expect(shot(i).detected_issue_timestamps_sec).toBeUndefined();
    }
    expect(s1().fault_frame_uri ?? null).toBeNull();
    await liveRun(swingRunKey('s1'))?.done;
  });

  it('paging to swing 2 afterwards reads its body and tracks its arc again — its fault comes from the NEW skeleton', async () => {
    seedOldReel();
    await runSwingAnalysis('s1');
    await liveRun(swingRunKey('s1'))?.done;
    mockPoseCalls.length = 0; mockArcCalls = 0;
    await settled('sh1');
    await tick(5);
    expect(mockPoseCalls).toEqual([12]);                         // swing 2's own window, read again
    expect(mockArcCalls).toBe(1);                                // and tracked again
    expect((shot(1).biomechanics as Bio).frames[0].tag).toBe('NEW');
    expect(shot(1).club_arc).not.toEqual(OLD_ARC);
    expect((shot(1).perShotAnalysis as { primary_fault?: string } | null)?.primary_fault).toBe('fault_from_NEW');
  });

  it('a re-analyze that the screen marks pending first is still a re-analysis (onReanalyze flips the status before the run)', async () => {
    seedOldReel('pending');
    await runSwingAnalysis('s1');
    expect(shot(2).biomechanics).toBeUndefined();
    expect(shot(2).club_arc).toBeUndefined();
    await liveRun(swingRunKey('s1'))?.done;
  });
});

describe('an old record never re-analyzed is re-read on demand (an older or missing stamp is unread)', () => {
  it('an unstamped stored body read is read again when the swing is shown, and no fault is minted from the old skeleton', async () => {
    seedOldReel();
    // The read has nothing for swing 2 (so the verdict stage would name it from its skeleton).
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((x) => ({ ...x, shots: x.shots.map((sh) => ({ ...sh, perShotAnalysis: undefined })) })) }) as never);
    await settled('sh1');
    expect(mockPoseCalls).toEqual([12]);
    expect((shot(1).biomechanics as Bio).frames[0].tag).toBe('NEW');
    expect((shot(1).perShotAnalysis as { primary_fault?: string } | null)?.primary_fault).toBe('fault_from_NEW');
    expect(mockArcCalls).toBe(1);                                // an unstamped tracked arc is not final either
  });

  it('a read stamped by today\'s code is final: not read again', async () => {
    seedOldReel();
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((x) => ({ ...x, shots: x.shots.map((sh) => ({
      ...sh, analysis_version: BODY_READ_VERSION, club_arc_version: CLUB_ARC_VERSION,
    })) })) }) as never);
    await settled('sh1');
    expect(mockPoseCalls).toEqual([]);
    expect(mockArcCalls).toBe(0);
  });

  it('a body read today\'s code stores carries today\'s stamp (so it is not read again next time)', async () => {
    seedOldReel();
    await settled('sh1');
    expect(shot(1).analysis_version).toBe(BODY_READ_VERSION);
    expect(shot(1).club_arc_version).toBe(CLUB_ARC_VERSION);
  });

  it('today\'s code finding NOBODY replaces an old build\'s skeleton (the "keep the good read" guard protects only a current one)', async () => {
    seedOldReel();
    mockPose = 'nobody';
    await settled('sh1', false);
    expect(shot(1).biomechanics).toBeNull();
  });
});

describe('a forced run never leaves the previous analysis standing', () => {
  it('a forced body read that throws leaves no old skeleton (shot and session)', async () => {
    seedOldReel();
    mockPose = 'throw';
    await runShotDetail('s1', 'sh0', { force: true, arc: false }).done;
    expect(shot(0).biomechanics).toBeUndefined();
    expect(s1().biomechanics).toBeUndefined();
  });

  it('a forced re-track that gets no answer at all clears the old arc (shot and session)', async () => {
    seedOldReel();
    mockArc = 'none';
    await runShotDetail('s1', 'sh0', { force: true, arc: 'tracker' }).done;
    expect(mockArcCalls).toBe(1);
    expect(shot(0).club_arc ?? null).toBeNull();
    expect(s1().club_arc ?? null).toBeNull();
  });

  it('a NON-forced view whose tracker gets no answer keeps asking later and touches nothing', async () => {
    seedOldReel();
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((x) => ({ ...x, shots: x.shots.map((sh) => ({
      ...sh, biomechanics: bio('NEW'), analysis_version: BODY_READ_VERSION,
    })) })) }) as never);
    mockArc = 'none';
    await settled('sh1');
    expect(shot(1).club_arc).toEqual(OLD_ARC);
  });
});

describe('a failed re-read does not leave the old verdict as the headline', () => {
  it('read fails and the body read finds nothing → failed, and the old headline is gone', async () => {
    seedOldReel('pending');
    mockRead = { primary_issue: null, drill_recommendation: null, analyses: {}, readFailed: 'The read timed out.' };
    mockPose = 'nobody';
    await runSwingAnalysis('s1');
    await liveRun(swingRunKey('s1'))?.done;
    expect(s1().analysis_status).toBe('failed');
    expect(s1().primary_issue ?? null).toBeNull();
    expect(s1().drill_recommendation ?? null).toBeNull();
  });

  it('a ball the camera saw never leave (no_launch) still stands', async () => {
    seedOldReel('pending');
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((x) => ({ ...x, primary_issue: { issue_id: 'no_launch' } })) }) as never);
    mockRead = { primary_issue: null, drill_recommendation: null, analyses: {}, readFailed: 'The read timed out.' };
    mockPose = 'nobody';
    await runSwingAnalysis('s1');
    await liveRun(swingRunKey('s1'))?.done;
    expect(s1().analysis_status).toBe('ok');
    expect((s1().primary_issue as { issue_id?: string } | null)?.issue_id).toBe('no_launch');
  });
});

describe('carving an upload into swings hands none of swing 1\'s results to the others', () => {
  it('expandUploadIntoSwings: no inherited body read, arc, fault timing or review labels; windows are the finder\'s', () => {
    seedOldReel();
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((x) => ({ ...x, shots: [{
      ...x.shots[0], clipWindowSource: 'user', review_labels: { contact: 'fat' }, review_transcript: 'chunked it',
      analysis_version: BODY_READ_VERSION, club_arc_version: CLUB_ARC_VERSION,
    }] })) }) as never);
    useSwingSessionStore.getState().expandUploadIntoSwings('s1', [{ startSec: 1, endSec: 4, impactSec: 3 }, { startSec: 11, endSec: 14, impactSec: 13 }]);
    expect(s1().shots).toHaveLength(2);
    for (const sh of s1().shots as unknown as Record<string, unknown>[]) {
      expect(sh.clipUri).toBe('file:///reel.mp4');
      expect(sh.biomechanics).toBeUndefined();
      expect(sh.club_arc).toBeUndefined();
      expect(sh.club_arc_frame).toBeUndefined();
      expect(sh.club_arc_source).toBeUndefined();
      expect(sh.detected_issue_timestamps_sec).toBeUndefined();
      expect(sh.review_labels).toBeUndefined();
      expect(sh.review_transcript).toBeUndefined();
      expect(sh.analysis_version).toBeUndefined();
      expect(sh.club_arc_version).toBeUndefined();
      expect(sh.clipWindowSource).toBe('auto');
    }
  });
});
