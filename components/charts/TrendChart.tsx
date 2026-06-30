/**
 * 2026-06-14 (Tim — points/practice viz) — generic numeric sparkline.
 *
 * Forked from JuniorSwingTrendChart (which is hard-typed to JuniorSwingAnalysis)
 * into a reusable `number[] → line` chart for the practice-history / improvement
 * graphs. Pure react-native-svg, no chart dep. Defensive: <2 points renders a
 * placeholder; a flat series still draws a mid-chart line; auto-scales unless an
 * explicit yMin/yMax is given.
 *
 * 2026-06-30 (Tim — "graphs nice and smooth and according to our branding") — line is
 * now a SMOOTH Catmull-Rom→Bézier curve (not angular segments) with a soft on-brand
 * gradient area fill under it. Same props + data; purely a rendering upgrade.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

export interface TrendChartProps {
  data: number[];
  width: number;
  height: number;
  color?: string;
  label?: string;
  /** Lower/upper bound override; auto from data (with padding) when omitted. */
  yMin?: number;
  yMax?: number;
  /** "higher is better" → green when rising; set false to invert the trend color. */
  higherIsBetter?: boolean;
  emptyText?: string;
}

const MIN_POINTS = 2;

type Pt = { x: number; y: number };

// Catmull-Rom spline → cubic-Bézier path. Endpoints are duplicated so the curve
// passes through every data point with natural tension (1/6).
function smoothLinePath(pts: Pt[]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

export default function TrendChart({
  data, width, height, color = '#00C896', label, yMin, yMax,
  higherIsBetter = true, emptyText = 'Not enough data yet',
}: TrendChartProps) {
  const series = useMemo(
    () => data.filter((v) => typeof v === 'number' && Number.isFinite(v)),
    [data],
  );

  if (series.length < MIN_POINTS) {
    return (
      <View style={[styles.empty, { width, height }]}>
        {label ? <Text style={styles.emptyLabel}>{label}</Text> : null}
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }

  const rawMin = Math.min(...series);
  const rawMax = Math.max(...series);
  const pad = Math.max(rawMax - rawMin, 1) * 0.15;
  const lo = yMin ?? rawMin - pad;
  const hi = yMax ?? rawMax + pad;
  const span = hi - lo || 1;
  const delta = series[series.length - 1] - series[0];

  const PAD_X = 6;
  const PAD_TOP = label ? 18 : 4;
  const PAD_BOT = 4;
  const chartW = width - PAD_X * 2;
  const chartH = height - PAD_TOP - PAD_BOT;
  const baseY = PAD_TOP + chartH;

  const points: Pt[] = series.map((v, i) => {
    const x = PAD_X + (chartW * i) / (series.length - 1);
    const y = PAD_TOP + chartH - ((v - lo) / span) * chartH;
    return { x, y };
  });
  const last = points[points.length - 1];

  // Color the line by trend direction relative to "better".
  const improving = higherIsBetter ? delta >= 0 : delta <= 0;
  const flat = Math.abs(delta) < 1e-9;
  const trendColor = flat ? '#cbd5e1' : improving ? color : '#f87171';

  const linePath = smoothLinePath(points);
  // Area = the smooth line, then down to the baseline and back to the start.
  const areaPath = `${linePath}L${last.x.toFixed(1)},${baseY.toFixed(1)}L${points[0].x.toFixed(1)},${baseY.toFixed(1)}Z`;
  // Unique per chart instance (color + size + endpoints) so multiple charts on one
  // screen don't share/collide on a single <LinearGradient> id.
  const gradId = `tc-${trendColor.replace('#', '')}-${Math.round(width)}x${Math.round(height)}-${Math.round(points[0].y)}-${Math.round(last.y)}`;

  return (
    <View style={{ width, height }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={trendColor} stopOpacity={0.28} />
            <Stop offset="1" stopColor={trendColor} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        <Path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        <Path
          d={linePath}
          fill="none"
          stroke={trendColor}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle cx={last.x} cy={last.y} r={3.5} fill={trendColor} />
        <Circle cx={last.x} cy={last.y} r={6} fill={trendColor} fillOpacity={0.18} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  emptyLabel: { color: '#6b7280', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  emptyText: { color: '#6b7280', fontSize: 11, fontStyle: 'italic' },
  label: { color: '#9ca3af', fontSize: 9, fontWeight: '900', letterSpacing: 1.3, marginBottom: 2 },
});
