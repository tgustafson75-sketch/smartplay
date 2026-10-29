/**
 * 2026-10-28 (Brain recheck r10) — A SETTING ORDER ADDRESSED TO HIM STILL SETS IT.
 *
 * r9 made handedness and theme match only the whole utterance, which was right, but its edges were
 * too tight: "Switch to dark mode, Kevin", "Turn on dark mode for me", "Make it dark mode", "I want
 * dark mode", "I'm a lefty, Kevin", "actually I'm a lefty", "oh I'm left handed", "by the way I'm left
 * handed" and "Kevin I'm left handed" (speech-to-text drops the comma) all fell to the mention
 * catch-all — 'conversational', so no cloud classifier — and reached a brain with no tool for either
 * setting. A lefty kept right-handed reads. r9 also blocked every want/need: "I want to go for it",
 * "I wanna go for it", "I want to play it safe here" left risk posture at normal, and a bare "let me
 * know" turned "I'm going for it, let me know if that's dumb" into talk.
 *
 * And whatever IS declined reaches the conversation as a fact: services/caddieRequestBody carries a
 * [SETTING NOT CHANGED] note, so the caddie cannot answer "done" to a setting nothing applied.
 *
 * BEHAVIOURAL: the real precheck (every voice and typed route) and the real payload builder.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';

const kind = (u: string) => {
  const hit = precheckLocalIntent(u);
  return hit ? `${hit.intent_type}${hit.parameters?.new_value ? `:${String(hit.parameters.new_value)}` : ''}` : null;
};
const context = (message: string) => String(buildCaddieRequestBody({ message, language: 'en' }).unified_context_block ?? '');

describe('orders with a vocative, a softener or a lead-in set the setting', () => {
  it.each([
    ['Switch to dark mode, Kevin', 'change_setting:dark'],
    ['Turn on dark mode for me', 'change_setting:dark'],
    ['Make it dark mode', 'change_setting:dark'],
    ['I want dark mode', 'change_setting:dark'],
    ['Kevin switch to dark mode', 'change_setting:dark'],
    ["I'm a lefty, Kevin", 'change_setting:left'],
    ["actually I'm a lefty", 'change_setting:left'],
    ["oh I'm left handed", 'change_setting:left'],
    ["by the way I'm left handed", 'change_setting:left'],
    ["Kevin I'm left handed", 'change_setting:left'],
    ['just set me to lefty, thanks', 'change_setting:left'],
    ['I want to go for it', 'change_setting:aggressive'],
    ['I wanna go for it', 'change_setting:aggressive'],
    ['I want to play it safe here', 'change_setting:safe'],
    ["I'm going for it, let me know if that's dumb", 'change_setting:aggressive'],
  ])('"%s" → %s', (u, want) => {
    expect(kind(u)).toBe(want);
  });
});

describe('mentions, refusals and other people still go to the caddie', () => {
  it.each([
    'We got paired with a lefty',
    'Dark mode is hurting my eyes',
    "I don't want to go for it",
    'my buddy wants to go for it',
    'Let me know when I should go for it',
    'I want to go for it after this hole',
    'Kevin should I go for it',
  ])('"%s"', (u) => {
    expect(kind(u)).toBe('conversational');
  });
});

describe('a declined setting reaches the caddie as unchanged', () => {
  it('the turn context says nothing was changed, and names the words that set it', () => {
    const block = context('Dark mode is hurting my eyes');
    expect(block).toContain('[SETTING NOT CHANGED]');
    expect(block).toContain('switch to light mode');
    expect(context("I don't want to go for it")).toContain('risk mode');
  });

  it('an applied order or ordinary talk carries no note', () => {
    expect(context('switch to dark mode')).not.toContain('[SETTING NOT CHANGED]');
    expect(context('what club here?')).not.toContain('[SETTING NOT CHANGED]');
  });
});
