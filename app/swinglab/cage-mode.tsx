/**
 * Cage Mode — dedicated practice + lesson environment.
 *
 * 2026-05-21 — Fix G (Option A): dropped the unbuilt CV bullseye gate and
 * the unbuilt /api/cage/analyze backend. Both endpoints 404'd in production
 * because they were never implemented past the mock stub. SETUP → RECORDING
 * directly (no fake CHECKING/READY/NOT_READY); the framing overlay still
 * renders so the user can align body + bullseye + ball-address visually,
 * but no fake "bullseye detected" gate runs. Post-record review is built
 * from REAL signals only: local acoustic impact detector + /api/acoustic-
 * detect (ball speed) + /api/kevin/coach (coach review). No fabrication —
 * if a capability isn't available, the card stays empty rather than fake.
 *
 * 2026-05-21 — Day 2 / Fix 9B: file renamed from cage-drill.tsx to
 * cage-mode.tsx + given a clear Cage Mode identity. SmartMotion (quick
 * swing check) and Cage Mode (full practice/lesson tool) are now two
 * distinct features with zero overlap. Works in a cage OR on the range.
 *
 * 2026-05-21 — Fix F diagnosis: Galaxy Watch IMU is the SIXTH planned
 * capability but is NOT wired yet. services/watchService.ts has only
 * tempo math + a "FUTURE: REAL SDK HOOK" comment block; nothing
 * writes to useWatchStore in production
 * (zero callers of setConnected / recordSwing). The render path in
 * this file IS correctly defensive (`watchSwing && ...` gate at the
 * results card) so no fake "watch connected" UI shows up — the
 * empty state is silence, which is the right answer for an unbuilt
 * integration. Real Watch IMU wiring requires native module +
 * EAS Build (not OTA-able). Sprint plan: defer to the next APK,
 * use the beta wearables SDK Tim has access to per
 * memory/beta-wearables-sdk-access.md.
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
 * State machine (post-G):
 *   SETUP → RECORDING (12s) → UPLOADING → RESULT | ERROR
 *   ERROR → "Try Again" → SETUP
 *   RESULT → "Swing Again" → SETUP  (auto if batch incomplete)
 *
 * Capture: 1080p / 30fps / audio / single .mp4. CameraView holds mode='video'
 * throughout so recordAsync can't race a mode transition.
 *
 * No pre-record CV gate — the unbuilt /api/cage/check-bullseye endpoint is
 * gone. CageOverlay still renders during SETUP so the user can align body
 * + bullseye + ball-address visually before tapping Start.
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
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
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
import { useCageStore, type PrimaryIssue } from '../../store/cageStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useFamilyStore } from '../../store/familyStore';
// 2026-05-21 — Fix A: shared CaddieMicBadge for consistent
// tap-to-talk affordance (ring + halo + mic-icon overlay).
import { CaddieMicBadge } from '../../components/caddie/CaddieMicBadge';
// 2026-05-21 — Fix D: 3-line caddie quick-start intro shown the first
// few opens of Cage Mode (per-slug counter in settingsStore). Skippable.
import { CaddieIntroSheet, useCaddieIntro } from '../../components/caddie/CaddieIntroSheet';

// 2026-05-21 — Fix G (Option A): CHECKING/READY/NOT_READY phases removed
// with the unbuilt CV bullseye gate. SETUP → RECORDING directly. The
// framing overlay still helps the user align manually; we just don't
// fake a server-side "bullseye detected" approval.
type Phase =
  | 'SETUP'
  | 'COUNTDOWN'
  | 'RECORDING'
  | 'UPLOADING'
  | 'RESULT'
  | 'ERROR';

// 2026-05-24 — Bumped from 12s → 30s. Tim's real-cage feedback:
// auto-stopping at 12s was tripping solo workflows (tap → walk to
// ball → swing routinely took 8-10s, leaving only 2-4s of post-impact
// capture). 30s ceiling + the explicit STOP button means the player
// controls when capture ends; auto-stop is a safety net, not a cue.
const RECORDING_MAX_SECONDS = 30;
// Pre-record countdown — same shape + duration as SmartMotion quick-record
// so the muscle memory transfers. Gives the solo user time to walk from
// the phone tripod to the hitting position after tapping Start.
const PRE_RECORD_COUNTDOWN_SECONDS = 5;

const KEVIN_CAPTION: Partial<Record<Phase, string>> = {
  SETUP:     "Frame your hitting area. Tap 'I'm Set' when you're ready.",
  COUNTDOWN: 'Get in position — recording starts in a few seconds.',
  RECORDING: 'Swing when ready. Tap STOP when done.',
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
  // 2026-05-28 — Fix EZ: pre-fire ball detection during the COUNTDOWN
  // phase so the analyzer has ball-area context ready the moment
  // recording ends. Same logic as Fix EK's pre-warm — uses the
  // otherwise-idle countdown seconds productively. Result is held in
  // a ref because the cage session ID doesn't exist until after
  // ingestUploadedSwing fires (post-recording); we apply the ref to
  // the session via setSessionBallArea right after ingest.
  const pendingBallDetectionRef = useRef<{ x: number; y: number; r: number } | null>(null);
  const [ballDetectStatus, setBallDetectStatus] = useState<'idle' | 'detecting' | 'found' | 'not_found'>('idle');

  // 2026-05-24 — Pre-record countdown ticker, used by COUNTDOWN phase.
  const preRecordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<Phase>('SETUP');
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  // Pre-record countdown remaining seconds (only valid while phase === 'COUNTDOWN').
  const [preRecordCountdown, setPreRecordCountdown] = useState<number>(PRE_RECORD_COUNTDOWN_SECONDS);
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
  // 2026-05-22 — Hide the pill row after the user picks a count so it
  // stops overlapping the ball box in SETUP. Stays hidden for the rest
  // of the cage session; the compact badge below the Start Recording
  // button can re-open it if the user changes their mind. Component
  // unmount (leave + return to cage) resets the state so the picker
  // appears again on a fresh session.
  const [batchPickerDismissed, setBatchPickerDismissed] = useState(false);

  const { voiceEnabled, voiceGender, language, caddiePersonality } = useSettingsStore();
  const caddieName = getCaddieName(caddiePersonality);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // ── Permissions ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!camPerm?.granted) void requestCamPerm();
    if (!micPerm?.granted) void requestMicPerm();
    // 2026-05-27 — Fix EK: pre-warm /api/swing-analysis so the first
    // cage-captured swing doesn't pay Vercel cold-start.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../services/swingAnalysisWarmup').prewarmSwingAnalysis();
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
  // triggers the same handler the button does.
  //
  // 2026-05-21 — Fix G (Option A): fire from SETUP (was READY). With the
  // unbuilt CV bullseye gate removed, SETUP is the only pre-record phase.
  // handleStartRecording has its own internal guards (mic permission,
  // double-tap promise) so mid-RECORDING dup-fires are still race-safe.
  useEffect(() => {
    let cancelled = false;
    const unsub = subscribeCapture(['swing'], () => {
      if (cancelled) return;
      if (phase === 'SETUP') {
        // Route through handleConfirmReady so voice "record" gets the
        // same 5s pre-record countdown the button does — gives the
        // solo player time to walk into position regardless of how
        // they triggered the capture.
        void handleConfirmReady();
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
      if (preRecordTimerRef.current) clearInterval(preRecordTimerRef.current);
    };
  }, []);

  // 2026-05-21 — Fix G (Option A): removed the NOT_READY auto-revert
  // useEffect and handleCheckPosition. With no CV bullseye gate, there
  // is no NOT_READY state and no preview-frame POST. The user frames
  // their target visually using CageOverlay and taps Start Recording.

  // ── State transitions ───────────────────────────────────────────────

  // 2026-05-24 — Pre-record countdown handler. SETUP → COUNTDOWN → RECORDING.
  // The COUNTDOWN phase ticks visibly so the solo player has time to walk
  // from the phone tripod to the hitting position. Voice "record" and the
  // SETUP "I'm Set" button both call this. Tapping the countdown card
  // cancels and returns to SETUP.
  const cancelPreRecordCountdown = useCallback(() => {
    if (preRecordTimerRef.current) {
      clearInterval(preRecordTimerRef.current);
      preRecordTimerRef.current = null;
    }
    setPreRecordCountdown(PRE_RECORD_COUNTDOWN_SECONDS);
    setPhase('SETUP');
  }, []);

  const handleConfirmReady = useCallback(async () => {
    if (!cameraRef.current) return;
    if (recordingPromiseRef.current) return;
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
    if (PRE_RECORD_COUNTDOWN_SECONDS <= 0) {
      void handleStartRecording();
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPreRecordCountdown(PRE_RECORD_COUNTDOWN_SECONDS);
    setPhase('COUNTDOWN');
    // 2026-05-28 — Fix EZ: reset pre-fire state for this round.
    pendingBallDetectionRef.current = null;
    setBallDetectStatus('idle');
    preRecordTimerRef.current = setInterval(() => {
      setPreRecordCountdown(prev => {
        if (prev <= 1) {
          if (preRecordTimerRef.current) { clearInterval(preRecordTimerRef.current); preRecordTimerRef.current = null; }
          void handleStartRecording();
          return PRE_RECORD_COUNTDOWN_SECONDS;
        }
        // 2026-05-28 — Fix EZ: at countdown=3 (2s after countdown starts,
        // 3s before record fires) snapshot a frame + run ball-detection
        // async. User has had a beat to settle into address; we have
        // 3s of fetch budget before recording starts. Result lands in
        // pendingBallDetectionRef and gets applied to the session after
        // recording completes. Same shape as Fix EK pre-warm —
        // productive use of otherwise-idle countdown seconds.
        if (prev === 3 && ballDetectStatus === 'idle') {
          void prefireBallDetection();
        }
        return prev - 1;
      });
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micPerm, requestMicPerm]);

  // 2026-05-28 — Fix EZ: pre-fire ball detection during the COUNTDOWN
  // phase. Grabs a low-quality snapshot from the live camera, sends to
  // /api/swing-analysis mode='detect_ball' (Claude Haiku vision), and
  // stashes the result in pendingBallDetectionRef so the post-recording
  // ingest path can apply it as the session's ball_area_norm. Visual
  // feedback via setBallDetectStatus drives the small "Detecting ball…"
  // → "✓ Ball detected" chip during countdown.
  //
  // Fire-and-forget: never blocks the countdown ticker. If detection
  // misses (low light, ball not in frame), the session just doesn't
  // get a ball-area anchor and the analyzer runs as before.
  const prefireBallDetection = useCallback(async () => {
    if (!cameraRef.current) return;
    setBallDetectStatus('detecting');
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.4,
        skipProcessing: true,
      });
      if (!photo?.uri) {
        setBallDetectStatus('not_found');
        return;
      }
      const FS = await import('expo-file-system/legacy');
      const b64 = await FS.readAsStringAsync(photo.uri, { encoding: FS.EncodingType.Base64 });
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
      const res = await fetch(`${apiUrl}/api/swing-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'detect_ball',
          frames: [{ b64, media_type: 'image/jpeg' }],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const data = (await res.json()) as { found?: boolean; x?: number; y?: number; r?: number };
      if (data.found && typeof data.x === 'number' && typeof data.y === 'number') {
        pendingBallDetectionRef.current = {
          x: data.x,
          y: data.y,
          r: typeof data.r === 'number' ? data.r : 0.06,
        };
        setBallDetectStatus('found');
        console.log('[cage-mode] pre-fire ball detection found ball at', pendingBallDetectionRef.current);
      } else {
        setBallDetectStatus('not_found');
        console.log('[cage-mode] pre-fire ball detection: ball not found in frame');
      }
      // Clean up the temp snapshot — we already have the base64 + result.
      try { await FS.deleteAsync(photo.uri, { idempotent: true }); } catch { /* ignore */ }
    } catch (e) {
      console.log('[cage-mode] pre-fire ball detection failed (non-fatal):', e);
      setBallDetectStatus('not_found');
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

    setPhase('UPLOADING');

    // 2026-05-21 — Fix G (Option A): the /api/cage/analyze endpoint was
    // never built (404 in prod) so the previous flow of POST-video-and-
    // wait-for-features-json is gone. Real signals only — local acoustic
    // impact + /api/acoustic-detect ball-speed + /api/kevin/coach review.
    // We still need the recording promise to resolve so the camera file
    // lands cleanly; we just don't upload it to anything.
    try {
      // Phase J.1 — stop and detect impact. Was fire-and-forget pre-G;
      // now awaited inline so we can hand the resolved values straight
      // into the coachReview features payload below (no race, no stale
      // state read).
      let resolvedImpact: ImpactReading | null = null;
      let resolvedSpeed: BallSpeedResult | null = null;
      try {
        resolvedImpact = await stopAndDetectImpact();
        if (resolvedImpact) {
          setImpactReading(resolvedImpact);
          if (resolvedImpact.audio_uri) {
            // J.2 hybrid: two-peak server detection for ball speed.
            resolvedSpeed = await detectBallSpeed({
              audioUri: resolvedImpact.audio_uri,
              impact_ms: resolvedImpact.impact_ms,
            });
            if (resolvedSpeed) {
              setBallSpeed(resolvedSpeed);
              useCageCalibrationStore.getState().setAutoDetected(resolvedSpeed.cage_distance_yards);
            }
            void cleanupImpactRecording(resolvedImpact.audio_uri);
          }
        }
      } catch (e) { console.log('[cage-mode] acoustic chain failed:', e); }

      // Drain the video recording promise so the camera releases its
      // file handle cleanly. We don't upload it — analyzeCageVideo's
      // backend was never built.
      const recorded = await recordingPromiseRef.current;
      recordingPromiseRef.current = null;
      if (!recorded?.uri) {
        setErrorMessage('Recording produced no file.');
        setPhase('ERROR');
        return;
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Build features.json from REAL signals only. bullseye_offsets stays
      // empty — we don't have CV scoring. strike_count derives from the
      // acoustic detector. notes carry the ball-speed estimate when the
      // server-side two-peak detector returned one. Honest about what we
      // know vs don't.
      const notes: string[] = [];
      if (resolvedImpact) {
        notes.push(
          `Impact at ${(resolvedImpact.impact_ms / 1000).toFixed(2)}s (acoustic confidence ${Math.round(resolvedImpact.confidence * 100)}%).`,
        );
      }
      if (resolvedSpeed) {
        notes.push(
          `Estimated ball speed ${resolvedSpeed.ball_speed_mph} mph at ${resolvedSpeed.cage_distance_yards}yd cage distance.`,
        );
      }
      const features: CageAnalyzeResponse = {
        strike_count: resolvedImpact ? 1 : 0,
        strike_times: resolvedImpact ? [Number((resolvedImpact.impact_ms / 1000).toFixed(2))] : [],
        bullseye_offsets: [],
        notes,
      };
      setResult(features);

      // Wire watch metrics. If the connected watch recorded a swing
      // during the capture window, attach it so video review + watch
      // tempo/club speed show side by side. No-op when no watch.
      const startedAt = recordingStartedAtRef.current ?? 0;
      const endedAt = Date.now();
      const watchSwings = useWatchStore.getState().sessionSwings;
      const matched = [...watchSwings]
        .reverse()
        .find((s) => s.timestamp >= startedAt && s.timestamp <= endedAt + 2000);
      if (matched) setWatchSwing(matched);

      // Hand the locally-built features to Kevin's cage_swing_review tool.
      // /api/kevin/coach exists (vercel.json rewrites to api/cage-coach.ts).
      // The endpoint accepts arbitrary features in the body; Sonnet
      // responds to what's present. With our sparser payload it leans on
      // strike timing + notes; no fabricated bullseye_offsets to riff on.
      const coachRes = await coachReview(features, voiceGender, caddiePersonality);
      const coachData = coachRes.kind === 'ok' ? coachRes.data : {
        kevin_response: "I saw the swing — couldn't put words to it just now. Take another and we'll see.",
        confidence: 'low' as const,
      };
      setCoach(coachData);
      if (coachRes.kind === 'ok' && voiceEnabled) {
        void (async () => {
          await configureAudioForSpeech();
          await speak(coachRes.data.kevin_response, voiceGender, language, apiUrl);
        })();
      }

      // 2026-05-23 — Persist this cage swing + coach review to the
      // Library (cageStore.sessionHistory) so the player can revisit
      // it later. Ingests with source='live_cage' so the row badge
      // reads CAGE not UPLOAD; primary_issue carries the coach's
      // verbal response as the mechanical_breakdown line. Watch +
      // acoustic notes ride along in the upload.notes field.
      //
      // 2026-05-23 (Fix #7) — Attribution: same family-aware override
      // as the SmartMotion path. When a family member is active in
      // familyStore (a coach is hitting in the cage with the student
      // recording, or a parent is recording their kid), persist the
      // swing under THAT member's name with perspective='watching_someone'
      // so getAnalyzerKind routes it to full-body swing analysis (Phase
      // K) instead of the account holder's POV branch.
      try {
        const famState = useFamilyStore.getState();
        const activeMember = famState.active_member_id
          ? famState.members.find(m => m.id === famState.active_member_id) ?? null
          : null;
        const firstName = activeMember?.firstName
          ?? usePlayerProfileStore.getState().firstName
          ?? null;
        const perspective: 'pov_self' | 'watching_someone' =
          activeMember ? 'watching_someone' : 'pov_self';
        const club = matched?.club ?? 'unknown';
        const noteParts = [...notes];
        if (matched) {
          noteParts.push(`Watch swing: ${matched.club}`);
        }
        if (coachData.kevin_response) noteParts.push(coachData.kevin_response);
        const sessionId = useCageStore.getState().ingestUploadedSwing({
          clipUri: recorded.uri,
          club,
          upload: {
            uploaded_at: Date.now(),
            notes: noteParts.join(' • ') || 'Cage swing',
            duration_sec: null,
            has_audio: true,
            source_device: 'phone',
            tag: null,
            swinger: firstName,
            perspective,
          },
          source: 'live_cage',
        });
        // 2026-05-28 — Fix EZ: apply the pre-fired ball detection
        // result (if any) to the freshly-ingested session. The
        // analyzer pipeline (Fix ES) reads ball_area_norm off the
        // session and threads it into the vision prompt as an anchor.
        // Net effect: by the time analysis fires, the model already
        // knows where the ball was at address — better impact-frame
        // selection, more confident fault reads.
        if (pendingBallDetectionRef.current) {
          useCageStore.getState().setSessionBallArea(sessionId, pendingBallDetectionRef.current);
          console.log('[cage-mode] applied pre-fired ball detection to session', sessionId);
          pendingBallDetectionRef.current = null;
        }
        const issue: PrimaryIssue = {
          issue_id: 'cage_coach_review',
          name: 'Cage swing — coach review',
          category: 'other',
          severity: 'minor',
          occurrence_count: 1,
          visual_reference_path: null,
          mechanical_breakdown: coachData.kevin_response,
          feel_cue: 'Run another swing and see if the same pattern shows up.',
          detected_in_shots: [],
          confidence: (coachData.confidence ?? 'medium') as PrimaryIssue['confidence'],
        };
        useCageStore.getState().setSessionAnalysis(sessionId, issue, null);
        useCageStore.getState().setSessionAnalysisStatus(sessionId, 'ok');
        console.log('[cage-mode] persisted swing to Library', sessionId);
      } catch (e) {
        console.log('[cage-mode] Library persist failed (non-fatal):', e);
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

  // 2026-05-21 — Fix D: caddie quick-start intro. Only gates on the
  // initial SETUP phase — once the user advances to RECORDING they're
  // already moving and don't need the orientation. Auto-suppresses
  // after a few opens via the per-slug counter in settingsStore.
  const introState = useCaddieIntro('cage_mode', phase === 'SETUP');

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
  // 2026-05-21 — Fix G (Option A): CameraView keeps mode='video' through
  // every visible phase. The pre-G code toggled between 'picture' and
  // 'video' so it could takePictureAsync for the CV bullseye check; that
  // toggle was async and could race a recordAsync call immediately after
  // setPhase('RECORDING'). With the CV check gone we never need picture
  // mode, so the race is eliminated by construction.
  const cameraVisible = phase === 'SETUP' || phase === 'COUNTDOWN' || phase === 'RECORDING' || phase === 'UPLOADING';

  return (
    <View style={styles.container}>
      <CaddieIntroSheet slug="cage_mode" visible={introState.visible} onDismiss={introState.dismiss} />
      {cameraVisible && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="video"
          videoQuality="1080p"
        />
      )}

      {/* Dim overlay so chrome reads on bright camera frames. */}
      {cameraVisible && <View style={styles.cameraDim} pointerEvents="none" />}

      {/* Phase AM — multi-purpose alignment overlay. Renders during
          SETUP only (post-G — no fake CHECKING/READY/NOT_READY states).
          Lets the user align body + bullseye + ball-address visually
          before tapping Start. */}
      {phase === 'SETUP' && (
        <CageOverlay phase="SETUP" />
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

      {/* 2026-05-24 — COUNTDOWN — pre-record window. The user just hit
          "I'm Set" or said "record"; this gives them PRE_RECORD_COUNTDOWN_SECONDS
          to walk into position before the camera actually starts capturing.
          Tap the cancel button to abort and return to SETUP. */}
      {phase === 'COUNTDOWN' && (
        <View style={[styles.recordingWrap, { paddingBottom: insets.bottom + 32 }]} pointerEvents="box-none">
          <View style={[styles.countdownCard, { borderColor: '#fbbf24' }]}>
            <Text style={[styles.countdownNum, { color: '#fbbf24' }]}>{preRecordCountdown}</Text>
            <Text style={styles.countdownLabel}>GET IN POSITION</Text>
          </View>
          {/* 2026-05-28 — Fix EZ: ball-detection HUD chip. Surfaces the
              pre-fire status to the user — "checking ball position"
              while detection runs, "✓ ball detected" on success, soft
              "—" when missed (doesn't read as a failure; analysis
              still works, just without the anchor). Subtle so it
              doesn't compete with the main GET IN POSITION block. */}
          {ballDetectStatus !== 'idle' && (
            <View style={{
              marginTop: 10,
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingVertical: 5, paddingHorizontal: 10,
              backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12,
              borderWidth: 1,
              borderColor: ballDetectStatus === 'found' ? '#00C896' : 'rgba(255,255,255,0.35)',
            }}>
              <View style={{
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: ballDetectStatus === 'found' ? '#00C896'
                  : ballDetectStatus === 'detecting' ? '#fbbf24'
                  : '#9ca3af',
              }} />
              <Text style={{
                color: ballDetectStatus === 'found' ? '#00C896' : '#ffffff',
                fontSize: 11, fontWeight: '700', letterSpacing: 0.4,
              }}>
                {ballDetectStatus === 'detecting' ? 'Locating ball…'
                  : ballDetectStatus === 'found' ? '✓ Ball locked'
                  : 'Ball not seen — manual placement after'}
              </Text>
            </View>
          )}
          <TouchableOpacity style={styles.stopBtn} onPress={cancelPreRecordCountdown}>
            <View style={[styles.stopSquare, { backgroundColor: '#fbbf24' }]} />
            <Text style={styles.stopText}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      )}

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

      {/* SETUP — bottom CTA. Post-G: single Start Recording button (was
          a Check Position → READY → Start Recording two-step gated on a
          404 endpoint). Voice "record" + manual mic + button all fire
          handleStartRecording from this single state. */}
      {phase === 'SETUP' && (
        <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + 32 }]} pointerEvents="box-none">
          {/* Day 2 / Fix 9B — batch-count selector (1/3/5/10).
              2026-05-22 — Once the user picks a count, hide the row so it
              stops overlapping the ball box. The compact badge below
              still surfaces the current choice + lets them re-open the
              picker to change it. */}
          {!batchPickerDismissed ? (
            <View style={styles.batchRow}>
              <Text style={styles.batchLabel}>SWINGS THIS SESSION</Text>
              <View style={styles.batchPills}>
                {BATCH_OPTIONS.map(opt => {
                  const active = batchSize === opt;
                  return (
                    <TouchableOpacity
                      key={opt}
                      onPress={() => { setBatchSize(opt); setBatchIdx(0); setBatchPickerDismissed(true); }}
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
          ) : (
            <TouchableOpacity
              onPress={() => setBatchPickerDismissed(false)}
              style={styles.batchBadge}
              accessibilityRole="button"
              accessibilityLabel={`${batchSize} swing${batchSize === 1 ? '' : 's'} planned. Tap to change.`}
            >
              <Text style={styles.batchBadgeText}>
                {batchSize} swing{batchSize === 1 ? '' : 's'}{batchActive ? ` · ${batchIdx + 1}/${batchSize}` : ''} · tap to change
              </Text>
            </TouchableOpacity>
          )}
          {/* Voice trigger hint — surfaces the hands-free path one time
              per device. Hidden once tutorialsSeen marks the slug. */}
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
              void handleConfirmReady();
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="I'm set — start the 5 second countdown before recording"
          >
            <View style={styles.recordDot} />
            <Text style={styles.primaryBtnText}>I&apos;m Set · Start in 5s</Text>
          </TouchableOpacity>
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
  // 2026-05-22 — Compact "tap to change" badge replaces the full pill
  // row once the user has picked a count. Single-line, small, lives in
  // the same ctaWrap above the Start Recording button so it doesn't
  // overlap the ball box like the full picker did.
  batchBadge: {
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 200, 150, 0.12)',
    marginBottom: 6,
  },
  batchBadgeText: { color: '#00C896', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

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
