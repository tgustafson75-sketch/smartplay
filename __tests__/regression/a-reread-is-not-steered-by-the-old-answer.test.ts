/**
 * 2026-10-26 (Tim: "Re-analyze must run the CURRENT code on every swing; old issues must not survive").
 *
 * 1. Every re-read sent the OLD headline as `prior_analyzed_fault`, and the server tells the model
 *    "Never name X again without clean evidence" (api/swing-analysis.ts). "Re-analyze with latest" was a
 *    read steered away from the old answer, not a fresh one. Only the second-look card ("want a second
 *    look?" under an inconclusive read) asks for that, and only it may send it.
 * 2. A swing whose read failed kept its OLD fault timestamp (the spotlight paused on the old moment):
 *    the timestamps were written only when the read succeeded.
 *
 * Driven through the real read (videoUpload._runPhaseKRead) with only analyzeSwing stubbed.
 */
const mockSent: (string | null | undefined)[] = [];

jest.mock('../../services/poseDetection', () => ({
  analyzeSwing: async (_uri: string, opts: { prior_analyzed_fault?: string | null }) => {
    mockSent.push(opts.prior_analyzed_fault);
    return { kind: 'no_network' };
  },
  analyzeSwingTentative: async () => ({ kind: 'no_network' }),
  probeDurationMs: async () => 4000,
  locateSwings: async () => [],
}));
jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  lastReachability: () => null,
  probeReachability: async () => ({ verdict: 'internet_ok', via: 'apple', controlMs: 100, at: Date.now() }),
}));
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/swingCommentaryService', () => ({ getTranscriptionStatus: () => 'done' }));

import { useSwingSessionStore } from '../../store/swingSessionStore';
import { _runPhaseKRead } from '../../services/videoUpload';

const seed = () => useSwingSessionStore.setState({
  activeSession: null,
  sessionHistory: [{
    id: 's1', source: 'live_capture', analysis_status: 'pending', club: '7i',
    primary_issue: { issue_id: 'inconclusive', primary_fault: 'over_the_top', name: 'Over the top' },
    shots: [0, 1].map((i) => ({ id: `sh${i}`, club: '7i', clipUri: `https://clips/${i}.mp4`, clipStartSeconds: 1, clipEndSeconds: 3, detected_issue_timestamps_sec: [9.9] })),
  }] as never,
});

beforeEach(() => { mockSent.length = 0; });

describe('a re-read is a fresh read', () => {
  it('Re-analyze (no second look asked for) does not send the old headline', async () => {
    seed();
    await _runPhaseKRead('s1');
    expect(mockSent.length).toBeGreaterThan(0);
    expect(mockSent.every((f) => f == null)).toBe(true);
  });

  it('the second-look card asks for it: then, and only then, the old headline goes along', async () => {
    seed();
    await _runPhaseKRead('s1', undefined, { secondLook: true });
    expect(mockSent[0]).toBe('over_the_top');
  });
});

describe('a swing whose read failed keeps no old fault moment', () => {
  it('a read that failed → the swing\'s fault timestamps are emptied, not left at the old analysis\'s', async () => {
    seed();
    await _runPhaseKRead('s1');
    const shots = useSwingSessionStore.getState().sessionHistory[0].shots;
    expect(shots.map((s) => s.detected_issue_timestamps_sec)).toEqual([[], []]);
  });
});
