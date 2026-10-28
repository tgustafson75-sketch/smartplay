/**
 * 2026-10-27 (Phase SB6 — recheck E1 of the SB3/SB4 work).
 *
 * Tim re-analyzes an upload whose swing 1 is demoted as practice (no ball seen), on weak or no Wi-Fi: the
 * reads fail. videoUpload's fallbacks already skip a practice swing (firstCountedSwing), but the run's body
 * read stage took `shots.find(x => x.clipUri)` — the practice swing — and, the read having failed, minted the
 * library and detail headline from ITS body (a pose verdict, or "No clear fault" naming it). The swing the
 * app itself marks as practice headlined the analysis.
 *
 * Now the fallback verdict is named from the first swing that counts, and from none when every swing is
 * demoted (the read's failure stands). Driven through the real run, the real shot run and the real store;
 * only the leaves (the read, the pose decode, the verdict, the arc) are mocked.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { runUploadAnalysis } from '../../services/swing/orchestrator/uploadRun';
import { _clearRunsForTest } from '../../services/swing/orchestrator/engine';

const mockPose: { uri: string; release: (bio: unknown) => void }[] = [];
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/swing/analysisOrchestrator', () => ({ findUploadSwingWindow: async () => null }));
jest.mock('../../services/videoUpload', () => ({
  _runPhaseKRead: async () => ({ primary_issue: null, drill_recommendation: null, readFailed: 'No connection.', analyses: {} }),
  resolveClipUri: async (u: string) => u,
}));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 6000, locateSwingWindow: async () => null }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: (uri: string) => new Promise((r) => { mockPose.push({ uri, release: r }); }),
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
// The verdict names the body it was given, so the test can see whose body named the headline.
jest.mock('../../services/swing/poseSwingRead', () => ({ buildPoseSwingRead: (bio: { angle: string }) => ({ who: bio.angle, faults: [] }) }));
let mockVerdicts = true;
jest.mock('../../services/swing/poseReadVerdict', () => ({
  poseReadToPrimaryIssue: (r: { who: string }) => (mockVerdicts ? { issue_id: `fault_from_${r.who}`, name: 'x', detected_in_shots: [] } : null),
}));
jest.mock('../../services/swing/clubPath', () => ({
  detectClubPath: async () => ({ points: [], source: 'tracker', rejected: { reason: 'too_few', detected: 0, gate: 'client' } }),
}));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const s1 = () => useSwingSessionStore.getState().sessionHistory[0];
const bio = (who: string) => ({ frames: [{ timestampMs: 5400, keypoints: [] }, { timestampMs: 7000, keypoints: [] }], angle: who });
const PRACTICE = { reason: 'no_ball_seen' as const };

/** A 42s range upload split into swings (`practice` marks the demoted ones), as a failed read leaves it. */
function seed(practice: boolean[]) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'analyzing_pose', club: '7i', upload: { duration_sec: 42 },
      primary_issue: { issue_id: 'old_headline', detected_in_shots: ['s1_shot_1'] },
      shots: practice.map((p, i) => ({
        id: `s1_shot_${i}`, clipUri: `file:///swing${i}.mp4`, clipStartSeconds: 0, clipEndSeconds: 3, ...(p ? { practice: PRACTICE } : {}),
      })),
    }] as never,
  });
}

/** Answer every body read asked for with a body named after its clip, until the run settles. */
async function answerBodyReads() {
  for (let i = 0; i < 20; i++) {
    await tick(5);
    for (const p of mockPose.splice(0)) p.release(bio(p.uri.replace('file:///', '').replace('.mp4', '')));
  }
}

beforeEach(() => { mockPose.length = 0; mockVerdicts = true; _clearRunsForTest(); });

describe('a practice swing never names the verdict when the read fails', () => {
  it('THE REPORT: swing 1 demoted, the read fails — the body verdict is swing 2\'s, and names swing 2', async () => {
    seed([true, false, false]);
    await runUploadAnalysis('s1');
    await answerBodyReads();
    expect(s1().analysis_status).toBe('ok');
    expect(s1().primary_issue?.issue_id).toBe('fault_from_swing1');
    expect(s1().primary_issue?.detected_in_shots).toEqual(['s1_shot_1']);
    // swing 1's skeleton is still read, for show
    expect(s1().shots[0].biomechanics).toEqual(bio('swing0'));
  });

  it('"No clear fault" names the counted swing too, never the practice swing', async () => {
    mockVerdicts = false;
    seed([true, false]);
    await runUploadAnalysis('s1');
    await answerBodyReads();
    expect(s1().primary_issue?.issue_id).toBe('no_clear_fault');
    expect(s1().primary_issue?.detected_in_shots).toEqual(['s1_shot_1']);
  });

  it('every swing demoted: no body verdict — the read\'s failure stands', async () => {
    seed([true, true]);
    await runUploadAnalysis('s1');
    await answerBodyReads();
    expect(s1().analysis_status).toBe('failed');
    expect(s1().analysis_error).toBe('No connection.');
    expect(s1().primary_issue ?? null).toBeNull();
  });

  it('guard: swing 1 counts — its body names the verdict, as before', async () => {
    seed([false, false]);
    await runUploadAnalysis('s1');
    await answerBodyReads();
    expect(s1().primary_issue?.issue_id).toBe('fault_from_swing0');
    expect(s1().primary_issue?.detected_in_shots).toEqual(['s1_shot_0']);
  });
});
