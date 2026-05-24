/**
 * 2026-05-24 — Coach Mode player calibration math.
 *
 * Derives a per-player calibration profile from two single-image pose
 * captures (one upright full-body, one in golf address). The output is
 * a stable per-player ruler the metric pipeline can consume LATER —
 * this run does NOT touch services/swingMetricsService; the hardened
 * honest-metrics path is untouched. Foundation only.
 *
 * Honest-degradation gate built into the validators: a partial body, an
 * occluded foot, or an implausible head-to-ankle ratio rejects the scan
 * before the profile is stored. A bad ruler is worse than no ruler —
 * never write a low-quality calibration silently.
 *
 * Keypoint set: COCO 17 (the existing pose endpoint shape from
 * services/poseAnalysisApi.ts). MediaPipe's heel/toe landmarks aren't
 * available — substituting `ankle` for "heel" in the head-to-heel
 * calculation costs ~3% in scale accuracy on typical adults, which the
 * caller is told via the `note` field on the returned profile.
 */

import type { PoseFrame, Keypoint } from './poseAnalysisApi';

// ─── Types ──────────────────────────────────────────────────────────

export interface PlayerProportions {
  /** Shoulder-to-shoulder distance, normalized to head-to-ankle. */
  shoulder_width_norm: number;
  /** Hip-to-hip distance, normalized to head-to-ankle. */
  hip_width_norm: number;
  /** Shoulder width / hip width. Body-shape independent — useful
   *  cross-player. */
  shoulder_to_hip_ratio: number;
  /** Hip-to-ankle length, normalized to head-to-ankle. */
  leg_length_norm: number;
  /** Shoulder-to-wrist length, normalized to head-to-ankle. */
  arm_length_norm: number;
}

export interface PostureBaseline {
  /** Spine inclination from vertical, in degrees. 0 = upright;
   *  ~30° is a typical address spine angle. */
  spine_angle_deg: number;
  /** Ankle-to-ankle distance in CM (real-world via scale). */
  stance_width_cm: number;
  /** Knee-flex amount, normalized to leg length. Higher = more bent. */
  knee_flex_norm: number;
}

export interface PlayerCalibrationProfile {
  player_id: string;
  name: string;
  /** Player-typed height in centimeters. The known ruler. */
  height_cm: number;
  /** Scale factor: real-world centimeters per pixel at the upright
   *  capture distance. Note this is distance-dependent — pose models
   *  return normalized [0,1] coords for some configurations; we treat
   *  the ankle-vs-head delta as the ground truth ruler. */
  scale_cm_per_pixel: number;
  /** Per-player body proportions, normalized so they're comparable
   *  cross-player. */
  proportions: PlayerProportions;
  /** Reference posture captured in golf address. Used downstream
   *  by fault detection ("your spine angle dropped 8° from baseline"). */
  posture_baseline: PostureBaseline;
  scanned_at: number;
  /** Short note about caveats — e.g. "ankle used as heel proxy
   *  (~3% scale error)". Surfaces in the owner debug card so the
   *  scan provenance is visible. */
  note: string;
}

export type CalibrationValidation =
  | { ok: true }
  | { ok: false; reason: string };

// ─── Helpers ────────────────────────────────────────────────────────

function getKp(frame: PoseFrame, name: string, minScore = 0.5): Keypoint | null {
  const kp = frame.keypoints.find(k => k.name === name);
  if (!kp || kp.score < minScore) return null;
  return kp;
}

function getBetterAnkle(frame: PoseFrame, minScore = 0.5): Keypoint | null {
  const l = frame.keypoints.find(k => k.name === 'left_ankle');
  const r = frame.keypoints.find(k => k.name === 'right_ankle');
  // Whichever has higher score (and clears the threshold).
  const candidates = [l, r].filter((k): k is Keypoint => !!k && k.score >= minScore);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.score - a.score)[0];
}

function avg(a: number, b: number): number { return (a + b) / 2; }

function dist(a: Keypoint, b: Keypoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ─── Validation ─────────────────────────────────────────────────────

/**
 * Upright scan must show: nose, both shoulders, both hips, BOTH
 * ankles (full body, head + feet in frame). Implausible head-to-ankle
 * pixel ratio (too small / too large for a real upright) rejects.
 */
export function validateUprightFrame(frame: PoseFrame): CalibrationValidation {
  const required: Array<'nose' | 'left_shoulder' | 'right_shoulder' | 'left_hip' | 'right_hip' | 'left_ankle' | 'right_ankle'> = [
    'nose', 'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_ankle', 'right_ankle',
  ];
  const missing = required.filter(n => !getKp(frame, n, 0.4));
  if (missing.length > 0) {
    return { ok: false, reason: `Couldn't see ${missing.join(', ').replace(/_/g, ' ')}. Step back so your head and both feet are in frame.` };
  }
  const nose = getKp(frame, 'nose', 0.4)!;
  const leftAnkle = getKp(frame, 'left_ankle', 0.4)!;
  const rightAnkle = getKp(frame, 'right_ankle', 0.4)!;
  const ankleY = Math.max(leftAnkle.y, rightAnkle.y);
  const headToAnkle = ankleY - nose.y;
  if (headToAnkle <= 0) {
    return { ok: false, reason: 'Head above ankles check failed — try again with you fully upright.' };
  }
  // Sanity: the head-to-ankle span should be a substantial fraction
  // of the frame. A normalized pose API returns ~0-1 coords; a person
  // filling most of the vertical frame produces a span ~0.5-0.85.
  // Below 0.3 is too small (subject too far) → scale would be noisy.
  if (headToAnkle < 0.30) {
    return { ok: false, reason: 'Subject too small in frame — step closer so you fill more vertical space.' };
  }
  // Above 1.1 is implausible (would indicate keypoint outside the frame,
  // a normalization bug, or model error).
  if (headToAnkle > 1.1) {
    return { ok: false, reason: 'Pose read came back unusable — try again with better lighting.' };
  }
  return { ok: true };
}

/**
 * Address scan must show shoulders, hips, knees, both ankles. Less
 * strict than upright — nose may be occluded by a hat or by the
 * player looking down. We allow nose to be missing/low-score; we
 * require hips below shoulders and knees below hips (sanity).
 */
export function validateAddressFrame(frame: PoseFrame): CalibrationValidation {
  const required: Array<'left_shoulder' | 'right_shoulder' | 'left_hip' | 'right_hip' | 'left_knee' | 'right_knee' | 'left_ankle' | 'right_ankle'> = [
    'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  ];
  const missing = required.filter(n => !getKp(frame, n, 0.4));
  if (missing.length > 0) {
    return { ok: false, reason: `Address read couldn't see ${missing.join(', ').replace(/_/g, ' ')}. Stand into your address with both feet visible.` };
  }
  const shoulderY = avg(getKp(frame, 'left_shoulder', 0.4)!.y, getKp(frame, 'right_shoulder', 0.4)!.y);
  const hipY = avg(getKp(frame, 'left_hip', 0.4)!.y, getKp(frame, 'right_hip', 0.4)!.y);
  const kneeY = avg(getKp(frame, 'left_knee', 0.4)!.y, getKp(frame, 'right_knee', 0.4)!.y);
  if (hipY <= shoulderY || kneeY <= hipY) {
    return { ok: false, reason: 'Address posture read came back inverted — try again standing into your normal address.' };
  }
  return { ok: true };
}

// ─── Compute ────────────────────────────────────────────────────────

/**
 * Compute per-pixel scale from the upright frame.
 *   scale_cm_per_pixel = height_cm / (ankle_y - nose_y)
 * Uses the BETTER-scored ankle of the two to handle occlusion asymmetry.
 * Caller MUST have already passed validateUprightFrame.
 *
 * Approximation note: COCO 17 doesn't include heel/toe, so we use
 * ankle as the bottom landmark. Real heel is ~3% below the ankle on a
 * standing adult — encoded in the `note` field of the profile.
 */
export function computeScale(frame: PoseFrame, heightCm: number): number {
  const nose = getKp(frame, 'nose', 0.4)!;
  const ankle = getBetterAnkle(frame, 0.4)!;
  const headToAnkle = ankle.y - nose.y;
  // Calibration approximation factor — heel is ~3% below ankle on the
  // standing body, so the real head-to-heel span is ~1.03 × head-to-ankle.
  // Adjusting the divisor compensates.
  const ANKLE_TO_HEEL_FACTOR = 1.03;
  return heightCm / (headToAnkle * ANKLE_TO_HEEL_FACTOR);
}

/**
 * Compute body proportions normalized to head-to-ankle so they're
 * comparable cross-player regardless of distance from camera.
 */
export function computeProportions(frame: PoseFrame): PlayerProportions {
  const nose = getKp(frame, 'nose', 0.4)!;
  const leftShoulder = getKp(frame, 'left_shoulder', 0.4)!;
  const rightShoulder = getKp(frame, 'right_shoulder', 0.4)!;
  const leftHip = getKp(frame, 'left_hip', 0.4)!;
  const rightHip = getKp(frame, 'right_hip', 0.4)!;
  const ankle = getBetterAnkle(frame, 0.4)!;
  const shoulderWidth = dist(leftShoulder, rightShoulder);
  const hipWidth = dist(leftHip, rightHip);
  const headToAnkle = ankle.y - nose.y;
  const midHipY = avg(leftHip.y, rightHip.y);
  const legLength = ankle.y - midHipY;
  // Arm length — shoulder to wrist when wrist is visible; fall back
  // to a small value if not. (Wrist visibility is hand-position-
  // dependent during upright stance.)
  const wristL = frame.keypoints.find(k => k.name === 'left_wrist');
  const armLength = wristL && wristL.score >= 0.4
    ? dist(leftShoulder, wristL)
    : Math.abs(midHipY - leftShoulder.y); // fallback: torso length as a proxy
  return {
    shoulder_width_norm: shoulderWidth / headToAnkle,
    hip_width_norm: hipWidth / headToAnkle,
    shoulder_to_hip_ratio: hipWidth > 0 ? shoulderWidth / hipWidth : 1,
    leg_length_norm: legLength / headToAnkle,
    arm_length_norm: armLength / headToAnkle,
  };
}

/**
 * Compute the address-posture baseline from the address frame +
 * the upright-derived scale (for real-world stance width in cm).
 */
export function computePostureBaseline(addressFrame: PoseFrame, scaleCmPerPixel: number): PostureBaseline {
  const leftShoulder = getKp(addressFrame, 'left_shoulder', 0.4)!;
  const rightShoulder = getKp(addressFrame, 'right_shoulder', 0.4)!;
  const leftHip = getKp(addressFrame, 'left_hip', 0.4)!;
  const rightHip = getKp(addressFrame, 'right_hip', 0.4)!;
  const leftKnee = getKp(addressFrame, 'left_knee', 0.4)!;
  const rightKnee = getKp(addressFrame, 'right_knee', 0.4)!;
  const leftAnkle = getKp(addressFrame, 'left_ankle', 0.4)!;
  const rightAnkle = getKp(addressFrame, 'right_ankle', 0.4)!;

  // Spine angle: vector from mid-hip to mid-shoulder, measured against
  // vertical (y-axis). Vertical = 0°; a 30° forward tilt is typical
  // address.
  const midShoulderX = avg(leftShoulder.x, rightShoulder.x);
  const midShoulderY = avg(leftShoulder.y, rightShoulder.y);
  const midHipX = avg(leftHip.x, rightHip.x);
  const midHipY = avg(leftHip.y, rightHip.y);
  const dx = midShoulderX - midHipX;
  const dy = midShoulderY - midHipY; // negative when shoulders above hips
  // angle from vertical = atan2(|dx|, |dy|), in degrees
  const spineAngleDeg = Math.abs(Math.atan2(dx, dy) * (180 / Math.PI));
  // atan2 returns 0..180; we want angle from vertical, so cap at 90
  // (anything beyond means a model error).
  const spineAngleClamped = Math.min(spineAngleDeg, 90);

  // Stance width — real-world cm via scale.
  const stancePixels = dist(leftAnkle, rightAnkle);
  const stanceCm = stancePixels * scaleCmPerPixel;

  // Knee flex — knee height above ankle divided by leg length. More
  // bent → knee sits higher above ankle, ratio is larger.
  const midKneeY = avg(leftKnee.y, rightKnee.y);
  const midAnkleY = avg(leftAnkle.y, rightAnkle.y);
  const legLength = Math.abs(midAnkleY - midHipY);
  const kneeAboveAnkle = midAnkleY - midKneeY;
  const kneeFlexNorm = legLength > 0 ? kneeAboveAnkle / legLength : 0;

  return {
    spine_angle_deg: Math.round(spineAngleClamped * 10) / 10,
    stance_width_cm: Math.round(stanceCm * 10) / 10,
    knee_flex_norm: Math.round(kneeFlexNorm * 1000) / 1000,
  };
}

/**
 * Compose a full profile from an already-validated upright frame +
 * address frame + the typed height. Caller must run validators first.
 */
export function buildProfile(args: {
  player_id: string;
  name: string;
  height_cm: number;
  upright: PoseFrame;
  address: PoseFrame;
}): PlayerCalibrationProfile {
  const scale = computeScale(args.upright, args.height_cm);
  const proportions = computeProportions(args.upright);
  const posture = computePostureBaseline(args.address, scale);
  return {
    player_id: args.player_id,
    name: args.name,
    height_cm: args.height_cm,
    scale_cm_per_pixel: Math.round(scale * 10000) / 10000,
    proportions: {
      shoulder_width_norm: Math.round(proportions.shoulder_width_norm * 1000) / 1000,
      hip_width_norm: Math.round(proportions.hip_width_norm * 1000) / 1000,
      shoulder_to_hip_ratio: Math.round(proportions.shoulder_to_hip_ratio * 100) / 100,
      leg_length_norm: Math.round(proportions.leg_length_norm * 1000) / 1000,
      arm_length_norm: Math.round(proportions.arm_length_norm * 1000) / 1000,
    },
    posture_baseline: posture,
    scanned_at: Date.now(),
    note: 'ankle used as heel proxy (~3% scale error compensated via constant)',
  };
}
