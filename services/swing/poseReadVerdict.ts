/**
 * 2026-08-06 (Tim — "analysis takes 3 tries; the first cloud read fails cold"). Shared mapper: turn the
 * on-device pose read (buildPoseSwingRead — measured from biomech+tempo, deterministic, offline, never
 * "no swing") into a PrimaryIssue so BOTH the live-capture path (app/swinglab/smartmotion.tsx) and the
 * upload/library path (services/videoUpload.ts) can commit the measured verdict the instant biomech lands,
 * without waiting on the cold cloud vision call. Returns null when the read isn't usable (no measurable
 * dimensions) so the cloud/observation path still owns that case. [[pose-first-analysis-rearchitecture]]
 */
import type { PrimaryIssue } from '../../store/swingSessionStore';
import type { PoseSwingRead, PoseFault } from './poseSwingRead';

const POSE_FAULT_CATEGORY: Record<PoseFault['key'], PrimaryIssue['category']> = {
  early_extension: 'attack_angle', sway: 'setup', reverse_pivot: 'setup',
  over_the_top: 'swing_path', under_coil: 'setup', quick_tempo: 'tempo', slow_tempo: 'tempo',
  // 2026-08-09 (elite fault engine) — arm/finish/head faults.
  lead_arm_bent: 'setup', chicken_wing: 'other', poor_finish: 'other', head_movement: 'setup',
};
const POSE_FAULT_TO_PRIMARY: Partial<Record<PoseFault['key'], NonNullable<PrimaryIssue['primary_fault']>>> = {
  early_extension: 'early_extension', sway: 'sway', reverse_pivot: 'reverse_pivot', over_the_top: 'over_the_top',
  chicken_wing: 'chicken_wing', head_movement: 'head_movement', lead_arm_bent: 'lead_arm_bent', poor_finish: 'poor_finish',
};

export function poseReadToPrimaryIssue(read: PoseSwingRead): PrimaryIssue | null {
  if (!read.usable) return null;
  const top = read.faults[0] ?? null;
  if (!top) {
    // A clean measured swing — name the standout strength honestly instead of a fault.
    return {
      issue_id: 'pose_clean',
      name: 'Solid, balanced motion',
      category: 'other',
      severity: 'minor',
      occurrence_count: 1,
      visual_reference_path: null,
      mechanical_breakdown: read.headline,
      feel_cue: read.strengths[0] ?? 'Repeat that motion — the measured fundamentals are in a good window.',
      detected_in_shots: [],
      confidence: 'medium',
      primary_fault: 'no_dominant_fault',
      strengths: read.strengths,
    };
  }
  return {
    issue_id: `pose_${top.key}`,
    name: top.label,
    category: POSE_FAULT_CATEGORY[top.key] ?? 'other',
    severity: top.severity,
    occurrence_count: 1,
    visual_reference_path: null,
    mechanical_breakdown: read.headline,
    feel_cue: top.evidence,
    detected_in_shots: [],
    confidence: 'medium',
    primary_fault: POSE_FAULT_TO_PRIMARY[top.key] ?? 'no_dominant_fault',
    evidence: top.evidence,
    strengths: read.strengths,
  };
}
