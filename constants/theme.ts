/**
 * SmartPlay Caddie — Design System
 *
 * Single source of truth for colors, spacing, typography, and shared styles.
 * Import { DS } from '@/constants/theme' in any screen or component.
 */

import { Platform, StyleSheet } from 'react-native';
// Re-export layout hook for convenience
export { useLayout, buildLayout, getBreakpoint, BP } from '../hooks/use-layout';
export type { LayoutTokens, Breakpoint } from '../hooks/use-layout';

// ─── Palette ─────────────────────────────────────────────────────────────────

export const Palette = {
  // Brand greens — premium dark palette
  brand:        '#071E16',   // screen background
  brandDeep:    '#071E16',   // deepest background
  cardBg:       '#0E2A21',   // card surface
  cardBgDark:   '#091B15',   // sunken card
  border:       '#1C3D2C',   // standard border — barely visible
  borderSubtle: '#0F2018',   // divider only
  borderActive: '#2ECC71',   // accent border
  bgActive:     '#12382C',   // selected / active chip bg
  bgHover:      '#112C20',   // pressed state

  // Semantic
  positive:     '#2ECC71',   // primary accent — clean green
  positiveDim:  '#27AE60',   // secondary accent
  positiveFaint:'rgba(255,255,255,0.90)',  // primary text
  muted:        'rgba(255,255,255,0.45)', // labels / disabled
  mutedBorder:  '#1A1A1A',   // dark-theme muted border

  // Intent
  miss:         '#C0392B',   // miss / error
  missWarm:     '#E74C3C',   // softer error
  warn:         '#E67E22',   // caution — amber
  warnLight:    '#F39C12',   // lighter amber
  info:         '#7F8EC8',   // insight — muted purple
  infoBg:       '#141230',   // info tile bg
  accent:       '#F0C030',   // rangefinder — gold

  // Neutral
  white:        '#FFFFFF',
  textPrimary:  'rgba(255,255,255,0.90)',
  textSub:      'rgba(255,255,255,0.65)',
  textMuted:    'rgba(255,255,255,0.45)',
  overlay:      'rgba(0,0,0,0.56)',
  overlayLight: 'rgba(0,0,0,0.32)',
} as const;

// ─── Spacing ─────────────────────────────────────────────────────────────────

export const Space = {
  xs:  4,
  sm:  7,
  md:  11,
  lg:  14,
  xl:  18,
  xxl: 24,
  section: 18,
} as const;

// ─── Border radius ────────────────────────────────────────────────────────────

export const Radius = {
  sm:   8,
  md:   12,
  lg:   14,
  xl:   18,
  xxl:  20,
  pill: 999,
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────

export const Type = {
  // sizes — strict scale
  xs:    11,   // labels (uppercase, letterSpacing: 1, opacity 0.6)
  sm:    12,   // captions, sub-labels
  body:  14,   // body text
  md:    16,   // secondary values, club names
  lg:    18,   // secondary values (large)
  xl:    20,   // section headings
  h2:    24,   // headings
  h1:    28,   // screen titles
  dist:  46,   // distance primary number
  hero:  72,   // oversized display (legacy — prefer dist)
  // weights
  regular:   '400' as const,
  medium:    '500' as const,
  semibold:  '600' as const,
  bold:      '700' as const,
  black:     '800' as const,
  // line heights
  tight: 1.2,
  base:  1.5,
  loose: 1.7,
} as const;

// ─── Shared StyleSheet fragments ─────────────────────────────────────────────

export const DS = StyleSheet.create({
  // Surfaces
  screen: {
    flex: 1,
    backgroundColor: Palette.brand,
  },
  card: {
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 13,
  },
  cardSunken: {
    backgroundColor: Palette.cardBgDark,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 13,
  },
  cardAccent: {
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 0,
    borderColor: 'transparent',
    borderLeftWidth: 2,
    borderLeftColor: Palette.positive,
    padding: 13,
  },

  // Header bar (reused across all tabs)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
    minHeight: 76,
  },
  headerTitle: {
    color: Palette.textPrimary,
    fontSize: Type.lg,
    fontWeight: Type.semibold,
  },
  headerSub: {
    color: Palette.muted,
    fontSize: Type.sm,
    marginTop: 1,
  },

  // Tools pill (3-dot menu trigger)
  toolsPill: {
    height: 28,
    paddingHorizontal: Space.md,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Palette.cardBg,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  toolsPillActive: {
    backgroundColor: Palette.bgActive,
    borderColor: Palette.borderActive,
  },
  dot: {
    width: 3, height: 3, borderRadius: 2,
    backgroundColor: Palette.muted,
  },
  dotActive: {
    backgroundColor: Palette.positive,
  },

  // Tools dropdown menu
  toolsMenu: {
    position: 'absolute',
    right: 14,
    zIndex: 52,
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    maxHeight: 420,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm + 1,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Palette.cardBg,
  },
  menuItemIcon: { fontSize: 16 },
  menuItemText: {
    color: Palette.textSub,
    fontSize: Type.body,
    fontWeight: Type.medium,
  },

  // Rangefinder icon button
  rfBtn: {
    width: 34, height: 34,
    borderRadius: Radius.sm,
    backgroundColor: Palette.cardBg,
    borderWidth: 1,
    borderColor: Palette.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Space.sm,
  },

  // Typography
  label: {
    color: Palette.muted,
    fontSize: Type.xs,
    fontWeight: Type.medium,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  caption: {
    color: Palette.muted,
    fontSize: Type.xs,
    fontWeight: Type.medium,
    letterSpacing: 1.2,
  },
  bodyText: {
    color: Palette.textSub,
    fontSize: Type.body,
    lineHeight: Type.body * Type.base,
  },
  sectionTitle: {
    color: Palette.textSub,
    fontSize: Type.body,
    fontWeight: Type.semibold,
    letterSpacing: 0.4,
    marginBottom: Space.xs,
  },

  // Chip / select row
  chip: {
    flex: 1,
    minWidth: 90,
    backgroundColor: Palette.cardBg,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    paddingVertical: Space.md - 2,
    paddingHorizontal: Space.md,
    alignItems: 'center',
  },
  chipActive: {
    backgroundColor: Palette.bgActive,
    borderColor: Palette.borderActive,
  },
  chipLabel: {
    color: Palette.muted,
    fontSize: Type.body,
    fontWeight: Type.medium,
  },
  chipLabelActive: {
    color: Palette.textPrimary,
  },

  // Text input
  input: {
    backgroundColor: Palette.cardBg,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.md,
    color: Palette.textPrimary,
    fontSize: Type.md,
  },

  // Stat pill (summary numbers)
  statPill: {
    flex: 1,
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.md,
    padding: Space.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Palette.border,
  },
  statPillNum: {
    color: Palette.textPrimary,
    fontWeight: Type.bold,
    fontSize: Type.xl,
  },
  statPillLabel: {
    color: Palette.textMuted,
    fontSize: Type.xs,
    marginTop: 2,
  },
});

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
