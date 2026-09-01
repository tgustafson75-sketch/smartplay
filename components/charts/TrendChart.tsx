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
  // 2026-08-06 (Tim — "the line graph has no labels, not sure which is score and which is practice; need a
  // much smarter graph"). A clearer, self-explaining legend + optional warm-up markers.
  /** Identity color for the legend dot — so the reader ties THIS line's color to its metric. Defaults to
   *  `color`. (The line itself still colors by TREND: green improving / red declining / grey flat.) */
  legendDotColor?: string;
  /** Show a trend arrow (↑ improving / ↓ declining / → flat) + the delta beside the label. */
  showTrend?: boolean;
  /** Unit suffix for the trend delta (e.g. 'balls', 'vs par'). */
  deltaUnit?: string;
  /** Indices in `data` to mark with a distinct dot — used to plot WARM-UP weeks on the line. */
  markerIndices?: number[];
  /** Color of the marker dots (defaults to a sky accent). */
  markerColor?: string;
  /** Legend text for the markers, e.g. 'warm-up'. Shown with a marker swatch when markerIndices is set. */
  markerLabel?: string;
  // 2026-08-06 (Tim — "there should be ONE graph not multiple"). A SECOND series overlaid on the same
  // chart (its own independent scale, so different units — practice balls vs score-vs-par — can share one
  // timeline and read as "are they moving together"). Drawn as a line in its own color with its own legend
  // entry. This is what collapses the old score/effort pair into a single graph.
  overlay?: {
    data: number[];
    color: string;
    label: string;
    /** Overlay is drawn in its solid color (not trend-colored) so the two lines stay distinguishable. */
  } | null;
}

const MIN_POINTS = 2;

type Pt = { x: number; y: number };

/** Map a numeric series into chart points over a shared x-range, normalized to its OWN [lo,hi]. */
function seriesToPoints(series: number[], xPad: number, chartW: number, yTop: number, chartH: number): Pt[] {
  if (series.length < 1) return [];
  const rawMin = Math.min(...series);
  const rawMax = Math.max(...series);
  const pad = Math.max(rawMax - rawMin, 1) * 0.15;
  const lo = rawMin - pad;
  const span = (rawMax + pad) - lo || 1;
  const n = series.length;
  return series.map((v, i) => ({
    x: xPad + (chartW * i) / Math.max(1, n - 1),
    y: yTop + chartH - ((v - lo) / span) * chartH,
  }));
}

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
  legendDotColor, showTrend = false, deltaUnit, markerIndices, markerColor = '#38bdf8', markerLabel,
  overlay = null,
}: TrendChartProps) {
  const series = useMemo(
    () => data.filter((v) => typeof v === 'number' && Number.isFinite(v)),
    [data],
  );
  const overlaySeries = useMemo(
    () => (overlay?.data ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v)),
    [overlay],
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
  const hasLegend = !!label;
  const PAD_TOP = hasLegend ? 22 : 4;
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
  // Overlay series: its OWN normalization over the SAME x-range/geometry (shape-correlation on one graph).
  const overlayPts = overlaySeries.length >= MIN_POINTS
    ? seriesToPoints(overlaySeries, PAD_X, chartW, PAD_TOP, chartH)
    : [];
  const overlayPath = overlayPts.length ? smoothLinePath(overlayPts) : '';
  // Markers sit on the effort (overlay) line when present — warm-ups are a property of practice weeks —
  // otherwise on the primary line.
  const markerHost = overlayPts.length ? overlayPts : points;
  const markerPts = (markerIndices ?? [])
    .filter((i) => Number.isInteger(i) && i >= 0 && i < markerHost.length)
    .map((i) => markerHost[i]);

  // Color the line by trend direction relative to "better".
  const improving = higherIsBetter ? delta >= 0 : delta <= 0;
  const flat = Math.abs(delta) < 1e-9;
  const trendColor = flat ? '#cbd5e1' : improving ? color : '#f87171';

  // 2026-08-06 — trend arrow + delta for the legend, so "which line, and is it improving" is unmistakable.
  const arrow = flat ? '→' : improving ? '↑' : '↓';
  const deltaAbs = Math.abs(delta);
  const deltaStr = flat ? 'flat' : `${arrow} ${deltaAbs % 1 === 0 ? deltaAbs : deltaAbs.toFixed(1)}${deltaUnit ? ' ' + deltaUnit : ''}`;
  // Warm-up (or other) markers: distinct dots ON the relevant line at the given data indices. When there's
  // an overlay (effort line), the markers belong to IT (warm-ups are a property of practice weeks); else the
  // primary line. Computed after overlayPts below via markerHost.

  const linePath = smoothLinePath(points);
  // Area = the smooth line, then down to the baseline and back to the start.
  const areaPath = `${linePath}L${last.x.toFixed(1)},${baseY.toFixed(1)}L${points[0].x.toFixed(1)},${baseY.toFixed(1)}Z`;
  // Unique per chart instance (color + size + endpoints) so multiple charts on one
  // screen don't share/collide on a single <LinearGradient> id.
  const gradId = `tc-${trendColor.replace('#', '')}-${Math.round(width)}x${Math.round(height)}-${Math.round(points[0].y)}-${Math.round(last.y)}`;

  return (
    <View style={{ width, height }}>
      {hasLegend ? (
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: legendDotColor ?? color }]} />
          <Text style={styles.legendLabel} numberOfLines={1}>{label}</Text>
          {showTrend ? (
            <Text style={[styles.legendTrend, { color: trendColor }]} numberOfLines={1}>{deltaStr}</Text>
          ) : null}
          {overlayPath ? (
            <>
              <View style={[styles.legendDot, { backgroundColor: overlay!.color, marginLeft: 8 }]} />
              <Text style={styles.legendLabel} numberOfLines={1}>{overlay!.label}</Text>
            </>
          ) : null}
          {markerPts.length && markerLabel ? (
            <>
              <View style={[styles.legendMarker, { borderColor: markerColor }]} />
              <Text style={[styles.legendMarkerLabel, { color: markerColor }]} numberOfLines={1}>{markerLabel}</Text>
            </>
          ) : null}
        </View>
      ) : null}
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={trendColor} stopOpacity={0.28} />
            <Stop offset="1" stopColor={trendColor} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        <Path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        {/* 2026-08-06 (Tim — ONE graph) — the overlaid effort line (own scale, own solid color), drawn
            BENEATH the primary outcome line so the score line stays the visual anchor. */}
        {overlayPath ? (
          <Path d={overlayPath} fill="none" stroke={overlay!.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.9} strokeDasharray="5 3" />
        ) : null}
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
        {/* 2026-08-06 (Tim) — WARM-UP markers on the line: a hollow ring at each flagged week/session, so a
            warm-up before a round/practice reads as a real data point on the graph. */}
        {markerPts.map((p, i) => (
          <Circle key={`mk-${i}`} cx={p.x} cy={p.y} r={4} fill="#0b1220" stroke={markerColor} strokeWidth={2} />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  emptyLabel: { color: '#6b7280', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  emptyText: { color: '#6b7280', fontSize: 11, fontStyle: 'italic' },
  label: { color: '#c2cad4', fontSize: 9, fontWeight: '900', letterSpacing: 1.3, marginBottom: 2 },
  // 2026-08-06 — a clear, self-explaining legend: colored dot ↔ line identity, bold label, trend arrow.
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2, height: 16 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { color: '#e5e7eb', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  legendTrend: { fontSize: 10, fontWeight: '800', marginLeft: 2 },
  legendMarker: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, backgroundColor: 'transparent', marginLeft: 6 },
  legendMarkerLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
});
