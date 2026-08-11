/**
 * 2026-08-10 (Tim) — "I'm so sick of the first read showing a couple things, showing weird numbers
 * for the readouts, and though it GIVES A READOUT, the little tile says 'no swing found. Try
 * again.' We have first-try error states built in again."
 *
 * THE CONTRADICTION: two independent systems judge the same clip. On-device pose/biomech MEASURES
 * the swing (shoulder turn, hip turn, backswing/downswing timing); the server's vision pass
 * separately returns `valid_swing`. Only the server's opinion drove the verdict tile, so a vision
 * false-negative displayed "NO SWING DETECTED" directly beside live, real metrics.
 *
 * The gate itself must survive — it exists because floor footage once produced a skeleton and an
 * "82 mph club speed" while the caddie correctly reported no player. So these lock BOTH directions:
 * measured evidence overrides a false negative, and noise/floor footage still cannot.
 */
import { hasMeasuredSwing, reconcileSwingValidity } from '../../services/swingValidity';
import type { SwingAnalysis } from '../../services/poseDetection';

const visionSaysNoSwing = { valid_swing: false, validity_reason: 'No analyzable swing detected.' } as unknown as SwingAnalysis;
const visionSaysSwing = { valid_swing: true } as unknown as SwingAnalysis;

const realSwing = {
  shoulderTurnDeg: 88,
  hipTurnDeg: 42,
  shoulderConfidence: 0.9,
  backswingMs: 780,
  downswingMs: 260,
  tempoRatio: 3.0,
  poseFrameCount: 42,
};

describe('measured evidence overrides a vision false-negative', () => {
  it("Tim's case: real turn + real tempo, vision says no swing → treated as a VALID swing", () => {
    expect(reconcileSwingValidity(visionSaysNoSwing, realSwing).valid).toBe(true);
  });

  it('explains WHY it overrode, so the read can be justified rather than silently flipped', () => {
    expect(reconcileSwingValidity(visionSaysNoSwing, realSwing).reason).toMatch(/on-device pose/i);
  });

  it('a hip turn alone, with timing, is enough (shoulder occluded down-the-line)', () => {
    expect(hasMeasuredSwing({ ...realSwing, shoulderTurnDeg: null, shoulderConfidence: null })).toBe(true);
  });

  it('accepts a plausible backswing/downswing split even with no tempo ratio', () => {
    expect(hasMeasuredSwing({ ...realSwing, tempoRatio: null })).toBe(true);
  });
});

describe('the floor-footage guard still holds — noise must NOT override', () => {
  it('no pose frames → no override', () => {
    expect(hasMeasuredSwing({ ...realSwing, poseFrameCount: 0 })).toBe(false);
  });

  it('too few pose frames → no override', () => {
    expect(hasMeasuredSwing({ ...realSwing, poseFrameCount: 3 })).toBe(false);
  });

  it('rotation but NO timing → no override (a still person is not a swing)', () => {
    expect(hasMeasuredSwing({ ...realSwing, backswingMs: null, downswingMs: null, tempoRatio: null })).toBe(false);
  });

  it('timing but NO rotation → no override (camera shake is not a swing)', () => {
    expect(hasMeasuredSwing({ ...realSwing, shoulderTurnDeg: 5, hipTurnDeg: 2 })).toBe(false);
  });

  it('a big shoulder number at LOW confidence does not count on its own', () => {
    expect(hasMeasuredSwing({ ...realSwing, shoulderTurnDeg: 90, shoulderConfidence: 0.2, hipTurnDeg: 3 })).toBe(false);
  });

  it('an implausible downswing (longer than the backswing) is rejected', () => {
    expect(hasMeasuredSwing({ ...realSwing, backswingMs: 200, downswingMs: 900, tempoRatio: null })).toBe(false);
  });

  it('no evidence at all → the vision verdict stands', () => {
    expect(reconcileSwingValidity(visionSaysNoSwing, null).valid).toBe(false);
  });
});

describe('never downgrades a good read', () => {
  it('vision says valid → stays valid regardless of evidence', () => {
    expect(reconcileSwingValidity(visionSaysSwing, null).valid).toBe(true);
    expect(reconcileSwingValidity(visionSaysSwing, { poseFrameCount: 0 }).valid).toBe(true);
  });
});
