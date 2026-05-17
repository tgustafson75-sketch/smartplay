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
import { useSmartVision } from '../contexts/SmartVisionContext';
import { fetchCourseGeometry, getHoleGeometry, type HoleGeometry } from '../services/courseGeometryService';
import { getGolfbertHolesForCourse, type GolfbertHole } from '../services/golfbertApi';
import { hasGolfbertCourseMapping } from '../constants/golfbertCourses';
import { fetchHoleImagery, computeFitView, getCenteredImageryUrl } from '../services/mapboxImagery';
import { useDeviceLayout } from '../hooks/useDeviceLayout';
import { getLocalHoleImage, LOCAL_COURSE_CENTROIDS, getLocalCourseSlug } from '../data/localCourseImages';

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
// Phase 108 — re-activated. The forward geo→pixel projection is sound;
// the prior decision to disable was about the inverse (pixel→geo) being
// unstable when the user dragged near image edges. Forward path is
// reliable and is what we need to position fixed markers (tee, pin)
// at their actual rendered positions in the bearing-rotated tile.
function projectToPixels(
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
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const totalHoles = courseHoles.length || 18;
  const addOrUpdatePlan = useRoundStore(s => s.addOrUpdatePlan);
  const existingPlan = useRoundStore(s => s.plans.find(p => p.hole_number === currentHole));
  const [savedFlash, setSavedFlash] = useState(false);

  const imageryMode = useSettingsStore(s => s.smartVisionImagery);
  const { setSmartVisionState } = useSmartVision();
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
  // Phase 406 — split-screen on landscape (Fold-open inner, phone
  // rotated, tablet). The hole image takes 65% of the width on the
  // left and the F/M/B panel becomes a 35% right-side column, both
  // occupying the full available height (no bottom panel chrome).
  // Portrait keeps the existing top-stack-bottom layout exactly.
  const layout = useDeviceLayout();
  const isSplit = layout.isLandscape;
  const SIDE_PANEL_W = isSplit ? Math.floor(W * 0.35) : 0;
  const imageW = isSplit ? W - SIDE_PANEL_W : W;
  const imageH = isSplit
    ? H - insets.top - insets.bottom - TOP_BAR_H
    : H - insets.top - insets.bottom - TOP_BAR_H - BOTTOM_PANEL_H;

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
  // Phase 108-followup — per-hole tee override. Matches pinByHole shape.
  // Lets the user nudge the T marker when course geometry positions it
  // off the actual tee box (golfcourseapi quality varies by course).
  // Drag is only enabled when no round is active per Tim's request —
  // mid-round, the tee marker should reflect the actual tee box and not
  // be accidentally moved by a fat-finger gesture during play.
  const [teeByHole, setTeeByHole] = useState<Record<number, { x: number; y: number }>>({});

  // Golfbert premium-data state — populated when the active course has a
  // mapping AND the upstream proxy returns data successfully. Holds the
  // current hole's polygon vectors (greens / fairway / bunkers / water)
  // so the SmartVision overlay layer can render them on top of the
  // satellite tile. Null means no premium data; existing geometry path
  // handles rendering with point-only data (status quo).
  const [golfbertHole, setGolfbertHole] = useState<GolfbertHole | null>(null);
  // hasGolfbertCourseMapping is checked inside the load effect; no
  // top-level derived value needed.

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

      // Golfbert premium fetch (opportunistic — failures are silent and
      // the existing geometry path serves as the fallback). Pulls all
      // mapped holes for the course, filters to current hole. Cached
      // by SmartVision component mount; re-fetched only on hole switch.
      if (courseId && hasGolfbertCourseMapping(courseId)) {
        try {
          const holes = await getGolfbertHolesForCourse(courseId);
          if (cancelled) return;
          const match = holes?.find(h => h.holeNumber === holeIndex) ?? null;
          setGolfbertHole(match);
          if (match) {
            console.log('[smartvision] using Golfbert premium data for hole', holeIndex);
          }
        } catch (e) {
          console.log('[smartvision] golfbert fetch failed (non-fatal)', e);
          if (!cancelled) setGolfbertHole(null);
        }
      } else {
        setGolfbertHole(null);
      }

      // GPS tile only when allowed AND geometry has tee+green coords.
      if (imageryMode !== 'curated' && geo?.green && courseId) {
        // Phase 401 — cap Mapbox request dims at 1280 (API limit) while
        // preserving the container's aspect ratio. Without this, a
        // Galaxy Fold unfolded container (1800×1660) requests
        // 1800×1660, Mapbox clamps to 1280×1280 (square), and resizeMode
        // "cover" then re-scales the square to fill the portrait
        // container — cropping the top+bottom of the hole. Capped dims
        // keep image aspect = container aspect, so cover = contain and
        // no cropping occurs.
        const MAX = 1280;
        let reqW = imageW;
        let reqH = imageH;
        if (reqW > MAX || reqH > MAX) {
          const scale = Math.min(MAX / reqW, MAX / reqH);
          reqW = Math.floor(reqW * scale);
          reqH = Math.floor(reqH * scale);
        }
        const uri = await fetchHoleImagery(
          {
            courseId,
            holeNumber: holeIndex,
            par: geo.par,
            yardage: geo.yardage,
            tee: geo.tee,
            green: geo.green,
          },
          { width: reqW, height: reqH },
        );
        if (cancelled) return;
        setImageUri(uri);
      } else if (imageryMode !== 'curated') {
        // 2026-05-16 — Centroid fallback for local courses that lack
        // BOTH per-hole geometry AND a bundled curated image. Replaces
        // the chromed Golfshot screenshots for Sunnyvale + San Jose
        // Muni only. CRITICAL: must check getLocalHoleImage first —
        // courses with bundled images (Palms, Lakes, Rancho, Crystal
        // Springs, Mariners Point) MUST NOT get centroid imagery
        // assigned here; if we did, imageUri would be set and the
        // render path would pick it over the curated bundled image,
        // showing a generic Mapbox tile instead of the hand-curated
        // hole photo. That regression was caught immediately on
        // Mariners ("measuring tool on a green screen").
        const hasCurated = getLocalHoleImage(courseName, holeIndex) != null;
        if (!hasCurated) {
          const slug = getLocalCourseSlug(courseName);
          const centroid = slug ? LOCAL_COURSE_CENTROIDS[slug] : null;
          if (centroid) {
            const MAX = 1280;
            let reqW = imageW;
            let reqH = imageH;
            if (reqW > MAX || reqH > MAX) {
              const scale = Math.min(MAX / reqW, MAX / reqH);
              reqW = Math.floor(reqW * scale);
              reqH = Math.floor(reqH * scale);
            }
            const uri = getCenteredImageryUrl({
              lat: centroid.lat,
              lng: centroid.lng,
              zoom: 15,
              width: reqW,
              height: reqH,
            });
            if (cancelled) return;
            setImageUri(uri);
          } else {
            setImageUri(null);
          }
        } else {
          // Bundled image exists for this hole — leave imageUri null so
          // the render path picks up `curatedImage` from line ~292.
          setImageUri(null);
        }
      } else {
        setImageUri(null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [courseId, courseName, holeIndex, imageW, imageH, imageryMode]);

  // ── Derived projection ──────────────────────────────────────────
  // Phase 401 — single source of truth for center/zoom/bearing, shared
  // with mapboxImagery.getHoleImageryUrl(). computeFitView picks the
  // zoom that guarantees the entire tee→green axis plus 15% margin
  // fits the container height — no more long-hole tee clipping.
  //
  // Tee coordinate fallback ladder:
  //   1. geometry.tee (golfcourseapi) — preferred
  //   2. courseHoles[holeIndex].teeLat/teeLng (round store; local courses
  //      Palms/Lakes/Rancho have these populated)
  //   3. null — projection unavailable; static fallback path runs
  const teeCoord = useMemo(() => {
    if (geometry?.tee) return geometry.tee;
    const h = courseHoles.find(x => x.hole === holeIndex);
    if (h && h.teeLat !== 0 && h.teeLng !== 0) {
      console.log(`[smartvision] hole ${holeIndex}: tee from courseHoles fallback (golfcourseapi had no tee)`);
      return { lat: h.teeLat, lng: h.teeLng };
    }
    return null;
  }, [geometry, courseHoles, holeIndex]);

  const greenCoord = useMemo(() => geometry?.green ?? null, [geometry]);

  const projection = useMemo(() => {
    if (!teeCoord || !greenCoord) return null;
    const fit = computeFitView({
      tee: teeCoord,
      green: greenCoord,
      width: imageW,
      height: imageH,
    });
    if (!fit) return null;
    return fit;
  }, [teeCoord, greenCoord, imageW, imageH]);
  void bearingDeg; void autoZoom; // legacy helpers retained for future use

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
  // Phase 108 — project tee + pin from actual geometry to canvas pixels
  // when projection data is available. Falls back to static (50%, 85%) /
  // (50%, 15%) when geometry is missing (curated bundled image mode or
  // courses without tee/green coords). Static fallback matches the prior
  // pre-Phase-108 behaviour exactly for the no-projection path.
  // Phase 108-followup — user override (drag) wins over projection wins
  // over static fallback.
  const teeOverride = teeByHole[holeIndex];
  const teeCanvas = useMemo(() => {
    if (teeOverride) return teeOverride;
    if (teeCoord && projection) {
      const off = projectToPixels(teeCoord, projection.center, projection.zoom, projection.bearing);
      return { x: imageW / 2 + off.x, y: imageH / 2 - off.y };
    }
    return { x: imageW / 2, y: imageH * 0.85 };
  }, [teeOverride, teeCoord, projection, imageW, imageH]);
  const pinDefaultCanvas = useMemo(() => {
    if (greenCoord && projection) {
      const off = projectToPixels(greenCoord, projection.center, projection.zoom, projection.bearing);
      return { x: imageW / 2 + off.x, y: imageH / 2 - off.y };
    }
    return { x: imageW / 2, y: imageH * 0.15 };
  }, [greenCoord, projection, imageW, imageH]);

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

  // Phase 401 — re-enabled. When projection is computed from real
  // tee/green coords AND the Mapbox tile is what's rendered, the
  // pixel→geo inverse is reliable and yardages should come from
  // haversine on the dragged target's projected lat/lng. We still fall
  // back to pixel-axis interpolation when no projection (curated mode
  // or no geometry) — that branch is unchanged.
  const usingGpsTile = projection != null && !!imageUri;

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

  // ── SmartVision context wiring (Phase BJ) ───────────────────────
  // Tells Kevin "SmartVision is open at hole N with these yardages" so
  // the [SMARTVISION OPEN] block lands in the prompt and tactical reads
  // skip the "let me look" preamble. Mirrors the legacy hole-view wiring.
  const par = useMemo(() => {
    return courseHoles.find(h => h.hole === holeIndex)?.par ?? null;
  }, [courseHoles, holeIndex]);
  useEffect(() => {
    setSmartVisionState({ isOpen: true, holeNumber: holeIndex, par });
    return () => setSmartVisionState({ isOpen: false, analysisText: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeIndex, par]);
  useEffect(() => {
    setSmartVisionState({
      centerYards: yardages.middle,
      measureYards: carryYards,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yardages.middle, carryYards]);

  // ── Drag handlers for yellow target + pin (canvas coords) ───────
  const targetDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const pinDragStartRef = useRef<{ x: number; y: number } | null>(null);
  // Phase 108-followup — tee drag start ref.
  const teeDragStartRef = useRef<{ x: number; y: number } | null>(null);

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

  // Phase 108-followup — tee drag handler. Persists per hole into teeByHole.
  const onTeeDrag = useCallback((dx: number, dy: number) => {
    if (!teeCanvas) return;
    if (!teeDragStartRef.current) teeDragStartRef.current = teeCanvas;
    const next = clampToCanvas({
      x: teeDragStartRef.current.x + dx,
      y: teeDragStartRef.current.y + dy,
    });
    setTeeByHole(prev => ({ ...prev, [holeIndex]: next }));
  }, [teeCanvas, holeIndex, clampToCanvas]);

  // Reset drag refs when hole changes
  useEffect(() => {
    targetDragStartRef.current = null;
    pinDragStartRef.current = null;
    teeDragStartRef.current = null;
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

      {/* Phase 406 — split-screen container. On landscape, image
          canvas + bottom panel sit side-by-side in a row so the panel
          becomes a right-side column. On portrait, vertical flow is
          unchanged. */}
      <View style={{ flexDirection: isSplit ? 'row' : 'column', flex: 1 }}>
      {/* Image canvas + markers */}
      <View style={{ width: imageW, height: imageH, backgroundColor: '#0d2418' }}>
        {/* Premium course data badge — visible only when Golfbert
            mapping returned data for this hole. Tells the user the map
            is using paid premium geometry (greens / bunkers / water)
            instead of point-only golfcourseapi data. */}
        {golfbertHole && (
          <View style={styles.premiumBadge} pointerEvents="none">
            <Text style={styles.premiumBadgeText}>★ Golfbert premium</Text>
          </View>
        )}
        {/* Prefer the Golfbert per-hole satellite image when available
            (has hazard outlines baked in), otherwise fall back to the
            existing imageUri (Mapbox tile) or curated bundled image. */}
        {golfbertHole?.imageryUrl ? (
          <Image source={{ uri: golfbertHole.imageryUrl }} style={{ width: imageW, height: imageH }} resizeMode="cover" />
        ) : imageUri ? (
          <Image source={{ uri: imageUri }} style={{ width: imageW, height: imageH }} resizeMode="cover" />
        ) : curatedImage && imageryMode !== 'gps' ? (
          // Curated bundled hole screenshot (Palms hole-NN.jpg etc).
          // Phase 401 — resizeMode "contain" (was "cover"). Curated
          // JPGs are pre-rendered at whatever aspect Tim captured;
          // cover was cropping top+bottom on more-portrait sources
          // than the container. Contain guarantees the entire image is
          // visible, letterboxing if aspect differs.
          <Image source={curatedImage} style={{ width: imageW, height: imageH }} resizeMode="contain" />
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
        {/* Phase 108-followup — T marker is draggable when no round is
            active so the user can compensate for course-geometry tee
            position errors. Locked during a round to prevent fat-finger
            adjustments while the player is using the view tactically. */}
        <Marker
          kind="T"
          x={teeCanvas.x}
          y={teeCanvas.y}
          draggable={!isRoundActive}
          onDrag={!isRoundActive ? onTeeDrag : undefined}
          onDragEnd={!isRoundActive ? () => { teeDragStartRef.current = null; } : undefined}
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

      {/* Bottom panel — F/M/B yardages from yellow target. Phase 406:
          on landscape, this becomes a right-side column (flexDirection
          column, fixed width = SIDE_PANEL_W, fills available height);
          on portrait, the existing bottom-strip layout is unchanged. */}
      <View
        style={[
          isSplit ? styles.sidePanel : styles.bottomPanel,
          isSplit
            ? { width: SIDE_PANEL_W, height: imageH, paddingBottom: insets.bottom + 12 }
            : { height: BOTTOM_PANEL_H, paddingBottom: insets.bottom },
        ]}
      >
        <YdCell label="FRONT" value={yardages.front} stacked={isSplit} />
        <View style={isSplit ? styles.dividerHorizontal : styles.divider} />
        <YdCell label="MIDDLE" value={yardages.middle} emphasis stacked={isSplit} />
        <View style={isSplit ? styles.dividerHorizontal : styles.divider} />
        <YdCell label="BACK" value={yardages.back} stacked={isSplit} />
      </View>
      </View>{/* close split-screen container */}
    </GestureHandlerRootView>
  );
}

function YdCell({ label, value, emphasis = false, stacked = false }: {
  label: string; value: number | null; emphasis?: boolean;
  // Phase 406 — stacked layout for the landscape side-panel where the
  // cells run vertically with bigger numbers (more vertical real
  // estate available than the portrait bottom-strip).
  stacked?: boolean;
}) {
  return (
    <View style={[styles.ydCell, stacked && styles.ydCellStacked]}>
      <Text style={styles.ydLabel}>{label}</Text>
      <Text style={[
        styles.ydValue,
        emphasis && styles.ydValueEmph,
        stacked && styles.ydValueStacked,
        stacked && emphasis && styles.ydValueStackedEmph,
      ]}>
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
  premiumBadge: {
    position: 'absolute', top: 8, right: 8, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderColor: 'rgba(245, 166, 35, 0.85)', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
  },
  premiumBadgeText: {
    color: '#F5A623', fontSize: 10, fontWeight: '900', letterSpacing: 0.6,
  },
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
  // Phase 406 — landscape split-screen side panel for SmartVision.
  // Replaces the horizontal bottomPanel when the device is landscape;
  // hosts F/M/B stacked vertically with larger numbers.
  sidePanel: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'space-evenly',
    backgroundColor: '#000000',
    paddingHorizontal: 20, paddingTop: 16,
    borderLeftWidth: 1, borderLeftColor: '#1f2937',
  },
  ydCellStacked: {
    flex: 0,
    alignItems: 'center',
    paddingVertical: 6,
  },
  ydValueStacked: { fontSize: 44, marginTop: 4 },
  ydValueStackedEmph: { fontSize: 58 },
  dividerHorizontal: { height: 1, backgroundColor: '#1f2937', marginVertical: 4 },
});
