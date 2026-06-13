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

import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system/legacy';
import { getApiBaseUrl } from './apiBase';

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
  /** Head-position drift from address to impact, in pixels (normalized
   *  to image height — multiply by frame height for absolute). */
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
async function poseAtTime(videoUri: string, timeMs: number, position: PoseFrame['position']): Promise<PoseFrame | null> {
  try {
    const { uri, width, height } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: timeMs, quality: 0.8 });
    const frame = await analyzePoseFromUri(uri, timeMs);
    if (!frame) return null;
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
export function computeBiomechanicsFromFrames(frames: PoseFrame[], angle?: 'down_the_line' | 'face_on' | 'glasses_pov' | null): SwingBiomechanics {
  return computeBiomechanics(frames, angle);
}

function computeBiomechanics(frames: PoseFrame[], angle?: 'down_the_line' | 'face_on' | 'glasses_pov' | null): SwingBiomechanics {
  const address = frames.find(f => f.position === 'P1_address');
  const top = frames.find(f => f.position === 'P4_top');
  const impact = frames.find(f => f.position === 'P6_impact');

  // Hip turn: shoulder/hip width "shrinks" as the body rotates away
  // from the camera. Ratio of width(top)/width(address) → degrees via
  // arccos. Crude but illustrative for a single-camera setup.
  let hipTurnDeg: number | null = null;
  if (address && top) {
    const wA = pairWidth(address, 'left_hip', 'right_hip');
    const wT = pairWidth(top, 'left_hip', 'right_hip');
    if (wA && wT && wA > 0) {
      const ratio = Math.min(1, Math.max(0, wT / wA));
      hipTurnDeg = Math.round((Math.acos(ratio) * 180) / Math.PI);
    }
  }
  let shoulderTurnDeg: number | null = null;
  if (address && top) {
    const wA = pairWidth(address, 'left_shoulder', 'right_shoulder');
    const wT = pairWidth(top, 'left_shoulder', 'right_shoulder');
    if (wA && wT && wA > 0) {
      const ratio = Math.min(1, Math.max(0, wT / wA));
      shoulderTurnDeg = Math.round((Math.acos(ratio) * 180) / Math.PI);
    }
  }

  // Weight shift: lead-ankle x-position relative to mid-stance from
  // address to impact. Positive = moved forward (toward target).
  let weightShiftPct: number | null = null;
  if (address && impact) {
    const lead = getKp(impact, 'left_ankle');
    const trail = getKp(impact, 'right_ankle');
    const leadAddr = getKp(address, 'left_ankle');
    const trailAddr = getKp(address, 'right_ankle');
    if (lead && trail && leadAddr && trailAddr) {
      const stance = Math.abs(trail.x - lead.x) || 1;
      const midAddr = (leadAddr.x + trailAddr.x) / 2;
      const midImpact = (lead.x + trail.x) / 2;
      weightShiftPct = Math.round(((midImpact - midAddr) / stance) * 100);
    }
  }

  // Spine angle delta — head-to-pelvis line angle change.
  let spineAngleDeltaDeg: number | null = null;
  if (address && impact) {
    const noseA = getKp(address, 'nose');
    const noseI = getKp(impact, 'nose');
    const hipA = address.keypoints.find(k => k.name === 'left_hip' || k.name === 'right_hip');
    const hipI = impact.keypoints.find(k => k.name === 'left_hip' || k.name === 'right_hip');
    if (noseA && noseI && hipA && hipI) {
      const angA = angleDeg(noseA, hipA);
      const angI = angleDeg(noseI, hipI);
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
  let hipSlideRatio: number | null = null;
  if (address && top) {
    const hipA = address.keypoints.find(k => k.name === 'left_hip');
    const hipT = top.keypoints.find(k => k.name === 'left_hip');
    const wA = pairWidth(address, 'left_hip', 'right_hip');
    const wT = pairWidth(top, 'left_hip', 'right_hip');
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
      weightShiftPct < 10 ? `Weight shift +${weightShiftPct}% — hanging back; thin/topped contact risk.` :
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
    weightShift: avgScore(address, impact, ['left_ankle', 'right_ankle']),
    spineAngleDelta: avgScore(address, impact, ['nose', 'left_hip', 'right_hip']),
    headDrift: avgScore(address, impact, ['nose', 'left_shoulder', 'right_shoulder']),
    hipSlide: avgScore(address, top, ['left_hip', 'right_hip']),
    sequencing: avgScore(top, impact, ['left_hip', 'right_hip', 'left_shoulder', 'right_shoulder']),
  };

  return {
    hipTurnDeg, shoulderTurnDeg, shoulderTiltDeg,
    weightShiftPct, spineAngleDeltaDeg, headDriftPxNorm, hipSlideRatio,
    sequencingScore,
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
): Promise<SwingBiomechanics | null> {
  const frames = await extractPoseFramesFromVideo(videoUri, durationMs, trustDuration);
  if (!frames) return null;
  return computeBiomechanics(frames, angle);
}

/** 2026-05-22 — Path A (SmartMotion real pose overlay): same keyframe-
 *  extraction pipeline as analyzeSwingFromVideo, but returns the raw
 *  per-position PoseFrames instead of collapsing into a biomechanics
 *  summary. SmartMotion uses this to render a real skeleton at the
 *  most-diagnostic position (P6 impact by default) instead of the
 *  StubSkeletonOverlay's animated mock.
 *
 *  Returns null when the video is too short or every frame failed
 *  pose detection (caller falls back to StubSkeletonOverlay so there's
 *  no regression vs the existing behavior).
 */
export async function extractPoseFramesFromVideo(videoUri: string, durationMs: number, trustDuration = false): Promise<PoseFrame[] | null> {
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
      const probed = await probeDurationMs(videoUri);
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
    return null;
  }

  // 2026-05-28 — Fix FO: tiered sampling so library uploads of long
  // instructor clips actually hit swing-position frames instead of
  // pre-swing chat. Mirrors poseDetection.ts windows.
  let positionTimes: { key: PoseFrame['position']; timeMs: number }[];
  if (effectiveDurationMs > LONG_CLIP_THRESHOLD_MS) {
    positionTimes = LONG_CLIP_POSITIONS.map(p => ({
      key: p.key,
      timeMs: Math.round(effectiveDurationMs * p.fraction),
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
    }));
    console.log('[pose] medium-clip back-window sampling', { duration_ms: effectiveDurationMs, window_start_ms: windowStartMs });
  } else {
    positionTimes = SWING_POSITIONS.map(p => ({
      key: p.key,
      timeMs: Math.round(effectiveDurationMs * p.fraction),
    }));
  }

  // Sequential to be polite to the rate limit (RapidAPI throttles bursts).
  const frames: PoseFrame[] = [];
  for (const { key, timeMs } of positionTimes) {
    const f = await poseAtTime(videoUri, timeMs, key);
    if (f) frames.push(f);
  }
  console.log('[pose] extracted frames', { requested: positionTimes.length, got: frames.length, duration_ms: effectiveDurationMs });
  if (frames.length === 0) return null;
  return frames;
}

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
  source: 'acoustic_pose' | 'none';
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
  opts?: { leadMs?: number; tailMs?: number; samples?: number },
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

  // Sample pose at each time; keep the frame so we can read sequencing
  // from the real top later.
  const series: { t: number; y: number; frame: PoseFrame }[] = [];
  for (const t of times) {
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: t, quality: 0.6 });
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
    const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: impactMs, quality: 0.6 });
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
    source: 'acoustic_pose',
    confidence: clean ? 'med' : 'low',
  };
}
