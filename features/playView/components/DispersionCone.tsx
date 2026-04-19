/**
 * features/playView/components/DispersionCone.tsx
 *
 * Draws two faint miss-lines ±CONE_ANGLE degrees off the main shot arc,
 * representing the player's dispersion window.
 *
 * Uses the same center-based rotation technique as ShotArc.
 */

import React from 'react';
import { View } from 'react-native';

interface Coord { x: number; y: number }

interface Props {
  start: Coord;
  end:   Coord;
}

const CONE_ANGLE = 10; // degrees either side

function ConeArm({ start, end, angleDelta }: { start: Coord; end: Coord; angleDelta: number }) {
  const dx       = end.x - start.x;
  const dy       = end.y - start.y;
  const length   = Math.sqrt(dx * dx + dy * dy);
  const baseAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const angle    = baseAngle + angleDelta;

  if (length < 1) return null;

  const cx = (start.x + end.x) / 2;
  const cy = (start.y + end.y) / 2;

  return (
    <View
      pointerEvents="none"
      style={{
        position:        'absolute',
        left:            cx - length / 2,
        top:             cy - 1,
        width:           length,
        height:          1,
        backgroundColor: '#F87171',
        opacity:         0.5,
        transform:       [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

export const DispersionCone = ({ start, end }: Props) => (
  <>
    <ConeArm start={start} end={end} angleDelta={-CONE_ANGLE} />
    <ConeArm start={start} end={end} angleDelta={+CONE_ANGLE} />
  </>
);
