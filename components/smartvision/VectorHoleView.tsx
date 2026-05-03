/**
 * Phase AN — Stylized vector hole rendering.
 *
 * Replaces (or supplements) Mapbox satellite tiles with an SVG-rendered
 * stylized hole view from coordinate data alone. No network dependency,
 * instant render, consistent quality regardless of conditions.
 *
 * Data realism: golfcourseapi provides POINT coords (tee, green centroid)
 * but NOT polygon data for fairway/green/hazards. Golfshot-style polygon
 * rendering needs a different data source. What this component ships from
 * the data we actually have:
 *
 *   - Background fairway/rough field
 *   - Tee→green fairway band (tapered straight line; doesn't model
 *     dogleg)
 *   - Green as an oval at the green centroid (approximate, ~28y across)
 *   - Tee marker at tee coord
 *   - Pin flag at green center
 *   - Current player position dot from GPS
 *   - Yardage rings from current position (100/150/200y)
 *   - Hole number + par + distance label in corner
 *
 * Coordinate projection: maps lat/lng to SVG viewport via a local
 * equirectangular projection (small-area approximation, accurate to <1%
 * over a single hole). Auto-rotates so tee→green points "up" on screen.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  Rect, Circle, Path, Line, G, Defs, LinearGradient, Stop, Polygon,
} from 'react-native-svg';

interface LatLng { lat: number; lng: number }

interface Props {
  hole: number;
  par: number;
  distance: number; // total hole yardage from card
  tee: LatLng | null;
  green: LatLng | null;
  currentPos: LatLng | null;
  width: number;
  height: number;
}

const METERS_PER_DEG_LAT = 111_111;
const YARDS_PER_METER = 1.0936;
const GREEN_RADIUS_YARDS = 14; // ~28y across, typical green
const FAIRWAY_WIDTH_YARDS = 36; // ~36y wide fairway

function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * METERS_PER_DEG_LAT * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export default function VectorHoleView({
  hole, par, distance, tee, green, currentPos, width, height,
}: Props) {
  // Pre-compute projection: rotate so tee→green axis points UP (negative
  // y in SVG coords); player dot inherits the same projection so the
  // visual matches reality.
  const projection = useMemo(() => {
    if (!tee || !green) return null;

    const teeToGreenMeters = metersBetween(tee, green);
    if (teeToGreenMeters < 5) return null; // bad data; bail

    // Yardage spans for layout.
    const teeToGreenYards = teeToGreenMeters * YARDS_PER_METER;

    // Padding so tee + green + a buffer fit cleanly. Add 40y above the
    // green (room for hole label + green) and 30y below the tee (label).
    const verticalSpanYards = teeToGreenYards + 70;
    const horizontalSpanYards = Math.max(120, FAIRWAY_WIDTH_YARDS * 3);

    const yardsPerPxY = verticalSpanYards / height;
    const yardsPerPxX = horizontalSpanYards / width;
    const yardsPerPx = Math.max(yardsPerPxY, yardsPerPxX);

    // Project a lat/lng into local-x/y meters relative to tee, then
    // rotate so green is straight up.
    const bearingRad = Math.atan2(
      (green.lng - tee.lng) * Math.cos(tee.lat * Math.PI / 180),
      green.lat - tee.lat,
    );
    const cosB = Math.cos(-bearingRad);
    const sinB = Math.sin(-bearingRad);

    const project = (p: LatLng): { x: number; y: number } => {
      const dxMeters = (p.lng - tee.lng) * METERS_PER_DEG_LAT * Math.cos(tee.lat * Math.PI / 180);
      const dyMeters = (p.lat - tee.lat) * METERS_PER_DEG_LAT;
      const xRot = dxMeters * cosB - dyMeters * sinB;
      const yRot = dxMeters * sinB + dyMeters * cosB;
      const xYards = xRot * YARDS_PER_METER;
      const yYards = yRot * YARDS_PER_METER;
      // Center-x, with tee anchored ~30y from bottom edge.
      return {
        x: width / 2 + xYards / yardsPerPx,
        y: height - 35 / yardsPerPx - yYards / yardsPerPx,
      };
    };

    return { project, yardsPerPx, teeToGreenYards };
  }, [tee, green, width, height]);

  // No coords yet → render a graceful placeholder
  if (!tee || !green || !projection) {
    return (
      <View style={[styles.placeholder, { width, height }]}>
        <Text style={styles.placeholderTitle}>HOLE {hole}</Text>
        <Text style={styles.placeholderSub}>Par {par} · {distance > 0 ? distance + ' yds' : 'yardage unknown'}</Text>
        <Text style={styles.placeholderHint}>
          Stand on the tee and tap &quot;📍 Anchor Tee&quot;,{'\n'}
          then walk to the green and tap &quot;⛳ Anchor Green&quot;{'\n'}
          to build the live hole view.
        </Text>
      </View>
    );
  }

  const { project, yardsPerPx, teeToGreenYards } = projection;
  const teePx = project(tee);
  const greenPx = project(green);
  const playerPx = currentPos ? project(currentPos) : null;

  // Fairway band as a tapered polygon: narrower at tee, wider toward green
  const halfFairwayPxAtTee = (FAIRWAY_WIDTH_YARDS * 0.6) / yardsPerPx / 2;
  const halfFairwayPxAtGreen = (FAIRWAY_WIDTH_YARDS * 1.0) / yardsPerPx / 2;
  const fairwayPoints =
    `${teePx.x - halfFairwayPxAtTee},${teePx.y} ` +
    `${teePx.x + halfFairwayPxAtTee},${teePx.y} ` +
    `${greenPx.x + halfFairwayPxAtGreen},${greenPx.y} ` +
    `${greenPx.x - halfFairwayPxAtGreen},${greenPx.y}`;

  const greenRadiusPx = GREEN_RADIUS_YARDS / yardsPerPx;

  // Yardage rings from current player position, or from tee if no GPS.
  const ringOrigin = playerPx ?? teePx;
  const ringYards = [100, 150, 200];

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="rough" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1f3a28" stopOpacity={1} />
            <Stop offset="1" stopColor="#162c1e" stopOpacity={1} />
          </LinearGradient>
          <LinearGradient id="fairway" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#4ea36a" stopOpacity={1} />
            <Stop offset="1" stopColor="#3a8a55" stopOpacity={1} />
          </LinearGradient>
          <LinearGradient id="green" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#7ed3a3" stopOpacity={1} />
            <Stop offset="1" stopColor="#5fb88a" stopOpacity={1} />
          </LinearGradient>
        </Defs>

        {/* Rough background */}
        <Rect x={0} y={0} width={width} height={height} fill="url(#rough)" />

        {/* Fairway band (tapered tee→green) */}
        <Polygon
          points={fairwayPoints}
          fill="url(#fairway)"
          stroke="#3a8a55"
          strokeWidth={1}
          opacity={0.95}
        />

        {/* Green oval */}
        <Circle
          cx={greenPx.x}
          cy={greenPx.y}
          r={greenRadiusPx}
          fill="url(#green)"
          stroke="#3a8a55"
          strokeWidth={1.5}
        />

        {/* Pin flag at green center */}
        <Line
          x1={greenPx.x}
          y1={greenPx.y - greenRadiusPx * 0.15}
          x2={greenPx.x}
          y2={greenPx.y - greenRadiusPx * 0.95}
          stroke="#1a1a1a"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <Path
          d={`M ${greenPx.x} ${greenPx.y - greenRadiusPx * 0.95} L ${greenPx.x + 7} ${greenPx.y - greenRadiusPx * 0.85} L ${greenPx.x} ${greenPx.y - greenRadiusPx * 0.75} Z`}
          fill="#ef4444"
          stroke="#7a1a1a"
          strokeWidth={0.5}
        />
        <Circle cx={greenPx.x} cy={greenPx.y} r={2.5} fill="#1a1a1a" />

        {/* Tee marker */}
        <G>
          <Rect
            x={teePx.x - 8}
            y={teePx.y - 4}
            width={16}
            height={8}
            rx={2}
            fill="#fbbf24"
            stroke="#92400e"
            strokeWidth={1}
          />
        </G>

        {/* Yardage rings from current position (or tee) */}
        {ringYards.map(y => {
          const r = y / yardsPerPx;
          // Hide if ring is too small (off-camera) or too large (whole screen)
          if (r < 12 || r > Math.max(width, height) * 0.95) return null;
          return (
            <Circle
              key={y}
              cx={ringOrigin.x}
              cy={ringOrigin.y}
              r={r}
              fill="none"
              stroke="#ffffff"
              strokeWidth={1}
              strokeDasharray="3,4"
              opacity={0.45}
            />
          );
        })}

        {/* Player dot */}
        {playerPx && (
          <>
            <Circle cx={playerPx.x} cy={playerPx.y} r={9} fill="#00C896" stroke="#ffffff" strokeWidth={2} />
            <Circle cx={playerPx.x} cy={playerPx.y} r={2} fill="#ffffff" />
          </>
        )}
      </Svg>

      {/* Hole label overlay (native text for crisper rendering) */}
      <View style={styles.label}>
        <Text style={styles.labelHole}>HOLE {hole}</Text>
        <Text style={styles.labelMeta}>Par {par} · {distance > 0 ? distance + ' yds' : Math.round(teeToGreenYards) + ' yds'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#162c1e',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  placeholderTitle: {
    color: '#7ed3a3',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 6,
  },
  placeholderSub: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 14,
  },
  placeholderHint: {
    color: '#6b7280',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 17,
  },
  label: {
    position: 'absolute',
    top: 10,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  labelHole: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  labelMeta: {
    color: '#d1d5db',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
});
