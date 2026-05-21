/**
 * Cage Mode — dedicated practice + lesson environment.
 *
 * 2026-05-21 — Day 2 / Fix 9B: file renamed from cage-drill.tsx to
 * cage-mode.tsx + given a clear Cage Mode identity. SmartMotion (quick
 * swing check) and Cage Mode (full practice/lesson tool) are now two
 * distinct features with zero overlap. Cage Mode keeps all six
 * cage-specific capabilities: bullseye-in-frame gate, ball-speed
 * detection, cage calibration store, Galaxy Watch IMU integration,
 * cage-specific analysis APIs (analyzeCageVideo + coachReview), and
 * the CageOverlay framing component. Works in a cage OR on the range.
 *
 * Behaviour is byte-identical to the prior cage-drill flow EXCEPT for
 * the ported batch-count selector (see below) — no other capability
 * changes vs the file prior to rename.
 *
 * Batch-count (1 / 3 / 5 / 10) ported in from the deleted
 * smartmotion-quick.tsx. Lets the player set a session length before
 * starting; after each RESULT the screen auto-returns to SETUP for the
 * next swing until the batch is complete. The voice "ready" wake-word
 * loop was NOT ported — Cage Mode already subscribes to the 'swing'
 * voice capture kind (see subscribeCapture below) so saying "record" /
 * "capture" / "start" hands-free fires the same handler the button
 * does. Wake-word loop would have been redundant.
 *
 * State machine:
 *   SETUP → CHECKING → READY | NOT_READY
 *                    └ NOT_READY auto-reverts to SETUP after 2s
 *           READY → RECORDING (12s) → UPLOADING → RESULT | ERROR
 *           ERROR → "Try Again" → SETUP
 *           RESULT → "Swing Again" → SETUP  (auto if batch incomplete)
 *
 * Capture: 1080p / 30fps / audio / single .mp4 in FileSystem.cacheDirectory.
 * Auto-stop at 12s OR on user stop tap.
 *
 * Bullseye visibility check is the gate before recording can start. The
 * still-frame upload to /api/cage/check-bullseye decides READY vs NOT_READY.
 *
 * Kevin badge (top-left, taps to listening) and ••• menu (top-right) stay
 * visible at all times so the player can pull Kevin in or exit cleanly.
 *
 * Layout adapts to Z Fold open / closed via useWindowDimensions aspect ratio.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Modal, ScrollView, Image, useWindowDimensions, Animated, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  checkBullseye,
  analyzeCageVideo,
  coachReview,
  isMockMode,
  type CageAnalyzeResponse,
  type CoachReviewResponse,
} from '../../services/cageApi';
import { toggle as toggleListening } from '../../services/listeningSession';
import { safeBack } from '../../services/safeBack';
import { useSettingsStore } from '../../store/settingsStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';
import { getCaddieName } from '../../lib/persona';
import CageOverlay, { type CageOverlayPhase } from '../../components/swinglab/CageOverlay';
import { setActiveSurface } from '../../services/activeSurfaceRegistry';
import { subscribeCapture } from '../../services/mediaCapture';
import { useWatchStore, type SwingMetrics } from '../../store/watchStore';
import {
  startImpactRecording,
  stopAndDetectImpact,
  abortImpactRecording,
  cleanupImpactRecording,
  type ImpactReading,
} from '../../services/acousticImpactDetector';
import { detectBallSpeed, type BallSpeedResult } from '../../services/acousticDetectApi';
import { useCageCalibrationStore } from '../../store/cageCalibrationStore';
// 2026-05-21 — Fix A: shared CaddieMicBadge for consistent
// tap-to-talk affordance (ring + halo + mic-icon overlay).
import { CaddieMicBadge } from '../../components/caddie/CaddieMicBadge';

type Phase =
  | 'SETUP'
  | 'CHECKING'
  | 'READY'
  | 'NOT_READY'
  | 'RECORDING'
  | 'UPLOADING'
  | 'RESULT'
  | 'ERROR';

const RECORDING_MAX_SECONDS = 12;

const KEVIN_CAPTION: Partial<Record<Phase, string>> = {
  SETUP:     'Position your camera so the bullseye is in the frame.',
  CHECKING:  'Looking for the target…',
  READY:     'Locked in. Ready when you are.',
  NOT_READY: "I can't see the target. Step left a bit.",
  RECORDING: 'Swing when ready.',
  UPLOADING: 'Lemme take a look at that one…',
  RESULT:    "Here's what I saw.",
  ERROR:     'Something went sideways on my end.',
};

const CONFIDENCE_DOT: Record<CoachReviewResponse['confidence'], string> = {
  high:   '#00C896',
  medium: '#fbbf24',
  low:    '#9ca3af',
};

export default function CageModeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  // Phase BI — Fold-open detection via width threshold (not aspect ratio).
  // Z Fold open W ≈ 673; closed W ≈ 412; standard phone W ≈ 390. The prior
  // `aspect < 1.5` heuristic mis-fired in portrait-locked mode (Fold open
  // portrait aspect ≈ 3.28, which is > 1.5) so the wide-caption branch
  // never engaged on the device class it was written for.
  const isFoldOpen = W >= 540;

  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordCountdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notReadyRevertRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [phase, setPhase] = useState<Phase>('SETUP');
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<CageAnalyzeResponse | null>(null);
  const [coach, setCoach] = useState<CoachReviewResponse | null>(null);
  // Watch metrics for THIS capture — populated after stopRecording if
  // the watchStore recorded a swing within the recording window.
  const [watchSwing, setWatchSwing] = useState<SwingMetrics | null>(null);
  // Connection status — surfaces "no watch" hint in the result card so
  // users know the section is empty by design, not broken.
  const watchConnected = useWatchStore((s) => s.isConnected);
  // Timestamp captured at the moment recording starts. Used to filter
  // watchStore.sessionSwings to ONLY the swing that happened during
  // this video capture. Set in startRecording, read in stopRecording.
  const recordingStartedAtRef = useRef<number | null>(null);
  // Acoustic impact detector result for this capture.
  const [impactReading, setImpactReading] = useState<ImpactReading | null>(null);
  // Server-detected acoustic result (cage distance + ball-speed estimate).
  // Lands asynchronously after the on-device impact detector returns.
  const [ballSpeed, setBallSpeed] = useState<BallSpeedResult | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // 2026-05-21 — Day 2 / Fix 9B: batch-count selector ported in from
  // the deleted smartmotion-quick.tsx. batchSize is the planned session
  // length (1 / 3 / 5 / 10 swings); batchIdx is the index of the
  // currently-completing swing (0-based). After each RESULT, if
  // batchIdx + 1 < batchSize we auto-return to SETUP for the next
  // swing. User can still tap "Swing Again" to advance manually or
  // abandon the batch.
  type BatchSize = 1 | 3 | 5 | 10;
  const BATCH_OPTIONS: BatchSize[] = [1, 3, 5, 10];
  const [batchSize, setBatchSize] = useState<BatchSize>(1);
  const [batchIdx, setBatchIdx] = useState(0);
  const batchActive = batchSize > 1;
  const batchComplete = batchIdx + 1 >= batchSize;

  const { voiceEnabled, voiceGender, language, caddiePersonality } = useSettingsStore();
  const caddieName = getCaddieName(caddiePersonality);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // ── Permissions ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!camPerm?.granted) void requestCamPerm();
    if (!micPerm?.granted) void requestMicPerm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 105 — register drills surface so caddieResolver routes the
  // drills-pillar caddie (Serena by default).
  useEffect(() => {
    setActiveSurface('drill_session');
    return () => { setActiveSurface(null); };
  }, []);

  // PGA HOPE follow-up (A4) — single-handed players cannot reach the
  // bottom-right record button while holding the camera. Subscribe to
  // 'swing' kind voice captures so saying "record" / "capture" / "start"
  // triggers the same handler the button does. Only fires while phase
  // is READY (don't double-trigger mid-recording).
  useEffect(() => {
    let cancelled = false;
    const unsub = subscribeCapture(['swing'], () => {
      if (cancelled) return;
      // Race-safe: only trigger if we're in the phase that allows it.
      // The button uses phase === 'READY' as its guard; mirror that.
      if (phase === 'READY') {
        void handleStartRecording();
      }
    });
    return () => { cancelled = true; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Cleanup on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recordCountdownRef.current) clearTimeout(recordCountdownRef.current);
      if (notReadyRevertRef.current) clearTimeout(notReadyRevertRef.current);
    };
  }, []);

  // ── NOT_READY auto-revert to SETUP after 2s ─────────────────────────
  useEffect(() => {
    if (phase !== 'NOT_READY') return;
    if (notReadyRevertRef.current) clearTimeout(notReadyRevertRef.current);
    notReadyRevertRef.current = setTimeout(() => setPhase('SETUP'), 2000);
    return () => {
      if (notReadyRevertRef.current) {
        clearTimeout(notReadyRevertRef.current);
        notReadyRevertRef.current = null;
      }
    };
  }, [phase]);

  // ── State transitions ───────────────────────────────────────────────

  const handleCheckPosition = useCallback(async () => {
    if (!cameraRef.current) return;
    console.log('[path3:cage] check_position requested');
    setPhase('CHECKING');
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5, base64: true, skipProcessing: true,
      });
      const b64 = photo?.base64 ?? '';
      if (!b64) {
        setErrorMessage('Could not capture preview frame.');
        setPhase('ERROR');
        return;
      }
      const res = await checkBullseye(b64);
      if (res.kind !== 'ok') {
        setErrorMessage(res.kind === 'no_network' ? 'No network. Try again.' : res.message);
        setPhase('ERROR');
        return;
      }
      if (res.data.detected && res.data.canvas_visible) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPhase('READY');
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setPhase('NOT_READY');
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('ERROR');
    }
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (!cameraRef.current) return;
    // Audit fix — double-tap guard. If a recording promise is already
    // in flight (rapid tap before the first state flush), bail. The
    // phase check covers the same case via React state.
    if (recordingPromiseRef.current) return;
    // Audit fix — mic permission gate. recordAsync silently produces
    // a videoless / audioless file when mic isn't granted; surface it
    // as a recoverable alert instead of a confusing capture failure.
    if (!micPerm?.granted) {
      const r = await requestMicPerm();
      if (!r.granted) {
        Alert.alert(
          'Microphone needed',
          'Cage Drill records audio to detect strikes. Allow microphone access to record.',
        );
        return;
      }
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setRecordedSeconds(0);
    setPhase('RECORDING');
    // Reset any previous watch swing + impact reading + ball speed.
    setWatchSwing(null);
    setImpactReading(null);
    setBallSpeed(null);

    // Tick countdown
    const startedAt = Date.now();
    // Capture the recording-start timestamp so we can later filter
    // watchStore.sessionSwings to swings that happened DURING this
    // capture window (recording-start → analyze-complete).
    recordingStartedAtRef.current = startedAt;

    // Phase J.1 — kick off the parallel audio recording for acoustic
    // impact detection. Fire-and-forget; if it fails (denied mic,
    // device busy) we silently skip detection. The video record below
    // already has its own mic permission gate so this won't double-prompt.
    void startImpactRecording().catch(() => undefined);
    recordTimerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      setRecordedSeconds(s);
    }, 100);

    // Auto-stop at 12s
    recordCountdownRef.current = setTimeout(() => {
      void stopRecordingAndUpload();
    }, RECORDING_MAX_SECONDS * 1000);

    try {
      // expo-camera v17: recordAsync resolves with { uri } when stopped.
      recordingPromiseRef.current = cameraRef.current.recordAsync({
        maxDuration: RECORDING_MAX_SECONDS,
      }) as Promise<{ uri: string } | undefined>;
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('ERROR');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micPerm, requestMicPerm]);

  const stopRecordingAndUpload = useCallback(async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (recordCountdownRef.current) {
      clearTimeout(recordCountdownRef.current);
      recordCountdownRef.current = null;
    }

    // Audit fix — stop the recording WHILE the camera is still mounted.
    // Switching to UPLOADING below removes the CameraView from the tree
    // (cameraVisible is false for UPLOADING). Calling stopRecording after
    // unmount would no-op against a null ref and the recordAsync promise
    // could hang or reject. Stop synchronously, then transition.
    try { cameraRef.current?.stopRecording(); } catch {}

    // Phase J.1 — stop the parallel audio recording and run peak
    // detection. Fire in parallel with the video upload below so this
    // ~50ms work doesn't block the user from seeing UPLOADING state.
    // J.2 hybrid: when on-device impact is found, ALSO POST the WAV to
    // /api/acoustic-detect for server-side two-peak ball speed.
    void stopAndDetectImpact()
      .then(async (reading) => {
        if (!reading) return;
        setImpactReading(reading);
        if (reading.audio_uri) {
          const speed = await detectBallSpeed({
            audioUri: reading.audio_uri,
            impact_ms: reading.impact_ms,
          });
          if (speed) {
            setBallSpeed(speed);
            // Persist the server-derived cage distance so camera-setup
            // can surface it (and the user can override if it's off).
            useCageCalibrationStore.getState().setAutoDetected(speed.cage_distance_yards);
          }
          void cleanupImpactRecording(reading.audio_uri);
        }
      })
      .catch(() => undefined);

    setPhase('UPLOADING');

    try {
      const recorded = await recordingPromiseRef.current;
      recordingPromiseRef.current = null;
      const sourceUri = recorded?.uri;
      if (!sourceUri) {
        setErrorMessage('Recording produced no file.');
        setPhase('ERROR');
        return;
      }

      // Move to a stable cache path so the camera's temp file doesn't
      // get evicted before upload completes.
      const cacheDir = FileSystem.cacheDirectory ?? '';
      const cachedUri = `${cacheDir}cage_drill_${Date.now()}.mp4`;
      try {
        await FileSystem.copyAsync({ from: sourceUri, to: cachedUri });
      } catch {
        // Fall through with the original uri if copy fails.
      }
      const uploadUri = (await FileSystem.getInfoAsync(cachedUri)).exists ? cachedUri : sourceUri;

      const res = await analyzeCageVideo(uploadUri);

      // Best-effort delete of the local cache file regardless of outcome.
      try { await FileSystem.deleteAsync(cachedUri, { idempotent: true }); } catch {}

      if (res.kind !== 'ok') {
        setErrorMessage(res.kind === 'no_network' ? 'Upload failed — no network. Try again.' : res.message);
        setPhase('ERROR');
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(res.data);

      // Wire watch metrics. If the connected watch recorded a swing
      // during the capture window (recording start → now), attach it to
      // the result so the user sees video analysis + watch tempo/club
      // speed side by side. No-op when no watch connected; harmless if
      // the watch recorded for a different drill.
      const startedAt = recordingStartedAtRef.current ?? 0;
      const endedAt = Date.now();
      const watchSwings = useWatchStore.getState().sessionSwings;
      const matched = [...watchSwings]
        .reverse()
        .find((s) => s.timestamp >= startedAt && s.timestamp <= endedAt + 2000);
      if (matched) setWatchSwing(matched);

      // Hand features.json to Kevin's cage_swing_review tool. The coach
      // response replaces the raw-JSON display from Prompt 1; the JSON is
      // still available behind a 'Show details' expander.
      const coachRes = await coachReview(res.data, voiceGender);
      if (coachRes.kind === 'ok') {
        setCoach(coachRes.data);
        if (voiceEnabled) {
          void (async () => {
            await configureAudioForSpeech();
            await speak(coachRes.data.kevin_response, voiceGender, language, apiUrl);
          })();
        }
      } else {
        // Don't fail the whole flow if Kevin times out — still show the
        // result card with a soft fallback caption.
        setCoach({
          kevin_response: "I saw the swing — couldn't put words to it just now. Take another and we'll see.",
          confidence: 'low',
        });
      }
      setPhase('RESULT');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('ERROR');
    }
  }, [voiceEnabled, voiceGender, language, apiUrl]);

  const handleSwingAgain = useCallback(() => {
    setResult(null);
    setCoach(null);
    setWatchSwing(null);
    setImpactReading(null);
    setBallSpeed(null);
    setErrorMessage(null);
    setDetailsOpen(false);
    setRecordedSeconds(0);
    // 2026-05-21 — Day 2 / Fix 9B: advance the batch index if a batch
    // session is in flight. When the batch completes the user has
    // already seen the final RESULT card; tapping Swing Again resets
    // for a fresh batch starting back at index 0.
    setBatchIdx(prev => (prev + 1 >= batchSize ? 0 : prev + 1));
    setPhase('SETUP');
  }, [batchSize]);

  // 2026-05-21 — Day 2 / Fix 9B: batch auto-advance. While a multi-swing
  // batch is in flight, the RESULT phase loops back to SETUP after a
  // short pause so the player keeps swinging without tapping. Final
  // RESULT of the batch stays on-screen until the user taps Swing
  // Again (which resets the batch).
  useEffect(() => {
    if (phase !== 'RESULT') return;
    if (!batchActive || batchComplete) return;
    const t = setTimeout(() => { handleSwingAgain(); }, 4000);
    return () => clearTimeout(t);
  }, [phase, batchActive, batchComplete, handleSwingAgain]);

  // Belt-and-suspenders: if the user backs out mid-recording we don't
  // want the parallel AudioRecorder to leak. abortImpactRecording is
  // idempotent so calling on every unmount is safe.
  useEffect(() => {
    return () => {
      void abortImpactRecording().catch(() => undefined);
    };
  }, []);

  const handleTryAgain = useCallback(() => {
    setErrorMessage(null);
    setRecordedSeconds(0);
    setPhase('SETUP');
  }, []);

  const onBadgeTap = useCallback(() => {
    void toggleListening();
  }, []);

  // ── Caption pulse on phase change ───────────────────────────────────
  const captionFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    captionFade.setValue(0);
    Animated.timing(captionFade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Permission gates ────────────────────────────────────────────────
  // Loading state (camPerm null) USED to render a bare spinner with no
  // Header/back affordance — if the OS permission dialog hung or got
  // backgrounded the user was stranded. Now always renders Header (back
  // button) + visible "Cancel" path so no state can trap the user.
  if (!camPerm) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header insets={insets} onBack={() => safeBack()} onMore={() => setMoreOpen(true)} onBadge={onBadgeTap} />
        <View style={styles.permWrap}>
          <ActivityIndicator color="#00C896" />
          <Text style={[styles.permBody, { marginTop: 12 }]}>Checking camera permission…</Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 20, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#00C896' }]}
            onPress={() => safeBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back to SwingLab"
          >
            <Text style={[styles.primaryBtnText, { color: '#00C896' }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
  if (!camPerm.granted) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header insets={insets} onBack={() => safeBack()} onMore={() => setMoreOpen(true)} onBadge={onBadgeTap} />
        <View style={styles.permWrap}>
          <Text style={styles.permTitle}>Camera permission needed</Text>
          <Text style={styles.permBody}>Cage Drill records your swing to score your strikes.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => void requestCamPerm()}>
            <Text style={styles.primaryBtnText}>Allow Camera</Text>
          </TouchableOpacity>
          {/* Always-available exit so a denied OS prompt never strands the user. */}
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 12, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#00C896' }]}
            onPress={() => safeBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back to SwingLab"
          >
            <Text style={[styles.primaryBtnText, { color: '#00C896' }]}>Back to SwingLab</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────
  // Audit fix — keep camera mounted through UPLOADING so the recordAsync
  // promise can resolve cleanly. The full-screen UPLOADING overlay covers
  // the camera visually; functional reason for keeping the View alive is
  // the recording promise lifecycle, not the pixel.
  const cameraVisible = phase === 'SETUP' || phase === 'CHECKING' || phase === 'READY' || phase === 'NOT_READY' || phase === 'RECORDING' || phase === 'UPLOADING';

  return (
    <View style={styles.container}>
      {cameraVisible && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode={phase === 'RECORDING' ? 'video' : 'picture'}
          videoQuality="1080p"
        />
      )}

      {/* Dim overlay so chrome reads on bright camera frames. */}
      {cameraVisible && <View style={styles.cameraDim} pointerEvents="none" />}

      {/* Phase AM — multi-purpose alignment overlay. Renders only during
          setup phases; hidden during RECORDING / UPLOADING so the
          recording UI isn't crowded with the alignment scaffold. Color
          maps to phase (amber → green when READY, red on NOT_READY). */}
      {(phase === 'SETUP' || phase === 'CHECKING' || phase === 'READY' || phase === 'NOT_READY') && (
        <CageOverlay phase={phase as CageOverlayPhase} />
      )}

      <Header insets={insets} onBack={() => safeBack()} onMore={() => setMoreOpen(true)} onBadge={onBadgeTap} />

      {/* Kevin caption — always visible, fades on phase change. */}
      <Animated.View
        style={[
          styles.captionWrap,
          { top: insets.top + 76, opacity: captionFade },
          isFoldOpen && { left: 96, right: 96 },
        ]}
        pointerEvents="none"
      >
        <Text style={styles.caption}>{KEVIN_CAPTION[phase] ?? ''}</Text>
        {isMockMode() && <Text style={styles.mockHint}>MOCK MODE</Text>}
      </Animated.View>

      {/* RECORDING — large countdown + stop button. */}
      {phase === 'RECORDING' && (
        <View style={[styles.recordingWrap, { paddingBottom: insets.bottom + 32 }]} pointerEvents="box-none">
          <View style={styles.countdownCard}>
            <Text style={styles.countdownNum}>{Math.max(0, RECORDING_MAX_SECONDS - recordedSeconds)}</Text>
            <Text style={styles.countdownLabel}>SECONDS LEFT</Text>
          </View>
          <TouchableOpacity style={styles.stopBtn} onPress={() => void stopRecordingAndUpload()}>
            <View style={styles.stopSquare} />
            <Text style={styles.stopText}>STOP</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* SETUP / READY / NOT_READY — bottom CTAs. */}
      {(phase === 'SETUP' || phase === 'READY' || phase === 'NOT_READY' || phase === 'CHECKING') && (
        <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + 32 }]} pointerEvents="box-none">
          {/* 2026-05-21 — Day 2 / Fix 9B: batch-count selector. Only
              renders pre-recording (SETUP/NOT_READY) so it doesn't
              clutter the READY/CHECKING moment. Selecting a size
              resets the batch index. */}
          {(phase === 'SETUP' || phase === 'NOT_READY') && (
            <View style={styles.batchRow}>
              <Text style={styles.batchLabel}>SWINGS THIS SESSION</Text>
              <View style={styles.batchPills}>
                {BATCH_OPTIONS.map(opt => {
                  const active = batchSize === opt;
                  return (
                    <TouchableOpacity
                      key={opt}
                      onPress={() => { setBatchSize(opt); setBatchIdx(0); }}
                      style={[styles.batchPill, active && styles.batchPillActive]}
                      accessibilityRole="button"
                      accessibilityLabel={`Set session length to ${opt} swing${opt === 1 ? '' : 's'}`}
                    >
                      <Text style={[styles.batchPillText, active && styles.batchPillTextActive]}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {batchActive && (
                <Text style={styles.batchProgress}>{batchIdx + 1} of {batchSize}</Text>
              )}
            </View>
          )}
          {phase === 'CHECKING' ? (
            <View style={styles.checkingCard}>
              <ActivityIndicator color="#00C896" />
              <Text style={styles.checkingText}>Checking position…</Text>
            </View>
          ) : phase === 'READY' ? (
            <>
              {/* Re-sim P0 #2 — surface the voice trigger one-time so
                  players (especially those who can't easily reach the
                  button) know it exists. Hidden once tutorialsSeen marks
                  cage_voice_trigger. */}
              {!useSettingsStore.getState().tutorialsSeen?.['cage_voice_trigger'] && (
                <View style={styles.voiceHintRow}>
                  <Ionicons name="mic-outline" size={14} color="#00C896" />
                  <Text style={styles.voiceHintText} accessibilityLabel="Tip: say record or capture to start recording with voice">
                    {'Tip: say "record" or "capture" — hands-free.'}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.primaryBtn, styles.recordBtn]}
                onPress={() => {
                  useSettingsStore.getState().markTutorialSeen('cage_voice_trigger');
                  void handleStartRecording();
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Start recording your swing — or say record"
              >
                <View style={styles.recordDot} />
                <Text style={styles.primaryBtnText}>Start Recording</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, phase === 'NOT_READY' && styles.primaryBtnDisabled]}
              onPress={handleCheckPosition}
              disabled={phase === 'NOT_READY'}
              activeOpacity={0.85}
            >
              <Ionicons name="scan-outline" size={20} color="#0d1a0d" />
              <Text style={styles.primaryBtnText}>Check Position</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* UPLOADING — full-card overlay with filler caption + spinner. */}
      {phase === 'UPLOADING' && (
        <View style={styles.fullOverlay}>
          <View style={styles.uploadCard}>
            <ActivityIndicator size="large" color="#00C896" />
            <Text style={styles.uploadText}>{KEVIN_CAPTION.UPLOADING}</Text>
          </View>
        </View>
      )}

      {/* RESULT — Kevin's response card + collapsible features.json. */}
      {phase === 'RESULT' && result && (
        <SafeAreaView style={styles.resultContainer} edges={['top', 'bottom']}>
          <Header insets={insets} onBack={() => safeBack()} onMore={() => setMoreOpen(true)} onBadge={onBadgeTap} />
          <ScrollView style={styles.resultScroll} contentContainerStyle={styles.resultScrollContent}>

            {/* Kevin response card — primary surface */}
            <View style={styles.kevinCard}>
              <View style={styles.kevinHeader}>
                <Image
                  source={require('../../assets/avatars/smartplay_caddie_badge.png')}
                  style={styles.kevinAvatar}
                  resizeMode="contain"
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.kevinName}>{caddieName}</Text>
                  {coach ? (
                    <View style={styles.confidenceRow}>
                      <View style={[styles.confidenceDot, { backgroundColor: CONFIDENCE_DOT[coach.confidence] }]} />
                      <Text style={styles.confidenceLabel}>{coach.confidence.toUpperCase()} CONFIDENCE</Text>
                    </View>
                  ) : (
                    <ActivityIndicator color="#00C896" size="small" style={{ alignSelf: 'flex-start', marginTop: 4 }} />
                  )}
                </View>
              </View>
              <Text style={styles.kevinResponse}>
                {coach ? coach.kevin_response : 'Working on it…'}
              </Text>
            </View>

            {/* Watch metrics — paired to the same swing the video
                captured. Hidden when no watch connected so the empty
                state doesn't confuse users without one. */}
            {watchSwing && (
              <View style={styles.watchCard}>
                <View style={styles.watchHeader}>
                  <Ionicons name="watch-outline" size={16} color="#00C896" />
                  <Text style={styles.watchHeaderText}>WATCH METRICS</Text>
                  <Text style={styles.watchClub}>{watchSwing.club}</Text>
                </View>
                <View style={styles.watchGrid}>
                  <WatchStat
                    label="TEMPO"
                    value={watchSwing.tempoRatio.toFixed(2)}
                    sub={watchSwing.tempoGood ? 'in range' : 'work on it'}
                    good={watchSwing.tempoGood}
                  />
                  <WatchStat
                    label="CLUB MPH"
                    value={String(Math.round(watchSwing.clubHeadSpeedEst))}
                    sub={`${Math.round(watchSwing.peakWristSpeed)} wrist`}
                  />
                  <WatchStat
                    label="BACKSWING"
                    value={`${Math.round(watchSwing.backswingMs)} ms`}
                    sub={`${Math.round(watchSwing.downswingMs)} down`}
                  />
                </View>
                {watchSwing.earlyTransition && (
                  <Text style={styles.watchWarn}>⚠ Early transition detected — pause at the top.</Text>
                )}
              </View>
            )}
            {!watchSwing && watchConnected && (
              <View style={[styles.watchCard, styles.watchCardEmpty]}>
                <Text style={styles.watchEmptyText}>Watch is connected but didn&apos;t catch this swing. Make sure it&apos;s on the lead wrist.</Text>
              </View>
            )}

            {/* Acoustic impact card — shows the detected strike time so
                users can scrub to the impact frame. Ball speed (server-
                detected) lands asynchronously after the on-device peak.
                Hidden when no acoustic reading came back. */}
            {impactReading && (
              <View style={styles.impactCard}>
                <View style={styles.watchHeader}>
                  <Ionicons name="pulse-outline" size={16} color="#F5A623" />
                  <Text style={[styles.watchHeaderText, { color: '#F5A623' }]}>ACOUSTIC</Text>
                  <Text style={styles.watchClub}>{Math.round(impactReading.confidence * 100)}% conf</Text>
                </View>
                <Text style={styles.impactBody}>
                  Strike at <Text style={styles.impactBold}>{(impactReading.impact_ms / 1000).toFixed(2)}s</Text> · peak {impactReading.peak_db.toFixed(1)} dB
                </Text>
                {ballSpeed ? (
                  <>
                    <Text style={[styles.impactBody, { marginTop: 6 }]}>
                      Cage <Text style={styles.impactBold}>{ballSpeed.cage_distance_yards} yd</Text> · echo {ballSpeed.delta_ms} ms
                    </Text>
                    <Text style={[styles.impactBody, { marginTop: 4 }]}>
                      Ball speed <Text style={styles.impactBold}>~{ballSpeed.ball_speed_mph} mph</Text>
                      <Text style={styles.impactNote}> · estimate (single-mic, club-typical × peak)</Text>
                    </Text>
                  </>
                ) : null}
              </View>
            )}

            {/* Collapsible features.json — debug surface, off by default */}
            <TouchableOpacity
              style={styles.detailsToggle}
              onPress={() => setDetailsOpen(o => !o)}
              activeOpacity={0.85}
            >
              <Ionicons name={detailsOpen ? 'chevron-down' : 'chevron-forward'} size={16} color="#9ca3af" />
              <Text style={styles.detailsLabel}>{detailsOpen ? 'Hide details' : 'Show details'}</Text>
            </TouchableOpacity>
            {detailsOpen && (
              <View style={styles.jsonCard}>
                <Text style={styles.jsonText}>{JSON.stringify(result, null, 2)}</Text>
              </View>
            )}

          </ScrollView>
          <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + 24, position: 'relative' }]} pointerEvents="box-none">
            <TouchableOpacity style={styles.primaryBtn} onPress={handleSwingAgain} activeOpacity={0.85}>
              <Ionicons name="refresh" size={18} color="#0d1a0d" />
              <Text style={styles.primaryBtnText}>Swing Again</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* ERROR — message + Try Again. */}
      {phase === 'ERROR' && (
        <SafeAreaView style={styles.resultContainer} edges={['top', 'bottom']}>
          <Header insets={insets} onBack={() => safeBack()} onMore={() => setMoreOpen(true)} onBadge={onBadgeTap} />
          <View style={styles.errorWrap}>
            <Ionicons name="alert-circle-outline" size={36} color="#ef4444" />
            <Text style={styles.errorTitle}>{KEVIN_CAPTION.ERROR}</Text>
            <Text style={styles.errorBody}>{errorMessage ?? 'Unknown error.'}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleTryAgain} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* ••• action sheet — minimal local menu so the affordance is real. */}
      <Modal transparent visible={moreOpen} animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMoreOpen(false)}>
          <View style={[styles.menuSheet, { paddingTop: insets.top + 60, paddingRight: 12 }]}>
            <View style={styles.menuCard}>
              <MenuItem
                icon="settings-outline"
                label="Settings"
                onPress={() => { setMoreOpen(false); router.push('/settings' as never); }}
              />
              <MenuItem
                icon="library-outline"
                label="My Swing Library"
                onPress={() => { setMoreOpen(false); router.push('/swinglab/library' as never); }}
              />
              <MenuItem
                icon="close-circle-outline"
                label="Close"
                onPress={() => { setMoreOpen(false); router.back(); }}
              />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * WatchStat — single cell of the watch-metrics grid on the result card.
 * Three of these render side-by-side: TEMPO, CLUB MPH, BACKSWING.
 */
function WatchStat({
  label, value, sub, good,
}: {
  label: string;
  value: string;
  sub: string;
  good?: boolean;
}) {
  const valueStyle = [
    styles.watchStatValue,
    good === true ? styles.watchStatGood : null,
    good === false ? styles.watchStatBad : null,
  ];
  return (
    <View style={styles.watchStat}>
      <Text style={styles.watchStatLabel}>{label}</Text>
      <Text style={valueStyle}>{value}</Text>
      <Text style={styles.watchStatSub}>{sub}</Text>
    </View>
  );
}

function Header({
  insets, onBack, onMore, onBadge,
}: {
  insets: { top: number };
  onBack: () => void;
  onMore: () => void;
  onBadge: () => void;
}) {
  return (
    <View style={[styles.header, { top: insets.top + 8 }]} pointerEvents="box-none">
      {/* 2026-05-21 — Fix A: swapped the static badge Image for the
          shared CaddieMicBadge so the ring + halo + mic-icon overlay
          react to listening state. Tap pipeline unchanged
          (onBadge → toggleListening). */}
      <CaddieMicBadge size={40} onPress={onBadge} />
      <View style={styles.headerCenter}>
        <Text style={styles.headerTitle}>Cage Mode</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <TouchableOpacity onPress={onBack} style={styles.iconBtn} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color="#9ca3af" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onMore} style={styles.iconBtn} accessibilityLabel="More options">
          <Ionicons name="ellipsis-horizontal" size={22} color="#9ca3af" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MenuItem({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <Ionicons name={icon} size={18} color="#00C896" />
      <Text style={styles.menuLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  cameraDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6, 15, 9, 0.18)' },

  header: {
    position: 'absolute', left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    zIndex: 30,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#ffffff', fontSize: 14, fontWeight: '900', letterSpacing: 1.4 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(6, 15, 9, 0.65)',
    alignItems: 'center', justifyContent: 'center',
  },

  captionWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 25 },
  caption: {
    color: '#ffffff', fontSize: 15, fontWeight: '600',
    textAlign: 'center', lineHeight: 21,
    backgroundColor: 'rgba(6, 15, 9, 0.72)',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(0, 200, 150, 0.35)',
  },
  mockHint: {
    color: '#fbbf24', fontSize: 10, fontWeight: '900', letterSpacing: 1.4,
    marginTop: 6,
  },

  ctaWrap: {
    position: 'absolute', left: 16, right: 16, bottom: 0,
    alignItems: 'center', gap: 10, zIndex: 25,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#00C896', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 24,
    minWidth: 220,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '900' },

  recordBtn: { backgroundColor: '#ef4444' },
  recordDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#ffffff' },

  // 2026-05-21 — Day 2 / Fix 9B: batch-count selector styles.
  batchRow: {
    backgroundColor: 'rgba(6, 15, 9, 0.78)',
    borderColor: 'rgba(0, 200, 150, 0.35)', borderWidth: 1,
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 10, alignItems: 'center', gap: 8,
  },
  batchLabel: { color: '#9ca3af', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  batchPills: { flexDirection: 'row', gap: 6 },
  batchPill: {
    minWidth: 44, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#1e3a28',
    backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center',
  },
  batchPillActive: {
    borderColor: '#00C896',
    backgroundColor: 'rgba(0, 200, 150, 0.18)',
  },
  batchPillText: { color: '#9ca3af', fontSize: 14, fontWeight: '800' },
  batchPillTextActive: { color: '#00C896' },
  batchProgress: { color: '#cbd5e1', fontSize: 11, fontWeight: '700' },

  voiceHintRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(6, 15, 9, 0.78)',
    borderColor: 'rgba(0, 200, 150, 0.45)', borderWidth: 1,
    borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12,
  },
  voiceHintText: { color: '#d1d5db', fontSize: 12, fontWeight: '600' },

  checkingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(6, 15, 9, 0.85)', borderColor: '#00C896', borderWidth: 1,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18,
  },
  checkingText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  recordingWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    alignItems: 'center', gap: 18, zIndex: 25,
  },
  countdownCard: {
    backgroundColor: 'rgba(6, 15, 9, 0.85)', borderColor: '#ef4444', borderWidth: 2,
    borderRadius: 18, paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center',
  },
  countdownNum: { color: '#ffffff', fontSize: 56, fontWeight: '900', fontVariant: ['tabular-nums'], lineHeight: 62 },
  countdownLabel: { color: '#9ca3af', fontSize: 10, fontWeight: '900', letterSpacing: 1.6, marginTop: 2 },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#ef4444', paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 32,
  },
  stopSquare: { width: 14, height: 14, backgroundColor: '#ffffff' },
  stopText: { color: '#ffffff', fontSize: 14, fontWeight: '900', letterSpacing: 1.2 },

  fullOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 15, 9, 0.92)',
    alignItems: 'center', justifyContent: 'center', zIndex: 40,
  },
  uploadCard: {
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 16, padding: 28, alignItems: 'center', gap: 16, maxWidth: 340,
  },
  uploadText: { color: '#ffffff', fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 21 },

  resultContainer: { ...StyleSheet.absoluteFillObject, backgroundColor: '#060f09', zIndex: 45 },
  resultScroll: { flex: 1 },
  resultScrollContent: { paddingHorizontal: 16, paddingTop: 70, paddingBottom: 120 },

  kevinCard: {
    backgroundColor: '#0d2418', borderColor: '#00C896', borderWidth: 1.5,
    borderRadius: 16, padding: 16, gap: 12,
  },
  kevinHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kevinAvatar: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5, borderColor: '#00C896',
  },
  kevinName: { color: '#00C896', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  confidenceDot: { width: 8, height: 8, borderRadius: 4 },
  confidenceLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  kevinResponse: { color: '#ffffff', fontSize: 16, fontWeight: '500', lineHeight: 23 },

  // Watch metrics card — sits below the Kevin card on the result surface.
  watchCard: {
    marginTop: 14,
    marginHorizontal: 16,
    backgroundColor: 'rgba(0, 200, 150, 0.06)',
    borderWidth: 1,
    borderColor: '#1e3a28',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  watchCardEmpty: { backgroundColor: 'rgba(107, 114, 128, 0.08)' },
  watchHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  watchHeaderText: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, flex: 1 },
  watchClub: { color: '#9ca3af', fontSize: 11, fontWeight: '700' },
  watchGrid: { flexDirection: 'row', gap: 10 },
  watchStat: { flex: 1, alignItems: 'flex-start' },
  watchStatLabel: { color: '#6b7280', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  watchStatValue: { color: '#e8f5e9', fontSize: 22, fontWeight: '900', marginTop: 4 },
  watchStatSub: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  watchStatGood: { color: '#00C896' },
  watchStatBad: { color: '#F0C030' },
  watchWarn: { color: '#F0C030', fontSize: 12, fontWeight: '600', marginTop: 10 },
  watchEmptyText: { color: '#9ca3af', fontSize: 12, lineHeight: 17, fontStyle: 'italic' },

  // Acoustic impact card.
  impactCard: {
    marginTop: 12,
    marginHorizontal: 16,
    backgroundColor: 'rgba(245, 166, 35, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.30)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  impactBody: { color: '#e8f5e9', fontSize: 13, lineHeight: 18 },
  impactBold: { color: '#F5A623', fontWeight: '800' },
  impactNote: { color: '#6b7280', fontSize: 11 },

  detailsToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 4, marginTop: 12,
  },
  detailsLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  jsonCard: {
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 12, padding: 14,
  },
  jsonText: { color: '#e5e7eb', fontSize: 12, fontFamily: 'monospace', lineHeight: 18 },

  errorWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, gap: 12,
  },
  errorTitle: { color: '#ef4444', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  errorBody: { color: '#d1d5db', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 12 },

  permWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  permTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  permBody: { color: '#9ca3af', fontSize: 14, textAlign: 'center', marginBottom: 12 },

  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  menuSheet: { alignItems: 'flex-end' },
  menuCard: {
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 14, padding: 6, minWidth: 200,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  menuLabel: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
