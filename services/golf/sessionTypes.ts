/**
 * 2026-11-01 — Session shapes the golf logic builds and reads, COPIED from SmartPump
 * (lib/state/session.ts SetPlan/PlannedExerciseInSession, lib/paths/types.ts StrengthSpec/StrengthSession).
 * SmartPlay has no session store of its own for this; the golf workout screen keeps its own log.
 */

export interface SetPlan {
  weight: number;
  reps: number;
  /** True for warm-up sets — UI renders these in a muted register. */
  isWarmup?: boolean;
  /** True for the working sets. */
  isWorking?: boolean;
}

export interface PlannedExerciseInSession {
  exerciseId: string;
  sets: SetPlan[];
}

export interface StrengthSpec {
  exerciseId: string;
  /** Quality key (must exist in the block's qualities). */
  quality: string;
  workingSets: number;
  /** Reps (or the `unit` count) per working set. 0 = AMRAP. */
  reps: number;
  intensity: number;
  warmups?: number[];
  perSide?: boolean;
  /** Rep unit when not "reps": 'throws' | 'steps' | 'jumps' | 'sec' | 'slams'. */
  unit?: string;
  note?: string;
}

export interface StrengthSession {
  kind: 'strength';
  id: string;
  phaseId: string;
  /** Short type tag shown on the card, e.g. 'POWER' | 'STRENGTH' | 'STABILITY'. */
  type: string;
  name: string;
  blurb: string;
  exercises: StrengthSpec[];
}

/**
 * A logged working set, as the Rx progress reads it. The golf workout store writes these; SmartPump
 * read them from its event log.
 */
export interface LoggedSetEvent {
  type: 'set.complete';
  /** ISO timestamp the set was logged. */
  timestamp: string;
  payload: {
    exerciseId: string;
    weight?: number;
    reps?: number;
  };
}
