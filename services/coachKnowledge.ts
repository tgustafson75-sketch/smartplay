/**
 * 2026-07-23 (Tim — "make Coach Caddie an elite, unique lesson experience, drawn from how real
 * coaches teach").
 *
 * This is the coaching BRAIN behind Coach Caddie's diagnostic lessons. It encodes how a good
 * instructor actually runs a lesson: watch a swing → find the ONE priority (the fault that's
 * costing the most, and ideally the ROOT cause, not a symptom) → explain the why simply → give a
 * single FEEL plus a named DRILL → rep with a clear CHECKPOINT → progress. The language, feels,
 * and drills are the ones real coaches use (Blackburn's posture/early-extension work, Foley's
 * pressure-shift, Como/AMG kinematic-sequence teaching, the classic chair/step/pump drills).
 *
 * Pure + dependency-light (only a SwingBiomechanics type import) so it's unit-testable and the
 * whole coaching library is OTA-able. NO fabrication: every fault is detected from a real measured
 * metric; when the metric is null (angle can't see it), the fault simply isn't diagnosable.
 */
import type { SwingBiomechanics } from './poseAnalysisApi';

export type SwingMetricKey =
  | 'weightShiftPct' | 'shoulderTurnDeg' | 'hipTurnDeg'
  | 'spineAngleDeltaDeg' | 'headDriftPxNorm' | 'hipSlideRatio' | 'sequencingScore';

export interface CoachDrill {
  name: string;
  how: string;
}

export interface CoachFault {
  id: string;
  /** Player-facing priority name. */
  name: string;
  /** What a coach calls it on the lesson tee. */
  coachName: string;
  /** The metric that reveals it + the target the fix should reach. */
  metric: SwingMetricKey;
  /** Base importance — root-cause faults (posture, pressure) outrank symptoms so we teach the
   *  thing that unlocks the rest, exactly like a real lesson plan. 1 (symptom) … 5 (root). */
  rootWeight: number;
  /** Detect the fault + how BAD it is (0 = fine, 1 = severe) from the measured metric. */
  detect: (m: SwingBiomechanics) => { present: boolean; severity: number; value: number | null };
  /** Has the target been reached on this rep? Drives the checkpoint / "that's it!" moment. */
  isFixed: (m: SwingBiomechanics) => boolean;
  /** Why it matters — one plain sentence, the way you'd explain it to a student. */
  why: string;
  /** The ONE feel. Coaches give a feel, not a position. */
  feel: string;
  /** A named drill with how-to. */
  drill: CoachDrill;
  /** What "fixed" looks/feels like — the checkpoint the player is chasing. */
  checkpoint: string;
  /** The miss this fault tends to produce (so the read connects to their ball flight). */
  ballFlight: string;
  /** Encouraging line the caddie says when the rep hits the checkpoint. */
  win: string;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// Severity helper: how far past a threshold, scaled 0..1 over `span`.
const over = (value: number, threshold: number, span: number) =>
  Math.max(0, Math.min(1, (value - threshold) / span));
const under = (value: number, threshold: number, span: number) =>
  Math.max(0, Math.min(1, (threshold - value) / span));

/**
 * The library. Ordered roughly root → symptom; the diagnose() ranker uses rootWeight × severity so
 * a real root cause (early extension, no pressure shift) is chosen over a downstream symptom.
 */
export const COACH_FAULTS: CoachFault[] = [
  {
    id: 'early_extension',
    name: 'Hold your posture',
    coachName: 'early extension (losing the tush line)',
    metric: 'spineAngleDeltaDeg',
    rootWeight: 5,
    detect: (m) => { const v = num(m.spineAngleDeltaDeg); return v == null ? { present: false, severity: 0, value: null } : { present: v > 11, severity: over(v, 11, 14), value: v }; },
    isFixed: (m) => { const v = num(m.spineAngleDeltaDeg); return v != null && v <= 9; },
    why: "When your hips push toward the ball and you stand up through impact, the club gets stuck behind you — that's the source of blocks, hooks, and the odd thin.",
    feel: "Feel your belt buckle and tush stay BACK through the strike — like your backside is pinned to a wall behind you as you turn.",
    drill: { name: 'Chair / wall drill', how: "Set up with your rear end just touching a chair or wall. Make slow swings keeping your glutes in contact with it all the way to impact — no pulling away." },
    checkpoint: 'Your spine angle holds from address to impact — no standing up.',
    ballFlight: 'blocks right, snap hooks, and inconsistent low-point (thin/fat).',
    win: "That's the one — you held your posture through it. Feel how the club had room to swing?",
  },
  {
    id: 'pressure_shift',
    name: 'Shift into your lead side',
    coachName: 'hanging back / reverse pivot (no pressure shift)',
    metric: 'weightShiftPct',
    rootWeight: 5,
    detect: (m) => { const v = num(m.weightShiftPct); return v == null ? { present: false, severity: 0, value: null } : { present: v < 48, severity: under(v, 48, 22), value: v }; },
    isFixed: (m) => { const v = num(m.weightShiftPct); return v != null && v >= 55; },
    why: "If your weight hangs on your trail foot at impact, you lose speed and bottom out behind the ball — this is the number-one amateur power leak.",
    feel: "Feel like you're stepping into a throw — pressure moves to your LEAD foot before the club comes down, and you finish with your belt buckle over that front foot.",
    drill: { name: 'Step-through drill', how: "Start with feet together. As you swing down, step your lead foot toward the target and swing — it forces the weight to move forward and teaches the sequence." },
    checkpoint: '55%+ of your weight is on your lead foot at impact.',
    ballFlight: 'thin and fat strikes, weak slices, loss of distance.',
    win: "There it is — you shifted into the shot. That's where your power lives.",
  },
  {
    id: 'sequence',
    name: 'Smooth the transition',
    coachName: 'rushed transition / over-the-top sequence',
    metric: 'sequencingScore',
    rootWeight: 4,
    detect: (m) => { const v = num(m.sequencingScore); return v == null ? { present: false, severity: 0, value: null } : { present: v < 58, severity: under(v, 58, 30), value: v }; },
    isFixed: (m) => { const v = num(m.sequencingScore); return v != null && v >= 68; },
    why: "When your shoulders and arms fire first from the top, the club comes over the top and steep — that's the classic slice/pull. The fix is letting the lower body lead.",
    feel: "From the top, feel the club almost WAIT while your lead hip starts to clear — lower body first, then arms. Smooth change of direction, not a lunge.",
    drill: { name: 'Pump drill', how: "Swing to the top, then pump down halfway two or three times feeling the hips start the move and the club drop behind you — then hit on the third." },
    checkpoint: 'Your lower body starts the downswing before your shoulders (a smooth, in-sequence change of direction).',
    ballFlight: 'slices, pulls, and steep, glancing contact.',
    win: "Beautiful — that came from the ground up. Feel how much more effortless it was?",
  },
  {
    id: 'coil',
    name: 'Complete your turn',
    coachName: 'short backswing / incomplete shoulder turn',
    metric: 'shoulderTurnDeg',
    rootWeight: 3,
    detect: (m) => { const v = num(m.shoulderTurnDeg); return v == null ? { present: false, severity: 0, value: null } : { present: v < 78, severity: under(v, 78, 25), value: v }; },
    isFixed: (m) => { const v = num(m.shoulderTurnDeg); return v != null && v >= 85; },
    why: "A short shoulder turn robs you of the coil that stores speed — you end up all arms, which costs distance and consistency.",
    feel: "Feel your lead shoulder turn all the way UNDER your chin and your back point at the target at the top — a full, unhurried coil.",
    drill: { name: 'Cross-arm turn drill', how: "Arms crossed over your chest, club held across your shoulders. Make your backswing turn until the club points at the ball line — grooving the feel of a complete turn against a stable lower body." },
    checkpoint: 'Your shoulders turn ~90° — lead shoulder under the chin, back to the target.',
    ballFlight: 'loss of distance and a tendency to get quick and handsy.',
    win: "That's a real turn — feel how much more coil and time you had?",
  },
  {
    id: 'sway',
    name: 'Turn, don’t sway',
    coachName: 'swaying off the ball',
    metric: 'headDriftPxNorm',
    rootWeight: 3,
    detect: (m) => { const v = num(m.headDriftPxNorm); return v == null ? { present: false, severity: 0, value: null } : { present: v > 0.09, severity: over(v, 0.09, 0.12), value: v }; },
    isFixed: (m) => { const v = num(m.headDriftPxNorm); return v != null && v <= 0.06; },
    why: "Sliding off the ball instead of turning around your spine wrecks your low point — you have to time a big move back to hit it, so contact gets random.",
    feel: "Feel like you're turning inside a barrel — load into your trail hip and glute WITHOUT your head sliding off the ball. Rotate, don't drift.",
    drill: { name: 'Trail-hip wall drill', how: "Set an alignment stick (or stand) just outside your trail hip. Make backswings turning your hip AWAY from the stick, not bumping into it — that's rotation, not sway." },
    checkpoint: 'Your head stays centered over the ball through the backswing — you turn instead of slide.',
    ballFlight: 'thin/fat strikes and a two-way, inconsistent miss.',
    win: "Steady as a rock — you turned around a centered head. That's repeatable contact.",
  },
  {
    id: 'hip_load',
    name: 'Free up your hips',
    coachName: 'restricted hip turn',
    metric: 'hipTurnDeg',
    rootWeight: 2,
    detect: (m) => { const v = num(m.hipTurnDeg); return v == null ? { present: false, severity: 0, value: null } : { present: v < 34, severity: under(v, 34, 18), value: v }; },
    isFixed: (m) => { const v = num(m.hipTurnDeg); return v != null && v >= 40; },
    why: "If the hips barely move going back, you can't create the stretch between hips and shoulders that generates effortless speed.",
    feel: "Let your trail hip turn back and deep — feel the pocket of your trail pants rotate behind you, then clear the lead hip through.",
    drill: { name: 'Chair-turn drill', how: "Sit lightly on a chair edge, club across your chest, and rotate your hips back and through while staying in contact — it teaches the hips to turn, not slide." },
    checkpoint: 'Your hips turn ~45° at the top with good separation from your shoulders.',
    ballFlight: 'a weak, armsy swing with limited speed.',
    win: "Now the hips are working — feel the extra coil that gave you?",
  },
];

// Which on-course misses each fault tends to produce — lets the lesson connect the swing read to
// the player's KNOWN miss (playerProfile.missType), so it feels like their coach, not a generic app.
export const FAULT_CAUSES_MISS: Record<string, string[]> = {
  early_extension: ['hook', 'thin', 'push'],
  pressure_shift: ['thin', 'fat', 'slice'],
  sequence: ['slice', 'pull'],
  coil: [],
  sway: ['thin', 'fat', 'varies'],
  hip_load: [],
};

export interface Diagnosis {
  fault: CoachFault;
  severity: number;   // 0..1, how bad
  score: number;      // severity × rootWeight, the ranking key
  value: number | null;
}

/**
 * Diagnose a swing → the prioritized faults, worst-first (root cause preferred). Empty array means
 * a fundamentally sound swing (nothing measured crossed a fault threshold). Only metrics the read
 * actually measured are considered — a null metric is never guessed at.
 */
export function diagnose(m: SwingBiomechanics): Diagnosis[] {
  const found: Diagnosis[] = [];
  for (const fault of COACH_FAULTS) {
    const d = fault.detect(m);
    if (d.present && d.severity > 0) {
      found.push({ fault, severity: d.severity, score: d.severity * fault.rootWeight, value: d.value });
    }
  }
  return found.sort((a, b) => b.score - a.score);
}

/** The single priority to coach this session (the highest-ranked fault), or null for a clean swing. */
export function topPriority(m: SwingBiomechanics): Diagnosis | null {
  return diagnose(m)[0] ?? null;
}

/**
 * Was the swing READABLE enough to diagnose? A down-the-line video (or a low-confidence read) nulls
 * most fault metrics — in that case an empty diagnose() means "couldn't see it", NOT "clean swing".
 * This gate keeps us honest: we require at least 3 of the 6 fault metrics to have real values before
 * we'll either praise a sound swing or claim a priority. Below that, ask for a better angle.
 */
export function isDiagnosable(m: SwingBiomechanics): boolean {
  const metrics: (number | null | undefined)[] = [
    m.spineAngleDeltaDeg, m.weightShiftPct, m.sequencingScore,
    m.shoulderTurnDeg, m.headDriftPxNorm, m.hipTurnDeg,
  ];
  return metrics.filter((v) => typeof v === 'number' && Number.isFinite(v)).length >= 3;
}

/**
 * When no fault crosses a threshold, name the swing's biggest STRENGTH so the caddie can reinforce
 * it (real coaches praise what's working before sharpening). Returns a spoken line.
 */
export function strengthLine(m: SwingBiomechanics): string {
  const st = num(m.weightShiftPct);
  const seq = num(m.sequencingScore);
  const turn = num(m.shoulderTurnDeg);
  const spine = num(m.spineAngleDeltaDeg);
  if (spine != null && spine <= 6) return "Your posture is rock-solid through the strike — that's a pro-level fundamental. Let's keep sharpening from there.";
  if (st != null && st >= 58) return "Your weight shift is excellent — you're really moving into the ball. That's the engine of a good swing.";
  if (seq != null && seq >= 75) return "Your sequencing is beautiful — lower body leading, everything in order. That's tour-caliber.";
  if (turn != null && turn >= 92) return "Full, powerful turn — you're loading up beautifully. Great base to build on.";
  return "That's a genuinely sound swing — nothing's costing you strokes. Let's fine-tune the feels and keep it grooved.";
}
