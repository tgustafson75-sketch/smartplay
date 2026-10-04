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
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => mockKind }));
jest.mock('../../services/swing/analysisOrchestrator', () => ({
  findUploadSwingWindow: async () => { mockOrder.push('window'); return { startSec: 5.3, endSec: 7.9, impactSec: null, via: 'motion' }; },
}));
jest.mock('../../services/videoUpload', () => ({
  _runPhaseKRead: async () => { mockOrder.push('read'); return { primary_issue: { issue_id: 'over_the_top' }, drill_recommendation: null }; },
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

beforeEach(() => { mockOrder.length = 0; mockPoseRelease = null; mockPoseSignals.length = 0; mockKind = 'full_swing'; _clearRunsForTest(); });

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
});
