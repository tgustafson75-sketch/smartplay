/**
 * features/playView/components/ShotArc.tsx
 *
 * Draws a straight line from the player's pixel position to the target pixel.
 * Uses center-based positioning + rotation to stay coordinate-accurate inside
 * the PlayViewMap container.
 *
 * Color is derived from risk level:
 *   risk < 30  → green (#4ADE80)
 *   risk < 60  → yellow (#FACC15)
 *   risk ≥ 60  → red (#F87171)
 */

import React from 'react';
import { View } from 'react-native';

interface Coord { x: number; y: number }

interface Props {
  start:    Coord;
  end:      Coord;
  risk?:    number;
}

function riskColor(risk: number): string {
  if (risk < 30) return '#4ADE80';
  if (risk < 60) return '#FACC15';
  return '#F87171';
}

export const ShotArc = ({ start, end, risk = 0 }: Props) => {
  const dx     = end.x - start.x;
  const dy     = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle  = (Math.atan2(dy, dx) * 180) / Math.PI;

  if (length < 1) return null;

  // Center the bar between start and end, then rotate
  const cx = (start.x + end.x) / 2;
  const cy = (start.y + end.y) / 2;

  return (
    <View
      pointerEvents="none"
      style={{
        position:        'absolute',
        left:            cx - length / 2,
        top:             cy - 2,
        width:           length,
        height:          3,
        backgroundColor: riskColor(risk),
        borderRadius:    2,
        opacity:         0.85,
        transform:       [{ rotate: `${angle}deg` }],
      }}
    />
  );
};
