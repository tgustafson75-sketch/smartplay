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
    drill_name: 'Alignment Check',
    reason: "Start with Alignment Check — open face often starts at setup. If alignment's clean and the face still leaks, we'll work the release next.",
  },
  club_face_closed: {
    drill_id: 'alignment',
    drill_name: 'Alignment Check',
    reason: "Alignment Check first. A shut face usually traces back to grip and aim. Square the foundation and the face squares with it.",
  },
  attack_angle_steep: {
    drill_id: 'impact',
    drill_name: 'Impact Position',
    reason: "Impact Position is the move. The steep cut comes from hands behind at impact — the bag drill resets the hand position.",
  },
  attack_angle_shallow: {
    drill_id: 'impact',
    drill_name: 'Impact Position',
    reason: "Impact Position. Shallow attack means no compression — train the hands ahead and weight forward, the angle steepens to neutral.",
  },
  early_extension: {
    drill_id: 'pump',
    drill_name: 'Pump Drill',
    reason: "Pump Drill is the move here — it'll fix the sequencing that's causing the early extension. Lower body leads, hips rotate around the spine, butt stays back.",
  },
  over_the_top: {
    drill_id: 'pump',
    drill_name: 'Pump Drill',
    reason: "Pump Drill — feel the hands lead the clubhead on the way down. Twenty pumps, then a ball. The over-the-top fades quickly when the sequence is right.",
  },
  chicken_wing: {
    drill_id: 'one-handed',
    drill_name: 'One Handed Swings',
    reason: "Lead-hand-only swings. The chicken wing is a lead-arm collapse — train the extension with one hand, then both rejoin and the elbow stays straighter.",
  },
  reverse_pivot: {
    drill_id: 'tempo',
    drill_name: 'Tempo Training',
    reason: "Tempo Training will help — reverse pivot usually comes from rushing the takeaway. Smooth back, full turn, then the weight stays where it should.",
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
  };
}
