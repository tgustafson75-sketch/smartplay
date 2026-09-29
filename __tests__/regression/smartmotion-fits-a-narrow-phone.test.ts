/**
 * 2026-09-29 — SMARTMOTION ON A PHONE TIM DOES NOT OWN.
 *
 * Tim tests on the open Fold (~690dp wide). A narrow-phone audit found defects that only show at
 * 320-400dp wide or ~667dp tall: the review bar overflowing, rails truncating, the tools card running
 * off the screen, a mode label that was off-screen at EVERY width, an eye button on top of a reading.
 * The size decisions are pure (services/swing/smartMotionLayout) and tested at real widths here; the
 * wiring into the 7,000-line screen is pinned with comment-stripped source assertions, because the
 * screen cannot be mounted in a test. Every width-conditional change leaves the Fold (690dp) as it was.
 */
import fs from 'fs';
import path from 'path';
import {
  aboveDeck, HUD_MAX_FONT_SCALE, MODE_FADE_LABEL_OFFSET_DP, modeFadeLabelWidth, railWidth, reviewBarLayout,
  reviewOverlayInset, showReviewRails, toolCardMaxHeight,
} from '../../services/swing/smartMotionLayout';

const FOLD = 690;

describe('the review control bar fits a 320dp phone', () => {
  it('six buttons + gaps fit inside 320 minus the deck padding', () => {
    const b = reviewBarLayout(320);
    const needed = 6 * b.button + 5 * b.gap;
    expect(needed).toBeLessThanOrEqual(320 - 2 * 10);
    expect(b.spacer).toBe(false);
    expect(b.spread).toBe(true);
  });

  it('the old layout did NOT fit — which is the defect', () => {
    expect(6 * 46 + 5 * 8 + 2 * 10).toBeGreaterThan(320);
  });

  it('the Fold is unchanged', () => {
    expect(reviewBarLayout(FOLD)).toEqual({ spacer: true, gap: 8, button: 46, spread: false });
  });
});

describe('rails, overlays and the tools card', () => {
  it('rails are 112dp below 400 wide and 124 on the Fold', () => {
    expect(railWidth(320)).toBe(112);
    expect(railWidth(399)).toBe(112);
    expect(railWidth(FOLD)).toBe(124);
  });

  it('no floating rails over a video box too short to hold them; unknown size shows them as before', () => {
    expect(showReviewRails(200)).toBe(false);
    expect(showReviewRails(319)).toBe(false);
    expect(showReviewRails(320)).toBe(true);
    expect(showReviewRails(0)).toBe(true);
  });

  it('review overlays stop paying the bottom inset twice on a 667dp phone, and keep it on tall screens', () => {
    expect(reviewOverlayInset(667, 34)).toBe(0);
    expect(reviewOverlayInset(800, 34)).toBe(34);
  });

  it('overlays clear the MEASURED deck, and keep the old offset until it is measured', () => {
    expect(aboveDeck(212.4, 136)).toBe(220);
    expect(aboveDeck(0, 136)).toBe(136);
    expect(aboveDeck(NaN, 136)).toBe(136);
  });

  it('fixed-size HUD text stops growing at 1.3x (a 344dp review bar holds "NEW SET" at that scale)', () => {
    expect(HUD_MAX_FONT_SCALE).toBe(1.3);
    const b = reviewBarLayout(344);
    const newSetLabelDp = 7 * (9 * 0.68 + 0.8) * HUD_MAX_FONT_SCALE; // 7 glyphs, 9pt heavy, 0.8 tracking
    expect(5 * b.button + Math.max(b.button, newSetLabelDp) + 5 * b.gap).toBeLessThanOrEqual(344 - 2 * 10);
  });

  it('the mode label fits between the mode button and the record button, never off the left edge', () => {
    for (const w of [320, 344, 360, 390, FOLD]) {
      const content = w - 2 * 10;
      const recordLeft = 10 + content / 2 - 56 / 2;
      const labelLeft = 10 + MODE_FADE_LABEL_OFFSET_DP;
      const width = modeFadeLabelWidth(w);
      expect(labelLeft).toBeGreaterThan(10 + 50);
      expect(width).toBeGreaterThanOrEqual(56); // two lines of "FULL / SWING" at >= 0.6 scale
      expect(labelLeft + width).toBeLessThanOrEqual(recordLeft - 6);
    }
    expect(modeFadeLabelWidth(FOLD)).toBe(150);
  });

  it('the tools card is capped to the space below its chevron (SE at 1.3), never below 160', () => {
    expect(toolCardMaxHeight(667, 20, 0)).toBe(667 - 142 - 12);
    expect(toolCardMaxHeight(300, 44, 34)).toBe(160);
  });
});

describe('SmartMotion is wired to those decisions', () => {
  const raw = fs.readFileSync(path.join(__dirname, '../../app/swinglab/smartmotion.tsx'), 'utf8');
  const sm = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
  const hudRaw = fs.readFileSync(path.join(__dirname, '../../components/smartmotion/SmartMotionHud.tsx'), 'utf8');
  const hud = hudRaw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

  it('#1 the review bar reads its layout, and the spacer goes when it spreads', () => {
    expect(sm).toMatch(/const reviewBar = reviewBarLayout\(windowWidth\);/);
    expect(sm).toMatch(/<View style=\{\[styles\.barRow, \{ gap: reviewBar\.gap \}, reviewBar\.spread && styles\.barRowSpread\]\}>/);
    expect(sm).toMatch(/\{isReview && !reviewBar\.spacer \? null : <View style=\{\{ flex: 1 \}\} \/>\}/);
    expect((sm.match(/style=\{\[styles\.toolBtnBare, reviewBtnSize/g) ?? []).length).toBe(6);
  });

  it('#2/#5 both rails use the width rule and hide over a short video box', () => {
    expect((sm.match(/width: railWidth\(windowWidth\)/g) ?? []).length).toBe(2);
    expect((sm.match(/showReviewRails\(rootSize\.h\)/g) ?? []).length).toBe(2);
    expect(sm).not.toMatch(/width: isNarrow \? 100 : 124/);
  });

  it('#4 the dead review targeting eye is gone, and effort is a rail card, not a pill over the rail', () => {
    expect(sm).not.toMatch(/accessibilityLabel=\{targetingVisible \? 'Hide targeting overlay' : 'Show targeting overlay'\}/);
    expect(sm).not.toMatch(/styles\.effortPill/);
    expect(sm).toMatch(/<View key="effort" style=\{styles\.metricBadgeCard\}>/);
  });

  it('#6 long row text shrinks instead of bleeding out', () => {
    expect(sm).toMatch(/framingPillText: \{[^}]*flexShrink: 1[^}]*textAlign: 'center'/);
    expect(hud).toMatch(/verdictText: \{[^}]*flexShrink: 1[^}]*textAlign: 'center'/);
    expect(hud).toMatch(/acousticTitle: \{[^}]*flexShrink: 1/);
  });

  it('#7 the mode label sits beside its button, in the gap, instead of off-screen', () => {
    expect(sm).toMatch(/modeFadeLabelWrap: \{ position: 'absolute', left: MODE_FADE_LABEL_OFFSET_DP, top: 0, bottom: 0,/);
    expect(sm).toMatch(/<Animated\.View style=\{\[styles\.modeFadeLabelWrap, \{ width: modeFadeLabelWidth\(windowWidth\), opacity: modeFadeOpacity \}\]\}/);
    expect(sm).toMatch(/<Text style=\{\[styles\.modeFadeLabelText[^>]*numberOfLines=\{2\} adjustsFontSizeToFit/);
    expect(sm).not.toMatch(/right: 62, width: 150/);
  });

  it('#8 the tools card is capped and scrolls', () => {
    expect(sm).toMatch(/maxHeight: toolCardMaxHeight\(windowHeight, insets\.top, insets\.bottom\)/);
    expect(sm).toMatch(/<ScrollView contentContainerStyle=\{styles\.toolCardScroll\}/);
  });

  it('#9 on a narrow phone the results eye lives in the top bar; wider screens keep it floating', () => {
    expect(sm).toMatch(/\{isReview && isNarrow \? \(\s*<Pressable\s*onPress=\{\(\) => setShowResults/);
    expect(sm).toMatch(/\{isReview && !isNarrow \? \(\s*<Pressable\s*onPress=\{\(\) => setShowResults/);
  });

  it('#10 the analysis page moves with the keyboard', () => {
    expect(sm).toMatch(/automaticallyAdjustKeyboardInsets/);
  });

  it('#12 the drill banner is capped to the screen and its name shrinks to fit', () => {
    expect(sm).toMatch(/drillBanner: \{ position: 'absolute', alignSelf: 'center', alignItems: 'center', maxWidth: '92%',/);
    expect(sm).toMatch(/<Text style=\{styles\.drillBannerName\} numberOfLines=\{1\} adjustsFontSizeToFit minimumFontScale=\{0\.6\} maxFontSizeMultiplier=\{HUD_MAX_FONT_SCALE\}>/);
  });

  it('#14 text in fixed-size HUD boxes stops growing at the HUD font scale, and rail text shrinks to fit', () => {
    const capped = (cls: string) => new RegExp(`<Text style=\\{\\[?styles\\.${cls}\\b[^>]*maxFontSizeMultiplier=\\{HUD_MAX_FONT_SCALE\\}`, 'g');
    const uncapped = (cls: string) => new RegExp(`<Text style=\\{\\[?styles\\.${cls}\\b(?![^>]*maxFontSizeMultiplier)[^>]*>`, 'g');
    const expected: Record<string, number> = {
      metricBadgeValue: 3, metricBadgeLabel: 3, ctrlLabelText: 2, barRateTag: 1, reelChipText: 1,
      drillBannerKicker: 1, drillBannerName: 1, gridCardLabel: 1, gridCardValue: 1, gridCardNote: 1,
      planLabel: 3, planUnit: 1, swingRowLabel: 1, swingRowChipText: 1,
    };
    for (const [cls, n] of Object.entries(expected)) {
      expect({ cls, capped: (sm.match(capped(cls)) ?? []).length }).toEqual({ cls, capped: n });
      expect({ cls, uncapped: (sm.match(uncapped(cls)) ?? []).length }).toEqual({ cls, uncapped: 0 });
    }
    expect((sm.match(/styles\.metricBadge(Value|Label)\} numberOfLines=\{1\} adjustsFontSizeToFit minimumFontScale=\{0\.7\}/g) ?? []).length).toBe(6);
  });

  it('#11 the framing pill, drill banner and caddie strip clear the measured deck', () => {
    expect(sm).toMatch(/onLayout=\{\(e\) => \{ const h = e\.nativeEvent\.layout\.height; if \(h > 0\) setDeckHeight\(h\); \}\}/);
    expect(sm).toMatch(/bottom: aboveDeck\(deckHeight, insets\.bottom \+ 96\)/);
    expect(sm).toMatch(/bottom: aboveDeck\(deckHeight, insets\.bottom \+ \(isNarrow \? 138 : 64\)\)/);
    expect(sm).toMatch(/<CaddieStatusStrip floating bottomOffset=\{aboveDeck\(deckHeight, insets\.bottom \+ 140\)\} \/>/);
  });
});
