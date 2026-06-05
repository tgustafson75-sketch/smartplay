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
  ActivityIndicator,
  AppState,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Circle, Line, Rect, Text as SvgText, Path } from 'react-native-svg';
import { safeBack } from '../services/safeBack';
import { useRouter } from 'expo-router';
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
import { refreshGpsAndReconcile } from '../services/refreshGpsAction';
import { haversineYards, projectToAxis } from '../utils/geoDistance';
import { computeDistance, buildLock } from '../services/rangefinder';
import GPSQuality from '../components/smartfinder/GPSQuality';
import SmartFinderModeToggle from '../components/smartfinder/SmartFinderModeToggle';
import TargetingOverlay from '../components/smartfinder/TargetingOverlay';
import { useCurrentWeather } from '../hooks/useCurrentWeather';
import { playsLikeDistance } from '../utils/playsLike';
import type { WeatherSnapshot } from '../services/weatherService';
import { useSettingsStore } from '../store/settingsStore';
import { useTrustLevelStore } from '../store/trustLevelStore';
import { speak } from '../services/voiceService';
// 2026-05-27 — Fix EP: SmartFinder "Send to Tank" icon. Routes to
// Library so the user picks the swing video to send (SmartFinder
// itself has no video — the icon launches the share flow).
import { isSendToTankAvailable } from '../services/tankReview';
import { Ionicons } from '@expo/vector-icons';
// 2026-05-27 — Fix EQ: toast feedback for capture results.
import { useToastStore } from '../store/toastStore';

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
      const fix = await refreshFix();
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
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
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
  const isCameraMode = mode === 'standard' || mode === 'putt' || mode === 'target';

  if (isCameraMode) {
    return (
      <CameraSmartFinder
        mode={mode}
        currentHole={currentHole}
        gps={gps}
        yards={yards}
        onModeChange={setMode}
        onClose={() => safeBack()}
        height={height}
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

      <SmartFinderModeToggle mode={mode} onChange={setMode} />

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

// ─── Camera-mode wrapper (Standard + Putt) ────────────────────────────────────

/**
 * Continuous zoom via two-finger pinch. expo-camera's `zoom` prop is 0..1
 * where 0 ≈ native 1× and 1 ≈ the device's max zoom (varies by phone —
 * Z Fold reports 30× at the top, most flagship Androids 10–20×, base
 * phones 8×).
 *
 * 2026-05-18 — replaced the previous ZOOM_STOPS index + ± buttons with
 * pinch-to-zoom (matches native camera apps). Labels are cosmetic and
 * approximate the visual zoom factor at each `zoom` value; tuned for
 * Z Fold but should read sensibly on any device.
 */
// 2026-05-24 — Bumped from 0.4 → 1.0 (native camera ratio). User reported
// "I can't zoom" on Z Fold — at 0.4 sensitivity a 3.5x finger spread was
// needed to reach max zoom (zoom=1.0), which is well outside ergonomic
// pinch range. 1.0 means a 2x finger spread covers the full range, same
// as the stock Android camera app.
const PINCH_SENSITIVITY = 1.0;

function zoomLabelFor(zoom: number): string {
  // Approximate visible zoom factor across the 0..1 range. expo-camera
  // maps zoom=1 to the device's reported max — Z Fold ≈ 30×, most
  // flagships 10–20×, base phones 8×. Anchors extend to 30× at the top
  // so the label tracks Z Fold's actual reach; on lower-max devices the
  // label still reads sensibly because the device's hardware caps the
  // visible result regardless of the label.
  const anchors: [number, number][] = [
    [0.00,  1], [0.10,  2], [0.20,  3], [0.30,  5],
    [0.45,  8], [0.60, 12], [0.80, 20], [1.00, 30],
  ];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [z0, x0] = anchors[i];
    const [z1, x1] = anchors[i + 1];
    if (zoom <= z1) {
      const t = (zoom - z0) / (z1 - z0);
      const x = x0 + t * (x1 - x0);
      return `${x.toFixed(1)}x`;
    }
  }
  return '30.0x';
}

function CameraSmartFinder({
  mode, currentHole, gps, yards, onModeChange, onClose, height,
}: {
  mode: SmartFinderMode;
  currentHole: number;
  gps: GPSQualityReading;
  yards: GreenYardages;
  onModeChange: (m: SmartFinderMode) => void;
  onClose: () => void;
  height: number;
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
  // AND its events were swallowed by the StandardCameraOverlay's
  // full-screen TouchableOpacity for tap-to-lock. The new API composes
  // pinch (multi-touch) with the existing tap (single-touch) without
  // a conflict because they're handled at different finger counts.
  const [zoom, setZoom] = useState(0);
  const baseZoomRef = useRef(0);
  const zoomLabel = zoomLabelFor(zoom);
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

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      setLocationGranted(status === 'granted');
    });
  }, []);

  // AppState refresh — on foreground, re-check camera permission so
  // returning from Settings unblocks the screen automatically.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') { void requestCameraPermission(); }
    });
    return () => sub.remove();
  }, [requestCameraPermission]);

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

          {mode === 'standard' ? (
            <StandardCameraOverlay
              locationGranted={locationGranted}
              height={height}
              zoomLabel={zoomLabel}
              yards={yards}
            />
          ) : mode === 'target' ? (
            <TargetCameraOverlay yards={yards} locked={locked} />
          ) : (
            <PuttCameraOverlay locationGranted={locationGranted} />
          )}
        </View>
      </GestureDetector>

      {/* 2026-05-27 — Fix EQ: Lock + Capture floating controls.
          Sit OUTSIDE the GestureDetector + overlay tree so they're
          always tappable regardless of the target-overlay touch
          capture. Position bottom-right above the F/M/B strip.
          Lock toggle: only renders in target mode (where the reticle
          actually moves). Capture button: always available, snaps a
          single photo with the full overlay composited via screen
          capture-ish flow (takePictureAsync gets the live camera
          frame; we don't bake overlays into the photo today — that
          needs view-shot for the SVG layer. v1 = raw photo). */}
      <View
        style={{ position: 'absolute', right: 16, bottom: insets.bottom + 110, gap: 12, alignItems: 'center' }}
        pointerEvents="box-none"
      >
        {mode === 'target' && (
          <TouchableOpacity
            onPress={() => setLocked(v => !v)}
            accessibilityRole="button"
            accessibilityLabel={locked ? 'Unlock target' : 'Lock target'}
            style={{
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: locked ? '#F0C030' : 'rgba(0,0,0,0.55)',
              borderWidth: 1.5, borderColor: '#F0C030',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name={locked ? 'lock-closed' : 'lock-open'} size={20} color={locked ? '#0d1a0d' : '#F0C030'} />
          </TouchableOpacity>
        )}
        {/* Mode toggle pill — photo / video. Sits above the capture
            button so it's easy to switch before pressing record.
            Switching mode mid-recording is disabled (would invalidate
            the in-flight recordAsync). */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: 'rgba(0,0,0,0.55)',
            borderRadius: 14,
            padding: 2,
            opacity: recording ? 0.5 : 1,
          }}
          pointerEvents={recording ? 'none' : 'auto'}
        >
          {(['picture', 'video'] as const).map(m => (
            <TouchableOpacity
              key={m}
              onPress={() => setCaptureMode(m)}
              accessibilityRole="button"
              accessibilityLabel={m === 'picture' ? 'Switch to photo' : 'Switch to video'}
              style={{
                paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
                backgroundColor: captureMode === m ? '#ffffff' : 'transparent',
              }}
            >
              <Text style={{
                fontSize: 10, fontWeight: '800', letterSpacing: 0.8,
                color: captureMode === m ? '#0d1a0d' : '#ffffff',
              }}>{m === 'picture' ? 'PHOTO' : 'VIDEO'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          onPress={async () => {
            if (capturing) return;
            if (!cameraRef.current) return;
            // 2026-05-27 — Fix EV: split path on captureMode.
            if (captureMode === 'video') {
              if (recording) {
                // Second tap on the recording button = stop. recordAsync
                // resolves with the file URI; the running promise
                // captured below handles the share.
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
                // recordAsync resolves when stopRecording is called or
                // maxDuration hits. 60s cap so a forgotten tap doesn't
                // fill the device.
                const result = await cameraRef.current.recordAsync({ maxDuration: 60 });
                setRecording(false);
                if (result?.uri) {
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
          }}
          accessibilityRole="button"
          accessibilityLabel={
            captureMode === 'video'
              ? (recording ? 'Stop video recording' : 'Start video recording')
              : 'Take photo'
          }
          style={{
            width: 60, height: 60, borderRadius: 30,
            backgroundColor: recording ? '#ef4444' : '#ffffff',
            borderWidth: 3, borderColor: recording ? '#ffffff' : 'rgba(0,0,0,0.4)',
            alignItems: 'center', justifyContent: 'center',
            opacity: capturing ? 0.5 : 1,
          }}
        >
          <Ionicons
            name={captureMode === 'video' ? (recording ? 'stop' : 'videocam') : 'camera'}
            size={26}
            color={recording ? '#ffffff' : '#0d1a0d'}
          />
        </TouchableOpacity>
      </View>

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
    </GestureHandlerRootView>
  );
}

// ─── Standard mode (camera AR, tilt-based distance lock) ─────────────────────

function StandardCameraOverlay({
  locationGranted, height, zoomLabel, yards,
}: {
  locationGranted: boolean;
  height: number;
  zoomLabel: string;
  yards: GreenYardages;
}) {
  const styles = useStyles();
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
    // Phase AH — wrap the whole measure path so any rejection (GPS hang,
    // math edge case, store mutation throw) surfaces a user-readable
    // alert instead of an unhandled promise rejection that crashes the
    // RN bridge or shows a red-screen toast in dev.
    try {
      // Race getCurrentPositionAsync against an 8s timeout so a hung GPS
      // call doesn't leave the user staring at nothing.
      let position: Location.LocationObject;
      try {
        position = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          new Promise<Location.LocationObject>((_, reject) =>
            setTimeout(() => reject(new Error('gps_timeout')), 8000),
          ),
        ]);
      } catch (gpsErr) {
        const msg = gpsErr instanceof Error ? gpsErr.message : String(gpsErr);
        if (msg === 'gps_timeout') {
          Alert.alert('GPS taking too long', "Couldn't get a fresh position in 8 seconds. Step into open sky and try again.");
        } else {
          Alert.alert('GPS unavailable', 'Could not get your position. Try moving to open sky.');
        }
        return;
      }
      const tapY = event.nativeEvent.locationY;
      const tapYNorm = Math.max(0, Math.min(1, tapY / height));
      const userPos = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy ?? 10,
      };
      // Defensive: nonsense lat/lng (the 0,0 case Tim hit) → clear msg
      if (Math.abs(userPos.lat) < 0.01 && Math.abs(userPos.lng) < 0.01) {
        Alert.alert("Couldn't measure", 'GPS position not ready yet. Wait a moment and try again.');
        return;
      }
      const result = computeDistance({
        user_position: userPos,
        compass_heading: headingRef.current,
        tap_y_normalized: tapYNorm,
        device_pitch_degrees: pitchRef.current,
      });
      // 2026-05-19 — when the phone is held near-level, the tilt math
      // can't compute distance. Previously the rangefinder stubbed 250yd
      // and the user saw it as a real lock. Now: surface the limit and
      // point them at a tool that actually works for far targets.
      if (result.unmeasurable) {
        Alert.alert(
          "Can't measure this target",
          "Tilt the phone DOWN at the ground in front of the target, OR switch to TARGET mode for far targets (uses GPS).",
        );
        return;
      }
      const newLock = buildLock({
        user_position: userPos,
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
    } catch (err) {
      // Phase AH catch-all — never let a measure rejection escape unhandled.
      const msg = err instanceof Error ? err.message : String(err);
      console.log('[smartfinder] measure error:', msg);
      Alert.alert("Couldn't measure", 'Something went wrong reading the tap. Try again, or check your GPS signal.');
    }
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

      {/* Phase 502 — reticle with corner brackets ported from V3's
          TargetingOverlay. The 4 L-shaped brackets frame the crosshair
          so the target "lock" feels tactile and intentional, not a
          floating dot. Same yellow accent palette throughout. */}
      <View style={styles.reticleContainer} pointerEvents="none">
        <View style={styles.reticleFrame}>
          <View style={styles.reticleH} />
          <View style={styles.reticleV} />
          <View style={styles.reticleCenterDot} />
          <View style={[styles.reticleBracket, styles.reticleBracketTL]} />
          <View style={[styles.reticleBracket, styles.reticleBracketTR]} />
          <View style={[styles.reticleBracket, styles.reticleBracketBL]} />
          <View style={[styles.reticleBracket, styles.reticleBracketBR]} />
        </View>
      </View>

      {/* 2026-05-18 — Zoom is now pinch-driven (two-finger gesture on
          the camera surface). The ± buttons + dot row were removed
          per Tim's request — feels more like a real rangefinder /
          native camera app. The readout label is kept so the user
          knows the current magnification at a glance. */}
      <View pointerEvents="none" style={[styles.zoomCol, { top: insets.top + 130 }]}>
        <Text style={styles.zoomLabel}>{zoomLabel}</Text>
      </View>

      {/* Bottom panel — legacy v2 layout: locked badge + big yardage row,
           "club · commit to the shot" yellow-bordered pill, big shutter
           capture button.
           2026-05-18 — F/M/B reference strip added above the lock /
           instruction text so the user always sees GPS yardages to
           the green, whether or not they've locked a target. Mirrors
           the Target mode strip. */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        <View style={styles.fmbStrip}>
          <View style={styles.fmbItem}>
            <Text style={styles.fmbLabel}>F</Text>
            <Text style={styles.fmbValue}>{yards.front ?? '—'}</Text>
          </View>
          <View style={styles.fmbDivider} />
          <View style={styles.fmbItem}>
            <Text style={styles.fmbLabel}>M</Text>
            <Text style={[styles.fmbValue, styles.fmbValueAccent]}>{yards.middle ?? '—'}</Text>
          </View>
          <View style={styles.fmbDivider} />
          <View style={styles.fmbItem}>
            <Text style={styles.fmbLabel}>B</Text>
            <Text style={styles.fmbValue}>{yards.back ?? '—'}</Text>
          </View>
        </View>

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

// ─── Target mode (camera + draggable target reticle + F/M/B strip) ──────────
//
// Phase 502 port from V3. The user drags the yellow corner-bracket reticle
// across the screen; yardage updates live based on the F/M/B yardages.
// Bottom strip shows TO TARGET <yds> with Front / Middle / Back of green
// distances. Replaces the old top-down flat-canvas TargetView.

function TargetCameraOverlay({ yards, locked }: { yards: GreenYardages; locked?: boolean }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [targetYards, setTargetYards] = useState<number | null>(yards.middle);

  return (
    <View style={StyleSheet.absoluteFill}>
      <TargetingOverlay
        gpsDistances={{ front: yards.front, middle: yards.middle, back: yards.back }}
        baseYardage={yards.middle}
        onTargetDistance={(v) => setTargetYards(v)}
        locked={locked}
      />

      {/* Bottom F/M/B strip — port of V3's TO TARGET row. */}
      <View
        style={[styles.targetBottomStrip, { paddingBottom: insets.bottom + 16 }]}
        pointerEvents="none"
      >
        {targetYards != null && (
          <Text style={styles.targetToLabel}>
            <Text style={styles.targetToLabelMuted}>⊕ TO TARGET </Text>
            <Text style={styles.targetToYards}>{targetYards}</Text>
            <Text style={styles.targetToLabelMuted}> yds</Text>
          </Text>
        )}
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

function PuttCameraOverlay({ locationGranted: _locationGranted }: { locationGranted: boolean }) {
  const styles = useStyles();
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
      yards.reason === 'no_geometry'
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
              {yards.reason === 'no_geometry' ? (
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

  // Reticle
  reticleContainer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  // Phase 502 — 80px frame matches V3's CROSS_SIZE so corner brackets
  // sit at the outer edges of the reticle area.
  reticleFrame: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  reticleH: { position: 'absolute', width: 60, height: 1.5, backgroundColor: 'rgba(245,166,35,0.7)' },
  reticleV: { position: 'absolute', width: 1.5, height: 60, backgroundColor: 'rgba(245,166,35,0.7)' },
  reticleCenterDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: '#F5A623' },
  reticleBracket: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: '#F5A623',
  },
  reticleBracketTL: { top: 0, left: 0, borderTopWidth: 2.5, borderLeftWidth: 2.5 },
  reticleBracketTR: { top: 0, right: 0, borderTopWidth: 2.5, borderRightWidth: 2.5 },
  reticleBracketBL: { bottom: 0, left: 0, borderBottomWidth: 2.5, borderLeftWidth: 2.5 },
  reticleBracketBR: { bottom: 0, right: 0, borderBottomWidth: 2.5, borderRightWidth: 2.5 },
  // Phase 502 — TARGET-mode bottom F/M/B strip.
  targetBottomStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingHorizontal: 16,
    paddingTop: 12,
    alignItems: 'center',
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
  targetFmbRow: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  targetFmbCol: { alignItems: 'center', minWidth: 70 },
  targetFmbHeader: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  targetFmbHeaderMid: { color: '#00C896', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  targetFmbValue: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.4, marginTop: 2 },
  targetFmbValueMid: { color: '#00C896', fontSize: 20, fontWeight: '900', letterSpacing: 0.4, marginTop: 2 },

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
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  zoomDotBgDisabled: { opacity: 0.35 },
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
  // 2026-05-18 — F/M/B strip used in Standard mode's bottom panel.
  fmbStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 4,
    paddingBottom: 10,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  fmbItem: { flex: 1, alignItems: 'center' },
  fmbLabel: { color: '#9ca3af', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 2 },
  fmbValue: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  fmbValueAccent: { color: '#00C896' },
  fmbDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.15)' },
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
