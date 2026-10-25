/**
 * 2026-10-17 (Phase F1a — Tim at a range on a weak uplink). A SmartMotion capture with 2-3 swings fired
 * every cloud read at once, ~500KB of frames each, plus the health probe ahead of each. On that link
 * they starved each other and every one gave up — so not even the first swing got a verdict.
 *
 * Now the first swing is read alone. Its wall time is the measured link: fast → the rest go three at a
 * time as before; slow (or a 'slow' reachability verdict) → the rest go one at a time.
 *
 * Driven through the real read (videoUpload._runPhaseKRead) with only analyzeSwing stubbed, so the
 * assertion is on how many reads are actually in flight at once.
 */
let mockInFlight = 0;
let mockMaxInFlight = 0;
const mockStarts: number[] = [];
let mockReadMs: (i: number) => number = () => 5;
let mockLastVerdict: string | null = null;
let mockVerdictAgeMs = 0;

jest.mock('../../services/poseDetection', () => ({
  analyzeSwing: async (_uri: string, opts: { swing_number: number }) => {
    const i = opts.swing_number - 1;
    mockStarts.push(i);
    mockInFlight++;
    mockMaxInFlight = Math.max(mockMaxInFlight, mockInFlight);
    await new Promise((r) => setTimeout(r, mockReadMs(i)));
    mockInFlight--;
    return { kind: 'no_network' };
  },
  analyzeSwingTentative: async () => ({ kind: 'no_network' }),
  probeDurationMs: async () => 4000,
  locateSwings: async () => [],
}));
jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  lastReachability: () => (mockLastVerdict ? { verdict: mockLastVerdict, via: 'apple', controlMs: 3000, at: Date.now() - mockVerdictAgeMs } : null),
  // Every read here fails no_network; the read then asks whether the phone is offline (2026-10-25). Never the real internet.
  probeReachability: async () => ({ verdict: 'internet_ok', via: 'apple', controlMs: 100, at: Date.now() }),
}));
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/swingCommentaryService', () => ({ getTranscriptionStatus: () => 'done' }));

import { useSwingSessionStore } from '../../store/swingSessionStore';
import { _runPhaseKRead } from '../../services/videoUpload';

const seed = (n: number) => useSwingSessionStore.setState({
  activeSession: null,
  sessionHistory: [{
    id: 's1', source: 'live_capture', analysis_status: 'pending', club: '7i',
    shots: Array.from({ length: n }, (_, i) => ({ id: `sh${i}`, club: '7i', clipUri: `https://clips/${i}.mp4`, clipStartSeconds: 1, clipEndSeconds: 3 })),
  }] as never,
});

beforeEach(() => {
  mockInFlight = 0; mockMaxInFlight = 0; mockStarts.length = 0; mockReadMs = () => 5; mockLastVerdict = null; mockVerdictAgeMs = 0;
});

describe('a multi-swing capture reads the first swing alone', () => {
  it('a 3-swing capture on a fast link: swing 0 alone first, then the rest together', async () => {
    seed(3);
    let soloCheck = -1;
    mockReadMs = (i) => { if (i === 0) soloCheck = mockInFlight; return 5; };
    await _runPhaseKRead('s1');
    expect(mockStarts[0]).toBe(0);
    expect(soloCheck).toBe(1);               // nothing else was in flight while swing 0 read
    expect(mockStarts).toHaveLength(3);
    expect(mockMaxInFlight).toBe(2);         // swings 1 and 2 still share a batch on a fast link
  });

  it("a slow first read (weak link) → the remaining reads are never concurrent", async () => {
    seed(3);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      mockReadMs = (i) => (i === 0 ? 35_000 : 5);
      const p = _runPhaseKRead('s1');
      for (let k = 0; k < 400 && mockStarts.length < 3; k++) { await jest.advanceTimersByTimeAsync(200); }
      await jest.advanceTimersByTimeAsync(40_000);
      await p;
    } finally { jest.useRealTimers(); }
    expect(mockStarts).toEqual([0, 1, 2]);
    expect(mockMaxInFlight).toBe(1);
  });

  it("a 'slow' reachability verdict → one at a time even when the first read was quick", async () => {
    seed(3);
    mockLastVerdict = 'slow';
    await _runPhaseKRead('s1');
    expect(mockStarts).toEqual([0, 1, 2]);
    expect(mockMaxInFlight).toBe(1);
  });
});

/**
 * 2026-10-17 (review of F1a) — a 'slow' probe from long ago, and an ordinary 20-25s first read, are not a
 * weak link now: the rest still read three at a time.
 */
describe('only a weak link NOW makes the reads serial', () => {
  it("a 'slow' verdict from five minutes ago does not", async () => {
    seed(3);
    mockLastVerdict = 'slow';
    mockVerdictAgeMs = 5 * 60_000;
    await _runPhaseKRead('s1');
    expect(mockMaxInFlight).toBe(2);
  });

  it('a 22s first read (frame extraction + upload + server on a phone) does not', async () => {
    seed(3);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      mockReadMs = (i) => (i === 0 ? 22_000 : 5);
      const p = _runPhaseKRead('s1');
      for (let k = 0; k < 400 && mockStarts.length < 3; k++) { await jest.advanceTimersByTimeAsync(200); }
      await jest.advanceTimersByTimeAsync(30_000);
      await p;
    } finally { jest.useRealTimers(); }
    expect(mockMaxInFlight).toBe(2);
  });
});
