import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DISPERSION_HCP_BREAKS } from '../constants/handicapTiers';
import {
  View,
  Text,
  Alert,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
  AppState,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Circle, Line, Rect, Text as SvgText, Path } from 'react-native-svg';
import { safeBack } from '../services/safeBack';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
// 2026-05-26 — Fix CM: theme the StyleSheet. Shared useStyles() hook
// below means each of the 9 sub-components only adds one line to
// pick up themed styles, vs duplicating useTheme + useMemo per
// component.
import { useTheme } from '../contexts/ThemeContext';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { useRoundStore } from '../store/roundStore';
import { composeShotRead } from '../services/cnsShotRead';
import { bagDistances } from '../services/shotStrategy';
// SF fix #2 — learned-bag club lookup (inferClub) + the canonical club ladder so
// the rangefinder recommends from the player's real distances, not a generic chart.
import { useClubStatsStore, CLUB_ORDER } from '../store/clubStatsStore';
// SF fix #3 — the 4-tier yardage resolver, so a number the player STATED
// ("I'm 150 out") wins over the GPS/scorecard middle on the target overlay.
import { resolveYardage } from '../services/yardageResolver';
import { useSmartFinderStore, type SmartFinderMode } from '../store/smartFinderStore';
import {
  peekFix,
  classifyAccuracy,
  getLastFix,
  getGreenYardagesSync,
  type GreenYardages,
  type GPSQualityReading,
} from '../services/smartFinderService';
import { fetchCourseGeometry, getHoleGeometry, type HoleGeometry } from '../services/courseGeometryService';
import { refreshGpsAndReconcile } from '../services/refreshGpsAction';
import { bearingDegrees, haversineYards, projectToAxis, unprojectFromAxis } from '../utils/geoDistance';
import { computeDistance, computeHeightRangedDistance, REFERENCE_HEIGHTS } from '../services/rangefinder';
import { detectMeasureReference } from '../services/measureScan';
import GPSQuality from '../components/smartfinder/GPSQuality';
import TargetingOverlay from '../components/smartfinder/TargetingOverlay';
import { useCurrentWeather } from '../hooks/useCurrentWeather';
import { playsLikeDistance } from '../utils/playsLike';
import { useElevationDeltaStatus } from '../hooks/useElevationDelta';
import type { WeatherSnapshot } from '../services/weatherService';
import { useSettingsStore } from '../store/settingsStore';
import { useTrustLevelStore } from '../store/trustLevelStore';
import { usePracticeStore } from '../store/practiceStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { speak } from '../services/voiceService';
// 2026-05-27 — Fix EP: SmartFinder "Send to Tank" icon. Routes to
// Library so the user picks the swing video to send (SmartFinder
// itself has no video — the icon launches the share flow).
import { isSendToTankAvailable } from '../services/tankReview';
import { Ionicons } from '@expo/vector-icons';
// 2026-05-27 — Fix EQ: toast feedback for capture results.
import { useToastStore } from '../store/toastStore';
import { getApiBaseUrl } from '../services/apiBase';
import { ingestCapture } from '../services/courseCaptureIngest';

const REFRESH_MS = 3_000;
const CANVAS_W_FRACTION = 0.92;

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
  const styles = useStyles();
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const _insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // 2026-05-27 — Fix EP: router for the Send-to-Tank header icon.
  const router = useRouter();

  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentHole = useRoundStore(s => s.currentHole);
  const setCurrentHole = useRoundStore(s => s.setCurrentHole);
  const courseHoles = useRoundStore(s => s.courseHoles);
  const activeCourseId = useRoundStore(s => s.activeCourseId);

  const mode = useSmartFinderStore(s => s.mode);
  const setMode = useSmartFinderStore(s => s.setMode);

  // autoread=1: voice trigger lands here for scene read. Override 'map' to
  // 'target' so the camera is live. User's persisted preference unchanged.
  const { autoread } = useLocalSearchParams<{ autoread?: string }>();
  const autoRead = autoread === '1';
  const displayMode: SmartFinderMode = autoRead && mode === 'map' ? 'target' : mode;

  const [yards, setYards] = useState<GreenYardages>(() => getGreenYardagesSync(currentHole));
  const [gps, setGps] = useState<GPSQualityReading>(() => {
    const f = getLastFix();
    // 2026-05-27 — Fix ET: thread fix timestamp into classifyAccuracy
    // so a stale fix reports honestly even when its old accuracy
    // number looks fine.
    return classifyAccuracy(f?.accuracy_m ?? null, f?.timestamp ?? null);
  });
  const [geometry, setGeometry] = useState<HoleGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      // 2026-06-14 (audit — battery) — ride the watch cache (≤3s) instead of
      // forcing a fresh high-accuracy pull every 3s; matches the poll cadence.
      const fix = await peekFix();
      if (cancelled) return;
      setGps(classifyAccuracy(fix?.accuracy_m ?? null, fix?.timestamp ?? null));
      setYards(getGreenYardagesSync(currentHole));
    };
    // 2026-06-04 — Defer first tick ~500ms. Voice-open path now awaits
    // speak BEFORE navigating (useVoiceCaddie order swap), so TTS is
    // already done by the time we mount — but the navigation animation
    // is still in-flight for ~300ms and bumpToActive + getOneShotFix
    // are heavy native calls that compete with the animation thread.
    // The interval keeps the existing 3s cadence regardless.
    const firstTickTimer = setTimeout(() => { void tick(); }, 500);
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearTimeout(firstTickTimer); clearInterval(id); };
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
    }).catch(err => {
      // 2026-06-08 (audit #2) — geometry fetch failure must not crash the
      // rangefinder; keep any cached geometry, otherwise degrade.
      console.log('[smartfinder] geometry fetch failed (non-fatal)', err);
    });
    return () => { cancelled = true; };
  }, [activeCourseId, currentHole]);

  const playedHoles = useMemo(() => courseHoles.map(h => h.hole).sort((a, b) => a - b), [courseHoles]);
  const idx = playedHoles.indexOf(currentHole);
  const prevHole = idx > 0 ? playedHoles[idx - 1] : null;
  const nextHole = idx >= 0 && idx < playedHoles.length - 1 ? playedHoles[idx + 1] : null;

  const { weather: caddieWeather, shotBearingDeg } = useCurrentWeather();
  const [holePickerOpen, setHolePickerOpen] = useState(false);

  // ── Voice callout on SmartFinder open ──────────────────────────────
  // Tim's WOW moment: when the rangefinder fires up, the caddie should
  // tell you what you're looking at — middle yardage, plays-like, wind
  // direction + speed — without you asking. Fires once per mount, gated
  // on isRoundActive (no callout off-course), voiceEnabled (respect
  // mute), and trustLevel >= 2 (Quiet stays silent by definition).
  // Waits for both green yardages AND weather to load before speaking
  // so we don't fire a half-sentence "Middle yards" and never finish.
  const calloutSpokenRef = useRef(false);
  const voiceGender = useSettingsStore(s => s.voiceGender);
  const voiceEnabled = useSettingsStore(s => s.voiceEnabled);
  const language = useSettingsStore(s => s.language);
  const trustLevel = useTrustLevelStore(s => s.level);
  const apiUrl = getApiBaseUrl();
  useEffect(() => {
    if (calloutSpokenRef.current) return;
    if (!isRoundActive) return;
    if (!voiceEnabled) return;
    if (trustLevel < 2) return; // Quiet = silent by design
    const middle = yards.middle;
    if (middle == null) return;
    // 2026-05-18 — Sanity gate. If middle yardage is insane (>600y means
    // we're not playing the hole we think we are, or GPS/geometry are
    // out of sync — Tim was hearing "Middle of green, eighty thousand
    // yards"), skip the callout entirely instead of speaking garbage.
    if (middle > 600 || middle < 30) return;
    calloutSpokenRef.current = true;
    const parts: string[] = [`Middle of green, ${middle} yards.`];
    if (caddieWeather) {
      const breakdown = playsLikeDistance(middle, caddieWeather, shotBearingDeg);
      if (Math.abs(breakdown.delta_yards) >= 3) {
        parts.push(`Plays ${breakdown.plays_like_yards}.`);
      }
      if (caddieWeather.wind_speed_mph >= 5) {
        const dir = describeWindDirection(caddieWeather.wind_direction_deg, shotBearingDeg);
        parts.push(`Wind ${Math.round(caddieWeather.wind_speed_mph)} ${dir}.`);
      }
    }
    // 2026-05-18 — Small delay lets any in-flight speech (briefing,
    // hole-transition, prior screen's callout) finish before the
    // rangefinder callout enqueues. Without this, the rangefinder
    // callout was preempting and getting preempted on rapid screen
    // changes, producing the choppy/cut-off speech Tim heard. Also
    // mark userInitiated:true — opening SmartFinder IS a user action,
    // so at L1 Quiet this should still fire (matches the memory rule
    // that user-initiated speech bypasses L1's scripted-speech gate).
    const text = parts.join(' ');
    const timer = setTimeout(() => {
      void speak(text, voiceGender, language, apiUrl, { userInitiated: true }).catch((e) => {
        console.log('[smartfinder] open callout speak failed', e);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [isRoundActive, voiceEnabled, trustLevel, yards.middle, caddieWeather, shotBearingDeg, voiceGender, language, apiUrl]);

  // Camera modes share the camera view + need permission gate. Phase 502
  // added TARGET to this set — V3-style camera-with-draggable-reticle.
  // The old flat-canvas TargetView is retained below the route for
  // surfaces that explicitly ask for top-down, but the default TARGET
  // path is now camera + overlay.
  const isCameraMode = displayMode === 'putt' || displayMode === 'target' || displayMode === 'measure';

  if (isCameraMode) {
    return (
      <CameraSmartFinder
        mode={displayMode}
        currentHole={currentHole}
        gps={gps}
        yards={yards}
        geometry={geometry}
        weather={caddieWeather}
        shotBearingDeg={shotBearingDeg}
        onModeChange={setMode}
        onClose={() => safeBack()}
        height={height}
        autoRead={autoRead}
      />
    );
  }

  // SVG modes — Target and Map
  return (
    <SafeAreaView style={styles.svgContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>← Caddie</Text>
        </TouchableOpacity>
        <Text style={styles.title}>SmartFinder</Text>
        <View style={[styles.headerBtn, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          {/* 2026-05-27 — Fix EP: Send-to-Tank entry point from
              SmartFinder. SmartFinder doesn't OWN a video, so the
              icon routes the user to Library where each swing has
              its own paper-plane to send. During paywall-off beta,
              isSendToTankAvailable() is always true. */}
          {isSendToTankAvailable() && (
            <TouchableOpacity
              onPress={() => router.push('/swinglab/library' as never)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Pick a swing to send to Tank for review"
            >
              <Ionicons name="paper-plane-outline" size={18} color="#F0C030" />
            </TouchableOpacity>
          )}
          <GPSQuality reading={gps} showText />
        </View>
      </View>

      {/* Map view: compact row — camera + putt access without a full toggle bar */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 16 }}>
        <TouchableOpacity
          onPress={() => setMode('target')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#003d20', borderRadius: 20, borderWidth: 1, borderColor: '#00C896' }}
          accessibilityRole="button"
          accessibilityLabel="Switch to camera view"
        >
          <Ionicons name="camera-outline" size={16} color="#00C896" />
          <Text style={{ color: '#00C896', fontSize: 13, fontWeight: '700' }}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setMode('putt')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#0a1e12', borderRadius: 20, borderWidth: 1, borderColor: '#1e3a28' }}
          accessibilityRole="button"
          accessibilityLabel="Switch to putt camera"
        >
          <Ionicons name="golf-outline" size={16} color="#9ca3af" />
          <Text style={{ color: '#9ca3af', fontSize: 13, fontWeight: '700' }}>Putt</Text>
        </TouchableOpacity>
        {/* 2026-07-22 (Tim) — Measure: point-and-tap rangefinder for anywhere (yard/cage/range). */}
        <TouchableOpacity
          onPress={() => setMode('measure')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#0a1e12', borderRadius: 20, borderWidth: 1, borderColor: '#1e3a28' }}
          accessibilityRole="button"
          accessibilityLabel="Measure a distance anywhere"
        >
          <Ionicons name="resize-outline" size={16} color="#9ca3af" />
          <Text style={{ color: '#9ca3af', fontSize: 13, fontWeight: '700' }}>Measure</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 2026-06-04 — Empty state "Start a round to see yardages" removed.
            getGreenYardagesSync already routes through staticYardages
            (scorecard distances from data/courses.ts) when GPS is null OR
            no green geometry is resolved, so the F/M/B yardages always
            have a value when bundled course data exists. Per Rule 3,
            don't report a problem we can solve from static data we have. */}
        <MapView
          geometry={geometry}
          yards={yards}
          width={width * CANVAS_W_FRACTION}
          weather={caddieWeather}
          shotBearingDeg={shotBearingDeg}
        />

        <View style={styles.holeNav}>
          <TouchableOpacity
            style={[styles.holeBtn, prevHole == null && styles.holeBtnDisabled]}
            disabled={prevHole == null}
            onPress={() => prevHole != null && setCurrentHole(prevHole)}
            accessibilityRole="button"
            accessibilityLabel={prevHole != null ? `Previous hole (hole ${prevHole})` : 'Previous hole, unavailable'}
            accessibilityState={{ disabled: prevHole == null }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
            accessibilityRole="button"
            accessibilityLabel={nextHole != null ? `Next hole (hole ${nextHole})` : 'Next hole, unavailable'}
            accessibilityState={{ disabled: nextHole == null }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.holeBtnText, nextHole == null && styles.holeBtnTextDisabled]}>Next →</Text>
          </TouchableOpacity>
        </View>

        {/* 2026-05-22 — Refresh GPS / "Where am I?" surface. Shared
            handler does the haptic + active-bump + force-reconcile +
            toast. Same call site as Cockpit's ShotResultRow pill so
            behavior + toast copy stay consistent across screens. */}
        {isRoundActive && (
          <TouchableOpacity
            style={styles.refreshGpsBtn}
            onPress={() => { void refreshGpsAndReconcile(); }}
            accessibilityRole="button"
            accessibilityLabel="Refresh GPS — reconcile current hole"
          >
            <Text style={styles.refreshGpsBtnText}>📍  Refresh GPS / Where am I?</Text>
          </TouchableOpacity>
        )}

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

// ─── Camera-mode wrapper (Target + Putt) ────────────────────────────────────

/**
 * Continuous zoom via two-finger pinch. expo-camera's `zoom` prop is 0..1
 * where 0 ≈ native 1× and 1 ≈ the device's max zoom (varies by phone —
 * Z Fold reports 30× at the top, most flagship Androids 10–20×, base
 * phones 8×).
 *
 * 2026-05-18 — replaced the previous ZOOM_STOPS index + ± buttons with
 * pinch-to-zoom (matches native camera apps).
 */
// 2026-05-24 — Bumped from 0.4 → 1.0 (native camera ratio). User reported
// "I can't zoom" on Z Fold — at 0.4 sensitivity a 3.5x finger spread was
// needed to reach max zoom (zoom=1.0), which is well outside ergonomic
// pinch range. 1.0 means a 2x finger spread covers the full range, same
// as the stock Android camera app.
const PINCH_SENSITIVITY = 1.0;

function CameraSmartFinder({
  mode, currentHole, gps, yards, geometry, weather, shotBearingDeg, onModeChange, onClose, height, autoRead,
}: {
  mode: SmartFinderMode;
  currentHole: number;
  gps: GPSQualityReading;
  yards: GreenYardages;
  geometry: HoleGeometry | null;
  weather: WeatherSnapshot | null;
  shotBearingDeg: number | null;
  onModeChange: (m: SmartFinderMode) => void;
  onClose: () => void;
  height: number;
  autoRead?: boolean;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationGranted, setLocationGranted] = useState(false);
  // 2026-05-27 — Fix EQ: Top Gun target lock + capture. cameraRef
  // holds CameraView so the capture button can call takePictureAsync.
  // `locked` is the reticle-hold state that TargetingOverlay reads;
  // when on, the target stops chasing every tap so the user can take
  // screenshots OR tap the capture button without the reticle jumping.
  const cameraRef = useRef<CameraView | null>(null);
  const [locked, setLocked] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // 2026-05-27 — Fix EV: video capture mode for SmartFinder.
  // Toggle pill above the capture button selects photo vs video.
  // CameraView mode is bound to this state so the underlying camera
  // is in the right capture pipeline before the user hits record.
  // recordingRef tracks the in-flight recordAsync promise so the
  // second tap stops it cleanly.
  const [captureMode, setCaptureMode] = useState<'picture' | 'video'>('picture');
  const [recording, setRecording] = useState(false);
  // 2026-07-23 (QA) — Measure mode's Auto-detect uses takePictureAsync, which fails when the
  // CameraView is left in mode='video' (e.g. after recording a target-mode pano). Force picture
  // mode whenever Measure is active; runs on mode change, so the mode prop has re-rendered to
  // 'picture' well before the user taps Auto-detect (unlike an in-tap setState, which is too late).
  useEffect(() => {
    if (mode === 'measure' && captureMode !== 'picture' && !recording) setCaptureMode('picture');
  }, [mode, captureMode, recording]);
  // 2026-06-13 — Scene Read (Tim's "mind-blown" moment): snap the view, the
  // multimodal brain reads the meta scene (water/trees/sky/leaves) grounded in the
  // MEASURED wind/temp/distance, and ties it to how to play + think. OTA-safe (reuses
  // /api/kevin); honest (camera = qualitative scene, weather = the wind number).
  const [sceneReading, setSceneReading] = useState(false);
  const [sceneResult, setSceneResult] = useState<string | null>(null);
  // 2026-06-21 — targetYards lifted from TargetCameraOverlay so runSceneRead
  // can pass the locked distance to the brain. TargetCameraOverlay calls
  // onTargetYardsChange whenever the user taps a new distance.
  const [sceneTargetYards, setSceneTargetYards] = useState<number | null>(null);
  const autoFiredRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Stop any in-progress video recording on unmount so CameraView releases.
      if (cameraRef.current) {
        try { cameraRef.current.stopRecording(); } catch { /* best effort */ }
      }
    };
  }, []);
  // Mic permission is required for video audio. Reusing the existing
  // pattern from cage-mode / quick-record (request on demand, not at
  // screen mount — keeps the GPS-only photo flow from prompting for
  // mic unnecessarily).
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  // Continuous zoom in [0, 1]. baseZoom captures the value at the start
  // of a pinch so subsequent pinches feel relative, not absolute. Resets
  // to 1.0× when the screen mounts (matches a real rangefinder power-on).
  // 2026-05-19 — Switched from legacy PinchGestureHandler to the new
  // Gesture API (Gesture.Pinch + GestureDetector). The legacy handler
  // required GestureHandlerRootView at the screen root (added below)
  // AND its events were swallowed by a child overlay's full-screen
  // TouchableOpacity. The new API composes pinch (multi-touch) with the
  // existing tap (single-touch) without a conflict because they're
  // handled at different finger counts.
  const [zoom, setZoom] = useState(0);
  const baseZoomRef = useRef(0);
  // 2026-06-23 (Tim) — collapse the right-side controls into a SmartMotion-style
  // TOOLS pop-out (sliders chevron → labeled themed rows) so the camera view
  // stays clear and the icons are learnable.
  // 2026-06-25 (Tim — "crowded ass dog shit") — the PHOTO/VIDEO pill + the big
  // floating shutter also move INTO this pop-out as rows, so the ONLY persistent
  // floating control in target mode is the single TOOLS button. Capture logic is
  // unchanged — it's just one tap deeper (TOOLS → Photo / Video).
  const [toolsOpen, setToolsOpen] = useState(false);

  // 2026-06-25 — Capture handler lifted out of the (now-removed) floating shutter's
  // inline onPress so it can be driven from the TOOLS pop-out rows. takePictureAsync /
  // recordAsync / ingestCapture / share logic is byte-for-byte the same; only the
  // trigger surface changed. `kind` selects photo vs video so the two TOOLS rows
  // each call straight into the right branch.
  const runCapture = useCallback(async (kind: 'picture' | 'video') => {
    if (capturing) return;
    if (!cameraRef.current) return;
    if (kind === 'video') {
      if (recording) {
        // Second tap on the recording row = stop. recordAsync resolves with the
        // file URI; the running promise captured below handles the share.
        try { cameraRef.current.stopRecording(); } catch (e) { console.log('[smartfinder] stopRecording threw', e); }
        return;
      }
      // First tap = start recording. Need mic permission first.
      if (!micPerm?.granted) {
        const result = await requestMicPerm();
        if (!result.granted) {
          useToastStore.getState().show('Microphone access needed for video.');
          return;
        }
      }
      setRecording(true);
      try {
        // recordAsync resolves when stopRecording is called or maxDuration hits.
        // 60s cap so a forgotten tap doesn't fill the device.
        const result = await cameraRef.current.recordAsync({ maxDuration: 60 });
        setRecording(false);
        if (result?.uri) {
          // 2026-06-13 (Tim) — INGEST: a turn-while-recording clip is this hole's
          // panorama source → builds the course's spatial data as you play.
          // 2026-06-14 (Tim) — attach the live compass heading; it's the key
          // field for green-facing selection + any future geometry/3D rebuild.
          void ingestCapture({ sourceUri: result.uri, kind: 'pano', hole: currentHole, heading: headingRef.current })
            .then((ok) => { if (ok) useToastStore.getState().show("Added to this hole's library"); });
          const Sharing = await import('expo-sharing');
          const can = await Sharing.isAvailableAsync().catch(() => false);
          if (can) {
            await Sharing.shareAsync(result.uri, { mimeType: 'video/mp4', dialogTitle: 'SmartFinder video' });
          } else {
            useToastStore.getState().show('Saved · sharing not available');
          }
        }
      } catch (e) {
        console.log('[smartfinder] video recording failed', e);
        useToastStore.getState().show('Recording failed — try again.');
        setRecording(false);
      }
      return;
    }
    // Photo path — unchanged from Fix EQ.
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, skipProcessing: false });
      if (photo?.uri) {
        // 2026-06-13 (Tim) — INGEST: every SmartFinder photo bootstraps this
        // hole's real player's-eye imagery (course-data self-build).
        void ingestCapture({ sourceUri: photo.uri, kind: 'single', hole: currentHole, heading: headingRef.current })
          .then((ok) => { if (ok) useToastStore.getState().show("Added to this hole's library"); });
        const Sharing = await import('expo-sharing');
        const can = await Sharing.isAvailableAsync().catch(() => false);
        if (can) {
          await Sharing.shareAsync(photo.uri, { mimeType: 'image/jpeg', dialogTitle: 'SmartFinder photo' });
        } else {
          useToastStore.getState().show('Saved to cache · sharing not available');
        }
      }
    } catch (e) {
      console.log('[smartfinder] capture failed', e);
      useToastStore.getState().show('Capture failed — try again.');
    } finally {
      setCapturing(false);
    }
  }, [capturing, recording, micPerm, requestMicPerm, currentHole]);
  const setZoomFromPinch = useCallback((next: number) => {
    setZoom(next);
  }, []);
  const commitBaseZoom = useCallback((next: number) => {
    baseZoomRef.current = next;
  }, []);
  const pinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .onUpdate((e) => {
        const next = Math.max(0, Math.min(1, baseZoomRef.current + (e.scale - 1) * PINCH_SENSITIVITY));
        runOnJS(setZoomFromPinch)(next);
      })
      .onEnd((e) => {
        const next = Math.max(0, Math.min(1, baseZoomRef.current + (e.scale - 1) * PINCH_SENSITIVITY));
        runOnJS(commitBaseZoom)(next);
      });
  }, [setZoomFromPinch, commitBaseZoom]);

  // 2026-06-14 (Tim) — track the live compass heading so SmartFinder captures are
  // tagged with the direction the camera faced (the key field for green-facing
  // Heading from the active child overlay (Standard or Target) — threaded up via
  // onHeadingUpdate prop instead of a separate parent DeviceMotion subscription
  // (which was a redundant 3rd/4th subscriber competing with child setUpdateInterval calls).
  const headingRef = useRef<number | null>(null);
  const onHeadingUpdate = useCallback((h: number) => { headingRef.current = h; }, []);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      setLocationGranted(status === 'granted');
    }).catch(err => {
      // 2026-06-08 (audit #2) — a thrown permission request must not crash
      // the rangefinder; treat as not-granted and let the UI prompt.
      console.log('[smartfinder] location permission request failed', err);
      setLocationGranted(false);
    });
  }, []);

  // AppState refresh — on foreground, re-check camera permission so
  // returning from Settings unblocks the screen automatically.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && cameraPermission && !cameraPermission.granted && cameraPermission.canAskAgain) { void requestCameraPermission(); }
    });
    return () => sub.remove();
  }, [requestCameraPermission, cameraPermission]);

  // 2026-06-17 — Scene read extracted so both the eye button and the
  // auto-read voice trigger can call the same code path.
  const runSceneRead = useCallback(async () => {
    if (sceneReading || !cameraRef.current) return;
    setSceneReading(true);
    setSceneResult(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6, skipProcessing: true });
      if (!photo?.uri) throw new Error('no photo');
      const IM = await import('expo-image-manipulator');
      const manip = await IM.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.7, format: IM.SaveFormat.JPEG, base64: true },
      );
      if (!manip.base64) throw new Error('no base64');
      const svc = await import('../services/sceneReadService');
      const result = await svc.readScene({ imageBase64: manip.base64, targetYards: sceneTargetYards });
      if (!mountedRef.current) return;
      if (result) {
        setSceneResult(result.text);
        try {
          const s = useSettingsStore.getState();
          void speak(result.text, s.voiceGender, s.language ?? 'en', getApiBaseUrl(), { userInitiated: true })
            ?.catch?.(() => undefined);
        } catch { /* spoken is best-effort */ }
      } else {
        useToastStore.getState().show('Scene read unavailable — check your signal.');
      }
    } catch (e) {
      if (!mountedRef.current) return;
      console.log('[smartfinder] scene read failed', e);
      useToastStore.getState().show('Scene read failed — try again.');
    } finally {
      if (mountedRef.current) setSceneReading(false);
    }
  }, [sceneReading, sceneTargetYards]);

  // 2026-06-17 — Auto-fire scene read when voice trigger lands with autoread=1.
  // Guard with autoFiredRef so the effect reruns (when runSceneRead changes due
  // to sceneReading flip) do NOT fire a second read.
  useEffect(() => {
    if (!autoRead || autoFiredRef.current) return;
    autoFiredRef.current = true;
    // 1500ms: camera hardware warmup before takePictureAsync is reliable.
    const timer = setTimeout(() => { void runSceneRead(); }, 1500);
    return () => clearTimeout(timer);
  }, [autoRead, runSceneRead]);

  // Loading state — always render a back affordance so a stalled OS
  // dialog can never strand the user.
  if (!cameraPermission) {
    return (
      <SafeAreaView style={styles.cameraContainer}>
        <View style={styles.permBox}>
          <ActivityIndicator color="#00C896" />
          <Text style={[styles.permText, { marginTop: 12 }]}>Checking camera permission…</Text>
          <TouchableOpacity style={styles.backLink} onPress={onClose}>
            <Text style={styles.backLinkText}>← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.cameraContainer}>
        <View style={styles.permBox}>
          <Text style={styles.permTitle}>Camera Access</Text>
          <Text style={styles.permText}>
            SmartFinder uses the camera to aim at your target. Your camera feed never leaves your device.
          </Text>
          <TouchableOpacity
            style={styles.permBtn}
            onPress={async () => {
              if (cameraPermission && !cameraPermission.canAskAgain) { Linking.openSettings(); return; }
              await requestCameraPermission();
            }}
          >
            <Text style={styles.permBtnText}>
              {cameraPermission && !cameraPermission.canAskAgain ? 'Open Settings' : 'Allow Camera'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backLink} onPress={onClose}>
            <Text style={styles.backLinkText}>← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.cameraContainer}>
      <GestureDetector gesture={pinchGesture}>
        <View style={styles.cameraContainer} collapsable={false}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            zoom={zoom}
            // 2026-05-27 — Fix EV: bind capture mode + audio so the
            // underlying camera is ready for either photo or video.
            // 2026-06-04 — IMPORTANT: captureMode MUST default to 'picture'
            // (and only flip to 'video' via explicit user tap on the pill).
            // expo-camera CameraView with mode='video' claims the iOS
            // AVAudioSession recording category on mount, which preempts
            // any in-flight TTS. mode='picture' does not. There is no
            // `mute` prop in expo-camera v17 to override this. The
            // voice-open path is now ordered so speak completes BEFORE
            // navigation (useVoiceCaddie.ts), so even when captureMode
            // is later toggled to video the TTS is already finished —
            // but do not default-mount in video mode.
            mode={captureMode}
            videoQuality="720p"
          />

          {mode === 'target' ? (
            <TargetCameraOverlay
              yards={yards}
              gps={gps}
              geometry={geometry}
              weather={weather}
              shotBearingDeg={shotBearingDeg}
              currentHole={currentHole}
              locked={locked}
              onTargetYardsChange={setSceneTargetYards}
              onHeadingUpdate={onHeadingUpdate}
            />
          ) : mode === 'measure' ? (
            <MeasureCameraOverlay cameraRef={cameraRef} />
          ) : (
            <PuttCameraOverlay locationGranted={locationGranted} />
          )}
        </View>
      </GestureDetector>

      {/* 2026-05-27 — Fix EQ: Lock + Capture floating controls.
          Sit OUTSIDE the GestureDetector + overlay tree so they're
          always tappable regardless of the target-overlay touch
          capture.
          2026-06-25 (Tim — "controls land ON the intel card text") — the
          stack used to anchor bottom-right (bottom: insets.bottom + 110),
          which dropped it INSIDE the tall targetBottomStrip's vertical span:
          the TOOLS pop-out covered the TO TARGET yardage, the PHOTO/VIDEO
          pill clipped the CONF column, and the shutter sat over the Landing
          line. Fix: anchor the whole stack to the UPPER-RIGHT camera zone
          (top-based) which is clear live-camera area above the card's top
          edge. The pop-out TOOLS card now expands DOWNWARD into that empty
          zone instead of upward into the card. This frees the strip to use
          full width (paddingRight reduced below) so CONF is fully visible.
          Lock toggle: only renders in target mode (where the reticle
          actually moves). Capture button: always available, snaps a
          single photo with the full overlay composited via screen
          capture-ish flow (takePictureAsync gets the live camera
          frame; we don't bake overlays into the photo today — that
          needs view-shot for the SVG layer. v1 = raw photo). */}
      <View
        style={{ position: 'absolute', right: 16, top: insets.top + 64, gap: 12, alignItems: 'center' }}
        pointerEvents="box-none"
      >
        {/* 2026-06-23 (Tim) — TOOLS pop-out (SmartMotion SETUP TOOLS style): a
            single sliders chevron collapses the scene-read + lock controls into a
            labeled themed card, keeping the camera view clear. */}
        {mode === 'target' && (
          <>
            {toolsOpen && (
              <View style={sfStyles.toolsCard}>
                <Text style={sfStyles.toolsHeader}>TOOLS</Text>
                <TouchableOpacity
                  style={sfStyles.toolRow}
                  onPress={() => { setToolsOpen(false); void runSceneRead(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Smart Play — read the scene"
                >
                  <View style={sfStyles.toolIcon}>
                    <Ionicons name={sceneReading ? 'sync' : 'eye'} size={20} color="#88F700" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={sfStyles.toolTitle}>AI Read</Text>
                    <Text style={sfStyles.toolDesc}>Snap → how to play this shot</Text>
                  </View>
                </TouchableOpacity>
                {mode === 'target' && (
                  <TouchableOpacity
                    style={sfStyles.toolRow}
                    onPress={() => { setLocked(v => !v); setToolsOpen(false); }}
                    accessibilityRole="button"
                    accessibilityLabel={locked ? 'Unlock target' : 'Lock target'}
                  >
                    <View style={[sfStyles.toolIcon, locked && { backgroundColor: 'rgba(240,192,48,0.18)', borderColor: '#F0C030' }]}>
                      <Ionicons name={locked ? 'lock-closed' : 'lock-open'} size={20} color={locked ? '#F0C030' : '#88F700'} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={sfStyles.toolTitle}>{locked ? 'Locked' : 'Lock target'}</Text>
                      <Text style={sfStyles.toolDesc}>Hold the distance reading</Text>
                    </View>
                  </TouchableOpacity>
                )}
                {/* 2026-06-25 (Tim — declutter) — capture moved off the floating
                    shutter into these two rows. Photo: snap immediately. Video:
                    first tap arms video mode + starts recording, second tap (label
                    flips to "Stop recording") stops + shares. Same takePictureAsync /
                    recordAsync / ingestCapture path as before, just relocated. */}
                <View style={sfStyles.toolDivider} />
                <TouchableOpacity
                  style={sfStyles.toolRow}
                  disabled={recording || capturing}
                  onPress={() => {
                    if (captureMode !== 'picture') setCaptureMode('picture');
                    setToolsOpen(false);
                    void runCapture('picture');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Take a photo"
                >
                  <View style={[sfStyles.toolIcon, (recording || capturing) && { opacity: 0.4 }]}>
                    <Ionicons name={capturing ? 'sync' : 'camera'} size={20} color="#88F700" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={sfStyles.toolTitle}>Photo</Text>
                    <Text style={sfStyles.toolDesc}>Snap + add to this hole</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={sfStyles.toolRow}
                  disabled={capturing}
                  onPress={() => {
                    // Arm video mode so CameraView is in the recording pipeline,
                    // then start/stop. The mode prop is bound to captureMode. Keep
                    // the pop-out OPEN while recording so the row (now "Stop
                    // recording") stays reachable for the second tap.
                    if (captureMode !== 'video') setCaptureMode('video');
                    void runCapture('video');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={recording ? 'Stop video recording' : 'Record video or pano'}
                >
                  <View style={[sfStyles.toolIcon, recording && { backgroundColor: 'rgba(239,68,68,0.18)', borderColor: '#ef4444' }]}>
                    <Ionicons name={recording ? 'stop' : 'videocam'} size={20} color={recording ? '#ef4444' : '#88F700'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={sfStyles.toolTitle}>{recording ? 'Stop recording' : 'Video / Pano'}</Text>
                    <Text style={sfStyles.toolDesc}>{recording ? 'Tap to finish + share' : 'Record this hole · turn to pan'}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity
              onPress={() => setToolsOpen(v => !v)}
              accessibilityRole="button"
              accessibilityLabel={toolsOpen ? 'Hide tools' : 'Show tools'}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 2,
                paddingHorizontal: 12, height: 44, borderRadius: 22,
                backgroundColor: 'rgba(0,0,0,0.6)',
                // Subtle live-recording tint so the single TOOLS button signals an
                // active recording even when the pop-out is the thing being looked at.
                borderWidth: 1.5, borderColor: recording ? '#ef4444' : '#88F700',
              }}
            >
              <Ionicons name="options-outline" size={18} color={recording ? '#ef4444' : '#88F700'} />
              <Ionicons name={toolsOpen ? 'chevron-down' : 'chevron-up'} size={14} color={recording ? '#ef4444' : '#88F700'} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Top bar — back, hole+par, GPS quality */}
      <View style={[styles.cameraTopBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.cameraIconBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close camera and return"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.cameraIconText}>←</Text>
        </TouchableOpacity>
        <View style={styles.cameraTopCenter}>
          <Text style={styles.cameraTopTitle}>HOLE {currentHole}</Text>
          <View style={{ marginTop: 4 }}>
            <GPSQuality reading={gps} showText />
          </View>
        </View>
        {/* Right side: measure + map + putt quick-access icons — replaces the 4-mode toggle bar */}
        <View style={[styles.cameraIconBtn, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
          {/* 2026-07-22 (Tim) — Measure: GPS-free known-height rangefinder, usable anywhere. */}
          <TouchableOpacity
            onPress={() => onModeChange(mode === 'measure' ? 'target' : 'measure')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={mode === 'measure' ? 'Back to camera' : 'Measure a distance'}
          >
            <Ionicons name={mode === 'measure' ? 'camera-outline' : 'resize-outline'} size={20} color={mode === 'measure' ? '#F0C030' : '#00C896'} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onModeChange(mode === 'putt' ? 'target' : 'putt')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={mode === 'putt' ? 'Back to camera' : 'Putt mode'}
          >
            <Ionicons name={mode === 'putt' ? 'camera-outline' : 'golf-outline'} size={20} color="#00C896" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onModeChange('map')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Map view"
          >
            <Ionicons name="map-outline" size={20} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      </View>

      {/* SCENE READ result — the caddie's meta read + mental approach, over a dark
          card so it's legible against the bright frame. Tap to dismiss. */}
      {sceneResult != null && (
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setSceneResult(null)}
          style={{
            position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 110,
            backgroundColor: 'rgba(8,13,10,0.94)', borderRadius: 16, borderWidth: 1,
            borderColor: 'rgba(136,247,0,0.35)', padding: 16,
          }}
          accessibilityRole="button"
          accessibilityLabel="Scene read. Tap to dismiss."
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Ionicons name="eye" size={14} color="#88F700" />
            <Text style={{ color: '#88F700', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }}>SCENE READ</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.5)" />
          </View>
          <Text style={{ color: '#ffffff', fontSize: 14, lineHeight: 20 }}>{sceneResult}</Text>
        </TouchableOpacity>
      )}
    </GestureHandlerRootView>
  );
}

// ─── Putt mode (camera + 2 taps + simple slope hint) ─────────────────────────

// ─── Target mode (camera + draggable target reticle + F/M/B strip) ──────────
//
// Phase 502 port from V3. The user drags the yellow corner-bracket reticle
// across the screen; yardage updates live based on the F/M/B yardages.
// Bottom strip shows TO TARGET <yds> with Front / Middle / Back of green
// distances. Replaces the old top-down flat-canvas TargetView.

// SF fix #2 (owner Tim — "generic hardcoded club ladder, not the learned bag") —
// this used to map distance→club via a fixed amateur ladder, ignoring the
// player's real/edited bag. Route it through clubStatsStore.inferClub(), which
// picks the closest club from the player's TRACKED carries → STATED My-Bag
// carries → STANDARD_YARDS chart (in that precedence). Same learned-bag lookup
// the brain read (composeShotRead/bagDistances) uses, so the plan lines and the
// headline can't recommend from different yardage tables. The old hardcoded
// ladder remains only as an unreachable safety fallback if the store throws.
function recommendClubForDistance(yards: number | null): string | null {
  if (yards == null || yards <= 0) return null;
  try {
    return useClubStatsStore.getState().inferClub(yards);
  } catch {
    // fall through to the generic chart only if the store is unavailable
  }
  if (yards >= 240) return 'Driver';
  if (yards >= 215) return '3 Wood';
  if (yards >= 195) return 'Hybrid';
  if (yards >= 178) return '4 Iron';
  if (yards >= 165) return '5 Iron';
  if (yards >= 152) return '6 Iron';
  if (yards >= 138) return '7 Iron';
  if (yards >= 125) return '8 Iron';
  if (yards >= 110) return '9 Iron';
  if (yards >= 95) return 'PW';
  if (yards >= 78) return 'GW';
  if (yards >= 58) return 'SW';
  if (yards >= 38) return 'LW';
  return 'Putter';
}

function estimateCarryTotal(club: string | null, avgCarryDriver: number, avgCarry3Wood: number): { carry: number; total: number; baseline: boolean } | null {
  if (!club) return null;
  // baseline = the player has logged NO real practice carries, so these numbers
  // are generic tour-average fallbacks, not their measured distances. The UI
  // labels the line "(est.)" in that case so a number is never shown as if it
  // were the player's own measured carry (honesty rule).
  const baseline = !(avgCarryDriver > 0);
  const dCarry = avgCarryDriver > 0 ? avgCarryDriver : 240;
  const w3Carry = avgCarry3Wood > 0 ? avgCarry3Wood : Math.max(205, dCarry - 22);
  const map: Record<string, number> = {
    'Driver': dCarry,
    '3 Wood': w3Carry,
    'Hybrid': Math.max(188, w3Carry - 20),
    '4 Iron': Math.max(176, w3Carry - 30),
    '5 Iron': Math.max(165, w3Carry - 40),
    '6 Iron': Math.max(154, w3Carry - 50),
    '7 Iron': Math.max(143, w3Carry - 60),
    '8 Iron': Math.max(132, w3Carry - 70),
    '9 Iron': Math.max(121, w3Carry - 80),
    'PW': 110,
    'GW': 95,
    'SW': 78,
    'LW': 62,
    'Putter': 12,
  };
  // 2026-07-06 (honesty audit) — an UNMAPPED club used to fabricate a flat 140-yard
  // carry that flowed into the hazard-clearance math + risk band as if real. Bail
  // instead so the strategy line degrades to "—" rather than inventing a number.
  if (map[club] == null) return null;
  const carry = Math.round(map[club]);
  const rollout = club === 'Driver' ? 18 : club === '3 Wood' ? 14 : club === 'Hybrid' ? 10 : club.includes('Iron') ? 6 : 2;
  return { carry, total: carry + rollout, baseline };
}

function estimateDispersion(club: string | null, handicap: number): { yards: number; band: 'tight' | 'moderate' | 'wide' } {
  // SF fix #2 — recognize the clubStatsStore short names ('3W','3H','7I') the
  // learned-bag lookup now returns, alongside the legacy display names.
  const isWood = club === 'Driver' || club === '3 Wood' || /^[3457]W$/.test(club ?? '');
  const isHybrid = club === 'Hybrid' || /^[234]H$/.test(club ?? '');
  const isIron = !!club?.includes('Iron') || /^[1-9]I$/.test(club ?? '');
  const base = isWood ? (club === 'Driver' ? 34 : 28) : isHybrid ? 24 : isIron ? 18 : 10;
  const hcpAdjust =
    handicap <= DISPERSION_HCP_BREAKS.tight ? -6
    : handicap <= DISPERSION_HCP_BREAKS.good ? -3
    : handicap <= DISPERSION_HCP_BREAKS.neutral ? 0
    : handicap <= DISPERSION_HCP_BREAKS.loose ? 5
    : 9;
  const yards = Math.max(8, base + hcpAdjust);
  const band = yards <= 16 ? 'tight' : yards <= 28 ? 'moderate' : 'wide';
  return { yards, band };
}

function stepDownClub(club: string | null): string | null {
  if (!club) return null;
  // SF fix #2 — step down using the canonical clubStatsStore CLUB_ORDER (the
  // same '7I'/'3W' names inferClub returns) so the hazard step-down stays
  // aligned with the learned-bag recommendation. Putter is excluded so we
  // never "step down" an approach club to the putter.
  const ladder = CLUB_ORDER.filter(c => c !== 'Putter') as readonly string[];
  const idx = ladder.indexOf(club);
  if (idx < 0 || idx === ladder.length - 1) return club;
  return ladder[idx + 1];
}

type HazardIntelligence = {
  label: string;
  kind: 'water' | 'bunker' | 'hazard';
  side: 'left' | 'right' | 'center';
  front: number;
  center: number;
  back: number;
  carryToClear: number;
  runoutDistance: number;
  source: 'polygon' | 'point';
};

function computeHazardIntelligence(
  player: { lat: number; lng: number } | null,
  geometry: HoleGeometry | null,
  landingTotal: number | null,
  shotBearingDeg: number | null,
): HazardIntelligence | null {
  if (!player || !geometry) return null;

  type Candidate = {
    label: string;
    kind: 'water' | 'bunker' | 'hazard';
    sideHint: 'left' | 'right' | 'center' | null;
    centroid: { lat: number; lng: number } | null;
    distances: number[];
    source: 'polygon' | 'point';
  };
  const candidates: Candidate[] = [];

  for (const h of geometry.hazards ?? []) {
    if (!h.location) continue;
    const lower = h.label.toLowerCase();
    const kind: 'water' | 'bunker' | 'hazard' =
      lower.includes('water') || lower.includes('pond') || lower.includes('lake') ? 'water'
      : lower.includes('bunker') || lower.includes('sand') ? 'bunker'
      : 'hazard';
    candidates.push({
      label: h.label,
      kind,
      sideHint: null,
      centroid: h.location,
      distances: [Math.round(haversineYards(player, h.location))],
      source: 'point',
    });
  }

  const polygonFeatures = [...(geometry.bunkers ?? []), ...(geometry.water_hazards ?? [])];
  for (const f of polygonFeatures) {
    const dists: number[] = [];
    if (f.polygon && f.polygon.length > 0) {
      for (const p of f.polygon) dists.push(Math.round(haversineYards(player, p)));
    }
    if (dists.length === 0 && f.centroid) {
      dists.push(Math.round(haversineYards(player, f.centroid)));
    }
    if (dists.length === 0) continue;
    candidates.push({
      label: f.name ?? (f.side === 'greenside' ? 'Greenside hazard' : 'Hazard'),
      kind: geometry.water_hazards?.includes(f) ? 'water' : 'bunker',
      sideHint: f.side === 'left' || f.side === 'right' ? f.side : null,
      centroid: f.centroid ?? null,
      distances: dists,
      source: f.polygon && f.polygon.length > 0 ? 'polygon' : 'point',
    });
  }

  if (candidates.length === 0) return null;

  const scored = candidates.map((c) => {
    const sorted = [...c.distances].sort((a, b) => a - b);
    const front = sorted[0];
    const back = sorted[sorted.length - 1];
    const center = Math.round((front + back) / 2);
    const sideFromBearing = (() => {
      if (!shotBearingDeg || !c.centroid) return null;
      const hazardBearing = bearingDegrees(player, c.centroid);
      let rel = ((hazardBearing - shotBearingDeg) % 360 + 360) % 360;
      if (rel > 180) rel -= 360;
      if (Math.abs(rel) <= 12) return 'center' as const;
      return rel < 0 ? 'left' as const : 'right' as const;
    })();
    const side = c.sideHint ?? sideFromBearing ?? 'center';
    return { c, front, back, center, side };
  }).sort((a, b) => a.center - b.center);

  const best = scored[0];
  const carryToClear = best.back + 1;
  const runoutDistance = landingTotal != null ? Math.max(0, landingTotal - carryToClear) : 0;

  return {
    label: best.c.label,
    kind: best.c.kind,
    side: best.side,
    front: best.front,
    center: best.center,
    back: best.back,
    carryToClear,
    runoutDistance,
    source: best.c.source,
  };
}

function riskBandFromHazards(nearestHazardYards: number | null, carryYards: number | null): 'Low' | 'Moderate' | 'High' {
  if (nearestHazardYards == null || carryYards == null) return 'Moderate';
  const delta = Math.abs(nearestHazardYards - carryYards);
  if (delta <= 8) return 'High';
  if (delta <= 20) return 'Moderate';
  return 'Low';
}

function TargetCameraOverlay({
  yards,
  gps,
  geometry,
  weather,
  shotBearingDeg,
  currentHole,
  locked,
  onTargetYardsChange,
  onHeadingUpdate,
}: {
  yards: GreenYardages;
  gps: GPSQualityReading;
  geometry: HoleGeometry | null;
  weather: WeatherSnapshot | null;
  shotBearingDeg: number | null;
  currentHole: number;
  locked?: boolean;
  onTargetYardsChange?: (yards: number | null) => void;
  onHeadingUpdate?: (h: number) => void;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  // SF fix #3 (owner Tim — "user-stated yardage ignored") — the target overlay
  // seeded/re-synced purely from yards.middle (GPS/scorecard) and never consulted
  // resolveYardage, so when the player STATES a distance ("I'm 150 out") the
  // screen kept showing the GPS middle. statedYardageFor() returns a number ONLY
  // when resolveYardage's source is 'user_stated' (a fresh, same-hole stated
  // anchor); otherwise null, so the GPS/scorecard path below is untouched. A
  // stated value wins over GPS for the seed, the re-sync, and the hole reset.
  const statedYardageFor = useCallback((hole: number): number | null => {
    const r = resolveYardage(hole);
    return r.source === 'user_stated' && r.value != null ? r.value : null;
  }, []);
  const [targetYards, setTargetYards] = useState<number | null>(
    () => statedYardageFor(currentHole) ?? yards.middle,
  );
  useEffect(() => { onTargetYardsChange?.(targetYards); }, [targetYards, onTargetYardsChange]);
  const [targetBearing, setTargetBearing] = useState<number | null>(shotBearingDeg);
  // 2026-06-23 (Tim — "surfaces shouldn't go dark/stale on a good signal") —
  // SPLIT-BRAIN FIX: targetYards was seeded ONCE from yards.middle and only
  // re-derived by a manual camera-TILT read. So when the live GPS green-middle
  // settled/changed, the F/M/B strip (which reads `yards` directly) showed the
  // good number while the camera intel + AI club card (which read `targetYards`)
  // stayed stale/dashed — two halves of the same screen disagreeing.
  //
  // Re-sync targetYards to the live GPS green-middle whenever it's a good fix
  // (yards.reason === 'ok'), UNLESS the user has taken precedence:
  //   - `locked`            → they've held the reticle on a target
  //   - lastYardsRef.current → a manual TILT read has placed a target distance
  //     (this ref is set ONLY inside onTargetPointNormalized, so a non-null
  //      value is the exact marker that the user has aimed)
  // In either case we keep their value. When GPS has NO fix (reason !== 'ok')
  // we touch nothing, so the existing static fallback behavior is unchanged.
  useEffect(() => {
    // SF fix #3 — a fresh user-stated number is the highest-trust source: it
    // overrides GPS AND the manual locked/tilt targets (the player literally
    // told us the distance). Re-checked on every GPS tick (yards changes ~3s)
    // so a number stated mid-screen takes over without a remount.
    const stated = statedYardageFor(currentHole);
    if (stated != null) {
      setTargetYards(prev => (prev === stated ? prev : stated));
      return;
    }
    if (locked) return;                         // manual: held target wins
    if (lastYardsRef.current != null) return;   // manual: tilt-placed target wins
    // 2026-06-30 (Tim — Greenhill: "SmartFinder didn't always adjust for the actual yardage
    // like the other parts did"). Was gated on reason === 'ok', so during a GPS stale-DEGRADE
    // (frequent in the log, even at good 3-9m accuracy) the club card / intel kept a STALE
    // number while the F/M/B strip (which reads yards.middle directly) updated — the two
    // halves disagreeing again. Sync to whatever the F/M/B strip shows (any non-null middle,
    // incl. a recent degraded fix) so they always match. Only when there's NO number at all
    // do we leave the static fallback.
    if (yards.middle == null) return;
    setTargetYards(prev => (prev === yards.middle ? prev : yards.middle));
  }, [yards.reason, yards.middle, locked, currentHole, statedYardageFor]);

  // 2026-07-09 (audit fix) — write the ranged lock to the SHARED store so the voice caddie
  // knows "the target you locked". Prod SmartFinder kept lock state LOCAL, so the caddie's
  // currentLock read (useKevin/useVoiceCaddie) was always null unless you used the debug
  // screen. On lock: build an honest RangefinderLock from the live GPS fix + compass heading
  // + the on-screen target yardage (target_position projected + flagged estimated). On unlock:
  // clear it. No fabrication — if there's no GPS or no yardage, we don't write a lock.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = (require('../store/smartFinderStore') as typeof import('../store/smartFinderStore')).useSmartFinderStore.getState();
    if (!locked) { store.clearLock(); return; }
    const fix = getLastFix();
    const dist = targetYards ?? yards.middle;
    if (!fix || fix.location.lat == null || fix.location.lng == null || dist == null) return;
    const heading = headingRef.current ?? 0;
    // Destination point from (user, bearing=heading, distance) — standard great-circle projection.
    const R = 6371000, d = dist * 0.9144, br = (heading * Math.PI) / 180;
    const lat1 = (fix.location.lat * Math.PI) / 180, lng1 = (fix.location.lng * Math.PI) / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d / R) + Math.cos(lat1) * Math.sin(d / R) * Math.cos(br));
    const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d / R) * Math.cos(lat1), Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2));
    store.setLock({
      id: `lock_${fix.timestamp}`,
      locked_at: fix.timestamp,
      user_position: { lat: fix.location.lat, lng: fix.location.lng, accuracy: fix.accuracy_m ?? 0 },
      target_position: { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI, estimated: true },
      distance_yards: Math.round(dist),
      distance_meters: Math.round(dist * 0.9144),
      compass_heading: Math.round(heading),
      tap_y_normalized: 0.52,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, targetYards, yards.middle]);
  // 2026-06-23 — Hole switch: clear any manual tilt placement + re-seed the
  // target from the new hole's GPS so hole N's aim doesn't bleed into hole N+1.
  // Keyed on currentHole; the re-sync effect above then re-syncs from the new
  // yards.middle on the next render.
  useEffect(() => {
    lastYardsRef.current = null;
    lastBearingRef.current = null;
    // SF fix #3 — re-seed the new hole from a stated number if the player has
    // one for it, otherwise the GPS/scorecard middle (unchanged behavior).
    setTargetYards(statedYardageFor(currentHole) ?? yards.middle ?? null);
    setTargetBearing(shotBearingDeg);
    setReticleConfidence('medium');
    setTargetLoc(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset is keyed on hole change only
  }, [currentHole]);
  const [reticleConfidence, setReticleConfidence] = useState<'high' | 'medium' | 'low'>('medium');
  // 2026-06-25 (Tim — "crowded ass dog shit") — the intel card defaults to a
  // COMPACT read (club + yardage + one-line safe-side tip). The full breakdown
  // (RAW/PLAYS/CLUB/CONF row + Landing + nearest-hazard + aggressive/conservative
  // plans + wind/elevation) lives behind this expand chevron, so the resting
  // rangefinder view is clean. No data is removed — just collapsed by default.
  const [intelExpanded, setIntelExpanded] = useState(false);
  const [playerLoc, setPlayerLoc] = useState<{ lat: number; lng: number } | null>(null);
  // 2026-06-11 — target coord (the reticle aim point) so plays-like can factor
  // real uphill/downhill via the cached elevation service. Defaults flat.
  const [targetLoc, setTargetLoc] = useState<{ lat: number; lng: number } | null>(null);
  // 2026-06-25 — Wire REAL elevation into plays-like. A manual camera-tilt read
  // sets playerLoc/targetLoc above, but the COMMON case is the GPS green read
  // (no tilt) — there both stayed null and elevation was always flat. Fall back
  // to the live GPS fix (player) + the hole's green centroid (target) so the
  // elevation lookup runs on every normal read, not just a manual tilt. The
  // elevationService caches per ~11m grid, so this is one lookup per tee/green.
  const fixForElev = getLastFix();
  const elevPlayer = playerLoc ?? (fixForElev ? { lat: fixForElev.location.lat, lng: fixForElev.location.lng } : null);
  const elevTarget = targetLoc ?? (geometry?.green ? { lat: geometry.green.lat, lng: geometry.green.lng } : null);
  const elevation = useElevationDeltaStatus(elevPlayer, elevTarget);
  const elevationDeltaFeet = elevation.deltaFeet;
  const headingRef = useRef(0);
  const pitchRef = useRef(-10);
  const lastYardsRef = useRef<number | null>(null);
  const lastBearingRef = useRef<number | null>(null);
  const lastPlayerLocRef = useRef<{ lat: number; lng: number } | null>(null);

  const avgCarryDriver = usePracticeStore(s => s.avgCarryDriver);
  const avgCarry3Wood = usePracticeStore(s => s.avgCarry3Wood);
  const handicap = usePlayerProfileStore(s => s.handicap);
  const dominantMiss = usePlayerProfileStore(s => s.dominantMiss);

  useEffect(() => {
    DeviceMotion.setUpdateInterval(80);
    const sub = DeviceMotion.addListener(data => {
      if (data.rotation) {
        const pitchDeg = ((data.rotation.beta ?? 0) * 180) / Math.PI;
        pitchRef.current = pitchDeg;
        const alphaDeg = ((data.rotation.alpha ?? 0) * 180) / Math.PI;
        const heading = ((alphaDeg % 360) + 360) % 360;
        headingRef.current = heading;
        onHeadingUpdate?.(heading);
      }
    });
    return () => sub.remove();
  }, [onHeadingUpdate]);

  const onTargetPointNormalized = useCallback((point: { xNorm: number; yNorm: number }) => {
    const fix = getLastFix();
    if (!fix) {
      setTargetYards(null);
      setReticleConfidence('low');
      return;
    }
    const userPos = {
      lat: fix.location.lat,
      lng: fix.location.lng,
      accuracy: fix.accuracy_m ?? 10,
    };
    const result = computeDistance({
      user_position: userPos,
      compass_heading: headingRef.current,
      tap_x_normalized: point.xNorm,
      tap_y_normalized: point.yNorm,
      device_pitch_degrees: pitchRef.current,
    });
    if (result.unmeasurable) {
      // Near-level hold: no usable tilt input. Keep the GPS green-middle
      // baseline and flag the read as soft rather than blanking.
      setReticleConfidence('low');
      return;
    }
    // 2026-06-23 (Tim — "moving the target never gets accurate, defaults to 250
    // or 10") — the camera-TILT rangefinder is unreliable near the horizon (most
    // golf targets): tiny pitch errors explode the projected point to 250+ or
    // collapse it to ~10.
    //
    // SF-1 (owner: "Keep GPS, gate the tilt read") — only let a tilt read
    // OVERWRITE the displayed distance when it is PLAUSIBLE relative to the
    // honest GPS green-middle distance (within a 60yd window). When the tilt
    // read is implausible — or there's no GPS baseline to compare against —
    // KEEP the GPS distance and drop the confidence to Low so the user sees a
    // soft read instead of a clobbered garbage number. The geodesic/tilt math
    // itself is unchanged; this is purely a display gate.
    const target = { lat: result.target_lat, lng: result.target_lng };
    const geodesicYards = Math.max(1, Math.round(haversineYards(fix.location, target)));
    const gpsMiddleYards = yards.reason === 'ok' ? yards.middle : null;
    if (gpsMiddleYards != null) {
      // ON-COURSE: gate the camera-tilt read against the honest GPS green-middle baseline (SF-1).
      // A tilt read >60yd off the baseline is horizon-noise → keep the GPS distance, drop to Low.
      if (Math.abs(geodesicYards - gpsMiddleYards) >= 60) {
        setReticleConfidence('low');
        return;
      }
      setReticleConfidence(result.confidence);
    } else {
      // 2026-07-14 (Tim — range / off-course POINT-FINDER) — not in a round, so there's no GPS
      // green to gate against; the camera-tilt read is the only signal. Accept it as the measured
      // distance so SmartFinder works as a standalone range-measuring tool (point → yards). Cap
      // confidence at Med — the tilt method is approximate, never truth-grade (esp. near horizon).
      setReticleConfidence(result.confidence === 'high' ? 'medium' : result.confidence);
    }
    if (lastYardsRef.current !== geodesicYards) {
      lastYardsRef.current = geodesicYards;
      setTargetYards(geodesicYards);
      // Update the target coord alongside the yardage (same ~1yd granularity)
      // so the elevation lookup tracks the aim point without per-pixel churn.
      setTargetLoc(target);
    }
    const nextBearing = bearingDegrees(fix.location, target);
    if (lastBearingRef.current !== nextBearing) {
      lastBearingRef.current = nextBearing;
      setTargetBearing(nextBearing);
    }
    // 2026-06-08 (audit #2) — playerLoc is the player's GPS (stable during
    // a reticle drag). Only update when it actually moves, so the hazard
    // useMemos don't recompute (haversine over every polygon vertex) on
    // every drag pixel.
    const prev = lastPlayerLocRef.current;
    if (!prev || prev.lat !== fix.location.lat || prev.lng !== fix.location.lng) {
      lastPlayerLocRef.current = fix.location;
      setPlayerLoc(fix.location);
    }
    // SF-1: yards.reason / yards.middle are read above for the plausibility
    // gate, so they must be in deps — otherwise the callback closes over a
    // stale GPS baseline and the 60yd window compares against an old number.
  }, [yards.reason, yards.middle]);

  const playsLike = useMemo(() => {
    if (targetYards == null || !weather) return null;
    const b = playsLikeDistance(targetYards, weather, targetBearing ?? shotBearingDeg, elevationDeltaFeet);
    return {
      yards: b.plays_like_yards,
      delta: b.delta_yards,
      windText: weather.wind_speed_mph >= 4
        ? `${Math.round(weather.wind_speed_mph)} mph ${describeWindDirection(weather.wind_direction_deg, targetBearing ?? shotBearingDeg)}`
        : null,
    };
  }, [targetBearing, targetYards, shotBearingDeg, weather, elevationDeltaFeet]);

  const effectiveYards = playsLike?.yards ?? targetYards;
  const recommendedClub = useMemo(() => recommendClubForDistance(effectiveYards), [effectiveYards]);
  const landing = useMemo(() => estimateCarryTotal(recommendedClub, avgCarryDriver, avgCarry3Wood), [recommendedClub, avgCarryDriver, avgCarry3Wood]);
  const dispersion = useMemo(() => estimateDispersion(recommendedClub, handicap), [recommendedClub, handicap]);

  const hazardSummary = useMemo(() => {
    if (!playerLoc || !geometry?.hazards || geometry.hazards.length === 0) return null;
    const withDistance = geometry.hazards
      .filter(h => h.location)
      .map(h => ({ label: h.label, yards: Math.round(haversineYards(playerLoc, h.location!)) }))
      .sort((a, b) => a.yards - b.yards);
    if (withDistance.length === 0) return null;
    const nearest = withDistance[0];
    return {
      nearest,
      risk: riskBandFromHazards(nearest.yards, landing?.carry ?? null),
      safeMiss: dominantMiss === 'right' ? 'Favor left center.' : dominantMiss === 'left' ? 'Favor right center.' : 'Favor center-left for margin.',
      secondary: withDistance[1] ?? null,
    };
  }, [dominantMiss, geometry?.hazards, landing?.carry, playerLoc]);

  const hazardIntel = useMemo(
    () => computeHazardIntelligence(playerLoc, geometry, landing?.total ?? null, targetBearing ?? shotBearingDeg),
    [geometry, landing?.total, playerLoc, shotBearingDeg, targetBearing],
  );

  const sideAwareMissGuidance = useMemo(() => {
    if (!hazardIntel) {
      return dominantMiss === 'right' ? 'Preferred miss: left-center.'
        : dominantMiss === 'left' ? 'Preferred miss: right-center.'
        : 'Preferred miss: center-left safe side.';
    }
    if (hazardIntel.side === 'left') return 'Safe miss: right-center (left trouble).';
    if (hazardIntel.side === 'right') return 'Safe miss: left-center (right trouble).';
    return dominantMiss === 'right' ? 'Safe miss: left-center.'
      : dominantMiss === 'left' ? 'Safe miss: right-center.'
      : 'Safe miss: center-left.';
  }, [dominantMiss, hazardIntel]);

  const confidenceLabel = useMemo(() => {
    if (gps.level === 'none' || gps.level === 'stale') return 'Low';
    if (reticleConfidence === 'high' && gps.level === 'strong') return 'High';
    if (reticleConfidence === 'low' || gps.level === 'weak') return 'Low';
    return 'Medium';
  }, [gps.level, reticleConfidence]);

  const conservativeYards = effectiveYards != null ? Math.max(20, effectiveYards - 28) : null;
  const conservativeClub = recommendClubForDistance(conservativeYards);
  const conservativeLanding = estimateCarryTotal(conservativeClub, avgCarryDriver, avgCarry3Wood);

  const aggressiveLine = useMemo(() => {
    if (!recommendedClub || effectiveYards == null) return 'Aggressive: unavailable until GPS settles.';
    if (hazardIntel && landing) {
      const risk = riskBandFromHazards(hazardIntel.carryToClear, landing.carry);
      return `Aggressive: ${recommendedClub} to ${effectiveYards}y, carry ${landing.carry}${landing.baseline ? ' est' : ''} (${risk} risk near ${hazardIntel.label}).`;
    }
    return `Aggressive: ${recommendedClub} to ${effectiveYards}y.`;
  }, [effectiveYards, hazardIntel, landing, recommendedClub]);

  const conservativeLine = useMemo(() => {
    if (!conservativeClub || conservativeYards == null) return 'Conservative: unavailable.';
    if (hazardIntel && conservativeLanding) {
      const clears = conservativeLanding.carry >= hazardIntel.carryToClear;
      const risk = clears ? 'Low' : 'Moderate';
      return `Conservative: ${conservativeClub} to ~${conservativeYards}y (${risk} risk), leave full approach in.`;
    }
    return `Conservative: ${conservativeClub} to ~${conservativeYards}y, leave approach in.`;
  }, [conservativeClub, conservativeLanding, conservativeYards, hazardIntel]);

  const adjustedClub = useMemo(() => {
    if (!hazardIntel || !recommendedClub || !landing) return recommendedClub;
    const nearHazardWindow = Math.abs(landing.carry - hazardIntel.carryToClear) <= 10;
    if (!nearHazardWindow) return recommendedClub;
    return stepDownClub(recommendedClub) ?? recommendedClub;
  }, [hazardIntel, landing, recommendedClub]);

  // 2026-06-13 — THE MOAT: the Caddie Brain's composed read. SmartFinder doesn't
  // calculate the recommendation; it hands the live signals to the CNS composer
  // (composeShotRead) and renders the answer-first result. Pure + offline-safe, so
  // it works with no signal. Past-performance only surfaces in a competitive round.
  const isCompetition = useRoundStore(s => s.isRoundActive && s.isCompetition);
  const shotRead = useMemo(() => composeShotRead({
    rawYards: targetYards,
    weather,
    shotBearingDeg: targetBearing ?? shotBearingDeg,
    elevationDeltaFeet,
    bag: bagDistances(),
    dominantMiss,
    holeLineNote: null,
    nearestHazard: hazardSummary?.nearest ?? null,
    isCompetition,
    pastScoreNote: null,
  }), [targetYards, weather, targetBearing, shotBearingDeg, elevationDeltaFeet, dominantMiss, hazardSummary, isCompetition]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <TargetingOverlay
        targetYards={targetYards}
        onTargetPointNormalized={onTargetPointNormalized}
        locked={locked}
      />

      {/* Bottom F/M/B strip — port of V3's TO TARGET row.
          2026-06-25 — box-none so the intel card's expand chevron is tappable
          while the rest of the strip (labels, F/M/B) stays touch-transparent and
          lets reticle drags through. */}
      <View
        style={[styles.targetBottomStrip, { paddingBottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
      >
        {targetYards != null && (
          <Text style={styles.targetToLabel}>
            <Text style={styles.targetToLabelMuted}>⊕ TO TARGET </Text>
            <Text style={styles.targetToYards}>{targetYards}</Text>
            <Text style={styles.targetToLabelMuted}> yds</Text>
          </Text>
        )}
        {/* SF-2 (owner: "Caption 'scorecard · aim not live'") — when the
            displayed distance is NOT a live GPS read (the static scorecard
            fallback: reason !== 'ok'), caption it so the off-round club rec is
            shown WITH the caveat rather than implying a live aim. Mirrors the
            MapView path's static-distance caption copy/style (geometryMsgText).
            Hidden when reason === 'ok' (live). */}
        {yards.reason !== 'ok' && targetYards != null && (
          <Text style={styles.targetStaticCaption}>scorecard distance · aim not live</Text>
        )}
        {/* 2026-06-25 (Tim — declutter) — COMPACT-by-default intel card. At rest it
            shows only the answer: club + yardage + one safe-side line. The full
            read (numbers row, landing, hazard, plans, wind/elevation) is gated
            behind the expand chevron so the resting rangefinder is clean. Tapping
            anywhere on the card toggles expand; box-none on the strip lets this
            TouchableOpacity receive the tap while the rest stays touch-through. */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setIntelExpanded(v => !v)}
          style={styles.targetIntelCard}
          accessibilityRole="button"
          accessibilityLabel={intelExpanded ? 'Hide the full shot read' : 'Show the full shot read'}
          accessibilityState={{ expanded: intelExpanded }}
        >
          {/* 2026-06-13 — THE MOAT: the brain's answer-first read leads the card.
              Club + plays-like big; one compact "why" line. */}
          {shotRead?.club ? (
            <View style={[styles.brainRead, !intelExpanded && styles.brainReadCompact]}>
              <View style={styles.brainReadHeadline}>
                <Text style={styles.brainReadClub}>{shotRead.club}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={styles.brainReadNums}>
                    {shotRead.deltaYards !== 0
                      ? `${shotRead.rawYards} · plays ${shotRead.playsLikeYards}`
                      : `${shotRead.rawYards} yds`}
                  </Text>
                  <Ionicons
                    name={intelExpanded ? 'chevron-down' : 'chevron-up'}
                    size={16}
                    color="rgba(255,255,255,0.55)"
                  />
                </View>
              </View>
              {shotRead.why.length > 0 && (
                <Text style={styles.brainReadWhy} numberOfLines={2}>{shotRead.why.join('  ·  ')}</Text>
              )}
              {shotRead.tendencyNote && (
                <Text style={styles.brainReadTend} numberOfLines={1}>↳ {shotRead.tendencyNote}</Text>
              )}
              {shotRead.pastPerfNote && (
                <Text style={styles.brainReadPast} numberOfLines={1}>◆ {shotRead.pastPerfNote}</Text>
              )}
            </View>
          ) : (
            // No brain club yet (GPS still settling) — keep a tiny affordance row
            // so the card is still tappable to expand.
            <View style={styles.brainReadHeadline}>
              <Text style={styles.brainReadNums}>{targetYards != null ? `${targetYards} yds` : 'Reading…'}</Text>
              <Ionicons name={intelExpanded ? 'chevron-down' : 'chevron-up'} size={16} color="rgba(255,255,255,0.55)" />
            </View>
          )}

          {/* COMPACT: one safe-side / miss line so the resting card still gives the
              key playing tip without the full data dump. */}
          {!intelExpanded && (
            <Text style={styles.brainReadWhy} numberOfLines={1}>
              {hazardSummary?.nearest
                ? `${hazardSummary.nearest.label} ${hazardSummary.nearest.yards}y · ${hazardSummary.safeMiss}`
                : sideAwareMissGuidance}
            </Text>
          )}

          {/* EXPANDED: the full read. Nothing here is new — it's the same numbers
              row + lines + plans that used to render always. */}
          {intelExpanded && (
            <>
              <View style={styles.targetIntelTopRow}>
                <View style={styles.targetIntelMetric}>
                  <Text style={styles.targetIntelLabel}>RAW</Text>
                  <Text style={styles.targetIntelValue}>{targetYards ?? '—'}</Text>
                </View>
                <View style={styles.targetIntelMetric}>
                  <Text style={styles.targetIntelLabel}>PLAYS</Text>
                  <Text style={styles.targetIntelValueAccent}>{effectiveYards ?? '—'}</Text>
                </View>
                <View style={styles.targetIntelMetric}>
                  <Text style={styles.targetIntelLabel}>CLUB</Text>
                  {/* SF fix #1 — single-source on shotRead.club so the card can
                      NEVER show two different clubs. */}
                  <Text style={styles.targetIntelValue}>{shotRead?.club ?? adjustedClub ?? '—'}</Text>
                </View>
                <View style={styles.targetIntelMetric}>
                  <Text style={styles.targetIntelLabel}>CONF</Text>
                  <Text style={styles.targetIntelValue}>{confidenceLabel}</Text>
                </View>
              </View>
              {!!playsLike?.windText && <Text style={styles.targetIntelLine}>Wind: {playsLike.windText}</Text>}
              {/* 2026-06-25 — Honest REAL-elevation line. Shown ONLY when we have a
                  real read (hasData) that actually moves the number (≥1yd ≈ 3ft). */}
              {elevation.hasData && Math.abs(elevationDeltaFeet) >= 3 && (
                <Text style={styles.targetIntelLine}>
                  Elevation: {elevationDeltaFeet > 0 ? '↑ uphill' : '↓ downhill'} {Math.abs(Math.round(elevationDeltaFeet))} ft
                  {' · '}plays {elevationDeltaFeet > 0 ? '+' : '−'}{Math.abs(Math.round(elevationDeltaFeet / 3))}y
                </Text>
              )}
              {landing && (
                <Text style={styles.targetIntelLine}>
                  Landing: carry {landing.carry}{landing.baseline ? ' est' : ''} · total {landing.total} · ±{dispersion.yards}y ({dispersion.band})
                </Text>
              )}
              {hazardSummary?.nearest ? (
                <Text style={styles.targetIntelLine}>
                  {hazardSummary.nearest.label} {hazardSummary.nearest.yards}y · {hazardSummary.safeMiss}
                </Text>
              ) : (
                <Text style={styles.targetIntelLine}>{sideAwareMissGuidance}</Text>
              )}
              {/* 2026-06-30 (audit) — the 2nd-nearest hazard is fully computed
                  (hazardSummary.secondary) but was dropped. Surface it as a quiet
                  follow-on line so the player sees the next thing in play. */}
              {!!hazardSummary?.secondary && (
                <Text style={styles.targetIntelLine}>
                  Also: {hazardSummary.secondary.label} {hazardSummary.secondary.yards}y
                </Text>
              )}
              <Text style={styles.targetIntelPlan}>{aggressiveLine}</Text>
              <Text style={styles.targetIntelPlan}>{conservativeLine}</Text>
            </>
          )}
        </TouchableOpacity>
        <View style={styles.targetFmbRow}>
          <View style={styles.targetFmbCol}>
            <Text style={styles.targetFmbHeader}>F</Text>
            <Text style={styles.targetFmbValue}>{yards.front ?? '—'}</Text>
          </View>
          <View style={styles.targetFmbCol}>
            <Text style={styles.targetFmbHeaderMid}>M</Text>
            <Text style={styles.targetFmbValueMid}>{yards.middle ?? '—'}</Text>
          </View>
          <View style={styles.targetFmbCol}>
            <Text style={styles.targetFmbHeader}>B</Text>
            <Text style={styles.targetFmbValue}>{yards.back ?? '—'}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Measure mode (GPS-free known-height rangefinder — usable anywhere) ──────
// 2026-07-22 (Tim — "use SmartFinder anytime to measure distance in my yard or cage").
// Point at any target of known height (flag, person, marker), tap its TOP then its BASE,
// and the angular height it fills gives the distance — no GPS, no course data, any distance.
// The camera-TILT rangefinder (target mode) caps at ~50 yds; this doesn't. Model mirrors
// PuttCameraOverlay's two-tap capture; the math is services/rangefinder.computeHeightRangedDistance.
function MeasureCameraOverlay({ cameraRef }: { cameraRef: React.RefObject<CameraView | null> }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [viewH, setViewH] = useState(0);
  const [viewW, setViewW] = useState(0);
  const [topPt, setTopPt] = useState<{ x: number; y: number } | null>(null);
  const [basePt, setBasePt] = useState<{ x: number; y: number } | null>(null);
  const [refId, setRefId] = useState(REFERENCE_HEIGHTS[0].id);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const ref = REFERENCE_HEIGHTS.find((r) => r.id === refId) ?? REFERENCE_HEIGHTS[0];

  const handleTap = useCallback((event: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = event.nativeEvent;
    if (!topPt) setTopPt({ x: locationX, y: locationY });
    else if (!basePt) setBasePt({ x: locationX, y: locationY });
    else { setTopPt({ x: locationX, y: locationY }); setBasePt(null); } // third tap restarts
    setAutoMsg(null);
  }, [topPt, basePt]);
  const reset = () => { setTopPt(null); setBasePt(null); setAutoMsg(null); };

  // 2026-07-23 — Auto-detect: capture a frame, let the vision brain find the flag/person's
  // top + base, and drop the two markers automatically. The model returns NORMALIZED image
  // coords; setting the markers as normalized×view means the existing `result` (which divides
  // y by viewH) recovers the exact image-normalized y the ranging math needs. HONEST fallback:
  // found=false → keep the manual two-tap and tell the user what to do.
  const runAutoDetect = useCallback(async () => {
    if (autoBusy || !cameraRef.current || viewH === 0) return;
    setAutoBusy(true);
    setAutoMsg(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true, skipProcessing: true });
      const b64 = photo?.base64;
      if (!b64) { setAutoMsg('Could not capture a frame — try again or tap manually.'); return; }
      const det = await detectMeasureReference(b64);
      if (!det.found || !det.top || !det.base) {
        setAutoMsg('No flag or person clearly in view — tap the top and base yourself.');
        return;
      }
      // Match the reference chip to what was detected so ref.meters reflects the real height.
      const matchedId = det.kind === 'flagstick' ? 'flagstick' : det.kind === 'person' ? 'person' : refId;
      setRefId(matchedId);
      const w = viewW || 1;
      setTopPt({ x: det.top.x * w, y: det.top.y * viewH });
      setBasePt({ x: det.base.x * w, y: det.base.y * viewH });
      setAutoMsg(null);
    } catch {
      setAutoMsg('Auto-detect failed — tap the top and base yourself.');
    } finally {
      setAutoBusy(false);
    }
  }, [autoBusy, cameraRef, viewH, viewW, refId]);

  // TOP = the smaller y (higher on screen); order-independent so tapping base first still works.
  const result = topPt && basePt && viewH > 0
    ? computeHeightRangedDistance({
        top_y_normalized: Math.min(topPt.y, basePt.y) / viewH,
        base_y_normalized: Math.max(topPt.y, basePt.y) / viewH,
        real_height_m: ref.meters,
        vfov_deg: 60, // base camera VFOV (measure at 1×; zoom-corrected VFOV is a follow-up)
      })
    : null;

  return (
    <>
      <TouchableOpacity
        activeOpacity={1}
        style={StyleSheet.absoluteFill}
        onPress={handleTap}
        onLayout={(e) => { setViewH(e.nativeEvent.layout.height); setViewW(e.nativeEvent.layout.width); }}
      />

      {/* Reference-target chips — what are we ranging off? */}
      <View style={{ position: 'absolute', top: insets.top + 12, left: 0, right: 0 }} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {REFERENCE_HEIGHTS.map((r) => (
            <TouchableOpacity
              key={r.id}
              onPress={() => { setRefId(r.id); reset(); }}
              style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, backgroundColor: r.id === refId ? '#003d20' : 'rgba(0,0,0,0.55)', borderColor: r.id === refId ? '#00C896' : 'rgba(255,255,255,0.25)' }}
              accessibilityRole="button"
              accessibilityLabel={`Range off ${r.label}`}
            >
              <Text style={{ color: r.id === refId ? '#00C896' : '#e5e7eb', fontSize: 12, fontWeight: '700' }}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Tap markers + the measured vertical span */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%">
          {topPt && (
            <Circle cx={topPt.x} cy={topPt.y} r={10} fill="rgba(0,200,150,0.35)" stroke="#00C896" strokeWidth={2} />
          )}
          {basePt && (
            <Circle cx={basePt.x} cy={basePt.y} r={10} fill="rgba(245,166,35,0.35)" stroke="#F5A623" strokeWidth={2} />
          )}
          {topPt && basePt && (
            <Line x1={topPt.x} y1={topPt.y} x2={basePt.x} y2={basePt.y} stroke="#ffffff" strokeWidth={2} strokeDasharray="6 4" />
          )}
        </Svg>
      </View>

      {/* Bottom panel — instruction while capturing, distance once both taps land */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {/* Auto-detect — hands-free capture of a flagstick / person. Shown until a read lands. */}
        {!(topPt && basePt && result && !result.unmeasurable) && (
          <TouchableOpacity
            onPress={runAutoDetect}
            disabled={autoBusy}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'center', marginBottom: 10, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, backgroundColor: '#003d20', borderWidth: 1, borderColor: '#00C896', opacity: autoBusy ? 0.6 : 1 }}
            accessibilityRole="button"
            accessibilityLabel="Auto-detect a flag or person to measure"
          >
            {autoBusy ? <ActivityIndicator size="small" color="#00C896" /> : <Ionicons name="scan-outline" size={18} color="#00C896" />}
            <Text style={{ color: '#00C896', fontSize: 14, fontWeight: '800' }}>{autoBusy ? 'Scanning…' : 'Auto-detect'}</Text>
          </TouchableOpacity>
        )}
        {autoMsg && (
          <Text style={{ color: '#F0C030', fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>{autoMsg}</Text>
        )}
        {!topPt ? (
          <Text style={styles.instructionText}>Auto-detect, or tap the TOP of the {ref.label.replace(/\s*\(.*\)$/, '')}</Text>
        ) : !basePt ? (
          <Text style={styles.instructionText}>Now tap its BASE (the ground)</Text>
        ) : result && !result.unmeasurable ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900' }}>{result.distance_yards}<Text style={{ fontSize: 18, fontWeight: '700' }}> yds</Text></Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600', marginTop: 2 }}>
              off {ref.label} · {result.confidence} confidence
            </Text>
            {result.confidence === 'low' && (
              <Text style={{ color: '#F0C030', fontSize: 11, fontWeight: '700', marginTop: 4 }}>Zoom in on the target for a tighter read</Text>
            )}
            <TouchableOpacity onPress={reset} style={{ marginTop: 10, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: '#00C896' }} accessibilityRole="button" accessibilityLabel="Measure again">
              <Text style={{ color: '#00C896', fontSize: 13, fontWeight: '800' }}>Measure again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.instructionText}>Line up the top and base and tap again</Text>
        )}
      </View>
    </>
  );
}

function PuttCameraOverlay({ locationGranted: _locationGranted }: { locationGranted: boolean }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const pitchRef = useRef(0);
  const rollRef = useRef(0);
  const [pointA, setPointA] = useState<{ x: number; y: number } | null>(null);
  const [pointB, setPointB] = useState<{ x: number; y: number } | null>(null);
  const [pitchAtMeasure, setPitchAtMeasure] = useState<number | null>(null);
  const [rollAtMeasure, setRollAtMeasure] = useState<number | null>(null);
  // Live tilt for the real-time level indicator. pitch = fore/aft (incline
  // along the aim), roll = side tilt. Updated ~5×/s.
  const [tilt, setTilt] = useState<{ pitch: number; roll: number }>({ pitch: 0, roll: 0 });

  useEffect(() => {
    DeviceMotion.setUpdateInterval(200);
    const sub = DeviceMotion.addListener(data => {
      if (data.rotation) {
        const pitch = ((data.rotation.beta ?? 0) * 180) / Math.PI;
        const roll = ((data.rotation.gamma ?? 0) * 180) / Math.PI;
        pitchRef.current = pitch;
        rollRef.current = roll;
        setTilt({ pitch, roll });
      }
    });
    return () => sub.remove();
  }, []);

  // Live slope estimate (% grade) along the aim, from how far the phone is
  // off vertical. Honest: this is an ESTIMATE that depends on a steady hold
  // — not a surveyed green map. Surfaced live so the player can "read" the
  // incline before committing.
  //
  // 2026-07-20 (pre-ship fix) — slope = tan(pitch − 90°) EXPLODES to a 15+ digit
  // number whenever the phone isn't held near-upright (at rest pitch≈0 → tan(−90°)→∞),
  // which used to print e.g. "DOWNHILL ~1633123935319537000%". Gate the read to a
  // sane upright hold and clamp to realistic green grades; return null (→ "hold
  // upright" hint / "—") when the phone isn't in a readable position.
  const slopePctFromPitch = (p: number | null): number | null => {
    if (p == null || !Number.isFinite(p)) return null;
    const deviation = Math.abs(p) - 90; // degrees off vertical; upright hold ≈ 0
    if (Math.abs(deviation) > 30) return null; // not a putting-read hold — tan() is noise here
    const pct = Math.tan((deviation * Math.PI) / 180) * 100;
    if (!Number.isFinite(pct)) return null;
    return Math.round(Math.max(-25, Math.min(25, pct))); // real greens don't exceed ~a dozen %
  };
  const liveSlopePct = slopePctFromPitch(tilt.pitch);
  const liveLevel = liveSlopePct != null && Math.abs(liveSlopePct) < 1 && Math.abs(tilt.roll) < 2;

  const handleTap = useCallback((event: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = event.nativeEvent;
    if (!pointA) {
      setPointA({ x: locationX, y: locationY });
    } else if (!pointB) {
      setPointB({ x: locationX, y: locationY });
      setPitchAtMeasure(pitchRef.current);
      setRollAtMeasure(rollRef.current);
    } else {
      // Reset on third tap
      setPointA({ x: locationX, y: locationY });
      setPointB(null);
      setPitchAtMeasure(null);
      setRollAtMeasure(null);
    }
  }, [pointA, pointB]);

  const reset = () => { setPointA(null); setPointB(null); setPitchAtMeasure(null); setRollAtMeasure(null); };

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
  const slopePct = slopePctFromPitch(pitchAtMeasure);

  // Putt READ — turn the captured metrics into actual advice: pace from
  // the incline, break direction from the side tilt. Qualitative on
  // purpose (no fake cup counts) and labeled an estimate — trust your own
  // read too. This is the "now that we have more metrics" improvement.
  const puttRead = pointA && pointB && slopePct != null ? (() => {
    const pace = slopePct > 2 ? 'firm pace — it’s uphill'
      : slopePct < -2 ? 'soft pace — downhill, let it die'
      : 'stock pace';
    const side = rollAtMeasure ?? 0;
    let breakTxt: string;
    if (Math.abs(side) >= 4) {
      breakTxt = side > 0 ? 'strong right break — aim outside the left edge' : 'strong left break — aim outside the right edge';
    } else if (Math.abs(side) >= 2) {
      breakTxt = side > 0 ? 'breaks right — aim the left edge' : 'breaks left — aim the right edge';
    } else {
      breakTxt = 'plays fairly straight';
    }
    return `${breakTxt}, ${pace}.`;
  })() : null;

  return (
    <>
      <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={handleTap} />

      {/* Live level indicator — hold the phone along the ball→hole line and
          read the incline in real time. Honest estimate (depends on a
          steady hold), not a surveyed green map. */}
      <View style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16, alignItems: 'center' }} pointerEvents="none">
        <View style={{ backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', minWidth: 190 }}>
          <Text style={{ color: liveLevel ? '#00C896' : '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 1 }}>
            {liveSlopePct == null
              ? 'HOLD PHONE UPRIGHT'
              : liveLevel ? 'LEVEL ✓' : `${liveSlopePct > 0 ? 'UPHILL' : 'DOWNHILL'} ~${Math.abs(liveSlopePct)}%`}
          </Text>
          <View style={{ marginTop: 8, width: 170, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', left: '50%', width: 1.5, height: 14, backgroundColor: 'rgba(255,255,255,0.55)', top: -4, marginLeft: -0.75 }} />
            <View style={{ position: 'absolute', left: `${50 + Math.max(-45, Math.min(45, (liveSlopePct ?? 0) * 5))}%`, width: 12, height: 12, borderRadius: 6, marginLeft: -6, backgroundColor: slopeColor(liveSlopePct) }} />
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 9, marginTop: 6, fontWeight: '600' }}>estimate · hold steady over the line</Text>
        </View>
      </View>

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
                <Text style={styles.puttResultValue}>{distanceFeet != null ? `~${distanceFeet}` : '—'}</Text>
                {/* 2026-06-14 (audit) — mark the uncalibrated pixel→feet heuristic as an
                    estimate, like SLOPE/READ; it's a rough visual reference, not a measure. */}
                <Text style={styles.puttResultLabel}>FEET (EST)</Text>
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
            {puttRead ? (
              <View style={{ marginTop: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#00C896', backgroundColor: 'rgba(0,200,150,0.12)' }}>
                <Text style={{ color: '#00C896', fontSize: 10, fontWeight: '900', letterSpacing: 1 }}>YOUR READ</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 3 }}>{puttRead}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 9, marginTop: 5 }}>estimate from phone tilt — trust your own read too</Text>
              </View>
            ) : null}
            <TouchableOpacity style={styles.clearBtn} onPress={reset}>
              <Text style={styles.clearBtnText}>Reset</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </>
  );
}

/**
 * Convert a meteorological wind direction (degrees the wind is coming
 * FROM) into a caddie-friendly relative phrase based on the shot bearing.
 * Returns "into you", "with you", "from the right", or "from the left."
 * Falls back to compass cardinals when shot bearing is unknown.
 */
function describeWindDirection(windDeg: number | null, shotBearingDeg: number | null): string {
  if (windDeg == null) return '';
  if (shotBearingDeg == null) {
    // No shot bearing — fall back to plain cardinal.
    const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return `from the ${cardinals[Math.round(((windDeg % 360) + 360) % 360 / 45) % 8]}`;
  }
  // Relative angle: wind FROM minus shot bearing TO. 0 = headwind, 180 = tail.
  let rel = ((windDeg - shotBearingDeg) % 360 + 360) % 360;
  if (rel > 180) rel -= 360; // -180..180 (negative = left of shot, positive = right)
  const abs = Math.abs(rel);
  if (abs <= 30) return 'into you';
  if (abs >= 150) return 'with you';
  return rel > 0 ? 'from the right' : 'from the left';
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
  const styles = useStyles();
  const [tap, setTap] = useState<{ xPx: number; yPx: number; yards: number; approx: boolean } | null>(null);

  if (!geometry || !geometry.tee || !geometry.green) {
    return <View style={styles.canvasWrap}><Text style={styles.empty}>Course geometry isn&apos;t available for this hole.</Text></View>;
  }
  const tee = geometry.tee;
  const green = geometry.green;
  const fix = getLastFix();
  if (!fix) {
    return <View style={styles.canvasWrap}><Text style={styles.empty}>Waiting for GPS — make sure location permission is granted.</Text></View>;
  }
  const axisYards = haversineYards(tee, green);
  // 2026-07-20 (white-screen guard) — `<= 0` misses NaN (NaN <= 0 is false); a non-finite
  // tee/green coordinate would flow into the target-canvas <Circle>/<Line> and crash
  // react-native-svg. `!(axisYards > 0)` rejects NaN/Infinity too.
  if (!(axisYards > 0)) return <View style={styles.canvasWrap}><Text style={styles.empty}>Hole geometry invalid.</Text></View>;

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
    const tapLoc = unprojectFromAxis({ x: tappedYx, y: tappedYy }, tee, green);
    // Fresh GPS read at tap time — getLastFix() at render scope is stale if GPS
    // updated after the component rendered (singleton doesn't trigger re-renders).
    const currentFix = getLastFix();
    if (!currentFix) return;
    const yards = Math.max(1, Math.round(haversineYards(currentFix.location, tapLoc)));
    const approx = (currentFix.accuracy_m ?? 0) > 15;
    setTap({ xPx: locationX, yPx: locationY, yards, approx });
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
      {tap && tap.approx && <Text style={styles.tapResult}>Approximate due to GPS quality.</Text>}
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
  const styles = useStyles();
  const router = useRouter();
  if (!geometry || !geometry.tee || !geometry.green) {
    const playsLike = (actual: number | null): number | null => {
      if (actual == null || !weather) return null;
      const breakdown = playsLikeDistance(actual, weather, shotBearingDeg);
      return Math.abs(breakdown.delta_yards) >= 3 ? breakdown.plays_like_yards : null;
    };
    // Phase 400-followup — explicit message when course geometry is
    // missing or GPS hasn't locked yet, instead of silent "—" placeholders.
    // 'no_geometry' is the painful case: hole exists but golfcourseapi
    // never returned green coordinates. Tell the user, don't pretend.
    //
    // 2026-05-21 — Consolidation 5: when the middle value is non-null
    // under 'no_geometry' it's the scorecard tee→green total — say so
    // explicitly rather than implying live GPS.
    const geometryMsg =
      yards.reason === 'estimated'
        ? '~GPS estimate from the tee — mark the green for exact yardage.'
        : yards.reason === 'no_geometry'
        ? (yards.middle != null
            ? 'Scorecard distance — no live GPS green for this course.'
            : 'Green coordinates unavailable for this course.')
        : yards.reason === 'no_fix'
        ? 'Waiting for GPS fix…'
        : null;
    return (
      <View style={styles.canvasWrap}>
        <View style={styles.standardWrap}>
          <View style={styles.standardRow}>
            <BigCell label="FRONT" value={yards.front} playsLikeValue={playsLike(yards.front)} />
            <View style={styles.standardDivider} />
            <BigCell label="MIDDLE" value={yards.middle} playsLikeValue={playsLike(yards.middle)} emphasis />
            <View style={styles.standardDivider} />
            <BigCell label="BACK" value={yards.back} playsLikeValue={playsLike(yards.back)} />
          </View>
          {geometryMsg && (
            <View style={styles.geometryMsgRow}>
              <Text style={styles.geometryMsgText}>{geometryMsg}</Text>
              {/* 2026-05-21 — Consolidation 5 Part 2: when the course has
                  no live green GPS, surface the Mark Green capture loop
                  here instead of leaving it buried in Settings / Tools.
                  Live yardage after marking is haversine(live → marked),
                  not step-subtraction; persists across rounds via
                  courseGreenOverrides; re-mark overwrites with a fresh
                  one-shot fix. See services/smartFinderService.ts
                  resolveGreenCoords() and app/mark-green.tsx. */}
              {(yards.reason === 'no_geometry' || yards.reason === 'estimated') ? (
                <TouchableOpacity
                  onPress={() => router.push('/mark-green' as never)}
                  style={styles.markGreenBtn}
                  activeOpacity={0.8}
                >
                  <Text style={styles.markGreenBtnText}>Mark this green for live yardages</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
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
  const styles = useStyles();
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
  const styles = useStyles();
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

// 2026-05-26 — Fix CM: themed StyleSheet wrapped in makeStyles(colors)
// + a useStyles() hook so each function component picks it up with one
// line. Dark-theme hex codes pulled from `c` so light mode renders.
function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => makeStyles(colors), [colors]);
}
function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
return StyleSheet.create({
  // SVG mode container
  svgContainer: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  headerBtn: { minWidth: 100 },
  headerBtnText: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  // Phase 406 wave 2 — graceful-landscape SmartFinder. Map / Target /
  // Standard-without-camera modes route through this ScrollView; the
  // maxWidth: 720 + alignSelf: center keeps the content readable on
  // landscape (Fold open inner / phone rotated / tablet) instead of
  // stretching the SVG canvas + F/M/B cells across the wide axis.
  // Camera modes (Standard/Putt) use cameraContainer (flex: 1) which
  // SHOULD fill the wide canvas for the viewfinder, so they're
  // intentionally not maxWidth-capped.
  scroll: { paddingTop: 12, paddingBottom: 32, maxWidth: 720, alignSelf: 'center', width: '100%' },
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

  // Phase 502 — TARGET-mode bottom F/M/B strip.
  targetBottomStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingLeft: 16,
    // 2026-06-25 (Tim) — the capture controls moved OUT of the bottom-right
    // into the upper-right camera zone (see the controls View above), so the
    // strip no longer needs to reserve a right gutter for them. Reclaim the
    // full width with a symmetric inset so the RAW/PLAYS/CLUB/CONF row breathes
    // and the CONF column is fully visible (was clipped to "CO…" behind the
    // PHOTO/VIDEO pill).
    paddingRight: 16,
    paddingTop: 12,
    alignItems: 'stretch',
  },
  targetToLabel: {
    color: '#FFE600',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  targetToLabelMuted: { color: 'rgba(255,230,0,0.85)' },
  targetToYards: { color: '#FFE600', fontSize: 18 },
  // SF-2 — static-distance caption. Mirrors the MapView path's geometryMsgText
  // (amber, 12px, 600) so the "not live" framing reads consistently across the
  // camera + map surfaces; nudged up under the TO TARGET label.
  targetStaticCaption: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginTop: -4,
    marginBottom: 8,
  },
  targetIntelCard: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(5,18,11,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  // 2026-06-13 — the brain read headline (answer-first).
  brainRead: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.14)',
    paddingBottom: 7,
    marginBottom: 7,
  },
  // 2026-06-25 — compact (collapsed) variant: drop the divider since the only
  // thing under it is the single safe-side line, not the full breakdown.
  brainReadCompact: {
    borderBottomWidth: 0,
    paddingBottom: 2,
    marginBottom: 2,
  },
  brainReadHeadline: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  brainReadClub: { color: '#00C896', fontSize: 22, fontWeight: '900', letterSpacing: 0.3 },
  brainReadNums: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  brainReadWhy: { color: 'rgba(255,255,255,0.78)', fontSize: 12, fontWeight: '600', marginTop: 3 },
  brainReadTend: { color: '#F0C030', fontSize: 12, fontWeight: '700', marginTop: 2 },
  brainReadPast: { color: '#7CC0FF', fontSize: 12, fontWeight: '700', marginTop: 2 },
  targetIntelTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  targetIntelMetric: { alignItems: 'center', minWidth: 60 },
  targetIntelLabel: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  targetIntelValue: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  targetIntelValueAccent: { color: '#00C896', fontSize: 14, fontWeight: '900' },
  targetIntelLine: {
    color: '#d1d5db',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  targetIntelPlan: {
    color: '#f3f4f6',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
    fontWeight: '700',
  },
  targetFmbRow: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  targetFmbCol: { alignItems: 'center', minWidth: 70 },
  targetFmbHeader: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  targetFmbHeaderMid: { color: '#00C896', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  targetFmbValue: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.4, marginTop: 2 },
  targetFmbValueMid: { color: '#00C896', fontSize: 20, fontWeight: '900', letterSpacing: 0.4, marginTop: 2 },

  // Bottom panel (camera modes)
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(6,15,9,0.85)',
    paddingTop: 18, paddingHorizontal: 24, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
  },
  instructionText: { color: 'rgba(255,255,255,0.85)', fontSize: 15, textAlign: 'center', paddingBottom: 10 },
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
  permBtnText: { color: c.background, fontSize: 16, fontWeight: '800' },
  backLink: { marginTop: 20 },
  backLinkText: { color: '#6b7280', fontSize: 14 },

  // SVG mode standard fallback
  standardWrap: {
    paddingHorizontal: 16, paddingVertical: 18, alignItems: 'center',
    backgroundColor: 'rgba(13, 36, 24, 0.92)',
    borderRadius: 14, borderWidth: 1.5, borderColor: '#F5A623',
    marginHorizontal: 12, marginTop: 12,
    shadowColor: '#F5A623', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
  },
  // Single-row layout: FRONT | MIDDLE (big) | BACK — divided by thin lines.
  // Tabular-nums + minWidth keeps spacing rock-steady as values change.
  standardRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between', gap: 0,
    width: '100%', maxWidth: 360,
  },
  bigCell: {
    alignItems: 'center',
    flex: 1, minWidth: 0,
    paddingHorizontal: 6,
  },
  standardDivider: { width: 1, height: 40, backgroundColor: c.border },
  bigValue: { color: '#e8f5e9', fontSize: 32, fontWeight: '900', fontVariant: ['tabular-nums'] },
  bigValueEmphasis: { color: '#ffffff', fontSize: 56 },
  bigLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginTop: 4 },
  playsLike: { color: '#F5A623', fontSize: 12, fontWeight: '700', marginTop: 2 },

  canvasWrap: { paddingHorizontal: 16, paddingTop: 12, alignItems: 'center' },
  canvasHint: { color: '#9ca3af', fontSize: 12, marginBottom: 8 },
  tapResult: { color: '#ffffff', fontSize: 16, fontWeight: '800', marginTop: 12 },
  hazardList: { marginTop: 24, alignSelf: 'stretch', paddingHorizontal: 16 },
  hazardHeading: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 8 },
  hazardItem: { color: '#9ca3af', fontSize: 13, lineHeight: 19 },
  geometryMsgRow: { marginTop: 16, alignSelf: 'stretch', alignItems: 'center', paddingHorizontal: 16 },
  geometryMsgText: { color: '#fbbf24', fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textAlign: 'center' },
  markGreenBtn: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#00C896',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#003d20',
  },
  markGreenBtnText: { color: c.background, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },

  holeNav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 24,
  },
  holeBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: '#00C896' },
  holeBtnDisabled: { borderColor: c.border },
  holeBtnText: { color: '#00C896', fontSize: 13, fontWeight: '700' },
  holeBtnTextDisabled: { color: '#374151' },
  holeNavLabel: { color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: 1.2 },
  // 2026-05-22 — Refresh GPS button. Blue accent to differentiate from
  // the green hole-nav pills above; full-width, generous touch target.
  refreshGpsBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#5DADE2',
    backgroundColor: 'rgba(93,173,226,0.10)',
    alignItems: 'center',
  },
  refreshGpsBtnText: {
    color: '#5DADE2',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  pickerScrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
  },
  pickerCard: {
    backgroundColor: c.surface_elevated, borderRadius: 14, borderWidth: 1, borderColor: c.border,
    padding: 16, width: '100%', maxWidth: 480,
  },
  pickerTitle: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 12, textAlign: 'center' },
  pickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  pickerBtn: {
    backgroundColor: '#0a1e12', borderWidth: 1, borderColor: c.border, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerBtnActive: { backgroundColor: '#003d20', borderColor: '#00C896' },
  pickerBtnText: { color: '#9ca3af', fontSize: 18, fontWeight: '800' },
  pickerBtnTextActive: { color: '#00C896' },
  pickerCloseBtn: {
    marginTop: 16, paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
  },
  pickerCloseText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
});
}

// 2026-06-23 (Tim) — SmartMotion SETUP-TOOLS-style pop-out for the SmartFinder
// right-side controls. Themed green-on-dark, icon + title + description rows.
const sfStyles = StyleSheet.create({
  toolsCard: {
    width: 248,
    backgroundColor: 'rgba(8,20,12,0.96)',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(136,247,0,0.45)',
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  toolsHeader: {
    color: '#9ca3af', fontSize: 11, fontWeight: '800', letterSpacing: 1.2,
    paddingHorizontal: 8, paddingTop: 4, paddingBottom: 6,
  },
  toolRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 9, paddingHorizontal: 8, borderRadius: 12,
  },
  toolIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(136,247,0,0.55)',
    backgroundColor: 'rgba(136,247,0,0.10)',
  },
  toolTitle: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  toolDesc: { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginTop: 1 },
  // 2026-06-25 — thin separator between the read/lock tools and the capture rows.
  toolDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 4,
    marginHorizontal: 8,
  },
});
