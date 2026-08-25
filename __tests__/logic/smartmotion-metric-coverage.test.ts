/**
 * 2026-08-24 (Tim: "check all smartmotion data points for all versions") — WHICH METRICS EACH CAMERA
 * ANGLE CAN HONESTLY PRODUCE.
 *
 * The pose pipeline is angle-aware on purpose, and the reasons are geometric, not arbitrary:
 *   - from DOWN THE LINE the shoulders/hips foreshorten, so turn angles read inverted and the
 *     lateral-x weight shift is actually depth. Those are nulled rather than guessed.
 *   - from FACE ON the projected shoulder TILT inflates toward 90° as the turn grows
 *     (atan(tan φ / cos θ)), so a perfect ~30° tour tilt at an 80° turn projects to ~73° and would
 *     read as a false "exaggerated dip". Tilt is valid DTL and invalid face-on.
 *   - GLASSES POV satisfies neither geometry, so everything angular is nulled.
 *
 * This pins the coverage matrix so a future change cannot quietly start reporting a number the
 * camera angle cannot measure — which is the failure this gating exists to prevent, and which
 * happened twice before (biomech audit #3 and #4, both 2026-07-07).
 */
import { computeBiomechanicsFromFrames, type PoseFrame, type Keypoint } from '../../services/poseAnalysisApi';

const NAMES = ['nose','left_eye','right_eye','left_ear','right_ear','left_shoulder','right_shoulder',
  'left_elbow','right_elbow','left_wrist','right_wrist','left_hip','right_hip','left_knee','right_knee',
  'left_ankle','right_ankle'];

/** A plausible face-on golfer at a given phase: shoulders/hips rotate, weight moves, arm bends. */
function frame(position: PoseFrame['position'], t: number, turn: number, shift: number, armBend: number, shoulderHalf = 0.11): PoseFrame {
  const cx = 0.5 + shift * 0.06;              // lateral centre moves with weight
  const halfSh = shoulderHalf * Math.cos(turn * Math.PI / 180);   // width foreshortens with turn
  const halfHip = (shoulderHalf * 0.73) * Math.cos(turn * 0.6 * Math.PI / 180);
  const put = (name: string, x: number, y: number): Keypoint => ({ x, y, score: 0.95, name });
  const kp: Keypoint[] = NAMES.map(n => put(n, 0.5, 0.5));
  const set = (n: string, x: number, y: number) => { const i = NAMES.indexOf(n); kp[i] = put(n, x, y); };
  set('nose', cx, 0.18);
  set('left_shoulder', cx - halfSh, 0.30); set('right_shoulder', cx + halfSh, 0.30 - turn * 0.0008);
  set('left_elbow', cx - halfSh - 0.03, 0.42); set('right_elbow', cx + halfSh + 0.03, 0.42);
  set('left_wrist', cx - halfSh - 0.02 - armBend * 0.02, 0.50);
  set('right_wrist', cx + halfSh + 0.02, 0.50);
  set('left_hip', cx - halfHip, 0.55); set('right_hip', cx + halfHip, 0.55);
  set('left_knee', cx - halfHip, 0.72); set('right_knee', cx + halfHip, 0.72);
  set('left_ankle', 0.5 - 0.08, 0.92); set('right_ankle', 0.5 + 0.08, 0.92);
  return { timestampMs: t, position, keypoints: kp, frameW: 1080, frameH: 1920 };
}

/**
 * services/cameraAngleInference decides the angle from shoulderWidth / torsoHeight: below 0.35 is
 * edge-on (down-the-line), above 0.60 is front-on (face-on). That inference OVERRIDES an explicit
 * label when it confidently disagrees — added 2026-07-30 after Tim recorded down-the-line but the
 * toggle said face-on in daylight glare, and the metrics branched on the wrong geometry.
 *
 * So a test cannot simply PASS 'down_the_line' with front-on frames and expect DTL behaviour; the
 * inference will correctly overrule it. (It overruled mine, and for a moment it looked like the
 * angle gate was broken.) Each angle gets frames whose geometry genuinely reads that way.
 */
const swing = (shoulderHalf: number): PoseFrame[] => [
  frame('P1_address', 0, 0, 0, 0, shoulderHalf),
  frame('P2_takeaway', 300, 25, -0.2, 0, shoulderHalf),
  frame('P4_top', 800, 85, -0.5, 0.3, shoulderHalf),
  frame('P6_impact', 1100, 35, 0.7, 0.1, shoulderHalf),
  frame('P10_finish', 1600, 100, 1.0, 0.4, shoulderHalf),
];
/** Broad across the frame — the camera is in front of the player. */
const frames = swing(0.11);
/** Stacked/edge-on — the camera is behind, down the target line. */
const dtlFrames = swing(0.030);


const METRICS = (b: ReturnType<typeof computeBiomechanicsFromFrames>) => ({
  hipTurnDeg: b.hipTurnDeg, shoulderTurnDeg: b.shoulderTurnDeg, shoulderTiltDeg: b.shoulderTiltDeg,
  weightShiftPct: b.weightShiftPct, spineAngleDeltaDeg: b.spineAngleDeltaDeg,
  headDriftPxNorm: b.headDriftPxNorm, hipSlideRatio: b.hipSlideRatio, sequencingScore: b.sequencingScore,
  leadArmTopDeg: b.leadArmTopDeg, leadArmImpactDeg: b.leadArmImpactDeg,
  swayNorm: b.swayNorm, finishWeightPct: b.finishWeightPct,
});
const populated = (angle: 'face_on' | 'down_the_line' | 'glasses_pov') =>
  Object.entries(METRICS(computeBiomechanicsFromFrames(
    angle === 'down_the_line' ? dtlFrames : frames, angle, 'right')))
    .filter(([, v]) => v != null).map(([k]) => k).sort();

describe('SmartMotion metric coverage, per camera angle', () => {
  it('FACE-ON reads the turn metrics, the weight shift and the sequence', () => {
    const have = populated('face_on');
    for (const m of ['hipTurnDeg', 'shoulderTurnDeg', 'weightShiftPct', 'sequencingScore', 'hipSlideRatio']) {
      expect(have).toContain(m);
    }
  });

  it('...and correctly REFUSES shoulder tilt, which face-on geometry inflates', () => {
    expect(populated('face_on')).not.toContain('shoulderTiltDeg');
  });

  it('DOWN-THE-LINE refuses the turn metrics and the lateral weight shift', () => {
    const have = populated('down_the_line');
    for (const m of ['hipTurnDeg', 'shoulderTurnDeg', 'weightShiftPct', 'sequencingScore', 'hipSlideRatio']) {
      expect(have).not.toContain(m);
    }
  });

  it('GLASSES POV refuses every angular metric — it satisfies neither geometry', () => {
    const have = populated('glasses_pov');
    for (const m of ['hipTurnDeg', 'shoulderTurnDeg', 'weightShiftPct', 'sequencingScore', 'hipSlideRatio', 'shoulderTiltDeg']) {
      expect(have).not.toContain(m);
    }
  });

  it('FACE-ON is the richest angle — strictly more than down-the-line', () => {
    expect(populated('face_on').length).toBeGreaterThan(populated('down_the_line').length);
  });

  it('every angle still reports the metrics that do not depend on it', () => {
    // Spine angle, head drift, arm angles, sway and finish are read from the same projection at any
    // angle, so nulling them would be losing data we legitimately have.
    for (const a of ['face_on', 'down_the_line'] as const) {
      const have = populated(a);
      for (const m of ['spineAngleDeltaDeg', 'headDriftPxNorm']) expect(have).toContain(m);
    }
  });
});

/**
 * 2026-08-24 (Tim's range screenshot) — the gate, end to end.
 *
 * The card showed "Weight shift -116% — your weight is hanging back through impact" in red. The
 * number came from a mis-tracked hip; the SENTENCE is what the player saw and acted on. So the check
 * that matters is not "is the number nulled" but "is the verdict gone".
 */
describe('an impossible read produces no verdict, not a red fault', () => {
  /** Same swing, but the hips teleport miles off the ankles at impact — a classic keypoint jump. */
  const brokenImpact = (): PoseFrame[] => {
    const f = swing(0.11);
    const impact = f.find(x => x.position === 'P6_impact')!;
    for (const name of ['left_hip', 'right_hip']) {
      const kp = impact.keypoints.find(k => k.name === name)!;
      kp.x = -2.5;                      // pelvis flung far outside the stance
    }
    return f;
  };

  it('nulls the weight shift instead of reporting -116%', () => {
    const b = computeBiomechanicsFromFrames(brokenImpact(), 'face_on', 'right');
    expect(b.weightShiftPct).toBeNull();
  });

  it('and writes NO weight-shift verdict — the sentence is what the player acted on', () => {
    const b = computeBiomechanicsFromFrames(brokenImpact(), 'face_on', 'right');
    expect(b.verdicts.weightShift).toBeNull();
  });

  it('a normal swing still reports its weight shift — the gate rejects the impossible, not the real', () => {
    const b = computeBiomechanicsFromFrames(frames, 'face_on', 'right');
    expect(b.weightShiftPct).not.toBeNull();
    expect(Math.abs(b.weightShiftPct as number)).toBeLessThanOrEqual(100);
  });
});
