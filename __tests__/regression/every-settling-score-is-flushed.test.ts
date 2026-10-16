/**
 * 2026-10-15 (review) — pendingScoreFlush held ONE holder: the strip and the cockpit both settle a
 * score, and whichever registered second replaced the first, so End Round flushed only one of them.
 */
import { registerPendingScoreFlush, flushPendingScores } from '../../services/round/pendingScoreFlush';

describe('every holder of a settling score is flushed', () => {
  it('two holders → both flushed; unregistering one leaves the other', () => {
    const a = jest.fn(); const b = jest.fn();
    const leaveA = registerPendingScoreFlush(a);
    const leaveB = registerPendingScoreFlush(b);
    flushPendingScores();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    leaveA();
    flushPendingScores();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    leaveB();
  });

  it('one holder throwing does not stop the next', () => {
    const b = jest.fn();
    const leaveA = registerPendingScoreFlush(() => { throw new Error('x'); });
    const leaveB = registerPendingScoreFlush(b);
    flushPendingScores();
    expect(b).toHaveBeenCalled();
    leaveA(); leaveB();
  });
});
