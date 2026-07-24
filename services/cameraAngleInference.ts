/**
 * 2026-07-24 (full-app audit, root D) — Infer the camera angle from pose geometry so
 * angle-honesty stops being opt-in per call-site. The turn / weight-shift / sequencing
 * metrics in computeBiomechanics are only valid FACE-ON; from down-the-line the player is
 * seen edge-on and those numbers are geometrically wrong. Callers that don't KNOW the
 * angle (Coach lesson, library uploads) used to pass null → nothing was nulled → invalid
 * numbers were spoken as measured. This reads the ground truth every call site already
 * has: face-on, the shoulders span a WIDE x-extent relative to torso height; down-the-line
 * they collapse to a narrow stacked line.
 *
 * Kept in its own module (type-only import of the frame shapes) so it stays PURE and
 * unit-testable — poseAnalysisApi pulls in expo-video-thumbnails / expo-file-system, which
 * can't load in the plain-node logic test project. See __tests__/logic/camera-angle-inference.
 */
import type { PoseFrame, Keypoint } from './poseAnalysisApi';

/** Score-gated keypoint lookup — mirrors poseAnalysisApi.getKp so the inference and the
 *  metrics agree on which joints are trustworthy. */
function kp(frame: PoseFrame, name: string): Keypoint | null {
  return frame.keypoints.find((k) => k.name === name && k.score > 0.2) ?? null;
}

/**
 * CONSERVATIVE by design — only assert an angle when the signal is unambiguous, else
 * return null (compute as-is, status quo). Never returns glasses_pov (a first-person
 * source the frames can't reveal — that stays an explicit caller flag).
 */
export function inferCameraAngle(frames: PoseFrame[]): 'face_on' | 'down_the_line' | null {
  let maxRatio = 0;
  let sampled = 0;
  for (const f of frames) {
    const ls = kp(f, 'left_shoulder');
    const rs = kp(f, 'right_shoulder');
    const lh = kp(f, 'left_hip');
    const rh = kp(f, 'right_hip');
    if (!ls || !rs || !lh || !rh) continue;
    const shoulderWidthX = Math.abs(rs.x - ls.x);
    const shoulderMidY = (ls.y + rs.y) / 2;
    const hipMidY = (lh.y + rh.y) / 2;
    const torsoHeightY = Math.abs(hipMidY - shoulderMidY);
    if (torsoHeightY <= 0) continue;
    sampled++;
    // MAX across frames: face-on shoulders foreshorten as the body rotates to the top,
    // so the WIDEST frame (address / finish) best reveals true face-on-ness; DTL stays
    // narrow in every frame.
    maxRatio = Math.max(maxRatio, shoulderWidthX / torsoHeightY);
  }
  if (sampled < 2) return null; // not enough clean frames to judge honestly
  if (maxRatio < 0.35) return 'down_the_line'; // clearly stacked/edge-on
  if (maxRatio > 0.60) return 'face_on';        // clearly broad/front-on
  return null;                                  // ambiguous — don't assert
}
