/**
 * Skeletal pose overlay — draws keypoints + skeleton edges on top of a
 * still frame for cage post-recording analysis.
 *
 * Phase AP follow-up: works with the typed seam from
 * services/poseInference.ts. When that service ships the actual TFJS
 * inference, this component renders the resulting keypoints without
 * code changes.
 *
 * Rendering: SVG circles for joints, lines for skeleton edges. Line
 * thickness + circle radius scale with viewport so the skeleton is
 * visible on Galaxy Fold both states.
 *
 * Color: brand accent green for joints, lighter green stroke for edges,
 * with confidence-based opacity (less confident keypoints fade).
 *
 * Position: keypoints are normalized 0-1 across the source frame; this
 * component scales them to its width × height props for rendering.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import {
  type Keypoint,
  SKELETON_EDGES,
  KEYPOINT_NAMES,
} from '../../services/poseInference';

interface Props {
  keypoints: Keypoint[];
  width: number;
  height: number;
  /** Minimum keypoint score to render. Default 0.3. */
  minScore?: number;
  /** Brand accent color for joints + edges. Default SmartPlay green. */
  color?: string;
}

export default function SkeletonOverlay({
  keypoints,
  width,
  height,
  minScore = 0.3,
  color = '#00C896',
}: Props) {
  // Build a name → keypoint map for fast edge lookup.
  const byName = new Map<string, Keypoint>();
  for (const k of keypoints) byName.set(k.name, k);

  return (
    <View style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Svg width={width} height={height}>
        {/* Edges first so joints draw on top of edge intersections. */}
        {SKELETON_EDGES.map(([a, b], i) => {
          const ka = byName.get(a);
          const kb = byName.get(b);
          if (!ka || !kb || ka.score < minScore || kb.score < minScore) return null;
          const opacity = Math.min(ka.score, kb.score);
          return (
            <Line
              key={`edge-${i}`}
              x1={ka.x * width}
              y1={ka.y * height}
              x2={kb.x * width}
              y2={kb.y * height}
              stroke={color}
              strokeWidth={3}
              strokeLinecap="round"
              opacity={opacity * 0.85}
            />
          );
        })}

        {/* Joints. Larger radius for major joints (shoulders/hips/knees)
            so they read at a glance. */}
        {KEYPOINT_NAMES.map(name => {
          const k = byName.get(name);
          if (!k || k.score < minScore) return null;
          const isMajor = name === 'left_shoulder' || name === 'right_shoulder' ||
                          name === 'left_hip' || name === 'right_hip' ||
                          name === 'left_knee' || name === 'right_knee';
          return (
            <Circle
              key={`joint-${name}`}
              cx={k.x * width}
              cy={k.y * height}
              r={isMajor ? 6 : 4}
              fill={color}
              stroke="#ffffff"
              strokeWidth={1.5}
              opacity={k.score}
            />
          );
        })}
      </Svg>
    </View>
  );
}
