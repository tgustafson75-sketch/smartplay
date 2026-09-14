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
  readPuttSlope, paceHintFor, whyNoSlope, readLevel, bubbleOffset,
  SLOPE_DEADBAND_DEG, SLOPE_MAX_DEVIATION_DEG, SLOPE_MAX_PCT, LEVEL_TOLERANCE_DEG,
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

  it('the aimed read never collapses the pitch sign — scoped to the function that owns it', () => {
    /**
     * 2026-09-13, second pass. This asserted `not.toMatch(/Math\.abs\(pitchDeg\)/)` against the WHOLE
     * file, which pinned a token rather than the property — and it went red the moment
     * `readGroundSlope` was added, whose `Math.abs(pitchDeg) > GROUND_MAX_TILT_DEG` is a magnitude
     * GATE that destroys no sign at all (the same shape as the existing
     * `Math.abs(deviationDeg) > SLOPE_MAX_DEVIATION_DEG` two lines below the thing it was guarding).
     *
     * The property is narrower and is what the bug actually was: inside readPuttSlope, the deviation
     * must be computed from the SIGNED pitch. So the assertion is scoped to that function's body.
     * [[break-test-every-guard-you-write]]
     */
    const src = code('services/puttSlopeRead.ts');
    const start = src.indexOf('export function readPuttSlope');
    const end = src.indexOf('export function paceHintFor');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toMatch(/const deviationDeg = pitchDeg - 90;/);
    expect(body).not.toMatch(/Math\.abs\(pitchDeg\)/);
    // the exact old bug shape, forbidden anywhere in the file
    expect(src).not.toMatch(/Math\.abs\([^)]*\)\s*-\s*90/);
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

  it('and it does NOT tell a casual player to stop using a feature this app ships', () => {
    /**
     * 2026-09-13 — Tim: "This is not USGA competition. Rangefinders use it every day, it helps a user
     * understand how slope affects the game."
     *
     * He is right, and my first version of this entry got it wrong in a way that mattered: its advice said
     * "save any slope reading for practice rounds", which would have had the caddie discouraging the app's
     * own on-course feature every time someone asked whether it was allowed. A rules reference that
     * contradicts the product is worse than none — the player believes the caddie.
     *
     * The rule itself is unchanged and still stated. What changed is WHEN it bites: a competition, and any
     * round posted for handicap (which this app calculates — see estimateNewIndex). Casual play has nothing
     * to switch off.
     */
    const [rule] = findRelevantRules('can I use the slope reading', 1) as Array<{
      rule_summary: string; tactical_advice: string; common_misconceptions: string;
    }>;
    expect(rule.tactical_advice).toMatch(/casual/i);
    expect(rule.tactical_advice).toMatch(/competition/i);
    expect(rule.tactical_advice).toMatch(/post(ing)?/i);
    // the blanket discouragement must not come back
    expect(rule.tactical_advice).not.toMatch(/save any slope reading for practice/i);
    // and it names the opposite error too, so it is balanced rather than permissive
    expect(rule.common_misconceptions).toMatch(/championship|casual/i);
  });
});

describe('the bubble level — the instrument that actually works', () => {
  /**
   * 2026-09-13 (Tim) — "cant we add a level indicator? … Like a bubble pill like a carpenters level?"
   *
   * One already existed and I had BROKEN it an hour earlier: `liveLevel` was derived from the slope
   * PERCENTAGE, and the deadband I added makes that null near level — so the indicator could never say
   * LEVEL exactly when the phone was level. Found only because he asked for the feature.
   *
   * It is also the honest half of this screen, and the reason is worth keeping straight: a level reads the
   * PHONE's own attitude, which is a direct gravity measurement good to a fraction of a degree. The slope
   * read tries to infer the GREEN's incline from where the camera points, which it cannot. Same sensor,
   * one question answerable and one not.
   */
  it('says LEVEL when the phone is level — the regression that started this', () => {
    const r = readLevel(90, 0);
    expect(r.isLevel).toBe(true);
    expect(r.unreadable).toBe(false);
    // and the slope read is simultaneously refusing, which is the correct pairing
    expect(readPuttSlope(90).pct).toBeNull();
  });

  it('needs BOTH axes — a carpenter\'s level does not round up', () => {
    expect(readLevel(90, 0).isLevel).toBe(true);
    expect(readLevel(90, 6).isLevel).toBe(false);          // rolled sideways
    expect(readLevel(97, 0).isLevel).toBe(false);          // pitched up
    expect(readLevel(90 + LEVEL_TOLERANCE_DEG + 0.5, 0).isLevel).toBe(false);
  });

  it('reports BOTH tilts signed, because a green tilts two ways', () => {
    const r = readLevel(95, -4);
    expect(r.pitchOffDeg).toBe(5);    // camera up the line
    expect(r.rollOffDeg).toBe(-4);    // cross-slope, what makes a putt break
  });

  it('a hold that is not upright is marked unreadable rather than pinned', () => {
    for (const pitch of [0, -90, 180]) expect(readLevel(pitch, 0).unreadable).toBe(true);
    expect(readLevel(null, 0).unreadable).toBe(true);
  });

  it('the bubble floats the right way and never leaves the vial', () => {
    // camera tilted UP should move the bubble UP — screen y grows downward, so y is negative.
    expect(bubbleOffset(readLevel(100, 0)).y).toBeLessThan(0);
    expect(bubbleOffset(readLevel(80, 0)).y).toBeGreaterThan(0);
    expect(bubbleOffset(readLevel(90, 5)).x).toBeGreaterThan(0);
    for (const [p, rl] of [[120, 40], [60, -40]] as const) {
      const b = bubbleOffset(readLevel(p, rl));
      expect(Math.abs(b.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.y)).toBeLessThanOrEqual(1);
    }
  });

  it('the screen drives the vial from the ANGLES, never from the refused percentage', () => {
    const sf = code('app/smartfinder.tsx');
    expect(sf).toMatch(/const liveLevelRead = readLevel\(tilt\.pitch, tilt\.roll\)/);
    expect(sf).toMatch(/bubbleOffset\(liveLevelRead\)/);
    // the broken derivation must not come back
    expect(sf).not.toMatch(/liveSlopePct != null && Math\.abs\(liveSlopePct\) < 1/);
    // and the old single-axis track driven by the percentage is gone
    expect(sf).not.toMatch(/\(liveSlopePct \?\? 0\) \* 5/);
  });

  it('and it still tells the player when it simply cannot call the slope', () => {
    const sf = code('app/smartfinder.tsx');
    expect(sf).toMatch(/TOO LEVEL TO CALL/);
    expect(sf).toMatch(/HOLD PHONE UPRIGHT/);
  });
});

describe('"it works every time" — because it never looked', () => {
  /**
   * 2026-09-13 (Tim) — "most of the time I ask the Caddie to look at the Putt which works every time and I
   * think it opens SmartFinder in Putt mode."
   *
   * Two beliefs, both wrong, and the pair explains why he had never seen the level indicator.
   *
   *   · "look at my putt" routes to query_status{putt_analysis}, which SPEAKS an analysis and never
   *     navigates. He was never landing on the screen that holds the bubble.
   *   · it "worked every time" because the blind fallback — no frame, no read, nothing to analyse —
   *     answered "Smooth pendulum, eyes still, trust the line." A confident coaching sentence about a putt
   *     the caddie cannot see is indistinguishable from a real read, which is precisely why it never
   *     appeared to fail.
   *
   * That is the app's own honesty rule broken at the one moment it matters: it had nothing and said
   * something. Now it says it has nothing, and names the instrument that can see — which is also how the
   * level indicator becomes reachable from the phrase he actually uses.
   */
  const service = code('services/puttingAnalysisService.ts');

  it('the blind fallback admits it cannot see the putt', () => {
    expect(service).toMatch(/partialCapture\s*\?/);
    expect(service).toMatch(/can't actually see this one/);
  });

  it('and it points at the instrument that CAN', () => {
    expect(service).toMatch(/putt read in SmartFinder/);
    expect(service).toMatch(/level/);
  });

  it('a REAL read is still answered normally — the honest line is only for the blind path', () => {
    expect(service).toMatch(/: `\$\{caddieName\} here\. \$\{echo\}Smooth pendulum, eyes still, trust the line\.`/);
  });

  it('the confident line can never again be spoken with nothing to read', () => {
    // The exact regression: one unconditional template for both cases.
    expect(service).not.toMatch(/const caddieComment = `\$\{caddieName\} here\. \$\{echo\}Smooth pendulum/);
  });
});
