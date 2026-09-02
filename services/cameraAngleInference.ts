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
  /**
   * 2026-09-01 (Tim — "the club arc shows up sporadically and mostly incorrect… it may get the
   * direction right, but it looks like it's behind the user. I think our down-the-line versus
   * face-on guards may be weak") — HE WAS RIGHT, AND DOWN-THE-LINE WAS EFFECTIVELY UNREACHABLE.
   *
   * The classifier took the MAX shoulder-span ratio ACROSS THE WHOLE SWING, on the reasoning that
   * "face-on shoulders foreshorten as the body rotates to the top, so the WIDEST frame best reveals
   * true face-on-ness; DTL stays narrow in every frame."
   *
   * The last clause is false, and it is false at exactly one position: THE FINISH. A down-the-line
   * camera sits behind the player looking along the target line. At address the shoulder line is
   * parallel to that line — stacked in depth, narrow in x, which is what the detector expects. At the
   * finish the player's chest faces the TARGET, so the shoulder line is now perpendicular to the
   * camera's view axis and spans its full real width. A DTL finish is one of the WIDEST frames in the
   * clip.
   *
   * Because the sampler always includes P10_finish, maxRatio for a real down-the-line swing landed
   * above the 0.60 face-on edge, so `down_the_line` could essentially never be returned for a
   * recorded swing — a branch that reads as a working classifier and cannot fire.
   *
   * AND THERE IS NO LONGER A HUMAN BACKSTOP. The DTL/face-on toggle was removed on 08-19 (Tim:
   * "having to add face on versus down the line is going to mess people up… is it viable to just make
   * it auto detect every time and take out the settings?"), precisely because this detector reads a
   * fact rather than a preference. So this function is now the ONLY source of the angle. The live
   * preview loop gets it RIGHT — it samples while the player is standing at address, which is exactly
   * the discriminating moment — and then the post-recording read, taken over the whole swing,
   * overwrote that correct answer with face_on.
   *
   * Downstream that is the club arc Tim is describing: the path read is DTL-only, and the swing was
   * being scored with face-on geometry. [[a-guard-can-enforce-a-stale-premise]]
   *
   * THE FIX IS THE POSITION, NOT THE THRESHOLD. Address is the only moment where the two angles are
   * unambiguous and stable: face-on the chest is square to the camera (wide), down-the-line it is
   * edge-on (narrow). Every later position rotates and stops discriminating. So when the frames carry
   * swing-position labels, judge on the SETUP SIDE only. Live-preview frames carry no labels and are
   * all at address anyway, so they fall through unchanged.
   */
  const setupSide = frames.filter((f) => f.position === 'P1_address' || f.position === 'P2_takeaway');
  const pool = setupSide.length >= 2 ? setupSide : frames.some((f) => f.position) ? setupSide : frames;

  let maxRatio = 0;
  let sampled = 0;
  for (const f of pool) {
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
