/**
 * 2026-06-14 (Tim — practice viz) — horizontal striation bar.
 *
 * A single segmented bar showing how a practice session split across clubs (or
 * any category): each segment's width ∝ its share (count or time), with a small
 * legend underneath. Pure react-native-svg. This is the "how much on irons vs
 * driver" read Tim described. Honest: renders only the segments passed in; a
 * single-club session is one full segment.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

export interface StriationSegment {
  label: string;
  value: number;
  /** Optional secondary line in the legend (e.g. "avg tempo 3.0:1"). */
  detail?: string | null;
}

export interface StriationBarProps {
  segments: StriationSegment[];
  width: number;
  height?: number;
  /** Palette cycled across segments. */
  colors?: string[];
}

const DEFAULT_PALETTE = ['#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee', '#a3e635'];

export default function StriationBar({ segments, width, height = 18, colors = DEFAULT_PALETTE }: StriationBarProps) {
  const valid = segments.filter((s) => s.value > 0);
  const total = valid.reduce((sum, s) => sum + s.value, 0);
  if (valid.length === 0 || total <= 0) {
    return (
      <View style={[styles.emptyWrap, { width }]}>
        <Text style={styles.emptyText}>No per-club breakdown yet</Text>
      </View>
    );
  }

  // Build segment rects left→right, widths proportional to value.
  let x = 0;
  const rects = valid.map((s, i) => {
    const w = (s.value / total) * width;
    const rect = { x, w, color: colors[i % colors.length], seg: s };
    x += w;
    return rect;
  });

  return (
    <View style={{ width }}>
      <Svg width={width} height={height}>
        {rects.map((r, i) => (
          <Rect
            key={i}
            x={r.x}
            y={0}
            width={Math.max(0, r.w - (i < rects.length - 1 ? 1 : 0))} // 1px gap between segments
            height={height}
            rx={3}
            fill={r.color}
          />
        ))}
      </Svg>
      <View style={styles.legend}>
        {rects.map((r, i) => {
          const pct = Math.round((r.seg.value / total) * 100);
          return (
            <View key={i} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: r.color }]} />
              <Text style={styles.legendLabel} numberOfLines={1}>
                {r.seg.label} · {pct}%{r.seg.detail ? ` · ${r.seg.detail}` : ''}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWrap: { paddingVertical: 8 },
  emptyText: { color: '#6b7280', fontSize: 11, fontStyle: 'italic' },
  legend: { marginTop: 8, gap: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 2 },
  legendLabel: { color: '#cbd5e1', fontSize: 12, flex: 1 },
});
