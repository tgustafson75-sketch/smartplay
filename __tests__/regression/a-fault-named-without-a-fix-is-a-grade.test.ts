/**
 * 2026-09-14 (Tim) — "We have smartmotion watch but how can we comment on a lesson we have not
 * taught. This is a pretty important principle throughout the app."
 *
 * `PoseFault` carried a key, a label, a severity and the measurement that triggered it — and
 * nothing else. The camera said EARLY EXTENSION, proved it with "spine angle rose 14° into impact",
 * and stopped. For a self-taught player that is a verdict in a language they do not speak.
 *
 * Counted before the fix: of ELEVEN pose faults, **seven had no teaching anywhere in the app**
 * (sway, under_coil, lead_arm_bent, poor_finish, head_movement, quick_tempo, slow_tempo), and the
 * four that did — early_extension, over_the_top, chicken_wing, reverse_pivot — had a drill in
 * `services/drillRecommendation` keyed on the AI vocabulary that this read was never passed to.
 *
 * The enforcement is the TYPE, not this file: `TEACHING` is a `Record<SwingFaultKey, …>` so an
 * untaught key fails typecheck, and every fault is built by one constructor that reads it. These
 * tests check the words are real and the drill is asked for rather than restated.
 */
import fs from 'fs';
import path from 'path';
import { buildPoseSwingRead } from '../../services/swing/poseSwingRead';
import { teachingFor, drillForFault, type SwingFaultKey } from '../../services/swing/faultTeaching';
import { recommendDrill } from '../../services/drillRecommendation';

const ROOT = path.resolve(__dirname, '../..');
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every key the read can raise, taken from the union so this list cannot fall behind it. */
const ALL: SwingFaultKey[] = [
  'early_extension', 'sway', 'reverse_pivot', 'over_the_top', 'under_coil',
  'quick_tempo', 'slow_tempo', 'lead_arm_bent', 'chicken_wing', 'poor_finish', 'head_movement',
];

describe('every fault teaches', () => {
  it.each(ALL)('%s says what it is and how to fix it', (key) => {
    const teaching = teachingFor(key);
    expect(teaching).toBeDefined();
    // Real sentences, not placeholders. "TODO" teaching is worse than none.
    expect(teaching.what.length).toBeGreaterThan(60);
    expect(teaching.what).not.toMatch(/TODO|TBD|coming soon/i);
    expect(teaching.fix.length).toBeGreaterThanOrEqual(2);
    for (const step of teaching.fix) expect(step.length).toBeGreaterThan(15);
    // The shot-shape lessons' shape: the last step is the ONE FEEL.
    expect(teaching.fix[teaching.fix.length - 1]).toMatch(/feel|Count it|Hold the finish|Chest facing/i);
  });

  it('the seven that had no teaching anywhere now do', () => {
    for (const k of ['sway', 'under_coil', 'lead_arm_bent', 'poor_finish', 'head_movement', 'quick_tempo', 'slow_tempo'] as SwingFaultKey[]) {
      expect(teachingFor(k).fix.length).toBeGreaterThan(0);
    }
  });

  it('the drill is ASKED of the catalog, never restated here', () => {
    // A second opinion about which drill answers early extension is how the two drift apart.
    for (const k of ['early_extension', 'over_the_top', 'chicken_wing', 'reverse_pivot'] as SwingFaultKey[]) {
      const d = drillForFault(k);
      expect(d).not.toBeNull();
      expect(d!.drill_name).toBe(recommendDrill(k as never)!.drill_name);
      expect(d!.reason).toBe(recommendDrill(k as never)!.reason);
    }
    const src = code('services/swing/faultTeaching.ts');
    expect(src).toMatch(/recommendDrill\(/);
    expect(src).not.toMatch(/drill_name: '/);      // no hardcoded drill names
  });

  it('a fault with no drill says so rather than inventing one', () => {
    expect(drillForFault('under_coil')).toBeNull();
    expect(drillForFault('slow_tempo')).toBeNull();
  });
});

describe('the read carries the teaching, not just the grade', () => {
  /** A swing that trips several faults at once. */
  const read = buildPoseSwingRead(
    {
      hipTurnDeg: 40, shoulderTurnDeg: 55, shoulderTiltDeg: 30, weightShiftPct: -10,
      spineAngleDeltaDeg: 20, headDriftPxNorm: 0.14, hipSlideRatio: 0.3, sequencingScore: 30,
      swayNorm: 0.32, leadArmTopDeg: 120, leadArmImpactDeg: 120, finishWeightPct: -5,
      confidence: { sway: 0.9, leadArm: 0.9, chickenWing: 0.9, finish: 0.9, headDrift: 0.9, spineAngleDelta: 0.9, weightShift: 0.9, shoulderTurn: 0.9 },
    } as never,
    { ratio: 1.6, backswingMs: 400, downswingMs: 250, topMs: 400, sequencingScore: null, source: 'video_pose', confidence: 'med' } as never,
  );

  it('raises faults at all in this fixture', () => {
    expect(read.faults.length).toBeGreaterThan(0);
  });

  it('every raised fault carries what / fix, never an empty one', () => {
    for (const f of read.faults) {
      expect(f.what.length).toBeGreaterThan(60);
      expect(f.fix.length).toBeGreaterThanOrEqual(2);
      expect(f.evidence.length).toBeGreaterThan(10);   // the measurement is still there
    }
  });

  it('faults are built through the ONE constructor, so none can skip its teaching', () => {
    const src = code('services/swing/poseSwingRead.ts');
    expect(src).not.toMatch(/faults\.push\(\{/);       // no raw object literal
    expect(src).toMatch(/function fault\(/);
  });

  it('the player sees the fix where the grade is shown', () => {
    const sm = code('app/swinglab/smartmotion.tsx');
    // Slice FORWARD from the breakdown card — "key: 'speed'" also appears earlier in this file,
    // and an unanchored indexOf produced a backwards (empty) slice that passed nothing.
    const at = sm.indexOf("key: 'breakdown'");
    expect(at).toBeGreaterThan(-1);
    const card = sm.slice(at, sm.indexOf("key: 'speed'", at));
    expect(card).toMatch(/top\.what/);
    expect(card).toMatch(/top\.fix/);
    expect(card).toMatch(/top\.drill/);
  });
});
