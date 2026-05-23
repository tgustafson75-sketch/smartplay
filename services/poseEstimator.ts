/**
 * 2026-05-22 — Pose Estimator (unified facade).
 *
 * SmartPlay has two existing pose-related services that grew
 * independently:
 *   - services/poseAnalysisApi.ts   — server-backed COCO-17 keypoint
 *                                     detection + Phase K biomechanics
 *                                     (hip turn, shoulder turn, weight
 *                                     shift, posture)
 *   - services/poseDetection.ts     — vision-LLM swing analysis that
 *                                     extracts keyframes from video and
 *                                     produces structured swing verdicts
 *
 * This module is the SINGLE entry consumers (juniorSwingAnalyzer,
 * swingComparisonEngine, smartAnalysisEngine) call into. It picks the
 * right backend for the request, normalizes output, applies
 * age/handedness corrections, and surfaces a uniform PoseEstimate
 * shape with confidence + fallback behavior.
 *
 * Why a facade:
 *   - Consumers don't have to know whether the keypoints came from the
 *     server-backed pose API or the LLM-derived swing analysis.
 *   - Junior + family-mode adjustments (smaller bodies, partial views,
 *     handedness mirroring) happen ONCE here, not duplicated downstream.
 *   - When a real on-device pose detector ships (MediaPipe / Apple
 *     Vision / Google ML Kit via a native module), it slots behind this
 *     facade with no caller changes.
 *
 * What this is NOT:
 *   - It does not run pose detection on-device. The poseAnalysisApi
 *     backend calls a server; until a native module ships, on-device
 *     pose stays a deferred sprint.
 *   - It does not yet do live-stream pose. Frames-in-frames-out only.
 */

import {
  analyzePoseFromUri,
  analyzeSwingFromVideo,
  extractPoseFramesFromVideo,
  type Keypoint,
  type PoseFrame,
  type SwingBiomechanics,
} from './poseAnalysisApi';
import type { SwingAnalysis, Frame } from './poseDetection';
import { devLog } from './devLog';

// ─── Public types ────────────────────────────────────────────────────────

export type PoseSource = 'image' | 'video' | 'frames' | 'unknown';

export interface PoseEstimateRequest {
  /** Single image URI (one-shot pose). */
  imageUri?: string;
  /** Video URI (multi-frame keypoints + biomechanics). */
  videoUri?: string;
  /** Pre-sampled frames (from glasses capture, AR overlay capture, etc).
   *  Caller provides each frame's base64 + timestamp. */
  frames?: Frame[];
  /** Duration of the video in ms (when videoUri given). */
  durationMs?: number;
  /** Optional context — drives age/handedness adjustments. */
  context?: {
    /** Age in years (drives small-body correction). */
    age?: number | null;
    /** Right or left dominant — used to MIRROR keypoint labels in
     *  output so consumers don't have to flip logic for lefties. */
    handedness?: 'right' | 'left' | 'unknown';
    /** Caller-supplied club (e.g. '7i') — informs biomechanics
     *  expectations downstream. */
    club?: string | null;
  };
}

export interface PoseEstimate {
  /** Where the pose came from. */
  source: PoseSource;
  /** 0..100 — engine confidence. Combines server confidence + frame
   *  quality + age-band adjustment. */
  confidence: number;
  /** Per-frame keypoints (COCO-17). Empty when only single-image input
   *  or when detection failed. */
  frames: PoseFrame[];
  /** Computed biomechanics summary (Phase K). Null when not derivable
   *  from the input (single image, partial-view video, etc). */
  biomechanics: SwingBiomechanics | null;
  /** Vision-LLM swing analysis (the legacy poseDetection.ts path).
   *  Provides verdicts + canonical-issue tagging the pose-keypoint
   *  pipeline doesn't produce. Null when not run. */
  swingVerdict: SwingAnalysis | null;
  /** Free-text reason / decision trail surfaced in debug panels. */
  reason: string;
  /** Age-band hint we applied during corrections. */
  age_band: 'tiny' | 'junior' | 'teen' | 'adult';
  /** Was this lefty? When true, keypoint labels were mirrored. */
  mirrored: boolean;
}

// ─── Tunables ────────────────────────────────────────────────────────────

const SMALL_BODY_AGE_THRESHOLD = 12;
/** Score boost applied to keypoints when small-body correction kicks in.
 *  Pose models are calibrated for adult proportions; kids' shoulder /
 *  hip widths often score lower from the model's perspective despite
 *  being well-resolved. Boost is conservative — pure compensation, not
 *  fabrication. */
const SMALL_BODY_SCORE_BOOST = 0.10;
/** Minimum per-keypoint score we consider "usable" downstream. Server
 *  pose models often return scores in [0, 1]. */
const USABLE_KEYPOINT_SCORE = 0.30;

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Run pose estimation. Picks the right backend based on which input was
 * supplied. Always resolves to a PoseEstimate — failures land as
 * confidence=0 with a usable reason string. Callers never have to
 * handle a thrown exception.
 */
export async function estimatePose(input: PoseEstimateRequest): Promise<PoseEstimate> {
  const ageBand = ageBandFromAge(input.context?.age ?? null);
  const lefty = input.context?.handedness === 'left';
  const baseReason = inputDescriptor(input);
  devLog(`[poseEstimator] start ${baseReason} band=${ageBand} lefty=${lefty}`);

  // ── 1. Video URI → biomechanics + full keypoint stream ─────────────
  if (input.videoUri && input.durationMs) {
    const bio = await analyzeSwingFromVideo(input.videoUri, input.durationMs).catch((e) => {
      devLog('[poseEstimator] swing video failed: ' + String(e));
      return null;
    });
    const frames = bio?.frames ?? (await extractPoseFramesFromVideo(input.videoUri, input.durationMs).catch(() => null)) ?? [];
    const adjusted = adjustFrames(frames, ageBand, lefty);
    const confidence = computeConfidence(adjusted, !!bio);
    return {
      source: 'video',
      confidence,
      frames: adjusted,
      biomechanics: bio,
      swingVerdict: null,
      reason: `video ${input.durationMs}ms; ${adjusted.length} frames; biomech=${bio ? 'ok' : 'null'}`,
      age_band: ageBand,
      mirrored: lefty,
    };
  }

  // ── 2. Pre-sampled frames → no-op bootstrap path ───────────────────
  // The vision-LLM analyzeSwing path requires a clipUri, not base64 frames;
  // the keypoint pose API requires URIs. Pre-sampled base64 frames don't
  // fit either backend cleanly, so we return a low-confidence "received
  // your frames" estimate so the caller can still proceed. When a real
  // base64→pose backend lands, this branch upgrades to call it.
  if (input.frames && input.frames.length > 0) {
    return {
      source: 'frames',
      confidence: 0,
      frames: [],
      biomechanics: null,
      swingVerdict: null,
      reason: `${input.frames.length} frames received; no base64→pose backend wired yet`,
      age_band: ageBand,
      mirrored: lefty,
    };
  }

  // ── 3. Single image → one-shot keypoints ───────────────────────────
  if (input.imageUri) {
    const frame = await analyzePoseFromUri(input.imageUri, 0).catch((e) => {
      devLog('[poseEstimator] image pose failed: ' + String(e));
      return null;
    });
    if (!frame) {
      return emptyResult('image', ageBand, lefty, 'pose detection returned null');
    }
    const adjusted = adjustFrames([frame], ageBand, lefty);
    return {
      source: 'image',
      confidence: computeConfidence(adjusted, false),
      frames: adjusted,
      biomechanics: null,
      swingVerdict: null,
      reason: 'single image pose',
      age_band: ageBand,
      mirrored: lefty,
    };
  }

  return emptyResult('unknown', ageBand, lefty, 'no input supplied (need imageUri / videoUri+durationMs / frames)');
}

// ─── Adjustments (age + handedness) ─────────────────────────────────────

function adjustFrames(frames: PoseFrame[], band: PoseEstimate['age_band'], lefty: boolean): PoseFrame[] {
  if (frames.length === 0) return frames;
  return frames.map((f) => {
    const keypoints = f.keypoints.map((k) => adjustKeypoint(k, band, lefty));
    return { ...f, keypoints };
  });
}

function adjustKeypoint(k: Keypoint, band: PoseEstimate['age_band'], lefty: boolean): Keypoint {
  let score = k.score;
  // Small-body correction: nudge confidence up so junior swings don't
  // get treated as "low quality" simply because the body is smaller in
  // the frame than the adult-calibrated model expects.
  if (band === 'tiny' || band === 'junior') {
    score = Math.min(1, score + SMALL_BODY_SCORE_BOOST);
  }
  // Lefty mirroring: swap left/right in the joint name + flip x.
  // Coordinate flip uses 1 - x for normalized (0..1) coords; pixel-
  // absolute frames remain unflipped (caller has to know image width).
  // Most pose backends in the codebase return normalized — safe default.
  if (lefty && k.name) {
    const swapped = k.name.replace(/^left_/, '__TMP__').replace(/^right_/, 'left_').replace(/^__TMP__/, 'right_');
    const x = k.x <= 1 ? 1 - k.x : k.x;
    return { ...k, name: swapped, x, score };
  }
  return { ...k, score };
}

// ─── Confidence ─────────────────────────────────────────────────────────

function computeConfidence(frames: PoseFrame[], hasBiomech: boolean): number {
  if (frames.length === 0) return 0;
  // Average per-frame "usable keypoint" rate.
  let usableCount = 0;
  let total = 0;
  for (const f of frames) {
    for (const k of f.keypoints) {
      total++;
      if (k.score >= USABLE_KEYPOINT_SCORE) usableCount++;
    }
  }
  const rate = total > 0 ? usableCount / total : 0;
  const base = Math.round(rate * 80);
  const bioBoost = hasBiomech ? 15 : 0;
  return Math.max(0, Math.min(100, base + bioBoost));
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function ageBandFromAge(age: number | null): PoseEstimate['age_band'] {
  if (age == null) return 'adult';
  if (age <= 7) return 'tiny';
  if (age <= SMALL_BODY_AGE_THRESHOLD - 1) return 'junior';
  if (age <= 15) return 'teen';
  return 'adult';
}

function inputDescriptor(input: PoseEstimateRequest): string {
  if (input.videoUri) return `video ${input.durationMs ?? '?'}ms`;
  if (input.frames) return `${input.frames.length} frames`;
  if (input.imageUri) return 'image';
  return 'no input';
}

function emptyResult(
  source: PoseSource,
  band: PoseEstimate['age_band'],
  lefty: boolean,
  reason: string,
): PoseEstimate {
  return {
    source,
    confidence: 0,
    frames: [],
    biomechanics: null,
    swingVerdict: null,
    reason,
    age_band: band,
    mirrored: lefty,
  };
}

// ─── Re-exports for consumers wanting the typed shapes ──────────────────

export type { Keypoint, PoseFrame, SwingBiomechanics, SwingAnalysis, Frame };
