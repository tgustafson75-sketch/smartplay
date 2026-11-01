/**
 * 2026-11-01 — Load math, COPIED from SmartPump lib/substrate/decision/coldStart.ts
 * (STARTING_WEIGHT_MULTIPLIERS, DEFAULT_BODYWEIGHT, bar/plate rounding, calcChallengeWeight,
 * roundChallengeWarmup). Same numbers as SmartPump so a golf load reads the same in both apps.
 */
export const STARTING_WEIGHT_MULTIPLIERS: Record<string, number> = {
  bench: 0.7,
  squat: 0.9,
  deadlift: 1.0,
  ohp: 0.4,
  row: 0.6,
  frontSquat: 0.7,
  rdl: 0.85,
  hipThrust: 1.0,
  inclineBench: 0.55,
  pullup: 0,
  dip: 0,
  curl: 0.15,
  tricep: 0.2,
  legCurl: 0.25,
  calf: 0.5,
  dbBench: 0.35,
  dbOhp: 0.2,
  dbRow: 0.3,
  gobletSquat: 0.4,
  dbRdl: 0.3,
  pushup: 0,
  pikePushup: 0,
  bwRow: 0,
  bwTricep: 0,
  situp: 0,
  crunch: 0,
  plank: 0,
  bwSquat: 0,
  lunge: 0,
  gluteBridge: 0,
  burpee: 0,
  slidingLegCurl: 0,
  // Bodybuilding staples. Same bodyweight-relative convention as the rest
  // of the table, set conservatively for a first session — the decision
  // engine moves them from real logged sets after that.
  inclineDbPress: 0.3,
  machineChestPress: 0.6,
  cableFly: 0.12,
  dbFly: 0.1,
  lateralRaise: 0.08,
  rearDeltFly: 0.06,
  shrug: 0.3,
  latPulldown: 0.55,
  seatedCableRow: 0.5,
  barbellCurl: 0.35,
  cableCurl: 0.25,
  hammerCurl: 0.15,
  cablePushdown: 0.25,
  legPress: 1.5,
  legExtension: 0.4,
  seatedCalf: 0.5,
  // Golf-performance movements. Load-based ones scale to bodyweight;
  // qualitative ones (throws/jumps/mobility) are 0 → reps-only.
  trapBarDeadlift: 1.0,
  bulgarianSplitSquat: 0.3,
  singleLegRdl: 0.25,
  farmerCarry: 0.5,
  landmineRotation: 0.2,
  medBallRotThrow: 0,
  medBallSlam: 0,
  cableRotation: 0,
  kbRotation: 0.12,
  kbSwing: 0.25,
  kbHalo: 0.08,
  pallofPress: 0,
  boxJump: 0,
  deadBug: 0,
  thoracicRotation: 0,
  hipMobility90: 0,
};

const DEFAULT_BODYWEIGHT = 175;

/** Barbell lifts — round to nearest 10 (bar + plates work in 10-lb
 *  increments cleanly: 95, 115, 135, 155, 185, 205, 225...). */
const BAR_EXERCISES = new Set([
  'squat',
  'bench',
  'deadlift',
  'row',
  'frontSquat',
  'rdl',
  'ohp',
  'inclineBench',
  'hipThrust',
]);

/** The big six — working sets floor at 135 (2 plates) since smaller
 *  weights don't justify the bar setup. Smaller barbell lifts (ohp,
 *  inclineBench, row) start at 95 (1 plate per side). */
const HEAVY_BAR_LIFTS = new Set([
  'squat',
  'bench',
  'deadlift',
  'frontSquat',
  'rdl',
  'hipThrust',
]);

function roundTo5(n: number): number {
  const cleaned = Math.round(n * 1000) / 1000;
  return Math.round(cleaned / 5) * 5;
}

/**
 * Plate-friendly rounding for barbell lifts. Working weights floor at
 * the ceremonial starting load (135 for the big six, 95 for smaller
 * bar lifts). Warm-ups can drop down to the empty bar (45). Non-bar
 * movements round to the nearest 5 since dumbbells / cable stacks
 * come in finer increments.
 */
function roundToBarPlate(
  exerciseId: string,
  weight: number,
  isWorking: boolean,
): number {
  if (!BAR_EXERCISES.has(exerciseId)) {
    return roundTo5(weight);
  }
  const cleaned = Math.round(weight * 1000) / 1000;
  const rounded = Math.round(cleaned / 10) * 10;
  if (!isWorking) {
    return Math.max(rounded, 45);
  }
  const min = HEAVY_BAR_LIFTS.has(exerciseId) ? 135 : 95;
  return Math.max(rounded, min);
}

function calcWeight(exerciseId: string, bodyweight: number, loadModifier: number): number {
  const mult = STARTING_WEIGHT_MULTIPLIERS[exerciseId];
  if (mult === undefined) return 0;
  if (mult === 0) return 0;
  return roundToBarPlate(exerciseId, bodyweight * mult * loadModifier, true);
}

/**
 * Bodyweight-relative working weight for an arbitrary exercise +
 * intensity multiplier. Exposed for the Iron Challenge tab so curated
 * routines (Arnold's chest, Dorian's back) can scale loads to the
 * user's body without re-implementing rounding rules.
 */
export function calcChallengeWeight(
  exerciseId: string,
  bodyweight: number | undefined,
  intensity: number,
): number {
  return calcWeight(exerciseId, bodyweight ?? DEFAULT_BODYWEIGHT, intensity);
}

/** Same plate-friendly rounding used everywhere else — exported so
 *  challenge warm-ups can drop below the working-weight floor. */
export function roundChallengeWarmup(exerciseId: string, weight: number): number {
  return roundToBarPlate(exerciseId, weight, false);
}
