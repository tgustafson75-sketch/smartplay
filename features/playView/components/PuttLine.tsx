/**
 * features/playView/components/PuttLine.tsx
 *
 * Draws a curved break line from ball → hole on the map overlay.
 * Approximates a quadratic Bézier with two straight segments:
 *   start → control  and  control → end
 * This avoids an SVG dependency and stays consistent with ShotArc.
 */

import React from 'react';
import { View } from 'react-native';
import { calculateBreak, SlopeDirection } from '../engine/GreenRead';

interface Coord { x: number; y: number }

interface Props {
  start: Coord;
  end:   Coord;
  slope: SlopeDirection;
}

function segment(a: Coord, b: Coord, color: string, opacity: number) {
  const dx     = b.x - a.x;
  const dy     = b.y - a.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle  = (Math.atan2(dy, dx) * 180) / Math.PI;
  const cx     = (a.x + b.x) / 2;
  const cy     = (a.y + b.y) / 2;

  if (length < 2) return null;

  return (
    <View
      key={`${a.x}-${a.y}-${b.x}-${b.y}`}
      pointerEvents="none"
      style={{
        position:        'absolute',
        left:            cx - length / 2,
        top:             cy - 1.5,
        width:           length,
        height:          3,
        backgroundColor: color,
        opacity,
        borderRadius:    2,
        transform:       [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

export const PuttLine = ({ start, end, slope }: Props) => {
  const { control } = calculateBreak({ start, end, slope });

  // Aim-point marker (small circle offset from hole)
  const { aimOffset } = calculateBreak({ start, end, slope });
  const aimX = end.x + aimOffset.x;
  const aimY = end.y + aimOffset.y;

  const seg1 = segment(start,   control, '#a78bfa', 0.9);
  const seg2 = segment(control, end,     '#a78bfa', 0.7);

  return (
    <>
      {/* Dashed approximation: 2-segment curve */}
      {seg1}
      {seg2}

      {/* Ball marker */}
      <View
        pointerEvents="none"
        style={{
          position:        'absolute',
          left:            start.x - 7,
          top:             start.y - 7,
          width:           14,
          height:          14,
          borderRadius:    7,
          borderWidth:     2.5,
          borderColor:     '#a78bfa',
          backgroundColor: 'rgba(167,139,250,0.25)',
        }}
      />

      {/* Hole marker */}
      <View
        pointerEvents="none"
        style={{
          position:        'absolute',
          left:            end.x - 6,
          top:             end.y - 6,
          width:           12,
          height:          12,
          borderRadius:    6,
          backgroundColor: '#f59e0b',
          opacity:         0.9,
        }}
      />

      {/* Aim-point indicator — where to aim so the break curves to hole */}
      {(aimOffset.x !== 0 || aimOffset.y !== 0) && (
        <View
          pointerEvents="none"
          style={{
            position:        'absolute',
            left:            aimX - 4,
            top:             aimY - 4,
            width:           8,
            height:          8,
            borderRadius:    4,
            borderWidth:     1.5,
            borderColor:     '#f59e0b',
            backgroundColor: 'transparent',
          }}
        />
      )}
    </>
  );
};
