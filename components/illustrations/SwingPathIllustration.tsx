/**
 * Phase 111 — Swing Path illustration.
 *
 * Top-down view of a target line with three swing-path arrows:
 *   - Inside-out (red)
 *   - On-plane (green)
 *   - Outside-in (red)
 * Plus the ball, the target line, and the target.
 *
 * Geometric / instructional, not a stick-figure body. Clean enough to
 * read as professional teaching content. Will be swapped for commissioned
 * art per category if Tim funds illustration work later.
 */

import React from 'react';
import Svg, { Circle, Line, Path, Text as SvgText, Defs, Marker, Polygon } from 'react-native-svg';

interface Props {
  size?: number;
  /** Optional theme tint for the on-plane arrow. */
  okColor?: string;
  /** Optional theme tint for the off-plane arrows. */
  warnColor?: string;
}

export default function SwingPathIllustration({
  size = 220,
  okColor = '#00C896',
  warnColor = '#ef4444',
}: Props) {
  const w = size;
  const h = size * 0.85;
  const ballX = w * 0.5;
  const ballY = h * 0.65;
  const targetX = w * 0.5;
  const targetY = h * 0.10;

  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Defs>
        <Marker id="arrowOk" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <Polygon points="0,0 8,4 0,8" fill={okColor} />
        </Marker>
        <Marker id="arrowWarn" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <Polygon points="0,0 8,4 0,8" fill={warnColor} />
        </Marker>
      </Defs>

      {/* Target line (dashed, faint) */}
      <Line
        x1={ballX}
        y1={ballY}
        x2={targetX}
        y2={targetY}
        stroke="#6b7280"
        strokeWidth={1}
        strokeDasharray="4,4"
      />

      {/* Outside-in path (red, sweeps across target line from outside to inside) */}
      <Path
        d={`M ${ballX + w * 0.22} ${ballY + h * 0.10} Q ${ballX + w * 0.05} ${ballY - h * 0.10} ${ballX - w * 0.18} ${ballY - h * 0.30}`}
        stroke={warnColor}
        strokeWidth={2.5}
        fill="none"
        markerEnd="url(#arrowWarn)"
        opacity={0.85}
      />

      {/* On-plane path (green, follows target line) */}
      <Path
        d={`M ${ballX - w * 0.02} ${ballY + h * 0.08} Q ${ballX} ${ballY - h * 0.05} ${ballX} ${ballY - h * 0.30}`}
        stroke={okColor}
        strokeWidth={3}
        fill="none"
        markerEnd="url(#arrowOk)"
      />

      {/* Inside-out path (red, sweeps across target line from inside to outside) */}
      <Path
        d={`M ${ballX - w * 0.22} ${ballY + h * 0.10} Q ${ballX - w * 0.05} ${ballY - h * 0.10} ${ballX + w * 0.18} ${ballY - h * 0.30}`}
        stroke={warnColor}
        strokeWidth={2.5}
        fill="none"
        markerEnd="url(#arrowWarn)"
        opacity={0.5}
      />

      {/* Ball */}
      <Circle cx={ballX} cy={ballY} r={6} fill="#ffffff" stroke="#6b7280" strokeWidth={1} />

      {/* Target */}
      <Circle cx={targetX} cy={targetY} r={4} fill="#6b7280" />

      {/* Labels */}
      <SvgText x={ballX + w * 0.24} y={ballY + h * 0.18} fontSize={9} fill={warnColor} fontWeight="600">
        Outside-in
      </SvgText>
      <SvgText x={ballX + 6} y={ballY - h * 0.28} fontSize={9} fill={okColor} fontWeight="700">
        On-plane
      </SvgText>
      <SvgText x={ballX - w * 0.32} y={ballY + h * 0.18} fontSize={9} fill={warnColor} fontWeight="600" opacity={0.6}>
        Inside-out
      </SvgText>
    </Svg>
  );
}
