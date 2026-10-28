/**
 * 2026-10-27 (Phase SB7, recheck R9 "trace-note-false-no-clubhead") — Tim's defect-2 route: open an old
 * library swing 1, tap Issue (the body read only, arc: false), then turn on Swing Trace (arc: true) while
 * that read is out. runShotDetail hands back the LIVE body-only run and queues the arc run after it; the
 * request settled on the body-only run, so the screen's pending flag cleared before the arc was traced and
 * swingTraceNote said "The clubhead could not be seen in this swing" (with a Re-analyze) for nothing.
 *
 * A request settles only on a run that answers its level. Driven through the real shot run on the real
 * store; only the leaves (clip copy, duration probe, the body read, the tracker) are stubbed.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { clearAnswered, requestShotDetail, shotRunKey } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest, liveRun } from '../../services/swing/orchestrator/engine';
import { swingTraceNote } from '../../services/swing/overlayVisibility';

const mockReads: ((v: unknown) => void)[] = [];
const mockArcs: ((v: unknown) => void)[] = [];
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/videoUpload', () => ({ resolveClipUri: async (u: string) => u }));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 12_000, locateSwingWindow: async () => null }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: () => new Promise((resolve) => { mockReads.push(resolve); }),
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
jest.mock('../../services/swing/clubPath', () => ({
  detectClubPath: () => new Promise((resolve) => { mockArcs.push(resolve); }),
}));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));
jest.mock('../../services/capture/clipFps', () => ({ sessionCapturedFps: () => 30 }));

const SID = 'old_swing_1';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const read = { frames: [{ timestampMs: 1000, keypoints: [] }, { timestampMs: 2500, keypoints: [] }], angle: 'down_the_line', metric_confidence: {} };
const arc = { points: [{ x: 0.6, y: 0.6, tMs: 0 }, { x: 0.7, y: 0.7, tMs: 10 }, { x: 0.8, y: 0.8, tMs: 20 }], source: 'tracker', frameW: 1080, frameH: 1920 };
const shot = () => useSwingSessionStore.getState().sessionHistory[0].shots[0];

beforeEach(() => {
  mockReads.length = 0;
  mockArcs.length = 0;
  _clearRunsForTest();
  clearAnswered(SID);
  (require('react-native') as { Platform: { OS: string } }).Platform.OS = 'android';
  // An old library swing: nothing today's code stored, so the body read runs when it is asked.
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: SID, source: 'uploaded_video', analysis_status: 'ok', club: '7i', upload: { duration_sec: 12 },
      shots: [{ id: 'sh0', club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: 0, clipEndSeconds: 3 }],
    }] as never,
  });
});

afterEach(() => { liveRun(shotRunKey(SID, 'sh0'))?.cancel(); });

describe('Swing Trace turned on while Issue\'s body read is out', () => {
  it('the trace request settles only once its own arc run has answered', async () => {
    const issueSettled = jest.fn();
    const traceSettled = jest.fn();
    requestShotDetail(SID, 'sh0', { arc: false, onSettled: issueSettled });   // tap Issue
    await tick(10);
    expect(mockReads).toHaveLength(1);
    requestShotDetail(SID, 'sh0', { arc: true, onSettled: traceSettled });    // then turn on Trace
    await tick(10);
    mockReads[0](read);                                                       // the body read lands
    await tick(30);
    expect(issueSettled).toHaveBeenCalledTimes(1);
    expect(shot().biomechanics).toBeTruthy();
    // The follow-up run is tracing the arc: the trace request is still pending, so the screen must not
    // read "no arc yet" as "the clubhead could not be seen".
    expect(mockArcs).toHaveLength(1);
    expect(traceSettled).not.toHaveBeenCalled();
    mockArcs[0](arc);
    await tick(30);
    expect(traceSettled).toHaveBeenCalledTimes(1);
    expect(shot().club_arc).toHaveLength(3);
  });

  it('the note the library shows while that arc is traced is not "no clubhead"', async () => {
    let pending = true;
    requestShotDetail(SID, 'sh0', { arc: false });
    await tick(10);
    requestShotDetail(SID, 'sh0', { arc: true, onSettled: () => { pending = false; } });
    await tick(10);
    mockReads[0](read);
    await tick(30);
    const note = swingTraceNote({ wanted: true, drawn: false, pending, hasArc: !!shot().club_arc?.length, hasBody: !!shot().biomechanics, settled: false });
    expect(note).not.toBe('no_clubhead');
    expect(note).not.toBe('no_trace');
    mockArcs[0](arc);
    await tick(30);
  });
});
