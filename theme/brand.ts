export const Colors = {
  background:    "#0A0F0D",
  surface:       "#121917",
  primary:       "#0F3D2E",
  accent:        "#1F6F54",
  accentSoft:    "#3CBF8F",
  primaryLight:  "#1F6F54",
  textPrimary:   "#FFFFFF",
  textSecondary: "#A7B3AF",
  divider:       "#1E2A26",
};

// ─── Bright / Dark themes ─────────────────────────────────────────────────────

export type ThemeMode = "dark" | "light";

export const Themes = {
  dark: {
    background:    "#0A0F0D",
    surface:       "#121917",
    primary:       "#0F3D2E",
    accent:        "#1F6F54",
    accentSoft:    "#3CBF8F",
    primaryLight:  "#1F6F54",
    textPrimary:   "#FFFFFF",
    textSecondary: "#A7B3AF",
    divider:       "#1E2A26",
    cardBorder:    "rgba(63,191,143,0.18)",
    iconDefault:   "#A7B3AF",
    iconActive:    "#3CBF8F",
    isBright:      false,
  },
  light: {
    background:    "#4FAF7C",
    surface:       "#6BCB9C",
    primary:       "#2A6B4A",
    accent:        "#22C55E",
    accentSoft:    "#16A34A",
    primaryLight:  "#2A6B4A",
    textPrimary:   "#071E16",
    textSecondary: "#0B3D2E",
    divider:       "#3A9968",
    cardBorder:    "rgba(7,30,22,0.15)",
    iconDefault:   "#0B3D2E",
    iconActive:    "#22C55E",
    isBright:      true,
  },
} as const;

export type Theme = typeof Themes.dark | typeof Themes.light;

/**
 * Convenience hook — returns correct theme tokens based on persisted brightMode.
 * Import anywhere that previously used `Colors` from brand.ts.
 */
import { useSettingsStore } from "../store/settingsStore";
export function useTheme(): Theme {
  const bright = useSettingsStore((s) => s.brightMode);
  return bright ? Themes.light : Themes.dark;
}

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const Typography = {
  brand:    { fontSize: 18, letterSpacing: 2,   fontWeight: "600" as const },
  tagline:  { fontSize: 11, letterSpacing: 2.5 },
  headline: { fontSize: 28, fontWeight: "600" as const },
  body:     { fontSize: 16 },
};

export const Caddie = {
  name:    "CADDIE",
  modes:   ["male", "female"] as const,
  default: "female" as const,
  states:  ["idle", "listening", "speaking"] as const,
};
