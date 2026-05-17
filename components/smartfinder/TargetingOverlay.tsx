import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  PanResponder,
} from 'react-native';

/**
 * SmartFinder TARGET-mode draggable target overlay. Ported from V3
 * (components/smartfinder/TargetingOverlay.tsx). The user drags the
 * yellow corner-bracket reticle across the screen; yardage updates as
 * they drag using a linear pixel→yard scale derived from the front /
 * middle / back of green distances.
 *
 * The user does NOT need full coords for both green ends — when only
 * the middle is known we fall back to a sensible default yards-per-px,
 * which is the right tradeoff for getting an actionable layup number
 * with imperfect data vs. refusing to render anything.
 */

interface Props {
  gpsDistances: { front: number | null; middle: number | null; back: number | null } | null;
  baseYardage: number | null;
  onTargetDistance?: (yards: number | null) => void;
}

export default function TargetingOverlay({
  gpsDistances,
  baseYardage,
  onTargetDistance,
}: Props) {
  const { width, height } = useWindowDimensions();

  const [targetX, setTargetX] = useState(width / 2);
  const [targetY, setTargetY] = useState(height / 2);
  const [targetYards, setTargetYards] = useState<number | null>(null);

  const calcYards = useCallback(
    (_screenX: number, screenY: number): number | null => {
      const midDist = gpsDistances?.middle ?? baseYardage;
      if (midDist == null) return null;
      const cy = height / 2;
      const dy = screenY - cy;
      let yardsPerPx = 0.6;
      if (gpsDistances?.front != null && gpsDistances?.back != null) {
        const frontBackYards = Math.abs(gpsDistances.back - gpsDistances.front);
        yardsPerPx = frontBackYards / Math.max(1, height * 0.45);
      }
      const adjusted = Math.round(midDist - dy * yardsPerPx);
      return Math.max(1, adjusted);
    },
    [gpsDistances, baseYardage, height],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt) => {
        setTargetX(evt.nativeEvent.pageX);
        setTargetY(evt.nativeEvent.pageY);
      },
      onPanResponderRelease: (evt) => {
        setTargetX(evt.nativeEvent.pageX);
        setTargetY(evt.nativeEvent.pageY);
      },
    }),
  ).current;

  const computedYards = calcYards(targetX, targetY);
  useEffect(() => {
    if (computedYards !== targetYards) {
      setTargetYards(computedYards);
      onTargetDistance?.(computedYards);
    }
  }, [computedYards, targetYards, onTargetDistance]);

  const isCenter = Math.abs(targetX - width / 2) < 12 && Math.abs(targetY - height / 2) < 12;

  return (
    <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} pointerEvents="box-only">
      <View
        pointerEvents="none"
        style={[
          styles.crosshairWrap,
          { left: targetX - CROSS_SIZE / 2, top: targetY - CROSS_SIZE / 2 },
        ]}
      >
        <View style={styles.crossH} />
        <View style={styles.crossV} />
        <View style={styles.dot} />
        <CornerBracket pos="tl" />
        <CornerBracket pos="tr" />
        <CornerBracket pos="bl" />
        <CornerBracket pos="br" />
      </View>
      {targetYards != null && (
        <View
          pointerEvents="none"
          style={[
            styles.yardBubble,
            { left: targetX - 56, top: targetY - CROSS_SIZE / 2 - 44 },
          ]}
        >
          <Text style={styles.yardBubbleText}>
            {isCenter ? '↕ drag' : `${targetYards} yds`}
          </Text>
        </View>
      )}
    </View>
  );
}

const BW = 2.5;
const BLEN = 14;
const BCOL = '#FFE600';
const BGLOW = { shadowColor: '#FFE600', shadowOpacity: 0.9, shadowRadius: 6, elevation: 3 } as const;
const CROSS_SIZE = 80;

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const isTop = pos === 'tl' || pos === 'tr';
  const isLeft = pos === 'tl' || pos === 'bl';
  return (
    <View
      style={{
        position: 'absolute',
        width: BLEN,
        height: BLEN,
        top: isTop ? 0 : undefined,
        bottom: !isTop ? 0 : undefined,
        left: isLeft ? 0 : undefined,
        right: !isLeft ? 0 : undefined,
        borderTopWidth: isTop ? BW : 0,
        borderBottomWidth: !isTop ? BW : 0,
        borderLeftWidth: isLeft ? BW : 0,
        borderRightWidth: !isLeft ? BW : 0,
        borderColor: BCOL,
        ...BGLOW,
      }}
    />
  );
}

const styles = StyleSheet.create({
  crosshairWrap: {
    position: 'absolute',
    width: CROSS_SIZE,
    height: CROSS_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  crossH: {
    position: 'absolute',
    width: CROSS_SIZE,
    height: 1.5,
    backgroundColor: 'rgba(255,230,0,0.55)',
  },
  crossV: {
    position: 'absolute',
    width: 1.5,
    height: CROSS_SIZE,
    backgroundColor: 'rgba(255,230,0,0.55)',
  },
  dot: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFE600',
    shadowColor: '#FFE600',
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 4,
  },
  yardBubble: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#FFE600',
    minWidth: 112,
    alignItems: 'center',
  },
  yardBubbleText: {
    color: '#FFE600',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
