/**
 * 2026-07-24 (final QA — "ask for features, tools, settings, and courses"). Handedness + units
 * were settable in the app but NOT by asking. These lock the OFFLINE precheck routing for
 * handedness — and, critically, that ordinary aiming/direction talk ("aim left", "go left",
 * "the green's to the right") never gets misread as a handedness change (the regex is anchored
 * on unambiguous "-handed"/"lefty"/"righty"/"southpaw" tokens).
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

describe('handedness by voice (offline precheck)', () => {
  const hand = (t: string) => {
    const i = precheckLocalIntent(t);
    return i && i.intent_type === 'change_setting' && i.parameters.setting_name === 'handedness'
      ? i.parameters.new_value
      : null;
  };

  it('sets left-handed from natural phrasings', () => {
    expect(hand("I'm left-handed")).toBe('left');
    expect(hand('set me to left-handed')).toBe('left');
    expect(hand('switch to left handed')).toBe('left');
    expect(hand("I'm a lefty")).toBe('left');
    expect(hand('I play southpaw')).toBe('left');
  });

  it('sets right-handed from natural phrasings', () => {
    expect(hand('switch to right-handed')).toBe('right');
    expect(hand("I'm right handed")).toBe('right');
    expect(hand("I'm a righty")).toBe('right');
  });

  it('NEVER treats aiming/direction talk as a handedness change (false-positive guard)', () => {
    expect(hand('aim left')).toBeNull();
    expect(hand('go left')).toBeNull();
    expect(hand('the green is to the right')).toBeNull();
    expect(hand('miss is right')).toBeNull();
    expect(hand('pull it left')).toBeNull();
    expect(hand('left side of the fairway')).toBeNull();
  });
});
