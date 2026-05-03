/**
 * Phase AM — Cage setup camera overlay.
 *
 * Multi-purpose visual scaffold that renders on top of the CameraView
 * during cage drill setup. Three layered elements:
 *
 *   1. Body alignment box — rectangular frame the user fits their swing
 *      inside (top above head, bottom below feet, sides shoulder + club
 *      length).
 *   2. Bullseye reticle — centered crosshair indicating optimal phone
 *      position (spine alignment + hip height).
 *   3. Strike zone — smaller rectangle near the bullseye marking ball
 *      address / impact zone. Phase K uses this region as the priority
 *      sample area; Phase X (future) uses it for strike validation.
 *
 * Color feedback driven by phase:
 *   SETUP / NOT_READY → amber ("frame your swing")
 *   CHECKING          → amber pulsing
 *   READY             → green
 *
 * Aspect-aware: scales correctly for Fold open (~8:9 wide) and standard
 * portrait phone (~9:19.5 tall). The body box is sized as a fraction of
 * viewport height so it always fits.
 *
 * No CV detection in this component. Visual scaffold only — alignment
 * verification still goes through the existing handleCheckPosition →
 * /api/cage/check-bullseye backend call.
 */

import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Rect, Line, Circle } from 'react-native-svg';

export type CageOverlayPhase = 'SETUP' | 'CHECKING' | 'READY' | 'NOT_READY';

interface Props {
  phase: CageOverlayPhase;
}

const COLOR_BY_PHASE: Record<CageOverlayPhase, { stroke: string; fill: string; label: string }> = {
  SETUP:     { stroke: '#F5A623', fill: 'rgba(245,166,35,0.06)', label: 'Frame your swing inside the box' },
  CHECKING:  { stroke: '#F5A623', fill: 'rgba(245,166,35,0.10)', label: 'Checking alignment…' },
  READY:     { stroke: '#00C896', fill: 'rgba(0,200,150,0.10)', label: 'Locked in — ready to swing' },
  NOT_READY: { stroke: '#ef4444', fill: 'rgba(239,68,68,0.10)', label: "Adjust your position" },
};

export default function CageOverlay({ phase }: Props) {
  const { width: W, height: H } = useWindowDimensions();
  const aspect = H / W;
  const isFoldOpen = aspect < 1.5;

  const palette = COLOR_BY_PHASE[phase];

  // Body alignment box — sized as a fraction of viewport so it always
  // fits regardless of aspect. On portrait, taller frame (golfer takes up
  // most vertical space). On Fold open / landscape, wider frame.
  const boxHeight = isFoldOpen ? H * 0.78 : H * 0.62;
  const boxWidth = isFoldOpen ? W * 0.45 : W * 0.62;
  const boxLeft = (W - boxWidth) / 2;
  const boxTop = (H - boxHeight) / 2;

  // Bullseye centered on box (corresponds to spine + hip-height).
  const cx = W / 2;
  const cy = H / 2;

  // Strike zone — small rectangle below center where ball address lives,
  // ~25% of body box size. Aligned to bottom-third (where the ball would
  // be at address position).
  const strikeW = boxWidth * 0.28;
  const strikeH = boxHeight * 0.18;
  const strikeLeft = cx - strikeW / 2;
  const strikeTop = boxTop + boxHeight * 0.62;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={W} height={H}>
        {/* Body alignment box */}
        <Rect
          x={boxLeft}
          y={boxTop}
          width={boxWidth}
          height={boxHeight}
          stroke={palette.stroke}
          strokeWidth={2.5}
          strokeDasharray={phase === 'CHECKING' ? '8,4' : 'none'}
          fill={palette.fill}
          rx={12}
        />
        {/* Corner brackets — make the box read more like a viewfinder than
            a filled rectangle. Small L-shapes at each corner. */}
        {[
          [boxLeft, boxTop, 1, 1],
          [boxLeft + boxWidth, boxTop, -1, 1],
          [boxLeft, boxTop + boxHeight, 1, -1],
          [boxLeft + boxWidth, boxTop + boxHeight, -1, -1],
        ].map(([x, y, dx, dy], i) => (
          <React.Fragment key={i}>
            <Line x1={x} y1={y} x2={x + 18 * dx} y2={y} stroke={palette.stroke} strokeWidth={4} strokeLinecap="round" />
            <Line x1={x} y1={y} x2={x} y2={y + 18 * dy} stroke={palette.stroke} strokeWidth={4} strokeLinecap="round" />
          </React.Fragment>
        ))}

        {/* Bullseye reticle — outer ring + inner dot + crosshair lines */}
        <Circle cx={cx} cy={cy} r={28} stroke={palette.stroke} strokeWidth={2} fill="none" opacity={0.6} />
        <Circle cx={cx} cy={cy} r={3} fill={palette.stroke} />
        <Line x1={cx - 14} y1={cy} x2={cx - 4} y2={cy} stroke={palette.stroke} strokeWidth={2} opacity={0.7} />
        <Line x1={cx + 4} y1={cy} x2={cx + 14} y2={cy} stroke={palette.stroke} strokeWidth={2} opacity={0.7} />
        <Line x1={cx} y1={cy - 14} x2={cx} y2={cy - 4} stroke={palette.stroke} strokeWidth={2} opacity={0.7} />
        <Line x1={cx} y1={cy + 4} x2={cx} y2={cy + 14} stroke={palette.stroke} strokeWidth={2} opacity={0.7} />

        {/* Strike zone — dashed sub-rect for ball-address area */}
        <Rect
          x={strikeLeft}
          y={strikeTop}
          width={strikeW}
          height={strikeH}
          stroke={palette.stroke}
          strokeWidth={1.5}
          strokeDasharray="4,3"
          fill="none"
          rx={4}
          opacity={0.55}
        />
      </Svg>

      {/* Guidance text under the box. Lives outside the SVG so it can
          use native text styling (letter-spacing, shadow). */}
      <View style={[styles.labelWrap, { top: boxTop + boxHeight + 12 }]}>
        <Text style={[styles.label, { color: palette.stroke }]}>{palette.label}</Text>
      </View>

      {/* Strike zone label — tiny tag above the dashed sub-rect */}
      <View style={[styles.zoneLabel, { top: strikeTop - 14, left: strikeLeft }]}>
        <Text style={[styles.zoneLabelText, { color: palette.stroke }]}>BALL</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelWrap: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  zoneLabel: {
    position: 'absolute',
  },
  zoneLabelText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
