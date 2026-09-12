/**
 * 2026-09-06 (Tim, on-course, light mode) — "our bottom caddy bar where you type in… the text
 * doesn't show. It's probably in black and I'm in light mode."
 *
 * He was right, and the mechanism is worth stating precisely because it is invisible in review:
 *
 *   `CaddieBottomBar.bar` hardcodes `backgroundColor: '#0d1a0d'`. The TextInput on it read
 *   `colors.text_primary` from the THEME. In light mode `theme/tokens.ts` sets text_primary to
 *   '#0d1a0d' — byte-for-byte the same value the bar paints. Not poor contrast. The identical
 *   colour. The input text, the placeholder and all three chevrons vanished.
 *
 * THE GENERAL SHAPE: a surface whose colour is FIXED, carrying contents whose colour is THEMED. The
 * two owners disagree the moment the theme moves, and the app is used in dark mode, so it looks
 * right to everyone who builds it and wrong only to whoever is standing outside in daylight.
 *
 * A sweep of the repo found 13 files pairing a hardcoded dark background with themed text. Eleven
 * were fine — either the theme value is overridden inline at the call site (which is the correct
 * pattern, and `app/course/[course_id].tsx` even carries a comment about hitting this exact bug), or
 * the dark surface is a <Video>/<Image> and the text sits in a sibling pane, not on top of it. Two
 * were real: CaddieBottomBar and coach-lesson's black video-review screen.
 *
 * This test is the ratchet. It re-runs that sweep and fails on a NEW pairing, so the next hardcoded
 * dark container cannot quietly acquire themed text.
 */
import fs from 'fs';
import path from 'path';
import { composeTheme, darkTheme, lightTheme } from '../../theme/tokens';

const ROOT = path.join(__dirname, '../..');

/** Perceived luminance. Below this a surface is dark enough that light-mode text disappears on it. */
function isDark(hex: string): boolean {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  return 0.299 * r + 0.587 * g + 0.114 * b < 70;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'ios', 'android', '__tests__'].includes(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.tsx')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/**
 * Known-safe pairings, each checked by hand on 2026-09-06.
 *
 * This list may only get SHORTER. Adding to it means "a dark surface carries themed text and that is
 * fine", which is true only when the theme value is overridden inline or the text is a sibling — and
 * if that is the case, say which, here, so the next reader does not have to re-derive it.
 */
const REVIEWED_SAFE: Record<string, string> = {
  'app/settings.tsx': 'themed rows sit on themed surfaces; the dark hexes are section chrome the text never overlays',
  'app/swinglab/swing/[swing_id].tsx': 'compareVideo is a <Video> background; the caption is in a sibling comparePane',
  'app/swinglab/smartmotion.tsx': 'the dark hexes are the camera surface; overlay text is pinned, not themed',
  'app/swinglab/smart-tempo.tsx': 'camera/video surface, same as smartmotion',
  'components/swinglab/YouTubeReferenceModal.tsx': 'previewThumb is an <Image> background; the title is in a sibling previewBody',
  'app/practice-session/target-calibration.tsx': 'the dark hex is the calibration target itself, not a text surface',
  'app/swinglab/trim.tsx': 'video scrubber surface; its labels are pinned',
  'app/drill-video.tsx': 'video surface',
  'app/jukebox.tsx': 'artwork surface',
  'app/course/[course_id].tsx': 'ctaBar overrides backgroundColor inline with colors.background — the correct pattern, and its comment names this exact bug',
  'components/course/HolePhotosGrid.tsx': 'placeholderWrap overrides backgroundColor inline with colors.surface',
};

/**
 * Files that FIXED the bug by pinning their contents. They must stay pinned.
 *
 * 2026-09-11 — CaddieBottomBar LEFT this list. Pinning its text was the 2026-09-06 fix for a bar
 * whose fill was a hardcoded '#0d1a0d'; the bar is now themed (`colors.surface`), so both halves
 * move together and pinning would re-break it in the opposite direction — white-pinned text on a
 * white light-mode pill. The invariant it actually has to satisfy is asserted directly further down
 * ("the caddie bottom bar specifically"), computed across every palette rather than by pinning an
 * implementation. coach-lesson is unchanged: its surface really is a fixed black video review pane.
 */
const PINNED_SURFACES: { file: string; consts: string[] }[] = [
  { file: 'app/swinglab/coach-lesson.tsx', consts: ['ON_BLACK_TEXT', 'ON_BLACK_MUTED'] },
];

describe('a fixed-colour surface never carries theme-coloured text', () => {
  const offenders = (() => {
    const found: string[] = [];
    for (const abs of walk(ROOT)) {
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      const src = fs.readFileSync(abs, 'utf8');
      const bgs = [...src.matchAll(/backgroundColor:\s*'(#[0-9a-fA-F]{3,8})'/g)].map(m => m[1]);
      if (!bgs.some(isDark)) continue;
      if (!/colors\.text_\w+/.test(src)) continue;
      found.push(rel);
    }
    return found;
  })();

  it('finds files to check (guards the scanner itself)', () => {
    // A scanner that silently matches nothing would make every assertion below vacuously true.
    expect(offenders.length).toBeGreaterThan(0);
  });

  it('every dark-surface file is either reviewed-safe or has pinned its text', () => {
    const pinnedFiles = PINNED_SURFACES.map(p => p.file);
    const unaccounted = offenders.filter(f => !(f in REVIEWED_SAFE) && !pinnedFiles.includes(f));
    expect(unaccounted).toEqual([]);
  });

  it('the reviewed-safe list cannot rot', () => {
    // An entry for a file that no longer pairs the two is an excuse outliving its reason.
    const stale = Object.keys(REVIEWED_SAFE).filter(f => !offenders.includes(f));
    expect(stale).toEqual([]);
  });

  it.each(PINNED_SURFACES.map(p => [p.file, p.consts] as const))(
    '%s keeps its text pinned rather than themed',
    (file, consts) => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const c of consts) expect(src).toContain(c);
    },
  );

  /**
   * THE INVARIANT, stated directly: whatever palette is active, the text painted on the caddie bar
   * must be legible against the bar's own fill. This is what the 2026-09-06 incident was really
   * about — light mode resolved text_primary to '#0d1a0d' while the bar painted '#0d1a0d', so the
   * contrast ratio was exactly 1.00 and everything on the bar vanished.
   *
   * Computed from the palettes rather than asserted about the source, so it holds for whichever fix
   * is in place — pinning the text, theming the surface, or anything later.
   */
  describe('the caddie bottom bar specifically — the one Tim hit on the course', () => {
    const srgb = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const luminance = (hex: string) => {
      const h = hex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
      return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
    };
    const contrast = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };

    /** Every palette the app can actually be in. */
    const PALETTES = [
      ['dark', composeTheme(darkTheme, true, false)],
      ['light', composeTheme(lightTheme, false, false)],
      ['dark high-contrast', composeTheme(darkTheme, true, true)],
      ['light high-contrast', composeTheme(lightTheme, false, true)],
    ] as const;

    it.each(PALETTES.map(([n, t]) => [n, t] as const))(
      'input text is legible on the bar in %s',
      (name, theme) => {
        const ratio = contrast(theme.colors.surface, theme.colors.text_primary);
        expect(`${name}:${ratio >= 4.5}`).toBe(`${name}:true`);
      },
    );

    it.each(PALETTES.map(([n, t]) => [n, t] as const))(
      'the placeholder is legible on the bar in %s',
      (name, theme) => {
        // A placeholder is deliberately quieter than body text, so it gets the large-text floor.
        const ratio = contrast(theme.colors.surface, theme.colors.text_muted);
        expect(`${name}:${ratio >= 3}`).toBe(`${name}:true`);
      },
    );

    it('REJECTS the exact pairing Tim hit — the old bar fill against light-mode text', () => {
      // The bar used to paint '#0d1a0d'; light mode's text_primary is byte-identical.
      expect(lightTheme.colors.text_primary).toBe('#0d1a0d');
      expect(contrast('#0d1a0d', lightTheme.colors.text_primary)).toBeCloseTo(1, 5);
      // ...so had the fill stayed hardcoded, the assertions above would fail. Prove that.
      expect(contrast('#0d1a0d', lightTheme.colors.text_primary) >= 4.5).toBe(false);
    });

    it('the bar takes both its fill and its text from the palette, not from literals', () => {
      const src = fs.readFileSync(path.join(ROOT, 'components/caddie/CaddieBottomBar.tsx'), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toContain("'#0d1a0d'");
      expect(code).toMatch(/backgroundColor: colors\.surface/);
      expect(code).toMatch(/colors\.text_primary/);
      expect(code).toMatch(/placeholderTextColor=\{colors\.text_muted\}/);
    });
  });
});
