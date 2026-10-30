/**
 * 2026-10-29 (Brain recheck r12) — A SETTINGS ORDER IS TAKEN, OR SAID TO BE DECLINED. NEVER A DEAD END.
 *
 * r9 and r10 matched handedness and theme on the whole utterance, and the r10 edges still missed real
 * orders. "Switch me to dark mode" (the "me" was not allowed), "can you switch me to light mode",
 * "put me in dark mode" and "actually switch me to dark mode" went to Kevin, who has no tool for the
 * theme. "Switch to dark theme", "set the theme to dark" and "switch to light" matched nothing at
 * all, so no [SETTING NOT CHANGED] note reached him either, and he could answer "done". "Change my
 * handedness to lefty" and "set me up as a lefty" were the same kind of miss.
 *
 * FIX: the order verbs take "me" and "it", "theme" is a theme noun, "dark|light" after "to" is an
 * order by itself, and a mention of the theme word or handedness that is not an order is still
 * declined TO HIM with the words that do set it.
 *
 * BEHAVIOURAL: the real precheck (every voice and typed route), the real declined-note, and the real
 * payload builder.
 */
import { precheckLocalIntent, settingNotAppliedNote } from '../../services/localIntentPrecheck';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';

const kind = (u: string) => {
  const hit = precheckLocalIntent(u);
  return hit ? `${hit.intent_type}${hit.parameters?.new_value ? `:${String(hit.parameters.new_value)}` : ''}` : null;
};
const context = (message: string) => String(buildCaddieRequestBody({ message, language: 'en' }).unified_context_block ?? '');

describe('the order is taken with its filler, its "me", or the theme named as a theme', () => {
  it.each([
    ['switch me to dark mode for me', 'change_setting:dark'],
    ['actually switch me to dark mode', 'change_setting:dark'],
    ['can you switch me to light mode', 'change_setting:light'],
    ['put me in dark mode', 'change_setting:dark'],
    ['switch to dark theme', 'change_setting:dark'],
    ['set the theme to dark', 'change_setting:dark'],
    ['make it dark theme', 'change_setting:dark'],
    ['switch to light theme', 'change_setting:light'],
    ['switch to light', 'change_setting:light'],
    ['turn the theme to dark', 'change_setting:dark'],
    ['change my handedness to lefty', 'change_setting:left'],
    ['set me up as a lefty', 'change_setting:left'],
    ['Kevin switch me to lefty', 'change_setting:left'],
    ['switch me to lefty please', 'change_setting:left'],
  ])('"%s" → %s', (u, want) => {
    expect(kind(u)).toBe(want);
  });
});

describe('an order that is not taken is said to be declined, never left to Kevin to pretend', () => {
  it.each([
    'dark theme is hurting my eyes',
    'the theme is dark on this phone',
  ])('"%s" → a declined setting, reaching the caddie as unchanged', (u) => {
    expect(settingNotAppliedNote(u)).toContain('[SETTING NOT CHANGED]');
    expect(context(u)).toContain('[SETTING NOT CHANGED]');
  });

  it('an applied theme order carries no note', () => {
    expect(settingNotAppliedNote('switch to dark theme')).toBeNull();
    expect(context('switch to dark theme')).not.toContain('[SETTING NOT CHANGED]');
  });
});
