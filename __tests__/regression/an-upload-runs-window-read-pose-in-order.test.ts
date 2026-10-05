/**
 * 2026-10-04 — Phase 1 of the SmartMotion orchestrator: every upload / library analysis is ONE run —
 * window → read → pose — whoever starts it (swing screen, trim, Analyze-at-position, practice overlay,
 * ingest). Pins the order, the 15s multi-swing rule, and that the caller gets the read without waiting
 * for pose.
 *
 * 2026-10-05 — the run is THE run for every saved swing (SmartMotion and the cage summary too), and its
 * body read is the shot run's (services/swing/orchestrator/shotDetail). These drive the real engine,
 * the real run and the real shot run; only the expensive leaves (the read, the pose decode, the arc) are
 * mocked.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { runSwingAnalysis, runUploadAnalysis } from '../../services/swing/orchestrator/uploadRun';
import { _clearRunsForTest } from '../../services/swing/orchestrator/engine';

const mockOrder: string[] = [];
let mockPoseRelease: ((bio: unknown) => void)[] = [];
let mockKind = 'full_swing';
let mockReadResult: Record<string, unknown> = { primary_issue: { issue_id: 'over_the_top' }, drill_recommendation: null, analyses: {} };
let mockReadThrows = false;
let mockPoseVerdict: unknown = null;
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => mockKind }));
jest.mock('../../services/swing/analysisOrchestrator', () => ({
  findUploadSwingWindow: async () => { mockOrder.push('window'); return { startSec: 5.3, endSec: 7.9, impactSec: null, via: 'motion' }; },
}));
jest.mock('../../services/videoUpload', () => ({
  _runPhaseKRead: async () => {
    mockOrder.push('read');
    if (mockReadThrows) throw new Error('boom');
    return mockReadResult;
  },
  resolveClipUri: async (u: string) => u,
}));
jest.mock('../../services/poseDetection', () => ({
  probeDurationMs: async () => 9000,
  locateSwingWindow: async () => null,
}));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: () => new Promise((r) => { mockOrder.push('pose'); mockPoseRelease.push(r); }),
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,   // the store's persist step
}));
jest.mock('../../services/swing/poseSwingRead', () => ({ buildPoseSwingRead: () => ({}) }));
jest.mock('../../services/swing/poseReadVerdict', () => ({ poseReadToPrimaryIssue: () => mockPoseVerdict }));
jest.mock('../../services/swing/clubPath', () => ({
  detectClubPath: async () => { mockOrder.push('arc'); return { points: [], source: 'tracker', rejected: { reason: 'too_few', detected: 0, gate: 'client' } }; },
}));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

const BIO = { frames: [{ timestampMs: 5400, keypoints: [] }, { timestampMs: 7000, keypoints: [] }], angle: 'down_the_line' };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const s1 = () => useSwingSessionStore.getState().sessionHistory[0];

const seed = (dur: number, source = 'uploaded_video') => useSwingSessionStore.setState({
  activeSession: null,
  sessionHistory: [{ id: 's1', source, analysis_status: 'pending', upload: { duration_sec: dur },
    shots: [{ id: 'sh1', clipUri: 'file:///c.mp4' }] }] as never,
});

beforeEach(() => {
  mockOrder.length = 0; mockPoseRelease = []; mockKind = 'full_swing'; mockReadThrows = false; mockPoseVerdict = null;
  _clearRunsForTest();
  mockReadResult = { primary_issue: { issue_id: 'over_the_top' }, drill_recommendation: null, analyses: {} };
});

describe('a swing runs window → read → body → arc, once', () => {
  it('a single-swing upload finds its window first, then reads; the caller gets the read before the body read ends', async () => {
    seed(6);
    const read = await runUploadAnalysis('s1');
    expect(read.primary_issue).toEqual({ issue_id: 'over_the_top' });
    expect(mockOrder.slice(0, 2)).toEqual(['window', 'read']);
    expect([s1().shots[0].clipStartSeconds, s1().shots[0].clipEndSeconds]).toEqual([5.3, 7.9]);
    await tick();
    expect(mockOrder).toContain('pose');          // the body read started after the read, still running
    mockPoseRelease[0]?.(BIO);
    await tick(10);
    expect(s1().biomechanics).toEqual(BIO);       // the session's (first swing) and the shot's
    expect(s1().shots[0].biomechanics).toEqual(BIO);
    expect(mockOrder).toContain('arc');           // and the arc came after it, from its frames
    expect(mockOrder.indexOf('arc')).toBeGreaterThan(mockOrder.indexOf('pose'));
  });

  it('a 15s+ upload skips the window — the read splits a range session into its swings', async () => {
    seed(42);
    await runUploadAnalysis('s1');
    expect(mockOrder[0]).toBe('read');
    expect(mockOrder).not.toContain('window');
  });

  it('a SmartMotion capture is the same run (no window stage: the capture already found the swing)', async () => {
    seed(6, 'live_capture');
    await runSwingAnalysis('s1', { angle: 'face_on' });
    expect(mockOrder[0]).toBe('read');
    expect(mockOrder).not.toContain('window');
  });

  it('two triggers for the same swing share one run', async () => {
    seed(6);
    await Promise.all([runUploadAnalysis('s1'), runUploadAnalysis('s1')]);
    expect(mockOrder.filter((x) => x === 'read')).toHaveLength(1);
  });

  /**
   * 2026-10-04 (sweep) — once the read has settled the live run is only its body tail. A new request
   * must get a NEW read, and the old body read must not write over the new one.
   */
  it('a trigger AFTER the read settled starts a fresh read, and the old body read writes nothing', async () => {
    seed(42);
    await runUploadAnalysis('s1');
    await tick();
    expect(mockPoseRelease).toHaveLength(1);
    await runUploadAnalysis('s1');
    expect(mockOrder.filter((x) => x === 'read')).toHaveLength(2);
    mockPoseRelease[0]({ ...BIO, angle: 'STALE' });   // the superseded decode finishes late
    await tick(10);
    expect((s1().biomechanics as { angle?: string } | undefined)?.angle).not.toBe('STALE');
  });

  it('a putt runs the read only — no swing window, no body read, no arc', async () => {
    mockKind = 'putting';
    seed(6);
    await runUploadAnalysis('s1');
    await tick(10);
    expect(mockOrder).toEqual(['read']);
  });

  /**
   * 2026-10-05 (Tim's phone: the read hung, "failed" showed, then a body-read headline appeared lower
   * down a minute later). A read that could not be done hands over to the body read, and the RUN
   * settles the status once — never "failed" and then a verdict.
   */
  it('read failed + a body verdict: the body read names it and the status is ok — never failed first', async () => {
    seed(6);
    mockReadResult = { primary_issue: null, drill_recommendation: null, readFailed: 'The analyzer hit a snag.', analyses: {} };
    mockPoseVerdict = { issue_id: 'early_extension', name: 'Early Extension' };
    await runUploadAnalysis('s1');
    await tick();
    expect(s1().analysis_status).not.toBe('failed');
    mockPoseRelease[0]?.(BIO);
    await tick(10);
    expect(s1().analysis_status).toBe('ok');
    expect(s1().primary_issue?.issue_id).toBe('early_extension');
  });

  it('read failed + no body verdict: it fails ONCE, at the end, with the read\'s reason', async () => {
    seed(6);
    mockReadResult = { primary_issue: null, drill_recommendation: null, readFailed: 'The analyzer hit a snag.', analyses: {} };
    await runUploadAnalysis('s1');
    await tick();
    expect(s1().analysis_status).not.toBe('failed');   // still analyzing
    mockPoseRelease[0]?.(null);
    await tick(10);
    expect(s1().analysis_status).toBe('failed');
    expect(s1().analysis_error).toBe('The analyzer hit a snag.');
  });

  it('read failed + the body read measured the swing and found no fault: ok, said plainly — not failed', async () => {
    seed(6);
    mockReadResult = { primary_issue: null, drill_recommendation: null, readFailed: 'snag', analyses: {} };
    mockPoseVerdict = null;
    await runUploadAnalysis('s1');
    await tick();
    mockPoseRelease[0]?.(BIO);
    await tick(10);
    expect(s1().analysis_status).toBe('ok');
    expect(s1().primary_issue?.issue_id).toBe('no_clear_fault');
    expect(s1().primary_issue?.confidence).toBe('low');
  });

  it('a read that THREW still gets the body read, then settles failed once — not a spinner, not failed-then-ok', async () => {
    seed(6);
    mockReadThrows = true;
    await runUploadAnalysis('s1');
    await tick();
    expect(mockOrder).toContain('pose');
    expect(s1().analysis_status).not.toBe('failed');
    mockPoseRelease[0]?.(null);
    await tick(10);
    expect(s1().analysis_status).toBe('failed');
    expect(s1().analysis_error).toMatch(/didn't finish/);
  });

  it('a NEW analysis never names a verdict from an EARLIER window\'s stored body read (pass 2)', async () => {
    seed(6);
    // frames left on the shot by an earlier analysis of a different window
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((x) => ({ ...x, biomechanics: BIO, shots: x.shots.map((sh) => ({ ...sh, biomechanics: BIO })) })) }) as never);
    mockReadResult = { primary_issue: null, drill_recommendation: null, readFailed: 'snag', analyses: {} };
    mockPoseVerdict = { issue_id: 'early_extension' };
    await runUploadAnalysis('s1');
    await tick();
    mockPoseRelease[0]?.(null);          // this run's body read found nothing
    await tick(10);
    expect(s1().analysis_status).toBe('failed');
    expect(s1().primary_issue?.issue_id).not.toBe('early_extension');
    expect(mockOrder).not.toContain('arc');   // and no arc aimed with the old frames
  });

  it('no_launch already stored + an unreachable read: the strike stands as the answer, not "failed" (pass 2)', async () => {
    seed(6);
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((x) => ({ ...x, primary_issue: { issue_id: 'no_launch' } })) }) as never);
    mockReadResult = { primary_issue: null, drill_recommendation: null, readFailed: 'snag', analyses: {} };
    await runUploadAnalysis('s1');
    await tick();
    mockPoseRelease[0]?.(null);
    await tick(10);
    expect(s1().analysis_status).toBe('ok');
    expect(s1().primary_issue?.issue_id).toBe('no_launch');
  });

  it('a strike the camera saw (no_launch) is never replaced by the body read\'s verdict', async () => {
    seed(6);
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((x) => ({ ...x, primary_issue: { issue_id: 'no_launch' } })) }) as never);
    mockReadResult = { primary_issue: null, drill_recommendation: null, readFailed: 'snag', analyses: {} };
    mockPoseVerdict = { issue_id: 'early_extension' };
    await runUploadAnalysis('s1');
    await tick();
    mockPoseRelease[0]?.(BIO);
    await tick(10);
    expect(s1().primary_issue?.issue_id).toBe('no_launch');
  });
});

describe('a new read clears the old swing rows, and checks the connection before it sends', () => {
  it('source', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const up = fs.readFileSync(path.join(__dirname, '..', '..', 'services/videoUpload.ts'), 'utf8');
    expect(up).toMatch(/liveSessionStore\(signal\)\.clearShotAnalyses\(sessionId\);\s*V6\('STAGE 0 — session loaded'/);
    expect(up).toMatch(/liveSessionStore\(signal\)\.setSessionAnalysisStatus\(sessionId, 'analyzing_pose'\);\s*return \{ primary_issue: null, drill_recommendation: null, readFailed: message, analyses \};/);
    const pd = fs.readFileSync(path.join(__dirname, '..', '..', 'services/poseDetection.ts'), 'utf8');
    // 2026-10-05 — and an API that did not answer twice is not sent the read at all (no 63s hang).
    expect(pd).toMatch(/if \(!\(await clearDeadConnection\(apiUrl\)\)\) \{[\s\S]{0,160}return \{ kind: 'no_network' \};\s*\}\s*let res = await tryFetch\(1\);/);
    expect(pd).toMatch(/if \(!\(await clearDeadConnection\(apiUrl\)\)\) return \{ kind: 'no_network' \};\s*V6\('TENTATIVE STAGE 3/);
    // and no second network read after one that could not reach the server or hung
    expect(up).toMatch(/const unreachable = perSwingOutcomes\.every\(o => o\.kind === 'no_network' \|\| \/took too long\/i\.test\(o\.detail \?\? ''\)\);/);
    expect(up).toMatch(/if \(!unreachable && firstSwingWithClip\?\.clipUri\) \{/);
    // a read that THREW hands over to the body read like every other failure — never 'failed' then 'ok'
    expect(up).toMatch(/liveSessionStore\(signal\)\.setSessionAnalysisStatus\(sessionId, 'analyzing_pose'\);\s*return \{ primary_issue: null, drill_recommendation: null, analyses, readFailed: "I had trouble watching this one/);
    expect(pd).toMatch(/\/api\/health\?lite=1`, \{ method: 'GET', signal: AbortSignal\.timeout\(5_000\) \}/);
  });
});
