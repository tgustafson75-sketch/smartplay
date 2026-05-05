/**
 * Phase 111 — Tempo illustration.
 *
 * Two horizontal "metronome" bars showing the 3:1 backswing-to-downswing
 * ratio (good) vs a 1:1 rushed transition (bad).
 */

import React from 'react';
import Svg, { Rect, Text as SvgText, Line } from 'react-native-svg';

interface Props {
  size?: number;
  okColor?: string;
  warnColor?: string;
}

export default function TempoIllustration({
  size = 220,
  okColor = '#00C896',
  warnColor = '#ef4444',
}: Props) {
  const w = size;
  const h = size * 0.55;
  const trackY1 = h * 0.30;
  const trackY2 = h * 0.65;
  const trackH = h * 0.12;

  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {/* Smooth tempo (3:1) */}
      <SvgText x={w * 0.04} y={h * 0.18} fontSize={10} fill={okColor} fontWeight="700">
        3 : 1 — smooth
      </SvgText>
      {/* Backswing (long) */}
      <Rect x={w * 0.05} y={trackY1} width={w * 0.60} height={trackH} rx={6} fill={okColor} opacity={0.85} />
      <SvgText x={w * 0.05} y={trackY1 - 4} fontSize={8} fill="#9ca3af">back</SvgText>
      {/* Downswing (short) */}
      <Rect x={w * 0.66} y={trackY1} width={w * 0.20} height={trackH} rx={6} fill={okColor} />
      <SvgText x={w * 0.66} y={trackY1 - 4} fontSize={8} fill="#9ca3af">down</SvgText>

      {/* Rushed tempo (1:1) */}
      <SvgText x={w * 0.04} y={trackY2 - 4} fontSize={10} fill={warnColor} fontWeight="700">
        1 : 1 — rushed
      </SvgText>
      <Rect x={w * 0.05} y={trackY2 + h * 0.03} width={w * 0.40} height={trackH} rx={6} fill={warnColor} opacity={0.85} />
      <Rect x={w * 0.46} y={trackY2 + h * 0.03} width={w * 0.40} height={trackH} rx={6} fill={warnColor} />

      {/* Tick marks under smooth bar (3 evenly spaced ticks for back, 1 for down) */}
      <Line x1={w * 0.05} y1={trackY1 + trackH + 4} x2={w * 0.05} y2={trackY1 + trackH + 9} stroke="#6b7280" strokeWidth={1} />
      <Line x1={w * 0.25} y1={trackY1 + trackH + 4} x2={w * 0.25} y2={trackY1 + trackH + 9} stroke="#6b7280" strokeWidth={1} />
      <Line x1={w * 0.45} y1={trackY1 + trackH + 4} x2={w * 0.45} y2={trackY1 + trackH + 9} stroke="#6b7280" strokeWidth={1} />
      <Line x1={w * 0.65} y1={trackY1 + trackH + 4} x2={w * 0.65} y2={trackY1 + trackH + 9} stroke="#6b7280" strokeWidth={1} />
      <Line x1={w * 0.86} y1={trackY1 + trackH + 4} x2={w * 0.86} y2={trackY1 + trackH + 9} stroke="#6b7280" strokeWidth={1} />
    </Svg>
  );
}
