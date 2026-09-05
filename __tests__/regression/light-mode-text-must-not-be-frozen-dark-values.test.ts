/**
 * 2026-09-05 (Tim) — "check all font and font color logic in light mode. The hero card for example
 * on the play tab shows pretty much no text but I can see shading of yellow or gold text."
 *
 * The Play tab's hero card had its text colours hardcoded to the DARK theme's values —
 * '#eafff6', 'rgba(232,245,233,0.62)', '#e8f5e9' — inside a stylesheet that is otherwise built from
 * theme tokens. On a card whose background composites to pale mint over white, near-white text at
 * 62% opacity is invisible. Note '#e8f5e9' IS dark `text_secondary` verbatim: these were never
 * chosen for light mode, they were the dark values frozen in place before the token pass.
 *
 * The gold he could still see is the giveaway. `accent_amber` (#FBBF24) and `warning` are
 * deliberately identical in both themes, so amber survived while everything around it vanished —
 * which is exactly what "no text but shading of gold" looks like.
 *
 * 49 more of the same shape were found across SmartFinder, the caddie tab, lie-analysis and
 * setup-check. Most were pure '#ffffff', which is dark `text_primary` verbatim, so tokenising them
 * changes nothing in dark mode and everything in light.
 *
 * This guard is deliberately narrow: it looks ONLY inside makeStyles() — a stylesheet that already
 * takes theme tokens and then hardcodes a light-only colour is self-contradicting, and that is the
 * bug. Colours outside a themed stylesheet are a separate question.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');

/** Screens whose stylesheets are theme-driven and must stay that way. */
const THEMED_SCREENS = [
  path.join('app', '(tabs)', 'play.tsx'),
  path.join('app', '(tabs)', 'caddie.tsx'),
  path.join('app', 'smartfinder.tsx'),
  path.join('app', 'lie-analysis.tsx'),
  path.join('app', 'swinglab', 'setup-check.tsx'),
];

/**
 * Near-white / very light text literals. These are unreadable on a light background by
 * construction, so inside a themed stylesheet they are always a defect.
 */
const LIGHT_ONLY_TEXT = /color:\s*'(#[eEfF][0-9a-fA-F]{5}|#[dD][0-9a-fA-F]{5}|rgba\(2[0-9]{2}\s*,)/g;

/**
 * 2026-09-05 — THERE IS NO BRAND EXEMPTION, and there was nearly one.
 *
 * My first pass exempted #FFE600 / #F5A623 / #F0C030 / #F0803C as "deliberate brand accents" and
 * flagged them for Tim to decide. He pushed back, correctly: theme/tokens.ts ALREADY darkens brand
 * hues for light mode — green #00C896 → #009e7a, lime #88F700 → #5a9e1a — and its own comment
 * claimed "brand accent colors ... already pass contrast against both backgrounds", which was
 * simply false. #FFE600 is ~1.1:1 on white; the ambers ~2:1; the target is 4.5:1.
 *
 * Amber had been missed in that pass and the yellows were never tokenised at all. They now carry
 * light variants of the same hue (accent_amber, accent_yellow), dark values unchanged. So the rule
 * is unconditional: inside a themed stylesheet, no hardcoded light-only text colour, brand or not.
 */

function stylesheetOf(rel: string): string | null {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const i = src.search(/function makeStyles\(/);
  if (i === -1) return null;
  // Strip comments: several of these files DOCUMENT the old hex values in prose explaining the fix.
  return src.slice(i).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('a themed stylesheet never hardcodes a light-only text colour', () => {
  for (const rel of THEMED_SCREENS) {
    it(`${rel} takes its text colours from the theme`, () => {
      const css = stylesheetOf(rel);
      expect(css).not.toBeNull();
      const offenders = [...(css as string).matchAll(LIGHT_ONLY_TEXT)].map(m => m[1]);
      expect(offenders).toEqual([]);
    });
  }

  it('the guard can actually see a stylesheet — a renamed makeStyles must fail loudly', () => {
    for (const rel of THEMED_SCREENS) {
      expect([rel, stylesheetOf(rel) !== null]).toEqual([rel, true]);
    }
  });

  it('the theme still distinguishes light from dark, which is what makes the fix work', () => {
    // If these ever collapse to the same value the tokens become decorative and the bug returns
    // wearing a token's name.
    const tokens = fs.readFileSync(path.join(root, 'theme', 'tokens.ts'), 'utf8');
    const lightPrimary = /text_primary:\s*'(#[0-9a-fA-F]{6})'/g;
    const found = [...tokens.matchAll(lightPrimary)].map(m => m[1].toLowerCase());
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(new Set(found).size).toBeGreaterThan(1);
  });
});
