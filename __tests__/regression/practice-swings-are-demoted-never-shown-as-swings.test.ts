/**
 * 2026-10-26 (Tim: "Practice swings still show on old uploads").
 *
 * An upload was split into swings ONLY on its first read (one shot, no window). Every later Re-analyze saw
 * N windowed shots and never looked for the swings again, so the practice swings the first split carved
 * were re-read forever. And there was no practice-swing classifier at all: the locator is told to lean
 * permissive, and since S2m its two passes are UNIONED, so a practice swing either pass saw is a swing.
 * The writers also threw the locator's confidence away, so no stored record could say "doubtful".
 *
 * Now:
 *  - both writers (the upload split and the live-capture ingest) persist the locator's confidence;
 *  - a re-analyze of an old upload whose every shot the finder carved (and the player never touched)
 *    looks for the swings again;
 *  - ONE classifier, run in the read for every source, DEMOTES a swing the read saw made with no ball
 *    (shot.practice) — never deletes it, never on a missing answer, never the last swing, never a swing
 *    whose strike was heard; the player can restore it;
 *  - the paid per-swing read skips a demoted swing unless the player restored it;
 *  - every reader of the swing list counts the demoted swing out.
 *
 * Driven through the real read (videoUpload._runPhaseKRead), the real store and the real library.
 */
type Read = { ball_struck?: 'yes' | 'no' | 'unknown' };
let mockReads: Record<number, Read> = {};
const mockReadCalls: number[] = [];   // the window start (s) of each paid read
let mockLocate: { timeSec: number; confidence: 'high' | 'low' }[] = [];
let mockLocateCalls = 0;

jest.mock('../../services/poseDetection', () => ({
  analyzeSwing: async (_uri: string, opts: { swing_number: number }, b?: { startSec: number }) => {
    mockReadCalls.push(b?.startSec ?? -1);
    const r = mockReads[opts.swing_number - 1] ?? {};
    return {
      kind: 'ok',
      analysis: {
        detected_issue: 'over_the_top', primary_fault: 'over_the_top', severity: 'moderate', confidence: 'high',
        observation: 'o', fault_frame_index: -1, contact_read: 'unknown', ...r,
      },
      frame_timestamps_sec: [],
    };
  },
  analyzeSwingTentative: async () => ({ kind: 'no_network' }),
  probeDurationMs: async () => 40_000,
  locateSwings: async (_u: string, _d: number, coverage?: { complete: boolean }) => {
    mockLocateCalls++;
    if (coverage) coverage.complete = true;   // both finder passes answered
    return mockLocate;
  },
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
import { _runPhaseKRead } from '../../services/videoUpload';
import { getLibrary } from '../../services/swingLibrary';

const s1 = () => useSwingSessionStore.getState().sessionHistory[0];
const shots = () => s1().shots as unknown as Record<string, unknown>[];

/** An upload split by an older build: three `${sid}_shot_i` windows on one clip, 'manual', no source, no confidence. */
function seedOldUpload(patch: (i: number) => Record<string, unknown> = () => ({})) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i', date: 1, upload: { duration_sec: 40, uploaded_at: 1 },
      shots: [2, 14, 28].map((start, i) => ({
        id: `s1_shot_${i}`, club: '7i', clipUri: 'file:///range.mp4', clipStartSeconds: start, clipEndSeconds: start + 4,
        detectionMethod: 'manual', timestamp: 1, feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null,
        ...patch(i),
      })),
    }] as never,
  });
}

/** A SmartMotion capture of three swings (live_capture), none of them heard. */
function seedLiveCapture(patch: (i: number) => Record<string, unknown> = () => ({})) {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'live_capture', analysis_status: 'ok', club: '7i', date: 1, upload: { uploaded_at: 1 },
      shots: [0, 1, 2].map((i) => ({
        id: `s1_shot_${i}`, club: '7i', clipUri: 'file:///cap.mp4', clipStartSeconds: 2 + i * 6, clipEndSeconds: 6 + i * 6,
        detectionMethod: 'manual', timestamp: 1, feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null,
        ...patch(i),
      })),
    }] as never,
  });
}

beforeEach(() => {
  mockReads = {}; mockReadCalls.length = 0; mockLocate = []; mockLocateCalls = 0;
});

describe('an old upload is split again on Re-analyze', () => {
  it('three legacy finder windows (one a practice swing) become the two swings the finder sees today', async () => {
    seedOldUpload();
    mockLocate = [{ timeSec: 16, confidence: 'high' }, { timeSec: 30, confidence: 'low' }];
    await _runPhaseKRead('s1');
    expect(mockLocateCalls).toBe(1);
    expect(shots().map((x) => x.id)).toEqual(['s1_shot_0', 's1_shot_1']);
    expect(shots()[0].locatedImpactSec).toBe(16);
    // The finder's verdict is kept on the record.
    expect(shots().map((x) => x.locateConfidence)).toEqual(['high', 'low']);
    expect(shots().every((x) => x.clipWindowSource === 'auto')).toBe(true);
    // The read read the NEW windows, not the stored ones.
    expect([...mockReadCalls].sort((a, b) => a - b)).toEqual([13.5, 27.5]);
  });

  it('the swing screen sees the re-split (ids are reused for other swings), but not a trim of one swing', async () => {
    const { swingLayoutKey } = require('../../services/swing/practiceSwings') as typeof import('../../services/swing/practiceSwings');
    seedOldUpload();
    const before = swingLayoutKey(s1() as never);
    useSwingSessionStore.getState().setShotClipBoundaries('s1', 's1_shot_1', 13, 17, 15, 'user');
    expect(swingLayoutKey(s1() as never)).toBe(before);              // a trim keeps the selection
    seedOldUpload();
    mockLocate = [{ timeSec: 16, confidence: 'high' }, { timeSec: 30, confidence: 'high' }, { timeSec: 36, confidence: 'high' }];
    await _runPhaseKRead('s1');
    expect(shots().map((x) => x.id)).toEqual(['s1_shot_0', 's1_shot_1', 's1_shot_2']);   // same ids…
    expect(swingLayoutKey(s1() as never)).not.toBe(before);          // …different swings: per-swing state is dropped
  });

  it('a window the PLAYER chose is never re-split', async () => {
    seedOldUpload((i) => (i === 1 ? { clipWindowSource: 'user' } : {}));
    mockLocate = [{ timeSec: 16, confidence: 'high' }];
    await _runPhaseKRead('s1');
    expect(mockLocateCalls).toBe(0);
    expect(shots()).toHaveLength(3);
  });

  it('a swing the player wrote on (a note, a keeper star, review labels) is never re-split away', async () => {
    for (const content of [{ userNotes: 'felt great' }, { isGoodRep: true }, { review_labels: { feel: 'pure' } }]) {
      seedOldUpload((i) => (i === 2 ? content : {}));
      mockLocate = [{ timeSec: 16, confidence: 'high' }];
      mockLocateCalls = 0;
      await _runPhaseKRead('s1');
      expect(mockLocateCalls).toBe(0);
      expect(shots()).toHaveLength(3);
    }
  });

  it('a live capture is never re-split (its split fused what the microphone heard)', async () => {
    seedLiveCapture();
    mockLocate = [{ timeSec: 4, confidence: 'high' }];
    await _runPhaseKRead('s1');
    expect(mockLocateCalls).toBe(0);
    expect(shots()).toHaveLength(3);
  });

  it('the finder answering nothing leaves the stored swings alone (a failed locate is not evidence)', async () => {
    seedOldUpload();
    mockLocate = [];
    await _runPhaseKRead('s1');
    expect(mockLocateCalls).toBe(1);
    expect(shots()).toHaveLength(3);
  });
});

describe('the read demotes a swing it saw made with no ball — every source, never deleted', () => {
  it('a live capture: swing 2 read as no ball is marked practice, the library counts 2 swings, the headline ignores it', async () => {
    seedLiveCapture();
    mockReads = { 1: { ball_struck: 'no' } };
    await _runPhaseKRead('s1');
    expect(shots()).toHaveLength(3);                                     // never deleted
    expect(shots()[1].practice).toEqual({ reason: 'no_ball_seen' });
    expect(shots()[0].practice ?? null).toBeNull();
    expect(getLibrary('all')[0].swing_count).toBe(2);
    const pi = s1().primary_issue as { detected_in_shots?: string[] } | null;
    expect(pi?.detected_in_shots ?? []).not.toContain('s1_shot_1');
  });

  it('an old upload too (with no re-split possible), on Re-analyze', async () => {
    seedOldUpload((i) => (i === 0 ? { userNotes: 'keep' } : {}));
    mockReads = { 2: { ball_struck: 'no' } };
    await _runPhaseKRead('s1');
    expect(shots()[2].practice).toEqual({ reason: 'no_ball_seen' });
    expect(getLibrary('all')[0].swing_count).toBe(2);
  });

  it('a missing or unknown answer (a server not yet deployed) never demotes', async () => {
    seedLiveCapture();
    mockReads = { 0: {}, 1: { ball_struck: 'unknown' } };
    await _runPhaseKRead('s1');
    expect(shots().every((x) => x.practice == null)).toBe(true);
    expect(getLibrary('all')[0].swing_count).toBe(3);
  });

  it('a HEARD strike is never demoted', async () => {
    seedLiveCapture((i) => (i === 1 ? { detectionMethod: 'audio_transient' } : {}));
    mockReads = { 1: { ball_struck: 'no' } };
    await _runPhaseKRead('s1');
    expect(shots()[1].practice ?? null).toBeNull();
  });

  it('the last swing standing is never demoted (a session is never emptied)', async () => {
    seedLiveCapture();
    mockReads = { 0: { ball_struck: 'no' }, 1: { ball_struck: 'no' }, 2: { ball_struck: 'no' } };
    await _runPhaseKRead('s1');
    expect(shots().filter((x) => x.practice == null)).not.toHaveLength(0);
  });

  it('Re-analyze does not pay to read a demoted swing again — unless the player restored it', async () => {
    seedLiveCapture((i) => (i === 1 ? { practice: { reason: 'no_ball_seen' } } : {}));
    await _runPhaseKRead('s1');
    expect([...mockReadCalls].sort((a, b) => a - b)).toEqual([2, 14]);
    mockReadCalls.length = 0;
    (useSwingSessionStore.getState() as unknown as { setPracticeSwingRestored: (a: string, b: string, c: boolean) => void })
      .setPracticeSwingRestored('s1', 's1_shot_1', true);
    expect(getLibrary('all')[0].swing_count).toBe(3);
    mockReads = { 1: { ball_struck: 'no' } };
    await _runPhaseKRead('s1');
    expect([...mockReadCalls].sort((a, b) => a - b)).toEqual([2, 8, 14]);
    // The player's call stands over the read's.
    expect(shots()[1].practice).toEqual({ reason: 'no_ball_seen', restoredByUser: true });
    expect(getLibrary('all')[0].swing_count).toBe(3);
  });
});

describe('the writers keep the locator\'s verdict', () => {
  it('a SmartMotion save stores an unconfirmed swing as locateConfidence low (ingestLiveCageSession)', () => {
    useSwingSessionStore.setState({ activeSession: null, sessionHistory: [] } as never);
    const ingest = useSwingSessionStore.getState().ingestLiveCageSession as unknown as (i: unknown) => string;
    const sid = ingest({
      masterVideoPath: 'file:///new.mp4', club: '7i', upload: { uploaded_at: 5 },
      shots: [
        { correlationId: 'a', detectionOffsetSeconds: 3, clipStartSeconds: 1, clipEndSeconds: 4, detectionMethod: 'audio_transient', locateConfidence: 'high' },
        { correlationId: 'b', detectionOffsetSeconds: 9, clipStartSeconds: 7, clipEndSeconds: 10, detectionMethod: 'manual', locateConfidence: 'low' },
      ],
    });
    const saved = useSwingSessionStore.getState().sessionHistory.find((x) => x.id === sid)!.shots as unknown as Record<string, unknown>[];
    expect(saved.map((x) => x.locateConfidence)).toEqual(['high', 'low']);
    expect(saved.every((x) => x.clipWindowSource === 'auto')).toBe(true);
  });

  it('the first split of a fresh upload stores each swing\'s confidence', async () => {
    useSwingSessionStore.setState({
      activeSession: null,
      sessionHistory: [{
        id: 's1', source: 'uploaded_video', analysis_status: 'pending', club: '7i', date: 1, upload: { duration_sec: 40, uploaded_at: 1 },
        shots: [{ id: 'up_shot', club: '7i', clipUri: 'file:///range.mp4', timestamp: 1, feel: null, shape: null, contact: null, direction: null, acousticContact: null, aiAnalysis: null }],
      }] as never,
    });
    mockLocate = [{ timeSec: 10, confidence: 'low' }, { timeSec: 25, confidence: 'high' }];
    await _runPhaseKRead('s1');
    expect(shots().map((x) => x.locateConfidence)).toEqual(['low', 'high']);
  });
});
