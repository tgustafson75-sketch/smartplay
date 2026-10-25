/**
 * 2026-10-25 — Sentry SMARTPLAY-CADDIE-MOBILE-N4: an iPhone14,5 on build 31 (the binary before iOS had
 * its pose module), 10-19: `pose_zero_frames · reason no_pose_detector · nativePose false`.
 *
 * Nothing looked at that swing — no on-device engine in the binary, the cloud proxy unconfigured. The
 * body-read stage stored the empty result anyway, and a stored null means "read, nobody there": the
 * stage's `when` never asks again. So once the player took the store update that gives the iPhone its
 * pose module, the swings recorded before it kept "no body read" for good.
 *
 * Driven through the real shot run (services/swing/orchestrator/shotDetail) with the body read stubbed
 * to report what it saw.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { runShotDetail, shotRunKey } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest, liveRun } from '../../services/swing/orchestrator/engine';

const S = { id: '1792900000000_ios31_cage', shot: '1792900000000_ios31_cage_shot', clip: 'file:///docs/rec-ios.mp4' };

/** What the next body read finds: nothing because nothing looked, nobody, or a body. */
let mockNext: 'unanswered' | 'nobody' | 'body' = 'unanswered';
const mockPoseCalls: string[] = [];
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/videoUpload', () => ({ resolveClipUri: async (u: string) => u }));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 4000, locateSwingWindow: async () => null }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({
  analyzeSwingFromVideo: async (uri: string, ...rest: unknown[]) => {
    mockPoseCalls.push(uri);
    const outcome = rest[9] as { unanswered?: boolean } | undefined;   // the 11th parameter
    if (mockNext === 'body') return { frames: [{ timestampMs: 1000, keypoints: [] }], angle: 'face_on' };
    if (outcome) outcome.unanswered = mockNext === 'unanswered';
    return null;
  },
  tempoFromPoseFrames: () => ({ ratio: null }),
  compactPoseFramesForPersist: (f: unknown) => f,
}));
jest.mock('../../services/swing/clubPath', () => ({ detectClubPath: async () => null }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

const shot = () => useSwingSessionStore.getState().sessionHistory.find((s) => s.id === S.id)?.shots[0] as { biomechanics?: unknown } | undefined;
const bodyRead = async () => { await runShotDetail(S.id, S.shot, { arc: false }).done; };

beforeEach(() => {
  mockPoseCalls.length = 0;
  mockNext = 'unanswered';
  _clearRunsForTest();
  (require('react-native') as { Platform: { OS: string } }).Platform.OS = 'ios';
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: S.id, source: 'live_capture', analysis_status: 'ok', club: 'driver', upload: { duration_sec: null },
      shots: [{ id: S.shot, clipUri: S.clip, clipStartSeconds: 0, clipEndSeconds: 4, clipWindowSource: 'auto' }],
    }] as never,
  });
});
afterEach(() => { liveRun(shotRunKey(S.id, S.shot))?.cancel(); });

describe('a body read nothing looked at is asked again', () => {
  it('no detector looked: nothing is stored, so the swing is still unread', async () => {
    await bodyRead();
    expect(mockPoseCalls).toHaveLength(1);
    expect(shot()?.biomechanics).toBeUndefined();
  });

  it('the next time the swing is shown — the detector now in the binary — it is read, and the read stands', async () => {
    await bodyRead();
    mockNext = 'body';
    await bodyRead();
    expect(mockPoseCalls).toHaveLength(2);
    expect((shot()?.biomechanics as { frames?: unknown[] } | null)?.frames?.length).toBe(1);
  });

  it('a detector that LOOKED and found nobody is an answer: stored, and not asked again', async () => {
    mockNext = 'nobody';
    await bodyRead();
    expect(shot()?.biomechanics).toBeNull();
    await bodyRead();
    expect(mockPoseCalls).toHaveLength(1);
  });

  /**
   * Review (10-25): a forced run is a NEW analysis (a trim may have moved the window). If it could not
   * read the body, the old window's skeleton and numbers must not stand in as this one's: back to unread.
   */
  it('a forced re-analysis nothing could look at clears the previous window\'s body read (to unread, not "nobody")', async () => {
    const old = { frames: [{ timestampMs: 500, keypoints: [] }], angle: 'face_on' };
    useSwingSessionStore.setState((st) => ({ sessionHistory: st.sessionHistory.map((x) => ({
      ...x, biomechanics: old, shots: x.shots.map((sh) => ({ ...sh, biomechanics: old })),
    })) }) as never);
    await runShotDetail(S.id, S.shot, { force: true, arc: false }).done;
    expect(mockPoseCalls).toHaveLength(1);
    expect(shot()).not.toHaveProperty('biomechanics');
    expect(useSwingSessionStore.getState().sessionHistory[0]).not.toHaveProperty('biomechanics');
  });
});

