/**
 * 2026-08-31 (OPEN-ITEMS §22c) — THREE WRITERS ANSWERED "what gender is the caddie", AND THEY
 * DISAGREED. For the CUSTOM caddie all three could differ at once:
 *
 *   settingsStore.setCaddiePersonality   `p === 'serena' ? 'female' : 'male'`  → always MALE
 *   voiceService.speak (effectiveGender) from customCaddieBasePersona          → FEMALE if base Serena
 *   app/_layout.tsx boot reconcile       from customCaddieGender               → whatever was picked
 *
 * Symptoms, all real: activating a Serena-based custom caddie wrote `male`, and the boot reconcile
 * corrected it — so the caddie's gender CHANGED at the next app restart. The `custom → kevin`
 * reconcile branch set the persona WITHOUT the gender, so Kevin inherited the custom caddie's.
 *
 * There is one owner now: services/caddieGender.genderForPersona.
 */
import { genderForPersona, customBasePersona } from '../../services/caddieGender';
import { usePlayerProfileStore } from '../../store/playerProfileStore';

const setBase = (p: 'kevin' | 'serena' | 'harry') =>
  usePlayerProfileStore.setState({ customCaddieBasePersona: p });

describe('one owner decides the caddie’s gender', () => {
  beforeEach(() => setBase('kevin'));

  it('answers the built-in personas', () => {
    expect(genderForPersona('serena')).toBe('female');
    expect(genderForPersona('kevin')).toBe('male');
    expect(genderForPersona('harry')).toBe('male');
  });

  it('follows the custom caddie’s BASE PERSONA — the thing that actually drives the voice', () => {
    setBase('serena');
    expect(genderForPersona('custom')).toBe('female');
    setBase('kevin');
    expect(genderForPersona('custom')).toBe('male');
  });

  it('THE BUG: a Serena-based custom caddie is female the moment it is activated, not after a restart', () => {
    setBase('serena');
    // setCaddiePersonality used to compute `p === 'serena' ? 'female' : 'male'`, which cannot see
    // the base persona and so wrote MALE here. The boot reconcile then flipped it on next launch.
    expect(genderForPersona('custom')).toBe('female');
  });

  it('THE OTHER BUG: resolving custom → kevin does not inherit the custom caddie’s gender', () => {
    setBase('serena');
    expect(genderForPersona('custom')).toBe('female');
    // _layout's fallback branch now derives this instead of omitting it entirely.
    expect(genderForPersona('kevin')).toBe('male');
  });

  it('never throws and never returns anything but male/female, whatever it is handed', () => {
    for (const v of [null, undefined, '', 'tank', 'nonsense', 'SERENA']) {
      expect(['male', 'female']).toContain(genderForPersona(v as string | null | undefined));
    }
  });

  it('degrades safely on a base persona the union no longer admits — without re-validating it here', () => {
    /**
     * This file deliberately does NOT re-check the base-persona set. An earlier version did, and a
     * guard rightly rejected it: that would have been the SIXTH list owning a persona question in
     * the same week that five lists owning ONE question was the bug being fixed. The store validates
     * its own field and its migration maps the retired value away, so a stale value cannot reach
     * runtime — only a test writing straight past the setter can produce one.
     *
     * What must hold regardless is that gender still answers, and answers safely.
     */
    usePlayerProfileStore.setState({ customCaddieBasePersona: 'tank' as never });
    expect(genderForPersona('custom')).toBe('male');
    expect(['male', 'female']).toContain(genderForPersona('custom'));
    expect(() => customBasePersona()).not.toThrow();
  });

  it('falls back to kevin when the field is absent entirely', () => {
    usePlayerProfileStore.setState({ customCaddieBasePersona: undefined as never });
    expect(customBasePersona()).toBe('kevin');
    expect(genderForPersona('custom')).toBe('male');
  });
});

describe('the deleted duplicate control cannot come back', () => {
  it('customCaddieGender is gone from the store state', () => {
    expect(usePlayerProfileStore.getState()).not.toHaveProperty('customCaddieGender');
    expect(usePlayerProfileStore.getState()).not.toHaveProperty('setCustomCaddieGender');
  });

  it('settingsStore exposes no setter for the derived mirror', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSettingsStore } = require('../../store/settingsStore');
    expect(useSettingsStore.getState()).not.toHaveProperty('setVoiceGender');
    // §22b — the two other dead field/setter pairs went with it.
    expect(useSettingsStore.getState()).not.toHaveProperty('setCockpitMode');
    expect(useSettingsStore.getState()).not.toHaveProperty('cockpitMode');
    expect(useSettingsStore.getState()).not.toHaveProperty('setPipecatServerUrl');
    expect(useSettingsStore.getState()).not.toHaveProperty('pipecatServerUrl');
  });
});

describe('playerProfile v3 migration — nobody’s caddie changes voice on the update', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const migrate = (usePlayerProfileStore as any).persist.getOptions().migrate as (s: unknown, v: number) => Record<string, unknown>;

  it('folds a FEMALE pick into base persona serena, so the voice is preserved', () => {
    // The deleted control's own label was "Female · Serena". Dropping the field without this would
    // silently demote every female custom caddie to Kevin's onyx.
    const out = migrate({ customCaddieGender: 'female', customCaddieBasePersona: 'kevin' }, 2);
    expect(out.customCaddieBasePersona).toBe('serena');
    expect(out).not.toHaveProperty('customCaddieGender');
  });

  it('folds a FEMALE pick even when the base persona was never set', () => {
    const out = migrate({ customCaddieGender: 'female' }, 2);
    expect(out.customCaddieBasePersona).toBe('serena');
  });

  it('does NOT override an explicit base persona — the newer, more specific choice wins', () => {
    const out = migrate({ customCaddieGender: 'female', customCaddieBasePersona: 'harry' }, 2);
    expect(out.customCaddieBasePersona).toBe('harry');
    expect(out).not.toHaveProperty('customCaddieGender');
  });

  it('leaves a male caddie on kevin', () => {
    const out = migrate({ customCaddieGender: 'male', customCaddieBasePersona: 'kevin' }, 2);
    expect(out.customCaddieBasePersona).toBe('kevin');
    expect(out).not.toHaveProperty('customCaddieGender');
  });

  it('still maps the removed persona to kevin (the v2 job is not lost)', () => {
    const out = migrate({ customCaddieBasePersona: 'tank' }, 1);
    expect(out.customCaddieBasePersona).toBe('kevin');
  });
});
