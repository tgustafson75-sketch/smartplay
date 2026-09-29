/**
 * 2026-09-29 — narrow-screen audit, the caddie ask bar (mounted once at the app root).
 *
 * 1. Keyboard lift. iOS keyboardWillShow reports a height that already INCLUDES the home-indicator
 *    area; Android keyboardDidShow's EXCLUDES the nav-bar inset. The bar used Android's formula on
 *    both, so on every Face-ID iPhone it floated ~44dp above the keyboard with the page showing
 *    through the gap.
 * 2. Placeholder budget. The input renders at 16 x the system font scale, and the bar's 1.5dp border
 *    was missing from the chrome sum, so a large system font clipped the placeholder mid-word.
 */
import { caddieBarKeyboardLift } from '../../utils/phoneLayout';
import { askBarTextWidth, fitAskPlaceholder, ASK_BAR_FONT_SIZE } from '../../services/caddieLayoutBudget';

describe('the ask bar lifts exactly onto the keyboard', () => {
  it('iOS: the reported height already includes the home indicator — lift by it, nothing more', () => {
    expect(caddieBarKeyboardLift('ios', 336, 34)).toBe(336);
  });

  it('Android: the reported height excludes the nav bar — add the inset and the upward bias', () => {
    expect(caddieBarKeyboardLift('android', 300, 48)).toBe(358);
  });

  it('no keyboard, no lift, on either platform', () => {
    expect(caddieBarKeyboardLift('ios', 0, 34)).toBe(0);
    expect(caddieBarKeyboardLift('android', 0, 48)).toBe(0);
  });
});

describe('the placeholder is measured at the size it is drawn', () => {
  const phrase = 'Ask or tell your caddie…';

  it('the bar border is paid for in the chrome budget', () => {
    // 344 - (20 outer + 20 bar pad + 3 border + 36 back + 36 trailing + 8 input pad + 50 mic + 18 gaps)
    expect(askBarTextWidth(344, { micVisible: true })).toBe(153);
  });

  it('at a large system font on a Fold cover panel the placeholder shortens at a word boundary', () => {
    const w = askBarTextWidth(344, { micVisible: true });
    const atOne = fitAskPlaceholder(phrase, w, ASK_BAR_FONT_SIZE);
    const atLarge = fitAskPlaceholder(phrase, w, ASK_BAR_FONT_SIZE * 1.3);
    expect(atLarge.length).toBeLessThan(atOne.length);
    expect(atLarge.endsWith('…')).toBe(true);
    // Whole words only: what precedes the ellipsis is a prefix of the phrase ending on a word.
    const kept = atLarge.slice(0, -1);
    expect(phrase.startsWith(kept)).toBe(true);
    expect(phrase.charAt(kept.length)).toBe(' ');
  });
});
