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
jest.mock('../../services/swing/analysisOrchestrator', () => ({
  findUploadSwingWindow: async () => { mockOrder.push('window'); return { startSec: 5.3, endSec: 7.9, impactSec: null, via: 'motion' }; },
}));
jest.mock('../../services/videoUpload', () => ({
  _runPhaseKRead: async () => { mockOrder.push('read'); return { primary_issue: { issue_id: 'over_the_top' }, drill_recommendation: null }; },
  runUploadPosePass: () => new Promise((r) => { mockOrder.push('pose'); mockPoseRelease = () => r(true); }),
}));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

const seed = (dur: number) => useSwingSessionStore.setState({
  activeSession: null,
  sessionHistory: [{ id: 's1', source: 'uploaded_video', analysis_status: 'pending', upload: { duration_sec: dur },
    shots: [{ id: 'sh1', clipUri: 'file:///c.mp4' }] }] as never,
});

beforeEach(() => { mockOrder.length = 0; mockPoseRelease = null; _clearRunsForTest(); });

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
});
