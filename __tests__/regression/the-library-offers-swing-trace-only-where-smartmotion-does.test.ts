/**
 * 2026-10-27 (Phase SB8, recheck round 13: SB8-LIB-TRACE-PRACTICE).
 *
 * THE LIBRARY STILL TRACED A PRACTICE SWING. SB8 hid SmartMotion's Swing Trace chip on a demoted practice swing
 * and stopped it asking arc: true there, "as on the library" — but the library did neither. Its Swing Trace
 * button was always shown, the lit trace stays on while he pages the reel, shotDetailRequestFor answered
 * { arc: true } for every swing (on iOS, or Android with no tracker, the paid vision call) and overlayLayers
 * drew the arc on the practice swing. The same swing in SmartMotion had no Trace chip at all.
 *
 * One gate on both screens (faultSpotlight.reviewTraceOffered): driven through the real store and the real
 * shot run; only the leaves are stubbed. The screen's wiring is pinned below.
 */
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { clearAnswered, requestShotDetail } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest } from '../../services/swing/orchestrator/engine';
import { BODY_READ_VERSION } from '../../services/swing/analysisVersion';
import { overlayLayers } from '../../services/swing/overlayVisibility';
import { reviewShotDetailAsk, reviewTraceOffered, shotDetailRequestFor } from '../../services/swing/faultSpotlight';
import fs from 'fs';
import path from 'path';

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

describe('the library offers Swing Trace only where SmartMotion does', () => {
  it('THE REPORT: Trace lit on swing 1, he pages onto a practice swing on iOS — no arc: true, no vision call, no trace', async () => {
    demote(1);
    expect(reviewTraceOffered(shot(1))).toBe(false);
    const ask = shotDetailRequestFor({ idx: 1, showSkeleton: false, traceAsked: true, issueAsked: false, shot: shot(1) })!;
    expect(ask).toEqual({ arc: 'tracker' });
    await settled('sh1', ask.arc!);
    expect(mockArcCalls).toEqual([]);
    expect(overlayLayers({ userSkeleton: false, userTrace: true, hasPose: true, arc: ARC, shotConfirmed: reviewTraceOffered(shot(1)) }).trace).toBe(false);
  });

  it('a practice swing 1 with the trace lit and nothing else asks for nothing (the library is manual)', () => {
    demote(0);
    expect(shotDetailRequestFor({ idx: 0, showSkeleton: false, traceAsked: true, issueAsked: false, shot: shot(0) })).toBeNull();
  });

  it('both screens ask the same for the same swing', () => {
    demote(1);
    for (const i of [0, 1]) {
      expect(shotDetailRequestFor({ idx: i, showSkeleton: false, traceAsked: true, issueAsked: false, shot: shot(i) })?.arc ?? 'tracker')
        .toEqual(reviewShotDetailAsk({ review: true, traceAsked: true, shot: shot(i) })!.arc);
    }
  });

  it('guard: on a counted swing the lit trace is his ask and may pay; "Count it" brings it back', async () => {
    demote(1);
    useSwingSessionStore.getState().setPracticeSwingRestored('s1', 'sh1', true);
    const ask = shotDetailRequestFor({ idx: 1, showSkeleton: false, traceAsked: true, issueAsked: false, shot: shot(1) })!;
    expect(ask).toEqual({ arc: true });
    await settled('sh1', ask.arc!);
    expect(mockArcCalls).toEqual([{ trackerOnly: false }]);
  });

  it('the library screen wires the one gate: button, ask, drawn trace, note and the baked still', () => {
    const lib = fs.readFileSync(path.join(__dirname, '../../app/swinglab/swing/[swing_id].tsx'), 'utf8');
    expect(lib).toMatch(/const traceOffered = reviewTraceOffered\(shot\);/);
    expect(lib).toMatch(/\{traceOffered && \(\s*<TouchableOpacity[^>]*?onPress=\{\(\) => setShowTrace\(v => !v\)\}/);
    expect(lib).toMatch(/shotDetailRequestFor\(\{[^)]*traceAsked: showTrace,[^)]*shot: selShot \}\)/);
    expect(lib).toMatch(/const layers = overlayLayers\(\{[^)]*shotConfirmed: traceOffered,/);
    expect(lib).toMatch(/const traceNote = swingTraceNote\(\{\s*wanted: showTrace && traceOffered,/);
    expect(lib).toMatch(/clubArc: traceOffered \? clubArcPoints : null,/);
  });
});
