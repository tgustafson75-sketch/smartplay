import type { PlannedExerciseInSession, SetPlan } from './sessionTypes';
import { calcChallengeWeight, roundChallengeWarmup } from './loadMath';

/**
 * Golf Performance block — a periodized 12-week program that builds the
 * physical qualities behind a faster, more repeatable golf swing, then
 * exports a coaching summary SmartPlay Caddie can ingest (see
 * lib/golf/caddieExport.ts).
 *
 * Structure: 3 phases × 3 session types.
 *   Foundation (wk 1-3)  — movement quality, base strength, anti-rotation.
 *   Strength   (wk 4-8)  — max strength + hip power.
 *   Power      (wk 9-12) — rotational speed, jumps, contrast, in-season taper.
 * Each phase carries a Power, a Strength, and a Stability/Mobility session.
 *
 * A session maps 1:1 onto a real Train session via buildGolfSession() →
 * useSessionStore.startSession(), exactly like an Iron Challenge. Loads
 * scale to bodyweight through the same helpers the challenges use; the
 * qualitative movements (throws, jumps, mobility) resolve to weight 0 and
 * render reps-only.
 */

/** The six trainable qualities the block develops. Keys are stable —
 *  the export JSON and the Golf tab both reference them. */
export type PerformanceQuality =
  | 'rotationalPower'
  | 'groundForce'
  | 'hipStrength'
  | 'coreStability'
  | 'thoracicMobility'
  | 'deceleration';

export interface QualityMeta {
  label: string;
  /** One-liner: why this quality matters for the golf swing. */
  blurb: string;
}

/** Display metadata + ordering for the six qualities. */
export const QUALITY_META: Record<PerformanceQuality, QualityMeta> = {
  rotationalPower: {
    label: 'Rotational Power',
    blurb: 'Speed through the ball — the hips-to-core-to-arms sequence that makes clubhead speed.',
  },
  groundForce: {
    label: 'Ground Force',
    blurb: 'Lower-body power. Vertical and horizontal force off the ground feeds every mph of swing speed.',
  },
  hipStrength: {
    label: 'Hip Strength',
    blurb: 'Posterior chain and hip drive — the engine of the downswing and a durable lower back.',
  },
  coreStability: {
    label: 'Core Stability',
    blurb: 'Anti-rotation and anti-extension trunk control. A braced core transfers power instead of leaking it.',
  },
  thoracicMobility: {
    label: 'Mobility (T-spine & Hips)',
    blurb: 'Turn without compensation. A bigger, cleaner shoulder and hip turn widens the arc.',
  },
  deceleration: {
    label: 'Deceleration',
    blurb: 'The ability to brake rotation — protects the joints and lets you swing faster without losing control.',
  },
};

export const QUALITY_ORDER: PerformanceQuality[] = [
  'rotationalPower',
  'groundForce',
  'hipStrength',
  'coreStability',
  'thoracicMobility',
  'deceleration',
];

/** Every movement the block uses → the primary quality it develops.
 *  Used by performanceProfile.ts to attribute logged work to a quality. */
export const QUALITY_BY_MOVEMENT: Record<string, PerformanceQuality> = {
  // rotational power
  medBallRotThrow: 'rotationalPower',
  medBallSlam: 'rotationalPower',
  landmineRotation: 'rotationalPower',
  cableRotation: 'rotationalPower',
  // ground force
  trapBarDeadlift: 'groundForce',
  gobletSquat: 'groundForce',
  bulgarianSplitSquat: 'groundForce',
  boxJump: 'groundForce',
  // hip strength
  rdl: 'hipStrength',
  dbRdl: 'hipStrength',
  hipThrust: 'hipStrength',
  // core stability
  pallofPress: 'coreStability',
  deadBug: 'coreStability',
  situp: 'coreStability',
  farmerCarry: 'coreStability',
  // mobility
  thoracicRotation: 'thoracicMobility',
  hipMobility90: 'thoracicMobility',
  // deceleration
  singleLegRdl: 'deceleration',
};

export type GolfPhaseId = 'foundation' | 'strength' | 'power';
export type GolfSessionType = 'POWER' | 'STRENGTH' | 'STABILITY';

export interface GolfExerciseSpec {
  exerciseId: string;
  /** Which quality this movement trains (drives the performance panel). */
  quality: PerformanceQuality;
  /** Working sets after warm-ups. */
  workingSets: number;
  /** Reps (or throws/steps/jumps — see `unit`) per working set. 0 = AMRAP. */
  reps: number;
  /** Multiplier vs the bodyweight-derived working weight. 0-mult movements
   *  ignore this (they resolve to weight 0 regardless). */
  intensity: number;
  /** Optional pyramid warm-up ratios (% of working weight). */
  warmups?: number[];
  /** Reps counted per side (display shows "/side"). */
  perSide?: boolean;
  /** Rep unit for display when it isn't "reps" (e.g. 'throws', 'steps', 'jumps'). */
  unit?: string;
  /** Coaching cue rendered under the exercise. */
  note?: string;
}

export interface GolfSession {
  id: string;
  phaseId: GolfPhaseId;
  type: GolfSessionType;
  name: string;
  blurb: string;
  exercises: GolfExerciseSpec[];
}

export interface GolfPhase {
  id: GolfPhaseId;
  name: string;
  weeks: string;
  focus: string;
  sessions: GolfSession[];
}

export interface GolfProgram {
  id: string;
  name: string;
  weeks: number;
  blurb: string;
  phases: GolfPhase[];
}

export const GOLF_BLOCK: GolfProgram = {
  id: 'long-game-12wk',
  name: 'Long Game',
  weeks: 12,
  blurb:
    'A 12-week athletic base for golf: build the strength, then convert it to rotational speed. Loads scale to your bodyweight.',
  phases: [
    {
      id: 'foundation',
      name: 'Foundation',
      weeks: 'Weeks 1–3',
      focus: 'Movement quality, base strength, and a trunk that holds its brace.',
      sessions: [
        {
          id: 'foundation-power',
          phaseId: 'foundation',
          type: 'POWER',
          name: 'Foundation · Spring',
          blurb: 'Teach the body to produce and absorb force before you chase speed.',
          exercises: [
            {
              exerciseId: 'hipMobility90',
              quality: 'thoracicMobility',
              workingSets: 3,
              reps: 8,
              intensity: 0,
              perSide: true,
              note: 'Own the range — slow, no bounce. This is the turn you want on the course.',
            },
            {
              exerciseId: 'medBallRotThrow',
              quality: 'rotationalPower',
              workingSets: 3,
              reps: 6,
              intensity: 0,
              perSide: true,
              unit: 'throws',
              note: 'Sequence hips → core → arms. Explode, reset, repeat. Intent over reps.',
            },
            {
              exerciseId: 'boxJump',
              quality: 'groundForce',
              workingSets: 4,
              reps: 5,
              intensity: 0,
              unit: 'jumps',
              note: 'Soft, quiet landings. Absorb the ground — do not crash into it.',
            },
            {
              exerciseId: 'pallofPress',
              quality: 'coreStability',
              workingSets: 3,
              reps: 10,
              intensity: 0,
              perSide: true,
              note: 'Resist the rotation. Ribs down, glutes on.',
            },
          ],
        },
        {
          id: 'foundation-strength',
          phaseId: 'foundation',
          type: 'STRENGTH',
          name: 'Foundation · Base',
          blurb: 'Grease the big patterns at a load you can own with clean form.',
          exercises: [
            {
              exerciseId: 'gobletSquat',
              quality: 'groundForce',
              workingSets: 3,
              reps: 10,
              intensity: 1.0,
              warmups: [0.6],
              note: 'Upright torso, knees track over toes. Depth you control.',
            },
            {
              exerciseId: 'dbRdl',
              quality: 'hipStrength',
              workingSets: 3,
              reps: 10,
              intensity: 1.0,
              warmups: [0.6],
              note: 'Hinge, don’t squat. Feel the hamstrings load — that’s the downswing.',
            },
            {
              exerciseId: 'farmerCarry',
              quality: 'coreStability',
              workingSets: 3,
              reps: 20,
              intensity: 1.0,
              unit: 'steps',
              note: 'Tall and stacked. Don’t let the load tip you — anti-lean core work.',
            },
            {
              exerciseId: 'deadBug',
              quality: 'coreStability',
              workingSets: 3,
              reps: 8,
              intensity: 0,
              perSide: true,
              note: 'Low back glued to the floor the whole time.',
            },
          ],
        },
        {
          id: 'foundation-stability',
          phaseId: 'foundation',
          type: 'STABILITY',
          name: 'Foundation · Control',
          blurb: 'Mobility plus single-leg control — the quiet work that unlocks the loud work.',
          exercises: [
            {
              exerciseId: 'thoracicRotation',
              quality: 'thoracicMobility',
              workingSets: 3,
              reps: 8,
              intensity: 0,
              perSide: true,
              note: 'Rotate from the upper back, not the low back. Exhale into the turn.',
            },
            {
              exerciseId: 'pallofPress',
              quality: 'coreStability',
              workingSets: 3,
              reps: 12,
              intensity: 0,
              perSide: true,
              note: 'Slow the press out, slower on the way back.',
            },
            {
              exerciseId: 'singleLegRdl',
              quality: 'deceleration',
              workingSets: 3,
              reps: 8,
              intensity: 1.0,
              perSide: true,
              note: 'Balance is the point. Control the lower — that’s deceleration training.',
            },
            {
              exerciseId: 'situp',
              quality: 'coreStability',
              workingSets: 3,
              reps: 15,
              intensity: 1.0,
              note: 'Controlled up and down. No yanking the neck.',
            },
          ],
        },
      ],
    },
    {
      id: 'strength',
      name: 'Strength',
      weeks: 'Weeks 4–8',
      focus: 'Max strength and hip power — the reservoir you’ll convert to speed.',
      sessions: [
        {
          id: 'strength-power',
          phaseId: 'strength',
          type: 'POWER',
          name: 'Strength · Drive',
          blurb: 'Heavy pulls paired with jumps and slams — strength that stays fast.',
          exercises: [
            {
              exerciseId: 'boxJump',
              quality: 'groundForce',
              workingSets: 5,
              reps: 4,
              intensity: 0,
              unit: 'jumps',
              note: 'Full recovery between sets. Every jump maximal.',
            },
            {
              exerciseId: 'trapBarDeadlift',
              quality: 'groundForce',
              workingSets: 4,
              reps: 5,
              intensity: 1.0,
              warmups: [0.5, 0.7, 0.85],
              note: 'Push the floor away. Fast off the ground, controlled down.',
            },
            {
              exerciseId: 'medBallSlam',
              quality: 'rotationalPower',
              workingSets: 3,
              reps: 8,
              intensity: 0,
              unit: 'slams',
              note: 'Whole body. Finish through the floor.',
            },
            {
              exerciseId: 'pallofPress',
              quality: 'coreStability',
              workingSets: 3,
              reps: 10,
              intensity: 0,
              perSide: true,
              note: 'Brace hard against the pull.',
            },
          ],
        },
        {
          id: 'strength-strength',
          phaseId: 'strength',
          type: 'STRENGTH',
          name: 'Strength · Load',
          blurb: 'The heaviest day of the block. Hips, hinge, and single-leg strength.',
          exercises: [
            {
              exerciseId: 'rdl',
              quality: 'hipStrength',
              workingSets: 4,
              reps: 6,
              intensity: 1.0,
              warmups: [0.6, 0.8],
              note: 'Load the hamstrings. Bar stays close, back stays flat.',
            },
            {
              exerciseId: 'bulgarianSplitSquat',
              quality: 'groundForce',
              workingSets: 3,
              reps: 8,
              intensity: 1.0,
              perSide: true,
              note: 'Front leg does the work. Fights the sway you get at impact.',
            },
            {
              exerciseId: 'hipThrust',
              quality: 'hipStrength',
              workingSets: 3,
              reps: 10,
              intensity: 1.0,
              warmups: [0.6],
              note: 'Full lockout, ribs down. Squeeze at the top.',
            },
            {
              exerciseId: 'farmerCarry',
              quality: 'coreStability',
              workingSets: 3,
              reps: 20,
              intensity: 1.1,
              unit: 'steps',
              note: 'Heavier than Foundation. Stay stacked under load.',
            },
          ],
        },
        {
          id: 'strength-stability',
          phaseId: 'strength',
          type: 'STABILITY',
          name: 'Strength · Anti-Rotation',
          blurb: 'Build the brake and the resist — rotational strength before rotational speed.',
          exercises: [
            {
              exerciseId: 'landmineRotation',
              quality: 'rotationalPower',
              workingSets: 4,
              reps: 8,
              intensity: 1.0,
              perSide: true,
              note: 'Drive from the hips, arms just carry the bar. Controlled, not sloppy.',
            },
            {
              exerciseId: 'pallofPress',
              quality: 'coreStability',
              workingSets: 4,
              reps: 10,
              intensity: 0,
              perSide: true,
              note: 'Longer holds at full extension.',
            },
            {
              exerciseId: 'singleLegRdl',
              quality: 'deceleration',
              workingSets: 3,
              reps: 8,
              intensity: 1.1,
              perSide: true,
              note: 'Add load. The eccentric is the point — brake the descent.',
            },
            {
              exerciseId: 'deadBug',
              quality: 'coreStability',
              workingSets: 3,
              reps: 10,
              intensity: 0,
              perSide: true,
              note: 'Slow and deliberate. Anti-extension under fatigue.',
            },
          ],
        },
      ],
    },
    {
      id: 'power',
      name: 'Power',
      weeks: 'Weeks 9–12',
      focus: 'Convert strength to speed, then taper to stay fresh for the course.',
      sessions: [
        {
          id: 'power-speed',
          phaseId: 'power',
          type: 'POWER',
          name: 'Power · Speed',
          blurb: 'Maximal-intent rotation. Every rep is a golf swing at full send.',
          exercises: [
            {
              exerciseId: 'medBallRotThrow',
              quality: 'rotationalPower',
              workingSets: 5,
              reps: 5,
              intensity: 0,
              perSide: true,
              unit: 'throws',
              note: 'Max intent every throw. Long rest — this is a speed day, not a burn.',
            },
            {
              exerciseId: 'boxJump',
              quality: 'groundForce',
              workingSets: 5,
              reps: 3,
              intensity: 0,
              unit: 'jumps',
              note: 'Explosive. Reset fully between reps.',
            },
            {
              exerciseId: 'landmineRotation',
              quality: 'rotationalPower',
              workingSets: 4,
              reps: 6,
              intensity: 1.05,
              perSide: true,
              note: 'Fast through the middle. Speed, not grind.',
            },
            {
              exerciseId: 'cableRotation',
              quality: 'rotationalPower',
              workingSets: 3,
              reps: 10,
              intensity: 0,
              perSide: true,
              note: 'Pivot the back foot, let the hips lead. Mirror the swing.',
            },
          ],
        },
        {
          id: 'power-contrast',
          phaseId: 'power',
          type: 'STRENGTH',
          name: 'Power · Contrast',
          blurb: 'Heavy then explosive, back to back — the classic speed-conversion method.',
          exercises: [
            {
              exerciseId: 'trapBarDeadlift',
              quality: 'groundForce',
              workingSets: 4,
              reps: 3,
              intensity: 1.05,
              warmups: [0.5, 0.7, 0.85],
              note: 'Heavy triple, then straight into the jumps below. That’s the contrast.',
            },
            {
              exerciseId: 'boxJump',
              quality: 'groundForce',
              workingSets: 4,
              reps: 3,
              intensity: 0,
              unit: 'jumps',
              note: 'Paired with the pull above — heavy primes the fast. Rest, then repeat the pair.',
            },
            {
              exerciseId: 'hipThrust',
              quality: 'hipStrength',
              workingSets: 3,
              reps: 6,
              intensity: 1.0,
              note: 'Snap to lockout. Fast concentric.',
            },
            {
              exerciseId: 'medBallSlam',
              quality: 'rotationalPower',
              workingSets: 3,
              reps: 6,
              intensity: 0,
              unit: 'slams',
              note: 'Finish the day with full-body power.',
            },
          ],
        },
        {
          id: 'power-inseason',
          phaseId: 'power',
          type: 'STABILITY',
          name: 'Power · In-Season',
          blurb: 'Maintenance dose. Keep the speed sharp without leaving your game in the gym.',
          exercises: [
            {
              exerciseId: 'hipMobility90',
              quality: 'thoracicMobility',
              workingSets: 2,
              reps: 8,
              intensity: 0,
              perSide: true,
              note: 'Prime the turn. Great the morning of a round.',
            },
            {
              exerciseId: 'medBallRotThrow',
              quality: 'rotationalPower',
              workingSets: 3,
              reps: 5,
              intensity: 0,
              perSide: true,
              unit: 'throws',
              note: 'Crisp, not exhausting. Touch the speed and leave.',
            },
            {
              exerciseId: 'pallofPress',
              quality: 'coreStability',
              workingSets: 2,
              reps: 10,
              intensity: 0,
              perSide: true,
              note: 'Keep the brace honest.',
            },
            {
              exerciseId: 'singleLegRdl',
              quality: 'deceleration',
              workingSets: 2,
              reps: 8,
              intensity: 1.0,
              perSide: true,
              note: 'Light. Balance and control, no fatigue.',
            },
          ],
        },
      ],
    },
  ],
};

/** Flat list of every session in the block, in program order. */
export const ALL_GOLF_SESSIONS: GolfSession[] = GOLF_BLOCK.phases.flatMap(
  (p) => p.sessions,
);

export function getGolfSession(id: string): GolfSession | undefined {
  return ALL_GOLF_SESSIONS.find((s) => s.id === id);
}

/**
 * Resolve a golf session into the SetPlan-shaped array that
 * useSessionStore.startSession() expects. Mirrors buildChallengeSession
 * (lib/challenges/ironChallenges.ts) and shares its weight helpers, so a
 * golf session runs through the Train pillar identically to a challenge.
 */
export function buildGolfSession(
  session: GolfSession,
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
      sets.push({
        weight: workingWeight,
        reps: spec.reps,
        isWorking: true,
      });
    }

    return { exerciseId: spec.exerciseId, sets };
  });
}

