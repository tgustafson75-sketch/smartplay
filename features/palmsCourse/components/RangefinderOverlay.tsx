/**
 * features/palmsCourse/components/RangefinderOverlay.tsx
 *
 * Transparent tap-to-range overlay that sits on top of PlayViewImage.
 *
 * Usage:
 *   <View style={{ position: 'relative' }}>
 *     <PlayViewImage holeNumber={hole} gpsLat={lat} gpsLng={lng} />
 *     <RangefinderOverlay
 *       holeNumber={hole}
 *       playerLat={lat}
 *       playerLng={lng}
 *       onDistance={(yards) => setTargetYards(yards)}
 *     />
 *   </View>
 *
 * – Tap to set a target point; the haversine distance to that point
 *   is computed and passed to onDistance.
 * – A crosshair and distance badge are drawn at the tapped location.
 * – Tap again to update the target; press × to clear.
 */

import React, { useRef, useCallback, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useRangefinder } from '../hooks/useRangefinder';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  holeNumber:  number;
  playerLat?:  number | null;
  playerLng?:  number | null;
  /** Called every time the distance to the tapped target changes. */
  onDistance?: (yards: number | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RangefinderOverlay({
  holeNumber,
  playerLat,
  playerLng,
  onDistance,
}: Props) {
  const layoutRef              = useRef<{ width: number; height: number }>({ width: 1, height: 1 });
  const [dotPos, setDotPos]    = useState<{ x: number; y: number } | null>(null);

  const { distanceToTarget, setTapPoint, clearTarget } = useRangefinder(
    holeNumber,
    playerLat,
    playerLng,
  );

  // Keep parent in sync whenever distance changes.
  React.useEffect(() => {
    onDistance?.(distanceToTarget);
  }, [distanceToTarget, onDistance]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    layoutRef.current = { width, height };
  }, []);

  const handlePress = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const { width, height }        = layoutRef.current;
    const nx = locationX / width;
    const ny = locationY / height;
    setTapPoint({ x: nx, y: ny });
    setDotPos({ x: locationX, y: locationY });
  }, [setTapPoint]);

  const handleClear = useCallback(() => {
    clearTarget();
    setDotPos(null);
    onDistance?.(null);
  }, [clearTarget, onDistance]);

  return (
    <Pressable
      onPress={handlePress}
      onLayout={handleLayout}
      style={StyleSheet.absoluteFill}
    >
      {dotPos && (
        <>
          {/* Crosshair */}
          <View pointerEvents="none" style={[s.crosshairH, { top: dotPos.y }]} />
          <View pointerEvents="none" style={[s.crosshairV, { left: dotPos.x }]} />

          {/* Target dot + distance badge */}
          <View
            pointerEvents="none"
            style={[s.targetDot, { left: dotPos.x - 8, top: dotPos.y - 8 }]}
          />

          {distanceToTarget !== null && (
            <View style={[s.badge, { left: dotPos.x + 14, top: dotPos.y - 14 }]}>
              <Text style={s.badgeText}>{Math.round(distanceToTarget)} yds</Text>
              <Pressable onPress={handleClear} style={s.clearBtn} hitSlop={8}>
                <Text style={s.clearText}>×</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  crosshairH: {
    position:        'absolute',
    left:            0,
    right:           0,
    height:          1,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  crosshairV: {
    position:        'absolute',
    top:             0,
    bottom:          0,
    width:           1,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  targetDot: {
    position:        'absolute',
    width:           16,
    height:          16,
    borderRadius:    8,
    backgroundColor: '#EF4444',
    borderWidth:     2,
    borderColor:     '#fff',
  },
  badge: {
    position:        'absolute',
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius:    8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap:             6,
  },
  badgeText: {
    color:      '#fff',
    fontSize:   14,
    fontWeight: '700',
  },
  clearBtn: {
    padding: 2,
  },
  clearText: {
    color:    '#aaa',
    fontSize: 16,
    lineHeight: 16,
  },
});
