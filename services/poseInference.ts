/**
 * Pose inference service — typed seam for MediaPipe / MoveNet keypoint
 * extraction.
 *
 * Phase AP follow-up: this is the SCAFFOLD ship. The seam exists, the
 * types are stable, the cage flow consumes the output. The actual model
 * inference is a placeholder that returns null until the TFJS install
 * commit lands (which adds @tensorflow/tfjs, @tensorflow/tfjs-react-native,
 * @tensorflow-models/pose-detection, expo-gl).
 *
 * Why a seam first: TFJS adds ~10MB of deps + a native expo-gl module
 * that has had New-Arch compatibility issues. Track-player was removed
 * for the same reason earlier in v1.0. Shipping the integration shape
 * separately from the install lets the build risk be a focused decision
 * point rather than buried inside a scaffold commit.
 *
 * Once TFJS is installed, the only change needed is to replace the
 * placeholder body of `detectPose` with the actual MoveNet call.
 *
 * Keypoint schema matches MoveNet SinglePose Lightning output:
 * 17 keypoints, COCO ordering. Coordinates normalised to 0-1 across the
 * input frame so consumers can scale to any render width/height.
 */

export type KeypointName =
  | 'nose'
  | 'left_eye' | 'right_eye'
  | 'left_ear' | 'right_ear'
  | 'left_shoulder' | 'right_shoulder'
  | 'left_elbow' | 'right_elbow'
  | 'left_wrist' | 'right_wrist'
  | 'left_hip' | 'right_hip'
  | 'left_knee' | 'right_knee'
  | 'left_ankle' | 'right_ankle';

export const KEYPOINT_NAMES: KeypointName[] = [
  'nose',
  'left_eye', 'right_eye',
  'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder',
  'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist',
  'left_hip', 'right_hip',
  'left_knee', 'right_knee',
  'left_ankle', 'right_ankle',
];

export interface Keypoint {
  name: KeypointName;
  /** 0-1 normalized x across the input frame width. */
  x: number;
  /** 0-1 normalized y across the input frame height. */
  y: number;
  /** 0-1 detector confidence; consumers can threshold (~0.3 typical). */
  score: number;
}

/**
 * Skeleton edges for drawing — pairs of keypoint names that connect
 * visually in the rendered overlay. Uses MediaPipe / COCO convention.
 */
export const SKELETON_EDGES: [KeypointName, KeypointName][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
];

export type DetectPoseResult =
  | { kind: 'ok'; keypoints: Keypoint[] }
  | { kind: 'no_pose' }
  | { kind: 'not_loaded' }
  | { kind: 'error'; message: string };

/**
 * Detect pose keypoints in a single image (file URI to a JPEG / PNG).
 *
 * SCAFFOLD: returns { kind: 'not_loaded' } until the TFJS install commit
 * lands. After install, replace this body with:
 *
 *   import * as tf from '@tensorflow/tfjs';
 *   import * as poseDetection from '@tensorflow-models/pose-detection';
 *   import * as FileSystem from 'expo-file-system';
 *
 *   await tf.ready();
 *   const detector = await poseDetection.createDetector(
 *     poseDetection.SupportedModels.MoveNet,
 *     { modelType: 'SinglePose.Lightning' },
 *   );
 *   const imageBytes = await FileSystem.readAsStringAsync(uri, {
 *     encoding: FileSystem.EncodingType.Base64,
 *   });
 *   const tensor = decodeJpeg(Buffer.from(imageBytes, 'base64'));
 *   const poses = await detector.estimatePoses(tensor);
 *   tensor.dispose();
 *   if (poses.length === 0) return { kind: 'no_pose' };
 *   const keypoints = poses[0].keypoints.map(k => ({
 *     name: k.name as KeypointName,
 *     x: k.x / tensor.shape[1],
 *     y: k.y / tensor.shape[0],
 *     score: k.score ?? 0,
 *   }));
 *   return { kind: 'ok', keypoints };
 */
export async function detectPose(_imageUri: string): Promise<DetectPoseResult> {
  // SCAFFOLD ship — model not yet bundled. See header comment for the
  // post-TFJS-install replacement body.
  return { kind: 'not_loaded' };
}

/**
 * Convenience: filter low-confidence keypoints. Default threshold 0.3
 * matches MoveNet SinglePose Lightning's typical floor for usable
 * detections.
 */
export function filterByConfidence(keypoints: Keypoint[], minScore = 0.3): Keypoint[] {
  return keypoints.filter(k => k.score >= minScore);
}

/**
 * Convenience: lookup a specific keypoint by name. Returns null if the
 * keypoint is missing or below the confidence threshold.
 */
export function getKeypoint(
  keypoints: Keypoint[],
  name: KeypointName,
  minScore = 0.3,
): Keypoint | null {
  const k = keypoints.find(p => p.name === name);
  if (!k || k.score < minScore) return null;
  return k;
}
