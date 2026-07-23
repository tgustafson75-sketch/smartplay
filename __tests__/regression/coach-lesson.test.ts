/**
 * Coach Caddie Card (Phase 1) — composeFocusFeedback scopes a swing analysis to ONE focus and
 * grades it honestly (good / refine / unclear when the metric is missing). Pinned so the coaching
 * verdicts don't drift and the honesty rule (no grade without data) holds.
 */
import { composeFocusFeedback, focusById, LESSON_FOCUSES } from '../../services/coachLesson';
import type { SwingBiomechanics } from '../../services/poseAnalysisApi';

// Minimal analysis object — only the fields under test matter; rest null.
const analysis = (over: Partial<SwingBiomechanics>): SwingBiomechanics => ({
  hipTurnDeg: null, shoulderTurnDeg: null, shoulderTiltDeg: null, weightShiftPct: null,
  spineAngleDeltaDeg: null, headDriftPxNorm: null, hipSlideRatio: null, sequencingScore: null,
  ...over,
} as SwingBiomechanics);

describe('composeFocusFeedback — good vs refine', () => {
  it('weight_shift: >=55% lead is good, <45% refines', () => {
    expect(composeFocusFeedback('weight_shift', analysis({ weightShiftPct: 60 })).verdict).toBe('good');
    expect(composeFocusFeedback('weight_shift', analysis({ weightShiftPct: 40 })).verdict).toBe('refine');
  });

  it('shoulder_turn: >=85 deg good, <75 refines', () => {
    expect(composeFocusFeedback('shoulder_turn', analysis({ shoulderTurnDeg: 90 })).verdict).toBe('good');
    expect(composeFocusFeedback('shoulder_turn', analysis({ shoulderTurnDeg: 70 })).verdict).toBe('refine');
  });

  it('posture: small spine change good, large refines', () => {
    expect(composeFocusFeedback('posture', analysis({ spineAngleDeltaDeg: 5 })).verdict).toBe('good');
    expect(composeFocusFeedback('posture', analysis({ spineAngleDeltaDeg: 20 })).verdict).toBe('refine');
  });

  it('sequencing: >=70 good, <55 refines', () => {
    expect(composeFocusFeedback('sequencing', analysis({ sequencingScore: 80 })).verdict).toBe('good');
    expect(composeFocusFeedback('sequencing', analysis({ sequencingScore: 50 })).verdict).toBe('refine');
  });
});

describe('composeFocusFeedback — honesty', () => {
  it('is UNCLEAR (never a grade) when the focus metric is null', () => {
    const f = composeFocusFeedback('weight_shift', analysis({ weightShiftPct: null }));
    expect(f.verdict).toBe('unclear');
    expect(f.metricLabel).toBeNull();
  });

  it('unknown focus id is unclear', () => {
    expect(composeFocusFeedback('nonsense', analysis({ weightShiftPct: 60 })).verdict).toBe('unclear');
  });

  it('a good/refine verdict always carries a metric label', () => {
    const f = composeFocusFeedback('shoulder_turn', analysis({ shoulderTurnDeg: 90 }));
    expect(f.metricLabel).toContain('°');
  });
});

describe('lesson content', () => {
  it('every focus has an instruction, cue, and resolves by id', () => {
    for (const f of LESSON_FOCUSES) {
      expect(f.instruction.length).toBeGreaterThan(0);
      expect(f.cue.length).toBeGreaterThan(0);
      expect(focusById(f.id)).toEqual(f);
    }
  });
});
