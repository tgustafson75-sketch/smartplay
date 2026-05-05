/**
 * Phase 111 — Grip illustration.
 *
 * Three V-shapes formed by thumb-and-index showing neutral, strong,
 * and weak grip orientations. The "V" pointing toward trail shoulder
 * is the conventional teaching shorthand.
 */

import React from 'react';
import Svg, { Line, Path, Text as SvgText, Circle } from 'react-native-svg';

interface Props {
  size?: number;
  okColor?: string;
  warnColor?: string;
}

export default function GripIllustration({
  size = 220,
  okColor = '#00C896',
  warnColor = '#ef4444',
}: Props) {
  const w = size;
  const h = size * 0.55;
  const cx = (col: number) => w * (0.20 + col * 0.30);
  const cy = h * 0.55;
  const r = h * 0.20;

  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {/* Three columns: weak | neutral | strong */}

      {/* Weak grip — V points toward target (left in this view) */}
      <Circle cx={cx(0)} cy={cy} r={r} fill="none" stroke="#6b7280" strokeWidth={1.5} />
      <Path d={`M ${cx(0) - r * 0.5} ${cy + r * 0.4} L ${cx(0)} ${cy - r * 0.2} L ${cx(0) - r * 0.7} ${cy - r * 0.1}`} stroke={warnColor} strokeWidth={2} fill="none" />
      <SvgText x={cx(0) - 18} y={h * 0.95} fontSize={10} fill={warnColor} fontWeight="600">weak</SvgText>

      {/* Neutral grip — V points toward trail shoulder (centre) */}
      <Circle cx={cx(1)} cy={cy} r={r} fill="none" stroke="#6b7280" strokeWidth={1.5} />
      <Path d={`M ${cx(1) - r * 0.4} ${cy + r * 0.4} L ${cx(1)} ${cy - r * 0.4} L ${cx(1) + r * 0.4} ${cy + r * 0.4}`} stroke={okColor} strokeWidth={2.5} fill="none" />
      <SvgText x={cx(1) - 22} y={h * 0.95} fontSize={10} fill={okColor} fontWeight="700">neutral</SvgText>

      {/* Strong grip — V points away from target (right) */}
      <Circle cx={cx(2)} cy={cy} r={r} fill="none" stroke="#6b7280" strokeWidth={1.5} />
      <Path d={`M ${cx(2) - r * 0.4} ${cy + r * 0.4} L ${cx(2)} ${cy - r * 0.2} L ${cx(2) + r * 0.7} ${cy - r * 0.1}`} stroke={warnColor} strokeWidth={2} fill="none" />
      <SvgText x={cx(2) - 18} y={h * 0.95} fontSize={10} fill={warnColor} fontWeight="600">strong</SvgText>

      {/* Knuckle indicators (small dots) showing where you'd see knuckles per grip */}
      <Line x1={cx(0) - 2} y1={cy - 2} x2={cx(0) + 4} y2={cy - 2} stroke={warnColor} strokeWidth={1.5} />
      <Line x1={cx(1) - 4} y1={cy - 2} x2={cx(1) + 4} y2={cy - 2} stroke={okColor} strokeWidth={1.5} />
      <Line x1={cx(2) - 4} y1={cy - 2} x2={cx(2) + 2} y2={cy - 2} stroke={warnColor} strokeWidth={1.5} />
    </Svg>
  );
}
