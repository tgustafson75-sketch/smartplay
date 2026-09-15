/**
 * 2026-09-14 — the root layout is where a mistake becomes a WHITE SCREEN, and today's changes
 * touched it: two imports swapped from default to named, and a new one-shot migration effect.
 *
 * This repo has been here. The 2026-08-14 incident was "the app opened to a white screen, no splash
 * greeting, taps landed but did nothing" — a store that could not rehydrate took `_layout` down with
 * it, and rolling the bundle back changed nothing because the bad value was on the device.
 *
 * WHAT IS NOT TESTED HERE, AND WHY. I tried to require() `app/_layout` to prove it evaluates. It
 * pulls the entire native surface — @sentry/react-native, then ExponentAV, and onward — and making
 * that work needs a native-module mock layer this repo does not have. Building one at 2am to prove
 * a two-line import change is the wrong trade. It is written down rather than left as a skipped
 * test pretending to cover something.
 *
 * The same risk is covered two other ways, both verified rather than assumed:
 *   · A WRONG NAMED IMPORT is a typecheck error. Confirmed by mutation: renaming the import to
 *     `GlobalCaddieMicTypo` produced "has no exported member named 'GlobalCaddieMicTypo'" plus a
 *     second error at the use site. tsc runs in the pre-commit hook, so this cannot ship.
 *   · The migration effect's only risky input is whatever JSON sits on the device, tested below.
 */
describe('the legacy-variant migration cannot take the app down', () => {
  it('survives an absent, empty, junk or real blob', () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    expect(() => useClubBagStore.getState().absorbLegacyVariants({})).not.toThrow();
    expect(() => useClubBagStore.getState().absorbLegacyVariants(null as never)).not.toThrow();
    expect(() => useClubBagStore.getState().absorbLegacyVariants(undefined as never)).not.toThrow();
    expect(() => useClubBagStore.getState().absorbLegacyVariants({ Driver: 'Burner 2' })).not.toThrow();
    expect(() => useClubBagStore.getState().absorbLegacyVariants({ '': '' } as never)).not.toThrow();
  });

  it('an empty fold does not latch — a cloud restore later must still be absorbed', () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    useClubBagStore.setState({ _legacyVariantsAbsorbed: false } as never);
    useClubBagStore.getState().absorbLegacyVariants({});
    expect(useClubBagStore.getState()._legacyVariantsAbsorbed).toBeFalsy();
  });

  it('the effect reads the blob inside a try/catch, so a corrupt value cannot reach rehydration', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../app/_layout.tsx'), 'utf8');
    // Anchor on the CALL, not the first mention of the key — the comment above the effect names it
    // too, and slicing around that landed 800 lines away in an unrelated guard.
    const at = src.indexOf("AsyncStorage.getItem('club-variant-v1')");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, at - 400), at + 700);
    expect(block).toMatch(/try \{/);
    expect(block).toMatch(/catch/);
    expect(block).toMatch(/JSON\.parse/);
  });
});
