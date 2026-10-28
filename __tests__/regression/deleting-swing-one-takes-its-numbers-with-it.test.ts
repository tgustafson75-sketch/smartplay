/**
 * 2026-10-27 (Phase SB7, recheck R9 "E-R9-1") — deleting swing 1 of a multi-swing set (the "•••" sheet →
 * Delete) only filtered the shot out. The SmartMotion shot map is swing 1's by position (swingIndex 0) and
 * the session-level body read, arc and fault frame are the first clip-bearing swing's, so the swing that
 * moved into first place showed swing 1's tempo, start line, carry, BODY tiles, skeleton and arc — and the
 * caddie was told they were that swing's measured numbers — until a Re-analyze.
 *
 * Also: a read of swing 1 still out when it is deleted must not write the deleted swing's skeleton back
 * onto the session (the new swing 1's copies). Driven through the real store and the real shot run; only
 * the leaves (clip copy, duration probe, the body read) are stubbed.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { clearAnswered, requestShotDetail, shotRunKey, shownShotBiomech } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest, liveRun } from '../../services/swing/orchestrator/engine';
import { BODY_READ_VERSION, CLUB_ARC_VERSION } from '../../services/swing/analysisVersion';
import { shotMapForShot } from '../../services/swing/smartMotionShotMap';
import { swingOnScreenFromShotMap } from '../../services/swing/swingOnScreen';

const mockReads: ((v: unknown) => void)[] = [];
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/videoUpload', () => ({ resolveClipUri: async (u: string) => u }));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 12_000, locateSwingWindow: async () => null }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: () => new Promise((resolve) => { mockReads.push(resolve); }),
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
jest.mock('../../services/swing/clubPath', () => ({ detectClubPath: async () => null }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));
jest.mock('../../services/capture/clipFps', () => ({ sessionCapturedFps: () => 30 }));

const SID = 'motion_set';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const read = { frames: [{ timestampMs: 1000, keypoints: [] }, { timestampMs: 2500, keypoints: [] }], angle: 'down_the_line', metric_confidence: {} };
const ARC = [{ x: 0.1, y: 0.1, tMs: 1 }, { x: 0.2, y: 0.2, tMs: 2 }, { x: 0.3, y: 0.3, tMs: 3 }];
const MAP = {
  swingIndex: 0, estCarry: 152, effortPct: 80, trace: { side: 'right', divergenceDeg: 4 },
  tempo: { ratio: 3.1, backswingMs: 780, downswingMs: 250, sequencingScore: null },
  bodyItems: [{ key: 'sway', label: 'Sway', tone: 'warn' as const }],
};
const s = () => useSwingSessionStore.getState().sessionHistory[0];

function seed(swingOneRead: boolean): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: SID, source: 'live_capture', analysis_status: 'ok', club: '7i',
      ...(swingOneRead ? {
        biomechanics: read, analysis_version: BODY_READ_VERSION,
        club_arc: ARC, club_arc_source: 'tracker', club_arc_version: CLUB_ARC_VERSION,
        fault_frame_uri: 'file:///fault.jpg', fault_frame_index: 2, fault_frame_fraction: 0.6,
      } : {}),
      smart_motion_shot_map: MAP,
      // Only swing 1 was read: swings 2 and 3 have no read of their own.
      shots: [0, 1, 2].map((i) => ({ id: `sh${i}`, club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: i * 4, clipEndSeconds: i * 4 + 3 })),
    }] as never,
  });
}

beforeEach(() => {
  mockReads.length = 0;
  _clearRunsForTest();
  clearAnswered(SID);
  (require('react-native') as { Platform: { OS: string } }).Platform.OS = 'android';
});

afterEach(() => { for (let i = 0; i < 3; i++) liveRun(shotRunKey(SID, `sh${i}`))?.cancel(); });

describe('deleting swing 1', () => {
  it('the swing that moves into first place carries none of swing 1\'s numbers, read, arc or fault frame', () => {
    seed(true);
    expect(shownShotBiomech(s(), 0)).toBe(read);                                 // swing 1's, before
    useSwingSessionStore.getState().deleteShot(SID, 'sh0');
    expect(s().shots.map((x) => x.id)).toEqual(['sh1', 'sh2']);
    expect(shotMapForShot(s().smart_motion_shot_map, 0, 2)).toBeNull();
    expect(swingOnScreenFromShotMap(s().smart_motion_shot_map, 0, 2)?.tempo ?? null).toBeNull();
    expect(swingOnScreenFromShotMap(s().smart_motion_shot_map, 0, 2)?.launch ?? null).toBeNull();
    expect(swingOnScreenFromShotMap(s().smart_motion_shot_map, 0, 2)?.estCarryYds ?? null).toBeNull();
    expect(shownShotBiomech(s(), 0)).toBeNull();
    expect(s().club_arc).toBeUndefined();
    expect(s().club_arc_source).toBeUndefined();
    expect(s().fault_frame_index ?? null).toBeNull();
    expect(s().fault_frame_uri ?? null).toBeNull();
  });

  it('deleting a later swing leaves swing 1\'s own copies where they are', () => {
    seed(true);
    useSwingSessionStore.getState().deleteShot(SID, 'sh2');
    expect(shotMapForShot(s().smart_motion_shot_map, 0, 2)).toEqual(MAP);
    expect(shownShotBiomech(s(), 0)).toBe(read);
    expect(s().club_arc).toEqual(ARC);
    expect(s().fault_frame_index).toBe(2);
  });

  it('a read of swing 1 that lands after it was deleted is not put on the new swing 1', async () => {
    seed(false);
    requestShotDetail(SID, 'sh0', { arc: false });                               // swing 1 is being read
    await tick(10);
    expect(mockReads).toHaveLength(1);
    useSwingSessionStore.getState().deleteShot(SID, 'sh0');
    mockReads[0](read);
    await tick(30);
    expect(s().biomechanics).toBeUndefined();
    expect(shownShotBiomech(s(), 0)).toBeNull();
  });
});
