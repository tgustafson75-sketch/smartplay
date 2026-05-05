/**
 * Phase AV — SmartVision (GolfShot-class hole view).
 *
 * Single-purpose screen: satellite hole tile (Mapbox, oriented tee→green
 * vertical), three draggable markers, live Front/Middle/Back yardage
 * from the yellow target.
 *
 *   T (tee)    — snaps to the tee polygon center (top of image).
 *   Y (yellow) — free-drag target. Moving Y updates F/M/B live.
 *   P (pin)    — snaps to the green center (bottom of image).
 *
 * No badge rows, no club selector, no scrolling, no side panels.
 * Back chevron + hole switcher only. Wind/Mark/etc. live on Caddie home.
 *
 * Geometry source:
 *   - Hole tee/green points come from `fetchCourseGeometry` (golfcourseapi
 *     upstream — points only today; polygons reserved for richer source).
 *   - Yardage: haversine between yellow-target lat/lng and green's
 *     front/middle/back points.
 *
 * Pixel ↔ geo projection:
 *   - Mapbox tile is bearing-rotated so the hole runs vertically with
 *     green near the top (centerLat = 55% from tee→green per
 *     mapboxImagery.ts default).
 *   - We project tee and green center to pixel coordinates relative to
 *     the image's center using Mapbox's known projection at the given
 *     zoom; everything in between is interpolated linearly along the
 *     bearing axis (sufficient for a single hole's bbox — the worst-case
 *     curvature error over ~600 yards is sub-pixel at typical zoom 16-18).
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';

import Svg, { Line as SvgLine } from 'react-native-svg';

import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { fetchCourseGeometry, getHoleGeometry, type HoleGeometry } from '../services/courseGeometryService';
import { fetchHoleImagery } from '../services/mapboxImagery';
import { getLocalHoleImage } from '../data/localCourseImages';

// ─── Geo helpers ──────────────────────────────────────────────────

function haversineYards(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.09361;
}

function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function autoZoom(yardage: number, par: number): number {
  if (par === 3 || yardage < 180) return 18;
  if (yardage < 400) return 17;
  return 16;
}

// Mapbox Web Mercator: meters per pixel at the equator at zoom z is
// 156543.03 / 2^z. Adjusted for latitude by multiplying by cos(lat).
function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
}

/**
 * Project a lat/lng point to pixel offset (dx, dy) from the image center,
 * accounting for the image's bearing rotation. Coordinate convention:
 * after rotation, +Y is "up the hole toward the green" (Mapbox renders
 * bearing such that the bearing direction points UP in the image).
 *
 * The Mapbox Static Images bearing parameter rotates the camera, not the
 * map underneath, so the bearing axis (tee→green) ends up pointing
 * vertically up in the rendered tile.
 */
function _projectToPixels(
  point: { lat: number; lng: number },
  center: { lat: number; lng: number },
  zoom: number,
  bearing: number,
): { x: number; y: number } {
  const mpp = metersPerPixel(center.lat, zoom);
  // World offsets in meters (north +, east +)
  const dEast =
    (point.lng - center.lng) *
    111320 *
    Math.cos(center.lat * Math.PI / 180);
  const dNorth = (point.lat - center.lat) * 110540;
  // Convert to pixels (east = +x in unrotated map; north = +y in unrotated map)
  const px = dEast / mpp;
  const py = dNorth / mpp;
  // Apply rotation: when bearing is θ° clockwise from north, points along
  // that bearing land along +y (up) in the rendered image. Rotate (px, py)
  // by −θ to get the on-screen coords (with +y still meaning up the hole).
  const θ = (bearing * Math.PI) / 180;
  const cosθ = Math.cos(θ);
  const sinθ = Math.sin(θ);
  // Rotation: image-x = px·cosθ − py·sinθ, image-y = px·sinθ + py·cosθ
  const ix = px * cosθ - py * sinθ;
  const iy = px * sinθ + py * cosθ;
  return { x: ix, y: iy };
}

/**
 * Inverse of projectToPixels: given a screen pixel offset from image
 * center (with +y meaning up the hole), return the lat/lng that pixel
 * maps to in geo space. Used when the user drags the yellow target.
 */
function pixelsToLatLng(
  pixel: { x: number; y: number },
  center: { lat: number; lng: number },
  zoom: number,
  bearing: number,
): { lat: number; lng: number } {
  const mpp = metersPerPixel(center.lat, zoom);
  const θ = (bearing * Math.PI) / 180;
  const cosθ = Math.cos(θ);
  const sinθ = Math.sin(θ);
  // Inverse rotation: image-coords back to map-coords
  const px = pixel.x * cosθ + pixel.y * sinθ;
  const py = -pixel.x * sinθ + pixel.y * cosθ;
  const dEast = px * mpp;
  const dNorth = py * mpp;
  const lat = center.lat + dNorth / 110540;
  const lng = center.lng + dEast / (111320 * Math.cos(center.lat * Math.PI / 180));
  return { lat, lng };
}

// ─── Marker component ────────────────────────────────────────────

type MarkerKind = 'T' | 'Y' | 'P';

const MARKER_STYLE: Record<MarkerKind, { bg: string; ring: string; text: string; size: number }> = {
  T: { bg: '#3b82f6', ring: '#1e40af', text: '#ffffff', size: 36 }, // blue tee
  Y: { bg: '#facc15', ring: '#a16207', text: '#1f2937', size: 40 }, // yellow target
  P: { bg: '#ef4444', ring: '#7f1d1d', text: '#ffffff', size: 36 }, // red pin
};

function Marker({ kind, x, y, draggable, onDrag, onDragEnd }: {
  kind: MarkerKind;
  x: number;
  y: number;
  draggable: boolean;
  /** Receives absolute translation since gesture start (translationX/Y). */
  onDrag?: (translationX: number, translationY: number) => void;
  onDragEnd?: () => void;
}) {
  const s = MARKER_STYLE[kind];

  // Using react-native-gesture-handler's Pan gesture (not PanResponder).
  // GH runs on the native side so it competes correctly with siblings
  // on Android (SVG, Image) and reliably wins for touches inside this
  // marker's bounds. runOnJS wraps the JS callbacks so we don't need
  // Reanimated worklets.
  const gesture = useMemo(() => {
    return Gesture.Pan()
      .runOnJS(true)
      .onUpdate((e) => {
        if (onDrag) onDrag(e.translationX, e.translationY);
      })
      .onEnd(() => {
        if (onDragEnd) onDragEnd();
      });
  }, [onDrag, onDragEnd]);

  const inner = (
    <View
      style={[
        styles.marker,
        {
          left: x - s.size / 2,
          top: y - s.size / 2,
          width: s.size,
          height: s.size,
          borderRadius: s.size / 2,
          backgroundColor: s.bg,
          borderColor: s.ring,
          zIndex: draggable ? 30 : 20,
          elevation: draggable ? 12 : 8,
        },
      ]}
      hitSlop={{ top: 24, bottom: 24, left: 24, right: 24 }}
    >
      <Text style={[styles.markerText, { color: s.text, fontSize: s.size * 0.42 }]}>{kind}</Text>
    </View>
  );

  if (!draggable) return inner;
  return <GestureDetector gesture={gesture}>{inner}</GestureDetector>;
}

// ─── Screen ──────────────────────────────────────────────────────

export default function SmartVisionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();

  const courseId = useRoundStore(s => s.activeCourseId);
  const courseName = useRoundStore(s => s.activeCourse);
  const courseHoles = useRoundStore(s => s.courseHoles);
  const currentHole = useRoundStore(s => s.currentHole);
  const totalHoles = courseHoles.length || 18;
  const addOrUpdatePlan = useRoundStore(s => s.addOrUpdatePlan);
  const existingPlan = useRoundStore(s => s.plans.find(p => p.hole_number === currentHole));
  const [savedFlash, setSavedFlash] = useState(false);

  const imageryMode = useSettingsStore(s => s.smartVisionImagery);
  const setImageryMode = useSettingsStore(s => s.setSmartVisionImagery);

  // Phase BG — subscribe to position-mark bus so a Mark event triggers
  // re-render. Used to invalidate cached imagery and recompute marker
  // positions if/when this screen later supports live GPS overlays.
  // Currently SmartVision uses fetched geometry only (no GPS overlay),
  // but the subscription is in place so adding a "you-are-here" dot
  // only requires reading getLastFix() in the render.
  const [markBumpTick, setMarkBumpTick] = useState(0);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    void (async () => {
      try {
        const bus = await import('../services/positionMarkBus');
        unsub = bus.subscribeToMark(() => setMarkBumpTick(t => t + 1));
      } catch (e) { console.log('[smartvision] mark sub failed', e); }
    })();
    return () => { if (unsub) unsub(); };
  }, []);
  void markBumpTick; // referenced so React re-renders on tick

  // Local hole index — independent of currentHole so the screen acts as
  // a viewer across the whole course without forcing the round to follow.
  const [holeIndex, setHoleIndex] = useState<number>(currentHole || 1);

  // Image area: leaves room for back chevron + hole switcher at top, F/M/B
  // yardage panel at bottom. Square-ish on phones, full-height on tablets.
  const TOP_BAR_H = 56;
  const BOTTOM_PANEL_H = 96;
  const imageW = W;
  const imageH = H - insets.top - insets.bottom - TOP_BAR_H - BOTTOM_PANEL_H;

  const [geometry, setGeometry] = useState<HoleGeometry | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Curated bundled image (Palms hole-01.jpg etc) — used as backdrop
  // when GPS imagery is unavailable or the user has chosen 'curated'.
  const curatedImage = useMemo(() => getLocalHoleImage(courseName, holeIndex), [courseName, holeIndex]);

  // Per-hole yellow target marker offset (relative to image center, in pixels).
  // Defaults to the midpoint of the bearing axis (50% of the way from tee
  // to green) on first view of each hole; persists in component memory
  // across hole switches so the user's adjustments aren't lost.
  const [targetByHole, setTargetByHole] = useState<Record<number, { x: number; y: number }>>({});
  // Per-hole pin override — same shape, but for the red Pin marker which
  // is now draggable. Defaults to green centroid; user can drag it to
  // simulate today's pin position (front/middle/back of green).
  const [pinByHole, setPinByHole] = useState<Record<number, { x: number; y: number }>>({});

  // ── Load geometry + imagery for the current hole ────────────────
  // Imagery selection logic:
  //   imageryMode='curated' → never fetch GPS tile, always show curated
  //   imageryMode='gps'     → only show GPS tile (no curated fallback)
  //   imageryMode='auto'    → try GPS tile if geometry available, else curated
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      // Always load geometry so the F/M/B yardage panel can use it
      // even in curated mode (when geometry is available).
      let geo: HoleGeometry | null = null;
      if (courseId) {
        const cached = getHoleGeometry(courseId, holeIndex);
        geo = cached;
        if (!geo) {
          const c = await fetchCourseGeometry(courseId);
          if (cancelled) return;
          geo = c?.holes.find(h => h.hole_number === holeIndex) ?? null;
        }
      }
      if (cancelled) return;
      setGeometry(geo);

      // GPS tile only when allowed AND geometry has tee+green coords.
      if (imageryMode !== 'curated' && geo?.green && courseId) {
        const uri = await fetchHoleImagery(
          {
            courseId,
            holeNumber: holeIndex,
            par: geo.par,
            yardage: geo.yardage,
            tee: geo.tee,
            green: geo.green,
          },
          { width: imageW, height: imageH },
        );
        if (cancelled) return;
        setImageUri(uri);
      } else {
        setImageUri(null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [courseId, holeIndex, imageW, imageH, imageryMode]);

  // ── Derived projection ──────────────────────────────────────────
  const projection = useMemo(() => {
    if (!geometry?.tee || !geometry?.green) return null;
    const center = {
      lat: geometry.tee.lat + (geometry.green.lat - geometry.tee.lat) * 0.55,
      lng: geometry.tee.lng + (geometry.green.lng - geometry.tee.lng) * 0.55,
    };
    const bearing = bearingDeg(geometry.tee, geometry.green);
    const zoom = autoZoom(geometry.yardage, geometry.par);
    return { center, bearing, zoom };
  }, [geometry]);

  // Marker positions in CANVAS-LOCAL pixel coordinates (top-left origin,
  // x increases right, y increases DOWN).
  //
  // Defaults: tee at bottom-center (50% W, 85% H — typical tee position
  // on a golf hole image), pin at top-center on the green (50% W, 15% H).
  // Yellow defaults to the midpoint of the tee→pin segment.
  //
  // GPS projection from Mapbox tiles dropped — kept producing off-screen
  // and overlapping markers from rotation/aspect mismatches between the
  // rendered tile and the projection math. Static layout is reliable;
  // user drags markers wherever they want.
  const teeCanvas = useMemo(() => ({ x: imageW / 2, y: imageH * 0.85 }), [imageW, imageH]);
  const pinDefaultCanvas = useMemo(() => ({ x: imageW / 2, y: imageH * 0.15 }), [imageW, imageH]);

  // Pin override (user-dragged) — stored in canvas coords.
  const pinOverride = pinByHole[holeIndex];
  const pinCanvas = pinOverride ?? pinDefaultCanvas;

  // Pixel-relative (+y up) versions for legacy yardage interpolation.
  const teePx = useMemo(() => ({ x: teeCanvas.x - imageW / 2, y: imageH / 2 - teeCanvas.y }), [teeCanvas, imageW, imageH]);
  const pinPx = useMemo(() => ({ x: pinCanvas.x - imageW / 2, y: imageH / 2 - pinCanvas.y }), [pinCanvas, imageW, imageH]);

  // Bounds clamper used in drag handlers — keep markers visible.
  const clampToCanvas = useCallback((p: { x: number; y: number }) => ({
    x: Math.max(8, Math.min(imageW - 8, p.x)),
    y: Math.max(8, Math.min(imageH - 8, p.y)),
  }), [imageW, imageH]);

  // Make GPS-mode no-op for yardages too (always pixel interpolation).
  const usingGpsTile = false;

  // Yellow target — defaults to midpoint of tee→pin if no override set.
  // Stored in CANVAS coords (top-left origin, y down) for direct render.
  const targetOverride = targetByHole[holeIndex];
  const targetCanvas = useMemo(() => {
    if (targetOverride) return targetOverride;
    return { x: (teeCanvas.x + pinCanvas.x) / 2, y: (teeCanvas.y + pinCanvas.y) / 2 };
  }, [targetOverride, teeCanvas, pinCanvas]);
  // Pixel-relative (+y up) version for the legacy yardage interpolation.
  const targetPx = useMemo(() => ({
    x: targetCanvas.x - imageW / 2,
    y: imageH / 2 - targetCanvas.y,
  }), [targetCanvas, imageW, imageH]);

  // Convert image-relative pixel (with +y up) to absolute screen pixel
  // (toScreen helper removed — markers + line now render directly in
  // canvas-local coords, no screen-coord conversion needed.)

  // Live yardages from yellow target → green's F (front edge), MIDDLE
  // (= the user-positioned PIN), B (back edge). Tim's spec: pin moves
  // → middle yardage updates. Three modes:
  //   1) GPS geometry available → real haversine math, all 3 numbers live.
  //   2) No geometry but tee/pin pixel positions known (curated mode) →
  //      pixel-axis interpolation against bundled courseHoles distance.
  //      Y position along tee→pin axis maps proportionally to yardage.
  //   3) Neither → static bundled values.
  const yardages = useMemo(() => {
    if (usingGpsTile && targetPx && geometry && pinPx) {
      const targetGeo = pixelsToLatLng(targetPx, projection!.center, projection!.zoom, projection!.bearing);
      const pinGeo = pixelsToLatLng(pinPx, projection!.center, projection!.zoom, projection!.bearing);
      const front = geometry.green_front ? Math.round(haversineYards(targetGeo.lat, targetGeo.lng, geometry.green_front.lat, geometry.green_front.lng)) : null;
      const middle = Math.round(haversineYards(targetGeo.lat, targetGeo.lng, pinGeo.lat, pinGeo.lng));
      const back = geometry.green_back ? Math.round(haversineYards(targetGeo.lat, targetGeo.lng, geometry.green_back.lat, geometry.green_back.lng)) : null;
      return { front, middle, back };
    }
    const h = courseHoles.find(x => x.hole === holeIndex);
    if (h && targetPx && teePx && pinPx) {
      // Pixel-axis interpolation against bundled hole distance. Used
      // whenever we're on the curated image (non-GPS tile), so dragging
      // Y/P actually moves the yardage numbers.
      const totalSpan = pinPx.y - teePx.y; // image-y +up, pin > tee
      const targetSpan = targetPx.y - teePx.y;
      const progress = totalSpan === 0 ? 0.5 : Math.max(0, Math.min(1, targetSpan / totalSpan));
      const total = h.distance;
      const middleYd = Math.round((1 - progress) * total);
      const greenDepth = (h.back - h.front) / 2;
      return { front: Math.max(0, middleYd - greenDepth), middle: middleYd, back: middleYd + greenDepth };
    }
    if (h) return { front: h.front ?? null, middle: h.distance ?? null, back: h.back ?? null };
    return { front: null as number | null, middle: null as number | null, back: null as number | null };
  }, [usingGpsTile, projection, targetPx, pinPx, teePx, geometry, courseHoles, holeIndex]);

  // Carry distance — yards from tee to current yellow target. GPS path
  // uses haversine; pixel-fallback path interpolates against the bundled
  // hole distance so the carry label still updates in curated mode.
  const carryYards = useMemo(() => {
    if (usingGpsTile && targetPx && geometry?.tee) {
      const targetGeo = pixelsToLatLng(targetPx, projection!.center, projection!.zoom, projection!.bearing);
      return Math.round(haversineYards(targetGeo.lat, targetGeo.lng, geometry.tee.lat, geometry.tee.lng));
    }
    const h = courseHoles.find(x => x.hole === holeIndex);
    if (h && targetPx && teePx && pinPx) {
      const totalSpan = pinPx.y - teePx.y;
      const targetSpan = targetPx.y - teePx.y;
      const progress = totalSpan === 0 ? 0.5 : Math.max(0, Math.min(1, targetSpan / totalSpan));
      return Math.round(progress * h.distance);
    }
    return null;
  }, [usingGpsTile, projection, targetPx, teePx, pinPx, geometry, courseHoles, holeIndex]);

  // ── Drag handlers for yellow target + pin (canvas coords) ───────
  const targetDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const pinDragStartRef = useRef<{ x: number; y: number } | null>(null);

  const onTargetDrag = useCallback((dx: number, dy: number) => {
    if (!targetCanvas) return;
    if (!targetDragStartRef.current) targetDragStartRef.current = targetCanvas;
    const next = clampToCanvas({
      x: targetDragStartRef.current.x + dx,
      y: targetDragStartRef.current.y + dy,
    });
    setTargetByHole(prev => ({ ...prev, [holeIndex]: next }));
  }, [targetCanvas, holeIndex, clampToCanvas]);

  const onPinDrag = useCallback((dx: number, dy: number) => {
    if (!pinCanvas) return;
    if (!pinDragStartRef.current) pinDragStartRef.current = pinCanvas;
    const next = clampToCanvas({
      x: pinDragStartRef.current.x + dx,
      y: pinDragStartRef.current.y + dy,
    });
    setPinByHole(prev => ({ ...prev, [holeIndex]: next }));
  }, [pinCanvas, holeIndex, clampToCanvas]);

  // Reset drag refs when hole changes
  useEffect(() => {
    targetDragStartRef.current = null;
    pinDragStartRef.current = null;
  }, [holeIndex]);

  // ── Hole nav ────────────────────────────────────────────────────
  const goPrev = () => setHoleIndex(i => Math.max(1, i - 1));
  const goNext = () => setHoleIndex(i => Math.min(totalHoles || 18, i + 1));

  // ── Save current marker positions as the hole plan ──────────────
  // Persists tee/approach(=yellow)/pin marker positions + computed
  // yardages so the player's pre-round strategy survives across hole
  // navigation and app restarts. Replaces an existing plan for the
  // hole if one exists.
  const onSaveStrategy = useCallback(() => {
    if (!targetPx || !pinPx || !teePx) return;
    addOrUpdatePlan({
      hole_number: holeIndex,
      markers: {
        tee:      { x: teePx.x,    y: teePx.y,    club_intent: null, landmark_target: null },
        approach: { x: targetPx.x, y: targetPx.y, club_intent: null, landmark_target: null },
        pin:      { x: pinPx.x,    y: pinPx.y,    club_intent: null, landmark_target: null },
      },
      computed_yardages: {
        from_tee_to_approach: carryYards,
        from_approach_to_pin: yardages.middle,
        total: yardages.middle != null && carryYards != null ? carryYards + yardages.middle : null,
      },
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  }, [targetPx, pinPx, teePx, holeIndex, carryYards, yardages.middle, addOrUpdatePlan]);

  // ── Restore saved plan when entering a hole that has one ────────
  useEffect(() => {
    if (!existingPlan) return;
    const m = existingPlan.markers;
    if (m.approach && targetByHole[holeIndex] === undefined) {
      setTargetByHole(prev => ({ ...prev, [holeIndex]: { x: m.approach!.x, y: m.approach!.y } }));
    }
    if (m.pin && pinByHole[holeIndex] === undefined) {
      setPinByHole(prev => ({ ...prev, [holeIndex]: { x: m.pin!.x, y: m.pin!.y } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeIndex, existingPlan?.id]);

  // ── Render ──────────────────────────────────────────────────────
  // Canvas-local coords feed both the SVG line and the markers directly.
  // No more screen↔canvas conversion — the canvas View IS the coordinate
  // space we render in, so we just use teeCanvas / pinCanvas / targetCanvas.

  return (
    // GestureHandlerRootView required at the root of any subtree using
    // react-native-gesture-handler. App _layout doesn't wrap globally,
    // so wrap here. Without this, Gesture.Pan callbacks never fire.
    <GestureHandlerRootView style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top bar — back + hole switcher. Compact, ~56px tall. */}
      <View style={[styles.topBar, { height: TOP_BAR_H }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.holeSwitch}>
          <TouchableOpacity onPress={goPrev} disabled={holeIndex <= 1} style={styles.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={22} color={holeIndex <= 1 ? '#374151' : '#ffffff'} />
          </TouchableOpacity>
          <View style={styles.holeBadge}>
            <Text style={styles.holeBadgeNum}>{holeIndex}</Text>
            <Text style={styles.holeBadgePar}>
              {geometry ? `PAR ${geometry.par} · ${geometry.yardage}y` : '—'}
            </Text>
          </View>
          <TouchableOpacity onPress={goNext} disabled={holeIndex >= (totalHoles || 18)} style={styles.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-forward" size={22} color={holeIndex >= (totalHoles || 18) ? '#374151' : '#ffffff'} />
          </TouchableOpacity>
        </View>
        {/* Imagery mode toggle — cycles auto → curated → gps. Icon
            reflects current mode. Lets the user switch between live
            satellite (when geometry available) and bundled screenshots. */}
        <TouchableOpacity
          onPress={() => {
            const next = imageryMode === 'auto' ? 'curated' : imageryMode === 'curated' ? 'gps' : 'auto';
            setImageryMode(next);
          }}
          style={styles.iconBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons
            name={imageryMode === 'gps' ? 'globe' : imageryMode === 'curated' ? 'image' : 'sparkles'}
            size={22}
            color="#ffffff"
          />
        </TouchableOpacity>
      </View>

      {/* Image canvas + markers */}
      <View style={{ width: imageW, height: imageH, backgroundColor: '#0d2418' }}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={{ width: imageW, height: imageH }} resizeMode="cover" />
        ) : curatedImage && imageryMode !== 'gps' ? (
          // Curated bundled hole screenshot (Palms hole-NN.jpg etc).
          // Used as backdrop when GPS imagery is unavailable or the
          // user has chosen 'curated' mode. Provides a usable view
          // even on courses without GPS coords.
          <Image source={curatedImage} style={{ width: imageW, height: imageH }} resizeMode="cover" />
        ) : loading ? (
          <View style={styles.canvasFallback}>
            <ActivityIndicator color="#00C896" />
          </View>
        ) : (
          <View style={styles.canvasFallback}>
            <Text style={styles.canvasFallbackTitle}>{courseName ?? 'No course'}</Text>
            <Text style={styles.canvasFallbackSub}>
              {imageryMode === 'gps'
                ? 'GPS imagery requires hole geometry (tee + green coords).'
                : geometry ? 'Hole imagery unavailable' : 'No geometry for this hole'}
            </Text>
          </View>
        )}

        {/* SVG overlay — line tee → yellow → pin, drawn beneath markers. */}
        <Svg
          width={imageW}
          height={imageH}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <SvgLine
            x1={teeCanvas.x}
            y1={teeCanvas.y}
            x2={targetCanvas.x}
            y2={targetCanvas.y}
            stroke="#facc15"
            strokeWidth={3}
            strokeDasharray="6,4"
            opacity={0.9}
          />
          <SvgLine
            x1={targetCanvas.x}
            y1={targetCanvas.y}
            x2={pinCanvas.x}
            y2={pinCanvas.y}
            stroke="#ffffff"
            strokeWidth={2}
            opacity={0.75}
          />
        </Svg>

        {/* Markers — direct canvas coords. */}
        <Marker
          kind="T"
          x={teeCanvas.x}
          y={teeCanvas.y}
          draggable={false}
        />
        <Marker
          kind="P"
          x={pinCanvas.x}
          y={pinCanvas.y}
          draggable
          onDrag={onPinDrag}
          onDragEnd={() => { pinDragStartRef.current = null; }}
        />
        <Marker
          kind="Y"
          x={targetCanvas.x}
          y={targetCanvas.y}
          draggable
          onDrag={onTargetDrag}
          onDragEnd={() => { targetDragStartRef.current = null; }}
        />

        {/* Measure label — floats above-right of yellow marker. */}
        {carryYards != null && yardages.middle != null && (
          <View
            pointerEvents="none"
            style={[
              styles.measureLabel,
              {
                left: Math.min(imageW - 100, targetCanvas.x + 28),
                top: Math.max(8, targetCanvas.y - 30),
              },
            ]}
          >
            <Text style={styles.measureLabelTop}>{carryYards}y carry</Text>
            <Text style={styles.measureLabelBot}>{yardages.middle}y to pin</Text>
          </View>
        )}

        {/* First-time hint */}
        <View pointerEvents="none" style={styles.measureHint}>
          <Ionicons name="hand-left-outline" size={12} color="#facc15" />
          <Text style={styles.measureHintText}>Drag Y to layup · Drag P to set pin</Text>
        </View>

        {/* Save strategy — right edge of canvas. Persists current marker
            positions as the hole plan (tee/approach/pin + yardages).
            Bookmark icon when no saved plan; checkmark + green when
            saved or just-saved. */}
        <TouchableOpacity
          onPress={onSaveStrategy}
          style={[
            styles.saveBtn,
            (savedFlash || existingPlan) && { backgroundColor: '#00C896', borderColor: '#00C896' },
          ]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Save strategy"
        >
          <Ionicons
            name={savedFlash ? 'checkmark' : existingPlan ? 'bookmark' : 'bookmark-outline'}
            size={20}
            color={savedFlash || existingPlan ? '#04140c' : '#ffffff'}
          />
        </TouchableOpacity>
      </View>

      {/* Bottom panel — F/M/B yardages from yellow target */}
      <View style={[styles.bottomPanel, { height: BOTTOM_PANEL_H, paddingBottom: insets.bottom }]}>
        <YdCell label="FRONT" value={yardages.front} />
        <View style={styles.divider} />
        <YdCell label="MIDDLE" value={yardages.middle} emphasis />
        <View style={styles.divider} />
        <YdCell label="BACK" value={yardages.back} />
      </View>
    </GestureHandlerRootView>
  );
}

function YdCell({ label, value, emphasis = false }: { label: string; value: number | null; emphasis?: boolean }) {
  return (
    <View style={styles.ydCell}>
      <Text style={styles.ydLabel}>{label}</Text>
      <Text style={[styles.ydValue, emphasis && styles.ydValueEmph]}>
        {value != null ? value : '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    backgroundColor: '#000000',
  },
  iconBtn: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
  },
  holeSwitch: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  holeBadge: {
    minWidth: 110,
    alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1, borderColor: '#1f2937',
    backgroundColor: '#0a0a0a',
  },
  holeBadgeNum: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  holeBadgePar: { color: '#9ca3af', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: -2 },
  canvasFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  canvasFallbackTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  canvasFallbackSub: { color: '#6b7280', fontSize: 13, textAlign: 'center' },
  marker: {
    position: 'absolute',
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 4, elevation: 6,
  },
  markerText: { fontWeight: '900', letterSpacing: 0.5 },
  measureLabel: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderWidth: 1, borderColor: '#facc15',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    minWidth: 92,
  },
  measureLabelTop: {
    color: '#facc15', fontSize: 12, fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  measureLabelBot: {
    color: '#ffffff', fontSize: 11, fontWeight: '700',
    fontVariant: ['tabular-nums'], marginTop: 1,
  },
  measureHint: {
    position: 'absolute',
    top: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1, borderColor: 'rgba(250,204,21,0.5)',
    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6,
  },
  measureHintText: {
    color: '#facc15', fontSize: 11, fontWeight: '700', letterSpacing: 0.3,
  },
  saveBtn: {
    position: 'absolute',
    top: 12, right: 12,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 4, elevation: 8,
    zIndex: 25,
  },
  bottomPanel: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#000000',
    paddingHorizontal: 16, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: '#1f2937',
  },
  ydCell: { flex: 1, alignItems: 'center' },
  ydLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  ydValue: { color: '#e8f5e9', fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  ydValueEmph: { color: '#ffffff', fontSize: 32 },
  divider: { width: 1, height: 36, backgroundColor: '#1f2937' },
});
