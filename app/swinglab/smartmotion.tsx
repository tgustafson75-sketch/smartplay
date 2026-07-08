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
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import VideoAnnotationOverlay from '../../components/swinglab/VideoAnnotationOverlay';
import SwingBodyOverlay, { faultJointsFor } from '../../components/swinglab/SwingBodyOverlay';
import CageTargetingCard, { CageTargetingOverlay, EditableCageTargets, BallTraceOverlay, MultiPointTraceOverlay } from '../../components/swinglab/CageTargetingCard';
import CaddiePresencePip from '../../components/swinglab/CaddiePresencePip';
import ReviewScrubber, { ScrubMoment } from '../../components/swinglab/ReviewScrubber';
import { defaultDtlRig } from '../../services/cage/targetRig';
import { prewarmSwingAnalysis } from '../../services/swingAnalysisWarmup';
import { computeTraceDirection, traceColor, buildShotTrace, type ShotTraceBuild } from '../../services/swing/ballTrace';
import { composeSmartTrace } from '../../services/swing/smartTrace';
import { detectBallPath } from '../../services/swing/ballPath';
import { detectClubPath } from '../../services/swing/clubPath';
import { frameToContainerNorm } from '../../services/swing/overlayCoords';
import { recordPracticeSwingIfActive, usePracticeSessionStore } from '../../store/practiceSessionStore';
// Type-only — erased at runtime, so it never loads the vision-camera native module.
// The component is lazy-required ONLY when the runtime toggle is on (a vision build),
// keeping this file's JS OTA-safe on a build that doesn't link vision-camera.
import type { SwingCameraHandle } from '../../components/capture/SwingVisionCamera';
import { useCaptureEngineStore } from '../../store/captureEngineStore';
import { estimateCarryYards } from '../../services/swing/carryEstimate';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as Haptics from 'expo-haptics';
import { CaddieMicBadge } from '../../components/caddie/CaddieMicBadge';
import { useTheme } from '../../contexts/ThemeContext';
import { analyzeSwing, probeDurationMs, type SwingAnalysis } from '../../services/poseDetection';
import { evaluateSwingValidity } from '../../services/swingValidity';
import {
  synthesizeSwingMetrics,
  isTruthGrade,
  isSwingDerived,
  type SwingMetricSet,
} from '../../services/swingMetricsService';
import {
  extractPoseFramesFromVideo,
  analyzeSwingFromVideo,
  computeBiomechanicsFromFrames,
  deriveSwingTempo,
  type PoseFrame,
  type SwingBiomechanics,
  type SwingTempo,
} from '../../services/poseAnalysisApi';
import { startMeteredRecording, type MeteringHandle } from '../../services/swing/audioMetering';
import { detectStrikes, type DetectedStrike } from '../../services/swing/strikeDetector';
import { segmentsFromStrikes, segmentsFromVideoSwings, correlateStrikesWithVideo, filterReboundStrikes, type SwingSegment } from '../../services/swing/swingSegmentation';
import { detectBallSpeed, type BallSpeedResult } from '../../services/acousticDetectApi';
import { useCageStore, type PrimaryIssue } from '../../store/cageStore';
import { deriveDrillVerdict } from '../../services/drillVerdict';
import { useClubBagStore } from '../../store/clubBagStore';
import { useFamilyStore } from '../../store/familyStore';
import { useAcousticCalibrationStore } from '../../store/acousticCalibrationStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { usePracticePointsStore } from '../../store/practicePointsStore';
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
import { useClubStatsStore, clubIdToClubName, CLUB_ORDER, type ClubName } from '../../store/clubStatsStore';
import { speak, warmVoice, stopSpeaking, configureAudioForSpeech, captureUtterance, endCaptureEarly } from '../../services/voiceService';
import { useClubSelectionStore } from '../../store/clubSelectionStore';
import { useToastStore } from '../../store/toastStore';
import { detectBallDeparture, type BallDepartureResult } from '../../services/swing/ballDeparture';
import { getShotShape, readActualLaunch, compareShotShape } from '../../services/practice/shotShapes';
import { ensureSwingThumbnail } from '../../services/videoUpload';
import { subscribeSmartMotionCommand, setSmartMotionActive, setSmartMotionRecording, subscribeDrillConfig, emitSmartMotionVoiceEvent, emitSmartMotionUtterance, isSmartMotionRecording, type SmartMotionCommand } from '../../services/smartMotionRecordBus';
import { setScreenContext, clearScreenContext } from '../../services/screenContext';
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

// 2026-06-29 (Tim — "work on something else? doesn't engage") — after a session the
// caddie asks if the player wants to go again, but that line is spoken OUTSIDE the
// brain's history, so when they answer "driver, full swing" the dialogue-first guard
// makes the brain OFFER instead of ACT. This screen-context focus (set on
// session_complete, cleared when they actually go again) tells the brain to ACT on
// the next club/angle/drill answer.
const SESSION_DONE_FOCUS =
  'choosing whether to go again. If the player says YES / "another round" / "run it back" / "again" / "let\'s go", ACT immediately — call record_swing to start the next set (their last set auto-saves; same club and setup) and tell them it\'s rolling. If they name a club, angle, or drill ("driver full swing", "face on", "nine iron easy"), ACT immediately — call configure_drill and/or set_angle to set it up, then record_swing so it\'s rolling. Do NOT merely offer, do NOT ask again — they are standing at the ball, not at the phone.';

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
  // 2026-06-30 (audit C5/C7) — surface the MEASURED number on each tile (was tone-only).
  // "~" marks a low-confidence read (metric_confidence < 0.5). Sway has no intuitive scalar
  // (head-drift is normalized pixels), so it stays qualitative — honest, no fabricated number.
  const conf = bio?.metric_confidence as Record<string, number | undefined> | undefined;
  const hedge = (k: string): string => (conf && typeof conf[k] === 'number' && conf[k]! < 0.5 ? '~' : '');
  const degVal = (v: number | null | undefined, k: string) => (v == null ? undefined : `${hedge(k)}${Math.round(v)}°`);
  const pctVal = (v: number | null | undefined, k: string) => (v == null ? undefined : `${hedge(k)}${Math.round(v)}%`);
  return [
    { key: 'sway', label: 'Sway', tone: sway, icon: 'swap-horizontal-outline', image: ICON_BIOMECH.sway },
    { key: 'tilt', label: 'Tilt', tone: tilt, icon: 'contract-outline', image: ICON_BIOMECH.tilt, value: degVal(bio?.shoulderTiltDeg, 'shoulderTilt') },
    { key: 'posture', label: 'Posture', tone: posture, icon: 'body-outline', image: ICON_BIOMECH.posture, value: degVal(bio?.spineAngleDeltaDeg, 'spineAngleDelta') },
    { key: 'weight', label: 'Weight', tone: weight, icon: 'scale-outline', image: ICON_BIOMECH.weight, value: pctVal(bio?.weightShiftPct, 'weightShift') },
  ];
}

// Contact/strike signals the BODY-MOTION analysis can't see. The vision model
// judges motion from a handful of frames — it does NOT measure whether the club
// hit the ball fat/thin/pure. These come from the camera strike check
// (ballDeparture), the acoustic/ball-launch read, or the player's own feel note,
// and they OVERRIDE a "no fault" motion read — a chunk with tidy-looking mechanics
// must never be celebrated as a good swing.
type SmContact = {
  /** true = ball confirmed to leave its spot; false = sound/swing but ball didn't
   *  launch (duff/whiff/heavy); null = we couldn't see the ball to confirm. */
  ballLaunched: boolean | null;
  /** A mishit the PLAYER reported (feel note) or the model flagged from visible
   *  evidence: 'fat' | 'thin' | 'topped' | null. The human's read wins. */
  reportedMishit: 'fat' | 'thin' | 'topped' | null;
};

function deriveVerdict(
  a: SwingAnalysis | null,
  analyzing: boolean,
  contact?: SmContact,
): { text: string; tone: SmTone } {
  // Honest state: only say "ANALYZING…" while a read is actually in flight. Once
  // it's done (or errored) with no result, say so instead of spinning forever.
  if (!a) return { text: analyzing ? 'ANALYZING…' : 'NO READ — RECORD AGAIN', tone: analyzing ? 'neutral' : 'warn' };
  const validity = evaluateSwingValidity(a);
  if (!validity.valid) return { text: 'NO SWING DETECTED', tone: 'warn' };

  // 2026-07-07 (Tim — "I hit a chunk and it says GOOD SWING / clean") — CONTACT
  // overrides come first. Motion analysis can't see strike; these signals can, so
  // they beat any "no fault" motion read.
  if (contact?.reportedMishit) {
    const label = contact.reportedMishit === 'thin' ? 'THIN CONTACT'
      : contact.reportedMishit === 'topped' ? 'TOPPED'
      : 'HEAVY / FAT CONTACT';
    return { text: label, tone: 'bad' };
  }
  if (contact?.ballLaunched === false) {
    // Sound/motion but the ball never left its spot — a duff, whiff, or heavy hit.
    return { text: 'BALL DIDN’T LAUNCH', tone: 'bad' };
  }

  // A named, evidence-gated fault wins even when the conservative detected_issue is
  // 'none' (detected_issue biases toward 'none', so it alone must NOT green-light).
  const namedFault =
    a.primary_fault && a.primary_fault !== 'no_dominant_fault' && a.primary_fault !== 'inconclusive'
      ? a.primary_fault
      : a.detected_issue && a.detected_issue !== 'none'
        ? a.detected_issue
        : null;
  if (namedFault) {
    return { text: namedFault.replace(/_/g, ' ').toUpperCase(), tone: a.severity === 'significant' ? 'bad' : 'warn' };
  }

  // No motion fault found. Be HONEST about what that means: we checked the MOTION,
  // not the strike. Only show a triumphant green verdict when a strike was actually
  // confirmed; otherwise it's an informational "motion looks clean" — never a claim
  // that the shot itself was good (which is exactly what mislabelled the chunk).
  if (contact?.ballLaunched === true) return { text: 'SOLID SWING', tone: 'good' };
  return { text: 'MOTION LOOKS CLEAN', tone: 'neutral' };
}

/** A positive/no-fault verdict (either a confirmed solid swing or clean motion). */
function isCleanVerdict(v: { tone: SmTone; text: string }): boolean {
  return v.text === 'SOLID SWING' || v.text === 'MOTION LOOKS CLEAN';
}

/** Scan a free-text feel note for a self-reported mishit — the human's read wins. */
function mishitFromFeel(feelText: string): SmContact['reportedMishit'] {
  const f = (feelText ?? '').toLowerCase();
  return /\b(fat|chunk|chunked|chunky|heavy|duff|duffed|dug|dig)\b/.test(f) ? 'fat'
    : /\b(thin|thinned|skull|skulled|blade|bladed|skinny)\b/.test(f) ? 'thin'
    : /\b(top|topped|topping|worm|worm.?burner)\b/.test(f) ? 'topped'
    : null;
}

// 2026-07-07 (Tim — chunk honesty, propagate everywhere) — build the SmContact from
// every signal the motion read can't see: the camera ball-departure check, the
// player's feel note, and the model's own contact_read. Used by EVERY swing-judging
// surface (live badge, spoken narration, saved report, drill verdict) so a chunk is
// never called clean on one screen and a fault on another.
function deriveContact(
  a: SwingAnalysis | null,
  extras?: { ballDeparture?: BallDepartureResult | null; feelText?: string },
): SmContact {
  const bd = extras?.ballDeparture;
  const ballLaunched: boolean | null = bd == null
    ? null
    : bd.departed
      ? true
      : bd.ball_present_before
        ? false
        : null;
  const cr = a?.contact_read;
  const fromModel: SmContact['reportedMishit'] = cr === 'fat' || cr === 'thin' || cr === 'topped' ? cr : null;
  return { ballLaunched, reportedMishit: mishitFromFeel(extras?.feelText ?? '') ?? fromModel };
}

/** A human-readable contact-fault name for a reported mishit. */
function contactMishitName(m: NonNullable<SmContact['reportedMishit']>): string {
  return m === 'thin' ? 'Thin Contact' : m === 'topped' ? 'Topped' : 'Heavy / Fat Contact';
}

/** CNS tendency id for a contact mishit (so the brain learns "tends to chunk"). */
function contactMishitFaultId(m: NonNullable<SmContact['reportedMishit']>): string {
  return m === 'thin' ? 'thin_contact' : m === 'topped' ? 'topped_contact' : 'heavy_contact';
}

// 2026-07-07 (Tim — chunk honesty everywhere) — build the SAVED report's PrimaryIssue
// for a contact mishit, so the library card + Drill Check never call a chunk clean.
// A fat/thin/topped strike is a real, scoring-relevant miss → significant.
function contactMishitIssue(m: NonNullable<SmContact['reportedMishit']>): PrimaryIssue {
  return {
    issue_id: contactMishitFaultId(m),
    name: contactMishitName(m),
    category: 'other',
    severity: 'significant',
    occurrence_count: 1,
    visual_reference_path: null,
    mechanical_breakdown: m === 'fat'
      ? 'Heavy contact — the club caught the ground before the ball. That saps distance and consistency even when the body motion looks fine.'
      : m === 'thin'
        ? 'Thin contact — caught the ball above center. The motion can look clean; low-point control is the thing to groove.'
        : 'Topped — the club caught the top of the ball, usually a low-point / posture-through-impact issue.',
    feel_cue: 'Ball-first contact: feel the low point just AHEAD of the ball. Put a towel a few inches behind the ball you have to miss — the classic groove drill.',
    detected_in_shots: [],
    confidence: 'medium',
  };
}

// The SAVED report's issue for a contact problem: a named mishit, OR a ball that never
// left its spot (a duff/whiff — definitely not clean, even if we can't name the miss).
// null when contact is fine/unknown → the caller keeps the motion classification.
function contactIssue(contact: SmContact): PrimaryIssue | null {
  if (contact.reportedMishit) return contactMishitIssue(contact.reportedMishit);
  if (contact.ballLaunched === false) {
    return {
      issue_id: 'no_launch',
      name: 'Ball Didn’t Launch',
      category: 'other',
      severity: 'significant',
      occurrence_count: 1,
      visual_reference_path: null,
      mechanical_breakdown: 'The ball never left its spot — a duff, heavy hit, or whiff. The body motion can look fine; the strike is what to groove.',
      feel_cue: 'Make ball-first contact — feel the low point just ahead of the ball. Re-record and I\'ll read the next one.',
      detected_in_shots: [],
      confidence: 'medium',
    };
  }
  return null;
}

// 2026-06-15 (Tim — pipelined per-swing narration) — a short spoken headline for
// ONE swing in a multi-swing read. Reuses deriveVerdict's honest logic (no read /
// no swing / clean / the named fault). One breath per swing so a 3-swing reel
// reads "Swing 1, over the top. Swing 2, early extension. Swing 3, clean."
// 2026-07-07 — carries the swing's OWN contact read so the spoken line matches the
// badge (was contact-blind → could say "motion looked clean" on a model-flagged fat).
function swingNarrationLine(n: number, a: SwingAnalysis): string {
  const v = deriveVerdict(a, false, deriveContact(a));
  if (v.text === 'NO SWING DETECTED' || v.text.startsWith('NO READ')) return `Swing ${n}, couldn't get a clean read.`;
  if (v.text === 'SOLID SWING') return `Swing ${n}, solid.`;
  if (v.text === 'MOTION LOOKS CLEAN') return `Swing ${n}, motion looked clean.`;
  return `Swing ${n}, ${v.text.toLowerCase()}.`;
}

// 2026-06-13 — TactilePressable: drop-in <Pressable> that makes every Smart Motion
// icon FEEL tapped — a light haptic tick + a quick spring "wobble" (scale 1 → 0.9 →
// overshoot back). Non-breaking: forwards all Pressable props, supports both static
// and function styles, and the haptic fails silently if the OS/user has it disabled
// (Tim — "even if it's hard, it should wobble a little when you touch it. Clean.").
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
function TactilePressable({
  onPress, onPressIn, onPressOut, style, children, haptic = 'light', ...rest
}: React.ComponentProps<typeof Pressable> & { haptic?: 'light' | 'medium' | 'none' }) {
  const scale = useRef(new Animated.Value(1)).current;
  const transform = { transform: [{ scale }] };
  return (
    <AnimatedPressable
      {...rest}
      style={typeof style === 'function'
        ? (state) => [style(state) as ViewStyle, transform]
        : [style as ViewStyle, transform]}
      onPressIn={(e) => {
        Animated.spring(scale, { toValue: 0.9, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 14 }).start();
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic !== 'none') {
          Haptics.impactAsync(
            haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
          ).catch(() => {});
        }
        onPress?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}

// 2026-06-13 (Tim) — a labeled row inside the setup tools CARD: icon + what it does,
// so the icons are self-explaining while people learn them. Active toggles get a tick.
// Uses the shared TactilePressable so every row buzzes + wobbles on tap.
function ToolCardRow({ icon, title, desc, active, disabled, onPress }: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TactilePressable
      onPress={onPress}
      disabled={disabled}
      style={[toolCardStyles.row, active ? toolCardStyles.rowActive : null, { opacity: disabled ? 0.5 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${desc}`}
    >
      <View style={toolCardStyles.iconWrap}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={toolCardStyles.title}>{title}</Text>
        <Text style={toolCardStyles.desc}>{desc}</Text>
      </View>
      {active ? <Ionicons name="checkmark-circle" size={16} color="#88F700" /> : null}
    </TactilePressable>
  );
}

const toolCardStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 10 },
  rowActive: { backgroundColor: 'rgba(136,247,0,0.12)' },
  iconWrap: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  desc: { color: 'rgba(255,255,255,0.62)', fontSize: 11, marginTop: 1 },
});

// ─── screen ──────────────────────────────────────────────────────────

export default function SmartMotion() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // 2026-06-29 (Tim) — narrow cover screens (e.g. closed Z Fold ~360pt) crowd the
  // bottom: the floating swing-count pill collides with the controls row. Bump its
  // clearance + tighten spacing when narrow so nothing overlaps. Open phone unaffected.
  const isNarrow = windowWidth < 400;
  const { clipUri: clipUriParam, angle: angleParam, drillId, drillName, drillShots, drillFocus, drillShotType, captureMode, returnTo, autoRecord, autoScan } =
    useLocalSearchParams<{ clipUri?: string; angle?: string; drillId?: string; drillName?: string; drillShots?: string; drillFocus?: string; drillShotType?: string; captureMode?: string; returnTo?: string; autoRecord?: string; autoScan?: string }>();
  // 2026-06-24 (Tim — camera-first Smart Tempo) — TEMPO capture mode. When
  // Smart Tempo opens its own camera it routes here with captureMode='tempo'
  // (+ returnTo='/swinglab/smart-tempo'). On a single-swing completion we route
  // BACK to that screen with the freshly-ingested swing_id, so the player lands
  // straight on the tempo RESULT — no manual "pick from library". A normal
  // launch leaves both undefined and behaves exactly as before. Held in a ref
  // so the async stop/ingest closure reads it without dep churn.
  const tempoReturnRef = useRef<string | null>(
    captureMode === 'tempo' && typeof returnTo === 'string' && returnTo.length > 0 ? returnTo : null,
  );
  // Note: drillFocus + drillShotType are carried on the route for the next
  // increment (per-focus metric surfacing); typed here so the drill contract is
  // complete even though this increment only consumes drillId/drillName/drillShots.
  // 2026-06-13 (#5) — DRILL mode. When launched from a drill card, Smart Motion
  // reads the drill: it labels the capture, caps the session at the drill's shot
  // count (3–5), tags the session captureKind 'drill', and (focus) names the one
  // metric this drill is about. A normal Smart Motion launch leaves all of these
  // undefined and behaves exactly as before.
  const isDrill = typeof drillId === 'string' && drillId.length > 0;
  const drillShotCount = isDrill ? Math.max(1, Math.min(5, Number(drillShots) || 3)) : null;

  // 2026-06-26 (Tim) — register the current screen/drill so a voice question
  // asked here is answered drill-aware (focus from the route), cleared on leave.
  useEffect(() => {
    const label = isDrill && typeof drillName === 'string' && drillName.trim()
      ? `the ${drillName.trim()} drill`
      : 'Smart Motion (recording swings)';
    setScreenContext({
      screen: label,
      focus: isDrill && typeof drillFocus === 'string' && drillFocus.trim() ? drillFocus.trim() : undefined,
      drillId: isDrill ? drillId : undefined,
    });
    // 2026-06-29 (Tim — audit) — clear UNCONDITIONALLY on leave. session_complete
    // overwrites the screen label to "just finished a session" (with an act-now
    // directive); a label-matched clear would no-op and LEAK that directive to the
    // next screen (saying "nine iron" on the dashboard could fire configure_drill).
    return () => clearScreenContext();
  }, [isDrill, drillName, drillFocus, drillId]);
  // 2026-06-16 (Tim — shot-rest cycles) — user-chosen swing count: null = OPEN (the
  // existing free window), or 1/3/5 → cap the session to exactly N swings (the read +
  // narration cover N). A drill's own count still wins. Ref mirror so the stop
  // callback reads the live value without dep churn.
  const [targetSwings, setTargetSwings] = useState<number | null>(null);
  const targetSwingsRef = useRef<number | null>(null);
  useEffect(() => { targetSwingsRef.current = targetSwings; }, [targetSwings]);

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
  // 2026-06-14 (Tim — speed) — warm the analysis lambda the moment we're in setup/
  // recording, so the first swing's analysis lands HOT (no cold-start wait). Throttled.
  useEffect(() => {
    if (phase === 'setup' || phase === 'recording') prewarmSwingAnalysis();
  }, [phase]);
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
  // 2026-06-14 (Tim — per-swing trace) — cache the departure read PER swing index so
  // switching reel tabs shows THAT swing's trace. The old single-shot effect computed
  // departure once off the FIRST strike and never recomputed, so swings 2-5 showed
  // swing 1's trace (or none). Mirrors the per-swing tempo cache.
  const ballDepartureCacheRef = useRef<Record<number, BallDepartureResult | null>>({});
  // 2026-06-25 (Shot Tracing, Tim) — the MULTI-FRAME measured ball path for the
  // selected swing. Where ballDeparture seeds the single launch-direction line,
  // this carries the full set of detected post-impact positions that buildShotTrace
  // renders as a solid measured polyline (+ a dashed projected continuation when the
  // ball leaves frame). Cached per swing index like the departure read. null = not
  // run / nothing detected (the overlay degrades to the single-line trace + a note).
  const [ballPathPoints, setBallPathPoints] = useState<{ x: number; y: number }[] | null>(null);
  const ballPathCacheRef = useRef<Record<number, { x: number; y: number }[] | null>>({});
  // 2026-07-07 — the SOURCE frame aspect (frameW/frameH) the ball-path was detected in,
  // so the overlay can map the frame-normalized points into the container's cover space.
  const [ballPathFrameAR, setBallPathFrameAR] = useState<number | null>(null);
  // 2026-07-07 (Tim — real clubhead swing arc) — the DETECTED clubhead path for the
  // selected swing (frame-normalized + tMs), from detectClubPath. null = not run /
  // nothing clearly detected → the overlay keeps the honest hand/tempo trace. Cached
  // per swing index like the ball path (one server pass per swing, on the Motion step).
  const [clubArcPoints, setClubArcPoints] = useState<{ x: number; y: number; tMs: number }[] | null>(null);
  const clubPathCacheRef = useRef<Record<number, { x: number; y: number; tMs: number }[] | null>>({});
  const [liveDb, setLiveDb] = useState<number | null>(null);
  // 2026-06-14 (audit — perf) — throttles the ~50ms meter callback down to ~120ms
  // of React state churn so the live meter doesn't re-render the whole screen 20×/s.
  const lastDbSetAtRef = useRef(0);
  // 2026-06-12 (honesty) — true ONLY while a metered mic track is actually capturing
  // (cage / range / off-round course). The AcousticPickupCard's "Listening" badge gates
  // on this so we never claim to be listening when metering is off (course-in-round,
  // or chip mode on a range) and no mic is running.
  const [meteringActive, setMeteringActive] = useState(false);
  const [segments, setSegments] = useState<SwingSegment[]>([]);
  // 2026-06-12 (phase 1b) — mirror so runAnalysis (a useCallback) can read the FULL set
  // of detected swings without a stale closure, to carve a multi-swing cage clip into N
  // per-swing library shots instead of collapsing it to one.
  const segmentsRef = useRef<SwingSegment[]>([]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
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
  // 2026-06-23 (Tim) — guided Scan-club: a framing box + 3-2-1 hold so the user
  // presents the club SOLE steadily (a quick pass gives the vision a blurry,
  // unreadable frame — the "8-iron" only reads from a crisp held frame).
  const [clubScanActive, setClubScanActive] = useState(false);
  const [clubScanCount, setClubScanCount] = useState(0);
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
  // 2026-07-06 (voice audit) — "record me putting" opens SmartMotion with ?angle=putt
  // when it's closed; without this it fell to down_the_line (putt isn't an Angle, it's
  // a separate mode). Seed putt mode from the param on cold open.
  const [puttMode, setPuttMode] = useState(angleParam === 'putt');
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
    else if (cur === 'face_on') { setPuttMode(true); setAngle('down_the_line'); lastChosenAngleRef.current = 'down_the_line'; showModeFade('PUTTING'); }
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

  // 2026-06-13 (Tim) — setup tool rail collapses to a chevron by default so the
  // right third stays clear for framing; tap to pop it down over a darker scrim.
  const [railExpanded, setRailExpanded] = useState(false);

  // 2026-06-13 (Tim) — handedness-aware DTL default framing: the player fills ~2/3
  // of the frame and the ball + target line sit in the OUTER 1/3 (RH → right, LH →
  // left) instead of dead-center. Applied once for down-the-line, only until the
  // user drags the box (userMovedBallRef) or pose auto-anchors it to the feet. This
  // partition (player 2/3 vs ball 1/3) is what lets analysis scope golfer vs ball.
  // NOT for putt mode — a putt is a ball→hole view, not a 2/3-player swing frame, so
  // it keeps the centered default (DEFAULT_BALL_BOX), not the outer-third rig.
  const dtlDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (dtlDefaultAppliedRef.current || userMovedBallRef.current) return;
    if (angle !== 'down_the_line' || isPutt) return;
    const rig = defaultDtlRig(swingerHandedness);
    setDraftBall(rig.ball);
    // (putt mode returned above) — DTL swing target sits up the frame, effort-capped.
    setDraftTarget({ x: rig.target.x, y: Math.max(EFFORT_TOP_CAP, rig.target.y) });
    dtlDefaultAppliedRef.current = true;
  }, [angle, swingerHandedness, isPutt]);
  const [videoPaused, setVideoPaused] = useState(false); // review play/pause
  // 2026-06-14 — guards the windowed-loop re-seek so a burst of playback-status
  // ticks past a swing's endMs only fires one setPositionAsync (no seek spam/stutter).
  const loopSeekGuardRef = useRef(false);
  // 2026-07-07 (Tim — "does evaluation improve with slow-mo first?") — YES: at ½ speed
  // the positions (top, transition, impact) are actually readable on a phone and the
  // skeleton/arc overlays track visibly, so the FIRST replay defaults to ½. The speed
  // badge still cycles (½ → ¼ → 1×) — one tap back to real-time for tempo feel.
  const [playbackRate, setPlaybackRate] = useState(0.5); // review slow-mo (1 / .5 / .25)
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
                  // "Still default" = the user hasn't manually dragged the box.
                  // (userMovedBallRef is the real signal; this also recognizes the
                  // handedness-aware DTL default, not just the legacy center box.)
                  const isDefault = !userMovedBallRef.current;
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

  // 2026-06-29 (Tim — "single brain everywhere") — TALK TO THE CADDIE from the
  // SmartMotion screen. Captures one utterance and hands it to the ONE caddie brain
  // (emit → caddie.tsx → pipecat): it replies AND dispatches tools, so "record my
  // swing" starts THIS screen's capture, "driver, 3 swings" configures the drill, and
  // a conversational "what should I work on" stays dialogue-first. Setup phase only /
  // never while recording (the camera has the mic then).
  const [caddieListening, setCaddieListening] = useState(false);
  const askCaddie = useCallback(async () => {
    if (caddieListening) { endCaptureEarly(); return; }
    if (isSmartMotionRecording()) return;
    setCaddieListening(true);
    try {
      const text = await captureUtterance(8000, getApiBaseUrl(), 'en');
      if (text && text.trim()) emitSmartMotionUtterance(text.trim());
    } catch { /* mic/transcribe failed — no-op, no fake text */ }
    finally { setCaddieListening(false); }
  }, [caddieListening]);
  const [playbackMs, setPlaybackMs] = useState(0);
  // 2026-06-09 — "Motion overlay" is now a SEPARATE on-demand step (off by
  // default). Default review = watch the swing + Kevin's feedback only, with a
  // clean video. Turning Motion on computes + shows the skeletal overlay, body
  // analysis, tempo and speed — so nothing fires all at once over the video.
  // 2026-06-13 — Tim: skeleton ON by default. The pose overlay draws async and
  // the video plays immediately, so it never slows the replay; the Motion chip
  // still toggles it OFF for a clean frame.
  // 2026-06-15 (Tim) — default the skeleton/body-trace OFF (it interpolates a
  // sparse 5-frame pose onto the moving video → laggy). The ball-departure/trace
  // compute is gated on showSkeleton too, so this defaults BOTH overlays off;
  // the toggle re-enables + processes them on demand. ([[overstrict-gate-lens]] —
  // off-by-default-but-available, not removed.)
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
  // 2026-07-08 (segmentation audit #1/#8) — session token + in-flight dedupe for the
  // per-swing analysis. Bumping the token on reset/new-recording makes any still-in-
  // flight read from the PRIOR session drop its result instead of poisoning the new
  // session's cache; the inflight map stops duplicate concurrent reads per swing.
  const sessionRunRef = useRef(0);
  const analysisInflightRef = useRef<Record<number, Promise<SwingAnalysis | null> | undefined>>({});
  const tempoCacheRef = useRef<Record<string, SwingTempo>>({});
  const pipelineNarratedRef = useRef(false); // 2026-06-15 — guards one-time per-session pipeline narration
  const pipelineAbortRef = useRef(false);    // 2026-06-16 — abort in-flight narration on exit / new session (no ghost reads)
  const pipelineRunRef = useRef(0);          // 2026-06-16 — per-run token: a new session bumps it so a stale pipeline bails

  const cameraRef = useRef<CameraView>(null);
  // 2026-06-11 — Front/rear camera toggle ("selfie mode"). Lets the user flip to
  // the FRONT camera to self-frame a face-on recording (verify they're centered /
  // fully in shot) — impossible with the rear camera pointed away. mirror={false}
  // keeps the recording UN-mirrored, so a front face-on clip is geometrically
  // identical to a rear face-on one: handedness, direction faults, and ball/target
  // coords are all unaffected — zero analysis changes. (A mirrored selfie preview
  // would feel natural but flip every direction read, so we deliberately don't.)
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  // SmartTrace: runtime capture-engine toggle (default expo-camera). Flipped on the
  // native-modules-debug screen so one build A/B-tests vision-camera vs expo-camera.
  const useVisionCamera = useCaptureEngineStore((s) => s.useVisionCamera);
  // Lazy-load the vision component ONLY when the toggle is on — which can only be
  // meaningfully true in a build that linked react-native-vision-camera. On any
  // other build the require never runs, so the native module is never touched and
  // this screen's JS ships safely over OTA. (require, not import, is the point.)
  const SwingVisionCamera = useMemo(() => {
    if (!useVisionCamera) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../../components/capture/SwingVisionCamera').SwingVisionCamera as typeof import('../../components/capture/SwingVisionCamera').SwingVisionCamera;
    } catch {
      // Toggle flipped on a build that didn't link vision-camera → fall back to
      // expo-camera instead of crashing. (Belt-and-suspenders with the OTA-safe
      // lazy require above.)
      return null;
    }
  }, [useVisionCamera]);
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

  // 2026-07-06 (MOAT Phase 2 — the judge) — grade the drill set against the fault
  // it's meant to fix. The drill id IS the CanonicalIssue it targets; the session's
  // rolled-up primary_issue tells us whether that fault still dominated the reps.
  // Honest + directional (per-set), never "you fixed your slice". Only once analysis
  // has resolved ('ok').
  const drillVerdict = useMemo(() => {
    if (!isDrill || !drillId || cageSession?.analysis_status !== 'ok') return null;
    const pi = cageSession?.primary_issue ?? null;
    // 2026-07-07 (Tim — chunk honesty in the MOAT loop) — the saved primary_issue now
    // encodes a contact mishit (H1), and ballDeparture tells us if the ball ever left.
    // Feed both so a chunked drill rep is NEVER graded "got it".
    const savedMishit: 'fat' | 'thin' | 'topped' | null =
      pi?.issue_id === 'heavy_contact' ? 'fat'
      : pi?.issue_id === 'thin_contact' ? 'thin'
      : pi?.issue_id === 'topped_contact' ? 'topped'
      : null;
    const ballLaunched: boolean | null = ballDeparture == null
      ? null
      : ballDeparture.departed ? true : ballDeparture.ball_present_before ? false : null;
    return deriveDrillVerdict({
      drillId,
      drillName: typeof drillName === 'string' ? drillName : null,
      issueId: pi?.issue_id ?? null,
      issueName: pi?.name ?? null,
      severity: pi?.severity ?? null,
      confidence: pi?.confidence ?? null,
      contactMishit: savedMishit,
      ballLaunched: pi?.issue_id === 'no_launch' ? false : ballLaunched,
    });
  }, [isDrill, drillId, drillName, cageSession?.analysis_status, cageSession?.primary_issue, ballDeparture]);
  const drillVerdictColor = drillVerdict
    ? (drillVerdict.grade === 'got_it' ? '#88F700' : drillVerdict.grade === 'closer' ? '#F0C030' : '#FF6B2C')
    : '#88F700';
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

  // 2026-06-29 (Tim) — targeting overlay: DEFAULT ON, manual toggle only. NO
  // auto-fade (it vanished before you could even see it). The eye toggle (top-left,
  // out of the tools card) hides/shows it INSTANTLY; otherwise it stays put.
  const [targetingVisible, setTargetingVisible] = useState(true);
  const targetingOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    targetingOpacity.setValue(targetingVisible ? 1 : 0);
  }, [targetingVisible, targetingOpacity]);
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
  // 2026-07-07 (Tim — "shot tracing that actually lines up on the user") — the CV points
  // (departure / ball-path) are FRAME-normalized; the ball box + target the user placed
  // are CONTAINER-normalized. Over the full-bleed COVER review video those spaces DON'T
  // coincide, so the trace drifted off the ball (and off the correctly-mapped skeleton).
  // Map every CV point into the SAME container space the anchors live in before the trace
  // math, so the line lands on the ball and the divergence isn't computed across two
  // spaces. frameAR from whichever detector ran; container aspect from the measured root.
  const frameAR = useMemo(() => {
    if (ballDeparture?.frameW && ballDeparture?.frameH) return ballDeparture.frameW / ballDeparture.frameH;
    return ballPathFrameAR;
  }, [ballDeparture, ballPathFrameAR]);
  const containerAR = rootSize.w > 0 && rootSize.h > 0 ? rootSize.w / rootSize.h : null;
  const cvToContainer = useCallback(
    (p: { x: number; y: number }) =>
      frameAR != null && containerAR != null ? frameToContainerNorm(p, frameAR, containerAR, 'cover') : p,
    [frameAR, containerAR],
  );

  // 2026-06-11 — DTL ball-trace. DOWN-THE-LINE ONLY (no flight to see face-on or in a
  // putt). The real departure point (from ballDeparture, detected off the acoustic
  // anchor) → the initial direction line measured against the ball→target aim line.
  const ballTrace = useMemo(() => {
    if (angle !== 'down_the_line' || isPutt) return null;
    if (!ballDeparture?.departurePoint || !ballArea) return null;
    return computeTraceDirection(ballArea, cvToContainer(ballDeparture.departurePoint), targetPoint);
  }, [angle, isPutt, ballDeparture, ballArea, targetPoint, cvToContainer]);
  // 2026-07-07 — ref mirrors so runAnalysis (a stable callback) reads the CURRENT
  // measured signals at call time without dep churn (same pattern as ballAreaRef).
  const tempoRef = useRef(tempo);
  const biomechRef = useRef(biomech);
  const ballTraceRef = useRef(ballTrace);
  useEffect(() => { tempoRef.current = tempo; }, [tempo]);
  useEffect(() => { biomechRef.current = biomech; }, [biomech]);
  useEffect(() => { ballTraceRef.current = ballTrace; }, [ballTrace]);
  // 2026-06-15 (Tim — shot-shape drills) — when this is a shot-shape drill, read
  // the actual LAUNCH (origin → the one departure point) and compare it to the
  // intended shape. Honest: launch height + direction only; roll is never claimed.
  const shotShapeDef = useMemo(() => getShotShape(drillShotType), [drillShotType]);
  const shotShapeVerdict = useMemo(() => {
    if (!shotShapeDef || !ballArea) return null;
    const actual = ballDeparture?.departurePoint ? readActualLaunch(ballArea, cvToContainer(ballDeparture.departurePoint)) : null;
    return compareShotShape(shotShapeDef, actual);
  }, [shotShapeDef, ballArea, ballDeparture, cvToContainer]);
  // Green→red by how far off the aim line it started, dimmed by a weak strike (peakDb
  // vs the session's strongest). Honest: divergence + real strike energy, no faked curve.
  const ballTraceColor = useMemo(() => {
    if (!ballTrace) return '#34d399';
    const seg = segments[selectedSwing];
    // 2026-06-12 — reference = the LOUDEST acoustic strike (max value = loudest whatever
    // the metering sign). Video-located segments carry peakDb EXACTLY 0 and are excluded
    // (non-zero only). No acoustic reference → undefined → no dim.
    const refDb = segments.reduce((m, s) => (typeof s.peakDb === 'number' && s.peakDb !== 0 ? Math.max(m, s.peakDb) : m), -Infinity);
    return traceColor(ballTrace.divergenceDeg, seg?.peakDb, refDb === -Infinity ? undefined : refDb);
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
      // 2026-07-06 (honesty audit) — hedge the monocular turn degrees with '~' when
      // metric_confidence is low (same convention as deriveBodyItems), so a soft 2D
      // read doesn't render as precise measured degrees.
      { key: 'shoulder', img: ICON_BIOMECH.shoulder, value: biomech?.shoulderTurnDeg != null ? `${(biomech.metric_confidence?.shoulderTurn ?? 1) < 0.5 ? '~' : ''}${Math.round(biomech.shoulderTurnDeg)}` : null, unit: '°', label: 'SHOULDER' },
      { key: 'hip', img: ICON_BIOMECH.hip, value: biomech?.hipTurnDeg != null ? `${(biomech.metric_confidence?.hipTurn ?? 1) < 0.5 ? '~' : ''}${Math.round(biomech.hipTurnDeg)}` : null, unit: '°', label: 'HIP TURN' },
    ];
  }, [isPutt, analysis, biomech]);
  // 2026-06-12 — LEFT rail: the ball/result metrics as custom badges (Tim). Honest +
  // distinct: TEMPO (ratio), BALL SPEED, BALL RESULT (the DTL trace's start direction).
  // Each shows "—" until measured. BALL SPEED is driven by the synthesized SwingMetric
  // (same source page 2 uses) and prefixed "~" when it's an ESTIMATE (acoustic loudness
  // heuristic, not truth-grade) — never shown as a hard measured number (honesty fix
  // 2026-06-12: the badge used to print a raw mph with no est marker). SMASH needs club
  // speed we don't have; inferred FACE ≈ ball result, so neither is duplicated here.
  // SmartTrace confidence-tiered read: flight (departure seen) → direction; contact
  // (no flight but a real acoustic strike) → "STRUCK" + honest flag; none → "—".
  // Never dark — degrades instead of going blank (memory overstrict-gate-lens).
  const smartTrace = useMemo(
    () => composeSmartTrace({
      isPutt,
      isDownTheLine: angle === 'down_the_line',
      direction: ballTrace ? { side: ballTrace.side, divergenceDeg: ballTrace.divergenceDeg } : null,
      strikeDetected: (segments[selectedSwing]?.peakDb ?? 0) !== 0,
      tempoRatio: tempo?.ratio ?? null,
    }),
    [isPutt, angle, ballTrace, segments, selectedSwing, tempo],
  );
  const leftMetrics = useMemo(() => {
    if (isPutt) return [];
    const dir = smartTrace.badge;
    const bs = metrics.ball_speed;
    const bsEst = bs.value != null && !isTruthGrade(bs.source);
    return [
      { key: 'tempo', img: ICON_METRIC.tempo, value: tempo?.ratio != null ? `${tempo.ratio.toFixed(1)}` : null, unit: ': 1', label: 'TEMPO' },
      { key: 'speed', img: ICON_METRIC.ballspeed, value: bs.value != null ? `${bsEst ? '~' : ''}${Math.round(bs.value)}` : null, unit: 'mph', label: 'BALL SPEED' },
      { key: 'result', img: ICON_METRIC.ballresult, value: dir, unit: '', label: 'BALL RESULT' },
    ];
  }, [isPutt, tempo, metrics, smartTrace]);

  // Practice Engine — stamp this analyzed swing into the active practice session.
  // recordPracticeSwingIfActive NO-OPS unless a session is running, so this is inert
  // outside practice (zero blast radius). Exactly-once per recording via a clipUri
  // dedup set. The tier is captured from the best-known read at review time; a late
  // async departure upgrade isn't retro-applied — conservative (never over-claims
  // flight). Divergence is signed (L negative) so the session's spread is directional.
  const stampedClipsRef = useRef<Set<string>>(new Set());
  // 2026-06-30 (audit M4) — also COLLECT each per-swing sample for this Smart Motion open,
  // so the session-less save path (plain SmartMotion + drills → recordCompletedSession) can
  // stamp them and the practice-detail screen shows real striation + tempo, not just a count.
  // Accumulates across the go-again loop within one mount; resets naturally on next open.
  const practiceSwingSamplesRef = useRef<Parameters<typeof recordPracticeSwingIfActive>[0][]>([]);
  useEffect(() => {
    if (phase !== 'review' || !clipUri || analysis == null) return;
    if (stampedClipsRef.current.has(clipUri)) return;
    stampedClipsRef.current.add(clipUri);
    const signedDiv = ballTrace
      ? (ballTrace.side === 'left' ? -1 : 1) * ballTrace.divergenceDeg
      : null;
    const sample = {
      club,
      tier: smartTrace.tier,
      tempoRatio: tempo?.ratio ?? null,
      divergenceDeg: signedDiv,
    };
    recordPracticeSwingIfActive(sample);
    practiceSwingSamplesRef.current.push(sample);
    // 2026-07-07 (Tim — "tie the tracing into the caddie brain") — the same measured
    // signals also feed the CNS rolling tendencies, so the brain can cite YOUR real
    // tempo average / start-line % / contact pattern (was: computed but never learned).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mem = require('../../store/caddieMemoryStore') as typeof import('../../store/caddieMemoryStore');
      const cr = analysis?.contact_read;
      mem.useCaddieMemoryStore.getState().recordSwingMetrics({
        tempoRatio: tempo?.ratio ?? null,
        divergenceDeg: signedDiv,
        mishit: cr === 'fat' || cr === 'thin' || cr === 'topped' ? cr : null,
        nowMs: Date.now(),
      });
    } catch { /* non-fatal — learning is additive */ }
  }, [phase, clipUri, analysis, smartTrace, ballTrace, club, tempo]);

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
    if (!showSkeleton || !clipUri || !ballArea) return;
    // 2026-06-14 (Tim) — compute departure for the SELECTED swing (its own strike),
    // cached per index, so each reel tab shows its own trace (was first-strike-only).
    const seg = segments[selectedSwing];
    const strikeMs = seg?.strikeMs ?? firstStrikeMsRef.current;
    if (strikeMs == null) return;
    // An ACOUSTIC impact anchor is frame-accurate; a video-LOCATED swing time
    // (range/upload/night-no-acoustic) is only ~±1s accurate, so the ±120/160ms
    // departure window around it can read the wrong frames → false direction.
    // swingSegmentation sets video-located peakDb to EXACTLY 0; an acoustic strike
    // carries the real (non-zero) metering reading.
    // 2026-06-15 (Tim — "watched the ball to the canvas but got no trace") — instead
    // of going DARK on video-located swings, ATTEMPT departure and accept it only
    // when it's HIGH-confidence and the ball was clearly present-then-gone. That
    // surfaces a trace when the departure is visually unambiguous (the daytime case)
    // WITHOUT ever drawing a wrong-direction line off a loose anchor — degrade+flag,
    // not hard-reject ([[overstrict-gate-lens]]).
    const videoLocated = (seg?.peakDb ?? 0) === 0;
    // Cache hit → show this swing's trace immediately.
    if (selectedSwing in ballDepartureCacheRef.current) {
      setBallDeparture(ballDepartureCacheRef.current[selectedSwing]);
      return;
    }
    setBallDeparture(null); // clear the prior swing's trace while this one computes
    let cancelled = false;
    void detectBallDeparture({ videoUri: clipUri, impactMs: strikeMs, ballArea })
      .then((r) => {
        if (cancelled) return;
        // 2026-06-29 (Tim — "the confidence gate is too high") — video-located reads
        // were thrown away unless confidence was HIGH (plus departed + ball-present).
        // The ball IS visible at the range; accept MEDIUM+ so a real, seen departure
        // draws its launch instead of nothing. Still drop genuinely-low reads.
        const accepted = videoLocated
          ? (r && r.departed && r.confidence !== 'low' && r.ball_present_before ? r : null)
          : (r ?? null);
        ballDepartureCacheRef.current[selectedSwing] = accepted;
        setBallDeparture(accepted);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [showSkeleton, clipUri, ballArea, segments, selectedSwing]);

  // 2026-06-25 (Shot Tracing, Tim) — MULTI-FRAME ball-path detection. Samples a
  // short sequence of post-impact frames and locates the ball in each it can (api/
  // ball-path → detectBallPath). The detected positions are the SOLID measured
  // portion of the shot trace; buildShotTrace adds the dashed PROJECTED continuation
  // when the ball runs off the edge. Runs only DTL + non-putt (no flight to trace
  // face-on / in a putt), on the same on-demand Motion step as the departure read
  // (never competes with the core analysis pass). Honest: detectBallPath returns
  // null on any failure / no-server, and an empty result → no trace + a note.
  useEffect(() => {
    if (!showSkeleton || !clipUri || !ballArea) return;
    if (angle !== 'down_the_line' || isPutt) { setBallPathPoints(null); return; }
    const seg = segments[selectedSwing];
    const strikeMs = seg?.strikeMs ?? firstStrikeMsRef.current;
    if (strikeMs == null) return;
    if (selectedSwing in ballPathCacheRef.current) {
      setBallPathPoints(ballPathCacheRef.current[selectedSwing]);
      return;
    }
    setBallPathPoints(null);
    let cancelled = false;
    void detectBallPath({ videoUri: clipUri, impactMs: strikeMs, ballArea })
      .then((r) => {
        if (cancelled) return;
        // 2026-06-29 (Tim — graded trace) — keep even a SINGLE detected point; buildShotTrace
        // renders it as a flagged low-confidence launch marker (tier 'single') instead of
        // dropping a real, seen ball position.
        const pts = r && r.points.length >= 1 ? r.points.map((p) => ({ x: p.x, y: p.y })) : null;
        ballPathCacheRef.current[selectedSwing] = pts;
        setBallPathPoints(pts);
        if (r?.frameW && r?.frameH) setBallPathFrameAR(r.frameW / r.frameH);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [showSkeleton, clipUri, ballArea, segments, selectedSwing, angle, isPutt]);

  // 2026-07-07 (Tim — real clubhead swing arc) — on the Motion step, run the clubhead
  // detector across the SELECTED swing's window. Unlike the ball path this is NOT
  // DTL-gated (the arc reads face-on too). One server pass per swing, cached. Honest:
  // detectClubPath returns null on any failure / no-server, and the overlay falls back
  // to the hand/tempo trace when there aren't enough clearly-detected clubhead points.
  useEffect(() => {
    if (!showSkeleton || !clipUri) { setClubArcPoints(null); return; }
    const seg = segments[selectedSwing];
    if (!seg || typeof seg.startMs !== 'number' || typeof seg.endMs !== 'number' || !(seg.endMs > seg.startMs)) {
      setClubArcPoints(null);
      return;
    }
    if (selectedSwing in clubPathCacheRef.current) {
      setClubArcPoints(clubPathCacheRef.current[selectedSwing]);
      return;
    }
    setClubArcPoints(null);
    let cancelled = false;
    void detectClubPath({ videoUri: clipUri, startMs: seg.startMs, endMs: seg.endMs })
      .then((r) => {
        if (cancelled) return;
        const pts = r && r.points.length >= 1 ? r.points.map((p) => ({ x: p.x, y: p.y, tMs: p.tMs })) : null;
        clubPathCacheRef.current[selectedSwing] = pts;
        setClubArcPoints(pts);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [showSkeleton, clipUri, segments, selectedSwing]);

  // Compose the tiered multi-point shot trace from the measured positions +
  // the aim reference. 'full' = solid in-frame path; 'launch' = solid measured
  // launch + a DASHED PROJECTED continuation; 'none' = no honest path (caller
  // shows the no-track note). Gated DTL + non-putt (same as ballTrace).
  const shotTrace = useMemo<ShotTraceBuild | null>(() => {
    if (angle !== 'down_the_line' || isPutt) return null;
    if (!ballPathPoints || ballPathPoints.length < 1 || !ballArea) return null;
    // Map the frame-normalized measured points into the container space the anchors +
    // overlay draw in, so the polyline sits on the ball and the divergence is honest.
    return buildShotTrace(ballPathPoints.map(cvToContainer), ballArea, targetPoint);
  }, [angle, isPutt, ballPathPoints, ballArea, targetPoint, cvToContainer]);
  // Colour the measured/projected trace by how far off the aim line it launched
  // (reuses traceColor — green on line → red way off), dimmed by a weak strike.
  const shotTraceColor = useMemo(() => {
    if (!shotTrace || shotTrace.divergenceDeg == null) return '#34d399';
    const seg = segments[selectedSwing];
    const refDb = segments.reduce((m, s) => (typeof s.peakDb === 'number' && s.peakDb !== 0 ? Math.max(m, s.peakDb) : m), -Infinity);
    return traceColor(shotTrace.divergenceDeg, seg?.peakDb, refDb === -Infinity ? undefined : refDb);
  }, [shotTrace, segments, selectedSwing]);

  const bodyItems = useMemo(() => deriveBodyItems(analysis, biomech), [analysis, biomech]);

  // 2026-07-07 (Tim — chunk-shot honesty) — the CONTACT signals the motion read
  // can't see: the camera strike check (did the ball actually leave?) and the
  // player's own feel note ("I chunked it"). These override a "no fault" motion
  // read so a fat/thin/topped strike is never shown as a good swing.
  const swingContact = useMemo<SmContact>(
    () => deriveContact(analysis, { ballDeparture, feelText }),
    [ballDeparture, feelText, analysis],
  );
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
    return deriveVerdict(analysis, phase === 'analyzing', swingContact);
  }, [isPutt, puttAnalysis, analysis, analysisError, phase, swingContact]);
  const faultHeadline = useMemo(() => {
    if (!analysis) return null;
    const f = analysis.primary_fault;
    if (f && f !== 'no_dominant_fault' && f !== 'inconclusive') return f.replace(/_/g, ' ');
    if (analysis.detected_issue && analysis.detected_issue !== 'none') return analysis.detected_issue.replace(/_/g, ' ');
    return null;
  }, [analysis]);

  // Cleanup on unmount — stop an in-flight recording + metering + ALL speech.
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recordTimeoutRef.current) clearTimeout(recordTimeoutRef.current);
      stoppingRef.current = true;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      try { cameraRef.current?.stopRecording(); } catch { /* no-op */ }
      void meteringRef.current?.cancel().catch(() => undefined);
      // 2026-06-16 (Tim — a previous read's voice fired off later) — leaving Smart
      // Motion must kill any in-flight / queued narration so it can't replay on the
      // next screen. Abort the per-swing pipeline AND stop the TTS queue.
      pipelineAbortRef.current = true;
      pipelineRunRef.current++; // invalidate any in-flight pipeline run
      void stopSpeaking().catch(() => undefined);
      setSmartMotionRecording(false); // never leave the mic flagged-reserved after we leave
    };
  }, []);

  const runAnalysis = useCallback(
    async (rawUri: string, segment?: SwingSegment) => {
      setPhase('analyzing');
      // try/finally ensures setPhase('review') fires even if something throws
      // before the normal call sites (putt return / swing path exit). Without
      // this, any uncaught synchronous throw above the existing calls leaves
      // the screen stuck on "Analyzing…" forever.
      try {
      // Prewarm the TTS function NOW (analysis takes seconds) so the spoken
      // verdict that follows fires hot, not cold (Tim's report-read lag).
      // Throttled + breaker-guarded inside warmVoice, so this is ~free.
      warmVoice(getApiBaseUrl());
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
      sessionRunRef.current += 1; // drop any prior session's in-flight analysis
      analysisInflightRef.current = {};
      // Persist the recorded clip into documents so it survives OS cache
      // eviction — otherwise an old SmartMotion recording later can't replay
      // OR re-analyze (the temp recorder file is gone). Already-persistent or
      // stale uris pass through unchanged. Best-effort; never blocks.
      const boundaries = segment ? { startSec: segment.startMs / 1000, endSec: segment.endMs / 1000 } : undefined;
      // CNS learned tendencies as SOFT priors (cheap store read; hoisted so the parallel
      // read below can carry them — identical to reading them just before the request).
      const cnsTend = (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mem = require('../../store/caddieMemoryStore') as typeof import('../../store/caddieMemoryStore');
          return mem.useCaddieMemoryStore.getState().getPlayer().tendencies;
        } catch { return { dominantMiss: null as string | null, recentFaults: [] as string[] }; }
      })();
      // 2026-07-08 (timeliness audit RANK 1) — START the SWING vision read on the RAW
      // recorder file NOW, so it runs in PARALLEL with the durable-clip byte-copy +
      // session ingest below. The old order AWAITED persistClipToDocuments (a full copy
      // of the recording) IN FRONT of the read — pure latency before every verdict. The
      // raw file is valid for the few seconds extractKeyFrames needs; the durable copy
      // only matters for later replay/re-analyze. Putts take the analyzePutt path below,
      // so only the swing path pre-starts. analyzeOpts reads live refs that are "absent
      // on first pass by design", so building it here (vs after the ingest) changes nothing.
      const hangGuardMs = 130_000;
      const analysisP: Promise<Awaited<ReturnType<typeof analyzeSwing>>> | null = isPutt ? null : Promise.race([
        analyzeSwing(rawUri, {
          club: clubRef.current ? clubIdToServerKey(clubRef.current) : 'unknown',
          swing_number: segment?.index ?? 1,
          caddie_name: caddiePersonality,
          angle,
          handedness: swingerHandedness,
          language,
          prior_issues: cnsTend.recentFaults.length > 0 ? cnsTend.recentFaults : undefined,
          player_context: {
            handicap: profile.handicap ?? null,
            dominant_miss: cnsTend.dominantMiss ?? profile.dominantMiss ?? null,
            first_name: profile.firstName ?? null,
          },
          tier: 'quick' as const,
          ball_area_norm: draftBallRef.current ?? ballAreaRef.current ?? null,
          target_norm: targetPointRef.current ?? null,
          drill_focus: isDrill && typeof drillFocus === 'string' && drillFocus.trim() ? drillFocus.trim() : undefined,
          drill_name: isDrill && typeof drillName === 'string' && drillName.trim() ? drillName.trim() : undefined,
          measured: {
            tempo_ratio: tempoRef.current?.ratio ?? null,
            backswing_ms: tempoRef.current?.backswingMs ?? null,
            downswing_ms: tempoRef.current?.downswingMs ?? null,
            shoulder_tilt_deg: biomechRef.current?.shoulderTiltDeg ?? null,
            spine_delta_deg: biomechRef.current?.spineAngleDeltaDeg ?? null,
            weight_shift_pct: biomechRef.current?.weightShiftPct ?? null,
            launch_divergence_deg: ballTraceRef.current?.divergenceDeg ?? null,
            launch_side: ballTraceRef.current?.side ?? null,
            strike_peak_db: segment?.peakDb ?? null,
          },
        }, boundaries),
        new Promise<Awaited<ReturnType<typeof analyzeSwing>>>((resolve) =>
          setTimeout(() => resolve({ kind: 'error', message: 'Analysis timed out' }), hangGuardMs)),
      ]);
      // Persist the durable copy in PARALLEL with the in-flight read above.
      let uri = rawUri;
      try {
        const { persistClipToDocuments } = await import('../../services/videoUpload');
        uri = await persistClipToDocuments(rawUri);
        // Point review/replay + re-analyze at the DURABLE copy (survives cache eviction).
        if (uri !== rawUri) setClipUri(uri);
      } catch { /* use rawUri */ }

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
        const uploadMeta = {
          uploaded_at: Date.now(),
          notes: `Smart Motion ${angle === 'face_on' ? 'face-on' : 'down-the-line'} swing`,
          duration_sec: null,
          has_audio: true,
          source_device: 'phone' as const,
          tag: null,
          swinger,
          perspective,
        };
        // 2026-06-12 (phase 1b) — CARVE a multi-swing cage reel into N per-swing library
        // shots (each scrubbing its own window into the master clip), so the session lands
        // in the library AS the N swings it was — not collapsed to one. Single-swing clips
        // keep the simple upload path. Both tag captureKind 'smart_motion'.
        // 2026-06-13 (#5) — DRILL shot cap. A drill says "take 3-5"; keep the
        // library reel to exactly that many swings (the first N detected). Safe
        // post-hoc cap on the carve — the live recording loop is untouched.
        const allSegs = segmentsRef.current;
        const segs = isDrill && drillShotCount ? allSegs.slice(0, drillShotCount) : allSegs;
        const sessionId = segs.length > 1
          ? useCageStore.getState().ingestLiveCageSession({
              masterVideoPath: uri,
              // 2026-06-30 (audit C8) — was hardcoded 'unknown', so multi-swing library
              // sessions lost the selected club → per-club practice points + bag learning
              // couldn't credit them. Use the live selection like the analysis path does.
              club: clubRef.current ? clubIdToServerKey(clubRef.current) : 'unknown',
              upload: uploadMeta,
              shots: segs.map((s, i) => ({
                correlationId: `sm_${i}_${s.strikeMs}`,
                detectionOffsetSeconds: s.strikeMs / 1000,
                clipStartSeconds: s.startMs / 1000,
                clipEndSeconds: s.endMs / 1000,
                // a real acoustic strike carries a non-zero peakDb; a video-located swing is 0
                detectionMethod: (s.peakDb ?? 0) !== 0 ? 'audio_transient' as const : 'manual' as const,
              })),
              captureKind: isDrill ? 'drill' : 'smart_motion',
            })
          : useCageStore.getState().ingestUploadedSwing({
              clipUri: uri,
              club: clubRef.current ? clubIdToServerKey(clubRef.current) : 'unknown',
              upload: uploadMeta,
              source: 'live_cage',
              captureKind: isDrill ? 'drill' : 'smart_motion',
            });
        ingestedSessionIdRef.current = sessionId;
        setSessionId(sessionId);
        // Camera-first Smart Tempo return — fire here where sessionId is assigned (the
        // stopRecording-side block raced ingestedSessionIdRef before this await).
        if (tempoReturnRef.current && segmentsRef.current.length <= 1) {
          const dest = tempoReturnRef.current;
          tempoReturnRef.current = null; // one-shot
          const tempoMode = puttModeRef.current ? 'putt' : 'full_swing';
          router.replace({ pathname: dest as never, params: { swing_id: sessionId, tempoMode } as never });
        }
        // 2026-06-15 (Tim) — eager library thumbnail at the IMPACT frame (we have the
        // acoustic strike time), so cage sessions always carry a meaningful thumb and
        // don't rely on the unreliable lazy library-open generation over a big clip.
        void ensureSwingThumbnail(sessionId, uri, segs[0]?.strikeMs ?? null);
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
            const msg = 'Putt analysis timed out';
            setAnalysisError(msg);
            try { const sid = ingestedSessionIdRef.current; if (sid) useCageStore.getState().setSessionAnalysisStatus(sid, 'failed', msg); } catch {}
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setAnalysisError(msg);
          try { const sid = ingestedSessionIdRef.current; if (sid) useCageStore.getState().setSessionAnalysisStatus(sid, 'failed', msg); } catch {}
        }
        return;
      }

      try {
        // 2026-07-08 (timeliness audit RANK 1) — the read was PRE-STARTED on the raw
        // recorder file above, in parallel with the durable-clip copy + ingest. Await
        // it here for the verdict. (Old order built analyzeOpts + fired analyzeSwing HERE,
        // strictly AFTER awaiting persistClipToDocuments — the byte-copy sat in front of
        // every verdict.) The 130s outer hang-guard is folded into analysisP so a true
        // hang still can't strand the screen, and a real-but-late read is never discarded.
        const result: Awaited<ReturnType<typeof analyzeSwing>> = await analysisP!;
        if (result.kind === 'ok') {
          setAnalysis(result.analysis);
          analysisCacheRef.current[(segment?.index ?? 1) - 1] = result.analysis;
          const a = result.analysis;
          // 2026-07-07 (Tim — chunk honesty) — the contact this swing's MOTION read
          // can't see. Overrides the saved report + what the CNS learns. Uses ONLY the
          // model's contact_read here: ballDeparture isn't computed until the review-
          // phase effect (after this runs), so reading it at save time would be a stale/
          // null value — a false-positive vector on the persisted report. The live badge
          // + Drill Check read the correctly-timed ballDeparture for the duff case.
          const contact = deriveContact(a);
          // Route the SAVED report + the CNS write through the REAL session classifier,
          // not the conservative `detected_issue` (biased to 'none'). Computed ONCE.
          let rolled: PrimaryIssue | null = null;
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { classifySession } = require('../../services/swingIssueClassifier') as typeof import('../../services/swingIssueClassifier');
            const resolvedCns = Object.entries(analysisCacheRef.current)
              .filter(([, an]) => !!an)
              .map(([idx, an]) => ({ swing_id: `smresolve-swing-${idx}`, analysis: an as typeof a }));
            rolled = resolvedCns.length ? classifySession(resolvedCns) : null;
          } catch { /* classifier is best-effort */ }
          // Caddie CNS Phase 1 — 2026-07-07 (H4): feed the EVIDENCE-GATED fault (rolled /
          // primary_fault), NOT detected_issue (biases to 'none' → the brain never learned
          // the real miss), and record a contact mishit as its OWN tendency ("tends to chunk").
          try {
            const learnedFault = contact.reportedMishit
              ? contactMishitFaultId(contact.reportedMishit)
              : rolled && rolled.issue_id !== 'smartmotion_observation'
                ? rolled.issue_id
                : a.primary_fault && a.primary_fault !== 'no_dominant_fault' && a.primary_fault !== 'inconclusive'
                  ? a.primary_fault
                  : null;
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mem = require('../../store/caddieMemoryStore') as typeof import('../../store/caddieMemoryStore');
            mem.useCaddieMemoryStore.getState().recordSwingFault({ fault: learnedFault, nowMs: Date.now() });
          } catch { /* non-fatal */ }
          const sessionId = ingestedSessionIdRef.current;
          if (sessionId) {
            try {
              // 2026-07-06 (range audit RANK 1) + 2026-07-07 (H1): the SAVED report is
              // the rolled evidence-gated classification, EXCEPT a contact mishit
              // overrides it so the library card + the Drill Check that reads it never
              // celebrate a chunk. `rolled` was computed once above. Falls back to a
              // light observation when there's no fault and no mishit.
              const primaryIssue: PrimaryIssue = contactIssue(contact)
                ?? rolled ?? {
                    issue_id: 'smartmotion_observation',
                    name: 'Smart Motion observation',
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
          const msg = `Analysis ${result.kind.replace('_', ' ')}`;
          setAnalysisError(msg);
          try { const sid = ingestedSessionIdRef.current; if (sid) useCageStore.getState().setSessionAnalysisStatus(sid, 'failed', msg); } catch {}
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setAnalysisError(msg);
        try { const sid = ingestedSessionIdRef.current; if (sid) useCageStore.getState().setSessionAnalysisStatus(sid, 'failed', msg); } catch {}
      }

      } finally {
        setPhase('review');
      }
    },
    [angle, caddiePersonality, language, profile.handicap, profile.dominantMiss, profile.firstName, setSessionBallArea, setSessionTarget, videoDurationMs, swingerHandedness, isDrill, drillShotCount],
  );

  // Pose biomechanics — only when the user opens the Motion overlay (step 2).
  // Keeping this off by default means the default review runs ONLY Kevin's
  // analysis (no simultaneous pose extraction competing for resources).
  // 2026-06-29 (Tim — "the report doesn't pick up / doesn't save") — COMPUTE biomech
  // + pose frames in review REGARDLESS of the Motion toggle. The toggle only controls
  // the on-video skeleton OVERLAY (the laggy part); the DATA (rotation/weight/balance
  // body card + the saved library report) must always be there. Runs async in the
  // background so it never blocks the replay, and commits to the session so Save
  // carries the full report into the library.
  useEffect(() => {
    if (!clipUri || videoDurationMs == null || phase !== 'review') return;
    let cancelled = false;
    // 2026-07-06 (SmartMotion audit H3 — "skeleton barely moves / doesn't match my
    // swing") — WINDOW the pose extraction to the SELECTED swing. A SmartMotion
    // session records ONE clip with multiple swings; this used to sample the 5 pose
    // positions across the WHOLE clip, so the skeleton for swing #3 was built from
    // frames scattered across every swing (SwingBodyOverlay then blended a pose from
    // swing #1 with one from swing #4 → it floated off the body and barely moved),
    // and the body card mixed one swing's address with another's impact. Tempo/ball
    // already window per-swing; pose now matches. Re-runs on selectedSwing change so
    // picking a different swing rebuilds its skeleton. Falls back to whole-clip when
    // there's no usable segment (single un-segmented clips are unchanged).
    const seg = segments[selectedSwing];
    const poseWindow = seg && typeof seg.startMs === 'number' && typeof seg.endMs === 'number' && seg.endMs - seg.startMs >= 500
      ? { startMs: seg.startMs, endMs: seg.endMs }
      : null;
    // 2026-07-07 (biomech audit #2) — anchor the phase frames to the ACOUSTIC strike
    // when we have one (peakDb !== 0 = real metering hit; video-located strikes are
    // only ±1s accurate and stay on window fractions). Fixes "impact" landing 100ms+
    // past the ball / "top" landing mid-backswing — the wrong-phase numbers.
    const acousticImpactMs = seg && seg.strikeMs != null && (seg.peakDb ?? 0) !== 0 ? seg.strikeMs : null;
    void (async () => {
      try {
        // trustDuration=true: videoDurationMs is the player's real onLoad
        // durationMillis, so skip the ~2-8s reprobe inside the pose path (SPEED).
        // 2026-07-07 (biomech audit #8) — extract ONCE and compute biomech from the
        // SAME frames (was two independent extraction runs → ~2× pose inferences and
        // a skeleton that could diverge from the numbers).
        const frames = await extractPoseFramesFromVideo(clipUri, videoDurationMs, true, poseWindow, acousticImpactMs);
        if (cancelled) return;
        setPoseFrames(frames);
        const bio = frames ? computeBiomechanicsFromFrames(frames, angle, swingerHandedness === 'left' ? 'left' : 'right') : null;
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
  }, [clipUri, videoDurationMs, phase, angle, segments, selectedSwing, swingerHandedness]);

  // Acoustic-anchored tempo + transition for the selected swing. Impact
  // comes from the acoustic strike detector (segment.strikeMs);
  // top-of-backswing is read from pose. Cached per (clip, strike) so
  // re-selecting a swing is instant and we never re-pay the pose calls.
  useEffect(() => {
    const seg = segments[selectedSwing];
    // Tempo is the headline swing metric — compute it in review by default (it
    // surfaces in the left tempo pill). Skipped for putts (no swing tempo).
    // Heavier pose/body still wait for the Motion overlay.
    // 2026-06-11 (audit) — only derive tempo from an ACOUSTIC impact anchor (cage).
    // A video-located segment (range/upload) has an impact time that's only frame-
    // spacing-accurate, and deriveSwingTempo trusts the passed impact directly
    // (downswing = impact − top), so a number there would be dishonest. swingSegmentation
    // marks video-located segments with peakDb EXACTLY 0; an acoustic strike carries the
    // real (non-zero) metering reading — so test `=== 0`, correct whatever the metering
    // sign. [2026-06-12 bug fix: was `<= 0`, which ALSO matched negative acoustic peakDb
    // and silently killed Tempo — the headline metric — on every cage swing.]
    if (!clipUri || isPutt || !seg || seg.strikeMs == null || (seg.peakDb ?? 0) === 0) { setTempo(null); return; }
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
        // 2026-06-13 (SPEED) — >= 1, not > 1. When the upload locate already
        // found the swing(s), pass the located window as boundaries so
        // runAnalysis is BOUNDED and analyzeSwing SKIPS its own second
        // locateSwingWindow (~25s) — the redundant double-locate that made
        // single-swing uploads crawl. A single swing → 1 segment (no reel, same
        // as before), but reusing the window we already paid for. swings.length
        // === 0 still falls through to analyzeSwing's own locate (no regression).
        if (!cancelled && swings.length >= 1) {
          const segs = segmentsFromVideoSwings(swings, durMs);
          setSegments(segs);
          setSelectedSwing(0);
          // Sync the ref SYNCHRONOUSLY (mirrors the cage path) so runAnalysis's
          // multi-swing carve sees the full segment set, not a stale one — else
          // multi-swing uploads collapse to 1 shot.
          segmentsRef.current = segs;
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
    // Re-arm the DTL handedness rig + pose ball-auto-anchor for the next capture.
    // Without this, the first clip "consumes" both refs and every later "Record
    // again" / hands-free loop loses the outer-third partition + auto-anchor. The
    // re-applying effect (~L571) is putt-guarded, so resetting here is safe.
    dtlDefaultAppliedRef.current = false;
    userMovedBallRef.current = false;
    setPlaceBallMode(false);
    firstStrikeMsRef.current = null;
    ballDepartureCacheRef.current = {}; // 2026-06-14 — drop per-swing trace cache on reset
    ballPathCacheRef.current = {};
    clubPathCacheRef.current = {};
    setBallPathPoints(null);
    setLiveDb(null);
    setMeteringActive(false);
    // Clear caches BEFORE resetting selection so no stale per-swing
    // analysis/tempo can be read for the new recording (audit #2).
    tempoCacheRef.current = {};
    analysisCacheRef.current = {};
    sessionRunRef.current += 1;          // segmentation audit #1 — a still-in-flight read from the
    analysisInflightRef.current = {};    // prior session drops its result instead of poisoning this one
    pipelineNarratedRef.current = false; // re-arm per-swing narration for the next session
    pipelineAbortRef.current = true;     // abort any still-running narration from the prior session
    pipelineRunRef.current++;            // invalidate the prior pipeline run (cache-collision guard)
    void stopSpeaking().catch(() => undefined); // and silence its in-flight/queued TTS
    setSmartMotionRecording(false);      // not recording after a reset
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
  // 2026-06-11 (audit) — background-safe windowed analysis for ONE swing. Takes the
  // clip uri + segment EXPLICITLY so callers that don't yet have segments/clipUri in
  // state (the stop-time pipeline below) can drive it. Races a 30s watchdog, caches
  // by index, touches no display state. Shared by the on-demand reel AND the pipeline.
  const runWindowedAnalysis = useCallback(
    async (uri: string, seg: SwingSegment | undefined, idx: number): Promise<SwingAnalysis | null> => {
      if (!seg || !uri) return null;
      const cachedHit = analysisCacheRef.current[idx];
      if (cachedHit) return cachedHit;
      // 2026-07-08 (segmentation audit #8) — dedupe concurrent launches for the same
      // swing: the pipeline head-start and the prefetch could both fire idx 1 before
      // either cached, producing TWO reads whose later resolve overwrote the first —
      // the narrated fault could differ from the card shown on tap.
      const inflight = analysisInflightRef.current[idx];
      if (inflight) return inflight;
      // 2026-07-08 (segmentation audit #1 — cross-session cache poisoning) — an
      // in-flight read can outlive reset() ("go again" mid-analysis) and used to write
      // its result into the NEXT session's cache slot: the new set's swing 3 showed +
      // narrated the OLD clip's analysis. Capture the session run at entry; a stale
      // resolve is dropped (same pattern as pipelineRunRef).
      const myRun = sessionRunRef.current;
      const job = (async (): Promise<SwingAnalysis | null> => {
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
          analyzeSwing(uri, {
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
            setTimeout(() => resolve({ kind: 'error', message: 'Analysis timed out' }), 60000),
          ),
        ]);
        if (r.kind === 'ok') {
          if (sessionRunRef.current !== myRun) return null; // stale session — drop, don't poison
          analysisCacheRef.current[idx] = r.analysis;
          return r.analysis;
        }
      } catch { /* non-fatal */ }
      return null;
      })();
      analysisInflightRef.current[idx] = job;
      try {
        return await job;
      } finally {
        delete analysisInflightRef.current[idx];
      }
    },
    [angle, caddiePersonality, language, profile.handicap, profile.dominantMiss, profile.firstName, swingerHandedness],
  );

  const analyzeSwingForIndex = useCallback(
    async (idx: number): Promise<SwingAnalysis | null> =>
      runWindowedAnalysis(clipUri ?? '', segments[idx], idx),
    [runWindowedAnalysis, clipUri, segments],
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

  // 2026-06-15 (Tim — "by the time I stop the 3rd swing, it's reading the first;
  // then it tells me the second... consecutively") — PIPELINED per-swing narration.
  // True during-capture analysis isn't possible (one continuous recording file
  // isn't readable until stop), but at stop we run the swings with a ONE-AHEAD
  // prefetch — swing N+1 computes WHILE swing N is being spoken — and narrate them
  // IN ORDER. Swing 0's read comes from runAnalysis (the visible review); we reuse
  // its cache rather than re-analyze. Bounded to ~2 concurrent reads, matching the
  // reel's rate-limit posture. Fire-and-forget; only runs for multi-swing sessions.
  const pipelineNarrate = useCallback(
    async (uri: string, segs: SwingSegment[]) => {
      if (segs.length < 2 || pipelineNarratedRef.current) return;
      pipelineNarratedRef.current = true;
      pipelineAbortRef.current = false; // fresh narration for this session
      // 2026-06-16 — per-run cancellation token. A NEW session (reset/unmount) bumps
      // pipelineRunRef, so a stale in-flight pipeline bails even if a newer pipeline
      // flipped pipelineAbortRef back to false — closes the cache-collision race where
      // an old narration could read a NEW session's analysisCacheRef and speak the
      // wrong swing. cancelled() is the single source of truth for "still mine".
      const myRun = ++pipelineRunRef.current;
      const cancelled = () => pipelineAbortRef.current || myRun !== pipelineRunRef.current;
      const st = useSettingsStore.getState();
      const speakLine = async (line: string) => {
        if (!st.voiceEnabled || cancelled()) return;
        try {
          await configureAudioForSpeech();
          if (cancelled()) return; // bailed while configuring audio
          await speak(line, st.voiceGender, st.language, getApiBaseUrl(), { userInitiated: true });
        } catch { /* speech non-fatal */ }
      };
      // Poll swing 0's cache — runAnalysis (the visible review) populates it.
      const waitForCache0 = async (): Promise<SwingAnalysis | null> => {
        const deadline = Date.now() + 32_000;
        while (Date.now() < deadline) {
          if (cancelled()) return null; // new session / left screen — abandon the poll now
          const c = analysisCacheRef.current[0];
          if (c) return c;
          await new Promise((r) => setTimeout(r, 200));
        }
        return analysisCacheRef.current[0] ?? null;
      };
      const jobs: (Promise<SwingAnalysis | null> | undefined)[] = new Array(segs.length);
      jobs[0] = waitForCache0();
      if (segs.length > 1) jobs[1] = runWindowedAnalysis(uri, segs[1], 1); // head start
      const resolvedAnalyses: (SwingAnalysis | null)[] = [];
      for (let idx = 0; idx < segs.length; idx++) {
        if (cancelled()) return; // left the screen / new session — stop narrating
        // Kick off the swing TWO ahead while we wait on / narrate this one, so the
        // next swing's read is always in flight before we need it.
        const ahead = idx + 2;
        if (ahead < segs.length && !jobs[ahead]) jobs[ahead] = runWindowedAnalysis(uri, segs[ahead], ahead);
        const a = (await jobs[idx]) ?? null;
        if (cancelled()) return;
        resolvedAnalyses.push(a);
        if (!a) continue;
        await speakLine(swingNarrationLine(idx + 1, a));
      }
      // 2026-07-07 (F2) — the SAVED report was persisted after SWING 0 only. Now that
      // the whole reel is analyzed, re-classify over the COMPLETE cache and re-persist
      // so the library report + the Drill Check that reads it reflect the WORST swing
      // (e.g. the chunk on swing 3), not just the first one.
      if (!cancelled()) {
        try {
          const sessionId = ingestedSessionIdRef.current;
          if (sessionId) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { classifySession } = require('../../services/swingIssueClassifier') as typeof import('../../services/swingIssueClassifier');
            const resolved = Object.entries(analysisCacheRef.current)
              .filter(([, an]) => !!an)
              .map(([idx2, an]) => ({ swing_id: `smresolve-swing-${idx2}`, analysis: an as SwingAnalysis }));
            const rolled = resolved.length ? classifySession(resolved) : null;
            // Session-level contact: ANY swing the model flagged as a mishit → not clean.
            let sessionMishit: SmContact['reportedMishit'] = null;
            for (const an of Object.values(analysisCacheRef.current)) {
              const m = deriveContact(an ?? null).reportedMishit;
              if (m) { sessionMishit = m; break; }
            }
            const primaryIssue = contactIssue({ ballLaunched: null, reportedMishit: sessionMishit }) ?? rolled;
            if (primaryIssue) {
              useCageStore.getState().setSessionAnalysis(sessionId, primaryIssue, null);
              useCageStore.getState().setSessionAnalysisStatus(sessionId, 'ok');
            }
          }
        } catch { /* re-persist is best-effort */ }
      }
      // Session complete — let Kevin offer a next drill or close.
      if (!cancelled() && st.voiceEnabled) {
        const issues = resolvedAnalyses
          .filter((a): a is SwingAnalysis => a != null)
          .map((a) => { const v = deriveVerdict(a, false, deriveContact(a)); return isCleanVerdict(v) ? null : v.text.toLowerCase(); })
          .filter((t): t is string => !!t);
        const clean = resolvedAnalyses.length - issues.length;
        const summary = issues.length === 0
          ? `${segs.length} swings — motion looked clean across the board. Tell me how they felt and I'll confirm the strike.`
          : `${segs.length} swings — ${clean} clean, ${issues.length} with ${issues[0]}${issues.length > 1 ? ' and others' : ''}.`;
        setScreenContext({ screen: 'Smart Motion — just finished a session', focus: SESSION_DONE_FOCUS });
        emitSmartMotionVoiceEvent({ type: 'session_complete', swingCount: segs.length, summary });
      }
    },
    [runWindowedAnalysis],
  );

  const selectSwing = useCallback(
    async (idx: number) => {
      const seg = segments[idx];
      if (!seg) return;
      setSelectedSwing(idx);
      // 2026-06-14 (Tim) — AWAIT the seek before playing. setPositionAsync +
      // playAsync fired back-to-back race: play often started before the seek
      // landed, so the clip played from its current spot (frame 0 = the setup,
      // "bending to place the ball") instead of the swing. Await fixes that.
      const v = videoRef.current;
      if (v) {
        try { await v.setPositionAsync(seg.startMs); } catch { /* ignore */ }
        void v.playAsync().catch(() => undefined);
      }
      setVideoPaused(false); // keep state in sync with the imperative play (avoid desync)

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
    // 2026-07-06 (voice-lifecycle audit #4) — a voice "record my swing" dispatches the
    // record tool BEFORE the caddie speaks its reply, so the reply audio landed IN the
    // swing clip's audio track (polluting acoustic strike detection) and the TTS
    // audio-session flip mid-recordAsync risked killing the capture's audio on iOS.
    // Silence the caddie the moment ANY entry path starts a recording.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await (require('../../services/voiceService') as typeof import('../../services/voiceService')).stopSpeaking();
    } catch { /* best-effort — never block the capture */ }
    // 2026-06-12 (analysis speed) — warm the fault-read Lambda the MOMENT recording starts.
    // The open record window (up to 60s) is free warm time, so the first swing's read lands
    // on a HOT Lambda instead of eating a cold start → no more cold-first-swing NO READ.
    // The mount warmup often loses the race (user records within a few seconds of opening).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    try { require('../../services/swingAnalysisWarmup').prewarmSwingAnalysis({ force: true }); } catch { /* non-fatal */ }
    setBallSpeed(null);
    setBallDeparture(null);
    ballDepartureCacheRef.current = {}; // 2026-06-14 — new recording → drop per-swing trace cache
    ballPathCacheRef.current = {};
    clubPathCacheRef.current = {};
    setBallPathPoints(null);
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
    setSmartMotionRecording(true); // mic is now the camera's — taps mean STOP, not listen

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
        // 2026-06-14 (audit — perf) — the meter callback fires ~every 50ms; piping
        // each tick straight into setLiveDb re-rendered the whole (~3300-line)
        // component up to 20×/s. Throttle the React state to ~120ms (still smooth
        // for the meter bar) — detection is unaffected (it runs inside
        // startMeteredRecording, not off this display state).
        meteringRef.current = await startMeteredRecording((s) => {
          const now = Date.now();
          if (now - lastDbSetAtRef.current >= 120) {
            lastDbSetAtRef.current = now;
            setLiveDb(s.dB);
          }
        });
      } catch {
        meteringRef.current = null;
      }
    } else {
      meteringRef.current = null;
    }
    // Honest "Listening" state: only when a mic track is actually running.
    setMeteringActive(meteringRef.current != null);

    // Assign the camera promise BEFORE arming timers (avoid the stop race).
    try {
      recordingPromiseRef.current = cameraRef.current.recordAsync({ maxDuration: maxSec }) as Promise<{ uri: string } | undefined>;
    } catch (e) {
      recordingPromiseRef.current = null;
      stoppingRef.current = false;
      void meteringRef.current?.cancel().catch(() => undefined);
      meteringRef.current = null;
      setSmartMotionRecording(false);
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
    setSmartMotionRecording(false); // mic released → voice/listen takes over from here
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
    // 2026-06-12 (analysis speed) — the metered recorder already knows the clip duration;
    // capture it here so the fallback/analysis never re-probes it (probeDurationMs is a
    // ≤8s Audio.Sound + thumbnail load that was running up to 3× per swing).
    let meteredDurationMs: number | null = null;
    try {
      if (meteringRef.current) {
        // 2026-07-07 (F1 — cage record could strand on "Analyzing…" forever) — the only
        // UNBOUNDED await in the stop→analyze handoff. expo-av's stopAndUnloadAsync can
        // hang (worse here because the audio session is flipped for TTS around recording);
        // a hang meant the catch never fired and phase never reached 'review'. Race it
        // against an 8s fallback — on timeout we lose only the ACOUSTIC read and degrade
        // to whole-clip video analysis, never a permanent spinner.
        const stopP = meteringRef.current.stop();
        const { samples, uri, durationMs } = await Promise.race([
          stopP,
          new Promise<Awaited<typeof stopP>>((resolve) =>
            setTimeout(() => resolve({ samples: [], uri: null, durationMs: 0 } as Awaited<typeof stopP>), 8000)),
        ]);
        meteringRef.current = null;
        meteredDurationMs = durationMs && durationMs > 0 ? durationMs : null;
        audioUriRef.current = uri;
        const meterMode = useRoundStore.getState().isRoundActive
          ? 'course'
          : useSettingsStore.getState().environmentMode;
        // RANGE tolerates a louder floor (vision confirms every candidate, so a
        // noisy floor can't fabricate a swing); cage keeps the strict default.
        // CHIP sensitivity drops the threshold so a quiet pitch/chip still registers.
        const chipOn = useSettingsStore.getState().chipSensitivity;
        // 2026-07-08 (cage audit #1) — only apply a calibration whose env class matches
        // where we are now (indoor cage≈backyard vs outdoor range/course); else fall
        // back to the constant so a mismatched (quiet-room) calibration can't zero out
        // detection at a loud venue. Chip sensitivity still wins when on.
        const envClass = (e: string | null | undefined): string | null =>
          !e ? null : (e === 'range' || e === 'course') ? 'outdoor' : 'indoor';
        const calOk = !appliedCalibration?.env || envClass(appliedCalibration.env) === envClass(meterMode);
        const thresholdDb = chipOn ? CHIP_STRIKE_THRESHOLD_DB : (calOk ? appliedCalibration?.transientThresholdDb : undefined);
        let res = detectStrikes(samples, {
          thresholdDb,
          noisyFloorDb: meterMode === 'range' ? 0 : undefined,
        });
        // 2026-06-14 (Tim — over-strict gate / multi-swing reliability) — a loud bay
        // makes cage detection BAIL to zero strikes, so a 3-5 swing recording collapses
        // to a single whole-clip "1 of 1". The relative floor+threshold (a strike must
        // be ~30 dB ABOVE the floor) still gates fabrication, so on a noisy-floor bail
        // re-run cage detection with the absolute floor gate disabled (degrade + flag)
        // rather than losing every swing. [[overstrict-gate-lens]]
        if (res.kind === 'noisy-environment' && meterMode === 'cage') {
          console.log('[smartmotion] cage noisy floor', res.floorDb, '— degrading to relative-threshold detection (keep swings)');
          res = detectStrikes(samples, { thresholdDb, noisyFloorDb: Number.POSITIVE_INFINITY });
        }
        if (res.kind === 'ok' && res.strikes.length > 0) {
          acousticStrikes = res.strikes;
          // CAGE: trust acoustics as the final segmentation here. RANGE waits for
          // video confirmation (correlateStrikesWithVideo) in the clip branch.
          if (meterMode === 'cage') {
            // 2026-07-08 (segmentation audit #3) — drop rebound thuds (net/floor
            // 0.5–2.5s after the true strike) so a 3-swing set never reads as 4.
            const real = filterReboundStrikes(res.strikes);
            detectedSegments = segmentsFromStrikes(real, durationMs);
            firstStrikeMs = real[0]?.timeMs ?? null;
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

    // Best-effort ball speed for the first swing. 2026-06-12 (analysis speed) —
    // FIRE-AND-FORGET: the fault-read doesn't depend on ball speed, so don't make the
    // user wait 1-3s for this network call before the analysis even starts. It resolves
    // in parallel and fills the badge whenever it lands.
    if (audioUriRef.current && firstStrikeMs != null) {
      void detectBallSpeed({
        audioUri: audioUriRef.current,
        impact_ms: firstStrikeMs,
        club: clubIdToServerKey(clubRef.current),
      }).then((speed) => { if (speed) setBallSpeed(speed); }).catch(() => { /* non-fatal */ });
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
          // 2026-06-13 (analysis speed) — reuse the duration metered FREE during
          // recording; only probe as a last resort. The probe is an ≤8s Audio.Sound +
          // thumbnail call, and RANGE was paying it on every swing despite having the
          // number already (the cage branch below already reuses meteredDurationMs).
          const durMs = meteredDurationMs ?? await pose.probeDurationMs(recorded.uri).catch(() => RANGE_RECORDING_MAX_SECONDS * 1000);
          const swings = await pose.locateSwings(recorded.uri, durMs);
          if (swings.length > 0 && acousticStrikes.length > 0) {
            segsForAnalysis = correlateStrikesWithVideo(acousticStrikes, swings, durMs);
          } else if (swings.length > 0) {
            segsForAnalysis = segmentsFromVideoSwings(swings, durMs); // nothing heard cleanly
          } else if (acousticStrikes.length > 0) {
            // vision empty — best effort, rebounds filtered (segmentation audit #3)
            segsForAnalysis = segmentsFromStrikes(filterReboundStrikes(acousticStrikes), durMs);
          }
          if (segsForAnalysis.length > 0) {
            setSegments(segsForAnalysis);
            setSelectedSwing(0);
            // Audit fix (2026-06-11) — ALWAYS seed the first-strike anchor from the
            // first segment (its strikeMs is always populated, acoustic or video time)
            // so camera strike-verification still runs for a VIDEO-ONLY first swing.
            // Only the ball-SPEED call needs a real acoustic strike. video-located
            // segments carry peakDb EXACTLY 0; an acoustic strike carries the real
            // (non-zero) reading — test `!== 0`, correct whatever the metering sign.
            // [2026-06-12 bug fix: was `> 0`, never true for a negative-dBFS strike, so
            // acoustic ball speed never fired.]
            const s0 = segsForAnalysis[0];
            if (s0) {
              firstStrikeMs = s0.strikeMs;
              firstStrikeMsRef.current = s0.strikeMs;
            }
            if (s0 && (s0.peakDb ?? 0) !== 0) {
              if (audioUriRef.current) {
                // 4 s cap so ball-speed never delays the runAnalysis call.
                // Race resolves null on timeout; .catch handles any throw.
                const speed = await Promise.race([
                  detectBallSpeed({
                    audioUri: audioUriRef.current,
                    impact_ms: s0.strikeMs,
                    club: clubIdToServerKey(clubRef.current),
                  }),
                  new Promise<null>(resolve => setTimeout(() => resolve(null), 4_000)),
                ]).catch(() => null);
                if (speed) setBallSpeed(speed);
              }
            }
          }
        } catch (e) {
          console.log('[smartmotion] range correlation failed (non-fatal):', e);
        }
      } else if (stopMode === 'cage' && detectedSegments.length <= 1) {
        try {
          const pose = await import('../../services/poseDetection');
          // Use the metered duration (no re-probe); only probe as a last resort.
          const durMs = meteredDurationMs ?? await pose.probeDurationMs(recorded.uri).catch(() => RANGE_RECORDING_MAX_SECONDS * 1000);
          // 2026-06-12 (analysis speed) — locateSwings is a cold-Lambda network call
          // (≤30s). It's only worth it on a LONG clip where the swing's position is
          // genuinely unknown. A SHORT cage clip basically IS the swing — skip the locate
          // and let the synthesized whole-clip window (below) drive a fast BOUNDED read.
          // This is the single biggest first-try-NO-READ fix: a missed strike used to
          // collapse the fast path into locateSwings + an unbounded re-locate (30-70s).
          const worthVideo = durMs > 12_000 && (detectedSegments.length === 0 || durMs > 20_000);
          if (worthVideo) {
            const swings = await pose.locateSwings(recorded.uri, durMs);
            // Use the video segments only if they found MORE swings than acoustics
            // — never reduce the count, just recover missed ones.
            if (swings.length > segsForAnalysis.length) {
              // 2026-07-08 (segmentation audit #2) — KEEP the real acoustic anchor(s).
              // Plain segmentsFromVideoSwings stamps every segment peakDb:0, which
              // threw away the precisely-heard strike → tempo + acoustic ball-speed/
              // departure went dark for EVERY swing including the clean one. The range
              // branch already merges via correlateStrikesWithVideo — do the same here
              // whenever we actually heard something.
              segsForAnalysis = acousticStrikes.length > 0
                ? correlateStrikesWithVideo(acousticStrikes, swings, durMs)
                : segmentsFromVideoSwings(swings, durMs);
              setSegments(segsForAnalysis);
              setSelectedSwing(0);
            }
          }
        } catch (e) {
          console.log('[smartmotion] cage video fallback failed (non-fatal):', e);
        }
      }
      // 2026-06-12 (analysis speed) — NEVER send a short clip down the UNBOUNDED analysis
      // path (which re-probes the duration AND runs locateSwingWindow, another ≤25s cold
      // call → 30-70s → watchdog → NO READ → forced re-record). If no real segment was
      // found, synthesize a bounded WHOLE-CLIP window so analyzeSwing goes bounded + fast;
      // extractKeyFrames samples across the short clip, which is the swing. peakDb 0 keeps
      // tempo/departure honestly off (no acoustic anchor), but the fault read lands fast.
      let firstSeg = segsForAnalysis[0];
      if (!firstSeg) {
        const durMs = meteredDurationMs ?? 0;
        // 2026-06-22 — removed `durMs <= 12_000` cap. The old cap meant any
        // clip >12 s where both acoustic AND vision locate failed received NO
        // segment, forcing the unbounded analysis path (70 s watchdog). For
        // a 19 s RANGE clip with a cold Lambda (locateSwings 502 at 13 s),
        // the unbounded path timed out → NO READ. Synthesizing a whole-clip
        // bounded window is ALWAYS better than going unbounded: the 30 s
        // watchdog is sufficient, and extractKeyFrames samples proportionally.
        if (durMs > 0) {
          firstSeg = { index: 1, strikeMs: Math.round(durMs * 0.6), startMs: 0, endMs: durMs, confidence: 'low', peakDb: 0, confirmed: false };
          // 2026-06-14 (audit fix) — surface the synthesized whole-clip segment to
          // state too, so the review's per-swing effects see segments[0] instead of
          // [] (otherwise tempo/ball-departure silently skipped this swing). It's
          // peakDb:0 so tempo/departure stay honestly off, but the segment exists.
          segsForAnalysis = [firstSeg];
          setSegments(segsForAnalysis);
          setSelectedSwing(0);
        }
      }
      // 2026-06-16 (Tim — shot-rest 1/3/5) — cap the session to the chosen swing
      // count (a drill's own count wins). Applied HERE so everything downstream —
      // segments state, the "Got it — N" count, the pipeline narration, the rep
      // credit, and the library carve — all see exactly N. OPEN (null) = no cap.
      const swingCap = drillShotCount ?? targetSwingsRef.current;
      if (swingCap && segsForAnalysis.length > swingCap) {
        segsForAnalysis = segsForAnalysis.slice(0, swingCap);
        setSegments(segsForAnalysis);
        setSelectedSwing(0);
      }
      // Sync the ref SYNCHRONOUSLY (the state-mirror effect hasn't run yet this tick) so
      // runAnalysis's multi-swing carve sees the final segment set, not a stale one.
      segmentsRef.current = segsForAnalysis;
      // 2026-06-16 (Tim — "I swung clubs in practice, got no credit") — credit
      // per-club practice REPS for this capture (honest volume, not a distance).
      // Only when the club is actually tagged (don't credit 'unknown'). ClubId and
      // the bag's ClubName align except DR→Driver.
      try {
        const cid = clubRef.current;
        if (cid && cid !== 'unknown') {
          const cn = (cid === 'DR' ? 'Driver' : cid) as ClubName;
          if ((CLUB_ORDER as readonly string[]).includes(cn)) {
            useClubStatsStore.getState().addReps(cn, segsForAnalysis.length || 1);
          }
        }
      } catch { /* non-fatal */ }
      // 2026-06-15 (Tim) — audible capture confirmation. After the strike session
      // CLOSES (recording stopped + segmented) the caddie says it got the swing, so
      // the user KNOWS it captured. Fired POST-stop so the TTS can't be metered as a
      // false strike. Honest count — also surfaces a mis-count audibly (3 vs 10)
      // while testing. Gated on voiceEnabled inside speak(); fire-and-forget.
      try {
        const n = segsForAnalysis.length || 1;
        const st = useSettingsStore.getState();
        void speak(
          n === 1 ? 'Got your swing.' : `Got it — ${n} swings.`,
          st.voiceGender, st.language, getApiBaseUrl(), { userInitiated: true },
        ).catch(() => undefined);
      } catch { /* non-fatal */ }
      // Analyze the FIRST detected swing windowed to its segment; other
      // swings analyze on-demand when selected in the reel.
      void runAnalysis(recorded.uri, firstSeg);
      // 2026-06-15 (Tim) — multi-swing PIPELINE: narrate each swing in order with a
      // one-ahead head start (swing N+1 reads while swing N is spoken). Skips putts
      // (a "Swing N, fault" read doesn't fit a putt). Single swing → no pipeline.
      if (segsForAnalysis.length > 1 && !puttModeRef.current) {
        void pipelineNarrate(recorded.uri, segsForAnalysis);
      } else if (segsForAnalysis.length === 1 && !puttModeRef.current) {
        // Single-swing session — pipeline doesn't run, so emit session_complete here
        // so subscribers (e.g. voice UI) receive the event.
        setScreenContext({ screen: 'Smart Motion — just finished a session', focus: SESSION_DONE_FOCUS });
        emitSmartMotionVoiceEvent({ type: 'session_complete', swingCount: 1, summary: '1 swing recorded.' });
      }
      // 2026-06-24 (Tim — camera-first Smart Tempo): the tempo-return now fires from
      // INSIDE runAnalysis (right after sessionId is assigned), so this side no longer
      // races ingestedSessionIdRef while it's transiently null. See runAnalysis.
    } catch (e) {
      recordingPromiseRef.current = null;
      stoppingRef.current = false;
      setAnalysisError(e instanceof Error ? e.message : String(e));
      // 2026-06-23 (smoke-test) — a segmentation throw used to drop to 'setup',
      // DISCARDING the just-recorded clip and forcing a full re-record. The clip is
      // already in state with a Re-analyze affordance, so land on 'review' instead.
      setPhase('review');
    }
  }, [runAnalysis, appliedCalibration, pipelineNarrate]);
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
        // 2026-07-01 (Tim — on-course "record this club": show the sole while recording so it
        // registers what you're about to use) — a confident camera recognition also REGISTERS
        // the club to the bag. Covers BOTH the guided scan and this voice/auto path.
        const newlyRegistered = !useClubBagStore.getState().clubs[res.club_id];
        try { useClubBagStore.getState().registerClub(res.club_id, { source: 'camera' }); } catch { /* non-fatal */ }
        // Manual/voice scan owns putt mode both ways; the SILENT auto scan only sets
        // it ADDITIVELY (a confident putter → putt mode) and never CLEARS a putt mode
        // the user set deliberately (audit 2026-06-11 — explicit per-recording intent).
        if (auto) { if (res.club_id === 'PT') setPuttMode(true); }
        else setPuttMode(res.club_id === 'PT');
        try {
          const s = useSettingsStore.getState();
          await configureAudioForSpeech();
          const ack = newlyRegistered ? `Got it — ${clubLabel(res.club_id)}. Added it to your bag.` : `Got it — ${clubLabel(res.club_id)}.`;
          await speak(ack, s.voiceGender, s.language, apiUrl, { userInitiated: true });
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

  // 2026-06-23 (Tim — guided Scan-club) — the manual path now shows a framing box +
  // a 3-2-1 hold so the SOLE is presented steadily, then captures a CRISP processed
  // frame (skipProcessing:false, higher quality) instead of the low-q immediate snap
  // that produced motion-blurred, unreadable frames on a quick pass. One steady frame
  // → club-recognition → auto-select. Falls back to the picker on a low-confidence read.
  const startClubScan = useCallback(async () => {
    if (scanningClub || clubScanActive) return;
    if (recordingPromiseRef.current || stoppingRef.current) return;
    setClubScanActive(true);
    try {
      // Countdown 3 → 2 → 1 (≈0.7s each) so the user can present + steady the sole.
      for (let n = 3; n >= 1; n--) {
        setClubScanCount(n);
        await new Promise((r) => setTimeout(r, 700));
      }
      setClubScanCount(0); // "Reading…"
      setScanningClub(true);
      const apiUrl = getApiBaseUrl();
      const pic = await cameraRef.current?.takePictureAsync?.({ base64: true, quality: 0.75, skipProcessing: false });
      const b64 = pic?.base64;
      if (!apiUrl || !b64) { setClubMenuOpen(true); return; }
      const res = await recognizeClubFromBase64(b64, apiUrl);
      if (res.kind === 'ok' && res.club_id !== 'unknown' && res.confidence !== 'low') {
        setClub(res.club_id);
        setPuttMode(res.club_id === 'PT');
        // 2026-07-01 (Tim) — a scanned club also REGISTERS to the bag, so "look at my club /
        // add this club" builds the player's real roster the caddie recommends from.
        const alreadyInBag = !!useClubBagStore.getState().clubs[res.club_id];
        try { useClubBagStore.getState().registerClub(res.club_id, { source: 'camera' }); } catch { /* non-fatal */ }
        try {
          const s = useSettingsStore.getState();
          await configureAudioForSpeech();
          const ack = alreadyInBag
            ? `Got it — ${clubLabel(res.club_id)}.`
            : `Got it — ${clubLabel(res.club_id)}. Added it to your bag.`;
          await speak(ack, s.voiceGender, s.language, apiUrl, { userInitiated: true });
        } catch { /* speech non-fatal */ }
      } else {
        setClubMenuOpen(true); // couldn't confirm — let the user pick/correct
      }
    } catch (e) {
      console.log('[smartmotion] guided club scan failed:', e);
      setClubMenuOpen(true);
    } finally {
      setScanningClub(false);
      setClubScanActive(false);
      setClubScanCount(0);
    }
  }, [scanningClub, clubScanActive, setClub]);

  // 2026-07-01 (Tim — "look at my club / register my club / add this club" from anywhere) — when
  // navigated here with ?autoScan=1 (a voice club-register command routed through openToolHandler),
  // fire the GUIDED scan (3-2-1 hold → recognize → registerClub → "added to your bag") once the
  // camera is up in setup. One-shot; yields to an in-flight record/scan so it never races the
  // camera. Mirrors the autoRecord one-shot above.
  const pendingScanRef = useRef(autoScan === '1');
  useEffect(() => {
    if (phase !== 'setup' || !pendingScanRef.current || scanningClub || clubScanActive || pendingStartRef.current) return;
    pendingScanRef.current = false;
    const t = setTimeout(() => { void startClubScan(); }, 700);
    return () => clearTimeout(t);
  }, [phase, scanningClub, clubScanActive, startClubScan]);

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
  // Ref indirection: persistReviewToLibrary is defined below (it needs the full review
  // state); beginNextRecording only fires from user taps, long after both exist.
  const persistReviewRef = useRef<(navigate: boolean) => void>(() => {});
  const beginNextRecording = useCallback(() => {
    // 2026-06-29 (Tim) — the player chose to go again, so clear the post-session
    // "act on their answer" directive and restore the normal capture context.
    setScreenContext({
      screen: isDrill && typeof drillName === 'string' && drillName.trim() ? `the ${drillName.trim()} drill` : 'Smart Motion (recording swings)',
      focus: isDrill && typeof drillFocus === 'string' && drillFocus.trim() ? drillFocus.trim() : undefined,
      drillId: isDrill ? drillId : undefined,
    });
    if (phase === 'review') {
      // 2026-07-07 (Tim) — moving to a NEW set auto-saves the current one: the report,
      // notes, and swings flush to the Swing Library (with points) before the reset, so
      // going again never silently drops a set. Same core as the explicit Save badge.
      if (ingestedSessionIdRef.current) {
        try { persistReviewRef.current(false); } catch { /* non-fatal — session is already ingested */ }
      }
      pendingStartRef.current = true;
      reset(); // → setup; CameraView mounts; onCameraReady fires startRecording
    } else if (phase !== 'analyzing' && phase !== 'recording') {
      void startRecording();
    }
  }, [phase, reset, startRecording, isDrill, drillName, drillFocus, drillId]);

  // 2026-06-30 (Tim — "watch this swing" on the course should open STRAIGHT INTO recording).
  // When navigated here with ?autoRecord=1 (a voice "watch/record my swing" from the Caddie
  // tab or any screen), arm the recorder so the CameraView's onCameraReady auto-starts the
  // capture — no manual tap. Course mode is already forced by effectiveMode when a round is
  // active (isRoundActive ? 'course' : …), so on the course this opens the COURSE recording
  // interface, camera ready, rolling. One-shot on mount; absent param = normal manual open.
  useEffect(() => {
    if (autoRecord === '1') pendingStartRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-06-13 (Tim) — RE-ANALYZE the clip you already hit, instead of forcing a
  // re-record on a failed read. The clip is saved + persistent and analysis
  // failures are usually transient (cold endpoint, a missed locate), so re-running
  // on the SAME clip is quick and never wastes the swing. runAnalysis resets its
  // own state + races its watchdog/auto-retry; we just point it at the kept clip.
  const reanalyze = useCallback(() => {
    if (!clipUri || phase === 'analyzing') return;
    void runAnalysis(clipUri, segmentsRef.current[0]);
  }, [clipUri, phase, runAnalysis]);

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
  const togglePlay = useCallback(async () => {
    const next = !videoPaused;
    setVideoPaused(next);
    try {
      if (next) await videoRef.current?.pauseAsync();
      else await videoRef.current?.playAsync();
    } catch { /* ignore */ }
  }, [videoPaused]);
  // 2026-06-11 — was a dead-end toast (deferred-wiring placeholder). The session
  // already auto-ingests at record time and the analysis/biomech attach to it, so
  // the data IS persisted — but the user's explicit "Save" tap did nothing visible
  // and never took them to the library (Tim's "reports didn't save / didn't go to
  // the swing library"). Now it flushes any review-time coach note, confirms, and
  // navigates to the library so the saved swing is right there.
  // 2026-07-07 (Tim — "when I move to a new round of swings, the report + swings should
  // automatically go to the swing library") — the flush/credit core, shared by the
  // explicit Save badge (navigate: true) AND the go-again path (navigate: false), so a
  // new set NEVER silently drops the last set's report.
  const persistReviewToLibrary = useCallback((navigate: boolean) => {
    const sid = ingestedSessionIdRef.current;
    if (sid && coachNote.trim()) {
      try { useCageStore.getState().setSessionCoachNote(sid, coachNote); } catch { /* non-fatal */ }
    }
    // 2026-06-12 (persistence fix) — also persist the typed/dictated FEEL on Save.
    // Previously feel only reached the store via the separate "Run it by your caddie"
    // button, so a user who spoke/typed how it felt and tapped Save lost it.
    if (sid && feelText.trim()) {
      try { useCageStore.getState().setSessionFeel(sid, feelText.trim()); } catch { /* non-fatal */ }
    }
    // 2026-06-29 (Tim — "Save loses the report") — FLUSH the full in-memory review
    // report onto the session so the saved library swing mirrors SmartMotion: tempo,
    // biomechanics, and the shot-map snapshot. (Biomech also commits live from the
    // review effect; this is belt-and-braces in case the user saves the instant it lands.)
    if (sid) {
      try {
        const store = useCageStore.getState();
        if (biomech) store.setSessionBiomechanics(sid, biomech);
        if (estCarry != null || effortPct != null || ballTrace || cageCanvasFeet != null || tempo || biomech) {
          store.setSessionShotMap(sid, {
            estCarry: estCarry ?? null,
            effortPct: effortPct ?? null,
            trace: ballTrace ? { side: ballTrace.side, divergenceDeg: ballTrace.divergenceDeg } : null,
            canvasFeet: cageCanvasFeet ?? null,
            cameraBehindFeet: cameraBehindFeet ?? null,
            angle,
            club: club ?? null,
            tempo: tempo ? {
              ratio: tempo.ratio ?? null,
              backswingMs: tempo.backswingMs ?? null,
              downswingMs: tempo.downswingMs ?? null,
              sequencingScore: tempo.sequencingScore ?? null,
            } : null,
            bodyItems: bodyItems.map((b) => ({ key: b.key, label: b.label, tone: b.tone, icon: typeof b.icon === 'string' ? b.icon : undefined })),
          });
        }
      } catch { /* non-fatal */ }
    }
    // 2026-06-13 (Tim) — award CONSERVATIVE practice points for a completed drill
    // session (a captureKind:'drill' save). Surfaces on the dashboard; the data is
    // the practice side of the future practice→on-course-improvement ledger.
    let savedMsg = 'Saved to your Swing Library';
    if (sid) {
      try {
        const swings = Math.max(1, segmentsRef.current.length || drillShotCount || 1);
        // 2026-06-30 (audit M1 — double-count fix) — when an Open Range / Focus / SmartPlan
        // SESSION is active, this swing was already stamped into it (recordPracticeSwingIfActive)
        // and endSession() awards + records the session total. Awarding here too DOUBLE-counted
        // points and wrote a duplicate Practice History row. So only award per-save when NO
        // session is active — which still covers plain dock-it-say-go SmartMotion (the
        // 2026-06-29 "points disappeared" fix) and the drill flow (no session lifecycle).
        const sessionActive = usePracticeSessionStore.getState().active != null;
        if (!sessionActive) {
          if (isDrill && drillId) {
            // 2026-06-14 (Tim) — drill-launched: award + record under the drill's focus.
            const drillLabel = typeof drillName === 'string' && drillName.trim() ? drillName.trim() : null;
            const pts = usePracticePointsStore.getState().awardPracticePoints({ key: drillId, label: drillLabel, swings, now: Date.now() });
            usePracticeSessionStore.getState().recordCompletedSession({ kind: 'focus', focus: drillId, drillId, label: drillLabel, swingCount: swings, swingSamples: practiceSwingSamplesRef.current });
            savedMsg = `Saved · +${pts} practice points`;
          } else {
            // 2026-06-29 (Tim — "my points/sessions disappeared") — PLAIN SmartMotion
            // practice (the normal dock-it-say-go flow) now ALSO counts toward the
            // dashboard, not only drill-launched sessions. Keyed by club so per-club
            // practice accrues; honest generic label.
            const clubKey = club ? clubIdLabel(club) : (isPutt ? 'Putting' : 'Practice');
            const pts = usePracticePointsStore.getState().awardPracticePoints({ key: `smartmotion:${clubKey}`, label: clubKey, swings, now: Date.now() });
            usePracticeSessionStore.getState().recordCompletedSession({ kind: 'open_range', focus: clubKey, label: clubKey, swingCount: swings, swingSamples: practiceSwingSamplesRef.current });
            savedMsg = `Saved · +${pts} practice points`;
          }
        }
        // Mark credited so the one-time backfill never double-counts this session — whether
        // the points came from here (no session) or from endSession (session active).
        useCageStore.getState().setSessionCreditedPractice(sid, true);
        // 2026-07-07 — samples were credited with THIS set; clear so a go-again set
        // doesn't re-stamp them (the accumulate-across-loop design predates per-set saves).
        practiceSwingSamplesRef.current = [];
      } catch { /* non-fatal */ }
    }
    useToastStore.getState().show(navigate ? savedMsg : `${savedMsg} — fresh set rolling`);
    if (navigate) router.push('/swinglab/library' as never);
  }, [coachNote, feelText, router, isDrill, drillId, drillName, drillShotCount, tempo, biomech, estCarry, effortPct, ballTrace, cageCanvasFeet, cameraBehindFeet, angle, club, isPutt, bodyItems]);
  const confirmSave = useCallback(() => persistReviewToLibrary(true), [persistReviewToLibrary]);
  persistReviewRef.current = persistReviewToLibrary;
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
    if (cmd === 'scanClub') { void startClubScan(); return; }
    // Voice club change set putt mode (parity with the picker / club scan).
    if (cmd === 'puttOn') { setPuttMode(true); setAngle('down_the_line'); return; }
    if (cmd === 'puttOff') { setPuttMode(false); return; }
    // 2026-06-29 (Tim) — voice camera-angle set ("down the line" / "face on").
    if (cmd === 'angleDtl') { setAngle('down_the_line'); setPuttMode(false); showModeFade('DOWN THE LINE'); return; }
    if (cmd === 'angleFaceOn') { setAngle('face_on'); setPuttMode(false); showModeFade('FACE-ON'); return; }
    const recording = phase === 'recording';
    if (cmd === 'stop') { if (recording) void stopRecording(); return; }
    if (cmd === 'start') { if (!recording) beginNextRecording(); return; }
    // toggle
    if (recording) void stopRecording();
    else beginNextRecording();
  };
  useEffect(() => {
    setSmartMotionActive(true);
    const unsub = subscribeSmartMotionCommand((cmd) => {
      if (cmd === 'close') { router.back(); return; }
      recordCmdRef.current(cmd);
    });
    // Warm /api/swing-analysis the moment SmartMotion opens so the FIRST
    // recording's analysis hits a hot Lambda (no cold-start latency that could
    // push it toward the client timeout). Mirrors the upload/cage screens.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/swingAnalysisWarmup').prewarmSwingAnalysis({ force: true });
    } catch { /* non-fatal */ }
    // Voice layer: tell Kevin we're open so he can greet + ask what to work on.
    // When opened in DRILL mode, pass the drill so the greeting is drill-aware
    // (no redundant "what are we working on?" — the drill IS the answer).
    if (useSettingsStore.getState().voiceEnabled) {
      emitSmartMotionVoiceEvent(
        isDrill
          ? { type: 'entered', drillName: typeof drillName === 'string' ? drillName : undefined, drillFocus: typeof drillFocus === 'string' ? drillFocus : undefined }
          : { type: 'entered' },
      );
    }
    // Kevin → SmartMotion: apply drill config (club + shot count) from voice setup.
    const unsubDrill = subscribeDrillConfig((cfg) => {
      if (cfg.club) setClub(cfg.club as Parameters<typeof setClub>[0]);
      if (cfg.shotCount != null) {
        setTargetSwings(cfg.shotCount);
        targetSwingsRef.current = cfg.shotCount;
      }
    });
    return () => { setSmartMotionActive(false); unsub(); unsubDrill(); };
  }, [router, setClub]);

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
      <TactilePressable haptic="medium" onPress={() => void stopRecording()} style={[styles.toolBtnBare, styles.barBtnStop]} accessibilityRole="button" accessibilityLabel="Stop recording">
        <Image source={ICON_CTRL.stop} style={{ width: 56, height: 56 }} resizeMode="contain" />
      </TactilePressable>
    ) : isReview ? (
      // Review controls as matching green-circle badges (Tim's art): play/pause ·
      // slow-mo · save · delete · record-again. Each uses its own circle (no border);
      // slow-mo fills when slowed + keeps a tiny rate tag so ½/¼ stays visible.
      <View style={styles.barRow}>
        <TactilePressable onPress={() => void togglePlay()} style={styles.toolBtnBare} accessibilityRole="button" accessibilityLabel={videoPaused ? 'Play' : 'Pause'}>
          {videoPaused
            ? <Image source={ICON_CTRL.playpause} style={styles.toolIconFull} resizeMode="contain" />
            : <Ionicons name="pause" size={40} color="rgba(255,255,255,0.9)" />}
        </TactilePressable>
        <TactilePressable onPress={cycleSpeed} style={[styles.toolBtnBare, playbackRate < 1 && styles.toolBtnBareActive]} accessibilityRole="button" accessibilityLabel={`Playback speed ${playbackRate}x`}>
          <Image source={ICON_CTRL.slowmo} style={styles.toolIconFull} resizeMode="contain" />
          {playbackRate < 1 ? <Text style={styles.barRateTag}>{playbackRate === 0.5 ? '½' : '¼'}</Text> : null}
        </TactilePressable>
        {/* 2026-06-13 (Tim) — RE-ANALYZE the kept clip instead of re-recording.
            Glows on a NO-READ so the failure state points you here, not at a
            wasted re-swing. */}
        <TactilePressable onPress={reanalyze} disabled={!clipUri} style={[styles.toolBtnBare, !!analysisError && styles.toolBtnBareActive]} accessibilityRole="button" accessibilityLabel="Re-analyze this swing">
          <Ionicons name="refresh" size={24} color={analysisError ? colors.accent : '#fff'} />
        </TactilePressable>
        {/* 2026-07-07 (Tim — "still hard to start a new session") — the two decisions
            that matter get NAMED: SAVE and NEW SET. New Set auto-saves the current set
            first (persistReviewToLibrary in beginNextRecording), so it's one obvious
            tap to keep rolling without losing anything. */}
        <View style={styles.ctrlLabeled}>
          <TactilePressable onPress={confirmSave} style={styles.toolBtnBare} accessibilityRole="button" accessibilityLabel="Save to library">
            <Image source={ICON_CTRL.save} style={styles.toolIconFull} resizeMode="contain" />
          </TactilePressable>
          <Text style={styles.ctrlLabelText}>SAVE</Text>
        </View>
        <TactilePressable onPress={discardSwing} style={styles.toolBtnBare} accessibilityRole="button" accessibilityLabel="Delete swing">
          <Image source={ICON_CTRL.delete} style={styles.toolIconFull} resizeMode="contain" />
        </TactilePressable>
        <View style={styles.ctrlLabeled}>
          <TactilePressable onPress={() => beginNextRecording()} style={styles.toolBtnBare} accessibilityRole="button" accessibilityLabel="New set — saves this one and records again">
            <Image source={ICON_CTRL.record} style={styles.toolIconFull} resizeMode="contain" />
          </TactilePressable>
          <Text style={[styles.ctrlLabelText, { color: '#88F700' }]}>NEW SET</Text>
        </View>
      </View>
    ) : phase === 'setup' ? (
      <TactilePressable haptic="medium" onPress={() => void startRecording()} style={[styles.toolBtnBare, styles.barBtnRecord]} accessibilityRole="button" accessibilityLabel="Record">
        <Image source={ICON_CTRL.record} style={{ width: 56, height: 56 }} resizeMode="contain" />
      </TactilePressable>
    ) : (
      <View style={styles.barBtn} />
    );

  // ── pause / scrub to a swing position (skeleton attached) ──
  const seekToPosition = async (pos: NonNullable<PoseFrame['position']>) => {
    const f = poseFrames?.find((p) => p.position === pos);
    if (f) {
      const v = videoRef.current;
      // 2026-06-14 (Tim) — pause FIRST, then await the seek, so the frame lands
      // and holds on the requested phase (un-awaited seek+pause raced: pause could
      // fire before the seek, drifting off the phase frame).
      try { await v?.pauseAsync(); } catch { /* ignore */ }
      try { await v?.setPositionAsync(f.timestampMs); } catch { /* ignore */ }
      // keep declarative state in sync with the imperative pause, or shouldPlay
      // desyncs and the next Play tap becomes a no-op (the "won't play" bug).
      setVideoPaused(true);
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
  // Detected swing phases as scrubber ticks (so you can scrub BY time point).
  const scrubMoments: ScrubMoment[] = poseReady
    ? P_SCRUB
        .map((p) => {
          const f = poseFrames?.find((x) => x.position === p.key);
          return f ? { ms: f.timestampMs, label: p.label } : null;
        })
        .filter((m): m is ScrubMoment => m != null)
    : [];
  const skeletonRow =
    isReview ? (
      <View style={styles.skelRow}>
        <TactilePressable
          onPress={() => setShowSkeleton((v) => !v)}
          style={[styles.skelToggle, { borderColor: showSkeleton ? colors.accent : 'rgba(255,255,255,0.3)', backgroundColor: showSkeleton ? colors.accent_muted : 'rgba(0,0,0,0.4)' }]}
        >
          <Ionicons name="body-outline" size={13} color={showSkeleton ? colors.accent : '#fff'} />
          <Text style={[styles.skelToggleText, { color: showSkeleton ? colors.accent : '#fff' }]}>
            {showSkeleton ? (poseReady ? 'Motion ✓' : 'Reading motion…') : 'Motion'}
          </Text>
        </TactilePressable>
        {showSkeleton && poseReady ? P_SCRUB.map((p) => (
          <TactilePressable key={p.key} onPress={() => void seekToPosition(p.key)} style={styles.scrubChip}>
            <Text style={styles.scrubChipText}>{p.label}</Text>
          </TactilePressable>
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
            // 2026-07-02 (Tim — skeleton lags/steps behind the motion) — report playback time ~25x/s
            // so the pose overlay tracks near frame-rate. 2026-07-04 (elite-clean audit) —
            // CONDITIONAL: 25x/s only while the Motion overlay is ON (it's the only consumer
            // that needs frame-rate position). Overlay off → 4x/s, plenty for the scrubber,
            // so the review loop doesn't re-render the whole screen 25x/s for nothing
            // (restores the perf property the old showSkeleton setState gate provided).
            progressUpdateIntervalMillis={showSkeleton ? 40 : 250}
            // 2026-06-09 — Mute the review loop. The captured clip's audio
            // (e.g. a TV in the room) replaying on loop reads as "audio
            // feedback"; it adds nothing to silent skeleton/speed analysis.
            isMuted
            useNativeControls={false}
            onLoad={async (s) => {
              if ('durationMillis' in s && s.durationMillis) setVideoDurationMs(s.durationMillis);
              const v = videoRef.current;
              if (!v) return;
              // 2026-06-14 (Tim) — start at the SELECTED swing's window, not frame 0.
              // Frame 0 is usually the pre-swing setup ("bending to place the ball")
              // the user saw replay; seek to the swing first so review opens on the
              // actual swing. Awaited so the kick-play below starts at the swing.
              // Read the selection via the ref (this callback closure is captured on
              // mount; selectedSwing in scope would be stale — see the loop below).
              const seg = segments[selectedSwingRef.current];
              if (seg && seg.startMs > 0) { try { await v.setPositionAsync(seg.startMs); } catch { /* ignore */ } }
              // expo-av often ignores the shouldPlay PROP on first load, leaving the
              // clip frozen; kick playback explicitly.
              if (!videoPaused) v.playAsync().catch(() => undefined);
            }}
            onPlaybackStatusUpdate={(s) => {
              // Track position ALWAYS (not just when the motion overlay is on) so the
              // review scrubber can show + seek by time even on a clean video.
              if ('positionMillis' in s && typeof s.positionMillis === 'number') setPlaybackMs(s.positionMillis);
              // 2026-06-14 (Tim) — WINDOW the loop to the selected swing so it stops
              // replaying the whole clip (the setup the user reported). isLooping loops
              // the entire file; when this swing is a real sub-window (endMs < clip end)
              // we re-seek to its start once playback runs past endMs. The whole-clip
              // synthetic segment has endMs ≈ duration, so this is a no-op there.
              if ('positionMillis' in s && typeof s.positionMillis === 'number' && !videoPaused) {
                // 2026-06-14 (audit) — read the LIVE selection via the ref; the stale
                // closure value made the loop briefly re-seek to the OLD swing when
                // tapping a reel chip for an earlier-in-clip swing.
                const seg = segments[selectedSwingRef.current];
                const dur = ('durationMillis' in s && s.durationMillis) ? s.durationMillis : 0;
                const windowed = seg && seg.endMs > seg.startMs && (dur === 0 || seg.endMs < dur - 250);
                if (windowed && s.positionMillis >= seg.endMs && !loopSeekGuardRef.current) {
                  loopSeekGuardRef.current = true;
                  void videoRef.current?.setPositionAsync(seg.startMs)
                    .catch(() => undefined)
                    .finally(() => { loopSeekGuardRef.current = false; });
                }
              }
            }}
            onError={(e) => {
              // Surface video load failures so "black screen / won't play" is
              // diagnosable in logcat instead of silently swallowed.
              console.log('[smartmotion] video load error:', JSON.stringify(e));
              setAnalysisError('Video failed to load — try re-recording');
            }}
          />
        ) : (
          // 2026-06-09 — `mute` disables the camera's own audio track. We run a
          // SEPARATE Audio.Recording for acoustic strike metering; on iOS the
          // audio session is a singleton, so two concurrent recorders can
          // collide and silently kill metering (→ no strikes/segments/tempo).
          // We never use the clip's audio (playback is muted), so muting the
          // camera is lossless and removes the contention.
          // SmartTrace migration: behind USE_VISION_CAMERA (default OFF, native
          // build only) the swing path records via react-native-vision-camera at a
          // high frame rate for a dense ball-departure launch window. The vision
          // component mimics CameraView's recordAsync()/stopRecording() ref API, so
          // every cameraRef call below works unchanged; it records video-only (the
          // acoustic Audio.Recording owns the mic). takePictureAsync (ball-area
          // auto-snapshot) is absent on the vision handle → those `?.` calls no-op
          // and ball-area falls back to manual anchoring until the vision photo path
          // lands (Stage 1 follow-up). Default OFF → this is dead, CameraView runs.
          useVisionCamera && SwingVisionCamera ? (
            <SwingVisionCamera
              ref={cameraRef as unknown as React.Ref<SwingCameraHandle>}
              style={StyleSheet.absoluteFill}
              facing={facing}
              isActive
              onCameraReady={() => {
                if (pendingStartRef.current) { pendingStartRef.current = false; void startRecording(); }
              }}
            />
          ) : (
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
          )
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

        {/* 2026-06-23 (Tim) — guided Scan-club overlay: framing box + 3-2-1 hold so
            the SOLE is presented steadily for a crisp, readable frame. */}
        {clubScanActive && (
          <View pointerEvents="none" style={styles.clubScanOverlay}>
            <View style={styles.clubScanBox}>
              {clubScanCount > 0
                ? <Text style={styles.clubScanCount}>{clubScanCount}</Text>
                : <Text style={styles.clubScanReading}>Reading…</Text>}
            </View>
            <Text style={styles.clubScanHint}>Hold the club SOLE flat in the box · keep it steady</Text>
          </View>
        )}

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
            <SwingBodyOverlay
              frames={poseFrames}
              currentTimeMs={playbackMs}
              showSkeleton
              showTrace={showSkeleton}
              resizeMode="cover"
              // 2026-07-06 (range audit RANK 3) — light the diagnosed fault's body
              // region orange/red in the LIVE review too (was only on the saved-swing
              // screen), so a significant over-the-top actually reads red as you watch.
              faultJoints={faultJointsFor(analysis?.primary_fault ?? analysis?.detected_issue)}
              faultSevere={analysis?.severity === 'significant'}
              clubArc={clubArcPoints}
            />
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
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: targetingOpacity }]} pointerEvents={targetingVisible ? 'box-none' : 'none'}>
            <EditableCageTargets
              ballArea={ballArea}
              target={targetPoint}
              targetKind={isPutt ? 'cup' : 'aim'}
              onChangeBallArea={(a) => { if (sessionId) setSessionBallArea(sessionId, a); }}
              onChangeTarget={(t) => { if (sessionId) setSessionTarget(sessionId, t); }}
            />
          </Animated.View>
        ) : null}

        {/* DTL shot trace (2026-06-25, Tim). PREFER the MULTI-POINT measured path
            when we have one: a SOLID polyline through the real detected ball
            positions, plus a DASHED/FADED clearly-labelled PROJECTED continuation
            when the ball leaves frame (buildShotTrace, with its own legend). Falls
            back to the single-line departure trace when the multi-frame path didn't
            resolve. Both honest: solid = measured only, dashed = labelled estimate.
            Down-the-line + non-putt only. */}
        {isReview && showResults && shotTrace && shotTrace.tier !== 'none' ? (
          <MultiPointTraceOverlay trace={shotTrace} color={shotTraceColor} />
        ) : isReview && showResults && ballTrace ? (
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
          // 2026-06-29 (Tim) — fades out via targetingOpacity once ball+target are set
          // (clean screen); the persistent toggle brings it back to re-adjust.
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: targetingOpacity }]} pointerEvents={targetingVisible ? 'box-none' : 'none'}>
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
          </Animated.View>
        ) : phase === 'recording' && draftBall ? (
          // RECORDING — display only (you're swinging; no dragging mid-record).
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: targetingOpacity }]} pointerEvents="none">
            <CageTargetingOverlay ballArea={draftBall} target={angle === 'down_the_line' ? draftTarget : null} launchDir={null} targetKind={isPutt ? 'cup' : 'aim'} />
          </Animated.View>
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
          <SmartMotionHeader mode={angle} isPutt={isPutt} style={{ flex: 1, borderBottomWidth: 0, paddingVertical: 0, paddingHorizontal: 6 }} />
          <View style={styles.dotsRow}>
            {Array.from({ length: pageCount }).map((_, i) => (
              <View key={i} style={[styles.dot, { backgroundColor: page === i ? colors.accent : 'rgba(255,255,255,0.35)' }]} />
            ))}
          </View>
        </View>

        {/* 2026-06-29 (Tim) — PERSISTENT targeting toggle (NOT buried in the tools
            card): show/hide the ball box + aim line + target. The overlay auto-fades
            once both are set for a clean screen; tap this to bring it back to adjust.
            Lives top-left, mirrors the setup-tools chevron on the right. */}
        {/* 2026-06-29 (Tim) — REVIEW keeps the floating eye toggle; in setup/recording
            the deck's flag button now owns show/hide targeting (deck = control center). */}
        {phase === 'review' && (ballArea || targetPoint) ? (
          <TactilePressable
            onPress={() => setTargetingVisible((v) => !v)}
            style={[styles.targetingToggle, { top: insets.top + 76 }]}
            accessibilityRole="button"
            accessibilityLabel={targetingVisible ? 'Hide targeting overlay' : 'Show targeting overlay'}
          >
            <Ionicons name={targetingVisible ? 'eye-outline' : 'eye-off-outline'} size={18} color={colors.accent} />
          </TactilePressable>
        ) : null}

        {/* 2026-06-29 (Tim) — TALK-TO-CADDIE mic. SmartMotion is the SAME caddie brain
            as every tab: tap and say "record my swing", "driver, 3 swings", or
            "what should I work on" and the one brain replies + acts. Setup phase
            (top-left, where the targeting eye sits in review). */}
        {phase === 'setup' ? (
          <TactilePressable
            onPress={askCaddie}
            style={[styles.targetingToggle, { top: insets.top + 76, backgroundColor: caddieListening ? colors.accent : 'rgba(6,15,9,0.72)' }]}
            accessibilityRole="button"
            accessibilityLabel={caddieListening ? 'Listening — tap to stop' : 'Talk to your caddie'}
          >
            <Ionicons name={caddieListening ? 'mic' : 'mic-outline'} size={18} color={caddieListening ? '#06140b' : colors.accent} />
          </TactilePressable>
        ) : null}

        {/* 2026-06-26 (Tim) — DRILL banner relocated from the top to the bottom
            (where the swing-count pill sits for non-drills) + made prominent. See
            the styled banner below the swing-count selector. */}

        {/* SHOT-REST swing-count selector — 2026-06-16 (Tim). Non-drill setup only.
            OPEN = the free window; 1/3/5 caps the session to exactly that many swings
            (the read + narration cover N). Sits where the drill banner would. */}
        {/* 2026-06-29 (Tim) — SWINGS OPEN·1·3·5 selector moved OFF the floating pill
            and INTO the bottom deck as a persistent row (no fade). See the deck below. */}

        {/* DRILL BANNER — 2026-06-26 (Tim): SmartMotion looks the same for every
            drill by design, so a distinct, high-contrast label makes it instantly
            clear WHICH drill you're recording. Sits exactly where the swing-count
            pill sits for non-drills (free in drill mode), above the tab bar. Shows
            through setup + recording so a capture reads as "this is the X drill". */}
        {isDrill && (phase === 'setup' || phase === 'recording') ? (
          <View style={[styles.drillBanner, { bottom: insets.bottom + (isNarrow ? 138 : 64) }]} pointerEvents="none">
            <Text style={styles.drillBannerKicker}>{`DRILL${drillShotCount ? ` · ${drillShotCount} SWINGS` : ''}`}</Text>
            <Text style={styles.drillBannerName} numberOfLines={1}>
              {(typeof drillName === 'string' && drillName.trim() ? drillName.trim() : 'Practice').toUpperCase()}
            </Text>
          </View>
        ) : null}

        {/* DRILL CHECK — 2026-07-06 (MOAT Phase 2, the judge): after a drill set the
            caddie grades whether the fault the drill targets still showed. Sits in the
            same slot the setup drill banner used (free in review). Colored by grade
            (green got-it / amber closer / orange not-yet). Honest, directional. */}
        {isDrill && isReview && drillVerdict ? (
          <View
            style={[styles.drillCheckCard, { bottom: insets.bottom + (isNarrow ? 138 : 64), borderLeftColor: drillVerdictColor }]}
            pointerEvents="none"
          >
            <Text style={styles.drillCheckLine} numberOfLines={4}>{drillVerdict.line}</Text>
          </View>
        ) : null}

        {/* SETUP TOOLS — 2026-06-13 (Tim): collapsed to a single chevron by default
            so the right third stays CLEAR for framing. Tap to pop a labeled CARD
            (icon + what it does) over a dark scrim, so people learn the icons.
            Refine the copy later. Same handlers as the old rail. */}
        {phase === 'setup' ? (
          <View style={[styles.toolRail, { top: insets.top + 76, alignItems: 'flex-end' }]}>
            <TactilePressable
              onPress={() => setRailExpanded((v) => !v)}
              style={styles.railChevron}
              accessibilityRole="button"
              accessibilityLabel={railExpanded ? 'Hide setup tools' : 'Show setup tools'}
            >
              <Ionicons name="options-outline" size={18} color={colors.accent} />
              <Ionicons name={railExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accent} />
            </TactilePressable>
            {railExpanded ? (
              <View style={styles.toolCard}>
                <Text style={styles.toolCardHeader}>SETUP TOOLS</Text>
                <ToolCardRow
                  icon={<Image source={ICON_RAIL.calibrate} style={styles.toolCardIcon} resizeMode="contain" />}
                  title={calibrated ? 'Re-calibrate' : 'Calibrate'}
                  desc="Set the distance reference"
                  active={calibrated}
                  onPress={() => { setRailExpanded(false); router.push('/swinglab/calibrate' as never); }}
                />
                <ToolCardRow
                  icon={scanningClub ? <Ionicons name="sync" size={26} color={colors.accent} /> : <Image source={ICON_CLUB} style={styles.toolCardIcon} resizeMode="contain" />}
                  title="Scan club"
                  desc="Hold the sole to the camera"
                  disabled={scanningClub || clubScanActive}
                  onPress={() => { setRailExpanded(false); void startClubScan(); }}
                />
                <ToolCardRow
                  icon={<Image source={ICON_RAIL.ballbox} style={styles.toolCardIcon} resizeMode="contain" />}
                  title={placeBallMode ? 'Tap your ball' : 'Ball box'}
                  desc="Place the ball marker on the frame"
                  active={placeBallMode}
                  onPress={() => { setPlaceBallMode((v) => !v); setRailExpanded(false); }}
                />
                <ToolCardRow
                  icon={<Image source={ICON_ENV[effectiveMode]} style={styles.toolCardIcon} resizeMode="contain" />}
                  title={isRoundActive ? 'Course (round)' : effectiveMode === 'cage' ? 'Cage' : effectiveMode === 'range' ? 'Range' : 'Course'}
                  desc={isRoundActive ? 'Locked to your live round' : 'Where you are — tap to switch'}
                  disabled={isRoundActive}
                  onPress={() => { if (!isRoundActive) setEnvironmentMode(environmentMode === 'cage' ? 'range' : environmentMode === 'range' ? 'course' : 'cage'); }}
                />
                <ToolCardRow
                  icon={<Image source={ICON_RAIL.selfie} style={styles.toolCardIcon} resizeMode="contain" />}
                  title={facing === 'front' ? 'Selfie on' : 'Selfie'}
                  desc="Front camera for face-on framing"
                  active={facing === 'front'}
                  onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
                />
                <ToolCardRow
                  icon={<Image source={ICON_RAIL.chip} style={styles.toolCardIcon} resizeMode="contain" />}
                  title={chipSensitivity ? 'Chip mode on' : 'Chip mode'}
                  desc="Listen for soft chip strikes"
                  active={chipSensitivity}
                  onPress={() => {
                    const next = !chipSensitivity;
                    setChipSensitivity(next);
                    useToastStore.getState().show(next ? 'Chip mode ON — listening for soft chips' : 'Chip mode off');
                  }}
                />
              </View>
            ) : null}
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

        {/* 2026-06-29 (Tim) — the DTL EFFORT/CARRY/AIM readout moved OFF the floating
            over-camera pill and INTO the bottom deck as a clean 3-card plan trio.
            Same honest sources (effortRaw / estCarry / aimRead). See the deck below. */}

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

        {/* SHOT-SHAPE drill verdict — intended vs the launch we actually read
            (origin → departure). Honest: launch height + direction, never roll. */}
        {isReview && showResults && shotShapeVerdict && shotShapeDef ? (
          <View style={[styles.shotShapeCard, { bottom: insets.bottom + 150 }]} pointerEvents="none">
            <Text style={styles.shotShapeTitle}>
              {shotShapeVerdict.match === 'on' ? '✓ ' : ''}{shotShapeDef.name.toUpperCase()}
            </Text>
            <View style={styles.shotShapeRow}>
              <Text style={styles.shotShapeLeg}>WENT FOR <Text style={styles.shotShapeVal}>{shotShapeVerdict.intendedHeight}</Text></Text>
              <Ionicons name="arrow-forward" size={12} color="#9ca3af" />
              <Text style={styles.shotShapeLeg}>READ <Text style={[styles.shotShapeVal, { color: shotShapeVerdict.match === 'on' ? '#3FB950' : shotShapeVerdict.match === 'close' ? '#f5a623' : '#ef4444' }]}>{shotShapeVerdict.actualHeight}</Text></Text>
            </View>
            <Text style={styles.shotShapeFeedback}>{shotShapeVerdict.feedback}</Text>
          </View>
        ) : null}

        {/* SHOT-TRACE caption (2026-06-25, Tim) — one honest line under the trace.
            'full'/'launch' → the trace headline (+ the measured-vs-projected note on
            launch tier); when DTL ball-path detection ran but found NOTHING (and the
            single-line departure trace also didn't resolve), the honest no-track
            one-liner instead of a fabricated arc. */}
        {isReview && showResults && angle === 'down_the_line' && !isPutt
          && (shotTrace || (ballPathPoints != null && !ballTrace)) ? (
          <View style={[styles.traceCaption, { bottom: insets.bottom + 116 }]} pointerEvents="none">
            <Text style={styles.traceCaptionText} numberOfLines={2}>
              {shotTrace
                ? (shotTrace.note ?? shotTrace.headline)
                : 'Couldn’t track the ball this time — try better light or keep it in frame a beat longer.'}
            </Text>
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

        {/* 2026-06-29 (Tim) — CADDIE PRESENCE PiP. The selected caddie, in a draggable
            corner tile, during review (the "coach reviewing your tape" feel). Honest:
            a static avatar, no live video / no voice. Rides with the clean-view toggle. */}
        {isReview && showResults ? <CaddiePresencePip /> : null}

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
        <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 6 }]}>
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
                    {/* 2026-07-07 (audit M1) — show a number only when it's DERIVED
                        from this swing (pose/acoustic/sensor). A 'profile'/'placeholder'
                        handicap-table lookup is identical for every swing and carries no
                        signal from the rep — render "—" instead of a constant dressed up
                        as a per-swing read. */}
                    <SpeedStat
                      label="CLUB"
                      value={isSwingDerived(metrics.club_speed.source) && metrics.club_speed.value != null ? String(metrics.club_speed.value) : null}
                      unit="mph"
                      estimate={!isTruthGrade(metrics.club_speed.source)}
                      style={{ flex: 1 }}
                    />
                    <SpeedStat
                      label="BALL"
                      value={isSwingDerived(metrics.ball_speed.source) && metrics.ball_speed.value != null ? String(metrics.ball_speed.value) : null}
                      unit="mph"
                      estimate={!isTruthGrade(metrics.ball_speed.source)}
                      style={{ flex: 1 }}
                    />
                    <SpeedStat
                      label="CARRY"
                      value={isSwingDerived(metrics.carry_yards.source) && metrics.carry_yards.value != null ? String(metrics.carry_yards.value) : null}
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

          {/* 2026-06-29 (Tim) — REVIEW SCRUBBER: scrub the swing by time, with the
              detected phases (Address/Top/Impact/Finish) shown as ticks. */}
          {isReview && videoDurationMs ? (
            <ReviewScrubber
              positionMs={playbackMs}
              durationMs={videoDurationMs}
              moments={scrubMoments}
              onSeek={(ms) => { void videoRef.current?.setPositionAsync(ms); setPlaybackMs(ms); }}
              onScrubStart={() => { setVideoPaused(true); void videoRef.current?.pauseAsync(); }}
            />
          ) : null}

          {/* 2026-06-29 (Tim) — PLAN TRIO in the deck: EFFORT · CARRY · AIM. The honest
              pre-shot plan, same sources as the old floating readout (effortRaw /
              estCarry / aimRead). DTL setup only, and only while targeting is shown. */}
          {phase === 'setup' && angle === 'down_the_line' && !isPutt && targetingVisible && (effortRaw != null || aimRead) ? (
            <View style={styles.planRow}>
              <View style={styles.planCard}>
                <Text style={styles.planLabel}>EFFORT</Text>
                <Text style={styles.planValue} numberOfLines={1}>{effortRaw != null ? `${effortRaw}%` : '—'}</Text>
                <View style={styles.planSeg}>
                  {Array.from({ length: 6 }).map((_, i) => {
                    const filled = effortRaw != null && i < Math.round((effortRaw / 100) * 6);
                    return <View key={i} style={[styles.planSegCell, { backgroundColor: filled ? colors.accent : 'rgba(255,255,255,0.18)' }]} />;
                  })}
                </View>
              </View>
              <View style={styles.planCard}>
                <Text style={styles.planLabel}>CARRY</Text>
                <Text style={styles.planValue} numberOfLines={1}>{estCarry != null ? `~${estCarry}` : '—'}</Text>
                <Text style={styles.planUnit}>{estCarry != null ? 'yds' : ''}</Text>
              </View>
              <View style={styles.planCard}>
                <Text style={styles.planLabel}>AIM</Text>
                <Text
                  style={[styles.planValue, styles.planValueText, { color: aimRead ? (aimRead === 'STRAIGHT' ? colors.accent : '#f5c451') : '#88F700' }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {aimRead ?? '—'}
                </Text>
              </View>
            </View>
          ) : null}

          {/* 2026-06-29 (Tim) — persistent SWINGS OPEN·1·3·5 selector (no fade), now a
              deck row. Non-drill setup only (drills set their own swing count). */}
          {!isDrill && phase === 'setup' ? (
            <View style={styles.swingRow}>
              <Text style={styles.swingRowLabel}>SWINGS</Text>
              {([null, 1, 3, 5] as const).map((n) => {
                const active = targetSwings === n;
                return (
                  <TactilePressable
                    key={String(n)}
                    onPress={() => setTargetSwings(n)}
                    style={[styles.swingRowChip, active && { backgroundColor: colors.accent, borderColor: colors.accent }]}
                    accessibilityRole="button"
                    accessibilityLabel={n == null ? 'Open swing count' : `${n} swings`}
                  >
                    <Text style={[styles.swingRowChipText, active && { color: '#06140b' }]}>{n == null ? 'OPEN' : String(n)}</Text>
                  </TactilePressable>
                );
              })}
            </View>
          ) : null}

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
                  detected={phase === 'recording' && meteringActive ? liveDb != null && liveDb > -30 : segments.length > 0}
                  swingCount={isReview ? segments.length : undefined}
                  calibrated={calibrated}
                  levelDb={phase === 'recording' && meteringActive ? liveDb : null}
                  listening={phase === 'recording' && meteringActive}
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

          {!isReview ? (
            // 2026-06-29 (Tim) — THREE-circle control row matching the mockup:
            // golfer (cycle DTL → Face-On → Putting, with a fade-away mode label) ·
            // record (center, larger) · flag (show/hide the aim target — owns what the
            // floating eye toggle did in setup, so the deck is the control center).
            <View style={styles.controlsRowTriple}>
              <View style={{ justifyContent: 'center' }}>
                <Animated.Text style={[styles.modeFadeLabelLeft, { opacity: modeFadeOpacity, color: colors.accent }]} pointerEvents="none" numberOfLines={1}>
                  {modeFadeText}
                </Animated.Text>
                <TactilePressable
                  haptic="medium"
                  onPress={cycleMode}
                  style={styles.modeCycleBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Camera mode: ${isPutt ? 'putting' : angle === 'face_on' ? 'face-on' : 'down the line'}. Tap to change.`}
                >
                  <Image source={ICON_ANGLE[isPutt ? 'putt' : angle]} style={styles.modeCycleImg} resizeMode="contain" />
                </TactilePressable>
              </View>
              {actionBtn}
              <TactilePressable
                haptic="medium"
                onPress={() => setTargetingVisible((v) => !v)}
                style={[styles.flagBtn, { borderColor: targetingVisible ? colors.accent : 'rgba(136,247,0,0.35)' }]}
                accessibilityRole="button"
                accessibilityLabel={targetingVisible ? 'Hide aim target' : 'Show aim target'}
              >
                <Ionicons name="flag" size={24} color={targetingVisible ? colors.accent : 'rgba(255,255,255,0.6)'} />
              </TactilePressable>
            </View>
          ) : (
            <View style={styles.controlsRow}>
              <View style={{ flex: 1 }} />
              {actionBtn}
            </View>
          )}

          <FooterChips
            club={club ? clubIdLabel(club) : null}
            onClubPress={() => setClubMenuOpen(true)}
            shot={isReview ? selectedSwing + 1 : null}
            distanceYds={isReview && isSwingDerived(metrics.carry_yards.source) ? metrics.carry_yards.value : null}
            distanceEst={isReview && isSwingDerived(metrics.carry_yards.source) && metrics.carry_yards.value != null}
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
              <Text style={[styles.comingItemLabel, { color: isDark ? '#88F700' : '#2f7d12' }]}>FACE ANGLE</Text>
            </View>
            <View style={styles.comingItem}>
              <Image source={ICON_METRIC.smash} style={styles.comingImg} resizeMode="contain" />
              <Text style={[styles.comingItemLabel, { color: isDark ? '#88F700' : '#2f7d12' }]}>SMASH FACTOR</Text>
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
  // 2026-06-30 (audit C1/C10 — Tim: "wire learned carry to on-course distances") — feed
  // the shot map the player's REAL per-club carry: tracked on-course average (wins) → stated
  // My Bag → null. Null lets fullCarryYards fall back to the handicap table, so this only
  // overrides with HONEST data. getState() (not a hook) — safe this late in the component.
  const shotMapClubName = clubIdToClubName(club);
  let learnedCarryYds: number | null = null;
  if (shotMapClubName) {
    const cs = useClubStatsStore.getState();
    learnedCarryYds = (cs.stats[shotMapClubName]?.samples ?? 0) > 0
      ? cs.stats[shotMapClubName]!.avgYards
      : (cs.manual[shotMapClubName] ?? null);
  }
  const shotMapPage = showShotMap ? (
    <ShotMapPage
      key="shotmap"
      mode={effectiveMode}
      club={club}
      handicap={profile.handicap ?? null}
      learnedCarry={learnedCarryYds}
      estCarry={estCarry}
      effortPct={effortPct}
      trace={ballTrace ? { side: ballTrace.side, divergenceDeg: ballTrace.divergenceDeg } : null}
      canvasFeet={cageCanvasFeet}
      cameraBehindFeet={cameraBehindFeet}
      onChangeCanvasFeet={setCageCanvasFeet}
      onChangeCameraBehindFeet={setCameraBehindFeet}
      colors={colors}
      isDark={isDark}
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
          <VideoAnnotationOverlay topOffset={insets.top + 60} />
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
  // 2026-06-23 (Tim) — guided Scan-club framing overlay.
  clubScanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 30,
  },
  clubScanBox: {
    width: 230, height: 165, borderRadius: 16,
    borderWidth: 2.5, borderColor: '#88F700', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(136,247,0,0.06)',
  },
  clubScanCount: { color: '#88F700', fontSize: 64, fontWeight: '900' },
  clubScanReading: { color: '#88F700', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  clubScanHint: { color: '#ffffff', fontSize: 14, fontWeight: '700', marginTop: 18, textAlign: 'center', paddingHorizontal: 24 },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingBottom: 8,
  },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  swingCountOuter: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 6, pointerEvents: 'box-none' },
  swingCountPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(6,15,9,0.82)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  swingCountLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginRight: 2 },
  swingCountChip: { minWidth: 30, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center' },
  swingCountText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  // 2026-06-26 (Tim) — DRILL identity banner. Canonical SmartMotion icon green
  // (#88F700) + heavy uppercase + wide tracking = a deliberately DIFFERENT look
  // from the rest of the HUD so the drill reads at a glance while recording.
  drillBanner: { position: 'absolute', alignSelf: 'center', alignItems: 'center', zIndex: 6, paddingHorizontal: 20, paddingVertical: 7, borderRadius: 14, backgroundColor: 'rgba(6,20,11,0.74)', borderWidth: 1.5, borderColor: '#88F700' },
  drillBannerKicker: { color: '#88F700', fontSize: 10, fontWeight: '700', letterSpacing: 4, marginBottom: 2 },
  drillBannerName: { color: '#FFFFFF', fontSize: 21, fontWeight: '900', letterSpacing: 1.5 },
  drillCheckCard: { position: 'absolute', alignSelf: 'center', maxWidth: '86%', zIndex: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(6,20,11,0.88)', borderWidth: 1, borderLeftWidth: 4, borderColor: 'rgba(255,255,255,0.12)' },
  drillCheckLine: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', lineHeight: 19 },

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
  // 2026-06-12 (Tim) — the green-circle icons washed out on BRIGHT live video. Give each
  // a soft translucent-dark scrim + shadow so the lime pops on any background. It's a dark
  // backing (a shadow, not a competing green ring), so it keeps the "icon's own circle is
  // the button" look. Active state brightens to the lime fill.
  toolBtnBare: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,15,9,0.42)', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 5, shadowOffset: { width: 0, height: 1 }, elevation: 4 },
  // 2026-07-07 — named review controls (SAVE / NEW SET) so the next action is obvious.
  ctrlLabeled: { alignItems: 'center', gap: 2 },
  ctrlLabelText: { color: 'rgba(255,255,255,0.85)', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  toolBtnBareActive: { backgroundColor: 'rgba(136,247,0,0.30)' },
  toolIconFull: { width: 46, height: 46 },
  // 2026-06-13 (Tim) — single tools icon → labeled card. Collapsed = just this pill
  // (clears the right third); expanded = the card below over a dark scrim.
  railChevron: {
    flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 11, paddingRight: 9, paddingVertical: 9,
    borderRadius: 999, backgroundColor: 'rgba(6,15,9,0.72)', borderWidth: 1, borderColor: 'rgba(136,247,0,0.55)',
  },
  // 2026-06-29 (Tim) — persistent show/hide for the targeting overlay (top-left).
  targetingToggle: {
    position: 'absolute', left: 12, zIndex: 7, width: 40, height: 40, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(6,15,9,0.72)', borderWidth: 1, borderColor: 'rgba(136,247,0,0.55)',
  },
  toolCard: {
    marginTop: 10, width: 232, backgroundColor: 'rgba(8,13,10,0.95)', borderRadius: 16, borderWidth: 1,
    borderColor: 'rgba(136,247,0,0.22)', padding: 10, gap: 2,
    shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
  toolCardHeader: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '900', letterSpacing: 1.3, marginBottom: 4, marginLeft: 4 },
  toolCardIcon: { width: 34, height: 34 },
  modeCycleBtn: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, borderColor: 'rgba(136,247,0,0.6)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,15,9,0.55)' },
  modeCycleImg: { width: 42, height: 42 },
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
    paddingHorizontal: 10, paddingTop: 10, gap: 6,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  placeHint: {
    position: 'absolute', alignSelf: 'center', zIndex: 6,
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
  },
  placeHintText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  // Translucent "glass" card bg so the camera shows through the bottom panel.
  // 2026-06-29 (Tim) — the bottom CLUB·SHOT·DIST bar now matches the brand pill deck
  // above it (dark base + subtle neon-green border), so the bottom reads cohesive.
  glassCard: { backgroundColor: 'rgba(6,15,9,0.82)', borderColor: 'rgba(136,247,0,0.28)', borderRadius: 14 },
  // 2026-06-29 (Tim) — in-deck PLAN TRIO (EFFORT/CARRY/AIM) + persistent SWINGS row +
  // three-circle control row (golfer · record · flag), matching the mockup.
  planRow: { flexDirection: 'row', gap: 6 },
  planCard: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1, backgroundColor: 'rgba(6,15,9,0.82)', borderWidth: 1, borderColor: 'rgba(136,247,0,0.28)', borderRadius: 12, paddingVertical: 6, paddingHorizontal: 8 },
  planLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  planValue: { color: '#88F700', fontSize: 20, fontWeight: '900', letterSpacing: 0.3 },
  planValueText: { fontSize: 15 },
  planUnit: { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '700' },
  planSeg: { flexDirection: 'row', gap: 2, marginTop: 3 },
  planSegCell: { width: 8, height: 4, borderRadius: 1 },
  swingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', backgroundColor: 'rgba(6,15,9,0.82)', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(136,247,0,0.22)', paddingHorizontal: 12, paddingVertical: 5 },
  swingRowLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginRight: 2 },
  swingRowChip: { minWidth: 38, paddingHorizontal: 11, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center' },
  swingRowChipText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  controlsRowTriple: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  flagBtn: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,15,9,0.55)' },
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
  // 2026-06-15 (Tim — shot-shape drills) — intended-vs-actual launch card.
  shotShapeCard: { position: 'absolute', alignSelf: 'center', maxWidth: '88%', backgroundColor: 'rgba(6,15,9,0.86)', borderWidth: 1, borderColor: 'rgba(124,224,79,0.4)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, zIndex: 7 },
  shotShapeTitle: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textAlign: 'center' },
  shotShapeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 },
  shotShapeLeg: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  shotShapeVal: { color: '#e8f5e9', fontSize: 11, fontWeight: '900' },
  shotShapeFeedback: { color: '#e8f5e9', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 6 },
  traceCaption: { position: 'absolute', alignSelf: 'center', maxWidth: '86%', backgroundColor: 'rgba(6,15,9,0.82)', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 6, zIndex: 7 },
  traceCaptionText: { color: '#e8f5e9', fontSize: 11, lineHeight: 15, textAlign: 'center', fontWeight: '600' },
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
  // 2026-06-12 — soft shadow so page-2 cards separate from a LIGHT-mode near-white
  // background (Tim: cards washed out). Invisible on the dark theme.
  insightCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  insightLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  comingCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, borderStyle: 'dashed', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  comingRow: { flexDirection: 'row', gap: 20, justifyContent: 'center', paddingVertical: 4 },
  comingItem: { alignItems: 'center', gap: 4, opacity: 0.85 },
  comingImg: { width: 46, height: 46 },
  comingItemLabel: { color: '#88F700', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  comingNote: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
  insightHeadline: { fontSize: 17, fontWeight: '900', letterSpacing: 0.3 },
  insightConf: { fontSize: 11, fontWeight: '600' },
  insightBody: { fontSize: 13, lineHeight: 19, fontWeight: '500', padding: 12, borderWidth: 1, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
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
