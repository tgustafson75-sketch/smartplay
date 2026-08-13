/**
 * 2026-08-12 — calibrate the chart to the player, from Tim's real Arccos bag.
 *
 *   Driver 253 vs our 245 (+8)    7i 163 vs 148 (+15)    PW 138 vs 110 (+28)
 *   9i     147 vs 122 (+25)       GW 128 vs  98 (+30)    SW 116 vs  86 (+30)
 *
 * Long clubs within a few yards; WEDGES OUT BY THIRTY. So before he'd logged anything, a 130-yard
 * shot got him a gap wedge — a club he actually hits 128, from a chart that thought it went 98.
 * That is the gap-wedge complaint he raised repeatedly, and the screenshot is where it came from.
 *
 * Per-club override already worked once a club had data. The hole was the clubs that DIDN'T: they
 * sat on a generic chart while his own measured clubs proved that chart was 20% wrong for him. We
 * had the evidence and ignored it for every club we hadn't seen.
 *
 * NOT a driver-length scale, deliberately: his driver is +3% while his wedges are +30%, so scaling
 * everything off the big stick would have fixed nothing.
 */
import { personalBagScale, personalCarryFor, STANDARD_CARRY_YARDS } from '../../services/standardBag';

/** Tim's real bag, from the Arccos "Smart Distances" screenshot. */
const TIM = { Driver: 253, '3W': 229, '5W': 223, '5I': 178, '6I': 171, '7I': 163, '8I': 155, '9I': 147, PW: 138, GW: 128, SW: 116 };

describe('the chart scales to the player', () => {
  it('derives a scale above 1 for a player who out-hits the chart', () => {
    const s = personalBagScale(TIM)!;
    expect(s).toBeGreaterThan(1.05);
    expect(s).toBeLessThan(1.3);
  });

  it('needs real evidence — one club is not a bag', () => {
    expect(personalBagScale({})).toBeNull();
    expect(personalBagScale({ Driver: 253 })).toBeNull();
  });

  it('a measured club always wins outright over any scaling', () => {
    expect(personalCarryFor('GW', TIM)).toBe(128);
    expect(personalCarryFor('7I', TIM)).toBe(163);
  });

  it('AND an unmeasured club is scaled instead of left on the raw chart', () => {
    // The actual bug: he had never logged a 4-iron, so it stayed at the chart's 190 while every
    // club he HAD logged said the chart runs ~10% short for him.
    const withoutFourIron = { ...TIM };
    const scaled = personalCarryFor('4I', withoutFourIron)!;
    expect(scaled).toBeGreaterThan(STANDARD_CARRY_YARDS['4I']);
  });

  it('THE 130-YARD SHOT: no longer a gap wedge for a player who hits GW 128', () => {
    // Before: chart GW=98, so 130y "past your GW" logic reached for the wrong club entirely.
    expect(personalCarryFor('GW', TIM)).toBeGreaterThan(120);
  });

  it('uses a median, so one bad sample cannot drag the bag', () => {
    const poisoned = { ...TIM, SW: 300 }; // a mis-attributed drive logged as a sand wedge
    expect(Math.abs(personalBagScale(poisoned)! - personalBagScale(TIM)!)).toBeLessThan(0.05);
  });

  it('refuses an absurd bag ENTIRELY rather than clamping it', () => {
    // Every per-club ratio is rejected as implausible, so there is nothing left to learn from and
    // it returns null — the chart stands. Stronger than clamping: we do not half-believe bad data.
    const absurd = { Driver: 600, '7I': 500, GW: 400 };
    expect(personalBagScale(absurd)).toBeNull();
  });

  it('ignores the putter and junk values', () => {
    expect(personalBagScale({ Putter: 5, Driver: 0, '7I': -3 })).toBeNull();
  });

  it('falls back to the raw chart when there is nothing to learn from', () => {
    expect(personalCarryFor('7I', {})).toBe(STANDARD_CARRY_YARDS['7I']);
  });
});

describe('the caddie actually uses it', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(path.join(__dirname, '../../services/cnsShotRead.ts'), 'utf8');

  it('scales the ladder it picks clubs from', () => {
    expect(src).toContain('const bagScale = personalBagScale(bag as Partial<Record<string, number>>) ?? 1;');
    expect(src).toContain('merged.set(club, Math.round(yds * bagScale))');
  });
});
