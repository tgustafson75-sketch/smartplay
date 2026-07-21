/**
 * 2026-07-21 — Curated fault → golf-exercise map ([[fault-to-workout-export]]).
 *
 * Tim: map a swing fault to the golf-specific workouts/exercises that help it, surfaced on the
 * dashboard with an export to his AI-trainer app + a share sheet. Decision: CURATED + honest (not
 * AI-generated) — a vetted table, deterministic, no fabrication.
 *
 * Keys match the canonical fault vocabulary (api/swing-analysis PRIMARY_FAULTS + the pose-first read
 * faults in poseSwingRead.ts), so the same fault the analysis names drives the training suggestion —
 * "everything is everything". Pure data + lookup; unit-tested.
 */

export type WorkoutCategory = 'mobility' | 'stability' | 'strength' | 'drill';

export interface Exercise {
  name: string;
  category: WorkoutCategory;
  /** Honest one-line rationale tying the exercise to THIS fault. */
  why: string;
}

// Canonical fault keys → 2-3 vetted golf exercises each. Aliases (early extension is emitted as
// both 'early_extension' and 'spine_angle_loss'; weight-hang as 'reverse_pivot') are normalized below.
const FAULT_EXERCISES: Record<string, Exercise[]> = {
  early_extension: [
    { name: 'Hip-hinge holds (dowel on spine)', category: 'drill', why: 'Grooves keeping your spine angle so your hips stop thrusting toward the ball.' },
    { name: 'Glute bridges', category: 'strength', why: 'Stronger glutes let you post up and rotate instead of standing up through impact.' },
    { name: 'Hip airplanes', category: 'stability', why: 'Trains single-leg rotation control — the move that keeps posture into impact.' },
  ],
  sway: [
    { name: 'Single-leg balance (trail leg)', category: 'stability', why: 'Builds the trail-side stability to turn around a centered post instead of sliding.' },
    { name: 'Pallof press (anti-rotation)', category: 'strength', why: 'Teaches your core to resist lateral drift so the backswing coils, not sways.' },
    { name: 'Trail-hip loading drill (gate)', category: 'drill', why: 'Feels the difference between rotating into the trail hip and sliding off the ball.' },
  ],
  reverse_pivot: [
    { name: 'Step-through weight-shift drill', category: 'drill', why: 'Trains driving onto the lead side through impact instead of hanging back.' },
    { name: 'Lateral lunges', category: 'strength', why: 'Strength in the lateral shift so your weight actually gets forward.' },
    { name: 'Med-ball rotational throw (to lead side)', category: 'strength', why: 'Builds the transfer of weight + speed toward the target.' },
  ],
  over_the_top: [
    { name: 'Hip-lead separation drill (pump)', category: 'drill', why: 'Sequences the hips to start the downswing so the club drops on plane.' },
    { name: 'Thoracic rotation mobility', category: 'mobility', why: 'More upper-back turn means less need to throw the shoulders over the top.' },
    { name: 'Med-ball scoop toss', category: 'strength', why: 'Ingrains the lower-body-first sequence that fixes the over-the-top move.' },
  ],
  under_coil: [
    { name: 'Thoracic spine rotation (open book)', category: 'mobility', why: 'Frees the upper-back turn that a short, under-coiled backswing is missing.' },
    { name: 'Seated shoulder-turn stretch', category: 'mobility', why: 'Adds coil range so you can make a fuller, wider backswing.' },
  ],
  casting: [
    { name: 'Wrist-hinge / lag hold drill', category: 'drill', why: 'Retains the angle you\'re casting away too early in the downswing.' },
    { name: 'Forearm + grip strength', category: 'strength', why: 'Holds lag under load so the club releases at the ball, not before it.' },
  ],
  chicken_wing: [
    { name: 'Lead-arm extension drill (towel)', category: 'drill', why: 'Trains the lead arm to extend through impact instead of bending/breaking down.' },
    { name: 'Rotator-cuff + tricep strength', category: 'strength', why: 'Supports a fuller extension so the lead elbow stays long past the ball.' },
  ],
  head_movement: [
    { name: 'Head-still gate drill', category: 'drill', why: 'Feedback for keeping your head centered so the low point stays consistent.' },
    { name: 'Deadbug core stability', category: 'stability', why: 'A stable core keeps the head quiet through the turn and strike.' },
  ],
  plane_too_steep: [
    { name: 'Half-swing plane-board reps', category: 'drill', why: 'Shallows a steep angle by feeling the club on a flatter delivery path.' },
    { name: 'Thoracic rotation mobility', category: 'mobility', why: 'Better turn lets you shallow the club instead of chopping down steeply.' },
  ],
  plane_too_flat: [
    { name: 'Half-swing plane-board reps', category: 'drill', why: 'Steepens an over-flat plane toward a more neutral delivery.' },
    { name: 'Posture + hinge patterning', category: 'drill', why: 'Sets the address angles that support a more upright, on-plane swing.' },
  ],
  quick_tempo: [
    { name: 'Metronome tempo reps (3:1)', category: 'drill', why: 'Slows a rushed transition toward the tour ~3:1 backswing-to-downswing ratio.' },
    { name: 'Slow-motion rehearsal swings', category: 'drill', why: 'Rebuilds a smooth, unrushed transition you can trust under pressure.' },
  ],
};

// Aliases → canonical key (the analysis emits several names for the same underlying issue).
const ALIASES: Record<string, string> = {
  spine_angle_loss: 'early_extension',
  slow_tempo: 'quick_tempo', // same tempo-drill family (metronome), rationale differs but exercises overlap
};

/** Exercises curated for a swing fault, or [] if we don't have a vetted set (never a fabricated one). */
export function exercisesForFault(faultKey: string | null | undefined): Exercise[] {
  if (!faultKey) return [];
  const key = ALIASES[faultKey] ?? faultKey;
  return FAULT_EXERCISES[key] ?? [];
}

/** True when we have a curated workout set for this fault (drives whether the dashboard card shows). */
export function hasWorkoutsForFault(faultKey: string | null | undefined): boolean {
  return exercisesForFault(faultKey).length > 0;
}
