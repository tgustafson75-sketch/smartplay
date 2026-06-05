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
 * yellow corner-bracket reticle across the screen; parent computes
 * geodesic yardage from current GPS + projected target GPS and passes
 * that yardage back for display.
 *
 * The user does NOT need full coords for both green ends — when only
 * the middle is known we fall back to a sensible default yards-per-px,
 * which is the right tradeoff for getting an actionable layup number
 * with imperfect data vs. refusing to render anything.
 */

interface Props {
  targetYards: number | null;
  onTargetPointNormalized?: (point: { xNorm: number; yNorm: number }) => void;
  // 2026-05-27 — Fix EQ: target lock. When true, the overlay stops
  // capturing touches so the user can take a screenshot OR interact
  // with controls underneath without the reticle chasing every tap.
  // Tim's pain: every tap on the camera moved the target, making
  // screenshots impossible. Lock = "Top Gun" reticle hold.
  locked?: boolean;
}

export default function TargetingOverlay({
  targetYards,
  onTargetPointNormalized,
  locked = false,
}: Props) {
  const { width, height } = useWindowDimensions();

  const [targetX, setTargetX] = useState(width / 2);
  const [targetY, setTargetY] = useState(height / 2);
  const reportPoint = useCallback((x: number, y: number) => {
    const xNorm = Math.max(0, Math.min(1, x / Math.max(1, width)));
    const yNorm = Math.max(0, Math.min(1, y / Math.max(1, height)));
    onTargetPointNormalized?.({ xNorm, yNorm });
  }, [height, onTargetPointNormalized, width]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const y = evt.nativeEvent.locationY;
        setTargetX(x);
        setTargetY(y);
        reportPoint(x, y);
      },
      onPanResponderRelease: (evt) => {
        const x = evt.nativeEvent.locationX;
        const y = evt.nativeEvent.locationY;
        setTargetX(x);
        setTargetY(y);
        reportPoint(x, y);
      },
    }),
  ).current;

  useEffect(() => {
    reportPoint(targetX, targetY);
  }, [reportPoint, targetX, targetY]);

  const isCenter = Math.abs(targetX - width / 2) < 12 && Math.abs(targetY - height / 2) < 12;

  return (
    <View
      style={StyleSheet.absoluteFill}
      {...(locked ? {} : panResponder.panHandlers)}
      // 2026-05-27 — Fix EQ: when locked, pointerEvents="none" so taps
      // pass through to whatever is underneath (e.g. the capture button
      // OR straight to the system screenshot gesture). When unlocked,
      // 'box-only' keeps the prior drag-anywhere-to-aim behavior.
      pointerEvents={locked ? 'none' : 'box-only'}
    >
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
