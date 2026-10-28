/**
 * 2026-10-27 (Phase SB5 — recheck R3 of the SB3/SB4 work).
 *
 * The launch's held-credit sweep (practice/smartMotionPracticeCredit.applyHeldSetCredits) credits a set
 * without reading it only when its read REACHED ITS END. It took analysis_status 'ok' for that, and 'ok' is
 * written mid-read too (SmartMotion's no-launch verdict, setSessionAnalysis). The read now stamps its own
 * end (SwingSession.readEndedAt) right after the practice classifier, and clears it when it starts.
 *
 * Driven through the real read (videoUpload._runPhaseKRead) on the real store; only the per-swing call and
 * the network edges are stubbed.
 */
let mockHold: Promise<void> | null = null;
jest.mock('../../services/poseDetection', () => ({
  analyzeSwing: async (_uri: string, opts: { swing_number: number }) => {
    if (mockHold) await mockHold;
    return {
      kind: 'ok',
      analysis: {
        detected_issue: 'over_the_top', primary_fault: 'over_the_top', severity: 'moderate', confidence: 'high',
        observation: 'o', fault_frame_index: -1, contact_read: 'unknown', ball_struck: opts.swing_number === 2 ? 'no' : 'yes',
      },
      frame_timestamps_sec: [],
    };
  },
  analyzeSwingTentative: async () => ({ kind: 'no_network' }),
  probeDurationMs: async () => 40_000,
  locateSwings: async () => [],
}));
jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  lastReachability: () => null,
  probeReachability: async () => ({ verdict: 'internet_ok', via: 'apple', controlMs: 100, at: Date.now() }),
}));
jest.mock('../../services/swingCommentaryService', () => ({ getTranscriptionStatus: () => 'done' }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../services/contextSynthesizer', () => ({ synthesizeCageInsight: async () => undefined }));

import { useSwingSessionStore } from '../../store/swingSessionStore';
import { noLaunchIssue } from '../../services/swing/contactVerdict';
import { _runPhaseKRead } from '../../services/videoUpload';

const s1 = () => useSwingSessionStore.getState().sessionHistory[0];

/** A SmartMotion capture of three swings, read once before (its end stamped then). */
function seed(): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'live_capture', analysis_status: 'ok', club: '7i', date: 1, upload: { uploaded_at: 1 }, readEndedAt: 1,
      shots: [0, 1, 2].map((i) => ({
        id: `s1_shot_${i}`, club: '7i', clipUri: 'file:///cap.mp4', clipStartSeconds: 2 + i * 6, clipEndSeconds: 6 + i * 6,
        detectionMethod: 'manual', timestamp: 1, feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null,
      })),
    }] as never,
  });
}

beforeEach(() => { mockHold = null; seed(); });

describe('a set\'s read stamps its own end', () => {
  it('cleared when the read starts, still clear mid-read after the no-launch \'ok\', stamped once the classifier ran', async () => {
    let release!: () => void;
    mockHold = new Promise((r) => { release = r; });
    const p = _runPhaseKRead('s1');
    expect(s1().readEndedAt ?? null).toBeNull();               // the read just started: not at its end
    // Mid-read, the review's ball-departure check writes its no-launch verdict: status 'ok'.
    useSwingSessionStore.getState().setSessionAnalysis('s1', noLaunchIssue(), null);
    expect(s1().analysis_status).toBe('ok');
    expect(s1().readEndedAt ?? null).toBeNull();               // …and that is not the end of the read
    release();
    await p;
    expect(typeof s1().readEndedAt).toBe('number');
    expect((s1().shots[1] as { practice?: unknown }).practice).toEqual({ reason: 'no_ball_seen' });
  });

  it('a read cut short (aborted) never stamps its end', async () => {
    let release!: () => void;
    mockHold = new Promise((r) => { release = r; });
    const ac = new AbortController();
    const p = _runPhaseKRead('s1', ac.signal);
    ac.abort();
    release();
    await p;
    expect(s1().readEndedAt ?? null).toBeNull();
  });
});
