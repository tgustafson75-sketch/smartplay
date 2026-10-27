/**
 * 2026-10-26 (Tim: "the blue club line stays with the arc, not the golfer's hands") — the tracker's measured
 * grip must survive the shot run's store write. The run used to re-map every arc point to { x, y, tMs }, so a
 * grip the tracker measured never reached the screen and the shaft could only ever be drawn to a guessed hand.
 * Driven through the real shot run (shotDetail) on the real store; only the tracker leaf is stubbed.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { clearAnswered, requestShotDetail } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest } from '../../services/swing/orchestrator/engine';
import { BODY_READ_VERSION, CLUB_ARC_VERSION } from '../../services/swing/analysisVersion';

jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/videoUpload', () => ({ resolveClipUri: async (u: string) => u }));
jest.mock('../../services/relationshipEngine', () => ({ processSwingAnalysis: () => undefined }));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));
jest.mock('../../services/swing/clubPath', () => ({
  detectClubPath: async () => ({
    points: [
      { x: 0.6, y: 0.6, tMs: 0, gx: 0.5, gy: 0.52 },
      { x: 0.7, y: 0.65, tMs: 33 },
      { x: 0.8, y: 0.7, tMs: 66, gx: 0.51, gy: 0.53 },
    ],
    source: 'tracker', frameW: 1080, frameH: 1920,
  }),
}));

const BIO = { frames: [{ timestampMs: 1000, keypoints: [] }, { timestampMs: 2500, keypoints: [] }], angle: 'down_the_line' };

beforeEach(() => {
  _clearRunsForTest();
  clearAnswered('s1');
  (require('react-native') as { Platform: { OS: string } }).Platform.OS = 'android';
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'uploaded_video', analysis_status: 'ok', club: '7i',
      shots: [{
        id: 'sh0', club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: 1, clipEndSeconds: 3,
        biomechanics: BIO, analysis_version: BODY_READ_VERSION,
      }],
    }] as never,
  });
});
afterEach(() => { _clearRunsForTest(); });

it('the arc the run stores keeps each measured grip, stamped with today\'s arc version', async () => {
  await new Promise<void>((res) => { requestShotDetail('s1', 'sh0', { arc: 'tracker', onSettled: res }); });
  const s = useSwingSessionStore.getState().sessionHistory[0] as unknown as { club_arc: unknown[]; club_arc_version: number; shots: { club_arc: { gx?: number; gy?: number; tMs: number }[]; club_arc_version: number }[] };
  const arc = s.shots[0].club_arc;
  expect(arc).toHaveLength(3);
  expect(arc[0]).toMatchObject({ gx: 0.5, gy: 0.52 });
  expect(arc[1].gx).toBeUndefined();
  expect(arc[2]).toMatchObject({ gx: 0.51, gy: 0.53 });
  expect(s.shots[0].club_arc_version).toBe(CLUB_ARC_VERSION);
  expect((s.club_arc as { gx?: number }[])[0].gx).toBe(0.5);   // the first swing's copy on the session too
});
