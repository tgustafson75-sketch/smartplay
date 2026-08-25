/**
 * 2026-08-24 (Tim's range screenshot) — THE CARD REPORTED THINGS A BODY CANNOT DO.
 *
 *     Weight shift  -116%   "your weight is hanging back through impact"
 *     Lead arm       42°    "lead arm bent to 42° at the top — losing width"
 *
 * Weight shift is pelvis displacement as a percentage of STANCE WIDTH — a person standing on two
 * feet cannot exceed one. leadArmTopDeg is an ELBOW angle where 180 is straight, so 42 is an arm
 * folded nearly shut. Both were mis-tracked keypoints, and both were narrated in red with coaching
 * attached, which is worse than reporting nothing: it sends someone to the range to fix a fault the
 * camera invented.
 *
 * REJECT, never clamp — clamping -116 to -100 turns a failed read into a confident extreme and
 * narrates that instead.
 */
import { isPlausible, rejectImplausible, BIOMECH_BANDS } from '../../services/swing/biomechPlausibility';

describe('a biomech number has to be something a body can do', () => {
  it('rejects the exact values from the screenshot', () => {
    expect(isPlausible('weightShiftPct', -116)).toBe(false);
    expect(isPlausible('leadArmTopDeg', 42)).toBe(false);
  });

  it('REJECTS rather than clamps — a failed read becomes null, not an extreme', () => {
    const { metrics, rejected } = rejectImplausible({ weightShiftPct: -116, leadArmTopDeg: 42 });
    expect(metrics.weightShiftPct).toBeNull();
    expect(metrics.leadArmTopDeg).toBeNull();
    expect(rejected.join(' ')).toMatch(/weightShiftPct=-116/);
    expect(rejected.join(' ')).toMatch(/leadArmTopDeg=42/);
  });

  it('keeps genuinely extreme but POSSIBLE swings — it rejects the impossible, not the unusual', () => {
    expect(isPlausible('weightShiftPct', -35)).toBe(true);   // a real hang-back
    expect(isPlausible('weightShiftPct', 85)).toBe(true);    // a real aggressive drive-through
    expect(isPlausible('leadArmTopDeg', 118)).toBe(true);    // a real collapsed lead arm
    expect(isPlausible('shoulderTurnDeg', 112)).toBe(true);  // a supple player
    expect(isPlausible('spineAngleDeltaDeg', -22)).toBe(true);
    // Head drift is SIGNED and measured against shoulder width — a head moving the other way is
    // real data, and the first version of this band wrongly excluded it.
    expect(isPlausible('headDriftPxNorm', -0.12)).toBe(true);
    expect(isPlausible('headDriftPxNorm', 0.12)).toBe(true);
  });

  it('rejects the impossible across every metric it has an opinion on', () => {
    expect(isPlausible('hipTurnDeg', 140)).toBe(false);
    expect(isPlausible('shoulderTurnDeg', 200)).toBe(false);
    expect(isPlausible('spineAngleDeltaDeg', 90)).toBe(false);
    expect(isPlausible('headDriftPxNorm', 3)).toBe(false);      // 3x shoulder width of head movement
    expect(isPlausible('sequencingScore', 140)).toBe(false);
    expect(isPlausible('swayNorm', 4)).toBe(false);
  });

  it('null stays null — "not measured" is not implausible', () => {
    expect(isPlausible('weightShiftPct', null)).toBe(true);
    expect(rejectImplausible({ weightShiftPct: null }).rejected).toHaveLength(0);
  });

  it('rejects NaN and Infinity, which no band would otherwise catch', () => {
    expect(isPlausible('weightShiftPct', NaN)).toBe(false);
    expect(isPlausible('hipTurnDeg', Infinity)).toBe(false);
  });

  it('passes through a metric it has no opinion about, rather than eating it', () => {
    expect(isPlausible('somethingNew', 9999)).toBe(true);
    expect(rejectImplausible({ somethingNew: 9999 }).metrics.somethingNew).toBe(9999);
  });

  it('covers every metric the analysis actually reports', () => {
    for (const m of ['hipTurnDeg', 'shoulderTurnDeg', 'shoulderTiltDeg', 'weightShiftPct',
                     'spineAngleDeltaDeg', 'headDriftPxNorm', 'hipSlideRatio', 'sequencingScore',
                     'leadArmTopDeg', 'leadArmImpactDeg', 'swayNorm', 'finishWeightPct']) {
      expect(BIOMECH_BANDS[m]).toBeDefined();
    }
  });
});
