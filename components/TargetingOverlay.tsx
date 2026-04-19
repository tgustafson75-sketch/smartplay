/**
 * TargetingOverlay
 * ─────────────────────────────────────────────────────────────────────────────
 * A transparent overlay placed over any view to let the user drag a crosshair
 * target to any point on screen.  Computes the real-world yardage from the
 * player's GPS position to the dragged target using a linear pixel→yard scale
 * derived from the known front/middle/back green coordinates.
 *
 * Usage
 * ─────
 * <TargetingOverlay
 *   userCoords={{ lat, lng }}          // null when GPS unavailable
 *   greenCoords={{ front, middle, back }}
 *   onTargetDistance={(yards) => ...}  // called whenever target moves
 * />
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, useWindowDimensions, PanResponder, Animated as RNAnimated,
} from 'react-native';

// ── Types ────────────────────────────────────────────────────────────────────
interface LatLng { lat: number; lng: number }

interface GreenCoords {
  front:  LatLng | null;
  middle: LatLng | null;
  back:   LatLng | null;
}

interface Props {
  userCoords:       LatLng | null;
  greenCoords:      GreenCoords;
  /** Raw GPS distances F/M/B to the green (yards) — used for scale calibration */
  gpsDistances:     { front: number | null; middle: number | null; back: number | null } | null;
  baseYardage:      number | null;  // fallback when no GPS
  onTargetDistance: (yards: number | null) => void;
}

// ── Haversine ────────────────────────────────────────────────────────────────
function haversineYards(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.09361);
}

export default function TargetingOverlay({
  userCoords,
  greenCoords,
  gpsDistances,
  baseYardage,
  onTargetDistance,
}: Props) {
  const { width, height } = useWindowDimensions();

  // Default crosshair to screen centre
  const [targetX, setTargetX] = useState(width / 2);
  const [targetY, setTargetY] = useState(height / 2);
  const [targetYards, setTargetYards] = useState<number | null>(null);

  const dragOffset = useRef({ dx: 0, dy: 0 });

  // ── Distance calculation ─────────────────────────────────────────────────
  const calcYards = useCallback(
    (screenX: number, screenY: number): number | null => {
      // If we have real GPS + green coords → use pixel-scale relative to centre
      const midDist = gpsDistances?.middle ?? baseYardage;
      if (midDist == null) return null;

      // Screen centre (where the middle crosshair lives by default) → midDist yards
      const cx = width  / 2;
      const cy = height / 2;

      // Pixel delta from centre
      const dx = screenX - cx;
      const dy = screenY - cy;  // dy > 0 = closer (lower screen = closer to player)

      // Calibrate scale: use F/M/B pixel spread if coords available, else fallback
      let yardsPerPx = 0.6; // ~1 yard per ~1.67 px at typical course scale
      if (gpsDistances?.front && gpsDistances?.back) {
        // Front is further back on screen (top), back is even further
        // Use the front-back yardage spread over ~25% screen height as scale
        const frontBackYards = Math.abs((gpsDistances.back ?? midDist + 7) - (gpsDistances.front ?? midDist - 7));
        yardsPerPx = frontBackYards / (height * 0.45);
      }

      // dy negative = moving up screen = further away
      const adjusted = Math.round(midDist - dy * yardsPerPx);
      return Math.max(1, adjusted);
    },
    [gpsDistances, baseYardage, width, height]
  );

  // ── PanResponder ─────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        dragOffset.current = { dx: pageX, dy: pageY };
      },
      onPanResponderMove: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        setTargetX(pageX);
        setTargetY(pageY);
        // Update yards inline without full closure re-capture
      },
      onPanResponderRelease: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        setTargetX(pageX);
        setTargetY(pageY);
      },
    })
  ).current;

  // ── Recompute yardage whenever target moves ───────────────────────────────
  // Computed as render-time side effect (safe — no infinite loop risk)
  const computedYards = calcYards(targetX, targetY);
  if (computedYards !== targetYards) {
    setTargetYards(computedYards);
    onTargetDistance(computedYards);
  }

  const displayY = targetYards;
  const isCenter = Math.abs(targetX - width / 2) < 12 && Math.abs(targetY - height / 2) < 12;

  return (
    <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} pointerEvents="box-only">
      {/* Crosshair */}
      <View
        pointerEvents="none"
        style={[
          styles.crosshairWrap,
          { left: targetX - CROSS_SIZE / 2, top: targetY - CROSS_SIZE / 2 },
        ]}
      >
        {/* Horizontal line */}
        <View style={styles.crossH} />
        {/* Vertical line */}
        <View style={styles.crossV} />
        {/* Centre dot */}
        <View style={styles.dot} />
        {/* Corner brackets */}
        <CornerBracket pos="tl" />
        <CornerBracket pos="tr" />
        <CornerBracket pos="bl" />
        <CornerBracket pos="br" />
      </View>

      {/* Yardage bubble above crosshair */}
      {displayY != null && (
        <View
          pointerEvents="none"
          style={[
            styles.yardBubble,
            { left: targetX - 48, top: targetY - CROSS_SIZE / 2 - 42 },
          ]}
        >
          <Text style={styles.yardBubbleText}>
            {isCenter ? '↕ drag' : `${displayY} yds`}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Corner bracket sub-component ─────────────────────────────────────────────
const BW = 2.5;
const BLEN = 14;
const BCOL = '#FFE600';
const BGLOW = { shadowColor: '#FFE600', shadowOpacity: 0.9, shadowRadius: 6, elevation: 3 };
const CROSS_SIZE = 80;

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const off = 0;
  const isTop    = pos === 'tl' || pos === 'tr';
  const isLeft   = pos === 'tl' || pos === 'bl';

  return (
    <View
      style={{
        position: 'absolute',
        width: BLEN, height: BLEN,
        top:    isTop  ? off : undefined,
        bottom: !isTop ? off : undefined,
        left:   isLeft ? off : undefined,
        right:  !isLeft ? off : undefined,
        borderTopWidth:    isTop    ? BW : 0,
        borderBottomWidth: !isTop   ? BW : 0,
        borderLeftWidth:   isLeft   ? BW : 0,
        borderRightWidth:  !isLeft  ? BW : 0,
        borderColor: BCOL,
        ...BGLOW,
      }}
    />
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
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
    minWidth: 96,
    alignItems: 'center',
  },
  yardBubbleText: {
    color: '#FFE600',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
