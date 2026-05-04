/**
 * app/hole-view.tsx — SmartPlay HoleView
 *
 * TWO MODES:
 *   MODE A — PRE-ROUND (isRoundActive === false):
 *     All yardages static from COURSE_DB distance param.
 *     No GPS, no haversine, no measuring line, no player dot.
 *   MODE B — ON-COURSE (isRoundActive === true):
 *     Live GPS yardages via haversine. Measuring line shown.
 *     Falls back to COURSE_DB distance on GPS failure.
 *
 * RULES:
 *   RULE 1 — haversine × 1.09361 ONLY (never 3.28084)
 *   RULE 2 — GPS validity gate: coords not null, accuracy < 30, lat > 0.01, lng > 0.01
 *   RULE 3 — Pre-round yardages always static (no haversine)
 *   RULE 4 — On-course: haversine when valid GPS, COURSE_DB fallback otherwise
 *   RULE 5 — playsLikeText is plain ASCII only
 *   RULE 6 — SmartVision posts to /api/vision proxy only
 *   RULE 7 — Measuring line only in ON-COURSE mode with valid GPS
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Dimensions,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import Svg, { Line, Circle } from 'react-native-svg';
import HoleDiagram from '../components/HoleDiagram';
import { useSettingsStore } from '../store/settingsStore';
import { useRoundStore } from '../store/roundStore';
import { speak as vsSpeakFn } from '../services/voice';
import { getApiBaseUrl } from '../utils/apiUrl';
import { useBagStore, DEFAULT_DISTANCES } from '../store/bagStore';

const IMAGE_WIDTH = Dimensions.get('window').width - 32;
const IMAGE_HEIGHT = Math.min(
  420,
  Math.max(260, Math.round(Dimensions.get('window').height * 0.34))
);

const PALMS_HOLE_IMAGES: Record<number, any> = {
  1: require('../assets/images/palms/palms-h1.jpg'),
  2: require('../assets/images/palms/palms-h2.jpg'),
  3: require('../assets/images/palms/palms-h3.jpg'),
  4: require('../assets/images/palms/palms-h4.jpg'),
  5: require('../assets/images/palms/palms-h5.jpg'),
  6: require('../assets/images/palms/palms-h6.jpg'),
  7: require('../assets/images/palms/palms-h7.jpg'),
  8: require('../assets/images/palms/palms-h8.jpg'),
  9: require('../assets/images/palms/palms-h9.jpg'),
  10: require('../assets/images/palms/palms-h10.jpg'),
  11: require('../assets/images/palms/palms-h11.jpg'),
  12: require('../assets/images/palms/palms-h12.jpg'),
  13: require('../assets/images/palms/palms-h13.jpg'),
  14: require('../assets/images/palms/palms-h14.jpg'),
  15: require('../assets/images/palms/palms-h15.jpg'),
  16: require('../assets/images/palms/palms-h16.jpg'),
  17: require('../assets/images/palms/palms-h17.jpg'),
  18: require('../assets/images/palms/palms-h18.jpg'),
};

const LAKES_HOLE_IMAGES: Record<number, any> = {
  1: require('../assets/images/lakes/lakes-h1.jpg'),
  2: require('../assets/images/lakes/lakes-h2.jpg'),
  3: require('../assets/images/lakes/lakes-h3.jpg'),
  4: require('../assets/images/lakes/lakes-h4.jpg'),
  5: require('../assets/images/lakes/lakes-h5.jpg'),
  6: require('../assets/images/lakes/lakes-h6.jpg'),
  7: require('../assets/images/lakes/lakes-h7.jpg'),
  8: require('../assets/images/lakes/lakes-h8.jpg'),
  9: require('../assets/images/lakes/lakes-h9.jpg'),
  10: require('../assets/images/lakes/lakes-h10.jpg'),
  11: require('../assets/images/lakes/lakes-h11.jpg'),
  12: require('../assets/images/lakes/lakes-h12.jpg'),
  13: require('../assets/images/lakes/lakes-h13.jpg'),
  14: require('../assets/images/lakes/lakes-h14.jpg'),
  15: require('../assets/images/lakes/lakes-h15.jpg'),
  16: require('../assets/images/lakes/lakes-h16.jpg'),
  17: require('../assets/images/lakes/lakes-h17.jpg'),
  18: require('../assets/images/lakes/lakes-h18.jpg'),
};

const RANCHO_HOLE_IMAGES: Record<number, any> = {
  1: require('../assets/images/rancho/rancho-h1.jpg'),
  2: require('../assets/images/rancho/rancho-h2.jpg'),
  3: require('../assets/images/rancho/rancho-h3.jpg'),
  4: require('../assets/images/rancho/rancho-h4.jpg'),
  5: require('../assets/images/rancho/rancho-h5.jpg'),
  6: require('../assets/images/rancho/rancho-h6.jpg'),
  7: require('../assets/images/rancho/rancho-h7.jpg'),
  8: require('../assets/images/rancho/rancho-h8.jpg'),
  9: require('../assets/images/rancho/rancho-h9.jpg'),
  10: require('../assets/images/rancho/rancho-h10.jpg'),
  11: require('../assets/images/rancho/rancho-h11.jpg'),
  12: require('../assets/images/rancho/rancho-h12.jpg'),
  13: require('../assets/images/rancho/rancho-h13.jpg'),
  14: require('../assets/images/rancho/rancho-h14.jpg'),
  15: require('../assets/images/rancho/rancho-h15.jpg'),
  16: require('../assets/images/rancho/rancho-h16.jpg'),
  17: require('../assets/images/rancho/rancho-h17.jpg'),
  18: require('../assets/images/rancho/rancho-h18.jpg'),
};

const COURSE_IMAGE_SETS: Record<string, Record<number, any>> = {
  menifee_lakes_palms: PALMS_HOLE_IMAGES,
  menifee_lakes_lakes: LAKES_HOLE_IMAGES,
  rancho_california_gc: RANCHO_HOLE_IMAGES,
};

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

/** Pick the closest club to a given yardage using player distances with DEFAULT_DISTANCES fallback */
function suggestClubForYards(yards: number, playerDistances: Partial<Record<string, number>>): string {
  const merged: Record<string, number> = { ...DEFAULT_DISTANCES, ...playerDistances };
  const entries = Object.entries(merged) as [string, number][];
  if (!entries.length || yards <= 0) return '';
  return entries.reduce((best, curr) =>
    Math.abs(curr[1] - yards) < Math.abs(best[1] - yards) ? curr : best
  )[0];
}

// RULE 1: haversine returns YARDS — multiply by 1.09361 ONLY
const haversineYards = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000;
  const ph1 = lat1 * Math.PI / 180;
  const ph2 = lat2 * Math.PI / 180;
  const dph = (lat2 - lat1) * Math.PI / 180;
  const dla = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dph / 2) * Math.sin(dph / 2) +
    Math.cos(ph1) * Math.cos(ph2) *
    Math.sin(dla / 2) * Math.sin(dla / 2);
  const c = 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );
  const meters = R * c;
  return meters * 1.09361; // YARDS — never change this multiplier
};

// RULE 2: GPS validity gate — ALL four conditions required
const isValidGPS = (coords: Location.LocationObjectCoords | null): boolean => {
  if (!coords) return false;
  if ((coords.accuracy ?? 999) >= 30) return false;
  if (Math.abs(coords.latitude) <= 0.01) return false;
  if (Math.abs(coords.longitude) <= 0.01) return false;
  return true;
};

const normalizeCourseKey = (courseId: string, courseName: string): string => {
  const raw = `${courseId} ${courseName}`.toLowerCase();
  if (raw.includes('palms')) return 'menifee_lakes_palms';
  if (raw.includes('lakes')) return 'menifee_lakes_lakes';
  if (raw.includes('rancho')) return 'rancho_california_gc';
  return 'menifee_lakes_palms';
};

const getBundledHoleImage = (courseKey: string, hole: number): any => {
  return COURSE_IMAGE_SETS[courseKey]?.[hole] ?? null;
};

const getHoleCenter = (
  frontLat: number,
  frontLng: number,
  middleLat: number,
  middleLng: number,
  backLat: number,
  backLng: number
): { lat: number; lng: number } | null => {
  if (Math.abs(middleLat) > 0.01 && Math.abs(middleLng) > 0.01) {
    return { lat: middleLat, lng: middleLng };
  }
  if (Math.abs(frontLat) > 0.01 && Math.abs(frontLng) > 0.01) {
    return { lat: frontLat, lng: frontLng };
  }
  if (Math.abs(backLat) > 0.01 && Math.abs(backLng) > 0.01) {
    return { lat: backLat, lng: backLng };
  }
  return null;
};

const getHoleHeading = (
  teeLat: number,
  teeLng: number,
  targetLat: number,
  targetLng: number
): number | null => {
  if (
    Math.abs(teeLat) <= 0.01 ||
    Math.abs(teeLng) <= 0.01 ||
    Math.abs(targetLat) <= 0.01 ||
    Math.abs(targetLng) <= 0.01
  ) {
    return null;
  }

  const lat1 = teeLat * (Math.PI / 180);
  const lat2 = targetLat * (Math.PI / 180);
  const deltaLng = (targetLng - teeLng) * (Math.PI / 180);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

  return (Math.atan2(y, x) * 180) / Math.PI;
};

const getHoleZoom = (holeDistance: number): number => {
  if (holeDistance <= 190) return 18;
  if (holeDistance <= 330) return 17;
  if (holeDistance <= 470) return 16;
  return 15;
};

// Convert GPS coords to image pixel position (green center = image center)
const gpsToImagePoint = (
  targetLat: number,
  targetLng: number,
  refLat: number,
  refLng: number,
  imageW: number,
  imageH: number
): { x: number; y: number } => {
  const degsPerPixelLat = 0.0001;
  const degsPerPixelLng = 0.0001;
  const dx = (targetLng - refLng) / degsPerPixelLng;
  const dy = (refLat - targetLat) / degsPerPixelLat;
  return {
    x: Math.max(0, Math.min(imageW, imageW / 2 + dx)),
    y: Math.max(0, Math.min(imageH, imageH / 2 + dy)),
  };
};

export default function HoleViewScreen() {
  const params  = useLocalSearchParams();
  const router  = useRouter();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const clubDistancesPlayer = useBagStore((s) => s.clubDistances);
  const ultraCompactLayout = screenWidth < 365;
  const compactLayout = screenWidth < 390;
  // On very small screens (fold inner panel) the image fills full width so the
  // right grass edge hugs the device border. Normal screens keep 16px side padding.
  const hPad = ultraCompactLayout ? 0 : 16;
  const imageWidth = screenWidth - hPad * 2;
  // Taller image now that measure readout moved to in-image overlay
  const imageHeight = Math.min(
    ultraCompactLayout ? Math.round(screenHeight * 0.72) : compactLayout ? Math.round(screenHeight * 0.68) : Math.round(screenHeight * 0.62),
    Math.max(ultraCompactLayout ? 380 : compactLayout ? 420 : 460, Math.round(screenHeight * (ultraCompactLayout ? 0.65 : compactLayout ? 0.62 : 0.56)))
  );

  // -- Router params (all strings, parse on entry) --
  const hole       = Number(params.hole)      || 1;
  const par        = Number(params.par)       || 4;
  const distance   = Number(params.distance)  || 150;
  const note       = String(params.note ?? '');
  const teeLat     = Number(params.teeLat)    || 0;
  const teeLng     = Number(params.teeLng)    || 0;
  const frontLat   = Number(params.frontLat)  || 0;
  const frontLng   = Number(params.frontLng)  || 0;
  const middleLat  = Number(params.middleLat) || 0;
  const middleLng  = Number(params.middleLng) || 0;
  const backLat    = Number(params.backLat)   || 0;
  const backLng    = Number(params.backLng)   || 0;
  const courseId    = String(params.courseId ?? '');
  const courseName  = String(params.courseName ?? '');
  // Use live round store value so the pill updates immediately when a round starts
  const isRoundActiveStore = useRoundStore((s) => s.isRoundActive);
  const isRoundActive = isRoundActiveStore || params.isRoundActive === 'true';

  // -- GPS state (MODE B only) --
  const [gpsCoords, setGpsCoords] =
    useState<Location.LocationObjectCoords | null>(null);
  const [lockedYards, setLockedYards] = useState<number | null>(null);

  // -- SmartVision state --
  const [analysisText, setAnalysisText]       = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [measureMode, setMeasureMode] = useState(!isRoundActive);
  const [plannerViewMode, setPlannerViewMode] = useState<'single' | 'split'>('single');
  const [preferredView, setPreferredView] = useState<'photo' | 'satellite'>('photo');
  const [pointB, setPointB] = useState<{ x: number; y: number }>(() => ({
    x: imageWidth * 0.5,
    y: imageHeight * 0.58,
  }));
  const [teePointState, setTeePointState] = useState<{ x: number; y: number }>(() => ({
    x: imageWidth * 0.5,
    y: imageHeight * 0.9,
  }));
  const draggingTeeRef = useRef(false);
  const draggingPinRef = useRef(false);
  const autoRunVision = useRef(false);

  // -- RULE 2: GPS validity gate --
  const gpsValid = isValidGPS(gpsCoords);
  const courseKey = useMemo(
    () => normalizeCourseKey(courseId, courseName),
    [courseId, courseName]
  );

  // -- RULE: only start GPS when on-course --
  useEffect(() => {
    if (!isRoundActive) return; // MODE A: no GPS needed
    let sub: Location.LocationSubscription | undefined;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 3000,
          distanceInterval: 2,
        },
        (loc) => setGpsCoords(loc.coords)
      );
    })();
    return () => { sub?.remove(); };
  }, [isRoundActive]);

  // -- Image source --
  const holeCenter = useMemo(
    () => getHoleCenter(frontLat, frontLng, middleLat, middleLng, backLat, backLng),
    [frontLat, frontLng, middleLat, middleLng, backLat, backLng]
  );
  const holeHeading = useMemo(
    () => getHoleHeading(teeLat, teeLng, middleLat, middleLng),
    [teeLat, teeLng, middleLat, middleLng]
  );

  const getSatelliteUrl = (): string | null => {
    if (!GOOGLE_MAPS_KEY) return null;
    if (!holeCenter) return null;
    return (
      'https://maps.googleapis.com/maps/api/staticmap' +
      '?center=' + holeCenter.lat + ',' + holeCenter.lng +
      '&zoom=' + getHoleZoom(distance) +
      '&size=1280x720' +
      '&maptype=satellite' +
      (holeHeading !== null ? '&heading=' + Math.round(holeHeading) : '') +
      '&key=' + GOOGLE_MAPS_KEY
    );
  };

  const bundledPhoto = getBundledHoleImage(courseKey, hole);
  const satelliteUrl = getSatelliteUrl();
  const hasBundledPhoto = !!bundledPhoto;
  const hasSatelliteView = !!satelliteUrl;
  const canSplitCompare = !compactLayout && !isRoundActive && hasBundledPhoto && hasSatelliteView;

  const imageSourceType: 'photo' | 'satellite' | 'diagram' = isRoundActive
    ? hasSatelliteView
      ? 'satellite'
      : hasBundledPhoto
      ? 'photo'
      : 'diagram'
    : preferredView === 'satellite' && hasSatelliteView
    ? 'satellite'
    : hasBundledPhoto
    ? 'photo'
    : hasSatelliteView
    ? 'satellite'
    : 'diagram';

  const imageSource = imageSourceType === 'satellite'
    ? (satelliteUrl ? { uri: satelliteUrl } : null)
    : imageSourceType === 'photo'
    ? bundledPhoto
    : null;

  useEffect(() => {
    setImageReady(!imageSource);
    setAnalysisText('');
    setPointB({ x: imageWidth * 0.5, y: imageHeight * 0.58 });
    setMeasureMode(!isRoundActive);
    setPlannerViewMode('single');
    setPreferredView(hasBundledPhoto ? 'photo' : 'satellite');
    autoRunVision.current = false;
  }, [courseKey, hole, imageHeight, imageWidth, isRoundActive, imageSource, hasBundledPhoto]);

  // ── YARDAGE CALCULATION — TWO MODES ──────────────────────────────────────

  // Helper: calculate one yardage with fallback
  const calcYards = (
    targetLat: number,
    targetLng: number,
    fallback: number
  ): number => {
    // RULE 3: Pre-round — always static, never haversine
    if (!isRoundActive) return fallback;
    // RULE 4: On-course but GPS invalid — use fallback
    if (!gpsValid) return fallback;
    // On-course but no target coords — use fallback
    if (Math.abs(targetLat) <= 0.01) return fallback;
    if (Math.abs(targetLng) <= 0.01) return fallback;
    // Live yardage via haversine
    const result = haversineYards(
      gpsCoords!.latitude,
      gpsCoords!.longitude,
      targetLat,
      targetLng
    );
    // Sanity check: discard impossible values
    if (result < 5 || result > 800) return fallback;
    return Math.round(result);
  };

  // CENTER — NEVER null, NEVER '--', NEVER 0
  const centerYards: number =
    lockedYards ?? calcYards(middleLat, middleLng, distance);

  // FRONT
  const frontYards: number = calcYards(
    frontLat,
    frontLng,
    Math.round(distance * 0.88)
  );

  // BACK
  const backYards: number = calcYards(
    backLat,
    backLng,
    Math.round(distance * 1.10)
  );

  // RULE 5: plain ASCII only
  const playsLikeText = 'plays like ' + centerYards + ' yds';

  // ── MEASURING LINE — ON-COURSE ONLY ──────────────────────────────────────

  // Player dot position (on-course + valid GPS only)
  const playerPoint =
    isRoundActive && gpsValid && Math.abs(middleLat) > 0.01
      ? gpsToImagePoint(
          gpsCoords!.latitude,
          gpsCoords!.longitude,
          middleLat,
          middleLng,
          imageWidth,
          imageHeight
        )
      : null;

  // Green center is always image center
  const greenPoint = { x: imageWidth / 2, y: imageHeight / 2 };
  const teePoint = teePointState;
  const [pinPoint, setPinPoint] = useState(() => ({ x: imageWidth * 0.5, y: imageHeight * 0.12 }));

  const clampPoint = useCallback((x: number, y: number) => {
    const pad = 8;
    return {
      x: Math.max(pad, Math.min(imageWidth - pad, x)),
      y: Math.max(pad, Math.min(imageHeight - pad, y)),
    };
  }, [imageHeight, imageWidth]);

  const holeAxisPixels = useMemo(
    () => Math.max(1, Math.hypot(pinPoint.x - teePoint.x, pinPoint.y - teePoint.y)),
    [pinPoint, teePoint]
  );

  const teeToB = useMemo(() => {
    const pixels = Math.hypot(pointB.x - teePoint.x, pointB.y - teePoint.y);
    return Math.max(0, Math.min(Math.round(distance * 1.5), Math.round((pixels / holeAxisPixels) * distance)));
  }, [distance, holeAxisPixels, pointB, teePoint]);

  const bToPin = useMemo(() => {
    const pixels = Math.hypot(pinPoint.x - pointB.x, pinPoint.y - pointB.y);
    return Math.max(0, Math.min(Math.round(distance * 1.5), Math.round((pixels / holeAxisPixels) * distance)));
  }, [distance, holeAxisPixels, pinPoint, pointB]);

  // ── SMARTVISION — RULE 6: proxy only ─────────────────────────────────────

  const runSmartVision = useCallback(async () => {
    if (!imageSource) return;
    setAnalysisLoading(true);
    try {
      let base64 = '';
      const fsAny = FileSystem as any;
      const base64Encoding = fsAny.EncodingType?.Base64 ?? 'base64';

      if (satelliteUrl) {
        const cacheDir = fsAny.cacheDirectory ?? '';
        const dest = `${cacheDir}sv_hole_${courseKey}_${hole}.jpg`;
        const dl = await fsAny.downloadAsync(satelliteUrl, dest);
        base64 = await fsAny.readAsStringAsync(
          dl.uri,
          { encoding: base64Encoding }
        );
      } else if (bundledPhoto) {
        const asset = Asset.fromModule(bundledPhoto);
        await asset.downloadAsync();
        base64 = await fsAny.readAsStringAsync(
          asset.localUri ?? asset.uri,
          { encoding: base64Encoding }
        );
      }

      if (!base64) {
        setAnalysisText('No image to analyze.');
        return;
      }

      // RULE 6: proxy only — never openai.com
      const url = `${getApiBaseUrl()}/api/vision`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'hole',
          imageBase64: base64,
          mimeType: 'image/jpeg',
          hole,
          par,
          distance: centerYards,
          note,
          courseId,
          courseName,
          sourceType: satelliteUrl ? 'satellite' : 'photo',
          isRoundActive,
        }),
      });

      if (!res.ok) {
        setAnalysisText('Analysis unavailable.');
        return;
      }

      const json = await res.json() as { message?: string };
      const msg = json.message ?? '';
      setAnalysisText(msg);

      const { voiceEnabled } = useSettingsStore.getState();
      if (voiceEnabled && msg) {
        void vsSpeakFn(msg);
      }
    } catch (e) {
      console.log('[SmartVision]', e);
      setAnalysisText('Analysis unavailable.');
    } finally {
      setAnalysisLoading(false);
    }
  }, [bundledPhoto, centerYards, courseId, courseKey, courseName, hole, imageSource, isRoundActive, note, par, satelliteUrl]);

  useEffect(() => {
    if (!imageReady || analysisLoading || autoRunVision.current || !imageSource) {
      return;
    }
    autoRunVision.current = true;
    void runSmartVision();
  }, [analysisLoading, imageReady, imageSource, runSmartVision]);

  const updatePlannerPoint = useCallback((event: any) => {
    if (!measureMode) return;

    const { locationX, locationY } = event.nativeEvent;
    if (draggingTeeRef.current) {
      setTeePointState(clampPoint(locationX, locationY));
    } else if (draggingPinRef.current) {
      setPinPoint(clampPoint(locationX, locationY));
    } else {
      setPointB(clampPoint(locationX, locationY));
    }
  }, [clampPoint, measureMode]);

  const startPlannerDrag = useCallback((event: any) => {
    if (!measureMode) return;
    const { locationX, locationY } = event.nativeEvent;
    const dxTee = locationX - teePoint.x;
    const dyTee = locationY - teePoint.y;
    const dxPin = locationX - pinPoint.x;
    const dyPin = locationY - pinPoint.y;
    const nearTee = Math.hypot(dxTee, dyTee) <= 28;
    const nearPin = Math.hypot(dxPin, dyPin) <= 28;
    draggingTeeRef.current = nearTee;
    draggingPinRef.current = !nearTee && nearPin;
    updatePlannerPoint(event);
  }, [measureMode, teePoint, pinPoint, updatePlannerPoint]);

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, ultraCompactLayout && styles.scrollContentSmall]}
        showsVerticalScrollIndicator={false}
      >

        {/* HEADER */}
        <View style={[styles.header, ultraCompactLayout && styles.headerSmall]}>
          <View style={[styles.headerSide, compactLayout && styles.headerSideCompact, ultraCompactLayout && styles.headerSideSmall]}>
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={[styles.backText, compactLayout && styles.backTextCompact, ultraCompactLayout && styles.backTextSmall]}>{'< Back'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.headerTitle, compactLayout && styles.headerTitleCompact, ultraCompactLayout && styles.headerTitleSmall]} numberOfLines={1}>
            {'Hole ' + hole + ' - Par ' + par}
          </Text>
          <View style={[styles.headerSide, compactLayout && styles.headerSideCompact, ultraCompactLayout && styles.headerSideSmall]} />
        </View>

        {/* HOLE IMAGE + MEASURING LINE — RULE 7 */}
        <View
          onStartShouldSetResponder={() => measureMode && plannerViewMode === 'single'}
          onMoveShouldSetResponder={() => measureMode && plannerViewMode === 'single'}
          onResponderGrant={startPlannerDrag}
          onResponderMove={updatePlannerPoint}
          style={[
          styles.imageWrapper,
          compactLayout && styles.imageWrapperCompact,
          ultraCompactLayout && styles.imageWrapperSmall,
          { width: imageWidth, height: imageHeight },
          ]}
        >
          {plannerViewMode === 'split' && canSplitCompare ? (
            <View style={styles.splitCompareColumn}>
              <View style={styles.splitPane}>
                <Image
                  source={bundledPhoto}
                  style={styles.holeImage}
                  resizeMode='cover'
                />
                <View style={[styles.splitPaneLabel, styles.splitPaneLabelPhoto]}>
                  <Text style={styles.splitPaneLabelText}>PHOTO</Text>
                </View>
              </View>
              <View style={styles.splitDivider} />
              <View style={styles.splitPane}>
                <Image
                  source={{ uri: satelliteUrl! }}
                  style={styles.holeImage}
                  resizeMode='cover'
                  onLoadEnd={() => setImageReady(true)}
                />
                <View style={[styles.splitPaneLabel, styles.splitPaneLabelSatellite]}>
                  <Text style={styles.splitPaneLabelText}>SATELLITE</Text>
                </View>
              </View>
            </View>
          ) : imageSource ? (
            <Image
              source={imageSource}
              style={styles.holeImage}
              resizeMode={compactLayout ? 'contain' : 'cover'}
              onLoadEnd={() => setImageReady(true)}
            />
          ) : (
            <HoleDiagram
              hole={{ hole, par, distance, note }}
              width={imageWidth}
              height={imageHeight}
            />
          )}

          {/* MEASURING LINE — on-course only, RULE 7 */}
          {isRoundActive && gpsValid && playerPoint !== null && (
            <Svg
              style={StyleSheet.absoluteFill}
              width={imageWidth}
              height={imageHeight}
            >
              <Line
                x1={playerPoint.x}
                y1={playerPoint.y}
                x2={greenPoint.x}
                y2={greenPoint.y}
                stroke='#00C896'
                strokeWidth={2}
                strokeDasharray='6,4'
              />
              <Circle
                cx={playerPoint.x}
                cy={playerPoint.y}
                r={8}
                fill='#00C896'
                stroke='#ffffff'
                strokeWidth={2}
              />
              <Circle
                cx={greenPoint.x}
                cy={greenPoint.y}
                r={6}
                fill='#F5A623'
                stroke='#ffffff'
                strokeWidth={2}
              />
            </Svg>
          )}

          {plannerViewMode === 'single' && measureMode && !isRoundActive && (
            <Svg
              style={StyleSheet.absoluteFill}
              width={imageWidth}
              height={imageHeight}
            >
              <Line
                x1={teePoint.x}
                y1={teePoint.y}
                x2={pointB.x}
                y2={pointB.y}
                stroke='#38bdf8'
                strokeWidth={2.5}
                strokeDasharray='6,4'
              />
              <Line
                x1={pointB.x}
                y1={pointB.y}
                x2={pinPoint.x}
                y2={pinPoint.y}
                stroke='#f59e0b'
                strokeWidth={2.5}
                strokeDasharray='6,4'
              />
              {/* Tee drag hint ring */}
              <Circle
                cx={teePoint.x}
                cy={teePoint.y}
                r={26}
                fill='transparent'
                stroke='rgba(6,182,212,0.28)'
                strokeWidth={2}
                strokeDasharray='4,3'
              />
              <Circle
                cx={teePoint.x}
                cy={teePoint.y}
                r={9}
                fill='#06b6d4'
                stroke='#ffffff'
                strokeWidth={2}
              />
              <Circle
                cx={pointB.x}
                cy={pointB.y}
                r={9}
                fill='#f59e0b'
                stroke='#ffffff'
                strokeWidth={2}
              />
              <Circle
                cx={pinPoint.x}
                cy={pinPoint.y}
                r={8}
                fill='#22c55e'
                stroke='#ffffff'
                strokeWidth={2}
              />
              {/* Pin drag hint ring */}
              <Circle
                cx={pinPoint.x}
                cy={pinPoint.y}
                r={26}
                fill='transparent'
                stroke='rgba(34,197,94,0.28)'
                strokeWidth={2}
                strokeDasharray='4,3'
              />
              <Circle
                cx={pointB.x}
                cy={pointB.y}
                r={18}
                fill='transparent'
                stroke='rgba(245,158,11,0.35)'
                strokeWidth={2}
              />
            </Svg>
          )}
          {plannerViewMode === 'single' && measureMode && !isRoundActive && (
            <View style={styles.plannerLegendRow}>
              <View style={styles.legendChipA}><Text style={styles.legendChipText}>A TEE</Text></View>
              <View style={styles.legendChipB}><Text style={styles.legendChipText}>B TARGET</Text></View>
              <View style={styles.legendChipPin}><Text style={styles.legendChipText}>PIN</Text></View>
            </View>
          )}

          <View style={[styles.overlayRail, compactLayout && styles.overlayRailCompact, ultraCompactLayout && styles.overlayRailUltraCompact]}>
            <View style={[styles.modeBadgeRowOverlay, compactLayout && styles.modeBadgeRowOverlayCompact]}>
              <View style={[
                styles.modeBadge,
                isRoundActive ? styles.modeBadgeLive : styles.modeBadgeStatic,
              ]}>
                <Text style={styles.modeBadgeText}>
                  {isRoundActive ? 'LIVE GPS' : 'PRE-ROUND'}
                </Text>
              </View>
              {isRoundActive && !gpsValid && (
                <View style={styles.modeBadgeWaiting}>
                  <Text style={styles.modeBadgeText}>Acquiring GPS...</Text>
                </View>
              )}
            </View>
          </View>

          {/* Measure readout — left-side overlay on image, always shown while measure mode active */}
          {measureMode && !isRoundActive && (() => {
            const approachClub = suggestClubForYards(bToPin, clubDistancesPlayer);
            return (
              <View style={styles.measureOverlayLeft}>
                <Text style={styles.measureOverlayLabel}>FROM TEE</Text>
                <Text style={styles.measureOverlayValue}>{teeToB} yds</Text>
                <View style={styles.measureOverlayDivider} />
                <Text style={styles.measureOverlayLabel}>APPROACH</Text>
                <Text style={styles.measureOverlayValue}>{bToPin} yds</Text>
                {approachClub && bToPin > 0 ? (
                  <Text style={styles.measureOverlayClub}>{approachClub}</Text>
                ) : null}
              </View>
            );
          })()}

        </View>

        {/* BOTTOM CONTROL CARD */}
        <View style={[styles.bottomControlCard, ultraCompactLayout && styles.bottomControlCardSmall]}>
          {/* Row: image source pill + measure toggle + SmartVision button */}
          <View style={styles.bottomControlRow}>
            <View style={[styles.controlPill, imageSourceType === 'photo' ? styles.modeBadgePhoto : styles.modeBadgeStatic]}>
              <Text style={styles.modeBadgeText}>
                {imageSourceType === 'photo' ? 'PHOTO' : imageSourceType === 'satellite' ? 'SATELLITE' : 'DIAGRAM'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.measureBtn, measureMode && styles.measureBtnActive]}
              onPress={() => {
                const next = !measureMode;
                if (next) setPlannerViewMode('single');
                setMeasureMode(next);
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.measureBtnText, measureMode && styles.measureBtnTextActive]}>
                {measureMode ? 'Measure on' : 'Measure'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.svBtn, styles.svBtnRow, !imageSource && styles.svBtnDisabled, analysisLoading && styles.svBtnLoading]}
              onPress={runSmartVision}
              disabled={!imageSource || analysisLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.svBtnText} numberOfLines={1}>
                {analysisLoading ? 'Analyzing...' : analysisText ? 'Re-run' : imageSource ? 'Analyze' : 'No image'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* SmartVision analysis box — always visible */}
          <View style={styles.analysisBox}>
            <Text style={styles.analysisLabel}>SMARTVISION</Text>
            <Text style={styles.analysisText}>
              {analysisText || 'Run SmartVision to get hole analysis and shot recommendations.'}
            </Text>
          </View>
        </View>

        {/* HOLE NOTE — below image */}
        {Boolean(note) && (
          <View style={styles.belowNoteRow}>
            <Text style={styles.belowNoteText}>{note}</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  scrollContentSmall: {
    paddingHorizontal: 0,
    paddingBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  headerSmall: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  headerSide: {
    width: 88,
    justifyContent: 'center',
  },
  headerSideCompact: {
    width: 78,
  },
  headerSideSmall: {
    width: 54,
  },
  backText: {
    color: '#00C896',
    fontSize: 18,
  },
  backTextCompact: {
    fontSize: 16,
  },
  backTextSmall: {
    fontSize: 14,
  },
  headerTitle: {
    flex: 1,
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerTitleCompact: {
    fontSize: 15,
  },
  headerTitleSmall: {
    fontSize: 13,
  },
  modeBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  modeBadgeRowCompact: {
    marginBottom: 8,
  },
  modeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  modeBadgeLive: {
    backgroundColor: '#003d20',
    borderWidth: 1,
    borderColor: '#00C896',
  },
  modeBadgeStatic: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#444',
  },
  modeBadgeWaiting: {
    backgroundColor: '#2a1a00',
    borderWidth: 1,
    borderColor: '#F5A623',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  modeBadgePhoto: {
    backgroundColor: '#10263a',
    borderWidth: 1,
    borderColor: '#5ea0ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  modeBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  imageWrapper: {
    alignSelf: 'center',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
    backgroundColor: '#08110d',
  },
  imageWrapperCompact: {
    borderRadius: 10,
  },
  imageWrapperSmall: {
    borderRadius: 0,
    marginBottom: 4,
    alignSelf: 'stretch',
  },
  holeImage: {
    width: '100%',
    height: '100%',
  },
  splitCompareColumn: {
    flex: 1,
    backgroundColor: '#08110d',
  },
  splitPane: {
    flex: 1,
    position: 'relative',
  },
  splitDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  splitPaneLabel: {
    position: 'absolute',
    top: 8,
    left: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  splitPaneLabelPhoto: {
    backgroundColor: 'rgba(16,38,58,0.88)',
    borderColor: '#5ea0ff',
  },
  splitPaneLabelSatellite: {
    backgroundColor: 'rgba(42,26,0,0.88)',
    borderColor: '#F5A623',
  },
  splitPaneLabelText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  overlayRail: {
    position: 'absolute',
    top: 10,
    left: 10,
    maxWidth: '50%',
    gap: 8,
    backgroundColor: 'rgba(4, 20, 12, 0.80)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 150, 0.22)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  overlayRailCompact: {
    maxWidth: '52%',
    top: 8,
    left: 8,
    gap: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  overlayRailUltraCompact: {
    maxWidth: '55%',
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  modeBadgeRowOverlay: {
    gap: 6,
  },
  modeBadgeRowOverlayCompact: {
    gap: 4,
  },
  overlayControlCard: {
    gap: 6,
  },
  overlayControlCardCompact: {
    gap: 5,
  },
  plannerLegendRow: {
    position: 'absolute',
    left: 10,
    bottom: 72,
    flexDirection: 'row',
    gap: 6,
  },
  legendChipA: {
    backgroundColor: 'rgba(6,182,212,0.85)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  legendChipB: {
    backgroundColor: 'rgba(245,158,11,0.9)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  legendChipPin: {
    backgroundColor: 'rgba(34,197,94,0.88)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  legendChipText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  measureBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#35545d',
    borderRadius: 12,
    minHeight: 40,
    paddingHorizontal: 8,
    paddingVertical: 0,
    backgroundColor: '#0d1a1f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  measureBtnOverlay: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  measureBtnCompact: {
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  measureBtnUltraCompact: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  measureBtnActive: {
    borderColor: '#F5A623',
    backgroundColor: '#2a1a00',
  },
  measureBtnText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  measureBtnTextCompact: {
    fontSize: 12,
  },
  measureBtnTextUltraCompact: {
    fontSize: 11,
  },
  measureBtnTextActive: {
    color: '#F5A623',
  },
  measureReadout: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: '#0d2418',
    borderWidth: 1,
    borderColor: '#214d37',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  measureReadoutOverlay: {
    flex: 0,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  measureReadoutCompact: {
    flexBasis: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  measureReadoutUltraCompact: {
    flexBasis: '100%',
    borderColor: '#2d7a58',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  measureReadoutText: {
    color: '#d1fae5',
    fontSize: 13,
    fontWeight: '600',
  },
  measureReadoutTextCompact: {
    fontSize: 12,
  },
  measureReadoutTextUltraCompact: {
    fontSize: 13,
    fontWeight: '700',
  },
  measureReadoutSubtext: {
    color: '#9cd8c0',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  measureClubSuggestion: {
    color: '#00C896',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
    letterSpacing: 0.3,
  },
  measureOverlayLeft: {
    position: 'absolute',
    left: 10,
    top: '50%' as any,
    transform: [{ translateY: -70 }],
    backgroundColor: 'rgba(6,15,9,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.45)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 90,
  },
  measureOverlayLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  measureOverlayValue: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 1,
  },
  measureOverlayDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 6,
  },
  measureOverlayClub: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 5,
    letterSpacing: 0.3,
  },
  measureReadoutSubtextCompact: {
    fontSize: 10,
    marginTop: 1,
  },
  measureReadoutSubtextUltraCompact: {
    fontSize: 11,
  },
  svBtn: {
    backgroundColor: '#0d2418',
    borderWidth: 1,
    borderColor: '#00C896',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  svBtnOverlay: {
    marginBottom: 0,
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    borderColor: 'rgba(0,200,150,0.35)',
  },
  svBtnCompact: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 5,
  },
  svBtnDisabled: {
    borderColor: '#333',
    opacity: 0.5,
  },
  svBtnLoading: {
    borderColor: '#F5A623',
  },
  svBtnText: {
    color: '#00C896',
    fontSize: 13,
    fontWeight: '600',
  },
  svBtnTextCompact: {
    fontSize: 12,
  },
  analysisCard: {
    backgroundColor: '#0d2418',
    borderLeftWidth: 3,
    borderLeftColor: '#00C896',
    borderRadius: 8,
    padding: 9,
    marginBottom: 6,
  },
  analysisCardOverlay: {
    marginBottom: 0,
    backgroundColor: 'transparent',
    borderLeftWidth: 0,
    borderRadius: 0,
    padding: 0,
  },
  analysisCardOverlayCompact: {
    padding: 0,
  },
  analysisLabel: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  analysisText: {
    color: '#e8f5f0',
    fontSize: 13,
    lineHeight: 19,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  analysisTextCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  yardageOverlayRow: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    gap: 8,
  },
  yardageOverlayRowCompact: {
    left: 8,
    right: 8,
    bottom: 8,
    gap: 4,
  },
  yardageOverlayRowUltraCompact: {
    gap: 3,
    bottom: 7,
  },
  yardageRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  yardageRowCompact: {
    gap: 4,
    marginBottom: 6,
  },
  yardageRowUltraCompact: {
    gap: 3,
    marginBottom: 5,
  },
  yardCard: {
    flex: 1,
    backgroundColor: '#0d2418',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
  },
  yardCardOverlay: {
    backgroundColor: 'rgba(13,36,24,0.92)',
  },
  yardCardCompact: {
    paddingHorizontal: 5,
    paddingVertical: 4,
    borderRadius: 8,
    minHeight: 72,
  },
  yardCardUltraCompact: {
    paddingHorizontal: 3,
    paddingVertical: 3,
    minHeight: 64,
    borderRadius: 7,
  },
  yardCardCenter: {
    flex: 1.5,
    borderWidth: 1.5,
    borderColor: '#00C896',
  },
  yardCardCenterCompact: {
    flex: 1.02,
  },
  yardCardCenterUltraCompact: {
    flex: 0.9,
  },
  yardCardLocked: {
    borderColor: '#F5A623',
  },
  yardLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  yardLabelCompact: {
    fontSize: 8,
    marginBottom: 2,
  },
  yardLabelUltraCompact: {
    fontSize: 7,
    marginBottom: 1,
    letterSpacing: 0.8,
  },
  yardLabelCenter: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  yardValue: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
  },
  yardValueCompact: {
    fontSize: 15,
    lineHeight: 16,
  },
  yardValueUltraCompact: {
    fontSize: 12,
    lineHeight: 14,
  },
  yardValueCenter: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
  },
  yardValueCenterCompact: {
    fontSize: 18,
    lineHeight: 20,
  },
  yardValueCenterUltraCompact: {
    fontSize: 14,
    lineHeight: 16,
  },
  playsLike: {
    color: '#F5A623',
    fontSize: 11,
    marginTop: 1,
    textAlign: 'center',
  },
  playsLikeCompact: {
    fontSize: 9,
    lineHeight: 11,
    marginTop: 0,
  },
  playsLikeUltraCompact: {
    fontSize: 7,
    lineHeight: 9,
  },
  staticNote: {
    color: '#6b7280',
    fontSize: 10,
    marginTop: 1,
  },
  staticNoteCompact: {
    fontSize: 8,
    marginTop: 0,
  },
    staticNoteUltraCompact: {
    fontSize: 6,
    lineHeight: 8,
  },
  bottomControlCard: {
    marginTop: 10,
    backgroundColor: '#0b1a13',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1b3d2d',
    padding: 12,
    gap: 10,
  },
  bottomControlCardSmall: {
    marginTop: 4,
    borderRadius: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    padding: 8,
    gap: 6,
  },
  bottomControlRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  controlPill: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  svBtnRow: {
    flex: 1,
    marginBottom: 0,
    minHeight: 40,
    paddingVertical: 0,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  analysisBox: {
    backgroundColor: '#060f09',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2e5c42',
    padding: 10,
  },
  belowNoteRow: {
    marginTop: 10,
    marginBottom: 10,
    backgroundColor: '#101a12',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a3d2e',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  belowNoteText: {
    color: '#9ca3af',
    fontSize: 11,
    lineHeight: 15,
    fontStyle: 'italic',
  },
});
