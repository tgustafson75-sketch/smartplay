/**
 * 2026-10-29 (Brain recheck r13) — THE WORD "THEME" IS NOT A SETTING UNLESS IT IS ABOUT THE APP.
 *
 * The catch-all added in r12 matched a bare \btheme\b, so a golf question about a hole's theme ("what's
 * the theme of the hole") returned a declined-setting note: "The player's words mention the app theme ...
 * say 'switch to dark mode'". services/caddieRequestBody appends that note to every non-proactive turn,
 * so a course-design question reached Kevin with an instruction about app settings. The app-theme words
 * still count, and so does a handedness mention, which keeps its own catch-all.
 *
 * BEHAVIOURAL: the real settingNotAppliedNote on the phrases, which runs the real precheck.
 */
import { settingNotAppliedNote } from '../../services/localIntentPrecheck';

describe('a golf question that says "theme" gets no app-setting note', () => {
  it.each([
    "What's the theme of the hole",
    'what is the theme of this par 3',
    'the theme of the course is links style, what should I hit',
  ])('"%s" gets no note', (t) => {
    expect(settingNotAppliedNote(t)).toBeNull();
  });

  it.each([
    'my app theme is hard to read',
    "the app's theme is wrong",
    'the theme is dark, can you change it',
  ])('"%s" is still a declined app-theme mention', (t) => {
    expect(settingNotAppliedNote(t)).toContain('the app theme');
  });

  it('the handedness catch-all is unchanged', () => {
    expect(settingNotAppliedNote('my buddy is a lefty, what should I play')).toContain('handedness');
  });
});
