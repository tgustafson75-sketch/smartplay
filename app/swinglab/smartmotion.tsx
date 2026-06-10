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
import { LinearGradient } from 'expo-linear-gradient';
import VideoAnnotationOverlay from '../../components/swinglab/VideoAnnotationOverlay';
import SwingBodyOverlay from '../../components/swinglab/SwingBodyOverlay';
import CageTargetingCard, { CageTargetingOverlay } from '../../components/swinglab/CageTargetingCard';
import * as VideoThumbnails from 'expo-video-thumbnails';
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
import ClubPickerModal, { clubIdToSmashKey, clubIdToServerKey, clubIdLabel } from '../../components/cage/ClubPickerModal';
import { recognizeClubFromBase64, clubLabel, type ClubId } from '../../services/clubRecognition';
import { speak, configureAudioForSpeech } from '../../services/voiceService';
import { useClubSelectionStore } from '../../store/clubSelectionStore';
import { detectBallDeparture, type BallDepartureResult } from '../../services/swing/ballDeparture';
import { subscribeSmartMotionCommand, setSmartMotionActive } from '../../services/smartMotionRecordBus';
import { reconcileFeel, extractFramesB64 } from '../../services/swing/feelReconcile';
import { analyzePutt, type PuttingAnalysis } from '../../services/puttingAnalysisService';

const RECORDING_MAX_SECONDS = 60; // open window — player swings freely
// Default ball-box position (normalized). Lower-center of the frame, where a
// teed/placed ball typically sits in a down-the-line or face-on setup. Shown
// by default so the user just lines their ball up to it — confirmatory only.
const DEFAULT_BALL_BOX = { x: 0.5, y: 0.6, r: 0.08 };

type Phase = 'setup' | 'recording' | 'analyzing' | 'review';

// ─── data → HUD mappers ──────────────────────────────────────────────

/** Short, honest label for the kinematic-sequence score (0..100). High =
 *  hips lead the downswing (tour order); low = shoulders lead / over-the-top. */
function transitionLabel(score: number): string {
  if (score > 65) return 'hips lead';
  if (score < 35) return 'shoulders lead';
  return 'even';
}

function metricToSpec(key: string, label: string, m: SwingMetric, icon?: MetricSpec['icon']): MetricSpec {
  return {
    key,
    label,
    value: m.value != null ? String(m.value) : null,
    unit: m.unit || undefined,
    estimate: !isTruthGrade(m.source),
    confidence: m.confidenceLabel,
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

function deriveVerdict(a: SwingAnalysis | null, analyzing: boolean): { text: string; tone: SmTone } {
  // Honest state: only say "ANALYZING…" while a read is actually in flight. Once
  // it's done (or errored) with no result, say so instead of spinning forever.
  if (!a) return { text: analyzing ? 'ANALYZING…' : 'NO READ — RECORD AGAIN', tone: analyzing ? 'neutral' : 'warn' };
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
  // Swinger's handedness — the active family member when recording someone
  // else, otherwise the account holder. Mirrors the capture guides.
  const activeMemberHandedness = useFamilyStore(s => {
    const m = s.active_member_id ? s.members.find(x => x.id === s.active_member_id) : null;
    return m?.handedness ?? null;
  });
  const swingerHandedness: 'right' | 'left' =
    activeMemberHandedness === 'left' || activeMemberHandedness === 'right'
      ? activeMemberHandedness
      : profile.handedness ?? 'right';
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
  // Camera cross-check of the acoustic strike (ball there → gone at impact).
  const [ballDeparture, setBallDeparture] = useState<BallDepartureResult | null>(null);
  const [liveDb, setLiveDb] = useState<number | null>(null);
  const [segments, setSegments] = useState<SwingSegment[]>([]);
  const [selectedSwing, setSelectedSwing] = useState(0);
  // Club tag — drives honest ball speed / smash / carry + the CLUB chip.
  // SINGLE SOURCE OF TRUTH: the persisted clubSelectionStore. Reading it
  // reactively means voice ("change club to 7 iron"), the scan-club detector,
  // and the manual picker all update the same value and the HUD reflects it.
  const club = useClubSelectionStore((s) => s.lastClub);
  const setClub = useClubSelectionStore((s) => s.setLastClub);
  const setLastClub = setClub; // alias kept for existing call sites
  const [clubMenuOpen, setClubMenuOpen] = useState(false);
  const [scanningClub, setScanningClub] = useState(false);
  // Putt mode — when a putter is tagged, the clip is analyzed AS A PUTT (green
  // read + stroke), not a full-swing fault read. A PUTT MODE pill confirms it.
  const isPutt = club === 'PT';
  const [puttAnalysis, setPuttAnalysis] = useState<PuttingAnalysis | null>(null);
  // Feels engine — the player tells the caddie how the swing FELT; the caddie
  // reconciles it with the real read and coaches back.
  const [feelText, setFeelText] = useState('');
  const [feelReply, setFeelReply] = useState<string | null>(null);
  const [feelLoading, setFeelLoading] = useState(false);
  const setSessionFeel = useCageStore((s) => s.setSessionFeel);
  // A club value is needed by detectBallSpeed (server key) at stop time;
  // keep a ref so the async stop path reads the current selection.
  const clubRef = useRef<ClubId | null>(club);
  useEffect(() => { clubRef.current = club; }, [club]);

  // Ball box — a DEFAULT reference box is shown automatically so the user just
  // lines their ball up to it and never has to think about it. It's purely
  // CONFIRMATORY (camera + acoustic cross-check); it NEVER gates recording or
  // analysis. Tap to nudge it if their ball sits somewhere else. Persisted into
  // the session on ingest for the strike verifier.
  const [draftBall, setDraftBall] = useState<{ x: number; y: number; r: number } | null>(DEFAULT_BALL_BOX);
  const [placeBallMode, setPlaceBallMode] = useState(false);
  const [rootSize, setRootSize] = useState({ w: 0, h: 0 });
  const draftBallRef = useRef<typeof draftBall>(null);
  useEffect(() => { draftBallRef.current = draftBall; }, [draftBall]);
  // Acoustic impact time of the first swing — needed by the camera verifier,
  // which runs from an effect once the clip + ball spot are both available.
  const firstStrikeMsRef = useRef<number | null>(null);

  const [page, setPage] = useState(0);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [showLayman, setShowLayman] = useState(false);
  const [coachNote, setCoachNote] = useState('');
  const [playbackMs, setPlaybackMs] = useState(0);
  // 2026-06-09 — "Motion overlay" is now a SEPARATE on-demand step (off by
  // default). Default review = watch the swing + Kevin's feedback only, with a
  // clean video. Turning Motion on computes + shows the skeletal overlay, body
  // analysis, tempo and speed — so nothing fires all at once over the video.
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [tempo, setTempo] = useState<SwingTempo | null>(null);
  const [swingAnalyzing, setSwingAnalyzing] = useState(false);
  // Cage targeting (ball + movable target) — reactive mirror of the
  // ingested session id so the targeting card/overlay update live.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [targetFrameUri, setTargetFrameUri] = useState<string | null>(null);
  const [autoDetectingBall, setAutoDetectingBall] = useState(false);
  const analysisCacheRef = useRef<Record<number, SwingAnalysis>>({});
  const tempoCacheRef = useRef<Record<string, SwingTempo>>({});

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

  // Cage targeting — subscribe to the ingested session so ball/target
  // overlays render live, plus the persisted setters. Reuses the same
  // store + components as the swing-detail screen; isolated from the
  // strike/pose/verdict pipelines.
  const cageSession = useCageStore(s =>
    sessionId ? s.sessionHistory.find(x => x.id === sessionId) ?? null : null,
  );
  const setSessionBallArea = useCageStore(s => s.setSessionBallArea);
  const setSessionTarget = useCageStore(s => s.setSessionTarget);
  const ballArea = cageSession?.ball_area_norm ?? null;
  const targetPoint = cageSession?.target_norm ?? null;

  // Engage mode — placing a target "engages" the session: the caddie now
  // has a committed aim line (ball→target). Aim read is the start-line
  // angle from vertical (+ = right), honest because both points are
  // user-placed (no inferred ball flight). Foundation for target-aware
  // club/strategy logic.
  const engaged = ballArea != null && targetPoint != null;
  const aimRead = useMemo(() => {
    if (!ballArea || !targetPoint) return null;
    const dx = targetPoint.x - ballArea.x;
    const dy = ballArea.y - targetPoint.y; // up the frame = positive (toward target)
    if (dy <= 0.02) return null; // target not meaningfully above the ball
    const deg = Math.round((Math.atan2(dx, dy) * 180) / Math.PI); // + right, - left
    if (Math.abs(deg) <= 2) return 'straight';
    return `${Math.abs(deg)}° ${deg > 0 ? 'right' : 'left'}`;
  }, [ballArea, targetPoint]);

  const metrics: SwingMetricSet = useMemo(
    () =>
      synthesizeSwingMetrics({
        poseFrames,
        clipDurationMs: videoDurationMs,
        club: clubIdToSmashKey(club),
        profile: { handicap: profile.handicap ?? null },
        measuredBallSpeedMph,
      }),
    [poseFrames, videoDurationMs, measuredBallSpeedMph, profile.handicap, club],
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

  // Camera strike-verification — did the ball actually leave its spot at
  // impact? Honest false-positive guard (TV/clap can't move YOUR ball) +
  // launch-direction seed. Runs once when the clip, a ball spot, and a
  // detected strike are all present; the ball spot may be pre-record or
  // placed in review.
  // 2026-06-09 — SPEED: the strike cross-check (thumbnails + crops + a network
  // call) is part of the on-demand Motion step, NOT the default review. The
  // default path stays a single fast analyzeSwing call; the verifier only runs
  // once the user opens Motion, so it never competes with the core read.
  useEffect(() => {
    if (!showSkeleton || !clipUri || !ballArea || firstStrikeMsRef.current == null || ballDeparture) return;
    let cancelled = false;
    void detectBallDeparture({ videoUri: clipUri, impactMs: firstStrikeMsRef.current, ballArea })
      .then((r) => { if (!cancelled && r) setBallDeparture(r); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [showSkeleton, clipUri, ballArea, ballDeparture]);

  const bodyItems = useMemo(() => deriveBodyItems(analysis, biomech), [analysis, biomech]);
  // "analyzing" = a read is genuinely in flight (no result yet AND no error).
  // Putt mode has its own verdict (the swing `analysis` stays null for putts,
  // so deriveVerdict would wrongly say ANALYZING/NO READ).
  const verdict = useMemo(() => {
    if (isPutt) {
      if (puttAnalysis) return { text: 'PUTT READ', tone: 'good' as SmTone };
      return { text: analysisError ? 'NO READ' : 'READING…', tone: 'neutral' as SmTone };
    }
    return deriveVerdict(analysis, analysis == null && !analysisError);
  }, [isPutt, puttAnalysis, analysis, analysisError]);
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
        setSessionId(sessionId);
        // Carry a pre-record ball box into the session so the targeting
        // overlay + camera strike-verification use it.
        if (draftBallRef.current) {
          setSessionBallArea(sessionId, draftBallRef.current);
        }
      } catch (e) {
        console.log('[smartmotion] library ingest failed (non-fatal):', e);
      }

      // PUTT MODE — when a putter is tagged, analyze the clip AS A PUTT (green
      // read + stroke), not a full-swing fault read. Isolated branch: the swing
      // path below is untouched for every other club. analyzePutt is
      // fallback-safe (always resolves), so this never hangs.
      if (clubRef.current === 'PT') {
        try {
          const frames = await extractFramesB64(uri, videoDurationMs).catch(() => [] as string[]);
          const sid = ingestedSessionIdRef.current;
          const ballAreaNow = sid
            ? (useCageStore.getState().sessionHistory.find((x) => x.id === sid)?.ball_area_norm ?? null)
            : null;
          const putt = await analyzePutt({
            video_url: uri,
            frames_base64: frames.length > 0 ? frames : undefined,
            ball_area_norm: ballAreaNow,
          });
          setPuttAnalysis(putt);
          if (sid) { try { useCageStore.getState().addPuttingAnalysis(sid, putt); } catch { /* non-fatal */ } }
        } catch (e) {
          setAnalysisError(e instanceof Error ? e.message : String(e));
        }
        setPhase('review');
        return;
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
                confidence: (a.confidence ?? 'low') as PrimaryIssue['confidence'],
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
    [angle, caddiePersonality, language, profile.handicap, profile.dominantMiss, profile.firstName, setSessionBallArea, videoDurationMs],
  );

  // Pose biomechanics — only when the user opens the Motion overlay (step 2).
  // Keeping this off by default means the default review runs ONLY Kevin's
  // analysis (no simultaneous pose extraction competing for resources).
  useEffect(() => {
    if (!clipUri || videoDurationMs == null || !showSkeleton) return;
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
  }, [clipUri, videoDurationMs, showSkeleton]);

  // Acoustic-anchored tempo + transition for the selected swing. Impact
  // comes from the acoustic strike detector (segment.strikeMs);
  // top-of-backswing is read from pose. Cached per (clip, strike) so
  // re-selecting a swing is instant and we never re-pay the pose calls.
  useEffect(() => {
    const seg = segments[selectedSwing];
    // Tempo is part of the Motion step (it needs pose); only derive it when the
    // Motion overlay is open, so the default review stays light.
    if (!clipUri || !showSkeleton || !seg || seg.strikeMs == null) { setTempo(null); return; }
    const cacheKey = `${clipUri}#${seg.strikeMs}`;
    const cached = tempoCacheRef.current[cacheKey];
    if (cached) { setTempo(cached); return; }
    let cancelled = false;
    setTempo(null);
    void (async () => {
      try {
        const t = await deriveSwingTempo(clipUri, seg.strikeMs);
        if (cancelled) return;
        tempoCacheRef.current[cacheKey] = t;
        setTempo(t);
      } catch (e) {
        console.log('[smartmotion] tempo derive failed (non-fatal):', e);
        if (!cancelled) setTempo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [clipUri, segments, selectedSwing, showSkeleton]);

  // Address still for the targeting card / ball auto-detect. Sample near
  // the start of the selected swing (or ~12% into a single clip) where
  // the ball is sitting at address.
  useEffect(() => {
    if (!clipUri || phase !== 'review') { setTargetFrameUri(null); return; }
    const seg = segments[selectedSwing];
    const addressMs = seg ? Math.max(0, seg.startMs) : Math.round((videoDurationMs ?? 3000) * 0.12);
    let cancelled = false;
    void (async () => {
      try {
        const { uri } = await VideoThumbnails.getThumbnailAsync(clipUri, { time: addressMs, quality: 0.8 });
        if (!cancelled) setTargetFrameUri(uri);
      } catch (e) {
        console.log('[smartmotion] address-frame extract failed (non-fatal):', e);
        if (!cancelled) setTargetFrameUri(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipUri, phase, selectedSwing, segments]);

  // Ball auto-detection — sends the address frame to the same vision
  // endpoint the swing-detail screen uses (/api/swing-analysis
  // mode=detect_ball, Claude Haiku). Commits the normalized ball area to
  // the session; on failure the user can still tap-place via the card.
  const autoDetectBall = useCallback(async () => {
    if (!targetFrameUri || !sessionId) return;
    setAutoDetectingBall(true);
    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
      const FS = await import('expo-file-system/legacy');
      const b64 = await FS.readAsStringAsync(targetFrameUri, { encoding: FS.EncodingType.Base64 });
      const res = await fetch(`${apiUrl}/api/swing-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'detect_ball', frames: [{ b64, media_type: 'image/jpeg' }] }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json()) as { found?: boolean; x?: number; y?: number; r?: number };
      if (data.found && typeof data.x === 'number' && typeof data.y === 'number') {
        setSessionBallArea(sessionId, { x: data.x, y: data.y, r: typeof data.r === 'number' ? data.r : 0.06 });
      }
    } catch (e) {
      console.log('[smartmotion] ball auto-detect failed (non-fatal):', e);
    } finally {
      setAutoDetectingBall(false);
    }
  }, [targetFrameUri, sessionId, setSessionBallArea]);

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
    setSessionId(null);
    setTargetFrameUri(null);
    setClipUri(null);
    setAnalysis(null);
    setAnalysisError(null);
    setPoseFrames(null);
    setBiomech(null);
    setVideoDurationMs(null);
    setBallSpeed(null);
    setBallDeparture(null);
    setPuttAnalysis(null);
    setFeelText('');
    setFeelReply(null);
    setDraftBall(DEFAULT_BALL_BOX); // keep the default reference box after Record again
    setPlaceBallMode(false);
    firstStrikeMsRef.current = null;
    setLiveDb(null);
    // Clear caches BEFORE resetting selection so no stale per-swing
    // analysis/tempo can be read for the new recording (audit #2).
    tempoCacheRef.current = {};
    analysisCacheRef.current = {};
    setSegments([]);
    setSelectedSwing(0);
    setCoachNote('');
    setTempo(null);
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

  // Feels engine — store the player's feel + ask the caddie to reconcile it
  // with the real read and coach back. Safe: always resolves with a message.
  const submitFeel = useCallback(async () => {
    const t = feelText.trim();
    if (!t || feelLoading) return;
    setFeelLoading(true);
    setFeelReply(null);
    const sid = ingestedSessionIdRef.current;
    if (sid) { try { setSessionFeel(sid, t); } catch { /* non-fatal */ } }
    try {
      const a = analysisCacheRef.current[selectedSwing] ?? analysis;
      const reply = await reconcileFeel({
        videoUri: clipUri ?? '',
        feel: t,
        durationMs: videoDurationMs,
        caddieName: caddiePersonality,
        club: club ? clubLabel(club) : null,
        priorFault: a?.primary_fault ?? a?.detected_issue ?? null,
        priorCause: a?.cause ?? null,
        priorFix: a?.fix ?? null,
        language,
      });
      setFeelReply(reply ?? "Saved your feel — I'll factor it into your reads.");
      if (reply) {
        try {
          const s = useSettingsStore.getState();
          await configureAudioForSpeech();
          await speak(reply, s.voiceGender, s.language, process.env.EXPO_PUBLIC_API_URL ?? '', { userInitiated: true });
        } catch { /* speech non-fatal */ }
      }
    } catch {
      setFeelReply('Saved your feel.');
    } finally {
      setFeelLoading(false);
    }
  }, [feelText, feelLoading, selectedSwing, analysis, clipUri, videoDurationMs, caddiePersonality, club, language, setSessionFeel]);

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
    setBallDeparture(null);
    setPlaceBallMode(false); // keep draftBall (carries into the session) but exit place mode
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
        const speed = await detectBallSpeed({
          audioUri: audioUriRef.current,
          impact_ms: firstStrikeMs,
          club: clubIdToServerKey(clubRef.current),
        });
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
      // Remember the strike time; the camera strike-verification runs from an
      // effect once both the clip and a ball spot are available (the ball spot
      // may be a pre-record draft or placed in review).
      firstStrikeMsRef.current = firstStrikeMs;
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

  // ── auto club detection (hands-free, between minutes) ──────────────────
  // Point the camera at the club (or just keep playing); a scan grabs a frame,
  // recognizes the club, and tags it. High/med confidence → set it + a spoken
  // "Got it, 7-iron". Low confidence → open the picker so the user CONFIRMS
  // (UI fallback). Club state is the shared store, so this updates the HUD,
  // ball speed, etc. everywhere. Never blocks recording.
  const detectClubFromCamera = useCallback(async () => {
    if (scanningClub) return;
    setScanningClub(true);
    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
      const pic = await cameraRef.current?.takePictureAsync?.({ base64: true, quality: 0.5, skipProcessing: true });
      const b64 = pic?.base64;
      if (!apiUrl || !b64) { setClubMenuOpen(true); return; }
      const res = await recognizeClubFromBase64(b64, apiUrl);
      if (res.kind === 'ok' && res.club_id !== 'unknown' && res.confidence !== 'low') {
        setClub(res.club_id);
        try {
          const s = useSettingsStore.getState();
          await configureAudioForSpeech();
          await speak(`Got it — ${clubLabel(res.club_id)}.`, s.voiceGender, s.language, apiUrl, { userInitiated: true });
        } catch { /* speech non-fatal */ }
      } else {
        // Couldn't confirm — let the user confirm/correct in the picker.
        setClubMenuOpen(true);
      }
    } catch (e) {
      console.log('[smartmotion] club scan failed:', e);
      setClubMenuOpen(true);
    } finally {
      setScanningClub(false);
    }
  }, [scanningClub, setClub]);

  // ── hands-free voice control (the money shot) ──────────────────────────
  // Active-listening "caddie, record / start / stop" drives capture without
  // touching the screen. The screen owns the decision: a command toggles by
  // phase (recording → stop, else → start) so it's robust to start/stop
  // mis-classification. Kept in a ref so we subscribe once and always act on
  // the CURRENT phase. The 60s window also auto-wraps each "minute".
  const recordCmdRef = useRef<(cmd: 'start' | 'stop' | 'toggle' | 'scanClub') => void>(() => {});
  recordCmdRef.current = (cmd) => {
    if (cmd === 'scanClub') { void detectClubFromCamera(); return; }
    const recording = phase === 'recording';
    if (cmd === 'stop') { if (recording) void stopRecording(); return; }
    if (cmd === 'start') { if (!recording && phase !== 'analyzing') void startRecording(); return; }
    // toggle
    if (recording) void stopRecording();
    else if (phase !== 'analyzing') void startRecording();
  };
  useEffect(() => {
    setSmartMotionActive(true);
    const unsub = subscribeSmartMotionCommand((cmd) => recordCmdRef.current(cmd));
    return () => { setSmartMotionActive(false); unsub(); };
  }, []);

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
  // Motion overlay toggle — ALWAYS available in review (turning it on is what
  // computes pose/body/tempo, so it can't depend on poseFrames existing yet).
  // Position scrub chips only appear once frames are computed.
  const poseReady = !!poseFrames && poseFrames.length > 0;
  const skeletonRow =
    isReview ? (
      <View style={styles.skelRow}>
        <Pressable
          onPress={() => setShowSkeleton((v) => !v)}
          style={[styles.skelToggle, { borderColor: showSkeleton ? colors.accent : 'rgba(255,255,255,0.3)', backgroundColor: showSkeleton ? colors.accent_muted : 'rgba(0,0,0,0.4)' }]}
        >
          <Ionicons name="body-outline" size={13} color={showSkeleton ? colors.accent : '#fff'} />
          <Text style={[styles.skelToggleText, { color: showSkeleton ? colors.accent : '#fff' }]}>
            {showSkeleton ? (poseReady ? 'Motion ✓' : 'Reading motion…') : 'Motion'}
          </Text>
        </Pressable>
        {showSkeleton && poseReady ? P_SCRUB.map((p) => (
          <Pressable key={p.key} onPress={() => seekToPosition(p.key)} style={styles.scrubChip}>
            <Text style={styles.scrubChipText}>{p.label}</Text>
          </Pressable>
        )) : null}
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
      <View
        style={styles.captureRoot}
        onLayout={(e) => setRootSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {isReview && clipUri ? (
          <Video
            ref={videoRef}
            source={{ uri: clipUri }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            isLooping
            shouldPlay
            // 2026-06-09 — Mute the review loop. The captured clip's audio
            // (e.g. a TV in the room) replaying on loop reads as "audio
            // feedback"; it adds nothing to silent skeleton/speed analysis.
            isMuted
            useNativeControls={false}
            onLoad={(s) => { if ('durationMillis' in s && s.durationMillis) setVideoDurationMs(s.durationMillis); }}
            onPlaybackStatusUpdate={(s) => { if ('positionMillis' in s && typeof s.positionMillis === 'number') setPlaybackMs(s.positionMillis); }}
          />
        ) : (
          // 2026-06-09 — `mute` disables the camera's own audio track. We run a
          // SEPARATE Audio.Recording for acoustic strike metering; on iOS the
          // audio session is a singleton, so two concurrent recorders can
          // collide and silently kill metering (→ no strikes/segments/tempo).
          // We never use the clip's audio (playback is muted), so muting the
          // camera is lossless and removes the contention.
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="video" mute />
        )}

        {/* Smart Capture — tap exposed video to freeze + mark up. */}
        {isReview && clipUri ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAnnotateOpen(true)} accessibilityRole="button" accessibilityLabel="Freeze and mark up this swing" />
        ) : null}

        {/* Attached skeletal overlay — real keypoints tracked to playback. */}
        {isReview && showSkeleton && poseFrames && poseFrames.length > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <SwingBodyOverlay frames={poseFrames} currentTimeMs={playbackMs} showSkeleton showTrace={false} resizeMode="cover" />
          </View>
        ) : null}

        {/* Ball area + (movable) target overlay — reference markers placed
            via the targeting card on the analysis page. */}
        {isReview && (ballArea || targetPoint) ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <CageTargetingOverlay ballArea={ballArea} target={targetPoint} />
          </View>
        ) : null}

        {/* SETUP — drop a ball box on the live preview before recording so the
            camera strike-verification can run. The draft box renders here;
            tapping (in place mode) sets its location. */}
        {phase === 'setup' && draftBall ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <CageTargetingOverlay ballArea={draftBall} target={null} />
          </View>
        ) : null}
        {phase === 'setup' && placeBallMode ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={(e) => {
              const { locationX, locationY } = e.nativeEvent;
              if (rootSize.w > 0 && rootSize.h > 0) {
                setDraftBall({ x: locationX / rootSize.w, y: locationY / rootSize.h, r: 0.07 });
              }
              setPlaceBallMode(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Tap where your ball is"
          />
        ) : null}

        {phase !== 'analyzing' ? <CaptureGuides mode={angle} handedness={swingerHandedness} /> : null}

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

        {/* SETUP TOOL RAIL — translucent icon buttons on the right edge so the
            bottom + ball box stay clear. Calibrate · scan club · place ball.
            Same handlers as the old bars, just compact + out of the way. */}
        {phase === 'setup' ? (
          <View style={[styles.toolRail, { top: insets.top + 76 }]}>
            <Pressable
              onPress={() => router.push('/swinglab/calibrate' as never)}
              style={[styles.toolBtn, { borderColor: calibrated ? colors.success : colors.accent }]}
              accessibilityRole="button"
              accessibilityLabel={calibrated ? 'Re-calibrate acoustics' : 'Calibrate acoustics'}
            >
              <Ionicons name="pulse-outline" size={20} color={calibrated ? colors.success : colors.accent} />
            </Pressable>
            <Pressable
              onPress={() => void detectClubFromCamera()}
              disabled={scanningClub}
              style={[styles.toolBtn, { borderColor: colors.accent, opacity: scanningClub ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Scan club with camera"
            >
              <Ionicons name={scanningClub ? 'sync' : 'scan-outline'} size={20} color={colors.accent} />
            </Pressable>
            <Pressable
              onPress={() => setPlaceBallMode((v) => !v)}
              style={[styles.toolBtn, { borderColor: placeBallMode ? colors.success : colors.accent }]}
              accessibilityRole="button"
              accessibilityLabel="Place ball box"
            >
              <Ionicons name={placeBallMode ? 'hand-left-outline' : 'golf-outline'} size={20} color={placeBallMode ? colors.success : colors.accent} />
            </Pressable>
          </View>
        ) : null}

        {/* PUTT MODE pill — confirms the clip is analyzed as a PUTT, not a
            full swing. Shown whenever a putter is tagged. */}
        {isPutt ? (
          <View style={[styles.puttPill, { top: insets.top + 56 }]} pointerEvents="none">
            <Ionicons name="golf-outline" size={13} color="#06281b" />
            <Text style={styles.puttPillText}>PUTT MODE</Text>
          </View>
        ) : null}

        {/* RIGHT RAIL — floating metric cards (review) */}
        {isReview && !isPutt ? (
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

        {/* BOTTOM PANEL — floating data + controls. While placing the ball box
            it's hidden so the full floor is visible + tappable; otherwise it's
            a soft translucent fade (not an opaque block) so the camera shows
            through, matching the clean overlay design. */}
        {phase === 'setup' && placeBallMode ? (
          <View style={[styles.placeHint, { bottom: insets.bottom + 24, backgroundColor: colors.overlay }]} pointerEvents="none">
            <Ionicons name="hand-left-outline" size={15} color={colors.accent} />
            <Text style={[styles.placeHintText, { color: colors.accent }]}>Tap the floor where your ball is</Text>
          </View>
        ) : (
        <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 8 }]}>
          <LinearGradient
            colors={['rgba(6,15,9,0)', 'rgba(6,15,9,0.5)', 'rgba(6,15,9,0.85)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* REVIEW STATS — speed cards, tempo, body analysis (matches redesign) */}
          {isReview ? (
            <>
              {engaged ? (
                <View style={[styles.engagePill, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}>
                  <Ionicons name="locate" size={13} color={colors.accent} />
                  <Text style={[styles.engageText, { color: colors.accent }]}>
                    RANGE · ENGAGED{aimRead ? ` · aim ${aimRead}` : ''}
                  </Text>
                </View>
              ) : null}
              {skeletonRow}
              {/* MOTION DATA (step 2) — speed / tempo / body only render when the
                  Motion overlay is on, so the default review keeps a clean video
                  with just Kevin's read. Translucent cards, fewer at a glance. */}
              {showSkeleton ? (
                <>
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
                  {tempo?.ratio != null && tempo.backswingMs != null && tempo.downswingMs != null ? (
                    <Text style={[styles.tempoDetail, { color: colors.text_muted }]} numberOfLines={1}>
                      Back {(tempo.backswingMs / 1000).toFixed(1)}s · Down {(tempo.downswingMs / 1000).toFixed(1)}s
                      {tempo.sequencingScore != null ? ` · Transition: ${transitionLabel(tempo.sequencingScore)}` : ''}
                    </Text>
                  ) : null}
                  <BodyAnalysisRow items={bodyItems} />
                </>
              ) : null}
            </>
          ) : null}

          {reel}

          {/* Acoustic card shows during RECORDING (live meter) + REVIEW (swing
              count). In SETUP it's hidden — calibration lives on the right-side
              icon rail so the bottom stays clear of the ball box. */}
          {phase !== 'setup' ? (
          <View style={styles.controlsRow}>
            <View style={{ flex: 1 }}>
              <Pressable
                onPress={() => router.push('/swinglab/calibrate' as never)}
                accessibilityRole="button"
                accessibilityLabel={calibrated ? 'Re-calibrate acoustics, 10 strikes' : 'Calibrate acoustics, 10 strikes'}
              >
                <AcousticPickupCard
                  detected={phase === 'recording' ? liveDb != null && liveDb > -30 : segments.length > 0}
                  swingCount={isReview ? confirmedCount(segments) : undefined}
                  calibrated={calibrated}
                  levelDb={phase === 'recording' ? liveDb : null}
                  listening={phase === 'recording'}
                  style={styles.glassCard}
                />
              </Pressable>
            </View>
            {isReview ? <VerdictBadge verdict={verdict.text} tone={verdict.tone} style={{ flex: 1 }} /> : null}
          </View>
          ) : null}

          {/* Strike cross-check — camera confirms the acoustic strike. Honest:
              only shown when we actually ran the check (ball spot existed). */}
          {isReview && ballDeparture ? (
            <View style={styles.verifyRow}>
              <Ionicons
                name={ballDeparture.departed ? 'checkmark-circle' : 'alert-circle'}
                size={14}
                color={ballDeparture.departed ? colors.success : colors.warning}
              />
              <Text style={[styles.verifyText, { color: ballDeparture.departed ? colors.success : colors.warning }]}>
                {ballDeparture.departed
                  ? `Ball strike confirmed${ballDeparture.direction !== 'unknown' ? ` · launch ${ballDeparture.direction}` : ''}`
                  : ballDeparture.ball_present_before
                    ? 'Sound only — ball didn’t leave its spot'
                    : 'Couldn’t see the ball to confirm'}
              </Text>
            </View>
          ) : null}

          {/* SETUP tools (calibrate / scan club / ball box) live on the
              right-side icon rail (rendered over the camera) so the bottom
              stays clear of the ball box. A one-line hint shows when placing. */}
          {phase === 'setup' && placeBallMode ? (
            <Text style={[styles.setupHintLine, { color: colors.accent }]}>Tap where your ball sits</Text>
          ) : null}

          <View style={styles.controlsRow}>
            <ModeToggle value={angle} onChange={setAngle} style={{ flex: 1 }} />
            <View style={{ width: 130 }}>{actionBtn}</View>
          </View>

          <FooterChips
            club={club ? clubIdLabel(club) : null}
            onClubPress={() => setClubMenuOpen(true)}
            shot={isReview ? selectedSwing + 1 : null}
            distanceYds={isReview ? metrics.carry_yards.value : null}
            distanceEst={isReview && metrics.carry_yards.value != null}
            style={styles.glassCard}
          />
        </View>
        )}
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
      ) : isPutt ? (
        // PUTT MODE — analyzed as a putt (green read + stroke), not a swing.
        puttAnalysis ? (
          <>
            <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.accent }]}>
              <Text style={[styles.insightLabel, { color: colors.accent }]}>PUTT READ{puttAnalysis.partialCapture ? ' · est' : ''}</Text>
              <Text style={[styles.insightText, { color: colors.text_primary }]}>{puttAnalysis.caddieComment}</Text>
            </View>
            <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
              <Text style={[styles.insightLabel, { color: colors.text_muted }]}>LINE</Text>
              <Text style={[styles.insightText, { color: colors.text_secondary }]}>{puttAnalysis.recommendation.line}</Text>
            </View>
            <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
              <Text style={[styles.insightLabel, { color: colors.text_muted }]}>SPEED / FEEL</Text>
              <Text style={[styles.insightText, { color: colors.text_secondary }]}>{puttAnalysis.recommendation.speedFeel}</Text>
            </View>
            <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
              <Text style={[styles.insightLabel, { color: colors.text_muted }]}>CUE</Text>
              <Text style={[styles.insightText, { color: colors.text_secondary }]}>{puttAnalysis.recommendation.technicalCue}</Text>
            </View>
          </>
        ) : (
          <Text style={[styles.muted, { color: colors.text_muted }]}>{analysisError ?? 'Reading your putt…'}</Text>
        )
      ) : analysis == null ? (
        // Null-prevention: even without a full server analysis, surface
        // whatever the motion DID reveal (biomech verdicts + tempo). One
        // finding is a finding — never show a bare "nothing" when we read
        // something. Only fall back to the empty message if truly nothing.
        (() => {
          const partial: string[] = [
            biomech?.verdicts?.hipTurn,
            biomech?.verdicts?.shoulderTurn,
            biomech?.verdicts?.weightShift,
            biomech?.verdicts?.posture,
            biomech?.verdicts?.sequencing,
          ].filter((v): v is string => !!v && v.trim().length > 0);
          if (tempo?.ratio != null) partial.push(`Tempo ${tempo.ratio.toFixed(1)} : 1 (backswing : downswing).`);
          if (partial.length === 0) {
            return <Text style={[styles.muted, { color: colors.text_muted }]}>{analysisError ?? 'No analysis available for this swing.'}</Text>;
          }
          return (
            <>
              <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
                <Text style={[styles.insightLabel, { color: colors.text_muted }]}>WHAT WE READ</Text>
                <Text style={[styles.insightText, { color: colors.text_secondary }]}>Couldn’t get a full coaching read on this clip, but your motion showed:</Text>
              </View>
              {partial.map((line, i) => (
                <Text key={i} style={[styles.insightBody, { color: colors.text_secondary, backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>{line}</Text>
              ))}
            </>
          );
        })()
      ) : (
        <>
          {faultHeadline ? (
            <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
              <Text style={[styles.insightLabel, { color: colors.text_muted }]}>TOP FOCUS</Text>
              <Text style={[styles.insightHeadline, { color: colors.text_primary }]}>{faultHeadline.toUpperCase()}</Text>
              <Text style={[styles.insightConf, { color: colors.text_muted }]}>Confidence: {analysis.confidence ?? '—'}</Text>
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

          {/* Ball + target placement. Auto-detect the ball, tap-place the
              target (movable) — both render as overlays on the swing video. */}
          <CageTargetingCard
            colors={colors}
            frameUri={targetFrameUri}
            ballArea={ballArea}
            target={targetPoint}
            onChangeBallArea={(a) => { if (sessionId) setSessionBallArea(sessionId, a); }}
            onChangeTarget={(t) => { if (sessionId) setSessionTarget(sessionId, t); }}
            onAutoDetectBall={targetFrameUri ? autoDetectBall : undefined}
            autoDetecting={autoDetectingBall}
          />
        </>
      )}

      {/* FEELS ENGINE — tell the caddie how it FELT (mechanical or emotional);
          it reconciles your feel with the real read and coaches you back. */}
      {isReview ? (
        <View style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
          <Text style={[styles.insightLabel, { color: colors.text_muted }]}>HOW&apos;D IT FEEL?</Text>
          <TextInput
            value={feelText}
            onChangeText={setFeelText}
            placeholder="e.g. felt like I came over the top · felt frustrated"
            placeholderTextColor={colors.text_muted}
            multiline
            style={[styles.noteInput, { color: colors.text_primary, borderColor: colors.border }]}
          />
          <Pressable
            onPress={() => { void submitFeel(); }}
            disabled={feelLoading || feelText.trim().length === 0}
            style={[styles.secondaryBtn, { borderColor: colors.accent, marginTop: 8, opacity: feelLoading || !feelText.trim() ? 0.6 : 1 }]}
          >
            {feelLoading
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.accent} />}
            <Text style={[styles.secondaryBtnText, { color: colors.accent }]}>{feelLoading ? 'Asking your caddie…' : 'Run it by your caddie'}</Text>
          </Pressable>
          {feelReply ? (
            <Text style={[styles.insightText, { color: colors.text_primary, marginTop: 8 }]}>{feelReply}</Text>
          ) : null}
        </View>
      ) : null}
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

      {/* Club tag picker — standalone mode (does not touch the cage session).
          Tagging a club unlocks honest ball speed / smash / carry. */}
      <ClubPickerModal
        open={clubMenuOpen}
        onClose={() => setClubMenuOpen(false)}
        selected={club}
        onPick={(c) => { setClub(c); setLastClub(c); setClubMenuOpen(false); }}
      />
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
  puttPill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, zIndex: 6, backgroundColor: '#34d399' },
  puttPillText: { color: '#06281b', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  // Setup tool rail — translucent icon buttons on the right edge.
  toolRail: { position: 'absolute', right: 10, gap: 12, zIndex: 7, alignItems: 'center' },
  toolBtn: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,15,9,0.55)' },
  setupHintLine: { fontSize: 12, fontWeight: '800', textAlign: 'center', paddingVertical: 2 },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  recText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  analyzeOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 6 },
  analyzeText: { color: '#fff', fontWeight: '700' },

  bottomPanel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5,
    backgroundColor: 'transparent', // translucent gradient fade renders behind
    overflow: 'hidden',
    paddingHorizontal: 10, paddingTop: 14, gap: 8,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  placeHint: {
    position: 'absolute', alignSelf: 'center', zIndex: 6,
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
  },
  placeHintText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  // Translucent "glass" card bg so the camera shows through the bottom panel.
  glassCard: { backgroundColor: 'rgba(12,22,16,0.55)' },
  tempoDetail: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, marginTop: -2 },
  engagePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  engageText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
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
  verifyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 2 },
  verifyText: { fontSize: 12, fontWeight: '700' },
  ballNudge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  ballNudgeText: { fontSize: 12, fontWeight: '700' },


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
