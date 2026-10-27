/**
 * 2026-10-27 (Tim: "Tapping Issue did not highlight the area") — the ring is drawn from the body read. Swings
 * saved before 421750aa carry a stored EMPTY body read (null, or no frames), and the shot run treated a stored
 * value as answered, so asking never read the swing again: no frames, no ring, for good.
 *
 * Since SB3a every stored read carries the code version that made it (analysisVersion); an unstamped one is
 * unread. This drives the real shot run on the real store, through the exact request the swing screen now
 * makes when the player taps Issue on swing 1 with everything else off (faultSpotlight.shotDetailRequestFor),
 * and checks the old empty read is replaced — while a TODAY'S empty read stays answered (no decode on every tap).
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { requestShotDetail, clearAnswered } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest } from '../../services/swing/orchestrator/engine';
import { _resetAnalysedForTest } from '../../services/swing/orchestrator/uploadRun';
import { BODY_READ_VERSION } from '../../services/swing/analysisVersion';
import { shotDetailRequestFor } from '../../services/swing/faultSpotlight';

let mockPoseCalls = 0;
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/videoUpload', () => ({
  _runPhaseKRead: async () => ({ primary_issue: null, drill_recommendation: null, analyses: {} }),
  resolveClipUri: async (u: string) => u,
}));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 42000, locateSwingWindow: async () => null }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: async (_u: string, _d: number, _a: unknown, _p: unknown, win: { startMs: number } | null) => {
    mockPoseCalls++;
    const at = win ? win.startMs + 200 : 1000;
    return { frames: [{ timestampMs: at, keypoints: [] }, { timestampMs: at + 1500, keypoints: [] }], angle: 'down_the_line' };
  },
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
jest.mock('../../services/swing/poseSwingRead', () => ({ buildPoseSwingRead: () => ({ faults: [], headline: 'h' }) }));
jest.mock('../../services/swing/poseReadVerdict', () => ({ poseReadToPrimaryIssue: () => null }));
jest.mock('../../services/swing/clubPath', () => ({ detectClubPath: async () => null }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

const shot0 = () => useSwingSessionStore.getState().sessionHistory[0].shots[0] as unknown as { biomechanics?: { frames: unknown[] } | null };

function seed(biomechanics: unknown, stamp?: number) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i', upload: { duration_sec: 42 },
      primary_issue: { issue_id: 'early_extension', primary_fault: 'early_extension', name: 'Early extension' },
      shots: [{
        id: 'sh0', club: '7i', clipUri: 'file:///old.mp4', clipStartSeconds: 2, clipEndSeconds: 6,
        biomechanics, ...(stamp != null ? { analysis_version: stamp } : {}),
        perShotAnalysis: { detected_issue: 'early_extension', primary_fault: 'early_extension', severity: 'moderate', confidence: 'high', observation: 'o' },
      }],
    }] as never,
  });
}

/** The exact request the swing screen makes for an Issue tap on swing 1 with Body / Trace off. */
const askForIssue = () => new Promise<void>((res) => {
  const ask = shotDetailRequestFor({ idx: 0, showSkeleton: false, traceAsked: false, issueAsked: true });
  expect(ask).not.toBeNull();
  requestShotDetail('s1', 'sh0', { ...ask!, onSettled: res });
});

beforeEach(() => {
  _clearRunsForTest(); _resetAnalysedForTest(); clearAnswered('s1'); mockPoseCalls = 0;
});
afterEach(() => { _clearRunsForTest(); });

describe('asking to see the issue reads an old empty body read again', () => {
  it('stored null by an older build: read again, frames land', async () => {
    seed(null);
    await askForIssue();
    expect(mockPoseCalls).toBe(1);
    expect(shot0().biomechanics?.frames.length).toBe(2);
  });
  it('stored { frames: [] } by an older build: read again, frames land', async () => {
    seed({ frames: [], angle: 'down_the_line' });
    await askForIssue();
    expect(mockPoseCalls).toBe(1);
    expect(shot0().biomechanics?.frames.length).toBe(2);
  });
  it("today's empty read is an answer: no decode on every tap (the screen says 'No body read — Re-analyze')", async () => {
    seed(null, BODY_READ_VERSION);
    await askForIssue();
    expect(mockPoseCalls).toBe(0);
    expect(shot0().biomechanics).toBeNull();
  });
});
