/**
 * 2026-10-17 — Tim at the range (SmartMotion live capture): "some of the swing arcs get a little crazy".
 * His screenshots: one arc of several overlapping loops (a practice swing / waggle and the swing in one
 * arc window), and one that zig-zags out to the ball and back. Field trace:
 *   `arc anchor · anchorMs=16500 toleranceMs=240 heard=false windowMs=4000`
 *   `club track (on-device) · frames=127 seen=57 kept=53`
 *
 * (1) The arc window was the shot's stored 4s segment (2.5s before a located impact, 1.5s after),
 *     narrowed only past 6s. Whatever else the hands did in those four seconds was tracked as club.
 *     It is now the ONE swing: address → finish from the body read's own hand-height anchors.
 * (A reversal filter on the tracked points was tried and removed the same day: on the range clips it
 *  removed nothing, and it could delete the real impact frame.)
 */
import { oneSwingArcWindow, ARC_BEFORE_ADDRESS_MS, ARC_AFTER_FINISH_MS } from '../../services/swing/clubPathWindow';
import { anchorsFromPoseFrames } from '../../services/swing/poseMotion';
import fx3870 from '../fixtures/clubtrack-3870.json';
import wrists3870 from '../fixtures/locate-3870-wrists.json';
import lily from '../fixtures/lily-4075-wrists.json';
import range1017 from '../fixtures/range-1017-arcs.json';

const mockArcCalls: { startMs: number; endMs: number; impactMs: number | null }[] = [];
jest.mock('../../services/swing/clubPath', () => ({
  detectClubPath: async (a: { startMs: number; endMs: number; impactMs: number | null }) => {
    mockArcCalls.push({ startMs: a.startMs, endMs: a.endMs, impactMs: a.impactMs });
    return { points: [], framesSampled: 10, framesPlanned: 10, frameW: 1080, frameH: 1920, source: 'tracker', rejected: { reason: 'too_few', detected: 0, gate: 'client' } };
  },
}));
jest.mock('../../services/videoUpload', () => ({ resolveClipUri: async (u: string) => u }));
jest.mock('../../services/poseDetection', () => ({ probeDurationMs: async () => 60_000 }));
jest.mock('../../services/capture/clipFps', () => ({ sessionCapturedFps: () => 30 }));
jest.mock('../../store/captureEngineStore', () => ({ useCaptureEngineStore: { getState: () => ({ clubheadNoticeShown: true, markClubheadNoticeShown: () => undefined }) } }));

const frame = (tMs: number, y: number) => ({
  timestampMs: tMs,
  keypoints: [{ name: 'left_wrist', x: 0.5, y, score: 0.9 }, { name: 'right_wrist', x: 0.5, y, score: 0.9 }],
});

/**
 * A 4s window (14.0-18.0s) the way the body read samples it. A practice swing first (hands to 0.50, an
 * unhurried 800ms down), back to address at 15.6-15.8s, then the swing: top 16.4s, impact 16.7s, the
 * held finish to 17.4s.
 */
const PRACTICE_THEN_SWING: [number, number][] = [
  [14000, 0.62], [14200, 0.62], [14400, 0.56], [14600, 0.52], [14800, 0.50], [15000, 0.52], [15200, 0.55], [15400, 0.58],
  [15600, 0.62], [15800, 0.62], [16000, 0.60], [16200, 0.54], [16300, 0.49], [16400, 0.45], [16500, 0.50], [16600, 0.57],
  [16700, 0.61], [16800, 0.55], [16900, 0.48], [17000, 0.46], [17200, 0.45], [17400, 0.46], [17600, 0.50], [17800, 0.55], [18000, 0.58],
];
const framesOf = (s: [number, number][]) => s.map(([t, y]) => frame(t, y));

describe('the arc window is the one swing: address → finish', () => {
  it('a practice swing earlier in the 4s window is outside it', () => {
    const w = oneSwingArcWindow({ startMs: 14000, endMs: 18000 }, framesOf(PRACTICE_THEN_SWING) as never, 16700, false);
    expect(w.bounded).toBe(true);
    expect(w.startMs).toBeGreaterThanOrEqual(15800 - ARC_BEFORE_ADDRESS_MS);
    expect(w.startMs).toBeGreaterThan(15400);                       // after the practice swing came down
    expect(w.endMs).toBeGreaterThanOrEqual(17400);                  // the held finish is in it
    expect(w.endMs).toBeLessThanOrEqual(17400 + ARC_AFTER_FINISH_MS);
  });

  it('never widens the window it was given', () => {
    const w = oneSwingArcWindow({ startMs: 16000, endMs: 17000 }, framesOf(PRACTICE_THEN_SWING) as never, 16700, false);
    expect(w.startMs).toBeGreaterThanOrEqual(16000);
    expect(w.endMs).toBeLessThanOrEqual(17000);
  });

  it('an impact anchor outside the swing the hands describe leaves the window alone (two answers, no guess)', () => {
    const w = oneSwingArcWindow({ startMs: 14000, endMs: 18000 }, framesOf(PRACTICE_THEN_SWING) as never, 15500, false);
    expect(w).toEqual({ startMs: 14000, endMs: 18000, bounded: false });
  });

  it('no usable body read leaves the window alone', () => {
    expect(oneSwingArcWindow({ startMs: 14000, endMs: 18000 }, null, 16700, false).bounded).toBe(false);
    expect(oneSwingArcWindow({ startMs: 14000, endMs: 18000 }, framesOf(PRACTICE_THEN_SWING.slice(0, 3)) as never, null, false).bounded).toBe(false);
  });

  it("Tim's 3870 (strike heard at 7.00s): every point of his validated tracked arc stays inside", () => {
    const frames = (wrists3870 as unknown as { samples: [number, number, number][] }).samples.map(([t, x, y]) => ({ timestampMs: t, keypoints: [{ name: 'left_wrist', x, y, score: 0.9 }, { name: 'right_wrist', x, y, score: 0.9 }] }));
    const w = oneSwingArcWindow({ startMs: 4500, endMs: 8500 }, frames as never, 7000, false);
    expect(w.bounded).toBe(true);
    const ts = (fx3870.points as { t: number }[]).map((p) => p.t);
    expect(w.startMs).toBeLessThanOrEqual(Math.min(...ts));
    expect(w.endMs).toBeGreaterThanOrEqual(Math.max(...ts));
    expect(w.endMs - w.startMs).toBeLessThan(4000);
  });

  it("Lily's 4075 (address ~4.85s, finish ~6.55s): the whole swing is inside, the minute around it is not", () => {
    const l = lily as unknown as { samples: [number, number, number][]; groundTruthMs: { address: number; finish: number } };
    const frames = l.samples.map(([t, x, y]) => ({ timestampMs: t, keypoints: [{ name: 'left_wrist', x, y, score: 0.9 }, { name: 'right_wrist', x, y, score: 0.9 }] }));
    const a = anchorsFromPoseFrames(frames as never);
    expect(a).not.toBeNull();
    const w = oneSwingArcWindow({ startMs: 3500, endMs: 7500 }, frames as never, a!.impactMs, false);
    expect(w.bounded).toBe(true);
    expect(w.startMs).toBeLessThanOrEqual(l.groundTruthMs.address);
    expect(w.endMs).toBeGreaterThanOrEqual(l.groundTruthMs.finish);
    expect(w.endMs - w.startMs).toBeLessThan(4000);
  });
});

/**
 * Tim's two range clips from 10-17 (the app's own 4s segments, the shipped tracker run on them, MediaPipe
 * poses as the body read samples them). On both, what made the arc "crazy" was the tracker following the
 * club AFTER the finish — lowered toward the balls and the basket while he turned to watch — inside the
 * 1.5s the segment keeps after impact. Bounded to the swing, that trail is gone and the swing is all there.
 */
describe("Tim's 10-17 range clips: the arc stops at the finish", () => {
  type Sw = { label: string; segment: { startMs: number; endMs: number }; impactMsFromFrames: number; finishMsFromFrames: number;
    poses: { t: number; kp: Record<string, [number, number, number]> }[]; trackedOnSegment: [number, number, number][] };
  const swings = (range1017 as unknown as { swings: Sw[] }).swings;
  it.each(swings.map((s) => [s.label, s] as const))('%s', (_l, s) => {
    const frames = s.poses.map((p) => ({ timestampMs: p.t, keypoints: Object.entries(p.kp).map(([name, [x, y, score]]) => ({ name, x, y, score })) }));
    const a = anchorsFromPoseFrames(frames as never);
    const w = oneSwingArcWindow(s.segment, frames as never, a?.impactMs ?? null, false);
    expect(w.bounded).toBe(true);
    expect(w.startMs).toBeLessThan(s.impactMsFromFrames - 500);           // the backswing is in it
    expect(w.endMs).toBeGreaterThanOrEqual(s.finishMsFromFrames);         // and the finish
    expect(w.endMs - w.startMs).toBeLessThan(2500);
    // what the segment tracked after the finish (the club lowered by the balls / basket) is outside now
    const trail = s.trackedOnSegment.filter(([t]) => t > w.endMs + 120);
    expect(trail.length).toBeGreaterThanOrEqual(10);
    expect(trail.every(([t]) => t > s.finishMsFromFrames)).toBe(true);
  });

  it('a practice swing and the real swing in one window: the arc is the real one', () => {
    const p = (range1017 as unknown as { practiceThenReal: { practiceTopMs: number; realImpactMs: number; poses: { t: number; kp: Record<string, [number, number, number]> }[] } }).practiceThenReal;
    const frames = p.poses.map((q) => ({ timestampMs: q.t, keypoints: Object.entries(q.kp).map(([name, [x, y, score]]) => ({ name, x, y, score })) }));
    const a = anchorsFromPoseFrames(frames as never);
    const w = oneSwingArcWindow({ startMs: 22000, endMs: 30000 }, frames as never, a?.impactMs ?? null, false);
    expect(w.bounded).toBe(true);
    expect(w.startMs).toBeGreaterThan(p.practiceTopMs + 1000);
    expect(w.startMs).toBeLessThan(p.realImpactMs - 600);
    expect(w.endMs).toBeGreaterThan(p.realImpactMs + 300);
  });
});

describe('the one arc runner tracks only that swing', () => {
  it('the shot run hands detectClubPath the swing, not the 4s segment around it', async () => {
    const { useSwingSessionStore } = await import('../../store/swingSessionStore');
    const { runShotDetail, shotRunKey } = await import('../../services/swing/orchestrator/shotDetail');
    const { _clearRunsForTest, liveRun } = await import('../../services/swing/orchestrator/engine');
    (require('react-native') as { Platform: { OS: string } }).Platform.OS = 'android';
    _clearRunsForTest();
    const bio = { frames: framesOf(PRACTICE_THEN_SWING), angle: 'face_on' };
    useSwingSessionStore.setState({
      activeSession: null,
      sessionHistory: [{
        id: 'sm1', source: 'live_capture', club: 'driver', upload: { duration_sec: null }, analysis_status: 'ok',
        shots: [
          { id: 'sm1_a_cage_shot', clipUri: 'file:///c.mp4', clipStartSeconds: 2, clipEndSeconds: 6, detectionMethod: 'manual', detectionOffsetSeconds: 4.5, biomechanics: { frames: [] }, analysis_version: 1 },
          { id: 'sm1_b_cage_shot', clipUri: 'file:///c.mp4', clipStartSeconds: 14, clipEndSeconds: 18, detectionMethod: 'manual', detectionOffsetSeconds: 16.5, biomechanics: bio, analysis_version: 1 },
        ],
      }] as never,
    });
    mockArcCalls.length = 0;
    const run = runShotDetail('sm1', 'sm1_b_cage_shot', { arc: 'tracker' });
    await run.done;
    expect(liveRun(shotRunKey('sm1', 'sm1_b_cage_shot'))).toBeNull();
    expect(mockArcCalls).toHaveLength(1);
    expect(mockArcCalls[0].startMs).toBeGreaterThan(15400);
    expect(mockArcCalls[0].endMs).toBeLessThanOrEqual(17400 + ARC_AFTER_FINISH_MS);
  });
});
