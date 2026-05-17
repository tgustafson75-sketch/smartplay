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
 * Coordinate handling: the pose API output may be normalized (0–1) or
 * pixel-absolute depending on provider. Rather than guess, we compute a
 * viewBox from the bounding box of every keypoint across every frame
 * (with a small padding margin) so the SVG self-fits to whatever
 * coordinate space the API returned. Not pixel-perfect when the video
 * letterboxes inside its container (resizeMode CONTAIN), but it puts
 * the skeleton on the body — the read every user wants.
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
};

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
}: Props) {
  const live = useMemo(() => interpolateFrame(frames, currentTimeMs), [frames, currentTimeMs]);
  const bbox = useMemo(() => computeBBox(frames), [frames]);

  // Swing trace: smooth-ish path through the lead wrist across all frames.
  // We try right_wrist first (right-handed setup, lead wrist of trail hand
  // = right). If not detected we fall back to left_wrist.
  const tracePath = useMemo(() => {
    const sorted = [...frames].sort((a, b) => a.timestampMs - b.timestampMs);
    const traceName = sorted.some(f => getKp(f, 'right_wrist')) ? 'right_wrist' : 'left_wrist';
    const pts = sorted
      .map(f => getKp(f, traceName))
      .filter((k): k is Keypoint => k != null);
    if (pts.length < 2) return null;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const cx = (prev.x + cur.x) / 2;
      const cy = (prev.y + cur.y) / 2;
      d += ` Q ${prev.x} ${prev.y} ${cx} ${cy} T ${cur.x} ${cur.y}`;
    }
    return d;
  }, [frames]);

  if (!bbox || !live) return null;

  const vb = `${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`;
  // Stroke widths derived from bbox so the overlay stays readable at any
  // coordinate scale (normalized vs pixel-absolute).
  const sw = Math.max(bbox.w, bbox.h) * 0.012;
  const dotR = Math.max(bbox.w, bbox.h) * 0.018;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={vb} preserveAspectRatio="xMidYMid meet">
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
                  x1={ka.x} y1={ka.y} x2={kb.x} y2={kb.y}
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
                  cx={k.x}
                  cy={k.y}
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
