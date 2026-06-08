import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  useWindowDimensions,
  ActivityIndicator,
  PanResponder,
  Alert,
} from 'react-native';
// 2026-05-26 — Fix CH: theme the StyleSheet so light mode renders correctly.
import { useTheme } from '../contexts/ThemeContext';
import KevinBadge from '../components/KevinBadge';
import { useKevinPresence } from '../contexts/KevinPresenceContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useKeepAwake } from 'expo-keep-awake';
import Svg, { Line, Circle, Text as SvgText } from 'react-native-svg';
import { File, Paths } from 'expo-file-system';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRoundStore } from '../store/roundStore';
import { useCourseGeometryOverrideStore } from '../store/courseGeometryOverrideStore';
// Per-(course, hole) image marker calibration. Persisted across rounds
// so once the user drags the tee/pin to where they actually sit on a
// hole image, the markers come up there on every subsequent visit.
import { useHoleMarkerCalibrationStore } from '../store/holeMarkerCalibrationStore';
import VectorHoleView from '../components/smartvision/VectorHoleView';
import GolfshotHoleView from '../components/smartvision/GolfshotHoleView';
import { ShareToSocial } from '../components/ShareToSocial';
import { useTranslation } from 'react-i18next';
import {
  getLatestMetaGlassesMedia,
  processMetaGlassesPhoto,
  type MetaGlassesAsset,
} from '../services/metaGlasses/importService';
import { uploadMetaVideoForTempoAnalysis } from '../services/metaGlasses/videoAudioService';
import { getHoleGeometry } from '../services/courseGeometryService';
import { speak, configureAudioForSpeech } from '../services/voiceService';
import { useSmartVision } from '../contexts/SmartVisionContext';
import PALMS_IMAGES from '../data/palmsImages';
import { getLocalHoleImageById, getLocalHoleImage } from '../data/localCourseImages';
import { getHoleImageryUrl, isMapboxConfigured } from '../services/mapboxImagery';
import {
  getLandmarksForHole,
  resolveCourseKey,
  type Landmark,
} from '../services/landmarks';

// ─── GPS HELPERS ──────────────────────────

// 2026-05-31 — Fix GA: consolidated to canonical haversine. Same
// rationale as the smartvision.tsx update — three inline copies of
// the same formula was a maintenance liability and the deterministic
// 246yd artifact in the harness traced to one of these unguarded
// inline implementations being fed out-of-range coords. WGS84 guard
// returns NaN on bad input (caller must check Number.isFinite).
import { haversineYards as canonicalHaversineYards } from '../utils/geoDistance';

const CLUBS = [
  'Driver', '3W', '5W', 'Hybrid',
  '3i', '4i', '5i', '6i', '7i', '8i', '9i',
  'PW', 'GW', 'SW', 'LW', 'Putter',
];

// 2026-05-24 — Per-hole screenshot override. When a CourseHole entry has
// `backgroundImageUri` set (Tim or owner curated a hand-picked image for
// a hole where Mapbox is poor), return that URI; otherwise null and the
// existing local → Mapbox → Google chain in holeImageMapper takes over.
// Caller passes the result as `imageOverrideUri` to GolfshotHoleView.
// Note: this is a one-shot read; if the user mutates courseHoles
// mid-screen the override won't refresh until the next mount. Good
// enough — overrides are curated at course-data ingest, not at runtime.
function getHoleBackgroundUri(courseId: string | null, holeNumber: number): string | null {
  void courseId;
  const { courseHoles } = useRoundStore.getState();
  const courseHole = courseHoles.find((h) => h.hole === holeNumber);
  return courseHole?.backgroundImageUri ?? null;
}

// ─── SATELLITE CACHE ──────────────────────
const SATELLITE_CACHE: Record<string, string> = {};

function isValidWgs84(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

const haversineYards = (
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number => {
  if (!isValidWgs84(lat1, lng1) || !isValidWgs84(lat2, lng2)) {
    console.error('[hole-view/yardage] coord out of WGS84 range — skipping haversine', {
      a: { lat: lat1, lng: lng1 },
      b: { lat: lat2, lng: lng2 },
    });
    return NaN;
  }
  return canonicalHaversineYards({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
};

const getHoleHeading = (
  teeLat: number, teeLng: number,
  greenLat: number, greenLng: number,
): number => {
  const dLng = (greenLng - teeLng) * Math.PI / 180;
  const φ1 = teeLat * Math.PI / 180;
  const φ2 = greenLat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

const getHoleZoom = (distance: number, par: number): number => {
  if (par === 3 || distance < 180) return 18;
  if (distance < 400) return 17;
  return 16;
};

const mppForZoom = (zoom: number): number => {
  if (zoom === 18) return 1.19;
  if (zoom === 17) return 2.39;
  return 4.78;
};

// ─── COMPONENT ────────────────────────────

export default function HoleView() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  // 2026-05-26 — Fix CH: theme-aware styles (was hardcoded dark palette).
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;

  // Landscape: image claims 68% of screen width, nearly full height
  const IMAGE_WIDTH = isLandscape ? Math.round(W * 0.68) - 4 : W - 24;
  const LANDSCAPE_IMG_H = Math.round(H * 0.88);

  // Phase AE follow-up — image cap reduced so the controls row + measuring
  // tool aren't pushed off-screen / under the tab bar. Was H*0.40 / 0.82
  // which forced the page to scroll under the measuring tool. Now the
  // image takes a controlled portion of the viewport (H*0.42 satellite,
  // H*0.55 bundled) leaving real estate for the data row that doesn't
  // require page scrolling.
  // Satellite: Google Maps tiles are 6:5 aspect
  const IMAGE_HEIGHT_SAT = isLandscape ? LANDSCAPE_IMG_H : Math.min(
    Math.round(IMAGE_WIDTH * (500 / 600)),
    Math.round(H * 0.42),
  );
  // Bundled: our Palms images are 705×1455 (≈2.064 tall)
  const IMAGE_HEIGHT_BUNDLED = isLandscape ? LANDSCAPE_IMG_H : Math.min(
    Math.round(IMAGE_WIDTH * (1455 / 705)),
    Math.round(H * 0.55),
  );

  const params = useLocalSearchParams();
  const hole = Number(String(params.hole ?? '')) || 1;
  const par = Number(String(params.par ?? '')) || 4;
  const distance = Number(String(params.distance ?? '')) || 150;
  const courseName = String(params.courseName ?? '');
  const isRoundActive = params.isRoundActive === 'true';
  const autoRunVision = params.autoRunVision === 'true';
  const courseId = String(params.courseId ?? '') || null;
  const paramTeeLat = Number(String(params.teeLat ?? '')) || 0;
  const paramTeeLng = Number(String(params.teeLng ?? '')) || 0;
  const paramMiddleLat = Number(String(params.middleLat ?? '')) || 0;
  const paramMiddleLng = Number(String(params.middleLng ?? '')) || 0;
  // Phase AG followup — per-user anchor override store. Tim taps "Anchor
  // tee" / "Anchor green" mid-round; capture saves current GPS to this
  // store; subsequent rounds use the captured coords automatically.
  // Reactive: subscribe to byCourse so re-anchoring re-renders yardage.
  const overrideAll = useCourseGeometryOverrideStore(s => s.byCourse);
  const override = courseId ? overrideAll[courseId]?.[hole] : undefined;
  const teeLat = override?.teeLat ?? paramTeeLat;
  const teeLng = override?.teeLng ?? paramTeeLng;
  const middleLat = override?.middleLat ?? paramMiddleLat;
  const middleLng = override?.middleLng ?? paramMiddleLng;
  const frontYards = Number(String(params.front ?? '')) || 0;
  const backYards = Number(String(params.back ?? '')) || 0;

  const { voiceGender, language } = useSettingsStore();
  // 2026-05-22 — Fix Q follow-up audit. Pull persona too so the vision
  // call below renders in the active caddie's voice.
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const { dominantMiss, firstName } = usePlayerProfileStore();
  const { setSmartVisionState } = useSmartVision();
  const {
    isRoundActive: roundActive,
    activeCourseId,
    activeCourse,
  } = useRoundStore();
  const { setMode } = useKevinPresence();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setMode('badge'); }, []);

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

  // ── Core state ─────────────────────────
  const [gpsCoords, setGpsCoords] = useState<{
    latitude: number; longitude: number; accuracy: number;
  } | null>(null);
  const [gpsValid, setGpsValid] = useState(false);
  const [centerYards, setCenterYards] = useState(distance);
  const [imageReady, _setImageReady] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [tapPoint, setTapPoint] = useState<{ x: number; y: number } | null>(null);
  const [measureYards, setMeasureYards] = useState<number | null>(null);
  const [analysisText, setAnalysisText] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // ── Bundled marker state ────────────────
  const [teePos, setTeePos] = useState({ x: 0, y: 0 });
  const [targetPos, setTargetPos] = useState({ x: 0, y: 0 });
  const [pinPos, setPinPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [markersReady, setMarkersReady] = useState(false);

  // ── Plan state ─────────────────────────
  const [teeClub, setTeeClub]         = useState<string | null>(null);
  const [approachClub, setApproachClub] = useState<string | null>(null);
  const [pinClub, setPinClub]         = useState<string | null>(null);
  const [clubPickerFor, setClubPickerFor] = useState<'tee' | 'approach' | 'pin' | null>(null);

  // ── Landmark state ──────────────────────
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [teeLandmark, setTeeLandmark]         = useState<Landmark | null>(null);
  const [approachLandmark, setApproachLandmark] = useState<Landmark | null>(null);
  const [pinLandmark, setPinLandmark]         = useState<Landmark | null>(null);
  const [landmarkPickerFor, setLandmarkPickerFor] = useState<'tee' | 'approach' | 'pin' | null>(null);

  const prevDraggingRef = useRef(false);
  const planSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 2026-05-24 v1.2 — Share-to-Instagram capture target. react-native-
  // view-shot snapshots whatever's inside this ref. We wrap the imagery
  // card below so the share image is just the hole view, not the whole
  // screen chrome.
  const shareViewRef = useRef<View>(null);

  // 2026-05-24 v1.2.1 — Meta glasses media auto-detect. Polls the
  // Ray-Ban/Meta album every 10s while hole-view is mounted. Surfaces
  // a banner when a <60s-old photo lands. Native dep (expo-media-
  // library) is in package.json but lights up only after the next EAS
  // Build cuts; getLatestMetaGlassesMedia returns [] in the meantime.
  const { t: tMeta } = useTranslation();
  const [pendingMetaMedia, setPendingMetaMedia] = useState<MetaGlassesAsset | null>(null);
  useEffect(() => {
    let cancelled = false;
    const NEW_WINDOW_MS = 60_000;
    const POLL_MS = 10_000;
    const check = async () => {
      const recent = await getLatestMetaGlassesMedia(5);
      if (cancelled) return;
      const cutoff = Date.now() - NEW_WINDOW_MS;
      // 2026-05-24 v1.2.3 — Surface photos AND videos. Type-aware
      // analyze handler branches below: photo → vision analysis;
      // video → upload to /api/swing-tempo for ffmpeg-extracted
      // audio + tempo read (backend returns 501 until pipeline
      // ships).
      const newMedia = recent.find((a) => a.creationTime > cutoff);
      setPendingMetaMedia(newMedia ?? null);
    };
    void check();
    const interval = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  const handleAnalyzeMetaPhoto = useCallback(async () => {
    if (!pendingMetaMedia) return;
    try {
      if (pendingMetaMedia.mediaType === 'video') {
        // 2026-05-24 v1.2.3 — Video tempo path. Upload MP4 to the
        // backend; ffmpeg extracts the audio track and runs tempo
        // analysis (backswing/downswing ratio + impact pair). The
        // backend route is a 501 stub today — surfaces "not deployed
        // yet" honestly via tank_advice.
        const tempo = await uploadMetaVideoForTempoAnalysis(pendingMetaMedia.uri);
        Alert.alert('Tank', tempo.tank_advice);
      } else {
        const result = await processMetaGlassesPhoto(pendingMetaMedia.uri);
        // TODO (next sprint): POST result.processedUri to Tank vision API.
        // v1.2.1 confirmation only — flagged in the spec.
        Alert.alert('Tank', result.tankPrompt);
      }
    } catch (e) {
      console.log('[hole-view] meta analyze failed:', e);
    } finally {
      setPendingMetaMedia(null);
    }
  }, [pendingMetaMedia]);

  // Mutable refs — read inside PanResponder callbacks (stable, captured once)
  const teePosRef = useRef(teePos);
  teePosRef.current = teePos;
  const targetPosRef = useRef(targetPos);
  targetPosRef.current = targetPos;
  const pinPosRef = useRef(pinPos);
  pinPosRef.current = pinPos;
  const imgWRef = useRef(IMAGE_WIDTH);
  imgWRef.current = IMAGE_WIDTH;
  const imgHRef = useRef(IMAGE_HEIGHT_BUNDLED);
  imgHRef.current = IMAGE_HEIGHT_BUNDLED;

  // Shared pan state (stable ref, mutated by all three PanResponders)
  const panRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });

  // ── PanResponders (created once) ───────
  const teePR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      panRef.current.startX = evt.nativeEvent.pageX;
      panRef.current.startY = evt.nativeEvent.pageY;
      panRef.current.initX = teePosRef.current.x;
      panRef.current.initY = teePosRef.current.y;
      setIsDragging(true);
    },
    onPanResponderMove: (evt) => {
      const next = {
        x: Math.max(12, Math.min(imgWRef.current - 12,
          panRef.current.initX + evt.nativeEvent.pageX - panRef.current.startX)),
        y: Math.max(12, Math.min(imgHRef.current - 12,
          panRef.current.initY + evt.nativeEvent.pageY - panRef.current.startY)),
      };
      teePosRef.current = next;
      setTeePos(next);
    },
    onPanResponderRelease: () => setIsDragging(false),
    onPanResponderTerminate: () => setIsDragging(false),
  })).current;

  const targetPR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      panRef.current.startX = evt.nativeEvent.pageX;
      panRef.current.startY = evt.nativeEvent.pageY;
      panRef.current.initX = targetPosRef.current.x;
      panRef.current.initY = targetPosRef.current.y;
      setIsDragging(true);
    },
    onPanResponderMove: (evt) => {
      const next = {
        x: Math.max(12, Math.min(imgWRef.current - 12,
          panRef.current.initX + evt.nativeEvent.pageX - panRef.current.startX)),
        y: Math.max(12, Math.min(imgHRef.current - 12,
          panRef.current.initY + evt.nativeEvent.pageY - panRef.current.startY)),
      };
      targetPosRef.current = next;
      setTargetPos(next);
    },
    onPanResponderRelease: () => setIsDragging(false),
    onPanResponderTerminate: () => setIsDragging(false),
  })).current;

  const pinPR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      panRef.current.startX = evt.nativeEvent.pageX;
      panRef.current.startY = evt.nativeEvent.pageY;
      panRef.current.initX = pinPosRef.current.x;
      panRef.current.initY = pinPosRef.current.y;
      setIsDragging(true);
    },
    onPanResponderMove: (evt) => {
      const next = {
        x: Math.max(12, Math.min(imgWRef.current - 12,
          panRef.current.initX + evt.nativeEvent.pageX - panRef.current.startX)),
        y: Math.max(12, Math.min(imgHRef.current - 12,
          panRef.current.initY + evt.nativeEvent.pageY - panRef.current.startY)),
      };
      pinPosRef.current = next;
      setPinPos(next);
    },
    onPanResponderRelease: () => setIsDragging(false),
    onPanResponderTerminate: () => setIsDragging(false),
  })).current;

  const gpsWatchRef = useRef<Location.LocationSubscription | null>(null);

  // ── Image source resolution (Phase S — Mapbox primary, Google Maps fallback) ──
  // Mapbox: course-agnostic, single PNG per hole, cacheable, free tier
  // covers v1.0 beta. If MAPBOX token isn't configured yet, fall through
  // to Google Maps so SmartVision keeps working during the migration.
  // Phase S removed the hardcoded Palms screenshot path entirely.

  const getSatelliteUrl = useCallback((): string | null => {
    if (Math.abs(middleLat) < 0.01 || Math.abs(middleLng) < 0.01) return null;

    const hasTee = Math.abs(teeLat) > 0.01 && Math.abs(teeLng) > 0.01;

    // Try Mapbox first
    const mapboxUrl = getHoleImageryUrl(
      {
        courseId: null,
        holeNumber: hole,
        par,
        yardage: distance,
        tee: hasTee ? { lat: teeLat, lng: teeLng } : null,
        green: { lat: middleLat, lng: middleLng },
      },
      { width: 600, height: 500 },
    );
    if (mapboxUrl) return mapboxUrl;

    // Google Maps fallback (legacy)
    if (!mapsKey) return null;
    let centerLat = middleLat;
    let centerLng = middleLng;
    let heading = 0;
    if (hasTee) {
      centerLat = teeLat + (middleLat - teeLat) * 0.55;
      centerLng = teeLng + (middleLng - teeLng) * 0.55;
      heading = getHoleHeading(teeLat, teeLng, middleLat, middleLng);
    }
    const zoom = getHoleZoom(distance, par);
    return (
      'https://maps.googleapis.com/maps/api/staticmap' +
      '?center=' + centerLat + ',' + centerLng +
      '&zoom=' + zoom +
      '&size=600x500' +
      '&maptype=satellite' +
      (heading > 0 ? '&heading=' + heading : '') +
      '&key=' + mapsKey
    );
  }, [mapsKey, middleLat, middleLng, teeLat, teeLng, distance, par, hole]);

  const satelliteUrl = getSatelliteUrl();

  // 2026-05-17 — bundled imagery generalized to every local course (was
  // hardcoded to Palms only, which is why a Crystal Springs round whose
  // courseName fell through to the home-course label rendered Palms hole 1
  // with the T/A/P shot-planning markers). Now resolves by courseId
  // first (canonical) and only falls back to substring-matching when no
  // local:* id is present. PALMS_IMAGES kept as an explicit alias for
  // the Palms set since the shot-planning marker calibration was tuned
  // against that course's aspect ratio.
  const bundledImage: ReturnType<typeof require> | null =
    getLocalHoleImageById(courseId, hole) ??
    getLocalHoleImage(courseName, hole) ??
    (courseName.toLowerCase().includes('palms') ? (PALMS_IMAGES[hole] ?? null) : null);

  // Phase AN — when we have real tee + green coords (from anchor capture
  // or course geometry API), prefer the stylized vector renderer over
  // satellite/bundled. Vector renders instantly with no network and is
  // accurate from the data we actually have. Falls through to bundled
  // (Palms screenshots) or satellite (Mapbox/Google) when coords missing.
  const hasVectorCoords = Math.abs(teeLat) > 0.01 && Math.abs(teeLng) > 0.01 &&
                          Math.abs(middleLat) > 0.01 && Math.abs(middleLng) > 0.01;

  // 2026-05-22 — Golfshot-style routing.
  // Priority:
  //   1. bundled screenshot exists → Golfshot UX on top (Tim's photos)
  //   2. tee+green coords + Mapbox/Google configured → Golfshot UX on remote tile
  //   3. tee+green coords only → SVG vector view (Phase AN)
  //   4. Google URL only → legacy satellite + measure-mode UI
  //   5. nothing → empty state
  // GolfshotHoleView handles cases 1+2 (holeImageMapper picks source).
  type DisplayType = 'satellite' | 'none' | 'bundled' | 'vector';
  const canGolfshotRemote =
    hasVectorCoords && (isMapboxConfigured() || (process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '').length > 0);
  const displayType: DisplayType =
    bundledImage ? 'bundled'
    : canGolfshotRemote ? 'bundled' // route remote-tile holes through Golfshot too
    : hasVectorCoords ? 'vector'
    : satelliteUrl ? 'satellite'
    : 'none';

  // Vector and satellite share the same shorter aspect; bundled uses tall.
  const IMAGE_HEIGHT = displayType === 'bundled' ? IMAGE_HEIGHT_BUNDLED : IMAGE_HEIGHT_SAT;

  const _imageSource =
    displayType === 'bundled' ? bundledImage
    : displayType === 'satellite' ? { uri: satelliteUrl! }
    : null;

  // ── Yards per pixel (bundled only) ─────
  // Calibration: the markers initialize with tee at 0.87·H and pin at 0.10·H,
  // so the initial T→P pixel span is 0.77·H and represents `distance` yards.
  // Lock yardsPerPixel to that calibration so initial fromTeeYards +
  // approachYards equals `distance` exactly (the prior 0.80 constant
  // produced a ~4% under-read on every hole). The constant is image-relative
  // — moving markers later measures different pixel spans on the same image
  // scale, which is the intended behavior.
  const TEE_INIT_FRAC = 0.87;
  const PIN_INIT_FRAC = 0.10;
  const yardsPerPixel = distance / (IMAGE_HEIGHT_BUNDLED * (TEE_INIT_FRAC - PIN_INIT_FRAC) || 1);

  const fromTeeYards = useMemo(() => {
    const dx = targetPos.x - teePos.x;
    const dy = targetPos.y - teePos.y;
    return Math.round(Math.sqrt(dx * dx + dy * dy) * yardsPerPixel);
  }, [teePos, targetPos, yardsPerPixel]);

  const approachYards = useMemo(() => {
    const dx = pinPos.x - targetPos.x;
    const dy = pinPos.y - targetPos.y;
    return Math.round(Math.sqrt(dx * dx + dy * dy) * yardsPerPixel);
  }, [pinPos, targetPos, yardsPerPixel]);

  // ── Init bundled markers ────────────────
  // Reads any per-(course, hole) calibration the user has saved before
  // (via a prior drag → auto-save). When no calibration exists, falls
  // back to the historical defaults (0.5, 0.87) for tee and (0.5, 0.10)
  // for pin. This fixes "arbitrary marker locations" — once the user
  // drags markers to the actual tee/pin on a hole, that calibration is
  // persisted and re-used on every subsequent visit.
  useEffect(() => {
    if (displayType !== 'bundled' || markersReady) return;
    const calibration = courseId
      ? useHoleMarkerCalibrationStore.getState().getCalibration(courseId, hole)
      : null;
    const teeFracX    = calibration?.tee?.x    ?? 0.5;
    const teeFracY    = calibration?.tee?.y    ?? TEE_INIT_FRAC;
    const targetFracX = calibration?.target?.x ?? 0.5;
    const targetFracY = calibration?.target?.y ?? 0.52;
    const pinFracX    = calibration?.pin?.x    ?? 0.5;
    const pinFracY    = calibration?.pin?.y    ?? PIN_INIT_FRAC;
    const tee    = { x: IMAGE_WIDTH * teeFracX,    y: IMAGE_HEIGHT_BUNDLED * teeFracY };
    const target = { x: IMAGE_WIDTH * targetFracX, y: IMAGE_HEIGHT_BUNDLED * targetFracY };
    const pin    = { x: IMAGE_WIDTH * pinFracX,    y: IMAGE_HEIGHT_BUNDLED * pinFracY };
    teePosRef.current = tee;
    targetPosRef.current = target;
    pinPosRef.current = pin;
    setTeePos(tee);
    setTargetPos(target);
    setPinPos(pin);
    setMarkersReady(true);
  }, [displayType, IMAGE_WIDTH, IMAGE_HEIGHT_BUNDLED, markersReady, courseId, hole]);

  // 2026-06-04 — HolePlan removed. Auto-save / restore / lock callbacks
  // demolished alongside the store action. Marker positions still
  // persist via useHoleMarkerCalibrationStore (per-course/hole, survives
  // across rounds); the per-round HolePlan layer that wrapped them is gone.
  useEffect(() => {
    if (displayType !== 'bundled' || !markersReady || !roundActive) return;
    if (prevDraggingRef.current && !isDragging) {
      if (planSaveTimerRef.current) clearTimeout(planSaveTimerRef.current);
      planSaveTimerRef.current = setTimeout(() => {
        if (courseId) {
          useHoleMarkerCalibrationStore.getState().setCalibration(courseId, hole, {
            tee:    { x: teePos.x    / IMAGE_WIDTH, y: teePos.y    / IMAGE_HEIGHT_BUNDLED },
            target: { x: targetPos.x / IMAGE_WIDTH, y: targetPos.y / IMAGE_HEIGHT_BUNDLED },
            pin:    { x: pinPos.x    / IMAGE_WIDTH, y: pinPos.y    / IMAGE_HEIGHT_BUNDLED },
          });
        }
      }, 500);
    }
    prevDraggingRef.current = isDragging;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  const saveClubUpdate = useCallback((
    _nextTee: string | null,
    _nextApp: string | null,
    _nextPin: string | null,
  ) => {
    // HolePlan demolished — club picker now drives only local state; no
    // round-scoped persistence. Keeping the callback shape so the picker
    // component can call it without conditionals.
  }, []);

  const saveLandmarkUpdate = useCallback((
    _nextTee: Landmark | null,
    _nextApp: Landmark | null,
    _nextPin: Landmark | null,
  ) => {
    // HolePlan demolished — landmark picker now drives only local state.
  }, []);

  // ── GPS validity ───────────────────────
  const checkGpsValid = (coords: {
    latitude: number; longitude: number; accuracy: number;
  }): boolean =>
    Math.abs(coords.latitude) > 0.01 &&
    Math.abs(coords.longitude) > 0.01 &&
    coords.accuracy < 30;

  // ── GPS watcher ────────────────────────
  useEffect(() => {
    if (!isRoundActive) return;
    const startGPS = async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) return;
      gpsWatchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2 },
        (loc) => {
          const coords = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy ?? 99,
          };
          setGpsCoords(coords);
          const valid = checkGpsValid(coords);
          setGpsValid(valid);
          if (valid && middleLat !== 0 && middleLng !== 0) {
            const yards = haversineYards(coords.latitude, coords.longitude, middleLat, middleLng);
            if (yards > 5 && yards < 800) setCenterYards(Math.round(yards));
          }
        },
      );
    };
    startGPS();
    return () => { gpsWatchRef.current?.remove(); };
  }, [isRoundActive, middleLat, middleLng]);

  // ── SmartVision context ─────────────────
  useEffect(() => {
    setSmartVisionState({ isOpen: true, holeNumber: hole, par });
    return () => setSmartVisionState({ isOpen: false, analysisText: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (displayType !== 'bundled') setSmartVisionState({ centerYards });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerYards, displayType]);

  useEffect(() => {
    if (displayType !== 'bundled') setSmartVisionState({ measureYards });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureYards, displayType]);

  useEffect(() => {
    if (displayType === 'bundled' && markersReady) {
      setSmartVisionState({ centerYards: fromTeeYards, measureYards: approachYards });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromTeeYards, approachYards, displayType, markersReady]);

  useEffect(() => {
    if (analysisText) setSmartVisionState({ analysisText });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisText]);

  // ── SmartVision analysis (satellite only)
  const runSmartVision = useCallback(async () => {
    if (!satelliteUrl) {
      setAnalysisText('No satellite image available. GPS coordinates needed.');
      return;
    }
    setAnalysisLoading(true);
    setAnalysisText('');
    try {
      const cacheKey = courseName.replace(/\s/g, '_') + '_h' + hole;
      let base64 = SATELLITE_CACHE[cacheKey];
      if (!base64) {
        const dlRes = await fetch(satelliteUrl);
        if (!dlRes.ok) throw new Error('Download failed: ' + dlRes.status);
        const arrayBuffer = await dlRes.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        const CHUNK = 8192;
        let dlBinary = '';
        for (let offset = 0; offset < uint8.byteLength; offset += CHUNK) {
          dlBinary += String.fromCharCode(...Array.from(uint8.subarray(offset, offset + CHUNK)));
        }
        const cacheFile = new File(Paths.cache, 'sv_' + cacheKey + '.jpg');
        cacheFile.write(btoa(dlBinary), { encoding: 'base64' });
        const compressed = await manipulateAsync(
          cacheFile.uri,
          [{ resize: { width: 400 } }],
          { compress: 0.7, format: SaveFormat.JPEG },
        );
        base64 = new File(compressed.uri).base64Sync();
        SATELLITE_CACHE[cacheKey] = base64;
      }
      const res = await fetch(apiUrl + '/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'hole', image: base64, hole, par,
          distance: centerYards, courseName,
          playerFirstName: firstName, dominantMiss, isRoundActive,
          // 2026-05-22 — Fix Q follow-up audit: thread persona +
          // voiceGender so the vision response lands in the active
          // caddie's voice instead of getCaddieNameFor(null)→Kevin.
          voiceGender,
          persona: caddiePersonality,
        }),
      });
      if (!res.ok) throw new Error('API error ' + res.status);
      const data = await res.json() as { message?: string };
      const message = data.message ?? '';
      if (!message) throw new Error('Empty response');
      setAnalysisText(message);
      await configureAudioForSpeech();
      await speak(message, voiceGender, language, apiUrl, { userInitiated: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('[SmartVision] error:', msg);
      setAnalysisText('Take a look at the layout and pick your target.');
    } finally {
      setAnalysisLoading(false);
    }
  }, [
    satelliteUrl, hole, par, centerYards, courseName,
    firstName, dominantMiss, isRoundActive, apiUrl, voiceGender, language, caddiePersonality,
  ]);

  useEffect(() => {
    if (autoRunVision && imageReady && satelliteUrl) {
      const t = setTimeout(() => { runSmartVision(); }, 1000);
      return () => clearTimeout(t);
    }
  }, [autoRunVision, imageReady, satelliteUrl, runSmartVision]);

  // ── Landmark loading ────────────────────
  useEffect(() => {
    const key = resolveCourseKey(activeCourseId ?? null, activeCourse ?? null);
    if (!key) { setLandmarks([]); return; }
    getLandmarksForHole(key, hole).then(setLandmarks);
    setTeeLandmark(null);
    setApproachLandmark(null);
    setPinLandmark(null);
  }, [activeCourseId, activeCourse, hole]);

  // ── Satellite tap measure ───────────────
  const handleImageTap = (evt: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!measureMode || displayType !== 'satellite') return;
    const { locationX, locationY } = evt.nativeEvent;
    setTapPoint({ x: locationX, y: locationY });
    if (Math.abs(middleLat) < 0.01) { setMeasureYards(null); return; }
    const zoom = getHoleZoom(distance, par);
    const mpp = mppForZoom(zoom);
    const imageCenterLat = teeLat + (middleLat - teeLat) * 0.55;
    const imageCenterLng = teeLng + (middleLng - teeLng) * 0.55;
    const cx = IMAGE_WIDTH / 2;
    const cy = IMAGE_HEIGHT / 2;
    const tapLat = imageCenterLat + ((cy - locationY) * mpp / 111320);
    const tapLng = imageCenterLng + ((locationX - cx) * mpp / (111320 * Math.cos(imageCenterLat * Math.PI / 180)));
    const yards = haversineYards(tapLat, tapLng, middleLat, middleLng);
    setMeasureYards(yards > 1 && yards < 800 ? Math.round(yards) : null);
  };

  // ── GPS pixel position (satellite) ─────
  const getPlayerPixel = (): { x: number; y: number } | null => {
    if (!gpsValid || !gpsCoords) return null;
    if (Math.abs(middleLat) < 0.01) return null;
    const zoom = getHoleZoom(distance, par);
    const mpp = mppForZoom(zoom);
    const imageCenterLat = teeLat + (middleLat - teeLat) * 0.55;
    const imageCenterLng = teeLng + (middleLng - teeLng) * 0.55;
    const dyM = (gpsCoords.latitude - imageCenterLat) * 111320;
    const dxM = (gpsCoords.longitude - imageCenterLng) * 111320 * Math.cos(imageCenterLat * Math.PI / 180);
    return { x: IMAGE_WIDTH / 2 + dxM / mpp, y: IMAGE_HEIGHT / 2 - dyM / mpp };
  };

  const playerPixel = isRoundActive && gpsValid ? getPlayerPixel() : null;
  const greenPixel = { x: IMAGE_WIDTH / 2, y: IMAGE_HEIGHT * 0.2 };

  // 2026-06-04 — HolePlan removed; Plan UI derived state + Lock Plan
  // surface below stripped out.

  const modeBadgeText =
    isRoundActive && gpsValid ? '● LIVE GPS'
    : isRoundActive ? '○ GPS SEARCHING...'
    : '○ PRE-ROUND';
  const modeBadgeColor = isRoundActive && gpsValid ? '#00C896' : '#6b7280';

  // ── RENDER ─────────────────────────────

  // Shared: hole image section (same in portrait and landscape)
  // Phase Y — claim the responder unconditionally on every touch so vertical
  // drags inside the image don't bubble up and scroll the parent ScrollView.
  // The marker PanResponders (T/target/pin) are children and win first via
  // RN's deepest-responder-first negotiation, so dragging a marker still
  // works. handleImageTap no-ops outside measure-mode + satellite, so the
  // claim is safe in bundled mode too.
  const holeImagePane = (
    <View
      ref={shareViewRef}
      collapsable={false}
      style={[styles.imageWrapper, { width: IMAGE_WIDTH, height: IMAGE_HEIGHT }]}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderRelease={handleImageTap}
    >
          {/* Phase AN — stylized vector renderer. Preferred when tee +
              green coords are known. No network, instant render. */}
          {displayType === 'vector' ? (
            <VectorHoleView
              hole={hole}
              par={par}
              distance={distance}
              tee={{ lat: teeLat, lng: teeLng }}
              green={{ lat: middleLat, lng: middleLng }}
              currentPos={gpsValid && gpsCoords
                ? { lat: gpsCoords.latitude, lng: gpsCoords.longitude }
                : null}
              width={IMAGE_WIDTH}
              height={IMAGE_HEIGHT}
              // 2026-05-17 — Drag-to-anchor. Only active during a round
              // where we know the courseId. Dragging the TEE or GRN
              // marker on the vector view writes the new lat/lng into
              // courseGeometryOverrideStore, which the yardage pipeline
              // already reads as the top priority over upstream geometry.
              // Same mutator path as the "📍 Anchor Tee" button below;
              // just sourced from a drag instead of current GPS.
              onTeeAnchor={isRoundActive && courseId
                ? (latlng) => {
                    useCourseGeometryOverrideStore.getState().anchorTee(
                      courseId, hole, latlng.lat, latlng.lng,
                    );
                  }
                : undefined}
              onGreenAnchor={isRoundActive && courseId
                ? (latlng) => {
                    useCourseGeometryOverrideStore.getState().anchorGreen(
                      courseId, hole, latlng.lat, latlng.lng,
                    );
                  }
                : undefined}
            />
          ) : displayType === 'bundled' ? (
            // 2026-05-22 — Golfshot-style hole view. Renders the resolved
            // image (bundled screenshot OR Mapbox/Google fallback for
            // golfcourseapi courses we don't have bundled) with semi-
            // transparent green disk, draggable yellow Y (layup) + red P
            // (pin) markers, dynamic distance line, top header, and
            // bottom F/M/B bar. Refreshes when holeReconciliation flips
            // `hole` upstream (component effect resets markers on
            // holeNumber change). Internal holeImageMapper picks: local
            // bundled (highest fidelity) → Mapbox → Google.
            <GolfshotHoleView
              courseId={courseId ?? null}
              courseName={courseName}
              holeNumber={hole}
              par={par}
              distanceYd={distance}
              tee={teeLat && teeLng ? { lat: teeLat, lng: teeLng } : null}
              green={middleLat && middleLng ? { lat: middleLat, lng: middleLng } : null}
              greenFront={(() => {
                const g = courseId ? getHoleGeometry(courseId, hole) : null;
                return g?.green_front ?? null;
              })()}
              greenBack={(() => {
                const g = courseId ? getHoleGeometry(courseId, hole) : null;
                return g?.green_back ?? null;
              })()}
              width={IMAGE_WIDTH}
              height={IMAGE_HEIGHT}
              imageOverrideUri={getHoleBackgroundUri(courseId ?? null, hole) ?? undefined}
            />
          ) : (
            <View style={styles.noImage}>
              <Text style={styles.noImageText}>{'Hole ' + hole}</Text>
              <Text style={styles.noImageSub}>{'Par ' + par + ' · ' + distance + ' yds'}</Text>
            </View>
          )}

          {/* Satellite SVG overlay */}
          {displayType === 'satellite' && imageReady && (
            <Svg style={StyleSheet.absoluteFill} width={IMAGE_WIDTH} height={IMAGE_HEIGHT}>
              <Circle cx={greenPixel.x} cy={greenPixel.y} r={8}
                fill="#F5A623" stroke="#ffffff" strokeWidth={2} />
              {playerPixel && (
                <>
                  <Line x1={playerPixel.x} y1={playerPixel.y}
                    x2={greenPixel.x} y2={greenPixel.y}
                    stroke="#00C896" strokeWidth={2} strokeDasharray="6,4" opacity={0.8} />
                  <Circle cx={playerPixel.x} cy={playerPixel.y} r={9}
                    fill="#00C896" stroke="#ffffff" strokeWidth={2} />
                </>
              )}
              {tapPoint && measureMode && (
                <>
                  <Line x1={tapPoint.x} y1={tapPoint.y}
                    x2={greenPixel.x} y2={greenPixel.y}
                    stroke="#ffffff" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.9} />
                  <Circle cx={tapPoint.x} cy={tapPoint.y} r={7}
                    fill="#ffffff" stroke="#00C896" strokeWidth={2} />
                  {measureYards && (
                    <SvgText x={tapPoint.x + 12} y={tapPoint.y - 8}
                      fill="#ffffff" fontSize={14} fontWeight="bold">
                      {measureYards + 'y'}
                    </SvgText>
                  )}
                </>
              )}
            </Svg>
          )}

          {/* Bundled image: shot-line SVG + draggable markers + distance panel */}
          {displayType === 'bundled' && imageReady && markersReady && (
            <>
              {/* Shot lines */}
              <Svg style={StyleSheet.absoluteFill} width={IMAGE_WIDTH} height={IMAGE_HEIGHT}>
                <Line
                  x1={teePos.x} y1={teePos.y}
                  x2={targetPos.x} y2={targetPos.y}
                  stroke="#00C896" strokeWidth={2.5} strokeDasharray="10,6" opacity={0.85}
                />
                <Line
                  x1={targetPos.x} y1={targetPos.y}
                  x2={pinPos.x} y2={pinPos.y}
                  stroke="#F5A623" strokeWidth={2.5} strokeDasharray="10,6" opacity={0.85}
                />
              </Svg>

              {/* TEE marker */}
              <View
                {...teePR.panHandlers}
                style={[styles.marker, styles.markerTee,
                  { left: teePos.x - 16, top: teePos.y - 16 }]}
              >
                <Text style={styles.markerLabel}>T</Text>
              </View>

              {/* TARGET marker */}
              <View
                {...targetPR.panHandlers}
                style={[styles.marker, styles.markerTarget,
                  { left: targetPos.x - 16, top: targetPos.y - 16 }]}
              >
                <Text style={styles.markerLabel}>A</Text>
              </View>

              {/* PIN marker */}
              <View
                {...pinPR.panHandlers}
                style={[styles.marker, styles.markerPin,
                  { left: pinPos.x - 16, top: pinPos.y - 16 }]}
              >
                <Text style={styles.markerLabel}>P</Text>
              </View>

              {/* Distance panel */}
              <View style={styles.distPanel} pointerEvents="none">
                <View style={styles.distItem}>
                  <Text style={styles.distLabel}>FROM TEE</Text>
                  <Text style={styles.distValue}>{fromTeeYards}</Text>
                  <Text style={styles.distUnit}>yds</Text>
                </View>
                <View style={styles.distDivider} />
                <View style={styles.distItem}>
                  <Text style={styles.distLabel}>APPROACH</Text>
                  <Text style={styles.distValue}>{approachYards}</Text>
                  <Text style={styles.distUnit}>yds</Text>
                </View>
              </View>

              {/* Drag hint */}
              <View style={styles.dragHint} pointerEvents="none">
                <Text style={styles.dragHintText}>Drag markers to plan your shot</Text>
              </View>
            </>
          )}
        </View>
  );  // end holeImagePane

  // Shared: controls below / beside the image
  const controlsPane = (
    <>
        {/* BUTTON ROW */}
        <View style={styles.btnRow}>
          {displayType === 'satellite' && (
            <TouchableOpacity
              style={[styles.btn, measureMode && styles.btnActive]}
              onPress={() => { setMeasureMode(!measureMode); setTapPoint(null); setMeasureYards(null); }}
            >
              <Text style={[styles.btnText, measureMode && styles.btnTextActive]}>
                📐 Measure
              </Text>
            </TouchableOpacity>
          )}
          {/* 2026-05-17 — 3D View button removed; the /hole-view-3d
              route was a placeholder that was deleted in commit
              63ca36e. Button stayed and would have broken navigation
              for any user who tapped it. Restore the button only
              alongside a real 3D-view implementation. */}
        </View>

        {/* Phase AG followup — anchor capture row. Only renders during an
            active round when courseId is known. Two taps build the live
            yardage data: stand on the tee → tap "Anchor Tee", walk to the
            green center → tap "Anchor Green". After 18 holes Tim has a
            complete accurate course geometry that lives in
            courseGeometryOverrideStore (persisted) and overrides the
            zero-coord static data automatically. */}
        {isRoundActive && courseId && (
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, (override?.teeLat != null && styles.btnActive)]}
              onPress={async () => {
                try {
                  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                  useCourseGeometryOverrideStore.getState().anchorTee(
                    courseId, hole, pos.coords.latitude, pos.coords.longitude,
                  );
                } catch (e) {
                  console.log('[anchor-tee] error', e);
                }
              }}
            >
              <Text style={[styles.btnText, (override?.teeLat != null && styles.btnTextActive)]}>
                {override?.teeLat ? '✓ Tee Anchored' : '📍 Anchor Tee'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, (override?.middleLat != null && styles.btnActive)]}
              onPress={async () => {
                try {
                  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                  useCourseGeometryOverrideStore.getState().anchorGreen(
                    courseId, hole, pos.coords.latitude, pos.coords.longitude,
                  );
                } catch (e) {
                  console.log('[anchor-green] error', e);
                }
              }}
            >
              <Text style={[styles.btnText, (override?.middleLat != null && styles.btnTextActive)]}>
                {override?.middleLat ? '✓ Green Anchored' : '⛳ Anchor Green'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 2026-06-04 — Plan row + Lock Plan button removed (HolePlan demolition). */}

        {/* CLUB INTENT ROW */}
        {displayType === 'bundled' && roundActive && markersReady && (
          <View style={styles.clubRow}>
            {(['tee', 'approach', 'pin'] as const).map(m => {
              const club = m === 'tee' ? teeClub : m === 'approach' ? approachClub : pinClub;
              const label = m === 'tee' ? 'T' : m === 'approach' ? 'A' : 'P';
              const color = m === 'tee' ? '#1DA1F2' : m === 'approach' ? '#00C896' : '#F5A623';
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.clubSlot, { borderColor: color + '44' }]}
                  onPress={() => setClubPickerFor(m)}
                >
                  <Text style={[styles.clubSlotLabel, { color }]}>{label}</Text>
                  <Text style={styles.clubSlotValue}>{club ?? '—'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* LANDMARK ROW */}
        {displayType === 'bundled' && roundActive && markersReady && landmarks.length > 0 && (
          <View style={styles.clubRow}>
            {(['tee', 'approach', 'pin'] as const).map(m => {
              const lm = m === 'tee' ? teeLandmark : m === 'approach' ? approachLandmark : pinLandmark;
              const label = m === 'tee' ? 'T' : m === 'approach' ? 'A' : 'P';
              const color = m === 'tee' ? '#1DA1F2' : m === 'approach' ? '#00C896' : '#F5A623';
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.clubSlot, { borderColor: lm ? color + '88' : '#1e3a28' }]}
                  onPress={() => setLandmarkPickerFor(m)}
                >
                  <Text style={[styles.clubSlotLabel, { color: lm ? color : '#374151' }]}>{label} AIM</Text>
                  <Text style={[styles.clubSlotValue, { fontSize: 10, color: lm ? '#ffffff' : '#374151' }]} numberOfLines={1}>
                    {lm ? lm.name : '—'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* MEASURE RESULT (satellite) */}
        {measureMode && measureYards !== null && (
          <View style={styles.measureResult}>
            <Text style={styles.measureResultText}>{measureYards + ' yds to flag'}</Text>
          </View>
        )}

        {/* SMARTVISION (satellite only) */}
        {displayType !== 'bundled' && (
          <>
            <TouchableOpacity
              style={[styles.svBtn, analysisLoading && styles.svBtnLoading]}
              onPress={runSmartVision}
              disabled={analysisLoading}
              activeOpacity={0.85}
            >
              {analysisLoading ? (
                <ActivityIndicator color="#00C896" size="small" />
              ) : (
                <Text style={styles.svBtnText}>
                  {analysisText ? 'SmartVision — tap to re-run' : 'SmartVision Analysis'}
                </Text>
              )}
            </TouchableOpacity>
            {Boolean(analysisText) && (
              <View style={styles.analysisCard}>
                <Text style={styles.analysisLabel}>KEVIN</Text>
                <Text style={styles.analysisText} numberOfLines={4}>{analysisText}</Text>
              </View>
            )}
          </>
        )}

        {/* YARDAGE ROW */}
        <View style={styles.yardRow}>
          <View style={styles.yardCard}>
            <Text style={styles.yardLabel}>FRONT</Text>
            <Text style={styles.yardValue}>{frontYards > 0 ? frontYards : distance - 16}</Text>
          </View>
          <View style={[styles.yardCard, styles.yardCardCenter]}>
            <Text style={styles.yardLabelGreen}>CTR</Text>
            <Text style={styles.yardValueCenter}>{centerYards}</Text>
            {/* Phase V.7+ — explicit "Locking GPS" feedback during cold-start
                so the user knows why "—" is showing instead of assuming it's
                broken. Phase AG — also surface "course geometry unavailable"
                when middleLat/Lng are zero (golfcourseapi returns no hole
                coords; only printed-card distances are usable). */}
            {isRoundActive && !gpsValid && middleLat !== 0 && middleLng !== 0 && (
              <Text style={styles.gpsWaiting}>Locking GPS…</Text>
            )}
            {isRoundActive && (middleLat === 0 || middleLng === 0) && (
              <Text style={styles.gpsWaiting}>No live yardage on this course</Text>
            )}
            {isRoundActive && gpsValid && middleLat !== 0 && middleLng !== 0 && (
              <Text style={styles.playsLike}>{'plays like ' + centerYards + ' yds'}</Text>
            )}
          </View>
          <View style={styles.yardCard}>
            <Text style={styles.yardLabel}>BACK</Text>
            <Text style={styles.yardValue}>{backYards > 0 ? backYards : distance + 16}</Text>
          </View>
        </View>
    </>
  );  // end controlsPane

  const headerRow = (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={styles.backBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.backText}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{'Hole ' + hole + ' · Par ' + par}</Text>
      <View style={{ width: 60 }} />
    </View>
  );

  const modeBadgeRow = (
    <View style={styles.badgeRow}>
      <View style={[styles.badge, { borderColor: modeBadgeColor }]}>
        <Text style={[styles.badgeText, { color: modeBadgeColor }]}>
          {modeBadgeText}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      {isLandscape ? (
        /* ── LANDSCAPE: image left 68%, controls right 32% ── */
        <View style={styles.landscapeRow}>
          <View style={[styles.landscapeLeft, { width: IMAGE_WIDTH + 8 }]}>
            {headerRow}
            {holeImagePane}
          </View>
          <ScrollView
            style={styles.landscapeRight}
            contentContainerStyle={styles.landscapeRightContent}
            showsVerticalScrollIndicator={false}
          >
            {modeBadgeRow}
            {controlsPane}
          </ScrollView>
        </View>
      ) : (
        // ── PORTRAIT: non-scrolling flex layout ──
        // Phase AE follow-up — was a ScrollView wrapping image + controls,
        // which let the page scroll under the measuring tool and made
        // tap-to-measure unreliable (image moved while tapping). Now the
        // image pane fills the available vertical space and the controls
        // row is compact at the bottom in its own scroll region; only the
        // inner ScrollView can overflow.
        <View style={[styles.scroll, { flex: 1 }]}>
          {headerRow}
          {modeBadgeRow}
          {/* 2026-05-24 v1.2.1 — Meta glasses media auto-detect banner.
              Visible only when a <60s-old photo lands in the Ray-Ban /
              Meta album. Dormant until the next EAS Build cuts the
              expo-media-library native module — the JS is OTA-safe and
              gracefully no-ops when the native binding isn't bundled. */}
          {pendingMetaMedia && (
            <View style={metaBannerStyles.wrap}>
              <Text style={metaBannerStyles.heading}>
                {pendingMetaMedia.mediaType === 'video'
                  ? tMeta('labels.meta_glasses_new_video')
                  : tMeta('labels.meta_glasses_new_photo')}
              </Text>
              <Image
                source={{ uri: pendingMetaMedia.uri }}
                style={metaBannerStyles.thumb}
                resizeMode="cover"
              />
              <View style={metaBannerStyles.btnRow}>
                <TouchableOpacity
                  style={metaBannerStyles.primaryBtn}
                  onPress={handleAnalyzeMetaPhoto}
                  accessibilityRole="button"
                  accessibilityLabel={
                    pendingMetaMedia.mediaType === 'video'
                      ? tMeta('labels.meta_glasses_analyze_video_btn')
                      : tMeta('labels.meta_glasses_analyze_btn')
                  }
                >
                  <Text style={metaBannerStyles.primaryBtnText}>
                    {pendingMetaMedia.mediaType === 'video'
                      ? tMeta('labels.meta_glasses_analyze_video_btn')
                      : tMeta('labels.meta_glasses_analyze_btn')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={metaBannerStyles.dismissBtn}
                  onPress={() => setPendingMetaMedia(null)}
                  accessibilityRole="button"
                  accessibilityLabel={tMeta('labels.meta_glasses_dismiss')}
                >
                  <Text style={metaBannerStyles.dismissText}>
                    {tMeta('labels.meta_glasses_dismiss')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View style={{ alignItems: 'center', justifyContent: 'flex-start' }}>
            {holeImagePane}
          </View>
          {/* v1.2 — Share to Instagram. Captures shareViewRef (the
              imagery card) and opens the platform share sheet. */}
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <ShareToSocial viewRef={shareViewRef} />
          </View>
          {/* Controls in a constrained region at the bottom; inner scroll
              handles overflow without moving the image above. */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {controlsPane}
          </ScrollView>
        </View>
      )}
      </SafeAreaView>
      <KevinBadge />

      {/* CLUB PICKER MODAL */}
      <Modal
        visible={clubPickerFor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setClubPickerFor(null)}
      >
        <TouchableOpacity
          style={styles.clubModalBackdrop}
          onPress={() => setClubPickerFor(null)}
          activeOpacity={1}
        >
          <View style={styles.clubModalSheet}>
            <Text style={styles.clubModalTitle}>
              {clubPickerFor === 'tee' ? 'Tee club' :
               clubPickerFor === 'approach' ? 'Approach club' : 'Pin club'}
            </Text>
            <View style={styles.clubGrid}>
              {CLUBS.map(club => {
                const current = clubPickerFor === 'tee' ? teeClub
                  : clubPickerFor === 'approach' ? approachClub : pinClub;
                const isSelected = current === club;
                return (
                  <TouchableOpacity
                    key={club}
                    style={[styles.clubChip, isSelected && styles.clubChipActive]}
                    onPress={() => {
                      if (clubPickerFor === 'tee') {
                        setTeeClub(club);
                        saveClubUpdate(club, approachClub, pinClub);
                      } else if (clubPickerFor === 'approach') {
                        setApproachClub(club);
                        saveClubUpdate(teeClub, club, pinClub);
                      } else {
                        setPinClub(club);
                        saveClubUpdate(teeClub, approachClub, club);
                      }
                      setClubPickerFor(null);
                    }}
                  >
                    <Text style={[styles.clubChipText, isSelected && styles.clubChipTextActive]}>
                      {club}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {/* Clear option */}
              <TouchableOpacity
                style={[styles.clubChip, styles.clubChipClear]}
                onPress={() => {
                  if (clubPickerFor === 'tee') {
                    setTeeClub(null); saveClubUpdate(null, approachClub, pinClub);
                  } else if (clubPickerFor === 'approach') {
                    setApproachClub(null); saveClubUpdate(teeClub, null, pinClub);
                  } else {
                    setPinClub(null); saveClubUpdate(teeClub, approachClub, null);
                  }
                  setClubPickerFor(null);
                }}
              >
                <Text style={styles.clubChipText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* LANDMARK PICKER MODAL */}
      <Modal
        visible={landmarkPickerFor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setLandmarkPickerFor(null)}
      >
        <TouchableOpacity
          style={styles.clubModalBackdrop}
          onPress={() => setLandmarkPickerFor(null)}
          activeOpacity={1}
        >
          <View style={styles.clubModalSheet}>
            <Text style={styles.clubModalTitle}>
              {landmarkPickerFor === 'tee' ? 'Tee aim' :
               landmarkPickerFor === 'approach' ? 'Approach aim' : 'Pin aim'}
            </Text>
            <View style={styles.clubGrid}>
              {landmarks.map(lm => {
                const current = landmarkPickerFor === 'tee' ? teeLandmark
                  : landmarkPickerFor === 'approach' ? approachLandmark : pinLandmark;
                const isSelected = current?.id === lm.id;
                return (
                  <TouchableOpacity
                    key={lm.id}
                    style={[styles.clubChip, isSelected && styles.clubChipActive]}
                    onPress={() => {
                      if (landmarkPickerFor === 'tee') {
                        setTeeLandmark(lm);
                        saveLandmarkUpdate(lm, approachLandmark, pinLandmark);
                      } else if (landmarkPickerFor === 'approach') {
                        setApproachLandmark(lm);
                        saveLandmarkUpdate(teeLandmark, lm, pinLandmark);
                      } else {
                        setPinLandmark(lm);
                        saveLandmarkUpdate(teeLandmark, approachLandmark, lm);
                      }
                      setLandmarkPickerFor(null);
                    }}
                  >
                    <Text style={[styles.clubChipText, isSelected && styles.clubChipTextActive]}>
                      {lm.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.clubChip, styles.clubChipClear]}
                onPress={() => {
                  if (landmarkPickerFor === 'tee') {
                    setTeeLandmark(null); saveLandmarkUpdate(null, approachLandmark, pinLandmark);
                  } else if (landmarkPickerFor === 'approach') {
                    setApproachLandmark(null); saveLandmarkUpdate(teeLandmark, null, pinLandmark);
                  } else {
                    setPinLandmark(null); saveLandmarkUpdate(teeLandmark, approachLandmark, null);
                  }
                  setLandmarkPickerFor(null);
                }}
              >
                <Text style={styles.clubChipText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── STYLES ───────────────────────────────

// 2026-05-26 — Fix CH: themed StyleSheet via makeStyles(colors).
function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scroll: { paddingBottom: 32 },
  landscapeRow: { flex: 1, flexDirection: 'row' },
  landscapeLeft: { overflow: 'hidden' },
  landscapeRight: { flex: 1 },
  landscapeRightContent: { padding: 12, paddingBottom: 32 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { width: 60 },
  backText: { color: '#00C896', fontSize: 16, fontWeight: '600' },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  badgeRow: { paddingHorizontal: 16, marginBottom: 8 },
  badge: {
    alignSelf: 'flex-start', borderWidth: 1,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  imageWrapper: {
    marginHorizontal: 12, marginBottom: 8,
    borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#0a0a0a',
  },
  holeImage: { width: '100%', height: '100%' },
  noImage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface_elevated },
  noImageText: { color: '#ffffff', fontSize: 32, fontWeight: '900' },
  noImageSub: { color: '#6b7280', fontSize: 14, marginTop: 4 },
  // Bundled markers
  marker: {
    position: 'absolute', width: 32, height: 32,
    borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  markerTee: { backgroundColor: '#1DA1F2', borderWidth: 2, borderColor: '#ffffff' },
  markerTarget: { backgroundColor: '#ffffff', borderWidth: 2, borderColor: '#00C896' },
  markerPin: { backgroundColor: '#F5A623', borderWidth: 2, borderColor: '#ffffff' },
  markerLabel: { color: c.background, fontSize: 11, fontWeight: '900' },
  // Distance panel
  distPanel: {
    position: 'absolute', bottom: 10, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(6,15,9,0.82)',
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16,
    borderWidth: 1, borderColor: 'rgba(0,200,150,0.3)',
  },
  distItem: { flex: 1, alignItems: 'center' },
  distLabel: { color: '#6b7280', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  distValue: { color: '#ffffff', fontSize: 26, fontWeight: '900', lineHeight: 30 },
  distUnit: { color: '#6b7280', fontSize: 10 },
  distDivider: { width: 1, height: 36, backgroundColor: c.border, marginHorizontal: 8 },
  // Drag hint
  dragHint: {
    position: 'absolute', top: 10, left: 0, right: 0,
    alignItems: 'center',
  },
  dragHintText: {
    color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '500',
    backgroundColor: 'rgba(6,15,9,0.5)',
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8,
  },
  // Buttons
  btnRow: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 6, gap: 8 },
  btn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: c.border, backgroundColor: c.background,
  },
  btnActive: { borderColor: '#00C896', backgroundColor: '#003d20' },
  btnText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  btnTextActive: { color: '#00C896' },
  measureResult: {
    marginHorizontal: 12, marginBottom: 6,
    backgroundColor: '#0d1a00', borderRadius: 10,
    borderWidth: 1, borderColor: '#F5A623',
    paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'flex-start',
  },
  measureResultText: { color: '#F5A623', fontSize: 14, fontWeight: '700' },
  svBtn: {
    marginHorizontal: 12, marginBottom: 8,
    backgroundColor: c.surface_elevated, borderWidth: 1.5, borderColor: '#00C896',
    borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  svBtnLoading: { borderColor: '#F5A623' },
  svBtnText: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  analysisCard: {
    marginHorizontal: 12, marginBottom: 8,
    backgroundColor: c.surface_elevated, borderLeftWidth: 3, borderLeftColor: '#00C896',
    borderRadius: 8, padding: 12,
  },
  analysisLabel: {
    color: '#00C896', fontSize: 10, fontWeight: '800',
    letterSpacing: 2, marginBottom: 6,
  },
  analysisText: { color: '#ffffff', fontSize: 14, lineHeight: 21 },
  // Yardage row
  yardRow: { flexDirection: 'row', marginHorizontal: 12, gap: 6 },
  yardCard: {
    flex: 1, backgroundColor: c.surface_elevated, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  yardCardCenter: { flex: 1.3, borderWidth: 2, borderColor: '#00C896' },
  yardLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  yardLabelGreen: { color: '#00C896', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  yardValue: { color: '#ffffff', fontSize: 26, fontWeight: '700' },
  yardValueCenter: { color: '#ffffff', fontSize: 38, fontWeight: '900' },
  playsLike: { color: '#F5A623', fontSize: 11, marginTop: 3 },
  gpsWaiting: { color: '#9ca3af', fontSize: 11, marginTop: 3, fontStyle: 'italic' },
  // Plan row
  planRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 12, marginBottom: 6, gap: 10,
  },
  lockBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#00C896', backgroundColor: '#003d20',
  },
  lockBtnLocked: {
    borderColor: '#F5A623', backgroundColor: '#1a1200',
  },
  lockBtnText: { color: '#00C896', fontSize: 13, fontWeight: '700' },
  lockBtnTextLocked: { color: '#F5A623' },
  planAgeText: { color: '#6b7280', fontSize: 11 },
  // Club row
  clubRow: {
    flexDirection: 'row', marginHorizontal: 12, marginBottom: 6, gap: 6,
  },
  clubSlot: {
    flex: 1, backgroundColor: c.surface_elevated, borderRadius: 10,
    borderWidth: 1, borderColor: c.border,
    paddingVertical: 8, alignItems: 'center',
  },
  clubSlotLabel: { color: '#6b7280', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  clubSlotValue: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  // Club picker modal
  clubModalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  clubModalSheet: {
    backgroundColor: c.surface_elevated, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40,
  },
  clubModalTitle: {
    color: '#ffffff', fontSize: 16, fontWeight: '800',
    textAlign: 'center', marginBottom: 16,
  },
  clubGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  clubChip: {
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 20, borderWidth: 1, borderColor: c.border,
    backgroundColor: c.background,
  },
  clubChipActive: { borderColor: '#00C896', backgroundColor: '#003d20' },
  clubChipClear: { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)' },
  clubChipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  clubChipTextActive: { color: '#00C896' },
});
}

// 2026-05-24 v1.2.1 — Meta glasses auto-detect banner styles. Kept
// separate from the main styles so the new banner block is easy to
// remove if the feature evolves into a different surface.
const metaBannerStyles = StyleSheet.create({
  wrap: {
    backgroundColor: '#0d1a0d',
    borderColor: '#1e3a28',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 8,
    marginTop: 8,
    gap: 10,
  },
  heading: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  thumb: { width: '100%', height: 160, borderRadius: 8, backgroundColor: '#020503' },
  btnRow: { flexDirection: 'row', gap: 8 },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#00C896',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0d1a0d', fontSize: 13, fontWeight: '800' },
  dismissBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
});
