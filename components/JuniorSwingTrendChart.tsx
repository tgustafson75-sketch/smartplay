/**
 * 2026-05-22 — Junior Swing Trend Chart.
 *
 * Compact sparkline visualization of a family member's overallScore
 * history over the most-recent N swings. Used by:
 *   - app/family/[memberId].tsx  — per-member dashboard trend strip
 *   - app/family/captain.tsx     — inline trend on each TeammateRow
 *
 * Pure react-native-svg. No external chart dep. Renders in ~50 lines of
 * SVG with no animation by default (perf-conscious for the Captain
 * screen which may render 10+ trend chips at once).
 *
 * Defensive:
 *   - <2 data points → renders a placeholder "Not enough swings yet"
 *   - Identical scores → still renders a flat line (not a single dot)
 *   - Clamps to last `limit` points (default 12) to keep visual density
 *     readable on small chips
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Line as SvgLine } from 'react-native-svg';
import type { JuniorSwingAnalysis } from '../services/juniorSwingAnalyzer';

export interface JuniorSwingTrendChartProps {
  history: JuniorSwingAnalysis[];
  width: number;
  height: number;
  /** Max data points to render. Older entries are dropped from the
   *  left edge. Default 12. */
  limit?: number;
  /** Show the score range labels (min/max) at top-right. Useful in the
   *  per-member dashboard; usually off on the captain row chips. */
  showRange?: boolean;
  /** Color of the line. Default lime-green. */
  color?: string;
  /** Background fill of the chart area. null = transparent. */
  background?: string | null;
  /** Label rendered above the chart (e.g. "OVERALL SCORE"). */
  label?: string;
}

const MIN_POINTS_FOR_LINE = 2;

export default function JuniorSwingTrendChart({
  history, width, height, limit = 12,
  showRange = false, color = '#86efac', background = null, label,
}: JuniorSwingTrendChartProps) {
  const data = useMemo(() => {
    return history
      .slice(-limit)
      .map((h) => h.overallScore)
      .filter((s) => typeof s === 'number' && Number.isFinite(s));
  }, [history, limit]);

  const range = useMemo(() => {
    if (data.length === 0) return { min: 0, max: 100, delta: 0 };
    const min = Math.min(...data);
    const max = Math.max(...data);
    return { min, max, delta: data[data.length - 1] - data[0] };
  }, [data]);

  if (data.length < MIN_POINTS_FOR_LINE) {
    return (
      <View style={[styles.empty, { width, height, backgroundColor: background ?? 'transparent' }]}>
        {label ? <Text style={styles.emptyLabel}>{label}</Text> : null}
        <Text style={styles.emptyText}>Not enough swings yet</Text>
      </View>
    );
  }

  // Layout — small inset so the line never clips at the edges.
  const PAD_X = 6;
  const PAD_TOP = label ? 18 : 4;
  const PAD_BOT = 4;
  const chartW = width - PAD_X * 2;
  const chartH = height - PAD_TOP - PAD_BOT;

  // Y scale: pad the data range by ~10% so peaks don't kiss the top
  // edge. When everything is the same score, we synthesize a small
  // band so the flat line draws mid-chart instead of at the top.
  const yMin = Math.max(0, range.min - Math.max(5, (range.max - range.min) * 0.15));
  const yMax = Math.min(100, range.max + Math.max(5, (range.max - range.min) * 0.15));
  const yRange = yMax - yMin || 1;

  const points = data.map((v, i) => {
    const x = PAD_X + (chartW * i) / (data.length - 1);
    const y = PAD_TOP + chartH - ((v - yMin) / yRange) * chartH;
    return { x, y, value: v };
  });

  const pointsStr = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const trendColor =
    range.delta >= 3 ? color :
    range.delta <= -3 ? '#f87171' :
    '#cbd5e1';

  return (
    <View style={{ width, height }}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {showRange && data.length > 0 ? (
            <Text style={styles.rangeText}>
              {`   ${range.min}–${range.max}`}
              {range.delta !== 0
                ? `   (${range.delta > 0 ? '+' : ''}${range.delta})`
                : ''}
            </Text>
          ) : null}
        </Text>
      ) : null}
      <Svg width={width} height={height - (label ? 0 : 0)}>
        {background ? (
          <SvgLine x1={0} y1={height - PAD_BOT} x2={width} y2={height - PAD_BOT} stroke={background} strokeWidth={1} />
        ) : null}
        <Polyline
          points={pointsStr}
          fill="none"
          stroke={trendColor}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Trailing dot at the most-recent point so the eye lands there. */}
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
  rangeText: { color: '#cbd5e1', fontSize: 9, fontWeight: '600' },
});
