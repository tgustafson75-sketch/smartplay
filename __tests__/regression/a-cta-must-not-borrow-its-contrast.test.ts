/**
 * 2026-09-12 (Tim, from a screenshot) — "the frosted effect through the middle fades the start
 * button a bit."
 *
 * Start Round was `rgba(0,200,150,0.12)` — 88% transparent — with a teal label. That read well for
 * exactly one reason: a DARK hero sat behind it. When the hero went full-bleed and its melt-gradient
 * started ending on the PAGE colour directly under the button, there was nothing left to borrow.
 * Measured, the teal label on the light page is 3.20:1 — below the 4.5 floor for its size.
 *
 * The general rule this pins: a PRIMARY CTA carries its own background. Anything that depends on
 * what happens to be behind it is one layout change away from disappearing, and the change that
 * breaks it will be made by someone looking at the theme where it still works.
 */
import fs from 'fs';
import path from 'path';
import { contrastRatio, bestOn, darkTheme, lightTheme, composeTheme } from '../../theme/tokens';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every palette the app can actually be in. */
const PALETTES = [
  ['dark', composeTheme(darkTheme, true, false)],
  ['light', composeTheme(lightTheme, false, false)],
  ['dark high-contrast', composeTheme(darkTheme, true, true)],
  ['light high-contrast', composeTheme(lightTheme, false, true)],
] as const;

describe('contrastRatio and bestOn do real arithmetic', () => {
  it('matches known WCAG anchors', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is order-independent — a ratio is not directional', () => {
    expect(contrastRatio('#009e7a', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#009e7a'), 6);
  });

  it('bestOn picks the higher-contrast candidate, not the first one', () => {
    expect(bestOn('#000000', '#111111', '#ffffff')).toBe('#ffffff');
    expect(bestOn('#ffffff', '#eeeeee', '#000000')).toBe('#000000');
  });

  it('degrades rather than throwing on a non-hex colour', () => {
    expect(() => bestOn('transparent', '#ffffff', '#000000')).not.toThrow();
    expect(() => contrastRatio('rgba(0,0,0,0.5)', '#fff')).not.toThrow();
  });
});

describe('the Start Round label is legible on the filled button in EVERY palette', () => {
  it.each(PALETTES.map(([n, t]) => [n, t] as const))('%s', (name, theme) => {
    const label = bestOn(theme.colors.accent, theme.colors.background, theme.colors.text_primary);
    const ratio = contrastRatio(theme.colors.accent, label);
    // Large bold text (17pt, weight 700) — WCAG large-text floor is 3.0. Hold a margin above it.
    expect(`${name}:${ratio >= 4.5}`).toBe(`${name}:true`);
  });

  it('and the two themes genuinely pick OPPOSITE labels — which is why hardcoding fails', () => {
    const d = bestOn(darkTheme.colors.accent, darkTheme.colors.background, darkTheme.colors.text_primary);
    const l = bestOn(lightTheme.colors.accent, lightTheme.colors.background, lightTheme.colors.text_primary);
    expect(d).toBe(darkTheme.colors.background);
    expect(l).toBe(lightTheme.colors.text_primary);
    expect(d).not.toBe(l);
  });

  it('REJECTS the pairing Tim photographed — the old translucent button on a light page', () => {
    expect(contrastRatio(lightTheme.colors.background, lightTheme.colors.accent)).toBeLessThan(4.5);
  });
});

describe('the button no longer depends on what is behind it', () => {
  const TAB = code('app/(tabs)/caddie.tsx');
  const block = TAB.slice(TAB.indexOf('startRoundBtn: {'), TAB.indexOf('startRoundBtn: {') + 700);

  it('is filled with the accent, not a translucent wash', () => {
    expect(block).toMatch(/backgroundColor: c\.accent,/);
    expect(block).not.toMatch(/rgba\(0,200,150,0\.12\)/);
  });

  it('its border and glow are themed too', () => {
    expect(block).toMatch(/borderColor: c\.accent,/);
    expect(block).toMatch(/shadowColor: c\.accent,/);
  });

  it('the label is chosen by measurement, never hardcoded', () => {
    const label = TAB.slice(TAB.indexOf('startRoundText: {'), TAB.indexOf('startRoundText: {') + 300);
    expect(label).toMatch(/bestOn\(c\.accent, c\.background, c\.text_primary\)/);
    expect(label).not.toMatch(/color: '#/);
  });
});
