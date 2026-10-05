/**
 * 2026-10-04 — Phase 1 of the SmartMotion orchestrator: every upload / library analysis is ONE run —
 * window → read → pose — whoever starts it (swing screen, trim, Analyze-at-position, practice overlay,
 * ingest). Pins the order, the 15s multi-swing rule, and that the caller gets the read without waiting
 * for pose.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { runUploadAnalysis } from '../../services/swing/orchestrator/uploadRun';
import { _clearRunsForTest } from '../../services/swing/orchestrator/engine';

const mockOrder: string[] = [];
let mockPoseRelease: (() => void) | null = null;
const mockPoseSignals: (AbortSignal | undefined)[] = [];
let mockKind = 'full_swing';
let mockReadResult: Record<string, unknown> = { primary_issue: { issue_id: 'over_the_top' }, drill_recommendation: null };
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => mockKind }));
jest.mock('../../services/swing/analysisOrchestrator', () => ({
  findUploadSwingWindow: async () => { mockOrder.push('window'); return { startSec: 5.3, endSec: 7.9, impactSec: null, via: 'motion' }; },
}));
jest.mock('../../services/videoUpload', () => ({
  _runPhaseKRead: async () => { mockOrder.push('read'); return mockReadResult; },
  runUploadPosePass: (_id: string, signal?: AbortSignal) => new Promise((r) => {
    mockOrder.push('pose'); mockPoseSignals.push(signal); mockPoseRelease = () => r(true);
  }),
}));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

const seed = (dur: number) => useSwingSessionStore.setState({
  activeSession: null,
  sessionHistory: [{ id: 's1', source: 'uploaded_video', analysis_status: 'pending', upload: { duration_sec: dur },
    shots: [{ id: 'sh1', clipUri: 'file:///c.mp4' }] }] as never,
});

beforeEach(() => {
  mockOrder.length = 0; mockPoseRelease = null; mockPoseSignals.length = 0; mockKind = 'full_swing'; _clearRunsForTest();
  mockReadResult = { primary_issue: { issue_id: 'over_the_top' }, drill_recommendation: null };
});

describe('an upload runs window → read → pose, once', () => {
  it('a single-swing upload finds its window first, then reads; the caller gets the read before pose ends', async () => {
    seed(6);
    const read = await runUploadAnalysis('s1');
    expect(read.primary_issue).toEqual({ issue_id: 'over_the_top' });
    expect(mockOrder.slice(0, 2)).toEqual(['window', 'read']);
    const shot = useSwingSessionStore.getState().sessionHistory[0].shots[0];
    expect([shot.clipStartSeconds, shot.clipEndSeconds]).toEqual([5.3, 7.9]);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockOrder).toContain('pose');   // pose started after the read, still running for the caller
    mockPoseRelease?.();
  });

  it('a 15s+ upload skips the window — the read splits a range session into its swings', async () => {
    seed(42);
    await runUploadAnalysis('s1');
    expect(mockOrder[0]).toBe('read');
    expect(mockOrder).not.toContain('window');
    mockPoseRelease?.();
  });

  it('two triggers for the same swing share one run', async () => {
    seed(6);
    await Promise.all([runUploadAnalysis('s1'), runUploadAnalysis('s1')]);
    expect(mockOrder.filter((x) => x === 'read')).toHaveLength(1);
    mockPoseRelease?.();
  });

  /**
   * 2026-10-04 (sweep) — once the read has settled the live run is only its pose tail. A new request
   * (Analyze this moment after a scrub, the angle chip, a trim) must get a NEW read, and the old pose
   * tail must be told to stop — it used to join and hand back the old result.
   */
  it('a trigger AFTER the read settled starts a fresh read and aborts the old pose tail', async () => {
    seed(42);
    await runUploadAnalysis('s1');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockPoseSignals).toHaveLength(1);
    await runUploadAnalysis('s1');
    expect(mockOrder.filter((x) => x === 'read')).toHaveLength(2);
    expect(mockPoseSignals[0]?.aborted).toBe(true);
    mockPoseRelease?.();
  });

  it('a putt runs the read only — no swing window, no swing pose pass', async () => {
    mockKind = 'putting';
    seed(6);
    await runUploadAnalysis('s1');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockOrder).toEqual(['read']);
  });

  /**
   * 2026-10-05 (Tim's phone: the read hung, "failed" showed, then a body-read headline appeared lower
   * down a minute later). A read that could not be done hands over to the body read, and the RUN settles
   * the status once — never "failed" and then a verdict.
   */
  it('read failed + a body verdict: the screen never shows failed — the body read stands', async () => {
    seed(6);
    mockReadResult = { primary_issue: null, drill_recommendation: null, readFailed: 'The analyzer hit a snag.' };
    const { getOrStartRun } = await import('../../services/swing/orchestrator/engine');
    void getOrStartRun;
    await runUploadAnalysis('s1');
    await new Promise((r) => setTimeout(r, 0));
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((x) => ({ ...x, analysis_status: 'ok' })) }) as never);
    mockPoseRelease?.();
    await new Promise((r) => setTimeout(r, 10));
    expect(useSwingSessionStore.getState().sessionHistory[0].analysis_status).toBe('ok');
  });

  it('read failed + no body verdict: it fails ONCE, at the end, with the read\'s reason', async () => {
    seed(6);
    mockReadResult = { primary_issue: null, drill_recommendation: null, readFailed: 'The analyzer hit a snag.' };
    await runUploadAnalysis('s1');
    await new Promise((r) => setTimeout(r, 0));
    expect(useSwingSessionStore.getState().sessionHistory[0].analysis_status).not.toBe('failed');   // still analyzing
    mockPoseRelease?.();
    await new Promise((r) => setTimeout(r, 10));
    const s1 = useSwingSessionStore.getState().sessionHistory[0];
    expect(s1.analysis_status).toBe('failed');
    expect(s1.analysis_error).toBe('The analyzer hit a snag.');
  });
});

describe('a new read clears the old swing rows, and checks the connection before it sends', () => {
  it('source', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const up = fs.readFileSync(path.join(__dirname, '..', '..', 'services/videoUpload.ts'), 'utf8');
    expect(up).toMatch(/liveSessionStore\(signal\)\.clearShotAnalyses\(sessionId\);\s*V6\('STAGE 0 — session loaded'/);
    expect(up).toMatch(/liveSessionStore\(signal\)\.setSessionAnalysisStatus\(sessionId, 'analyzing_pose'\);\s*return \{ primary_issue: null, drill_recommendation: null, readFailed: message \};/);
    const pd = fs.readFileSync(path.join(__dirname, '..', '..', 'services/poseDetection.ts'), 'utf8');
    expect(pd).toMatch(/await clearDeadConnection\(apiUrl\);\s*let res = await tryFetch\(1\);/);
    expect(pd).toMatch(/await clearDeadConnection\(apiUrl\);\s*V6\('TENTATIVE STAGE 3/);
    expect(pd).toMatch(/\/api\/health\?lite=1`, \{ method: 'GET', signal: AbortSignal\.timeout\(5_000\) \}/);
  });
});

