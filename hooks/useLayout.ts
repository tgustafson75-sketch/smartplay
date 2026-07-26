/**
 * 2026-07-26 (Tim) — ONE responsive source of truth. Every screen used to invent its own W/H
 * breakpoints + offsets, so layouts drifted and small sizes (Fold-Z folded) kept hitting edge cases
 * ("we tend to have consistent issues with element formatting by screen size"). This hook centralizes
 * the device class + the standard sizing tokens so screens size from ONE place instead of ad-hoc math.
 *
 * Device classes (by width, with a tablet override from the SHORTEST side so an iPad reads as a tablet
 * in both orientations, and a phone never does):
 *   - phone       : narrow phones + Fold-Z FOLDED (tall-narrow)      width < 400
 *   - largePhone  : big phones (Pro Max, etc.)                        400–639
 *   - foldOpen    : unfolded foldables / small landscape             640–899   (not a tablet)
 *   - tablet      : iPad-class canvas                                 shortestSide ≥ 600 (any width)
 *
 * Usage: `const { isNarrow, isTablet, isSplit, gutter, maxContentWidth, contentWidth } = useLayout();`
 * Nothing here forces a layout — it's advisory sizing; screens opt in incrementally (no big-bang
 * refactor, no regression). Pure + reactive (re-renders on rotate / fold via useWindowDimensions).
 *
 * The classifier lives in layoutClassify.ts (RN-free → testable in the sim harness); this file is the
 * thin reactive wrapper. Re-exports the classifier + types so callers only import from one place.
 */
import { useWindowDimensions } from 'react-native';
import { classifyLayout, type LayoutInfo } from './layoutClassify';

export { classifyLayout, BP, type Breakpoint, type LayoutInfo } from './layoutClassify';

export function useLayout(): LayoutInfo {
  const { width, height } = useWindowDimensions();
  return classifyLayout(width, height);
}
