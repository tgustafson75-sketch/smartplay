/**
 * 2026-05-22 — Golfshot-style hole view.
 *
 * Full-bleed satellite/screenshot background with:
 *   - Top header: HOLE N · PAR P · D yds
 *   - Instruction banner: "Drag Y to layup · Drag P to set pin"
 *   - Semi-transparent green disk overlay at the pin
 *   - Distance line + label from Y to P
 *   - Draggable yellow "Y" (layup) and red "P" (pin) markers
 *   - Bottom bar: FRONT / MIDDLE / BACK yardages
 *
 * Image source: services/holeImageMapper — bundled screenshot wins
 * (highest fidelity), with Mapbox + Google fallbacks for courses we
 * don't have bundled (resolved via golfcourseapi).
 *
 * Calibration: the bundled screenshots are pre-cropped so the tee box
 * sits at ~87% of image height and the green sits at ~10% (the same
 * frame the legacy hole-view drag UI was tuned against). yards-per-
 * pixel derives from the hole's scorecard yardage spanning that 77%
 * vertical range. F/M/B yardages factor the green-depth offset
 * computed from courseGeometry.green_front / green_back.
 *
 * Defensive: missing image → "no image" empty state. Missing geometry
 * → distance bar shows "—".  Marker positions clamped to image bounds.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Image, StyleSheet, PanResponder,
  type ImageSourcePropType,
} from 'react-native';
import Svg, { Line, Circle, Text as SvgText } from 'react-native-svg';
import { resolveHoleImage, type HoleImageResolution } from '../../services/holeImageMapper';
import { haversineYards } from '../../utils/geoDistance';
import WindageBadge from './WindageBadge';

interface LatLng { lat: number; lng: number }

export interface GolfshotHoleViewProps {
  courseId: string | null;
  courseName: string | null;
  holeNumber: number;
  par: number;
  /** Scorecard yardage for the hole (tee→green centroid). */
  distanceYd: number;
  tee: LatLng | null;
  green: LatLng | null;
  greenFront: LatLng | null;
  greenBack: LatLng | null;
  /** Container size — typically full screen minus header. */
  width: number;
  height: number;
  /** Optional: persist Y / P moves up to a caller-managed store. */
  onLayupMoved?: (positionFrac: { x: number; y: number }) => void;
  onPinMoved?: (positionFrac: { x: number; y: number }) => void;
  /** 2026-05-24 — Per-hole screenshot override URI. When set, used as
   *  the image source instead of holeImageMapper's chain (Mapbox /
   *  bundled / Google). Marker calibration overlays still render on
   *  top so existing tee/pin drag persistence keeps working. Sourced
   *  by callers from CourseHole.backgroundImageUri. */
  imageOverrideUri?: string;
}

// Calibration constants tuned against the bundled Palms-aspect screenshots.
// 0.87 = tee box bottom edge, 0.10 = green centroid top. Keeping these
// here (not the legacy hole-view file) so the new surface owns its own
// calibration without touching the older one.
const TEE_INIT_FRAC = 0.87;
const PIN_INIT_FRAC = 0.10;
const MARKER_SIZE = 44;
const MARKER_HALF = MARKER_SIZE / 2;

export default function GolfshotHoleView({
  courseId, courseName, holeNumber, par, distanceYd,
  tee, green, greenFront, greenBack,
  width, height,
  onLayupMoved, onPinMoved,
  imageOverrideUri,
}: GolfshotHoleViewProps) {
  // ─── Image resolution ──────────────────────────────────────────────
  // 2026-05-24 — If caller provided an override URI (CourseHole.
  // backgroundImageUri), use it directly. Skip holeImageMapper's
  // resolution chain. Caller has decided this screenshot is better
  // than whatever Mapbox / bundled would produce for this hole.
  const resolution: HoleImageResolution = useMemo(
    () => {
      if (imageOverrideUri) {
        return {
          source: { uri: imageOverrideUri },
          url: imageOverrideUri,
          source_type: 'local_by_id',
          confidence: 100,
        };
      }
      return resolveHoleImage({
        courseId, courseName, holeNumber,
        par, yardage: distanceYd, tee, green,
        width, height,
      });
    },
    [imageOverrideUri, courseId, courseName, holeNumber, par, distanceYd, tee, green, width, height],
  );
  const imageSource: ImageSourcePropType | null = resolution.source;

  // ─── Marker positions (pixels relative to the image rect) ─────────
  // P (pin) defaults to PIN_INIT_FRAC of height, centered horizontally.
  // Y (layup) defaults to TEE_INIT_FRAC of height — the tee box. Player
  // drags Y to where their ball / layup target is.
  const [pinPos, setPinPos] = useState<{ x: number; y: number }>(() => ({
    x: width / 2,
    y: height * PIN_INIT_FRAC,
  }));
  const [yPos, setYPos] = useState<{ x: number; y: number }>(() => ({
    x: width / 2,
    y: height * TEE_INIT_FRAC,
  }));

  // Reset markers on hole change (also acts as the hole-reconciliation
  // refresh — when reconcileHole flips currentHole upstream, hole-view
  // re-renders us with the new holeNumber and markers snap back).
  useEffect(() => {
    setPinPos({ x: width / 2, y: height * PIN_INIT_FRAC });
    setYPos({ x: width / 2, y: height * TEE_INIT_FRAC });
  }, [holeNumber, courseId, width, height]);

  // ─── Yards / pixel calibration ─────────────────────────────────────
  // The screenshots span `distanceYd` over (TEE_INIT_FRAC - PIN_INIT_FRAC)
  // of the image height. Same calc the legacy hole-view used.
  const yardsPerPixel = useMemo(() => {
    const span = height * (TEE_INIT_FRAC - PIN_INIT_FRAC);
    return distanceYd / Math.max(1, span);
  }, [distanceYd, height]);

  // Green-depth offsets from courseGeometry. front-offset = centroid →
  // green_front (player-side); back-offset = centroid → green_back.
  // Both signed positive (we apply them as -front / +back from pin).
  const { frontOffsetYd, backOffsetYd } = useMemo(() => {
    if (!green) return { frontOffsetYd: 0, backOffsetYd: 0 };
    return {
      frontOffsetYd: greenFront ? haversineYards(green, greenFront) : 0,
      backOffsetYd: greenBack ? haversineYards(green, greenBack) : 0,
    };
  }, [green, greenFront, greenBack]);

  // ─── Distance derivations ──────────────────────────────────────────
  const yToPinYd = useMemo(() => {
    const dy = yPos.y - pinPos.y; // px (positive: Y is below pin = nearer tee side)
    const dx = yPos.x - pinPos.x;
    const px = Math.sqrt(dx * dx + dy * dy);
    return Math.round(px * yardsPerPixel);
  }, [yPos, pinPos, yardsPerPixel]);

  const frontYd = Math.max(0, yToPinYd - Math.round(frontOffsetYd));
  const middleYd = yToPinYd;
  const backYd = yToPinYd + Math.round(backOffsetYd);

  // ─── PanResponders ─────────────────────────────────────────────────
  const pinPosRef = useRef(pinPos);
  const yPosRef = useRef(yPos);
  pinPosRef.current = pinPos;
  yPosRef.current = yPos;
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  function clampToFrame(x: number, y: number): { x: number; y: number } {
    return {
      x: Math.max(MARKER_HALF, Math.min(width - MARKER_HALF, x)),
      y: Math.max(MARKER_HALF, Math.min(height - MARKER_HALF, y)),
    };
  }

  const pinPan = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { dragStartRef.current = { ...pinPosRef.current }; },
      onPanResponderMove: (_e, g) => {
        const start = dragStartRef.current;
        if (!start) return;
        setPinPos(clampToFrame(start.x + g.dx, start.y + g.dy));
      },
      onPanResponderRelease: () => {
        dragStartRef.current = null;
        if (onPinMoved) onPinMoved({ x: pinPosRef.current.x / width, y: pinPosRef.current.y / height });
      },
    }),
    // clampToFrame closes over width/height; recreate on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, onPinMoved],
  );

  const yPan = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { dragStartRef.current = { ...yPosRef.current }; },
      onPanResponderMove: (_e, g) => {
        const start = dragStartRef.current;
        if (!start) return;
        setYPos(clampToFrame(start.x + g.dx, start.y + g.dy));
      },
      onPanResponderRelease: () => {
        dragStartRef.current = null;
        if (onLayupMoved) onLayupMoved({ x: yPosRef.current.x / width, y: yPosRef.current.y / height });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, onLayupMoved],
  );

  // ─── Green overlay sizing ─────────────────────────────────────────
  // Approximate green radius from front+back offsets — gives a visually
  // sized disk that follows the hole's actual green depth. Defaults to a
  // gentle 14y radius when geometry missing (matches VectorHoleView's
  // GREEN_RADIUS_YARDS constant).
  const greenRadiusYd = Math.max(8, (frontOffsetYd + backOffsetYd) / 2 || 14);
  const greenRadiusPx = greenRadiusYd / yardsPerPixel;

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <View style={[styles.frame, { width, height }]}>
      {imageSource ? (
        <Image source={imageSource} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noImage]}>
          <Text style={styles.noImageText}>No imagery for hole {holeNumber}</Text>
          <Text style={styles.noImageHint}>Drag Y and P to set your own targets.</Text>
        </View>
      )}

      {/* 2026-05-26 — Fix BL: SmartPlay live-wind badge. Two birds one
          stone: covers the noisy 18Birdies floating bubbles cluster
          (top-center) AND surfaces actual live wind data the player
          can use for shot choice. Renders only when round is active +
          weather available; gracefully shrinks to nothing otherwise. */}
      {imageSource ? (
        <WindageBadge containerWidth={width} containerHeight={height} />
      ) : null}

      {/* Green disk overlay + distance line + labels (one SVG layer). */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Semi-transparent green shape */}
        <Circle
          cx={pinPos.x}
          cy={pinPos.y}
          r={greenRadiusPx}
          fill="rgba(94, 234, 130, 0.30)"
          stroke="rgba(94, 234, 130, 0.85)"
          strokeWidth={1.5}
        />
        {/* Y → P line */}
        <Line
          x1={yPos.x} y1={yPos.y}
          x2={pinPos.x} y2={pinPos.y}
          stroke="#facc15"
          strokeWidth={2}
          strokeDasharray="6,4"
        />
        {/* Mid-line distance label (Carry to pin) */}
        {/* Two-pass text — stroke pass for outline, fill pass on top.
            react-native-svg's Text doesn't expose paintOrder, so we
            emulate it. */}
        <SvgText
          x={(yPos.x + pinPos.x) / 2 + 8}
          y={(yPos.y + pinPos.y) / 2 - 4}
          fill="none"
          stroke="rgba(0,0,0,0.7)"
          strokeWidth={3}
          fontSize={13}
          fontWeight="800"
        >
          {yToPinYd}y
        </SvgText>
        <SvgText
          x={(yPos.x + pinPos.x) / 2 + 8}
          y={(yPos.y + pinPos.y) / 2 - 4}
          fill="#fde68a"
          fontSize={13}
          fontWeight="800"
        >
          {yToPinYd}y
        </SvgText>
      </Svg>

      {/* Draggable P marker (red — pin). */}
      <View
        {...pinPan.panHandlers}
        style={[
          styles.marker, styles.pinMarker,
          { left: pinPos.x - MARKER_HALF, top: pinPos.y - MARKER_HALF },
        ]}
      >
        <Text style={styles.markerText}>P</Text>
      </View>

      {/* Draggable Y marker (yellow — layup). */}
      <View
        {...yPan.panHandlers}
        style={[
          styles.marker, styles.yMarker,
          { left: yPos.x - MARKER_HALF, top: yPos.y - MARKER_HALF },
        ]}
      >
        <Text style={styles.markerText}>Y</Text>
      </View>

      {/* Top header bar. */}
      <View style={styles.headerBar}>
        <Text style={styles.headerText}>
          HOLE {holeNumber} <Text style={styles.headerSeparator}>·</Text> PAR {par} <Text style={styles.headerSeparator}>·</Text> {distanceYd}y
        </Text>
      </View>

      {/* Instruction banner directly under the header. */}
      <View style={styles.instructionBanner}>
        <Text style={styles.instructionText}>
          Drag Y to layup · Drag P to set pin
        </Text>
      </View>

      {/* Bottom F/M/B bar. */}
      <View style={styles.fmbBar}>
        <FmbCell label="FRONT" value={frontYd} hasData={green != null} />
        <View style={styles.fmbDivider} />
        <FmbCell label="MIDDLE" value={middleYd} hasData={green != null} accent />
        <View style={styles.fmbDivider} />
        <FmbCell label="BACK" value={backYd} hasData={green != null} />
      </View>
    </View>
  );
}

function FmbCell({
  label, value, hasData, accent,
}: {
  label: string;
  value: number;
  hasData: boolean;
  accent?: boolean;
}) {
  return (
    <View style={styles.fmbCell}>
      <Text style={[styles.fmbValue, accent && styles.fmbValueAccent]}>
        {hasData ? `${value}` : '—'}
      </Text>
      <Text style={styles.fmbLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: '#0a1410',
    overflow: 'hidden',
  },
  noImage: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a2e22',
  },
  noImageText: {
    color: '#86efac',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  noImageHint: {
    color: '#65a684',
    fontSize: 12,
    marginTop: 6,
  },
  marker: {
    position: 'absolute',
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.55)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
    elevation: 4,
  },
  pinMarker: { backgroundColor: '#ef4444' },
  yMarker: { backgroundColor: '#facc15' },
  markerText: {
    color: '#0a1410',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  headerBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
  },
  headerText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  headerSeparator: {
    color: '#9ca3af',
    fontWeight: '600',
  },
  instructionBanner: {
    position: 'absolute',
    top: 56,
    left: 12,
    right: 12,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
  },
  instructionText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  fmbBar: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  fmbCell: {
    flex: 1,
    alignItems: 'center',
  },
  fmbDivider: {
    width: 1,
    marginVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  fmbValue: {
    color: '#e5e7eb',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  fmbValueAccent: {
    color: '#fef3c7',
  },
  fmbLabel: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 2,
  },
});
