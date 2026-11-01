/**
 * 2026-11-01 — Exercise library + equipment/body-group types, COPIED from SmartPump
 * lib/substrate/decision/coldStart.ts (lines 37–197). SmartPlay and SmartPump are separate repos
 * with no shared package, so this copy is maintained by hand: change it in both when a golf
 * movement changes. Only the Golf Performance movements are used here, but the whole table is
 * copied so Rx parsing can resolve any Caddie-named exercise the same way SmartPump does.
 */
export const EQUIPMENT_KEYS = [
  'barbell',
  'rack',
  'bench',
  'dumbbells',
  'pullupBar',
  'dipStation',
  'cable',
  'legCurlMachine',
  // Selectorized / plate-loaded strength machines OTHER than the leg curl
  // (which predates this key and keeps its own): leg press, leg extension,
  // chest press, seated calf. Added 2026-10-10 with the bodybuilding
  // staples — tagging a leg press as 'cable' or 'barbell' would make the
  // hotel scanner claim it's available whenever it saw a cable stack.
  'machine',
  'kettlebell',
  'bodyweight',
] as const;

export type Equipment = (typeof EQUIPMENT_KEYS)[number];

/**
 * Exercise library — body group + display label per exercise ID.
 * Source of truth for the build-week picker. Adding an exercise here
 * makes it pickable in onboarding; bootstrap defaults still control
 * which ones get pre-selected.
 */
export const EXERCISE_LIBRARY: Record<
  string,
  { label: string; group: BodyGroup; equipment: Equipment[] }
> = {
  bench: { label: 'Bench Press', group: 'CHEST', equipment: ['barbell', 'bench'] },
  inclineBench: { label: 'Incline Bench', group: 'CHEST', equipment: ['barbell', 'bench'] },
  ohp: { label: 'Overhead Press', group: 'SHOULDERS', equipment: ['barbell'] },
  row: { label: 'Barbell Row', group: 'BACK', equipment: ['barbell'] },
  pullup: { label: 'Pull-up', group: 'BACK', equipment: ['pullupBar'] },
  deadlift: { label: 'Deadlift', group: 'BACK', equipment: ['barbell'] },
  curl: { label: 'Bicep Curl', group: 'ARMS', equipment: ['dumbbells'] },
  tricep: { label: 'Tricep Extension', group: 'ARMS', equipment: ['dumbbells'] },
  dip: { label: 'Dip', group: 'ARMS', equipment: ['dipStation'] },
  squat: { label: 'Back Squat', group: 'LEGS', equipment: ['barbell', 'rack'] },
  frontSquat: { label: 'Front Squat', group: 'LEGS', equipment: ['barbell', 'rack'] },
  rdl: { label: 'Romanian Deadlift', group: 'LEGS', equipment: ['barbell'] },
  hipThrust: { label: 'Hip Thrust', group: 'LEGS', equipment: ['barbell', 'bench'] },
  legCurl: { label: 'Leg Curl', group: 'LEGS', equipment: ['legCurlMachine'] },
  calf: { label: 'Calf Raise', group: 'CALVES', equipment: ['dumbbells'] },

  // Dumbbell-only variants — picked by the hotel planner when the gym
  // has dumbbells but no barbell. Loads are per-hand (matches the
  // existing curl/tricep multipliers).
  dbBench: { label: 'DB Bench Press', group: 'CHEST', equipment: ['dumbbells', 'bench'] },
  dbOhp: { label: 'DB Shoulder Press', group: 'SHOULDERS', equipment: ['dumbbells'] },
  dbRow: { label: 'One-Arm DB Row', group: 'BACK', equipment: ['dumbbells'] },
  // ['dumbbells'] only. Equipment lists mean ALL of these (see canDoWith in
  // lib/gym/buildHotelWorkout.ts), so listing the kettlebell as an
  // alternative made a goblet squat require BOTH — and since the scanner
  // couldn't report a kettlebell, it was never available from any scan.
  gobletSquat: { label: 'Goblet Squat', group: 'LEGS', equipment: ['dumbbells'] },
  dbRdl: { label: 'DB Romanian Deadlift', group: 'LEGS', equipment: ['dumbbells'] },

  // Bodyweight movements — usable on travel days, in a stripped-down
  // hotel gym, or as fillers when the scan finds nothing for a body
  // group. Multiplier=0 → workingWeight=0 → the UI shows reps only.
  pushup: { label: 'Push-up', group: 'CHEST', equipment: ['bodyweight'] },
  pikePushup: { label: 'Pike Push-up', group: 'SHOULDERS', equipment: ['bodyweight'] },
  bwRow: { label: 'Towel/Bag Row', group: 'BACK', equipment: ['bodyweight'] },
  bwTricep: { label: 'Chair Dip', group: 'ARMS', equipment: ['bodyweight'] },
  situp: { label: 'Sit-up', group: 'CORE', equipment: ['bodyweight'] },
  crunch: { label: 'Crunch', group: 'CORE', equipment: ['bodyweight'] },
  plank: { label: 'Plank', group: 'CORE', equipment: ['bodyweight'] },
  bwSquat: { label: 'Bodyweight Squat', group: 'LEGS', equipment: ['bodyweight'] },
  lunge: { label: 'Lunge', group: 'LEGS', equipment: ['bodyweight'] },
  gluteBridge: { label: 'Glute Bridge', group: 'LEGS', equipment: ['bodyweight'] },
  burpee: { label: 'Burpee', group: 'LEGS', equipment: ['bodyweight'] },
  slidingLegCurl: { label: 'Sliding Leg Curl', group: 'LEGS', equipment: ['bodyweight'] },

  // Bodybuilding staples — added 2026-10-10 so an equipment swap has
  // somewhere to go (lib/train/variants.ts) and a physique split can be
  // built at all. Dumbbell loads are per hand, cable/machine loads are the
  // number on the stack, same conventions as above.
  inclineDbPress: { label: 'Incline DB Press', group: 'CHEST', equipment: ['dumbbells', 'bench'] },
  machineChestPress: { label: 'Machine Chest Press', group: 'CHEST', equipment: ['machine'] },
  cableFly: { label: 'Cable Fly', group: 'CHEST', equipment: ['cable'] },
  dbFly: { label: 'DB Fly', group: 'CHEST', equipment: ['dumbbells', 'bench'] },
  lateralRaise: { label: 'Lateral Raise', group: 'SHOULDERS', equipment: ['dumbbells'] },
  rearDeltFly: { label: 'Rear-Delt Fly', group: 'SHOULDERS', equipment: ['dumbbells'] },
  shrug: { label: 'DB Shrug', group: 'SHOULDERS', equipment: ['dumbbells'] },
  latPulldown: { label: 'Lat Pulldown', group: 'BACK', equipment: ['cable'] },
  seatedCableRow: { label: 'Seated Cable Row', group: 'BACK', equipment: ['cable'] },
  barbellCurl: { label: 'Barbell Curl', group: 'ARMS', equipment: ['barbell'] },
  cableCurl: { label: 'Cable Curl', group: 'ARMS', equipment: ['cable'] },
  hammerCurl: { label: 'Hammer Curl', group: 'ARMS', equipment: ['dumbbells'] },
  cablePushdown: { label: 'Cable Pushdown', group: 'ARMS', equipment: ['cable'] },
  legPress: { label: 'Leg Press', group: 'LEGS', equipment: ['machine'] },
  legExtension: { label: 'Leg Extension', group: 'LEGS', equipment: ['machine'] },
  seatedCalf: { label: 'Seated Calf Raise', group: 'CALVES', equipment: ['machine'] },

  // Golf-performance movements — used only by the Golf Performance path
  // (lib/golf). Mapped onto existing BodyGroups so no picker/type churn.
  // Qualitative movements (throws, jumps, mobility) use multiplier 0 →
  // workingWeight 0 → the UI renders them reps-only, same as bodyweight.
  trapBarDeadlift: { label: 'Trap-Bar Deadlift', group: 'LEGS', equipment: ['barbell'] },
  bulgarianSplitSquat: { label: 'Bulgarian Split Squat', group: 'LEGS', equipment: ['dumbbells'] },
  singleLegRdl: { label: 'Single-Leg RDL', group: 'LEGS', equipment: ['dumbbells'] },
  farmerCarry: { label: 'Farmer Carry', group: 'BACK', equipment: ['dumbbells'] },
  landmineRotation: { label: 'Landmine Rotation', group: 'CORE', equipment: ['barbell'] },
  medBallRotThrow: { label: 'Rotational Med-Ball Throw', group: 'CORE', equipment: ['bodyweight'] },
  medBallSlam: { label: 'Med-Ball Slam', group: 'CORE', equipment: ['bodyweight'] },
  cableRotation: { label: 'Cable Rotation', group: 'CORE', equipment: ['cable'] },
  kbRotation: { label: 'Kettlebell Rotation', group: 'CORE', equipment: ['kettlebell'] },
  kbSwing: { label: 'Kettlebell Swing', group: 'LEGS', equipment: ['kettlebell'] },
  kbHalo: { label: 'Kettlebell Halo', group: 'SHOULDERS', equipment: ['kettlebell'] },
  pallofPress: { label: 'Pallof Press', group: 'CORE', equipment: ['cable'] },
  boxJump: { label: 'Box Jump', group: 'LEGS', equipment: ['bodyweight'] },
  deadBug: { label: 'Dead Bug', group: 'CORE', equipment: ['bodyweight'] },
  thoracicRotation: { label: 'Thoracic Rotation', group: 'BACK', equipment: ['bodyweight'] },
  hipMobility90: { label: '90/90 Hip Mobility', group: 'LEGS', equipment: ['bodyweight'] },
};

export type BodyGroup =
  | 'CHEST'
  | 'SHOULDERS'
  | 'BACK'
  | 'ARMS'
  | 'CORE'
  | 'LEGS'
  | 'CALVES';

