/**
 * CageTargetUI — visual tap-to-label target for cage acoustic calibration.
 *
 * Renders a 10×10 cage back wall (green netting) with a 3×3 canvas square
 * centered on it (white, taut). A classic bullseye sits inside the canvas.
 * User taps where the ball hit; component computes (hitX, hitY) relative to
 * canvas center (−1..+1) and classifies as canvas_center / canvas_edge / net.
 *
 * The cage/canvas ratio is configurable (defaults to Tim's 10×10 / 3×3 setup)
 * so this works for different cage sizes in the future.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import type { TargetHitType } from '../../store/acousticCalibrationStore';

export interface HitPosition {
  hitType: TargetHitType;
  /** −1 = left edge, 0 = center, +1 = right edge. Null for net hits. */
  hitX: number | null;
  /** −1 = bottom edge, 0 = center, +1 = top edge. Null for net hits. */
  hitY: number | null;
}

interface Props {
  onHit: (pos: HitPosition) => void;
  disabled?: boolean;
  /** px width and height of the component. Defaults to 280. */
  size?: number;
  /** Cage side in feet. Default 10. */
  cageFt?: number;
  /** Canvas side in feet. Default 3. */
  canvasFt?: number;
}

const CANVAS_ZONE_THRESHOLD = 0.35; // within this radius of center = canvas_center

export function CageTargetUI({
  onHit,
  disabled = false,
  size = 280,
  cageFt = 10,
  canvasFt = 3,
}: Props) {
  const [pendingDot, setPendingDot] = useState<{ px: number; py: number; type: TargetHitType } | null>(null);

  const canvasRatio = canvasFt / cageFt;
  const canvasPx = size * canvasRatio;
  const canvasOffset = (size - canvasPx) / 2;

  // Bullseye ring radii (proportional to canvas)
  const outerR = canvasPx / 2;
  const midR = outerR * 0.58;
  const innerR = outerR * 0.30;
  const centerR = outerR * 0.11;

  const handlePress = useCallback((e: GestureResponderEvent) => {
    if (disabled) return;
    const tapX = e.nativeEvent.locationX;
    const tapY = e.nativeEvent.locationY;

    // Relative to canvas origin
    const rxRaw = (tapX - canvasOffset) / canvasPx;
    const ryRaw = (tapY - canvasOffset) / canvasPx;

    if (rxRaw < 0 || rxRaw > 1 || ryRaw < 0 || ryRaw > 1) {
      setPendingDot({ px: tapX, py: tapY, type: 'net' });
      onHit({ hitType: 'net', hitX: null, hitY: null });
      return;
    }

    // Canvas-centered coords: −1..+1, Y inverted so up = positive
    const hitX = (rxRaw - 0.5) * 2;
    const hitY = -((ryRaw - 0.5) * 2);
    const dist = Math.sqrt(hitX * hitX + hitY * hitY);
    const hitType: TargetHitType = dist <= CANVAS_ZONE_THRESHOLD ? 'canvas_center' : 'canvas_edge';

    setPendingDot({ px: tapX, py: tapY, type: hitType });
    onHit({ hitType, hitX, hitY });
  }, [disabled, canvasOffset, canvasPx, onHit]);

  const dotColor = pendingDot?.type === 'canvas_center'
    ? '#00C896'
    : pendingDot?.type === 'canvas_edge'
      ? '#f59e0b'
      : '#ef4444';

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={[s.wrap, { width: size, height: size }, disabled && s.wrapDisabled]}
      accessibilityLabel="Tap where the ball hit"
      accessibilityRole="button"
    >
      {/* Green netting background */}
      <View style={[StyleSheet.absoluteFill, s.netting]} />

      {/* Netting label hints */}
      <Text style={[s.netLabel, { top: 10, left: 10 }]}>NET</Text>
      <Text style={[s.netLabel, { top: 10, right: 10 }]}>NET</Text>
      <Text style={[s.netLabel, { bottom: 10, left: 10 }]}>NET</Text>
      <Text style={[s.netLabel, { bottom: 10, right: 10 }]}>NET</Text>

      {/* White canvas square */}
      <View style={[s.canvas, { left: canvasOffset, top: canvasOffset, width: canvasPx, height: canvasPx }]}>
        {/* Bullseye — dark outer ring */}
        <View style={[s.ring, { width: outerR * 2, height: outerR * 2, borderRadius: outerR, backgroundColor: '#222' }]}>
          {/* Mid ring — white */}
          <View style={[s.ring, { width: midR * 2, height: midR * 2, borderRadius: midR, backgroundColor: '#fff' }]}>
            {/* Inner ring — black */}
            <View style={[s.ring, { width: innerR * 2, height: innerR * 2, borderRadius: innerR, backgroundColor: '#111' }]}>
              {/* Center dot — red */}
              <View style={[s.ring, { width: centerR * 2, height: centerR * 2, borderRadius: centerR, backgroundColor: '#e63946' }]} />
            </View>
          </View>
        </View>

        {/* Canvas label */}
        <Text style={s.canvasLabel}>CANVAS</Text>
      </View>

      {/* Hit dot — appears after tap */}
      {pendingDot && (
        <View
          pointerEvents="none"
          style={[
            s.hitDot,
            {
              left: pendingDot.px - 8,
              top: pendingDot.py - 8,
              backgroundColor: dotColor,
            },
          ]}
        />
      )}

      {/* Disabled overlay */}
      {disabled && (
        <View style={[StyleSheet.absoluteFill, s.disabledOverlay]}>
          <Text style={s.disabledText}>HIT A SHOT FIRST</Text>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
  },
  wrapDisabled: {
    opacity: 0.55,
  },
  netting: {
    backgroundColor: '#1a4a1a',
    // Crosshatch pattern via overlapping semi-transparent lines
  },
  netLabel: {
    position: 'absolute',
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.22)',
    letterSpacing: 1,
  },
  canvas: {
    position: 'absolute',
    backgroundColor: '#f5f0e8',
    borderWidth: 3,
    borderColor: '#d4c9a8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasLabel: {
    position: 'absolute',
    bottom: 3,
    fontSize: 7,
    fontWeight: '800',
    color: 'rgba(0,0,0,0.25)',
    letterSpacing: 1,
  },
  hitDot: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: '#fff',
  },
  disabledOverlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledText: {
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.5,
  },
});
