/**
 * components/CaddieLine.tsx
 *
 * Animated SVG shot trajectory line from player position to target.
 * Renders as an overlay on top of CourseMap.
 */

import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Line, Circle, Defs, Marker, Path } from 'react-native-svg';

export interface Point {
  x: number;
  y: number;
}

interface CaddieLineProps {
  /** Player position in SVG canvas coordinates */
  from: Point;
  /** Target position in SVG canvas coordinates */
  to: Point;
  /** Canvas width */
  width: number;
  /** Canvas height */
  height: number;
  /** Line color. Default: '#A7F3D0' */
  color?: string;
  /** Miss-pattern side for secondary aim line */
  missPattern?: 'left' | 'right' | 'neutral';
}

export default function CaddieLine({
  from,
  to,
  width,
  height,
  color = '#A7F3D0',
  missPattern = 'neutral',
}: CaddieLineProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [from.x, from.y, to.x, to.y]);

  // Compute a secondary miss-avoidance line offset slightly left/right
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  const offset = missPattern === 'neutral' ? 0 : missPattern === 'right' ? -12 : 12;

  const aimX = to.x + perpX * offset;
  const aimY = to.y + perpY * offset;

  return (
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, opacity }}>
      <Svg width={width} height={height}>
        {/* Primary shot line */}
        <Line
          x1={from.x}
          y1={from.y}
          x2={aimX}
          y2={aimY}
          stroke={color}
          strokeWidth={2.5}
          strokeDasharray="8,5"
          strokeLinecap="round"
        />

        {/* Target dot */}
        <Circle cx={aimX} cy={aimY} r={6} fill={color} opacity={0.9} />

        {/* Player dot */}
        <Circle cx={from.x} cy={from.y} r={5} fill="#3b82f6" opacity={0.9} />

        {/* Miss-side secondary line (shown when bias detected) */}
        {missPattern !== 'neutral' && (
          <Line
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="#f59e0b"
            strokeWidth={1.2}
            strokeDasharray="4,8"
            strokeLinecap="round"
            opacity={0.5}
          />
        )}
      </Svg>
    </Animated.View>
  );
}
