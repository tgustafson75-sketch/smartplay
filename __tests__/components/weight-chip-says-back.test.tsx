/**
 * 2026-10-17 (review of S2k) — the Body Analysis "Weight" chip on SmartMotion review and swing detail is the
 * most visible weight number in the app. A negative share is weight that moved back: "21% back", never "-21%".
 */
import { deriveBodyItems } from '../../components/smartmotion/SmartMotionHud';
import type { SwingBiomechanics } from '../../services/poseAnalysisApi';

const bio = (over: Partial<SwingBiomechanics>): SwingBiomechanics => ({
  hipTurnDeg: null, shoulderTurnDeg: null, shoulderTiltDeg: null, weightShiftPct: null, spineAngleDeltaDeg: null,
  headDriftPxNorm: null, hipSlideRatio: null, sequencingScore: null, leadArmTopDeg: null, leadArmImpactDeg: null,
  swayNorm: null, finishWeightPct: null, angle: 'face_on', frames: [], verdicts: {} as never,
  metric_confidence: { weightShift: 0.9 } as never,
  ...over,
} as SwingBiomechanics);

describe('the Weight chip', () => {
  it('says "21% back" for -21', () => {
    expect(deriveBodyItems(null, bio({ weightShiftPct: -21 })).find((i) => i.key === 'weight')?.value).toBe('21% back');
  });
  it('keeps "+12%" toward the lead side, and the low-confidence "~"', () => {
    expect(deriveBodyItems(null, bio({ weightShiftPct: 12 })).find((i) => i.key === 'weight')?.value).toBe('+12%');
    expect(deriveBodyItems(null, bio({ weightShiftPct: -21, metric_confidence: { weightShift: 0.3 } as never })).find((i) => i.key === 'weight')?.value).toBe('~21% back');
  });
});
