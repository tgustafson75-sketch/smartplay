/**
 * 2026-11-01 — GOLF PRE-ROUND ROUTINE (ported from SmartPump).
 *
 * The golf-specific mobility and activation moves SmartPump prescribes before a swing, ported as
 * data so the pre-round "Loosen Up" step can run them inline. SmartPump is a separate repo with no
 * shared package, so these are a COPY of the movements and their coaching cues, not an import. If
 * SmartPump's movements or cues change, change them here too — each move names its source.
 *
 *   mobility   → lib/golf/swingRx.ts (hipMobility90, thoracicRotation), cues from
 *                lib/golf/golfProgram.ts Foundation · Control (thoracicRotation)
 *   activation → lib/golf/golfProgram.ts Foundation · Control (pallofPress)
 *
 * Pure data. No I/O, no state. Progress lives in the screen.
 */

export type GolfRoutineGroup = 'mobility' | 'activation';

export interface GolfRoutineMove {
  id: string;
  name: string;
  group: GolfRoutineGroup;
  /** Display dose, matching SmartPump's reps/perSide prescription. */
  dose: string;
  /** Coaching cue, copied from SmartPump. */
  cue: string;
  /** SmartPump exercise id this move was ported from. */
  sourceExerciseId: string;
}

export const GOLF_PRE_ROUND_ROUTINE: readonly GolfRoutineMove[] = [
  {
    id: 'thoracic-rotation',
    name: 'Thoracic Rotation',
    group: 'mobility',
    dose: '8 each side',
    cue: 'Rotate from the upper back, not the low back. Exhale into the turn.',
    sourceExerciseId: 'thoracicRotation',
  },
  {
    id: 'hip-mobility-90',
    name: '90/90 Hip Mobility',
    group: 'mobility',
    dose: '8 each side',
    cue: 'Own the range — slow, no bounce.',
    sourceExerciseId: 'hipMobility90',
  },
  {
    id: 'pallof-press',
    name: 'Pallof Press',
    group: 'activation',
    dose: '12 each side',
    cue: 'Slow the press out, slower on the way back.',
    sourceExerciseId: 'pallofPress',
  },
];

/** True when every move in the routine has been checked off. */
export function golfRoutineComplete(done: ReadonlySet<string>): boolean {
  return GOLF_PRE_ROUND_ROUTINE.every((m) => done.has(m.id));
}
