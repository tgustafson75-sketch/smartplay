import type { CanonicalIssue } from './poseDetection';
import type { DrillRecommendation } from '../store/cageStore';

/**
 * Phase K — Map a detected swing fault to a drill from the SwingLab library
 * with Kevin's Coach voice reason for the recommendation.
 *
 * The drill_id maps to entries in `app/(tabs)/swinglab.tsx` DRILLS array.
 * When future Phase K refinement adds drill-id deep-linking from DrillCard,
 * the same drill_id values navigate to the right drill detail.
 *
 * Returns null when issue is 'none' or unmapped — the DrillCard then renders
 * the placeholder, which is the honest behavior for an analysis-empty session.
 */

const ISSUE_TO_DRILL: Record<CanonicalIssue, { drill_id: string; drill_name: string; reason: string } | null> = {
  swing_path_outside_in: {
    drill_id: 'gate',
    drill_name: 'Gate Drill',
    reason: "Based on what I saw, the Gate Drill will help with that path. Start with a 7-iron — the gate exposes the cut immediately.",
  },
  swing_path_inside_out: {
    drill_id: 'gate',
    drill_name: 'Gate Drill',
    reason: "Same Gate Drill — your tendency's the opposite, but the gate teaches both sides of neutral. Hit ten clean and the path resets.",
  },
  club_face_open: {
    drill_id: 'alignment',
    drill_name: 'Knuckle Check',
    reason: "Start with the Knuckle Check — an open face usually starts at the grip. Two to three knuckles on the top hand, flat lead wrist at the top, and the face squares up.",
  },
  club_face_closed: {
    drill_id: 'alignment',
    drill_name: 'Soft-Hands Punch',
    reason: "Soft-Hands Punch first. A shut face is usually too much forearm roll — half swings, hold the finish low with the toe skyward, and the hook stops appearing.",
  },
  attack_angle_steep: {
    drill_id: 'impact',
    drill_name: 'Headcover Drill',
    reason: "The Headcover drill is the move — a cover six inches behind the ball forces a shallower approach, and the belt-loop turn keeps it there.",
  },
  attack_angle_shallow: {
    drill_id: 'impact',
    drill_name: 'Lead-Shoulder Drill',
    reason: "Lead-Shoulder drill. Shallow attack means no compression — drop the lead shoulder an inch at setup and hit down into the strike; the angle steepens to neutral.",
  },
  early_extension: {
    drill_id: 'pump',
    drill_name: 'Pump Drill',
    reason: "Pump Drill is the move here — it'll fix the sequencing that's causing the early extension. Lower body leads, hips rotate around the spine, butt stays back.",
  },
  /**
   * 2026-08-13 — was the Pump Drill, same as early_extension: one drill answering the two most common
   * amateur faults, which is why it was the only drill Tim ever saw.
   *
   * Step-and-swing trains the same transition — lower body leads, club drops instead of being thrown —
   * but it ENDS IN A FINISH by construction. That matters here specifically: his reported limitation
   * with the pump drill was not finishing the swing, and not being certain how to perform it. The pump
   * drill is still listed on the fault's catalog page as an alternative; it is no longer the only
   * thing offered.
   */
  over_the_top: {
    drill_id: 'step',
    drill_name: 'Step-and-Swing',
    reason: "Step-and-Swing — feet together, step toward the target to start down, and swing all the way through to a finish over your lead leg. The step forces the lower body to lead, which is the thing that's throwing the club over the top.",
  },
  chicken_wing: {
    drill_id: 'one-handed',
    drill_name: 'Wide-and-Rotate',
    reason: "Wide-and-Rotate — the chicken wing is a lead-arm collapse. Hold the finish with both arms extended toward the target; the towel-under-armpit rep locks it in.",
  },
  reverse_pivot: {
    drill_id: 'tempo',
    drill_name: 'Trail-Foot Weight',
    reason: "Trail-Foot Weight — reverse pivot means the weight's going the wrong way. Pause at the top and check sixty percent is in the trail foot before you swing.",
  },
  none: null,
};

export function recommendDrill(issue: CanonicalIssue): DrillRecommendation | null {
  const mapped = ISSUE_TO_DRILL[issue];
  if (!mapped) return null;
  return {
    drill_id: mapped.drill_id,
    drill_name: mapped.drill_name,
    reason: mapped.reason,
    // The CanonicalIssue value is the /drills/<id> catalog route id (over_the_top,
    // early_extension, chicken_wing, reverse_pivot, …) — every mapped issue has a
    // matching DRILL_CATALOG entry, so DrillCard can deep-link straight to it.
    catalog_id: issue,
  };
}
