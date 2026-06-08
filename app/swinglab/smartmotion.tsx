/**
 * 2026-06-07 — Smart Motion (unified rebuild).
 *
 * The single go-to swing capture + analysis surface. Replaces the old
 * two-card SmartMotion AND the separate Cage Mode / quick-record
 * screens (those are being retired — Smart Motion captures in place).
 * Coach Mode stays separate (instructor tool).
 *
 * Design: the clean launch-monitor look from the redesign mockups,
 * rendered via the SmartMotionHud kit. Responsive — phone-portrait
 * stacks; wide screens (landscape phone, tablet, Z Fold) split into
 * capture | data so bigger screens show more at once.
 *
 * Lifecycle (state machine):
 *   setup     → live camera preview, angle toggle, acoustic status, Record
 *   recording → OPEN window (up to 60s), elapsed timer, Stop, listening
 *   analyzing → run cloud Phase-K + pose biomechanics + metric synthesis
 *   review    → captured clip + metrics/body/verdict through the HUD
 *
 * Phase 1 wires single-swing end-to-end. Phase 2 layers acoustic
 * multi-swing segmentation (open window → N strikes → per-swing reel)
 * and the 10-strike calibration onto this same screen. Phase 3 adds the
 * attached skeleton + DTL/Face-On overlays. See memory smartmotion-*.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import VideoAnnotationOverlay from '../../components/swinglab/VideoAnnotationOverlay';
import { useTheme } from '../../contexts/ThemeContext';
import { useDeviceLayout } from '../../hooks/useDeviceLayout';
import { analyzeSwing, type SwingAnalysis } from '../../services/poseDetection';
import { evaluateSwingValidity } from '../../services/swingValidity';
import {
  synthesizeSwingMetrics,
  isTruthGrade,
  type SwingMetric,
  type SwingMetricSet,
} from '../../services/swingMetricsService';
import {
  extractPoseFramesFromVideo,
  analyzeSwingFromVideo,
  type PoseFrame,
  type SwingBiomechanics,
} from '../../services/poseAnalysisApi';
import {
  startImpactRecording,
  stopAndDetectImpact,
  abortImpactRecording,
  cleanupImpactRecording,
  type ImpactReading,
} from '../../services/acousticImpactDetector';
import { detectBallSpeed, type BallSpeedResult } from '../../services/acousticDetectApi';
import { useCageStore, type PrimaryIssue } from '../../store/cageStore';
import { useAcousticCalibrationStore } from '../../store/acousticCalibrationStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useSettingsStore } from '../../store/settingsStore';
import {
  SmartMotionHeader,
  ModeToggle,
  CaptureGuides,
  MetricRail,
  SpeedStat,
  TempoBar,
  BodyAnalysisRow,
  AcousticPickupCard,
  VerdictBadge,
  FooterChips,
  type Angle,
  type MetricSpec,
  type BodyItem,
  type SmTone,
} from '../../components/smartmotion/SmartMotionHud';

const RECORDING_MAX_SECONDS = 60; // open window — player swings freely

type Phase = 'setup' | 'recording' | 'analyzing' | 'review';

// ─── data → HUD mappers ──────────────────────────────────────────────

function metricToSpec(
  key: string,
  label: string,
  m: SwingMetric,
  icon?: MetricSpec['icon'],
): MetricSpec {
  const estimate = !isTruthGrade(m.source);
  const status = m.value != null && m.range ? `${m.range[0]}–${m.range[1]}` : undefined;
  return {
    key,
    label,
    value: m.value != null ? String(m.value) : null,
    unit: m.unit || undefined,
    estimate,
    status,
    statusTone: 'neutral',
    icon,
  };
}

function degSpec(key: string, label: string, deg: number | null | undefined, icon?: MetricSpec['icon']): MetricSpec {
  return {
    key,
    label,
    value: deg != null ? String(Math.round(deg)) : null,
    unit: deg != null ? '°' : undefined,
    estimate: true,
    icon,
  };
}

// Club path is qualitative from the analyzer (we don't measure degrees
// on a phone — honesty policy). Direction word + tone, no fabricated °.
function clubPathSpec(a: SwingAnalysis | null): MetricSpec {
  let value: string | null = null;
  let statusTone: SmTone = 'neutral';
  if (a) {
    if (a.detected_issue === 'swing_path_outside_in') { value = 'OUT → IN'; statusTone = 'warn'; }
    else if (a.detected_issue === 'swing_path_inside_out') { value = 'IN → OUT'; statusTone = 'warn'; }
    else { value = 'NEUTRAL'; statusTone = 'good'; }
  }
  return { key: 'club_path', label: 'CLUB PATH', value, statusTone, estimate: true, icon: 'git-compare-outline' };
}

function deriveBodyItems(a: SwingAnalysis | null, bio: SwingBiomechanics | null): BodyItem[] {
  const fault = a?.primary_fault;
  const issue = a?.detected_issue;
  const neutral = !a;
  const sway: SmTone = neutral ? 'neutral' : fault === 'sway' || fault === 'head_movement' ? 'bad' : 'good';
  const tilt: SmTone = neutral ? 'neutral' : fault === 'reverse_pivot' || fault === 'plane_too_flat' || fault === 'plane_too_steep' ? 'warn' : 'good';
  const posture: SmTone = neutral ? 'neutral'
    : fault === 'early_extension' || fault === 'spine_angle_loss' || issue === 'early_extension' ? 'bad' : 'good';
  const weight: SmTone = neutral ? 'neutral'
    : fault === 'reverse_pivot' ? 'bad'
    : bio?.weightShiftPct != null && bio.weightShiftPct < 30 ? 'warn' : 'good';
  return [
    { key: 'sway', label: 'Sway', tone: sway, icon: 'swap-horizontal-outline' },
    { key: 'tilt', label: 'Tilt', tone: tilt, icon: 'contract-outline' },
    { key: 'posture', label: 'Posture', tone: posture, icon: 'body-outline' },
    { key: 'weight', label: 'Weight Shift', tone: weight, icon: 'scale-outline' },
  ];
}

function deriveVerdict(a: SwingAnalysis | null): { text: string; tone: SmTone } {
  if (!a) return { text: 'ANALYZING…', tone: 'neutral' };
  const validity = evaluateSwingValidity(a);
  if (!validity.valid) return { text: 'NO SWING DETECTED', tone: 'warn' };
  if (a.severity === 'none' || a.detected_issue === 'none') return { text: 'GOOD SWING', tone: 'good' };
  const headline =
    a.primary_fault && a.primary_fault !== 'no_dominant_fault' && a.primary_fault !== 'inconclusive'
      ? a.primary_fault
      : a.detected_issue;
  const text = headline.replace(/_/g, ' ').toUpperCase();
  return { text, tone: a.severity === 'significant' ? 'bad' : 'warn' };
}

// ─── screen ──────────────────────────────────────────────────────────

export default function SmartMotion() {
  const router = useRouter();
  const { colors } = useTheme();
  const { isWide } = useDeviceLayout();
  const { width: windowWidth } = useWindowDimensions();
  const { clipUri: clipUriParam, angle: angleParam } = useLocalSearchParams<{ clipUri?: string; angle?: string }>();

  const profile = usePlayerProfileStore();
  const caddiePersonality = useSettingsStore((s) => s.caddiePersonality);
  const language = useSettingsStore((s) => s.language);
  const appliedCalibration = useAcousticCalibrationStore((s) => s.appliedCalibration);
  const calibrated = !!appliedCalibration;

  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  const initialAngle: Angle = angleParam === 'face_on' || angleParam === 'face-on' ? 'face_on' : 'down_the_line';
  const [angle, setAngle] = useState<Angle>(initialAngle);

  const [phase, setPhase] = useState<Phase>(clipUriParam ? 'analyzing' : 'setup');
  const [clipUri, setClipUri] = useState<string | null>(clipUriParam ?? null);
  const [recordedSeconds, setRecordedSeconds] = useState(0);

  const [analysis, setAnalysis] = useState<SwingAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [poseFrames, setPoseFrames] = useState<PoseFrame[] | null>(null);
  const [biomech, setBiomech] = useState<SwingBiomechanics | null>(null);
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const [impact, setImpact] = useState<ImpactReading | null>(null);
  const [ballSpeed, setBallSpeed] = useState<BallSpeedResult | null>(null);
  const [page, setPage] = useState(0); // 0 = capture+metrics, 1 = analysis
  const [annotateOpen, setAnnotateOpen] = useState(false); // tap-to-freeze fullscreen markup
  const [showLayman, setShowLayman] = useState(false);
  const [coachNote, setCoachNote] = useState('');
  const pagerRef = useRef<ScrollView>(null);

  const cameraRef = useRef<CameraView>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ingestedSessionIdRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);

  const measuredBallSpeedMph = ballSpeed?.ball_speed_mph ?? null;

  const metrics: SwingMetricSet = useMemo(
    () =>
      synthesizeSwingMetrics({
        poseFrames,
        clipDurationMs: videoDurationMs,
        club: null,
        profile: { handicap: profile.handicap ?? null },
        measuredBallSpeedMph,
      }),
    [poseFrames, videoDurationMs, measuredBallSpeedMph, profile.handicap],
  );

  const railMetrics: MetricSpec[] = useMemo(
    () => [
      clubPathSpec(analysis),
      degSpec('shoulder_turn', 'SHOULDER TURN', biomech?.shoulderTurnDeg, 'sync-outline'),
      degSpec('hip_turn', 'HIP TURN', biomech?.hipTurnDeg, 'refresh-outline'),
      metricToSpec('smash', 'SMASH FACTOR', metrics.smash_factor, 'flash-outline'),
    ],
    [analysis, biomech, metrics],
  );

  const bodyItems = useMemo(() => deriveBodyItems(analysis, biomech), [analysis, biomech]);
  const verdict = useMemo(() => deriveVerdict(analysis), [analysis]);

  // Cleanup timers/recordings on unmount. C3 — if a recording is still
  // active (user hit Back mid-capture), stop the native recorder before
  // the CameraView unmounts so we don't leak the capture session / crash
  // with a surface-destroyed error on Android.
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recordTimeoutRef.current) clearTimeout(recordTimeoutRef.current);
      stoppingRef.current = true;
      // Intentionally read cameraRef at cleanup time — we want the LIVE
      // camera instance at unmount to stop an in-flight recording, not a
      // mount-time snapshot (which would be null before the camera mounts).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      try { cameraRef.current?.stopRecording(); } catch { /* no-op */ }
      void abortImpactRecording().catch(() => undefined);
    };
  }, []);

  // Run the full analysis pipeline for a clip (in-place capture OR a
  // clipUri passed in from the Library re-analyze path).
  const runAnalysis = useCallback(
    async (uri: string) => {
      setPhase('analyzing');
      setAnalysis(null);
      setAnalysisError(null);
      setPoseFrames(null);
      setBiomech(null);
      setVideoDurationMs(null);
      // M4 — each analysis is its own Library session. Reset here so the
      // in-place-capture path AND the Library re-analyze (clipUriParam)
      // path both ingest a fresh session instead of attaching a new clip
      // to a stale session id on a reused screen instance.
      ingestedSessionIdRef.current = null;

      // Library ingest (once per clip).
      try {
        if (ingestedSessionIdRef.current == null) {
          const sessionId = useCageStore.getState().ingestUploadedSwing({
            clipUri: uri,
            club: 'unknown',
            upload: {
              uploaded_at: Date.now(),
              notes: `Smart Motion ${angle === 'face_on' ? 'face-on' : 'down-the-line'} swing`,
              duration_sec: null,
              has_audio: true,
              source_device: 'phone',
              tag: null,
              swinger: profile.firstName ?? null,
              perspective: 'pov_self',
            },
            source: 'live_cage',
          });
          ingestedSessionIdRef.current = sessionId;
        }
      } catch (e) {
        console.log('[smartmotion] library ingest failed (non-fatal):', e);
      }

      // Cloud Phase-K analysis (quick tier — Smart Motion is the speed surface).
      try {
        const result = await analyzeSwing(uri, {
          club: 'unknown',
          swing_number: 1,
          caddie_name: caddiePersonality,
          angle,
          language,
          player_context: {
            handicap: profile.handicap ?? null,
            dominant_miss: profile.dominantMiss ?? null,
            first_name: profile.firstName ?? null,
          },
          tier: 'quick',
        });
        if (result.kind === 'ok') {
          setAnalysis(result.analysis);
          const sessionId = ingestedSessionIdRef.current;
          if (sessionId) {
            try {
              const a = result.analysis;
              const issueId = a.detected_issue && a.detected_issue !== 'none' ? a.detected_issue : 'smartmotion_observation';
              const primaryIssue: PrimaryIssue = {
                issue_id: issueId,
                name: issueId === 'smartmotion_observation' ? 'Smart Motion observation' : issueId.replace(/_/g, ' '),
                category: 'other',
                severity: (a.severity ?? 'minor') as PrimaryIssue['severity'],
                occurrence_count: 1,
                visual_reference_path: null,
                mechanical_breakdown: a.observation ?? 'Captured this swing.',
                feel_cue: a.follow_up_question ?? 'Re-record from another angle for a fuller read.',
                detected_in_shots: [],
                confidence: (a.confidence ?? 'medium') as PrimaryIssue['confidence'],
              };
              useCageStore.getState().setSessionAnalysis(sessionId, primaryIssue, null);
              useCageStore.getState().setSessionAnalysisStatus(sessionId, 'ok');
            } catch (e) {
              console.log('[smartmotion] attach analysis failed (non-fatal):', e);
            }
          }
        } else {
          setAnalysisError(`Analysis ${result.kind.replace('_', ' ')}`);
        }
      } catch (e) {
        setAnalysisError(e instanceof Error ? e.message : String(e));
      }

      setPhase('review');
    },
    [angle, caddiePersonality, language, profile.handicap, profile.dominantMiss, profile.firstName],
  );

  // Pose biomechanics — runs once the video reports its duration.
  useEffect(() => {
    if (!clipUri || videoDurationMs == null) return;
    let cancelled = false;
    void (async () => {
      try {
        const frames = await extractPoseFramesFromVideo(clipUri, videoDurationMs);
        if (!cancelled) setPoseFrames(frames);
        const bio = await analyzeSwingFromVideo(clipUri, videoDurationMs);
        if (!cancelled && bio) {
          setBiomech(bio);
          const sessionId = ingestedSessionIdRef.current;
          if (sessionId) {
            try {
              useCageStore.getState().setSessionBiomechanics(sessionId, bio);
            } catch { /* non-fatal */ }
          }
        }
      } catch (e) {
        console.log('[smartmotion] pose/biomech failed (non-fatal):', e);
      }
    })();
    return () => { cancelled = true; };
  }, [clipUri, videoDurationMs]);

  // Kick off analysis when a clipUri arrives from the Library param path.
  useEffect(() => {
    if (clipUriParam && phase === 'analyzing' && analysis == null && !analysisError) {
      void runAnalysis(clipUriParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipUriParam]);

  // ── capture ──
  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recordingPromiseRef.current) return;
    if (!micPerm?.granted) {
      const r = await requestMicPerm();
      if (!r.granted) {
        Alert.alert('Microphone needed', 'Smart Motion listens for ball strikes to detect your swings. Allow microphone access to record.');
        return;
      }
    }
    setImpact(null);
    setBallSpeed(null);
    setRecordedSeconds(0);
    stoppingRef.current = false;
    setPhase('recording');

    void startImpactRecording().catch(() => undefined);

    // C1 — assign the recording promise BEFORE arming the timers so a
    // fast Stop (or a microtask interleave) can't race a still-null ref
    // and orphan the real recordAsync promise.
    try {
      recordingPromiseRef.current = cameraRef.current.recordAsync({ maxDuration: RECORDING_MAX_SECONDS }) as Promise<{ uri: string } | undefined>;
    } catch (e) {
      // recordAsync threw synchronously — tear down cleanly, don't leak
      // the (not-yet-armed) timers or wedge stoppingRef.
      recordingPromiseRef.current = null;
      stoppingRef.current = false;
      void abortImpactRecording().catch(() => undefined);
      setAnalysisError(e instanceof Error ? e.message : String(e));
      setPhase('setup');
      return;
    }

    const startedAt = Date.now();
    recordTimerRef.current = setInterval(() => {
      setRecordedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 200);
    recordTimeoutRef.current = setTimeout(() => { void stopRecording(); }, RECORDING_MAX_SECONDS * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micPerm, requestMicPerm]);

  const stopRecording = useCallback(async () => {
    if (stoppingRef.current) return; // guard double-invoke (auto-stop + tap)
    stoppingRef.current = true;
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    if (recordTimeoutRef.current) { clearTimeout(recordTimeoutRef.current); recordTimeoutRef.current = null; }
    try { cameraRef.current?.stopRecording(); } catch { /* no-op */ }
    setPhase('analyzing');

    // Acoustic single-shot for now (Phase 2 = multi-strike segmentation).
    try {
      const reading = await stopAndDetectImpact();
      if (reading) {
        setImpact(reading);
        if (reading.audio_uri) {
          const speed = await detectBallSpeed({ audioUri: reading.audio_uri, impact_ms: reading.impact_ms });
          if (speed) setBallSpeed(speed);
          void cleanupImpactRecording(reading.audio_uri);
        }
      }
    } catch (e) {
      console.log('[smartmotion] acoustic chain failed (non-fatal):', e);
    }

    try {
      // C2 — watchdog: if the native recordAsync promise never settles
      // (ref torn down, stopRecording threw), don't hang forever in
      // 'analyzing'. Race it against an 8s fallback.
      const pending = recordingPromiseRef.current;
      const recorded = pending
        ? await Promise.race([
            pending,
            new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 8000)),
          ])
        : undefined;
      recordingPromiseRef.current = null;
      if (!recorded?.uri) {
        stoppingRef.current = false;
        setAnalysisError('Recording produced no file.');
        setPhase('setup');
        return;
      }
      setClipUri(recorded.uri);
      void runAnalysis(recorded.uri);
    } catch (e) {
      recordingPromiseRef.current = null;
      stoppingRef.current = false;
      setAnalysisError(e instanceof Error ? e.message : String(e));
      setPhase('setup');
    }
  }, [runAnalysis]);

  const reset = useCallback(() => {
    ingestedSessionIdRef.current = null;
    setClipUri(null);
    setAnalysis(null);
    setAnalysisError(null);
    setPoseFrames(null);
    setBiomech(null);
    setVideoDurationMs(null);
    setImpact(null);
    setBallSpeed(null);
    setPhase('setup');
  }, []);

  // Card 2 / pager handlers — declared with the other hooks (before any
  // early return) so hook order stays stable across renders.
  const openDrills = useCallback(() => {
    const issue = analysis?.detected_issue && analysis.detected_issue !== 'none' ? analysis.detected_issue : null;
    router.push((issue ? `/drills/${issue}` : '/drills') as never);
  }, [analysis, router]);
  const saveCoachNote = useCallback(() => {
    const sid = ingestedSessionIdRef.current;
    if (sid) {
      try { useCageStore.getState().setSessionCoachNote(sid, coachNote); } catch { /* non-fatal */ }
    }
  }, [coachNote]);
  const onPagerScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const w = e.nativeEvent.layoutMeasurement.width || 1;
    setPage(Math.round(e.nativeEvent.contentOffset.x / w));
  }, []);

  // ── permission gate ──
  if (!camPerm) {
    return (
      <SafeAreaView style={[styles.root, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }
  if (!camPerm.granted && phase === 'setup' && !clipUri) {
    return (
      <SafeAreaView style={[styles.root, styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Ionicons name="camera-outline" size={48} color={colors.accent} />
        <Text style={[styles.permTitle, { color: colors.text_primary }]}>Camera access needed</Text>
        <Text style={[styles.permBody, { color: colors.text_muted }]}>Smart Motion records your swing to analyze it.</Text>
        <Pressable onPress={() => void requestCamPerm()} style={[styles.primaryBtn, { backgroundColor: colors.accent }]}>
          <Text style={styles.primaryBtnText}>Grant access</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Card 2 (analysis) — plain derived value (not a hook).
  const faultHeadline = (() => {
    if (!analysis) return null;
    const f = analysis.primary_fault;
    if (f && f !== 'no_dominant_fault' && f !== 'inconclusive') return f.replace(/_/g, ' ');
    if (analysis.detected_issue && analysis.detected_issue !== 'none') return analysis.detected_issue.replace(/_/g, ' ');
    return null;
  })();

  // ── capture surface (camera live, or video replay in review) ──
  const captureSurface = (
    <View style={[styles.surface, { backgroundColor: '#000', borderColor: colors.border }]}>
      {phase === 'review' && clipUri ? (
        <Video
          source={{ uri: clipUri }}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.COVER}
          isLooping
          shouldPlay
          useNativeControls={false}
          onLoad={(s) => { if ('durationMillis' in s && s.durationMillis) setVideoDurationMs(s.durationMillis); }}
        />
      ) : (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="video" />
      )}

      {/* alignment framing guides — match the redesign mockups */}
      {phase !== 'analyzing' ? <CaptureGuides mode={angle} /> : null}

      {/* Smart Capture — tap the replay to freeze full-screen and mark up. */}
      {phase === 'review' && clipUri ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setAnnotateOpen(true)} accessibilityRole="button" accessibilityLabel="Freeze and mark up this swing">
          <View style={[styles.markupHint, { backgroundColor: colors.overlay }]}>
            <Ionicons name="brush-outline" size={13} color="#fff" />
            <Text style={styles.markupHintText}>Tap to freeze & mark up</Text>
          </View>
        </Pressable>
      ) : null}

      {/* recording overlay */}
      {phase === 'recording' ? (
        <View style={styles.recOverlay} pointerEvents="none">
          <View style={[styles.recPill, { backgroundColor: colors.overlay }]}>
            <View style={[styles.recDot, { backgroundColor: colors.error }]} />
            <Text style={styles.recText}>{recordedSeconds}s · {RECORDING_MAX_SECONDS - recordedSeconds}s left</Text>
          </View>
          <Text style={[styles.recHint, { backgroundColor: colors.overlay }]}>Swing freely — listening for your strikes</Text>
        </View>
      ) : null}

      {phase === 'analyzing' ? (
        <View style={[styles.analyzeOverlay, { backgroundColor: colors.overlay }]}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.analyzeText}>Analyzing swing…</Text>
        </View>
      ) : null}
    </View>
  );

  // ── data panel (metrics / body / verdict) ──
  const dataPanel = (
    <View style={{ gap: 10 }}>
      <AcousticPickupCard
        detected={impact != null || phase === 'review'}
        swingCount={phase === 'review' ? 1 : undefined}
        calibrated={calibrated}
      />
      {phase === 'review' ? (
        <>
          <VerdictBadge verdict={verdict.text} tone={verdict.tone} />
          {analysisError ? (
            <Text style={[styles.errText, { color: colors.warning }]}>{analysisError}</Text>
          ) : null}
          {analysis?.observation ? (
            <Text style={[styles.observation, { color: colors.text_secondary, borderColor: colors.border, backgroundColor: colors.surface_elevated }]}>
              {analysis.observation}
            </Text>
          ) : null}
          <MetricRail metrics={railMetrics} />
          <View style={styles.speedRow}>
            <SpeedStat label="CLUB SPEED" value={metrics.club_speed.value != null ? String(metrics.club_speed.value) : null} unit="mph" estimate={!isTruthGrade(metrics.club_speed.source)} />
            <SpeedStat label="BALL SPEED" value={metrics.ball_speed.value != null ? String(metrics.ball_speed.value) : null} unit="mph" estimate={!isTruthGrade(metrics.ball_speed.source)} />
            <SpeedStat label="CARRY" value={metrics.carry_yards.value != null ? String(metrics.carry_yards.value) : null} unit="yds" estimate={!isTruthGrade(metrics.carry_yards.source)} />
          </View>
          <TempoBar ratio={null} />
          <BodyAnalysisRow items={bodyItems} />
          <FooterChips club={null} shot={1} distanceYds={metrics.carry_yards.value} />
        </>
      ) : null}
    </View>
  );

  // ── Card 2: analysis / drills / coach notes (kept from old SmartMotion) ──
  const insightBlock = (
    <View style={{ gap: 10 }}>
      <View style={styles.cardHeaderRow}>
        <Ionicons name="bulb-outline" size={16} color={colors.accent} />
        <Text style={[styles.cardHeader, { color: colors.text_primary }]}>ANALYSIS</Text>
      </View>

      {phase !== 'review' ? (
        <Text style={[styles.muted, { color: colors.text_muted }]}>Record a swing to see your full breakdown, drill, and notes here.</Text>
      ) : analysis == null ? (
        <Text style={[styles.muted, { color: colors.text_muted }]}>{analysisError ?? 'No analysis available for this swing.'}</Text>
      ) : (
        <>
          {faultHeadline ? (
            <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
              <Text style={[styles.insightLabel, { color: colors.text_muted }]}>TOP FOCUS</Text>
              <Text style={[styles.insightHeadline, { color: colors.text_primary }]}>{faultHeadline.toUpperCase()}</Text>
              <Text style={[styles.insightConf, { color: colors.text_muted }]}>Confidence: {analysis.confidence ?? 'medium'}</Text>
            </View>
          ) : null}

          {analysis.observation ? (
            <Text style={[styles.insightBody, { color: colors.text_secondary, backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
              {analysis.observation}
            </Text>
          ) : null}

          {analysis.cause ? (
            <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
              <Text style={[styles.insightLabel, { color: colors.text_muted }]}>WHY IT HAPPENS</Text>
              <Text style={[styles.insightText, { color: colors.text_secondary }]}>{analysis.cause}</Text>
            </View>
          ) : null}

          {analysis.fix ? (
            <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.accent }]}>
              <Text style={[styles.insightLabel, { color: colors.accent }]}>THE FIX</Text>
              <Text style={[styles.insightText, { color: colors.text_primary }]}>{analysis.fix}</Text>
            </View>
          ) : null}

          {analysis.drill ? (
            <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
              <Text style={[styles.insightLabel, { color: colors.text_muted }]}>RECOMMENDED DRILL</Text>
              <Text style={[styles.insightText, { color: colors.text_secondary }]}>{analysis.drill}</Text>
            </View>
          ) : null}

          {analysis.layman_explanation ? (
            <Pressable onPress={() => setShowLayman((v) => !v)} style={[styles.laymanToggle, { borderColor: colors.border }]}>
              <Ionicons name={showLayman ? 'chevron-up' : 'help-circle-outline'} size={15} color={colors.accent} />
              <Text style={[styles.laymanToggleText, { color: colors.accent }]}>{showLayman ? 'Hide' : 'What does this mean?'}</Text>
            </Pressable>
          ) : null}
          {showLayman && analysis.layman_explanation ? (
            <Text style={[styles.insightText, { color: colors.text_secondary }]}>{analysis.layman_explanation}</Text>
          ) : null}

          <Pressable onPress={openDrills} style={[styles.secondaryBtn, { borderColor: colors.accent }]}>
            <Ionicons name="library-outline" size={16} color={colors.accent} />
            <Text style={[styles.secondaryBtnText, { color: colors.accent }]}>Open drills</Text>
          </Pressable>

          {/* Coach notes — kept from the swing-detail flow. */}
          <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
            <Text style={[styles.insightLabel, { color: colors.text_muted }]}>COACH NOTES</Text>
            <TextInput
              value={coachNote}
              onChangeText={setCoachNote}
              onBlur={saveCoachNote}
              placeholder="Add a note for this swing…"
              placeholderTextColor={colors.text_muted}
              multiline
              style={[styles.noteInput, { color: colors.text_primary, borderColor: colors.border }]}
            />
            <Pressable onPress={saveCoachNote} style={[styles.secondaryBtn, { borderColor: colors.border, marginTop: 8 }]}>
              <Ionicons name="save-outline" size={15} color={colors.text_secondary} />
              <Text style={[styles.secondaryBtnText, { color: colors.text_secondary }]}>Save note</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );

  // ── action button (Record / Stop / Re-record) ──
  const actionBtn =
    phase === 'recording' ? (
      <Pressable onPress={() => void stopRecording()} style={[styles.primaryBtn, { backgroundColor: colors.error }]}>
        <Ionicons name="stop" size={18} color="#fff" />
        <Text style={styles.primaryBtnText}>Stop</Text>
      </Pressable>
    ) : phase === 'review' ? (
      <Pressable onPress={reset} style={[styles.primaryBtn, { backgroundColor: colors.accent }]}>
        <Ionicons name="refresh" size={18} color="#06281b" />
        <Text style={[styles.primaryBtnText, { color: '#06281b' }]}>Record another</Text>
      </Pressable>
    ) : phase === 'setup' ? (
      <Pressable onPress={() => void startRecording()} style={[styles.primaryBtn, { backgroundColor: colors.accent }]}>
        <Ionicons name="radio-button-on" size={18} color="#06281b" />
        <Text style={[styles.primaryBtnText, { color: '#06281b' }]}>Record</Text>
      </Pressable>
    ) : null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>
        <SmartMotionHeader mode={angle} style={{ flex: 1, borderBottomWidth: 0, paddingVertical: 0 }} />
      </View>

      {isWide ? (
        // Wide / split-screen: capture left, both data + analysis cards
        // visible on the right (cleaner than swiping on a big screen).
        <View style={styles.splitRow}>
          <View style={styles.splitLeft}>
            {captureSurface}
            <ModeToggle value={angle} onChange={setAngle} style={{ marginTop: 10 }} />
            {actionBtn}
          </View>
          <ScrollView style={styles.splitRight} contentContainerStyle={{ paddingBottom: 24, gap: 14 }} showsVerticalScrollIndicator={false}>
            {dataPanel}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            {insightBlock}
          </ScrollView>
        </View>
      ) : (
        // Phone-portrait: two cards, swipe left/right.
        <>
          <View style={styles.dotsRow}>
            {[0, 1].map((i) => (
              <View key={i} style={[styles.dot, { backgroundColor: page === i ? colors.accent : colors.border }]} />
            ))}
            <Text style={[styles.swipeHint, { color: colors.text_muted }]}>
              {page === 0 ? 'Swipe for analysis →' : '← Swipe back to capture'}
            </Text>
          </View>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onPagerScroll}
          >
            <ScrollView style={{ width: windowWidth }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {captureSurface}
              <ModeToggle value={angle} onChange={setAngle} style={{ marginTop: 10 }} />
              {actionBtn}
              <View style={{ marginTop: 12 }}>{dataPanel}</View>
            </ScrollView>
            <ScrollView style={{ width: windowWidth }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {insightBlock}
            </ScrollView>
          </ScrollView>
        </>
      )}

      {/* Smart Capture markup — fullscreen frozen frame + draw tools
          (lines / circles / straight-plane / ROI), kept from old SmartMotion. */}
      <Modal visible={annotateOpen} animationType="fade" onRequestClose={() => setAnnotateOpen(false)} supportedOrientations={['portrait', 'landscape']}>
        <View style={styles.markupRoot}>
          {clipUri ? (
            <Video source={{ uri: clipUri }} style={StyleSheet.absoluteFill} resizeMode={ResizeMode.CONTAIN} shouldPlay={false} useNativeControls={false} />
          ) : null}
          <VideoAnnotationOverlay />
          <Pressable onPress={() => setAnnotateOpen(false)} style={styles.markupClose} accessibilityRole="button" accessibilityLabel="Close markup">
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },

  scroll: { padding: 12, paddingBottom: 32 },
  splitRow: { flex: 1, flexDirection: 'row', padding: 12, gap: 14 },
  splitLeft: { flex: 1.3 },
  splitRight: { flex: 1, maxWidth: 380 },

  surface: { width: '100%', aspectRatio: 3 / 4, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },

  recOverlay: { position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center', gap: 8 },
  recPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  recText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  recHint: { color: '#fff', fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, overflow: 'hidden' },

  analyzeOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10 },
  analyzeText: { color: '#fff', fontWeight: '700' },

  speedRow: { flexDirection: 'row', gap: 8 },

  observation: { fontSize: 13, lineHeight: 19, fontWeight: '500', padding: 10, borderWidth: 1, borderRadius: 12 },
  errText: { fontSize: 12, fontWeight: '700' },

  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, marginTop: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  permTitle: { fontSize: 18, fontWeight: '800' },
  permBody: { fontSize: 14, textAlign: 'center' },

  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  swipeHint: { marginLeft: 6, fontSize: 11, fontWeight: '600' },
  divider: { height: 1, marginVertical: 2 },

  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardHeader: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  muted: { fontSize: 13, lineHeight: 19, fontWeight: '500' },

  insightCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  insightLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  insightHeadline: { fontSize: 17, fontWeight: '900', letterSpacing: 0.3 },
  insightConf: { fontSize: 11, fontWeight: '600' },
  insightBody: { fontSize: 13, lineHeight: 19, fontWeight: '500', padding: 12, borderWidth: 1, borderRadius: 12 },
  insightText: { fontSize: 13, lineHeight: 19, fontWeight: '500' },

  laymanToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  laymanToggleText: { fontSize: 12, fontWeight: '700' },

  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingVertical: 11 },
  secondaryBtnText: { fontSize: 13, fontWeight: '800' },

  noteInput: { minHeight: 60, borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 13, textAlignVertical: 'top', marginTop: 6 },

  markupHint: { position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  markupHintText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  markupRoot: { flex: 1, backgroundColor: '#000' },
  markupClose: { position: 'absolute', top: 44, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
});
