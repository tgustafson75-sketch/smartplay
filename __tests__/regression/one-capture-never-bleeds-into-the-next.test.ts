/**
 * 2026-10-17 — Tim's range session, two captures two minutes apart:
 *   1792269387918_369ror_cage  a 3.8s clip with nobody in shot; its body read ran to
 *                              `shot pose: failed · ms=120022 error=budget`
 *   1792269503604_svr3zw_cage  the next capture — whose report carried the first one's
 *                              `pose frames … window=0-3832ms` and that budget failure as its own.
 *
 * Three defects, one shape: (1) nothing retired the first capture's body read when the next capture
 * started, so it kept the decoder through the second analysis; (2) a trace step went to EVERY open trace,
 * so the first session's steps landed in the second's report; (3) the trace named every shot by the
 * last six characters of its id, and every live capture's shot id ends in `cage_shot` — both read `e_shot`.
 * The run keys themselves use the full ids (no collision there).
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { useIssueLogStore } from '../../store/issueLogStore';
import { runSwingAnalysis, RETIRED_POSE_WAIT_MS } from '../../services/swing/orchestrator/uploadRun';
import { requestShotDetail, shotRunKey, swingRunKey } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest, liveRun } from '../../services/swing/orchestrator/engine';
import { traceStep, _resetAnalysisTracesForTest } from '../../services/analysisTrace';

const A = { id: '1792269387918_369ror_cage', shot: '1792269387918_aaa111_cage_shot', clip: 'file:///docs/rec-a-3832.mp4' };
const B = { id: '1792269503604_svr3zw_cage', shot: '1792269503604_bbb222_cage_shot', clip: 'file:///docs/rec-b-4100.mp4' };
// A real swing in shot, captured between A and B (and N: the newest capture, whose body read is still going).
const C = { id: '1792269450000_ccc333_cage', shot: '1792269450000_ccc333_cage_shot', clip: 'file:///docs/rec-c-4000.mp4' };
const N = { id: '1792269999999_nnn444_cage', shot: '1792269999999_nnn444_cage_shot', clip: 'file:///docs/rec-a-n.mp4' };

const mockPoseCalls: string[] = [];
const mockHoldReads = new Set<string>();
const mockSlowReads: Record<string, () => void> = {};
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/swing/analysisOrchestrator', () => ({ findUploadSwingWindow: async () => ({ via: 'middle', startSec: 0, endSec: 1, impactSec: null }) }));
jest.mock('../../services/videoUpload', () => ({
  // A read can be held open per session (a slow link) — mockSlowReads[sessionId] resolves it.
  _runPhaseKRead: (sid: string) => new Promise((resolve) => {
    const failed = { primary_issue: null, drill_recommendation: null, readFailed: 'snag', analyses: {} };
    if (mockHoldReads.has(sid)) mockSlowReads[sid] = () => resolve(failed); else resolve(failed);
  }),
  resolveClipUri: async (u: string) => u,
}));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 3832, locateSwingWindow: async () => null }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({
  // The first capture's body read is the one that never ends (an empty tee box, frame after frame).
  analyzeSwingFromVideo: (uri: string) => {
    mockPoseCalls.push(uri);
    if (uri.includes('rec-a')) return new Promise(() => undefined);
    // A real swing, in shot: a body read with frames.
    if (uri.includes('rec-c')) return Promise.resolve({ frames: [{ timestampMs: 1000, keypoints: [] }], angle: 'face_on' });
    return Promise.resolve(null);
  },
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
jest.mock('../../services/swing/poseSwingRead', () => ({ buildPoseSwingRead: () => ({}) }));
jest.mock('../../services/swing/poseReadVerdict', () => ({ poseReadToPrimaryIssue: () => null }));
jest.mock('../../services/swing/clubPath', () => ({ detectClubPath: async () => null }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const sess = (x: typeof A) => ({ id: x.id, source: 'live_capture', analysis_status: 'pending', club: 'driver', upload: { duration_sec: null },
  shots: [{ id: x.shot, clipUri: x.clip, clipStartSeconds: 0, clipEndSeconds: 3.832, clipWindowSource: 'auto' }] });

// Stop every run left going (a body read that never ends holds its budget timer open).
afterEach(() => {
  for (const x of [A, B, C, N]) { liveRun(shotRunKey(x.id, x.shot))?.cancel(); liveRun(swingRunKey(x.id))?.cancel(); }
  _resetAnalysisTracesForTest();
});

beforeEach(() => {
  mockPoseCalls.length = 0;
  mockHoldReads.clear();
  require('../../services/swing/orchestrator/uploadRun')._resetAnalysedForTest?.();
  _clearRunsForTest();
  _resetAnalysisTracesForTest();
  useIssueLogStore.setState({ entries: [] } as never);
  (require('react-native') as { Platform: { OS: string } }).Platform.OS = 'android';
  useSwingSessionStore.setState({ activeSession: null, sessionHistory: [sess(A), sess(B), sess(C), sess(N)] as never });
});

describe('a new capture retires the one before it', () => {
  it("the first capture's body read is cancelled when the next capture's analysis starts — and not restarted", async () => {
    await runSwingAnalysis(A.id);
    await tick(10);
    expect(liveRun(shotRunKey(A.id, A.shot))).not.toBeNull();   // decoding an empty tee box
    // SmartMotion's review is still showing that swing when the next capture is analysed.
    requestShotDetail(A.id, A.shot, { arc: 'tracker' });
    await runSwingAnalysis(B.id);
    await tick(20);
    expect(liveRun(shotRunKey(A.id, A.shot))).toBeNull();
    expect(mockPoseCalls.filter((u) => u === A.clip)).toHaveLength(1);   // never started again
    // and the first capture still settles: its read's failure, once — not a spinner
    expect(useSwingSessionStore.getState().sessionHistory.find((s) => s.id === A.id)?.analysis_status).toBe('failed');
  });

  it('an UPLOAD analysing in the background is not retired by a capture', async () => {
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((s) => (s.id === A.id ? { ...s, source: 'uploaded_video', upload: { duration_sec: 3.8 } } : s)) }) as never);
    await runSwingAnalysis(A.id);
    await tick(10);
    await runSwingAnalysis(B.id);
    await tick(20);
    expect(liveRun(shotRunKey(A.id, A.shot))).not.toBeNull();
  });
});

describe("one session's steps never land in another session's report", () => {
  it("the first capture's late pose frames and its shot failure stay out of the next capture's trace", async () => {
    await runSwingAnalysis(A.id);
    await tick(10);
    await runSwingAnalysis(B.id);
    // The first capture's extraction reports late, while the second's trace is open.
    // (cast: the same call the extractor makes; compiles against the pre-fix two-argument signature too)
    (traceStep as (...a: unknown[]) => void)('pose frames', { requested: 20, got: 0, window: '0-3832ms' }, { clipUri: A.clip });
    await tick(20);
    const b = useIssueLogStore.getState().entries
      .filter((x) => x.kind === 'analysis_trace')
      .map((x) => (x.details?.timeline as string[]).join('\n'))
      .find((t) => t.includes('bbb222'));
    expect(b).toBeDefined();
    expect(b).not.toMatch(/window=0-3832ms/);
    expect(b).not.toMatch(/aaa111/);
    expect(b).not.toMatch(/shot=e_shot/);   // every shot used to be named by its id's constant tail
  });
});


/**
 * 2026-10-17 (review of F2a) — retiring must not cost a capture its verdict, and only a NEW capture retires,
 * and only captures older than it.
 */
describe('retirement never strands a verdict, and only a newer capture retires', () => {
  const status = (id: string) => useSwingSessionStore.getState().sessionHistory.find((s) => s.id === id)?.analysis_status;

  it('a real swing retired while its slow read is still out still gets its body-read verdict', async () => {
    mockHoldReads.add(C.id);
    void runSwingAnalysis(C.id);                 // the read is out on a slow link
    await tick(10);
    await runSwingAnalysis(B.id);                // the player records the next swing: C is retired
    await tick(20);
    mockSlowReads[C.id]();                       // C's read finally fails
    await tick(50);
    expect(mockPoseCalls).toContain(C.clip);     // its body read ran (after B's)
    expect(status(C.id)).toBe('ok');             // and named the verdict — not 'failed' for good
    expect(useSwingSessionStore.getState().sessionHistory.find((s) => s.id === C.id)?.primary_issue?.issue_id).toBe('no_clear_fault');
  });

  // Review of S2e: the wait for the newer capture's body read had no cap of its own — a newer read that
  // never answers held this one for the whole doubled budget, and then failed it on 'budget'.
  it("a retired swing's body read waits for the newer one at most RETIRED_POSE_WAIT_MS, then decodes anyway", async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      mockHoldReads.add(C.id);
      void runSwingAnalysis(C.id);
      await jest.advanceTimersByTimeAsync(10);
      void runSwingAnalysis(N.id);               // newer capture: its body read never answers
      await jest.advanceTimersByTimeAsync(20);
      mockSlowReads[C.id]();
      await jest.advanceTimersByTimeAsync(RETIRED_POSE_WAIT_MS - 1_000);
      expect(mockPoseCalls).not.toContain(C.clip);   // still waiting its turn
      await jest.advanceTimersByTimeAsync(2_000);
      expect(mockPoseCalls).toContain(C.clip);       // the cap passed: it decodes
      await jest.advanceTimersByTimeAsync(50);
      expect(status(C.id)).toBe('ok');
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-analysing an older swing does not retire the capture just recorded', async () => {
    await runSwingAnalysis(C.id);                // C's own capture run
    await tick(30);
    await runSwingAnalysis(N.id);                // the newest capture: its body read is decoding
    await tick(10);
    expect(liveRun(shotRunKey(N.id, N.shot))).not.toBeNull();
    await runSwingAnalysis(C.id);                // the player re-analyses C from the library
    await tick(10);
    expect(liveRun(shotRunKey(N.id, N.shot))).not.toBeNull();
  });

  it("an older capture's first analysis this launch does not retire a newer one", async () => {
    await runSwingAnalysis(N.id);
    await tick(10);
    await runSwingAnalysis(C.id);
    await tick(10);
    expect(liveRun(shotRunKey(N.id, N.shot))).not.toBeNull();
  });
});
