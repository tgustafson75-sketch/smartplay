/**
 * 2026-10-27 (Phase SB4x — review of the CLUB_ARC_VERSION 2 change, "overlay" findings 1 and 3).
 *
 * 1. THE GRIP VERSION RETIRED VISION ARCS TOO. CLUB_ARC_VERSION 2 means "the tracker now returns the grip";
 *    a vision arc never carries a grip and the vision path did not change, so asking again returns the same
 *    kind of arc. Yet a v1 vision arc was hidden (overlayVisibility.drawableClubArc) and not final
 *    (shotDetail.hasFinalArc) — on iOS every old swing paid the vision model again to redraw what it had.
 * 2. iOS SMARTMOTION'S SWING TRACE ASKED FOR NOTHING. Its review asked only the silent tracker pass, which
 *    is skipped where there is no tracker (iOS), whatever the chip said — so the chip lit and toggled to
 *    nothing. The player's tap is now the one ask that may pay (faultSpotlight.reviewShotDetailAsk).
 *
 * Driven through the real shot run (shotDetail.requestShotDetail) on the real store; only the leaves
 * (clip copy, duration probe, the tracker / vision call) are stubbed.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { clearAnswered, requestShotDetail } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest } from '../../services/swing/orchestrator/engine';
import { BODY_READ_VERSION, CLUB_ARC_VERSION } from '../../services/swing/analysisVersion';
import { drawableClubArc } from '../../services/swing/overlayVisibility';
import { reviewShotDetailAsk } from '../../services/swing/faultSpotlight';

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

function seed(arc: Record<string, unknown>): void {
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{
      id: 's1', source: 'live_capture', analysis_status: 'ok', club: '7i',
      biomechanics: read, analysis_version: BODY_READ_VERSION,
      shots: [0, 1].map((i) => ({
        id: `sh${i}`, club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: i * 4, clipEndSeconds: i * 4 + 3,
        biomechanics: read, analysis_version: BODY_READ_VERSION,
        perShotAnalysis: { detected_issue: 'none', primary_fault: null, severity: 'none', confidence: 'high' },
        ...(i === 1 ? arc : {}),
      })),
    }] as never,
  });
}
const s1 = () => useSwingSessionStore.getState().sessionHistory[0];
const settled = (shotId: string, arc: boolean | 'tracker') =>
  new Promise<void>((res) => { requestShotDetail('s1', shotId, { arc, onSettled: res }); });
const setOS = (os: string) => { (require('react-native') as { Platform: { OS: string } }).Platform.OS = os; };

beforeEach(() => {
  _clearRunsForTest();
  clearAnswered('s1');
  mockArcCalls = [];
  setOS('android');
});
afterEach(() => { _clearRunsForTest(); setOS('ios'); });

describe('an arc is current by what produced it: the grip version is the tracker\'s', () => {
  it('THE REPORT: an older build\'s VISION arc is still drawn (no grip was ever part of it)', () => {
    seed({ club_arc: ARC, club_arc_source: 'vision', club_arc_version: 1 });
    expect(drawableClubArc(s1() as never, s1().shots[1] as never)).toHaveLength(3);
  });

  it('an older build\'s TRACKER arc (no grip) is still not drawn, stamped or not', () => {
    seed({ club_arc: ARC, club_arc_source: 'tracker', club_arc_version: 1 });
    expect(drawableClubArc(s1() as never, s1().shots[1] as never)).toBeNull();
    seed({ club_arc: ARC, club_arc_source: 'tracker' });
    expect(drawableClubArc(s1() as never, s1().shots[1] as never)).toBeNull();
    seed({ club_arc: ARC, club_arc_source: 'tracker', club_arc_version: CLUB_ARC_VERSION });
    expect(drawableClubArc(s1() as never, s1().shots[1] as never)).toHaveLength(3);
  });

  it('THE REPORT: on iOS, Swing Trace on an old swing with a stored vision arc does not pay the vision model again', async () => {
    setOS('ios');
    seed({ club_arc: ARC, club_arc_source: 'vision', club_arc_version: 1 });
    await settled('sh1', true);
    expect(mockArcCalls).toEqual([]);
  });

  it('on iOS, an old TRACKER arc is asked again (the grip is new) — the player\'s ask may pay', async () => {
    setOS('ios');
    seed({ club_arc: ARC, club_arc_source: 'tracker', club_arc_version: 1 });
    await settled('sh1', true);
    expect(mockArcCalls).toEqual([{ trackerOnly: false }]);
  });

  it('on Android, a stored vision arc is still retried with the free tracker only (unchanged)', async () => {
    seed({ club_arc: ARC, club_arc_source: 'vision', club_arc_version: 1 });
    await settled('sh1', true);
    expect(mockArcCalls).toEqual([{ trackerOnly: true }]);
  });
});

describe('SmartMotion\'s Swing Trace chip is the player\'s ask (iOS has no free tracker)', () => {
  it('THE REPORT: on iOS, turning Swing Trace on asks for an arc; with it off nothing is tracked', async () => {
    setOS('ios');
    seed({});
    const off = reviewShotDetailAsk({ review: true, traceAsked: false })!;
    await settled('sh1', off.arc!);
    expect(mockArcCalls).toEqual([]);
    const on = reviewShotDetailAsk({ review: true, traceAsked: true })!;
    await settled('sh1', on.arc!);
    expect(mockArcCalls).toEqual([{ trackerOnly: false }]);
  });

  it('paging with the trace off stays the silent free pass; outside review nothing is asked', () => {
    expect(reviewShotDetailAsk({ review: true, traceAsked: false })).toEqual({ arc: 'tracker' });
    expect(reviewShotDetailAsk({ review: false, traceAsked: true })).toBeNull();
  });
});
