/**
 * 2026-10-17 — Tim's range screenshot (s_4118), spoken and shown: "Incomplete finish. Weight only -21% onto
 * the lead side at the finish". A negative share is not an amount ONTO the lead side: it is weight that
 * moved back toward the trail side, and it is said that way — on the card, in the breakdown, and in the
 * evidence the caddie speaks (poseReadToPrimaryIssue's feel_cue).
 */
import { buildPoseSwingRead, signedWeightDisplay } from '../../services/swing/poseSwingRead';
import { poseReadToPrimaryIssue } from '../../services/swing/poseReadVerdict';
import type { SwingBiomechanics } from '../../services/poseAnalysisApi';

const bio = (over: Partial<SwingBiomechanics>): SwingBiomechanics => ({
  hipTurnDeg: null, shoulderTurnDeg: null, shoulderTiltDeg: null, weightShiftPct: null, spineAngleDeltaDeg: null,
  headDriftPxNorm: null, hipSlideRatio: null, sequencingScore: null, leadArmTopDeg: null, leadArmImpactDeg: null,
  swayNorm: null, finishWeightPct: null, angle: 'face_on', frames: [], verdicts: {} as never,
  metric_confidence: { weightShift: 0.9, finish: 0.9 } as never,
  ...over,
} as SwingBiomechanics);

const allText = (b: SwingBiomechanics) => {
  const r = buildPoseSwingRead(b, null);
  const pi = poseReadToPrimaryIssue(r);
  return [...r.dimensions.flatMap((d) => [d.display, d.note]), ...r.faults.map((f) => f.evidence), pi?.feel_cue ?? '', pi?.evidence ?? ''].join('\n');
};

describe('THE REPORT: a -21% finish', () => {
  const r = buildPoseSwingRead(bio({ finishWeightPct: -21 }), null);
  it('is still the fault it was (an incomplete finish, significant)', () => {
    expect(r.faults[0]).toEqual(expect.objectContaining({ key: 'poor_finish', severity: 'significant' }));
  });
  it('says the weight went back toward the trail side, with no minus sign', () => {
    expect(r.faults[0].evidence).toMatch(/back toward your trail side at the finish \(21% of your stance\)/);
    expect(allText(bio({ finishWeightPct: -21 }))).not.toMatch(/-\s?21%/);
  });
});

describe('no weight read, at any value, speaks a negative share "onto" anything', () => {
  it.each([-60, -21, -9, -1, 0, 3, 9, 20, 30])('finish and weight shift at %i%%', (w) => {
    const t = allText(bio({ finishWeightPct: w, weightShiftPct: w }));
    expect(t).not.toMatch(/-\d+%/);
    expect(t).not.toMatch(/only \+?0% /);   // "only 0% onto the lead side" is not a sentence either
  });
  it('the display is "+12%" toward the lead side and "21% back" toward the trail side', () => {
    expect(signedWeightDisplay(12)).toBe('+12%');
    expect(signedWeightDisplay(-21)).toBe('21% back');
  });
});
