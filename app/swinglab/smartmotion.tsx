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
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Animated,
  Vibration,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import VideoAnnotationOverlay from '../../components/swinglab/VideoAnnotationOverlay';
import SwingBodyOverlay from '../../components/swinglab/SwingBodyOverlay';
import CageTargetingCard, { CageTargetingOverlay, EditableCageTargets, BallTraceOverlay } from '../../components/swinglab/CageTargetingCard';
import { computeTraceDirection, traceColor } from '../../services/swing/ballTrace';
import { estimateCarryYards } from '../../services/swing/carryEstimate';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { CaddieMicBadge } from '../../components/caddie/CaddieMicBadge';
import { useTheme } from '../../contexts/ThemeContext';
import { analyzeSwing, probeDurationMs, type SwingAnalysis } from '../../services/poseDetection';
import { evaluateSwingValidity } from '../../services/swingValidity';
import {
  synthesizeSwingMetrics,
  isTruthGrade,
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
import { detectStrikes, type DetectedStrike } from '../../services/swing/strikeDetector';
import { segmentsFromStrikes, segmentsFromVideoSwings, correlateStrikesWithVideo, type SwingSegment } from '../../services/swing/swingSegmentation';
import { detectBallSpeed, type BallSpeedResult } from '../../services/acousticDetectApi';
import { useCageStore, type PrimaryIssue } from '../../store/cageStore';
import { useFamilyStore } from '../../store/familyStore';
import { useAcousticCalibrationStore } from '../../store/acousticCalibrationStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRoundStore } from '../../store/roundStore';
import {
  SmartMotionHeader,
  CaptureGuides,
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
import { speak, configureAudioForSpeech, captureUtterance, endCaptureEarly } from '../../services/voiceService';
import { useClubSelectionStore } from '../../store/clubSelectionStore';
import { useToastStore } from '../../store/toastStore';
import { detectBallDeparture, type BallDepartureResult } from '../../services/swing/ballDeparture';
import { subscribeSmartMotionCommand, setSmartMotionActive, type SmartMotionCommand } from '../../services/smartMotionRecordBus';
import { reconcileFeel, extractFramesB64 } from '../../services/swing/feelReconcile';
import { analyzePutt, type PuttingAnalysis } from '../../services/puttingAnalysisService';
import { ShotMapPage } from '../../components/smartmotion/ShotMapPage';
import { getApiBaseUrl } from '../../services/apiBase';

const RECORDING_MAX_SECONDS = 60; // cage / course — open window, player swings freely
const RANGE_RECORDING_MAX_SECONDS = 120; // range — longer window for a multi-swing session
// Default ball-box position (normalized). Lower-center of the frame, where a
// teed/placed ball typically sits in a down-the-line or face-on setup. Shown
// by default so the user just lines their ball up to it — confirmatory only.
// 2026-06-11 — lower-CENTER default on the DTL dashed center line. Grounded in Tim's
// real cage clip (Downloads 7790): in his framing the ball at address sits ~mid-to-
// lower frame (≈0.45–0.6 depending on how tight the DTL crop is), NOT at the very
// bottom — a box "anchored to the bottom" (0.8) lands in the leaves below the mat,
// further from the ball. So the static default is a sane lower-center; the REAL
// normalize-the-start fix (planned with the ball-trace detector, which already has to
// find the ball) is to snap the box onto the detected ball so the user doesn't hand-
// move it. x stays 0.5 (center line).
const DEFAULT_BALL_BOX = { x: 0.5, y: 0.62, r: 0.08 };
// 2026-06-11 — chip/short-game strike threshold (dB above the noise floor). A chip's
// impact is ~half a full strike's energy, so the default ~30dB misses it; ~18dB lets
// the quieter pitch/chip register. Used only when chipSensitivity is on (cage = alone,
// so the few extra candidates it admits are harmless; range still vision-confirms).
const CHIP_STRIKE_THRESHOLD_DB = 18;
// 2026-06-12 — default DTL target: straight up the frame from the ball (full-ish
// shot). Draggable in setup so the aim line + the live effort/direction readout
// update as you move it (geometry ↔ tempo, made interactive). x=0.5 = on the line.
const DEFAULT_TARGET = { x: 0.5, y: 0.18 };
// Topmost the DTL target can travel (kept below the header so it's reachable + not
// jammed under the readout). This y is also the 100%-effort point: a target dragged
// to the cap = a full shot, scaling down to 0% at the ball (Tim — couldn't reach the
// top past the overlay; top should read ~100%).
const EFFORT_TOP_CAP = 0.13;

// 2026-06-12 — custom green-on-transparent icon set (Tim's ChatGPT art, cropped +
// black knocked out). Golfer stances for the angle toggle, scene badges for the
// environment toggle, a club-bag glyph for the scan button.
const ICON_ANGLE = {
  down_the_line: require('../../assets/icons/smartmotion/angle-dtl.png'),
  face_on: require('../../assets/icons/smartmotion/angle-faceon.png'),
  putt: require('../../assets/icons/smartmotion/angle-putt.png'),
} as const;
const ICON_ENV = {
  cage: require('../../assets/icons/smartmotion/env-cage.png'),
  range: require('../../assets/icons/smartmotion/env-range.png'),
  course: require('../../assets/icons/smartmotion/env-course.png'),
} as const;
const ICON_CLUB = require('../../assets/icons/smartmotion/club-detect.png');
// Ball/result metric badges for the LEFT rail (honest: tempo, ball speed, ball result
// direction, + face INFERRED from ball start). Smash needs club speed we don't have.
const ICON_METRIC = {
  tempo: require('../../assets/icons/smartmotion/metric-tempo.png'),
  ballspeed: require('../../assets/icons/smartmotion/metric-ballspeed.png'),
  ballresult: require('../../assets/icons/smartmotion/metric-ballresult.png'),
  face: require('../../assets/icons/smartmotion/metric-faceangle.png'),
  smash: require('../../assets/icons/smartmotion/metric-smash.png'),
  clubpath: require('../../assets/icons/smartmotion/metric-clubpath.png'),
} as const;
// Biomech RESULT badges (Tim — the dashed-line set for the body-analysis row).
const ICON_BIOMECH = {
  sway: require('../../assets/icons/smartmotion/biomech-sway.png'),
  tilt: require('../../assets/icons/smartmotion/biomech-tilt.png'),
  posture: require('../../assets/icons/smartmotion/biomech-posture.png'),
  weight: require('../../assets/icons/smartmotion/biomech-weight.png'),
  shoulder: require('../../assets/icons/smartmotion/biomech-shoulder.png'),
  hip: require('../../assets/icons/smartmotion/biomech-hip.png'),
} as const;
// 2026-06-12 — the rest of the rail as matching green-circle badges (Tim's art), so
// every rail button uses its OWN circle (our button border dropped — no double circle).
const ICON_RAIL = {
  calibrate: require('../../assets/icons/smartmotion/rail-calibrate.png'),
  ballbox: require('../../assets/icons/smartmotion/rail-ballbox.png'),
  selfie: require('../../assets/icons/smartmotion/rail-selfie.png'),
  chip: require('../../assets/icons/smartmotion/rail-chip.png'),
} as const;
// Review control bar as matching badges (record / play-pause / slow-mo / delete / save).
const ICON_CTRL = {
  record: require('../../assets/icons/smartmotion/ctrl-record.png'),
  playpause: require('../../assets/icons/smartmotion/ctrl-playpause.png'),
  slowmo: require('../../assets/icons/smartmotion/ctrl-slowmo.png'),
  delete: require('../../assets/icons/smartmotion/ctrl-delete.png'),
  save: require('../../assets/icons/smartmotion/ctrl-save.png'),
  stop: require('../../assets/icons/smartmotion/ctrl-stop.png'),
} as const;

type Phase = 'setup' | 'recording' | 'analyzing' | 'review';

// ─── data → HUD mappers ──────────────────────────────────────────────

/** Short, honest label for the kinematic-sequence score (0..100). High =
 *  hips lead the downswing (tour order); low = shoulders lead / over-the-top. */
function transitionLabel(score: number): string {
  if (score > 65) return 'hips lead';
  if (score < 35) return 'shoulders lead';
  return 'even';
}

// Club path is qualitative (we don't measure degrees on a phone).
function clubPathSpec(a: SwingAnalysis | null): MetricSpec {
  let value: string | null = null;
  let statusTone: SmTone = 'neutral';
  if (a) {
    if (a.detected_issue === 'swing_path_outside_in') { value = 'OUT→IN'; statusTone = 'warn'; }
    else if (a.detected_issue === 'swing_path_inside_out') { value = 'IN→OUT'; statusTone = 'warn'; }
    // 2026-06-11 (audit) — the server WITHHOLDS a path verdict unless it cited
    // 2D evidence (its HARD_TO_SEE_2D gate). Don't manufacture a confident green
    // "NEUTRAL" from the mere absence of a named path fault — leave value null
    // → renders "—" (not read), matching what the server actually claimed.
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
  // 2026-06-11 (audit) — only claim "good" weight shift when it was actually
  // MEASURED (bio.weightShiftPct present); a null metric is neutral ("—"), not a
  // baseless green. (sway/tilt/posture map to real AI fault categories, so their
  // "good = not flagged by the analysis" reads stay qualitative-honest.)
  const weight: SmTone = n ? 'neutral'
    : fault === 'reverse_pivot' ? 'bad'
    : bio?.weightShiftPct == null ? 'neutral'
    : bio.weightShiftPct < 30 ? 'warn' : 'good';
  return [
    { key: 'sway', label: 'Sway', tone: sway, icon: 'swap-horizontal-outline', image: ICON_BIOMECH.sway },
    { key: 'tilt', label: 'Tilt', tone: tilt, icon: 'contract-outline', image: ICON_BIOMECH.tilt },
    { key: 'posture', label: 'Posture', tone: posture, icon: 'body-outline', image: ICON_BIOMECH.posture },
    { key: 'weight', label: 'Weight', tone: weight, icon: 'scale-outline', image: ICON_BIOMECH.weight },
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

// 2026-06-12 — RailButton: an icon-only setup-rail button that FLASHES a label to
// its LEFT on tap (Tim — makes the icon-only rail self-explaining). The caller owns
// the button look (btnStyle) + the icon (children); this adds the flash behavior.
function RailButton({
  label, disabled, onPress, btnStyle, children,
}: {
  label: string;
  disabled?: boolean;
  onPress?: () => void;
  btnStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const op = useRef(new Animated.Value(0)).current;
  const flash = () => {
    op.setValue(1);
    Animated.timing(op, { toValue: 0, duration: 950, delay: 500, useNativeDriver: true }).start();
  };
  return (
    <View style={railStyles.wrap}>
      <Animated.Text style={[railStyles.flashLabel, { opacity: op, color: colors.accent }]} pointerEvents="none" numberOfLines={1}>
        {label}
      </Animated.Text>
      <Pressable
        onPress={() => { flash(); onPress?.(); }}
        disabled={disabled}
        style={btnStyle}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {children}
      </Pressable>
    </View>
  );
}

const railStyles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  flashLabel: { position: 'absolute', right: 54, width: 150, height: 46, textAlign: 'right', textAlignVertical: 'center', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
});

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
  // 2026-06-10 — Environment mode (cage/range/course). Default 'cage' keeps every
  // existing path byte-for-byte; 'range' is an additive branch (longer window,
  // acoustics off, video segmentation). 'course' = single shot, acoustics off
  // (wind), GPS-side distance is the on-course caddie's job.
  const environmentMode = useSettingsStore((s) => s.environmentMode);
  const setEnvironmentMode = useSettingsStore((s) => s.setEnvironmentMode);
  const cageCanvasFeet = useSettingsStore((s) => s.cageCanvasFeet);
  const setCageCanvasFeet = useSettingsStore((s) => s.setCageCanvasFeet);
  const cameraBehindFeet = useSettingsStore((s) => s.cameraBehindFeet);
  const setCameraBehindFeet = useSettingsStore((s) => s.setCameraBehindFeet);
  const chipSensitivity = useSettingsStore((s) => s.chipSensitivity);
  const setChipSensitivity = useSettingsStore((s) => s.setChipSensitivity);
  // 2026-06-10 (phase 3) — a live round forces COURSE sensing (acoustics off,
  // single shot) regardless of the practice toggle: you don't want neighbor/
  // wind acoustic detection on the course. Off-round, the toggle wins.
  const isRoundActive = useRoundStore((s) => s.isRoundActive);
  const effectiveMode: 'cage' | 'range' | 'course' = isRoundActive ? 'course' : environmentMode;
  const recordingMaxSeconds = effectiveMode === 'range' ? RANGE_RECORDING_MAX_SECONDS : RECORDING_MAX_SECONDS;
  const appliedCalibration = useAcousticCalibrationStore((s) => s.appliedCalibration);
  const calibrated = !!appliedCalibration;

  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  const initialAngle: Angle = angleParam === 'face_on' || angleParam === 'face-on' ? 'face_on' : 'down_the_line';
  const [angle, setAngle] = useState<Angle>(initialAngle);
  // 2026-06-11 (audit H3) — remember the user's last EXPLICIT angle pick so
  // reset() can restore it. A putt forces 'down_the_line'; without this, that
  // forced DTL bled into the next full swing's capture guides + analysis prior.
  const lastChosenAngleRef = useRef<Angle>(initialAngle);
  // 2026-06-11 (audit H1) — the auto-window-end timeout is armed inside
  // startRecording's closure (deps [micPerm, requestMicPerm]) and would otherwise
  // capture a STALE stopRecording (stale appliedCalibration + stale runAnalysis,
  // i.e. stale angle). Route the auto-stop through this ref so the hands-free
  // "let the 60s run out" path always invokes the CURRENT stopRecording.
  const stopRecordingRef = useRef<() => void>(() => {});

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
  // 2026-06-11 (audit) — mirror selectedSwing in a ref so an async per-swing
  // analysis can detect when its result is STALE (the user scrubbed the reel to
  // a different swing meanwhile) and avoid showing one swing's read under
  // another's header. Effect keeps it synced across every setSelectedSwing site
  // (select, reset, record, the locate fallbacks).
  const selectedSwingRef = useRef(0);
  useEffect(() => { selectedSwingRef.current = selectedSwing; }, [selectedSwing]);
  // Club tag — drives honest ball speed / smash / carry + the CLUB chip.
  // SINGLE SOURCE OF TRUTH: the persisted clubSelectionStore. Reading it
  // reactively means voice ("change club to 7 iron"), the scan-club detector,
  // and the manual picker all update the same value and the HUD reflects it.
  const club = useClubSelectionStore((s) => s.lastClub);
  const setClub = useClubSelectionStore((s) => s.setLastClub);
  const setLastClub = setClub; // alias kept for existing call sites
  const [clubMenuOpen, setClubMenuOpen] = useState(false);
  const [scanningClub, setScanningClub] = useState(false);
  // 2026-06-11 — periodic auto club detection (Tim: "every ~3 cycles"). A completed
  // recording bumps cycleCountRef; every Nth cycle marks a scan due, fired silently
  // once we settle back in setup (see the effect below detectClubFromCamera).
  const cycleCountRef = useRef(0);
  const clubScanDueRef = useRef(false);
  // Putt mode — EXPLICIT, per-recording state (NOT derived from the sticky
  // club). Deriving it from `club === 'PT'` meant a putter tagged once stayed
  // tagged in the persisted clubSelectionStore, so EVERY later recording routed
  // to the putt analyzer instead of the swing analyzer — swings silently stopped
  // getting a swing read. Now putt mode is turned on deliberately (PUTT toggle,
  // or picking the putter) and reset on every new recording, so it can't stick.
  const [puttMode, setPuttMode] = useState(false);
  const isPutt = puttMode;
  const puttModeRef = useRef(false);
  useEffect(() => { puttModeRef.current = puttMode; }, [puttMode]);
  const [puttAnalysis, setPuttAnalysis] = useState<PuttingAnalysis | null>(null);
  // Feels engine — the player tells the caddie how the swing FELT; the caddie
  // reconciles it with the real read and coaches back.
  const [feelText, setFeelText] = useState('');
  const [feelReply, setFeelReply] = useState<string | null>(null);
  const [feelLoading, setFeelLoading] = useState(false);
  const setSessionFeel = useCageStore((s) => s.setSessionFeel);
  // 2026-06-12 — cycling mode toggle: a quick fade-away label on each mode change
  // (one golfer icon you tap to cycle DTL → FO → PUTT, keeping the screen clear).
  const modeFadeOpacity = useRef(new Animated.Value(0)).current;
  const [modeFadeText, setModeFadeText] = useState('');
  const showModeFade = (label: string) => {
    setModeFadeText(label);
    modeFadeOpacity.setValue(1);
    Animated.timing(modeFadeOpacity, { toValue: 0, duration: 1100, delay: 400, useNativeDriver: true }).start();
  };
  // One golfer badge you tap to cycle DTL → FACE-ON → PUTTING (then back), with a
  // quick fade-away label. Putt forces down-the-line under the hood (same as the old
  // PUTT chip). Keeps lastChosenAngleRef in sync so reset() restores the real angle.
  const cycleMode = () => {
    const cur = isPutt ? 'putt' : angle;
    if (cur === 'down_the_line') { setAngle('face_on'); setPuttMode(false); lastChosenAngleRef.current = 'face_on'; showModeFade('FACE-ON'); }
    else if (cur === 'face_on') { setPuttMode(true); setAngle('down_the_line'); showModeFade('PUTTING'); }
    else { setPuttMode(false); setAngle('down_the_line'); lastChosenAngleRef.current = 'down_the_line'; showModeFade('DOWN THE LINE'); }
  };
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
  // 2026-06-12 — draft TARGET for DTL setup: a draggable aim point (the floating
  // end of the ball→target line, like SmartVision). Shown only in DTL (no flight
  // to aim face-on / in a putt). Carries into the session on ingest.
  const [draftTarget, setDraftTarget] = useState<{ x: number; y: number } | null>(DEFAULT_TARGET);
  const draftTargetRef = useRef<typeof draftTarget>(DEFAULT_TARGET);
  useEffect(() => { draftTargetRef.current = draftTarget; }, [draftTarget]);
  const [placeBallMode, setPlaceBallMode] = useState(false);
  // 2026-06-11 — Framing Coach. On-device pose on the LIVE preview tells us if the
  // golfer is fully in frame (head + feet) before they swing — Tim's "Golf Fix knows
  // when you're in frame" idea, now buildable with MediaPipe. Null = not yet checked.
  const [framing, setFraming] = useState<import('../../services/swing/framingCheck').FramingResult | null>(null);
  const framingSpokeRef = useRef(false);   // spoke the "framed" cue once per setup
  const userMovedBallRef = useRef(false);   // don't auto-place the box once the user drags it
  const [videoPaused, setVideoPaused] = useState(false); // review play/pause
  const [playbackRate, setPlaybackRate] = useState(1); // review slow-mo (1 / .5 / .25)
  const [rootSize, setRootSize] = useState({ w: 0, h: 0 });
  // Status-perimeter pulse — a thin border around the video that ties to the
  // analysis phase (green active/done, amber while thinking), like the caddie
  // face box. Subtle opacity loop; native-driven so it's cheap.
  const statusPulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(statusPulse, { toValue: 1, duration: 950, useNativeDriver: true }),
      Animated.timing(statusPulse, { toValue: 0.45, duration: 950, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [statusPulse]);
  const draftBallRef = useRef<typeof draftBall>(null);
  useEffect(() => { draftBallRef.current = draftBall; }, [draftBall]);

  // 2026-06-11 — Framing Coach loop. While lining up (SETUP), grab a preview frame
  // every ~900ms, run ON-DEVICE pose, and evaluate whether the golfer is fully in
  // frame (head + feet). Drives the framing pill + a one-time "you're framed" cue,
  // and auto-anchors the ball box below the detected feet (until the user drags it).
  // Best-effort + cancellable: every step is guarded, so it can NEVER throw or block
  // recording. Stops the instant we leave setup. (If a device plays a shutter sound
  // on takePictureAsync, widen the cadence / gate behind a toggle — confirm in cage.)
  useEffect(() => {
    if (phase !== 'setup') { setFraming(null); framingSpokeRef.current = false; return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        // Don't grab a still while a club scan is running OR while a recording is
        // starting/active/stopping — a takePictureAsync overlapping recordAsync can
        // throw or hiccup the video session on some devices (audit 2026-06-11).
        if (!scanningClub && !recordingPromiseRef.current && !stoppingRef.current) {
          // Bail PERMANENTLY on builds without the on-device pose module (e.g. the
          // older installed APK) — checked BEFORE the camera grab so we never poll
          // takePictureAsync for nothing. Framing stays null (no pill); no crash.
          const mp = await import('../../services/mediaPipePoseService');
          if (!mp.isMediaPipeAvailable()) return; // no reschedule → loop ends
          const pic = await cameraRef.current?.takePictureAsync?.({ base64: true, quality: 0.35, skipProcessing: true });
          const b64 = pic?.base64;
          if (b64 && !cancelled) {
            const frame = await mp.detectPoseFromBase64(b64).catch(() => null);
            if (frame && !cancelled) {
              const { evaluateFraming } = await import('../../services/swing/framingCheck');
              const res = evaluateFraming(frame.keypoints as { name: string; x: number; y: number; score: number }[]);
              if (!cancelled) {
                setFraming(res);
                if (res.status === 'framed' && res.feetCenter) {
                  // Auto-anchor the box below the feet ONCE, only while it's still the
                  // default (never override a placement the user dragged).
                  const placed = draftBallRef.current;
                  const isDefault = !userMovedBallRef.current && (!placed
                    || (Math.abs(placed.x - DEFAULT_BALL_BOX.x) < 0.001 && Math.abs(placed.y - DEFAULT_BALL_BOX.y) < 0.001));
                  if (isDefault) {
                    setDraftBall({ x: res.feetCenter.x, y: Math.min(0.92, res.feetCenter.y + 0.04), r: DEFAULT_BALL_BOX.r });
                  }
                  if (!framingSpokeRef.current) {
                    framingSpokeRef.current = true;
                    const s = useSettingsStore.getState();
                    if (s.voiceEnabled) {
                      void (async () => {
                        try {
                          await configureAudioForSpeech();
                          await speak("You're framed up — start swinging when you're ready.", s.voiceGender, s.language, getApiBaseUrl(), { userInitiated: true });
                        } catch { /* advisory only */ }
                      })();
                    }
                  }
                } else {
                  framingSpokeRef.current = false; // re-arm the cue if they step out
                }
              }
            }
          }
        }
      } catch { /* non-fatal — just retry next tick */ }
      if (!cancelled) timer = setTimeout(() => void tick(), 900);
    };
    timer = setTimeout(() => void tick(), 700); // let the camera settle first
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [phase, scanningClub]);
  // Acoustic impact time of the first swing — needed by the camera verifier,
  // which runs from an effect once the clip + ball spot are both available.
  const firstStrikeMsRef = useRef<number | null>(null);

  const [page, setPage] = useState(0);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [showLayman, setShowLayman] = useState(false);
  const [coachNote, setCoachNote] = useState('');
  // 2026-06-12 (Tim) — voice dictation for the page-2 note/feel inputs so the player
  // can SPEAK how it felt (ingested per-swing). One-shot press-to-talk using the same
  // captureUtterance(/api/transcribe) the caddie uses; safe here because review has the
  // camera unmounted (replay <Video>), so the mic is free (no live-capture contention).
  const [dictating, setDictating] = useState<null | 'note' | 'feel'>(null);
  const dictate = useCallback(async (field: 'note' | 'feel', append: (text: string) => void) => {
    if (dictating) { endCaptureEarly(); return; } // tapping the live mic ends it early
    setDictating(field);
    try {
      const text = await captureUtterance(15000, getApiBaseUrl(), 'en');
      if (text && text.trim()) append(text.trim());
    } catch { /* transcription failed — leave the field as-is, no fake text */ }
    finally { setDictating(null); }
  }, [dictating]);
  const [playbackMs, setPlaybackMs] = useState(0);
  // 2026-06-09 — "Motion overlay" is now a SEPARATE on-demand step (off by
  // default). Default review = watch the swing + Kevin's feedback only, with a
  // clean video. Turning Motion on computes + shows the skeletal overlay, body
  // analysis, tempo and speed — so nothing fires all at once over the video.
  const [showSkeleton, setShowSkeleton] = useState(false);
  // 2026-06-12 — master show/hide for the result overlays on the review video, so the
  // player can grab a CLEAN frame (off) or an annotated one (on) for screenshot/share
  // (Tim's Smart Capture), and to declutter the center video. Video + controls stay.
  const [showResults, setShowResults] = useState(true);
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
  // 2026-06-11 — Front/rear camera toggle ("selfie mode"). Lets the user flip to
  // the FRONT camera to self-frame a face-on recording (verify they're centered /
  // fully in shot) — impossible with the rear camera pointed away. mirror={false}
  // keeps the recording UN-mirrored, so a front face-on clip is geometrically
  // identical to a rear face-on one: handedness, direction faults, and ball/target
  // coords are all unaffected — zero analysis changes. (A mirrored selfie preview
  // would feel natural but flip every direction read, so we deliberately don't.)
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const videoRef = useRef<Video>(null);
  const pagerRef = useRef<ScrollView>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 2026-06-10 — end-of-window audible cue: the recording window length used,
  // and whether the window auto-ended (vs a manual stop) so the cue only fires
  // when the player didn't choose to stop.
  const recordWindowSecRef = useRef(RECORDING_MAX_SECONDS);
  const autoStopAtLimitRef = useRef(false);
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
  // Refs so the analyze callbacks read the CURRENT ball/target anchor without
  // needing them in their dep arrays (avoids stale-closure + dep churn).
  const ballAreaRef = useRef(ballArea);
  const targetPointRef = useRef(targetPoint);
  useEffect(() => { ballAreaRef.current = ballArea; }, [ballArea]);
  useEffect(() => { targetPointRef.current = targetPoint; }, [targetPoint]);

  // Engage mode — placing a target "engages" the session: the caddie now
  // has a committed aim line (ball→target). Aim read is the start-line
  // angle from vertical (+ = right), honest because both points are
  // user-placed (no inferred ball flight). Foundation for target-aware
  // club/strategy logic.
  const engaged = ballArea != null && targetPoint != null;
  // 2026-06-12 — LIVE ball/target: the SETUP draft in setup, the session marks in
  // review. So the aim direction + effort readout update as the DTL target is dragged
  // (interactive geometry ↔ tempo — Tim "the target's not moveable + no readout").
  const liveBall = ballArea ?? draftBall;
  const liveTarget = targetPoint ?? draftTarget;
  const aimRead = useMemo(() => {
    if (!liveBall || !liveTarget) return null;
    const dx = liveTarget.x - liveBall.x;
    const dy = liveBall.y - liveTarget.y; // up the frame = positive (toward target)
    if (dy <= 0.02) return null; // target not meaningfully above the ball
    const deg = Math.round((Math.atan2(dx, dy) * 180) / Math.PI); // + right, - left
    if (Math.abs(deg) <= 2) return 'STRAIGHT';
    return `${Math.abs(deg)}° ${deg > 0 ? 'RIGHT' : 'LEFT'}`;
  }, [liveBall, liveTarget]);
  // GEOMETRY ↔ EFFORT. How far up the frame the target sits from the ball (vs the
  // ball's room to the top) = the declared shot effort: target near the top = a full
  // swing; halfway = a ~half shot. Honest (directly measured, no faked carry number).
  const effortRaw = useMemo(() => {
    if (!liveBall || !liveTarget) return null;
    const up = liveBall.y - liveTarget.y;
    if (up <= 0.02) return null;
    // Scale against the USABLE span (ball → the top cap), so a target at the cap reads
    // ~100% and the ball reads 0% — not against the raw frame top (which is unreachable).
    const span = Math.max(0.001, liveBall.y - EFFORT_TOP_CAP);
    return Math.round(Math.max(0, Math.min(1, up / span)) * 100);
  }, [liveBall, liveTarget]);
  // Review EFFORT chip shows only a genuinely PARTIAL shot; the live setup readout
  // shows any value (incl. ~full) as you move the line.
  const effortPct = effortRaw != null && effortRaw > 0 && effortRaw < 85 ? effortRaw : null;
  // 2026-06-12 — yardage estimate from the SELECTED CLUB + effort % (Tim). Reuses the
  // app's club carry table scaled by handicap; null when we can't honestly estimate.
  const estCarry = useMemo(() => estimateCarryYards(club, effortRaw, profile.handicap), [club, effortRaw, profile.handicap]);
  // 2026-06-11 — DTL ball-trace. DOWN-THE-LINE ONLY (no flight to see face-on or in a
  // putt). The real departure point (from ballDeparture, detected off the acoustic
  // anchor) → the initial direction line measured against the ball→target aim line.
  const ballTrace = useMemo(() => {
    if (angle !== 'down_the_line' || isPutt) return null;
    if (!ballDeparture?.departurePoint || !ballArea) return null;
    return computeTraceDirection(ballArea, ballDeparture.departurePoint, targetPoint);
  }, [angle, isPutt, ballDeparture, ballArea, targetPoint]);
  // Green→red by how far off the aim line it started, dimmed by a weak strike (peakDb
  // vs the session's strongest). Honest: divergence + real strike energy, no faked curve.
  const ballTraceColor = useMemo(() => {
    if (!ballTrace) return '#34d399';
    const seg = segments[selectedSwing];
    const refDb = segments.reduce((m, s) => Math.max(m, s.peakDb ?? 0), 0);
    return traceColor(ballTrace.divergenceDeg, seg?.peakDb, refDb || undefined);
  }, [ballTrace, segments, selectedSwing]);

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

  // 2026-06-12 — RIGHT rail: now the SAME custom green badges as the left rail
  // (Tim — no more teal Ionicon cards). Club path (qualitative, OUT→IN / IN→OUT
  // or "—"), shoulder turn, hip turn. SMASH is DROPPED here — it's parked (no club
  // speed) and lives on the page-2 COMING SOON roadmap, so it must not masquerade
  // as a live rail metric (honesty rule). Each shows "—" until measured.
  const rightMetrics = useMemo(() => {
    if (isPutt) return [];
    const path = clubPathSpec(analysis);
    return [
      { key: 'club_path', img: ICON_METRIC.clubpath, value: path.value, unit: '', label: 'CLUB PATH' },
      { key: 'shoulder', img: ICON_BIOMECH.shoulder, value: biomech?.shoulderTurnDeg != null ? `${Math.round(biomech.shoulderTurnDeg)}` : null, unit: '°', label: 'SHOULDER' },
      { key: 'hip', img: ICON_BIOMECH.hip, value: biomech?.hipTurnDeg != null ? `${Math.round(biomech.hipTurnDeg)}` : null, unit: '°', label: 'HIP TURN' },
    ];
  }, [isPutt, analysis, biomech]);
  // 2026-06-12 — LEFT rail: the ball/result metrics as custom badges (Tim). Honest +
  // distinct: TEMPO (ratio), BALL SPEED (acoustic mph), BALL RESULT (the DTL trace's
  // start direction). Each shows "—" until measured — no fabricated number. (Inferred
  // FACE ≈ ball result, so it's not duplicated; SMASH needs club speed we don't have.)
  const leftMetrics = useMemo(() => {
    if (isPutt) return [];
    const dir = ballTrace
      ? (ballTrace.side === 'straight' ? 'ON LINE' : `${ballTrace.divergenceDeg}° ${ballTrace.side === 'left' ? 'L' : 'R'}`)
      : null;
    return [
      { key: 'tempo', img: ICON_METRIC.tempo, value: tempo?.ratio != null ? `${tempo.ratio.toFixed(1)}` : null, unit: ': 1', label: 'TEMPO' },
      { key: 'speed', img: ICON_METRIC.ballspeed, value: ballSpeed?.ball_speed_mph != null ? `${Math.round(ballSpeed.ball_speed_mph)}` : null, unit: 'mph', label: 'BALL SPEED' },
      { key: 'result', img: ICON_METRIC.ballresult, value: dir, unit: '', label: 'BALL RESULT' },
    ];
  }, [isPutt, tempo, ballSpeed, ballTrace]);

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
      return { text: phase === 'review' && analysisError ? 'NO READ' : 'READING…', tone: 'neutral' as SmTone };
    }
    // 2026-06-11 — "NO READ — RECORD AGAIN" is a TERMINAL state, only in review.
    // The cage's first read often runs a bounded acoustic window, THEN falls back
    // to a whole-clip video re-scan + analysis; in that gap analysis is briefly
    // null. Keying NO READ off `phase === 'analyzing'` (not the old null+no-error
    // test) keeps every in-flight pass — including the re-scan — showing ANALYZING,
    // so the read no longer flashes a fail state before it lands (cage findings).
    return deriveVerdict(analysis, phase === 'analyzing');
  }, [isPutt, puttAnalysis, analysis, analysisError, phase]);
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
    async (rawUri: string, segment?: SwingSegment) => {
      setPhase('analyzing');
      setAnalysis(null);
      setAnalysisError(null);
      setPoseFrames(null);
      setBiomech(null);
      setVideoDurationMs(null);
      // NOTE: ball speed/departure are intentionally NOT cleared here. The live
      // CAGE record path calls runAnalysis AFTER measuring the acoustic ball
      // speed; clearing it here wiped every cage swing's measured value. The
      // upload/library path (which has no acoustics) clears them itself before
      // calling runAnalysis (see the clipUriParam effect). reset()/startRecording
      // also clear them. (audit 2026-06-11)
      ingestedSessionIdRef.current = null;
      analysisCacheRef.current = {};
      // Persist the recorded clip into documents so it survives OS cache
      // eviction — otherwise an old SmartMotion recording later can't replay
      // OR re-analyze (the temp recorder file is gone). Already-persistent or
      // stale uris pass through unchanged. Best-effort; never blocks.
      let uri = rawUri;
      try {
        const { persistClipToDocuments } = await import('../../services/videoUpload');
        uri = await persistClipToDocuments(rawUri);
        // Point the review/replay + re-analyze state at the DURABLE copy (not
        // the temp recorder file) so it survives OS cache eviction.
        if (uri !== rawUri) setClipUri(uri);
      } catch { /* use rawUri */ }
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
        // Carry the pre-record ball box + (DTL) target into the session so the
        // targeting overlay, ball-trace, and effort grading use them in review.
        if (draftBallRef.current) {
          setSessionBallArea(sessionId, draftBallRef.current);
        }
        if (angle === 'down_the_line' && !puttModeRef.current && draftTargetRef.current) {
          setSessionTarget(sessionId, draftTargetRef.current);
        }
      } catch (e) {
        console.log('[smartmotion] library ingest failed (non-fatal):', e);
      }

      // PUTT MODE — when a putter is tagged, analyze the clip AS A PUTT (green
      // read + stroke), not a full-swing fault read. Isolated branch: the swing
      // path below is untouched for every other club. analyzePutt is
      // fallback-safe (always resolves), so this never hangs.
      if (puttModeRef.current) {
        try {
          // 30s watchdog — same guarantee the swing path has. probe /
          // frame-extraction / analyzePutt are all best-effort, but if any
          // of them hangs (a thumbnail decode that never resolves) the screen
          // must NOT be stranded on "Analyzing…" forever. Whichever resolves
          // first wins; on timeout we fall through to review with no putt read.
          const puttWork = (async () => {
            // Frames for the putt read must come from the actual stroke, not the
            // first 3s of setup. videoDurationMs is null this early (the review
            // <Video> hasn't loaded yet), so probe it; and when the acoustic
            // segmenter gave us the stroke window, sample WITHIN it.
            let puttDurMs = videoDurationMs;
            if (puttDurMs == null) {
              puttDurMs = await probeDurationMs(uri).catch(() => null);
            }
            const puttFractions = boundaries
              ? [0.2, 0.5, 0.8].map((f) => {
                  const span = boundaries.endSec - boundaries.startSec;
                  const absSec = boundaries.startSec + span * f;
                  return puttDurMs && puttDurMs > 0 ? (absSec * 1000) / puttDurMs : f;
                })
              : undefined;
            const frames = await extractFramesB64(uri, puttDurMs, puttFractions).catch(() => [] as string[]);
            const sid = ingestedSessionIdRef.current;
            const ballAreaNow = sid
              ? (useCageStore.getState().sessionHistory.find((x) => x.id === sid)?.ball_area_norm ?? null)
              : null;
            return analyzePutt({
              video_url: uri,
              frames_base64: frames.length > 0 ? frames : undefined,
              ball_area_norm: ballAreaNow,
            });
          })();
          const putt = await Promise.race([
            puttWork,
            new Promise<PuttingAnalysis | null>((resolve) => setTimeout(() => resolve(null), 30000)),
          ]);
          if (putt) {
            setPuttAnalysis(putt);
            const sid = ingestedSessionIdRef.current;
            if (sid) { try { useCageStore.getState().addPuttingAnalysis(sid, putt); } catch { /* non-fatal */ } }
          } else {
            setAnalysisError('Putt analysis timed out');
          }
        } catch (e) {
          setAnalysisError(e instanceof Error ? e.message : String(e));
        }
        setPhase('review');
        return;
      }

      // Brain → analysis pretext: feed the CNS learned tendencies as SOFT
      // priors. The server biases toward a named dominant_miss + lists prior
      // faults but always trusts the visual read and notes any disagreement.
      const cnsTend = (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mem = require('../../store/caddieMemoryStore') as typeof import('../../store/caddieMemoryStore');
          return mem.useCaddieMemoryStore.getState().getPlayer().tendencies;
        } catch { return { dominantMiss: null as string | null, recentFaults: [] as string[] }; }
      })();

      try {
        // Watchdog so a hung network call can't strand the screen on the
        // "Analyzing…" overlay. BOUNDED clips (a segment was passed) skip
        // analyzeSwing's internal locate, so 30s is plenty. UNBOUNDED clips
        // (course single-shot, single-swing upload) run an internal
        // probe(≤8s)+locate(≤25s) BEFORE the analysis fetch — 30s would fire
        // before the real read even starts and discard it — so give them ~70s.
        // (audit 2026-06-11)
        const watchdogMs = boundaries ? 30_000 : 70_000;
        const result = await Promise.race([
          analyzeSwing(uri, {
            // Thread the tagged club so the analyst has club context (a driver
            // vs wedge fault read differs); 'unknown' only when truly untagged.
            club: clubRef.current ? clubIdToServerKey(clubRef.current) : 'unknown',
            swing_number: segment?.index ?? 1,
            caddie_name: caddiePersonality,
            angle,
            // Handedness pretext so direction-dependent faults read correctly.
            handedness: swingerHandedness,
            language,
            // CNS recent faults as prior context (server: "Prior swings showed…").
            prior_issues: cnsTend.recentFaults.length > 0 ? cnsTend.recentFaults : undefined,
            player_context: {
              handicap: profile.handicap ?? null,
              // Prefer the LEARNED dominant miss (from real swings) over the
              // static profile value when we have it.
              dominant_miss: cnsTend.dominantMiss ?? profile.dominantMiss ?? null,
              first_name: profile.firstName ?? null,
            },
            tier: 'quick',
            // Ball/stand anchor — where the ball sits (and by extension where the
            // golfer stands). The analyzer uses it as a strong prior: "ball is at
            // (x,y); impact is the frame it leaves that area." Wires the set ball
            // area into the SWING read (was only wired to the putt read before).
            ball_area_norm: draftBallRef.current ?? ballAreaRef.current ?? null,
            target_norm: targetPointRef.current ?? null,
          }, boundaries),
          new Promise<Awaited<ReturnType<typeof analyzeSwing>>>((resolve) =>
            setTimeout(() => resolve({ kind: 'error', message: 'Analysis timed out' }), watchdogMs),
          ),
        ]);
        if (result.kind === 'ok') {
          setAnalysis(result.analysis);
          analysisCacheRef.current[(segment?.index ?? 1) - 1] = result.analysis;
          // Caddie CNS Phase 1 — feed the detected fault into the learning
          // tendencies (rolling dominant miss). Additive + best-effort.
          try {
            const fault = result.analysis.detected_issue ?? null;
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mem = require('../../store/caddieMemoryStore') as typeof import('../../store/caddieMemoryStore');
            mem.useCaddieMemoryStore.getState().recordSwingFault({ fault, nowMs: Date.now() });
          } catch { /* non-fatal */ }
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
    [angle, caddiePersonality, language, profile.handicap, profile.dominantMiss, profile.firstName, setSessionBallArea, setSessionTarget, videoDurationMs, swingerHandedness],
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
        const bio = await analyzeSwingFromVideo(clipUri, videoDurationMs, angle);
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
  }, [clipUri, videoDurationMs, showSkeleton, angle]);

  // Acoustic-anchored tempo + transition for the selected swing. Impact
  // comes from the acoustic strike detector (segment.strikeMs);
  // top-of-backswing is read from pose. Cached per (clip, strike) so
  // re-selecting a swing is instant and we never re-pay the pose calls.
  useEffect(() => {
    const seg = segments[selectedSwing];
    // Tempo is the headline swing metric — compute it in review by default (it
    // surfaces in the left tempo pill). Skipped for putts (no swing tempo).
    // Heavier pose/body still wait for the Motion overlay.
    // 2026-06-11 (audit) — only derive tempo from an ACOUSTIC impact anchor
    // (cage; peakDb>0). For video-located segments (range/upload; peakDb===0) the
    // impact time is only frame-spacing-accurate, and deriveSwingTempo trusts the
    // passed impact directly (downswing = impact − top), so a number here would
    // be dishonest — suppress it until impact is pose-anchored. Cage tempo (the
    // headline metric) is unaffected.
    if (!clipUri || isPutt || !seg || seg.strikeMs == null || (seg.peakDb ?? 0) <= 0) { setTempo(null); return; }
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
  }, [clipUri, segments, selectedSwing, isPutt]);

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
      const apiUrl = getApiBaseUrl();
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

  // Library / upload re-analyze (clipUriParam) path.
  // 2026-06-11 (audit C2) — an uploaded clip carries NO acoustics, so — exactly
  // like range mode — segment swings from VIDEO. Without this, a 6-swing upload
  // collapsed to a single "1 of 1" read (analyzeSwing's internal locateSwingWindow
  // is singular). We only segment when the locator finds MORE THAN ONE swing, so
  // a genuine single-swing upload behaves exactly as before (no regression).
  useEffect(() => {
    if (!(clipUriParam && phase === 'analyzing' && analysis == null && !analysisError)) return;
    // 2026-06-11 (audit fix) — an uploaded/library clip has NO acoustics, so any
    // ball speed/departure from a prior cage swing must be cleared on THIS entry
    // path (not inside runAnalysis, which the cage record path also calls right
    // after it measures the real acoustic ball speed).
    setBallSpeed(null);
    setBallDeparture(null);
    let cancelled = false;
    void (async () => {
      try {
        const pose = await import('../../services/poseDetection');
        const durMs = await pose.probeDurationMs(clipUriParam).catch(() => 0);
        const swings = durMs > 0 ? await pose.locateSwings(clipUriParam, durMs) : [];
        if (!cancelled && swings.length > 1) {
          const segs = segmentsFromVideoSwings(swings, durMs);
          setSegments(segs);
          setSelectedSwing(0);
          void runAnalysis(clipUriParam, segs[0]);
          return;
        }
      } catch (e) {
        console.log('[smartmotion] upload video segmentation failed (non-fatal):', e);
      }
      if (!cancelled) void runAnalysis(clipUriParam); // single-swing fallback
    })();
    return () => { cancelled = true; };
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
    setSwingAnalyzing(false); // audit: never leave the per-swing spinner stuck
    setPoseFrames(null);
    setBiomech(null);
    setVideoDurationMs(null);
    setBallSpeed(null);
    setBallDeparture(null);
    setPuttAnalysis(null);
    // Putt mode is EXPLICIT + per-recording: clear it on every reset so it can
    // never stick across "Record again" / the hands-free voice loop and
    // silently route a full swing to the putt analyzer. (The only in-UI
    // off-switch, the DTL/FO/PUTT toggle, is hidden in review and unreachable
    // by voice — so without this, putt mode set once would trap every later
    // clip. Re-arm putt mode per recording via the PUTT toggle, picking the
    // putter, a club scan, or a voice "switch to putter".)
    setPuttMode(false);
    // Restore the user's last explicit angle — a putt forces down-the-line, and
    // that must not carry into the next full swing's guides/analysis. (audit H3)
    setAngle(lastChosenAngleRef.current);
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
    setVideoPaused(false);
    setPlaybackRate(1);
    setShowSkeleton(false); // Motion defaults OFF each review (light default path)
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
          await speak(reply, s.voiceGender, s.language, getApiBaseUrl(), { userInitiated: true });
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

  // 2026-06-11 (audit) — background-safe per-swing analysis shared by the
  // on-demand selectSwing AND the prefetch below. Windows the clip to the
  // segment, races a 30s watchdog, caches by swing index, and returns the
  // analysis (or null). Does NOT touch any display state, so it's safe to run
  // in the background.
  const analyzeSwingForIndex = useCallback(
    async (idx: number): Promise<SwingAnalysis | null> => {
      const seg = segments[idx];
      if (!seg || !clipUri) return null;
      const cachedHit = analysisCacheRef.current[idx];
      if (cachedHit) return cachedHit;
      // 2026-06-11 — multi-swing variety: hand the analyzer the DISTINCT faults
      // already read on this session's earlier swings (whatever's cached so far).
      // The server treats this (on swing 2+) as a "don't just echo swing 1 — surface
      // a real secondary fault unless the same one is clearly here" directive, so
      // four swings stop returning one identical fault. Empty on swing 1.
      const priorFaultSet = new Set<string>();
      for (const [k, a] of Object.entries(analysisCacheRef.current)) {
        if (Number(k) >= idx) continue;
        const f = a?.primary_fault ?? a?.detected_issue ?? null;
        if (f && f !== 'none' && f !== 'no_dominant_fault' && f !== 'inconclusive') priorFaultSet.add(f);
      }
      const sessionPriorFaults = Array.from(priorFaultSet);
      try {
        const r = await Promise.race([
          analyzeSwing(clipUri, {
            club: clubRef.current ? clubIdToServerKey(clubRef.current) : 'unknown',
            swing_number: seg.index,
            caddie_name: caddiePersonality,
            angle,
            handedness: swingerHandedness,
            language,
            prior_issues: sessionPriorFaults.length > 0 ? sessionPriorFaults : undefined,
            player_context: {
              handicap: profile.handicap ?? null,
              dominant_miss: profile.dominantMiss ?? null,
              first_name: profile.firstName ?? null,
            },
            tier: 'quick',
            ball_area_norm: ballAreaRef.current ?? draftBallRef.current ?? null,
            target_norm: targetPointRef.current ?? null,
          }, { startSec: seg.startMs / 1000, endSec: seg.endMs / 1000 }),
          new Promise<Awaited<ReturnType<typeof analyzeSwing>>>((resolve) =>
            setTimeout(() => resolve({ kind: 'error', message: 'Analysis timed out' }), 30000),
          ),
        ]);
        if (r.kind === 'ok') { analysisCacheRef.current[idx] = r.analysis; return r.analysis; }
      } catch { /* non-fatal */ }
      return null;
    },
    [segments, clipUri, angle, caddiePersonality, language, profile.handicap, profile.dominantMiss, profile.firstName, swingerHandedness],
  );

  // 2026-06-11 (audit opt #1) — prefetch the NEXT swing's read in the background
  // so stepping through the reel is instant instead of a 3-8s wait per tab.
  // BOUNDED: depth 1 (only the immediate next swing) and a single in-flight
  // prefetch at a time, so a 6-swing reel never fans out 6 concurrent Haiku
  // calls — at most one read ahead of the user. If the user stops at swing 1,
  // only swing 2 is ever prefetched.
  const prefetchInFlightRef = useRef(false);
  const prefetchSwing = useCallback((idx: number) => {
    if (idx < 0 || idx >= segments.length) return;
    if (analysisCacheRef.current[idx]) return;
    if (prefetchInFlightRef.current) return;
    prefetchInFlightRef.current = true;
    void analyzeSwingForIndex(idx).finally(() => { prefetchInFlightRef.current = false; });
  }, [segments.length, analyzeSwingForIndex]);

  const selectSwing = useCallback(
    async (idx: number) => {
      const seg = segments[idx];
      if (!seg) return;
      setSelectedSwing(idx);
      videoRef.current?.setPositionAsync(seg.startMs).catch(() => undefined);
      videoRef.current?.playAsync().catch(() => undefined);

      const cached = analysisCacheRef.current[idx];
      // 2026-06-11 (audit fix) — clear the analyzing spinner on a cached hit too.
      // Without this, scrubbing to a cached swing while an earlier read is still
      // in flight left swingAnalyzing stuck true (the in-flight call's clear is
      // guarded by the staleness check and never fires) → spinner forever.
      if (cached) { setAnalysis(cached); setSwingAnalyzing(false); return; }
      if (!clipUri) return;
      // Per-swing analysis on demand — windowed to this segment.
      setSwingAnalyzing(true);
      const a = await analyzeSwingForIndex(idx);
      // Only apply to the display if THIS swing is still selected — a fast reel
      // scrub could have moved on, and a late-resolving older read would
      // otherwise overwrite the current swing's view. (audit)
      if (selectedSwingRef.current === idx) {
        if (a) setAnalysis(a);
        setSwingAnalyzing(false);
      }
    },
    [segments, clipUri, analyzeSwingForIndex],
  );

  // 2026-06-11 (audit opt #1) — once the current swing's read is in, prefetch the
  // next one. Watching `analysis` covers both the fetch and the cache-hit paths
  // (selectSwing sets analysis in both, and the first swing's read after capture
  // sets it too), while the in-flight + cached guards keep it to a single read
  // ahead. The background prefetch itself never sets `analysis`, so it can't
  // re-trigger this effect into a loop.
  useEffect(() => {
    if (!analysis || segments.length <= 1) return;
    prefetchSwing(selectedSwing + 1);
  }, [analysis, selectedSwing, segments.length, prefetchSwing]);

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
    // Clear the prior swing's results so the next minute starts clean (the
    // voice loop uses startRecording, not reset).
    setAnalysis(null);
    setAnalysisError(null);
    setPuttAnalysis(null);
    setTempo(null);
    setFeelText('');
    setFeelReply(null);
    setVideoPaused(false);
    setPlaybackRate(1);
    setPlaceBallMode(false); // keep draftBall (carries into the session) but exit place mode
    setSegments([]);
    setSelectedSwing(0);
    setLiveDb(null);
    setRecordedSeconds(0);
    stoppingRef.current = false;
    setPhase('recording');

    // 2026-06-10 — Mode-aware capture. Read fresh so the current state wins
    // without re-creating this callback. A live round forces COURSE.
    //   cage   → metered audio track for acoustic multi-strike segmentation
    //   range  → metered track ALSO runs, but as CANDIDATES the video locator
    //            confirms (acoustics propose when, vision disposes which — the
    //            mic can't separate a neighbour's strike, the in-frame video can)
    //   course → acoustics OFF (wind), single shot via video localization
    // 2026-06-11 — range was video-only; now it keeps the metered track too so a
    // confirmed strike donates the precise impact instant + peakDb (honest tempo
    // + the ball-trace anchor). Course stays off (single shot, wind).
    const roundActive = useRoundStore.getState().isRoundActive;
    const captureMode = roundActive ? 'course' : useSettingsStore.getState().environmentMode;
    const maxSec = captureMode === 'range' ? RANGE_RECORDING_MAX_SECONDS : RECORDING_MAX_SECONDS;
    // 2026-06-11 — mode-aware metering (Tim): a chip's strike is too quiet to read over
    // a noisy RANGE, so CHIP mode shuts range acoustics off (video-only) and instead
    // enables them for the QUIET spots — cage + course (off-round; during a live round
    // the mic belongs to voice listening, so course stays silent then). Default (no
    // chip): cage (acoustic multi-swing) + range (acoustic candidates + vision).
    const chipOnStart = useSettingsStore.getState().chipSensitivity;
    const useMetering = chipOnStart
      ? (captureMode === 'cage' || (captureMode === 'course' && !roundActive))
      : (captureMode === 'cage' || captureMode === 'range');
    if (useMetering) {
      // Parallel metered audio track for multi-strike detection.
      try {
        meteringRef.current = await startMeteredRecording((s) => setLiveDb(s.dB));
      } catch {
        meteringRef.current = null;
      }
    } else {
      meteringRef.current = null;
    }

    // Assign the camera promise BEFORE arming timers (avoid the stop race).
    try {
      recordingPromiseRef.current = cameraRef.current.recordAsync({ maxDuration: maxSec }) as Promise<{ uri: string } | undefined>;
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
    recordWindowSecRef.current = maxSec; // for the end-of-window audible cue
    recordTimerRef.current = setInterval(() => {
      setRecordedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 200);
    // 2026-06-10 — When the window auto-ends (vs a manual stop), flag it so
    // stopRecording can play an audible "that's time, analyzing" cue.
    recordTimeoutRef.current = setTimeout(() => { autoStopAtLimitRef.current = true; void stopRecordingRef.current(); }, maxSec * 1000);
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
    // 2026-06-11 — raw acoustic candidates kept separate from the finalized
    // segments. CAGE finalizes straight from acoustics (clean, alone). RANGE
    // holds these as CANDIDATES the video locator confirms below (a busy range's
    // mic can't separate a neighbour — only the in-frame video can).
    let acousticStrikes: DetectedStrike[] = [];
    let firstStrikeMs: number | null = null;
    try {
      if (meteringRef.current) {
        const { samples, uri, durationMs } = await meteringRef.current.stop();
        meteringRef.current = null;
        audioUriRef.current = uri;
        const meterMode = useRoundStore.getState().isRoundActive
          ? 'course'
          : useSettingsStore.getState().environmentMode;
        // RANGE tolerates a louder floor (vision confirms every candidate, so a
        // noisy floor can't fabricate a swing); cage keeps the strict default.
        // CHIP sensitivity drops the threshold so a quiet pitch/chip still registers.
        const chipOn = useSettingsStore.getState().chipSensitivity;
        const res = detectStrikes(samples, {
          thresholdDb: chipOn ? CHIP_STRIKE_THRESHOLD_DB : appliedCalibration?.transientThresholdDb,
          noisyFloorDb: meterMode === 'range' ? 0 : undefined,
        });
        if (res.kind === 'ok' && res.strikes.length > 0) {
          acousticStrikes = res.strikes;
          // CAGE: trust acoustics as the final segmentation here. RANGE waits for
          // video confirmation (correlateStrikesWithVideo) in the clip branch.
          if (meterMode === 'cage') {
            detectedSegments = segmentsFromStrikes(res.strikes, durationMs);
            firstStrikeMs = res.strikes[0]?.timeMs ?? null;
          } else if (meterMode === 'course') {
            // CHIP on COURSE (off-round, single shot): no multi-segmentation — just
            // take the chip's strike as the impact anchor for tempo / ball-departure.
            firstStrikeMs = res.strikes[0]?.timeMs ?? null;
          }
        }
      }
    } catch (e) {
      console.log('[smartmotion] metering/segmentation failed (non-fatal):', e);
    }
    setSegments(detectedSegments);
    setSelectedSwing(0);

    // 2026-06-10 — Audible end-of-window cue. ONLY when the window auto-ended
    // (the player didn't stop themselves) — a light haptic + a brief caddie line
    // so they know to stop swinging and analysis has started. Mode-aware on the
    // window length (1 min cage/coach/course, 2 min range). Fully fire-and-forget
    // and best-effort: it can never block or affect the analysis below. Camera +
    // metering are already stopped here, so the audio session is free for speech.
    if (autoStopAtLimitRef.current) {
      autoStopAtLimitRef.current = false;
      const windowSec = recordWindowSecRef.current;
      try { Vibration.vibrate(120); } catch { /* haptic optional */ }
      const sset = useSettingsStore.getState();
      if (sset.voiceEnabled) {
        void (async () => {
          try {
            await configureAudioForSpeech();
            await speak(
              `That's your ${windowSec >= 120 ? 'two minutes' : 'minute'} — analyzing now.`,
              sset.voiceGender,
              sset.language,
              getApiBaseUrl(),
              { userInitiated: true },
            );
          } catch { /* advisory only */ }
        })();
      }
    }

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
      // 2026-06-11 (audit) — 8s→20s. Flushing a 60s/120s clip on a slower/older
      // device can take >8s; the old cap discarded a valid recording as "no
      // file". Also swallow a late rejection on the orphaned promise (when the
      // timeout wins the race) so it can't surface as an unhandled rejection.
      if (pending) void pending.catch(() => undefined);
      const recorded = pending
        ? await Promise.race([
            pending,
            new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20000)),
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
      // 2026-06-11 — count the cycle; every Nth, queue a SILENT auto club scan for
      // the next setup (the effect below detectClubFromCamera fires it).
      cycleCountRef.current += 1;
      if (cycleCountRef.current % 3 === 0) clubScanDueRef.current = true;

      // 2026-06-11 — RANGE: acoustics PROPOSE *when*, vision DISPOSES *which*. The
      // video locator finds the swings actually in YOUR frame (the spine — the
      // count is never inflated by a neighbour's sound); correlateStrikesWithVideo
      // snaps each acoustic candidate onto its video swing, donating the precise
      // impact instant + peakDb (honest tempo + the ball-trace anchor) where they
      // agree. Degrades cleanly: video-only if nothing was heard, acoustic-only if
      // the locator came up empty. COURSE (incl. any live round) stays single-shot
      // and falls through to single-swing localization (runAnalysis, no segment).
      // CAGE: trust the acoustic segments, but cross-check the video locator when
      // ≤1 strike (audit C1 — a loud/open bay zeroes the detector; don't collapse a
      // 6-swing reel to "1 of 1"). That fallback only ADDS missed swings, never reduces.
      const stopMode = useRoundStore.getState().isRoundActive
        ? 'course'
        : useSettingsStore.getState().environmentMode;
      let segsForAnalysis = detectedSegments;
      if (stopMode === 'range') {
        try {
          const pose = await import('../../services/poseDetection');
          const durMs = await pose.probeDurationMs(recorded.uri).catch(() => RANGE_RECORDING_MAX_SECONDS * 1000);
          const swings = await pose.locateSwings(recorded.uri, durMs);
          if (swings.length > 0 && acousticStrikes.length > 0) {
            segsForAnalysis = correlateStrikesWithVideo(acousticStrikes, swings, durMs);
          } else if (swings.length > 0) {
            segsForAnalysis = segmentsFromVideoSwings(swings, durMs); // nothing heard cleanly
          } else if (acousticStrikes.length > 0) {
            segsForAnalysis = segmentsFromStrikes(acousticStrikes, durMs); // vision empty — best effort
          }
          if (segsForAnalysis.length > 0) {
            setSegments(segsForAnalysis);
            setSelectedSwing(0);
            // Audit fix (2026-06-11) — ALWAYS seed the first-strike anchor from the
            // first segment (its strikeMs is always populated, acoustic or video time)
            // so camera strike-verification still runs for a VIDEO-ONLY first swing.
            // Only the ball-SPEED call needs a real acoustic strike (peakDb > 0).
            const s0 = segsForAnalysis[0];
            if (s0) {
              firstStrikeMs = s0.strikeMs;
              firstStrikeMsRef.current = s0.strikeMs;
            }
            if (s0 && (s0.peakDb ?? 0) > 0) {
              if (audioUriRef.current) {
                try {
                  const speed = await detectBallSpeed({
                    audioUri: audioUriRef.current,
                    impact_ms: s0.strikeMs,
                    club: clubIdToServerKey(clubRef.current),
                  });
                  if (speed) setBallSpeed(speed);
                } catch { /* non-fatal */ }
              }
            }
          }
        } catch (e) {
          console.log('[smartmotion] range correlation failed (non-fatal):', e);
        }
      } else if (stopMode === 'cage' && detectedSegments.length <= 1) {
        try {
          const pose = await import('../../services/poseDetection');
          const durMs = await pose.probeDurationMs(recorded.uri).catch(() => RANGE_RECORDING_MAX_SECONDS * 1000);
          // cage with exactly 1 strike: only cross-check on a LONG clip — a short
          // single-strike clip is a legit single swing, don't override it with a
          // possibly-noisier video read. cage-0 always tries (nothing to lose).
          const worthVideo = detectedSegments.length === 0 || durMs > 20_000;
          if (worthVideo) {
            const swings = await pose.locateSwings(recorded.uri, durMs);
            // Use the video segments only if they found MORE swings than acoustics
            // — never reduce the count, just recover missed ones.
            if (swings.length > segsForAnalysis.length) {
              segsForAnalysis = segmentsFromVideoSwings(swings, durMs);
              setSegments(segsForAnalysis);
              setSelectedSwing(0);
            }
          }
        } catch (e) {
          console.log('[smartmotion] cage video fallback failed (non-fatal):', e);
        }
      }
      // Analyze the FIRST detected swing windowed to its segment; other
      // swings analyze on-demand when selected in the reel.
      void runAnalysis(recorded.uri, segsForAnalysis[0]);
    } catch (e) {
      recordingPromiseRef.current = null;
      stoppingRef.current = false;
      setAnalysisError(e instanceof Error ? e.message : String(e));
      setPhase('setup');
    }
  }, [runAnalysis, appliedCalibration]);
  // Keep the auto-stop ref pointed at the current stopRecording (audit H1).
  stopRecordingRef.current = stopRecording;

  // ── club detection (manual scan + periodic auto, hands-free) ───────────────
  // A scan grabs a frame, recognizes the club, and tags it. High/med confidence →
  // set it + a spoken "Got it, 7-iron". Club state is the shared store, so this
  // updates the HUD, ball speed, etc. everywhere. Never blocks recording.
  //
  // `auto` distinguishes the PERIODIC scan (every few cycles) from a MANUAL/voice
  // scan: on a low-confidence read a MANUAL scan opens the picker so the user can
  // confirm, but the AUTO scan stays SILENT (keeps the current club) — popping the
  // picker mid-session every few cycles would hijack the hands-free flow. (2026-06-11
  // — auto path added; before this the "auto between minutes" comment was aspirational,
  // the scan only ever fired from the tool-rail button or a voice "scan club".)
  const detectClubFromCamera = useCallback(async (opts?: { auto?: boolean }) => {
    if (scanningClub) return;
    const auto = opts?.auto === true;
    // Don't grab a still mid-record (audit 2026-06-11) — a takePictureAsync overlapping
    // recordAsync can hiccup the video session. The periodic auto scan especially must
    // never fire into a recording the user just started.
    if (recordingPromiseRef.current || stoppingRef.current) return;
    setScanningClub(true);
    try {
      const apiUrl = getApiBaseUrl();
      const pic = await cameraRef.current?.takePictureAsync?.({ base64: true, quality: 0.5, skipProcessing: true });
      const b64 = pic?.base64;
      if (!apiUrl || !b64) { if (!auto) setClubMenuOpen(true); return; }
      const res = await recognizeClubFromBase64(b64, apiUrl);
      if (res.kind === 'ok' && res.club_id !== 'unknown' && res.confidence !== 'low') {
        setClub(res.club_id);
        // Manual/voice scan owns putt mode both ways; the SILENT auto scan only sets
        // it ADDITIVELY (a confident putter → putt mode) and never CLEARS a putt mode
        // the user set deliberately (audit 2026-06-11 — explicit per-recording intent).
        if (auto) { if (res.club_id === 'PT') setPuttMode(true); }
        else setPuttMode(res.club_id === 'PT');
        try {
          const s = useSettingsStore.getState();
          await configureAudioForSpeech();
          await speak(`Got it — ${clubLabel(res.club_id)}.`, s.voiceGender, s.language, apiUrl, { userInitiated: true });
        } catch { /* speech non-fatal */ }
      } else if (!auto) {
        // Manual scan couldn't confirm — let the user confirm/correct in the picker.
        setClubMenuOpen(true);
      }
      // auto + low-confidence → stay silent, keep the current club.
    } catch (e) {
      console.log('[smartmotion] club scan failed:', e);
      if (!auto) setClubMenuOpen(true);
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
  // From REVIEW the camera is unmounted (the replay <Video> is shown), so
  // startRecording's `cameraRef.current` is null and a voice "record" would
  // no-op. We reset() to setup (camera re-mounts) and set this flag; the
  // CameraView's onCameraReady then auto-starts the next recording. This keeps
  // the hands-free "do a minute, review, go again" loop working by voice.
  const pendingStartRef = useRef(false);
  const beginNextRecording = useCallback(() => {
    if (phase === 'review') {
      pendingStartRef.current = true;
      reset(); // → setup; CameraView mounts; onCameraReady fires startRecording
    } else if (phase !== 'analyzing' && phase !== 'recording') {
      void startRecording();
    }
  }, [phase, reset, startRecording]);

  // 2026-06-11 — fire the queued periodic auto club scan once we're back in setup —
  // but NOT during the hands-free auto-record relaunch (pendingStartRef), so it can
  // never race the camera into the next recording. Silent (auto:true), and yields
  // to/from the framing loop via scanningClub.
  useEffect(() => {
    if (phase !== 'setup' || !clubScanDueRef.current || scanningClub || pendingStartRef.current) return;
    clubScanDueRef.current = false;
    const t = setTimeout(() => { void detectClubFromCamera({ auto: true }); }, 500);
    return () => clearTimeout(t);
  }, [phase, scanningClub, detectClubFromCamera]);

  // Review video transport + keep/discard for the control bar.
  const togglePlay = useCallback(() => {
    setVideoPaused((p) => {
      const next = !p;
      if (next) void videoRef.current?.pauseAsync().catch(() => undefined);
      else void videoRef.current?.playAsync().catch(() => undefined);
      return next;
    });
  }, []);
  // 2026-06-11 — was a dead-end toast (deferred-wiring placeholder). The session
  // already auto-ingests at record time and the analysis/biomech attach to it, so
  // the data IS persisted — but the user's explicit "Save" tap did nothing visible
  // and never took them to the library (Tim's "reports didn't save / didn't go to
  // the swing library"). Now it flushes any review-time coach note, confirms, and
  // navigates to the library so the saved swing is right there.
  const confirmSave = useCallback(() => {
    const sid = ingestedSessionIdRef.current;
    if (sid && coachNote.trim()) {
      try { useCageStore.getState().setSessionCoachNote(sid, coachNote); } catch { /* non-fatal */ }
    }
    useToastStore.getState().show('Saved to your Swing Library');
    router.push('/swinglab/library' as never);
  }, [coachNote, router]);
  // Slow-mo cycle for swing review (rate prop on the Video — safe, declarative).
  const cycleSpeed = useCallback(() => {
    setPlaybackRate((r) => (r === 1 ? 0.5 : r === 0.5 ? 0.25 : 1));
  }, []);
  const discardSwing = useCallback(() => {
    const sid = ingestedSessionIdRef.current;
    if (sid) { try { useCageStore.getState().deleteSession(sid); } catch { /* non-fatal */ } }
    useToastStore.getState().show('Swing discarded');
    reset();
  }, [reset]);

  const recordCmdRef = useRef<(cmd: SmartMotionCommand) => void>(() => {});
  recordCmdRef.current = (cmd) => {
    if (cmd === 'scanClub') { void detectClubFromCamera(); return; }
    // Voice club change set putt mode (parity with the picker / club scan).
    if (cmd === 'puttOn') { setPuttMode(true); setAngle('down_the_line'); return; }
    if (cmd === 'puttOff') { setPuttMode(false); return; }
    const recording = phase === 'recording';
    if (cmd === 'stop') { if (recording) void stopRecording(); return; }
    if (cmd === 'start') { if (!recording) beginNextRecording(); return; }
    // toggle
    if (recording) void stopRecording();
    else beginNextRecording();
  };
  useEffect(() => {
    setSmartMotionActive(true);
    const unsub = subscribeSmartMotionCommand((cmd) => recordCmdRef.current(cmd));
    // Warm /api/swing-analysis the moment SmartMotion opens so the FIRST
    // recording's analysis hits a hot Lambda (no cold-start latency that could
    // push it toward the client timeout). Mirrors the upload/cage screens.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/swingAnalysisWarmup').prewarmSwingAnalysis({ force: true });
    } catch { /* non-fatal */ }
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
  // Universal control bar — clean translucent icons. Setup: Record. Recording:
  // Stop. Review: Play/Pause · Slow-mo · Save · Delete · Record-again.
  const actionBtn =
    phase === 'recording' ? (
      // Stop as the matching green-circle badge (Tim's set), with a faint red fill so
      // "recording — tap to stop" still reads as live/urgent against the rest of the bar.
      <Pressable onPress={() => void stopRecording()} style={[styles.toolBtnBare, styles.barBtnStop]} accessibilityRole="button" accessibilityLabel="Stop recording">
        <Image source={ICON_CTRL.stop} style={{ width: 56, height: 56 }} resizeMode="contain" />
      </Pressable>
    ) : isReview ? (
      // Review controls as matching green-circle badges (Tim's art): play/pause ·
      // slow-mo · save · delete · record-again. Each uses its own circle (no border);
      // slow-mo fills when slowed + keeps a tiny rate tag so ½/¼ stays visible.
      <View style={styles.barRow}>
        <Pressable onPress={togglePlay} style={styles.toolBtnBare} accessibilityRole="button" accessibilityLabel={videoPaused ? 'Play' : 'Pause'}>
          <Image source={ICON_CTRL.playpause} style={styles.toolIconFull} resizeMode="contain" />
        </Pressable>
        <Pressable onPress={cycleSpeed} style={[styles.toolBtnBare, playbackRate < 1 && styles.toolBtnBareActive]} accessibilityRole="button" accessibilityLabel={`Playback speed ${playbackRate}x`}>
          <Image source={ICON_CTRL.slowmo} style={styles.toolIconFull} resizeMode="contain" />
          {playbackRate < 1 ? <Text style={styles.barRateTag}>{playbackRate === 0.5 ? '½' : '¼'}</Text> : null}
        </Pressable>
        <Pressable onPress={confirmSave} style={styles.toolBtnBare} accessibilityRole="button" accessibilityLabel="Save to library">
          <Image source={ICON_CTRL.save} style={styles.toolIconFull} resizeMode="contain" />
        </Pressable>
        <Pressable onPress={discardSwing} style={styles.toolBtnBare} accessibilityRole="button" accessibilityLabel="Delete swing">
          <Image source={ICON_CTRL.delete} style={styles.toolIconFull} resizeMode="contain" />
        </Pressable>
        <Pressable onPress={() => beginNextRecording()} style={styles.toolBtnBare} accessibilityRole="button" accessibilityLabel="Record again">
          <Image source={ICON_CTRL.record} style={styles.toolIconFull} resizeMode="contain" />
        </Pressable>
      </View>
    ) : phase === 'setup' ? (
      <Pressable onPress={() => void startRecording()} style={[styles.toolBtnBare, styles.barBtnRecord]} accessibilityRole="button" accessibilityLabel="Record">
        <Image source={ICON_CTRL.record} style={{ width: 56, height: 56 }} resizeMode="contain" />
      </Pressable>
    ) : (
      <View style={styles.barBtn} />
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
        <Text style={[styles.reelLabel, { color: '#fff' }]}>{segments.length} SWINGS</Text>
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

  // 2026-06-12 (Tim) — PAGE 3 (SHOT MAP) only exists for down-the-line modes, so the
  // page/dot count is dynamic. Declared before hudPage because the dots read pageCount.
  const showShotMap = !isPutt && angle === 'down_the_line';
  const pageCount = showShotMap ? 3 : 2;

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
            shouldPlay={!videoPaused}
            rate={playbackRate}
            shouldCorrectPitch={false}
            // 2026-06-09 — Mute the review loop. The captured clip's audio
            // (e.g. a TV in the room) replaying on loop reads as "audio
            // feedback"; it adds nothing to silent skeleton/speed analysis.
            isMuted
            useNativeControls={false}
            onLoad={(s) => { if ('durationMillis' in s && s.durationMillis) setVideoDurationMs(s.durationMillis); }}
            onPlaybackStatusUpdate={(s) => { if (showSkeleton && 'positionMillis' in s && typeof s.positionMillis === 'number') setPlaybackMs(s.positionMillis); }}
          />
        ) : (
          // 2026-06-09 — `mute` disables the camera's own audio track. We run a
          // SEPARATE Audio.Recording for acoustic strike metering; on iOS the
          // audio session is a singleton, so two concurrent recorders can
          // collide and silently kill metering (→ no strikes/segments/tempo).
          // We never use the clip's audio (playback is muted), so muting the
          // camera is lossless and removes the contention.
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            mirror={false}
            mode="video"
            mute
            onCameraReady={() => {
              // Auto-start a voice-requested recording once the camera (re)mounts
              // coming out of review — completes the hands-free loop.
              if (pendingStartRef.current) { pendingStartRef.current = false; void startRecording(); }
            }}
          />
        )}

        {/* STATUS PERIMETER — thin pulsing border tied to the analysis phase:
            amber while analyzing ("thinking"), green otherwise (live / ready /
            analyzed). Like the caddie face box. Decorative — never blocks. */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.statusBorder,
            { borderColor: phase === 'analyzing' ? '#f59e0b' : '#34d399', opacity: statusPulse },
          ]}
        />

        {/* LEFT RAIL — ball/result metric badges (review): tempo · ball speed · ball
            result. Mirrors the right rail so the metrics flank the video and the
            centre stays clear (Tim). Honest "—" until measured. Hide-toggle gated. */}
        {isReview && showResults && !isPutt ? (
          <View style={[styles.leftRail, { top: insets.top + 60 }]} pointerEvents="none">
            {leftMetrics.map((m) => (
              <View key={m.key} style={styles.metricBadgeCard}>
                <Image source={m.img} style={styles.metricBadgeImg} resizeMode="contain" />
                <View style={styles.metricBadgeText}>
                  <Text style={styles.metricBadgeValue} numberOfLines={1}>
                    {m.value ?? '—'}{m.value != null && m.unit ? <Text style={styles.metricBadgeUnit}> {m.unit}</Text> : null}
                  </Text>
                  <Text style={styles.metricBadgeLabel} numberOfLines={1}>{m.label}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* EFFORT chip — declared shot effort from ball→target geometry (a partial
            shot). Honest: directly measured, no faked carry. The read is graded
            against this intended effort, so a deliberate half-swing isn't a "fault". */}
        {isReview && showResults && !isPutt && effortPct != null ? (
          <View style={[styles.effortPill, { top: insets.top + 150 }]} pointerEvents="none">
            <Text style={styles.tempoPillLabel}>EFFORT</Text>
            <Text style={[styles.tempoPillValue, { color: '#88F700' }]}>{effortPct}%</Text>
            <Text style={styles.tempoPillUnit}>shot</Text>
          </View>
        ) : null}

        {/* Smart Capture — tap exposed video to freeze + mark up. */}
        {isReview && clipUri ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAnnotateOpen(true)} accessibilityRole="button" accessibilityLabel="Freeze and mark up this swing" />
        ) : null}

        {/* Attached skeletal overlay — real keypoints tracked to playback. */}
        {isReview && showResults && showSkeleton && poseFrames && poseFrames.length > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <SwingBodyOverlay frames={poseFrames} currentTimeMs={playbackMs} showSkeleton showTrace={false} resizeMode="cover" />
          </View>
        ) : null}

        {/* Ball area + (movable) target overlay — reference markers placed
            via the targeting card on the analysis page. */}
        {isReview && showResults && (ballArea || targetPoint) ? (
          // 2026-06-11 — DRAGGABLE in review: the recorded clip's FOV is a tighter
          // crop than the live preview (Samsung video crop), so a box placed in
          // setup can land a bit off on playback. Review IS the actual recorded
          // frame, so dragging here is guaranteed-faithful fine-tuning that sticks
          // to the session. (No face-on launch line — you can't see flight head-on.)
          <EditableCageTargets
            ballArea={ballArea}
            target={targetPoint}
            targetKind={isPutt ? 'cup' : 'aim'}
            onChangeBallArea={(a) => { if (sessionId) setSessionBallArea(sessionId, a); }}
            onChangeTarget={(t) => { if (sessionId) setSessionTarget(sessionId, t); }}
          />
        ) : null}

        {/* DTL ball-trace — the real initial departure direction, green→red by how
            far off the aim line it started. Down-the-line only (gated in ballTrace). */}
        {isReview && showResults && ballTrace ? (
          <BallTraceOverlay trace={ballTrace} color={ballTraceColor} />
        ) : null}

        {/* SETUP / RECORDING — the ball box is the SINGLE target origin: the
            target line runs straight up from the ball box (one unified anchor,
            no duplicate static box). Shown while lining up and while recording. */}
        {phase === 'setup' && draftBall ? (
          // SETUP — DRAG to anchor the ball box AND (DTL only) the TARGET. The ball→
          // target aim line + the live effort/direction readout update as you drag the
          // floating target end (Tim: "the target's not moveable + no readout"). No
          // target face-on / in a putt (no flight to aim). Both carry into the session.
          <EditableCageTargets
            ballArea={draftBall}
            // Putt sets angle to down_the_line too, so this enables BOTH the DTL aim
            // target and the putt CUP flag; face-on has no on-floor target. The effort
            // clamp is DTL-only (putt has no "effort" — the flag goes wherever the cup is).
            target={angle === 'down_the_line' ? draftTarget : null}
            targetKind={isPutt ? 'cup' : 'aim'}
            onChangeBallArea={(a) => { userMovedBallRef.current = true; setDraftBall(a); }}
            onChangeTarget={(t) => setDraftTarget(isPutt ? { x: t.x, y: t.y } : { x: t.x, y: Math.max(EFFORT_TOP_CAP, t.y) })}
          />
        ) : phase === 'recording' && draftBall ? (
          // RECORDING — display only (you're swinging; no dragging mid-record).
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <CageTargetingOverlay ballArea={draftBall} target={angle === 'down_the_line' ? draftTarget : null} launchDir={null} targetKind={isPutt ? 'cup' : 'aim'} />
          </View>
        ) : null}
        {phase === 'setup' && placeBallMode ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={(e) => {
              const { locationX, locationY } = e.nativeEvent;
              if (rootSize.w > 0 && rootSize.h > 0) {
                userMovedBallRef.current = true;
                setDraftBall({ x: locationX / rootSize.w, y: locationY / rootSize.h, r: 0.07 });
              }
              setPlaceBallMode(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Tap where your ball is"
          />
        ) : null}

        {/* Framing guides for BOTH angles during line-up/recording:
              • DTL  → center target line (ball straight up to target)
              • FO   → the two stance lines (TARGET LINE + BALL LINE), mirrored
                       for lefties — restored here; gating to DTL-only had left
                       face-on with no side guides at all.
            Suppressed in review and while analyzing. */}
        {phase !== 'analyzing' && !isReview
          ? <CaptureGuides mode={angle} handedness={swingerHandedness} ball={draftBall} aspect={rootSize.h > 0 ? rootSize.w / rootSize.h : null} />
          : null}

        {/* TOP BAR (interactive) */}
        <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
          <CaddieMicBadge size={36} />
          <SmartMotionHeader mode={angle} style={{ flex: 1, borderBottomWidth: 0, paddingVertical: 0, paddingHorizontal: 6 }} />
          <View style={styles.dotsRow}>
            {Array.from({ length: pageCount }).map((_, i) => (
              <View key={i} style={[styles.dot, { backgroundColor: page === i ? colors.accent : 'rgba(255,255,255,0.35)' }]} />
            ))}
          </View>
        </View>

        {/* SETUP TOOL RAIL — translucent icon buttons on the right edge so the
            bottom + ball box stay clear. Calibrate · scan club · place ball.
            Same handlers as the old bars, just compact + out of the way. */}
        {phase === 'setup' ? (
          <View style={[styles.toolRail, { top: insets.top + 76 }]}>
            {/* Each rail button is its OWN green-circle badge (no extra border) and
                flashes its label to the LEFT on tap. A faint fill marks the on state. */}
            <RailButton
              label={calibrated ? 'Re-calibrate' : 'Calibrate'}
              onPress={() => router.push('/swinglab/calibrate' as never)}
              btnStyle={[styles.toolBtnBare, calibrated && styles.toolBtnBareActive]}
            >
              <Image source={ICON_RAIL.calibrate} style={styles.toolIconFull} resizeMode="contain" />
            </RailButton>
            <RailButton
              label="Scan club"
              disabled={scanningClub}
              onPress={() => void detectClubFromCamera()}
              btnStyle={[styles.toolBtnBare, { opacity: scanningClub ? 0.5 : 1 }]}
            >
              {scanningClub
                ? <Ionicons name="sync" size={22} color={colors.accent} />
                : <Image source={ICON_CLUB} style={styles.toolIconFull} resizeMode="contain" />}
            </RailButton>
            <RailButton
              label={placeBallMode ? 'Tap your ball' : 'Ball box'}
              onPress={() => setPlaceBallMode((v) => !v)}
              btnStyle={[styles.toolBtnBare, placeBallMode && styles.toolBtnBareActive]}
            >
              <Image source={ICON_RAIL.ballbox} style={styles.toolIconFull} resizeMode="contain" />
            </RailButton>
            {/* Environment toggle — cage → range → course (scene badge + flashed label). */}
            <RailButton
              label={isRoundActive ? 'Course (round)' : effectiveMode === 'cage' ? 'Cage' : effectiveMode === 'range' ? 'Range' : 'Course'}
              disabled={isRoundActive}
              onPress={() => { if (!isRoundActive) setEnvironmentMode(environmentMode === 'cage' ? 'range' : environmentMode === 'range' ? 'course' : 'cage'); }}
              btnStyle={[styles.toolBtnBare, { opacity: isRoundActive ? 0.6 : 1 }]}
            >
              <Image source={ICON_ENV[effectiveMode]} style={styles.toolIconFull} resizeMode="contain" />
            </RailButton>
            {/* Selfie/front-camera toggle (recording stays un-mirrored). */}
            <RailButton
              label={facing === 'front' ? 'Selfie on' : 'Selfie'}
              onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
              btnStyle={[styles.toolBtnBare, facing === 'front' && styles.toolBtnBareActive]}
            >
              <Image source={ICON_RAIL.selfie} style={styles.toolIconFull} resizeMode="contain" />
            </RailButton>
            {/* Chip/short-game sensitivity — mode-aware (cage+course on, range off). */}
            <RailButton
              label={chipSensitivity ? 'Chip mode ON' : 'Chip mode'}
              onPress={() => {
                const next = !chipSensitivity;
                setChipSensitivity(next);
                useToastStore.getState().show(next ? 'Chip mode ON — listening for soft chips' : 'Chip mode off');
              }}
              btnStyle={[styles.toolBtnBare, chipSensitivity && styles.toolBtnBareActive]}
            >
              <Image source={ICON_RAIL.chip} style={styles.toolIconFull} resizeMode="contain" />
            </RailButton>
          </View>
        ) : null}

        {/* 2026-06-12 (Tim) — the persistent "PUTT MODE" pill is GONE. Mode changes
            are announced by the transient fade label (showModeFade → "PUTTING"), which
            disappears like every other mode transition; the standing putt indicator is
            now the draggable FLAG/cup target the user lines up over the real cup. */}

        {/* FRAMING COACH pill (setup) — on-device pose checks you're fully in frame
            before you swing. Green = framed (head + feet); amber = a fix (step back,
            tilt up, center). Bottom-center, clear of the right tool rail + ball box. */}
        {phase === 'setup' && framing ? (
          <View
            style={[
              styles.framingPill,
              { bottom: insets.bottom + 96, backgroundColor: framing.status === 'framed' ? 'rgba(0,200,150,0.92)' : 'rgba(18,20,24,0.86)' },
            ]}
            pointerEvents="none"
          >
            <Ionicons
              name={framing.status === 'framed' ? 'checkmark-circle' : framing.status === 'no_person' ? 'body-outline' : 'alert-circle-outline'}
              size={15}
              color={framing.status === 'framed' ? '#06281b' : '#f5c451'}
            />
            <Text style={[styles.framingPillText, { color: framing.status === 'framed' ? '#06281b' : '#fff' }]}>
              {framing.message}
            </Text>
          </View>
        ) : null}

        {/* DTL AIM READOUT (setup) — live as you drag the target: declared effort %
            + start direction. CENTERED, just UNDER the ball-area box (Tim) — the target
            travels UP from the ball, so a readout below it can never collide on any
            screen size. Clamped to stay above the bottom controls. DTL only. */}
        {phase === 'setup' && angle === 'down_the_line' && !isPutt && liveBall && rootSize.h > 0 && (effortRaw != null || aimRead) ? (
          <View
            style={{
              position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 6,
              top: Math.min(rootSize.h - 132, liveBall.y * rootSize.h + liveBall.r * rootSize.w * 1.5 + 14),
            }}
            pointerEvents="none"
          >
            <View style={styles.aimReadout}>
              {effortRaw != null ? (
                <View style={styles.aimReadoutCol}>
                  <Text style={styles.aimReadoutValue}>{effortRaw}%</Text>
                  <Text style={styles.aimReadoutLabel}>EFFORT</Text>
                </View>
              ) : null}
              {effortRaw != null && estCarry != null ? <View style={styles.aimReadoutDivider} /> : null}
              {estCarry != null ? (
                <View style={styles.aimReadoutCol}>
                  <Text style={styles.aimReadoutValue}>~{estCarry}y</Text>
                  <Text style={styles.aimReadoutLabel}>CARRY</Text>
                </View>
              ) : null}
              {(effortRaw != null || estCarry != null) && aimRead ? <View style={styles.aimReadoutDivider} /> : null}
              {aimRead ? (
                <View style={styles.aimReadoutCol}>
                  <Text style={[styles.aimReadoutValue, { color: aimRead === 'STRAIGHT' ? '#34d399' : '#f5c451' }]}>{aimRead}</Text>
                  <Text style={styles.aimReadoutLabel}>AIM</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* RIGHT RAIL — floating metric cards (review) */}
        {isReview && showResults && !isPutt ? (
          <View style={[styles.rightRail, { top: insets.top + 60 }]} pointerEvents="none">
            {rightMetrics.map((m) => (
              <View key={m.key} style={styles.metricBadgeCard}>
                <Image source={m.img} style={styles.metricBadgeImg} resizeMode="contain" />
                <View style={styles.metricBadgeText}>
                  <Text style={styles.metricBadgeValue} numberOfLines={1}>
                    {m.value ?? '—'}{m.value != null && m.unit ? <Text style={styles.metricBadgeUnit}>{m.unit}</Text> : null}
                  </Text>
                  <Text style={styles.metricBadgeLabel} numberOfLines={1}>{m.label}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* SHOW/HIDE RESULTS — clears every result overlay for a clean frame to
            screenshot/share (Tim's Smart Capture), or declutter the center video. */}
        {isReview ? (
          <Pressable
            onPress={() => setShowResults((v) => !v)}
            style={[styles.overlayToggle, { top: insets.top + 8, backgroundColor: showResults ? 'rgba(6,15,9,0.7)' : 'rgba(124,224,79,0.9)' }]}
            accessibilityRole="button"
            accessibilityLabel={showResults ? 'Hide result overlays for a clean view' : 'Show result overlays'}
          >
            <Ionicons name={showResults ? 'eye-outline' : 'eye-off-outline'} size={20} color={showResults ? colors.accent : '#06281b'} />
          </Pressable>
        ) : null}

        {/* RECORDING timer */}
        {phase === 'recording' ? (
          <View style={[styles.recPill, { top: insets.top + 56, backgroundColor: colors.overlay }]} pointerEvents="none">
            <View style={[styles.recDot, { backgroundColor: colors.error }]} />
            <Text style={styles.recText}>{recordedSeconds}s · {recordingMaxSeconds - recordedSeconds}s left</Text>
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
                  swingCount={isReview ? segments.length : undefined}
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
            {!isReview ? (
              // 2026-06-12 — ONE golfer badge, tap to cycle DTL → Face-On → Putting,
              // with a quick fade-away label (Tim's idea — clears the bottom bar vs
              // the old 3-chip toggle). The current stance icon shows which mode you're in.
              <View style={{ justifyContent: 'center' }}>
                <Animated.Text style={[styles.modeFadeLabelLeft, { opacity: modeFadeOpacity, color: colors.accent }]} pointerEvents="none" numberOfLines={1}>
                  {modeFadeText}
                </Animated.Text>
                <Pressable
                  onPress={cycleMode}
                  style={styles.modeCycleBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Camera mode: ${isPutt ? 'putting' : angle === 'face_on' ? 'face-on' : 'down the line'}. Tap to change.`}
                >
                  <Image source={ICON_ANGLE[isPutt ? 'putt' : angle]} style={styles.modeCycleImg} resizeMode="contain" />
                </Pressable>
              </View>
            ) : null}
            <View style={{ flex: 1 }} />
            {actionBtn}
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
        // 2026-06-12 — PRE-SWING SCAFFOLD (Tim): show the breakdown STRUCTURE with
        // empty "—" boxes so page 2 reads as a results page waiting to fill, not a
        // blank black screen. The body-analysis badges + the insight cards, dimmed.
        <>
          <Text style={[styles.muted, { color: colors.text_muted }]}>Record a swing to fill in your breakdown.</Text>
          {!isPutt ? <BodyAnalysisRow items={bodyItems} style={{ opacity: 0.7 }} /> : null}
          {['TOP FOCUS', 'WHY IT HAPPENS', 'THE FIX', 'RECOMMENDED DRILL'].map((lbl) => (
            <View key={lbl} style={[styles.insightCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border, opacity: 0.5 }]}>
              <Text style={[styles.insightLabel, { color: colors.text_muted }]}>{lbl}</Text>
              <Text style={[styles.insightText, { color: colors.text_muted }]}>—</Text>
            </View>
          ))}
        </>
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
            <View style={styles.noteHeadRow}>
              <Text style={[styles.insightLabel, { color: colors.text_muted }]}>COACH NOTES</Text>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => dictate('note', (t) => setCoachNote((p) => (p ? `${p} ${t}` : t)))}
                hitSlop={10}
                style={[styles.micBtn, dictating === 'note' && styles.micBtnActive]}
                accessibilityRole="button"
                accessibilityLabel={dictating === 'note' ? 'Stop dictation' : 'Dictate a note'}
              >
                <Ionicons name={dictating === 'note' ? 'stop' : 'mic'} size={15} color={dictating === 'note' ? '#06281b' : colors.accent} />
              </Pressable>
            </View>
            <TextInput
              value={coachNote}
              onChangeText={setCoachNote}
              onBlur={saveCoachNote}
              placeholder={dictating === 'note' ? 'Listening… speak your note' : 'Add a note for this swing…'}
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
          <View style={styles.noteHeadRow}>
            <Text style={[styles.insightLabel, { color: colors.text_muted }]}>HOW&apos;D IT FEEL?</Text>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => dictate('feel', (t) => setFeelText((p) => (p ? `${p} ${t}` : t)))}
              hitSlop={10}
              style={[styles.micBtn, dictating === 'feel' && styles.micBtnActive]}
              accessibilityRole="button"
              accessibilityLabel={dictating === 'feel' ? 'Stop dictation' : 'Dictate how it felt'}
            >
              <Ionicons name={dictating === 'feel' ? 'stop' : 'mic'} size={15} color={dictating === 'feel' ? '#06281b' : colors.accent} />
            </Pressable>
          </View>
          <TextInput
            value={feelText}
            onChangeText={setFeelText}
            placeholder={dictating === 'feel' ? 'Listening… speak how it felt' : 'e.g. felt like I came over the top · felt frustrated'}
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

      {/* COMING SOON — face angle + smash are HONEST future metrics: they need
          higher-frame-rate capture (240fps+) or an external camera source (e.g. a
          GoPro feed) to measure reliably. Shown as roadmap, not faked — and kept at
          the BOTTOM (Tim) so what we CAN'T do yet never sits above the real read. */}
      {!isPutt ? (
        <View style={[styles.comingCard, { borderColor: colors.border }]}>
          <Text style={[styles.insightLabel, { color: colors.text_muted }]}>COMING SOON</Text>
          <View style={styles.comingRow}>
            <View style={styles.comingItem}>
              <Image source={ICON_METRIC.face} style={styles.comingImg} resizeMode="contain" />
              <Text style={styles.comingItemLabel}>FACE ANGLE</Text>
            </View>
            <View style={styles.comingItem}>
              <Image source={ICON_METRIC.smash} style={styles.comingImg} resizeMode="contain" />
              <Text style={styles.comingItemLabel}>SMASH FACTOR</Text>
            </View>
          </View>
          <Text style={[styles.comingNote, { color: colors.text_muted }]}>
            Unlocks with higher-frame-rate capture (240fps+) or an added camera source (e.g. a GoPro feed) — on the roadmap.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );

  // 2026-06-12 (Tim) — PAGE 3: the SHOT MAP (full swing → vertical course; cage →
  // bullseye). Gated by showShotMap (declared above for the dot count).
  const shotMapPage = showShotMap ? (
    <ShotMapPage
      key="shotmap"
      mode={effectiveMode}
      club={club}
      handicap={profile.handicap ?? null}
      learnedCarry={null}
      estCarry={estCarry}
      effortPct={effortPct}
      trace={ballTrace ? { side: ballTrace.side, divergenceDeg: ballTrace.divergenceDeg } : null}
      canvasFeet={cageCanvasFeet}
      cameraBehindFeet={cameraBehindFeet}
      onChangeCanvasFeet={setCageCanvasFeet}
      onChangeCameraBehindFeet={setCameraBehindFeet}
      colors={colors}
      topInset={insets.top}
      onBack={() => pagerRef.current?.scrollTo({ x: 0, animated: true })}
      width={windowWidth}
    />
  ) : null;

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
        {shotMapPage}
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
        onPick={(c) => { setClub(c); setLastClub(c); setPuttMode(c === 'PT'); setClubMenuOpen(false); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#060f09' },

  captureRoot: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  statusBorder: { borderWidth: 2.5, borderRadius: 2, zIndex: 4 },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingBottom: 8,
  },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },

  rightRail: { position: 'absolute', right: 8, width: 124, gap: 8, zIndex: 4 },
  leftRail: { position: 'absolute', left: 8, width: 124, gap: 8, zIndex: 4 },
  // 2026-06-12 (Tim) — soft translucent shadow halo so the badges stay readable on
  // bright range/cage backgrounds WITHOUT an ugly hard box. Slightly deeper card fill
  // + a dark drop shadow (iOS) / elevation (Android) = clean lift off the video.
  metricBadgeCard: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(6,15,9,0.72)', borderRadius: 12, paddingVertical: 5, paddingHorizontal: 7, borderWidth: 1, borderColor: 'rgba(124,224,79,0.28)', shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 7, shadowOffset: { width: 0, height: 2 }, elevation: 6 },
  metricBadgeImg: { width: 32, height: 32 },
  metricBadgeText: { flex: 1, minWidth: 0 },
  metricBadgeValue: { color: '#88F700', fontSize: 14, fontWeight: '900', letterSpacing: 0.2 },
  metricBadgeUnit: { color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '700' },
  metricBadgeLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },

  recPill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, zIndex: 6 },
  framingPill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, zIndex: 6, maxWidth: '88%' },
  framingPillText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  aimReadout: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(6,15,9,0.74)', borderWidth: 1, borderColor: 'rgba(136,247,0,0.4)' },
  aimReadoutCol: { alignItems: 'center' },
  aimReadoutValue: { color: '#88F700', fontSize: 13, fontWeight: '900', letterSpacing: 0.3 },
  aimReadoutLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 7, fontWeight: '700', letterSpacing: 1 },
  aimReadoutDivider: { width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.2)' },
  // Tempo data pill — vertical, left edge.
  tempoPill: { position: 'absolute', left: 10, zIndex: 6, alignItems: 'center', backgroundColor: 'rgba(6,15,9,0.6)', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10, gap: 1 },
  tempoPillLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  tempoPillValue: { fontSize: 22, fontWeight: '900' },
  tempoPillUnit: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700' },
  effortPill: { position: 'absolute', left: 10, zIndex: 6, alignItems: 'center', backgroundColor: 'rgba(6,15,9,0.6)', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10, gap: 1 },
  // Setup tool rail — translucent icon buttons on the right edge.
  toolRail: { position: 'absolute', right: 10, gap: 12, zIndex: 7, alignItems: 'center' },
  toolBtn: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,15,9,0.55)' },
  toolIconImg: { width: 36, height: 36 },
  // 2026-06-12 — bare rail button: the badge's OWN circle is the button (no border).
  // A faint green fill marks the active/on state (since there's no border to recolor).
  toolBtnBare: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  toolBtnBareActive: { backgroundColor: 'rgba(136,247,0,0.22)' },
  toolIconFull: { width: 46, height: 46 },
  modeCycleBtn: { width: 54, height: 54, borderRadius: 27, borderWidth: 1.5, borderColor: 'rgba(136,247,0,0.6)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,15,9,0.55)' },
  modeCycleImg: { width: 44, height: 44 },
  modeFadeLabelLeft: { position: 'absolute', right: 62, width: 150, height: 54, textAlign: 'right', textAlignVertical: 'center', fontSize: 13, fontWeight: '900', letterSpacing: 1 },
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
  // Universal control bar — translucent icon buttons.
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  barRateTag: { position: 'absolute', bottom: 2, right: 4, fontSize: 9, fontWeight: '900', color: '#88F700' },
  overlayToggle: { position: 'absolute', right: 46, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', zIndex: 7, borderWidth: 1, borderColor: 'rgba(124,224,79,0.5)' },
  barBtnRecord: { width: 56, height: 56, borderRadius: 28 },
  barBtnStop: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(229,72,77,0.22)' },
  barGhost: { borderWidth: 1.5, backgroundColor: 'rgba(6,15,9,0.55)' },
  barRate: { fontSize: 15, fontWeight: '900' },

  // analysis page
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardHeader: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  backChip: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backChipText: { fontSize: 12, fontWeight: '700' },
  muted: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  insightCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  insightLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  comingCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, borderStyle: 'dashed' },
  comingRow: { flexDirection: 'row', gap: 20, justifyContent: 'center', paddingVertical: 4 },
  comingItem: { alignItems: 'center', gap: 4, opacity: 0.85 },
  comingImg: { width: 46, height: 46 },
  comingItemLabel: { color: '#88F700', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  comingNote: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
  insightHeadline: { fontSize: 17, fontWeight: '900', letterSpacing: 0.3 },
  insightConf: { fontSize: 11, fontWeight: '600' },
  insightBody: { fontSize: 13, lineHeight: 19, fontWeight: '500', padding: 12, borderWidth: 1, borderRadius: 12 },
  insightText: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  laymanToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  laymanToggleText: { fontSize: 12, fontWeight: '700' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingVertical: 11 },
  secondaryBtnText: { fontSize: 13, fontWeight: '800' },
  noteInput: { minHeight: 60, borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 13, textAlignVertical: 'top', marginTop: 6 },
  noteHeadRow: { flexDirection: 'row', alignItems: 'center' },
  micBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,200,150,0.5)' },
  micBtnActive: { backgroundColor: '#88F700', borderColor: '#88F700' },

  // markup
  markupRoot: { flex: 1, backgroundColor: '#000' },
  markupClose: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },

  // permission
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, marginTop: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  permTitle: { fontSize: 18, fontWeight: '800' },
  permBody: { fontSize: 14, textAlign: 'center' },
});
