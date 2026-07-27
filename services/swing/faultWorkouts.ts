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
  /**
   * 2026-07-26 (Tim) — an optional curated instructor video tagged to the exercise. Watching it
   * full-length IN-APP (via /drill-video) awards a one-time +5 through awardVideoWatch. REAL links
   * only — never fabricated; an exercise with no vetted video simply omits this (no fake "Watch").
   * [[pro-video-drill-loop-moat]] [[points-practice-correlation]]
   */
  video?: { url: string; title: string; source?: string };
}

// Canonical fault keys → 2-3 vetted golf exercises each. Aliases (early extension is emitted as
// both 'early_extension' and 'spine_angle_loss'; weight-hang as 'reverse_pivot') are normalized below.
const FAULT_EXERCISES: Record<string, Exercise[]> = {
  early_extension: [
    { name: 'Hip-hinge holds (dowel on spine)', category: 'drill', why: 'Grooves keeping your spine angle so your hips stop thrusting toward the ball.', video: { url: 'https://youtu.be/cJa4lQ5_ZnQ', title: 'Stay In Posture — Early Extension Fix', source: 'Me and My Golf' } },
    { name: 'Glute bridges', category: 'strength', why: 'Stronger glutes let you post up and rotate instead of standing up through impact.' },
    { name: 'Hip airplanes', category: 'stability', why: 'Trains single-leg rotation control — the move that keeps posture into impact.' },
  ],
  sway: [
    { name: 'Single-leg balance (trail leg)', category: 'stability', why: 'Builds the trail-side stability to turn around a centered post instead of sliding.' },
    { name: 'Pallof press (anti-rotation)', category: 'strength', why: 'Teaches your core to resist lateral drift so the backswing coils, not sways.' },
    { name: 'Trail-hip loading drill (gate)', category: 'drill', why: 'Feels the difference between rotating into the trail hip and sliding off the ball.', video: { url: 'https://youtu.be/sg8xbRBw_y4', title: 'The Golf Fix — Tips & Drills to Avoid Swaying', source: 'Golf Channel' } },
  ],
  reverse_pivot: [
    { name: 'Step-through weight-shift drill', category: 'drill', why: 'Trains driving onto the lead side through impact instead of hanging back.', video: { url: 'https://youtu.be/_Z5a76bGBeE', title: 'Weight Shift Drill', source: 'Golf Channel · SwingFix' } },
    { name: 'Lateral lunges', category: 'strength', why: 'Strength in the lateral shift so your weight actually gets forward.' },
    { name: 'Med-ball rotational throw (to lead side)', category: 'strength', why: 'Builds the transfer of weight + speed toward the target.' },
  ],
  over_the_top: [
    { name: 'Hip-lead separation drill (pump)', category: 'drill', why: 'Sequences the hips to start the downswing so the club drops on plane.', video: { url: 'https://youtu.be/SYtoiQBXOFc', title: 'The Golf Fix — Stop Coming Over the Top', source: 'Golf Channel · Michael Breed' } },
    { name: 'Thoracic rotation mobility', category: 'mobility', why: 'More upper-back turn means less need to throw the shoulders over the top.' },
    { name: 'Med-ball scoop toss', category: 'strength', why: 'Ingrains the lower-body-first sequence that fixes the over-the-top move.' },
  ],
  under_coil: [
    { name: 'Thoracic spine rotation (open book)', category: 'mobility', why: 'Frees the upper-back turn that a short, under-coiled backswing is missing.' },
    { name: 'Seated shoulder-turn stretch', category: 'mobility', why: 'Adds coil range so you can make a fuller, wider backswing.' },
  ],
  casting: [
    { name: 'Wrist-hinge / lag hold drill', category: 'drill', why: 'Retains the angle you\'re casting away too early in the downswing.', video: { url: 'https://youtu.be/ID71I0_JcyY', title: 'School of Golf — 3 Drills to Create Lag', source: 'Golf Channel · Martin Hall' } },
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
    { name: 'Metronome tempo reps (3:1)', category: 'drill', why: 'Slows a rushed transition toward the tour ~3:1 backswing-to-downswing ratio.', video: { url: 'https://youtu.be/5RZ4VqyQTWA', title: 'Stop Rushing Your Golf Swing (Tempo Drill)', source: 'Danny Maude' } },
    { name: 'Slow-motion rehearsal swings', category: 'drill', why: 'Rebuilds a smooth, unrushed transition you can trust under pressure.' },
  ],
  // 2026-07-26 (deep audit S3) — CONTACT faults (thin/topped/heavy/fat) are the single most common
  // recorded tendency, but had no exercise set, so the Train-Your-Swing card silently never showed for
  // those players. These are honest low-point-control drills — the real fix for strike location.
  low_point_control: [
    { name: 'Towel-behind-the-ball drill', category: 'drill', why: 'Lay a towel a few inches behind the ball — forces ball-first contact so the low point moves in FRONT of the ball, curing thin and heavy strikes.' },
    { name: 'Brush-the-grass drill', category: 'drill', why: 'Make swings that just brush the turf at a target line, bottoming out past the ball — grooves a consistent low point instead of digging or topping.' },
    { name: 'Spray-line / divot ladder', category: 'drill', why: 'Mark a line and check where your divot starts — feedback to move the strike point ahead of the ball for crisp, ball-first contact.' },
  ],
};

// Aliases → canonical key (the analysis emits several names for the same underlying issue).
const ALIASES: Record<string, string> = {
  spine_angle_loss: 'early_extension',
  slow_tempo: 'quick_tempo', // same tempo-drill family (metronome), rationale differs but exercises overlap
  // 2026-07-26 — the contact-mishit ids the analysis/classifier emit all map to low-point control.
  thin_contact: 'low_point_control',
  topped_contact: 'low_point_control',
  heavy_contact: 'low_point_control',
  fat_contact: 'low_point_control',
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
