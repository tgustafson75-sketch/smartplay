/**
 * 2026-06-14 (Tim — points/practice viz) — generic numeric sparkline.
 *
 * Forked from JuniorSwingTrendChart (which is hard-typed to JuniorSwingAnalysis)
 * into a reusable `number[] → line` chart for the practice-history / improvement
 * graphs. Pure react-native-svg, no chart dep. Defensive: <2 points renders a
 * placeholder; a flat series still draws a mid-chart line; auto-scales unless an
 * explicit yMin/yMax is given.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';

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

export default function TrendChart({
  data, width, height, color = '#86efac', label, yMin, yMax,
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

  const points = series.map((v, i) => {
    const x = PAD_X + (chartW * i) / (series.length - 1);
    const y = PAD_TOP + chartH - ((v - lo) / span) * chartH;
    return { x, y };
  });
  const pointsStr = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];

  // Color the line by trend direction relative to "better".
  const improving = higherIsBetter ? delta >= 0 : delta <= 0;
  const flat = Math.abs(delta) < 1e-9;
  const trendColor = flat ? '#cbd5e1' : improving ? color : '#f87171';

  return (
    <View style={{ width, height }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Svg width={width} height={height}>
        <Polyline
          points={pointsStr}
          fill="none"
          stroke={trendColor}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle cx={last.x} cy={last.y} r={3} fill={trendColor} />
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
