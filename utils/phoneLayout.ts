/**
 * 2026-09-29 — narrow-phone layout breakpoints (iPhone SE 320/375, iPhone 390-430, Fold cover ~344).
 *
 * The owner tests on the OPEN Fold (~690dp), where every one of these rows fits; the narrow audit
 * (widths 320-430, fontScale 1.0 and 1.3 — there is deliberately no maxFontSizeMultiplier in the
 * app) found them overflowing on the phones the app actually ships to. Each breakpoint below is
 * the width UNDER which a row changes shape; at or above it the original wide layout renders
 * byte-for-byte unchanged. One owner for the numbers so a retune happens here, not per screen.
 */

/** Play tab, selected-course card: 4 equal action buttons -> 2x2 grid below this width. */
export const ACTION_ROW_GRID_BELOW = 440;
/** Play tab, course list rows: distance pill moves under the course name below this width. */
export const COURSE_ROW_STACK_BELOW = 400;
/** Play tab, co-located "which course?" banner: the two choices take their own line below this. */
export const AT_COURSE_CHOICES_WRAP_BELOW = 400;
/** SwingLab hero feature row: icon stacks above a 2-line label below this width. */
export const SWINGLAB_FEATURE_STACK_BELOW = 500;
/** SwingLab section hero: the PRACTICE tag drops under the title below this width. */
export const SWINGLAB_TAG_STACK_BELOW = 380;

export const isBelow = (width: number, breakpoint: number): boolean => width < breakpoint;

/**
 * Props for a label that must stay on ONE line and shrink to fit rather than wrap or clip.
 * Shrinks only when the text would otherwise overflow, so a row that already fits renders
 * unchanged, and the user's system font size is still honoured everywhere it fits.
 */
export const fitOneLine = (minimumFontScale = 0.8) =>
  ({ numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale }) as const;

/**
 * How far GlobalCaddieBar (mounted at the ROOT, its bottom edge on the screen bottom) must lift
 * while the keyboard is up.
 *
 * - iOS: keyboardWillShow's endCoordinates.height is measured to the screen bottom and already
 *   INCLUDES the home-indicator area, so the keyboard's top edge is exactly `keyboardHeight` above
 *   the bar's resting bottom. Adding insets.bottom + 10 (2026-09-29 audit) floated the bar ~44-50dp
 *   above the keyboard on every Face-ID iPhone.
 * - Android (edge-to-edge): keyboardDidShow's height EXCLUDES the nav-bar inset, so the bar needs
 *   that inset plus a small upward bias (2026-07-25, "I still can't see what I typed"). Unchanged.
 */
export const caddieBarKeyboardLift = (
  os: string,
  keyboardHeight: number,
  insetBottom: number,
): number => {
  if (!(keyboardHeight > 0)) return 0;
  return os === 'ios' ? keyboardHeight : keyboardHeight + insetBottom + 10;
};
