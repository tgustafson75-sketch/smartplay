/**
 * 2026-09-14 (Tim) — "the Today's Pins card looks like a memory game. Can we make it look like a
 * segmented green? Rounded rectangle or oblong circle — it matches the brand so much more."
 *
 * It was nine separately-rounded boxes, each with a dot in it. That is the shape of Concentration,
 * and he is right that it fights the brand: the information being entered is A POSITION ON A GREEN,
 * so the control should be a green — one oblong surface, divided by mowing lines, with a flag where
 * the pin is.
 *
 * NOTHING ABOUT THE DATA CHANGED. Still depth × side, still one tap, still declared once for the
 * round, still routed through setSetupPin. The sibling guard
 * (the-pin-moves-every-yardage-at-once) covers that and must keep passing.
 *
 * WHAT MAKES IT READ AS ONE SURFACE rather than nine buttons is the clipped parent: a large radius
 * plus overflow hidden means the corner segments inherit the green's curve. Lose either and the
 * memory game comes back, which is why both are pinned here.
 */
import fs from 'fs';
import path from 'path';
import { contrastRatio, bestOn, darkTheme, lightTheme, composeTheme } from '../../theme/tokens';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const PLAY = code('app/(tabs)/play.tsx');
const style = (name: string) => {
  const at = PLAY.indexOf(`  ${name}: {`);
  if (at < 0) return '';
  return PLAY.slice(at, PLAY.indexOf('},', at));
};

/** Every palette the app can actually be in. */
const PALETTES = [
  ['dark', composeTheme(darkTheme, true, false)],
  ['light', composeTheme(lightTheme, false, false)],
  ['dark high-contrast', composeTheme(darkTheme, true, true)],
  ['light high-contrast', composeTheme(lightTheme, false, true)],
] as const;

describe('it is one green, not nine boxes', () => {
  it('the turf is a single clipped surface', () => {
    const g = style('pinGreen');
    expect(g).toMatch(/overflow: 'hidden'/);
    expect(g).toMatch(/borderRadius: \d\d/);           // a real oblong radius, not 4
    expect(g).toMatch(/backgroundColor: c\.accent_muted/);
  });

  it('the radius is big enough to read as a green, not a card', () => {
    const m = /borderRadius: (\d+)/.exec(style('pinGreen'));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(28);
  });

  it('the segments themselves have NO box of their own — that was the memory game', () => {
    const cell = style('pinCell');
    expect(cell).not.toMatch(/borderRadius/);
    expect(cell).not.toMatch(/borderWidth/);
    expect(cell).not.toMatch(/backgroundColor/);
  });

  it('they are divided by hairlines — a seam in turf, not a table', () => {
    expect(style('pinGreenDivideTop')).toMatch(/StyleSheet\.hairlineWidth/);
    expect(style('pinGreenDivideLeft')).toMatch(/StyleSheet\.hairlineWidth/);
  });

  it('the depth labels sit outside the turf so the curve cannot clip them', () => {
    expect(PLAY).toMatch(/pinDepthCol/);
    expect(style('pinRowLabel')).not.toMatch(/width: 56/);   // no longer inside the row
  });

  it('every segment is still a full-height tap target', () => {
    expect(style('pinCell')).toMatch(/flex: 1/);
    const h = /height: (\d+)/.exec(style('pinGreen'));
    expect(Number(h![1]) / 3).toBeGreaterThanOrEqual(44);    // 44pt minimum, per band
  });
});

describe('the declared pin is a FLAG, and it is legible in every palette', () => {
  it('is drawn from Views — no icon family, no SVG, nothing to drift', () => {
    expect(style('pinFlagPole')).toMatch(/backgroundColor/);
    expect(style('pinFlagCloth')).toMatch(/borderLeftWidth: 9/);
    expect(PLAY).not.toMatch(/Ionicons|react-native-svg/);
  });

  it('sits on a SOLID accent patch, so there is one known background to be legible against', () => {
    expect(style('pinCellActive')).toMatch(/backgroundColor: c\.accent\b/);
    // a translucent wash would land on a different colour in each palette
    expect(style('pinCellActive')).not.toMatch(/withAlpha/);
  });

  it('takes its colour by measurement, never hardcoded', () => {
    for (const s of [style('pinFlagPole'), style('pinFlagCloth')]) {
      expect(s).toMatch(/bestOn\(c\.accent, c\.background, c\.text_primary\)/);
      expect(s).not.toMatch(/#[0-9a-fA-F]{6}/);
    }
  });

  it.each(PALETTES.map(([n, t]) => [n, t] as const))('reads on the patch in %s', (name, theme) => {
    const flag = bestOn(theme.colors.accent, theme.colors.background, theme.colors.text_primary);
    expect(`${name}:${contrastRatio(theme.colors.accent, flag) >= 4.5}`).toBe(`${name}:true`);
  });

  it('REJECTS the lime flag I tried first — it measured 2.73 on light turf', () => {
    expect(contrastRatio(lightTheme.colors.accent_muted, lightTheme.colors.accent_lime)).toBeLessThan(3);
  });
});

describe('the unpicked segments stay visible without shouting', () => {
  it('use text_muted, the token built to read on a surface', () => {
    expect(style('pinDot')).toMatch(/backgroundColor: c\.text_muted/);
  });

  it.each(PALETTES.map(([n, t]) => [n, t] as const))('is legible on the turf in %s', (name, theme) => {
    const ratio = contrastRatio(theme.colors.accent_muted, theme.colors.text_muted);
    expect(`${name}:${ratio >= 4.5}`).toBe(`${name}:true`);
  });

  it('and the accent would NOT have been — which is why it is not used here', () => {
    expect(contrastRatio(lightTheme.colors.accent_muted, lightTheme.colors.accent)).toBeLessThan(3);
  });
});
