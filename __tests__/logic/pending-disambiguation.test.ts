/**
 * 2026-07-27 (tester UX — multi-turn wrong-course fix). When voice quick-round finds several
 * matching courses it now HOLDS the candidate list and the user's next utterance resolves against it
 * ("the New Jersey one" / "Austin" / "the first one") — no re-issuing the whole command. These lock
 * the matcher (the risk surface: "the ___ ONE" must NOT resolve to candidate #1), the ephemeral
 * store's lifecycle + round-state eviction, and the resolve-and-commit path.
 */
jest.mock('../../store/roundStore', () => {
  const state = { isRoundActive: false, setPendingStartCourse: jest.fn(), setPendingStartFactors: jest.fn() };
  return { useRoundStore: { getState: () => state, __state: state } };
});
jest.mock('../../store/guestProfileStore', () => ({
  useGuestProfileStore: { getState: () => ({ addGuest: (n: string) => ({ displayName: n }) }) },
}));

import {
  matchCourseChoice,
  setPendingCourseChoices,
  getPendingCourseChoices,
  clearPendingCourseChoices,
  resolvePendingCourseUtterance,
  type CourseChoice,
} from '../../services/pendingDisambiguation';
import { useRoundStore } from '../../store/roundStore';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const roundState = (useRoundStore as any).__state as {
  isRoundActive: boolean;
  setPendingStartCourse: jest.Mock;
  setPendingStartFactors: jest.Mock;
};

const CHOICES: CourseChoice[] = [
  { id: '1', name: 'Riverside Golf Club', location: 'Austin, TX' },
  { id: '2', name: 'Riverside Country Club', location: 'Indianapolis, IN' },
  { id: '3', name: 'Pine Valley Golf Club', location: 'Pine Valley, NJ' },
];

beforeEach(() => {
  clearPendingCourseChoices();
  roundState.isRoundActive = false;
  roundState.setPendingStartCourse.mockClear();
  roundState.setPendingStartFactors.mockClear();
});

describe('matchCourseChoice', () => {
  it('resolves a full STATE NAME to its abbreviation (not the "one" trap)', () => {
    // "the New Jersey one" contains "one" — must resolve to NJ (idx 2), NOT candidate #1.
    expect(matchCourseChoice('the New Jersey one', CHOICES)?.id).toBe('3');
  });
  it('resolves a spoken city', () => {
    expect(matchCourseChoice('the Austin one please', CHOICES)?.id).toBe('1');
    expect(matchCourseChoice('Indianapolis', CHOICES)?.id).toBe('2');
  });
  it('resolves explicit positions (ordinal word, digit, "last")', () => {
    expect(matchCourseChoice('the second one', CHOICES)?.id).toBe('2');
    expect(matchCourseChoice('number 1', CHOICES)?.id).toBe('1');
    expect(matchCourseChoice('the last one', CHOICES)?.id).toBe('3');
    expect(matchCourseChoice('second', CHOICES)?.id).toBe('2');
    expect(matchCourseChoice('number two', CHOICES)?.id).toBe('2');
  });
  it('does NOT read a positional token embedded in a sentence (no false round-start)', () => {
    // These are normal commands that happen to contain last/ordinal/digit — must NOT resolve.
    expect(matchCourseChoice('what did I shoot on the last hole', CHOICES)).toBeNull();
    expect(matchCourseChoice('let me hit my first shot', CHOICES)).toBeNull();
    expect(matchCourseChoice('give me 3 tips', CHOICES)).toBeNull();
    expect(matchCourseChoice('I am 3 over through 5', CHOICES)).toBeNull();
    expect(matchCourseChoice("what's my score", CHOICES)).toBeNull();
  });
  it('resolves a distinctive club-name word (ignoring generic golf words)', () => {
    expect(matchCourseChoice('Pine Valley', CHOICES)?.id).toBe('3');
    // "Golf"/"Club" are generic → no unique match on them alone
    expect(matchCourseChoice('the golf club', CHOICES)).toBeNull();
  });
  it('returns null when the answer is ambiguous or unrelated', () => {
    expect(matchCourseChoice('Riverside', CHOICES)).toBeNull(); // matches BOTH 1 and 2
    expect(matchCourseChoice('what time is it', CHOICES)).toBeNull();
    expect(matchCourseChoice('', CHOICES)).toBeNull();
  });
});

describe('pending store lifecycle', () => {
  it('holds and returns the candidate list, then clears', () => {
    setPendingCourseChoices(CHOICES, { nineHole: false, guestNames: [] });
    expect(getPendingCourseChoices()?.choices).toHaveLength(3);
    clearPendingCourseChoices('test');
    expect(getPendingCourseChoices()).toBeNull();
  });

  it('evicts on round-state change (a started round abandons a stale choice)', () => {
    setPendingCourseChoices(CHOICES, { nineHole: false, guestNames: [] }); // captured with isRoundActive=false
    roundState.isRoundActive = true; // a round started
    expect(getPendingCourseChoices()).toBeNull();
  });

  it('decays after the TTL window', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_000_000);
      setPendingCourseChoices(CHOICES, { nineHole: false, guestNames: [] });
      jest.setSystemTime(1_000_000 + 91_000); // > 90s
      expect(getPendingCourseChoices()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('resolvePendingCourseUtterance', () => {
  it('is a no-op when nothing is pending', () => {
    expect(resolvePendingCourseUtterance('the Austin one')).toBeNull();
    expect(roundState.setPendingStartCourse).not.toHaveBeenCalled();
  });

  it('commits the matched course start and voices a confirmation', () => {
    setPendingCourseChoices(CHOICES, { nineHole: true, guestNames: ['Mike'] });
    const r = resolvePendingCourseUtterance('the New Jersey one');
    expect(r?.confirmLine).toContain('Pine Valley Golf Club');
    expect(r?.confirmLine).toContain('Pine Valley, NJ');
    expect(r?.confirmLine).toContain('9-hole');
    expect(r?.confirmLine).toContain('Mike');
    expect(roundState.setPendingStartCourse).toHaveBeenCalledWith('3');
    expect(roundState.setPendingStartFactors).toHaveBeenCalledWith(
      expect.objectContaining({ nineHole: true, mode: 'free_play' }),
    );
    // consumed — a second identical answer no longer resolves
    expect(getPendingCourseChoices()).toBeNull();
  });

  it('returns null on an unclear answer WITHOUT consuming it (no swallow, no false start)', () => {
    setPendingCourseChoices(CHOICES, { nineHole: false, guestNames: [] });
    // Unrelated command while a disambiguation is pending: must fall through, NOT start a round.
    expect(resolvePendingCourseUtterance("what's my score")).toBeNull();
    expect(resolvePendingCourseUtterance('what did I shoot on the last hole')).toBeNull();
    expect(roundState.setPendingStartCourse).not.toHaveBeenCalled();
    // choices stay pending so a later CLEAR answer still resolves
    expect(getPendingCourseChoices()?.choices).toHaveLength(3);
    expect(resolvePendingCourseUtterance('the New Jersey one')?.confirmLine).toContain('Pine Valley');
    expect(roundState.setPendingStartCourse).toHaveBeenCalledWith('3');
  });
});
