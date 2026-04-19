/**
 * features/palmsCourse/components/PlayViewImage.tsx
 *
 * Renders the full play-view photograph for a Palms hole with an optional
 * GPS dot overlay showing the player's current position on the image.
 *
 * Props:
 *   holeNumber   — 1-based hole number
 *   gpsLat/Lng   — player GPS coordinates (null = no fix)
 *   onPress      — called when the user taps the image (passes normalised tap coords)
 *   style        — additional container styles
 */

import React, { useCallback } from 'react';
import {
  View, Image, Pressable, StyleSheet,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { getPalmsHoleImage } from '../data/palmsImages';
import { useHoleMapping }    from '../hooks/useHoleMapping';
import type { TapPoint }     from '../hooks/useRangefinder';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  holeNumber: number;
  gpsLat?:    number | null;
  gpsLng?:    number | null;
  /** Called with normalised {x,y} when the player taps the image. */
  onPress?:   (tap: TapPoint) => void;
  style?:     StyleProp<ViewStyle>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlayViewImage({
  holeNumber,
  gpsLat,
  gpsLng,
  onPress,
  style,
}: Props) {
  const image    = getPalmsHoleImage(holeNumber);
  const { position, inFrame } = useHoleMapping(holeNumber, gpsLat, gpsLng);

  const handlePress = useCallback((e: GestureResponderEvent) => {
    if (!onPress) return;
    const { locationX, locationY } = e.nativeEvent;
    // nativeEvent gives pixel coords; we need the layout size to normalise.
    // RangefinderOverlay handles the proper normalised tap — this is a
    // lightweight fallback for callers that don't use RangefinderOverlay.
    const target = e.currentTarget as unknown as { measure: (...a: unknown[]) => void };
    if (typeof target?.measure === 'function') {
      target.measure((_x: number, _y: number, w: number, h: number) => {
        onPress({ x: locationX / w, y: locationY / h });
      });
    }
  }, [onPress]);

  return (
    <Pressable onPress={handlePress} style={[s.container, style]}>
      <Image source={image} style={s.image} resizeMode="cover" />

      {/* GPS position dot */}
      {inFrame && position && (
        <View
          pointerEvents="none"
          style={[
            s.gpsDot,
            {
              // Position is normalised [0,1]; convert to percentage-based layout.
              left: `${position.x * 100}%` as unknown as number,
              top:  `${position.y * 100}%` as unknown as number,
            },
          ]}
        />
      )}
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const DOT_SIZE = 12;

const s = StyleSheet.create({
  container: {
    width:    '100%',
    aspectRatio: 0.55,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  image: {
    width:  '100%',
    height: '100%',
  },
  gpsDot: {
    position:     'absolute',
    width:        DOT_SIZE,
    height:       DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: '#00E0FF',
    borderWidth:  2,
    borderColor:  '#fff',
    marginLeft:   -(DOT_SIZE / 2),
    marginTop:    -(DOT_SIZE / 2),
  },
});
