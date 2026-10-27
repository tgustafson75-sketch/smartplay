/**
 * 2026-10-27 (capture-half audit C5) — SmartMotion's practice credit, swing by swing.
 *
 * The stamp into an active practice session was once per CLIP (a 5-swing set counted 1), only after the
 * cloud read (an offline swing never counted), and points landed only on Save / New Set (Back lost
 * them). services/practice/smartMotionPracticeCredit owns the rule; the screen stamps what it returns.
 */
import { samplesToStamp, creditedSwingCount, shouldCreditOnLeave, swingStampKey } from '../../services/practice/smartMotionPracticeCredit';
import type { RangeSwingSample } from '../../services/practice/openRangeStats';

const real = { practice: null };
const demoted = { practice: { reason: 'no_ball_seen' as const } };
const measured: RangeSwingSample = { club: '7i', tier: 'flight', tempoRatio: 3.1, divergenceDeg: -2 };

describe('each swing of a set is stamped once', () => {
  it('THE REPORT: a five-swing set stamps five swings, not one', () => {
    const out = samplesToStamp({ sessionId: 's1', swingCount: 5, shots: [real, real, real, real, real], stamped: new Set(), club: '7i' });
    expect(out.map((o) => o.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('the swing on screen carries what was measured on it; the others carry only the club', () => {
    const out = samplesToStamp({ sessionId: 's1', swingCount: 3, shots: [real, real, real], stamped: new Set(), club: '7i', measured: { index: 1, sample: measured } });
    expect(out[1]!.sample).toEqual(measured);
    expect(out[0]!.sample).toEqual({ club: '7i', tier: 'none', tempoRatio: null, divergenceDeg: null });
  });

  it('a swing already stamped (on screen, then again on leave) is never stamped twice', () => {
    const first = samplesToStamp({ sessionId: 's1', swingCount: 3, shots: [real, real, real], stamped: new Set(), club: null, only: 0, measured: { index: 0, sample: measured } });
    expect(first.map((o) => o.index)).toEqual([0]);
    const rest = samplesToStamp({ sessionId: 's1', swingCount: 3, shots: [real, real, real], stamped: new Set(first.map((o) => o.key)), club: null });
    expect(rest.map((o) => o.index)).toEqual([1, 2]);
  });

  it('an OFFLINE swing (no read, no shots demoted yet) is still stamped', () => {
    const out = samplesToStamp({ sessionId: 's2', swingCount: 1, shots: [{}], stamped: new Set(), club: 'DR', only: 0 });
    expect(out).toHaveLength(1);
  });

  it('a swing the read demoted as a practice swing is never stamped', () => {
    const out = samplesToStamp({ sessionId: 's1', swingCount: 3, shots: [real, demoted, real], stamped: new Set(), club: null });
    expect(out.map((o) => o.index)).toEqual([0, 2]);
  });

  it('keys are per session and swing, so re-analyzing the same set re-stamps nothing', () => {
    expect(swingStampKey('s1', 2)).not.toBe(swingStampKey('s2', 2));
    const stamped = new Set([swingStampKey('s1', 0)]);
    expect(samplesToStamp({ sessionId: 's1', swingCount: 1, shots: [real], stamped, club: null, only: 0 })).toEqual([]);
  });
});

describe('credit', () => {
  it('counts every swing but the demoted ones, at least one', () => {
    expect(creditedSwingCount({ swingCount: 5, shots: [real, demoted, real, real, real] })).toBe(4);
    expect(creditedSwingCount({ swingCount: 1, shots: [demoted] })).toBe(1);
    expect(creditedSwingCount({ swingCount: 0, drillShotCount: 3, shots: [] })).toBe(3);
  });

  it('THE REPORT: leaving with Back credits a saved, uncredited set; never one already credited or never saved', () => {
    expect(shouldCreditOnLeave({ sessionId: 's1', alreadyCredited: false })).toBe(true);
    expect(shouldCreditOnLeave({ sessionId: 's1', alreadyCredited: true })).toBe(false);
    expect(shouldCreditOnLeave({ sessionId: null, alreadyCredited: false })).toBe(false);
  });
});
