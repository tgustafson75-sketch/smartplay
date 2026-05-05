/**
 * Phase 111 — Weight Transfer illustration.
 *
 * Two foot-pressure indicators showing trail-foot vs lead-foot pressure
 * distribution at impact. Compares "hanging back" (bad — too much trail
 * foot) vs "balanced shift" (good — pressure on lead foot at impact).
 *
 * Geometric / instructional. No body silhouettes.
 */

import React from 'react';
import Svg, { Rect, Text as SvgText, Line, Circle } from 'react-native-svg';

interface Props {
  size?: number;
  okColor?: string;
  warnColor?: string;
}

export default function WeightTransferIllustration({
  size = 220,
  okColor = '#00C896',
  warnColor = '#ef4444',
}: Props) {
  const w = size;
  const h = size * 0.85;

  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {/* Hanging back (left half) */}
      <SvgText x={w * 0.05} y={h * 0.10} fontSize={10} fill={warnColor} fontWeight="700">
        Hanging back
      </SvgText>
      {/* Trail foot (full bar) */}
      <Rect x={w * 0.10} y={h * 0.30} width={w * 0.12} height={h * 0.55} rx={4} fill={warnColor} opacity={0.85} />
      <SvgText x={w * 0.10} y={h * 0.95} fontSize={9} fill="#9ca3af">trail</SvgText>
      {/* Lead foot (empty bar) */}
      <Rect x={w * 0.28} y={h * 0.70} width={w * 0.12} height={h * 0.15} rx={4} fill={warnColor} opacity={0.25} />
      <SvgText x={w * 0.28} y={h * 0.95} fontSize={9} fill="#9ca3af">lead</SvgText>

      {/* Divider */}
      <Line x1={w * 0.5} y1={h * 0.20} x2={w * 0.5} y2={h * 0.90} stroke="#6b7280" strokeWidth={1} strokeDasharray="3,3" />

      {/* Balanced (right half) */}
      <SvgText x={w * 0.55} y={h * 0.10} fontSize={10} fill={okColor} fontWeight="700">
        Balanced shift
      </SvgText>
      {/* Trail foot (small bar) */}
      <Rect x={w * 0.60} y={h * 0.65} width={w * 0.12} height={h * 0.20} rx={4} fill={okColor} opacity={0.4} />
      <SvgText x={w * 0.60} y={h * 0.95} fontSize={9} fill="#9ca3af">trail</SvgText>
      {/* Lead foot (full bar) */}
      <Rect x={w * 0.78} y={h * 0.30} width={w * 0.12} height={h * 0.55} rx={4} fill={okColor} />
      <SvgText x={w * 0.78} y={h * 0.95} fontSize={9} fill="#9ca3af">lead</SvgText>

      {/* Pressure dot indicators above bars */}
      <Circle cx={w * 0.16} cy={h * 0.25} r={3} fill={warnColor} />
      <Circle cx={w * 0.84} cy={h * 0.25} r={3} fill={okColor} />
    </Svg>
  );
}
