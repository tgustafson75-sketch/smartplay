import type { PlannedExerciseInSession, StrengthSession, StrengthSpec, LoggedSetEvent } from './sessionTypes';
import { buildStrengthSession, describeStrengthSpec } from './strengthBuild';
import { QUALITY_META, type PerformanceQuality } from './golfProgram';

/**
 * Swing Rx — the INBOUND half of the SmartPlay Caddie bridge.
 *
 * lib/golf/caddieExport.ts sends SmartPump's training summary OUT to Caddie.
 * This module receives what comes BACK: Caddie identifies a swing fault, and
 * SmartPump turns that fault into real, runnable, trackable strength work.
 *
 *   Caddie: "your miss is early extension"
 *     → SmartPump: hip thrust / DB RDL / 90-90, 3 sessions a week, tracked
 *       against the same golf qualities the Performance panel already reads.
 *
 * Ownership rule: **SmartPump owns the exercise prescription.** Caddie is the
 * authority on what the swing is doing; it is not the authority on what is in
 * SmartPump's exercise library or how to load it. A payload MAY carry exercise
 * hints (see swingRxParse.ts) and they are reconciled against the library, but
 * the fault alone is enough to build a full block. That keeps the bridge
 * working today, before Caddie ships an exercise-emitting export.
 *
 * Honesty rule (carried from caddieExport.ts): the physical rationale below is
 * a coaching mapping from a visible fault to the physical qualities that
 * commonly underlie it — never a claim that SmartPump measured the swing.
 * Every prescribed movement is attributed to a golf quality that already
 * exists in lib/paths/configs/golf.ts, so logged Rx work flows into the same
 * Performance panel rather than into a parallel score nobody can audit.
 */

/** Caddie's fault vocabulary — the union of two real sources on the SmartPlay
 *  side, both of which can reach an export:
 *   - store/cageStore.ts → PrimaryIssue.primary_fault (the analysis allowlist)
 *   - services/swing/faultWorkouts.ts (the curated fault→exercise table that
 *     backs the dashboard export, which adds under_coil and the tempo faults)
 *  Kept as a superset so the bridge never drops a value Caddie can emit. */
export type SwingFault =
  | 'over_the_top'
  | 'early_extension'
  | 'casting'
  | 'sway'
  | 'reverse_pivot'
  | 'chicken_wing'
  | 'plane_too_flat'
  | 'plane_too_steep'
  | 'head_movement'
  | 'spine_angle_loss'
  | 'under_coil'
  | 'quick_tempo'
  | 'slow_tempo'
  | 'no_dominant_fault'
  | 'inconclusive';

export const SWING_FAULTS: SwingFault[] = [
  'over_the_top',
  'early_extension',
  'casting',
  'sway',
  'reverse_pivot',
  'chicken_wing',
  'plane_too_flat',
  'plane_too_steep',
  'head_movement',
  'spine_angle_loss',
  'under_coil',
  'quick_tempo',
  'slow_tempo',
  'no_dominant_fault',
  'inconclusive',
];

export function isSwingFault(v: unknown): v is SwingFault {
  return typeof v === 'string' && (SWING_FAULTS as string[]).includes(v);
}

/** A prescribed movement: a normal strength spec plus the one-line reason it
 *  was prescribed for THIS fault. */
export interface RxSpec extends StrengthSpec {
  quality: PerformanceQuality;
  /** Why this movement addresses the fault. Shown on the Rx card. */
  why: string;
}

export interface FaultRx {
  fault: SwingFault;
  label: string;
  /** Honest physical read: what a body limitation behind this fault usually
   *  looks like. Never asserts a measurement. */
  physical: string;
  /** Golf qualities this Rx loads (all exist in the golf path config). */
  qualities: PerformanceQuality[];
  /** Empty for faults with nothing specific to train against. */
  exercises: RxSpec[];
}

/** Faults Caddie can report that carry no physical prescription — either
 *  because nothing was named, or because the fault is a timing pattern rather
 *  than a body limitation. Refusing these is the honest call: SmartPump can
 *  train a weak hip, not a rushed transition. */
export function isTrainableFault(fault: SwingFault): boolean {
  return FAULT_RX[fault].exercises.length > 0;
}

/**
 * The fault → physical-quality → movement map. Three movements per fault:
 * enough to be a real session, few enough to actually get done. Loads reuse
 * the golf block's conventions — intensity 0 for qualitative movements
 * (throws / jumps / mobility / anti-rotation), 1.0 for loaded lifts, so
 * lib/paths/build.ts resolves weights exactly as it does for a block session.
 */
export const FAULT_RX: Record<SwingFault, FaultRx> = {
  over_the_top: {
    fault: 'over_the_top',
    label: 'Over the Top',
    physical:
      'The upper body starts the downswing because the trunk cannot resist rotation and the hips do not lead. What trains underneath it: anti-rotation strength and a hips-first sequence.',
    qualities: ['coreStability', 'rotationalPower'],
    exercises: [
      {
        exerciseId: 'pallofPress',
        quality: 'coreStability',
        workingSets: 3,
        reps: 12,
        intensity: 0,
        perSide: true,
        note: 'Resist the pull. Ribs down, glutes on.',
        why: 'Builds the brace that stops the shoulders from firing first.',
      },
      {
        exerciseId: 'medBallRotThrow',
        quality: 'rotationalPower',
        workingSets: 4,
        reps: 6,
        intensity: 0,
        perSide: true,
        unit: 'throws',
        note: 'Hips, then core, then arms. Reset between reps.',
        why: 'Grooves the ground-up order the over-the-top move skips.',
      },
      {
        exerciseId: 'cableRotation',
        quality: 'rotationalPower',
        workingSets: 3,
        reps: 10,
        intensity: 0,
        perSide: true,
        note: 'Pivot the back foot, let the hips lead the hands.',
        why: 'Rehearses hips leading the arms under light resistance.',
      },
    ],
  },

  early_extension: {
    fault: 'early_extension',
    label: 'Early Extension',
    physical:
      'The hips push toward the ball when the glutes and hamstrings cannot hold the hinge and the lead hip has no room to rotate. What trains underneath it: posterior-chain strength and hip rotation.',
    qualities: ['hipStrength', 'thoracicMobility'],
    exercises: [
      {
        exerciseId: 'hipThrust',
        quality: 'hipStrength',
        workingSets: 3,
        reps: 10,
        intensity: 1.0,
        warmups: [0.6],
        note: 'Full lockout, ribs down. Squeeze at the top.',
        why: 'Builds the glute drive that keeps you back in your posture.',
      },
      {
        exerciseId: 'dbRdl',
        quality: 'hipStrength',
        workingSets: 3,
        reps: 10,
        intensity: 1.0,
        warmups: [0.6],
        note: 'Hinge, don’t squat. Feel the hamstrings load.',
        why: 'Strengthens the exact hinge the swing gives up at impact.',
      },
      {
        exerciseId: 'hipMobility90',
        quality: 'thoracicMobility',
        workingSets: 3,
        reps: 8,
        intensity: 0,
        perSide: true,
        note: 'Own the range — slow, no bounce.',
        why: 'Buys the lead hip room to rotate instead of thrusting forward.',
      },
    ],
  },

  casting: {
    fault: 'casting',
    label: 'Casting',
    physical:
      'The angle releases early when the trunk cannot hold its brace and the body cannot carry load against rotation. What trains underneath it: trunk and grip strength under load, plus a late, sequenced finish.',
    qualities: ['coreStability', 'rotationalPower'],
    exercises: [
      {
        exerciseId: 'farmerCarry',
        quality: 'coreStability',
        workingSets: 3,
        reps: 20,
        intensity: 1.0,
        unit: 'steps',
        note: 'Tall and stacked. Don’t let the load tip you.',
        why: 'Grip and trunk under load — stored angle needs both.',
      },
      {
        exerciseId: 'pallofPress',
        quality: 'coreStability',
        workingSets: 3,
        reps: 10,
        intensity: 0,
        perSide: true,
        note: 'Slow out, slower back.',
        why: 'Trains a trunk that doesn’t give when the arms want to release.',
      },
      {
        exerciseId: 'medBallSlam',
        quality: 'rotationalPower',
        workingSets: 3,
        reps: 8,
        intensity: 0,
        unit: 'slams',
        note: 'Whole body. Finish through the floor.',
        why: 'Teaches a late, violent release instead of an early one.',
      },
    ],
  },

  sway: {
    fault: 'sway',
    label: 'Sway',
    physical:
      'The body slides off the trail hip instead of turning into it — usually a single-leg stability limit plus a hip that cannot rotate. What trains underneath it: trail-leg strength, braking control, and hip rotation.',
    qualities: ['groundForce', 'deceleration', 'thoracicMobility'],
    exercises: [
      {
        exerciseId: 'bulgarianSplitSquat',
        quality: 'groundForce',
        workingSets: 3,
        reps: 8,
        intensity: 1.0,
        perSide: true,
        note: 'Front leg does the work. Stay stacked.',
        why: 'Builds the post you’re currently sliding off of.',
      },
      {
        exerciseId: 'singleLegRdl',
        quality: 'deceleration',
        workingSets: 3,
        reps: 8,
        intensity: 1.0,
        perSide: true,
        note: 'Control the lower. Balance is the point.',
        why: 'Trains the brake that stops lateral drift in the backswing.',
      },
      {
        exerciseId: 'hipMobility90',
        quality: 'thoracicMobility',
        workingSets: 3,
        reps: 8,
        intensity: 0,
        perSide: true,
        note: 'Slow, no bounce. Own the end range.',
        why: 'A trail hip that can’t rotate slides instead. Buy the rotation.',
      },
    ],
  },

  reverse_pivot: {
    fault: 'reverse_pivot',
    label: 'Reverse Pivot',
    physical:
      'Weight moves the wrong way when the lower body cannot load and push. What trains underneath it: a real hinge, bilateral leg strength, and force into the ground.',
    qualities: ['groundForce', 'hipStrength'],
    exercises: [
      {
        exerciseId: 'gobletSquat',
        quality: 'groundForce',
        workingSets: 3,
        reps: 10,
        intensity: 1.0,
        warmups: [0.6],
        note: 'Upright torso, depth you control.',
        why: 'Teaches the body to sit into the ground instead of away from it.',
      },
      {
        exerciseId: 'dbRdl',
        quality: 'hipStrength',
        workingSets: 3,
        reps: 10,
        intensity: 1.0,
        warmups: [0.6],
        note: 'Hinge and load. Bar stays close.',
        why: 'Loading the trail hamstring is the backswing you’re missing.',
      },
      {
        exerciseId: 'boxJump',
        quality: 'groundForce',
        workingSets: 4,
        reps: 5,
        intensity: 0,
        unit: 'jumps',
        note: 'Soft, quiet landings. Absorb the ground.',
        why: 'Weight goes down before it goes anywhere else.',
      },
    ],
  },

  chicken_wing: {
    fault: 'chicken_wing',
    label: 'Chicken Wing',
    physical:
      'The lead arm folds because the body stops rotating through impact. What trains underneath it: upper-back rotation and rotation that keeps going past the ball.',
    qualities: ['thoracicMobility', 'rotationalPower'],
    exercises: [
      {
        exerciseId: 'thoracicRotation',
        quality: 'thoracicMobility',
        workingSets: 3,
        reps: 8,
        intensity: 0,
        perSide: true,
        note: 'Rotate from the upper back. Exhale into the turn.',
        why: 'Gives the torso somewhere to go so the arm doesn’t have to fold.',
      },
      {
        exerciseId: 'cableRotation',
        quality: 'rotationalPower',
        workingSets: 4,
        reps: 10,
        intensity: 0,
        perSide: true,
        note: 'Keep rotating through the finish.',
        why: 'Trains rotation past impact instead of stalling at the ball.',
      },
      {
        exerciseId: 'medBallRotThrow',
        quality: 'rotationalPower',
        workingSets: 3,
        reps: 6,
        intensity: 0,
        perSide: true,
        unit: 'throws',
        note: 'Throw through the target, not at it.',
        why: 'Full-speed rehearsal of extending through, not across.',
      },
    ],
  },

  plane_too_flat: {
    fault: 'plane_too_flat',
    label: 'Plane Too Flat',
    physical:
      'A rounded setup and a flat turn usually trace back to a thoracic spine that cannot extend and rotate, and a ribcage that won’t stay stacked. What trains underneath it: posture under rotation.',
    qualities: ['thoracicMobility', 'coreStability'],
    exercises: [
      {
        exerciseId: 'thoracicRotation',
        quality: 'thoracicMobility',
        workingSets: 3,
        reps: 10,
        intensity: 0,
        perSide: true,
        note: 'Extend first, then rotate.',
        why: 'The posture the plane sits on — build it before you fix the plane.',
      },
      {
        exerciseId: 'pallofPress',
        quality: 'coreStability',
        workingSets: 3,
        reps: 12,
        intensity: 0,
        perSide: true,
        note: 'Ribs down, tall.',
        why: 'Holds posture while something is actively trying to move you.',
      },
      {
        exerciseId: 'deadBug',
        quality: 'coreStability',
        workingSets: 3,
        reps: 10,
        intensity: 0,
        perSide: true,
        note: 'Low back glued to the floor.',
        why: 'Anti-extension work keeps the ribcage where the plane needs it.',
      },
    ],
  },

  plane_too_steep: {
    fault: 'plane_too_steep',
    label: 'Plane Too Steep',
    physical:
      'A steep shaft is often a turn that never happened — the arms lift because the torso won’t rotate. What trains underneath it: rotation the arms don’t have to substitute for.',
    qualities: ['thoracicMobility', 'rotationalPower'],
    exercises: [
      {
        exerciseId: 'thoracicRotation',
        quality: 'thoracicMobility',
        workingSets: 3,
        reps: 10,
        intensity: 0,
        perSide: true,
        note: 'Rotate from the upper back, not the low back.',
        why: 'More turn available means less lift needed to make a backswing.',
      },
      {
        exerciseId: 'landmineRotation',
        quality: 'rotationalPower',
        workingSets: 4,
        reps: 8,
        intensity: 1.0,
        perSide: true,
        note: 'Drive from the hips, arms just carry the bar.',
        why: 'Loads rotation around you instead of lifting up in front of you.',
      },
      {
        exerciseId: 'hipMobility90',
        quality: 'thoracicMobility',
        workingSets: 3,
        reps: 8,
        intensity: 0,
        perSide: true,
        note: 'Slow, no bounce.',
        why: 'A hip turn that works takes load off the arms.',
      },
    ],
  },

  head_movement: {
    fault: 'head_movement',
    label: 'Head Movement',
    physical:
      'An unstable center — the middle of you moves because nothing is holding it still. What trains underneath it: trunk control and single-leg balance.',
    qualities: ['coreStability', 'deceleration'],
    exercises: [
      {
        exerciseId: 'deadBug',
        quality: 'coreStability',
        workingSets: 3,
        reps: 10,
        intensity: 0,
        perSide: true,
        note: 'Slow and deliberate. Nothing else moves.',
        why: 'The most direct training for holding a center under motion.',
      },
      {
        exerciseId: 'singleLegRdl',
        quality: 'deceleration',
        workingSets: 3,
        reps: 8,
        intensity: 1.0,
        perSide: true,
        note: 'Balance is the point. Control the lower.',
        why: 'Balance under load is what a stable head position actually is.',
      },
      {
        exerciseId: 'farmerCarry',
        quality: 'coreStability',
        workingSets: 3,
        reps: 20,
        intensity: 1.0,
        unit: 'steps',
        note: 'Tall and stacked, eyes level.',
        why: 'Walking under load with a quiet torso, repeated.',
      },
    ],
  },

  spine_angle_loss: {
    fault: 'spine_angle_loss',
    label: 'Loss of Spine Angle',
    physical:
      'Posture gives out when the posterior chain and trunk cannot hold a hinge through a full-speed swing. What trains underneath it: hinge strength plus anti-extension endurance.',
    qualities: ['hipStrength', 'coreStability'],
    exercises: [
      {
        exerciseId: 'rdl',
        quality: 'hipStrength',
        workingSets: 4,
        reps: 6,
        intensity: 1.0,
        warmups: [0.6, 0.8],
        note: 'Flat back under load. Bar stays close.',
        why: 'Strengthens the exact position the swing is losing.',
      },
      {
        exerciseId: 'hipThrust',
        quality: 'hipStrength',
        workingSets: 3,
        reps: 10,
        intensity: 1.0,
        warmups: [0.6],
        note: 'Full lockout, ribs down.',
        why: 'Glute strength holds the hinge when speed tries to break it.',
      },
      {
        exerciseId: 'deadBug',
        quality: 'coreStability',
        workingSets: 3,
        reps: 10,
        intensity: 0,
        perSide: true,
        note: 'Anti-extension under fatigue.',
        why: 'Keeps the ribcage from popping up as the swing accelerates.',
      },
    ],
  },

  under_coil: {
    fault: 'under_coil',
    label: 'Under-Coil',
    physical:
      'A short backswing is usually a turn the body can’t make — restricted upper-back rotation and hips that won’t load. What trains underneath it: rotation range, then rotation under load.',
    qualities: ['thoracicMobility', 'rotationalPower'],
    exercises: [
      {
        exerciseId: 'thoracicRotation',
        quality: 'thoracicMobility',
        workingSets: 3,
        reps: 10,
        intensity: 0,
        perSide: true,
        note: 'Rotate from the upper back. Exhale into the turn.',
        why: 'Directly adds the coil range a short backswing is missing.',
      },
      {
        exerciseId: 'hipMobility90',
        quality: 'thoracicMobility',
        workingSets: 3,
        reps: 8,
        intensity: 0,
        perSide: true,
        note: 'Own the range — slow, no bounce.',
        why: 'Lets the trail hip load so the turn has somewhere to go.',
      },
      {
        exerciseId: 'cableRotation',
        quality: 'rotationalPower',
        workingSets: 3,
        reps: 10,
        intensity: 0,
        perSide: true,
        note: 'Full range, controlled. Turn as far as you own.',
        why: 'Makes the new range usable under load instead of just available.',
      },
    ],
  },

  quick_tempo: {
    fault: 'quick_tempo',
    label: 'Quick Tempo',
    physical:
      'Tempo is a timing pattern, not a physical limitation — there’s no strength quality that makes a transition slower. Caddie’s drills are the right work here; SmartPump won’t invent gym work for it.',
    qualities: [],
    exercises: [],
  },

  slow_tempo: {
    fault: 'slow_tempo',
    label: 'Slow Tempo',
    physical:
      'Tempo is a timing pattern, not a physical limitation. Caddie’s drills are the right work here; SmartPump won’t invent gym work for it.',
    qualities: [],
    exercises: [],
  },

  no_dominant_fault: {
    fault: 'no_dominant_fault',
    label: 'No Dominant Fault',
    physical:
      'Caddie didn’t find one thing to fix — nothing specific to train against. Run the Long Game block as written; the general athletic base is the right work here.',
    qualities: [],
    exercises: [],
  },

  inconclusive: {
    fault: 'inconclusive',
    label: 'Inconclusive',
    physical:
      'Caddie couldn’t read the swing well enough to name a fault. No prescription — capture a cleaner swing before training against a guess.',
    qualities: [],
    exercises: [],
  },
};

/** Human label for a fault (falls back to a de-slugged form). */
export function faultLabel(fault: SwingFault): string {
  return FAULT_RX[fault]?.label ?? fault.replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ *
 * Stored prescription
 * ------------------------------------------------------------------ */

/** One movement as stored — the resolved spec plus where it came from. */
export interface RxMovement extends RxSpec {
  /** 'smartpump' when derived from the fault map; 'caddie' when the payload
   *  named an exercise SmartPump could resolve to a real library movement. */
  origin: 'smartpump' | 'caddie';
}

/**
 * A swing drill Caddie prescribed. Carried through and displayed, never
 * built as gym work: a range drill has no sets, no load, and nothing
 * SmartPump can honestly track. Caddie owns these — SmartPump just makes
 * sure they don't get lost on the way over.
 */
export interface CaddieDrill {
  name: string;
  why: string;
  /** Caddie's own category: 'drill' | 'mobility' | 'stability' | 'strength'. */
  category: string;
}

/**
 * A prescription imported from Caddie. `importedAt` is the tracking epoch:
 * only sets logged AFTER it count toward this Rx, so re-importing the same
 * fault starts a fresh block rather than inheriting old credit.
 */
export interface SwingPrescription {
  id: string;
  /** ISO — when SmartPump ingested it. Tracking starts here. */
  importedAt: string;
  /** ISO — when Caddie analyzed the swing, if the payload said. */
  capturedAt: string | null;
  fault: SwingFault;
  label: string;
  physical: string;
  confidence: 'high' | 'medium' | 'low' | null;
  /** Caddie's own words, carried through verbatim when present. */
  cause: string | null;
  fix: string | null;
  drill: string | null;
  /** Other faults Caddie flagged as downstream symptoms. */
  secondaryFaults: SwingFault[];
  qualities: PerformanceQuality[];
  movements: RxMovement[];
  /** Caddie's swing drills — shown, not built. */
  drills: CaddieDrill[];
  /** Anything in the payload SmartPump kept but couldn't act on. */
  warnings: string[];
}

/** Sets per movement that counts an Rx block as done (≈4 sessions × 3 sets). */
export const RX_TARGET_SETS = 12;

/** Ceiling on prescribed movements so a chatty payload can't turn one Rx into
 *  an unfinishable session. Anything dropped is reported, never silent. */
export const RX_MAX_MOVEMENTS = 6;

/** Assemble a stored prescription from a fault plus optional Caddie extras. */
export function buildPrescription(
  fault: SwingFault,
  extras: {
    capturedAt?: string | null;
    confidence?: 'high' | 'medium' | 'low' | null;
    cause?: string | null;
    fix?: string | null;
    drill?: string | null;
    secondaryFaults?: SwingFault[];
    /** Library movements Caddie asked for, already resolved, with Caddie's
     *  own rationale for each. */
    caddieExercises?: { exerciseId: string; why?: string }[];
    drills?: CaddieDrill[];
    warnings?: string[];
  } = {},
  now: number = Date.now(),
): SwingPrescription {
  const rx = FAULT_RX[fault];
  const base: RxMovement[] = rx.exercises.map((e) => ({ ...e, origin: 'smartpump' }));
  const asked = extras.caddieExercises ?? [];
  const warnings = [...(extras.warnings ?? [])];

  // A movement SmartPump already prescribes isn't duplicated — it's marked as
  // confirmed by both sides, and Caddie's rationale replaces the generic one.
  for (const m of base) {
    const hit = asked.find((a) => a.exerciseId === m.exerciseId);
    if (!hit) continue;
    m.origin = 'caddie';
    if (hit.why) m.why = hit.why;
  }

  const fromCaddie: RxMovement[] = asked
    .filter((a) => !base.some((m) => m.exerciseId === a.exerciseId))
    .map((a) => caddieMovement(a.exerciseId, a.why))
    .filter((m): m is RxMovement => m !== null);

  let movements = [...base, ...fromCaddie];
  if (movements.length > RX_MAX_MOVEMENTS) {
    const dropped = movements.slice(RX_MAX_MOVEMENTS);
    movements = movements.slice(0, RX_MAX_MOVEMENTS);
    warnings.push(
      `Capped at ${RX_MAX_MOVEMENTS} movements — not prescribed: ${dropped
        .map((m) => m.exerciseId)
        .join(', ')}.`,
    );
  }

  return {
    id: `rx_${now}_${fault}`,
    importedAt: new Date(now).toISOString(),
    capturedAt: extras.capturedAt ?? null,
    fault,
    label: rx.label,
    physical: rx.physical,
    confidence: extras.confidence ?? null,
    cause: extras.cause ?? null,
    fix: extras.fix ?? null,
    drill: extras.drill ?? null,
    secondaryFaults: extras.secondaryFaults ?? [],
    qualities: rx.qualities,
    movements,
    drills: extras.drills ?? [],
    warnings,
  };
}

/** Build a movement for a Caddie-named exercise using the golf path's own
 *  quality attribution + a conservative default dose. Returns null when the
 *  id isn't a movement the golf path attributes (so it can't be tracked). */
function caddieMovement(exerciseId: string, why?: string): RxMovement | null {
  const quality = CADDIE_MOVEMENT_QUALITY[exerciseId];
  if (!quality) return null;
  const loaded = LOADED_MOVEMENTS.has(exerciseId);
  return {
    exerciseId,
    quality,
    workingSets: 3,
    reps: loaded ? 10 : 8,
    intensity: loaded ? 1.0 : 0,
    perSide: PER_SIDE_MOVEMENTS.has(exerciseId),
    note: undefined,
    why: why ?? 'Named by Caddie in the swing analysis.',
    origin: 'caddie',
  };
}

/**
 * Movements Caddie's curated table names that the Long Game block itself
 * doesn't use, but which are honestly attributable to a golf quality. The
 * golf path merges these into `qualityByKey` (lib/paths/configs/golf.ts), so
 * a Caddie-prescribed lift moves the Performance panel like any block lift.
 *
 * Kept separate from golfProgram's QUALITY_BY_MOVEMENT so that map stays what
 * its comment says it is: the movements the BLOCK uses.
 */
export const RX_EXTRA_MOVEMENT_QUALITY: Record<string, PerformanceQuality> = {
  lunge: 'groundForce',
  squat: 'groundForce',
  bwSquat: 'groundForce',
  deadlift: 'hipStrength',
  gluteBridge: 'hipStrength',
  plank: 'coreStability',
};

/** Quality attribution for movements Caddie may name: the block's own map
 *  plus the Rx-only extensions above. A Caddie-named movement can never
 *  resolve to a quality the golf path doesn't display. */
const CADDIE_MOVEMENT_QUALITY: Record<string, PerformanceQuality> = {
  medBallRotThrow: 'rotationalPower',
  medBallSlam: 'rotationalPower',
  landmineRotation: 'rotationalPower',
  cableRotation: 'rotationalPower',
  trapBarDeadlift: 'groundForce',
  gobletSquat: 'groundForce',
  bulgarianSplitSquat: 'groundForce',
  boxJump: 'groundForce',
  rdl: 'hipStrength',
  dbRdl: 'hipStrength',
  hipThrust: 'hipStrength',
  pallofPress: 'coreStability',
  deadBug: 'coreStability',
  situp: 'coreStability',
  farmerCarry: 'coreStability',
  thoracicRotation: 'thoracicMobility',
  hipMobility90: 'thoracicMobility',
  singleLegRdl: 'deceleration',
  ...RX_EXTRA_MOVEMENT_QUALITY,
};

/** Movement ids SmartPump can prescribe from a Caddie payload. */
export const RX_ELIGIBLE_MOVEMENTS: ReadonlySet<string> = new Set(
  Object.keys(CADDIE_MOVEMENT_QUALITY),
);

const LOADED_MOVEMENTS = new Set([
  'trapBarDeadlift',
  'gobletSquat',
  'bulgarianSplitSquat',
  'rdl',
  'dbRdl',
  'hipThrust',
  'farmerCarry',
  'landmineRotation',
  'singleLegRdl',
  'situp',
  'squat',
  'deadlift',
]);

const PER_SIDE_MOVEMENTS = new Set([
  'medBallRotThrow',
  'landmineRotation',
  'cableRotation',
  'pallofPress',
  'deadBug',
  'thoracicRotation',
  'hipMobility90',
  'singleLegRdl',
  'bulgarianSplitSquat',
  'lunge',
]);

/* ------------------------------------------------------------------ *
 * Build — an Rx runs through Train exactly like a block session
 * ------------------------------------------------------------------ */

/** The Rx as a StrengthSession, so it reuses lib/paths/build.ts verbatim. */
export function rxSession(rx: SwingPrescription): StrengthSession {
  return {
    kind: 'strength',
    id: `rx-${rx.id}`,
    phaseId: 'rx',
    type: 'SWING RX',
    name: `Swing Rx · ${rx.label}`,
    blurb: rx.physical,
    exercises: rx.movements,
  };
}

/** Resolve the Rx into the SetPlan array useSessionStore.startSession() wants. */
export function buildRxSession(
  rx: SwingPrescription,
  bodyweight: number | undefined,
): PlannedExerciseInSession[] {
  return buildStrengthSession(rxSession(rx), bodyweight);
}

export { describeStrengthSpec as describeRxMovement };

/* ------------------------------------------------------------------ *
 * Track — progress comes from real logged sets, never from "marked done"
 * ------------------------------------------------------------------ */

export interface RxMovementProgress {
  exerciseId: string;
  label: string;
  setsLogged: number;
  targetSets: number;
  topLoad: number;
  /** 0..1 volume against the block target. */
  score: number;
}

export interface RxProgress {
  rxId: string;
  setsLogged: number;
  targetSets: number;
  /** 0..1 across every prescribed movement. */
  completion: number;
  /** Movements with at least one logged set since import. */
  movementsStarted: number;
  movements: RxMovementProgress[];
  /** ISO of the most recent logged Rx set, or null. */
  lastLoggedAt: string | null;
}

/**
 * Pure computation over already-fetched events. Only sets logged at or after
 * `rx.importedAt` count — the Rx measures work done in response to the
 * analysis, not work that happened to precede it.
 */
export function computeRxProgress(
  rx: SwingPrescription,
  events: LoggedSetEvent[],
): RxProgress {
  const since = new Date(rx.importedAt).getTime();
  const prescribed = new Set(rx.movements.map((m) => m.exerciseId));

  const acc = new Map<string, { sets: number; topLoad: number }>();
  for (const id of prescribed) acc.set(id, { sets: 0, topLoad: 0 });
  let lastLoggedAt: string | null = null;

  for (const e of events) {
    const { exerciseId, weight, reps } = e.payload;
    if (!prescribed.has(exerciseId)) continue;
    if (typeof reps !== 'number' || reps < 1) continue;
    const at = new Date(e.timestamp).getTime();
    if (!Number.isFinite(at) || at < since) continue;
    const bucket = acc.get(exerciseId);
    if (!bucket) continue;
    bucket.sets += 1;
    if (typeof weight === 'number' && weight > bucket.topLoad) bucket.topLoad = weight;
    if (lastLoggedAt === null || e.timestamp > lastLoggedAt) lastLoggedAt = e.timestamp;
  }

  const movements: RxMovementProgress[] = rx.movements.map((m) => {
    const b = acc.get(m.exerciseId)!;
    return {
      exerciseId: m.exerciseId,
      label: describeStrengthSpec(m).label,
      setsLogged: b.sets,
      targetSets: RX_TARGET_SETS,
      topLoad: b.topLoad,
      score: Math.min(1, b.sets / RX_TARGET_SETS),
    };
  });

  const setsLogged = movements.reduce((n, m) => n + m.setsLogged, 0);
  const targetSets = movements.length * RX_TARGET_SETS;

  return {
    rxId: rx.id,
    setsLogged,
    targetSets,
    completion: targetSets === 0 ? 0 : Math.min(1, setsLogged / targetSets),
    movementsStarted: movements.filter((m) => m.setsLogged > 0).length,
    movements,
    lastLoggedAt,
  };
}

/** Quality labels an Rx loads, for the card's "what this trains" line. */
export function rxQualityLabels(rx: SwingPrescription): string[] {
  return rx.qualities.map((q) => QUALITY_META[q]?.label ?? q);
}
