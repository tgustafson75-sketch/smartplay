/**
 * SwingBodyOverlay — renders a skeleton + swing-arc trace on top of the
 * swing video player using keypoints already computed by the pose pipeline
 * (services/poseAnalysisApi.ts → analyzeSwingFromVideo).
 *
 * Inputs:
 *   - frames: the 5 sampled positions (P1 address … P10 finish), each with
 *     keypoints. Already stored on the session via setSessionBiomechanics.
 *   - currentTimeMs: the playback position. We interpolate the skeleton
 *     between the two frames bracketing the current time.
 *   - showTrace: when true, draws a smooth path through the lead wrist
 *     across all frames — the canonical "swing arc" view used by every
 *     pro swing-review app.
 *
 * Coordinate handling — two paths:
 *   1. ALIGNED (preferred): when frames carry frameW/frameH (captured from
 *      the source thumbnail), we draw in true frame-pixel space — viewBox =
 *      "0 0 frameW frameH" with preserveAspectRatio matched to the video's
 *      resizeMode ("meet" for CONTAIN, "slice" for COVER). The SVG then
 *      letterboxes/crops EXACTLY like the video, so shoulders/hips/ankles
 *      land on the body. Normalized (0–1) coords are scaled up to frame
 *      pixels; pixel-absolute coords are used as-is.
 *   2. FALLBACK (old swings w/o dims): bbox-fit viewBox — self-fits to the
 *      keypoint bounding box. Keeps the skeleton roughly on the body but
 *      can drift since absolute position + frame aspect are unknown.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Line, Circle, G } from 'react-native-svg';
import type { PoseFrame, Keypoint } from '../../services/poseAnalysisApi';

const SKELETON_EDGES: [string, string][] = [
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

const MIN_KP_SCORE = 0.2;

type Props = {
  frames: PoseFrame[];
  currentTimeMs: number;
  showSkeleton?: boolean;
  showTrace?: boolean;
  /** Must match the underlying <Video> resizeMode so the overlay
   *  letterboxes/crops identically. 'contain' = letterbox (meet),
   *  'cover' = crop (slice). Defaults to 'contain'. */
  resizeMode?: 'contain' | 'cover';
};

/** Detect whether keypoint coords are normalized 0–1 vs pixel-absolute by
 *  the largest coordinate seen. Pixel coords are in the 100s; normalized
 *  stay ≤ ~1, so a 1.5 threshold separates them robustly. */
function coordsAreNormalized(frames: PoseFrame[]): boolean {
  let maxCoord = 0;
  for (const f of frames) {
    for (const k of f.keypoints) {
      if (k.score < MIN_KP_SCORE) continue;
      if (Math.abs(k.x) > maxCoord) maxCoord = Math.abs(k.x);
      if (Math.abs(k.y) > maxCoord) maxCoord = Math.abs(k.y);
    }
  }
  return maxCoord <= 1.5;
}

function getKp(frame: PoseFrame, name: string): Keypoint | null {
  const k = frame.keypoints.find(p => p.name === name);
  if (!k || k.score < MIN_KP_SCORE) return null;
  return k;
}

function interpolateFrame(frames: PoseFrame[], timeMs: number): PoseFrame | null {
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0];
  const sorted = [...frames].sort((a, b) => a.timestampMs - b.timestampMs);
  if (timeMs <= sorted[0].timestampMs) return sorted[0];
  if (timeMs >= sorted[sorted.length - 1].timestampMs) return sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (timeMs >= a.timestampMs && timeMs <= b.timestampMs) {
      const span = b.timestampMs - a.timestampMs;
      const t = span > 0 ? (timeMs - a.timestampMs) / span : 0;
      const blended: Keypoint[] = a.keypoints.map(ka => {
        const kb = b.keypoints.find(p => p.name === ka.name);
        if (!kb) return ka;
        return {
          name: ka.name,
          x: ka.x + (kb.x - ka.x) * t,
          y: ka.y + (kb.y - ka.y) * t,
          score: Math.min(ka.score, kb.score),
        };
      });
      return { timestampMs: timeMs, keypoints: blended };
    }
  }
  return sorted[sorted.length - 1];
}

function computeBBox(frames: PoseFrame[]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of frames) {
    for (const k of f.keypoints) {
      if (k.score < MIN_KP_SCORE) continue;
      if (k.x < minX) minX = k.x;
      if (k.y < minY) minY = k.y;
      if (k.x > maxX) maxX = k.x;
      if (k.y > maxY) maxY = k.y;
    }
  }
  if (!isFinite(minX) || !isFinite(minY)) return null;
  const pad = Math.max((maxX - minX) * 0.15, (maxY - minY) * 0.15, 0.05);
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export default function SwingBodyOverlay({
  frames,
  currentTimeMs,
  showSkeleton = true,
  showTrace = true,
  resizeMode = 'contain',
}: Props) {
  const live = useMemo(() => interpolateFrame(frames, currentTimeMs), [frames, currentTimeMs]);
  const bbox = useMemo(() => computeBBox(frames), [frames]);

  // Aligned path: when we know the true frame dimensions, draw in frame-pixel
  // space so the overlay maps onto the body exactly like the video.
  const aligned = useMemo(() => {
    const dimFrame = frames.find(f => (f.frameW ?? 0) > 0 && (f.frameH ?? 0) > 0);
    if (!dimFrame) return null;
    const fw = dimFrame.frameW as number;
    const fh = dimFrame.frameH as number;
    const normalized = coordsAreNormalized(frames);
    return {
      fw, fh,
      // Scale factor to take coords into frame-pixel space.
      sx: normalized ? fw : 1,
      sy: normalized ? fh : 1,
    };
  }, [frames]);

  // Swing trace: smooth-ish path through the lead wrist across all frames.
  // We try right_wrist first (right-handed setup, lead wrist of trail hand
  // = right). If not detected we fall back to left_wrist.
  const tracePath = useMemo(() => {
    const sx = aligned ? aligned.sx : 1;
    const sy = aligned ? aligned.sy : 1;
    const sorted = [...frames].sort((a, b) => a.timestampMs - b.timestampMs);
    const traceName = sorted.some(f => getKp(f, 'right_wrist')) ? 'right_wrist' : 'left_wrist';
    const pts = sorted
      .map(f => getKp(f, traceName))
      .filter((k): k is Keypoint => k != null);
    if (pts.length < 2) return null;
    let d = `M ${pts[0].x * sx} ${pts[0].y * sy}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const cx = (prev.x + cur.x) / 2;
      const cy = (prev.y + cur.y) / 2;
      d += ` Q ${prev.x * sx} ${prev.y * sy} ${cx * sx} ${cy * sy} T ${cur.x * sx} ${cur.y * sy}`;
    }
    return d;
  }, [frames, aligned]);

  if (!live) return null;
  // Aligned mode draws in true frame space and matches the video resizeMode;
  // fallback self-fits to the keypoint bbox.
  let sx = 1, sy = 1, vb: string, par: string, strokeBase: number;
  if (aligned) {
    sx = aligned.sx; sy = aligned.sy;
    vb = `0 0 ${aligned.fw} ${aligned.fh}`;
    par = resizeMode === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
    strokeBase = Math.max(aligned.fw, aligned.fh);
  } else {
    if (!bbox) return null;
    vb = `${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`;
    par = 'xMidYMid meet';
    strokeBase = Math.max(bbox.w, bbox.h);
  }
  // Stroke widths derived from the draw space so the overlay stays readable.
  const sw = strokeBase * 0.012;
  // 2026-06-15 (Tim) — joint dots were too big and overlapped; smaller so the
  // skeleton reads cleanly (joints sit on the lines, not blobs over them).
  const dotR = strokeBase * 0.011;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={vb} preserveAspectRatio={par}>
        {showTrace && tracePath && (
          <Path
            d={tracePath}
            stroke="#F0C030"
            strokeWidth={sw * 0.8}
            strokeOpacity={0.85}
            fill="none"
            strokeLinecap="round"
          />
        )}
        {showSkeleton && (
          <G>
            {SKELETON_EDGES.map(([a, b]) => {
              const ka = getKp(live, a);
              const kb = getKp(live, b);
              if (!ka || !kb) return null;
              return (
                <Line
                  key={`${a}-${b}`}
                  x1={ka.x * sx} y1={ka.y * sy} x2={kb.x * sx} y2={kb.y * sy}
                  stroke="#22d3ee"
                  strokeWidth={sw}
                  strokeOpacity={0.9}
                  strokeLinecap="round"
                />
              );
            })}
            {live.keypoints.map((k, i) => {
              if (k.score < MIN_KP_SCORE) return null;
              return (
                <Circle
                  key={i}
                  cx={k.x * sx}
                  cy={k.y * sy}
                  r={dotR}
                  fill="#ffffff"
                  stroke="#22d3ee"
                  strokeWidth={sw * 0.6}
                />
              );
            })}
          </G>
        )}
      </Svg>
    </View>
  );
}
