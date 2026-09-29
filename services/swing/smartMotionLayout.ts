/**
 * 2026-09-29 — SMARTMOTION'S SIZE DECISIONS, IN ONE PURE PLACE.
 *
 * A narrow-phone layout audit found defects Tim cannot see: he tests on the open Fold (~690dp wide),
 * and the review bar, the metric rails, the tools card and several overlays were sized for it. Every
 * threshold below is width- or height-conditional so the Fold view is unchanged; keeping them here
 * makes each one testable at 320 / 344 / 360 / 690dp without mounting a 7,000-line screen.
 */

/**
 * The font scale that text inside a FIXED-SIZE HUD box stops growing at: rail cards (112/124dp), the
 * 40/46dp review buttons' labels, the footer chips, the swing-count chips, the header. Past it such text
 * overran its box or was ellipsized to nothing; body copy that wraps (analysis page, tool card rows)
 * keeps the player's full font scale.
 */
export const HUD_MAX_FONT_SCALE = 1.3;

/** Below this width the review bar, the rails and the eye button compact. The Fold open is ~690dp. */
export const NARROW_WIDTH_DP = 400;
/** Below this height (a 667dp phone) overlays in review stop paying the bottom inset twice. */
export const SHORT_HEIGHT_DP = 740;
/** A review video box shorter than this has no room for the floating metric rails. */
export const MIN_VIDEO_BOX_FOR_RAILS_DP = 320;

/**
 * The review control bar: six 46dp buttons with 8dp gaps plus a flex spacer overflowed a 320dp phone
 * by ~16dp (and lost half of "New Set" at font scale 1.3). Narrow: 40dp buttons, 4dp gaps, no spacer,
 * spread edge to edge.
 */
export function reviewBarLayout(windowWidth: number): { spacer: boolean; gap: number; button: number; spread: boolean } {
  const narrow = windowWidth < NARROW_WIDTH_DP;
  return narrow ? { spacer: false, gap: 4, button: 40, spread: true } : { spacer: true, gap: 8, button: 46, spread: false };
}

/** The floating metric rail width. 100dp truncated "BALL SPEED" / "105 mph" below 400dp. */
export function railWidth(windowWidth: number): number {
  return windowWidth < NARROW_WIDTH_DP ? 112 : 124;
}

/** Whether the floating review rails fit over the video at all. Unknown size (0) → show, as before. */
export function showReviewRails(videoBoxHeight: number): boolean {
  return !(videoBoxHeight > 0 && videoBoxHeight < MIN_VIDEO_BOX_FOR_RAILS_DP);
}

/**
 * The bottom inset an overlay INSIDE the review video box should add. In review the deck sits in flow
 * below the video and already pays the inset; on a short phone paying it again pushes captions into
 * the golfer. Height-conditional so taller screens (the Fold) are unchanged.
 */
export function reviewOverlayInset(windowHeight: number, insetBottom: number): number {
  return windowHeight < SHORT_HEIGHT_DP ? 0 : insetBottom;
}

/**
 * A bottom offset that clears the deck. The deck is content-height (chips, club bar, controls, and
 * font scale all change it), so fixed offsets either overlapped it or floated far above it. Before the
 * deck has been measured, the previous fixed offset stands.
 */
export function aboveDeck(deckHeight: number, fallback: number): number {
  return Number.isFinite(deckHeight) && deckHeight > 0 ? Math.round(deckHeight) + 8 : fallback;
}

/**
 * The setup-tools card's max height: it opens below the chevron at insetTop + 122 and must stop above
 * the bottom inset, or its last rows run off an SE-sized screen at font scale 1.3. Never below 160 so
 * at least the header and two rows show before it scrolls.
 */
export function toolCardMaxHeight(windowHeight: number, insetTop: number, insetBottom: number): number {
  return Math.max(160, Math.round(windowHeight - (insetTop + 122) - insetBottom - 12));
}

/**
 * The mode-change label ("FULL SWING" / "PUTTING") beside the mode button. It was written in June for a
 * mode button on the RIGHT of the deck (label to its left, toward the centre); on 06-29 the button moved
 * to the left edge and the label kept `right: 62` — off-screen at every width. It now sits to the button's
 * right, toward the centre again, in the gap before the 56dp record/stop button:
 * deck padding 10 · mode 50 · gap · record 56 · gap · flag 50 · padding 10 (space-between), 6dp clear
 * of each neighbour. Capped at 150 so a wide screen keeps the original size.
 */
export const MODE_FADE_LABEL_OFFSET_DP = 50 + 6;
export function modeFadeLabelWidth(windowWidth: number): number {
  const gap = (windowWidth - 2 * 10 - 50 - 56 - 50) / 2;
  return Math.max(0, Math.min(150, Math.floor(gap - 2 * 6)));
}
