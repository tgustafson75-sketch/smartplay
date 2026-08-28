/**
 * 2026-08-28 — SmartFinder sweep, part 2: the RESOLVER, not the rangefinder maths.
 *
 * The 08-21 pass swept the tilt/height engine and found two real defects in the confidence badge.
 * It did not reach `yardageResolver`, which the sweep notes had flagged as "the distance the caddie
 * quotes; highest leverage" — and that is where this one went.
 *
 * A stated yardage is the highest-trust number in the app. yardageResolver Tier 3 returns it at
 * `confidence: 'high'`, it BEATS live GPS for five minutes, and the caddie both quotes it and clubs
 * from it. Five call sites wrote it, each validating with its own band (700 / 700 / 900 / 400 /
 * 400), and the setter they all converge on validated nothing at all — so NaN, Infinity, 0 and
 * negative numbers were writable, and "I'm 850 out" was accepted through one voice route and
 * refused through another.
 *
 * The invariant, asserted here against the REAL store and the REAL resolver rather than a mock:
 *
 *      A STATED YARDAGE IS EITHER A PLAUSIBLE YARDAGE OR IT IS NOT STORED.
 *
 * Written as properties over generated inputs, because the failures that mattered were shapes
 * nobody thought to type into a test: not "does 150 work" but "what does 0 do".
 */

import { useRoundStore } from '../../store/roundStore';
import { resolveYardage } from '../../services/yardageResolver';

const freshRound = () => {
  useRoundStore.setState({ userStatedYardage: null, currentHole: 4, isRoundActive: true } as never);
};

describe('the setter is the one owner of "is this a yardage"', () => {
  beforeEach(freshRound);

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['zero', 0],
    ['negative', -120],
    ['absurd (850 — accepted by one voice route before this)', 850],
    ['absurd (10000)', 10_000],
  ])('refuses %s and leaves the field untouched', (_label, value) => {
    const accepted = useRoundStore.getState().setUserStatedYardage(value as number, 'user');
    expect(accepted).toBe(false);
    expect(useRoundStore.getState().userStatedYardage).toBeNull();
  });

  it.each([
    ['a tap-in', 1],
    ['a wedge', 95],
    ['a mid-iron', 165],
    ['a par 5 from the tee', 600],
    ['the top of the band', 700],
  ])('accepts %s', (_label, value) => {
    const accepted = useRoundStore.getState().setUserStatedYardage(value as number, 'user');
    expect(accepted).toBe(true);
    expect(useRoundStore.getState().userStatedYardage?.value).toBe(value);
  });

  it('does not clobber a good value with a bad one', () => {
    useRoundStore.getState().setUserStatedYardage(152, 'rangefinder');
    const accepted = useRoundStore.getState().setUserStatedYardage(NaN, 'user');
    expect(accepted).toBe(false);
    // The player's real number survives the bad write rather than being replaced by nothing.
    expect(useRoundStore.getState().userStatedYardage?.value).toBe(152);
  });

  it('a refused write is never reported as accepted', () => {
    // The point of the boolean: a caller that ANNOUNCES the number ("Got it — 850") can tell.
    const results = [NaN, 0, -1, 900, 150].map((v) =>
      useRoundStore.getState().setUserStatedYardage(v, 'user'),
    );
    expect(results).toEqual([false, false, false, false, true]);
  });
});

describe('the resolver does not trust the store either', () => {
  beforeEach(freshRound);

  /**
   * userStatedYardage is PERSISTED. A value written before the setter guard existed can rehydrate
   * into a fresh session, and a guard at the door does nothing about what is already in the room.
   * These write through setState directly — exactly what a rehydrate does.
   */
  it.each([
    ['NaN', NaN],
    ['zero', 0],
    ['negative', -50],
    ['absurd', 4000],
  ])('ignores a rehydrated %s rather than quoting it at high confidence', (_label, value) => {
    useRoundStore.setState({
      userStatedYardage: { value: value as number, source: 'user', asOf: Date.now(), holeAtCapture: 4 },
    } as never);
    const r = resolveYardage(4);
    expect(r.source).not.toBe('user_stated');
    // And whatever it falls through to, it never hands back a broken number dressed as a yardage.
    if (r.value !== null) expect(Number.isFinite(r.value)).toBe(true);
  });

  it('still uses a plausible rehydrated value', () => {
    useRoundStore.setState({
      userStatedYardage: { value: 143, source: 'rangefinder', asOf: Date.now(), holeAtCapture: 4 },
    } as never);
    const r = resolveYardage(4);
    expect(r.source).toBe('user_stated');
    expect(r.value).toBe(143);
    expect(r.confidence).toBe('high');
  });
});

describe('whatever the resolver returns is a yardage or nothing', () => {
  beforeEach(freshRound);

  /**
   * The generic invariant from the sweep notes: "a yardage is either a finite plausible number or
   * null — never 0-as-a-number, never NaN". Swept across the tier ladder by varying what the store
   * holds, deterministically — no Math.random, so a failure is reproducible.
   */
  it('never returns NaN, Infinity or a negative, whatever the store holds', () => {
    const values = [NaN, Infinity, -Infinity, 0, -1, 0.5, 1, 700, 701, 10_000];
    const ages = [0, 60_000, 10 * 60_000];
    for (const v of values) {
      for (const age of ages) {
        for (const hole of [3, 4]) {
          useRoundStore.setState({
            userStatedYardage: { value: v, source: 'user', asOf: Date.now() - age, holeAtCapture: hole },
            currentHole: 4,
          } as never);
          const r = resolveYardage(4);
          if (r.value !== null) {
            expect(Number.isFinite(r.value)).toBe(true);
            expect(r.value).toBeGreaterThan(0);
          }
          // The reason line is player-visible via the caddie; it must never leak a JS artefact.
          expect(r.reason).not.toMatch(/undefined|NaN|null|\[object Object\]/);
        }
      }
    }
  });
});
