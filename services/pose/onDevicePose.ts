/**
 * On-device pose backend — Google ML Kit Pose Detection (BlazePose).
 *
 * This is the LOCAL replacement for the cloud /api/pose-analysis call.
 * ML Kit runs on-device and returns 33 landmarks; we map the subset our
 * biomech/tempo pipeline reads onto the COCO-17 names the rest of the
 * code already uses. That keeps `analyzePoseFromUri()` the ONLY swap
 * point — tempo (deriveSwingTempo), biomech (analyzePoseFrames) and the
 * SwingBodyOverlay skeleton all keep working unchanged.
 *
 * Why it can't break existing builds: the native module is loaded
 * OPTIONALLY. In Expo Go — or any build that hasn't included the native
 * module yet — `requireOptionalNativeModule` returns null and
 * `detectOnDevice()` returns null, so `analyzePoseFromUri()` cleanly
 * falls back to the cloud path. No crash, no hard native dependency.
 *
 * Coordinate space: ML Kit returns landmark x/y in SOURCE-IMAGE PIXELS
 * plus the image width/height. We pass those straight through as the
 * PoseFrame's keypoints + frameW/frameH, which is exactly what
 * SwingBodyOverlay's viewBox expects — so the skeleton lands on the body.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Keypoint, PoseFrame } from '../poseAnalysisApi';

/** One landmark as returned by the native ML Kit module. `type` is the
 *  ML Kit PoseLandmark.Type ordinal (0..32); x/y are pixels in the source
 *  image; likelihood is the 0..1 in-frame confidence. */
interface MlkitLandmark {
  type: number;
  x: number;
  y: number;
  likelihood: number;
}
interface MlkitPose {
  width: number;
  height: number;
  landmarks: MlkitLandmark[];
}
interface MlkitPoseModule {
  detectPoseAsync(uri: string): Promise<MlkitPose | null>;
}

/** ML Kit PoseLandmark.Type ordinal → COCO-17 joint name. ML Kit emits 33
 *  BlazePose points (NOSE=0 … RIGHT_FOOT_INDEX=32); we keep only the joints
 *  the pipeline reads and drop the hand/foot/mouth/eye-inner-outer extras.
 *  Ordinals per https://developers.google.com/ml-kit/vision/pose-detection */
const MLKIT_TO_COCO: Readonly<Record<number, string>> = {
  0: 'nose',
  2: 'left_eye',
  5: 'right_eye',
  7: 'left_ear',
  8: 'right_ear',
  11: 'left_shoulder',
  12: 'right_shoulder',
  13: 'left_elbow',
  14: 'right_elbow',
  15: 'left_wrist',
  16: 'right_wrist',
  23: 'left_hip',
  24: 'right_hip',
  25: 'left_knee',
  26: 'right_knee',
  27: 'left_ankle',
  28: 'right_ankle',
};

/** Pure: map raw ML Kit landmarks → our COCO-named Keypoint[]. Exported so
 *  the mapping can be asserted directly (sim/unit). Unmapped landmark types
 *  are skipped; the resulting names match what getKp()/the biomech geometry
 *  and SwingBodyOverlay look up. */
export function mapMlkitToKeypoints(landmarks: MlkitLandmark[]): Keypoint[] {
  const out: Keypoint[] = [];
  for (const lm of landmarks) {
    const name = MLKIT_TO_COCO[lm.type];
    if (!name) continue;
    out.push({
      x: Number(lm.x) || 0,
      y: Number(lm.y) || 0,
      score: Number(lm.likelihood) || 0,
      name,
    });
  }
  return out;
}

// Resolve the native module once. `undefined` = not yet looked up,
// `null` = looked up and absent (Expo Go / not built in).
let cached: MlkitPoseModule | null | undefined;
function nativeModule(): MlkitPoseModule | null {
  if (cached === undefined) {
    cached = requireOptionalNativeModule<MlkitPoseModule>('MlkitPose') ?? null;
  }
  return cached;
}

/** True when the on-device pose module is present in this build. Lets the
 *  UI/diagnostics show "on-device pose" vs "cloud" without a detection run. */
export function isOnDevicePoseAvailable(): boolean {
  return nativeModule() != null;
}

/** Run ML Kit pose on a LOCAL image file (an extracted swing keyframe).
 *  Returns null — so the caller falls back to the cloud path — when the
 *  native module is absent or the uri is a remote http(s) source (ML Kit
 *  reads a local bitmap, not a URL). */
export async function detectOnDevice(imageUri: string, timestampMs: number): Promise<PoseFrame | null> {
  const mod = nativeModule();
  if (!mod) return null;
  if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) return null;
  try {
    const native = await mod.detectPoseAsync(imageUri);
    if (!native || !Array.isArray(native.landmarks) || native.landmarks.length === 0) return null;
    const keypoints = mapMlkitToKeypoints(native.landmarks);
    if (keypoints.length === 0) return null;
    return { timestampMs, keypoints, frameW: native.width, frameH: native.height };
  } catch (e) {
    console.warn('[pose] on-device detect failed', e);
    return null;
  }
}
