/**
 * 2026-09-05 (Tim, from the course) — "I would move to my next spot, know from my yardage where I
 * was and then hit. And then sometimes by the time I get to the green, Serena was giving me my
 * kinda layout for the shot I just hit. She was right in what she said, but I had already done it."
 *
 * The answer was correct. It was just about a shot that no longer existed. A club call for a lie
 * he is not standing in is worse than silence, because he has to work out which shot she means
 * before he can ignore it.
 *
 * TWO halves, and the second is the one that does lasting damage:
 *   1. It was SPOKEN late. Annoying, visible, self-correcting once he realises.
 *   2. It STAMPED pendingKevinRec late — after the shot it described had been logged — where it sat
 *      waiting to be attributed to the NEXT shot. That is silent: the wrong club is logged against a
 *      shot the caddie never advised on, its measured distance trains the learned bag, and adherence
 *      is scored against advice for a different position. Stale advice must not become data.
 *
 * The epoch is hole + shots-logged: the two things that make a recommendation obsolete. NOT GPS
 * distance — a player pacing around their ball would trip a threshold while the advice is still
 * perfectly good, and the point is to drop advice that is WRONG, not advice that is merely late.
 */
import {
  captureShotEpoch,
  shotEpochChanged,
  isPositionalAdvice,
  adviceIsStillWorthSaying,
  markAdviceTurnStart,
  currentTurnEpoch,
  _resetAdviceTurnEpoch,
} from '../../services/adviceFreshness';
import { useRoundStore } from '../../store/roundStore';

const REC = [{ name: 'recommend_club' }];
const ASK = [{ name: 'get_handicap' }];

function setRound(hole: number, shotCount: number, active = true): void {
  useRoundStore.setState({
    isRoundActive: active,
    currentHole: hole,
    shots: Array.from({ length: shotCount }, () => ({})),
  } as never);
}

beforeEach(() => {
  _resetAdviceTurnEpoch();
  setRound(1, 0);
});

describe('the epoch tracks the shot the player is standing over', () => {
  it('is null off-course, so nothing is ever suppressed at home or on the range', () => {
    setRound(1, 0, false);
    expect(captureShotEpoch()).toBeNull();
    // A null epoch can never be stale — suppression requires positive evidence.
    expect(shotEpochChanged(null)).toBe(false);
  });

  it('changes when a shot is logged', () => {
    const before = captureShotEpoch();
    setRound(1, 1);
    expect(shotEpochChanged(before)).toBe(true);
  });

  it('changes when the hole changes', () => {
    const before = captureShotEpoch();
    setRound(2, 0);
    expect(shotEpochChanged(before)).toBe(true);
  });

  it('does NOT change while the player stands there thinking', () => {
    const before = captureShotEpoch();
    expect(shotEpochChanged(before)).toBe(false);
  });
});

describe('only positional advice expires', () => {
  it('a club call is positional', () => {
    expect(isPositionalAdvice(REC)).toBe(true);
    expect(isPositionalAdvice([{ name: 'plan_shot' }])).toBe(true);
  });

  it('a fact about the player is not', () => {
    expect(isPositionalAdvice(ASK)).toBe(false);
    expect(isPositionalAdvice([])).toBe(false);
    expect(isPositionalAdvice(null)).toBe(false);
  });

  it("THE REPORT: a club call for a shot already hit is not worth saying", () => {
    markAdviceTurnStart();
    const epoch = currentTurnEpoch();
    setRound(1, 1); // he hit it while the brain was thinking
    expect(adviceIsStillWorthSaying(epoch, REC)).toBe(false);
  });

  it('...but the same delay does not swallow a non-positional answer', () => {
    // "What's my handicap" is as true on the green as in the fairway. Suppressing it would trade
    // one silent failure for another.
    markAdviceTurnStart();
    const epoch = currentTurnEpoch();
    setRound(1, 1);
    expect(adviceIsStillWorthSaying(epoch, ASK)).toBe(true);
  });

  it('advice that arrives before the shot is spoken normally', () => {
    markAdviceTurnStart();
    expect(adviceIsStillWorthSaying(currentTurnEpoch(), REC)).toBe(true);
  });

  it('a turn started off-course is never suppressed, even if a round begins mid-turn', () => {
    setRound(1, 0, false);
    markAdviceTurnStart();
    expect(currentTurnEpoch()).toBeNull();
    setRound(1, 3);
    expect(adviceIsStillWorthSaying(currentTurnEpoch(), REC)).toBe(true);
  });
});

describe('the freshness check never breaks a turn', () => {
  it('survives an unreadable round store', () => {
    useRoundStore.setState({ isRoundActive: true, currentHole: 1, shots: undefined } as never);
    expect(() => captureShotEpoch()).not.toThrow();
    expect(() => adviceIsStillWorthSaying('1:0', REC)).not.toThrow();
  });
});
