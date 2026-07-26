/**
 * 2026-07-26 (Tim) — PURE responsive classifier (no react-native import, so it's testable in the sim
 * harness and usable by non-React callers). The hook `useLayout()` is a thin reactive wrapper around
 * this. See useLayout.ts for the full rationale (one source of truth for per-screen sizing).
 */

export type Breakpoint = 'phone' | 'largePhone' | 'foldOpen' | 'tablet';

export interface LayoutInfo {
  width: number;
  height: number;
  shortestSide: number;
  longestSide: number;
  breakpoint: Breakpoint;
  /** Narrow phones + Fold-Z folded (tall-narrow) — the tightest case; use compact spacing. */
  isNarrow: boolean;
  isPhone: boolean;      // phone OR largePhone (any handset)
  isLargePhone: boolean;
  isFoldOpen: boolean;   // unfolded foldable / small landscape, NOT a tablet
  isTablet: boolean;     // iPad-class canvas (shortest side ≥ 600)
  isLandscape: boolean;
  /** Side-by-side layout is viable (wide enough): landscape-and-wide, or a tablet. */
  isSplit: boolean;
  /** Standard horizontal screen padding for this size. */
  gutter: number;
  /** Cap for centered content columns so text/cards don't stretch edge-to-edge on wide screens. */
  maxContentWidth: number;
  /** width clamped to maxContentWidth — the usable content column width. */
  contentWidth: number;
  /** Multiplier for scaling up sizes on bigger canvases (1 on phones, up to ~1.25 on tablets). */
  scale: number;
}

// Breakpoint thresholds (dp). Kept as named constants so tuning is one place.
export const BP = { largePhone: 400, foldOpen: 640, tablet: 900, tabletShortSide: 600 } as const;

/** Pure classifier — the hook is a thin reactive wrapper. Exported for tests + non-React callers. */
export function classifyLayout(width: number, height: number): LayoutInfo {
  const shortestSide = Math.min(width, height);
  const longestSide = Math.max(width, height);
  const isLandscape = width > height;

  // Tablet is defined by the physical canvas (shortest side), NOT the current width — so an iPad in
  // portrait is still a tablet, and a wide-but-short foldable isn't mistaken for one.
  const isTablet = shortestSide >= BP.tabletShortSide;

  const breakpoint: Breakpoint =
    isTablet ? 'tablet' :
    width >= BP.foldOpen ? 'foldOpen' :
    width >= BP.largePhone ? 'largePhone' :
    'phone';

  const isNarrow = !isTablet && width < 360;
  const isFoldOpen = breakpoint === 'foldOpen';
  const isLargePhone = breakpoint === 'largePhone';
  const isPhone = breakpoint === 'phone' || breakpoint === 'largePhone';

  // Side-by-side is worth it when there's real horizontal room: a tablet, or a wide landscape.
  const isSplit = isTablet || (isLandscape && width >= BP.foldOpen);

  const gutter = isNarrow ? 12 : isTablet ? 24 : 16;
  const maxContentWidth = isTablet ? 760 : isSplit ? 680 : width;
  const contentWidth = Math.min(width, maxContentWidth);
  const scale = isTablet ? 1.2 : isFoldOpen ? 1.08 : 1;

  return {
    width, height, shortestSide, longestSide, breakpoint,
    isNarrow, isPhone, isLargePhone, isFoldOpen, isTablet, isLandscape, isSplit,
    gutter, maxContentWidth, contentWidth, scale,
  };
}
