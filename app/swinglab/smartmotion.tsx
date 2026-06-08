/**
 * 2026-06-07 — Smart Motion (unified rebuild, overlay HUD).
 *
 * The single go-to swing capture + analysis surface. Replaces the old
 * two-card SmartMotion AND the retired Cage Mode / quick-record screens
 * (Smart Motion captures in place). Coach Mode stays separate.
 *
 * Design — matches the redesign mockups (~/Downloads/SmartMotion
 * Redesign Pics): a FULL-BLEED camera/replay with the data cleanly
 * OVERLAID on top (floating metric rail + bottom strip), never shrinking
 * the picture. Fills the screen on any size and re-lays-out live on Z
 * Fold open/close. Two cards: swipe right → analysis / drills / coach
 * notes. Tap the replay → fullscreen freeze + markup.
 *
 * Lifecycle: setup → recording (OPEN ~60s window) → analyzing → review.
 * Acoustic engine: a metered audio track runs alongside the video; on
 * stop, detectStrikes() finds every ball strike → segmentsFromStrikes()
 * carves the clip into per-swing segments → a reel to scrub between them.
 * See memory smartmotion-rebuild / -metrics-honesty / -quality-bar /
 * acoustic-10-strike-calibration.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import VideoAnnotationOverlay from '../../components/swinglab/VideoAnnotationOverlay';
import SwingBodyOverlay from '../../components/swinglab/SwingBodyOverlay';
import { CaddieMicBadge } from '../../components/caddie/CaddieMicBadge';
import { useTheme } from '../../contexts/ThemeContext';
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
  deriveSwingTempo,
  type PoseFrame,
  type SwingBiomechanics,
  type SwingTempo,
} from '../../services/poseAnalysisApi';
import { startMeteredRecording, type MeteringHandle } from '../../services/swing/audioMetering';
import { detectStrikes } from '../../services/swing/strikeDetector';
import { segmentsFromStrikes, confirmedCount, type SwingSegment } from '../../services/swing/swingSegmentation';
import { detectBallSpeed, type BallSpeedResult } from '../../services/acousticDetectApi';
import { useCageStore, type PrimaryIssue } from '../../store/cageStore';
import { useFamilyStore } from '../../store/familyStore';
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

function metricToSpec(key: string, label: string, m: SwingMetric, icon?: MetricSpec['icon']): MetricSpec {
  return {
    key,
    label,
    value: m.value != null ? String(m.value) : null,
    unit: m.unit || undefined,
    estimate: !isTruthGrade(m.source),
    status: m.value != null && m.range ? `${m.range[0]}–${m.range[1]}` : undefined,
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

// Club path is qualitative (we don't measure degrees on a phone).
function clubPathSpec(a: SwingAnalysis | null): MetricSpec {
  let value: string | null = null;
  let statusTone: SmTone = 'neutral';
  if (a) {
    if (a.detected_issue === 'swing_path_outside_in') { value = 'OUT→IN'; statusTone = 'warn'; }
    else if (a.detected_issue === 'swing_path_inside_out') { value = 'IN→OUT'; statusTone = 'warn'; }
    else { value = 'NEUTRAL'; statusTone = 'good'; }
  }
  return { key: 'club_path', label: 'CLUB PATH', value, statusTone, estimate: true, icon: 'git-compare-outline' };
}

function deriveBodyItems(a: SwingAnalysis | null, bio: SwingBiomechanics | null): BodyItem[] {
  const fault = a?.primary_fault;
  const issue = a?.detected_issue;
  const n = !a;
  const sway: SmTone = n ? 'neutral' : fault === 'sway' || fault === 'head_movement' ? 'bad' : 'good';
  const tilt: SmTone = n ? 'neutral' : fault === 'reverse_pivot' || fault === 'plane_too_flat' || fault === 'plane_too_steep' ? 'warn' : 'good';
  const posture: SmTone = n ? 'neutral' : fault === 'early_extension' || fault === 'spine_angle_loss' || issue === 'early_extension' ? 'bad' : 'good';
  const weight: SmTone = n ? 'neutral' : fault === 'reverse_pivot' ? 'bad' : bio?.weightShiftPct != null && bio.weightShiftPct < 30 ? 'warn' : 'good';
  return [
    { key: 'sway', label: 'Sway', tone: sway, icon: 'swap-horizontal-outline' },
    { key: 'tilt', label: 'Tilt', tone: tilt, icon: 'contract-outline' },
    { key: 'posture', label: 'Posture', tone: posture, icon: 'body-outline' },
    { key: 'weight', label: 'Weight', tone: weight, icon: 'scale-outline' },
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
  return { text: headline.replace(/_/g, ' ').toUpperCase(), tone: a.severity === 'significant' ? 'bad' : 'warn' };
}

// ─── screen ──────────────────────────────────────────────────────────

export default function SmartMotion() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
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
  const [ballSpeed, setBallSpeed] = useState<BallSpeedResult | null>(null);
  const [liveDb, setLiveDb] = useState<number | null>(null);
  const [segments, setSegments] = useState<SwingSegment[]>([]);
  const [selectedSwing, setSelectedSwing] = useState(0);

  const [page, setPage] = useState(0);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [showLayman, setShowLayman] = useState(false);
  const [coachNote, setCoachNote] = useState('');
  const [playbackMs, setPlaybackMs] = useState(0);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [tempo, setTempo] = useState<SwingTempo | null>(null);
  const [swingAnalyzing, setSwingAnalyzing] = useState(false);
  const analysisCacheRef = useRef<Record<number, SwingAnalysis>>({});

  const cameraRef = useRef<CameraView>(null);
  const videoRef = useRef<Video>(null);
  const pagerRef = useRef<ScrollView>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ingestedSessionIdRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);
  const meteringRef = useRef<MeteringHandle | null>(null);
  const audioUriRef = useRef<string | null>(null);

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
      degSpec('shoulder_turn', 'SHOULDER', biomech?.shoulderTurnDeg, 'sync-outline'),
      degSpec('hip_turn', 'HIP TURN', biomech?.hipTurnDeg, 'refresh-outline'),
      metricToSpec('smash', 'SMASH', metrics.smash_factor, 'flash-outline'),
    ],
    [analysis, biomech, metrics],
  );

  const bodyItems = useMemo(() => deriveBodyItems(analysis, biomech), [analysis, biomech]);
  const verdict = useMemo(() => deriveVerdict(analysis), [analysis]);
  const faultHeadline = useMemo(() => {
    if (!analysis) return null;
    const f = analysis.primary_fault;
    if (f && f !== 'no_dominant_fault' && f !== 'inconclusive') return f.replace(/_/g, ' ');
    if (analysis.detected_issue && analysis.detected_issue !== 'none') return analysis.detected_issue.replace(/_/g, ' ');
    return null;
  }, [analysis]);

  // Cleanup on unmount — stop an in-flight recording + metering.
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recordTimeoutRef.current) clearTimeout(recordTimeoutRef.current);
      stoppingRef.current = true;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      try { cameraRef.current?.stopRecording(); } catch { /* no-op */ }
      void meteringRef.current?.cancel().catch(() => undefined);
    };
  }, []);

  const runAnalysis = useCallback(
    async (uri: string, segment?: SwingSegment) => {
      setPhase('analyzing');
      setAnalysis(null);
      setAnalysisError(null);
      setPoseFrames(null);
      setBiomech(null);
      setVideoDurationMs(null);
      ingestedSessionIdRef.current = null;
      analysisCacheRef.current = {};
      const boundaries = segment ? { startSec: segment.startMs / 1000, endSec: segment.endMs / 1000 } : undefined;

      try {
        // Coach Mode attribution: when a family member is active (coach
        // recording a student / parent recording a kid), persist the
        // swing under THAT member with perspective 'watching_someone' so
        // analysis routes correctly — same threading the old screen used.
        const fam = useFamilyStore.getState();
        const activeMember = fam.active_member_id
          ? fam.members.find((m) => m.id === fam.active_member_id) ?? null
          : null;
        const swinger = activeMember?.firstName ?? profile.firstName ?? null;
        const perspective: 'pov_self' | 'watching_someone' = activeMember ? 'watching_someone' : 'pov_self';
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
            swinger,
            perspective,
          },
          source: 'live_cage',
        });
        ingestedSessionIdRef.current = sessionId;
      } catch (e) {
        console.log('[smartmotion] library ingest failed (non-fatal):', e);
      }

      try {
        // 30s watchdog so a hung network call can't strand the screen on
        // the "Analyzing…" overlay with no way out.
        const result = await Promise.race([
          analyzeSwing(uri, {
            club: 'unknown',
            swing_number: segment?.index ?? 1,
            caddie_name: caddiePersonality,
            angle,
            language,
            player_context: {
              handicap: profile.handicap ?? null,
              dominant_miss: profile.dominantMiss ?? null,
              first_name: profile.firstName ?? null,
            },
            tier: 'quick',
          }, boundaries),
          new Promise<Awaited<ReturnType<typeof analyzeSwing>>>((resolve) =>
            setTimeout(() => resolve({ kind: 'error', message: 'Analysis timed out' }), 30000),
          ),
        ]);
        if (result.kind === 'ok') {
          setAnalysis(result.analysis);
          analysisCacheRef.current[(segment?.index ?? 1) - 1] = result.analysis;
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

  // Pose biomechanics once the video reports its duration.
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
            try { useCageStore.getState().setSessionBiomechanics(sessionId, bio); } catch { /* non-fatal */ }
          }
        }
      } catch (e) {
        console.log('[smartmotion] pose/biomech failed (non-fatal):', e);
      }
    })();
    return () => { cancelled = true; };
  }, [clipUri, videoDurationMs]);

  // Acoustic-anchored tempo for the selected swing. Impact comes from the
  // acoustic strike detector (segment.strikeMs); top-of-backswing is read
  // from pose. Recomputes when the selected swing changes.
  useEffect(() => {
    const seg = segments[selectedSwing];
    if (!clipUri || !seg || seg.strikeMs == null) { setTempo(null); return; }
    let cancelled = false;
    setTempo(null);
    void (async () => {
      try {
        const t = await deriveSwingTempo(clipUri, seg.strikeMs);
        if (!cancelled) setTempo(t);
      } catch (e) {
        console.log('[smartmotion] tempo derive failed (non-fatal):', e);
        if (!cancelled) setTempo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [clipUri, segments, selectedSwing]);

  // Library re-analyze (clipUriParam) path.
  useEffect(() => {
    if (clipUriParam && phase === 'analyzing' && analysis == null && !analysisError) {
      void runAnalysis(clipUriParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipUriParam]);

  const reset = useCallback(() => {
    ingestedSessionIdRef.current = null;
    audioUriRef.current = null;
    recordingPromiseRef.current = null;
    stoppingRef.current = false;
    setClipUri(null);
    setAnalysis(null);
    setAnalysisError(null);
    setPoseFrames(null);
    setBiomech(null);
    setVideoDurationMs(null);
    setBallSpeed(null);
    setLiveDb(null);
    setSegments([]);
    setSelectedSwing(0);
    setCoachNote('');
    setPage(0);
    pagerRef.current?.scrollTo({ x: 0, animated: false });
    setPhase('setup');
  }, []);

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

  const selectSwing = useCallback(
    async (idx: number) => {
      const seg = segments[idx];
      if (!seg) return;
      setSelectedSwing(idx);
      videoRef.current?.setPositionAsync(seg.startMs).catch(() => undefined);
      videoRef.current?.playAsync().catch(() => undefined);

      const cached = analysisCacheRef.current[idx];
      if (cached) { setAnalysis(cached); return; }
      if (!clipUri) return;
      // Per-swing analysis on demand — windowed to this segment.
      setSwingAnalyzing(true);
      try {
        const r = await Promise.race([
          analyzeSwing(clipUri, {
            club: 'unknown',
            swing_number: seg.index,
            caddie_name: caddiePersonality,
            angle,
            language,
            player_context: {
              handicap: profile.handicap ?? null,
              dominant_miss: profile.dominantMiss ?? null,
              first_name: profile.firstName ?? null,
            },
            tier: 'quick',
          }, { startSec: seg.startMs / 1000, endSec: seg.endMs / 1000 }),
          new Promise<Awaited<ReturnType<typeof analyzeSwing>>>((resolve) =>
            setTimeout(() => resolve({ kind: 'error', message: 'Analysis timed out' }), 30000),
          ),
        ]);
        if (r.kind === 'ok') {
          setAnalysis(r.analysis);
          analysisCacheRef.current[idx] = r.analysis;
        }
      } catch { /* keep prior analysis on failure */ }
      setSwingAnalyzing(false);
    },
    [segments, clipUri, angle, caddiePersonality, language, profile.handicap, profile.dominantMiss, profile.firstName],
  );

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recordingPromiseRef.current) return;
    if (!micPerm?.granted) {
      const r = await requestMicPerm();
      if (!r.granted) {
        Alert.alert('Microphone needed', 'Smart Motion listens for ball strikes to detect your swings. Allow microphone access to record.');
        return;
      }
    }
    setBallSpeed(null);
    setSegments([]);
    setSelectedSwing(0);
    setLiveDb(null);
    setRecordedSeconds(0);
    stoppingRef.current = false;
    setPhase('recording');

    // Parallel metered audio track for multi-strike detection.
    try {
      meteringRef.current = await startMeteredRecording((s) => setLiveDb(s.dB));
    } catch {
      meteringRef.current = null;
    }

    // Assign the camera promise BEFORE arming timers (avoid the stop race).
    try {
      recordingPromiseRef.current = cameraRef.current.recordAsync({ maxDuration: RECORDING_MAX_SECONDS }) as Promise<{ uri: string } | undefined>;
    } catch (e) {
      recordingPromiseRef.current = null;
      stoppingRef.current = false;
      void meteringRef.current?.cancel().catch(() => undefined);
      meteringRef.current = null;
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
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    if (recordTimeoutRef.current) { clearTimeout(recordTimeoutRef.current); recordTimeoutRef.current = null; }
    try { cameraRef.current?.stopRecording(); } catch { /* no-op */ }
    setPhase('analyzing');

    // Stop metering → strikes → segments.
    let detectedSegments: SwingSegment[] = [];
    let firstStrikeMs: number | null = null;
    try {
      if (meteringRef.current) {
        const { samples, uri, durationMs } = await meteringRef.current.stop();
        meteringRef.current = null;
        audioUriRef.current = uri;
        const res = detectStrikes(samples, { thresholdDb: appliedCalibration?.transientThresholdDb });
        if (res.kind === 'ok' && res.strikes.length > 0) {
          detectedSegments = segmentsFromStrikes(res.strikes, durationMs);
          firstStrikeMs = res.strikes[0]?.timeMs ?? null;
        }
      }
    } catch (e) {
      console.log('[smartmotion] metering/segmentation failed (non-fatal):', e);
    }
    setSegments(detectedSegments);
    setSelectedSwing(0);

    // Best-effort ball speed for the first swing.
    if (audioUriRef.current && firstStrikeMs != null) {
      try {
        const speed = await detectBallSpeed({ audioUri: audioUriRef.current, impact_ms: firstStrikeMs });
        if (speed) setBallSpeed(speed);
      } catch { /* non-fatal */ }
    }

    try {
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
      // Analyze the FIRST detected swing windowed to its segment; other
      // swings analyze on-demand when selected in the reel.
      void runAnalysis(recorded.uri, detectedSegments[0]);
    } catch (e) {
      recordingPromiseRef.current = null;
      stoppingRef.current = false;
      setAnalysisError(e instanceof Error ? e.message : String(e));
      setPhase('setup');
    }
  }, [runAnalysis, appliedCalibration]);

  // ── permission gate ──
  if (!camPerm) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!camPerm.granted && phase === 'setup' && !clipUri) {
    return (
      <View style={[styles.root, styles.center, { padding: 24 }]}>
        <Ionicons name="camera-outline" size={48} color={colors.accent} />
        <Text style={[styles.permTitle, { color: colors.text_primary }]}>Camera access needed</Text>
        <Text style={[styles.permBody, { color: colors.text_muted }]}>Smart Motion records your swing to analyze it.</Text>
        <Pressable onPress={() => void requestCamPerm()} style={[styles.primaryBtn, { backgroundColor: colors.accent }]}>
          <Text style={[styles.primaryBtnText, { color: '#06281b' }]}>Grant access</Text>
        </Pressable>
      </View>
    );
  }

  const isReview = phase === 'review';

  // ── action button ──
  const actionBtn =
    phase === 'recording' ? (
      <Pressable onPress={() => void stopRecording()} style={[styles.actionBtn, { backgroundColor: colors.error }]}>
        <Ionicons name="stop" size={18} color="#fff" />
        <Text style={styles.actionBtnText}>Stop</Text>
      </Pressable>
    ) : isReview ? (
      <Pressable onPress={reset} style={[styles.actionBtn, { backgroundColor: colors.accent }]}>
        <Ionicons name="refresh" size={18} color="#06281b" />
        <Text style={[styles.actionBtnText, { color: '#06281b' }]}>Record again</Text>
      </Pressable>
    ) : phase === 'setup' ? (
      <Pressable onPress={() => void startRecording()} style={[styles.actionBtn, { backgroundColor: colors.accent }]}>
        <Ionicons name="radio-button-on" size={18} color="#06281b" />
        <Text style={[styles.actionBtnText, { color: '#06281b' }]}>Record</Text>
      </Pressable>
    ) : (
      <View style={styles.actionBtn} />
    );

  // ── pause / scrub to a swing position (skeleton attached) ──
  const seekToPosition = (pos: NonNullable<PoseFrame['position']>) => {
    const f = poseFrames?.find((p) => p.position === pos);
    if (f) {
      videoRef.current?.setPositionAsync(f.timestampMs).catch(() => undefined);
      videoRef.current?.pauseAsync().catch(() => undefined);
    }
  };
  const P_SCRUB: { key: NonNullable<PoseFrame['position']>; label: string }[] = [
    { key: 'P1_address', label: 'Address' },
    { key: 'P4_top', label: 'Top' },
    { key: 'P6_impact', label: 'Impact' },
    { key: 'P10_finish', label: 'Finish' },
  ];
  const skeletonRow =
    isReview && poseFrames && poseFrames.length > 0 ? (
      <View style={styles.skelRow}>
        <Pressable
          onPress={() => setShowSkeleton((v) => !v)}
          style={[styles.skelToggle, { borderColor: showSkeleton ? colors.accent : 'rgba(255,255,255,0.3)', backgroundColor: showSkeleton ? colors.accent_muted : 'rgba(0,0,0,0.4)' }]}
        >
          <Ionicons name="body-outline" size={13} color={showSkeleton ? colors.accent : '#fff'} />
          <Text style={[styles.skelToggleText, { color: showSkeleton ? colors.accent : '#fff' }]}>Skeleton</Text>
        </Pressable>
        {P_SCRUB.map((p) => (
          <Pressable key={p.key} onPress={() => seekToPosition(p.key)} style={styles.scrubChip}>
            <Text style={styles.scrubChipText}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
    ) : null;

  // ── swing reel (multi-swing) ──
  const reel =
    isReview && segments.length > 1 ? (
      <View style={styles.reelWrap}>
        <Text style={[styles.reelLabel, { color: '#fff' }]}>{confirmedCount(segments)} SWINGS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {segments.map((s, i) => {
            const sel = i === selectedSwing;
            const tone = s.confidence === 'low' ? colors.warning : colors.accent;
            return (
              <Pressable
                key={i}
                onPress={() => void selectSwing(i)}
                style={[styles.reelChip, { borderColor: sel ? tone : 'rgba(255,255,255,0.3)', backgroundColor: sel ? tone : 'rgba(0,0,0,0.5)' }]}
              >
                <Text style={[styles.reelChipText, { color: sel ? '#06281b' : '#fff' }]}>{s.index}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    ) : null;

  // ── the HUD page (full-bleed camera/replay + floating data) ──
  const hudPage = (
    <View style={{ width: windowWidth, flex: 1 }}>
      <View style={styles.captureRoot}>
        {isReview && clipUri ? (
          <Video
            ref={videoRef}
            source={{ uri: clipUri }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            isLooping
            shouldPlay
            useNativeControls={false}
            onLoad={(s) => { if ('durationMillis' in s && s.durationMillis) setVideoDurationMs(s.durationMillis); }}
            onPlaybackStatusUpdate={(s) => { if ('positionMillis' in s && typeof s.positionMillis === 'number') setPlaybackMs(s.positionMillis); }}
          />
        ) : (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="video" />
        )}

        {/* Smart Capture — tap exposed video to freeze + mark up. */}
        {isReview && clipUri ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAnnotateOpen(true)} accessibilityRole="button" accessibilityLabel="Freeze and mark up this swing" />
        ) : null}

        {/* Attached skeletal overlay — real keypoints tracked to playback. */}
        {isReview && showSkeleton && poseFrames && poseFrames.length > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <SwingBodyOverlay frames={poseFrames} currentTimeMs={playbackMs} showSkeleton showTrace={false} />
          </View>
        ) : null}

        {phase !== 'analyzing' ? <CaptureGuides mode={angle} /> : null}

        {/* TOP BAR (interactive) */}
        <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
          <CaddieMicBadge size={36} />
          <SmartMotionHeader mode={angle} style={{ flex: 1, borderBottomWidth: 0, paddingVertical: 0, paddingHorizontal: 6 }} />
          <View style={styles.dotsRow}>
            {[0, 1].map((i) => (
              <View key={i} style={[styles.dot, { backgroundColor: page === i ? colors.accent : 'rgba(255,255,255,0.35)' }]} />
            ))}
          </View>
        </View>

        {/* RIGHT RAIL — floating metric cards (review) */}
        {isReview ? (
          <View style={[styles.rightRail, { top: insets.top + 60 }]}>
            <MetricRail metrics={railMetrics} />
          </View>
        ) : null}

        {/* RECORDING timer */}
        {phase === 'recording' ? (
          <View style={[styles.recPill, { top: insets.top + 56, backgroundColor: colors.overlay }]} pointerEvents="none">
            <View style={[styles.recDot, { backgroundColor: colors.error }]} />
            <Text style={styles.recText}>{recordedSeconds}s · {RECORDING_MAX_SECONDS - recordedSeconds}s left</Text>
          </View>
        ) : null}

        {/* ANALYZING */}
        {phase === 'analyzing' ? (
          <View style={[styles.analyzeOverlay, { backgroundColor: colors.overlay }]} pointerEvents="none">
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.analyzeText}>Analyzing swing…</Text>
          </View>
        ) : null}

        {/* BOTTOM PANEL — floating data + controls */}
        <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 8 }]}>
          {/* REVIEW STATS — speed cards, tempo, body analysis (matches redesign) */}
          {isReview ? (
            <>
              {skeletonRow}
              <View style={styles.speedRow}>
                <SpeedStat
                  label="CLUB"
                  value={metrics.club_speed.value != null ? String(metrics.club_speed.value) : null}
                  unit="mph"
                  estimate={!isTruthGrade(metrics.club_speed.source)}
                  style={{ flex: 1 }}
                />
                <SpeedStat
                  label="BALL"
                  value={metrics.ball_speed.value != null ? String(metrics.ball_speed.value) : null}
                  unit="mph"
                  estimate={!isTruthGrade(metrics.ball_speed.source)}
                  style={{ flex: 1 }}
                />
                <SpeedStat
                  label="CARRY"
                  value={metrics.carry_yards.value != null ? String(metrics.carry_yards.value) : null}
                  unit="yds"
                  estimate={!isTruthGrade(metrics.carry_yards.source)}
                  style={{ flex: 1 }}
                />
              </View>
              <TempoBar ratio={tempo?.ratio ?? null} />
              <BodyAnalysisRow items={bodyItems} />
            </>
          ) : null}

          {reel}

          <View style={styles.controlsRow}>
            <View style={{ flex: 1 }}>
              <AcousticPickupCard
                detected={phase === 'recording' ? liveDb != null && liveDb > -30 : segments.length > 0}
                swingCount={isReview ? confirmedCount(segments) : undefined}
                calibrated={calibrated}
              />
            </View>
            {isReview ? <VerdictBadge verdict={verdict.text} tone={verdict.tone} style={{ flex: 1 }} /> : null}
          </View>

          {!calibrated ? (
            <Pressable onPress={() => router.push('/swinglab/calibrate' as never)} style={[styles.calibrateLink, { borderColor: colors.accent }]}>
              <Ionicons name="options-outline" size={14} color={colors.accent} />
              <Text style={[styles.calibrateText, { color: colors.accent }]}>Calibrate acoustics (10 strikes)</Text>
            </Pressable>
          ) : null}

          <View style={styles.controlsRow}>
            <ModeToggle value={angle} onChange={setAngle} style={{ flex: 1 }} />
            <View style={{ width: 130 }}>{actionBtn}</View>
          </View>

          <FooterChips club={null} shot={isReview ? selectedSwing + 1 : null} distanceYds={isReview ? metrics.carry_yards.value : null} />
        </View>
      </View>
    </View>
  );

  // ── the analysis page (swipe right) ──
  const analysisPage = (
    <ScrollView
      style={{ width: windowWidth, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 14, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24, gap: 10 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.cardHeaderRow}>
        <Ionicons name="bulb-outline" size={16} color={colors.accent} />
        <Text style={[styles.cardHeader, { color: colors.text_primary }]}>ANALYSIS</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => pagerRef.current?.scrollTo({ x: 0, animated: true })} hitSlop={8} style={styles.backChip}>
          <Ionicons name="chevron-back" size={14} color={colors.text_muted} />
          <Text style={[styles.backChipText, { color: colors.text_muted }]}>Capture</Text>
        </Pressable>
      </View>

      {isReview && segments.length > 1 ? (
        <View style={styles.swingTag}>
          <Text style={[styles.swingTagText, { color: colors.text_muted }]}>SWING {selectedSwing + 1} OF {segments.length}</Text>
          {swingAnalyzing ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        </View>
      ) : null}

      {!isReview ? (
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
            <Text style={[styles.insightBody, { color: colors.text_secondary, backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>{analysis.observation}</Text>
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
    </ScrollView>
  );

  return (
    <View style={[styles.root, { backgroundColor: '#000' }]}>
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        scrollEnabled={phase !== 'recording'}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPagerScroll}
        keyboardShouldPersistTaps="handled"
      >
        {hudPage}
        {analysisPage}
      </ScrollView>

      {/* Smart Capture markup — fullscreen frozen frame + draw tools. */}
      <Modal visible={annotateOpen} animationType="fade" onRequestClose={() => setAnnotateOpen(false)} supportedOrientations={['portrait', 'landscape']}>
        <View style={styles.markupRoot}>
          {clipUri ? (
            <Video source={{ uri: clipUri }} style={StyleSheet.absoluteFill} resizeMode={ResizeMode.CONTAIN} shouldPlay={false} useNativeControls={false} />
          ) : null}
          <VideoAnnotationOverlay />
          <Pressable onPress={() => setAnnotateOpen(false)} style={[styles.markupClose, { top: insets.top + 8 }]} accessibilityRole="button" accessibilityLabel="Close markup">
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#060f09' },

  captureRoot: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingBottom: 8,
  },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },

  rightRail: { position: 'absolute', right: 8, width: 118, gap: 8, zIndex: 4 },

  recPill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, zIndex: 6 },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  recText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  analyzeOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 6 },
  analyzeText: { color: '#fff', fontWeight: '700' },

  bottomPanel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5,
    backgroundColor: 'rgba(6,15,9,0.78)',
    paddingHorizontal: 10, paddingTop: 10, gap: 8,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  reelWrap: { gap: 6 },
  reelLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  reelChip: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  reelChipText: { fontSize: 14, fontWeight: '900' },

  skelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  skelToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  skelToggleText: { fontSize: 11, fontWeight: '800' },
  scrubChip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: 'rgba(0,0,0,0.4)' },
  scrubChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  swingTag: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swingTagText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  speedRow: { flexDirection: 'row', gap: 8 },
  dataRow: { flexDirection: 'row', gap: 8 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  calibrateLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 9 },
  calibrateText: { fontSize: 12, fontWeight: '800' },

  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  actionBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  // analysis page
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardHeader: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  backChip: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backChipText: { fontSize: 12, fontWeight: '700' },
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

  // markup
  markupRoot: { flex: 1, backgroundColor: '#000' },
  markupClose: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },

  // permission
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, marginTop: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  permTitle: { fontSize: 18, fontWeight: '800' },
  permBody: { fontSize: 14, textAlign: 'center' },
});
