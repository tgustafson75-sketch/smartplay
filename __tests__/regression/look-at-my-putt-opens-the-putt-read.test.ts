/**
 * 2026-09-13 (Tim) — "most of the time I ask the Caddie to look at the Putt which works every time and
 * I think it opens SmartFinder in Putt mode… Or maybe it was actually opening tightlie but I get a pic
 * analysis, I have given you screenshots before. You just make a very simple assumption and ran with it."
 *
 * He was right. I had read the `query_status{putt_analysis}` branch, seen that it speaks without
 * navigating, and built an explanation on top of it without ever checking which route his words take.
 * The trace:
 *
 *   1. the local precheck returned NULL for every putt phrasing → the cloud classifier decided
 *   2. it landed on open_tool{look|scene_read}: speaks "Let me take a look.", navigates to
 *      /smartfinder?autoread=1
 *   3. SmartFinder opened at its PERSISTED mode — putt ONLY because that is what he last tapped; the
 *      autoread override rewrites 'map'→'target' and leaves everything else alone
 *   4. autoread fired `runSceneRead` — the general "what's out there" HOLE read — on a putt, with no
 *      putt context, 1500 ms after mount, before either end had been tapped
 *
 * A feature he uses every round, reachable only by accident of a zustand-persisted value, firing the
 * wrong analysis on nothing. Nothing in the app opened SmartFinder in putt mode on purpose: there was
 * no `mode` param at all, and the only setMode('putt') anywhere is the on-screen tab button.
 *
 * [[smartplay-defect-class-unwired-halves]] [[feedback-verify-negative-claims]]
 */
import fs from 'fs';
import path from 'path';
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { parseSmartFinderMode, SMARTFINDER_MODES } from '../../store/smartFinderStore';
import {
  readGroundSlope,
  summarizeGroundSpots,
  groundReadConfidence,
  describeGroundSlope,
  GROUND_DEADBAND_DEG,
  GROUND_MAX_TILT_DEG,
  GROUND_AGREE_PCT,
  GROUND_STEADY_DEG,
  readGrazingPose,
  whyNoGrazingPose,
} from '../../services/puttSlopeRead';
import { buildPuttMeasurementBlock, composeInstruction } from '../../services/puttReadService';
import { computePuttGroundDistance, whyNoPuttDistance, PUTT_MIN_DEPRESSION_DEG } from '../../services/rangefinder';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('the route is deliberate, not a persisted accident', () => {
  it('every putt-READ phrasing resolves locally — the classifier no longer decides', () => {
    for (const p of [
      'look at my putt', 'look at this putt', 'read my putt', 'read this putt',
      'check my putt', 'analyze my putt', 'read the green', "how's my read",
    ]) {
      const r = precheckLocalIntent(p);
      expect(r).not.toBeNull();
      expect(r!.intent_type).toBe('open_tool');
      expect(r!.parameters.tool_name).toBe('putt_read');
    }
  });

  it('putt_read lands on SmartFinder in PUTT mode, by name', () => {
    const h = code('services/intents/openToolHandler.ts');
    expect(h).toMatch(/putt_read: \{ type: 'navigate', path: '\/smartfinder\?autoread=1&mode=putt' \}/);
  });

  it('the scene-read routes name TARGET mode, so they cannot inherit a persisted putt mode either', () => {
    const h = code('services/intents/openToolHandler.ts');
    for (const tool of ['scene_read', 'look', 'what_you_see', 'smartplay']) {
      expect(h).toMatch(new RegExp(`${tool}: \\{ type: 'navigate', path: '/smartfinder\\?autoread=1&mode=target' \\}`));
    }
  });

  it('the screen actually READS a mode param — the whole bug was that it read only autoread', () => {
    const sf = code('app/smartfinder.tsx');
    expect(sf).toMatch(/useLocalSearchParams<\{ autoread\?: string; mode\?: string \}>\(\)/);
    expect(sf).toMatch(/parseSmartFinderMode\(modeParam\)/);
    // an explicit request must WIN over the autoread nudge, or naming a mode changes nothing
    expect(sf).toMatch(/displayMode: SmartFinderMode = requestedMode \?\?/);
  });

  it('the param validator covers every mode the type allows, and refuses anything else', () => {
    for (const m of SMARTFINDER_MODES) expect(parseSmartFinderMode(m)).toBe(m);
    expect(parseSmartFinderMode('PUTT')).toBe('putt');
    expect(parseSmartFinderMode('measure')).toBe('target'); // retired, still in old links
    for (const bad of ['', 'wat', null, undefined, 7, {}]) expect(parseSmartFinderMode(bad)).toBeNull();
  });
});

describe('the analysis fired is the PUTT read, not a hole scene read', () => {
  it('the scene read is gated to target mode', () => {
    // The defect exactly: this effect fired in putt mode too, so asking about a putt analysed the hole.
    expect(code('app/smartfinder.tsx')).toMatch(/if \(!autoRead \|\| mode !== 'target' \|\| autoFiredRef\.current\) return;/);
  });

  it('the putt read waits for a MEASUREMENT instead of firing on arrival', () => {
    const sf = code('app/smartfinder.tsx');
    // armRead alone must never be the trigger — distanceFeet is what says there is something to read.
    expect(sf).toMatch(/if \(!armRead \|\| distanceFeet == null \|\| caddieFiredRef\.current\) return;/);
  });

  it('it goes through puttReadService, which is a different brain call from readScene', () => {
    expect(code('app/smartfinder.tsx')).toMatch(/import\('\.\.\/services\/puttReadService'\)/);
    expect(code('services/puttReadService.ts')).not.toMatch(/sceneReadService|SCENE_INSTRUCTION/);
  });
});

describe('the precheck takes the command and leaves the questions alone', () => {
  it('stroke mechanics still reach the brain — that is PuttingLab, not a green read', () => {
    for (const p of ['analyze my putting stroke', "how's my putting stroke", 'look at my putting tempo']) {
      const r = precheckLocalIntent(p);
      if (r) expect(r.parameters.tool_name).not.toBe('putt_read');
    }
  });

  it('putt STATS questions are untouched', () => {
    expect(precheckLocalIntent('how many putts')!.parameters.query_topic).toBe('putt_stats');
    expect(precheckLocalIntent("how's my putting")!.parameters.query_topic).toBe('putt_stats');
    expect(precheckLocalIntent('longest putt')!.parameters.query_topic).toBe('longest_putt');
    expect(precheckLocalIntent('how many putts so far')!.parameters.query_topic).toBe('putt_stats');
  });

  it('a hole read is still a hole read', () => {
    const r = precheckLocalIntent('give me the read on this hole');
    expect(r?.parameters.query_topic).toBe('hole_read');
  });
});

describe('the grounded read is a measurement, and the aimed one is not the number', () => {
  it('lying flat and level reads flat', () => {
    const g = readGroundSlope(0, 0);
    expect(g.call).toBe('read');
    expect(g.isFlat).toBe(true);
  });

  it('the top edge raised reads UPHILL — the sign is derived, not guessed', () => {
    const g = readGroundSlope(3, 0);
    expect(g.alongPct).toBeGreaterThan(0);
    expect(readGroundSlope(-3, 0).alongPct).toBeLessThan(0);
  });

  it('CROSSWISE swaps the axes — reading it lengthwise would invert the break call', () => {
    const lengthwise = readGroundSlope(3, 0, 'top_to_hole');
    const crosswise = readGroundSlope(3, 0, 'crosswise');
    // the same physical tilt is along-line one way and across-line the other
    expect(lengthwise.alongPct).toBeCloseTo(crosswise.acrossPct!, 5);
    expect(crosswise.alongPct).toBe(0);
    // and the along axis crosswise comes from the OTHER sensor axis, negated
    expect(readGroundSlope(0, -3, 'crosswise').alongPct).toBeGreaterThan(0);
  });

  it('an upright or face-down phone is refused rather than interpreted', () => {
    for (const beta of [90, -90, 180, -180]) {
      expect(readGroundSlope(beta, 0).call).toBe('not_flat');
    }
    expect(readGroundSlope(GROUND_MAX_TILT_DEG + 1, 0).call).toBe('not_flat');
  });

  it('inside the grass floor it reads flat instead of inventing a tenth', () => {
    expect(readGroundSlope(GROUND_DEADBAND_DEG - 0.01, 0).alongPct).toBe(0);
    expect(readGroundSlope(GROUND_DEADBAND_DEG + 1, 0).alongPct).not.toBe(0);
  });

  it('the grounded floor is well under the angle 2% of grade subtends — the reason this method exists', () => {
    const twoPercentDeg = (Math.atan(0.02) * 180) / Math.PI; // ≈1.15°
    expect(GROUND_DEADBAND_DEG).toBeLessThan(twoPercentDeg);
  });

  it('the SCREEN reports the grounded value, not the aimed inference', () => {
    const sf = code('app/smartfinder.tsx');
    expect(sf).toMatch(/const shownSlopePct = groundSummary\?\.mean\.alongPct \?\? slopePct;/);
    // and what gets persisted for the next visit is the measurement
    expect(sf).toMatch(/slopePct: shownSlopePct,/);
  });
});

describe('spots that disagree are a finding, not noise', () => {
  const flatish = readGroundSlope(1.2, 0);
  const steeper = readGroundSlope(4.5, 0);

  it('two agreeing spots average, and agree', () => {
    const sum = summarizeGroundSpots([readGroundSlope(3, 0), readGroundSlope(3.2, 0)])!;
    expect(sum.spots).toBe(2);
    expect(sum.agree).toBe(true);
  });

  it('two disagreeing spots are reported as disagreeing rather than smoothed', () => {
    const sum = summarizeGroundSpots([flatish, steeper])!;
    expect(sum.agree).toBe(false);
    expect(sum.spreadPct).toBeGreaterThan(GROUND_AGREE_PCT);
  });

  it('nothing usable summarises to null, never to a zero slope', () => {
    expect(summarizeGroundSpots([])).toBeNull();
    expect(summarizeGroundSpots([readGroundSlope(90, 0)])).toBeNull();
  });
});

describe('confidence is derived from what was measured', () => {
  const steady = { wobbleDeg: GROUND_STEADY_DEG - 0.1 };

  it('a reading barely above the floor is low however steady the hold', () => {
    const g = readGroundSlope(GROUND_DEADBAND_DEG + 0.1, 0);
    expect(groundReadConfidence(g, { ...steady, spots: 2 })).toBe('low');
  });

  it('an unwatched hold is low — unknown is not steady', () => {
    expect(groundReadConfidence(readGroundSlope(4, 0), { spots: 2, wobbleDeg: null })).toBe('low');
  });

  it('one clear steady spot is moderate; two agreeing spots earn good', () => {
    const g = readGroundSlope(4, 0);
    expect(groundReadConfidence(g, { ...steady, spots: 1 })).toBe('moderate');
    expect(groundReadConfidence(g, { ...steady, spots: 2, agree: true })).toBe('good');
  });

  it('spots that disagree do not earn good, however many there are', () => {
    expect(groundReadConfidence(readGroundSlope(4, 0), { ...steady, spots: 3, agree: false })).toBe('moderate');
  });
});

describe('the read never states a slope it did not measure', () => {
  it('with no grounded reading it says so and asks for one', () => {
    const block = buildPuttMeasurementBlock({
      distanceFeet: 18, ground: null, groundConfidence: null, groundSpots: 0,
    });
    expect(block).toMatch(/Slope: NO MEASUREMENT/);
    expect(block).toMatch(/Do not state uphill or downhill/);
    // [[silence-is-not-an-answer]] — it must say what it still needs
    expect(block).toMatch(/lay the phone flat on the green/i);
  });

  it('with a grounded reading it states the grade AND its confidence', () => {
    const g = readGroundSlope(3, 0);
    const block = buildPuttMeasurementBlock({
      distanceFeet: 18, ground: g, groundConfidence: 'moderate', groundSpots: 1,
    });
    expect(block).toMatch(/Slope, phone laid on the green: .*uphill/);
    expect(block).toMatch(/Confidence in that slope: moderate/);
    // one spot must not be allowed to speak for the whole line
    expect(block).toMatch(/one spot on the line was sampled/i);
  });

  it('an unmeasured distance is declared, not omitted — omission reads as permission to invent', () => {
    const block = buildPuttMeasurementBlock({
      distanceFeet: null, ground: null, groundConfidence: null, groundSpots: 0,
    });
    expect(block).toMatch(/Length: not measured yet/);
  });

  it('a distance always travels with its ± — the honesty is the number, not a disclaimer', () => {
    /**
     * 2026-09-13, second pass. This asserted the phrase "rough visual estimate", which was the right
     * guard while the distance was pixels over a fixed constant. It is now a tilt projection with an
     * uncertainty propagated through the real geometry, so the property worth protecting changed: the
     * model must be given the RANGE, not a hedge in words it has to decide how much to discount.
     */
    const withPm = buildPuttMeasurementBlock({
      distanceFeet: 18, distanceUncertaintyFeet: 1.2, ground: null, groundConfidence: null, groundSpots: 0,
    });
    expect(withPm).toMatch(/18 feet, give or take 1\.2/);
    expect(withPm).toMatch(/different lag/);

    // and with no ± available it states the number plainly rather than inventing a confidence
    const without = buildPuttMeasurementBlock({
      distanceFeet: 18, ground: null, groundConfidence: null, groundSpots: 0,
    });
    expect(without).toMatch(/- Length: 18 feet\./);
  });

  it("the player's own read is reconciled with, not overruled", () => {
    const block = buildPuttMeasurementBlock({
      distanceFeet: 18, ground: readGroundSlope(3, 0), groundConfidence: 'moderate', groundSpots: 1,
      spokenRead: 'left edge, 8 inches',
    });
    expect(block).toMatch(/left edge, 8 inches/);
    expect(block).toMatch(/Do not simply overrule him/);
    expect(block).toMatch(/whole line/);
  });

  it('a low-confidence slope is spoken as marginal rather than dropped or asserted', () => {
    const block = buildPuttMeasurementBlock({
      distanceFeet: 18, ground: readGroundSlope(4, 0), groundConfidence: 'low', groundSpots: 1,
    });
    expect(block).toMatch(/confidence is low/);
  });
});

describe('the vision step checks the measurement rather than decorating it', () => {
  const svc = code('services/puttReadService.ts');

  it('it looks for the flagstick, the flag and the hole', () => {
    expect(svc).toMatch(/flagstick/i);
    expect(svc).toMatch(/hole and the flagstick|hole, a flagstick/i);
  });

  it('the tapped point goes with the frame so the tap can be CHECKED', () => {
    const block = buildPuttMeasurementBlock({
      distanceFeet: 18, ground: null, groundConfidence: null, groundSpots: 0,
      targetPoint: { xNorm: 0.5, yNorm: 0.2 },
    });
    expect(block).toMatch(/I tapped the hole at the upper centre/);
    expect(block).toMatch(/Check that against where the hole actually is/);
  });

  it('a MISS is an answer — it must be told to say the tap was wrong', () => {
    expect(svc).toMatch(/tell me to re-tap it/);
    expect(svc).toMatch(/my distance is wrong if the tap missed/);
  });

  it('it is forbidden from estimating distance from pixels', () => {
    expect(svc).toMatch(/Never estimate a distance from the picture/);
  });

  it('the flag question is only asked when there IS a frame', () => {
    // Asking a text-only turn to look at a picture invites it to invent one. Asserted through the
    // function rather than against the source text, so it survives the composition being refactored.
    const base = { distanceFeet: 18, ground: null, groundConfidence: null, groundSpots: 0 } as const;
    expect(composeInstruction({ ...base })).not.toMatch(/flagstick/i);
    expect(composeInstruction({ ...base, imageBase64: 'x' })).toMatch(/flagstick/i);
    // and the image fields are nulled rather than sent empty when there is no frame
    expect(svc).toMatch(/image_media_type: input\.imageBase64 \?/);
  });
});

describe('green truth stays unified', () => {
  it('the putt read goes through the ONE builder, so green truth is not assembled twice', () => {
    /**
     * The first version of puttReadService POSTed its own body and pulled the putting record and the
     * prior green read itself — and the one-payload guard went red, correctly. buildCaddieRequestBody
     * already emits both, so the hand-rolled version was a second assembly of context that existed.
     * That is the shape that made the caddie's voice change between surfaces.
     */
    const svc = code('services/puttReadService.ts');
    expect(svc).toMatch(/askCaddie\(/);
    expect(svc).not.toMatch(/greenHeatInput\(/);
    expect(svc).not.toMatch(/fetch\(/);
  });

  it('the grounded spots are cleared with the putt they belong to', () => {
    // Carrying one green's slope onto the next putt is the quiet kind of wrong this screen produced.
    expect(code('app/smartfinder.tsx')).toMatch(/const reset = \(\) => \{[\s\S]{0,400}setGroundSpots\(\[\]\)/);
  });

  it('the Rules answer covers reading a green with the phone, and is askable about it', () => {
    const rules = code('data/rulesReference.ts');
    expect(rules).toMatch(/read the incline of a green/);
    expect(rules).toMatch(/'bubble level'/);
    // and it is the casual/competition split Tim asked for, not a blanket prohibition
    expect(rules).toMatch(/In casual play there is nothing to switch off/);
  });
});

describe('what the caddie SAYS on the way in sets the right expectation', () => {
  it('a putt read does not announce a scene read', () => {
    const h = code('services/intents/openToolHandler.ts');
    expect(h).toMatch(/toolName === 'putt_read'[\s\S]{0,200}voiceResponse = 'Let me read it\. Tap your ball, then the hole\.'/);
  });
});

describe('describeGroundSlope reports plainly and hedges once', () => {
  it('a flat patch says flat', () => {
    expect(describeGroundSlope(readGroundSlope(0, 0))).toMatch(/flat/i);
  });

  it('the grade is stated without qualifiers buried in the sentence', () => {
    const txt = describeGroundSlope(readGroundSlope(4, 0))!;
    expect(txt).toMatch(/uphill/);
    // the uncertainty rides on the confidence chip, not on weasel words in the number
    expect(txt).not.toMatch(/maybe|roughly|about|approximately|estimate/i);
  });

  it('there is nothing to describe when the phone is not down', () => {
    expect(describeGroundSlope(readGroundSlope(90, 0))).toBeNull();
  });
});

/**
 * 2026-09-13 (Tim) — "Finish path A distance option and grazing view."
 *
 * THE DISTANCE WAS NEVER A MEASUREMENT. The putt overlay divided the pixel gap between two taps by a
 * fixed constant (PIXELS_PER_FOOT = 35, "rough by design"). Under perspective ten feet near the camera
 * and ten feet away occupy completely different pixel counts, so the same putt read differently
 * depending on hold height and where in the frame the taps landed. That is the accuracy complaint.
 *
 * The tilt projection replaces it — and it is the method that was taken OFF the reticle on 2026-08-24
 * for being unusable. Both are true, because the reason it failed there is a function of DISTANCE:
 * "at ~1.6 m phone height a 150-yard target sits at 0.67 DEGREES of down-angle", under the 2° floor.
 * A putt is 3-60 feet, where the same geometry has degrees to spare. The envelope test below pins that
 * argument numerically so nobody has to take it on trust — including me.
 */
describe('the putt distance is a projection, inside the envelope where tilt works', () => {
  const H = 1.6;
  const D2R = Math.PI / 180;
  const VFOV = 60;

  /** Build the tap a real camera would produce for a ground point at a known distance. */
  const tapFor = (groundM: number, axisDepDeg: number) => {
    const depression = Math.atan(H / groundM) / D2R;
    const rayAboveDeg = axisDepDeg - depression;
    const halfTan = Math.tan((VFOV * D2R) / 2);
    return { xNorm: 0.5, yNorm: 0.5 - Math.tan(rayAboveDeg * D2R) / (2 * halfTan), pitchDeg: 90 - axisDepDeg };
  };

  it('recovers a putt length it was never told — this is the whole claim', () => {
    for (const [ballM, holeM] of [[1.5, 6.1], [1.0, 3.05], [1.2, 9.14]] as const) {
      const out = computePuttGroundDistance({ a: tapFor(ballM, 28), b: tapFor(holeM, 28), hold_height_m: H });
      expect(out.call).toBe('read');
      expect(out.feet!).toBeCloseTo((holeM - ballM) / 0.3048, 0);
    }
  });

  it('the envelope claim is TRUE: a putt has degrees to spare where a 150-yard shot has none', () => {
    const depressionFor = (metres: number) => Math.atan(H / metres) / D2R;
    // why it was pulled off the reticle
    expect(depressionFor(137)).toBeLessThan(1);            // 150 yd — under a degree
    // why it belongs on a putt
    expect(depressionFor(6.1)).toBeGreaterThan(PUTT_MIN_DEPRESSION_DEG * 3);   // 20 ft
    expect(depressionFor(18.3)).toBeGreaterThan(PUTT_MIN_DEPRESSION_DEG);      // 60 ft, the long end
  });

  it('the uncertainty is propagated, not asserted — it grows with the putt', () => {
    const short = computePuttGroundDistance({ a: tapFor(1.0, 30), b: tapFor(3.05, 30), hold_height_m: H });
    const long = computePuttGroundDistance({ a: tapFor(2.0, 20), b: tapFor(18.3, 20), hold_height_m: H });
    expect(short.uncertaintyFeet!).toBeLessThan(long.uncertaintyFeet!);
    // and a ± that is a large fraction of the putt cannot be called high confidence
    expect(short.confidence).toBe('high');
    expect(long.confidence).not.toBe('high');
  });

  it('confidence is the error as a FRACTION of the putt, not its absolute size', () => {
    // ±1 ft on a 40-footer is fine; the same ±1 ft on a 3-footer is the whole putt.
    const out = computePuttGroundDistance({ a: tapFor(1.0, 30), b: tapFor(1.3, 30), hold_height_m: H });
    if (out.call === 'read' && out.uncertaintyFeet! / out.feet! > 0.25) expect(out.confidence).toBe('low');
  });

  it('a shallow-but-nonzero angle is REFUSED, not served as a 300-foot putt', () => {
    /**
     * The floor is the point. Between 0 and PUTT_MIN_DEPRESSION_DEG the geometry still produces a
     * finite number — it just runs away toward the horizon, where half a degree of tap error is tens of
     * feet. A naive `depression > 0` test accepts all of it and reports a confident nonsense distance,
     * which is exactly how the reticle used to behave before its own floor was added.
     *
     * Found because break-test B13 (replacing the floor with `> 0`) passed: the earlier refusal test
     * used a level phone, which fails either way and so never exercised the floor at all.
     */
    const shallow = tapFor(90, 2);   // ~90 m out, ~1° of depression: inside the old naive test, outside this one
    const near = tapFor(2.0, 2);
    const out = computePuttGroundDistance({ a: near, b: shallow, hold_height_m: H });
    expect(out.call).toBe('too_shallow');
    expect(out.feet).toBeNull();
  });

  it('a geometry it cannot read is refused, and says WHICH way', () => {
    // phone level: the ray never meets the ground inside the usable band
    const level = computePuttGroundDistance({
      a: { xNorm: 0.5, yNorm: 0.5, pitchDeg: 90 },
      b: { xNorm: 0.5, yNorm: 0.45, pitchDeg: 90 },
      hold_height_m: H,
    });
    expect(level.call).toBe('too_shallow');
    expect(level.feet).toBeNull();
    expect(whyNoPuttDistance(level.call)).toMatch(/Tilt down/);
  });

  it('the pixel heuristic is GONE — not kept as a second owner of how long the putt is', () => {
    const sf = code('app/smartfinder.tsx');
    expect(sf).not.toMatch(/PIXELS_PER_FOOT/);
    expect(sf).toMatch(/computePuttGroundDistance\(/);
  });

  it('hold height comes from the calibration owner, not a new preset system', () => {
    /**
     * services/rangefinderCalibration already learns the player's real hold height from GPS-anchored
     * reads — it exists because a constant 1.6 m made the reticle read long for anyone shorter. A putt
     * read is the same hold, so it takes the same learned number rather than becoming a second owner.
     */
    expect(code('app/smartfinder.tsx')).toMatch(/hold_height_m: effectiveEyeHeightM\(\)/);
    expect(code('services/rangefinder.ts')).not.toMatch(/PUTT_HOLD_HEIGHTS/);
  });

  it('each tap carries its OWN pitch — the phone moves between them', () => {
    const sf = code('app/smartfinder.tsx');
    expect(sf).toMatch(/pitchDeg: pointA\.pitch/);
    expect(sf).toMatch(/pitchDeg: pointB\.pitch/);
  });
});

describe('the grazing view is a pose, verified rather than promised', () => {
  it('upright AND steady is ready — that combination is a phone resting on the green', () => {
    expect(readGrazingPose(90, 0.1).ready).toBe(true);
  });

  it('upright but moving is NOT ready — that is just the normal aiming hold', () => {
    const pose = readGrazingPose(90, 2.5);
    expect(pose.ready).toBe(false);
    expect(pose.call).toBe('not_steady');
    expect(whyNoGrazingPose(pose)).toMatch(/settle/);
  });

  it('an unwatched hold is not steady — unknown is never treated as good', () => {
    expect(readGrazingPose(90, null).ready).toBe(false);
  });

  it('flat on the green is NOT the grazing pose — the camera is looking at grass', () => {
    // The two poses are different and cannot be done at once; conflating them would send a picture of
    // turf up with the grazing question attached.
    const pose = readGrazingPose(0, 0.1);
    expect(pose.ready).toBe(false);
    expect(pose.call).toBe('not_upright');
  });

  it('the grazing question is only asked of a frame taken from the ground', () => {
    const base = { distanceFeet: 18, ground: null, groundConfidence: null, groundSpots: 0 } as const;
    expect(composeInstruction({ ...base })).not.toMatch(/resting ON the green/);
    expect(composeInstruction({ ...base, imageBase64: 'x' })).not.toMatch(/resting ON the green/);
    expect(composeInstruction({ ...base, imageBase64: 'x', frameFromGround: true })).toMatch(/resting ON the green/);
  });

  it('a picture is never allowed to produce the slope number', () => {
    const txt = composeInstruction({
      distanceFeet: 18, ground: null, groundConfidence: null, groundSpots: 0,
      imageBase64: 'x', frameFromGround: true,
    });
    expect(txt).toMatch(/do NOT give me a slope percentage or inches of break from a picture/);
    expect(txt).toMatch(/the measured slope is above and it owns the numbers/);
  });

  it('the ground frame is PREFERRED over a fresh chest-height grab', () => {
    expect(code('app/smartfinder.tsx')).toMatch(/groundFrame \?\? \(captureFrameBase64 \? await captureFrameBase64\(\) : null\)/);
    expect(code('app/smartfinder.tsx')).toMatch(/frameFromGround: groundFrame != null/);
  });

  it('capturing a ground view makes the previous read stale rather than leaving it standing', () => {
    const sf = code('app/smartfinder.tsx');
    expect(sf).toMatch(/setGroundFrame\(b64\);[\s\S]{0,200}caddieFiredRef\.current = false;/);
  });
});
