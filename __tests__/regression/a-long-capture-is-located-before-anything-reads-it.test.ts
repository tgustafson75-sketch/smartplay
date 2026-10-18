/**
 * 2026-10-17 — Tim's range session, 1792271029197_ndibo6_cage: a 60s driver capture whose strike was
 * never heard. SmartMotion's live finder gave up at its 15s ceiling and stored the whole clip as the
 * swing (`smartmotion capture · window=0.0-59.8s strike=guessed`). The run had no window stage for a
 * live capture, so the read got nine frames over a minute and the body read twenty
 * (`pose frames · requested=20 got=19 window=0-59817ms`), and that body read named the verdict.
 *
 * Now a stored window longer than one swing is not a window: the run finds the swing before anything
 * reads it, and when nothing is found it says so — nothing reads 0–60s. These drive the real engine, the
 * real run and the real shot run; only the expensive leaves are mocked.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { runSwingAnalysis } from '../../services/swing/orchestrator/uploadRun';
import { requestShotDetail, shotRunKey, swingRunKey } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest, liveRun } from '../../services/swing/orchestrator/engine';
import { _resetAnalysisTracesForTest } from '../../services/analysisTrace';

const mockOrder: string[] = [];
const mockReadWindows: unknown[] = [];
const mockPoseWindows: unknown[] = [];
let mockFound: Record<string, unknown> | 'hang' = { via: 'middle', startSec: 27.4, endSec: 32.9, impactSec: null };
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/swing/analysisOrchestrator', () => ({
  findUploadSwingWindow: async () => { mockOrder.push('window'); return mockFound === 'hang' ? new Promise(() => undefined) : mockFound; },
}));
jest.mock('../../services/videoUpload', () => ({
  _runPhaseKRead: async (sid: string) => {
    mockOrder.push('read');
    const sh = (require('../../store/swingSessionStore') as typeof import('../../store/swingSessionStore'))
      .useSwingSessionStore.getState().sessionHistory.find((s) => s.id === sid)?.shots[0];
    mockReadWindows.push([sh?.clipStartSeconds, sh?.clipEndSeconds]);
    return { primary_issue: null, drill_recommendation: null, readFailed: 'snag', analyses: {} };
  },
  resolveClipUri: async (u: string) => u,
}));
jest.mock('../../services/poseDetection', () => ({
  probeDurationMs: async () => 59_817,
  locateSwingWindow: async () => null,
}));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: async (_u: string, _d: number, _a: unknown, _t: unknown, window: unknown) => {
    mockOrder.push('pose'); mockPoseWindows.push(window);
    return { frames: [{ timestampMs: 42_000, keypoints: [] }, { timestampMs: 42_500, keypoints: [] }], angle: 'face_on' };
  },
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
jest.mock('../../services/swing/poseSwingRead', () => ({ buildPoseSwingRead: () => ({}) }));
jest.mock('../../services/swing/poseReadVerdict', () => ({ poseReadToPrimaryIssue: () => ({ issue_id: 'pose_lead_arm_bent', name: 'Lead arm bent' }) }));
jest.mock('../../services/swing/clubPath', () => ({ detectClubPath: async () => null }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

const SID = '1792271029197_ndibo6_cage';
const SHOT = '1792271029197_k2x9q1_cage_shot';
/** What the player is told (uploadRun NO_SWING_FOUND). */
const NO_SWING = /couldn't find a swing in this clip/;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const s1 = () => useSwingSessionStore.getState().sessionHistory[0];

/** The field capture as SmartMotion saved it: one live shot, its "window" the whole 59.8s clip. */
const seedFieldCapture = () => useSwingSessionStore.setState({
  activeSession: null,
  sessionHistory: [{ id: '1792271029197_ndibo6_cage', source: 'live_capture', analysis_status: 'pending', club: 'driver',
    upload: { duration_sec: null },
    shots: [{ id: '1792271029197_k2x9q1_cage_shot', clipUri: 'file:///rec-60s.mp4', clipStartSeconds: 0, clipEndSeconds: 59.817, clipWindowSource: 'auto' }] }] as never,
});

// Stop every run left going (a body read that never ends holds its budget timer open).
afterEach(() => {
  liveRun(shotRunKey(SID, SHOT))?.cancel(); liveRun(swingRunKey(SID))?.cancel();
  _resetAnalysisTracesForTest();
});

beforeEach(() => {
  mockOrder.length = 0; mockReadWindows.length = 0; mockPoseWindows.length = 0;
  _clearRunsForTest();
  (require('react-native') as { Platform: { OS: string } }).Platform.OS = 'android';
});

describe('a capture whose window is the whole minute is located before it is read', () => {
  it('the swing is found first; the read and the body read see a swing-sized window, never 0–60s', async () => {
    mockFound = { via: 'on_device', startSec: 41.4, endSec: 44.4, impactSec: 42.42 };
    seedFieldCapture();
    await runSwingAnalysis(s1().id, { angle: 'face_on' });
    await tick(20);
    expect(mockOrder.slice(0, 2)).toEqual(['window', 'read']);
    expect(mockReadWindows[0]).toEqual([41.4, 44.4]);
    expect(mockPoseWindows).toEqual([{ startMs: 41_400, endMs: 44_400 }]);
  });

  it('nothing found in a minute: said honestly — no read, no body read, no verdict from frames across the minute', async () => {
    mockFound = { via: 'middle', startSec: 27.4, endSec: 32.9, impactSec: null };
    seedFieldCapture();
    const read = await runSwingAnalysis(s1().id, { angle: 'face_on' });
    await tick(20);
    expect(mockOrder).toEqual(['window']);
    expect(read.readFailed).toMatch(NO_SWING);
    expect(s1().analysis_status).toBe('failed');
    expect(s1().analysis_error).toMatch(NO_SWING);
    expect(s1().primary_issue?.issue_id).not.toBe('pose_lead_arm_bent');
    // and the screen that shows this swing afterwards does not body-read the minute either
    requestShotDetail(s1().id, s1().shots[0].id, { arc: 'tracker' });
    await tick(20);
    expect(mockPoseWindows).toEqual([]);
  });
});

describe('the body read never reads a stored window longer than a swing', () => {
  it('a screen asking for that shot locates it, and with nothing found reads nothing', async () => {
    seedFieldCapture();
    requestShotDetail(s1().id, s1().shots[0].id, { arc: 'tracker' });
    await tick(20);
    expect(mockPoseWindows).toEqual([]);           // before: [{ startMs: 0, endMs: 59817 }]
    expect(s1().shots[0].biomechanics).toBeNull();  // computed, none — not asked again
  });

  it('a window the PLAYER chose is read as chosen, however long', async () => {
    seedFieldCapture();
    useSwingSessionStore.getState().setShotClipBoundaries(s1().id, s1().shots[0].id, 10, 22, null, 'user');
    requestShotDetail(s1().id, s1().shots[0].id, { arc: 'tracker' });
    await tick(20);
    expect(mockPoseWindows).toEqual([{ startMs: 10_000, endMs: 22_000 }]);
  });
});

/**
 * 2026-10-17 (review of F2a) — the no-swing message tells the player to "scrub to your swing and tap Analyze
 * the swing at that moment", and SmartMotion's review had no such button: its refresh re-read the same
 * whole-clip segment and failed again. The button now exists there, and the moment it sends is read.
 */
describe('the way out of "no swing found" is the moment the player points at', () => {
  it('a user moment after a failed find is read as a swing around it — no second find, the body read names it', async () => {
    mockFound = { via: 'middle', startSec: 27.4, endSec: 32.9, impactSec: null };
    seedFieldCapture();
    await runSwingAnalysis(s1().id, { angle: 'face_on' });
    await tick(20);
    expect(s1().analysis_error).toMatch(NO_SWING);
    mockOrder.length = 0;
    // what SmartMotion's analyzeAtMoment saves: 2.5s before / 3s after the scrubbed 41.7s (the library's numbers), the player's own
    useSwingSessionStore.getState().setShotClipBoundaries(s1().id, s1().shots[0].id, 39.2, 44.7, 41.7, 'user');
    await runSwingAnalysis(s1().id, { angle: 'face_on' });
    await tick(30);
    expect(mockOrder).toEqual(['read', 'pose']);
    expect(mockReadWindows.at(-1)).toEqual([39.2, 44.7]);
    expect(mockPoseWindows.at(-1)).toEqual({ startMs: 39_200, endMs: 44_700 });
    expect(s1().analysis_status).toBe('ok');
  });

  it('SmartMotion review offers it on that message and saves the moment as the player\'s window', () => {
    // Source check: the screen has no render harness (camera, 7,000 lines).
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app/swinglab/smartmotion.tsx'), 'utf8') as string;
    expect(src).toMatch(/if \(analysisError === NO_SWING_FOUND && segments\.length <= 1\) \{[\s\S]{0,900}onPress=\{analyzeAtMoment\}/);
    expect(src).toMatch(/Math\.min\(videoDurationMs, center \+ 3000\) : center \+ 3000;/);
    expect(src).toMatch(/startMs: Math\.max\(0, center - 2500\)/);
    expect(src).toMatch(/void runAnalysis\(clipUri, seg, \{ reuseSessionId: ingestedSessionIdRef\.current, userMomentSec: center \/ 1000 \}\);/);
    expect(src).toMatch(/userMoment \?\? \(heard \? segment\.strikeMs \/ 1000 : undefined\), userMoment != null \? 'user' : 'auto'\);/);
  });
});

/** 2026-10-17 (review of F2a) — the window stage overrunning its budget must not hand the read the minute. */
describe('a window stage that never answers', () => {
  it('reads nothing: the read runs after the window, not on it, and the minute is not a swing', async () => {
    mockFound = 'hang';
    seedFieldCapture();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const p = runSwingAnalysis(s1().id, { angle: 'face_on' });
      await jest.advanceTimersByTimeAsync(95_000);   // past the window stage's 90s budget
      const read = await p;
      await jest.advanceTimersByTimeAsync(10_000);
      expect(mockOrder).toEqual(['window']);
      expect(mockReadWindows).toEqual([]);
      expect(mockPoseWindows).toEqual([]);
      expect(read.readFailed).toMatch(NO_SWING);
      expect(s1().analysis_error).toMatch(NO_SWING);
    } finally { jest.useRealTimers(); }
  });
});
