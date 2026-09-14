/**
 * 2026-09-13 (Tim) — "sometimes the putting read has said uphill when its down. A sure like me has the
 * camera close to level but an expectation at level is not real."
 *
 * TWO DEFECTS, and his second sentence names the harder one.
 *
 * 1. THE SIGN WAS ERASED. `const deviation = Math.abs(p) - 90`. |pitch| collapses both hemispheres onto
 *    one answer, and the sign is the ONLY thing separating uphill from downhill. It works while
 *    `rotation.beta` stays positive and inverts silently when it does not — an inverted hold read
 *    +9% "uphill" for a phone aimed the other way.
 *
 * 2. THE VERDICT WAS DECIDED INSIDE THE NOISE. Thresholds were ±2%. In the unit actually measured, 2%
 *    is 1.15° of camera angle — at ANY putt length — while a handheld phone wanders ±2-3° from tremor
 *    and grip. So a 1.2° difference in how he held it flipped "firm pace — it's uphill" to "soft pace —
 *    downhill, let it die". Not a miscalibration: a claim the instrument cannot support.
 *
 * AND THERE IS NO GPS CROSS-CHECK, though it was the first thing we both reached for. Against a 20 ft
 * putt's 2% slope (0.12 m of rise): GPS horizontal is the wrong axis; GPS altitude carries ±5-15 m of
 * error, 40-125x the signal; and the terrain API caches on an 11 m grid, so both ends of a 6 m putt land
 * in one cell and the delta is always 0. A reconciliation against a source that cannot see the thing is
 * false comfort, so none was built. The numbers are recorded in services/puttSlopeRead so nobody adds one
 * later believing it helps.
 */
import fs from 'fs';
import path from 'path';
import {
  readPuttSlope, paceHintFor, whyNoSlope,
  SLOPE_DEADBAND_DEG, SLOPE_MAX_DEVIATION_DEG, SLOPE_MAX_PCT,
} from '../../services/puttSlopeRead';
import { findRelevantRules } from '../../data/rulesReference';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('the sign survives, because the sign IS the answer', () => {
  it('camera tilted UP reads uphill, tilted DOWN reads downhill', () => {
    expect(readPuttSlope(95).call).toBe('uphill');
    expect(readPuttSlope(85).call).toBe('downhill');
    expect(readPuttSlope(95).pct!).toBeGreaterThan(0);
    expect(readPuttSlope(85).pct!).toBeLessThan(0);
  });

  it('an INVERTED hold no longer reads as uphill — the exact old bug', () => {
    // Old code: abs(-95) - 90 = +5 → +9% "uphill" for a phone pointing the other way.
    expect(readPuttSlope(-95).call).toBe('unreadable_hold');
    expect(readPuttSlope(-95).pct).toBeNull();
    // and it must not agree with the upright reading of the same magnitude
    expect(readPuttSlope(-95).call).not.toBe(readPuttSlope(95).call);
  });

  it('no Math.abs is applied to the pitch anywhere in the owner', () => {
    const src = code('services/puttSlopeRead.ts');
    expect(src).toMatch(/const deviationDeg = pitchDeg - 90;/);
    expect(src).not.toMatch(/Math\.abs\(pitchDeg\)/);
  });

  it('the broken inline helper is gone from SmartFinder', () => {
    const sf = code('app/smartfinder.tsx');
    expect(sf).not.toMatch(/slopePctFromPitch/);
    expect(sf).not.toMatch(/Math\.abs\(p\) - 90/);
    expect(sf).toMatch(/readPuttSlope\(/);
  });
});

describe('near level it refuses, rather than rounding into a direction', () => {
  it('the deadband is stated in the unit actually measured, and is bigger than hand tremor', () => {
    expect(SLOPE_DEADBAND_DEG).toBeGreaterThanOrEqual(2);   // tremor is ±2-3°
    expect(SLOPE_DEADBAND_DEG).toBeLessThanOrEqual(5);      // but not so wide it refuses a real slope
  });

  it.each([90, 91, 89, 92.9, 87.1])('beta %s is too level to call', (beta) => {
    const r = readPuttSlope(beta);
    expect(r.call).toBe('too_level_to_call');
    expect(r.pct).toBeNull();
  });

  it('the old ±2% verdict would have called these — which is the bug', () => {
    // 1.15° is 2%: inside the deadband now, a confident verdict before.
    const r = readPuttSlope(90 + 1.15);
    expect(r.call).toBe('too_level_to_call');
  });

  it('a real slope still gets called', () => {
    expect(readPuttSlope(90 + 3.5).call).toBe('uphill');     // ~6%
    expect(readPuttSlope(90 - 5.71).call).toBe('downhill');  // ~-10%
  });

  it('a hold that is not a putting read is refused, not extrapolated', () => {
    for (const beta of [0, -90, 180, 90 + SLOPE_MAX_DEVIATION_DEG + 1]) {
      expect(readPuttSlope(beta).call).toBe('unreadable_hold');
    }
  });

  it('nothing is ever reported past a real green grade', () => {
    /**
     * Bounded against REALITY, not against the constant. The first version asserted
     * `abs(pct) <= SLOPE_MAX_PCT`, which is tautological — raising the constant to 99999 raised the bound
     * with it and the test stayed green. Break-testing caught that. The real fact is that putting surfaces
     * do not exceed roughly a dozen per cent, so a 25% ceiling is already generous and 30 is the outer
     * bound of anything worth printing.
     */
    expect(SLOPE_MAX_PCT).toBeLessThanOrEqual(30);
    const r = readPuttSlope(90 + SLOPE_MAX_DEVIATION_DEG);
    expect(Math.abs(r.pct ?? 0)).toBeLessThanOrEqual(30);
  });

  it('junk in, no reading out', () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readPuttSlope(v as number).call).toBe('no_reading');
    }
  });
});

describe('a refusal is SPOKEN, never a silent fallback to stock pace', () => {
  it('a no-call explains itself in the player\'s language', () => {
    expect(whyNoSlope(readPuttSlope(90))).toMatch(/too close to level/i);
    expect(whyNoSlope(readPuttSlope(0))).toMatch(/hold it upright/i);
    expect(whyNoSlope(readPuttSlope(null))).toMatch(/no tilt reading/i);
  });

  it('and a real call has no excuse attached', () => {
    expect(whyNoSlope(readPuttSlope(95))).toBeNull();
    expect(paceHintFor(readPuttSlope(95))).toMatch(/uphill/);
    expect(paceHintFor(readPuttSlope(85))).toMatch(/let it die/);
    expect(paceHintFor(readPuttSlope(90))).toBeNull();
  });

  it('SmartFinder speaks the refusal instead of saying "stock pace"', () => {
    const sf = code('app/smartfinder.tsx');
    expect(sf).toMatch(/paceHintFor\(measuredSlope\) \?\? whyNoSlope\(measuredSlope\)/);
  });

  it('the GPS dead end is written down, so it is not rebuilt', () => {
    const src = fs.readFileSync(path.join(root, 'services/puttSlopeRead.ts'), 'utf8');
    expect(src).toMatch(/11 m grid/);
    expect(src).toMatch(/40-125x the signal/);
  });
});

describe('the caddie can finally answer whether any of this is legal', () => {
  it('a rule on measuring devices exists and is findable in the words a player uses', () => {
    for (const q of ['can I use a rangefinder', 'is slope legal', 'can I measure the slope', 'gps allowed']) {
      const hits = findRelevantRules(q, 2) as { rule_id: string }[];
      expect(hits.map((h) => h.rule_id)).toContain('measuring_devices');
    }
  });

  it('it states the distinction that people actually get wrong', () => {
    const [rule] = findRelevantRules('is slope legal', 1) as Array<{
      rule_summary: string; tactical_advice: string; official_reference: string; common_misconceptions: string;
    }>;
    expect(rule.rule_summary).toMatch(/distance/i);
    expect(rule.rule_summary).toMatch(/slope|elevation/i);
    expect(rule.official_reference).toMatch(/4\.3/);
    // and it points at the committee rather than pretending to be the final word
    expect(rule.tactical_advice).toMatch(/committee|ask/i);
  });
});
