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
} from 'react-native';
import KevinBadge from '../components/KevinBadge';
import { useKevinPresence } from '../contexts/KevinPresenceContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useKeepAwake } from 'expo-keep-awake';
import Svg, { Line, Circle, Text as SvgText } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { File, Paths } from 'expo-file-system';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRoundStore } from '../store/roundStore';
import { speak, configureAudioForSpeech } from '../services/voiceService';
import { useSmartVision } from '../contexts/SmartVisionContext';
import PALMS_IMAGES from '../data/palmsImages';
import {
  getLandmarksForHole,
  resolveCourseKey,
  type Landmark,
} from '../services/landmarks';

const CLUBS = [
  'Driver', '3W', '5W', 'Hybrid',
  '3i', '4i', '5i', '6i', '7i', '8i', '9i',
  'PW', 'GW', 'SW', 'LW', 'Putter',
];

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return Math.floor(diff / 60_000) + 'm ago';
  return Math.floor(diff / 3600_000) + 'h ago';
}

// ─── SATELLITE CACHE ──────────────────────
const SATELLITE_CACHE: Record<string, string> = {};

// ─── GPS HELPERS ──────────────────────────

const haversineYards = (
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number => {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1.09361;
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
  useKeepAwake();
  const router = useRouter();
  const { width: W, height: H } = useWindowDimensions();
  const IMAGE_WIDTH = W - 24;
  // Satellite: Google Maps tiles are 6:5 aspect
  const IMAGE_HEIGHT_SAT = Math.min(
    Math.round(IMAGE_WIDTH * (500 / 600)),
    Math.round(H * 0.40),
  );
  // Bundled: our Palms images are 705×1455 (≈2.064 tall)
  const IMAGE_HEIGHT_BUNDLED = Math.min(
    Math.round(IMAGE_WIDTH * (1455 / 705)),
    Math.round(H * 0.82),
  );

  const params = useLocalSearchParams();
  const hole = Number(String(params.hole ?? '')) || 1;
  const par = Number(String(params.par ?? '')) || 4;
  const distance = Number(String(params.distance ?? '')) || 150;
  const courseName = String(params.courseName ?? '');
  const isRoundActive = params.isRoundActive === 'true';
  const autoRunVision = params.autoRunVision === 'true';
  const teeLat = Number(String(params.teeLat ?? '')) || 0;
  const teeLng = Number(String(params.teeLng ?? '')) || 0;
  const middleLat = Number(String(params.middleLat ?? '')) || 0;
  const middleLng = Number(String(params.middleLng ?? '')) || 0;
  const frontYards = Number(String(params.front ?? '')) || 0;
  const backYards = Number(String(params.back ?? '')) || 0;

  const { voiceGender, language } = useSettingsStore();
  const { dominantMiss, firstName } = usePlayerProfileStore();
  const { setSmartVisionState } = useSmartVision();
  const {
    isRoundActive: roundActive,
    addOrUpdatePlan,
    lockPlanForHole,
    getPlanForHole,
    activeCourseId,
    activeCourse,
  } = useRoundStore();
  const { setMode } = useKevinPresence();

  useEffect(() => { setMode('badge'); }, []);

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

  // ── Core state ─────────────────────────
  const [gpsCoords, setGpsCoords] = useState<{
    latitude: number; longitude: number; accuracy: number;
  } | null>(null);
  const [gpsValid, setGpsValid] = useState(false);
  const [centerYards, setCenterYards] = useState(distance);
  const [imageReady, setImageReady] = useState(false);
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

  // ── Image source resolution ────────────
  const bundledImage = courseName.toLowerCase().includes('palms')
    ? (PALMS_IMAGES[hole] ?? null)
    : null;

  const getSatelliteUrl = useCallback((): string | null => {
    if (!mapsKey) return null;
    if (Math.abs(middleLat) < 0.01 || Math.abs(middleLng) < 0.01) return null;
    const hasTee = Math.abs(teeLat) > 0.01 && Math.abs(teeLng) > 0.01;
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
  }, [mapsKey, middleLat, middleLng, teeLat, teeLng, distance, par]);

  const satelliteUrl = getSatelliteUrl();

  type DisplayType = 'bundled' | 'satellite' | 'none';
  const displayType: DisplayType =
    bundledImage ? 'bundled'
    : satelliteUrl ? 'satellite'
    : 'none';

  const IMAGE_HEIGHT = displayType === 'bundled' ? IMAGE_HEIGHT_BUNDLED : IMAGE_HEIGHT_SAT;

  const imageSource =
    displayType === 'bundled' ? bundledImage
    : displayType === 'satellite' ? { uri: satelliteUrl! }
    : null;

  // ── Yards per pixel (bundled only) ─────
  const yardsPerPixel = distance / (IMAGE_HEIGHT_BUNDLED * 0.80 || 1);

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
  useEffect(() => {
    if (displayType !== 'bundled' || markersReady) return;
    const cx = IMAGE_WIDTH / 2;
    const tee    = { x: cx, y: IMAGE_HEIGHT_BUNDLED * 0.87 };
    const target = { x: cx, y: IMAGE_HEIGHT_BUNDLED * 0.52 };
    const pin    = { x: cx, y: IMAGE_HEIGHT_BUNDLED * 0.10 };
    teePosRef.current = tee;
    targetPosRef.current = target;
    pinPosRef.current = pin;
    setTeePos(tee);
    setTargetPos(target);
    setPinPos(pin);
    setMarkersReady(true);
  }, [displayType, IMAGE_WIDTH, IMAGE_HEIGHT_BUNDLED, markersReady]);

  // ── Restore existing plan when markers initialise ──
  useEffect(() => {
    if (!markersReady || !roundActive) return;
    const plan = getPlanForHole(hole);
    if (!plan) return;
    const { tee, approach, pin } = plan.markers;
    teePosRef.current   = { x: tee.x,      y: tee.y };
    setTeePos({ x: tee.x, y: tee.y });
    if (approach) {
      targetPosRef.current = { x: approach.x, y: approach.y };
      setTargetPos({ x: approach.x, y: approach.y });
    }
    if (pin) {
      pinPosRef.current = { x: pin.x, y: pin.y };
      setPinPos({ x: pin.x, y: pin.y });
    }
    setTeeClub(tee.club_intent);
    setApproachClub(approach?.club_intent ?? null);
    setPinClub(pin?.club_intent ?? null);
  }, [markersReady, roundActive, hole]); // intentionally not tracking getPlanForHole

  // ── Auto-save plan when drag ends ──────
  useEffect(() => {
    if (displayType !== 'bundled' || !markersReady || !roundActive) return;
    if (prevDraggingRef.current && !isDragging) {
      if (planSaveTimerRef.current) clearTimeout(planSaveTimerRef.current);
      planSaveTimerRef.current = setTimeout(() => {
        addOrUpdatePlan({
          hole_number: hole,
          markers: {
            tee:      { x: teePos.x,    y: teePos.y,    club_intent: teeClub,    landmark_target: teeLandmark ? { name: teeLandmark.name, description: teeLandmark.description } : null },
            approach: { x: targetPos.x, y: targetPos.y, club_intent: approachClub, landmark_target: approachLandmark ? { name: approachLandmark.name, description: approachLandmark.description } : null },
            pin:      { x: pinPos.x,    y: pinPos.y,    club_intent: pinClub,    landmark_target: pinLandmark ? { name: pinLandmark.name, description: pinLandmark.description } : null },
          },
          computed_yardages: {
            from_tee_to_approach: fromTeeYards,
            from_approach_to_pin: approachYards,
            total: fromTeeYards + approachYards,
          },
        });
      }, 500);
    }
    prevDraggingRef.current = isDragging;
  }, [isDragging]);

  // ── Re-save when club intent changes ───
  const saveClubUpdate = useCallback((
    nextTee: string | null,
    nextApp: string | null,
    nextPin: string | null,
  ) => {
    if (!roundActive || !markersReady) return;
    addOrUpdatePlan({
      hole_number: hole,
      markers: {
        tee:      { x: teePos.x,    y: teePos.y,    club_intent: nextTee, landmark_target: teeLandmark ? { name: teeLandmark.name, description: teeLandmark.description } : null },
        approach: { x: targetPos.x, y: targetPos.y, club_intent: nextApp, landmark_target: approachLandmark ? { name: approachLandmark.name, description: approachLandmark.description } : null },
        pin:      { x: pinPos.x,    y: pinPos.y,    club_intent: nextPin, landmark_target: pinLandmark ? { name: pinLandmark.name, description: pinLandmark.description } : null },
      },
      computed_yardages: {
        from_tee_to_approach: fromTeeYards,
        from_approach_to_pin: approachYards,
        total: fromTeeYards + approachYards,
      },
    });
  }, [roundActive, markersReady, hole, teePos, targetPos, pinPos, fromTeeYards, approachYards, teeLandmark, approachLandmark, pinLandmark]);

  const saveLandmarkUpdate = useCallback((
    nextTee: Landmark | null,
    nextApp: Landmark | null,
    nextPin: Landmark | null,
  ) => {
    if (!roundActive || !markersReady) return;
    addOrUpdatePlan({
      hole_number: hole,
      markers: {
        tee:      { x: teePos.x,    y: teePos.y,    club_intent: teeClub,    landmark_target: nextTee ? { name: nextTee.name, description: nextTee.description } : null },
        approach: { x: targetPos.x, y: targetPos.y, club_intent: approachClub, landmark_target: nextApp ? { name: nextApp.name, description: nextApp.description } : null },
        pin:      { x: pinPos.x,    y: pinPos.y,    club_intent: pinClub,    landmark_target: nextPin ? { name: nextPin.name, description: nextPin.description } : null },
      },
      computed_yardages: {
        from_tee_to_approach: fromTeeYards,
        from_approach_to_pin: approachYards,
        total: fromTeeYards + approachYards,
      },
    });
  }, [roundActive, markersReady, hole, teePos, targetPos, pinPos, teeClub, approachClub, pinClub, fromTeeYards, approachYards]);

  const handleLockPlan = useCallback(() => {
    lockPlanForHole(hole);
  }, [hole, lockPlanForHole]);

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
  }, []);

  useEffect(() => {
    if (displayType !== 'bundled') setSmartVisionState({ centerYards });
  }, [centerYards, displayType]);

  useEffect(() => {
    if (displayType !== 'bundled') setSmartVisionState({ measureYards });
  }, [measureYards, displayType]);

  useEffect(() => {
    if (displayType === 'bundled' && markersReady) {
      setSmartVisionState({ centerYards: fromTeeYards, measureYards: approachYards });
    }
  }, [fromTeeYards, approachYards, displayType, markersReady]);

  useEffect(() => {
    if (analysisText) setSmartVisionState({ analysisText });
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
          dlBinary += String.fromCharCode(...(uint8.subarray(offset, offset + CHUNK) as unknown as number[]));
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
        }),
      });
      if (!res.ok) throw new Error('API error ' + res.status);
      const data = await res.json() as { message?: string };
      const message = data.message ?? '';
      if (!message) throw new Error('Empty response');
      setAnalysisText(message);
      await configureAudioForSpeech();
      await speak(message, voiceGender, language, apiUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('[SmartVision] error:', msg);
      setAnalysisText('Take a look at the layout and pick your target.');
    } finally {
      setAnalysisLoading(false);
    }
  }, [
    satelliteUrl, hole, par, centerYards, courseName,
    firstName, dominantMiss, isRoundActive, apiUrl, voiceGender, language,
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

  // Plan UI derived state
  const existingPlan  = roundActive ? getPlanForHole(hole) : null;
  const isPlanLocked  = existingPlan?.locked_at != null;
  const planCreatedAt = existingPlan?.created_at ?? null;

  const modeBadgeText =
    isRoundActive && gpsValid ? '● LIVE GPS'
    : isRoundActive ? '○ GPS SEARCHING...'
    : '○ PRE-ROUND';
  const modeBadgeColor = isRoundActive && gpsValid ? '#00C896' : '#6b7280';

  // ── RENDER ─────────────────────────────
  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        scrollEnabled={!isDragging}
      >

        {/* HEADER */}
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

        {/* MODE BADGE */}
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { borderColor: modeBadgeColor }]}>
            <Text style={[styles.badgeText, { color: modeBadgeColor }]}>
              {modeBadgeText}
            </Text>
          </View>
        </View>

        {/* HOLE IMAGE */}
        <View
          style={[styles.imageWrapper, { width: IMAGE_WIDTH, height: IMAGE_HEIGHT }]}
          onStartShouldSetResponder={() => measureMode && displayType === 'satellite'}
          onResponderRelease={handleImageTap}
        >
          {imageSource ? (
            <Image
              source={imageSource}
              style={styles.holeImage}
              resizeMode={displayType === 'bundled' ? 'contain' : 'cover'}
              onLoad={() => setImageReady(true)}
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
          <TouchableOpacity
            style={styles.btn}
            onPress={() => router.push({ pathname: '/hole-view-3d', params: { courseName } } as never)}
          >
            <Text style={styles.btnText}>🌐 3D View</Text>
          </TouchableOpacity>
        </View>

        {/* PLAN ROW — bundled + round active only */}
        {displayType === 'bundled' && roundActive && markersReady && (
          <View style={styles.planRow}>
            {/* Lock / status button */}
            <TouchableOpacity
              style={[styles.lockBtn, isPlanLocked && styles.lockBtnLocked]}
              onPress={handleLockPlan}
              disabled={isPlanLocked}
            >
              <Text style={[styles.lockBtnText, isPlanLocked && styles.lockBtnTextLocked]}>
                {isPlanLocked ? 'Plan Locked ✓' : existingPlan ? 'Lock Plan' : 'Lock Plan'}
              </Text>
            </TouchableOpacity>
            {planCreatedAt != null && (
              <Text style={styles.planAgeText}>
                {isPlanLocked ? 'Locked ' : 'Draft · '}
                {timeAgo(isPlanLocked ? (existingPlan?.locked_at ?? planCreatedAt) : planCreatedAt)}
              </Text>
            )}
          </View>
        )}

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
            {isRoundActive && gpsValid && (
              <Text style={styles.playsLike}>{'plays like ' + centerYards + ' yds'}</Text>
            )}
          </View>
          <View style={styles.yardCard}>
            <Text style={styles.yardLabel}>BACK</Text>
            <Text style={styles.yardValue}>{backYards > 0 ? backYards : distance + 16}</Text>
          </View>
        </View>

      </ScrollView>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  scroll: { paddingBottom: 32 },
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
  noImage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d2418' },
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
  markerLabel: { color: '#060f09', fontSize: 11, fontWeight: '900' },
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
  distDivider: { width: 1, height: 36, backgroundColor: '#1e3a28', marginHorizontal: 8 },
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
    borderWidth: 1, borderColor: '#1e3a28', backgroundColor: '#060f09',
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
    backgroundColor: '#0d2418', borderWidth: 1.5, borderColor: '#00C896',
    borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  svBtnLoading: { borderColor: '#F5A623' },
  svBtnText: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  analysisCard: {
    marginHorizontal: 12, marginBottom: 8,
    backgroundColor: '#0d2418', borderLeftWidth: 3, borderLeftColor: '#00C896',
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
    flex: 1, backgroundColor: '#0d2418', borderRadius: 10,
    paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#1e3a28',
  },
  yardCardCenter: { flex: 1.3, borderWidth: 2, borderColor: '#00C896' },
  yardLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  yardLabelGreen: { color: '#00C896', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  yardValue: { color: '#ffffff', fontSize: 26, fontWeight: '700' },
  yardValueCenter: { color: '#ffffff', fontSize: 38, fontWeight: '900' },
  playsLike: { color: '#F5A623', fontSize: 11, marginTop: 3 },
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
    flex: 1, backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28',
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
    backgroundColor: '#0d2418', borderTopLeftRadius: 20, borderTopRightRadius: 20,
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
    borderRadius: 20, borderWidth: 1, borderColor: '#1e3a28',
    backgroundColor: '#060f09',
  },
  clubChipActive: { borderColor: '#00C896', backgroundColor: '#003d20' },
  clubChipClear: { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)' },
  clubChipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  clubChipTextActive: { color: '#00C896' },
});
