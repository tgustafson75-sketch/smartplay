/**
 * 2026-10-28 (Brain review r4) — ANOTHER PLAYER'S SCORE IS NOT HIS, AND A HABIT IS NOT AN ORDER.
 *
 * The score patterns accept a missing subject on purpose ("got a 4", "parred it"), so they also took
 * everyone else's: "My partner got a 4 there", "The guys ahead parred it", "My dad birdied this hole
 * once" and "He made a 5" each came back log_score at confidence 'high' and logScoreHandler wrote the
 * number on Tim's card. The risk-mode patterns did the same with talk ABOUT the decision: "My buddy
 * told me to just go for it", "Every time I go aggressive here I make double", "Theres no way I go
 * for it from here right" → aggressive; "I always go conservative off the tee and still make bogey"
 * and "dial it back a bit on the wording kevin" → safe. The shared story frame knew only negations
 * and past markers — no other subject, no habit, no reported speech.
 *
 * BEHAVIOURAL: the real precheck (the first classifier on the Caddie-tab mic, the typed box, the
 * earbud and the watch). A 'conversational' answer is the route every router sends to the brain.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const kind = (u: string) => {
  const hit = precheckLocalIntent(u);
  return hit ? `${hit.intent_type}${hit.parameters?.new_value ? `:${String(hit.parameters.new_value)}` : ''}` : null;
};

describe('a score said about someone else goes to the caddie, not onto his card', () => {
  it.each([
    'My partner got a 4 there',
    'The guys ahead parred it',
    'My dad birdied this hole once',
    'He made a 5',
    'Mike got a 4',
    'my buddy carded a 6 on that one',
  ])('"%s"', (u) => {
    expect(kind(u)).toBe('conversational');
  });
});

describe('talk about the risk decision does not change the risk mode', () => {
  it.each([
    'My buddy told me to just go for it',
    'Every time I go aggressive here I make double',
    'Theres no way I go for it from here right',
    'I always go conservative off the tee and still make bogey',
    'I usually play it safe here',
  ])('"%s"', (u) => {
    expect(kind(u)).toBe('conversational');
  });

  it('"dial it back" about the caddie\'s wording is not a risk mode', () => {
    expect(kind('dial it back a bit on the wording kevin')).not.toBe('change_setting:safe');
  });
});

describe('his own scores and orders still act', () => {
  it.each([
    'got a 4', 'I made par', 'parred it', 'birdied it', 'Just got a 4', 'put me down for a 5',
    'Put me down for a 5, my partner got a 6', 'score me a bogey',
  ])('"%s" logs a score', (u) => {
    expect(kind(u)).toBe('log_score');
  });

  it.each([
    ["let's go aggressive", 'change_setting:aggressive'],
    ["I'm going for it", 'change_setting:aggressive'],
    ['play it safe', 'change_setting:safe'],
    ['dial it back', 'change_setting:safe'],
    ["let's go for it once more", 'change_setting:aggressive'],
  ])('"%s" → %s', (u, want) => {
    expect(kind(u)).toBe(want);
  });
});
