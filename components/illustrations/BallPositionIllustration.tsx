/**
 * Phase 111 — Ball Position illustration.
 *
 * Top-down view of stance feet with three balls showing position by club:
 * driver (front of stance), mid-iron (centre), wedge (back of stance).
 */

import React from 'react';
import Svg, { Circle, Rect, Text as SvgText, Line } from 'react-native-svg';

interface Props {
  size?: number;
  okColor?: string;
}

export default function BallPositionIllustration({
  size = 220,
  okColor = '#00C896',
}: Props) {
  const w = size;
  const h = size * 0.55;
  const stanceY = h * 0.55;
  const stanceLeft = w * 0.20;
  const stanceRight = w * 0.80;

  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {/* Stance line */}
      <Line x1={stanceLeft} y1={stanceY} x2={stanceRight} y2={stanceY} stroke="#6b7280" strokeWidth={1} strokeDasharray="3,3" />

      {/* Trail foot (left in graphic; lead is right) */}
      <Rect x={stanceLeft - w * 0.04} y={stanceY - h * 0.10} width={w * 0.08} height={h * 0.20} rx={3} fill="#6b7280" opacity={0.4} />
      <SvgText x={stanceLeft - w * 0.04} y={stanceY + h * 0.20} fontSize={9} fill="#9ca3af">trail</SvgText>

      {/* Lead foot */}
      <Rect x={stanceRight - w * 0.04} y={stanceY - h * 0.10} width={w * 0.08} height={h * 0.20} rx={3} fill="#6b7280" opacity={0.4} />
      <SvgText x={stanceRight - w * 0.05} y={stanceY + h * 0.20} fontSize={9} fill="#9ca3af">lead</SvgText>

      {/* Centre marker */}
      <Line x1={w * 0.5} y1={stanceY - 4} x2={w * 0.5} y2={stanceY + 4} stroke="#9ca3af" strokeWidth={1} />

      {/* Wedge ball (back of stance, near trail foot) */}
      <Circle cx={w * 0.30} cy={stanceY} r={5} fill="#ffffff" stroke="#6b7280" strokeWidth={1} />
      <SvgText x={w * 0.22} y={stanceY - h * 0.18} fontSize={9} fill={okColor} fontWeight="600">wedge</SvgText>

      {/* Mid-iron ball (centre) */}
      <Circle cx={w * 0.5} cy={stanceY} r={5} fill="#ffffff" stroke="#6b7280" strokeWidth={1} />
      <SvgText x={w * 0.43} y={stanceY - h * 0.18} fontSize={9} fill={okColor} fontWeight="600">7-iron</SvgText>

      {/* Driver ball (front of stance, near lead heel) */}
      <Circle cx={w * 0.72} cy={stanceY} r={5} fill="#ffffff" stroke="#6b7280" strokeWidth={1} />
      <SvgText x={w * 0.65} y={stanceY - h * 0.18} fontSize={9} fill={okColor} fontWeight="600">driver</SvgText>
    </Svg>
  );
}
