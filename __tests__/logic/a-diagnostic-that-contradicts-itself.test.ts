/**
 * 2026-09-19 — Tim pasted the Owner Tools → Native Modules card:
 *
 *     MediaPipePose: ✓ loaded (android)
 *     MetaWearablesFrame: ✗ MISSING (android, NativeModules.MetaWearablesFrame resolved to object)
 *
 * The second line says the module was FOUND and MISSING in the same breath. `typeof null` is
 * `'object'` in JavaScript, and null is the ordinary shape of an absent native module, so the probe
 * reported its own verdict as a contradiction. The verdict was right; the explanation sent the
 * reader to debug the probe instead of the build.
 *
 * Worse, it read as a fault. MetaWearablesFrame is absent from EVERY Android build cut without
 * GITHUB_TOKEN, by design — plugins/withMetaWearablesDAT skips the wiring and says so at build
 * time. A diagnostic that reports a deliberate build decision in the same red as a broken
 * dependency makes the reader chase it, which is exactly what happened.
 */
import { __testing } from '../../services/nativeModuleHealth';

const { describeMissing, expectedAbsence } = __testing;

describe('a probe must not contradict its own verdict', () => {
  it('THE REPORT: null never reads as "object"', () => {
    // The exact value Tim's build produced.
    expect(describeMissing(null)).not.toMatch(/^a object|resolved to object/);
    expect(describeMissing(null)).toMatch(/null/);
  });

  it('tells null and undefined apart, because they mean different things', () => {
    // undefined = nothing registered this name. null = the name exists and holds nothing.
    expect(describeMissing(undefined)).toMatch(/undefined/);
    expect(describeMissing(undefined)).toMatch(/no native module registered/i);
    expect(describeMissing(null)).toMatch(/registered nothing/i);
    expect(describeMissing(undefined)).not.toEqual(describeMissing(null));
  });

  it('still names an unexpected shape rather than guessing', () => {
    expect(describeMissing('oops')).toMatch(/string/);
    expect(describeMissing(42)).toMatch(/number/);
  });
});

describe('an absence by build decision is not a fault', () => {
  it('the glasses bridge is EXPECTED to be absent on a normal Android build', () => {
    const why = expectedAbsence('MetaWearablesFrame', 'android');
    expect(why).toBeTruthy();
    expect(why).toMatch(/GITHUB_TOKEN/);
    // It must also say what it costs the player, or "expected" is just a shrug.
    expect(why).toMatch(/degrade|glasses/i);
  });

  it('and on a normal iOS build, for the other reason', () => {
    expect(expectedAbsence('MetaWearablesFrame', 'ios')).toMatch(/glasses.*profile|MWDAT_IOS_ENABLED/);
  });

  /**
   * The half that keeps this honest. If everything is "expected", the card stops meaning anything —
   * MediaPipePose ships in the standard plugin set and its absence would break every swing read.
   */
  it('MediaPipePose is NOT expected to be missing anywhere', () => {
    for (const p of ['android', 'ios', 'web'] as const) {
      expect(expectedAbsence('MediaPipePose', p)).toBeUndefined();
    }
  });
});
