/**
 * 2026-05-23 — MediaPipe Pose Landmarker JS service.
 *
 * Thin wrapper around NativeModules.MediaPipePose. Translates the
 * BlazePose 33-landmark output into the existing COCO-17 PoseFrame
 * shape that poseAnalysisApi + poseEstimator + swingComparisonEngine
 * already consume — so downstream consumers don't have to know
 * whether the keypoints came from the on-device model or the cloud
 * proxy.
 *
 * Public API:
 *   - isMediaPipeAvailable() — true when the native module is linked
 *     (after a build that included withMediaPipePose.js).
 *   - detectPoseFromBase64(b64, opts?) — one-shot pose detection on a
 *     single JPEG/PNG frame, returns a PoseFrame compatible with the
 *     existing biomechanics pipeline. Returns null when the model
 *     didn't find a pose OR the native call failed.
 *   - detectPoseFromUri(uri, opts?) — convenience wrapper that reads
 *     the local file as base64 first.
 *   - getMediaPipeStatus() — { available, modelLoaded, loadedQuality,
 *     lastInferenceMs } for the status badge.
 *
 * Battery / thermal:
 *   - Default quality is 'full' (~9 MB model, balanced precision/perf).
 *   - Callers can override with opts.quality = 'lite' for live-preview
 *     scenarios where 3x speed beats half the precision.
 *   - The bridge listens to AppState transitions and auto-degrades to
 *     'lite' in background — matches the DAT bridge throttle pattern.
 *
 * Backward compatibility:
 *   - When the native module is null (web, pre-build, or model file
 *     missing), every public function collapses to a null/false
 *     return. Callers should check isMediaPipeAvailable() OR treat
 *     null as "try cloud fallback" — exactly the seam poseEstimator
 *     already has for cloud failures.
 */

import { NativeModules, AppState, type AppStateStatus } from 'react-native';
import { devLog } from './devLog';
import type { Keypoint, PoseFrame } from './poseAnalysisApi';

// ─── Types ───────────────────────────────────────────────────────────

export type MPQuality = 'lite' | 'full' | 'heavy';

export interface MediaPipeLandmark {
  x: number;        // normalized 0..1, image-relative
  y: number;        // normalized 0..1
  z: number;        // depth, relative
  visibility: number; // 0..1 — model confidence the joint is in-frame
  presence: number;   // 0..1 — model confidence the joint is detected
}

export interface MediaPipePoseResult {
  poseFound: boolean;
  landmarks: MediaPipeLandmark[];   // 33 entries when poseFound
  worldLandmarks: MediaPipeLandmark[]; // 0 or 33 entries; world-space
  inferenceMs: number;
}

export interface MediaPipeStatus {
  available: boolean;
  modelLoaded: boolean;
  loadedQuality: MPQuality;
  lastInferenceMs: number;
}

interface DetectOptions {
  quality?: MPQuality;
  /** When true, the returned PoseFrame includes the raw 33-landmark
   *  array alongside the COCO-17 projection. Use sparingly — adds
   *  ~3 KB of JSON per frame. */
  includeRawLandmarks?: boolean;
  /** 2026-05-23 — When true, runs the glasses-POV post-processing
   *  pass (zeros torso joint scores when the torso isn't reliably
   *  in frame). Callers that know the source is head-mounted set
   *  this true. Default false — auto-detection still happens inside
   *  the pass via the torso visibility threshold. */
  povHint?: boolean;
}

interface NativeMP {
  detectPoseFromFrame(b64: string, options: { quality?: MPQuality } | null): Promise<MediaPipePoseResult>;
  getStatus(): Promise<MediaPipeStatus>;
  startContinuousDetection(quality: MPQuality): Promise<void>;
  stopContinuousDetection(): Promise<void>;
  close(): Promise<void>;
}

const NativeMod: NativeMP | null =
  ((NativeModules as Record<string, unknown>).MediaPipePose as NativeMP | undefined) ?? null;

// Effective quality flips down when the app is backgrounded. Bridge
// reads this when calling into the native module.
let preferredQuality: MPQuality = 'full';
let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
function ensureAppStateListener(): void {
  if (appStateSub || !NativeMod) return;
  appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
    devLog(`[mediaPipe] app state → ${next}`);
  });
}

function effectiveQuality(requested: MPQuality | undefined): MPQuality {
  const base = requested ?? preferredQuality;
  if (AppState.currentState !== 'active') {
    // Background → drop to lite regardless of caller request.
    return 'lite';
  }
  return base;
}

// ─── Public API ──────────────────────────────────────────────────────

export function isMediaPipeAvailable(): boolean {
  return NativeMod !== null;
}

export async function getMediaPipeStatus(): Promise<MediaPipeStatus> {
  if (!NativeMod) {
    return { available: false, modelLoaded: false, loadedQuality: 'full', lastInferenceMs: 0 };
  }
  try {
    return await NativeMod.getStatus();
  } catch (e) {
    devLog('[mediaPipe] getStatus failed: ' + String(e));
    return { available: true, modelLoaded: false, loadedQuality: 'full', lastInferenceMs: 0 };
  }
}

export function setPreferredQuality(q: MPQuality): void {
  preferredQuality = q;
  devLog(`[mediaPipe] preferredQuality=${q}`);
}

/**
 * One-shot pose detection on a single base64-encoded frame.
 * Returns the COCO-17-shaped PoseFrame (consumable by
 * poseAnalysisApi.computeBiomechanics + swingComparisonEngine) OR
 * null when no pose was found / native call failed.
 */
export async function detectPoseFromBase64(
  b64: string,
  opts?: DetectOptions,
  timestampMs: number = 0,
): Promise<PoseFrame | null> {
  if (!NativeMod) return null;
  ensureAppStateListener();
  const quality = effectiveQuality(opts?.quality);
  try {
    const result = await NativeMod.detectPoseFromFrame(b64, { quality });
    if (!result.poseFound || result.landmarks.length === 0) {
      devLog(`[mediaPipe] no pose detected (inferenceMs=${result.inferenceMs})`);
      return null;
    }
    const keypoints = projectBlazePoseToCoco17(result.landmarks);
    let frame: PoseFrame = { timestampMs, keypoints };
    // 2026-05-23 — Always run the glasses-POV post-processing pass.
    // It's a no-op when the torso is in frame (cheapest possible
    // path), and zeroes torso scores when it isn't. povHint just
    // forces the pass unconditionally — useful when the caller
    // already knows the frame came from glasses.
    if (opts?.povHint || true) {
      frame = postProcessForGlassesPOV(frame);
    }
    devLog(`[mediaPipe] detect ok quality=${quality} ms=${result.inferenceMs} usable=${countUsable(frame.keypoints)}/17`);
    return frame;
  } catch (e) {
    devLog('[mediaPipe] detectPoseFromBase64 failed: ' + String(e));
    return null;
  }
}

/**
 * Convenience wrapper: reads the file:// URI as base64 + delegates.
 * Returns null on any failure — caller falls back to cloud pose.
 */
export async function detectPoseFromUri(
  uri: string,
  opts?: DetectOptions,
  timestampMs: number = 0,
): Promise<PoseFrame | null> {
  if (!NativeMod) return null;
  try {
    const FS = await import('expo-file-system/legacy');
    const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
    if (!b64) return null;
    return await detectPoseFromBase64(b64, opts, timestampMs);
  } catch (e) {
    devLog('[mediaPipe] detectPoseFromUri failed: ' + String(e));
    return null;
  }
}

/**
 * 2026-05-23 — Glasses-POV post-processing. When the source frame is
 * known to be from a head-mounted camera (Ray-Ban Meta glasses), the
 * BlazePose model often "finds" a person from the player's own arms
 * + hands + a sliver of leg at the bottom of the frame — but the
 * torso is fundamentally NOT in view. The keypoints it produces for
 * shoulders/hips are then guesses with low presence scores.
 *
 * This pass walks the keypoints and zeros the score on torso joints
 * (left/right shoulder, left/right hip) when the average shoulder +
 * hip visibility falls below the POV threshold. The downstream
 * biomechanics pipeline already treats score=0 as "missing" and skips
 * the metric — so this pass effectively tells the pipeline "don't
 * try to compute hip turn or shoulder coil from a POV frame; the
 * data isn't there." Hands / wrists / arms keypoints stay intact —
 * those ARE in frame and ARE useful for grip + takeaway reads.
 *
 * Caller marks a frame as POV by passing source='glasses' OR by
 * setting opts.povHint=true when they know the source independently.
 * No-op when neither signal is present.
 */
const POV_TORSO_THRESHOLD = 0.30;
const TORSO_JOINTS = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'] as const;

export function postProcessForGlassesPOV(frame: PoseFrame): PoseFrame {
  let torsoScoreSum = 0;
  let torsoCount = 0;
  for (const k of frame.keypoints) {
    if (k.name && (TORSO_JOINTS as readonly string[]).includes(k.name)) {
      torsoScoreSum += k.score;
      torsoCount++;
    }
  }
  if (torsoCount === 0) return frame;
  const avg = torsoScoreSum / torsoCount;
  if (avg >= POV_TORSO_THRESHOLD) return frame; // torso clearly visible — leave alone
  // Torso visibility low — likely a head-mounted POV frame. Zero the
  // torso scores so downstream metric computation skips hip turn /
  // shoulder coil / weight shift cleanly. Arms + hands stay usable.
  devLog(`[mediaPipe] glasses-POV detected (avg torso visibility=${avg.toFixed(2)}); zeroing torso scores`);
  return {
    ...frame,
    keypoints: frame.keypoints.map((k) =>
      k.name && (TORSO_JOINTS as readonly string[]).includes(k.name)
        ? { ...k, score: 0 }
        : k,
    ),
  };
}

/**
 * Multi-frame smoothing helper. Given N PoseFrames sampled close
 * together (typically the 5 keyframes of a single swing), produces a
 * single "best-of" frame per anchor position where each keypoint is
 * picked from the frame with the highest score for that joint.
 *
 * Practical use: when MediaPipe momentarily loses a hip at one
 * keyframe but holds it at the adjacent one, smoothing recovers a
 * usable composite without falling all the way back to cloud.
 *
 * Caller still receives the per-frame array AS WELL — this just
 * returns the smoothed composite for callers that want a single
 * "representative" frame. The biomechanics pipeline still consumes
 * the per-frame array; smoothing is for surfaces that render ONE
 * skeleton overlay.
 */
export function smoothPoseFrames(frames: PoseFrame[]): PoseFrame | null {
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0];
  // For each of the 17 COCO joints, pick the frame whose keypoint had
  // the highest score. Falls back to the first frame's value when no
  // joint was usable across the stack.
  const composite: Keypoint[] = [];
  const sample = frames[0].keypoints;
  for (let i = 0; i < sample.length; i++) {
    let best: Keypoint | null = null;
    for (const f of frames) {
      const k = f.keypoints[i];
      if (!k) continue;
      if (!best || k.score > best.score) best = k;
    }
    composite.push(best ?? sample[i]);
  }
  return { timestampMs: frames[Math.floor(frames.length / 2)].timestampMs, keypoints: composite };
}

// ─── Translation: 33-landmark BlazePose → 17-keypoint COCO ──────────

// BlazePose indices (subset relevant to our biomechanics):
// 0  nose
// 11 left_shoulder      12 right_shoulder
// 13 left_elbow         14 right_elbow
// 15 left_wrist         16 right_wrist
// 23 left_hip           24 right_hip
// 25 left_knee          26 right_knee
// 27 left_ankle         28 right_ankle
// 2/5 left_eye/right_eye (the L+R inner-eye pair) — we map to COCO L/R eye
// 7/8 left_ear/right_ear
//
// The result mirrors COCO_17 order in poseAnalysisApi.ts so that file's
// `normalizeKeypoints` consumes our output without changes.
const BLAZEPOSE_TO_COCO17: Array<{ name: string; blazeIdx: number }> = [
  { name: 'nose',           blazeIdx: 0 },
  { name: 'left_eye',       blazeIdx: 2 },
  { name: 'right_eye',      blazeIdx: 5 },
  { name: 'left_ear',       blazeIdx: 7 },
  { name: 'right_ear',      blazeIdx: 8 },
  { name: 'left_shoulder',  blazeIdx: 11 },
  { name: 'right_shoulder', blazeIdx: 12 },
  { name: 'left_elbow',     blazeIdx: 13 },
  { name: 'right_elbow',    blazeIdx: 14 },
  { name: 'left_wrist',     blazeIdx: 15 },
  { name: 'right_wrist',    blazeIdx: 16 },
  { name: 'left_hip',       blazeIdx: 23 },
  { name: 'right_hip',      blazeIdx: 24 },
  { name: 'left_knee',      blazeIdx: 25 },
  { name: 'right_knee',     blazeIdx: 26 },
  { name: 'left_ankle',     blazeIdx: 27 },
  { name: 'right_ankle',    blazeIdx: 28 },
];

function projectBlazePoseToCoco17(landmarks: MediaPipeLandmark[]): Keypoint[] {
  return BLAZEPOSE_TO_COCO17.map(({ name, blazeIdx }) => {
    const lm = landmarks[blazeIdx];
    if (!lm) {
      return { x: 0, y: 0, score: 0, name };
    }
    // Use min(visibility, presence) as the combined confidence — both
    // must be high for a keypoint to be trusted. Conservative against
    // the BlazePose "I see SOMETHING here but I'm not sure what" case
    // where presence is high but visibility is low.
    const score = Math.min(lm.visibility, lm.presence);
    return {
      x: lm.x,
      y: lm.y,
      score,
      name,
    };
  });
}

function countUsable(keypoints: Keypoint[]): number {
  return keypoints.filter((k) => k.score >= 0.3).length;
}
