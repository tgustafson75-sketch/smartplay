/**
 * 2026-11-01 — Strength session builder, COPIED from SmartPump lib/paths/build.ts
 * (buildStrengthSession, describeStrengthSpec). Cardio helpers are not ported: golf is strength only.
 */
import type { PlannedExerciseInSession, SetPlan, StrengthSession, StrengthSpec } from './sessionTypes';
import { EXERCISE_LIBRARY } from './exerciseLibrary';
import { calcChallengeWeight, roundChallengeWarmup } from './loadMath';


/**
 * Resolve a strength session into the SetPlan array that
 * useSessionStore.startSession() expects. Generalized from
 * buildGolfSession — shares the challenge weight helpers so every strength
 * path runs through the Train pillar identically to an Iron Challenge.
 */
export function buildStrengthSession(
  session: StrengthSession,
  bodyweight: number | undefined,
): PlannedExerciseInSession[] {
  return session.exercises.map((spec) => {
    const workingWeight = calcChallengeWeight(
      spec.exerciseId,
      bodyweight,
      spec.intensity,
    );
    const sets: SetPlan[] = [];

    if (spec.warmups && workingWeight > 0) {
      for (const ratio of spec.warmups) {
        sets.push({
          weight: roundChallengeWarmup(spec.exerciseId, workingWeight * ratio),
          reps: Math.min(spec.reps + 4, 12),
          isWarmup: true,
        });
      }
    }

    for (let i = 0; i < spec.workingSets; i++) {
      sets.push({ weight: workingWeight, reps: spec.reps, isWorking: true });
    }

    return { exerciseId: spec.exerciseId, sets };
  });
}

/** Label + set/rep summary for a strength spec (path screen preview). */
export function describeStrengthSpec(spec: StrengthSpec): {
  label: string;
  summary: string;
} {
  const meta = EXERCISE_LIBRARY[spec.exerciseId];
  const label = (meta?.label ?? spec.exerciseId).toUpperCase();
  const unit = spec.unit ?? 'reps';
  const count = spec.reps === 0 ? 'AMRAP' : `${spec.reps}`;
  const perSide = spec.perSide ? '/side' : '';
  const summary =
    unit === 'reps'
      ? `${spec.workingSets} × ${count}${perSide}`
      : `${spec.workingSets} × ${count} ${unit}${perSide}`;
  return { label, summary };
}
