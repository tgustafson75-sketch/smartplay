/**
 * 2026-10-27 (Phase SB4x — review finding "reanalyze #4").
 *
 * A swing demoted as a practice swing (no ball seen) is deliberately NOT read again by a Re-analyze — its
 * paid read is skipped (videoUpload's work filter). But the Re-analyze cleared every swing's read first
 * (store.resetDerivedAnalysis, then the read's own clearShotAnalyses), so the demoted swing lost the only
 * read it had, and "count it" afterwards restored a swing with no read at all. Its last read is kept.
 *
 * Driven through the real run (uploadRun.runSwingAnalysis → videoUpload's read) on the real store.
 */
const mockReads: { uri: string; start: number | undefined }[] = [];
jest.mock('../../services/poseDetection', () => ({
  analyzeSwing: async (uri: string, o: { clipBoundaries?: { startSec: number } }) => {
    mockReads.push({ uri, start: o?.clipBoundaries?.startSec });
    return {
      kind: 'ok',
      analysis: {
        detected_issue: 'over_the_top', severity: 'moderate', confidence: 'high', observation: 'steep',
        fault_frame_index: -1, primary_fault: 'over_the_top', ball_struck: 'yes',
        phases_visible: { address: true, top: true, impact: true, finish: true },
      },
      locate_degraded: null, frame_timestamps_sec: [], fault_frame_uri: null, fault_frame_display_uri: null, fault_frame_fraction: null,
    };
  },
  analyzeSwingTentative: async () => ({ kind: 'no_network' }),
  probeDurationMs: async () => 12000,
  locateSwings: async () => [],
}));
jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  probeReachability: async () => ({ verdict: 'internet_ok', via: null, controlMs: null, at: Date.now() }),
  lastReachability: () => null,
}));
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/swingCommentaryService', () => ({ getTranscriptionStatus: () => 'done' }));
jest.mock('../../services/swing/analysisOrchestrator', () => ({ findUploadSwingWindow: async () => ({ via: 'middle', startSec: 0, endSec: 1, impactSec: null }) }));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: async () => null,
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/swing/clubPath', () => ({ detectClubPath: async () => null }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../services/contextSynthesizer', () => ({ synthesizeCageInsight: async () => null }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

import { useSwingSessionStore } from '../../store/swingSessionStore';
import { runSwingAnalysis } from '../../services/swing/orchestrator/uploadRun';
import { _clearRunsForTest, liveRunKeys, liveRun } from '../../services/swing/orchestrator/engine';
import { countedShots } from '../../services/swing/practiceSwings';

const oldRead = { detected_issue: 'early_extension', primary_fault: 'early_extension', severity: 'moderate', confidence: 'high', observation: 'stood up' };
const sess = () => useSwingSessionStore.getState().sessionHistory.find((s) => s.id === 'p')!;
const shot = (i: number) => sess().shots[i] as unknown as { perShotAnalysis?: { primary_fault?: string }; detected_issue_timestamps_sec?: number[]; practice?: unknown };

function seed(): void {
  useSwingSessionStore.setState({
    activeSession: null, hasHydrated: true,
    sessionHistory: [{
      id: 'p', date: 1, source: 'live_capture', analysis_status: 'ok', club: '7i',
      shots: [0, 1].map((i) => ({
        id: `p_shot_${i}`, club: '7i', clipUri: 'https://clips/p.mp4', clipStartSeconds: 1 + i * 5, clipEndSeconds: 4 + i * 5,
        detectionMethod: 'manual',
        perShotAnalysis: oldRead, detected_issue_timestamps_sec: [2.5 + i * 5],
        ...(i === 1 ? { practice: { reason: 'no_ball_seen' } } : {}),
      })),
    }] as never,
  });
}

afterEach(() => { for (const k of liveRunKeys()) liveRun(k)?.cancel(); _clearRunsForTest(); });
afterAll(() => { require('../../services/analytics').teardownAnalytics(); });
beforeEach(() => { mockReads.length = 0; seed(); });

describe('a demoted practice swing keeps its last read through a Re-analyze', () => {
  it('THE REPORT: Re-analyze, then "count it" — the swing counts WITH its read', async () => {
    await runSwingAnalysis('p');
    // The demoted swing was not paid for again…
    expect(mockReads).toHaveLength(1);
    // …and it still has the only read it ever had.
    expect(shot(1).practice).toBeTruthy();
    expect(shot(1).perShotAnalysis?.primary_fault).toBe('early_extension');
    expect(shot(1).detected_issue_timestamps_sec).toEqual([7.5]);
    useSwingSessionStore.getState().setPracticeSwingRestored('p', 'p_shot_1', true);
    expect(countedShots(sess().shots)).toHaveLength(2);
    expect(shot(1).perShotAnalysis?.primary_fault).toBe('early_extension');
  });

  it('a counted swing is read again by today\'s code (its old read does not survive)', async () => {
    await runSwingAnalysis('p');
    expect(shot(0).perShotAnalysis?.primary_fault).toBe('over_the_top');
  });
});
