import { useWindowDimensions } from 'react-native';

// ─── Breakpoints ──────────────────────────────────────────────────────────────
// small  : <375   — iPhone SE, Galaxy A series compact
// medium : <600   — standard iPhones, most Android phones
// large  : ≥600   — Galaxy Fold (unfolded ~600dp), tablets, landscape mid-range
export const BP = {
  small:  375,
  medium: 600,
} as const;

export type Breakpoint = 'small' | 'medium' | 'large';

export function getBreakpoint(width: number): Breakpoint {
  if (width < BP.small)  return 'small';
  if (width < BP.medium) return 'medium';
  return 'large';
}

// ─── Layout tokens that scale per breakpoint ──────────────────────────────────
export interface LayoutTokens {
  bp: Breakpoint;
  isSmall:  boolean;
  isMedium: boolean;
  isLarge:  boolean;
  /** Whether to use two-column layout (Fold unfolded / tablet) */
  isWide: boolean;

  screenW: number;
  screenH: number;

  // Typography
  heroFontSize:  number;
  h1FontSize:    number;
  bodyFontSize:  number;

  // Cards / containers
  cardPadding:   number;
  cardRadius:    number;
  /** Horizontal screen padding */
  hPad:          number;
  /** Vertical gap between blocks */
  blockGap:      number;

  // Play screen specifics
  shotBtnH:      number;
  shotBtnRadius: number;
  shotBtnEmoji:  number;
  qBtnSize:      number;
  watchCardW:    number;
  watchFontSize: number;

  // Column width when in large/two-column mode (half screen minus gaps)
  colW: number;
}

export function buildLayout(w: number, h: number): LayoutTokens {
  const bp       = getBreakpoint(w);
  const isSmall  = bp === 'small';
  const isMedium = bp === 'medium';
  const isLarge  = bp === 'large';
  const isWide   = isLarge;

  return {
    bp, isSmall, isMedium, isLarge, isWide,
    screenW: w,
    screenH: h,

    // Typography
    heroFontSize: isSmall ? 68 : isMedium ? 80 : 96,
    h1FontSize:   isSmall ? 22 : isMedium ? 28 : 34,
    bodyFontSize: isSmall ? 13 : isMedium ? 15 : 16,

    // Spacing
    cardPadding: isSmall ? 12 : isMedium ? 16 : 20,
    cardRadius:  isSmall ? 12 : 14,
    hPad:        isSmall ? 12 : isMedium ? 16 : 24,
    blockGap:    isSmall ? 10 : isMedium ? 14 : 20,

    // Play screen
    shotBtnH:      isSmall ? 76 : isMedium ? 88 : 100,
    shotBtnRadius: isSmall ? 14 : 18,
    shotBtnEmoji:  isSmall ? 24 : 30,
    qBtnSize:      isSmall ? 64 : isMedium ? 72 : 86,
    watchCardW:    Math.min(w - 48, isLarge ? 320 : 220),
    watchFontSize: isSmall ? 52 : isLarge ? 80 : 68,

    // Two-column width: (screen - hPad*2 - gap) / 2
    colW: isWide ? (w - 48 - 16) / 2 : w,
  };
}

/** Hook — re-evaluates automatically on orientation/window change (Fold unfold) */
export function useLayout(): LayoutTokens {
  const { width, height } = useWindowDimensions();
  return buildLayout(width, height);
}
