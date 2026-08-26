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

describe('other settings by voice (offline precheck)', () => {
  const setting = (t: string) => {
    const i = precheckLocalIntent(t);
    return i && i.intent_type === 'change_setting'
      ? { name: i.parameters.setting_name, value: i.parameters.new_value }
      : null;
  };

  it('switches caddie persona (known names + switch verb only)', () => {
    expect(setting('switch to Kevin')).toEqual({ name: 'caddie_persona', value: 'kevin' });
    expect(setting('change my caddie to Serena')).toEqual({ name: 'caddie_persona', value: 'serena' });
    expect(setting('put Harry in charge')).toEqual({ name: 'caddie_persona', value: 'harry' });
    // 2026-08-26 — a removed persona must no longer be reachable by voice. Naming it is not a
    // persona switch any more; it falls through to the brain like any other sentence.
    expect(setting('switch to Tank')).toBeNull();
  });

  it('flips theme / cart / ghost', () => {
    expect(setting('dark mode')).toEqual({ name: 'theme', value: 'dark' });
    expect(setting('switch to light mode')).toEqual({ name: 'theme', value: 'light' });
    expect(setting('cart mode on')).toEqual({ name: 'cart_mode', value: 'on' });
    expect(setting('turn off cart mode')).toEqual({ name: 'cart_mode', value: 'off' });
    expect(setting('ghost on')).toEqual({ name: 'ghost', value: 'on' });
  });

  it('does not misfire on ordinary talk', () => {
    expect(setting('turn on the lights')).toBeNull();      // not theme (no "mode")
    expect(setting('start a round at Tank')).toBeNull();   // not a persona switch
  });
});

describe('club distance by voice ("what\'s my 7 iron")', () => {
  const topic = (t: string) => {
    const i = precheckLocalIntent(t);
    return i && i.intent_type === 'query_status' ? i.parameters.query_topic : null;
  };

  it('routes club-distance asks to the club_distance topic', () => {
    expect(topic('how far do I hit my 7 iron')).toBe('club_distance');
    expect(topic("what's my driver")).toBe('club_distance');
    expect(topic('how far does my pitching wedge go')).toBe('club_distance');
    expect(topic('how far is my 5 wood')).toBe('club_distance');
  });

  it('does NOT hijack score / handicap / yardage asks', () => {
    expect(topic("what's my score")).toBe('score');
    expect(precheckLocalIntent("what's my handicap")?.intent_type).toBe('handicap_query');
    expect(topic('how far to the pin')).toBe('green_middle');
  });
});
