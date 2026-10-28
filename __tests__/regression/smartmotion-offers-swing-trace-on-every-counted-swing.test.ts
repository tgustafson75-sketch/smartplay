/**
 * 2026-10-27 (Phase SB8, recheck SM-TRACE-GATE).
 *
 * SMARTMOTION HID SWING TRACE ON COUNTED SWINGS. Its review offered the chip only for a "confirmed strike": an
 * accepted ball departure, or a read naming the contact (clean/fat/thin/topped). A counted swing whose read said
 * 'unknown' (or failed), with no departure accepted, had no chip there — while the library traced the same swing.
 * And the chip stays lit when he pages, so on a swing the screen would not draw it still asked arc: true, which on
 * iOS (no tracker) is the paid vision call.
 *
 * One owner for "is this a swing", as on the library: the practice mark (faultSpotlight.reviewTraceOffered). The
 * ask is the player's only where the chip is offered (faultSpotlight.reviewShotDetailAsk). Driven through the real
 * store and the real shot run; only the leaves are stubbed.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { clearAnswered, requestShotDetail } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest } from '../../services/swing/orchestrator/engine';
import { BODY_READ_VERSION } from '../../services/swing/analysisVersion';
import { overlayLayers } from '../../services/swing/overlayVisibility';
import { reviewShotDetailAsk, reviewTraceOffered } from '../../services/swing/faultSpotlight';

let mockArcCalls: { trackerOnly: boolean }[] = [];
jest.mock('../../services/swingLibrary', () => ({ getAnalyzerKind: () => 'full_swing' }));
jest.mock('../../services/videoUpload', () => ({ resolveClipUri: async (u: string) => u }));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 42000, locateSwingWindow: async () => null }));
jest.mock('../../services/swing/clubPath', () => ({
  detectClubPath: async (o: { trackerOnly?: boolean }) => {
    mockArcCalls.push({ trackerOnly: !!o.trackerOnly });
    return { points: [{ x: 0.6, y: 0.6, tMs: 0 }, { x: 0.7, y: 0.7, tMs: 10 }, { x: 0.8, y: 0.8, tMs: 20 }], source: 'vision', frameW: 1080, frameH: 1920 };
  },
}));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));

const read = { frames: [{ timestampMs: 1000, keypoints: [] }, { timestampMs: 2500, keypoints: [] }], angle: 'down_the_line' };
const ARC = [{ x: 0.1, y: 0.1, tMs: 1 }, { x: 0.2, y: 0.2, tMs: 2 }, { x: 0.3, y: 0.3, tMs: 3 }];

function seed(): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'live_capture', analysis_status: 'ok', club: '7i', biomechanics: read, analysis_version: BODY_READ_VERSION,
      shots: [0, 1].map((i) => ({
        id: `sh${i}`, club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: i * 4, clipEndSeconds: i * 4 + 3,
        // Found from the video (no heard strike), so the set's read may demote it; its read says 'unknown'.
        detectionMethod: 'manual', biomechanics: read, analysis_version: BODY_READ_VERSION,
        perShotAnalysis: { detected_issue: 'none', primary_fault: null, severity: 'none', confidence: 'high', contact_read: 'unknown' },
      })),
    }] as never,
  });
}
const shot = (i: number) => useSwingSessionStore.getState().sessionHistory[0].shots[i];
const demote = (i: number) => useSwingSessionStore.getState().setShotPracticeMarks('s1', { [`sh${i}`]: { reason: 'no_ball_seen' } });
const settled = (shotId: string, arc: boolean | 'tracker') =>
  new Promise<void>((res) => { requestShotDetail('s1', shotId, { arc, onSettled: res }); });
const setOS = (os: string) => { (require('react-native') as { Platform: { OS: string } }).Platform.OS = os; };

beforeEach(() => { _clearRunsForTest(); clearAnswered('s1'); mockArcCalls = []; seed(); setOS('ios'); });
afterEach(() => { _clearRunsForTest(); setOS('ios'); });

describe('SmartMotion offers Swing Trace on every counted swing, as the library does', () => {
  it('THE REPORT: a counted swing whose read said "unknown", no departure accepted — the chip is offered and draws', () => {
    expect(reviewTraceOffered(shot(0))).toBe(true);
    const layers = overlayLayers({ userSkeleton: false, userTrace: true, hasPose: true, arc: ARC, shotConfirmed: reviewTraceOffered(shot(0)) });
    expect(layers.trace).toBe(true);
  });

  it('a demoted practice swing is not offered and draws nothing; "Count it" brings it back', () => {
    demote(1);
    expect(reviewTraceOffered(shot(1))).toBe(false);
    expect(overlayLayers({ userSkeleton: false, userTrace: true, hasPose: true, arc: ARC, shotConfirmed: reviewTraceOffered(shot(1)) }).trace).toBe(false);
    useSwingSessionStore.getState().setPracticeSwingRestored('s1', 'sh1', true);
    expect(reviewTraceOffered(shot(1))).toBe(true);
  });
});

describe('a lit chip never pays for an arc the screen will not draw', () => {
  it('THE REPORT: Trace on for swing 1, he pages to a practice swing on iOS — no vision call', async () => {
    demote(1);
    const ask = reviewShotDetailAsk({ review: true, traceAsked: true, shot: shot(1) })!;
    expect(ask).toEqual({ arc: 'tracker' });
    await settled('sh1', ask.arc);
    expect(mockArcCalls).toEqual([]);
  });

  it('guard: on a counted swing the lit chip is his ask and may pay', async () => {
    const ask = reviewShotDetailAsk({ review: true, traceAsked: true, shot: shot(1) })!;
    expect(ask).toEqual({ arc: true });
    await settled('sh1', ask.arc);
    expect(mockArcCalls).toEqual([{ trackerOnly: false }]);
  });
});
