export interface ThemeColors {
  background: string;
  surface: string;
  surface_elevated: string;
  text_primary: string;
  text_secondary: string;
  text_muted: string;
  accent: string;
  accent_muted: string;
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
    text_muted:       '#6b7280',
    accent:           '#00C896',
    accent_muted:     '#003d20',
    success:          '#00C896',
    warning:          '#fbbf24',
    error:            '#ef4444',
    border:           '#1e3a28',
    overlay:          'rgba(0,0,0,0.72)',
  },
  spacing,
  typography,
  radii,
};

// ─── Light theme ──────────────────────────────────────────────────────────────

export const lightTheme: ThemeTokens = {
  colors: {
    background:       '#f5f9f6',
    surface:          '#ffffff',
    surface_elevated: '#eaf4ef',
    text_primary:     '#0d1a0d',
    text_secondary:   '#374151',
    text_muted:       '#6b7280',
    accent:           '#009e7a',
    accent_muted:     '#d0f0e6',
    success:          '#009e7a',
    warning:          '#d97706',
    error:            '#dc2626',
    border:           '#c5e0d0',
    overlay:          'rgba(0,0,0,0.45)',
  },
  spacing,
  typography,
  radii,
};
