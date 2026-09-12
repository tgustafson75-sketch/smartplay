/**
 * 2026-09-11 (Tim) — ONE OWNER FOR THE CADDIE TAB'S VERTICAL SPACE.
 *
 * "We should have universal budget for applying to the phone. In other words, if somebody gets a
 *  brand new full iPhone, everything needs to adjust accordingly."
 *
 * WHAT WAS WRONG. The caddie tab placed its bottom furniture with a dozen independent constants,
 * each correct for the one device it was tuned on:
 *
 *     zoneBottom      = 150 + insets.bottom      cornerBox   = 132 + insets.bottom
 *     penaltyQuickBtn =  96 + insets.bottom      startRound  =  22
 *     bubbleClearance = (168 | 108) + insets.bottom + 104
 *
 * Two separate errors were baked into those.
 *
 * ERROR 1 — THE BOTTOM INSET IS NOT OURS. GlobalCaddieBar is a SIBLING of the navigator, below it in
 * a column, and its own `paddingBottom: max(insets.bottom, 8) + 6` consumes the home-indicator inset
 * for the whole app. By the time a tab screen lays out, the inset is already spent. Every
 * `+ insets.bottom` inside this tab therefore reserved a safe area that nothing was going to draw
 * in. This was DIAGNOSED on 2026-07-25 and fixed at exactly one call site — the Start Round CTA,
 * whose comment still explains it — while the other four kept double-counting.
 * [[no-half-fixes-enforce-every-surface]]
 *
 * ERROR 2 — WE RESERVED FOR CHROME THAT IS ALREADY SUBTRACTED. The tab bar (48) and the caddie bar
 * (CADDIE_BAR_RESERVE) are outside this screen's box. `bottom: 0` here already means "just above the
 * tab bar". The 150 was reserving room for furniture that lives in a different container. Combined
 * with error 1 that stranded roughly 150 + inset of dead space under the portrait — the pale band
 * Tim photographed, where the hero's melt-gradient dies in mid-air instead of dissolving into the
 * page.
 *
 * There was already a correct answer in the codebase and nothing called it: `useCaddieBarReserve()`
 * in GlobalCaddieBar, whose doc comment says full-window screens read it "so their bottom content
 * sits above the bar instead of clipping". It had ZERO consumers. The hand-tuned constants here were
 * the workaround for an export that was written and never wired.
 * [[orphans-are-live-bugs-not-dead-code]]
 *
 * WHAT THIS DOES. Takes the real measured chrome and returns the whole allocation, so a new geometry
 * changes one computation instead of needing twelve constants re-tuned. Pure and synchronous — no
 * hooks — so the budget can be asserted against any device in a unit test rather than on a phone.
 */

/**
 * The tab row's height. Lives here rather than in the navigator so the budget and the bar it has to
 * subtract can never drift apart — app/(tabs)/_layout.tsx imports this value instead of restating it.
 */
export const TAB_BAR_HEIGHT = 48;

/**
 * ── THE SHAPE, per Tim's original inspiration board (2026-09-11) ──────────────────────────────
 *
 * The reference he designed this tab from is a FULL-BLEED portrait with a single floating data strip
 * over it. No boxed hero, no band of page below it, no CTA stranded in empty space — the avatar IS
 * the screen and the furniture floats on top. "Obviously we have more info but it's very clean."
 *
 * So the hero's base is 0: it fills its box and meets the tab row directly. That is not a tuning
 * choice, it is what makes the void unrepresentable — there is no longer a below-the-hero region for
 * dead space to appear in, on any device. The numbers below therefore position furniture OVER the
 * portrait; they no longer carve a band out from under it.
 */

/** The bottom furniture, measured from the BOTTOM OF THIS SCREEN'S BOX (i.e. above the tab bar). */
const CTA_GAP = 22;      // Start Round's float above the tab row — 2026-07-25, already inset-correct.
const CTA_HEIGHT = 60;   // styles.startRoundBtn.height
const CTA_BREATH = 16;   // clearance between the CTA and the swap inlay above it
const CORNER_HEIGHT = 86; // the swap inlay's height

/**
 * The hero must still read as a PORTRAIT, not a letterbox. On a very short viewport the furniture
 * tightens toward the bottom edge rather than the subject being crushed.
 */
const MIN_HERO_HEIGHT = 260;

/** Above this the furniture sits at its natural offsets; below it everything compresses together. */
const COMFORTABLE_HEIGHT = 640;

export interface CaddieChrome {
  /** Window width in dp. */
  W: number;
  /** Window height in dp. */
  H: number;
  /** Safe-area top inset — this IS ours; nothing above us consumes it. */
  insetTop: number;
  /**
   * Safe-area bottom inset. Accepted so the budget can state explicitly that it does NOT spend it,
   * and so the one case where it IS ours — the caddie bar killed or hidden — stays expressible.
   */
  insetBottom: number;
  /** useCaddieBarReserve() — the bar's content height, 0 where the bar is hidden or killed. */
  barReserve: number;
  /** The tab row's height, 0 on screens without one. */
  tabBarHeight: number;
}

export interface CaddieBudget {
  /**
   * Top of the hero. NOT zero: Tim asked on 2026-07-25 that the portrait be contained below the
   * status bar rather than running under it ("top box extends to the top; contain it"), and that
   * request stands even though the reference is full-bleed at the top.
   */
  heroTop: number;
  /** Base of the hero. Always 0 — the portrait is full-bleed to the tab row. */
  heroBottom: number;
  /** Resolved hero height, so callers can size a child without re-deriving it. */
  heroHeight: number;
  /**
   * The height of THIS SCREEN'S BOX — the window minus the tab bar, the caddie bar and the inset,
   * all of which are siblings outside it.
   *
   * Exposed because the tab repeatedly wrote `H - <a distance from the bottom>` to turn a
   * bottom-anchored offset into a top-anchored one, using the WINDOW height for a coordinate inside
   * a container ~136dp shorter. That error was masked while the bottom offsets over-reserved by
   * about the same amount; removing the over-reservation unmasked it. Anything converting between
   * the two edges must measure against this, never against H.
   */
  boxHeight: number;
  /** Start Round / primary CTA float. */
  ctaBottom: number;
  /** The swap inlay that toggles which view leads — floats ON the portrait, above the CTA. */
  cornerBottom: number;
  /** Secondary round controls (penalty quick-add). */
  controlsBottom: number;
  /** Clearance a speech bubble needs so it never lands on the bottom furniture. */
  bubbleClearance: number;
  /**
   * The safe-area bottom this screen must pay for itself. Normally 0 — the caddie bar pays it. Only
   * non-zero when no bar is mounted, which is the one case the old constants could not express.
   */
  ownedBottomInset: number;
}

/**
 * Allocate the caddie tab's vertical space for one device geometry.
 *
 * `H` is the WINDOW height. The usable box is smaller — the tab bar and the caddie bar are siblings
 * outside it — so the usable height is computed here rather than by each caller, which is the
 * subtraction every hand-tuned constant was trying and failing to approximate.
 */
export function caddieLayoutBudget(chrome: CaddieChrome): CaddieBudget {
  const { H, insetTop, insetBottom, barReserve, tabBarHeight } = chrome;

  /**
   * When the caddie bar is mounted it owns the home-indicator inset for the whole app. When it is
   * not (kill switch, or a hidden route) nothing below us does, and the screen must pay it.
   */
  const ownedBottomInset = barReserve > 0 ? 0 : insetBottom;

  /** The box this screen actually gets, after the chrome that is NOT inside it. */
  const boxHeight = Math.max(0, H - tabBarHeight - barReserve - insetBottom);
  /** ...and what is left once the status bar is cleared at the top. */
  const usable = Math.max(0, boxHeight - insetTop);

  /**
   * On a comfortable viewport the furniture sits at its natural offsets and every extra pixel of a
   * taller phone goes to the portrait. On a short one it compresses toward the bottom edge so the
   * subject keeps its minimum before anything else gives.
   */
  const fullBand = CTA_GAP + CTA_HEIGHT + CTA_BREATH + ownedBottomInset;
  const band = usable >= COMFORTABLE_HEIGHT
    ? fullBand
    : Math.min(fullBand, Math.max(0, usable - MIN_HERO_HEIGHT));
  const scale = fullBand === 0 ? 1 : band / fullBand;

  const heroTop = insetTop + 12;
  const ctaBottom = Math.round(CTA_GAP * scale) + ownedBottomInset;
  const cornerBottom = ctaBottom + Math.round((CTA_HEIGHT + CTA_BREATH) * scale);

  return {
    heroTop,
    // Full-bleed. The reference has no page under the portrait, so neither do we.
    heroBottom: 0,
    heroHeight: Math.max(0, boxHeight - heroTop),
    boxHeight,
    ctaBottom,
    cornerBottom,
    controlsBottom: cornerBottom,
    bubbleClearance: cornerBottom + Math.round((CORNER_HEIGHT + 16) * scale),
    ownedBottomInset,
  };
}

/**
 * ── THE ASK BAR'S HORIZONTAL BUDGET ───────────────────────────────────────────────────────────
 *
 * Same failure, rotated 90°. The bar spends fixed width on chrome and hands the TextInput `flex: 1`
 * with a fixed 16pt placeholder. A TextInput placeholder does not ellipsize — it clips — so on a
 * narrow panel the player reads "Ask or tell your c" with the rest simply gone. Tim shot it on a
 * Fold cover panel: 344dp − 188dp of chrome = 156dp for a string that wants ~192dp.
 */
export const ASK_BAR_CHROME = {
  /** GlobalCaddieBar wrap paddingHorizontal ×2. */
  outerPad: 20,
  /** CaddieBottomBar bar paddingHorizontal ×2. */
  barPad: 20,
  /** The back chevron, always present. */
  backChevron: 36,
  /** The neon caddie mic — hidden when the voice_caddie flag is off. */
  mic: 50,
  /** Exactly one trailing control renders: send, hide-keyboard, or forward. All 36 wide. */
  trailing: 36,
  /** `gap: 6` between row children. */
  gap: 6,
  /** input paddingHorizontal ×2. */
  inputPad: 8,
} as const;

/** Width left for the placeholder once the bar's fixed furniture is paid for. */
export function askBarTextWidth(W: number, opts: { micVisible: boolean }): number {
  const c = ASK_BAR_CHROME;
  const children = opts.micVisible ? 4 : 3;
  const fixed =
    c.outerPad + c.barPad + c.backChevron + c.trailing + c.inputPad +
    (opts.micVisible ? c.mic : 0) +
    c.gap * (children - 1);
  return Math.max(0, W - fixed);
}

/**
 * Average glyph advance as a fraction of font size, for the system sans at 16pt. Deliberately a
 * touch generous: erring wide shortens the placeholder a word early, which is invisible; erring
 * narrow puts us back to clipping mid-word, which is the defect.
 */
const GLYPH_RATIO = 0.52;

/**
 * Shorten a placeholder to fit, at a word boundary.
 *
 * Trims WORDS off the end rather than selecting from a ladder of shorter alternatives, because a
 * ladder would mean new user-facing strings for every locale to translate — and this has to work in
 * languages whose full phrase is longer than English's. Trimming is language-agnostic and adds
 * nothing to the catalogue. Never returns empty: one word plus an ellipsis beats a blank field.
 */
export function fitAskPlaceholder(text: string, availableWidth: number, fontSize = 16): string {
  const per = fontSize * GLYPH_RATIO;
  const fits = (s: string) => s.length * per <= availableWidth;
  if (fits(text)) return text;

  const words = text.replace(/[….\s]+$/u, '').split(/\s+/u).filter(Boolean);
  if (words.length === 0) return text;
  for (let n = words.length - 1; n >= 1; n--) {
    const candidate = `${words.slice(0, n).join(' ')}…`;
    if (fits(candidate)) return candidate;
  }
  return `${words[0]}…`;
}
