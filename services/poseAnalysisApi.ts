/**
 * Client-side pose analysis helpers.
 *
 * Wraps /api/pose-analysis. Two surfaces:
 *   - analyzePoseFromUri(uri) — runs pose detection on a single image
 *     (typically an extracted swing keyframe) and returns normalized
 *     keypoints.
 *   - analyzeSwingFromVideo(videoUri) — extracts 8 swing-position
 *     keyframes via expo-video-thumbnails, runs pose detection on each,
 *     and aggregates into a SwingBiomechanics summary (hip turn,
 *     shoulder coil, weight shift, posture, etc).
 *
 * Defensive: every failure path returns null. Caller (videoUpload,
 * swing detail card) renders a placeholder when null. Pose API can be
 * 502-flaky in our experience; never block the upload pipeline on it.
 */

// 2026-07-30 (analysis audit C4) — route through the app-wide single-flight queue (utils/videoThumbnail),
// NOT raw expo-video-thumbnails. Pose extraction was the only bypass left, so it could run a native
// retriever concurrently with any wrapped extractor (clubPath/ballPath/…) → the multi-instance
// MediaMetadataRetriever OOM/SIGSEGV the queue exists to prevent. Drop-in: identical getThumbnailAsync.
import * as VideoThumbnails from '../utils/videoThumbnail';
import * as FileSystem from 'expo-file-system/legacy';
import { getApiBaseUrl } from './apiBase';
import { inferCameraAngle } from './cameraAngleInference';
import { rejectImplausible } from './swing/biomechPlausibility';

const apiUrl = (): string => getApiBaseUrl();

// ─── Types ────────────────────────────────────────────────────────────────────

/** Single keypoint as returned by most pose APIs (normalized 0–1 OR
 *  pixel-absolute depending on the provider). Score is the model's
 *  confidence in this joint (typically 0–1). */
export interface Keypoint {
  x: number;
  y: number;
  score: number;
  /** Optional joint name (e.g. "left_shoulder"). Keypoint indices for
   *  COCO 17-point models are well-known; we map indices→names below. */
  name?: string;
}

/** Single-frame pose detection result. Empty `keypoints` = no person
 *  detected (common cause: subject too small in frame, occlusion). */
export interface PoseFrame {
  /** When this frame was sampled relative to the source video, in ms. */
  timestampMs: number;
  /** Position label if the frame matches a canonical PGA swing position. */
  position?: 'P1_address' | 'P2_takeaway' | 'P4_top' | 'P6_impact' | 'P10_finish';
  /**
   * 2026-09-01 (Tim — "make sure we have dialed in being able to find the different important parts
   * of the swing in the analysis") — HOW THE LABEL ABOVE WAS ARRIVED AT.
   *
   *   'strike'    — anchored to a heard strike. P6_impact IS the impact; the rest sit at swing-physics
   *                 offsets around it. This is a measurement.
   *   'estimated' — placed at a FIXED FRACTION of the clip or window (P6_impact at 0.65, P4_top at
   *                 0.50). Nothing was detected. The label names where impact USUALLY falls, which on
   *                 any given swing can be hundreds of milliseconds off.
   *
   * The two were indistinguishable, and that is a live defect rather than a documentation gap: a
   * consumer reading `frames.find(f => f.position === 'P6_impact').timestampMs` and treating it as an
   * impact time is trusting a fraction. clubPathWindow refuses the synthesized 0.6*duration strike
   * offset for exactly this reason and was accepting the pose label — the same fabrication wearing a
   * different name. [[a-field-that-is-sometimes-a-placeholder]] [[illustration-data-points]]
   */
  positionSource?: 'strike' | 'estimated';
  keypoints: Keypoint[];
  /** Source frame pixel dimensions (from the extracted thumbnail). Lets the
   *  overlay build a viewBox at the TRUE frame aspect ratio so joints land
   *  on the body instead of being stretched to fill the container. Optional
   *  for backward-compat with swings analyzed before this was captured. */
  frameW?: number;
  frameH?: number;
}

/** Biomechanics summary computed from 5–8 keyframes of a single swing.
 *  Each metric is a number plus a one-line verdict the UI shows
 *  alongside it. Null fields mean we couldn't compute (e.g. pose API
 *  failed for that keyframe).
 *
 *  Practical metrics only — see header note. We do not attempt full IK
 *  or 3D body reconstruction from a single-camera 2D feed; the metrics
 *  below all reduce to "what can a coach reliably eyeball from this
 *  angle?" Newer fields are optional so older persisted biomechanics
 *  in cageStore / swingDatabase remain backward-compatible. */
export interface SwingBiomechanics {
  /** Hip rotation degrees from address to top of backswing. */
  hipTurnDeg: number | null;
  /** Shoulder turn degrees (coil) from address to top. */
  shoulderTurnDeg: number | null;
  /** 2026-05-22 audit refinement — Shoulder TILT degrees at top.
   *  Distinct from shoulderTurnDeg: tilt is the lead-shoulder dip
   *  (how much the lead shoulder drops below the trail shoulder at
   *  the top of the backswing) — a tour-standard ~30° tilt
   *  indicates proper spine-angle preservation. Low tilt (flat
   *  shoulders) signals an over-the-top / lifted swing pattern. */
  shoulderTiltDeg?: number | null;
  /** Lead-foot weight shift at impact, in % (positive = forward). */
  weightShiftPct: number | null;
  /** Spine angle change from address to impact, in degrees. */
  spineAngleDeltaDeg: number | null;
  /**
   * Head-position drift from address to impact, SIGNED, as a fraction of SHOULDER WIDTH.
   *
   * 2026-08-24 — this said "normalized to image height — multiply by frame height for absolute".
   * It never was: the computation divides the nose's x-change by the address shoulder width. Anyone
   * who followed the old note and multiplied by frame height got a meaningless number, and it did
   * mislead the first version of the plausibility band written against it.
   */
  headDriftPxNorm: number | null;
  /** Hip slide vs rotate ratio at top. >1 = sliding more than rotating. */
  hipSlideRatio: number | null;
  /** 2026-05-22 audit refinement — Sequencing score 0..100. Higher
   *  number = hips initiate the downswing before shoulders (the tour
   *  "kinematic sequence" hallmark). Lower number = shoulders initiate
   *  (over-the-top / steep pattern). Computed from the relative
   *  rotation rates between P4_top and P6_impact. Null when we don't
   *  have both frames or hip/shoulder widths needed to read it. */
  sequencingScore?: number | null;
  /** 2026-08-09 (elite fault engine) — lead-arm elbow angle (deg; 180 = straight) at the TOP of the
   *  backswing. Below ~150° = a bent lead arm (collapsed radius). null when the arm keypoints weren't
   *  cleanly tracked. */
  leadArmTopDeg?: number | null;
  /** Lead-arm elbow angle (deg) through impact/early follow-through. Below ~150° = chicken wing
   *  (loss of extension). */
  leadArmImpactDeg?: number | null;
  /** Hip-midpoint lateral translation address→top as a FRACTION of shoulder width (scale-invariant).
   *  ~0.20+ = swaying off the ball. Replaces the unreliable hipSlideRatio for the sway fault. */
  swayNorm?: number | null;
  /** Weight-through onto the lead side at the FINISH frame (%; same proxy as weightShift). Low/negative
   *  = a fall-back / incomplete finish. */
  finishWeightPct?: number | null;
  /** 2026-06-10 — camera angle this read was computed for. The pose pipeline is
   *  angle-aware: the width-foreshortening turn metrics + the lateral-x weight
   *  shift are nulled for down-the-line (that geometry makes them invalid from
   *  behind), so we never report a number the angle can't honestly measure. */
  angle?: 'down_the_line' | 'face_on' | 'glasses_pov' | null;
  /** Per-frame pose data we computed metrics from. Empty when the API
   *  failed entirely. UI uses this to render a skeleton overlay later. */
  frames: PoseFrame[];
  /** Tour-standard comparison verdict per metric. */
  verdicts: {
    hipTurn: string | null;
    shoulderTurn: string | null;
    weightShift: string | null;
    posture: string | null;
    /** 2026-05-22 audit refinement — verdicts for the two new metrics.
     *  Optional so existing persisted SwingBiomechanics records (no
     *  tilt / sequencing computed) don't fail-shape at read. */
    shoulderTilt?: string | null;
    sequencing?: string | null;
    leadArm?: string | null;
    chickenWing?: string | null;
    finish?: string | null;
    sway?: string | null;
  };
  /** 2026-05-22 audit refinement — per-metric confidence 0..1 derived
   *  from the source keypoint scores. Lets the poseEstimator facade
   *  hedge verdict language when keypoints were marginal ("Approximate
   *  — hip turn ~32°…") without re-running the geometry. Optional so
   *  legacy records continue to read clean. */
  metric_confidence?: {
    hipTurn?: number;
    shoulderTurn?: number;
    shoulderTilt?: number;
    weightShift?: number;
    spineAngleDelta?: number;
    headDrift?: number;
    hipSlide?: number;
    sequencing?: number;
    leadArm?: number;
    chickenWing?: number;
    sway?: number;
    finish?: number;
  };
}

// ─── COCO 17-point joint index map (most common pose API output) ──────────────
// Source: https://cocodataset.org/#keypoints-2020
const COCO_17 = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist',
  'left_hip', 'right_hip',
  'left_knee', 'right_knee',
  'left_ankle', 'right_ankle',
] as const;

/** Normalize raw API response into our Keypoint[] shape. The pose API's
 *  exact data envelope is documented as `{ data, meta, error }` but the
 *  inner `data` shape varies by provider. We try several common forms:
 *   - data.keypoints: [{ x, y, score, name }]
 *   - data.landmarks: [[x, y, score], ...]  (positional, COCO 17 order)
 *   - data: [...] (array directly under data)
 */
function normalizeKeypoints(raw: unknown): Keypoint[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const candidate =
    (Array.isArray(obj.keypoints) ? obj.keypoints : null) ??
    (Array.isArray(obj.landmarks) ? obj.landmarks : null) ??
    (Array.isArray(obj.points) ? obj.points : null) ??
    (Array.isArray(obj.poses) && obj.poses.length > 0 && Array.isArray((obj.poses[0] as { keypoints?: unknown }).keypoints) ? (obj.poses[0] as { keypoints: unknown[] }).keypoints : null);
  if (!candidate || !Array.isArray(candidate)) return [];
  return candidate.slice(0, 17).map((entry, idx) => {
    if (Array.isArray(entry)) {
      // Positional [x, y, score] form.
      const [x, y, score] = entry as [number, number, number];
      return { x: Number(x) || 0, y: Number(y) || 0, score: Number(score) || 0, name: COCO_17[idx] };
    }
    const e = entry as { x?: unknown; y?: unknown; score?: unknown; confidence?: unknown; name?: unknown };
    return {
      x: Number(e.x) || 0,
      y: Number(e.y) || 0,
      score: Number(e.score ?? e.confidence) || 0,
      name: typeof e.name === 'string' ? e.name : COCO_17[idx],
    };
  });
}

// ─── Single-frame pose detection ─────────────────────────────────────────────

/** Run pose detection on a single image (file URI from device or http URL).
 *  Returns null on any failure — caller should render fallback. */
export async function analyzePoseFromUri(imageUri: string, timestampMs = 0): Promise<PoseFrame | null> {
  // 2026-06-11 — On-device MediaPipe first. The BlazePose model + native module
  // already ship via the withMediaPipePose config plugin (services/
  // mediaPipePoseService.ts); poseEstimator uses them, but SmartMotion's tempo
  // (deriveSwingTempo) and biomech (analyzePoseFrames) call THIS function
  // directly and were therefore stuck on the cloud — which is unconfigured, so
  // they read null. Route them through the on-device path too. Dynamic import
  // mirrors poseEstimator and avoids a static cycle (the service imports our
  // types). Returns null when the native module isn't linked (pre-build) or no
  // pose was found → we fall through to the cloud proxy below.
  try {
    const mp = await import('./mediaPipePoseService');
    const t0 = Date.now();
    const onDevice = await mp.detectPoseFromUri(imageUri, undefined, timestampMs);
    if (onDevice) {
      // SPEED telemetry — confirm the on-device path is live + measure it.
      // On-device ~100-300ms vs cloud 5-15s/frame; this proves the APK unlock.
      console.log('[pose] on-device hit', Date.now() - t0, 'ms');
      return onDevice;
    }
  } catch {
    // fall through to cloud
  }

  let body: { imageUrl?: string; imageBase64?: string };
  if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
    body = { imageUrl: imageUri };
  } else {
    // Local file:// — read as base64 since the proxy can't fetch local URIs.
    try {
      const b64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
      body = { imageBase64: b64 };
    } catch (e) {
      console.warn('[pose] local file read failed', e);
      return null;
    }
  }
  try {
    const res = await fetch(`${apiUrl()}/api/pose-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      // Pre-G safety net — covers a real upstream failure (500/502/etc).
      // Note that the env-var-gated "not configured" branch ships 200
      // with { configured: false } now (Fix H Option B); see below.
      console.warn('[pose] proxy returned', res.status);
      return null;
    }
    const data = await res.json() as { data?: unknown; configured?: boolean };
    // 2026-05-21 — Fix H (Option B): server now returns 200 with
    // { data: null, configured: false } when POSE_API_KEY/HOST aren't
    // set. Collapse to null so the biomechanics card stays hidden —
    // identical UX, just no false 503 alert from Vercel.
    if (data.configured === false || data.data == null) return null;
    const keypoints = normalizeKeypoints(data.data);
    if (keypoints.length === 0) return null;
    return { timestampMs, keypoints };
  } catch (e) {
    console.warn('[pose] analyzePoseFromUri exception', e);
    return null;
  }
}

// ─── Geometry helpers (pure) ─────────────────────────────────────────────────

function getKp(frame: PoseFrame, name: string): Keypoint | null {
  return frame.keypoints.find(k => k.name === name && k.score > 0.2) ?? null;
}

/** Angle (degrees) of the line through two points relative to horizontal. */
function angleDeg(a: Keypoint, b: Keypoint): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** 2026-08-09 (elite fault engine) — the INTERIOR angle at joint `b` formed by segments b→a and b→c,
 *  in degrees (0..180). 180 = perfectly straight (e.g. a straight lead arm: shoulder-elbow-wrist).
 *  Elbow/shoulder/wrist are the largest, highest-confidence, least-foreshortened keypoints, so arm
 *  angles are among the MOST reliable single-camera 2D reads — exactly the plainly-visible faults
 *  (bent lead arm, chicken wing) the width-ratio metrics never attempted. */
function jointAngleDeg(a: Keypoint, b: Keypoint, c: Keypoint): number {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return 180;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return Math.round((Math.acos(cos) * 180) / Math.PI);
}

/** Midpoint x of two named keypoints (score-gated via getKp). null if either is missing/low-score. */
function midX(frame: PoseFrame, leftName: string, rightName: string): number | null {
  const l = getKp(frame, leftName);
  const r = getKp(frame, rightName);
  if (!l || !r) return null;
  return (l.x + r.x) / 2;
}

/** Width of the line segment connecting two named keypoints — proxy for
 *  rotation when measuring shoulders or hips (foreshortened width = turn). */
function pairWidth(frame: PoseFrame, leftName: string, rightName: string): number | null {
  const l = getKp(frame, leftName);
  const r = getKp(frame, rightName);
  if (!l || !r) return null;
  const dx = r.x - l.x;
  const dy = r.y - l.y;
  return Math.hypot(dx, dy);
}

/** 2026-07-07 (biomech audit #7) — HORIZONTAL width only, for the TURN ratio.
 *  The full hypot keeps the segment long at the top (the tilt's dy), inflating
 *  the ratio and systematically under-reading real coils (a 90° coil with 30°
 *  tilt read ≈60°). Rotation foreshortens the projected x-extent specifically. */
function pairWidthX(frame: PoseFrame, leftName: string, rightName: string): number | null {
  const l = getKp(frame, leftName);
  const r = getKp(frame, rightName);
  if (!l || !r) return null;
  return Math.abs(r.x - l.x);
}

// ─── Swing-position keyframe sampling + biomechanics ─────────────────────────

/** Approximate timestamps in a swing video where canonical PGA positions
 *  occur, as fractions of total video length. Tunable; matches a typical
 *  3s recorded swing where address = 5%, P2 = 25%, top = 50%, impact =
 *  65%, finish = 90%. Real implementation should use audio-impact
 *  detection to anchor P6 then derive others. For v1 spike this is fine.
 *
 *  2026-05-28 — Fix FO: tiered sampling for longer uploaded clips.
 *  These FRACTIONS are correct for in-app captures where the entire
 *  clip is the swing. Library uploads of instructor footage (Katie's
 *  videos: ~30s with talking pre-swing + drill demo + actual swing
 *  somewhere in the middle/end) sampled 5%-90% of total → 5 frames
 *  of Katie standing talking, none containing the swing. computeAtSwingPositions
 *  below now picks the right fractions based on probed clip length.
 *  Long-clip fractions mirror poseDetection.LONG_CLIP_FRACTIONS so
 *  vision + pose pipelines sample the same windows. */
const SWING_POSITIONS: { key: PoseFrame['position']; fraction: number }[] = [
  { key: 'P1_address',  fraction: 0.05 },
  { key: 'P2_takeaway', fraction: 0.25 },
  { key: 'P4_top',      fraction: 0.50 },
  { key: 'P6_impact',   fraction: 0.65 },
  { key: 'P10_finish',  fraction: 0.90 },
];

// 2026-05-28 — Fix FO: for clips > 10s, the swing typically occupies
// a small window inside a longer demo / coach clip. These fractions
// cluster more aggressively in the back-half (where Katie-style
// "demo then swing" clips usually place the actual swing) while
// keeping enough spread that we don't miss a mid-clip swing entirely.
// Mirror of LONG_CLIP_FRACTIONS in services/poseDetection.ts so the
// pose backfill samples the same windows the vision analyzer reads.
const LONG_CLIP_POSITIONS: { key: PoseFrame['position']; fraction: number }[] = [
  { key: 'P1_address',  fraction: 0.20 },
  { key: 'P2_takeaway', fraction: 0.40 },
  { key: 'P4_top',      fraction: 0.60 },
  { key: 'P6_impact',   fraction: 0.78 },
  { key: 'P10_finish',  fraction: 0.92 },
];
const LONG_CLIP_THRESHOLD_MS = 10_000;
const MEDIUM_CLIP_THRESHOLD_MS = 4_000;
const MEDIUM_CLIP_BACK_WINDOW_MS = 5_000;

/** Extract a JPEG keyframe from a video at the given time and run pose
 *  detection on it. Returns null on any failure. */
/**
 * 2026-08-21 — WHY a frame failed, not just that it did.
 *
 * An iOS tester reported pose_zero_frames four times in 75 seconds: five frames requested from a
 * 10-second clip, zero returned. The private copy had SUCCEEDED, so every frame died in here — and
 * this function only console.warn'd, which is invisible on a tester's phone. Four reports, no cause.
 *
 * Worse, the two failure modes are indistinguishable and need OPPOSITE fixes:
 *   • getThumbnailAsync threw     → we cannot read the video at all. A platform/code problem.
 *   • pose came back null         → the frame was read fine and no body was found. A FRAMING problem
 *                                   (too far away, out of shot) — or the native module is not linked,
 *                                   in which case it silently returns null for every frame forever.
 *
 * The reason from the FIRST failure is now carried out so the zero-frames report can name it.
 */
let lastFrameFailure: string | null = null;

/** Exported 2026-09-01 for the on-device swing locate (services/swing/onDeviceLocate). */
export async function poseAtTime(videoUri: string, timeMs: number, position: PoseFrame['position']): Promise<PoseFrame | null> {
  try {
    let uri: string; let width: number | undefined; let height: number | undefined;
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(videoUri, { time: timeMs, quality: 0.8 });
      uri = thumb.uri; width = thumb.width; height = thumb.height;
    } catch (te) {
      if (!lastFrameFailure) lastFrameFailure = `thumbnail_failed: ${te instanceof Error ? te.message.slice(0, 90) : String(te).slice(0, 90)}`;
      throw te;
    }
    const frame = await analyzePoseFromUri(uri, timeMs);
    if (!frame) {
      // Read the image fine, found no body. Distinct from being unable to read it at all.
      if (!lastFrameFailure) lastFrameFailure = 'no_pose_in_frame';
      return null;
    }
    // Carry the true frame dimensions so the overlay can align the skeleton
    // to the body (correct aspect ratio + resize mode) rather than bbox-fit.
    return { ...frame, position, frameW: width || undefined, frameH: height || undefined };
  } catch (e) {
    console.warn('[pose] poseAtTime failed', position, e);
    return null;
  }
}

/** Compute biomechanics from the per-position frames. Each metric falls
 *  back to null when the prerequisite keypoints are missing, and the
 *  verdict copy is generated from the user's value vs the tour standard.
 *
 *  2026-05-23 — Public re-export `computeBiomechanicsFromFrames` lets
 *  the MediaPipe on-device path (services/poseEstimator.ts) reuse this
 *  same pipeline without an HTTP round-trip. The function expects
 *  frames tagged with `position` (P1_address / P4_top / P6_impact)
 *  for the metric reads — callers must populate those tags before
 *  calling. */
export function computeBiomechanicsFromFrames(frames: PoseFrame[], angle?: 'down_the_line' | 'face_on' | 'glasses_pov' | null, handedness?: 'right' | 'left' | null): SwingBiomechanics {
  return computeBiomechanics(frames, angle, handedness);
}

// 2026-08-06 (Tim — "body mechanics SUPER tight"). Make each phase anchor robust to a single bad pose
// frame: instead of reading the lone tagged frame, composite the BEST-scoring keypoint per joint across a
// small time neighborhood around the anchor. (Same idea as mediaPipePoseService.smoothPoseFrames, inlined
// here to stay synchronous + avoid the dynamic-import cycle.) Kills the "one mis-detected hip at 'top' →
// wrong turn number" failure that made the reads jumpy. On sparse frame sets the window collapses to the
// anchor itself (no-op), so it only ever tightens, never fabricates.
function robustAnchor(frames: PoseFrame[], anchor: PoseFrame | undefined, windowMs = 90): PoseFrame | undefined {
  if (!anchor) return undefined;
  const near = frames.filter(f => Math.abs(f.timestampMs - anchor.timestampMs) <= windowMs);
  if (near.length <= 1) return anchor;
  const sample = anchor.keypoints;
  const composite: typeof sample = [];
  for (let i = 0; i < sample.length; i++) {
    // 2026-08-06 (audit) — match each joint by NAME across the neighborhood, not by array index. A neighbor
    // frame with a different-length/reordered keypoints array (the rest of the pipeline never assumes index
    // alignment) would otherwise mix joints (a high-score shoulder landing in the hip slot) → wrong angles.
    const name = sample[i].name;
    let best = sample[i];
    for (const f of near) {
      const k = f.keypoints.find((p) => p.name === name);
      if (k && k.score > best.score) best = k;
    }
    composite.push(best);
  }
  return { ...anchor, keypoints: composite };
}

function computeBiomechanics(frames: PoseFrame[], angle?: 'down_the_line' | 'face_on' | 'glasses_pov' | null, handedness: 'right' | 'left' | null = 'right'): SwingBiomechanics {
  // 2026-07-24 (full-app audit, root D) — when the caller doesn't KNOW the angle
  // (null/undefined — Coach lesson, library uploads), infer it from the pose
  // geometry so the honesty gate below fires everywhere, not just where a caller
  // happened to thread it.
  // 2026-07-30 (Tim — "my videos recorded DTL but were face-on; I couldn't see the
  // toggle in daylight. Did that affect analysis?") — YES it did: the metrics below
  // branch on angle, so a face-on swing scored with the DTL geometry is wrong. The
  // angle toggle is a UI HINT the user can get wrong (glare, rushed setup); the pose
  // geometry is ground truth. So even with an EXPLICIT down_the_line/face_on label,
  // cross-check against inferCameraAngle — which is CONSERVATIVE (returns non-null only
  // when the read is UNAMBIGUOUS) — and if it confidently DISAGREES, self-correct to the
  // frames. A null/ambiguous inference keeps the user's label. glasses_pov (a first-person
  // source the frames can't reveal) is never overridden — inference can't produce it.
  if (angle == null) {
    angle = inferCameraAngle(frames);
  } else if (angle === 'down_the_line' || angle === 'face_on') {
    const inferred = inferCameraAngle(frames);
    if (inferred && inferred !== angle) angle = inferred;
  }
  const address = robustAnchor(frames, frames.find(f => f.position === 'P1_address'));
  const top = robustAnchor(frames, frames.find(f => f.position === 'P4_top'));
  // 2026-08-06 (analysis audit) — impact sits in the FASTEST motion of the swing; a 90ms keypoint borrow
  // there can composite in a hip/ankle from a materially different body position and skew weightShift /
  // spineAngle. Address + top are at/near the transition (near-zero velocity), so their wider window only
  // denoises. Tighten impact's window (~one frame each side at 30fps) so it still rejects a single bad
  // frame without teleporting a joint across fast motion.
  const impact = robustAnchor(frames, frames.find(f => f.position === 'P6_impact'), 45);
  const finish = robustAnchor(frames, frames.find(f => f.position === 'P10_finish'));

  // 2026-08-09 (elite fault engine — Tim: "lead arm bent, trail chicken winged, finish correct or not.
  // Missing a lot my eyes see plainly"). The engine measured hips/shoulders/spine but NEVER the ARMS —
  // yet bent-lead-arm and chicken-wing are the most VISUALLY OBVIOUS faults and the most RELIABLE 2D
  // reads (elbow/wrist are big, high-confidence, barely foreshortened). Lead arm = the target-line arm:
  // RH golfer → LEFT arm, LH → RIGHT.
  const leadPrefix = handedness === 'left' ? 'right' : 'left';
  const armAngleAt = (frame: PoseFrame | null | undefined): number | null => {
    if (!frame) return null;
    const sh = getKp(frame, `${leadPrefix}_shoulder`);
    const el = getKp(frame, `${leadPrefix}_elbow`);
    const wr = getKp(frame, `${leadPrefix}_wrist`);
    if (!sh || !el || !wr) return null;
    return jointAngleDeg(sh, el, wr); // 180 = straight lead arm
  };
  // Lead-arm angle at the TOP of the backswing: a straight lead arm keeps width + a wide arc; a bent
  // lead arm collapses the radius (power leak, inconsistent low point).
  // `let`, not const: the plausibility gate below rejects an out-of-band read (2026-08-24).
  let leadArmTopDeg = armAngleAt(top);
  // Lead-arm angle through IMPACT/early follow-through: a bent/cupping lead arm here is the "chicken
  // wing" — loss of extension + face control.
  let leadArmImpactDeg = armAngleAt(impact);

  // ROBUST SWAY (Tim's named miss): lateral translation of the hip MIDPOINT from address→top,
  // normalized by shoulder width (scale-invariant). Replaces the old hipSlideRatio, which used a
  // single hip's x (moves from rotation AND sway — conflating the two it claims to separate) divided by
  // a noisy Δwidth (→ divided real sway away on a well-rotated turn = the miss). A fraction of shoulder
  // width is directly interpretable: ~0.20+ = the hips have slid meaningfully off the ball.
  let swayNorm: number | null = null;
  if (address && top) {
    const hipMidA = midX(address, 'left_hip', 'right_hip');
    const hipMidT = midX(top, 'left_hip', 'right_hip');
    const shW = pairWidthX(address, 'left_shoulder', 'right_shoulder');
    if (hipMidA != null && hipMidT != null && shW && shW > 0) {
      swayNorm = Math.round((Math.abs(hipMidT - hipMidA) / shW) * 100) / 100;
    }
  }

  // FINISH quality (Tim: "finish correct or not"): weight through onto the lead side at the finish
  // frame. A full, balanced finish stacks the pelvis over the lead leg; weight still centered/back =
  // a fall-back / incomplete finish. Reuses the validated pelvis-in-stance proxy at the FINISH frame.
  let finishWeightPct: number | null = null;
  if (address && finish) {
    const la = getKp(finish, 'left_ankle'); const ra = getKp(finish, 'right_ankle');
    const laA = getKp(address, 'left_ankle'); const raA = getKp(address, 'right_ankle');
    const lhF = getKp(finish, 'left_hip'); const rhF = getKp(finish, 'right_hip');
    const lhA = getKp(address, 'left_hip'); const rhA = getKp(address, 'right_hip');
    if (la && ra && laA && raA && lhF && rhF && lhA && rhA) {
      const stance = Math.abs(ra.x - la.x) || 1;
      const pelvisAddr = (lhA.x + rhA.x) / 2 - (laA.x + raA.x) / 2;
      const pelvisFinish = (lhF.x + rhF.x) / 2 - (la.x + ra.x) / 2;
      const raw = ((pelvisFinish - pelvisAddr) / stance) * 100;
      const lead = handedness === 'left' ? ra : la;
      const trail = handedness === 'left' ? la : ra;
      const towardLead = Math.sign(lead.x - trail.x) || 1;
      finishWeightPct = Math.round(raw * towardLead);
    }
  }

  // Hip turn: shoulder/hip width "shrinks" as the body rotates away
  // from the camera. Ratio of width(top)/width(address) → degrees via
  // arccos. Crude but illustrative for a single-camera setup.
  // 2026-08-06 (Tim — kill the "0°" ghost reads). A top width >= address width means we could NOT measure a
  // real turn (pose noise, or the 'top' frame landed near address / mid-downswing) — a genuine backswing
  // always turns. Return null (unmeasured → shows "—") instead of a fake, confident "0°" that the verdict
  // then scolds you for. Threshold 0.985 ≈ under ~11° of apparent turn = not a trustworthy read.
  const TURN_UNMEASURABLE_RATIO = 0.985;
  let hipTurnDeg: number | null = null;
  if (address && top) {
    const wA = pairWidthX(address, 'left_hip', 'right_hip');
    const wT = pairWidthX(top, 'left_hip', 'right_hip');
    if (wA && wT && wA > 0) {
      const ratio = wT / wA;
      hipTurnDeg = ratio >= TURN_UNMEASURABLE_RATIO ? null : Math.round((Math.acos(Math.max(0, ratio)) * 180) / Math.PI);
    }
  }
  let shoulderTurnDeg: number | null = null;
  if (address && top) {
    const wA = pairWidthX(address, 'left_shoulder', 'right_shoulder');
    const wT = pairWidthX(top, 'left_shoulder', 'right_shoulder');
    if (wA && wT && wA > 0) {
      const ratio = wT / wA;
      shoulderTurnDeg = ratio >= TURN_UNMEASURABLE_RATIO ? null : Math.round((Math.acos(Math.max(0, ratio)) * 180) / Math.PI);
    }
  }

  // Weight shift — 2026-07-07 (biomech audit #1): the old proxy compared ANKLE
  // midpoints address→impact, but feet stay planted, so it read ~0 noise on every
  // swing → chronic false "hanging back". The coach-standard 2D proxy is PELVIS
  // position IN the stance: hip-midpoint x relative to ankle-midpoint x, normalized
  // by stance width. Signed toward the LEAD ankle (handedness-aware: righty lead =
  // left foot) so positive = onto the lead side. 0% = centered; ~30-50% = strong move.
  let weightShiftPct: number | null = null;
  if (address && impact) {
    const la = getKp(impact, 'left_ankle');
    const ra = getKp(impact, 'right_ankle');
    const laA = getKp(address, 'left_ankle');
    const raA = getKp(address, 'right_ankle');
    const lhI = getKp(impact, 'left_hip');
    const rhI = getKp(impact, 'right_hip');
    const lhA = getKp(address, 'left_hip');
    const rhA = getKp(address, 'right_hip');
    if (la && ra && laA && raA && lhI && rhI && lhA && rhA) {
      const stance = Math.abs(ra.x - la.x) || 1;
      // Pelvis position within the stance, address → impact.
      const pelvisAddr = (lhA.x + rhA.x) / 2 - (laA.x + raA.x) / 2;
      const pelvisImpact = (lhI.x + rhI.x) / 2 - (la.x + ra.x) / 2;
      const raw = ((pelvisImpact - pelvisAddr) / stance) * 100;
      // Sign convention: positive = toward the LEAD ankle (target side).
      const lead = handedness === 'left' ? ra : la;
      const trail = handedness === 'left' ? la : ra;
      const towardLead = Math.sign(lead.x - trail.x) || 1;
      weightShiftPct = Math.round(raw * towardLead);
    }
  }

  // Spine angle delta — head-to-pelvis line angle change.
  // 2026-07-07 (biomech audit #5) — use score-gated getKp (was raw find(), so a
  // score-0 placeholder hip fabricated posture numbers) and require the SAME side
  // hip in both frames (was left-at-address vs right-at-impact = different lines).
  let spineAngleDeltaDeg: number | null = null;
  if (address && impact) {
    const noseA = getKp(address, 'nose');
    const noseI = getKp(impact, 'nose');
    const sameSide = (name: string) => {
      const a = getKp(address, name);
      const i = getKp(impact, name);
      return a && i ? { a, i } : null;
    };
    const hips = sameSide('left_hip') ?? sameSide('right_hip');
    if (noseA && noseI && hips) {
      const angA = angleDeg(noseA, hips.a);
      const angI = angleDeg(noseI, hips.i);
      spineAngleDeltaDeg = Math.round(Math.abs(angI - angA));
    }
  }

  // Head drift — nose x-position change normalized to head-shoulder
  // distance (a rough body-scale proxy).
  let headDriftPxNorm: number | null = null;
  if (address && impact) {
    const noseA = getKp(address, 'nose');
    const noseI = getKp(impact, 'nose');
    const shoulderA = pairWidth(address, 'left_shoulder', 'right_shoulder');
    if (noseA && noseI && shoulderA && shoulderA > 0) {
      headDriftPxNorm = Math.round(((noseI.x - noseA.x) / shoulderA) * 100) / 100;
    }
  }

  // Hip slide: compare hip x-translation vs hip-width "rotation" between
  // address and top. >1 = sliding more than rotating (the bad pattern).
  // 2026-07-07 (biomech audit #5) — score-gated keypoints (was raw find → junk
  // coords from score-0 placeholder joints could fabricate a slide read).
  let hipSlideRatio: number | null = null;
  if (address && top) {
    const hipA = getKp(address, 'left_hip');
    const hipT = getKp(top, 'left_hip');
    const wA = pairWidthX(address, 'left_hip', 'right_hip');
    const wT = pairWidthX(top, 'left_hip', 'right_hip');
    if (hipA && hipT && wA && wT && wA > 0) {
      const slide = Math.abs(hipT.x - hipA.x);
      const rotate = Math.abs(wA - wT);
      hipSlideRatio = rotate > 0 ? Math.round((slide / rotate) * 100) / 100 : null;
    }
  }

  // 2026-05-22 audit refinement — Shoulder tilt at top. Angle (degrees)
  // of the line connecting the two shoulders relative to horizontal in
  // the P4_top frame. Tour ~30°. Flat (< 15°) reads as a "lifted /
  // over-the-top" pattern; very steep (> 45°) reads as exaggerated dip.
  // Pure 2D angle from a single camera — same limitation as every other
  // metric here; we're approximating spine angle preservation, not
  // measuring it true.
  let shoulderTiltDeg: number | null = null;
  if (top) {
    const ls = getKp(top, 'left_shoulder');
    const rs = getKp(top, 'right_shoulder');
    if (ls && rs) {
      const tilt = Math.abs(angleDeg(ls, rs));
      // Wrap into 0..90 — we don't care which side is "up", only how
      // much off horizontal.
      shoulderTiltDeg = Math.round(Math.min(90, tilt));
    }
  }

  // 2026-05-22 audit refinement — Sequencing score 0..100.
  // The tour "kinematic sequence" is: hips initiate the downswing,
  // shoulders follow. We can approximate that with a single-camera 2D
  // feed by comparing the change in hip-width vs shoulder-width
  // between P4_top and P6_impact: if hips have "rotated back" (width
  // widened) MORE than shoulders by impact, the hips led. We map that
  // delta into 0..100 (50 = even rates, 100 = hips clearly led, 0 =
  // shoulders clearly led / over-the-top). Conservative — capped and
  // clamped so a noisy single-frame doesn't peg the dial.
  let sequencingScore: number | null = null;
  if (top && impact) {
    const hipTopW = pairWidth(top, 'left_hip', 'right_hip');
    const hipImpactW = pairWidth(impact, 'left_hip', 'right_hip');
    const shTopW = pairWidth(top, 'left_shoulder', 'right_shoulder');
    const shImpactW = pairWidth(impact, 'left_shoulder', 'right_shoulder');
    if (hipTopW && hipImpactW && shTopW && shImpactW && hipTopW > 0 && shTopW > 0) {
      const hipRotRate = (hipImpactW - hipTopW) / hipTopW;
      const shoulderRotRate = (shImpactW - shTopW) / shTopW;
      // Diff > 0 means hips rotated more (faster relative open) than
      // shoulders, which is the desired pattern.
      const diff = hipRotRate - shoulderRotRate;
      // Map [-0.30, +0.30] → [0, 100]. The 0.30 spread covers the
      // realistic range of single-camera 2D-width-derived sequencing
      // signal; tighter spreads make the score read jumpy on noise.
      const clamped = Math.max(-0.30, Math.min(0.30, diff));
      sequencingScore = Math.round(((clamped + 0.30) / 0.60) * 100);
    }
  }

  // 2026-06-10 — Angle-aware honesty. From DOWN-THE-LINE the camera is behind
  // the player, so the width-foreshortening turn metrics read inverted and the
  // lateral-x weight shift is actually depth — both invalid. Null them rather
  // than surface a wrong number; the verdicts below already render null when the
  // metric is null. Face-on / glasses / unknown keep the existing behavior.
  if (angle === 'down_the_line') {
    hipTurnDeg = null;
    shoulderTurnDeg = null;
    weightShiftPct = null;
    // 2026-07-07 (biomech audit #4) — sequencing + hip-slide use the SAME
    // width-foreshortening / lateral-x geometry the gate declares invalid from
    // behind; they were slipping through and printing confident wrong numbers.
    sequencingScore = null;
    hipSlideRatio = null;
  }
  // 2026-07-07 (biomech audit #3) — the tilt gate was INVERTED from the geometry:
  // from FACE-ON the projected shoulder tilt inflates toward 90° as the turn grows
  // (atan(tanφ/cosθ) — a perfect ~30° tour tilt at a normal ~80° turn projects to
  // ~73° → false "exaggerated dip"). From DTL the projection ≈ true tilt. So tilt is
  // valid DTL and INVALID face-on — null it there.
  if (angle === 'face_on') {
    shoulderTiltDeg = null;
  }
  // glasses_pov (first-person) satisfies NEITHER geometry — null everything angular.
  if (angle === 'glasses_pov') {
    hipTurnDeg = null;
    shoulderTurnDeg = null;
    weightShiftPct = null;
    sequencingScore = null;
    hipSlideRatio = null;
    shoulderTiltDeg = null;
  }

  /**
   * 2026-08-24 (Tim's range screenshot) — REJECT WHAT A BODY CANNOT DO, BEFORE ANY VERDICT IS WRITTEN.
   *
   * The card read "Weight shift -116% — your weight is hanging back through impact" and "Lead arm
   * bent to 42° at the top". Neither is a measurement. Weight shift is pelvis displacement as a
   * percentage of STANCE WIDTH and a person standing on two feet cannot exceed one; leadArmTopDeg is
   * an ELBOW angle where 180 is straight, so 42 is an arm folded nearly shut. Both were mis-tracked
   * keypoints, and both were narrated to the player in red, with coaching attached.
   *
   * That is worse than reporting nothing — it sends someone to the range to fix a fault the camera
   * invented. The app already applies this discipline to coordinates (utils/coordGuard) and to club
   * distances (the plausibility band in clubStatsStore); the pose metrics never got it.
   *
   * Placed HERE, above the verdicts, on purpose: the raw number is not what the player sees. The
   * verdict is. A gate below this line would leave the sentence intact.
   */
  {
    const gated = rejectImplausible({
      hipTurnDeg, shoulderTurnDeg, shoulderTiltDeg, weightShiftPct, spineAngleDeltaDeg,
      headDriftPxNorm, hipSlideRatio, sequencingScore, leadArmTopDeg, leadArmImpactDeg,
      swayNorm, finishWeightPct,
    });
    if (gated.rejected.length > 0) {
      console.log(`[biomech] rejected implausible read(s): ${gated.rejected.join(', ')} — reported as not measured`);
    }
    hipTurnDeg = gated.metrics.hipTurnDeg;
    shoulderTurnDeg = gated.metrics.shoulderTurnDeg;
    shoulderTiltDeg = gated.metrics.shoulderTiltDeg;
    weightShiftPct = gated.metrics.weightShiftPct;
    spineAngleDeltaDeg = gated.metrics.spineAngleDeltaDeg;
    headDriftPxNorm = gated.metrics.headDriftPxNorm;
    hipSlideRatio = gated.metrics.hipSlideRatio;
    sequencingScore = gated.metrics.sequencingScore;
    leadArmTopDeg = gated.metrics.leadArmTopDeg;
    leadArmImpactDeg = gated.metrics.leadArmImpactDeg;
    swayNorm = gated.metrics.swayNorm;
    finishWeightPct = gated.metrics.finishWeightPct;
  }

  // Verdicts — short coaching one-liners based on tour standards.
  const verdicts = {
    hipTurn:
      hipTurnDeg == null ? null :
      hipTurnDeg < 30 ? `Hip turn ${hipTurnDeg}° / target ~45° — under-rotating, costs distance.` :
      hipTurnDeg > 55 ? `Hip turn ${hipTurnDeg}° — over-rotating, may lose stability.` :
      `Hip turn ${hipTurnDeg}° — solid range (tour ~45°).`,
    shoulderTurn:
      shoulderTurnDeg == null ? null :
      shoulderTurnDeg < 75 ? `Shoulder turn ${shoulderTurnDeg}° / target 90° — short coil.` :
      shoulderTurnDeg > 100 ? `Shoulder turn ${shoulderTurnDeg}° — long coil; watch tempo.` :
      `Shoulder turn ${shoulderTurnDeg}° — solid coil.`,
    weightShift:
      weightShiftPct == null ? null :
      weightShiftPct < 10 ? `Weight shift ${weightShiftPct >= 0 ? '+' : ''}${weightShiftPct}% — hanging back; thin/topped contact risk.` :
      weightShiftPct > 50 ? `Weight shift +${weightShiftPct}% — over-shifting forward.` :
      `Weight shift +${weightShiftPct}% — solid forward move.`,
    posture:
      spineAngleDeltaDeg == null ? null :
      spineAngleDeltaDeg > 10 ? `Posture changed ${spineAngleDeltaDeg}° — early extension or stand-up move.` :
      `Posture maintained (Δ${spineAngleDeltaDeg}°) — strong base.`,
    // 2026-05-22 audit refinement — tilt + sequencing verdicts.
    shoulderTilt:
      shoulderTiltDeg == null ? null :
      shoulderTiltDeg < 15 ? `Shoulder tilt ${shoulderTiltDeg}° — flat at the top; risk of over-the-top.` :
      shoulderTiltDeg > 45 ? `Shoulder tilt ${shoulderTiltDeg}° — exaggerated dip; watch spine angle.` :
      `Shoulder tilt ${shoulderTiltDeg}° — solid tilt (tour ~30°).`,
    sequencing:
      sequencingScore == null ? null :
      sequencingScore < 35 ? `Sequencing ${sequencingScore}/100 — shoulders leading the downswing.` :
      sequencingScore > 65 ? `Sequencing ${sequencingScore}/100 — hips lead clearly, tour kinematic order.` :
      `Sequencing ${sequencingScore}/100 — even hip/shoulder timing.`,
    // 2026-08-09 (elite fault engine) — arm + finish verdicts.
    leadArm:
      leadArmTopDeg == null ? null :
      leadArmTopDeg < 150 ? `Lead arm bent to ${leadArmTopDeg}° at the top — collapsing your radius (a straighter lead arm keeps width + speed).` :
      `Lead arm straight (${leadArmTopDeg}°) at the top — wide, connected.`,
    chickenWing:
      leadArmImpactDeg == null ? null :
      leadArmImpactDeg < 150 ? `Lead arm folding to ${leadArmImpactDeg}° through impact — a chicken wing; you're losing extension + face control.` :
      `Lead arm extending (${leadArmImpactDeg}°) through impact — good release.`,
    finish:
      finishWeightPct == null ? null :
      finishWeightPct < 15 ? `Finish weight ${finishWeightPct >= 0 ? '+' : ''}${finishWeightPct}% — not getting through; you're falling back instead of finishing balanced over your lead side.` :
      `Balanced finish — weight +${finishWeightPct}% onto the lead side.`,
    sway:
      swayNorm == null ? null :
      swayNorm > 0.20 ? `Hips slid ${Math.round(swayNorm * 100)}% of shoulder-width off the ball in the backswing — swaying instead of turning around a post.` :
      `Centered turn — hips stayed stacked (${Math.round(swayNorm * 100)}% drift).`,
  };

  // 2026-05-22 audit refinement — per-metric confidence. Each metric's
  // confidence is the AVERAGE score of the keypoints it actually
  // depended on; downstream callers (poseEstimator, swing detail UI)
  // can hedge verdict language when these are low. Pure rollup —
  // never gates metric computation, just annotates it.
  const metric_confidence = {
    hipTurn: avgScore(address, top, ['left_hip', 'right_hip']),
    shoulderTurn: avgScore(address, top, ['left_shoulder', 'right_shoulder']),
    shoulderTilt: avgScore(top, null, ['left_shoulder', 'right_shoulder']),
    weightShift: avgScore(address, impact, ['left_ankle', 'right_ankle', 'left_hip', 'right_hip']),
    spineAngleDelta: avgScore(address, impact, ['nose', 'left_hip', 'right_hip']),
    headDrift: avgScore(address, impact, ['nose', 'left_shoulder', 'right_shoulder']),
    hipSlide: avgScore(address, top, ['left_hip', 'right_hip']),
    sequencing: avgScore(top, impact, ['left_hip', 'right_hip', 'left_shoulder', 'right_shoulder']),
    leadArm: avgScore(top, null, [`${leadPrefix}_shoulder`, `${leadPrefix}_elbow`, `${leadPrefix}_wrist`]),
    chickenWing: avgScore(impact, null, [`${leadPrefix}_shoulder`, `${leadPrefix}_elbow`, `${leadPrefix}_wrist`]),
    sway: avgScore(address, top, ['left_hip', 'right_hip', 'left_shoulder', 'right_shoulder']),
    finish: avgScore(address, finish, ['left_hip', 'right_hip', 'left_ankle', 'right_ankle']),
  };

  /**
   * 2026-08-19 (Tim — "in analysis, I wanna see what fails silently… includes the shot tracing and the
   * BODY MECHANICS as well").
   *
   * A read where EVERY metric came back null is not an error — each null is individually honest, and
   * the app is deliberately built to show a dash rather than invent a number. But it is the outcome
   * the player experiences as "it analysed my swing and told me nothing", and until now it left no
   * trace at all: the function returned a well-formed object full of nulls and everything downstream
   * quietly rendered empty.
   *
   * Logged as a diag, not an error: nothing malfunctioned, and it is expected on a bad angle, a
   * part-framed body or a two-frame sample. But if a tester's swings are consistently coming back
   * blank, that pattern is now visible instead of being invisible by construction — which is the
   * whole point of asking what fails silently.
   */
  const measured = [
    hipTurnDeg, shoulderTurnDeg, shoulderTiltDeg, weightShiftPct, spineAngleDeltaDeg,
    headDriftPxNorm, hipSlideRatio, sequencingScore, leadArmTopDeg, leadArmImpactDeg,
    swayNorm, finishWeightPct,
  ].filter((v) => v != null).length;
  if (measured === 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../store/issueLogStore').useIssueLogStore.getState().addAppEvent('biomech_all_null', {
        frames: frames.length,
        angle: angle ?? null,
        anchors: [address ? 'address' : null, top ? 'top' : null, impact ? 'impact' : null, finish ? 'finish' : null].filter(Boolean).join(','),
      }, 'diag');
    } catch { /* best-effort */ }
  }

  return {
    hipTurnDeg, shoulderTurnDeg, shoulderTiltDeg,
    weightShiftPct, spineAngleDeltaDeg, headDriftPxNorm, hipSlideRatio,
    sequencingScore,
    leadArmTopDeg, leadArmImpactDeg, swayNorm, finishWeightPct,
    angle: angle ?? null,
    frames, verdicts, metric_confidence,
  };
}

/** Average keypoint score across the supplied joints in 1 or 2 frames.
 *  Returns 0 when no keypoints matched (so callers can treat it as
 *  "unmeasured"). Used to roll up per-metric confidence. */
function avgScore(frameA: PoseFrame | undefined, frameB: PoseFrame | null | undefined, joints: string[]): number {
  const samples: number[] = [];
  const frames = [frameA, frameB].filter((f): f is PoseFrame => !!f);
  for (const f of frames) {
    for (const name of joints) {
      const k = f.keypoints.find((kp) => kp.name === name);
      if (k) samples.push(k.score);
    }
  }
  if (samples.length === 0) return 0;
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return Math.round(avg * 100) / 100;
}

/** Full pipeline: extract keyframes from a swing video, run pose detection
 *  on each, compute biomechanics. Returns null when the video is invalid
 *  OR the pose API failed for every frame (caller renders fallback). */
export async function analyzeSwingFromVideo(
  videoUri: string,
  durationMs: number,
  angle?: 'down_the_line' | 'face_on' | 'glasses_pov' | null,
  trustDuration = false,
  window?: { startMs: number; endMs: number } | null,
  impactMs?: number | null,
  handedness?: 'right' | 'left' | null,
  /** How wrong `impactMs` could be — see clubPathWindow.anchorToleranceMs. 0 = treat it as exact. */
  impactToleranceMs = 0,
): Promise<SwingBiomechanics | null> {
  const frames = await extractPoseFramesFromVideo(
    videoUri, durationMs, trustDuration, window, impactMs, undefined, impactToleranceMs,
  );
  if (!frames) return null;
  return computeBiomechanics(frames, angle, handedness);
}

/** 2026-05-22 — Path A (SmartMotion real pose overlay): same keyframe-
 *  extraction pipeline as analyzeSwingFromVideo, but returns the raw
 *  per-position PoseFrames instead of collapsing into a biomechanics
 *  summary. SmartMotion feeds these frames to SwingBodyOverlay, which
 *  draws the real skeleton + swing-arc trace over the video player.
 *  (2026-07-04 — the old StubSkeletonOverlay animated mock is deleted;
 *  real computed frames are the only skeleton source.)
 *
 *  Returns null when the video is too short or every frame failed
 *  pose detection (callers render no skeleton overlay in that case —
 *  never a mock).
 */
export async function extractPoseFramesFromVideo(
  videoUri: string,
  durationMs: number,
  trustDuration = false,
  window?: { startMs: number; endMs: number } | null,
  impactMs?: number | null,
  // 2026-07-29 — optional "stop if the video is playing" guard (e.g. () => !videoPaused). The review
  // surface loops the clip; a retriever decoding the file ExoPlayer is playing = native SIGSEGV.
  shouldAbort?: () => boolean,
  /**
   * 2026-09-02 — how wrong `impactMs` could be, from clubPathWindow.anchorToleranceMs. Widens the
   * window the extra on-device frames cluster into, so a THIN acoustic pickup is not treated as a
   * frame-accurate one. Defaults to 0: a caller that does not know the strike's confidence gets
   * exactly the previous behaviour.
   */
  impactToleranceMs = 0,
): Promise<PoseFrame[] | null> {
  try { require('./routeBreadcrumb').breadcrumb('pose:extract:start', { durMs: Math.round(durationMs), windowed: !!window }); } catch { /* non-fatal */ }

  // 2026-07-30 (audit #13 — "analysis stuck, works on the 3rd try") — make the PRIVATE COPY FIRST, before
  // ANY native retriever runs (the duration probe below AND the frame extraction). Previously the copy
  // was created only after the probe, so probeDurationMs decoded the ORIGINAL clip while ExoPlayer looped
  // it on the review surface → native SIGSEGV/hang that cleared only on a retry. Everything native now
  // reads workUri (the copy); copy failure → skeleton-only degrade, never a crash. Deleted on every exit.
  let workUri = videoUri;

  /**
   * 2026-08-23 (Tim — "you're almost always gonna get a first failure… cannot read, cannot analyze,
   * but you'll get some kind of data").
   *
   * WAIT FOR THE FILE TO EXIST BEFORE READING IT.
   *
   * Nothing checked the clip was on disk and finished before the private copy and the frame
   * extraction ran. `recordAsync` resolving does not guarantee the container is flushed — on Android
   * the moov atom is written last, so a clip read microseconds after stop can be present, non-empty,
   * and still undecodable. Every frame then comes back empty and the read reports
   * `no_pose_in_frame` — indistinguishable from "the golfer was not in shot", which is why the
   * first attempt failed and a later retry on the same clip worked.
   *
   * Bounded: ~1.5s of patience at most, and only while the file is actually growing or absent. A
   * ready clip pays one stat call. The wait is RECORDED so the next report can prove whether this
   * was the cause rather than leaving it a theory.
   */
  let fileWaitMs = 0;
  let fileBytes: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FS = require('expo-file-system') as typeof import('expo-file-system');
    let lastSize = -1;
    for (let attempt = 0; attempt < 6; attempt++) {
      const info = await FS.getInfoAsync(videoUri).catch(() => null);
      const size = info?.exists ? ((info as { size?: number }).size ?? 0) : 0;
      fileBytes = size;
      // Settled = present, plausibly a video, and no longer growing between checks.
      if (size > 50_000 && size === lastSize) break;
      lastSize = size;
      if (attempt === 5) break;
      await new Promise((r) => setTimeout(r, 250));
      fileWaitMs += 250;
    }
    if (fileWaitMs > 0) console.log(`[pose] waited ${fileWaitMs}ms for the clip to settle (${fileBytes} bytes)`);
  } catch { /* cannot stat — proceed exactly as before */ }

  /**
   * 2026-08-19 (Tim — "in analysis, I wanna see what fails silently so we can adjust").
   *
   * Three ways this function could produce NO usable swing read and say nothing to the issue log:
   * the private clip copy failing, zero frames coming back, and the on-device pose module being
   * absent. All three ended in console only. A console line is invisible on a tester's phone, so the
   * log read as healthy while the player got no measured read at all — the same shape as the 08-17
   * busy-bail, where an unlogged path was indistinguishable from no failure.
   *
   * `kind` is honest about severity: a failure that costs the read is an analysis_error and reaches
   * the owner inbox; an expected degradation on a build without the native module is a diag, kept on
   * device only. Never throws — this is a failure path.
   */
  const logPose = (stage: string, details: Record<string, unknown>, kind: 'analysis_error' | 'diag' = 'analysis_error') => {
    try {
      // 2026-09-01 — every pose diagnostic carries WHICH ENGINE served it and how fast. Without this
      // "pose returned nothing" reads identically whether MediaPipe ran on-device in 40ms or the
      // cloud proxy was called and timed out. The explicit details win on key collision — a caller
      // that measured something itself knows more than the shared bus does.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pose = require('./poseTelemetry').describePoseTelemetry() as Record<string, unknown> | null;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../store/issueLogStore').useIssueLogStore.getState()
        .addAppEvent(stage, { ...(pose ?? {}), ...details }, kind);
    } catch { /* best-effort */ }
  };

  // 2026-08-09 (speed #3) — shared refcounted copy (services/swing/sharedClipCopy): one copy per
  // clip serves pose + tempo + club path + ball departure. Refusal-on-failure unchanged.
  let sharedCopy: { uri: string; release: () => void } | null = null;
  try {
    const { acquireClipCopy } = await import('./swing/sharedClipCopy');
    sharedCopy = await acquireClipCopy(videoUri);
  } catch { /* acquire failed — refusal below */ }
  if (!sharedCopy) {
    console.warn('[pose] private copy failed — skipping frame extraction to avoid a native crash');
    // Costs the ENTIRE measured read (no biomech, no skeleton, no dimensions). Was console-only.
    logPose('pose_private_copy_failed', { videoUri: videoUri.slice(-40), windowed: !!window });
    return null;
  }
  workUri = sharedCopy.uri;

  // 2026-09-01 — `source` travels WITH the time, so a fraction can never be read back as a strike.
  let positionTimes: { key: PoseFrame['position']; timeMs: number; source: 'strike' | 'estimated' }[];

  // 2026-07-07 (biomech audit #2) — STRIKE-ANCHORED sampling. The fixed window
  // fractions put "P4_top" mid-backswing and "P6_impact" 100ms past the ball (or,
  // on a clamped first swing, into the FOLLOW-THROUGH) — every address→top/impact
  // metric was then computed across the wrong phases. The app already KNOWS the
  // acoustic strike time; when the caller passes it, anchor the phases to it:
  // impact = the strike exactly, the rest at swing-physics offsets around it.
  if (impactMs != null && impactMs > 0) {
    const lo = window ? window.startMs : 0;
    const hi = window ? window.endMs : durationMs > 500 ? durationMs : Number.MAX_SAFE_INTEGER;
    const clamp = (t: number) => Math.round(Math.max(lo, Math.min(hi, t)));
    positionTimes = [
      { key: 'P1_address' as const, timeMs: clamp(impactMs - 2000), source: 'strike' as const },
      { key: 'P2_takeaway' as const, timeMs: clamp(impactMs - 1200), source: 'strike' as const },
      { key: 'P4_top' as const, timeMs: clamp(impactMs - 320), source: 'strike' as const },
      { key: 'P6_impact' as const, timeMs: clamp(impactMs), source: 'strike' as const },
      { key: 'P10_finish' as const, timeMs: clamp(impactMs + 700), source: 'strike' as const },
    ];
    console.log('[pose] strike-anchored sampling', { impact_ms: impactMs });
  } else if (window && window.endMs - window.startMs >= 500) {
    const span = window.endMs - window.startMs;
    positionTimes = SWING_POSITIONS.map(p => ({
      key: p.key,
      timeMs: Math.round(window.startMs + span * p.fraction),
      source: 'estimated' as const,   // a fraction of the window, not a detected position
    }));
    console.log('[pose] windowed swing sampling', { start_ms: window.startMs, end_ms: window.endMs });
  } else {
    // 2026-05-28 — Fix FO: caller-supplied durationMs is unreliable on
    // library uploads (the swing detail backfill passes 3000 when
    // session.upload.duration_sec is null — typical for camera-roll
    // uploads). Probe the real duration first; if probing yields a
    // meaningfully different number, use it.
    let effectiveDurationMs = durationMs;
    // 2026-06-13 (SPEED) — skip the ~2-8s reprobe when the caller passes a TRUSTED
    // real duration (e.g. the video player's onLoad durationMillis). The probe only
    // ever overrode the unreliable 3000ms upload default or a >50% disagreement; a
    // trusted value triggers neither, so the probe was pure cost on the Motion path.
    const canTrust = trustDuration && durationMs >= 500;
    if (!canTrust) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { probeDurationMs } = require('./poseDetection') as { probeDurationMs: (uri: string) => Promise<number> };
        // 2026-07-30 (audit #13 — "analysis stuck, works on the 3rd try") — probe the PRIVATE COPY, never
        // the original: probeDurationMs runs a native MediaMetadataRetriever, and on the always-looping
        // review the original is being decoded by ExoPlayer → SIGSEGV/hang until a retry. workUri is the
        // copy (made just above, before this probe).
        const probed = await probeDurationMs(workUri);
        if (probed && probed >= 500) {
          // Trust the probe when caller-supplied was the suspicious
          // 3000ms default OR when the probe disagrees by > 50%.
          if (durationMs === 3000 || Math.abs(probed - durationMs) / Math.max(probed, durationMs) > 0.5) {
            console.log('[pose] duration probe correction', { caller_ms: durationMs, probed_ms: probed });
            effectiveDurationMs = probed;
          }
        }
      } catch (e) {
        console.log('[pose] duration probe failed (non-fatal, using caller value)', e);
      }
    }

    if (effectiveDurationMs < 500) {
      console.warn('[pose] video too short to sample', { duration_ms: effectiveDurationMs });
      sharedCopy.release();
      return null;
    }

    // 2026-05-28 — Fix FO: tiered sampling so library uploads of long
    // instructor clips actually hit swing-position frames instead of
    // pre-swing chat. Mirrors poseDetection.ts windows.
    if (effectiveDurationMs > LONG_CLIP_THRESHOLD_MS) {
      positionTimes = LONG_CLIP_POSITIONS.map(p => ({
        key: p.key,
        timeMs: Math.round(effectiveDurationMs * p.fraction),
        source: 'estimated' as const,
      }));
      console.log('[pose] long-clip wide-spread sampling', { duration_ms: effectiveDurationMs });
    } else if (effectiveDurationMs > MEDIUM_CLIP_THRESHOLD_MS) {
      // Medium clips: back-window the last 5s (where the swing usually
      // lives in a short demo / preroll-then-swing capture).
      const windowStartMs = Math.max(0, effectiveDurationMs - MEDIUM_CLIP_BACK_WINDOW_MS);
      const windowMs = effectiveDurationMs - windowStartMs;
      positionTimes = SWING_POSITIONS.map(p => ({
        key: p.key,
        timeMs: windowStartMs + Math.round(windowMs * p.fraction),
        source: 'estimated' as const,
      }));
      console.log('[pose] medium-clip back-window sampling', { duration_ms: effectiveDurationMs, window_start_ms: windowStartMs });
    } else {
      positionTimes = SWING_POSITIONS.map(p => ({
        key: p.key,
        timeMs: Math.round(effectiveDurationMs * p.fraction),
        source: 'estimated' as const,
      }));
    }
  }

  // 2026-07-06 (Tim: "the skeletal overlay is super laggy... barely moves") —
  // 5 anchor frames across a ~2s swing IS the lag: SwingBodyOverlay linearly
  // interpolates between them, so the skeleton slides robotically between five
  // poses. When ON-DEVICE MediaPipe is linked (~100-300ms/frame), densify to
  // ~20 frames across the same span — smooth playback skeleton — while the
  // P-position anchors keep their tags for the biomech read. Cloud-only
  // installs keep the 5-frame behavior (5-15s/frame makes density unaffordable);
  // the native build is what unlocks this. compactPoseFramesForPersist already
  // keeps up to 28 frames, so the dense set persists intact.
  let sampleTimes: { key: PoseFrame['position'] | undefined; timeMs: number; source?: 'strike' | 'estimated' }[] =
    [...positionTimes];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mp = require('./mediaPipePoseService') as { isMediaPipeAvailable: () => boolean };
    if (mp.isMediaPipeAvailable()) {
      const DENSE_TARGET = 20;
      const anchorTimes = positionTimes.map(p => p.timeMs);
      const spanStart = Math.min(...anchorTimes);
      const spanEnd = Math.max(...anchorTimes);
      const extra = DENSE_TARGET - positionTimes.length;
      if (spanEnd - spanStart > 300 && extra > 0) {
        /**
         * 2026-09-01 (Tim — "are we sampling enough frames to be accurate on this?") — NOT WHERE IT
         * MATTERED, AND THE ARITHMETIC IS BLUNT.
         *
         * The extra frames were spread EVENLY across the anchor span. Strike-anchored, that span runs
         * impact-2000ms to impact+700ms — 2,700ms — so 20 frames sit 135ms apart, and they land:
         *
         *     backswing  P1 -> P4   1,680ms   12.4 frames
         *     DOWNSWING  P4 -> P6     320ms    2.4 frames   <- the part that decides the shot
         *     follow     P6 -> P10    700ms    5.2 frames
         *
         * Twelve frames on the slowest part of the swing and two on the fastest. At impact the
         * clubhead is moving ~40m/s, so consecutive frames are metres apart in clubhead terms. Every
         * read that depends on the downswing — the top, the transition, the impact pose, anything
         * that wants to FIND a position rather than assume one — was being asked to work from two
         * samples. Same shape as the club-path sampler fixed earlier today: dense where the body is
         * barely moving, sparse where everything happens.
         *
         * So weight the extra frames toward the strike when we HAVE a strike. The backswing keeps
         * enough to show the shape; the transition-through-impact window gets the bulk. With an
         * estimated anchor there is no honest centre to weight toward, so the even spread stands —
         * clustering on a fraction would concentrate the samples on the wrong 300ms with confidence.
         */
        const strikeAnchor = positionTimes.find(p => p.key === 'P6_impact' && p.source === 'strike');
        const push = (t: number) => {
          if (t > spanStart && t < spanEnd && sampleTimes.every(p => Math.abs(p.timeMs - t) > 40)) {
            sampleTimes.push({ key: undefined, timeMs: Math.round(t) });
          }
        };
        if (strikeAnchor) {
          /**
           * 2026-09-02 (adversarial pass over the previous day's own work) — TWO FAULTS, BOTH THE
           * SAME SHAPE AS ONE FOUND IN THE CLUB-PATH SAMPLER.
           *
           * 1. The core window was FIXED at -420/+260 around the strike and ignored how good that
           *    strike was. A thin acoustic pickup can be a couple of hundred milliseconds out (see
           *    clubPathWindow.anchorToleranceMs), so clustering tightly on it aims the extra frames
           *    confidently at the wrong moment — the failure the tolerance exists to prevent, left
           *    in place here while the club-path sampler was taught to widen.
           *
           * 2. When the anchor sat near the START of the span, `coreStart` collapsed onto
           *    `spanStart` and the entire approach allocation was pushed into a zero-width range and
           *    silently discarded — fewer frames on exactly the swings that are hardest to read.
           *
           * Both are fixed the same way the sampler's were: widen by the anchor's own tolerance, and
           * give a collapsed range's share to its neighbour rather than to nobody.
           */
          const slop = Math.max(0, impactToleranceMs);
          const coreStart = Math.max(spanStart, strikeAnchor.timeMs - 420 - slop);
          const coreEnd = Math.min(spanEnd, strikeAnchor.timeMs + 260 + slop);
          const coreWide = coreEnd > coreStart;
          const approachWide = coreStart > spanStart;
          // Whatever ranges survive share the whole budget; a collapsed one gives its share away.
          const nCore = !approachWide ? extra : coreWide ? Math.round(extra * 0.65) : 0;
          const nRest = extra - nCore;
          if (coreWide) {
            for (let i = 1; i <= nCore; i++) push(coreStart + ((coreEnd - coreStart) * i) / (nCore + 1));
          }
          // The remainder still covers the approach so the swing reads as one motion, not a stub.
          if (approachWide) {
            for (let i = 1; i <= nRest; i++) push(spanStart + ((coreStart - spanStart) * i) / (nRest + 1));
          } else if (!coreWide) {
            for (let i = 1; i <= extra; i++) push(spanStart + ((spanEnd - spanStart) * i) / (extra + 1));
          }
        } else {
          for (let i = 1; i <= extra; i++) push(spanStart + ((spanEnd - spanStart) * i) / (extra + 1));
        }
        sampleTimes.sort((a, b) => a.timeMs - b.timeMs);
        console.log('[pose] on-device densification', {
          anchors: positionTimes.length,
          total: sampleTimes.length,
          weighted: !!strikeAnchor,
        });
      }
    }
  } catch (e) {
    // Not a failure — the read continues on anchors alone — but it IS materially thinner, and
    // silently so. Diag: worth seeing when a device produces sparse reads, not worth an inbox.
    logPose('pose_densification_skipped', { reason: e instanceof Error ? e.message.slice(0, 120) : 'native module absent' }, 'diag');
  }

  // Sequential — on-device runs one detector instance; cloud is polite to the rate limit.
  // (workUri = the private copy made at the top of this function; NEVER the playing original.)
  const frames: PoseFrame[] = [];
  try {
    for (const { key, timeMs, source } of sampleTimes) {
      if (shouldAbort?.()) { console.log('[pose] aborted between frames — playback active'); break; }
      const f = await poseAtTime(workUri, timeMs, key);
      // 2026-09-01 — carry HOW the label was arrived at onto the frame itself. A consumer that reads
      // back `position === 'P6_impact'` must be able to tell a heard strike from a fraction of a clip.
      if (f) frames.push(key && source ? { ...f, positionSource: source } : f);
    }
  } finally {
    sharedCopy.release();
  }
  /**
   * 2026-08-21 (Tim) — FIND HIM, DON'T GIVE UP. "It's gonna be very rare that someone's not gonna
   * be in the frame… if you're recording yourself there's gonna be initial empty time as I walk
   * into the frame, because I have to hit record."
   *
   * That is the normal way a golfer films himself, and it was being treated as a failure. When the
   * swing window is unknown (windowed: false) the sampler spreads evenly across the WHOLE clip — so
   * on a 10s recording where he hits record, walks in around 4s and swings near 7s, most samples
   * land on an empty tee box. Zero frames, "analysis_error", nothing learned.
   *
   * A body that appears late is not an error, it is the recording. So before reporting failure,
   * SEARCH: probe the back half of the clip, where a self-filmed swing always is, and if a body
   * turns up, sample around it properly. Bounded to a handful of probes so a genuinely empty clip
   * still fails fast.
   *
   * This runs ONLY after the planned pass found nothing, so a normal swing pays nothing for it.
   */
  if (frames.length === 0 && !(window && window.endMs - window.startMs >= 500) && durationMs >= 2000) {
    const scanAt = [0.55, 0.7, 0.85, 0.95].map(f => Math.round(durationMs * f));
    let anchorMs: number | null = null;
    for (const t of scanAt) {
      if (shouldAbort?.()) break;
      const probe = await poseAtTime(workUri, t, 'P6_impact');
      if (probe) { anchorMs = t; frames.push(probe); break; }
    }
    if (anchorMs != null) {
      console.log('[pose] recovery scan found a body at', anchorMs, 'ms — the earlier frames were the walk-in');
      // Sample around the body we actually found, rather than around the whole clip.
      const around: { key: PoseFrame['position']; timeMs: number }[] = [
        { key: 'P1_address', timeMs: Math.max(0, anchorMs - 1200) },
        { key: 'P4_top', timeMs: Math.max(0, anchorMs - 500) },
        { key: 'P10_finish', timeMs: Math.min(durationMs - 50, anchorMs + 600) },
      ];
      for (const { key, timeMs } of around) {
        if (shouldAbort?.()) break;
        const f = await poseAtTime(workUri, timeMs, key);
        if (f) frames.push(f);
      }
      frames.sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
      logPose('pose_recovered_after_walk_in', { anchorMs, got: frames.length }, 'diag');
    }
  }
  if (frames.length > 0) lastFrameFailure = null;
  console.log('[pose] extracted frames', { requested: sampleTimes.length, got: frames.length, windowed: !!(window && window.endMs - window.startMs >= 500) });
  if (frames.length === 0) {
    // Asked for N frames and got none: the swing has no measured read at all. Console-only until now,
    // so a device failing EVERY extraction looked identical to a device that was never asked.
    /**
     * The fields that make the next report decisive instead of another blind repeat:
     *   nativePose false → the MediaPipe module is not linked in this build, so EVERY frame returns
     *                      null and no amount of re-recording will help. A build problem.
     *   reason 'no_pose_in_frame' with nativePose true → we read the video and found no body:
     *                      framing, distance, or the player out of shot. A coaching problem.
     *   reason 'thumbnail_failed: …' → we could not read the video at all. A platform problem.
     * One field separates three fixes that have nothing to do with each other.
     */
    let nativePose: boolean | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      nativePose = (require('./mediaPipePoseService') as typeof import('./mediaPipePoseService')).isMediaPipeAvailable();
    } catch { nativePose = null; }
    logPose('pose_zero_frames', {
      requested: sampleTimes.length,
      windowed: !!(window && window.endMs - window.startMs >= 500),
      durationMs: Math.round(durationMs),
      reason: lastFrameFailure ?? 'unknown',
      nativePose,
      // 2026-08-23 — these two separate "the file was not ready" from "the golfer was not in shot",
      // which reported identically before and sent every investigation down the wrong path.
      fileBytes,
      fileWaitMs,
    });
    lastFrameFailure = null;
    return null;
  }
  return frames;
}

/** 2026-07-01 (audit H1) — the cage store used to STRIP biomechanics.frames to []
 *  on persist (the Greenhill SQLITE_FULL fix). That silently killed the swing
 *  overlay (skeleton + tempo arc) on every reload — it showed right after analysis,
 *  then vanished forever. Instead of dropping the frames, DOWNSAMPLE them: keep at
 *  most `maxFrames` (always including the position-tagged P1..P10 keyframes the
 *  biomech read needs) and round coords.
 *
 *  2026-07-01 (re-audit) — keep ALL keypoints (not just the overlay joints): the
 *  persisted frames are ALSO re-fed to the swing-comparison engine, which reads
 *  head/foot joints the overlay doesn't draw (e.g. head-drift). Dropping non-overlay
 *  joints made a reloaded-then-compared swing lose those metrics. Only sub-threshold
 *  (<0.2) keypoints are dropped — the biomech/compare code discards those anyway. At
 *  today's real input (5 keyframes) this is still tiny; the frame cap bounds the
 *  worst case. Verdicts/numbers persist separately, so this only affects visuals +
 *  the compare frames, never the stored analysis. */
export function compactPoseFramesForPersist(frames: PoseFrame[], maxFrames = 28): PoseFrame[] {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  const sorted = [...frames].sort((a, b) => a.timestampMs - b.timestampMs);
  const keep = new Set<number>();
  sorted.forEach((f, i) => { if (f.position) keep.add(i); });
  if (sorted.length <= maxFrames) {
    sorted.forEach((_, i) => keep.add(i));
  } else {
    const need = maxFrames - keep.size;
    if (need > 0) {
      const step = (sorted.length - 1) / need;
      for (let j = 0; j <= need; j++) keep.add(Math.round(j * step));
    }
  }
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return [...keep].sort((a, b) => a - b).slice(0, maxFrames).map((i) => {
    const f = sorted[i];
    const compact: PoseFrame = {
      timestampMs: f.timestampMs,
      keypoints: f.keypoints
        .filter(k => k.name != null && k.score >= MIN_PERSIST_SCORE)
        .map(k => ({ name: k.name, x: round(k.x), y: round(k.y), score: round(k.score) })),
    };
    if (f.position) compact.position = f.position;
    if (f.frameW) compact.frameW = f.frameW;
    if (f.frameH) compact.frameH = f.frameH;
    return compact;
  });
}
const MIN_PERSIST_SCORE = 0.2;

// ─── Acoustic-anchored tempo ─────────────────────────────────────────

/** Backswing:downswing tempo + transition read for a single swing.
 *  Ratio ≈ 3:1 is the tour standard. Every numeric field is null when we
 *  couldn't read it from real signal — the UI shows "—" rather than a
 *  fabricated number. */
export interface SwingTempo {
  ratio: number | null;
  backswingMs: number | null;
  downswingMs: number | null;
  /** Top-of-backswing time relative to clip start (ms) — the transition. */
  topMs: number | null;
  /** Kinematic-sequence score 0..100 (hips lead the downswing = high),
   *  computed from REAL top + REAL impact frames. Null when either frame
   *  lacked the hip/shoulder keypoints. This is the "transition quality"
   *  read — see header note: NOT the fixed-fraction sequencingScore that
   *  computeBiomechanics() produces. */
  sequencingScore: number | null;
  // 'acoustic_pose' = impact anchored by the acoustic strike (cage/range acoustic swings).
  // 'video_pose'    = impact anchored by the video segmenter's frame-accurate strike (video /
  //                   range / uploaded swings — no acoustic strike). Same pose-derived tempo
  //                   shape; the only difference is where the impact instant came from. Both
  //                   display identically (Tim, 2026-07-19 — "tempo on all swings", clean number).
  source: 'acoustic_pose' | 'video_pose' | 'none';
  confidence: 'med' | 'low';
}

const NO_TEMPO: SwingTempo = {
  ratio: null, backswingMs: null, downswingMs: null, topMs: null,
  sequencingScore: null, source: 'none', confidence: 'low',
};

/** Hips-lead-the-downswing score (0..100) from two real frames. Mirrors
 *  the formula in computeBiomechanics() but takes caller-supplied frames
 *  so we can anchor it to the REAL top + impact instead of clip
 *  fractions. Compares hip-width vs shoulder-width opening between the
 *  two frames: hips opening faster than shoulders = the tour sequence. */
function sequencingFromFrames(top: PoseFrame, impact: PoseFrame): number | null {
  const hipTopW = pairWidth(top, 'left_hip', 'right_hip');
  const hipImpactW = pairWidth(impact, 'left_hip', 'right_hip');
  const shTopW = pairWidth(top, 'left_shoulder', 'right_shoulder');
  const shImpactW = pairWidth(impact, 'left_shoulder', 'right_shoulder');
  if (!hipTopW || !hipImpactW || !shTopW || !shImpactW || hipTopW <= 0 || shTopW <= 0) return null;
  const diff = (hipImpactW - hipTopW) / hipTopW - (shImpactW - shTopW) / shTopW;
  const clamped = Math.max(-0.30, Math.min(0.30, diff));
  return Math.round(((clamped + 0.30) / 0.60) * 100);
}

/**
 * 2026-08-09 (verification wave C3 + speed #2) — HONEST tempo from the dense pose frames the biomech
 * pass ALREADY extracted, anchored on a REAL impact time (acoustic strike or the vision locator's
 * estimate). Reads the actual wrist-Y series — top = hands highest, takeaway = 20% of observed travel —
 * with the same sanity gates as deriveSwingTempo, but with ZERO extra video decodes (the old upload
 * path re-copied the clip + ran 11 more thumbnail+pose calls; worse, tempoFromBiomechanics computed the
 * ratio from SYNTHETIC anchor timestamps, which is a CONSTANT of the offset table — every windowed
 * upload returned exactly the same "tempo" regardless of the swing. Fabricated metric, now dead).
 * Returns NO_TEMPO whenever the series is too sparse or shows no clean interior top — never a guess.
 */
export function tempoFromPoseFrames(
  frames: PoseFrame[] | null | undefined,
  impactMs: number | null | undefined,
  impactSource: 'acoustic' | 'video' = 'video',
): SwingTempo {
  if (!frames || frames.length === 0 || impactMs == null || !(impactMs > 0)) return NO_TEMPO;
  // Backswing-side wrist series: strictly before impact (small guard so the impact frame itself
  // never reads as "top" when the hands are low through the ball).
  const series: { t: number; y: number; frame: PoseFrame }[] = [];
  for (const f of [...frames].sort((a, b) => a.timestampMs - b.timestampMs)) {
    if (f.timestampMs > impactMs - 80) continue;
    const lw = getKp(f, 'left_wrist');
    const rw = getKp(f, 'right_wrist');
    const ys = [lw?.y, rw?.y].filter((v): v is number => typeof v === 'number');
    if (ys.length === 0) continue;
    series.push({ t: f.timestampMs, y: ys.reduce((a, b) => a + b, 0) / ys.length, frame: f });
  }
  if (series.length < 6) return NO_TEMPO;
  if (series[series.length - 1].t - series[0].t < 350) return NO_TEMPO;
  let topIdx = 0;
  for (let i = 1; i < series.length; i++) if (series[i].y < series[topIdx].y) topIdx = i;
  if (topIdx === 0 || topIdx === series.length - 1) return NO_TEMPO; // no interior reversal = no read
  const addressY = series[0].y;
  const travel = addressY - series[topIdx].y;
  if (travel <= 0) return NO_TEMPO;
  const onsetDelta = travel * 0.2;
  let takeIdx = 0;
  for (let i = 0; i <= topIdx; i++) {
    if (addressY - series[i].y >= onsetDelta) { takeIdx = i; break; }
  }
  const topMs = series[topIdx].t;
  const backswingMs = topMs - series[takeIdx].t;
  const downswingMs = impactMs - topMs;
  if (downswingMs < 80 || downswingMs > 700) return NO_TEMPO;
  if (backswingMs < 250 || backswingMs > 1600) return NO_TEMPO;
  const ratio = backswingMs / downswingMs;
  if (!(ratio >= 1.0 && ratio <= 6.0)) return NO_TEMPO;
  // Sequencing from the real top frame + the frame nearest impact (must be within 150ms to count).
  let sequencingScore: number | null = null;
  const near = [...frames].sort((a, b) => Math.abs(a.timestampMs - impactMs) - Math.abs(b.timestampMs - impactMs))[0];
  if (near && Math.abs(near.timestampMs - impactMs) <= 150) {
    sequencingScore = sequencingFromFrames(series[topIdx].frame, near);
  }
  return {
    ratio: Math.round(ratio * 10) / 10,
    backswingMs,
    downswingMs,
    topMs,
    sequencingScore,
    source: impactSource === 'acoustic' ? 'acoustic_pose' : 'video_pose',
    confidence: series.length >= 8 && takeIdx > 0 ? 'med' : 'low',
  };
}

/**
 * 2026-06-08 — Vision swing tempo + transition (acoustic-verified impact).
 *
 * PRINCIPLE: tempo character — takeaway, top-of-backswing, transition —
 * is VISION/pose-derived (analysis of the actual swing motion), NOT
 * acoustic. Acoustic only supplies the verified impact instant (its real
 * role is smash factor + shot verification/quality), never the shape of
 * the tempo. Putt tempo is likewise fully vision.
 *
 * The classic tour ratio is backswing:downswing ≈ 3:1, and the
 * transition (top-of-backswing changeover) is where it lives. We measure
 * both honestly from two anchors:
 *   • IMPACT — supplied by the caller from the acoustic strike detector
 *     (services/swing/strikeDetector), precise to the audio sample. This
 *     is `impactMs` (relative to clip start).
 *   • TOP-OF-BACKSWING + TAKEAWAY — read from pose: we sample frames
 *     across the backswing window before impact and track the hands
 *     (wrist keypoints). Hands highest (min wrist-y, image y grows
 *     downward) = the top; takeaway = first frame the hands left address
 *     height. Sequencing is then read from the REAL top + impact frames.
 *
 * Cost note: each sample is one server pose call (no on-device pose yet —
 * see services/poseEstimator.ts). We focus samples on the backswing
 * window (we don't need the downswing densely — impact is already known
 * acoustically) and keep the count modest; callers should cache per swing
 * so this runs once. If/when on-device pose lands, pass denser frames
 * cheaply. Everything derives from real signal — no clip fractions. When
 * the curve shows no clean interior peak we return all-null.
 */
export async function deriveSwingTempo(
  videoUri: string,
  impactMs: number,
  opts?: { leadMs?: number; tailMs?: number; samples?: number; impactSource?: 'acoustic' | 'video' },
): Promise<SwingTempo> {
  // Backswing-focused window: from ~address up to just before impact. We
  // don't sample the downswing — impact is the acoustic anchor and the
  // top sits at the end of the backswing.
  const leadMs = opts?.leadMs ?? 1400;   // how far before impact to start
  const tailMs = opts?.tailMs ?? 120;    // stop this long before impact
  const samples = Math.max(8, opts?.samples ?? 10);
  const startMs = Math.max(0, impactMs - leadMs);
  const endMs = impactMs - tailMs;
  if (endMs - startMs < 350) return NO_TEMPO; // need room for a backswing

  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    times.push(Math.round(startMs + ((endMs - startMs) * i) / (samples - 1)));
  }

  // 2026-07-30 (analysis audit C1 — HIGHEST-freq crash) — tempo is the DEFAULT headline metric, so this
  // fires the instant review opens while <Video> is looping the SAME clip. Decoding the original with a
  // native retriever while ExoPlayer plays it → SIGSEGV to the launcher (the exact vector poseFrames /
  // clubPath were hardened against; the fix hadn't reached here). Mirror them EXACTLY: sample from a
  // PRIVATE COPY (distinct file handle → the crash condition can't occur), never touch the playing
  // original, and delete the copy when done. Copy failure → NO_TEMPO (a missing tempo beats a crash).
  // 2026-08-09 (speed #3) — shared refcounted copy; refcounting solves audit C-1's re-entry class
  // structurally (no consumer can delete a file another still holds).
  let workUri = videoUri;
  let sharedCopy: { uri: string; release: () => void } | null = null;
  try {
    const { acquireClipCopy } = await import('./swing/sharedClipCopy');
    sharedCopy = await acquireClipCopy(videoUri);
  } catch { /* acquire failed — refusal below */ }
  if (!sharedCopy) {
    console.warn('[tempo] private copy failed — skipping tempo read to avoid a native crash');
    return NO_TEMPO;
  }
  workUri = sharedCopy.uri;

  try {
    // Sample pose at each time; keep the frame so we can read sequencing
    // from the real top later.
    const series: { t: number; y: number; frame: PoseFrame }[] = [];
    for (const t of times) {
      try {
        const { uri } = await VideoThumbnails.getThumbnailAsync(workUri, { time: t, quality: 0.6 });
        const frame = await analyzePoseFromUri(uri, t);
        if (!frame) continue;
        const lw = getKp(frame, 'left_wrist');
        const rw = getKp(frame, 'right_wrist');
        const ys = [lw?.y, rw?.y].filter((v): v is number => typeof v === 'number');
        if (ys.length === 0) continue;
        series.push({ t, y: ys.reduce((a, b) => a + b, 0) / ys.length, frame });
      } catch {
        // a few gaps are fine
      }
    }
    if (series.length < 6) return NO_TEMPO;

    // Top of backswing = hands highest = minimum y. Must be interior
    // (not first/last sample) to count as a real reversal.
    let topIdx = 0;
    for (let i = 1; i < series.length; i++) {
      if (series[i].y < series[topIdx].y) topIdx = i;
    }
    if (topIdx === 0 || topIdx === series.length - 1) return NO_TEMPO;

    // Takeaway = first sample where the hands have risen meaningfully from
    // address (first-sample) height. Threshold scales to observed travel
    // so it's robust to normalized-vs-pixel coordinates.
    const addressY = series[0].y;
    const travel = addressY - series[topIdx].y; // positive: hands went up
    if (travel <= 0) return NO_TEMPO;
    const onsetDelta = travel * 0.2;
    let takeIdx = 0;
    for (let i = 0; i <= topIdx; i++) {
      if (addressY - series[i].y >= onsetDelta) { takeIdx = i; break; }
    }

    const topMs = series[topIdx].t;
    const backswingMs = topMs - series[takeIdx].t;
    const downswingMs = impactMs - topMs;

    // Sanity windows for a real full/partial swing.
    if (downswingMs < 80 || downswingMs > 700) return NO_TEMPO;
    if (backswingMs < 250 || backswingMs > 1600) return NO_TEMPO;
    const ratio = backswingMs / downswingMs;
    if (!(ratio >= 1.0 && ratio <= 6.0)) return NO_TEMPO;

    // Transition/sequencing from the REAL top + REAL impact frame. One more
    // pose call (only when tempo itself is valid, so we never pay it for a
    // throwaway read).
    let sequencingScore: number | null = null;
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(workUri, { time: impactMs, quality: 0.6 });
      const impactFrame = await analyzePoseFromUri(uri, impactMs);
      if (impactFrame) sequencingScore = sequencingFromFrames(series[topIdx].frame, impactFrame);
    } catch {
      // sequencing is optional — tempo still stands without it
    }

    const clean = series.length >= 8 && takeIdx > 0;
    return {
      ratio: Math.round(ratio * 10) / 10,
      backswingMs,
      downswingMs,
      topMs,
      sequencingScore,
      source: opts?.impactSource === 'video' ? 'video_pose' : 'acoustic_pose',
      confidence: clean ? 'med' : 'low',
    };
  } finally {
    sharedCopy.release();
  }
}
