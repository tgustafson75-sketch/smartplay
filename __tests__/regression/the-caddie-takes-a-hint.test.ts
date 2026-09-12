/**
 * 2026-09-11 (Tim) — BE SMART, NOT TOGGLE HEAVY.
 *
 * "That whole way we originally designed levels — users don't quite understand it, especially
 *  looking through the settings, it's not intuitive. That whole premise needs to be simplified into
 *  one simple card, or even just dynamically learning user preferences and responses and
 *  frustrations. The user says 'listen, I don't wanna talk this much, let's be more brief, let's get
 *  to the point' — the caddie can take a hint and adjust accordingly."
 *
 * A real caddie is not configured. You tell him once you don't want a lecture over every shot and he
 * remembers. He does not hand you a settings screen with a Trust Spectrum on it.
 *
 * THE RISK THIS FILE MOSTLY GUARDS is the opposite of the feature: a caddie who goes quiet because
 * you said "just tell me the number" about ONE shot is worse than one who never listens, because you
 * cannot tell what you did and getting him back means the settings screen this replaces. So most of
 * these tests are about what must NOT move it.
 */
import {
  detectStyleSignal, applySignal, effectiveResponseMode, describeLearnedStyle,
  type LearnedStyle,
} from '../../services/caddieStyle';

describe('he hears it when it is about the talking', () => {
  for (const said of [
    "you're talking too much",
    'be brief',
    'keep it short',
    'get to the point',
    'just give me the number',
    'less detail please',
    'give me the quick rundown',
    'stop explaining',
  ]) {
    it(`"${said}" → briefer`, () => expect(detectStyleSignal(said)).toBe('briefer'));
  }

  for (const said of ['tell me more', 'more detail', 'walk me through it', 'elaborate']) {
    it(`"${said}" → fuller`, () => expect(detectStyleSignal(said)).toBe('fuller'));
  }
});

describe('and deaf to everything else, which is the harder half', () => {
  for (const said of [
    'why did that go right',                 // a question about a shot, not about him
    'what do I have left',
    'seven iron',
    'that was too much club',                // "too much" about a CLUB, not talking
    'I hit it short',                        // "short" about a shot
    'the group ahead is slow',
    'give me the line',
    'what did I score',
    'this hole is long',
    '',
  ]) {
    it(`"${said}" moves nothing`, () => expect(detectStyleSignal(said)).toBeNull());
  }

  it('never throws on junk', () => {
    expect(() => detectStyleSignal(null as never)).not.toThrow();
    expect(() => detectStyleSignal(undefined as never)).not.toThrow();
  });
});

describe('it moves one step, not off a cliff', () => {
  it('balanced → brief, and only to brief', () => {
    expect(applySignal('balanced', 'briefer')).toBe('brief');
    expect(applySignal('brief', 'briefer')).toBe('brief');       // already there, stays
  });

  it('and back up the same way', () => {
    expect(applySignal('brief', 'fuller')).toBe('balanced');
    expect(applySignal('balanced', 'fuller')).toBe('full');
    expect(applySignal('full', 'fuller')).toBe('full');
  });

  it('so a player can always talk their way back', () => {
    // The failure mode this prevents: one offhand remark silences him and the only way back is the
    // settings screen the whole feature exists to replace.
    let s = applySignal('balanced', 'briefer');
    s = applySignal(s, 'fuller');
    expect(s).toBe('balanced');
  });
});

describe('what he says beats what was once toggled', () => {
  const learned = (style: LearnedStyle['style']): LearnedStyle => ({ style, at: Date.now(), heard: 'be brief' });

  it('nothing learned → the stored setting stands, untouched', () => {
    expect(effectiveResponseMode('detailed', null)).toBe('detailed');
    expect(effectiveResponseMode('short', null)).toBe('short');
    expect(effectiveResponseMode('neutral', null)).toBe('neutral');
  });

  it('learned brief overrides a stored "detailed" — he said it more recently than he toggled it', () => {
    expect(effectiveResponseMode('detailed', learned('brief'))).toBe('short');
  });

  it('and learned full overrides a stored "short"', () => {
    expect(effectiveResponseMode('short', learned('full'))).toBe('detailed');
  });
});

describe('the card can say what it heard, in the player’s own words', () => {
  it('quotes them rather than naming a category', () => {
    const d = describeLearnedStyle({ style: 'brief', at: Date.now(), heard: "you're talking too much" });
    expect(d).toContain("you're talking too much");
    expect(d).not.toMatch(/Trust Spectrum|level 1|L1/i);
  });

  it('says nothing when nothing was learned', () => {
    expect(describeLearnedStyle(null)).toBeNull();
  });
});

describe('it is heard at the ONE seam, not at five call sites', () => {
  const brain = require('fs').readFileSync(
    require('path').join(__dirname, '../../services/caddieBrain.ts'), 'utf8',
  ) as string;

  it('caddieBrain listens on every turn, whichever surface asked', () => {
    // Hand-copying this to the askCaddie call sites is how the caddie tab went a month without a
    // putt intercept. A player must be able to say it to any surface and have it stick.
    expect(brain).toMatch(/noteUtterance\(extras\.message\)/);
  });

  it('and learning a preference can never fail the turn it is learned in', () => {
    const at = brain.indexOf('noteUtterance(extras.message)');
    expect(brain.slice(at - 120, at + 120)).toMatch(/void |catch/);
  });

  it('the payload resolves the effective mode once, centrally', () => {
    const body = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/caddieRequestBody.ts'), 'utf8',
    ) as string;
    expect(body).toMatch(/cs\.effectiveResponseMode\(stored, cs\.learnedStyleSync\(\)\)/);
  });
});
