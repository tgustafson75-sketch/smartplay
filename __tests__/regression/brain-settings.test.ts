/**
 * Voice settings-mapping safety net. brainSettings() is the single choke point every brain-bound
 * setting flows through. This test asserts each one is forwarded — so a NEW setting that someone
 * forgets to wire fails HERE instead of silently doing nothing on the live voice path (the exact
 * class of bug that left cecilyMode / responseMode / personaIntensity / tankSoftIntro dead).
 */
import { brainSettings } from '../../services/voice/brainSettings';

describe('brainSettings — every brain-bound field is forwarded', () => {
  it('exposes exactly the expected keys (guards against a dropped setting)', () => {
    const bs = brainSettings({ caddiePersonality: 'kevin' });
    expect(Object.keys(bs).sort()).toEqual(
      ['aiProvider', 'cecilyMode', 'continuousConversationMode', 'language', 'personaIntensity', 'responseMode', 'tankSoftIntro'].sort(),
    );
  });

  it('applies safe defaults (default = current behavior, no regression)', () => {
    const bs = brainSettings({ caddiePersonality: 'kevin' });
    expect(bs.responseMode).toBe('neutral');
    expect(bs.cecilyMode).toBe(false);
    expect(bs.personaIntensity).toBe(100);
    expect(bs.tankSoftIntro).toBe(false);
    expect(bs.language).toBe('en');
    expect(bs.continuousConversationMode).toBe(false);
  });

  it('forwards cecily + response style + tankSoftIntro', () => {
    const bs = brainSettings({ caddiePersonality: 'kevin', cecilyMode: true, responseMode: 'short', tankSoftIntro: true });
    expect(bs.cecilyMode).toBe(true);
    expect(bs.responseMode).toBe('short');
    expect(bs.tankSoftIntro).toBe(true);
  });

  it('resolves the ACTIVE persona intensity (not another persona)', () => {
    expect(brainSettings({ caddiePersonality: 'tank', personaIntensity: { tank: 70, kevin: 100 } }).personaIntensity).toBe(70);
    // missing / non-finite → default 100 (never NaN into the prompt)
    expect(brainSettings({ caddiePersonality: 'harry', personaIntensity: { kevin: 100 } }).personaIntensity).toBe(100);
  });

  it('clamps an unsupported language to en', () => {
    expect(brainSettings({ caddiePersonality: 'kevin', language: 'fr' }).language).toBe('en');
    expect(brainSettings({ caddiePersonality: 'kevin', language: 'es' }).language).toBe('es');
  });
});
