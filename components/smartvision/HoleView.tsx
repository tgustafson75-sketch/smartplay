/**
 * Phase S — SmartVision generalized hole view.
 *
 * Mapbox Static Images base + SVG strategic overlay. Course-agnostic.
 * Tap-to-target sets a marker; hazard/annotation taps expand detail.
 *
 * Rendering pipeline:
 *   1. mapboxImagery.fetchHoleImagery returns a tile URL (cached after
 *      first fetch). If Mapbox isn't configured, falls back to the
 *      legacy Google Maps URL passed via fallbackUrl prop.
 *   2. Image renders as the substrate.
 *   3. SVG overlay paints geometry (tee/green/hazards), distance rings,
 *      strategic annotations, recent shot trace, target marker.
 *   4. TouchableWithoutFeedback over the image converts taps to lat/lng
 *      via inverse Web Mercator projection.
 *
 * The overlay layers compute via services/smartVisionOverlay.ts. Pure
 * functions take geometry + player data → render data; this component
 * paints them via react-native-svg.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Image, Text, TouchableWithoutFeedback, TouchableOpacity,
  StyleSheet, Modal, Pressable, ActivityIndicator, PanResponder,
} from 'react-native';
import Svg, { Circle, Line, Text as SvgText, Polygon } from 'react-native-svg';
import {
  fetchHoleImagery, isMapboxConfigured,
} from '../../services/mapboxImagery';
import {
  projectToTilePixels,
  computeYardageRings, computeDangerCarries, computeLandingZone, computeLayupSuggestion,
  distanceToTarget,
  type LatLng, type StrategicAnnotation,
} from '../../services/smartVisionOverlay';
import type { HoleGeometry } from '../../services/courseGeometryService';

const ZOOM_FOR_HOLE = (yardage: number, par: number): number => {
  if (par === 3 || yardage < 180) return 18;
  if (yardage < 400) return 17;
  return 16;
};

function bearingDegrees(a: LatLng, b: LatLng): number {
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export type HoleViewProps = {
  geometry: HoleGeometry;
  /** Player's current GPS, if available. */
  userPosition: LatLng | null;
  /** Player's typical driver carry (Phase B accumulated). Drives danger / landing zone calc. */
  playerDriverYards?: number | null;
  /** Recent shots on this hole, for the connect-the-dots trace. */
  recentShotPositions?: LatLng[];
  /** Pixel size of the rendered tile (and SVG overlay canvas). */
  width: number;
  height: number;
  /** Fallback URL — used when Mapbox isn't configured. */
  fallbackUrl?: string | null;
  /** Called when user taps the imagery — receives lat/lng of tap point. */
  onTargetTap?: (latlng: LatLng, distanceFromUser: number) => void;
  /**
   * 2026-05-17 — When provided, the TEE marker becomes draggable.
   * Long-press the marker to grab it, drag to where the tee box is on
   * the satellite image, release to save. Parent persists the new
   * location to courseGeometryOverrideStore.anchorTee so it survives
   * the round and propagates to yardage calcs.
   */
  onTeeAnchor?: (latlng: LatLng) => void;
  /** Same as onTeeAnchor, but for the green marker. */
  onGreenAnchor?: (latlng: LatLng) => void;
};

export default function HoleView({
  geometry, userPosition, playerDriverYards = null,
  recentShotPositions = [], width, height,
  fallbackUrl = null, onTargetTap,
  onTeeAnchor, onGreenAnchor,
}: HoleViewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [target, setTarget] = useState<LatLng | null>(null);
  const [annotation, setAnnotation] = useState<StrategicAnnotation | null>(null);
  // 2026-05-17 — Drag state for tee/green markers. Pixel offset from the
  // marker's projected position, used to render the ghost during a drag.
  // Refs hold the live drag delta so PanResponder callbacks can read it
  // without re-binding on every render.
  const [teeDrag, setTeeDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [greenDrag, setGreenDrag] = useState<{ dx: number; dy: number } | null>(null);
  const teeDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const greenDragRef = useRef<{ dx: number; dy: number } | null>(null);

  // Compute tile rendering parameters once per geometry change
  const { center, bearing, zoom } = useMemo(() => {
    const z = ZOOM_FOR_HOLE(geometry.yardage, geometry.par);
    if (geometry.tee && geometry.green) {
      return {
        center: {
          lat: geometry.tee.lat + (geometry.green.lat - geometry.tee.lat) * 0.55,
          lng: geometry.tee.lng + (geometry.green.lng - geometry.tee.lng) * 0.55,
        },
        bearing: bearingDegrees(geometry.tee, geometry.green),
        zoom: z,
      };
    }
    return {
      center: geometry.green ?? geometry.tee ?? { lat: 0, lng: 0 },
      bearing: 0,
      zoom: z,
    };
  }, [geometry.tee, geometry.green, geometry.yardage, geometry.par]);

  // Fetch + cache the imagery
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = await fetchHoleImagery({
        courseId: null,
        holeNumber: geometry.hole_number,
        par: geometry.par,
        yardage: geometry.yardage,
        tee: geometry.tee,
        green: geometry.green,
      }, { width, height, zoom });
      if (cancelled) return;
      setImageUrl(url ?? fallbackUrl);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry.hole_number, geometry.tee, geometry.green, width, height, zoom, fallbackUrl]);

  // Pre-compute overlay layer data
  const yardageRings = useMemo(
    () => computeYardageRings(geometry.yardage),
    [geometry.yardage],
  );
  const dangerCarries = useMemo(
    () => computeDangerCarries(geometry, playerDriverYards),
    [geometry, playerDriverYards],
  );
  const landingZone = useMemo(
    () => computeLandingZone(geometry, playerDriverYards),
    [geometry, playerDriverYards],
  );
  const layupSuggestion = useMemo(
    () => computeLayupSuggestion(geometry, dangerCarries),
    [geometry, dangerCarries],
  );

  // Project a lat/lng onto pixel coordinates of this tile
  const project = (p: LatLng) =>
    projectToTilePixels(p, center, zoom, bearing, width, height);

  // 2026-05-17 — Draggable tee/green marker handlers. Active only when
  // the parent supplies onTeeAnchor / onGreenAnchor. Each PanResponder
  // tracks the touch delta; on release we unproject the final pixel
  // position to lat/lng and pass it up. We `useMemo` so the responder
  // closures see fresh center/zoom/bearing after geometry changes.
  const teeProjected = geometry.tee ? project(geometry.tee) : null;
  const greenProjected = geometry.green ? project(geometry.green) : null;

  const teePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => onTeeAnchor != null,
    onMoveShouldSetPanResponder: () => onTeeAnchor != null,
    onPanResponderGrant: () => {
      teeDragRef.current = { dx: 0, dy: 0 };
      setTeeDrag({ dx: 0, dy: 0 });
    },
    onPanResponderMove: (_e, g) => {
      teeDragRef.current = { dx: g.dx, dy: g.dy };
      setTeeDrag({ dx: g.dx, dy: g.dy });
    },
    onPanResponderRelease: () => {
      const d = teeDragRef.current;
      teeDragRef.current = null;
      setTeeDrag(null);
      if (!d || !teeProjected || !onTeeAnchor) return;
      if (Math.abs(d.dx) < 4 && Math.abs(d.dy) < 4) return; // ignore taps
      const newLatLng = unprojectPixel(
        teeProjected.x + d.dx,
        teeProjected.y + d.dy,
        center, zoom, bearing, width, height,
      );
      onTeeAnchor(newLatLng);
    },
    onPanResponderTerminate: () => {
      teeDragRef.current = null;
      setTeeDrag(null);
    },
  }), [onTeeAnchor, teeProjected?.x, teeProjected?.y, center, zoom, bearing, width, height]);

  const greenPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => onGreenAnchor != null,
    onMoveShouldSetPanResponder: () => onGreenAnchor != null,
    onPanResponderGrant: () => {
      greenDragRef.current = { dx: 0, dy: 0 };
      setGreenDrag({ dx: 0, dy: 0 });
    },
    onPanResponderMove: (_e, g) => {
      greenDragRef.current = { dx: g.dx, dy: g.dy };
      setGreenDrag({ dx: g.dx, dy: g.dy });
    },
    onPanResponderRelease: () => {
      const d = greenDragRef.current;
      greenDragRef.current = null;
      setGreenDrag(null);
      if (!d || !greenProjected || !onGreenAnchor) return;
      if (Math.abs(d.dx) < 4 && Math.abs(d.dy) < 4) return;
      const newLatLng = unprojectPixel(
        greenProjected.x + d.dx,
        greenProjected.y + d.dy,
        center, zoom, bearing, width, height,
      );
      onGreenAnchor(newLatLng);
    },
    onPanResponderTerminate: () => {
      greenDragRef.current = null;
      setGreenDrag(null);
    },
  }), [onGreenAnchor, greenProjected?.x, greenProjected?.y, center, zoom, bearing, width, height]);

  // Tap handler: map screen pixels back to lat/lng (inverse projection)
  const onPress = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const px = e.nativeEvent.locationX;
    const py = e.nativeEvent.locationY;
    const tapLatLng = unprojectPixel(px, py, center, zoom, bearing, width, height);
    setTarget(tapLatLng);
    if (onTargetTap) {
      onTargetTap(tapLatLng, distanceToTarget(userPosition, tapLatLng));
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────

  if (!imageUrl) {
    return (
      <View style={[styles.placeholder, { width, height }]}>
        <ActivityIndicator color="#00C896" />
        <Text style={styles.placeholderText}>
          {isMapboxConfigured() ? 'Loading hole imagery…' : 'Imagery not configured.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ width, height }}>
      <TouchableWithoutFeedback onPress={onPress}>
        <Image source={{ uri: imageUrl }} style={{ width, height }} resizeMode="cover" />
      </TouchableWithoutFeedback>

      {/* Overlay layers — pointerEvents="none" so taps pass through to imagery */}
      <Svg
        width={width} height={height}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      >
        {/* Layer 1 — hole geometry */}
        {geometry.tee && (() => {
          const p = project(geometry.tee);
          return (
            <>
              <Circle cx={p.x} cy={p.y} r={6} fill="#00C896" stroke="#fff" strokeWidth={1.5} />
              <SvgText x={p.x + 10} y={p.y + 4} fill="#fff" fontSize={11} fontWeight="700">TEE</SvgText>
            </>
          );
        })()}
        {geometry.green && (() => {
          const p = project(geometry.green);
          return (
            <>
              <Circle cx={p.x} cy={p.y} r={9} fill="rgba(0,200,150,0.4)" stroke="#00C896" strokeWidth={2} />
              <SvgText x={p.x + 12} y={p.y + 4} fill="#fff" fontSize={11} fontWeight="700">GRN</SvgText>
            </>
          );
        })()}
        {geometry.green_outline.length > 0 && (
          <Polygon
            points={geometry.green_outline.map(g => { const p = project(g); return `${p.x},${p.y}`; }).join(' ')}
            stroke="#00C896" strokeWidth={1.5} fill="rgba(0,200,150,0.15)"
          />
        )}
        {/* Tee → green centerline */}
        {geometry.tee && geometry.green && (() => {
          const t = project(geometry.tee);
          const g = project(geometry.green);
          return <Line x1={t.x} y1={t.y} x2={g.x} y2={g.y} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="6,4" />;
        })()}

        {/* Layer 2 — yardage rings from user position (or tee fallback) */}
        {(userPosition ?? geometry.tee) && yardageRings.map(ring => {
          const p = project(userPosition ?? geometry.tee!);
          // 1 yard = 0.9144 m; convert to pixel radius via metersPerPixel
          const metersPerPixel = (156543.03392 * Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom);
          const r = (ring.distance_yards * 0.9144) / metersPerPixel;
          return (
            <React.Fragment key={ring.distance_yards}>
              <Circle cx={p.x} cy={p.y} r={r} stroke="rgba(96,165,250,0.5)" strokeWidth={1} fill="none" strokeDasharray="3,3" />
              <SvgText x={p.x + r - 4} y={p.y - 2} fill="rgba(96,165,250,0.9)" fontSize={9} fontWeight="600">{ring.label}</SvgText>
            </React.Fragment>
          );
        })}

        {/* Layer 3 — recent shots trace */}
        {recentShotPositions.length > 0 && (
          <>
            {recentShotPositions.slice(0, -1).map((shot, i) => {
              const a = project(shot);
              const b = project(recentShotPositions[i + 1]);
              return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#F5A623" strokeWidth={2} />;
            })}
            {recentShotPositions.map((shot, i) => {
              const p = project(shot);
              return <Circle key={i} cx={p.x} cy={p.y} r={4} fill="#F5A623" stroke="#fff" strokeWidth={1} />;
            })}
          </>
        )}

        {/* Layer 4 — user-tapped target */}
        {target && (() => {
          const p = project(target);
          const userP = userPosition ? project(userPosition) : null;
          const dist = distanceToTarget(userPosition, target);
          return (
            <>
              {userP && <Line x1={userP.x} y1={userP.y} x2={p.x} y2={p.y} stroke="#fbbf24" strokeWidth={2} strokeDasharray="6,4" />}
              <Circle cx={p.x} cy={p.y} r={8} fill="rgba(251,191,36,0.4)" stroke="#fbbf24" strokeWidth={2} />
              <SvgText x={p.x + 12} y={p.y + 4} fill="#fbbf24" fontSize={12} fontWeight="800">{dist}y</SvgText>
            </>
          );
        })()}

        {/* Layer 5 — Kevin annotations (landing zone, lay-up) */}
        {[landingZone, layupSuggestion].filter((a): a is StrategicAnnotation => a != null).map(a => {
          const p = project(a.position);
          const color = a.kind === 'landing_zone' ? '#34d399' : '#fbbf24';
          return (
            <React.Fragment key={a.id}>
              <Circle cx={p.x} cy={p.y} r={11} fill={`${color}33`} stroke={color} strokeWidth={1.5} />
              <SvgText x={p.x} y={p.y + 4} textAnchor="middle" fill={color} fontSize={10} fontWeight="800">{a.label}</SvgText>
            </React.Fragment>
          );
        })}
      </Svg>

      {/* Annotation tap targets — separate touch layer above SVG since SVG pointerEvents=none */}
      {[landingZone, layupSuggestion].filter((a): a is StrategicAnnotation => a != null).map(a => {
        const p = project(a.position);
        return (
          <TouchableOpacity
            key={'tap-' + a.id}
            style={[styles.annotationTap, { left: p.x - 14, top: p.y - 14 }]}
            onPress={() => setAnnotation(a)}
          />
        );
      })}

      {/* 2026-05-17 — Draggable tee/green markers. Rendered as transparent
          touch targets sized larger than the SVG dot underneath so they
          catch fat-finger taps. While dragging, a green ghost ring
          follows the finger to show the proposed new location. */}
      {onTeeAnchor && teeProjected && (
        <View
          {...teePanResponder.panHandlers}
          style={[
            styles.dragHandle,
            { left: teeProjected.x - 22, top: teeProjected.y - 22 },
            teeDrag != null && styles.dragHandleActive,
          ]}
        >
          {teeDrag != null && (
            <View style={[
              styles.dragGhost,
              { left: 22 + teeDrag.dx - 16, top: 22 + teeDrag.dy - 16 },
            ]}>
              <Text style={styles.dragGhostLabel}>TEE</Text>
            </View>
          )}
        </View>
      )}
      {onGreenAnchor && greenProjected && (
        <View
          {...greenPanResponder.panHandlers}
          style={[
            styles.dragHandle,
            { left: greenProjected.x - 22, top: greenProjected.y - 22 },
            greenDrag != null && styles.dragHandleActive,
          ]}
        >
          {greenDrag != null && (
            <View style={[
              styles.dragGhost,
              { left: 22 + greenDrag.dx - 16, top: 22 + greenDrag.dy - 16 },
            ]}>
              <Text style={styles.dragGhostLabel}>GRN</Text>
            </View>
          )}
        </View>
      )}

      {/* Annotation detail modal */}
      <Modal visible={annotation != null} transparent animationType="fade" onRequestClose={() => setAnnotation(null)}>
        <Pressable style={styles.modalBg} onPress={() => setAnnotation(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>
              {annotation?.kind === 'landing_zone' ? 'Target Landing Zone' :
                annotation?.kind === 'layup_suggestion' ? 'Lay-up Suggestion' :
                annotation?.kind === 'danger_zone' ? 'Danger Zone' : 'Carry Target'}
            </Text>
            <Text style={styles.modalBody}>{annotation?.detail}</Text>
            <TouchableOpacity onPress={() => setAnnotation(null)} style={styles.modalBtn}>
              <Text style={styles.modalBtnText}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Danger carries hint strip — always visible at bottom edge */}
      {dangerCarries.length > 0 && (
        <View style={styles.dangerStrip}>
          {dangerCarries.slice(0, 3).map((c, i) => (
            <Text key={i} style={[styles.dangerChip, !c.in_range && { opacity: 0.5 }]}>
              {c.hazard_label}: {c.distance_yards}y{c.in_range ? '  ⚠️' : ''}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

// Inverse projection — pixel → lat/lng. Needed for tap-to-target.
function unprojectPixel(
  px: number, py: number,
  center: LatLng, zoom: number, bearingDeg: number,
  imgWidth: number, imgHeight: number,
): LatLng {
  const metersPerPixel = (156543.03392 * Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom);
  const dx_px = px - imgWidth / 2;
  const dy_px = py - imgHeight / 2;

  // Reverse the bearing rotation
  const θ = bearingDeg * Math.PI / 180;
  const cosθ = Math.cos(θ);
  const sinθ = Math.sin(θ);
  const x_unrot = dx_px * cosθ - dy_px * sinθ;
  const y_unrot = dx_px * sinθ + dy_px * cosθ;

  const dx_m = x_unrot * metersPerPixel;
  const dy_m = -y_unrot * metersPerPixel;

  const R = 6371000;
  const dLat = dy_m / R * (180 / Math.PI);
  const dLng = dx_m / (R * Math.cos(center.lat * Math.PI / 180)) * (180 / Math.PI);

  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#0d1a0d',
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 12,
  },
  placeholderText: {
    color: '#9ca3af', fontSize: 13, marginTop: 12,
    textAlign: 'center', paddingHorizontal: 24,
  },
  annotationTap: {
    position: 'absolute', width: 28, height: 28, borderRadius: 14,
  },
  dragHandle: {
    position: 'absolute', width: 44, height: 44, borderRadius: 22,
  },
  dragHandleActive: {
    backgroundColor: 'rgba(0,200,150,0.15)',
    borderWidth: 1, borderColor: '#00C896', borderStyle: 'dashed',
  },
  dragGhost: {
    position: 'absolute', width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(0,200,150,0.45)',
    borderWidth: 2, borderColor: '#00C896',
    alignItems: 'center', justifyContent: 'center',
  },
  dragGhostLabel: {
    color: '#fff', fontSize: 9, fontWeight: '900',
  },
  modalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalCard: {
    width: '78%', maxWidth: 360, padding: 20,
    backgroundColor: '#0d1a0d', borderRadius: 14, borderWidth: 1, borderColor: '#1e3a28',
  },
  modalTitle: { color: '#00C896', fontSize: 16, fontWeight: '900', marginBottom: 10 },
  modalBody: { color: '#fff', fontSize: 14, lineHeight: 21 },
  modalBtn: { marginTop: 18, alignItems: 'center', backgroundColor: '#1e3a28', paddingVertical: 10, borderRadius: 10 },
  modalBtnText: { color: '#fff', fontWeight: '700' },
  dangerStrip: {
    position: 'absolute', bottom: 8, left: 8, right: 8,
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  dangerChip: {
    backgroundColor: 'rgba(239,68,68,0.85)',
    color: '#fff', fontSize: 11, fontWeight: '700',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
});
