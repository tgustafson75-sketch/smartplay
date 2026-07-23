/**
 * 2026-07-23 (Tim — elite Coach Caddie). The lesson-flow brain: turns a diagnosis into the spoken
 * arc a real coach runs — watch → diagnose the ONE priority → explain the why → give a feel + a
 * named drill → rep with honest, encouraging feedback and a clear checkpoint → celebrate the win →
 * send them home with a single thing. Pure + testable; composes services/coachKnowledge.
 *
 * The voice is deliberately coach-authentic: warm, specific, one idea at a time, always tied to a
 * FEEL the player can chase — never a robotic metric dump.
 */
import type { SwingBiomechanics } from './poseAnalysisApi';
import { type CoachFault, type Diagnosis, topPriority, strengthLine, FAULT_CAUSES_MISS } from './coachKnowledge';

export type SessionStage = 'intro' | 'baseline' | 'diagnosis' | 'drill' | 'reps' | 'progress' | 'homework';

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Opening line — a coach sets the tone and asks for a baseline swing first. */
export function introLine(): string {
  return "Alright, let's get to work. Make a couple of your normal swings for me — I want to see what you're bringing today before we change anything. Record when you're ready.";
}

/**
 * The diagnosis reveal. If a priority fault was found, name it, connect it to the player's ball
 * flight, and explain why it matters — the way a coach frames the ONE thing worth their time. If
 * the swing is clean, reinforce the strength instead (and offer a sharpening focus).
 */
export function diagnosisReveal(priority: Diagnosis | null, m: SwingBiomechanics): string {
  if (!priority) {
    return `${strengthLine(m)} Since there's no glaring fault, we'll sharpen a fundamental and groove it — pick a focus, or I'll start you on tempo.`;
  }
  const f = priority.fault;
  return `Here's what I see. Your biggest opportunity is ${f.name.toLowerCase()} — what a coach would call ${f.coachName}. ${f.why} That's likely behind your ${f.ballFlight} So that's our one thing today. Get this and a lot cleans up on its own.`;
}

/**
 * If the diagnosed fault is a known cause of the player's actual on-course miss, say so — this is
 * what makes it feel like THEIR coach. Returns null when we don't know their miss or it doesn't
 * connect (no forced/false link).
 */
export function missConnectionLine(faultId: string, missType: string | null | undefined): string | null {
  if (!missType || missType === 'varies') return null;
  const causes = FAULT_CAUSES_MISS[faultId] ?? [];
  if (!causes.includes(missType)) return null;
  return `And here's the kicker — I know your miss tends to be a ${missType}. This is exactly where that comes from. Fix this and that miss largely takes care of itself.`;
}

/**
 * If we've coached this same fault before, open with continuity — a coach who remembers you. Pass
 * the days since the last lesson on this fault (null = never). Returns null on first-ever.
 */
export function memoryLine(faultName: string, daysSinceLast: number | null): string | null {
  if (daysSinceLast == null) return null;
  if (daysSinceLast <= 3) return `We were on ${faultName.toLowerCase()} just recently — let's see if it's sticking.`;
  return `Last time we worked together it was ${faultName.toLowerCase()} too — it's still your one thing, so let's really lock it in today.`;
}

/** The prescription — one feel and one named drill. */
export function prescriptionLine(f: CoachFault): string {
  return `Here's the feel I want: ${f.feel} And a drill to burn it in — the ${f.drill.name}: ${f.drill.how} Take a practice rep or two with that feel, then hit one and I'll watch.`;
}

/** Short cue the caddie repeats right before a rep. */
export function cueLine(f: CoachFault): string {
  return `Okay — with that feel: ${f.feel} Swing when you're ready.`;
}

export interface RepEvaluation {
  /** The measured value of the priority metric on this rep (null if the angle couldn't see it). */
  value: number | null;
  /** Did this rep hit the checkpoint / target? */
  fixed: boolean;
  /** Moved toward the target vs the previous rep? */
  improved: boolean;
  /** The spoken feedback for this rep. */
  line: string;
}

// Read the priority metric off a swing.
function readMetric(f: CoachFault, m: SwingBiomechanics): number | null {
  return num((m as unknown as Record<string, number | null | undefined>)[f.metric]);
}

// Is a higher value better for this metric? (spine change / head drift / hip slide: lower is better.)
function higherIsBetter(f: CoachFault): boolean {
  return f.metric !== 'spineAngleDeltaDeg' && f.metric !== 'headDriftPxNorm' && f.metric !== 'hipSlideRatio';
}

// Minimum change (in the metric's own units) that counts as real improvement. Degree/score metrics
// move in whole numbers; the normalized head-drift / hip-slide metrics live in ~0..0.3, so a 0.5
// epsilon would make improvement impossible to detect for them.
function improvementEpsilon(f: CoachFault): number {
  return f.metric === 'headDriftPxNorm' || f.metric === 'hipSlideRatio' ? 0.01 : 0.5;
}

/**
 * Evaluate one rep against the priority fault. `prevValue` is the last rep's metric (null on the
 * first rep). Produces the coach's spoken feedback: a win when the checkpoint is hit, encouragement
 * + the direction when it improved, or a re-cue (exaggerate the feel) when it didn't.
 */
export function evaluateRep(f: CoachFault, m: SwingBiomechanics, prevValue: number | null): RepEvaluation {
  const value = readMetric(f, m);
  const fixed = f.isFixed(m);

  if (value == null) {
    return { value: null, fixed: false, improved: false,
      line: "I couldn't read that one cleanly — get your whole swing in frame, face-on works best for this, and give me another." };
  }
  if (fixed) {
    return { value, fixed: true, improved: true, line: `${f.win} ${f.checkpoint}` };
  }
  let improved = false;
  const eps = improvementEpsilon(f);
  if (prevValue != null) improved = higherIsBetter(f) ? value > prevValue + eps : value < prevValue - eps;

  if (improved) {
    return { value, fixed: false, improved: true,
      line: `Better — that moved the right way. You're close. A touch more of the same feel: ${f.feel} One more.` };
  }
  return { value, fixed: false, improved: false,
    line: `Not quite that time — really exaggerate it: ${f.feel} Make it feel like too much; it won't be. Run it again.` };
}

/** Called after a run of good reps — lock it in and progress. */
export function progressLine(f: CoachFault, nextPriority: Diagnosis | null): string {
  if (nextPriority && nextPriority.fault.id !== f.id) {
    return `That's locked in — great work on ${f.name.toLowerCase()}. Now that it's better, the next thing to sharpen is ${nextPriority.fault.name.toLowerCase()}. Want to keep going, or bank this and finish?`;
  }
  return `That's the checkpoint hit cleanly, back to back — you've genuinely changed it. Let's not overcook it. Ready to wrap with your takeaway?`;
}

/** The homework — the ONE thing to leave with, the way a good lesson ends. */
export function homeworkLine(f: CoachFault): string {
  return `Here's your one thing to take away: ${f.feel} Do ten reps of the ${f.drill.name} before every range session — slow and deliberate — and that feel becomes yours. That's the lesson. Go build it.`;
}

/** Convenience: full diagnosis for a baseline swing. */
export function diagnoseBaseline(m: SwingBiomechanics): Diagnosis | null {
  return topPriority(m);
}
