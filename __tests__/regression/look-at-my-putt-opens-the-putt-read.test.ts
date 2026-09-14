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
} from '../../services/puttSlopeRead';
import { buildPuttMeasurementBlock } from '../../services/puttReadService';

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

  it('the A/B distance is never presented as surveyed', () => {
    const block = buildPuttMeasurementBlock({
      distanceFeet: 18, ground: null, groundConfidence: null, groundSpots: 0,
    });
    expect(block).toMatch(/rough visual estimate/);
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
    // Asking a text-only turn to look at a picture invites it to invent one.
    expect(svc).toMatch(/input\.imageBase64 \? `\$\{PUTT_INSTRUCTION\}[\s\S]{0,40}\$\{FLAG_INSTRUCTION\}` : PUTT_INSTRUCTION/);
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
