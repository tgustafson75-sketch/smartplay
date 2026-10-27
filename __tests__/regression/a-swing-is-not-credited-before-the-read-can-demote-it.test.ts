/**
 * 2026-10-27 — SEAM between SB3b (the practice classifier runs at the END of the set's read) and SB3e (the
 * swing on screen is stamped for practice credit "when the read settles" — in practice when the review opens,
 * which is as soon as swing 1's OWN read lands, before the classifier has run). A swing-1 practice swing was
 * credited, then demoted: credit for a swing the library says was not one.
 *
 * Driven through the owner the screen stamps from (services/practice/smartMotionPracticeCredit) and the real
 * classifier (services/swing/practiceSwings).
 */
import { samplesToStamp } from '../../services/practice/smartMotionPracticeCredit';
import { classifyPracticeSwings } from '../../services/swing/practiceSwings';
import type { RangeSwingSample } from '../../services/practice/openRangeStats';

const measured: RangeSwingSample = { club: '7i', tier: 'flight', tempoRatio: 3, divergenceDeg: 1 };
const shots = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as { id: string; practice?: { reason: 'no_ball_seen' } | null }[];

describe('the swing on screen is credited only once the read could demote it', () => {
  it('THE REPORT: swing 1\'s read has landed, the set\'s read has not settled — nothing is stamped yet', () => {
    const out = samplesToStamp({ sessionId: 's', swingCount: 3, shots, stamped: new Set(), club: '7i', only: 0, measured: { index: 0, sample: measured }, readSettled: false });
    expect(out).toEqual([]);
  });

  it('once settled, a swing-1 the classifier demoted is never stamped; a real one is, with its numbers', () => {
    const marks = classifyPracticeSwings(shots, { a: { ball_struck: 'no' }, b: { ball_struck: 'yes' }, c: { ball_struck: 'yes' } });
    const after = shots.map((s) => ({ ...s, practice: marks[s.id] }));
    expect(samplesToStamp({ sessionId: 's', swingCount: 3, shots: after, stamped: new Set(), club: '7i', only: 0, measured: { index: 0, sample: measured }, readSettled: true })).toEqual([]);
    const real = samplesToStamp({ sessionId: 's', swingCount: 3, shots, stamped: new Set(), club: '7i', only: 0, measured: { index: 0, sample: measured }, readSettled: true });
    expect(real.map((o) => o.sample)).toEqual([measured]);
  });

  it('guard: leaving / saving mid-read (no `only`) still stamps the set — C5\'s Back credit is kept', () => {
    const out = samplesToStamp({ sessionId: 's', swingCount: 3, shots, stamped: new Set(), club: '7i', readSettled: false });
    expect(out.map((o) => o.index)).toEqual([0, 1, 2]);
  });
});
