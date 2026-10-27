/**
 * 2026-10-25 — Sentry SMARTPLAY-CADDIE-MOBILE-MK, MW, MV, MT, MY, MZ, N3 (Tim's Fold3, 10-17, live
 * captures): `analysis_failed · source live_capture · failure_kinds [no_network ×1-3]`.
 *
 * The swing was kept; its read was dropped. The player was told "Lost connection to the analyzer. Check
 * your network and try Re-analyze" — and nothing ever read that swing unless he went back and tapped. (On
 * the 10-17 builds most of those were not even offline: our own probe timing out was read as no network,
 * fixed by F1a. This is the case that remains: the phone really had no signal.)
 *
 * Now a read the phone was PROVEN offline for marks the swing, raises the offline banner, and the read
 * is sent when the connection comes back. A failure that is not proven offline is not marked: nothing
 * would come along to read it, so the player is not promised that it will.
 *
 * Driven through the real read (videoUpload._runPhaseKRead) and the real drain, with analyzeSwing and
 * the reachability verdict stubbed.
 */
let mockRead: 'no_network' | 'ok' = 'no_network';
let mockVerdict: 'offline' | 'captive' | 'internet_ok' | 'slow' = 'offline';
const mockReads: string[] = [];

jest.mock('../../services/poseDetection', () => ({
  analyzeSwing: async (uri: string) => {
    mockReads.push(uri);
    if (mockRead === 'no_network') return { kind: 'no_network' };
    return {
      kind: 'ok',
      analysis: {
        detected_issue: 'over_the_top', severity: 'moderate', confidence: 'high', observation: 'steep',
        fault_frame_index: -1, primary_fault: 'over_the_top',
        phases_visible: { address: true, top: true, impact: true, finish: true },
      },
      locate_degraded: null, frame_timestamps_sec: [], fault_frame_uri: null, fault_frame_display_uri: null, fault_frame_fraction: null,
    };
  },
  analyzeSwingTentative: async () => ({ kind: 'no_network' }),
  probeDurationMs: async () => 4000,
  locateSwings: async () => [],
}));
jest.mock('../../services/reachability', () => ({
  ...jest.requireActual('../../services/reachability'),
  probeReachability: async () => ({ verdict: mockVerdict, via: null, controlMs: null, at: Date.now() }),
  lastReachability: () => null,
}));
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/swingCommentaryService', () => ({ getTranscriptionStatus: () => 'done' }));
// The run's later stages (body read, arc) are not what this is about: they answer at once.
jest.mock('../../services/swing/analysisOrchestrator', () => ({ findUploadSwingWindow: async () => ({ via: 'middle', startSec: 0, endSec: 1, impactSec: null }) }));
/** Clips whose body read is held open until released (a live capture's decode in progress). */
const mockHeld: Record<string, (() => void) | null> = {};
const mockBodyReads: string[] = [];
const release = (uri: string) => { mockHeld[uri]?.(); };
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: (uri: string) => {
    mockBodyReads.push(uri);
    if (!(uri in mockHeld)) return Promise.resolve(null);
    return new Promise((resolve) => { mockHeld[uri] = () => resolve(null); });
  },
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/swing/clubPath', () => ({ detectClubPath: async () => null }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../services/contextSynthesizer', () => ({ synthesizeCageInsight: async () => null }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

import { useSwingSessionStore } from '../../store/swingSessionStore';
import { useConnectivityStore } from '../../store/connectivityStore';
import { _runPhaseKRead, OFFLINE_READ_WAITS } from '../../services/videoUpload';
import { readAwaitingSwings, sessionsAwaitingConnection, startReadWhenOnline } from '../../services/swing/orchestrator/readWhenOnline';
import { runSwingAnalysis } from '../../services/swing/orchestrator/uploadRun';
import { _clearRunsForTest, liveRunKeys, liveRun } from '../../services/swing/orchestrator/engine';

const session = (id: string) => useSwingSessionStore.getState().sessionHistory.find((s) => s.id === id);
const seed = (...ids: string[]) => useSwingSessionStore.setState({
  activeSession: null,
  hasHydrated: true,
  sessionHistory: ids.map((id, n) => ({
    id, date: 1_000 + n, source: 'live_capture', analysis_status: 'pending', club: '7i',
    shots: [{ id: `${id}_shot`, club: '7i', clipUri: `https://clips/${id}.mp4`, clipStartSeconds: 1, clipEndSeconds: 3 }],
  })) as never,
});
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

afterEach(() => { for (const k of liveRunKeys()) liveRun(k)?.cancel(); });
// The read's diagnostics start the analytics flush interval; stop it so the suite can exit.
afterAll(() => { require('../../services/analytics').teardownAnalytics(); });

beforeEach(async () => {
  await tick(50);   // let the previous test's connectivity verdicts land before this one resets them
  mockRead = 'no_network';
  mockVerdict = 'offline';
  mockReads.length = 0;
  mockBodyReads.length = 0;
  for (const k of Object.keys(mockHeld)) delete mockHeld[k];
  _clearRunsForTest();
  useConnectivityStore.setState({ isOnline: true, consecutiveFailures: 0 });
});

describe('a read the phone was proven offline for waits for the connection', () => {
  it('proven offline: the swing is marked, the player is told it will be read, the banner goes up', async () => {
    seed('s1');
    const r = await _runPhaseKRead('s1');
    expect(session('s1')?.read_awaits_connection).toBe(true);
    expect(r.readFailed).toBe(OFFLINE_READ_WAITS);
    expect(useConnectivityStore.getState().isOnline).toBe(false);
  });

  it('a captive Wi-Fi is offline too', async () => {
    seed('s1');
    mockVerdict = 'captive';
    await _runPhaseKRead('s1');
    expect(session('s1')?.read_awaits_connection).toBe(true);
  });

  it('NOT proven offline (the internet answered): not marked, and nothing promises a read that will not come', async () => {
    seed('s1');
    mockVerdict = 'internet_ok';
    const r = await _runPhaseKRead('s1');
    expect(session('s1')?.read_awaits_connection ?? false).toBe(false);
    expect(r.readFailed).not.toBe(OFFLINE_READ_WAITS);
  });

  it('a read that comes back clears the mark', async () => {
    seed('s1');
    await _runPhaseKRead('s1');
    mockRead = 'ok';
    await _runPhaseKRead('s1');
    expect(session('s1')?.read_awaits_connection).toBe(false);
  });
});

describe('the waiting reads are sent when the connection comes back', () => {
  it('offline → online: every waiting swing is read, oldest first, and none is left waiting', async () => {
    seed('old', 'new');
    await _runPhaseKRead('old');
    await _runPhaseKRead('new');
    expect(sessionsAwaitingConnection()).toEqual(['old', 'new']);
    const stop = startReadWhenOnline({ launchDelayMs: 60_000 });
    try {
      mockReads.length = 0;
      mockRead = 'ok';
      useConnectivityStore.getState().reportOnline();   // the banner's recovery probe found the internet
      for (let i = 0; i < 50 && sessionsAwaitingConnection().length > 0; i++) await tick(20);
      expect(mockReads).toEqual(['https://clips/old.mp4', 'https://clips/new.mp4']);
      expect(sessionsAwaitingConnection()).toEqual([]);
      expect(session('old')?.primary_issue).toBeTruthy();
    } finally { stop(); }
  });

  it('still offline when it tries: the swing keeps waiting for the next return', async () => {
    seed('s1');
    await _runPhaseKRead('s1');
    useConnectivityStore.setState({ isOnline: true });
    await readAwaitingSwings();
    for (let i = 0; i < 20; i++) await tick(10);
    expect(session('s1')?.read_awaits_connection).toBe(true);
  });

  it('swings left waiting by an earlier launch are read at launch', async () => {
    seed('s1');
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((s) => ({ ...s, read_awaits_connection: true, analysis_status: 'failed' })) }) as never);
    mockRead = 'ok';
    const stop = startReadWhenOnline({ launchDelayMs: 0 });
    try {
      for (let i = 0; i < 50 && sessionsAwaitingConnection().length > 0; i++) await tick(20);
      expect(mockReads).toEqual(['https://clips/s1.mp4']);
      expect(session('s1')?.read_awaits_connection).toBe(false);
    } finally { stop(); }
  });
});

/**
 * Review (10-25) — every run's body read shares the one frame decoder. A drained swing's body-read tail
 * queued ahead of the swing the player had just hit could run that one out of its budget. The drain
 * waits for live swing runs, and sends the next waiting read only after the previous run has finished.
 */
describe('a waiting read never competes with a live swing', () => {
  const flag = (...ids: string[]) => useSwingSessionStore.setState((st) => ({
    sessionHistory: st.sessionHistory.map((x) => (ids.includes(x.id) ? { ...x, read_awaits_connection: true, analysis_status: 'failed' } : x)),
  }) as never);
  const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await tick(20); };

  it('the signal returns while the player\'s capture is still being read: the waiting swing goes after it', async () => {
    seed('waiting', 'live');
    flag('waiting');
    mockRead = 'ok';
    mockHeld['https://clips/live.mp4'] = null;
    void runSwingAnalysis('live');
    await until(() => mockBodyReads.includes('https://clips/live.mp4'));   // the live swing is decoding
    void readAwaitingSwings();
    await tick(200);
    expect(mockReads).not.toContain('https://clips/waiting.mp4');
    release('https://clips/live.mp4');
    await until(() => mockReads.includes('https://clips/waiting.mp4'));
    expect(mockReads).toContain('https://clips/waiting.mp4');
  });

  it('two waiting swings: the second is not read until the first one\'s body read has finished', async () => {
    seed('first', 'second');
    flag('first', 'second');
    mockRead = 'ok';
    mockHeld['https://clips/first.mp4'] = null;
    void readAwaitingSwings();
    await until(() => mockBodyReads.includes('https://clips/first.mp4'));
    await tick(200);
    expect(mockReads).toEqual(['https://clips/first.mp4']);
    release('https://clips/first.mp4');
    await until(() => mockReads.length === 2);
    expect(mockReads).toEqual(['https://clips/first.mp4', 'https://clips/second.mp4']);
  });
});


/**
 * 2026-10-27 (Phase SB4x — review finding "reanalyze #2"). The waiting read went through the one run like a
 * Re-analyze, and the run's invalidation (uploadRun.invalidateForReanalysis) wiped every swing's body read
 * and arc. A live capture's swings did not move — its split fused what the microphone heard — and its
 * swings 2+ were read on the device while the phone had no signal; only swing 1 is read again by the run.
 * The read that waited is the FIRST read of those swings, not a second look at them.
 */
describe('the waiting read keeps what the capture already measured', () => {
  const read = { frames: [{ timestampMs: 1, keypoints: [] }, { timestampMs: 2, keypoints: [] }], angle: 'down_the_line' };
  const arc = [{ x: 0.1, y: 0.2, t: 1 }];
  const seedTwoSwings = (source: 'live_capture' | 'uploaded_video') => {
    const { BODY_READ_VERSION, CLUB_ARC_VERSION } = require('../../services/swing/analysisVersion');
    useSwingSessionStore.setState({
      activeSession: null, hasHydrated: true,
      sessionHistory: [{
        id: 'w', date: 1, source, analysis_status: 'failed', club: '7i', read_awaits_connection: true,
        shots: [0, 1].map((i) => ({
          id: `w_shot_${i}`, club: '7i', clipUri: 'https://clips/w.mp4', clipStartSeconds: 1 + i * 4, clipEndSeconds: 3 + i * 4,
          biomechanics: read, analysis_version: BODY_READ_VERSION,
          club_arc: arc, club_arc_source: 'tracker', club_arc_version: CLUB_ARC_VERSION,
        })),
      }] as never,
    });
  };
  const shot1 = () => session('w')?.shots[1] as unknown as { biomechanics?: unknown; club_arc?: unknown };

  it('THE REPORT: a live capture\'s swing 2 keeps its body read and arc when the signal comes back', async () => {
    seedTwoSwings('live_capture');
    mockRead = 'ok';
    await readAwaitingSwings();
    for (let i = 0; i < 50 && liveRunKeys().length > 0; i++) await tick(20);
    expect(mockReads).toContain('https://clips/w.mp4');
    expect(session('w')?.read_awaits_connection).toBe(false);
    expect(shot1().biomechanics).toEqual(read);
    expect(shot1().club_arc).toEqual(arc);
  });

  it('a Re-analyze the player asks for still clears every swing (it is a second look)', async () => {
    seedTwoSwings('live_capture');
    mockRead = 'ok';
    const p = runSwingAnalysis('w');
    expect(shot1().biomechanics).toBeUndefined();
    await p;
  });

  it('an upload that waited is still cleared: its swings are split online, so its windows may move', async () => {
    seedTwoSwings('uploaded_video');
    mockRead = 'ok';
    const p = readAwaitingSwings();
    await tick(0);
    expect(shot1().biomechanics).toBeUndefined();
    await p;
  });
});
