/**
 * 2026-09-14 (Tim) — "We have smartmotion watch but how can we comment on a lesson we have not
 * taught. This is a pretty important principle throughout the app."
 *
 * TEACH BEFORE YOU GRADE, and here is where the app was failing its own rule.
 *
 * `services/swing/poseSwingRead` produces the deterministic read SmartMotion headlines with. Its
 * `PoseFault` carried exactly four things: a key, a label, a severity and the measurement that
 * triggered it. So the camera said EARLY EXTENSION, proved it with "spine angle rose 14° into
 * impact", and stopped. That is a grade for a lesson nobody gave.
 *
 * The teaching partly existed and could not be reached. `services/drillRecommendation` maps faults
 * to drills with real coaching reasons — but it is keyed on `CanonicalIssue`, the AI analysis
 * vocabulary, and is read only by the swing-detail screen. Counted on the day: of the ELEVEN pose
 * faults, four had a drill that could have answered them and was never wired, and **seven had no
 * teaching anywhere in the app**: sway, under_coil, lead_arm_bent, poor_finish, head_movement,
 * quick_tempo, slow_tempo.
 *
 * This module is the one owner of WHAT A FAULT IS AND HOW TO FIX IT. The drill, where a fault has
 * one, still comes from `drillRecommendation` — asking it rather than restating it is the only way
 * the two cannot drift about which drill answers early extension.
 *
 * HOW THE WORDS ARE WRITTEN, which is the whole point of the exercise:
 *   - `what` says what the fault IS in a sentence a player recognises from their own ball flight,
 *     not from a biomechanics paper. Someone who has never had a lesson has to know what we mean.
 *   - `fix` is setup first, then THE ONE FEEL. Same shape as the shot-shape lessons Tim asked for
 *     on 2026-09-01, because that shape worked.
 *   - No numbers we cannot measure, no launch angles, no "tour players average X". The evidence
 *     line already carries the real measurement; this carries the instruction.
 *     [[illustration-data-points]] [[time-constrained-golfer-lens]]
 */
import type { CanonicalIssue } from '../poseDetection';
import { recommendDrill } from '../drillRecommendation';

/** Every fault `poseSwingRead` can raise. Kept in step with `PoseFault['key']` by a guard. */
export type SwingFaultKey =
  | 'early_extension' | 'sway' | 'reverse_pivot' | 'over_the_top' | 'under_coil'
  | 'quick_tempo' | 'slow_tempo' | 'lead_arm_bent' | 'chicken_wing' | 'poor_finish'
  | 'head_movement';

export interface FaultTeaching {
  /** What it is, in terms a player recognises. One sentence. */
  what: string;
  /** How to fix it — setup, then the one feel. Two to four steps, never more. */
  fix: string[];
}

/** The drill that trains a fault, when the catalog has one. Null is honest, not a gap. */
export interface FaultDrill {
  drill_id: string;
  drill_name: string;
  reason: string;
  /** Optional upstream: `DrillRecommendation.catalog_id` is optional, and a drill with no catalog
   *  page is still a drill worth naming. Callers deep-link only when it is present. */
  catalog_id?: string;
}

const TEACHING: Record<SwingFaultKey, FaultTeaching> = {
  early_extension: {
    what: 'Your hips push in toward the ball on the way down and you stand up out of the posture you started in. It costs you the low point — thin and heavy shots from the same swing — and it jams your arms so the face has to flip to square.',
    fix: [
      'Set up with your backside just brushing a wall or a chair back.',
      'Make slow swings and keep that contact all the way to impact.',
      'The feel: your belt buckle turns LEFT, it does not move toward the ball.',
    ],
  },
  sway: {
    what: 'Your hips slide away from the target in the backswing instead of turning. You end up behind the ball with nothing to push against, so the strike moves around and you lose the coil that makes speed.',
    fix: [
      'Put a club shaft in the ground just outside your trail hip, almost touching.',
      'Turn back without touching it. Slowly at first — a sway will hit it every time.',
      'The feel: you are turning AROUND a post, not moving off one.',
    ],
  },
  reverse_pivot: {
    what: 'Your weight goes the wrong way — onto the front foot going back, onto the back foot coming down. It is the classic hit-from-the-top pattern and it robs both power and strike.',
    fix: [
      'Feet together, ball centre. Make half swings and step INTO the shot.',
      'Pause at the top of a normal swing and check most of your weight is in the trail foot.',
      'The feel: load into the trail hip going back, then move to the lead side to start down.',
    ],
  },
  over_the_top: {
    what: 'The club comes down outside the line it went back on, so the path cuts across the ball. That is where a slice starts, and the pull that comes with it when the face happens to be square.',
    fix: [
      'Feet together, step toward the target to start the downswing.',
      'Let the step, not your shoulders, be what starts you down.',
      'The feel: the club DROPS behind you in transition while the lower body turns through.',
    ],
  },
  under_coil: {
    what: 'Your shoulders do not turn far enough going back, so there is not much stretch to release. The swing feels short and armsy, and the distance is not there however hard you hit it.',
    fix: [
      'Cross your arms over your chest and turn your lead shoulder behind the ball.',
      'Let the trail hip turn too — a turn blocked at the hips cannot reach the shoulders.',
      'The feel: your back points at the target at the top. That is the coil.',
    ],
  },
  quick_tempo: {
    what: 'The downswing starts before the backswing has finished. Everything after that is a recovery, which is why a quick swing and an inconsistent strike usually arrive together.',
    fix: [
      'Count it: a long "one-two-three" going back, a short "one" coming down.',
      'Make the backswing feel almost lazy. It will not be as slow as it feels.',
      'The feel: the club finishes going back BEFORE you fire. Nothing else changes.',
    ],
  },
  slow_tempo: {
    what: 'The load runs long for the speed you come down with — the club waits at the top. It is not a disaster, but the pause lets the sequence come apart and drains the stretch you built.',
    fix: [
      'Shorten the backswing a touch rather than trying to swing harder.',
      'Start down as the backswing finishes, with no stop between the two.',
      'The feel: one continuous motion with a turnaround, not a backswing and then a downswing.',
    ],
  },
  lead_arm_bent: {
    what: 'Your lead arm folds at the top, so the swing loses width. A narrow backswing gives you less room to build speed and moves the bottom of the swing around.',
    fix: [
      'Make slow backswings pushing the clubhead as far from your chest as it will go.',
      'Stop when the arm wants to bend and turn your shoulders further instead.',
      'The feel: WIDE going back. Width first, then length.',
    ],
  },
  chicken_wing: {
    what: 'Your lead elbow folds out and away through impact instead of extending. It is a collapse, usually a way of saving a face that is already open, and it scoops height onto the ball.',
    fix: [
      'Towel under the lead armpit. Make half swings without dropping it.',
      'Hold the finish with BOTH arms extended down the target line.',
      'The feel: the arms get longer through the ball, not shorter.',
    ],
  },
  poor_finish: {
    what: 'You are stopping at the ball rather than swinging through to a balanced finish. A swing that decelerates into impact gives away speed and control at the same time.',
    fix: [
      'Swing at seventy percent and hold the finish for three seconds. Every ball.',
      'Chest facing the target, weight on the lead foot, trail toe down.',
      'The feel: the ball is on the WAY to the finish, not the point of the swing.',
    ],
  },
  head_movement: {
    what: 'Your head is travelling during the swing — usually up or toward the target — which moves the bottom of the arc and makes clean contact a matter of timing.',
    fix: [
      'Small swings with your eyes on one blade of grass just ahead of the ball.',
      'Let the head rotate with the through-swing; keeping it rigid is its own fault.',
      'The feel: your head STAYS while the body turns underneath it.',
    ],
  },
};

/**
 * Fault keys that are also `CanonicalIssue` values, so the drill catalog can answer them.
 * Typed as CanonicalIssue rather than cast at the call site — a key that stops being a canonical
 * issue then fails typecheck here instead of silently returning no drill.
 */
const DRILLABLE: Partial<Record<SwingFaultKey, CanonicalIssue>> = {
  early_extension: 'early_extension',
  over_the_top: 'over_the_top',
  chicken_wing: 'chicken_wing',
  reverse_pivot: 'reverse_pivot',
};

/** What a fault IS and how to fix it. Every fault has one — that is the point. */
export function teachingFor(key: SwingFaultKey): FaultTeaching {
  return TEACHING[key];
}

/** The drill that trains it, or null when the catalog has none. Asked, never restated. */
export function drillForFault(key: SwingFaultKey): FaultDrill | null {
  const issue = DRILLABLE[key];
  if (!issue) return null;
  const d = recommendDrill(issue);
  return d ? { drill_id: d.drill_id, drill_name: d.drill_name, reason: d.reason, catalog_id: d.catalog_id } : null;
}

/**
 * Deliberately NOT exporting a list of taught keys.
 *
 * `TEACHING` is a `Record<SwingFaultKey, FaultTeaching>`, so a new fault key without teaching is a
 * TYPECHECK failure, and `poseSwingRead` builds every fault through one constructor that reads this
 * module. That is a stronger guarantee than a runtime list a test walks — and an export kept alive
 * only for a guard to lean on is the orphan class this repo already hunts. The sim's orphan lock
 * caught exactly that when the list was here. [[orphans-are-live-bugs]]
 */
