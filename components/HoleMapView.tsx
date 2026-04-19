/**
 * HoleMapView
 *
 * Top-down SVG hole layout. Zero extra dependencies — uses react-native-svg
 * which is already installed. Renders entirely from GPS coordinates.
 *
 * Features
 * ────────
 *  • Player location  — animated blue dot with accuracy halo
 *  • Green markers    — front (yellow), middle (green), back (red) flags
 *  • Tee box          — white rectangle if tee coords provided
 *  • Fairway corridor — soft semi-transparent green band between tee and green
 *  • Distance labels  — front / middle / back yardages when available
 *  • North arrow      — small orientation indicator
 *  • Auto-fits        — calculates bounding box and scales all points to canvas
 *  • Live updates     — pass fresh userLat/userLng every tick; component is
 *                        pure so React re-renders only when props change
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, {
  Circle, Rect, Line, Path, Text as SvgText,
  Defs, RadialGradient, Stop, G, Ellipse,
} from 'react-native-svg';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface LatLng {
  lat: number;
  lng: number;
}

export interface HoleMapProps {
  /** Player's current GPS position. null = no fix yet. */
  userLocation: LatLng | null;
  /** GPS accuracy radius in metres (from expo-location). */
  gpsAccuracy?: number | null;
  /** Green coordinates from CourseHole */
  green: {
    front:  LatLng;
    middle: LatLng;
    back:   LatLng;
  };
  /** Optional tee box centre. Draws a white tee rectangle if provided. */
  tee?: LatLng | null;
  /** Yardages shown as labels. Pass from gpsYards or static hole.distance. */
  yards?: {
    front:  number | null;
    middle: number | null;
    back:   number | null;
  } | null;
  /** Hole name / number shown in header */
  holeLabel?: string;
  /** Par shown in header */
  par?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PAD          = 40;   // canvas padding (px)
const GREEN_RADIUS = 18;   // SVG px for the green circle
const DOT_R        = 9;    // player dot radius

// Colours
const COL = {
  bg:         '#091e13',
  fairway:    '#0f3320',
  fairwayBdr: '#16a34a33',
  green:      '#22c55e',
  tee:        '#f9fafb',
  playerDot:  '#3b82f6',
  playerHalo: '#3b82f620',
  front:      '#fbbf24',   // yellow flag
  middle:     '#4ade80',   // green  flag
  back:       '#f87171',   // red    flag
  label:      '#d1fae5',
  muted:      '#4a7c5e',
  north:      '#9ca3af',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Degrees → radians */
const toRad = (d: number) => (d * Math.PI) / 180;

/** Haversine distance in yards between two lat/lng points */
function haversineYards(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // metres
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(a))) * 1.09361; // m → yards
}

/**
 * Projects a lat/lng to canvas (x, y) pixels.
 * Uses a simple equirectangular projection (accurate enough within a few hundred metres).
 */
function project(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number,
  scale: number,         // pixels per degree
  canvasW: number,
  canvasH: number,
  offsetX: number,       // shift to centre the bounding box
  offsetY: number,
): { x: number; y: number } {
  const cosLat = Math.cos(toRad(originLat));
  const x = (lng - originLng) * scale * cosLat + canvasW / 2 + offsetX;
  const y = -(lat - originLat) * scale          + canvasH / 2 + offsetY;
  return { x, y };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function HoleMapView({
  userLocation,
  gpsAccuracy,
  green,
  tee = null,
  yards = null,
  holeLabel = 'Hole',
  par,
}: HoleMapProps) {
  const { width } = useWindowDimensions();
  const canvasW = Math.min(width - 32, 400);
  const canvasH = canvasW * 1.35;

  // ── Compute projection ───────────────────────────────────────────────────
  const {
    proj,
    scaleInfo,
  } = useMemo(() => {
    // Collect all known points for bounding-box calculation
    const points: LatLng[] = [green.front, green.middle, green.back];
    if (tee)          points.push(tee);
    if (userLocation) points.push(userLocation);

    // Bounding box
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const originLat = (minLat + maxLat) / 2;
    const originLng = (minLng + maxLng) / 2;
    const cosLat    = Math.cos(toRad(originLat));

    // Target usable canvas area (canvas minus padding on each side)
    const drawW = canvasW - PAD * 2;
    const drawH = canvasH - PAD * 2;

    // Degree spans
    const spanLat = Math.max(maxLat - minLat, 0.0001);
    const spanLng = Math.max((maxLng - minLng) * cosLat, 0.0001);

    // Scale: pixels per degree, constrained by both axes
    const scaleByLat = drawH / spanLat;
    const scaleByLng = drawW / spanLng;
    const scale      = Math.min(scaleByLat, scaleByLng) * 0.8; // 0.8 for breathing room

    // Centre offset: shift so bounding box sits in middle of canvas
    const centreX = (minLng + maxLng) / 2;
    const centreY = (minLat + maxLat) / 2;
    const offsetX = -(centreX - originLng) * scale * cosLat;
    const offsetY =  (centreY - originLat) * scale;

    const proj = (lat: number, lng: number) =>
      project(lat, lng, originLat, originLng, scale, canvasW, canvasH, offsetX, offsetY);

    // Accuracy circle radius in SVG pixels (1 degree lat ≈ 111 km)
    const metresToPx = scale / 111000;
    const accuracyR  = gpsAccuracy ? gpsAccuracy * metresToPx : 0;

    return { proj, scaleInfo: { scale, metresToPx, accuracyR } };
  }, [
    green.front.lat, green.front.lng,
    green.middle.lat, green.middle.lng,
    green.back.lat, green.back.lng,
    tee?.lat, tee?.lng,
    userLocation?.lat, userLocation?.lng,
    gpsAccuracy,
    canvasW, canvasH,
  ]);

  // ── Project all points ───────────────────────────────────────────────────
  const pFront  = proj(green.front.lat,  green.front.lng);
  const pMiddle = proj(green.middle.lat, green.middle.lng);
  const pBack   = proj(green.back.lat,   green.back.lng);
  const pTee    = tee ? proj(tee.lat, tee.lng) : null;
  const pUser   = userLocation ? proj(userLocation.lat, userLocation.lng) : null;

  // ── Fairway path (trapezoid from tee to green) ──────────────────────────
  // Only drawn when we have a tee reference
  const fairwayPath = useMemo(() => {
    if (!pTee) return null;
    const gx = pMiddle.x;
    const gy = pMiddle.y;
    const tx = pTee.x;
    const ty = pTee.y;
    // Perpendicular direction
    const dx = gy - ty;
    const dy = tx - gx;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx  = dx / len;
    const ny  = dy / len;
    const gwHalf = GREEN_RADIUS * 1.4;  // green width at green end
    const twHalf = GREEN_RADIUS * 2.2;  // fairway width at tee end
    return [
      `M ${gx + nx * gwHalf} ${gy + ny * gwHalf}`,
      `L ${gx - nx * gwHalf} ${gy - ny * gwHalf}`,
      `L ${tx - nx * twHalf} ${ty - ny * twHalf}`,
      `L ${tx + nx * twHalf} ${ty + ny * twHalf}`,
      'Z',
    ].join(' ');
  }, [pTee, pMiddle]);

  // ── Distance line (user → middle) ────────────────────────────────────────
  const showDistLine = pUser != null;

  // ── No-GPS placeholder ───────────────────────────────────────────────────
  if (!userLocation) {
    // Still show the hole layout without the player dot
  }

  return (
    <View style={styles.wrapper}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{holeLabel}{par ? ` · Par ${par}` : ''}</Text>
        {userLocation ? (
          <Text style={styles.headerCoords}>
            {userLocation.lat.toFixed(5)}°N  {Math.abs(userLocation.lng).toFixed(5)}°W
          </Text>
        ) : (
          <Text style={[styles.headerCoords, { color: '#f59e0b' }]}>Waiting for GPS…</Text>
        )}
      </View>

      {/* ── SVG Canvas ──────────────────────────────────────────────── */}
      <View style={[styles.canvas, { width: canvasW, height: canvasH }]}>
        <Svg width={canvasW} height={canvasH}>
          <Defs>
            <RadialGradient id="playerGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%"   stopColor={COL.playerDot} stopOpacity={0.35} />
              <Stop offset="100%" stopColor={COL.playerDot} stopOpacity={0}    />
            </RadialGradient>
          </Defs>

          {/* Background */}
          <Rect x={0} y={0} width={canvasW} height={canvasH} fill={COL.bg} />

          {/* Fairway corridor */}
          {fairwayPath && (
            <Path d={fairwayPath} fill={COL.fairway} stroke={COL.fairwayBdr} strokeWidth={1} />
          )}

          {/* ── Distance line user → middle green ─────────────────── */}
          {showDistLine && pUser && (
            <Line
              x1={pUser.x} y1={pUser.y}
              x2={pMiddle.x} y2={pMiddle.y}
              stroke="#4ade8044"
              strokeWidth={1.5}
              strokeDasharray="6,4"
            />
          )}

          {/* ── Tee box ────────────────────────────────────────────── */}
          {pTee && (
            <G>
              <Rect
                x={pTee.x - 8} y={pTee.y - 5}
                width={16} height={10}
                rx={3} ry={3}
                fill={COL.tee} fillOpacity={0.25}
                stroke={COL.tee} strokeWidth={1.2}
              />
              <SvgText x={pTee.x} y={pTee.y + 16} textAnchor="middle"
                fill={COL.tee} fontSize={9} fontWeight="700" opacity={0.65}>
                TEE
              </SvgText>
            </G>
          )}

          {/* ── Green circle ────────────────────────────────────────── */}
          <Ellipse
            cx={pMiddle.x} cy={pMiddle.y}
            rx={GREEN_RADIUS * 1.5} ry={GREEN_RADIUS}
            fill={COL.green} fillOpacity={0.18}
            stroke={COL.green} strokeWidth={1.5} strokeOpacity={0.6}
          />

          {/* ── Green markers: front / middle / back ─────────────────── */}
          {/* Front — yellow */}
          <FlagMarker px={pFront} color={COL.front} label="F" yards={yards?.front} />

          {/* Middle — bright green */}
          <FlagMarker px={pMiddle} color={COL.middle} label="M" yards={yards?.middle} primary />

          {/* Back — red */}
          <FlagMarker px={pBack} color={COL.back} label="B" yards={yards?.back} />

          {/* ── Player dot ──────────────────────────────────────────── */}
          {pUser && (
            <G>
              {/* Accuracy halo */}
              {scaleInfo.accuracyR > 4 && (
                <Circle
                  cx={pUser.x} cy={pUser.y}
                  r={Math.min(scaleInfo.accuracyR, 60)}
                  fill="url(#playerGlow)"
                />
              )}
              {/* Outer ring */}
              <Circle cx={pUser.x} cy={pUser.y} r={DOT_R + 3}
                fill="none" stroke={COL.playerDot} strokeWidth={1.5} opacity={0.5} />
              {/* Solid dot */}
              <Circle cx={pUser.x} cy={pUser.y} r={DOT_R}
                fill={COL.playerDot} />
              {/* Inner highlight */}
              <Circle cx={pUser.x - 2} cy={pUser.y - 2} r={3}
                fill="#fff" opacity={0.35} />
              <SvgText x={pUser.x} y={pUser.y + DOT_R + 12}
                textAnchor="middle" fill={COL.playerDot}
                fontSize={9} fontWeight="800">
                YOU
              </SvgText>
            </G>
          )}

          {/* ── North arrow (top-right) ────────────────────────────── */}
          <NorthArrow x={canvasW - 22} y={22} />
        </Svg>
      </View>

      {/* ── Legend ──────────────────────────────────────────────────── */}
      <View style={styles.legend}>
        <LegendItem color={COL.front}     label="Front"  />
        <LegendItem color={COL.middle}    label="Middle" />
        <LegendItem color={COL.back}      label="Back"   />
        {pTee && <LegendItem color={COL.tee} label="Tee" square />}
        <LegendItem color={COL.playerDot} label="You"   />
      </View>

      {/* ── Green coords debug strip ─────────────────────────────────── */}
      <View style={styles.debugStrip}>
        <Text style={styles.debugText}>
          Green M  {green.middle.lat.toFixed(5)}, {green.middle.lng.toFixed(5)}
        </Text>
        {userLocation && (
          <Text style={styles.debugText}>
            User  {userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FlagProps {
  px: { x: number; y: number };
  color: string;
  label: string;
  yards?: number | null;
  primary?: boolean;
}

function FlagMarker({ px, color, label, yards, primary = false }: FlagProps) {
  const r = primary ? 7 : 5.5;
  return (
    <G>
      {/* Dot */}
      <Circle cx={px.x} cy={px.y} r={r}
        fill={color} fillOpacity={primary ? 1 : 0.85}
        stroke="#fff" strokeWidth={primary ? 1.5 : 1} strokeOpacity={0.4}
      />
      {/* Letter */}
      <SvgText x={px.x} y={px.y + r * 0.38}
        textAnchor="middle" fill="#fff"
        fontSize={primary ? 8 : 7} fontWeight="900">
        {label}
      </SvgText>
      {/* Yardage label */}
      {yards != null && yards > 0 && (
        <G>
          <Rect
            x={px.x - 15} y={px.y - r - 17}
            width={30} height={13}
            rx={4} ry={4}
            fill="#000" fillOpacity={0.55}
          />
          <SvgText
            x={px.x} y={px.y - r - 8}
            textAnchor="middle" fill={color}
            fontSize={11} fontWeight="800">
            {yards}
          </SvgText>
        </G>
      )}
    </G>
  );
}

function NorthArrow({ x, y }: { x: number; y: number }) {
  return (
    <G>
      <Line x1={x} y1={y + 10} x2={x} y2={y - 10}
        stroke="#9ca3af" strokeWidth={1.5} />
      <Path d={`M ${x - 4} ${y - 6} L ${x} ${y - 14} L ${x + 4} ${y - 6} Z`}
        fill="#9ca3af" />
      <SvgText x={x} y={y + 20} textAnchor="middle"
        fill="#9ca3af" fontSize={8} fontWeight="700">
        N
      </SvgText>
    </G>
  );
}

function LegendItem({
  color, label, square = false,
}: { color: string; label: string; square?: boolean }) {
  return (
    <View style={styles.legendItem}>
      {square ? (
        <View style={[styles.legendSquare, { backgroundColor: color, opacity: 0.6 }]} />
      ) : (
        <View style={[styles.legendDot, { backgroundColor: color }]} />
      )}
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 4,
  },
  headerTitle: {
    color: '#4ade80',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  headerCoords: {
    color: '#4a7c5e',
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  canvas: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1a4a2e',
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  legendItem:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:    { width: 9, height: 9, borderRadius: 5 },
  legendSquare: { width: 9, height: 7, borderRadius: 2 },
  legendLabel:  { color: '#4a7c5e', fontSize: 11, fontWeight: '700' },
  debugStrip: {
    width: '100%',
    backgroundColor: '#0a120e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a3020',
    paddingVertical: 5,
    paddingHorizontal: 10,
    gap: 2,
  },
  debugText: {
    color: '#2d6a45',
    fontSize: 10,
    fontFamily: 'monospace',
    fontVariant: ['tabular-nums'],
  },
});
