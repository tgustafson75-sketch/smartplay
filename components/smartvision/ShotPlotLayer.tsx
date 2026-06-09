/**
 * 2026-06-08 — Shared shot-plot layer.
 *
 * One renderer for the live on-course shot plot, reused across all three
 * hole-view renderers (VectorHoleView, GolfshotHoleView, and hole-view's
 * satellite branch). Each view projects shot GPS → pixels with ITS OWN
 * projection, then hands the pixel points here so the drawing + the
 * tap-callout are identical everywhere.
 *
 * Honest by construction: we draw STRAIGHT start→rest connectors. We know
 * the GPS endpoints (cart-mark / shot tracking), not the airborne arc, so
 * we never fake a curve. See memory shot-tracing-goal.
 *
 * Split in two because react-native-svg children must be SVG primitives:
 *   - ShotPlotSvg     → render INSIDE an <Svg> (lines + numbered markers)
 *   - ShotPlotCallout → render as a sibling overlay (native View)
 * The parent owns the selected-index state and shares it to both.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { G, Line, Circle, Text as SvgText } from 'react-native-svg';

interface LatLng { lat: number; lng: number }
interface Pixel { x: number; y: number }

/** A completed shot in GPS space. Either endpoint may be null (e.g. a
 *  shot with only a rest mark). Views project these to ShotPlotPoint. */
export interface PlottedShot {
  /** 1-based shot number on the hole. */
  index: number;
  start: LatLng | null;
  end: LatLng | null;
  club?: string | null;
  distanceYards?: number | null;
}

/** A shot already projected into a view's pixel space. */
export interface ShotPlotPoint {
  index: number;
  startPx: Pixel | null;
  endPx: Pixel | null;
  club?: string | null;
  distanceYards?: number | null;
}

const ACCENT = '#00C896';
const SELECTED = '#fde68a';

/** Project GPS shots → pixel points using a caller-supplied projection.
 *  Drops shots with neither endpoint projectable. */
export function projectShots(
  shots: PlottedShot[] | undefined,
  project: (loc: LatLng) => Pixel | null,
): ShotPlotPoint[] {
  return (shots ?? [])
    .map(s => ({
      index: s.index,
      club: s.club ?? null,
      distanceYards: s.distanceYards ?? null,
      startPx: s.start ? project(s.start) : null,
      endPx: s.end ? project(s.end) : null,
    }))
    .filter(p => p.endPx != null || p.startPx != null);
}

/** SVG layer — MUST be rendered inside an <Svg>. Start→rest connectors +
 *  numbered, tappable rest markers. */
export function ShotPlotSvg({
  points, selectedIndex, onSelect,
}: {
  points: ShotPlotPoint[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}) {
  return (
    <>
      {points.map((p) => {
        const isSel = p.index === selectedIndex;
        return (
          <G key={`shot-${p.index}`}>
            {p.startPx && p.endPx && (
              <Line
                x1={p.startPx.x} y1={p.startPx.y}
                x2={p.endPx.x} y2={p.endPx.y}
                stroke={isSel ? SELECTED : ACCENT}
                strokeWidth={isSel ? 3 : 2}
                strokeLinecap="round"
                opacity={0.95}
              />
            )}
            {p.startPx && (
              <Circle cx={p.startPx.x} cy={p.startPx.y} r={2.5} fill="#ffffff" opacity={0.7} />
            )}
            {p.endPx && (
              <>
                {/* Fat transparent hit target for easy tapping. */}
                <Circle
                  cx={p.endPx.x} cy={p.endPx.y} r={16} fill="transparent"
                  onPress={() => onSelect(isSel ? null : p.index)}
                />
                <Circle
                  cx={p.endPx.x} cy={p.endPx.y} r={9}
                  fill={isSel ? SELECTED : ACCENT}
                  stroke="#0a1410" strokeWidth={2}
                  onPress={() => onSelect(isSel ? null : p.index)}
                />
                <SvgText
                  x={p.endPx.x} y={p.endPx.y + 3.5}
                  fill="#0a1410" fontSize={10} fontWeight="900"
                  textAnchor="middle"
                >
                  {p.index}
                </SvgText>
              </>
            )}
          </G>
        );
      })}
    </>
  );
}

/** Native callout — render as a sibling of the <Svg>, near the selected
 *  shot's rest marker. */
export function ShotPlotCallout({
  point, width, height,
}: {
  point: ShotPlotPoint | null;
  width: number;
  height: number;
}) {
  if (!point?.endPx) return null;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.callout,
        {
          left: Math.max(4, Math.min(width - 108, point.endPx.x - 52)),
          top: Math.max(4, Math.min(height - 46, point.endPx.y - 52)),
        },
      ]}
    >
      <Text style={styles.title}>SHOT {point.index}</Text>
      <Text style={styles.meta}>
        {(point.club ?? '—')}{point.distanceYards != null ? ` · ${point.distanceYards}y` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  callout: {
    position: 'absolute',
    minWidth: 104,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  title: { color: ACCENT, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  meta: { color: '#ffffff', fontSize: 13, fontWeight: '800', marginTop: 1 },
});
