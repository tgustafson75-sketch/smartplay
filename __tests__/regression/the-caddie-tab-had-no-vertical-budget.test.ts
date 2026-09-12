/**
 * 2026-09-11 — THE CADDIE TAB RESERVED SPACE FOR CHROME THAT LIVES IN ANOTHER CONTAINER.
 *
 * Tim photographed a pale band between the bottom of the portrait and the Start Round button, with
 * the hero's melt-gradient dying in mid-air. Two compounding errors produced it:
 *
 *   1. GlobalCaddieBar is a SIBLING of the navigator and its own paddingBottom spends the
 *      home-indicator inset for the whole app — so every `+ insets.bottom` inside the tab reserved
 *      a safe area nothing would draw in. Diagnosed 2026-07-25, fixed at ONE of five call sites.
 *   2. `150` reserved room for the tab bar + caddie bar, which are OUTSIDE this screen's box and
 *      already subtracted from it.
 *
 * Verified against the reported geometry: with the old constants the hero's base lands ~35% of the
 * window height above the bottom, which is where it sits in Tim's screenshot (~37%).
 */
import fs from 'fs';
import path from 'path';
import { caddieLayoutBudget, type CaddieChrome } from '../../services/caddieLayoutBudget';

const BAR = 64;   // CADDIE_BAR_RESERVE
const TABS = 48;  // sharedTabBarStyle.height

/** Real geometries, dp. The budget must be sane on every one without per-device branching. */
const DEVICES: Record<string, CaddieChrome> = {
  'iPhone 15 Pro Max': { W: 430, H: 932, insetTop: 59, insetBottom: 34, barReserve: BAR, tabBarHeight: TABS },
  'iPhone 15':         { W: 393, H: 852, insetTop: 59, insetBottom: 34, barReserve: BAR, tabBarHeight: TABS },
  'iPhone SE':         { W: 375, H: 667, insetTop: 20, insetBottom: 0,  barReserve: BAR, tabBarHeight: TABS },
  'Fold open':         { W: 673, H: 841, insetTop: 24, insetBottom: 24, barReserve: BAR, tabBarHeight: TABS },
  'Fold cover':        { W: 344, H: 882, insetTop: 30, insetBottom: 24, barReserve: BAR, tabBarHeight: TABS },
  'iPad 11':           { W: 820, H: 1180, insetTop: 24, insetBottom: 20, barReserve: BAR, tabBarHeight: TABS },
};

describe('the bottom inset belongs to the caddie bar, not to this screen', () => {
  it('spends nothing on the safe area while the bar is mounted', () => {
    for (const [name, chrome] of Object.entries(DEVICES)) {
      const b = caddieLayoutBudget(chrome);
      expect(`${name}:${b.ownedBottomInset}`).toBe(`${name}:0`);
    }
  });

  it('pays the inset itself when no bar is mounted — the case the constants could not express', () => {
    const b = caddieLayoutBudget({ ...DEVICES['iPhone 15 Pro Max'], barReserve: 0 });
    expect(b.ownedBottomInset).toBe(34);
    // and the CTA must clear the home indicator rather than sitting under it
    expect(b.ctaBottom).toBeGreaterThanOrEqual(34);
  });

  it('does not grow the reservation when the inset grows — the old bug, stated directly', () => {
    const noInset = caddieLayoutBudget({ ...DEVICES['iPhone SE'], insetBottom: 0 });
    const bigInset = caddieLayoutBudget({ ...DEVICES['iPhone SE'], insetBottom: 48, H: 667 + 48 });
    // Same usable box → same band. Under `150 + insets.bottom` these differed by 48.
    expect(bigInset.heroBottom).toBe(noInset.heroBottom);
  });
});

describe('the portrait is full-bleed, per the reference Tim designed this from', () => {
  it('has no band of page beneath it on any device — the void is unrepresentable', () => {
    for (const [name, chrome] of Object.entries(DEVICES)) {
      const b = caddieLayoutBudget(chrome);
      expect(`${name}:${b.heroBottom}`).toBe(`${name}:0`);
    }
  });

  it('still clears the status bar at the top — Tim asked for that on 2026-07-25 and it stands', () => {
    for (const [name, chrome] of Object.entries(DEVICES)) {
      const b = caddieLayoutBudget(chrome);
      expect(`${name}:${b.heroTop}`).toBe(`${name}:${chrome.insetTop + 12}`);
    }
  });

  it('fills the box it is given, so a new geometry needs no re-tuning', () => {
    for (const [name, chrome] of Object.entries(DEVICES)) {
      const b = caddieLayoutBudget(chrome);
      const box = chrome.H - TABS - BAR - chrome.insetBottom;
      expect(`${name}:${b.heroHeight}`).toBe(`${name}:${box - b.heroTop}`);
    }
  });
});

describe('a taller phone shows more caddie, not more empty page', () => {
  it('gives every extra pixel of a comfortable viewport to the hero', () => {
    const short = caddieLayoutBudget(DEVICES['iPhone 15']);
    const tall = caddieLayoutBudget(DEVICES['iPhone 15 Pro Max']);
    expect(tall.heroHeight - short.heroHeight).toBe(932 - 852);
    // the furniture is unchanged — the growth went to the portrait
    expect(tall.ctaBottom).toBe(short.ctaBottom);
  });

  it('never lets the visible portrait fall below a portrait-shaped minimum', () => {
    for (let H = 380; H <= 1400; H += 7) {
      const b = caddieLayoutBudget({ ...DEVICES['iPhone SE'], H });
      expect(b.heroBottom).toBe(0);
      expect(b.heroHeight).toBeGreaterThanOrEqual(0);
      expect(b.ctaBottom).toBeGreaterThanOrEqual(0);
    }
  });

  it('compresses the furniture, not the portrait, when the viewport is short', () => {
    const tiny = caddieLayoutBudget({ ...DEVICES['iPhone SE'], H: 420 });
    const roomy = caddieLayoutBudget(DEVICES['iPhone SE']);
    expect(tiny.ctaBottom).toBeLessThan(roomy.ctaBottom);
    expect(tiny.cornerBottom).toBeLessThan(roomy.cornerBottom);
  });
});

describe('the furniture floats over the portrait without colliding', () => {
  it('stacks CTA → swap inlay → bubble, in that order, on every device', () => {
    const CTA_HEIGHT = 60;
    for (const [name, chrome] of Object.entries(DEVICES)) {
      const b = caddieLayoutBudget(chrome);
      expect(`${name}:${b.cornerBottom >= b.ctaBottom + CTA_HEIGHT}`).toBe(`${name}:true`);
      expect(`${name}:${b.bubbleClearance > b.cornerBottom}`).toBe(`${name}:true`);
    }
  });

  it('keeps the CTA off the tab row', () => {
    for (const [name, chrome] of Object.entries(DEVICES)) {
      const b = caddieLayoutBudget(chrome);
      expect(`${name}:${b.ctaBottom > 0}`).toBe(`${name}:true`);
    }
  });
});

describe('the reclaimed band is the defect Tim photographed', () => {
  /** What the old constants produced, reproduced here so the comparison is against real numbers. */
  const legacyHeroBottom = (c: CaddieChrome) => 150 + c.insetBottom;

  it('recovers the whole dead band on every device', () => {
    for (const [name, chrome] of Object.entries(DEVICES)) {
      const b = caddieLayoutBudget(chrome);
      expect(`${name}:${legacyHeroBottom(chrome) - b.heroBottom}`).toBe(`${name}:${150 + chrome.insetBottom}`);
    }
  });

  it('matches where the portrait actually ended in the screenshot', () => {
    // Below the screen box sit the tab bar, the caddie bar and the inset. With the OLD constant the
    // hero's base therefore sat (150 + inset + those) above the window bottom — ~35% of the window,
    // which is where the dark area ends in Tim's photo (~37%).
    const fold = DEVICES['Fold cover'];
    const belowBox = TABS + BAR + fold.insetBottom;
    expect(Math.round(((legacyHeroBottom(fold) + belowBox) / fold.H) * 100)).toBe(35);
    // Full-bleed: the portrait now runs all the way to the tab row.
    expect(Math.round(((caddieLayoutBudget(fold).heroBottom + belowBox) / fold.H) * 100)).toBe(15);
  });
});

describe('a bottom-anchored offset is converted against the BOX, never the window', () => {
  /**
   * 2026-09-12 — the tab wrote `H - <distance from the bottom>` to flip a bottom-anchored offset
   * into a top-anchored one. H is the WINDOW; the container is ~136dp shorter, because the tab bar,
   * the caddie bar and the inset are siblings outside it. While the bottom offsets over-reserved by
   * roughly that much the two errors cancelled and nothing looked wrong. Going full-bleed removed
   * the over-reservation and unmasked it: L1HolePreview was handed a height 136dp larger than its
   * own container, and the L2 cells could reach down into the Start Round button.
   */
  it('boxHeight is the window minus every sibling below it', () => {
    for (const [name, c] of Object.entries(DEVICES)) {
      const b = caddieLayoutBudget(c);
      expect(`${name}:${b.boxHeight}`).toBe(`${name}:${c.H - TABS - BAR - c.insetBottom}`);
    }
  });

  it('heroHeight is exactly what a top/bottom-pinned child of that box resolves to', () => {
    for (const [name, c] of Object.entries(DEVICES)) {
      const b = caddieLayoutBudget(c);
      // the container is { top: heroTop, bottom: heroBottom } inside the box
      expect(`${name}:${b.heroHeight}`).toBe(`${name}:${b.boxHeight - b.heroTop - b.heroBottom}`);
    }
  });

  it('the box is always shorter than the window — a budget that returned H would be wrong', () => {
    for (const [name, c] of Object.entries(DEVICES)) {
      const b = caddieLayoutBudget(c);
      expect(`${name}:${b.boxHeight < c.H}`).toBe(`${name}:true`);
    }
  });

  it('the caddie tab performs no window-height conversion of its own', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Comments are stripped first: the explanation of this very bug quotes the expression.
    expect(src).not.toMatch(/=\s*H\s*-\s*/);
    expect(src).toMatch(/budget\.boxHeight/);
    expect(src).toMatch(/const zoneHeight = budget\.heroHeight;/);
  });
});
