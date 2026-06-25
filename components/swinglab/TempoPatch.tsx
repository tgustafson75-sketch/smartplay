/**
 * 2026-06-24 — Tempo Patch.
 *
 * The VISUAL half of Smart Tempo: a horizontal, graduated-color swing
 * timeline that makes the player's tempo offset obvious at a glance. Two
 * stacked rows:
 *
 *   YOUR TEMPO — three points (takeaway · top · impact) placed at the
 *                player's REAL measured positions: the backswing segment
 *                takes backswingMs of the total, the downswing takes
 *                downswingMs. So a rushed swing's "top" point sits to the
 *                RIGHT of ideal (short backswing share); a slow one's sits
 *                LEFT.
 *   IDEAL 3:1  — the same total length re-split on a 3:1 ratio (top at 75%),
 *                drawn directly beneath so the horizontal offset between the
 *                two "top" points is the visible error.
 *
 * Both rows share the SAME total width (both swings normalized to their own
 * 0→impact span), so the bars line up at the takeaway (left) and impact
 * (right) edges and only the middle TOP marker diverges — that divergence IS
 * the tempo story.
 *
 * Colors: an on-brand teal→lime gradient for the backswing load, shifting to
 * amber→accent through the (shorter) downswing — a "patch" reading left to
 * right. The ideal row is drawn dimmer so the player's row reads as the hero.
 *
 * HONESTY: every position comes from result.backswingMs / result.downswingMs
 * (the player's placed marks via computeTempo). The component renders nothing
 * fabricated; with no result it renders null. Low-confidence marks are the
 * caller's concern (it flags + offers Refine) — this only ever draws a real
 * measured read.
 *
 * Tech: react-native-svg (already a dep) with a LinearGradient fill. Static,
 * declarative, no canvas lifecycle — the cleanest path for a small timeline.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Circle, Line } from 'react-native-svg';
import type { TempoResult } from '../../services/smartTempo';
import { useTheme } from '../../contexts/ThemeContext';

interface TempoPatchProps {
  result: TempoResult;
}

// Lane geometry (in the SVG's own units; the <Svg> scales to the container).
const W = 320;        // logical width
const ROW_H = 26;     // bar height
const ROW_GAP = 30;   // vertical gap between the two rows + their labels
const PAD_X = 10;     // horizontal padding so end dots aren't clipped
const TRACK_W = W - PAD_X * 2;
const DOT_R = 6;

/** A single graduated bar with three points at the given fractional split.
 *  topFrac = backswing share of the total (0..1). */
function PatchRow({
  y, topFrac, gradId, dim, colors,
}: {
  y: number;
  topFrac: number;
  gradId: string;
  dim: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const topX = PAD_X + TRACK_W * Math.max(0, Math.min(1, topFrac));
  const startX = PAD_X;
  const endX = PAD_X + TRACK_W;
  const cy = y + ROW_H / 2;
  const dotStroke = dim ? colors.surface_elevated : colors.background;
  const dotFill = dim ? colors.text_muted : '#ffffff';
  return (
    <>
      {/* graduated patch bar */}
      <Rect
        x={startX}
        y={y}
        width={TRACK_W}
        height={ROW_H}
        rx={ROW_H / 2}
        fill={`url(#${gradId})`}
        opacity={dim ? 0.35 : 1}
      />
      {/* the TOP divider — the load→strike boundary, the point that moves */}
      <Line x1={topX} y1={y - 4} x2={topX} y2={y + ROW_H + 4} stroke={dotFill} strokeWidth={dim ? 1.5 : 2.5} opacity={dim ? 0.5 : 0.9} />
      {/* three points */}
      <Circle cx={startX} cy={cy} r={DOT_R} fill={dotFill} stroke={dotStroke} strokeWidth={2} />
      <Circle cx={topX} cy={cy} r={DOT_R} fill={dotFill} stroke={dotStroke} strokeWidth={2} />
      <Circle cx={endX} cy={cy} r={DOT_R} fill={dotFill} stroke={dotStroke} strokeWidth={2} />
    </>
  );
}

export default function TempoPatch({ result }: TempoPatchProps) {
  const { colors } = useTheme();
  if (!result) return null;

  const total = result.backswingMs + result.downswingMs;
  if (!(total > 0)) return null;

  // YOUR row: real measured split. IDEAL row: same total re-split 3:1 (top @75%).
  const actualTopFrac = result.backswingMs / total;
  const idealTopFrac = 0.75;

  const rowTopY = 0;
  const rowBottomY = ROW_H + ROW_GAP;
  const svgH = rowBottomY + ROW_H + 6;

  // brand gradient: teal load → lime apex → amber transition → accent strike
  const lime = colors.accent_lime;
  const teal = colors.accent;
  const amber = colors.accent_amber;

  return (
    <View style={styles.wrap}>
      {/* YOUR TEMPO label row */}
      <View style={styles.labelRow}>
        <Text style={[styles.rowLabel, { color: colors.text_primary }]}>YOUR TEMPO</Text>
        <Text style={[styles.rowRatio, { color: colors.accent_lime }]}>{result.ratioLabel}</Text>
      </View>

      <Svg width="100%" height={svgH} viewBox={`0 0 ${W} ${svgH}`} preserveAspectRatio="none">
        <Defs>
          {/* Your row — full-strength patch */}
          <LinearGradient id="tp_actual" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={teal} />
            <Stop offset={String(actualTopFrac * 0.9)} stopColor={lime} />
            <Stop offset={String(Math.min(1, actualTopFrac + 0.02))} stopColor={amber} />
            <Stop offset="1" stopColor={teal} />
          </LinearGradient>
          {/* Ideal row — same ramp (drawn dim via opacity) */}
          <LinearGradient id="tp_ideal" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={teal} />
            <Stop offset={String(idealTopFrac * 0.9)} stopColor={lime} />
            <Stop offset={String(idealTopFrac + 0.02)} stopColor={amber} />
            <Stop offset="1" stopColor={teal} />
          </LinearGradient>
        </Defs>

        <PatchRow y={rowTopY} topFrac={actualTopFrac} gradId="tp_actual" dim={false} colors={colors} />
        <PatchRow y={rowBottomY} topFrac={idealTopFrac} gradId="tp_ideal" dim colors={colors} />
      </Svg>

      {/* IDEAL label + point legend */}
      <View style={styles.labelRow}>
        <Text style={[styles.rowLabelDim, { color: colors.text_muted }]}>IDEAL 3:1</Text>
      </View>

      {/* segment ms readout — real measured values */}
      <View style={styles.segRow}>
        <View style={styles.seg}>
          <Text style={[styles.segLabel, { color: colors.text_muted }]}>BACKSWING</Text>
          <Text style={[styles.segVal, { color: colors.accent_lime }]}>{result.backswingMs} ms</Text>
        </View>
        <Text style={[styles.segDiv, { color: colors.text_muted }]}>·</Text>
        <View style={styles.seg}>
          <Text style={[styles.segLabel, { color: colors.text_muted }]}>DOWNSWING</Text>
          <Text style={[styles.segVal, { color: colors.accent_amber }]}>{result.downswingMs} ms</Text>
        </View>
        <Text style={[styles.segDiv, { color: colors.text_muted }]}>·</Text>
        <View style={styles.seg}>
          <Text style={[styles.segLabel, { color: colors.text_muted }]}>RATIO</Text>
          <Text style={[styles.segVal, { color: colors.text_primary }]}>{result.ratioLabel}</Text>
        </View>
      </View>

      {/* takeaway / top / impact captions under the points */}
      <View style={styles.tickRow}>
        <Text style={[styles.tickLabel, { color: colors.text_muted, textAlign: 'left' }]}>takeaway</Text>
        <Text style={[styles.tickLabel, { color: colors.text_muted, textAlign: 'center' }]}>top</Text>
        <Text style={[styles.tickLabel, { color: colors.text_muted, textAlign: 'right' }]}>impact</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', marginTop: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, marginTop: 4 },
  rowLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  rowLabelDim: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  rowRatio: { fontSize: 14, fontWeight: '900' },
  segRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10 },
  seg: { alignItems: 'center' },
  segLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  segVal: { fontSize: 14, fontWeight: '900', marginTop: 2 },
  segDiv: { fontSize: 16, fontWeight: '900', marginBottom: 6 },
  tickRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  tickLabel: { flex: 1, fontSize: 10, fontWeight: '700' },
});
