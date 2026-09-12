// ─── Disciplined 3-color brand accent palette ────────────────────────────────
// 2026-06-23 (Tim) — retired the scattered per-card rainbow (purple/pink/orange/
// cyan/blue) down to exactly THREE accents so the app reads on-brand. Reference
// these named constants everywhere instead of inline hex. The theme also exposes
// them as colors.accent / colors.accent_amber / colors.accent_sky for components
// inside a theme context; module-level specs (card lists) use the constants.
//   GREEN — the EXISTING brand/primary accent. CORE / capture / play / caddie.
//   AMBER — PRACTICE / tempo / warmth / warnings / intensity.
//   SKY   — ANALYSIS / data / prep / review / info.
/** Brand/primary green — same value as darkTheme.colors.accent. */
export const ACCENT_GREEN = '#00C896';
/** Brand amber. */
export const ACCENT_AMBER = '#FBBF24';
/** Brand sky. */
export const ACCENT_SKY = '#38BDF8';

export interface ThemeColors {
  background: string;
  surface: string;
  surface_elevated: string;
  text_primary: string;
  text_secondary: string;
  text_muted: string;
  accent: string;
  accent_muted: string;
  /** Neon lime #88F700 — used for positive deltas, hero carry numbers, and
   *  SmartMotion icon highlights. Distinct from the teal primary accent. */
  accent_lime: string;
  /** Brand accent — AMBER #FBBF24. The disciplined 3-color palette's "warmth"
   *  channel: PRACTICE / tempo / warnings / intensity. (See ACCENT_AMBER below.) */
  accent_amber: string;
  /** Brand accent — SKY #38BDF8. The palette's "data" channel:
   *  ANALYSIS / prep / review / info. (See ACCENT_SKY below.) */
  accent_sky: string;
  /**
   * 2026-09-05 — Brand YELLOW. SmartFinder's target readout (#FFE600 in dark).
   *
   * Added as a token because it was hardcoded in the screen and therefore had no light-mode value
   * at all: pure yellow on white is ~1.1:1 contrast, which is why Tim could see "shading of yellow
   * or gold text" and nothing else. Dark keeps the exact original hex so the signed-off dark look
   * is unchanged; light gets a darkened yellow of the same hue that actually reads.
   */
  accent_yellow: string;
  success: string;
  warning: string;
  error: string;
  border: string;
  overlay: string;
}

export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface ThemeTypography {
  display:  { fontSize: number; fontWeight: string; lineHeight: number };
  title:    { fontSize: number; fontWeight: string; lineHeight: number };
  headline: { fontSize: number; fontWeight: string; lineHeight: number };
  body:     { fontSize: number; fontWeight: string; lineHeight: number };
  caption:  { fontSize: number; fontWeight: string; lineHeight: number };
  label:    { fontSize: number; fontWeight: string; lineHeight: number };
}

export interface ThemeRadii {
  sm: number;
  md: number;
  lg: number;
  full: number;
}

export interface ThemeTokens {
  colors: ThemeColors;
  spacing: ThemeSpacing;
  typography: ThemeTypography;
  radii: ThemeRadii;
  /** True when the active base palette is the dark theme. Lets components pick
   *  contrast-safe colors (e.g. lime #88F700 washes out on light backgrounds, so
   *  light mode needs a darker green). Always present (defaults true). */
  isDark: boolean;
}

// ─── Spacing + Typography are mode-independent ────────────────────────────────

const spacing: ThemeSpacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

const typography: ThemeTypography = {
  display:  { fontSize: 32, fontWeight: '900', lineHeight: 38 },
  title:    { fontSize: 24, fontWeight: '900', lineHeight: 30 },
  headline: { fontSize: 20, fontWeight: '800', lineHeight: 26 },
  body:     { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  caption:  { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  label:    { fontSize: 10, fontWeight: '700', lineHeight: 14 },
};

const radii: ThemeRadii = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
};

// ─── Dark theme (default — matches existing app colors exactly) ───────────────

export const darkTheme: ThemeTokens = {
  colors: {
    background:       '#060f09',
    surface:          '#0d1a0d',
    surface_elevated: '#0d2418',
    text_primary:     '#ffffff',
    text_secondary:   '#e8f5e9',
    // Phase AA — was '#6b7280' identically in both themes; bumped lighter for
    // dark mode so muted labels are actually readable against #060f09.
    // 2026-09-01 (Tim: "all white text brighten") — was #9ca3af (grey-400). This is a GOLF app: the
    // screen is read at arm's length, outdoors, in direct sun, often through polarised sunglasses.
    // Grey-400 on a dark ground is comfortable at a desk and marginal on a tee box.
    text_muted:       '#c2cad4',
    accent:           '#00C896',
    accent_muted:     '#003d20',
    accent_lime:      '#88F700',
    accent_amber:     '#FBBF24',
    accent_sky:       '#38BDF8',
    accent_yellow:    '#FFE600',
    success:          '#00C896',
    warning:          '#fbbf24',
    error:            '#ef4444',
    border:           '#1e3a28',
    overlay:          'rgba(0,0,0,0.72)',
  },
  spacing,
  typography,
  radii,
  isDark: true,
};

// ─── Light theme ──────────────────────────────────────────────────────────────

export const lightTheme: ThemeTokens = {
  colors: {
    background:       '#f5f9f6',
    surface:          '#ffffff',
    surface_elevated: '#eaf4ef',
    text_primary:     '#0d1a0d',
    text_secondary:   '#374151',
    // Phase AA — was '#6b7280'; pushed darker for light mode so muted labels
    // have real contrast against #f5f9f6 and don't disappear in sunlight.
    text_muted:       '#4b5563',
    accent:           '#009e7a',
    accent_muted:     '#d0f0e6',
    accent_lime:      '#5a9e1a',
    /**
     * 2026-09-05 — DARKENED FOR LIGHT MODE, as accent and accent_lime already were.
     *
     * This sat at the dark value '#FBBF24' while every other brand accent had a light variant —
     * green #00C896 → #009e7a, lime #88F700 → #5a9e1a. Amber was simply missed, so amber text on a
     * white surface ran at roughly 2:1 against a 4.5:1 target. Same hue, enough to read.
     */
    accent_amber:     '#B45309',
    accent_sky:       '#38BDF8',
    /** Dark ships #FFE600; pure yellow is ~1.1:1 on white, so light gets the same hue darkened. */
    accent_yellow:    '#A16207',
    success:          '#009e7a',
    warning:          '#d97706',
    error:            '#dc2626',
    border:           '#c5e0d0',
    overlay:          'rgba(0,0,0,0.45)',
  },
  spacing,
  typography,
  radii,
  isDark: false,
};

// ─── High-contrast variants ─────────────────────────────────────────────────
// Phase AP — applied as an overlay on top of the base dark/light theme when
// the user enables High Contrast in settings. Pure-black/pure-white field
// with stronger borders for readability in bright sunlight or for users
// who need max contrast.
//
// 2026-09-05 — CORRECTED. This used to read "Brand accent colors stay consistent — they already
// pass contrast against both backgrounds." That was not true and it is why brand-coloured text
// disappeared in light mode: #FFE600 is ~1.1:1 on white and the ambers ~2:1, against a 4.5:1
// target. Brand accents now carry LIGHT VARIANTS of the same hue (see lightTheme above), which is
// what accent and accent_lime were already doing. High contrast still leaves them alone; the base
// light theme is where the correction belongs.

export const darkHighContrast: Partial<ThemeTokens['colors']> = {
  background:       '#000000',
  surface:          '#0a0a0a',
  surface_elevated: '#141414',
  text_primary:     '#ffffff',
  text_secondary:   '#f5f5f5',
  text_muted:       '#cfcfcf',
  border:           '#4a4a4a',
};

export const lightHighContrast: Partial<ThemeTokens['colors']> = {
  background:       '#ffffff',
  surface:          '#ffffff',
  surface_elevated: '#f0f0f0',
  text_primary:     '#000000',
  text_secondary:   '#1a1a1a',
  text_muted:       '#3a3a3a',
  border:           '#1a1a1a',
};

/**
 * Compose a base theme with the appropriate high-contrast layer when
 * enabled. Brand accent colors are NOT overridden HERE — but note that is
 * not the same as them being mode-agnostic: as of 2026-09-05 the base light
 * theme carries darkened variants of the brand hues, because the originals
 * do not pass contrast on a white field. High contrast only strengthens the
 * neutrals on top of whichever base is in play.
 */
export function composeTheme(
  base: ThemeTokens,
  isDark: boolean,
  highContrast: boolean,
): ThemeTokens {
  if (!highContrast) return { ...base, isDark };
  const overlay = isDark ? darkHighContrast : lightHighContrast;
  return {
    ...base,
    isDark,
    colors: { ...base.colors, ...overlay },
  };
}

/**
 * 2026-09-11 — Fade a palette colour to transparency.
 *
 * The caddie hero's melt-gradient has to END on whatever the page behind it actually is, or it stops
 * being a dissolve and becomes a hard edge — which is what Tim photographed in light mode, where the
 * gradient melted to the DARK palette's `#060f09` over a `#f5f9f6` page. The gradient needs the same
 * colour at three alphas, so the conversion lives with the palette rather than being open-coded at
 * the one call site that happens to need it today.
 *
 * Accepts the `#rrggbb` form every token in this file uses; anything else is returned untouched so a
 * future `rgba()` or named token degrades to opaque rather than rendering as a black band.
 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * 2026-09-12 — Relative luminance, then the WCAG contrast ratio between two palette colours.
 *
 * Exists because "which text colour reads on this fill?" kept being answered by eye, and the eye was
 * calibrated on dark mode. The caddie tab's Start Round button was a near-transparent teal that
 * borrowed its contrast from the dark hero behind it; once the hero melted into a LIGHT page under
 * it, there was nothing left to borrow and the button faded out (Tim, from a screenshot).
 */
function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick whichever candidate reads best on `background`.
 *
 * Measured rather than assumed, so it stays correct in all five palettes AND if a token is ever
 * retuned. On the current palettes this resolves to the page colour on dark (8.98:1) and
 * text_primary on light (5.27:1) — the opposite choice each way, which is exactly why hardcoding one
 * of them is how a button ends up unreadable in the theme its author does not use.
 */
export function bestOn(background: string, ...candidates: string[]): string {
  let best = candidates[0] ?? '#000000';
  let bestRatio = -1;
  for (const c of candidates) {
    const r = contrastRatio(background, c);
    if (r > bestRatio) { bestRatio = r; best = c; }
  }
  return best;
}
