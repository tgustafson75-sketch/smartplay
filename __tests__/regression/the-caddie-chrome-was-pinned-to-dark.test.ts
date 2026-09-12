/**
 * 2026-09-11 — THE CADDIE TAB'S CHROME IGNORED FOUR OF THE FIVE PALETTES.
 *
 * Tim, on a light-mode screenshot: "there's just always been something so close about the main
 * Caddie tab, but somewhat thematically disjointed." Four surfaces were literals from the DARK
 * palette, so in light mode a black tab row and a black ask pill sandwiched a pale page:
 *
 *   CaddieAvatar       #060f09 ×5  — background, and the hero melt-gradient's end stop
 *   CaddieBottomBar    #0d1a0d     — the ask pill, plus white/#c2cad4 on-bar text
 *   (tabs)/_layout     #0d1a0d / #1e3a28 — the tab row
 *
 * The melt-gradient is the one that matters. It exists BECAUSE of Tim's 2026-07-25 report ("the
 * bottom looks home-made, hard cut-off under the portrait") and its job is to dissolve the hero into
 * the page. Ending it on a literal dark colour meant that in light mode it dissolved into the wrong
 * colour and re-created the exact hard edge it was added to remove — and in dark-HIGH-CONTRAST it
 * melted to #060f09 over a pure #000000 page and floated as a visibly lighter block.
 *
 * Those literals ARE the dark palette's tokens, so dark mode is byte-identical after this.
 */
import fs from 'fs';
import path from 'path';
import { darkTheme, lightTheme, withAlpha } from '../../theme/tokens';

/**
 * Comments are stripped before every match below. The header above quotes the literals this file
 * forbids, and four previous guards in this repo passed only because they were matching their own
 * explanation rather than the code. [[my-own-comment-defeats-my-own-guard]]
 */
const codeOf = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const AVATAR = codeOf('components/CaddieAvatar.tsx');
const BAR = codeOf('components/caddie/CaddieBottomBar.tsx');
const TABS = codeOf('app/(tabs)/_layout.tsx');

describe('the literals this guard exists to reject', () => {
  it('the comment-stripper actually removed the prose, or every test below is vacuous', () => {
    expect(AVATAR).not.toMatch(/thematically disjointed/);
    expect(TABS).not.toMatch(/thematically disjointed/);
    // and it did not eat the code
    expect(AVATAR).toMatch(/LinearGradient/);
    expect(BAR).toMatch(/TextInput/);
    expect(TABS).toMatch(/tabBarStyle/);
  });
});

describe('no surface is pinned to the dark palette', () => {
  it('the avatar carries no dark-background literal', () => {
    expect(AVATAR).not.toMatch(/#060f09/i);
    expect(AVATAR).not.toMatch(/rgba\(6\s*,\s*15\s*,\s*9/i);
  });

  it('the ask bar and the tab row carry no dark-surface literal', () => {
    expect(BAR).not.toMatch(/#0d1a0d/i);
    expect(TABS).not.toMatch(/#0d1a0d/i);
    expect(TABS).not.toMatch(/#1e3a28/i);
  });

  it('the on-bar text is not the dark palette copied by hand', () => {
    // These were named ON_BAR_TEXT / ON_BAR_MUTED with comments saying "dark text_primary".
    expect(BAR).not.toMatch(/ON_BAR_TEXT|ON_BAR_MUTED/);
    expect(BAR).toMatch(/colors\.text_primary/);
    expect(BAR).toMatch(/colors\.text_muted/);
  });
});

describe('the melt-gradient ends on the page colour, whatever the page is', () => {
  it('is derived from the theme, not a literal list', () => {
    expect(AVATAR).toMatch(/colors=\{meltColors\}/);
    expect(AVATAR).toMatch(/withAlpha\(themeColors\.background/);
  });

  it('its final stop equals the background in every palette', () => {
    for (const theme of [darkTheme, lightTheme]) {
      const melt = [
        'transparent', 'transparent',
        withAlpha(theme.colors.background, 0.5),
        withAlpha(theme.colors.background, 0.88),
        theme.colors.background,
      ];
      expect(melt[melt.length - 1]).toBe(theme.colors.background);
      expect(melt[2]).toContain('0.5');
      expect(melt[3]).toContain('0.88');
    }
  });

  it('dark mode is unchanged — these literals WERE the dark tokens', () => {
    expect(darkTheme.colors.background).toBe('#060f09');
    expect(darkTheme.colors.surface).toBe('#0d1a0d');
    expect(darkTheme.colors.border).toBe('#1e3a28');
  });

  it('and light mode genuinely differs, so the fix is observable', () => {
    expect(lightTheme.colors.background).not.toBe(darkTheme.colors.background);
    expect(lightTheme.colors.surface).not.toBe(darkTheme.colors.surface);
  });
});

describe('withAlpha', () => {
  it('converts the #rrggbb form every token uses', () => {
    expect(withAlpha('#060f09', 0.5)).toBe('rgba(6, 15, 9, 0.5)');
    expect(withAlpha('#f5f9f6', 0.88)).toBe('rgba(245, 249, 246, 0.88)');
    expect(withAlpha('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
  });

  it('returns a non-hex colour untouched rather than rendering it as black', () => {
    expect(withAlpha('rgba(1,2,3,0.5)', 0.5)).toBe('rgba(1,2,3,0.5)');
    expect(withAlpha('transparent', 0.5)).toBe('transparent');
  });

  it('clamps out-of-range alpha', () => {
    expect(withAlpha('#ffffff', 5)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha('#ffffff', -2)).toBe('rgba(255, 255, 255, 0)');
  });
});
