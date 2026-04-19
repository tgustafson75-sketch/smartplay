/**
 * theme/tokens.ts — Design tokens for SmartPlay Caddie
 *
 * Single source of truth for colours, spacing, and radius.
 * Values align with constants/theme.ts where both exist; this file
 * adds missing tokens without conflicting with the existing theme.
 */

export const COLORS = {
  primary:       '#0B3D2E',
  action:        '#2ECC71',
  bg:            '#071E17',
  card:          '#0E2A22',
  textPrimary:   '#FFFFFF',
  textSecondary: '#A7B3AF',
  accent:        '#FF6B6B',
  success:       '#6ee7b7',
  warning:       '#fcd34d',
  info:          '#93c5fd',
  border:        '#1a4a2e',
} as const;

export const SPACING = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  24,
  xxxl: 32,
} as const;

export const RADIUS = {
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
} as const;
