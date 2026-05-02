import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Alert,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Rect, Text as SvgText, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { useRoundStore } from '../store/roundStore';
import { useSmartFinderStore, type SmartFinderMode } from '../store/smartFinderStore';
import {
  refreshFix,
  classifyAccuracy,
  getLastFix,
  getGreenYardagesSync,
  type GreenYardages,
  type GPSQualityReading,
} from '../services/smartFinderService';
import { fetchCourseGeometry, getHoleGeometry, type HoleGeometry } from '../services/courseGeometryService';
import { haversineYards, projectToAxis } from '../utils/geoDistance';
import { computeDistance, buildLock } from '../services/rangefinder';
import GPSQuality from '../components/smartfinder/GPSQuality';
import SmartFinderModeToggle from '../components/smartfinder/SmartFinderModeToggle';
import { useCurrentWeather } from '../hooks/useCurrentWeather';
import { playsLikeDistance } from '../utils/playsLike';
import type { WeatherSnapshot } from '../services/weatherService';

const REFRESH_MS = 3_000;
const CANVAS_W_FRACTION = 0.92;
const LOCK_DURATION_MS = 30_000;

/**
 * Phase D-2 SmartFinder — four modes:
 *   Standard: camera viewfinder + reticle + tap-to-lock distance via tilt-based AR (matches legacy v1).
 *   Target:   tap any point on the hole overhead view (SVG) to get yards to that point.
 *   Map:      hole map with player position, tee, green markers.
 *   Putt:     camera viewfinder + tap two points to measure A→B distance with a slope hint
 *             from device pitch (rough green-curvature read; v1).
 *
 * Mode persists across sessions. GPS quality indicator visible in all modes;
 * camera modes (Standard, Putt) overlay it on the camera; SVG modes show it in
 * the standard header.
 */
export default function SmartFinder() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentHole = useRoundStore(s => s.currentHole);
  const setCurrentHole = useRoundStore(s => s.setCurrentHole);
  const courseHoles = useRoundStore(s => s.courseHoles);
  const activeCourseId = useRoundStore(s => s.activeCourseId);

  const mode = useSmartFinderStore(s => s.mode);
  const setMode = useSmartFinderStore(s => s.setMode);

  const [yards, setYards] = useState<GreenYardages>(() => getGreenYardagesSync(currentHole));
  const [gps, setGps] = useState<GPSQualityReading>(() =>
    classifyAccuracy(getLastFix()?.accuracy_m ?? null),
  );
  const [geometry, setGeometry] = useState<HoleGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const fix = await refreshFix();
      if (cancelled) return;
      setGps(classifyAccuracy(fix?.accuracy_m ?? null));
      setYards(getGreenYardagesSync(currentHole));
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [currentHole]);

  useEffect(() => {
    let cancelled = false;
    if (!activeCourseId) {
      setGeometry(null);
      return;
    }
    const cached = getHoleGeometry(activeCourseId, currentHole);
    if (cached && !cancelled) setGeometry(cached);
    fetchCourseGeometry(activeCourseId).then(full => {
      if (cancelled) return;
      setGeometry(full?.holes.find(h => h.hole_number === currentHole) ?? null);
    });
    return () => { cancelled = true; };
  }, [activeCourseId, currentHole]);

  const playedHoles = useMemo(() => courseHoles.map(h => h.hole).sort((a, b) => a - b), [courseHoles]);
  const idx = playedHoles.indexOf(currentHole);
  const prevHole = idx > 0 ? playedHoles[idx - 1] : null;
  const nextHole = idx >= 0 && idx < playedHoles.length - 1 ? playedHoles[idx + 1] : null;

  const { weather: caddieWeather, shotBearingDeg } = useCurrentWeather();
  const [holePickerOpen, setHolePickerOpen] = useState(false);

  // Camera modes share the camera view + need permission gate
  const isCameraMode = mode === 'standard' || mode === 'putt';

  if (isCameraMode) {
    return (
      <CameraSmartFinder
        mode={mode}
        currentHole={currentHole}
        gps={gps}
        onModeChange={setMode}
        onClose={() => router.back()}
        height={height}
      />
    );
  }

  // SVG modes — Target and Map
  return (
    <SafeAreaView style={styles.svgContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>← Caddie</Text>
        </TouchableOpacity>
        <Text style={styles.title}>SmartFinder</Text>
        <View style={styles.headerBtn}>
          <GPSQuality reading={gps} showText />
        </View>
      </View>

      <SmartFinderModeToggle mode={mode} onChange={setMode} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {!isRoundActive ? (
          <Text style={styles.empty}>Start a round to see yardages.</Text>
        ) : mode === 'target' ? (
          <TargetView geometry={geometry} width={width * CANVAS_W_FRACTION} />
        ) : (
          <MapView
            geometry={geometry}
            yards={yards}
            width={width * CANVAS_W_FRACTION}
            weather={caddieWeather}
            shotBearingDeg={shotBearingDeg}
          />
        )}

        <View style={styles.holeNav}>
          <TouchableOpacity
            style={[styles.holeBtn, prevHole == null && styles.holeBtnDisabled]}
            disabled={prevHole == null}
            onPress={() => prevHole != null && setCurrentHole(prevHole)}
          >
            <Text style={[styles.holeBtnText, prevHole == null && styles.holeBtnTextDisabled]}>← Prev</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setHolePickerOpen(true)} accessibilityRole="button" accessibilityLabel="Pick hole">
            <Text style={styles.holeNavLabel}>HOLE {currentHole} ▾</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.holeBtn, nextHole == null && styles.holeBtnDisabled]}
            disabled={nextHole == null}
            onPress={() => nextHole != null && setCurrentHole(nextHole)}
          >
            <Text style={[styles.holeBtnText, nextHole == null && styles.holeBtnTextDisabled]}>Next →</Text>
          </TouchableOpacity>
        </View>

        <HolePickerModal
          visible={holePickerOpen}
          holes={playedHoles}
          currentHole={currentHole}
          onSelect={(h) => { setCurrentHole(h); setHolePickerOpen(false); }}
          onClose={() => setHolePickerOpen(false)}
          width={width}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Camera-mode wrapper (Standard + Putt) ────────────────────────────────────

function CameraSmartFinder({
  mode, currentHole, gps, onModeChange, onClose, height,
}: {
  mode: SmartFinderMode;
  currentHole: number;
  gps: GPSQualityReading;
  onModeChange: (m: SmartFinderMode) => void;
  onClose: () => void;
  height: number;
}) {
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationGranted, setLocationGranted] = useState(false);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      setLocationGranted(status === 'granted');
    });
  }, []);

  if (!cameraPermission) return <View style={styles.cameraContainer} />;

  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.cameraContainer}>
        <View style={styles.permBox}>
          <Text style={styles.permTitle}>Camera Access</Text>
          <Text style={styles.permText}>
            SmartFinder uses the camera to aim at your target. Your camera feed never leaves your device.
          </Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestCameraPermission}>
            <Text style={styles.permBtnText}>Allow Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backLink} onPress={onClose}>
            <Text style={styles.backLinkText}>← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />

      {mode === 'standard' ? (
        <StandardCameraOverlay
          locationGranted={locationGranted}
          height={height}
        />
      ) : (
        <PuttCameraOverlay locationGranted={locationGranted} />
      )}

      {/* Top bar — back, hole+par, GPS quality */}
      <View style={[styles.cameraTopBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <TouchableOpacity style={styles.cameraIconBtn} onPress={onClose}>
          <Text style={styles.cameraIconText}>←</Text>
        </TouchableOpacity>
        <View style={styles.cameraTopCenter}>
          <Text style={styles.cameraTopTitle}>HOLE {currentHole}</Text>
          <View style={{ marginTop: 4 }}>
            <GPSQuality reading={gps} showText />
          </View>
        </View>
        <View style={styles.cameraIconBtn} />
      </View>

      {/* Mode toggle floats over the camera, just below the top bar */}
      <View style={[styles.cameraToggleWrap, { top: insets.top + 70 }]} pointerEvents="box-none">
        <SmartFinderModeToggle mode={mode} onChange={onModeChange} />
      </View>
    </View>
  );
}

// ─── Standard mode (camera AR, tilt-based distance lock) ─────────────────────

function StandardCameraOverlay({
  locationGranted, height,
}: {
  locationGranted: boolean;
  height: number;
}) {
  const insets = useSafeAreaInsets();
  const headingRef = useRef(0);
  const pitchRef = useRef(-10);
  const [lock, setLock] = useState<{ distance_yards: number; confidence: 'high' | 'medium' | 'low' } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    DeviceMotion.setUpdateInterval(200);
    const sub = DeviceMotion.addListener(data => {
      if (data.rotation) {
        const pitchDeg = ((data.rotation.beta ?? 0) * 180) / Math.PI;
        pitchRef.current = pitchDeg;
        const alphaDeg = ((data.rotation.alpha ?? 0) * 180) / Math.PI;
        headingRef.current = ((alphaDeg % 360) + 360) % 360;
      }
    });
    return () => sub.remove();
  }, []);

  const clearLock = useCallback(() => {
    setLock(null);
    setCountdown(0);
    useSmartFinderStore.getState().clearLock();
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    lockTimerRef.current = null;
    countdownRef.current = null;
  }, []);

  const handleTap = useCallback(async (event: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!locationGranted) {
      Alert.alert('Location needed', 'SmartFinder uses your GPS position to calculate distance. Please grant location access in Settings.');
      return;
    }
    let position: Location.LocationObject;
    try {
      position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    } catch {
      Alert.alert('GPS unavailable', 'Could not get your position. Try moving to open sky.');
      return;
    }
    const tapY = event.nativeEvent.locationY;
    const tapYNorm = Math.max(0, Math.min(1, tapY / height));
    const result = computeDistance({
      user_position: { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy ?? 10 },
      compass_heading: headingRef.current,
      tap_y_normalized: tapYNorm,
      device_pitch_degrees: pitchRef.current,
    });
    const newLock = buildLock({
      user_position: { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy ?? 10 },
      compass_heading: headingRef.current,
      tap_y_normalized: tapYNorm,
      device_pitch_degrees: pitchRef.current,
    }, result);
    useSmartFinderStore.getState().setLock(newLock);
    setLock({ distance_yards: result.distance_yards, confidence: result.confidence });
    setCountdown(30);
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    lockTimerRef.current = setTimeout(clearLock, LOCK_DURATION_MS);
    let remaining = 30;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0 && countdownRef.current) clearInterval(countdownRef.current);
    }, 1000);
  }, [locationGranted, height, clearLock]);

  useEffect(() => () => {
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const confidenceColor = lock
    ? (lock.confidence === 'high' ? '#00C896' : lock.confidence === 'medium' ? '#F5A623' : '#ef4444')
    : '#6b7280';

  return (
    <>
      {/* Tap surface — full-screen, behind overlays */}
      <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={handleTap} />

      {/* Yellow corner focus brackets — legacy v2 frame */}
      <View pointerEvents="none" style={styles.focusFrame}>
        <View style={[styles.focusCorner, styles.focusCornerTL]} />
        <View style={[styles.focusCorner, styles.focusCornerTR]} />
        <View style={[styles.focusCorner, styles.focusCornerBL]} />
        <View style={[styles.focusCorner, styles.focusCornerBR]} />
      </View>

      {/* Yellow crosshair reticle (legacy v2) */}
      <View style={styles.reticleContainer} pointerEvents="none">
        <View style={styles.reticleH} />
        <View style={styles.reticleV} />
        <View style={styles.reticleCenterDot} />
      </View>

      {/* Top-right zoom indicator + flashlight (visual only — actual zoom /
           torch are 1.x. Layout matches legacy v2 reference. */}
      <View pointerEvents="none" style={[styles.zoomCol, { top: insets.top + 130 }]}>
        <Text style={styles.zoomLabel}>1.0x</Text>
        <View style={styles.zoomDots}>
          <View style={styles.zoomDotBg}><Text style={styles.zoomDotMinus}>−</Text></View>
          <View style={styles.zoomDotActive} />
          <View style={styles.zoomDotBg}><Text style={styles.zoomDotPlus}>+</Text></View>
        </View>
      </View>

      {/* Bottom panel — legacy v2 layout: locked badge + big yardage row,
           "club · commit to the shot" yellow-bordered pill, big shutter
           capture button. */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {lock ? (
          <>
            <View style={styles.distanceRow}>
              <Text style={styles.lockedBadge}>🔒 LOCKED</Text>
              <Text style={[styles.distanceNumber, { color: confidenceColor }]}>{lock.distance_yards}</Text>
              <Text style={styles.distanceUnit}>yds</Text>
            </View>
            <View style={styles.commitPill}>
              <Text style={styles.commitPillIcon}>🔒</Text>
              <Text style={styles.commitPillText}>commit to the shot</Text>
            </View>
            <View style={styles.lockFooter}>
              <Text style={styles.countdownText}>Clears in {countdown}s</Text>
              <TouchableOpacity style={styles.clearBtn} onPress={clearLock}>
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={styles.instructionText}>Aim at target · tap anywhere to lock distance</Text>
        )}

        {/* Shutter capture button — visible cue that the screen is the
             capture surface. Tapping it does the same thing as tapping
             anywhere on the camera (handleTap via the full-screen
             TouchableOpacity above). */}
        <View style={styles.shutterRow}>
          <TouchableOpacity
            style={styles.shutterOuter}
            onPress={() => handleTap({ nativeEvent: { locationX: 0, locationY: height / 2 } })}
            activeOpacity={0.85}
          >
            <View style={styles.shutterInner} />
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

// ─── Putt mode (camera + 2 taps + simple slope hint) ─────────────────────────

function PuttCameraOverlay({ locationGranted: _locationGranted }: { locationGranted: boolean }) {
  const insets = useSafeAreaInsets();
  const pitchRef = useRef(0);
  const [pointA, setPointA] = useState<{ x: number; y: number } | null>(null);
  const [pointB, setPointB] = useState<{ x: number; y: number } | null>(null);
  const [pitchAtMeasure, setPitchAtMeasure] = useState<number | null>(null);

  useEffect(() => {
    DeviceMotion.setUpdateInterval(200);
    const sub = DeviceMotion.addListener(data => {
      if (data.rotation) {
        pitchRef.current = ((data.rotation.beta ?? 0) * 180) / Math.PI;
      }
    });
    return () => sub.remove();
  }, []);

  const handleTap = useCallback((event: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = event.nativeEvent;
    if (!pointA) {
      setPointA({ x: locationX, y: locationY });
    } else if (!pointB) {
      setPointB({ x: locationX, y: locationY });
      setPitchAtMeasure(pitchRef.current);
    } else {
      // Reset on third tap
      setPointA({ x: locationX, y: locationY });
      setPointB(null);
      setPitchAtMeasure(null);
    }
  }, [pointA, pointB]);

  const reset = () => { setPointA(null); setPointB(null); setPitchAtMeasure(null); };

  // Approximate distance in feet using a simple visual heuristic — pixels mapped
  // to feet via a fixed reference (this is rough by design; a calibrated camera
  // model is 1.x work). One screen-width assumed to be ~6 feet at typical
  // putting-arm-extension hold. Better than nothing for v1; tunable later.
  const PIXELS_PER_FOOT = 35;
  const distanceFeet = pointA && pointB
    ? Math.round(Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y) / PIXELS_PER_FOOT * 10) / 10
    : null;

  // Slope hint from device pitch — a putter face perpendicular to the green
  // surface reads pitch ≈ -90°. Deviation from level is the rough slope read.
  const slopePct = pitchAtMeasure != null
    ? Math.round(Math.tan((Math.abs(pitchAtMeasure) - 90) * Math.PI / 180) * 100)
    : null;

  return (
    <>
      <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={handleTap} />

      {/* Overlay markers + connecting line */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%">
          {pointA && (
            <>
              <Circle cx={pointA.x} cy={pointA.y} r={12} fill="rgba(0,200,150,0.35)" stroke="#00C896" strokeWidth={2} />
              <SvgText x={pointA.x} y={pointA.y + 5} fill="#fff" fontSize={11} fontWeight="900" textAnchor="middle">A</SvgText>
            </>
          )}
          {pointB && (
            <>
              <Circle cx={pointB.x} cy={pointB.y} r={12} fill="rgba(245,166,35,0.35)" stroke="#F5A623" strokeWidth={2} />
              <SvgText x={pointB.x} y={pointB.y + 5} fill="#fff" fontSize={11} fontWeight="900" textAnchor="middle">B</SvgText>
            </>
          )}
          {pointA && pointB && (
            <Line
              x1={pointA.x} y1={pointA.y} x2={pointB.x} y2={pointB.y}
              stroke="#ffffff" strokeWidth={2} strokeDasharray="6 4"
            />
          )}
        </Svg>
      </View>

      {/* Bottom panel */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {!pointA ? (
          <Text style={styles.instructionText}>Tap your ball position (point A)</Text>
        ) : !pointB ? (
          <Text style={styles.instructionText}>Tap the hole (point B)</Text>
        ) : (
          <>
            <View style={styles.puttResultRow}>
              <View style={styles.puttResultItem}>
                <Text style={styles.puttResultValue}>{distanceFeet}</Text>
                <Text style={styles.puttResultLabel}>FEET</Text>
              </View>
              <View style={styles.puttDivider} />
              <View style={styles.puttResultItem}>
                <Text style={[styles.puttResultValue, { color: slopeColor(slopePct) }]}>
                  {slopePct != null ? `${slopePct > 0 ? '+' : ''}${slopePct}%` : '—'}
                </Text>
                <Text style={styles.puttResultLabel}>SLOPE</Text>
              </View>
            </View>
            <Text style={styles.puttHint}>{slopePct != null ? readSlope(slopePct) : 'Hold phone level over ball to read slope.'}</Text>
            <TouchableOpacity style={styles.clearBtn} onPress={reset}>
              <Text style={styles.clearBtnText}>Reset</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </>
  );
}

function slopeColor(pct: number | null): string {
  if (pct == null) return '#6b7280';
  const a = Math.abs(pct);
  if (a < 1) return '#00C896';
  if (a < 3) return '#F5A623';
  return '#ef4444';
}

function readSlope(pct: number): string {
  const a = Math.abs(pct);
  if (a < 1) return 'Pretty flat — straight putt.';
  if (a < 3) return 'Mild break — read the grain.';
  return 'Significant break — pace matters.';
}

// ─── Target view (SVG tap-to-target) ─────────────────────────────────────────

function TargetView({ geometry, width }: { geometry: HoleGeometry | null; width: number }) {
  const [tap, setTap] = useState<{ xPx: number; yPx: number; yards: number } | null>(null);

  if (!geometry || !geometry.tee || !geometry.green) {
    return <View style={styles.canvasWrap}><Text style={styles.empty}>Course geometry isn&apos;t available for this hole.</Text></View>;
  }
  const fix = getLastFix();
  if (!fix) {
    return <View style={styles.canvasWrap}><Text style={styles.empty}>Waiting for GPS — make sure location permission is granted.</Text></View>;
  }
  const axisYards = haversineYards(geometry.tee, geometry.green);
  if (axisYards <= 0) return <View style={styles.canvasWrap}><Text style={styles.empty}>Hole geometry invalid.</Text></View>;

  const playerProj = projectToAxis(fix.location, geometry.tee, geometry.green);
  const halfPad = 30;
  const xPad = 30;
  const xRange = Math.max(60, Math.abs(playerProj.x) * 2 + 60);
  const yRange = axisYards + 60;
  const canvasH = (width / xRange) * yRange;
  const scale = (width - xPad * 2) / xRange;
  const project = (xYd: number, yYd: number) => ({
    sx: xPad + (xYd + xRange / 2) * scale,
    sy: halfPad + (yRange - yYd - 30) * scale,
  });
  const teePos = project(0, 0);
  const greenPos = project(0, axisYards);
  const playerPos = project(playerProj.x, playerProj.y);

  const handlePress = (evt: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = evt.nativeEvent;
    const tappedYx = (locationX - xPad) / scale - xRange / 2;
    const tappedYy = (yRange - (locationY - halfPad) / scale) - 30;
    const dx = tappedYx - playerProj.x;
    const dy = tappedYy - playerProj.y;
    const yards = Math.round(Math.sqrt(dx * dx + dy * dy));
    setTap({ xPx: locationX, yPx: locationY, yards });
  };

  return (
    <View style={styles.canvasWrap}>
      <Text style={styles.canvasHint}>Tap anywhere on the hole to get yardage.</Text>
      <Svg width={width} height={canvasH + halfPad * 2} onPress={handlePress as never}>
        <Rect x={0} y={0} width={width} height={canvasH + halfPad * 2} fill="#0a1f12" rx={12} />
        <Line x1={teePos.sx} y1={teePos.sy} x2={greenPos.sx} y2={greenPos.sy} stroke="#1e3a28" strokeWidth={1} strokeDasharray="4 4" />
        <Circle cx={teePos.sx} cy={teePos.sy} r={6} fill="#6b7280" />
        <SvgText x={teePos.sx} y={teePos.sy + 18} fill="#9ca3af" fontSize={10} textAnchor="middle">TEE</SvgText>
        <Circle cx={greenPos.sx} cy={greenPos.sy} r={10} fill="#003d20" stroke="#00C896" strokeWidth={1.5} />
        <SvgText x={greenPos.sx} y={greenPos.sy - 14} fill="#00C896" fontSize={10} textAnchor="middle">GREEN</SvgText>
        <Circle cx={playerPos.sx} cy={playerPos.sy} r={7} fill="#F5A623" stroke="#0a1f12" strokeWidth={2} />
        <SvgText x={playerPos.sx} y={playerPos.sy + 22} fill="#F5A623" fontSize={9} textAnchor="middle" fontWeight="700">YOU</SvgText>
        {tap && (
          <>
            <Path d={`M ${playerPos.sx} ${playerPos.sy} L ${tap.xPx} ${tap.yPx}`} stroke="#ffffff" strokeWidth={1.5} strokeDasharray="3 3" />
            <Circle cx={tap.xPx} cy={tap.yPx} r={9} fill="#ffffff" stroke="#000000" strokeWidth={1.5} />
            <SvgText x={tap.xPx} y={tap.yPx + 4} fill="#000000" fontSize={11} fontWeight="900" textAnchor="middle">{tap.yards}</SvgText>
          </>
        )}
      </Svg>
      {tap && <Text style={styles.tapResult}>{tap.yards} yards to tap</Text>}
    </View>
  );
}

function MapView({
  geometry, yards, width, weather, shotBearingDeg,
}: {
  geometry: HoleGeometry | null;
  yards: GreenYardages;
  width: number;
  weather: WeatherSnapshot | null;
  shotBearingDeg: number | null;
}) {
  if (!geometry || !geometry.tee || !geometry.green) {
    const playsLike = (actual: number | null): number | null => {
      if (actual == null || !weather) return null;
      const breakdown = playsLikeDistance(actual, weather, shotBearingDeg);
      return Math.abs(breakdown.delta_yards) >= 3 ? breakdown.plays_like_yards : null;
    };
    return (
      <View style={styles.canvasWrap}>
        <View style={styles.standardWrap}>
          <View style={styles.standardRow}>
            <BigCell label="FRONT" value={yards.front} playsLikeValue={playsLike(yards.front)} />
            <BigCell label="MIDDLE" value={yards.middle} playsLikeValue={playsLike(yards.middle)} emphasis />
            <BigCell label="BACK" value={yards.back} playsLikeValue={playsLike(yards.back)} />
          </View>
        </View>
        {geometry && geometry.hazards.length > 0 && (
          <View style={styles.hazardList}>
            <Text style={styles.hazardHeading}>HAZARDS</Text>
            {geometry.hazards.map((h, i) => (
              <Text key={i} style={styles.hazardItem}>• {h.label}</Text>
            ))}
          </View>
        )}
      </View>
    );
  }
  return <TargetView geometry={geometry} width={width} />;
}

function BigCell({ label, value, emphasis, playsLikeValue }: {
  label: string; value: number | null; emphasis?: boolean; playsLikeValue?: number | null;
}) {
  return (
    <View style={styles.bigCell}>
      <Text style={[styles.bigValue, emphasis && styles.bigValueEmphasis]}>
        {value != null ? value : '—'}
      </Text>
      {playsLikeValue != null && <Text style={styles.playsLike}>plays {playsLikeValue}</Text>}
      <Text style={styles.bigLabel}>{label}</Text>
    </View>
  );
}

function HolePickerModal({
  visible, holes, currentHole, onSelect, onClose, width,
}: {
  visible: boolean;
  holes: number[];
  currentHole: number;
  onSelect: (h: number) => void;
  onClose: () => void;
  width: number;
}) {
  const cols = width >= 700 ? 6 : 3;
  const cellWidth = Math.floor((Math.min(width, 480) - 32 - (cols - 1) * 8) / cols);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerScrim} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.pickerCard}>
          <Text style={styles.pickerTitle}>JUMP TO HOLE</Text>
          <View style={styles.pickerGrid}>
            {holes.map(h => {
              const active = h === currentHole;
              return (
                <TouchableOpacity
                  key={h}
                  onPress={() => onSelect(h)}
                  style={[styles.pickerBtn, { width: cellWidth, height: cellWidth }, active && styles.pickerBtnActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.pickerBtnText, active && styles.pickerBtnTextActive]}>{h}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity onPress={onClose} style={styles.pickerCloseBtn}>
            <Text style={styles.pickerCloseText}>Close</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // SVG mode container
  svgContainer: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  headerBtn: { minWidth: 100 },
  headerBtnText: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  scroll: { paddingTop: 12, paddingBottom: 32 },
  empty: { color: '#9ca3af', fontSize: 13, textAlign: 'center', paddingHorizontal: 24, marginVertical: 24 },

  // Camera mode container
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  cameraTopBar: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  cameraIconBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  cameraIconText: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  cameraTopCenter: { alignItems: 'center', flex: 1 },
  cameraTopTitle: { color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: 1.5 },
  cameraToggleWrap: { position: 'absolute', left: 0, right: 0 },

  // Reticle
  reticleContainer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  reticleH: { position: 'absolute', width: 36, height: 2, backgroundColor: '#F5A623' },
  reticleV: { position: 'absolute', width: 2, height: 36, backgroundColor: '#F5A623' },
  reticleCenterDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#F5A623' },

  // Legacy v2 yellow corner focus brackets
  focusFrame: {
    position: 'absolute',
    top: '34%',
    bottom: '38%',
    left: '20%',
    right: '20%',
  },
  focusCorner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#F5A623',
  },
  focusCornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  focusCornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  focusCornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  focusCornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },

  // Top-right zoom column (visual only)
  zoomCol: {
    position: 'absolute',
    right: 16,
    alignItems: 'center',
    gap: 6,
  },
  zoomLabel: { color: '#F5A623', fontSize: 13, fontWeight: '800' },
  zoomDots: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  zoomDotBg: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  zoomDotActive: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#F5A623',
  },
  zoomDotMinus: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  zoomDotPlus: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  // "club · commit to the shot" yellow pill
  commitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#F5A623',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 8,
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  commitPillIcon: { fontSize: 14 },
  commitPillText: { color: '#F5A623', fontSize: 13, fontWeight: '700' },

  // Shutter button
  shutterRow: { alignItems: 'center', marginTop: 12, marginBottom: 4 },
  shutterOuter: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 4, borderColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#ffffff',
  },

  // Bottom panel (camera modes)
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(6,15,9,0.85)',
    paddingTop: 18, paddingHorizontal: 24, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
  },
  instructionText: { color: 'rgba(255,255,255,0.85)', fontSize: 15, textAlign: 'center', paddingBottom: 10 },
  distanceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  lockedBadge: { color: '#F5A623', fontSize: 13, fontWeight: '900', letterSpacing: 1.4, marginRight: 6, alignSelf: 'center' },
  distanceNumber: { fontSize: 64, fontWeight: '900', lineHeight: 70 },
  distanceUnit: { color: '#9ca3af', fontSize: 22, fontWeight: '600', paddingBottom: 8 },
  lockFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 10 },
  countdownText: { color: '#9ca3af', fontSize: 13 },
  clearBtn: { borderWidth: 1, borderColor: '#ef4444', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, marginTop: 8 },
  clearBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '700' },

  // Putt panel
  puttResultRow: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 4 },
  puttResultItem: { alignItems: 'center', minWidth: 80 },
  puttResultValue: { color: '#ffffff', fontSize: 32, fontWeight: '900' },
  puttResultLabel: { color: '#9ca3af', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 2 },
  puttDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.15)' },
  puttHint: { color: '#cbd5e1', fontSize: 12, marginTop: 8, textAlign: 'center', paddingHorizontal: 16 },

  // Permission gate
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  permTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  permText: { color: '#9ca3af', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 28 },
  permBtn: { backgroundColor: '#00C896', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  permBtnText: { color: '#060f09', fontSize: 16, fontWeight: '800' },
  backLink: { marginTop: 20 },
  backLinkText: { color: '#6b7280', fontSize: 14 },

  // SVG mode standard fallback
  standardWrap: { paddingHorizontal: 16, paddingVertical: 24, alignItems: 'center' },
  standardRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 18 },
  bigCell: { alignItems: 'center', minWidth: 80 },
  bigValue: { color: '#e8f5e9', fontSize: 36, fontWeight: '900', fontVariant: ['tabular-nums'] },
  bigValueEmphasis: { color: '#ffffff', fontSize: 56 },
  bigLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginTop: 4 },
  playsLike: { color: '#F5A623', fontSize: 12, fontWeight: '700', marginTop: 2 },

  canvasWrap: { paddingHorizontal: 16, paddingTop: 12, alignItems: 'center' },
  canvasHint: { color: '#9ca3af', fontSize: 12, marginBottom: 8 },
  tapResult: { color: '#ffffff', fontSize: 16, fontWeight: '800', marginTop: 12 },
  hazardList: { marginTop: 24, alignSelf: 'stretch', paddingHorizontal: 16 },
  hazardHeading: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 8 },
  hazardItem: { color: '#9ca3af', fontSize: 13, lineHeight: 19 },

  holeNav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 24,
  },
  holeBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: '#00C896' },
  holeBtnDisabled: { borderColor: '#1e3a28' },
  holeBtnText: { color: '#00C896', fontSize: 13, fontWeight: '700' },
  holeBtnTextDisabled: { color: '#374151' },
  holeNavLabel: { color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: 1.2 },

  pickerScrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
  },
  pickerCard: {
    backgroundColor: '#0d2418', borderRadius: 14, borderWidth: 1, borderColor: '#1e3a28',
    padding: 16, width: '100%', maxWidth: 480,
  },
  pickerTitle: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 12, textAlign: 'center' },
  pickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  pickerBtn: {
    backgroundColor: '#0a1e12', borderWidth: 1, borderColor: '#1e3a28', borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerBtnActive: { backgroundColor: '#003d20', borderColor: '#00C896' },
  pickerBtnText: { color: '#9ca3af', fontSize: 18, fontWeight: '800' },
  pickerBtnTextActive: { color: '#00C896' },
  pickerCloseBtn: {
    marginTop: 16, paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#1e3a28', borderRadius: 10,
  },
  pickerCloseText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
});
