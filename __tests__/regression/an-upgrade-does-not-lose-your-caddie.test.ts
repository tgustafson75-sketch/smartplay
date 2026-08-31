/**
 * 2026-08-31 (adversarial audit C — "assume the app breaks for a real player").
 *
 * §22b DELETED persisted settings keys (`cockpitMode`, `pipecatServerUrl`) and §22c deleted
 * `customCaddieGender` from the profile. Everyone already on the app is carrying a blob that still
 * contains them, written by a build that is still in TestFlight.
 *
 * Two failure modes this pins, neither of which typechecking can see:
 *   - a migration that throws on an OLD version number leaves the store on defaults, which reads to
 *     the player as "the app forgot everything about me"
 *   - dropping customCaddieGender without folding it into customCaddieBasePersona would silently
 *     demote every FEMALE custom caddie to Kevin's voice on update. That is the one that would have
 *     been reported as "my caddie changed" and been very hard to trace back to a settings cleanup.
 */
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';

describe('a real user upgrading does not lose their caddie', () => {
  it('settings: a pre-deletion blob carrying the removed keys still migrates', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migrate = (useSettingsStore as any).persist.getOptions().migrate;
    const old = {
      caddiePersonality: 'serena', voiceGender: 'female', voiceEnabled: true,
      cockpitMode: true, pipecatServerUrl: 'https://kevin.up.railway.app',
      voiceOrchestrator: 'pipecat', trustLevel: 1,
    };
    for (const v of [0, 3, 13, 14, 15, 22]) {
      const out = migrate(JSON.parse(JSON.stringify(old)), v);
      expect(out).toBeTruthy();
      expect(out.caddiePersonality).toBeTruthy();
    }
  });

  it('profile: a female custom caddie keeps her voice across the v3 migration', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migrate = (usePlayerProfileStore as any).persist.getOptions().migrate;
    const out = migrate({ useCustomCaddie: true, customCaddieName: 'Robin', customCaddieGender: 'female' }, 2);
    expect(out.customCaddieBasePersona).toBe('serena');
    expect(out.customCaddieName).toBe('Robin');
    expect(out.useCustomCaddie).toBe(true);
  });
});
