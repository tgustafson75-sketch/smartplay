/**
 * SmartCaddie Typography System
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for font sizes and weights used across the app.
 * Aligns with Type scale in constants/theme.ts.
 *
 * Rules:
 *  - Core UI (yardage, club, advice) ≥ 16px
 *  - Interactive labels ≥ 14px
 *  - Metadata / badges: 12px minimum
 *  - NEVER use gray (#A7B3AF or opacity < 0.6) for primary information
 */

/** Primary display — yardage number shown on caddie screen */
export const TypographyYardage = {
  fontSize:   46,
  fontWeight: '700' as const,
  lineHeight: 52,
} as const;

/** Club recommendation displayed below yardage */
export const TypographyClub = {
  fontSize:   20,
  fontWeight: '500' as const,
} as const;

/** Section / card label (uppercase caps) */
export const TypographyLabel = {
  fontSize:    14,
  fontWeight:  '600' as const,
  letterSpacing: 1.2,
  textTransform: 'uppercase' as const,
} as const;

/** Primary body text — caddie advice, shot insight */
export const TypographyBody = {
  fontSize:   16,
  fontWeight: '400' as const,
  lineHeight: 24,
} as const;

/** Secondary / metadata — wind, hole info, badges */
export const TypographySecondary = {
  fontSize:   13,
  fontWeight: '400' as const,
} as const;

/** Shot button / action button label */
export const TypographyAction = {
  fontSize:   15,
  fontWeight: '600' as const,
} as const;

/** Stepper value (hole number, score) */
export const TypographyStepper = {
  fontSize:   28,
  fontWeight: '700' as const,
} as const;

/**
 * Convenience bundle — import Typography from '@/theme/typography'
 */
export const Typography = {
  yardage:   TypographyYardage,
  club:      TypographyClub,
  label:     TypographyLabel,
  body:      TypographyBody,
  secondary: TypographySecondary,
  action:    TypographyAction,
  stepper:   TypographyStepper,
} as const;

/**
 * Resolve primary text color based on theme.
 * Use for yardage, club, advice — never use muted/gray for these.
 */
export function getTextColor(theme: 'dark' | 'bright' = 'dark'): string {
  return theme === 'bright' ? '#0B3D2E' : '#FFFFFF';
}

/**
 * Secondary text color — wind speed, hole metadata, badges only.
 * NOT for critical information.
 */
export function getSecondaryColor(theme: 'dark' | 'bright' = 'dark'): string {
  return theme === 'bright' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.65)';
}
