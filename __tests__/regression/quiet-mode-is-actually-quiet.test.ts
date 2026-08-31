/**
 * 2026-08-30 — THE TRUST LADDER RAN BACKWARDS.
 *
 * trustLevelStore's own entry for L1 reads "Quiet · SmartVision leads · tap or type to talk", and
 * trustLevelService's proactiveEnabled() said L1 is false. Neither was consulted. proactiveKevin
 * decided interruption on its own with:
 *
 *     const debounce = trustLevel === 2 ? L2_DEBOUNCE_MS : GLOBAL_DEBOUNCE_MS;
 *
 * There is no branch for L1. So Quiet fell to the ELSE and got the same two minutes as L3
 * voice-first — twice as talkative as Companion, which sat in the middle. A player who chose the
 * quietest setting was interrupted every two minutes, and the function that said otherwise
 * (proactiveEnabled) was orphaned: nothing in the app imported it.
 *
 * [[no-push-nagging-no-ads]] [[two-owners-is-the-root-cause]]
 *
 * WHAT IS PINNED is the ORDER, not three magic numbers. Quiet must never speak unprompted, and each
 * level up may speak at least as often as the one below — a ladder that cannot inverse again
 * whatever the intervals become.
 */

import { proactiveDebounceMs } from '../../services/trustLevelService';
import { mayInterject, markProactiveFired, resetProactiveState } from '../../services/proactiveKevin';

beforeEach(() => resetProactiveState());

describe('Quiet means quiet', () => {
  it('never speaks unprompted at L1', () => {
    // THE REGRESSION: this returned true, on a two-minute clock.
    expect(proactiveDebounceMs(1)).toBeNull();
    expect(mayInterject(1)).toBe(false);
  });

  it('stays silent at L1 even on a completely idle clock', () => {
    // No trigger has ever fired, so every debounce in the world has elapsed. Silence here has to
    // come from the policy, not from timing — which is exactly what the old ternary could not say.
    resetProactiveState();
    expect(mayInterject(1)).toBe(false);
  });
});

describe('the ladder cannot invert again', () => {
  it('lets each level speak at least as often as the one below it', () => {
    const l2 = proactiveDebounceMs(2);
    const l3 = proactiveDebounceMs(3);
    expect(l2).not.toBeNull();
    expect(l3).not.toBeNull();
    // Higher trust = shorter wait. This is the assertion that fails if anyone reintroduces a
    // ternary that skips a level.
    expect(l3 as number).toBeLessThanOrEqual(l2 as number);
  });

  it('treats L2 as the alias of Active that the store says it is', () => {
    // There is no middle level. Tim collapsed the ladder to two on 2026-07-24; TRUST_LEVEL_META[2]
    // reads label 'Active', setLevel coerces 2 to 3 and migrate maps anything but 1 to 3. A level
    // that calls itself Active must not be quieter than Active — the first pass at this fix kept a
    // 4-minute "Companion" branch and would have shipped exactly that contradiction.
    expect(proactiveDebounceMs(2)).toBe(proactiveDebounceMs(3));
  });

  it('lets L2 and L3 speak, so this is a fix and not a mute button', () => {
    for (const level of [2, 3] as const) {
      resetProactiveState();
      expect(mayInterject(level)).toBe(true);
    }
  });
});

describe('the shared clock still applies where speech is allowed', () => {
  it('debounces a second interjection at L3', () => {
    resetProactiveState();
    expect(mayInterject(3)).toBe(true);
    markProactiveFired('front_9_summary');
    // One clock across every trigger — the 08-27 interruption-clock behaviour, unchanged.
    expect(mayInterject(3)).toBe(false);
  });

  it('an L1 player is not merely debounced — firing nothing changes nothing', () => {
    resetProactiveState();
    markProactiveFired('front_9_summary');
    expect(mayInterject(1)).toBe(false);
    resetProactiveState();
    expect(mayInterject(1)).toBe(false);
  });
});
