/**
 * 2026-10-17 — Tim at the range: "it doesn't correctly analyze the second and third swing. We may have a
 * pause on that when you click on it, then it should analyze, I think… there was a logical way so it
 * didn't cause overloading and crashing or slowness." F2a left it open: "multi-swing captures give the
 * body read + arc only to shot 0 from the run; swings 2+ get theirs only when paged to, and with the
 * cloud read down they get no verdict."
 *
 * The design: a swing the player taps is read THEN, one at a time — never beside swing 1's body read and
 * arc, never beside another swing — and a swing the cloud read did not answer gets its measured verdict.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { runSwingAnalysis } from '../../services/swing/orchestrator/uploadRun';
import { requestShotDetail, shotRunKey, swingRunKey } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest, liveRun } from '../../services/swing/orchestrator/engine';
import { _resetAnalysisTracesForTest } from '../../services/analysisTrace';

const SID = '1792280000000_abc123_cage';
const shotId = (i: number) => `17922800000${i}0_s${i}x${i}x_cage_shot`;
const CLIP = 'file:///docs/rec-range-3.mp4';

type Pending = { window: { startMs: number; endMs: number } | null; resolve: (v: unknown) => void };
const mockDecodes: Pending[] = [];
let mockInFlight = 0;
let mockMaxInFlight = 0;
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/swing/analysisOrchestrator', () => ({ findUploadSwingWindow: async () => ({ via: 'middle', startSec: 0, endSec: 1, impactSec: null }) }));
jest.mock('../../services/videoUpload', () => ({
  // The cloud read is down for the whole capture (Tim's range: a slow link).
  _runPhaseKRead: async () => ({ primary_issue: null, drill_recommendation: null, readFailed: "Couldn't reach the read", analyses: {} }),
  resolveClipUri: async (u: string) => u,
}));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 40_000, locateSwingWindow: async () => null }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: (_u: string, _d: number, _a: unknown, _t: unknown, window: { startMs: number; endMs: number } | null) => {
    mockInFlight++;
    mockMaxInFlight = Math.max(mockMaxInFlight, mockInFlight);
    return new Promise((resolve) => {
      mockDecodes.push({ window, resolve: (v) => { mockInFlight--; resolve(v); } });
    });
  },
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
jest.mock('../../services/swing/poseSwingRead', () => ({
  buildPoseSwingRead: () => ({
    usable: true, dimensions: [], strengths: [], headline: 'Early extension',
    faults: [{ key: 'early_extension', label: 'Early extension', severity: 'moderate', evidence: 'Spine angle rose 20° into impact.' }],
  }),
}));
jest.mock('../../services/swing/clubPath', () => ({ detectClubPath: async () => null }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));
jest.mock('../../services/capture/clipFps', () => ({ sessionCapturedFps: () => 30 }));

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const bio = () => ({ frames: [{ timestampMs: 1000, keypoints: [] }], angle: 'face_on', metric_confidence: {} });
const shot = (i: number) => useSwingSessionStore.getState().sessionHistory[0].shots[i];

beforeEach(() => {
  mockDecodes.length = 0;
  mockInFlight = 0;
  mockMaxInFlight = 0;
  _clearRunsForTest();
  _resetAnalysisTracesForTest();
  (require('react-native') as { Platform: { OS: string } }).Platform.OS = 'android';
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: SID, source: 'live_capture', analysis_status: 'pending', club: 'driver', upload: { duration_sec: null },
      shots: [0, 1, 2].map((i) => ({
        id: shotId(i), clipUri: CLIP, clipStartSeconds: 4 + i * 12, clipEndSeconds: 8 + i * 12,
        detectionMethod: 'manual', detectionOffsetSeconds: 6.5 + i * 12,
      })),
    }] as never,
  });
});

afterEach(() => {
  for (let i = 0; i < 3; i++) liveRun(shotRunKey(SID, shotId(i)))?.cancel();
  liveRun(swingRunKey(SID))?.cancel();
  _resetAnalysisTracesForTest();   // a trace's deadline timer would hold jest open
});

describe('a swing the player taps is read then — one decode at a time', () => {
  it('swing 2 waits for swing 1\'s body read and arc, then reads alone', async () => {
    await runSwingAnalysis(SID);
    await tick(10);
    expect(mockDecodes).toHaveLength(1);                         // swing 1's body read, from the run
    const settled = jest.fn();
    requestShotDetail(SID, shotId(1), { arc: 'tracker', onSettled: settled });   // the player pages to swing 2
    await tick(10);
    expect(mockDecodes).toHaveLength(1);                         // not beside swing 1's decode
    mockDecodes[0].resolve(bio());
    await tick(20);
    expect(mockDecodes).toHaveLength(2);
    expect(mockDecodes[1].window).toEqual({ startMs: 16000, endMs: 20000 });   // swing 2's own window
    expect(settled).not.toHaveBeenCalled();
    mockDecodes[1].resolve(bio());
    await tick(20);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(mockMaxInFlight).toBe(1);
  });

  it('paging 2 → 3 before 2 started: only swing 3 is read, and only after swing 1', async () => {
    await runSwingAnalysis(SID);
    await tick(10);
    const off2 = requestShotDetail(SID, shotId(1), { arc: 'tracker' });
    await tick(5);
    off2();                                                       // the player moved on
    requestShotDetail(SID, shotId(2), { arc: 'tracker' });
    await tick(10);
    expect(mockDecodes).toHaveLength(1);
    mockDecodes[0].resolve(bio());
    await tick(20);
    expect(mockDecodes.map((d) => d.window?.startMs)).toEqual([4000, 28000]);
    expect(mockMaxInFlight).toBe(1);
  });

  it('two swings asked for at once (library + review) still decode one after the other', async () => {
    await runSwingAnalysis(SID);
    await tick(10);
    mockDecodes[0].resolve(bio());
    await tick(20);                                              // the swing's run is done
    requestShotDetail(SID, shotId(1), { arc: 'tracker' });
    requestShotDetail(SID, shotId(2), { arc: 'tracker' });
    await tick(10);
    expect(mockDecodes).toHaveLength(2);
    mockDecodes[1].resolve(bio());
    await tick(20);
    expect(mockDecodes).toHaveLength(3);
    mockDecodes[2].resolve(bio());
    await tick(20);
    expect(mockMaxInFlight).toBe(1);
  });
});

describe('the cloud read down: swings 2+ still get the measured verdict', () => {
  it('swing 2\'s own row is named from its body read, marked measured', async () => {
    await runSwingAnalysis(SID);
    await tick(10);
    mockDecodes[0].resolve(bio());
    await tick(20);
    requestShotDetail(SID, shotId(1), { arc: 'tracker' });
    await tick(10);
    mockDecodes[1].resolve(bio());
    await tick(20);
    const row = shot(1).perShotAnalysis;
    expect(row).toEqual(expect.objectContaining({ primary_fault: 'early_extension', detected_issue: 'early_extension', confidence: 'low', source: 'measured' }));
    expect(row?.observation).toMatch(/Spine angle rose 20/);
    // swing 1 too — the same verdict the run named for the session
    expect(shot(0).perShotAnalysis?.primary_fault).toBe('early_extension');
    expect(useSwingSessionStore.getState().sessionHistory[0].primary_issue?.primary_fault).toBe('early_extension');
  });

  it('a swing the read DID answer keeps the read\'s answer', async () => {
    await runSwingAnalysis(SID);
    await tick(10);
    mockDecodes[0].resolve(bio());
    await tick(20);
    useSwingSessionStore.getState().setShotAnalysis(SID, shotId(1), { detected_issue: 'none', primary_fault: 'over_the_top', severity: 'moderate', confidence: 'high', observation: 'From the read.' });
    requestShotDetail(SID, shotId(1), { arc: 'tracker' });
    await tick(10);
    mockDecodes[1].resolve(bio());
    await tick(20);
    expect(shot(1).perShotAnalysis).toEqual(expect.objectContaining({ primary_fault: 'over_the_top', observation: 'From the read.' }));
  });

  it('a swing whose body read is already stored gets its verdict on tap with no decode at all', async () => {
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((s) => ({ ...s, analysis_status: 'failed', shots: s.shots.map((sh, i) => (i === 2 ? { ...sh, biomechanics: bio(), analysis_version: 1, club_arc_source: 'tracker', club_arc_version: 1 } : sh)) })) }) as never);
    requestShotDetail(SID, shotId(2), { arc: 'tracker' });
    await tick(20);
    expect(mockDecodes).toHaveLength(0);
    expect(shot(2).perShotAnalysis?.source).toBe('measured');
    // one swing measured on the phone is not the session's read succeeding
    expect(useSwingSessionStore.getState().sessionHistory[0].analysis_status).toBe('failed');
  });
});

describe('both review screens ask for the swing on screen', () => {
  // Source check, secondary to the behaviour above (neither screen has a render harness).
  const read = (p: string) => require('fs').readFileSync(require('path').join(__dirname, '..', '..', p), 'utf8') as string;
  it("SmartMotion asks on every page and says ANALYZING while that swing's body read is coming", () => {
    const src = read('app/swinglab/smartmotion.tsx');
    expect(src).toMatch(/return requestShotDetail\(sessionId, sh\.id, \{\s*arc: 'tracker',\s*onSettled:/);
    expect(src).toMatch(/deriveVerdict\(analysis, phase === 'analyzing' \|\| \(phase === 'review' && !analysis && selectedBodyReadPending\)/);
  });
  it('the library asks for any swing past the first that the player selects', () => {
    expect(read('app/swinglab/swing/[swing_id].tsx')).toMatch(/if \(!\(selectedShotIdx > 0 \|\| showSkeleton \|\| traceAsked\)\) return;[\s\S]{0,400}return requestShotDetail\(swing_id, selShot\.id/);
  });
});

/** Review of S2c — SmartMotion's no-launch write-back rebuilds the row; a measured row must stay marked measured. */
describe('the no-launch write-back keeps a measured row measured', () => {
  it('passes the previous source through', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app/swinglab/smartmotion.tsx'), 'utf8') as string;
    const at = src.indexOf("contact_read: 'fat', // a no-launch duff");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 400)).toMatch(/\.\.\.\(prev\?\.source \? \{ source: prev\.source \} : \{\}\),\s*\}\);/);
  });
});
