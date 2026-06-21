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
import GlassesStatusBadge from '../components/GlassesStatusBadge';
import SmartVisionLiveStrategy from '../components/SmartVisionLiveStrategy';
// 2026-05-26 — Fix CD: theme the image-canvas fallback bg so light
// mode doesn't show a dark rectangle while the hole image loads.
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';

import Svg, { Line as SvgLine, Polygon as SvgPolygon, Text as SvgText, G as SvgG, Circle as SvgCircle } from 'react-native-svg';

import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useSmartVision } from '../contexts/SmartVisionContext';
// 2026-06-06 — Phase 4.3: reactive reads of marked tee/green geo
// anchors. When both exist for a Mode 2 (curated bundled-image) hole,
// we can build a 2-point pixel↔lat/lng calibration and produce real
// haversine yardages instead of the pixel-axis interpolation fallback.
import { useTeeOverride } from '../services/courseTeeOverrides';
import { useGreenOverride } from '../services/courseGreenOverrides';
import { fetchCourseGeometry, getHoleGeometry, type HoleGeometry } from '../services/courseGeometryService';
import { getLastFix, subscribeFixChange, resolveGreenCoords, resolveTeeCoords, setMarkedFix } from '../services/smartFinderService';
import { bumpToActive } from '../services/gpsManager';
import { verifyShotAtLocation, correctShotClub, confirmTrackedShot, type ShotTrackResult } from '../services/shotTracking';
import ShotTrackedSheet from '../components/round/ShotTrackedSheet';
import type { ClubName } from '../store/clubStatsStore';
import { getGolfbertHolesForCourse, type GolfbertHole } from '../services/golfbertApi';
import { hasGolfbertCourseMapping } from '../constants/golfbertCourses';
import { fetchHoleImagery, computeFitView, getCenteredImageryUrl } from '../services/mapboxImagery';
import YardageBookPanel from '../components/smartvision/YardageBookPanel';
import { useDeviceLayout } from '../hooks/useDeviceLayout';
import { getLocalHoleImage, getLocalHoleImageById, LOCAL_COURSE_CENTROIDS, getLocalCourseSlug } from '../data/localCourseImages';
import { pointAlongHoleLine } from '../data/holeLineCalibration';
import { getBundledHoles, getCourseHoleCount } from '../data/courses';
// 2026-05-31 — Fix GA: consolidate to canonical haversine. Prior inline
// implementation duplicated utils/geoDistance.ts and was a maintenance
// liability (three copies across this file, hole-view.tsx, and utils).
// Single source of truth now lives in utils/geoDistance.ts.
import { haversineYards as canonicalHaversineYards } from '../utils/geoDistance';
import { planAimLines, layupFraction } from '../utils/layupPlan';

// ─── Geo helpers ──────────────────────────────────────────────────

// 2026-05-31 — Fix GA: WGS84 range guard. Any coord with |lat| > 90 OR
// |lng| > 180 is mathematically invalid (planet doesn't go there) and
// indicates a unit-mismatch upstream — typically meters where degrees
// were expected, or a projection result that wasn't normalized. Returns
// false → caller skips the haversine call rather than producing the
// deterministic ~246yd artifact Tim's harness flagged (225m × 1.09361).
function isValidWgs84(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

// 4-arg wrapper matching the prior inline signature so existing call
// sites don't need restructuring. Internally delegates to the canonical
// {lat,lng}-shape haversine in utils/geoDistance.ts.
function haversineYards(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!isValidWgs84(lat1, lng1) || !isValidWgs84(lat2, lng2)) {
    console.error('[smartvision/yardage] coord out of WGS84 range — skipping haversine', {
      a: { lat: lat1, lng: lng1 },
      b: { lat: lat2, lng: lng2 },
    });
    return NaN;
  }
  return canonicalHaversineYards({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
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
  Y: { bg: '#facc15', ring: '#a16207', text: '#1f2937', size: 40 }, // yellow target — Phase 4.1: now a cart icon (your position)
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

  // 2026-06-06 — Phase 4.1 of on-course resilience sprint. The Y marker
  // (yardage target) is now rendered as a cart icon so the metaphor
  // matches Tim's mental model ("tap your position"). T (tee) and P
  // (pin) keep their letter labels — those are fixed reference points.
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
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
      hitSlop={{ top: 24, bottom: 24, left: 24, right: 24 }}
    >
      {kind === 'Y' ? (
        <Ionicons name="car-sport" size={Math.round(s.size * 0.62)} color={s.text} />
      ) : (
        <Text style={[styles.markerText, { color: s.text, fontSize: s.size * 0.42 }]}>{kind}</Text>
      )}
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
  // 2026-05-26 — Fix CD: theme tokens for the canvas fallback color.

  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const activeCourseName = useRoundStore(s => s.activeCourse);
  const liveCourseHoles = useRoundStore(s => s.courseHoles);
  const currentHole = useRoundStore(s => s.currentHole);
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  // 2026-05-17 — pre-round planning context. When no active round but
  // the user has picked a course on the Play tab, render SmartVision
  // for that course's hole 1 so the user can measure + drag tee/pin
  // and save a plan BEFORE starting the round. The plan persists in
  // roundStore.plans and flows into the active round when startRound
  // fires (which doesn't clear existing plans).
  const pendingStartCourseId = useRoundStore(s => s.pendingStartCourseId);
  const previewCourseId = useRoundStore(s => s.previewCourseId);
  const homeCourseName = usePlayerProfileStore(s => s.homeCourse);
  // Resolution chain (most-specific → most-default):
  //   1. activeCourseId — live round
  //   2. pendingStartCourseId — about to launch (Play tab "Start Round")
  //   3. previewCourseId — picked on Play tab, render-only hint
  //   4. homeCourse — player profile fallback
  //   5. 'local:sunnyvale' — final hard fallback so the screen NEVER renders
  //      "No course" / "No geometry" when bundled imagery is available. The
  //      user can swipe to any hole; if nothing matches, the green canvas
  //      with friendly hint copy renders instead of a broken-looking state.
  // homeCourse is a NAME (string), not an id, so we resolve to id via
  // a fuzzy substring match against LOCAL_COURSE_SLUG_BY_NAME below.
  const homeCourseIdFromProfile: string | null = (() => {
    if (!homeCourseName) return null;
    const n = homeCourseName.toLowerCase();
    if (n.includes('sunnyvale')) return 'local:sunnyvale';
    if (n.includes('san jose')) return 'local:san-jose-muni';
    if (n.includes('palms')) return 'local:palms';
    if (n.includes('lakes')) return 'local:lakes';
    if (n.includes('rancho')) return 'local:rancho-california';
    if (n.includes('crystal')) return 'local:crystal-springs';
    if (n.includes('mariner')) return 'local:mariners-point';
    return null;
  })();
  // 2026-05-17 — Removed BOTH the 'local:palms' hard fallback AND the
  // homeCourseIdFromProfile fallback. The home-course leg was the
  // remaining Palms leak: when a user with homeCourse="Menifee Lakes
  // — Palms" hits SmartVision without first selecting a course on
  // the Play tab, the cascade silently returned 'local:palms' and
  // rendered Palms imagery for whatever the user thought they were
  // looking at. SmartVision now requires an actual context
  // (activeCourseId | pendingStartCourseId | previewCourseId);
  // otherwise courseId stays null and the empty-state UI renders.
  // 2026-05-25 — Last-resort homeCourse fallback for the courseId path
  // ONLY (not for courseName — see comment block below for why that's
  // dangerous). Tim reported pre-round SmartVision showed no yardages
  // because he hadn't selected a course on Play tab first → all three
  // context vars were null → courseHoles empty → no F/M/B numbers. Now
  // when the explicit context cascade is null AND a homeCourse string
  // is set, resolve it to a local slug via getLocalCourseSlug and use
  // that local:<slug> id. Falls through to null when the resolver
  // doesn't recognize the home course name. Pure additive — existing
  // explicit-context paths get the same effectiveCourseId they had.
  const explicitCourseId =
    activeCourseId ?? pendingStartCourseId ?? previewCourseId ?? null;
  const homeFallbackCourseId = (() => {
    if (explicitCourseId) return null;
    if (!homeCourseName) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getLocalCourseSlug } = require('../data/localCourseImages') as typeof import('../data/localCourseImages');
      const slug = getLocalCourseSlug(homeCourseName);
      return slug ? `local:${slug}` : null;
    } catch {
      return null;
    }
  })();
  const effectiveCourseId = explicitCourseId ?? homeFallbackCourseId;
  // homeCourseIdFromProfile still computed for any read-only consumer
  // below that wants it; it's no longer in the cascade.
  void homeCourseIdFromProfile;
  const derivedCourseLabel =
    effectiveCourseId && effectiveCourseId.startsWith('local:')
      ? effectiveCourseId.slice('local:'.length).replace(/-/g, ' ')
      : effectiveCourseId ?? '';
  const courseId = effectiveCourseId;
  // 2026-05-17 — Resolve courseName from courseId FIRST, not from the
  // user's homeCourse. The previous cascade fell through to
  // homeCourseName whenever activeCourseName was briefly null, which
  // leaked the home course's label into substring-matching everywhere
  // downstream (e.g. a Crystal Springs round whose courseName fell to
  // "Menifee Lakes — Palms" would substring-match getLocalHoleImage as
  // palms and render the wrong hole). courseId-derived label is the
  // canonical source.
  // 2026-05-17 — Also removed homeCourseName from the courseName
  // cascade. Same leak as effectiveCourseId above: if Tim's home is
  // "Menifee Lakes — Palms", any null effectiveCourseId fell here and
  // substring-matched Palms via the name-based getLocalHoleImage
  // path. Empty string when no real context exists — let downstream
  // render the explicit empty state.
  const courseName = activeCourseName ?? derivedCourseLabel ?? '';
  // 2026-05-17 — pre-round F/M/B yardages need real course data. The
  // live `courseHoles` slice from roundStore is empty until
  // startRound() fires; before that, the bundled holes for the
  // previewed local course are the right source. Tim's spec: F/M/B
  // works in static pre-round, then GPS overrides once round is
  // active. This memo picks the live slice when it's populated
  // (active round), else falls back to the bundled holes resolved
  // from the previewed courseId.
  const courseHoles = useMemo(() => {
    if (liveCourseHoles.length > 0) return liveCourseHoles;
    return getBundledHoles(courseId);
  }, [liveCourseHoles, courseId]);
  // 2026-06-04 — Bundled length wins over live for known local courses
  // (Echo Hills + Mariners Point are 9-hole; golfcourseapi can pad to 18).
  const totalHoles = getCourseHoleCount(courseId, courseHoles.length);
  // 2026-06-04 — HolePlan removed. addOrUpdatePlan / existingPlan /
  // savedFlash + the bookmark-save canvas button stripped out.

  const imageryMode = useSettingsStore(s => s.smartVisionImagery);
  const { setSmartVisionState } = useSmartVision();
  const setImageryMode = useSettingsStore(s => s.setSmartVisionImagery);

  // 2026-06-04 — Pre-round force-auto. When the user opens SmartVision
  // without an active round (course preview, hole-shopping, demo), reset
  // the imagery mode to 'auto' so they get the best-available view
  // regardless of what they last selected mid-round. Fires once per
  // mount; mid-round opens leave the user's chosen mode alone.
  useEffect(() => {
    if (!isRoundActive && imageryMode !== 'auto') {
      setImageryMode('auto');
    }
    // Intentionally not depending on imageryMode — we only want this to
    // fire once on mount, not every time the user cycles modes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRoundActive]);

  // Phase BG — subscribe to position-mark bus so a Mark event triggers
  // re-render. Used to invalidate cached imagery and recompute marker
  // positions if/when this screen later supports live GPS overlays.
  // Currently SmartVision uses fetched geometry only (no GPS overlay),
  // but the subscription is in place so adding a "you-are-here" dot
  // only requires reading getLastFix() in the render.
  const [markBumpTick, setMarkBumpTick] = useState(0);
  // 2026-05-19 — Subscribe to fix-change so the player marker (added
  // below) recomputes whenever the simulator or real GPS moves the
  // cached lastFix. Without this, SmartVision's player marker would
  // stay frozen on whatever fix was current when the screen mounted.
  useEffect(() => {
    const unsub = subscribeFixChange(() => setMarkBumpTick(t => t + 1));
    return () => { unsub(); };
  }, []);
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

  // 2026-05-17 — Curated bundled image. Prefer the courseId-keyed lookup
  // (canonical) and fall back to courseName-based substring matching
  // only when courseId is missing. Without the ID-first lookup, a brief
  // null on activeCourseName during state transitions caused Palms
  // imagery to leak into Crystal Springs / SJM / Mariners rounds via
  // the home-course-name fallback.
  const curatedImage = useMemo(
    () => getLocalHoleImageById(courseId, holeIndex) ?? getLocalHoleImage(courseName, holeIndex),
    [courseId, courseName, holeIndex],
  );

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
  // 2026-06-07 — Shot tracked via cart-mark verification (shotTracking).
  // Set after a same-hole cart tap during an active round; drives the
  // ShotTrackedSheet (distance + approach + tap-to-scroll club correct).
  const [trackedShot, setTrackedShot] = useState<ShotTrackResult | null>(null);
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
          try {
            const c = await fetchCourseGeometry(courseId);
            if (cancelled) return;
            geo = c?.holes.find(h => h.hole_number === holeIndex) ?? null;
          } catch (e) {
            // 2026-06-08 (audit #2) — never let a geometry fetch failure
            // crash the on-course screen; degrade to no-geometry.
            console.log('[smartvision] geometry fetch failed (non-fatal)', e);
            if (cancelled) return;
            geo = null;
          }
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

      // 2026-05-18 — Curated bundled images win when one exists for this
      // course, unless the user has explicitly set imageryMode='gps'.
      // Tim's expectation on the synthetic Menifee harness was the
      // bundled Palms hole photos, not a Mapbox satellite tile of green
      // grass. Previous order ("GPS tile if geometry available") forced
      // the satellite path whenever geometry was seeded, even for
      // courses with hand-curated imagery on disk. New order: curated
      // (if available + mode != gps) → GPS tile (geometry + mode != curated) → centroid fallback.
      const curatedAvailable =
        getLocalHoleImageById(courseId, holeIndex) ?? getLocalHoleImage(courseName, holeIndex);
      if (curatedAvailable && imageryMode !== 'gps') {
        setImageUri(null);
        setLoading(false);
        return;
      }
      // 2026-06-01 — Fix GI: when geo has polygons but no centroid
      // (some upstream sources return green_polygon without computing
      // green centroid), derive the centroid from the polygon so the
      // satellite-tile fetch still fires. Prior code's `geo?.green`
      // gate fell through when only polygons existed → no background
      // image rendered, polygons floated on blank canvas. Symptom
      // from Tim's screenshot: vector outline of green/bunkers with
      // no aerial behind it in satellite mode.
      const polygonCentroid = (poly: { lat: number; lng: number }[] | null | undefined) => {
        if (!poly || poly.length === 0) return null;
        const lat = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
        const lng = poly.reduce((s, p) => s + p.lng, 0) / poly.length;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
        return { lat, lng };
      };
      const resolved = resolveGreenCoords(holeIndex);
      const resolvedTee = resolveTeeCoords(holeIndex);
      const effectiveGreen =
        resolved.middle ?? geo?.green ?? polygonCentroid(geo?.green_polygon);
      const effectiveTee =
        resolvedTee.tee ?? geo?.tee ?? polygonCentroid(geo?.tee_polygon);
      // GPS tile only when allowed AND we have at least a green coord
      // (real centroid or polygon-derived).
      if (imageryMode !== 'curated' && effectiveGreen && courseId) {
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
        // 2026-06-01 — Fix GI: thread the polygon-derived
        // effective coords into the imagery fetch so the tile
        // renders even when upstream only gave us polygons (not
        // centroids). Without this, the tile fetch would still
        // miss because geo.green is null even though we have a
        // usable polygon centroid right here.
        try {
          const uri = await fetchHoleImagery(
            {
              courseId,
              holeNumber: holeIndex,
              par: geo!.par,
              yardage: geo!.yardage,
              tee: effectiveTee,
              green: effectiveGreen,
            },
            { width: reqW, height: reqH },
          );
          if (cancelled) return;
          setImageUri(uri);
        } catch (e) {
          // 2026-06-08 (audit #2) — imagery fetch failure must not crash
          // the hole view; fall through to no-image (vector still renders).
          console.log('[smartvision] imagery fetch failed (non-fatal)', e);
          if (cancelled) return;
          setImageUri(null);
        }
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
    // 2026-06-08 (audit m1) — canonical WGS84 validity (rejects near-zero
    // placeholders + leaked-meters values), not just `!== 0`.
    if (h && isValidWgs84(h.teeLat, h.teeLng)) {
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
  // 2026-05-26 — Fix BM: local-image hole-line calibration consumer.
  // When the screen is rendering a bundled hole image (Maplewood,
  // Palms — and any future course with bundled assets), the projection
  // fallback (last clause of the useMemos below) puts tee at
  // (50%, 85%) and pin at (50%, 15%) — a centered vertical axis that
  // ignores the actual hole layout. The Batch 46 scaffold gives us
  // per-hole calibrated pixel coords on the cropped 1768×1450 image;
  // when calibration exists, use it as the static fallback instead
  // of the dumb centered axis. User drag still wins via teeOverride /
  // pinOverride; geo projection still wins when both teeCoord and
  // projection are present (Mapbox-rendered courses).
  const SOURCE_IMG_W = 1768;
  const SOURCE_IMG_H = 1450;
  const calibrationSlug = useMemo(() => getLocalCourseSlug(courseName), [courseName]);
  const calibratedTeeCanvas = useMemo(() => {
    if (!calibrationSlug) return null;
    const pt = pointAlongHoleLine(calibrationSlug, holeIndex, 0);
    if (!pt) return null;
    return { x: pt.x * (imageW / SOURCE_IMG_W), y: pt.y * (imageH / SOURCE_IMG_H) };
  }, [calibrationSlug, holeIndex, imageW, imageH]);
  const calibratedPinCanvas = useMemo(() => {
    if (!calibrationSlug) return null;
    const pt = pointAlongHoleLine(calibrationSlug, holeIndex, 1);
    if (!pt) return null;
    return { x: pt.x * (imageW / SOURCE_IMG_W), y: pt.y * (imageH / SOURCE_IMG_H) };
  }, [calibrationSlug, holeIndex, imageW, imageH]);

  const teeOverride = teeByHole[holeIndex];
  const teeCanvas = useMemo(() => {
    if (teeOverride) return teeOverride;
    if (teeCoord && projection) {
      const off = projectToPixels(teeCoord, projection.center, projection.zoom, projection.bearing);
      return { x: imageW / 2 + off.x, y: imageH / 2 - off.y };
    }
    if (calibratedTeeCanvas) return calibratedTeeCanvas;
    return { x: imageW / 2, y: imageH * 0.85 };
  }, [teeOverride, teeCoord, projection, imageW, imageH, calibratedTeeCanvas]);
  const pinDefaultCanvas = useMemo(() => {
    if (greenCoord && projection) {
      const off = projectToPixels(greenCoord, projection.center, projection.zoom, projection.bearing);
      return { x: imageW / 2 + off.x, y: imageH / 2 - off.y };
    }
    if (calibratedPinCanvas) return calibratedPinCanvas;
    return { x: imageW / 2, y: imageH * 0.15 };
  }, [greenCoord, projection, imageW, imageH, calibratedPinCanvas]);

  // Pin override (user-dragged) — stored in canvas coords.
  const pinOverride = pinByHole[holeIndex];
  const pinCanvas = pinOverride ?? pinDefaultCanvas;

  // Pixel-relative (+y up) versions for legacy yardage interpolation.
  const teePx = useMemo(() => ({ x: teeCanvas.x - imageW / 2, y: imageH / 2 - teeCanvas.y }), [teeCanvas, imageW, imageH]);
  const pinPx = useMemo(() => ({ x: pinCanvas.x - imageW / 2, y: imageH / 2 - pinCanvas.y }), [pinCanvas, imageW, imageH]);

  // Phase 4.3 calibration hook reads. The full calibration memo lives
  // below `usingGpsTile` (which it gates on) — but the hook calls must
  // run unconditionally at the same hook position every render.
  const teeOverrideGeo = useTeeOverride(courseId, holeIndex);
  const greenOverrideGeo = useGreenOverride(courseId, holeIndex);

  // 2026-05-19 — Live player position (you-are-here cart marker).
  // Splits its positioning logic by render substrate:
  //   - Aerial / Golfbert satellite tile: projection-based math —
  //     image is bearing-aligned to tee→green so the lat/lng→pixel
  //     projection lands accurately under the player.
  //   - Curated bundled hole photo: vertical-track positioning —
  //     curated photos are framed tee-bottom / pin-top with no
  //     bearing alignment, so the projection math inverted on Tim's
  //     view ("opposite direction" report). Use pctAlong along the
  //     hole's GPS axis to slide a centered marker vertically from
  //     bottom (tee) to top (pin) — matches L1HolePreview's behavior.
  const playerCanvas = useMemo(() => {
    const fix = getLastFix();
    if (!fix) return null;
    const onCurated = !golfbertHole?.imageryUrl && !imageUri && !!curatedImage;
    if (onCurated && teeCoord && greenCoord) {
      const total = haversineYards(teeCoord.lat, teeCoord.lng, greenCoord.lat, greenCoord.lng);
      const fromPlayer = haversineYards(fix.location.lat, fix.location.lng, greenCoord.lat, greenCoord.lng);
      if (total <= 0 || !Number.isFinite(fromPlayer) || fromPlayer > 1500) return null;
      const pctAlong = Math.max(0, Math.min(1, 1 - fromPlayer / total));
      const padTop = 12;
      const padBottom = 12;
      const trackHeight = imageH - padTop - padBottom;
      // pctAlong=0 (at tee) → near bottom, pctAlong=1 (at green) → near top.
      // Screen y increases downward, so y = padTop + (1 - pctAlong) * trackHeight.
      return { x: imageW / 2, y: padTop + (1 - pctAlong) * trackHeight };
    }
    if (!projection) return null;
    const off = projectToPixels(fix.location, projection.center, projection.zoom, projection.bearing);
    return { x: imageW / 2 + off.x, y: imageH / 2 - off.y };
    // markBumpTick listed so the memo recomputes when fix-change fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection, imageW, imageH, markBumpTick, golfbertHole, imageUri, curatedImage, teeCoord, greenCoord]);

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

  // ── Phase 4.3: 2-point pixel↔lat/lng calibration for Mode 2 holes ──
  // When the user has marked BOTH tee and green for a curated bundled-
  // image hole (Mode 2, no Mapbox projection), we have:
  //   - teeCanvas pixel + teeOverrideGeo lat/lng (anchor A)
  //   - pinCanvas pixel + greenOverrideGeo lat/lng (anchor B)
  // That's enough to compute pixel → lat/lng for any other pixel via
  // axis projection + linear interpolation. Treats the tee→pin axis as
  // the hole's geographic line; perpendicular drift is collapsed onto
  // the axis (1D approximation). Sufficient for Tim's "~10 yard
  // accuracy" target on straight par 4/5 holes; Phase 4.4 will add
  // GPS-fix reconciliation to compensate for dogleg lateral.
  const calibration2Anchor = useMemo(() => {
    if (usingGpsTile) return null;
    if (!teeOverrideGeo || !greenOverrideGeo) return null;
    const teePxA = { x: teeCanvas.x, y: teeCanvas.y };
    const pinPxA = { x: pinCanvas.x, y: pinCanvas.y };
    const dx = pinPxA.x - teePxA.x;
    const dy = pinPxA.y - teePxA.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1) return null;
    return { teePx: teePxA, teeGeo: teeOverrideGeo, greenGeo: greenOverrideGeo, axisDx: dx, axisDy: dy, axisLenSq: lenSq };
  }, [usingGpsTile, teeOverrideGeo, greenOverrideGeo, teeCanvas.x, teeCanvas.y, pinCanvas.x, pinCanvas.y]);
  const projectCanvasToLatLngVia2Anchor = useCallback((canvasPx: { x: number; y: number }): { lat: number; lng: number } | null => {
    if (!calibration2Anchor) return null;
    const { teePx: tA, teeGeo: tG, greenGeo: gG, axisDx, axisDy, axisLenSq } = calibration2Anchor;
    const t = ((canvasPx.x - tA.x) * axisDx + (canvasPx.y - tA.y) * axisDy) / axisLenSq;
    return { lat: tG.lat + t * (gG.lat - tG.lat), lng: tG.lng + t * (gG.lng - tG.lng) };
  }, [calibration2Anchor]);

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
      // 2026-05-31 — Fix GA: guard against out-of-range coords BEFORE
      // any haversine call. If pixelsToLatLng ever returned something
      // that isn't WGS84 (projection regression, bad input), the prior
      // code blindly fed the result into haversine and produced the
      // 246yd artifact. haversineYards itself now returns NaN on bad
      // coords and we coerce that to null at the cell level below.
      if (!isValidWgs84(targetGeo.lat, targetGeo.lng) || !isValidWgs84(pinGeo.lat, pinGeo.lng)) {
        console.error('[smartvision/yardage] pixelsToLatLng produced out-of-range coord — skipping yardage tick', { targetGeo, pinGeo });
        return { front: null as number | null, middle: null as number | null, back: null as number | null };
      }
      const cell = (v: number) => Number.isFinite(v) ? Math.round(v) : null;
      const front = geometry.green_front ? cell(haversineYards(targetGeo.lat, targetGeo.lng, geometry.green_front.lat, geometry.green_front.lng)) : null;
      const middle = cell(haversineYards(targetGeo.lat, targetGeo.lng, pinGeo.lat, pinGeo.lng));
      const back = geometry.green_back ? cell(haversineYards(targetGeo.lat, targetGeo.lng, geometry.green_back.lat, geometry.green_back.lng)) : null;
      return { front, middle, back };
    }
    // Phase 4.3 — Mode 2 calibrated branch. When the user has marked
    // both tee and green on this curated-image hole, project the
    // target's canvas pixel via the 2-anchor calibration and use real
    // haversine math. F/B stay null (we don't have green-depth geo
    // from the 2-anchor model — would need a 3rd anchor). Middle is
    // the genuine yards from target → green per the marked positions.
    const calibratedTargetGeo = !usingGpsTile && calibration2Anchor
      ? projectCanvasToLatLngVia2Anchor(targetCanvas)
      : null;
    if (calibratedTargetGeo && greenOverrideGeo) {
      const yds = haversineYards(calibratedTargetGeo.lat, calibratedTargetGeo.lng, greenOverrideGeo.lat, greenOverrideGeo.lng);
      const middle = Number.isFinite(yds) ? Math.round(yds) : null;
      return { front: null as number | null, middle, back: null as number | null };
    }
    const h = courseHoles.find(x => x.hole === holeIndex);
    if (h && targetPx && teePx && pinPx) {
      // Pixel-axis interpolation against bundled hole distance. Used
      // whenever we're on the curated image (non-GPS tile), so dragging
      // Y/P actually moves the yardage numbers.
      const totalSpan = pinPx.y - teePx.y; // image-y +up, pin > tee
      const targetSpan = targetPx.y - teePx.y;
      const progress = totalSpan === 0 ? 0.5 : Math.max(0, Math.min(1, totalSpan === 0 ? 0.5 : targetSpan / totalSpan));
      const total = h.distance;
      const middleYd = Math.round((1 - progress) * total);
      // 2026-06-01 — Fix GH: don't fake F/B when bundled hole data
      // has no real front/back spread. Prior code computed
      // `greenDepth = (h.back - h.front) / 2` then returned
      // {middle - greenDepth, middle, middle + greenDepth}. When the
      // bundled data has front===back (or both 0 / both same as
      // middle), greenDepth=0 → all three cells render the same
      // number (Tim's screenshot: 45/45/45). That's misleading — it
      // implies we have F/B data when we don't. Render F/B as null
      // when the spread is zero or nonsensical so the UI shows "—"
      // honestly instead of three identical numbers.
      const hasRealGreenSpread =
        typeof h.front === 'number' && typeof h.back === 'number' &&
        h.front > 0 && h.back > 0 && h.back > h.front;
      if (!hasRealGreenSpread) {
        return { front: null as number | null, middle: middleYd, back: null as number | null };
      }
      const greenDepth = (h.back - h.front) / 2;
      return { front: Math.max(0, middleYd - greenDepth), middle: middleYd, back: middleYd + greenDepth };
    }
    if (h) {
      // 2026-06-01 — Fix GH: same honesty for the static fallback
      // (no target/tee/pin pixels yet — pre-mount render). Reject
      // front===back or zero values as "no real F/B data."
      const hasRealGreenSpread =
        typeof h.front === 'number' && typeof h.back === 'number' &&
        h.front > 0 && h.back > 0 && h.back > h.front;
      return {
        front: hasRealGreenSpread ? h.front : null,
        middle: h.distance ?? null,
        back: hasRealGreenSpread ? h.back : null,
      };
    }
    return { front: null as number | null, middle: null as number | null, back: null as number | null };
    // Phase 4.3 — calibration2Anchor + greenOverrideGeo + targetCanvas
    // added to deps so the calibrated Mode 2 branch recomputes when
    // user re-marks or drags the cart.
  }, [usingGpsTile, projection, targetPx, pinPx, teePx, geometry, courseHoles, holeIndex, calibration2Anchor, greenOverrideGeo, targetCanvas, projectCanvasToLatLngVia2Anchor]);

  // 2026-06-13 (Tim #6) — Golfshot-style layup planning. The hole's playing
  // distance (tee→green) decides whether the view shows one direct line or a
  // two-segment layup plan; the waypoint rides the tee→pin axis at the layup
  // carry point so par-5s read strategically instead of pretending one shot gets
  // home. Pure planner (utils/layupPlan) keeps the decision out of this render.
  const approachYards = useMemo(() => {
    const h = courseHoles.find(x => x.hole === holeIndex);
    return h?.distance ?? yardages.middle ?? null;
  }, [courseHoles, holeIndex, yardages.middle]);
  const aimPlan = useMemo(() => planAimLines(approachYards), [approachYards]);
  const layupCanvas = useMemo(() => {
    const f = layupFraction(aimPlan, approachYards);
    if (f == null) return null;
    return {
      x: teeCanvas.x + f * (pinCanvas.x - teeCanvas.x),
      y: teeCanvas.y + f * (pinCanvas.y - teeCanvas.y),
    };
  }, [aimPlan, approachYards, teeCanvas, pinCanvas]);

  // Carry distance — yards from tee to current yellow target. GPS path
  // uses haversine; pixel-fallback path interpolates against the bundled
  // hole distance so the carry label still updates in curated mode.
  const carryYards = useMemo(() => {
    if (usingGpsTile && targetPx && geometry?.tee) {
      const targetGeo = pixelsToLatLng(targetPx, projection!.center, projection!.zoom, projection!.bearing);
      // 2026-05-31 — Fix GA: same WGS84 guard as the yardages memo.
      if (!isValidWgs84(targetGeo.lat, targetGeo.lng) || !isValidWgs84(geometry.tee.lat, geometry.tee.lng)) {
        console.error('[smartvision/carry] out-of-range coord — skipping', { targetGeo, tee: geometry.tee });
        return null;
      }
      const yds = haversineYards(targetGeo.lat, targetGeo.lng, geometry.tee.lat, geometry.tee.lng);
      return Number.isFinite(yds) ? Math.round(yds) : null;
    }
    // Phase 4.3 — Mode 2 calibrated carry. Same 2-anchor pattern as
    // yardages: project target's canvas pixel via marked tee+green
    // anchors, then haversine target → marked tee.
    const calibratedTargetGeo = !usingGpsTile && calibration2Anchor
      ? projectCanvasToLatLngVia2Anchor(targetCanvas)
      : null;
    if (calibratedTargetGeo && teeOverrideGeo) {
      const yds = haversineYards(calibratedTargetGeo.lat, calibratedTargetGeo.lng, teeOverrideGeo.lat, teeOverrideGeo.lng);
      return Number.isFinite(yds) ? Math.round(yds) : null;
    }
    const h = courseHoles.find(x => x.hole === holeIndex);
    if (h && targetPx && teePx && pinPx) {
      const totalSpan = pinPx.y - teePx.y;
      const targetSpan = targetPx.y - teePx.y;
      const progress = totalSpan === 0 ? 0.5 : Math.max(0, Math.min(1, targetSpan / totalSpan));
      return Math.round(progress * h.distance);
    }
    return null;
  }, [usingGpsTile, projection, targetPx, teePx, pinPx, geometry, courseHoles, holeIndex, calibration2Anchor, teeOverrideGeo, targetCanvas, projectCanvasToLatLngVia2Anchor]);

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

  // ── Phase 4.4a/b: Shared cart position + GPS auto-reconcile ─────
  // When the user TAPS or DRAGS the cart marker, derive the cart's
  // lat/lng (Mode 1: pixelsToLatLng via projection; Mode 2: 2-anchor
  // calibration if tee+pin are marked). If derivable, propagate via
  // setMarkedFix so SmartFinder + the caddie brain + every other
  // GPS-reading surface sees the same position. Then bumpToActive
  // so the next live GPS tick arrives in ~1s (instead of up to 20s
  // in stationary mode) — that fresh fix automatically OVERWRITES
  // lastFix in gpsManager and the cart "auto-corrects" within
  // seconds, matching Tim's "if signal returns it auto-corrects" UX.
  //
  // No new auto-reconcile listener needed — gpsManager's existing
  // watchPositionAsync onUpdate writes every tick to lastFix
  // (overwriting marked positions naturally), so the SECOND tick
  // after the user's tap IS the reconciliation. We only need to
  // make sure that tick comes fast.
  // 2026-06-06 — Auto-reconcile pending flag: when commitCartCanvas
  // calls setMarkedFix, we want the NEXT live GPS tick (which lands
  // ~1s later via bumpToActive) to also update the visible cart
  // pixel + yardages so the on-screen cart moves to GPS truth. Set
  // here; consumed by the effect below watching markBumpTick.
  const pendingReconcileAtRef = useRef<number>(0);
  // Last committed cart lat/lng — shot logging reads this on a DISCRETE
  // commit (tap-end / drag-end), never per drag frame (would log phantoms).
  const lastCartFixRef = useRef<{ lat: number; lng: number } | null>(null);

  const commitCartCanvas = useCallback((canvasCoord: { x: number; y: number }) => {
    setTargetByHole(prev => ({ ...prev, [holeIndex]: canvasCoord }));
    let lat: number | null = null;
    let lng: number | null = null;
    if (usingGpsTile && projection) {
      try {
        const px = { x: canvasCoord.x - imageW / 2, y: imageH / 2 - canvasCoord.y };
        const geo = pixelsToLatLng(px, projection.center, projection.zoom, projection.bearing);
        if (Number.isFinite(geo.lat) && Number.isFinite(geo.lng) && isValidWgs84(geo.lat, geo.lng)) {
          lat = geo.lat;
          lng = geo.lng;
        }
      } catch (e) {
        console.log('[smartvision] commit cart Mode 1 derive failed:', e);
      }
    } else if (calibration2Anchor) {
      const geo = projectCanvasToLatLngVia2Anchor(canvasCoord);
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng) && isValidWgs84(geo.lat, geo.lng)) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }
    if (lat == null || lng == null) { lastCartFixRef.current = null; return; }
    // 2026-06-07 GPS-audit #3: only propagate to setMarkedFix when the
    // SmartVision screen is on the SAME hole as the live round. If
    // the user is browsing other holes (e.g. peeking ahead at hole 7
    // while playing hole 3), a tap on hole-7 image derives lat/lng
    // for hole 7 — writing that to lastFix would corrupt the cockpit
    // location tag, shotLocationService, and the brain context with
    // wrong-hole coords. The visual cart still places on the canvas
    // (setTargetByHole above); we just skip the global fix update.
    if (isRoundActive && holeIndex !== currentHole) {
      console.log('[smartvision] cart commit visualization-only (browsing hole', holeIndex, 'while currentHole=', currentHole, ')');
      pendingReconcileAtRef.current = 0;
      lastCartFixRef.current = null;
      return;
    }
    try {
      // Mark accuracy as null — this is a user-placed position, not a
      // GPS reading. classifyAccuracy treats null accuracy as "no
      // quality info" so downstream consumers don't claim a precision
      // we don't have.
      setMarkedFix(lat, lng, null);
      bumpToActive('smartvision_cart_tap');
      // Arm the reconcile flag so the next markBumpTick (live GPS
      // arrival) projects the new fix back to canvas and snaps the
      // cart visually + recomputes yardages from GPS truth.
      pendingReconcileAtRef.current = Date.now();
    } catch (e) {
      console.log('[smartvision] commit cart setMarkedFix failed:', e);
    }
    // 2026-06-07 — Stash the committed cart fix. Shot logging happens on a
    // DISCRETE commit (tap-end / drag-end → maybeTrackShot), NEVER here:
    // commitCartCanvas runs per drag frame, so logging here logged dozens
    // of phantom shots per drag and inflated the score.
    lastCartFixRef.current = { lat, lng };
  }, [holeIndex, usingGpsTile, projection, imageW, imageH, calibration2Anchor, projectCanvasToLatLngVia2Anchor, currentHole, isRoundActive]);

  // Log a shot from the last committed cart fix — called only on a DISCRETE
  // commit (tap-end / drag-end), so a drag can't mint phantom shots. One
  // tracked shot is pending at a time until the user confirms the sheet.
  const maybeTrackShot = useCallback(() => {
    const fix = lastCartFixRef.current;
    if (!fix) return;
    if (!isRoundActive || holeIndex !== currentHole) return;
    if (trackedShot) return;
    try {
      const r = verifyShotAtLocation(fix);
      if (r.ok) setTrackedShot(r);
    } catch (e) {
      console.log('[smartvision] shot tracking failed (non-fatal):', e);
    }
  }, [isRoundActive, holeIndex, currentHole, trackedShot]);

  // 2026-06-06 — Auto-reconcile: when a live GPS tick arrives within
  // 10s of a user mark, project the new GPS position to canvas and
  // update targetByHole so the cart marker visually moves to GPS
  // truth AND the yardage memos recompute against the corrected
  // position. Without this, the cart stayed pinned at the tapped
  // pixel forever and "auto-reconciles within seconds" was UX-broken
  // (cross-commit audit bug B).
  useEffect(() => {
    if (pendingReconcileAtRef.current === 0) return;
    if (Date.now() - pendingReconcileAtRef.current > 10_000) {
      pendingReconcileAtRef.current = 0;
      return;
    }
    const fix = getLastFix();
    if (!fix || !fix.location) return;
    let canvasCoord: { x: number; y: number } | null = null;
    if (usingGpsTile && projection) {
      try {
        const px = projectToPixels(
          { lat: fix.location.lat, lng: fix.location.lng },
          projection.center, projection.zoom, projection.bearing,
        );
        canvasCoord = clampToCanvas({ x: px.x + imageW / 2, y: imageH / 2 - px.y });
      } catch { /* skip — leave existing target */ }
    } else if (calibration2Anchor) {
      // For Mode 2 we need the inverse: lat/lng → canvas. The 2-anchor
      // calibration only gives canvas → lat/lng. We can derive inverse
      // by parameterizing along the same axis: t = (geo - teeGeo) /
      // (greenGeo - teeGeo) in lat or lng (use whichever has larger
      // delta to avoid division by tiny number). Then canvas = teePx +
      // t * (pinPx - teePx).
      const tG = calibration2Anchor.teeGeo;
      const gG = calibration2Anchor.greenGeo;
      const dLat = gG.lat - tG.lat;
      const dLng = gG.lng - tG.lng;
      const useLat = Math.abs(dLat) > Math.abs(dLng);
      const t = useLat
        ? (fix.location.lat - tG.lat) / (dLat || 1)
        : (fix.location.lng - tG.lng) / (dLng || 1);
      const tA = calibration2Anchor.teePx;
      canvasCoord = clampToCanvas({
        x: tA.x + t * calibration2Anchor.axisDx,
        y: tA.y + t * calibration2Anchor.axisDy,
      });
    }
    if (canvasCoord) {
      setTargetByHole(prev => ({ ...prev, [holeIndex]: canvasCoord! }));
      pendingReconcileAtRef.current = 0;
      console.log('[smartvision] cart auto-reconciled to live GPS');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markBumpTick]);

  const onTargetDrag = useCallback((dx: number, dy: number) => {
    if (!targetCanvas) return;
    if (!targetDragStartRef.current) targetDragStartRef.current = targetCanvas;
    const next = clampToCanvas({
      x: targetDragStartRef.current.x + dx,
      y: targetDragStartRef.current.y + dy,
    });
    commitCartCanvas(next);
  }, [targetCanvas, clampToCanvas, commitCartCanvas]);

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

  // 2026-06-06 — Phase 4.1: tap-to-place gesture. Tapping ANYWHERE on
  // the canvas (image background, not on a marker — markers have their
  // own Pan gestures that take touch priority) drops the cart (Y target)
  // at the tap location. Combined with the cart-icon visual swap, this
  // is the "tap your position" UX. maxDelta keeps a drag from also
  // firing this tap (so dragging markers stays clean).
  const canvasTapGesture = useMemo(() => {
    return Gesture.Tap()
      .runOnJS(true)
      .maxDeltaX(8)
      .maxDeltaY(8)
      .onEnd((e) => {
        const next = clampToCanvas({ x: e.x, y: e.y });
        // 2026-06-06 — Phase 4.4a/b: commitCartCanvas also propagates
        // the derived lat/lng to setMarkedFix + bumpToActive so the
        // cart position is shared with SmartFinder / brain and a
        // fresh live GPS tick arrives within ~1s to auto-reconcile.
        commitCartCanvas(next);
        maybeTrackShot();
      });
  }, [clampToCanvas, commitCartCanvas, maybeTrackShot]);

  // 2026-06-06 — Phase 4.1: GPS-init the cart on hole entry when we
  // have Mapbox geometry to project against (Mode 1 — usingGpsTile).
  // For curated bundled-image holes (Mode 2 — Echo Hills, Sunnyvale,
  // etc.) we have no pixel↔latlng mapping, so we let the existing
  // pixel-axis interpolation default (midpoint of tee→pin) stand.
  // Only seeds when the user hasn't yet set their own cart position
  // for this hole (targetByHole[holeIndex] is undefined). Once they
  // drag or tap, their pick wins until they leave the screen.
  useEffect(() => {
    if (targetByHole[holeIndex]) return; // user already placed cart this session
    if (!usingGpsTile || !projection) return; // Mode 2 — no projection
    const fix = getLastFix();
    if (!fix || !fix.location || typeof fix.location.lat !== 'number' || typeof fix.location.lng !== 'number') return;
    try {
      const px = projectToPixels(
        { lat: fix.location.lat, lng: fix.location.lng },
        projection.center,
        projection.zoom,
        projection.bearing,
      );
      // 2026-06-07 GPS-audit #7: skip seeding when the projected
      // pixel falls outside the canvas bounds. Common cause: user
      // opens SmartVision in the parking lot or on a different hole
      // than the one the image represents — projectToPixels returns
      // an off-canvas coord; clampToCanvas would pin the cart to the
      // edge of the image, then pixelsToLatLng round-trip yields a
      // lat/lng at the image boundary (NOT the player's real
      // position) and yardages would render confidently wrong.
      // Leave the midpoint default; user can tap to place when they
      // actually want to position themselves on the image.
      const unclamped = { x: px.x + imageW / 2, y: imageH / 2 - px.y };
      const onCanvas =
        unclamped.x >= 0 && unclamped.x <= imageW &&
        unclamped.y >= 0 && unclamped.y <= imageH;
      if (!onCanvas) {
        console.log('[smartvision] gps-init skipped — fix is off-image', unclamped);
        return;
      }
      const canvasCoord = clampToCanvas(unclamped);
      setTargetByHole(prev => ({ ...prev, [holeIndex]: canvasCoord }));
    } catch (e) {
      console.log('[smartvision] gps-init cart failed (non-fatal):', e);
    }
    // 2026-06-06 — markBumpTick added so the effect re-runs when a
    // GPS fix lands AFTER mount. Without it, opening SmartVision
    // before the first fix arrives left the cart stuck at the
    // midpoint default for the rest of the hole.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeIndex, usingGpsTile, projection?.center, projection?.zoom, projection?.bearing, imageW, imageH, markBumpTick]);

  // ── Hole nav ────────────────────────────────────────────────────
  const goPrev = () => setHoleIndex(i => Math.max(1, i - 1));
  const goNext = () => setHoleIndex(i => Math.min(totalHoles, i + 1));

  // 2026-06-04 — HolePlan removed. onSaveStrategy + restore-plan effect
  // demolished. Marker drags now drive only in-session per-hole state
  // (targetByHole / pinByHole), no cross-session persistence.

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
            {/* 2026-05-23 — Glasses badge under the hole/par chip.
                Surfaces when DAT is connected so the player sees that
                SmartVision will get multimodal grounding from the
                glasses POV. Renders nothing on non-DAT builds. */}
            <GlassesStatusBadge />
          </View>
          <TouchableOpacity onPress={goNext} disabled={holeIndex >= (totalHoles)} style={styles.iconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-forward" size={22} color={holeIndex >= (totalHoles) ? '#374151' : '#ffffff'} />
          </TouchableOpacity>
        </View>
        {/* Imagery mode toggle — cycles auto → curated → gps. Icon +
            label so the current mode is readable without guessing. Lets
            the user switch between live satellite (when geometry is
            available) and bundled screenshots. */}
        <TouchableOpacity
          onPress={() => {
            const next = imageryMode === 'auto' ? 'curated' : imageryMode === 'curated' ? 'gps' : 'auto';
            setImageryMode(next);
          }}
          style={styles.modeBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={`Imagery mode: ${imageryMode === 'gps' ? 'Satellite' : imageryMode === 'curated' ? 'Photo' : 'Auto'} (tap to cycle)`}
        >
          <Ionicons
            name={imageryMode === 'gps' ? 'globe' : imageryMode === 'curated' ? 'image' : 'sparkles'}
            size={20}
            color="#ffffff"
          />
          <Text style={styles.modeBtnText}>
            {imageryMode === 'gps' ? 'Satellite' : imageryMode === 'curated' ? 'Photo' : 'Auto'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 2026-05-23 — Live Strategy card. Auto-renders when the
          unified vision context has rich data (active round +
          green geometry + recent vision frame). Falls back to null
          off the rich-context path so the SmartVision canvas stays
          uncluttered. Tapping routes the user to the Caddie tab for
          a deeper read. */}
      <View style={{ paddingHorizontal: 12, paddingTop: 6 }} pointerEvents="box-none">
        <SmartVisionLiveStrategy
          onPress={() => router.push('/' as never)}
        />
      </View>

      {/* Phase 406 — split-screen container. On landscape, image
          canvas + bottom panel sit side-by-side in a row so the panel
          becomes a right-side column. On portrait, vertical flow is
          unchanged. */}
      <View style={{ flexDirection: isSplit ? 'row' : 'column', flex: 1 }}>
      {/* Image canvas + markers. Phase 4.1 — wrapped in a GestureDetector
          with a Tap gesture so tapping the image background drops the
          cart (Y target) at the tap location. Marker Pan gestures take
          touch priority because they're attached to individual marker
          subviews; Tap only fires on background taps. */}
      <GestureDetector gesture={canvasTapGesture}>
      <View style={{ width: imageW, height: imageH, backgroundColor: '#0a1f12' }}>
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

        {/* 2026-05-17 — SVG overlay rebuilt to Bluegolf-class.
            Bottom: fairway polygons (translucent green tint over satellite).
            Above that: green polygon (darker fill + bright stroke).
            Above that: tee polygon (yellow tint).
            Above that: bunkers (sand fill) and water (blue fill).
            Above that: tee→target→pin centerline + draggable markers
                        (in their own layer below).
            All projected via the same projectToPixels helper that
            anchors the T/Y/P markers, so polygons align with the
            satellite tile pixel-for-pixel. */}
        <Svg
          width={imageW}
          height={imageH}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          {projection && geometry && (() => {
            const polyToPoints = (poly: { lat: number; lng: number }[]): string => {
              return poly
                .map(p => {
                  const off = projectToPixels(p, projection.center, projection.zoom, projection.bearing);
                  return `${(imageW / 2 + off.x).toFixed(1)},${(imageH / 2 - off.y).toFixed(1)}`;
                })
                .join(' ');
            };
            const fairways = geometry.fairway_polygons ?? [];
            const bunkers = geometry.bunkers ?? [];
            const water = geometry.water_hazards ?? [];
            const greenPoly = geometry.green_polygon ?? null;
            const teePoly = geometry.tee_polygon ?? null;
            return (
              <SvgG>
                {fairways.map((poly, i) => (
                  <SvgPolygon
                    key={'fw-' + i}
                    points={polyToPoints(poly)}
                    fill="rgba(78,163,106,0.35)"
                    stroke="rgba(78,163,106,0.85)"
                    strokeWidth={1}
                  />
                ))}
                {water.map((w, i) => (
                  <SvgPolygon
                    key={'wh-' + i}
                    points={polyToPoints(w.polygon)}
                    fill="rgba(56,189,248,0.55)"
                    stroke="rgba(14,116,144,0.95)"
                    strokeWidth={1.5}
                  />
                ))}
                {bunkers.map((b, i) => (
                  <SvgPolygon
                    key={'bk-' + i}
                    points={polyToPoints(b.polygon)}
                    fill="rgba(252,211,77,0.7)"
                    stroke="rgba(180,140,40,0.95)"
                    strokeWidth={1.5}
                  />
                ))}
                {teePoly && (
                  <SvgPolygon
                    points={polyToPoints(teePoly)}
                    fill="rgba(251,191,36,0.45)"
                    stroke="rgba(180,140,40,0.95)"
                    strokeWidth={1.5}
                  />
                )}
                {greenPoly && (
                  <SvgPolygon
                    points={polyToPoints(greenPoly)}
                    fill="rgba(126,211,163,0.7)"
                    stroke="rgba(255,255,255,0.95)"
                    strokeWidth={2}
                  />
                )}
              </SvgG>
            );
          })()}
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
          {/* 2026-05-17 — Bluegolf-style running yardage labels at the
              midpoints of (tee→target) and (target→pin) line segments.
              Stroke-then-fill gives a halo for legibility on whatever
              the satellite tile happens to be underneath. */}
          {carryYards != null && (
            <SvgText
              x={(teeCanvas.x + targetCanvas.x) / 2 + 14}
              y={(teeCanvas.y + targetCanvas.y) / 2 + 5}
              fill="#facc15"
              stroke="#000"
              strokeWidth={3}
              fontSize={18}
              fontWeight="900"
            >{carryYards}</SvgText>
          )}
          {yardages.middle != null && (
            <SvgText
              x={(targetCanvas.x + pinCanvas.x) / 2 + 14}
              y={(targetCanvas.y + pinCanvas.y) / 2 + 5}
              fill="#fff"
              stroke="#000"
              strokeWidth={3}
              fontSize={18}
              fontWeight="900"
            >{yardages.middle}</SvgText>
          )}
          {/* 2026-06-13 (Tim #6) — layup waypoint. Only drawn when the green is
              200y+ away (the two-line plan); under 200y the view stays a single
              direct line. The "leaves Ny" label = the approach you set up. */}
          {layupCanvas && aimPlan.mode === 'layup' && aimPlan.leaveYards != null && (
            <>
              <SvgCircle
                cx={layupCanvas.x}
                cy={layupCanvas.y}
                r={7}
                fill="#f97316"
                stroke="#ffffff"
                strokeWidth={2}
              />
              <SvgText
                x={layupCanvas.x + 12}
                y={layupCanvas.y - 9}
                fill="#f97316"
                stroke="#000"
                strokeWidth={3}
                fontSize={13}
                fontWeight="900"
              >{`LAY UP · ${aimPlan.leaveYards} in`}</SvgText>
            </>
          )}
        </Svg>

        {/* Markers — direct canvas coords. */}
        {/* 2026-05-19 — T marker now draggable in active rounds too.
            Tim's report: geometry.tee often lands off the actual tee
            box on curated photos because the image framing isn't
            pixel-mapped to the GPS axis. Locking T mid-round forced
            the user to live with a misplaced marker. Letting them
            re-anchor it on the fly is the right call — fat-finger
            risk is minimal (T isn't a high-tap-frequency element). */}
        {/* 2026-05-26 — Fix DJ: gate marker render on !loading so the
            T/P/Y markers don't render at default positions (center-top,
            center-bottom, center) before the geometry resolves — only
            to SNAP into real positions a moment later. The brief
            flicker was visible on every hole switch. Now markers appear
            at their final positions once the image + geometry load. */}
        {!loading && (
          <>
            {/* 2026-06-13 (Tim #6) — the T clears once you CAPTURE your spot
                (place/drag the Y target). Before capture it's draggable to
                re-anchor the tee; after, the view is just your line(s) + pin. */}
            {!targetOverride && (
              <Marker
                kind="T"
                x={teeCanvas.x}
                y={teeCanvas.y}
                draggable
                onDrag={onTeeDrag}
                onDragEnd={() => { teeDragStartRef.current = null; }}
              />
            )}
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
              onDragEnd={() => { targetDragStartRef.current = null; maybeTrackShot(); }}
            />
          </>
        )}

        {/* 2026-05-19 — Live player-position marker. Distinct from the
            T/Y/P set: filled orange disc with a white ring + tiny cart
            icon, smaller than the planning markers so it doesn't fight
            them visually. Renders only when a fix + projection are
            both available. */}
        {playerCanvas ? (
          <>
            {/* 2026-05-25 — Fix Q: brand-green halo + larger cart so
                the live position dot is unmissable. Both layers
                update on every GPS tick via markBumpTick → playerCanvas
                memo recompute. */}
            <View
              pointerEvents="none"
              style={[
                styles.playerCartHalo,
                { left: playerCanvas.x - 28, top: playerCanvas.y - 28 },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.playerCart,
                { left: playerCanvas.x - 18, top: playerCanvas.y - 18 },
              ]}
            >
              <Ionicons name="navigate" size={18} color="#0d1a0d" />
            </View>
          </>
        ) : null}

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

        {/* First-time hint. Phase 4.1 — updated copy: tap-to-place is
            the new primary interaction; drag still works. */}
        <View pointerEvents="none" style={styles.measureHint}>
          <Ionicons name="hand-left-outline" size={12} color="#facc15" />
          <Text style={styles.measureHintText}>Tap to place your position · Drag P for pin</Text>
        </View>

        {/* 2026-06-04 — Save-strategy bookmark button removed with HolePlan. */}
      </View>
      </GestureDetector>

      {/* 2026-06-06 — Phase 4.2 + 4.3: inline Mark Tee / Mark Pin buttons.
          - Mode 1 (Mapbox geometry, usingGpsTile): T/P markers already
            have real lat/lng via projection. Buttons invert the marker
            pixel via pixelsToLatLng → write to course overrides.
          - Mode 2 (curated bundled image, no projection): no pixel→geo
            available, so we use the user's CURRENT GPS fix as the geo
            anchor — user is expected to be physically standing at the
            tee (or near the green) when they tap. The marker's canvas
            position acts as the pixel anchor; with both T and P marked,
            calibration2Anchor activates and downstream haversine math
            (yardages + carryYards) becomes real, not pixel-interpolated. */}
      {courseId && (
        <View style={styles.markRow}>
          <TouchableOpacity
            style={styles.markBtn}
            onPress={() => {
              try {
                let teeGeoCoords: { lat: number; lng: number } | null = null;
                if (usingGpsTile && projection) {
                  const g = pixelsToLatLng(teePx, projection.center, projection.zoom, projection.bearing);
                  if (Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
                    teeGeoCoords = { lat: g.lat, lng: g.lng };
                  }
                } else {
                  // Mode 2: use current GPS fix (user stands at the tee).
                  const fix = getLastFix();
                  if (fix && Number.isFinite(fix.location.lat) && Number.isFinite(fix.location.lng)) {
                    teeGeoCoords = { lat: fix.location.lat, lng: fix.location.lng };
                  }
                }
                if (!teeGeoCoords) {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const toastMod = require('../store/toastStore') as typeof import('../store/toastStore');
                  toastMod.useToastStore.getState().show('No GPS fix — stand at the tee and try again');
                  return;
                }
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const teeMod = require('../services/courseTeeOverrides') as typeof import('../services/courseTeeOverrides');
                void teeMod.setTeeOverride(courseId, holeIndex, teeGeoCoords);
                // Phase 4.3 — lock the marker's canvas position into
                // teeByHole so subsequent drags of T don't shift the
                // calibration anchor unexpectedly. User can re-mark to
                // re-anchor.
                if (!usingGpsTile) {
                  setTeeByHole(prev => ({ ...prev, [holeIndex]: { x: teeCanvas.x, y: teeCanvas.y } }));
                }
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const toastMod = require('../store/toastStore') as typeof import('../store/toastStore');
                toastMod.useToastStore.getState().show(`Tee marked for hole ${holeIndex}`);
              } catch (e) {
                console.log('[smartvision] mark tee failed (non-fatal):', e);
              }
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="flag-outline" size={16} color="#ffffff" />
            <Text style={styles.markBtnText}>Mark T</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.markBtn}
            onPress={() => {
              try {
                let pinGeoCoords: { lat: number; lng: number } | null = null;
                if (usingGpsTile && projection) {
                  const g = pixelsToLatLng(pinPx, projection.center, projection.zoom, projection.bearing);
                  if (Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
                    pinGeoCoords = { lat: g.lat, lng: g.lng };
                  }
                } else {
                  const fix = getLastFix();
                  if (fix && Number.isFinite(fix.location.lat) && Number.isFinite(fix.location.lng)) {
                    pinGeoCoords = { lat: fix.location.lat, lng: fix.location.lng };
                  }
                }
                if (!pinGeoCoords) {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const toastMod = require('../store/toastStore') as typeof import('../store/toastStore');
                  toastMod.useToastStore.getState().show('No GPS fix — stand near the green and try again');
                  return;
                }
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const greenMod = require('../services/courseGreenOverrides') as typeof import('../services/courseGreenOverrides');
                void greenMod.setGreenOverride(courseId, holeIndex, pinGeoCoords);
                if (!usingGpsTile) {
                  setPinByHole(prev => ({ ...prev, [holeIndex]: { x: pinCanvas.x, y: pinCanvas.y } }));
                }
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const toastMod = require('../store/toastStore') as typeof import('../store/toastStore');
                toastMod.useToastStore.getState().show(`Pin marked for hole ${holeIndex}`);
              } catch (e) {
                console.log('[smartvision] mark pin failed (non-fatal):', e);
              }
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="location-outline" size={16} color="#ffffff" />
            <Text style={styles.markBtnText}>Mark P</Text>
          </TouchableOpacity>
        </View>
      )}

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
        {/* 2026-05-17 — Bluegolf-style yardage book. Origin = tee for
            planning; per-bunker / per-water polygon distances. Only
            renders on the landscape side panel (vertical space); the
            portrait bottom strip doesn't have the height. */}
        {isSplit && (
          <YardageBookPanel geometry={geometry} origin={teeCoord} />
        )}
      </View>
      </View>{/* close split-screen container */}

      {/* Shot Tracked sheet — floats above the canvas after a cart-mark verify. */}
      {trackedShot ? (
        <View style={[styles.shotTrackedWrap, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
          <ShotTrackedSheet
            result={trackedShot}
            onCorrectClub={(club: ClubName) => {
              if (trackedShot.shotId) correctShotClub(trackedShot.shotId, club);
              setTrackedShot({ ...trackedShot, club });
            }}
            onDismiss={() => {
              if (trackedShot.shotId) confirmTrackedShot(trackedShot.shotId);
              setTrackedShot(null);
            }}
          />
        </View>
      ) : null}
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
  shotTrackedWrap: { position: 'absolute', left: 12, right: 12, zIndex: 50 },
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
  // 2026-06-04 — modeBtn: icon + visible label for the imagery-mode cycler.
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  modeBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
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
  // 2026-06-06 — Phase 4.2: Mark Tee / Mark Pin button row.
  markRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  markBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: 'rgba(0, 200, 150, 0.85)',
    borderRadius: 8,
  },
  markBtnText: {
    color: '#ffffff', fontSize: 13, fontWeight: '700', letterSpacing: 0.3,
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
  // 2026-05-19 — Player-position cart marker. Distinct visual from
  // the T/Y/P planning markers.
  // 2026-05-25 — Fix Q: bumped 24→36px + brand-green ring + outer
  // halo so the live moving cart icon is unmissable on Palms (Tim
  // wanted the harness-style "GPS is moving" visual feedback on the
  // real hole view). Re-renders on every GPS fix via the existing
  // markBumpTick subscription, so it tracks the cart's motion.
  playerCart: {
    position: 'absolute',
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: '#00C896',
    borderWidth: 3, borderColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#00C896', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85, shadowRadius: 8, elevation: 10,
    zIndex: 25,
  },
  playerCartHalo: {
    position: 'absolute',
    width: 56, height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#00C896',
    opacity: 0.35,
    zIndex: 24,
  },
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
