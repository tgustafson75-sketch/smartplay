/**
 * constants/useTheme.ts
 *
 * Returns the active theme token set based on user preference (light/dark).
 * Consumers import { useTheme } from '@/constants/useTheme' and access
 * theme.background, theme.card, theme.text, theme.accent, etc.
 *
 * By default the app is dark (golf course / outdoor use).
 * Light mode uses a brighter green-on-darkgreen palette.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Token sets
// ─────────────────────────────────────────────────────────────────────────────

export interface AppTheme {
  background:       string;
  backgroundDeep:   string;
  card:             string;
  cardSunken:       string;
  border:           string;
  borderActive:     string;
  text:             string;
  textSub:          string;
  textMuted:        string;
  accent:           string;
  accentDim:        string;
  miss:             string;
  warn:             string;
  overlay:          string;
  isDark:           boolean;
}

export const darkTheme: AppTheme = {
  background:       '#071E16',
  backgroundDeep:   '#040F0B',
  card:             '#0E2A21',
  cardSunken:       '#091B15',
  border:           '#1C3D2C',
  borderActive:     '#2ECC71',
  text:             'rgba(255,255,255,0.90)',
  textSub:          'rgba(255,255,255,0.65)',
  textMuted:        'rgba(255,255,255,0.45)',
  accent:           '#2ECC71',
  accentDim:        '#27AE60',
  miss:             '#E74C3C',
  warn:             '#F39C12',
  overlay:          'rgba(0,0,0,0.56)',
  isDark:           true,
};

export const lightTheme: AppTheme = {
  background:       '#4FAF7C',
  backgroundDeep:   '#3A9968',
  card:             '#6BCB9C',
  cardSunken:       '#5BBF8A',
  border:           '#3A9968',
  borderActive:     '#22C55E',
  text:             '#071E16',
  textSub:          '#0B3D2E',
  textMuted:        'rgba(7,30,22,0.55)',
  accent:           '#22C55E',
  accentDim:        '#16A34A',
  miss:             '#DC2626',
  warn:             '#D97706',
  overlay:          'rgba(0,0,0,0.32)',
  isDark:           false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook — driven by user preference, not OS color scheme
// ─────────────────────────────────────────────────────────────────────────────
import { useSettingsStore } from '../store/settingsStore';

export const useTheme = (): AppTheme => {
  const bright = useSettingsStore((s) => s.brightMode);
  return bright ? lightTheme : darkTheme;
};
