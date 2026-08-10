/**
 * 2026-08-09 (elite fault engine — Tim: "over-the-top is fabricated; missing lead-arm-bent, chicken
 * wing, finish that my eyes see plainly"). Locks the fault thresholds on the ARM/FINISH/SWAY metrics,
 * and locks that over-the-top is NO LONGER asserted from the (fabricated) sequencing width proxy.
 * buildPoseSwingRead takes a SwingBiomechanics object, so we drive the thresholds directly.
 */
import { buildPoseSwingRead } from '../../services/swing/poseSwingRead';
import type { SwingBiomechanics } from '../../services/poseAnalysisApi';

// A clean baseline: every measured dimension in a good window, high confidence, no fault.
function baseBio(over: Partial<SwingBiomechanics> = {}): SwingBiomechanics {
  return {
    hipTurnDeg: 45, shoulderTurnDeg: 90, shoulderTiltDeg: 30,
    weightShiftPct: 30, spineAngleDeltaDeg: 4, headDriftPxNorm: 0.03, hipSlideRatio: null,
    sequencingScore: 20, // intentionally "bad" — must NOT produce an over_the_top fault anymore
    leadArmTopDeg: 168, leadArmImpactDeg: 165, swayNorm: 0.08, finishWeightPct: 35,
    angle: 'face_on', frames: [], verdicts: {} as SwingBiomechanics['verdicts'],
    metric_confidence: {
      hipTurn: 0.9, shoulderTurn: 0.9, shoulderTilt: 0.9, weightShift: 0.9, spineAngleDelta: 0.9,
      headDrift: 0.9, hipSlide: 0.9, sequencing: 0.9, leadArm: 0.9, chickenWing: 0.9, sway: 0.9, finish: 0.9,
    },
    ...over,
  };
}
const faultKeys = (bio: SwingBiomechanics) => buildPoseSwingRead(bio, null).faults.map((f) => f.key);

describe('over-the-top is no longer fabricated from sequencing', () => {
  it('a very low sequencingScore does NOT produce an over_the_top fault', () => {
    expect(faultKeys(baseBio({ sequencingScore: 5 }))).not.toContain('over_the_top');
  });
  it('the clean baseline names no fault at all', () => {
    expect(faultKeys(baseBio())).toHaveLength(0);
  });
});

describe('lead arm bent at the top', () => {
  it('a bent lead arm (130°) fires lead_arm_bent', () => {
    expect(faultKeys(baseBio({ leadArmTopDeg: 130 }))).toContain('lead_arm_bent');
  });
  it('a straight lead arm (168°) does not', () => {
    expect(faultKeys(baseBio({ leadArmTopDeg: 168 }))).not.toContain('lead_arm_bent');
  });
  it('low confidence suppresses the scold (hedged dimension only)', () => {
    expect(faultKeys(baseBio({ leadArmTopDeg: 130, metric_confidence: { ...baseBio().metric_confidence, leadArm: 0.1 } }))).not.toContain('lead_arm_bent');
  });
});

describe('chicken wing through impact', () => {
  it('lead arm folded to 128° through impact fires chicken_wing', () => {
    expect(faultKeys(baseBio({ leadArmImpactDeg: 128 }))).toContain('chicken_wing');
  });
  it('full extension (165°) does not', () => {
    expect(faultKeys(baseBio({ leadArmImpactDeg: 165 }))).not.toContain('chicken_wing');
  });
});

describe('sway rebuilt on hip-midpoint translation', () => {
  it('hips slid 26% of shoulder width fires sway', () => {
    expect(faultKeys(baseBio({ swayNorm: 0.26 }))).toContain('sway');
  });
  it('a centered turn (8%) does not', () => {
    expect(faultKeys(baseBio({ swayNorm: 0.08 }))).not.toContain('sway');
  });
});

describe('finish quality', () => {
  it('weight still back at finish (2%) fires poor_finish', () => {
    expect(faultKeys(baseBio({ finishWeightPct: 2 }))).toContain('poor_finish');
  });
  it('a balanced finish (+35%) does not', () => {
    expect(faultKeys(baseBio({ finishWeightPct: 35 }))).not.toContain('poor_finish');
  });
});

describe('head movement wired from the previously-orphaned metric', () => {
  it('excess head drift (12%) fires head_movement', () => {
    expect(faultKeys(baseBio({ headDriftPxNorm: 0.12 }))).toContain('head_movement');
  });
  it('a quiet head (3%) does not', () => {
    expect(faultKeys(baseBio({ headDriftPxNorm: 0.03 }))).not.toContain('head_movement');
  });
});

describe('most-severe fault leads the headline', () => {
  it('a significant chicken wing outranks a minor sway', () => {
    const read = buildPoseSwingRead(baseBio({ leadArmImpactDeg: 125, swayNorm: 0.21 }), null);
    expect(read.faults[0].key).toBe('chicken_wing');
  });
});
