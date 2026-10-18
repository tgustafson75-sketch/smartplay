/**
 * 2026-10-10 (Tim, after the SmartBay build: "the pointing out and highlighting of issues I've wanted
 * for many months … playback with a pause on the displayed issue and/or highlight of the area", and on
 * the arc: "a real working option … maybe silently on a pass after analysis is done").
 *
 * Every analysed swing stored the frame its fault was read from and the joints each fault lives in;
 * nothing played to that frame or pointed at that place. And the arc the analysis run computed was
 * hidden behind a toggle while, on iOS, every analysis paid the vision model for it.
 *
 * These pin: when the replay stops, what it says, where the ring goes, that the skeleton stays opt-in,
 * that the arc shows by itself, and that only the player's own toggle can pay for one.
 */
import fs from 'fs';
import path from 'path';
import {
  FAULT_REGION_JOINTS,
  FAULT_SPOTLIGHT,
  faultCaption,
  faultMomentFor,
  isSpotlightFault,
  spotlightRing,
} from '../../services/swing/faultSpotlight';
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { runShotDetail, shotRunKey } from '../../services/swing/orchestrator/shotDetail';
import { _clearRunsForTest, liveRun } from '../../services/swing/orchestrator/engine';

const mockArcArgs: Record<string, unknown>[] = [];
jest.mock('../../services/videoUpload', () => ({ resolveClipUri: async (u: string) => u }));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 9000, locateSwingWindow: async () => null }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseAnalysisApi', () => ({ analyzeSwingFromVideo: async () => null, compactPoseFramesForPersist: (f: unknown) => f }));
jest.mock('../../services/swing/clubPath', () => ({
  detectClubPath: async (args: Record<string, unknown>) => { mockArcArgs.push(args); return { points: [], source: 'tracker', rejected: { reason: 'too_few', detected: 0, gate: 'client' } }; },
}));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));
const mockRN = require('react-native') as { Platform: { OS: string } };

const root = path.resolve(__dirname, '../..');
/** Source with comments stripped, so prose naming a thing can never satisfy a guard. */
const code = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
  .replace(/\{\s*\}/g, '{}');

const ANCHORS = { startMs: 5000, topMs: 6000, impactMs: 6400, endMs: 7400 };
const win = { windowStartSec: 4.9, windowEndSec: 7.6 };

describe('when the replay stops', () => {
  it('the read\'s own fault frame wins when it lies in the swing', () => {
    expect(faultMomentFor({ faultId: 'early_extension', readTimestampsSec: [6.2], anchors: ANCHORS, ...win }))
      .toEqual({ sec: 6.2, source: 'read' });
  });
  it('a read frame outside the swing is ignored; the fault\'s phase on the measured anchors stands in', () => {
    expect(faultMomentFor({ faultId: 'early_extension', readTimestampsSec: [1.0], anchors: ANCHORS, ...win }))
      .toEqual({ sec: 6.4, source: 'phase' });                    // impact
    expect(faultMomentFor({ faultId: 'sway', readTimestampsSec: [], anchors: ANCHORS, ...win })?.sec).toBe(6.0);          // top
    expect(faultMomentFor({ faultId: 'over_the_top', readTimestampsSec: [], anchors: ANCHORS, ...win })?.sec).toBeCloseTo(6.16, 5); // transition
    expect(faultMomentFor({ faultId: 'chicken_wing', readTimestampsSec: [], anchors: ANCHORS, ...win })?.sec).toBeCloseTo(6.7, 5);  // through
    expect(faultMomentFor({ faultId: 'poor_finish', readTimestampsSec: [], anchors: ANCHORS, ...win })?.sec).toBe(7.4);   // finish
  });
  it('a moment in the window\'s last frames (where the replay loops back) is held just inside it', () => {
    expect(faultMomentFor({ faultId: 'early_extension', readTimestampsSec: [7.58], anchors: null, ...win })).toBeNull();
    expect(faultMomentFor({ faultId: 'poor_finish', readTimestampsSec: [], anchors: { ...ANCHORS, endMs: 7600 }, ...win })?.sec).toBeCloseTo(7.54, 5);
  });
  it('no real fault, or nothing to time it by → no stop', () => {
    for (const f of [null, undefined, 'none', 'no_clear_fault', 'no_launch', 'inconclusive']) {
      expect(faultMomentFor({ faultId: f, readTimestampsSec: [6.2], anchors: ANCHORS, ...win })).toBeNull();
    }
    expect(faultMomentFor({ faultId: 'sway', readTimestampsSec: [], anchors: null, ...win })).toBeNull();
  });
  it('every fault the overlay can paint can also be timed and captioned — and nothing else', () => {
    expect(Object.keys(FAULT_SPOTLIGHT).sort()).toEqual(Object.keys(FAULT_REGION_JOINTS).sort());
    for (const f of Object.keys(FAULT_SPOTLIGHT)) {
      expect(isSpotlightFault(f)).toBe(true);
      expect(faultCaption(f).look.length).toBeGreaterThan(10);
    }
    expect(faultCaption('early_extension').name).toBe('Early Extension');
    expect(faultCaption('sway').name).toBe('Sway');
  });
});

describe('the caption never covers what it points at', () => {
  it('head and hands-high faults caption at the bottom; hip and impact faults at the top', () => {
    const { calloutAtBottom } = jest.requireActual('../../services/swing/faultSpotlight');
    for (const f of ['head_movement', 'over_the_top', 'sway', 'lead_arm_bent', 'plane_too_flat']) expect(calloutAtBottom(f)).toBe(true);
    for (const f of ['early_extension', 'chicken_wing', 'poor_finish', 'spine_angle_loss']) expect(calloutAtBottom(f)).toBe(false);
  });
});

describe('where the ring goes', () => {
  const kp = (name: string, x: number, y: number, score = 0.9) => ({ name, x, y, score });
  const frame = {
    timestampMs: 6400,
    keypoints: [
      kp('left_shoulder', 0.40, 0.30), kp('right_shoulder', 0.50, 0.30),
      kp('left_hip', 0.42, 0.55), kp('right_hip', 0.50, 0.55),
      kp('left_knee', 0.43, 0.72), kp('right_knee', 0.51, 0.72),
      kp('nose', 0.46, 0.20, 0.05),
    ],
  } as never;
  it('centred on the fault\'s joints, sized to the player', () => {
    const r = spotlightRing(frame, FAULT_REGION_JOINTS.early_extension, 1000, 1000)!;
    expect(r.cx).toBeCloseTo(465, 0);
    expect(r.cy).toBeCloseTo(635, 0);
    expect(r.r).toBeGreaterThan(45);                  // at least ~half a shoulder width (100px)
    expect(r.r).toBeLessThan(200);
  });
  it('a ring on joints the pose could not see is no ring', () => {
    expect(spotlightRing(frame, FAULT_REGION_JOINTS.head_movement, 1000, 1000)).toBeNull();   // nose below the score floor
  });
});

describe('the swing screen stops, rings and names it — the skeleton stays opt-in', () => {
  const sd = code('app/swinglab/swing/[swing_id].tsx');
  it('the playback callback stops on the fault and seeks back to exactly it, only when the setting is on', () => {
    // 2026-10-16 — the crossing rule moved to faultSpotlight.faultPauseTick (tested by behaviour in
    // the-fault-review-shows-only-on-the-fault); the screen feeds it the setting and the latch.
    expect(sd).toMatch(/enabled: pauseOnIssueRef\.current, latched: issuePausedRef\.current/);
    // zero tolerance: iOS otherwise snaps to a keyframe up to a second off the fault
    expect(sd).toMatch(/await videoRef\.current\?\.pauseAsync\(\);\s*await videoRef\.current\?\.setPositionAsync\(Math\.round\(f \* 1000\), \{ toleranceMillisBefore: 0, toleranceMillisAfter: 0 \}\);/);
    // a seek that jumps over the fault is not a crossing; our own seek back never clears the latch
    expect(sd).toMatch(/lastPosSec: lastRawPosRef\.current/);
    expect(sd).toMatch(/selfSeeking: Date\.now\(\) <= selfSeekUntilRef\.current/);
    // the overlay draws at the fault frame, not the overshoot tick
    expect(sd).toMatch(/playbackEmitRef\.current\.pos = f;\s*playbackEmitRef\.current\.lastPosAt = Date\.now\(\);\s*setPosition\(f\);\s*setAtIssue\(true\);/);
    // every scrub lands on its frame
    expect(sd).toMatch(/await videoRef\.current\?\.setPositionAsync\(sec \* 1000, \{ toleranceMillisBefore: 0, toleranceMillisAfter: 0 \}\);/);
    expect(sd).toMatch(/faultSecRef\.current = faultMoment\?\.sec \?\? null;/);
  });
  it('the moment is the SELECTED swing\'s fault, from the one module — and its read frame only when it is that fault', () => {
    expect(sd).toMatch(/faultMomentFor\(\{\s*faultId: displayFault,/);
    expect(sd).toMatch(/const readMatches = !!displayFault && shotFault === displayFault;/);
    expect(sd).toMatch(/readTimestampsSec: readMatches && ts\.length <= 2 \? ts : \[\],/);
  });
  it('the ring needs the highlight setting and the overlay mounts for it without the skeleton', () => {
    expect(sd).toMatch(/const spotlightOn = onIssueFrame && highlightIssue && hasPose && overlayFaultJoints\.length > 0;/);
    expect(sd).toMatch(/showSkeleton \|\| showTrace \|\| motionOnly \|\| spotlightOn\)/);
    expect(sd).toMatch(/spotlight=\{spotlightOn\}/);
    expect(sd).toMatch(/const \[showSkeleton, setShowSkeleton\] = useState\(false\);/);   // still opt-in
  });
  it('both settings persist', () => {
    const st = code('store/settingsStore.ts');
    const part = st.slice(st.indexOf('partialize:'));
    expect(part).toMatch(/swingReviewPauseOnIssue: s\.swingReviewPauseOnIssue/);
    expect(part).toMatch(/swingReviewHighlight: s\.swingReviewHighlight/);
  });
});

describe('SmartMotion\'s review makes the same stop — the swing you just hit', () => {
  const sm = code('app/swinglab/smartmotion.tsx');
  it('times THIS swing\'s fault from its stored read frame, through the one module', () => {
    expect(sm).toMatch(/const reviewFaultId = analysis\?\.primary_fault \?\? analysis\?\.detected_issue \?\? null;/);
    expect(sm).toMatch(/faultMomentFor\(\{\s*faultId: reviewFaultId,/);
    expect(sm).toMatch(/const sh = cageSession\?\.shots\[selectedSwing\];/);
  });
  it('the status handler stops on it (declarative pause too) only with the setting on', () => {
    expect(sm).toMatch(/enabled: pauseOnIssueRef\.current, latched: reviewIssuePausedRef\.current/);
    expect(sm).toMatch(/reviewIssuePausedRef\.current = true;\s*reviewSelfSeekUntilRef\.current = Date\.now\(\) \+ 800;\s*setVideoPaused\(true\);/);
    expect(sm).toMatch(/lastPosSec: reviewLastPosRef\.current, playing: !videoPaused/);
    expect(sm).toMatch(/setPositionAsync\(Math\.round\(f \* 1000\), \{ toleranceMillisBefore: 0, toleranceMillisAfter: 0 \}\)/);
  });
  it('a placed (estimated) pose label is not a timing anchor; the read frame only for the same fault', () => {
    // 2026-10-16 — same intent, stronger: the anchors are MEASURED from this read's motion
    // (poseMotion.anchorsFromPoseFrames, as the library uses). A placed label — a window fraction OR a
    // fixed offset from a located impact ('strike') — times nothing.
    expect(sm).toMatch(/const reviewAnchors = useMemo\(\(\) => anchorsFromPoseFrames\(poseFrames\), \[poseFrames\]\);/);
    expect(sm).toMatch(/const anchors = reviewAnchors;/);
    expect(sm).toMatch(/!!reviewFaultId && shotFault === reviewFaultId && ts\.length <= 2 \? ts : \[\]/);
  });
  it('the ring mounts the overlay without the skeleton, and needs the highlight setting', () => {
    expect(sm).toMatch(/const reviewSpotlightOn = reviewOnIssueFrame && highlightIssue && poseReady && reviewFaultJoints\.length > 0;/);
    expect(sm).toMatch(/\|\|\s*reviewSpotlightOn\s*\) \? \(/);
    expect(sm).toMatch(/spotlight=\{reviewSpotlightOn\}/);
  });
  it('the fault hooks sit above the permission gate (the 08-09 "more hooks" crash)', () => {
    const gate = sm.indexOf('if (!camPerm) {');
    expect(gate).toBeGreaterThan(-1);
    for (const h of ['const [reviewPause, setReviewPause] = useState(', 'const reviewAnchors = useMemo(', 'const reviewStageTimes = useMemo(', 'const reviewFaultMoment = useMemo(', 'const jumpToReviewIssue = useCallback(', 'const [reviewAtIssue, setReviewAtIssue] = useState(']) {
      const at = sm.indexOf(h);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(gate);
    }
  });
});

describe('the arc shows by itself; only the player can pay for one', () => {
  const sd = code('app/swinglab/swing/[swing_id].tsx');
  it('the trace follows the swing on screen (on with a stored arc, off without) until the player touches it; off hides the club', () => {
    expect(sd).toMatch(/if \(!traceTouchedRef\.current\) setShowTrace\(!!\(clubArcPoints && clubArcPoints\.length >= 3\)\);/);
    expect(sd).toMatch(/clubArc=\{showTrace \? clubArcPoints : null\}/);
    // the stored arc is read whether or not the trace is on (it used to be nulled while off)
    expect(sd).not.toMatch(/if \(!showTrace \|\| !session \|\| !shot\) \{ setClubArcPoints\(null\)/);
  });
  it('a shot paged to asks the silent pass; only the touched toggle asks for more', () => {
    expect(sd).toMatch(/const traceAsked = showTrace && traceTouchedRef\.current;/);
    expect(sd).toMatch(/arc: traceAsked \? true : 'tracker'/);
    expect(code('app/swinglab/smartmotion.tsx')).toMatch(/requestShotDetail\(sessionId, sh\.id, \{\s*arc: 'tracker',/);
  });

  // A fresh clip per test: an answered window is remembered for the app session (shotDetail `answered`).
  let clip = 0;
  const seed = () => useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{ id: 's1', source: 'uploaded_video', analysis_status: 'ok', shots: [
      { id: 'a', clipUri: `file:///a${++clip}.mp4`, clipStartSeconds: 5, clipEndSeconds: 7.5, biomechanics: { frames: [{ timestampMs: 5200, keypoints: [] }, { timestampMs: 7000, keypoints: [] }] } },
    ] }] as never,
  });
  const runOnce = async (arc: true | 'tracker') => {
    runShotDetail('s1', 'a', { arc });
    await liveRun(shotRunKey('s1', 'a'))?.done;
  };
  beforeEach(() => { _clearRunsForTest(); mockArcArgs.length = 0; seed(); });

  it('Android: the silent pass runs the tracker and never the paid model', async () => {
    mockRN.Platform.OS = 'android';
    await runOnce('tracker');
    expect(mockArcArgs).toHaveLength(1);
    expect(mockArcArgs[0].trackerOnly).toBe(true);
  });
  it('iOS: the silent pass asks for nothing', async () => {
    mockRN.Platform.OS = 'ios';
    await runOnce('tracker');
    expect(mockArcArgs).toHaveLength(0);
  });
  it('the player\'s toggle may go to the vision model where the tracker cannot run', async () => {
    mockRN.Platform.OS = 'ios';
    await runOnce(true);
    expect(mockArcArgs).toHaveLength(1);
    expect(mockArcArgs[0].trackerOnly).toBe(false);
  });
});
