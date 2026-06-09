/**
 * Phase R — Uploaded swing detail surface.
 *
 * Loads a session by id, plays the swing video, lets the user toggle
 * between embedded coach audio (if present) and Kevin's analysis voice.
 * Shows PrimaryIssueCard + DrillCard with timestamp anchors that scrub
 * the video to the detected moment.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Animated, Alert, Image, Modal,
  Pressable, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Video, ResizeMode, type AVPlaybackStatus, type AVPlaybackStatusSuccess } from 'expo-av';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { useCageStore, type AnalysisStatus, type CageShot } from '../../../store/cageStore';
import { useToastStore } from '../../../store/toastStore';
import { usePlayerProfileStore } from '../../../store/playerProfileStore';
import { exportCoachReport } from '../../../services/coachReport';
import { getSwingReference } from '../../../services/swingReferences';
import { useTrustLevelStore } from '../../../store/trustLevelStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { speak, stopSpeaking, configureAudioForSpeech, captureUtterance, stopCapture } from '../../../services/voiceService';
import { runPhaseKOnSession } from '../../../services/videoUpload';
// 2026-05-28 — Fix FI: presence fill when analysis fails. Instead of
// leaving the user staring at "Couldn't analyze this one" with no
// caddie voice, the caddie speaks a short context-aware line
// (re-record advice, reassurance that one miss doesn't change the
// read of their game).
import { presenceFill } from '../../../services/presenceCaddie';
import { uploadLog } from '../../../services/uploadDiagnostic';
import PrimaryIssueCard from '../../../components/swinglab/PrimaryIssueCard';
import AskYourSwingCard from '../../../components/swinglab/AskYourSwingCard';
import ZoomableView from '../../../components/swinglab/ZoomableView';
import VideoAnnotationOverlay from '../../../components/swinglab/VideoAnnotationOverlay';
// 2026-05-27 — Fix EO: cage targeting card + overlay.
import CageTargetingCard, { CageTargetingOverlay } from '../../../components/swinglab/CageTargetingCard';
// 2026-05-27 — Fix EP: send-to-Tank stub.
import { sendSwingToTank, isSendToTankAvailable, TANK_REVIEW_EMAIL } from '../../../services/tankReview';
import DrillCard from '../../../components/swinglab/DrillCard';
import PuttingAnalysisCard from '../../../components/swinglab/PuttingAnalysisCard';
import SwingActionSheet from '../../../components/swinglab/SwingActionSheet';
import SwingBodyOverlay from '../../../components/swinglab/SwingBodyOverlay';
import VideoWatermark from '../../../components/swinglab/VideoWatermark';
import CompareReferencePickerSheet from '../../../components/swinglab/CompareReferencePickerSheet';
import ComparisonResultSheet from '../../../components/swinglab/ComparisonResultSheet';
import type { SimilarMatch, ReferenceSwing } from '../../../services/swingDatabase';
import type { PoseEstimate } from '../../../services/poseEstimator';
import type { SwingComparison } from '../../../services/swingComparisonEngine';

// Phase BW — short mm:ss formatter for the per-swing list rows.
function formatMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

// Phase V — copy the user sees while Phase K is running. Maps the analysis
// lifecycle stages to honest, plain-language status.
const STATUS_COPY: Record<AnalysisStatus, string> = {
  pending:           'Kevin is reviewing your swing…',
  analyzing_frames:  'Extracting frames…',
  analyzing_pose:    'Watching the swing…',
  analyzing_pattern: 'Identifying patterns…',
  ok:                'Analysis complete.',
  failed:            "I had trouble watching this one.",
};

export default function SwingDetail() {
  const router = useRouter();
  const { colors } = useTheme();
  const { swing_id, watch } = useLocalSearchParams<{ swing_id: string; watch?: string }>();
  // 2026-05-25 — Path A: when upload routed here with ?watch=1 (short
  // clip, analysis deferred), auto-play the video on mount and fire
  // runPhaseKOnSession on didJustFinish. The watchFiredRef gate stops
  // a second navigation to this screen from re-firing the analysis on
  // an already-analyzed session.
  const shouldAutoplayThenAnalyze = watch === '1';
  const watchFiredRef = useRef(false);
  const trustLevel = useTrustLevelStore(s => s.level);
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  // 2026-05-28 — Fix FI: caddie persona for presence brain calls.
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // Phase V — subscribe via the store selector so the surface re-renders
  // when Phase K transitions analysis_status / populates primary_issue.
  // The previous static getSession() call returned a snapshot and never
  // updated past the initial mount.
  const session = useCageStore(s =>
    swing_id ? s.sessionHistory.find(x => x.id === swing_id) ?? null : null,
  );
  // Coach report export is an instructor tool — gate the button so a
  // golfer can't export a report headed with their own name as the
  // "instructor" (audit). Reactive so a role change in Settings reflects.
  const isInstructor = usePlayerProfileStore(s => s.role === 'instructor');
  // 2026-05-23 — Hydration guard. AsyncStorage rehydration is async,
  // so sessionHistory starts as [] before persist fills it from disk.
  // Without this, deep-linking to a swing detail before hydration
  // renders "Swing not found." even though the data IS in storage.
  // Library hydration race fix — same pattern as app/swinglab/library.tsx.
  const hasHydrated = useCageStore(s => s.hasHydrated);
  const shot = session?.shots[0];

  // Phase BZ-v1 — per-shot action sheet + compare mode state.
  const [actionShotId, setActionShotId] = useState<string | null>(null);
  // Phase 403b — "See the moment" modal. Holds the URI of the fault
  // frame to display full-size, or null when closed.
  // Phase 404 — additionally carries detected_issue so the reference
  // registry can be looked up at open-time; when a reference is
  // registered, the modal renders side-by-side.
  const [faultFrameModal, setFaultFrameModal] = useState<{
    uri: string;
    observation: string;
    detected_issue: string | null;
  } | null>(null);
  const [leftCompareShotId, setLeftCompareShotId] = useState<string | null>(null);
  const [rightCompareShotId, setRightCompareShotId] = useState<string | null>(null);
  // 2026-05-22 — Compare-to-Reference picker sheet open/close.
  const [compareSheetOpen, setCompareSheetOpen] = useState(false);
  // 2026-05-23 — Comparison result sheet state. Holds the resolved
  // SwingComparison + ReferenceSwing pair. When both are non-null
  // the result sheet animates up with the side-by-side metric bars.
  const [comparisonResult, setComparisonResult] = useState<{
    result: SwingComparison;
    reference: ReferenceSwing;
  } | null>(null);
  // 2026-05-23 — Auto-suggested comparisons (1-2 most-relevant
  // references) computed after analysis_status==='ok'. Renders inline
  // under the primary issue card so the player sees the matches
  // without opening the picker. Tap a chip to lock in that reference
  // via the same compareSwings pass.
  const [autoSuggestions, setAutoSuggestions] = useState<SimilarMatch[] | null>(null);
  const autoSuggestComputedFor = useRef<string | null>(null);
  const isComparing = leftCompareShotId != null && rightCompareShotId != null;
  const isPickingCompareTarget = leftCompareShotId != null && rightCompareShotId == null;
  const actionShot = actionShotId
    ? session?.shots.find(s => s.id === actionShotId) ?? null
    : null;
  const leftShot = leftCompareShotId
    ? session?.shots.find(s => s.id === leftCompareShotId) ?? null
    : null;
  const rightShot = rightCompareShotId
    ? session?.shots.find(s => s.id === rightCompareShotId) ?? null
    : null;

  const videoRef = useRef<Video>(null);
  const leftCompareVideoRef = useRef<Video>(null);
  const rightCompareVideoRef = useRef<Video>(null);
  // Phase V.7+ — default to Kevin analysis. The has_audio probe in
  // videoUpload.probeVideo is unreliable (it returns true for any video with
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(session?.upload?.duration_sec ?? null);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showTrace, setShowTrace] = useState(true);

  const poseFrames = session?.biomechanics?.frames ?? [];
  const hasPose = poseFrames.length >= 2;

  // 2026-05-17 — dropped the Coach Audio / Kevin Analysis toggle.
  // The dual-audio path was confusing and the coach-audio detection was
  // unreliable (has_audio probe returned true for silent clips). Now the
  // video is always muted and the caddie's analysis auto-narrates once
  // per swing via the effect below. Single source of truth.
  useEffect(() => {
    void videoRef.current?.setIsMutedAsync(true);
    return () => { void stopSpeaking(); };
  }, []);

  // Phase V — automatic Kevin voice when analysis FIRST completes for this
  // session. Fires once per swing_id transition into 'ok' so the player
  // gets the coach-delivered result without toggling. Skipped at Quiet
  // (banner-only) trust and when voiceEnabled=false. Also drives a subtle
  // entry animation for the analysis cards.
  const cardsFade = useRef(new Animated.Value(0)).current;
  const spokenForRef = useRef<string | null>(null);
  const analysisStatus: AnalysisStatus = session?.analysis_status ?? 'pending';

  // Phase BQ — emit [upload:ui-render] on every analysis_status transition
  // so the empirical trace shows whether the UI ever sees the result the
  // pipeline stored. Includes the full status so a "stuck on
  // analyzing_pose" failure is visible in logs instead of inferred.
  const lastRenderStatus = useRef<AnalysisStatus | null>(null);
  useEffect(() => {
    if (!swing_id) return;
    if (lastRenderStatus.current === analysisStatus) return;
    lastRenderStatus.current = analysisStatus;
    uploadLog('ui-render', {
      analysis_status: analysisStatus,
      has_primary_issue: !!session?.primary_issue,
      has_drill: !!session?.drill_recommendation,
      analysis_error: session?.analysis_error ?? null,
    }, swing_id);
  }, [analysisStatus, swing_id, session?.primary_issue, session?.drill_recommendation, session?.analysis_error]);

  // 2026-05-23 — Auto-suggest 1-2 relevant comparisons once analysis
  // completes and biomechanics is present. Idempotent per swing_id;
  // failures collapse to no-suggestion (the manual Compare button
  // still works).
  useEffect(() => {
    if (!swing_id || autoSuggestComputedFor.current === swing_id) return;
    if (!session?.biomechanics) return;
    if ((session.analysis_status ?? 'pending') !== 'ok') return;
    autoSuggestComputedFor.current = swing_id;
    void (async () => {
      try {
        const dbMod = await import('../../../services/swingDatabase');
        const current: PoseEstimate = {
          source: 'video',
          confidence: 75,
          frames: session.biomechanics?.frames ?? [],
          biomechanics: session.biomechanics ?? null,
          swingVerdict: null,
          reason: 'auto-suggest comparison',
          age_band: 'adult',
          mirrored: false,
          joint_confidence: { hip: 0.8, shoulder: 0.8, knee: 0.6, wrist: 0.6, ankle: 0.6, head: 0.7 },
          partial_view: false,
        };
        const matches = await dbMod.searchSimilarSwings(current, 2, session.club ? { club: session.club } : undefined);
        setAutoSuggestions(matches);
      } catch (e) {
        console.log('[swing-detail] auto-suggest failed (non-fatal):', e);
        setAutoSuggestions([]);
      }
    })();
  }, [swing_id, session?.biomechanics, session?.analysis_status, session?.club]);

  // Backfill biomechanics for older swings captured before the pose pipeline
  // shipped. Fires once per swing_id; failure is silent (pose API is opt-in
  // and known to be flaky — same posture as the upload pipeline's branch).
  const poseBackfillRef = useRef<string | null>(null);
  useEffect(() => {
    if (!swing_id || !shot?.clipUri) return;
    if (session?.biomechanics !== undefined) return;
    if (poseBackfillRef.current === swing_id) return;
    poseBackfillRef.current = swing_id;
    const durationMs = (session?.upload?.duration_sec ?? 3) * 1000;
    void (async () => {
      try {
        const poseMod = await import('../../../services/poseAnalysisApi');
        const biomech = await poseMod.analyzeSwingFromVideo(shot.clipUri!, durationMs);
        useCageStore.getState().setSessionBiomechanics(swing_id, biomech);
      } catch (e) {
        console.log('[swing-detail] pose backfill failed', e);
      }
    })();
  }, [swing_id, shot?.clipUri, session?.biomechanics, session?.upload?.duration_sec]);

  useEffect(() => {
    if (analysisStatus === 'ok') {
      Animated.timing(cardsFade, { toValue: 1, duration: 420, useNativeDriver: true }).start();
    }
    if (analysisStatus !== 'ok') return;
    if (!session?.primary_issue || !swing_id) return;
    if (spokenForRef.current === swing_id) return;
    spokenForRef.current = swing_id;
    if (!voiceEnabled || trustLevel === 1) return;
    const issue = session.primary_issue;
    const text = `Okay, I watched it. Your primary issue is ${issue.name.toLowerCase()}. ${issue.mechanical_breakdown} ${issue.feel_cue}`;
    void (async () => {
      await configureAudioForSpeech();
      await speak(text, voiceGender, language, apiUrl);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisStatus, swing_id, session?.primary_issue?.issue_id]);

  // 2026-05-28 — Fix FI: presence fill on analysis_failed. Mirrors the
  // ok-path speak-once pattern (gated on swing_id via spokenFailRef so
  // a re-mount doesn't double-speak). When the analyzer punts on a
  // clip, the caddie says something context-aware about the club /
  // re-record suggestion instead of leaving the user with silent red
  // text. Same voice/trust gates as the ok path.
  const spokenFailRef = useRef<string | null>(null);
  useEffect(() => {
    if (analysisStatus !== 'failed' || !swing_id) return;
    if (spokenFailRef.current === swing_id) return;
    spokenFailRef.current = swing_id;
    if (!voiceEnabled || trustLevel === 1) return;
    void (async () => {
      const line = await presenceFill({
        trigger: 'analysis_failed',
        context: {
          persona: caddiePersonality,
          club: session?.club ?? null,
          swingTitle: session?.upload?.notes ?? null,
        },
      });
      if (!line) return;
      await configureAudioForSpeech();
      await speak(line, voiceGender, language, apiUrl);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisStatus, swing_id]);

  const onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    const s = status as AVPlaybackStatusSuccess;
    if (s.positionMillis != null) setPosition(s.positionMillis / 1000);
    if (s.durationMillis != null) setDuration(s.durationMillis / 1000);
    // 2026-05-25 — Path A: when the user routed here with ?watch=1
    // (analysis was deferred at upload time for short clips), fire
    // runPhaseKOnSession the moment the video plays through. Gated
    // by watchFiredRef so re-mounts can't double-fire, and by
    // analysisStatus so we don't clobber a result if one's already
    // present (e.g. user navigated back-and-forth after analysis ran).
    if (
      s.didJustFinish &&
      shouldAutoplayThenAnalyze &&
      !watchFiredRef.current &&
      analysisStatus === 'pending' &&
      swing_id
    ) {
      watchFiredRef.current = true;
      uploadLog('watch-then-analyze-fire', { from_status: analysisStatus }, swing_id);
      useCageStore.getState().setSessionAnalysisStatus(swing_id, 'pending');
      void runPhaseKOnSession(swing_id);
    }
  };

  const scrubTo = async (sec: number) => {
    await videoRef.current?.setPositionAsync(sec * 1000);
    await videoRef.current?.playAsync();
  };

  // 2026-05-25 — Safety-net auto-fire for stuck-on-pending analysis.
  // For uploaded clips that landed with ?watch=1, analysis ONLY fires
  // when the video plays through (didJustFinish). If the user pauses
  // mid-play, never starts playback, or the video errors silently,
  // analysisStatus sits at 'pending' forever. Tonight Tim reported a
  // 3-minute "Kevin is reviewing" hang on a real upload — this watchdog
  // fixes that: when ?watch=1 AND status is 'pending' AND we haven't
  // fired yet, schedule an auto-fire after 25s. By then the video has
  // either auto-played through (fired naturally) OR not — in which case
  // we kick off analysis anyway so the user isn't stranded. Cleaned up
  // on unmount + on status change.
  useEffect(() => {
    if (!swing_id) return;
    if (!shouldAutoplayThenAnalyze) return;
    if (analysisStatus !== 'pending') return;
    if (watchFiredRef.current) return;
    const timer = setTimeout(() => {
      if (watchFiredRef.current) return;
      if (useCageStore.getState().sessionHistory.find(s => s.id === swing_id)?.analysis_status !== 'pending') return;
      watchFiredRef.current = true;
      // 2026-05-25 — bumped 25s → 60s per Tim's request. Longer clips
      // (uploaded coach lessons, multi-swing demos) need more time
      // for natural play-through completion before we override with
      // the watchdog. 60s still bounds the worst-case "stuck on
      // Kevin is reviewing forever" UX.
      uploadLog('watch-then-analyze-watchdog-fire', { reason: 'pending_60s' }, swing_id);
      useCageStore.getState().setSessionAnalysisStatus(swing_id, 'pending');
      void runPhaseKOnSession(swing_id);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [swing_id, shouldAutoplayThenAnalyze, analysisStatus]);

  // Phase BZ-v1 — when in compare-picker mode, tapping a row picks the
  // right-pane swing instead of scrubbing the main video. Otherwise
  // scrubs as before.
  const handleRowTap = async (s: CageShot) => {
    if (isPickingCompareTarget) {
      if (s.id === leftCompareShotId) return; // can't compare with itself
      setRightCompareShotId(s.id);
      return;
    }
    await scrubTo(s.clipStartSeconds ?? 0);
  };

  const handleStartCompare = (shotId: string) => {
    setLeftCompareShotId(shotId);
    setRightCompareShotId(null);
  };

  const exitCompare = () => {
    setLeftCompareShotId(null);
    setRightCompareShotId(null);
  };

  // Phase BZ-v1 — synced playback for the comparison view. Play/pause
  // applied to both video panes together so the user sees the swings
  // in lockstep.
  const playBoth = async () => {
    await Promise.all([
      leftCompareVideoRef.current?.playAsync(),
      rightCompareVideoRef.current?.playAsync(),
    ]);
  };
  const pauseBoth = async () => {
    await Promise.all([
      leftCompareVideoRef.current?.pauseAsync(),
      rightCompareVideoRef.current?.pauseAsync(),
    ]);
  };
  const restartBoth = async () => {
    const lStart = leftShot?.clipStartSeconds ?? 0;
    const rStart = rightShot?.clipStartSeconds ?? 0;
    await Promise.all([
      leftCompareVideoRef.current?.setPositionAsync(lStart * 1000),
      rightCompareVideoRef.current?.setPositionAsync(rStart * 1000),
    ]);
    await playBoth();
  };

  const handleSessionShare = async () => {
    if (!shot?.clipUri) {
      Alert.alert('Nothing to share', 'This session has no video file.');
      return;
    }
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(shot.clipUri, {
        mimeType: 'video/mp4',
        dialogTitle: 'Share session',
      });
    } catch (e) {
      console.log('[swing-detail] session share failed', e);
    }
  };

  // 2026-06-08 — Coach report export. One clean PDF (instructor header +
  // logo, dated, fault frame, the AI read + drill + the coach's note) to
  // send a student — replaces the piecemeal clip-plus-text workflow.
  const handleExportReport = async () => {
    if (!session) { useToastStore.getState().show('Nothing to export yet.'); return; }
    const profile = usePlayerProfileStore.getState();
    const pi = session.primary_issue ?? null;
    const swinger = session.upload?.swinger ?? null;
    const history = useCageStore.getState().sessionHistory;
    const sameStudent = swinger ? history.filter(h => (h.upload?.swinger ?? null) === swinger) : [];
    useToastStore.getState().show('Building report…');
    const res = await exportCoachReport({
      studentName: swinger,
      instructorName: profile.name || profile.firstName || 'Your Instructor',
      instructorCredentials: profile.coachCredentials ?? null,
      sessionDateMs: session.upload?.uploaded_at ?? Date.now(),
      sessionNumber: sameStudent.length > 0 ? sameStudent.length : null,
      // image frames only (never the video clip) for the embedded picture
      faultFrameUri: session.fault_frame_uri ?? pi?.visual_reference_path ?? null,
      analysis: pi ? {
        primaryFault: pi.primary_fault ?? null,
        observation: pi.mechanical_breakdown ?? pi.layman_explanation ?? null,
        cause: pi.cause ?? null,
        fix: pi.fix ?? null,
        drill: pi.drill ?? null,
        confidence: pi.confidence ?? null,
      } : null,
      coachNote: session.coach_note ?? null,
    });
    if (!res.ok) {
      useToastStore.getState().show(res.reason === 'sharing_unavailable' ? 'Sharing not available on this device.' : 'Couldn’t build the report — try again.');
    }
  };

  if (!hasHydrated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={{ color: colors.text_muted, marginTop: 12 }}>Loading swing…</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!session || !shot?.clipUri) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Text style={{ color: colors.text_primary }}>Swing not found.</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
            <Text style={{ color: colors.accent }}>‹ Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const issueTimestamps = shot.detected_issue_timestamps_sec ?? [];

  // Phase V.7 — Re-run Phase K on this session with the post-V.6 pipeline.
  // Status transitions inside runPhaseKOnSession drive the existing analyzing
  // card automatically. Reset spokenForRef so Kevin re-narrates on completion.
  const reanalyzing =
    analysisStatus === 'analyzing_frames' ||
    analysisStatus === 'analyzing_pose' ||
    analysisStatus === 'analyzing_pattern' ||
    analysisStatus === 'pending';
  const onReanalyze = () => {
    if (!swing_id || reanalyzing) return;
    // Phase V.7 — flip status to 'pending' BEFORE clearing spokenForRef so the
    // auto-narrate effect can't fire with stale 'ok' status and re-speak the
    // old primary_issue between the ref clear and the first runPhaseK status
    // transition. Also stop any in-flight TTS from a prior auto-narration.
    uploadLog('reanalyze-start', { from_status: analysisStatus }, swing_id);
    void stopSpeaking().catch(() => {});
    useCageStore.getState().setSessionAnalysisStatus(swing_id, 'pending');
    spokenForRef.current = null;
    void runPhaseKOnSession(swing_id);
  };

  // 2026-05-22 — Phase 2 "Compare to..." action. Opens the bottom-sheet
  // picker (CompareReferencePickerSheet); the sheet calls onCompareToSelect
  // when the user locks in a reference, at which point we run the full
  // swingComparisonEngine pass and surface the per-metric result.
  const onCompareTo = () => {
    if (!session?.biomechanics) {
      useToastStore.getState().show('No biomechanics on this swing yet — analyze first.');
      return;
    }
    setCompareSheetOpen(true);
  };

  // Wraps the session's biomechanics as a PoseEstimate so the sheet
  // (and the engine) can consume it cleanly. Kept here so both the
  // sheet's search and the post-pick comparison see the same shape.
  const currentPoseForCompare: PoseEstimate | null = session?.biomechanics
    ? {
        source: 'video',
        confidence: 75,
        frames: session.biomechanics.frames ?? [],
        biomechanics: session.biomechanics,
        swingVerdict: null,
        reason: 'swing detail compare-to action',
        age_band: 'adult',
        mirrored: false,
        joint_confidence: { hip: 0.8, shoulder: 0.8, knee: 0.6, wrist: 0.6, ankle: 0.6, head: 0.7 },
        partial_view: false,
      }
    : null;

  const onCompareToSelect = (match: SimilarMatch) => {
    if (!currentPoseForCompare) return;
    void (async () => {
      try {
        const [dbMod, engineMod] = await Promise.all([
          import('../../../services/swingDatabase'),
          import('../../../services/swingComparisonEngine'),
        ]);
        await dbMod.touchReference(match.reference.id);
        const ref = match.reference;
        // Wrap the ReferenceSwing as a PoseEstimate so the engine can
        // diff biomechanics directly. Mirrors the wrap used in
        // swingDatabase.searchSimilarSwings.
        const referencePose: PoseEstimate = {
          source: 'video',
          confidence: 80,
          frames: ref.frames ?? [],
          biomechanics: ref.biomechanics ?? null,
          swingVerdict: null,
          reason: `reference: ${ref.label}`,
          age_band: ref.body?.age_band ?? 'adult',
          mirrored: ref.body?.handedness === 'left',
          joint_confidence: { hip: 0.9, shoulder: 0.9, knee: 0.7, wrist: 0.7, ankle: 0.7, head: 0.7 },
          partial_view: false,
        };
        const kind =
          ref.source === 'self_upload' ? 'self_vs_self' :
          ref.source === 'archetype'   ? 'self_vs_avatar' :
                                         'self_vs_pro';
        const result = engineMod.compareSwings({
          current: currentPoseForCompare,
          reference: referencePose,
          kind,
        });
        // 2026-05-23 — Open the visual result sheet instead of a
        // toast. The sheet renders side-by-side per-metric bars +
        // takeaways + voice summary. Toast retained only as the
        // failure surface below.
        setComparisonResult({ result, reference: ref });
        // Auto-narrate at trust >=2 — keeps parity with the existing
        // primary-issue auto-narration policy.
        if (voiceEnabled && trustLevel !== 1) {
          await configureAudioForSpeech();
          const headline = `${result.overall_match}% match to ${ref.label}. ${result.takeaways[0] ?? ''}`.trim();
          await speak(result.voice_summary || headline, voiceGender, language, apiUrl);
        }
      } catch (e) {
        console.log('[swing-detail] compare-to-select failed:', e);
        useToastStore.getState().show('Compare failed — try again.');
      }
    })();
  };

  const onAddReferenceFromSheet = () => {
    setCompareSheetOpen(false);
    router.push('/swinglab/upload' as never);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.back, { color: colors.accent }]}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]} numberOfLines={1}>
            {session.upload?.notes ?? `${session.club} swing`}
          </Text>
          <View style={{ width: 84, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14 }}>
            {/* 2026-05-27 — Fix EP: send-to-Tank icon. Sits next to
                the existing share icon. Sends this swing's video to
                Tank's review queue via system Share sheet. Pre-set
                to TANK_REVIEW_EMAIL. Hidden entirely when
                isSendToTankAvailable() returns false (paywall locked) —
                during beta SUBSCRIPTIONS_ENABLED=false so it's always
                shown. The button is disabled when there's no clip URI
                to send (rare, but defensive). */}
            {isSendToTankAvailable() && (
              <TouchableOpacity
                onPress={() => {
                  const clip = session.shots[0]?.clipUri ?? null;
                  if (!clip) {
                    useToastStore.getState().show('No video on this swing yet.');
                    return;
                  }
                  const dateStr = new Date(session.date).toLocaleDateString();
                  const ctx: string[] = [
                    `Club: ${session.club ?? 'unknown'}`,
                    `Date: ${dateStr}`,
                  ];
                  if (session.primary_issue?.name) {
                    ctx.push(`AI fault read: ${session.primary_issue.name}`);
                  }
                  if (session.coach_note) {
                    ctx.push(`Player note: ${session.coach_note}`);
                  }
                  void sendSwingToTank({
                    videoUri: clip,
                    swingTitle: session.upload?.notes ?? `${session.club} swing`,
                    contextLines: ctx,
                  }).then(result => {
                    if (result.kind === 'paywall') {
                      useToastStore.getState().show('Send to Tank — premium review (coming soon).');
                    } else if (result.kind === 'no_file') {
                      useToastStore.getState().show('No video to send.');
                    } else if (result.kind === 'error') {
                      useToastStore.getState().show('Send failed — try again.');
                      console.log('[swing-detail] send-to-tank error:', result.message);
                    } else if (result.kind === 'ok') {
                      useToastStore.getState().show(`Sharing to ${TANK_REVIEW_EMAIL}…`);
                    }
                  });
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Send this swing to Tank for review"
              >
                <Ionicons name="paper-plane-outline" size={20} color="#F0C030" />
              </TouchableOpacity>
            )}
            {isInstructor ? (
              <TouchableOpacity
                onPress={handleExportReport}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Export swing report PDF"
              >
                <Ionicons name="document-text-outline" size={22} color={colors.accent} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={handleSessionShare}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Share this swing"
            >
              <Ionicons name="share-outline" size={22} color={colors.accent} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Phase BZ-v1 — comparison banner during compare-picker mode */}
        {isPickingCompareTarget && leftShot && (
          <View style={[styles.compareBanner, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
            <Ionicons name="git-compare-outline" size={18} color={colors.accent} />
            <Text style={[styles.compareBannerText, { color: colors.accent }]} numberOfLines={2}>
              Pick a swing below to compare with swing {String((session.shots.findIndex(x => x.id === leftShot.id) + 1)).padStart(2, '0')}.
            </Text>
            <TouchableOpacity onPress={exitCompare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.compareBannerCancel, { color: colors.accent }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Phase BZ-v1 — comparison view: two videos side-by-side */}
        {isComparing && leftShot && rightShot && (
          <View style={[styles.compareCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.compareHeader}>
              <Text style={[styles.compareLabel, { color: colors.text_muted }]}>COMPARE</Text>
              <TouchableOpacity onPress={exitCompare}>
                <Text style={[styles.compareExit, { color: colors.accent }]}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.compareRow}>
              <View style={styles.comparePane}>
                <Text style={[styles.compareCaption, { color: colors.text_muted }]} numberOfLines={1}>
                  Swing {String((session.shots.findIndex(x => x.id === leftShot.id) + 1)).padStart(2, '0')}
                  {leftShot.perShotAnalysis?.detected_issue && leftShot.perShotAnalysis.detected_issue !== 'none'
                    ? ` · ${leftShot.perShotAnalysis.detected_issue.replace(/_/g, ' ')}`
                    : ''}
                </Text>
                <Video
                  ref={leftCompareVideoRef}
                  source={{ uri: leftShot.clipUri ?? '' }}
                  style={styles.compareVideo}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={false}
                  isMuted
                  positionMillis={(leftShot.clipStartSeconds ?? 0) * 1000}
                />
              </View>
              <View style={styles.comparePane}>
                <Text style={[styles.compareCaption, { color: colors.text_muted }]} numberOfLines={1}>
                  Swing {String((session.shots.findIndex(x => x.id === rightShot.id) + 1)).padStart(2, '0')}
                  {rightShot.perShotAnalysis?.detected_issue && rightShot.perShotAnalysis.detected_issue !== 'none'
                    ? ` · ${rightShot.perShotAnalysis.detected_issue.replace(/_/g, ' ')}`
                    : ''}
                </Text>
                <Video
                  ref={rightCompareVideoRef}
                  source={{ uri: rightShot.clipUri ?? '' }}
                  style={styles.compareVideo}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={false}
                  isMuted
                  positionMillis={(rightShot.clipStartSeconds ?? 0) * 1000}
                />
              </View>
            </View>
            <View style={styles.compareControls}>
              <TouchableOpacity onPress={playBoth} style={[styles.compareCtrl, { backgroundColor: colors.accent }]}>
                <Ionicons name="play" size={16} color="#fff" />
                <Text style={styles.compareCtrlText}>Play both</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={pauseBoth} style={[styles.compareCtrl, { borderColor: colors.border, borderWidth: 1.5 }]}>
                <Ionicons name="pause" size={16} color={colors.text_primary} />
                <Text style={[styles.compareCtrlText, { color: colors.text_primary }]}>Pause</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={restartBoth} style={[styles.compareCtrl, { borderColor: colors.border, borderWidth: 1.5 }]}>
                <Ionicons name="refresh" size={16} color={colors.text_primary} />
                <Text style={[styles.compareCtrlText, { color: colors.text_primary }]}>Restart</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!isComparing && (
          <>
            <View style={styles.videoWrap}>
              {/* 2026-05-25 — Fix AG: pinch-zoom + pan on the SmartMotion
                  video so a coach can zoom in on hands at top, hips at
                  impact, etc. Double-tap to reset. The Video stays
                  unchanged inside — native controls work when at 1×;
                  when zoomed, the pan gesture takes over. */}
              <ZoomableView style={StyleSheet.absoluteFill}>
              <Video
                ref={videoRef}
                source={{ uri: shot.clipUri }}
                style={styles.video}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls
                // 2026-05-25 — Auto-play on ?watch=1 (Path A: watch-
                // then-analyze for short uploads). User sees the swing
                // play through; runPhaseKOnSession fires when the video
                // ends via onPlaybackStatusUpdate didJustFinish. Other
                // entry paths (library tap, re-mount) keep manual play.
                shouldPlay={shouldAutoplayThenAnalyze && !watchFiredRef.current}
                // Audio plays for watch-then-analyze (user wants to
                // hear coach narration on uploaded videos). Other
                // paths stay muted so library scrubbing doesn't blast.
                isMuted={!shouldAutoplayThenAnalyze}
                onPlaybackStatusUpdate={onPlaybackStatusUpdate}
              />
              </ZoomableView>
              {/* 2026-05-25 — Fix AH: coach annotation overlay. DRAW
                  toggle is OFF by default so pinch-zoom + native
                  video controls work; coach taps DRAW to enter
                  freehand/circle/line/text mode. Per-shot session;
                  strokes don't persist across mount in v1. */}
              <VideoAnnotationOverlay />
              {hasPose && (showSkeleton || showTrace) && (
                <SwingBodyOverlay
                  frames={poseFrames}
                  currentTimeMs={position * 1000}
                  showSkeleton={showSkeleton}
                  showTrace={showTrace}
                />
              )}
              {/* 2026-05-27 — Fix EO: cage targeting overlay. Renders
                  the ball-area circle (green) + target marker (gold)
                  on top of the playing video. pointerEvents="none"
                  so the underlying video controls + annotation tools
                  stay tappable. Null/null = no render. */}
              <CageTargetingOverlay
                ballArea={session?.ball_area_norm ?? null}
                target={session?.target_norm ?? null}
              />
              <VideoWatermark position="bottomRight" size={36} />
            </View>
            {hasPose && (
              <View style={[styles.toggleRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <TouchableOpacity
                  style={[styles.toggleBtn, { flexDirection: 'row' }, showSkeleton && { backgroundColor: colors.accent }]}
                  onPress={() => setShowSkeleton(v => !v)}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle body overlay"
                >
                  <Ionicons name="body-outline" size={14} color={showSkeleton ? '#fff' : colors.text_muted} style={{ marginRight: 6 }} />
                  <Text style={[styles.toggleText, showSkeleton && { color: '#fff' }]}>Body</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleBtn, { flexDirection: 'row' }, showTrace && { backgroundColor: colors.accent }]}
                  onPress={() => setShowTrace(v => !v)}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle swing trace"
                >
                  <Ionicons name="analytics-outline" size={14} color={showTrace ? '#fff' : colors.text_muted} style={{ marginRight: 6 }} />
                  <Text style={[styles.toggleText, showTrace && { color: '#fff' }]}>Swing Trace</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* Audio source toggle removed 2026-05-17 — analysis always plays
            via the auto-narrate effect; video is always muted. */}

        {/* Issue timestamp anchors */}
        {issueTimestamps.length > 0 && session.primary_issue && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text_muted }]}>DETECTED MOMENTS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              {issueTimestamps.map((ts, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => void scrubTo(ts)}
                  style={[styles.tsPill, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}
                >
                  <Text style={[styles.tsText, { color: colors.accent }]}>0:{Math.floor(ts).toString().padStart(2, '0')}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={[styles.tsHint, { color: colors.text_muted }]}>Tap a timestamp to jump to that moment.</Text>
          </View>
        )}

        {/* Phase V — analysis processing / failure / done */}
        <View style={{ marginTop: 16 }}>
          {analysisStatus !== 'ok' && analysisStatus !== 'failed' && (
            <View style={[styles.analyzingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <ActivityIndicator color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.analyzingText, { color: colors.text_primary }]}>
                  {STATUS_COPY[analysisStatus]}
                </Text>
                <Text style={[styles.analyzingSub, { color: colors.text_muted }]}>
                  About 60 seconds. You can stay on this screen.
                </Text>
              </View>
            </View>
          )}

          {analysisStatus === 'failed' && (
            <View style={[styles.failedCard, { backgroundColor: colors.surface, borderColor: '#ef4444' }]}>
              <Text style={[styles.failedTitle, { color: '#ef4444' }]}>Couldn&apos;t analyze this one</Text>
              <Text style={[styles.failedBody, { color: colors.text_primary }]}>
                {session.analysis_error ?? "I had trouble watching this one — could be lighting, angle, or video quality."}
              </Text>
              <View style={styles.failedBtnRow}>
                <TouchableOpacity
                  style={[styles.failedBtn, { borderColor: colors.accent, opacity: reanalyzing ? 0.5 : 1 }]}
                  onPress={onReanalyze}
                  disabled={reanalyzing}
                >
                  <Text style={[styles.failedBtnText, { color: colors.accent }]}>Try again with new analysis</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.failedBtn, { borderColor: colors.border }]}
                  onPress={() => router.replace('/swinglab/upload' as never)}
                >
                  <Text style={[styles.failedBtnText, { color: colors.text_muted }]}>Upload another</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Phase BW + 403b — per-swing list. Originally gated on
              session.shots.length > 1 so single-upload sessions saw only
              the session-level aggregate, but Phase 403b unhid this for
              single uploads too: a single-shot session with
              perShotAnalysis now shows its diagnostic row + the fault-
              frame thumbnail as visual evidence of the read. Multi-shot
              sessions keep their existing scroll-list-of-rows behavior. */}
          {session.shots.some(s => s.perShotAnalysis || s.clipStartSeconds != null) && (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>
                {isPickingCompareTarget
                  ? `PICK A SWING TO COMPARE`
                  : session.shots.length > 1
                    ? `${session.shots.length} SWINGS · TAP TO JUMP`
                    : `THIS SWING`}
              </Text>
              {session.shots.map((s, idx) => {
                const start = s.clipStartSeconds ?? 0;
                const a = s.perShotAnalysis;
                const issueLabel = a?.detected_issue && a.detected_issue !== 'none'
                  ? a.detected_issue.replace(/_/g, ' ')
                  : a
                    ? 'no clear issue'
                    : '—';
                const conf = a?.confidence ?? null;
                const isLeftPick = s.id === leftCompareShotId;
                const goodRepIcon: keyof typeof Ionicons.glyphMap | null =
                  s.isGoodRep === true ? 'star' :
                  s.isGoodRep === false ? 'close-circle-outline' : null;
                const noteIcon: keyof typeof Ionicons.glyphMap | null =
                  s.userNotes && s.userNotes.length > 0 ? 'document-text' : null;
                // Phase 403b — fault-frame visual evidence. When the
                // Phase K result included a visual_reference_path (a
                // JPEG persisted from the diagnostic frame), surface it
                // as a small thumbnail beside the row + a "See the
                // moment" tap target that opens the full-size modal
                // with the observation. Tolerates absence gracefully.
                const faultUri = a?.visual_reference_path ?? null;
                const observation = a?.observation ?? '';
                return (
                  <View key={s.id} style={[styles.shotRow, { borderColor: colors.border, opacity: isPickingCompareTarget && isLeftPick ? 0.4 : 1 }]}>
                    <TouchableOpacity
                      onPress={() => void handleRowTap(s)}
                      style={styles.shotRowTap}
                      disabled={isPickingCompareTarget && isLeftPick}
                    >
                      <Text style={[styles.shotIdx, { color: colors.accent }]}>
                        {String(idx + 1).padStart(2, '0')}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <View style={styles.shotIssueRow}>
                          <Text style={[styles.shotIssue, { color: colors.text_primary }]} numberOfLines={1}>
                            {issueLabel}
                          </Text>
                          {goodRepIcon && (
                            <Ionicons name={goodRepIcon} size={14} color={s.isGoodRep ? '#f59e0b' : colors.text_muted} />
                          )}
                          {noteIcon && (
                            <Ionicons name={noteIcon} size={13} color={colors.accent} />
                          )}
                        </View>
                        <Text style={[styles.shotMeta, { color: colors.text_muted }]} numberOfLines={1}>
                          {`${formatMmSs(start)}`}
                          {conf ? ` · ${conf} conf` : ''}
                          {s.detectionMethod ? ` · ${s.detectionMethod === 'audio_transient' ? 'auto' : 'manual'}` : ''}
                        </Text>
                        {observation && (
                          <Text style={[styles.shotObservation, { color: colors.text_muted }]} numberOfLines={2}>
                            {observation}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                    {faultUri && (
                      <TouchableOpacity
                        onPress={() => setFaultFrameModal({
                          uri: faultUri,
                          observation,
                          detected_issue: a?.detected_issue ?? null,
                        })}
                        style={styles.faultThumbWrap}
                        accessibilityRole="button"
                        accessibilityLabel="See the moment of the fault"
                      >
                        <Image source={{ uri: faultUri }} style={styles.faultThumb} resizeMode="cover" />
                        <View style={styles.faultThumbBadge}>
                          <Ionicons name="search" size={10} color="#ffffff" />
                        </View>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => setActionShotId(s.id)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      style={styles.shotActionBtn}
                    >
                      <Ionicons name="ellipsis-vertical" size={18} color={colors.text_muted} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* Phase BZ-v1 — single-shot Manage button. Multi-shot sessions
              expose Manage via the per-row "•••". Single-shot uploads need
              a dedicated affordance so users can still tag, note, share,
              and delete without a per-row list. */}
          {session.shots.length === 1 && shot && (
            <TouchableOpacity
              style={[styles.reanalyzeBtn, { borderColor: colors.border, marginTop: 8 }]}
              onPress={() => setActionShotId(shot.id)}
            >
              <Text style={[styles.reanalyzeText, { color: colors.text_muted }]}>Manage swing</Text>
            </TouchableOpacity>
          )}

          {analysisStatus === 'ok' && (
            <Animated.View style={{ opacity: cardsFade }}>
              {/* 2026-05-22 — PuttingLab card. Renders when the session
                  was classified as putting (analyzer-router routed it
                  through puttingAnalysisService). Granular grip /
                  stroke / read detail. */}
              {session.putting_analysis && (
                <PuttingAnalysisCard analysis={session.putting_analysis} />
              )}
              {/* 2026-05-23 (Fix #5) — PrimaryIssueCard renders on BOTH
                  putting AND full-swing sessions. For full swings it's
                  the Phase K classifier output (placeholder while
                  analysis is pending). For putting, it's the synthesized
                  overall-fault read built from the putting result
                  (services/puttingAnalysisService.synthesizePrimaryIssueFromPutting)
                  — closes the gap where glasses POV uploads showed
                  grip detail but no overall summary. We only suppress
                  it on putting sessions when the synthesis hasn't
                  landed yet, otherwise an empty "Analyzing..."
                  placeholder would appear next to the populated
                  putting card. */}
              {(!session.putting_analysis || session.primary_issue) && (
                <PrimaryIssueCard
                  issue={session.primary_issue ?? null}
                  totalShots={session.shots.length}
                />
              )}
              {/* 2026-06-02 — Fix GO: valid_swing safety net (Option C).
                  When the AI returned but said "inconclusive" or
                  "tentative_read", offer the user a re-analyze action
                  next to the read. Without this, the user sees "I
                  couldn't read this recording clearly" with no path
                  forward — the failed-card retry only fires when
                  analysis_status='failed', not when the analysis
                  succeeded but flagged the swing as unreadable.
                  Closes the "valid_swing=false silently suppresses
                  real reads" defect from the SwingLab audit. */}
              {analysisStatus === 'ok'
                && session.primary_issue
                && (session.primary_issue.primary_fault === 'inconclusive'
                  || session.primary_issue.issue_id === 'tentative_read')
                && (
                <View style={[styles.failedCard, { backgroundColor: colors.surface, borderColor: '#f59e0b', marginTop: 10 }]}>
                  <Text style={[styles.failedTitle, { color: '#f59e0b' }]}>Want a second look?</Text>
                  <Text style={[styles.failedBody, { color: colors.text_primary }]}>
                    Re-analyzing with a fresh pass sometimes catches what the first read missed — especially if the angle or lighting was borderline.
                  </Text>
                  <View style={styles.failedBtnRow}>
                    <TouchableOpacity
                      style={[styles.failedBtn, { borderColor: '#f59e0b', opacity: reanalyzing ? 0.5 : 1 }]}
                      onPress={onReanalyze}
                      disabled={reanalyzing}
                    >
                      <Text style={[styles.failedBtnText, { color: '#f59e0b' }]}>Re-analyze this swing</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {/* 2026-05-26 — Fix AT: Ask Your Swing card. Lives
                  directly under PrimaryIssue so the player can ask a
                  follow-up while the diagnosis is fresh. Renders only
                  when the session has a captured fault frame; gates
                  itself internally (no UI noise on un-analyzed
                  swings). Gemini-first Q&A — Bryson-DeChambeau-ad
                  parity with our caddie voice on top. */}
              <AskYourSwingCard session={session} />
              {/* 2026-05-23 (Fix #5) — DrillCard gated on
                  drill_recommendation being non-null for putting
                  sessions so no empty drill placeholder appears
                  alongside the putting + primary-issue cards.
                  Full-swing sessions keep the existing placeholder
                  rendering behavior (null → "Drill suggestions will
                  appear..."). */}
              {(!session.putting_analysis || session.drill_recommendation) && (
                <DrillCard recommendation={session.drill_recommendation ?? null} />
              )}

              {/* 2026-05-23 — Coach Note card. Lives alongside the AI
                  analysis (PrimaryIssue / Putting / Biomechanics) so
                  the coach's own observation reads side-by-side with
                  Kevin's read. Persisted via setSessionCoachNote on
                  cageStore; appears on the Coach Mode player swing
                  list too. Tank's "hips stalled at impact" lives
                  here. Visible on every swing detail — POV self
                  swings get it too if the user wants to journal. */}
              {/* 2026-05-27 — Fix EO: cage targeting card. Lets the
                  user mark where the ball sat and where they were
                  aiming, with optional one-tap auto-detect for the
                  ball position. Both flow through cageStore as
                  normalized coords; the overlay above the video
                  renders them on playback. */}
              <CageTargetingSlot session={session} />

              <CoachNoteCard
                sessionId={session.id}
                initialNote={session.coach_note ?? null}
              />

              {/* 2026-05-25 — Fix AJ Phase 2: spoken commentary card.
                  Whisper transcript of the recorded mp4's audio so the
                  user can see what they narrated ("this is Chris's
                  third swing, he's been pulling it left"). Brain picks
                  up the same transcript when the user asks about the
                  swing. Hides cleanly when no commentary captured
                  (silent clip, transcription pending, or transcribe
                  call failed). */}
              {(() => {
                const transcript = (shot.commentary_transcript ?? '').trim();
                if (!transcript) return null;
                return (
                  <View style={[commentaryStyles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <View style={commentaryStyles.headerRow}>
                      <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accent} />
                      <Text style={[commentaryStyles.label, { color: colors.accent }]}>YOUR COMMENTARY</Text>
                    </View>
                    <Text style={[commentaryStyles.body, { color: colors.text_primary }]}>{transcript}</Text>
                  </View>
                );
              })()}

              {/* Pose-derived biomechanics — only renders when the
                  pose API was configured AND returned at least one
                  usable frame, AND this is NOT a putting session
                  (those use PuttingAnalysisCard above). */}
              {session.biomechanics && !session.putting_analysis && (
                <View style={[styles.biomechCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.biomechLabel, { color: colors.accent }]}>BIOMECHANICS</Text>
                  <Text style={[styles.biomechSub, { color: colors.text_muted }]}>
                    Measured from {session.biomechanics.frames.length} swing keyframes
                  </Text>
                  {session.biomechanics.verdicts.hipTurn && (
                    <Text style={[styles.biomechRow, { color: colors.text_primary }]}>• {session.biomechanics.verdicts.hipTurn}</Text>
                  )}
                  {session.biomechanics.verdicts.shoulderTurn && (
                    <Text style={[styles.biomechRow, { color: colors.text_primary }]}>• {session.biomechanics.verdicts.shoulderTurn}</Text>
                  )}
                  {session.biomechanics.verdicts.weightShift && (
                    <Text style={[styles.biomechRow, { color: colors.text_primary }]}>• {session.biomechanics.verdicts.weightShift}</Text>
                  )}
                  {session.biomechanics.verdicts.posture && (
                    <Text style={[styles.biomechRow, { color: colors.text_primary }]}>• {session.biomechanics.verdicts.posture}</Text>
                  )}
                </View>
              )}
              <TouchableOpacity
                style={[styles.reanalyzeBtn, { borderColor: colors.border }]}
                onPress={onReanalyze}
                disabled={reanalyzing}
              >
                <Text style={[styles.reanalyzeText, { color: colors.text_muted }]}>Re-analyze with latest</Text>
              </TouchableOpacity>
              {/* 2026-05-23 — Auto-suggested comparisons.
                  Animated card: fade + slide-up entry when matches
                  land, ranked chips with a colored match badge (lime
                  / amber / red by tier). Each chip uses Pressable
                  with scale-down feedback on tap. Hidden when no
                  matches or still loading silently — never blocks
                  the reanalyze flow. */}
              {session.biomechanics && !session.putting_analysis && autoSuggestions && autoSuggestions.length > 0 && (
                <AutoSuggestCard
                  matches={autoSuggestions}
                  onSelect={onCompareToSelect}
                  colors={colors}
                />
              )}
              {/* Render legacy fallback path so existing layout flows
                  through. The original card structure has been replaced
                  by the component above — kept this section heading so
                  any diff readers can find the seam. */}
              {false && (
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.label, { color: colors.accent }]}>SUGGESTED COMPARISONS</Text>
                  <Text style={[styles.subtleHint, { color: colors.text_muted }]}>
                    Closest matches in your library. Tap to compare.
                  </Text>
                  <View style={styles.suggestRow}>
                    {autoSuggestions?.map((m) => (
                      <TouchableOpacity
                        key={m.reference.id}
                        onPress={() => onCompareToSelect(m)}
                        style={[styles.suggestChip, { borderColor: colors.accent }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Compare to ${m.reference.label} — ${m.similarity}% match`}
                      >
                        <Text style={[styles.suggestPct, { color: colors.accent }]} numberOfLines={1}>
                          {m.similarity}%
                        </Text>
                        <Text style={[styles.suggestName, { color: colors.text_primary }]} numberOfLines={1}>
                          {m.reference.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* 2026-05-22 — Phase 2 Compare action. Renders ONLY when
                  this is a full-swing session (not putting) with usable
                  biomechanics. Fires searchSimilarSwings → opens a
                  bottom-sheet picker (next sprint UI) OR auto-runs vs
                  tour-median archetype when no other refs exist. */}
              {session.biomechanics && !session.putting_analysis && (
                <TouchableOpacity
                  style={[styles.reanalyzeBtn, { borderColor: colors.accent, marginTop: 8 }]}
                  onPress={onCompareTo}
                  accessibilityRole="button"
                  accessibilityLabel="Compare this swing to a reference swing"
                >
                  <Text style={[styles.reanalyzeText, { color: colors.accent }]}>
                    ⇄  Compare to a reference swing
                  </Text>
                </TouchableOpacity>
              )}
            </Animated.View>
          )}
        </View>

        {/* Metadata */}
        {session.upload && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text_muted }]}>DETAILS</Text>
            <Text style={[styles.detailLine, { color: colors.text_primary }]}>Club: {session.club}</Text>
            {session.upload.swinger ? (
              <Text style={[styles.detailLine, { color: colors.text_primary }]}>Swinger: {session.upload.swinger}</Text>
            ) : null}
            {session.upload.tag ? (
              <Text style={[styles.detailLine, { color: colors.text_primary }]}>Tag: {session.upload.tag}</Text>
            ) : null}
            {duration != null ? (
              <Text style={[styles.detailLine, { color: colors.text_muted }]}>Duration: {duration.toFixed(1)}s · Position: {position.toFixed(1)}s</Text>
            ) : null}
          </View>
        )}

        {/* Phase BZ-v1 — selected-shot user note display. Surfaces the
            note prominently so the user sees their own annotation without
            opening the action sheet. */}
        {actionShot?.userNotes && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text_muted }]}>NOTE</Text>
            <Text style={[styles.detailLine, { color: colors.text_primary }]}>{actionShot.userNotes}</Text>
          </View>
        )}
      </ScrollView>

      <SwingActionSheet
        visible={actionShotId != null}
        shot={actionShot}
        sessionId={session.id}
        onClose={() => setActionShotId(null)}
        onStartCompare={handleStartCompare}
        multiShotSessionAvailable={session.shots.length > 1}
      />

      {/* 2026-05-22 — Compare-to-Reference picker. Replaces the toast-only
          flow with a ranked bottom-sheet list. onSelect runs the actual
          swingComparisonEngine pass. */}
      <CompareReferencePickerSheet
        visible={compareSheetOpen}
        current={currentPoseForCompare}
        clubFilter={session.club ?? null}
        onClose={() => setCompareSheetOpen(false)}
        onSelect={onCompareToSelect}
        onAddReference={onAddReferenceFromSheet}
      />

      {/* 2026-05-23 — Visual comparison result sheet. Slides up after
          compareSwings resolves; shows side-by-side per-metric bars +
          top takeaways + voice summary. Closes via scrim tap, the
          Done button, or "Compare another" which re-opens the picker. */}
      <ComparisonResultSheet
        visible={comparisonResult != null}
        result={comparisonResult?.result ?? null}
        reference={comparisonResult?.reference ?? null}
        onClose={() => setComparisonResult(null)}
        onCompareAnother={() => {
          setComparisonResult(null);
          setCompareSheetOpen(true);
        }}
      />

      {/* Phase 403b + 404 — "See the moment" modal. Shows the
          diagnostic frame full-size with the observation overlaid as a
          caption. Phase 404: when a reference illustration is
          registered for the fault category, also renders the reference
          side-by-side with a position label and the per-category
          callout. When no reference exists (the default until Tim
          drops in licensed assets), falls back to the single-frame
          layout — no regression. Tap anywhere to dismiss. */}
      <Modal
        visible={faultFrameModal != null}
        transparent
        animationType="fade"
        onRequestClose={() => setFaultFrameModal(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.faultModalBackdrop}
          onPress={() => setFaultFrameModal(null)}
          accessibilityRole="button"
          accessibilityLabel="Close fault frame view"
        >
          {faultFrameModal && (() => {
            const reference = getSwingReference(faultFrameModal.detected_issue);
            const hasReference = reference != null;
            return (
              <View style={styles.faultModalContent}>
                {hasReference ? (
                  <View style={styles.faultModalSideBySide}>
                    <View style={styles.faultModalPane}>
                      <Text style={styles.faultModalPaneLabel}>YOUR SWING</Text>
                      <Image
                        source={{ uri: faultFrameModal.uri }}
                        style={styles.faultModalPaneImage}
                        resizeMode="cover"
                      />
                    </View>
                    <View style={styles.faultModalPane}>
                      <Text style={[styles.faultModalPaneLabel, styles.faultModalPaneLabelRef]}>
                        REFERENCE{reference.position ? ` · ${reference.position.toUpperCase()}` : ''}
                      </Text>
                      <Image
                        source={reference.image as NonNullable<typeof reference.image>}
                        style={styles.faultModalPaneImage}
                        resizeMode="cover"
                      />
                    </View>
                  </View>
                ) : (
                  <Image
                    source={{ uri: faultFrameModal.uri }}
                    style={styles.faultModalImage}
                    resizeMode="contain"
                  />
                )}
                {faultFrameModal.observation ? (
                  <View style={styles.faultModalCaption}>
                    <Text style={styles.faultModalCaptionText}>
                      {faultFrameModal.observation}
                    </Text>
                  </View>
                ) : null}
                {hasReference && reference.callout ? (
                  <View style={[styles.faultModalCaption, styles.faultModalCalloutRef]}>
                    <Text style={[styles.faultModalCaptionText, styles.faultModalCalloutRefText]}>
                      {reference.callout}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.faultModalCloseHint}>
                  <Text style={styles.faultModalCloseHintText}>Tap to close</Text>
                </View>
              </View>
            );
          })()}
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

/**
 * 2026-05-27 — Fix EO: Cage Targeting card wrapper. Self-contained
 * slot that subscribes to the session's ball_area_norm + target_norm,
 * wires the setters, and handles the Phase 2 auto-detect call to the
 * server. Kept as its own function so the parent screen stays clean.
 *
 * Auto-detect flow: send the address frame (fault_frame_uri preferred,
 * thumbnail_uri fallback) as base64 to /api/swing-analysis with
 * mode='detect_ball'. Server runs Claude Haiku vision and returns
 * normalized x/y/r. We commit that as the ball area. If detection
 * fails (no ball found, server error), we just leave the area unset
 * and the user can tap-place manually.
 */
function CageTargetingSlot({ session }: { session: import('../../../store/cageStore').CageSession }) {
  const { colors } = useTheme();
  const setBallArea = useCageStore(s => s.setSessionBallArea);
  const setTarget = useCageStore(s => s.setSessionTarget);
  const [autoDetecting, setAutoDetecting] = React.useState(false);

  // Address frame source — fault frame is the best available shot of
  // the address position; thumbnail is the next-best fallback. When
  // both are missing the card still renders, but the Set buttons are
  // disabled (we don't have a frame to tap on).
  const frameUri =
    session.fault_frame_uri ??
    session.primary_issue?.visual_reference_path ??
    session.shots.find(s => s.perShotAnalysis?.visual_reference_path)?.perShotAnalysis?.visual_reference_path ??
    null;

  const autoDetect = async () => {
    if (!frameUri) return;
    setAutoDetecting(true);
    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
      const FS = await import('expo-file-system/legacy');
      const b64 = await FS.readAsStringAsync(frameUri, { encoding: FS.EncodingType.Base64 });
      const res = await fetch(`${apiUrl}/api/swing-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'detect_ball',
          frames: [{ b64, media_type: 'image/jpeg' }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json()) as { found?: boolean; x?: number; y?: number; r?: number };
      if (data.found && typeof data.x === 'number' && typeof data.y === 'number') {
        setBallArea(session.id, { x: data.x, y: data.y, r: typeof data.r === 'number' ? data.r : 0.06 });
        useToastStore.getState().show('Ball detected ✓');
      } else {
        useToastStore.getState().show('Couldn’t find the ball — tap to place manually.');
      }
    } catch (e) {
      console.log('[cage-targeting] auto-detect failed', e);
      useToastStore.getState().show('Detection failed — tap to place manually.');
    } finally {
      setAutoDetecting(false);
    }
  };

  return (
    <CageTargetingCard
      colors={colors}
      frameUri={frameUri}
      ballArea={session.ball_area_norm ?? null}
      target={session.target_norm ?? null}
      onChangeBallArea={(a) => setBallArea(session.id, a)}
      onChangeTarget={(t) => setTarget(session.id, t)}
      onAutoDetectBall={frameUri ? autoDetect : undefined}
      autoDetecting={autoDetecting}
    />
  );
}

/**
 * 2026-05-23 — Coach Note card. Inline-editable text area persisted
 * via setSessionCoachNote. Closes Coach Mode's loop: pro watches the
 * swing, AI analysis lands, pro reads the AI fault + adds their own
 * note ("hips stalled at impact"), both live alongside on the swing
 * detail surface and on Coach Mode's per-player list.
 *
 * Editing model: tap into the text area to edit (controlled local
 * state); tap Save to commit. Cancel reverts to the persisted note.
 * Empty save clears the note (setSessionCoachNote treats empty/null
 * as a delete).
 */
function CoachNoteCard({ sessionId, initialNote }: { sessionId: string; initialNote: string | null }) {
  const { colors } = useTheme();
  const setSessionCoachNote = useCageStore(s => s.setSessionCoachNote);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(initialNote ?? '');
  // 2026-05-25 — Voice capture state. The mic button starts a
  // captureUtterance recording (12s ceiling); a second tap calls
  // stopCapture which short-circuits the wait inside captureUtterance
  // so transcription fires immediately. Transcript is APPENDED to the
  // current draft so a coach can dictate multiple snippets before save.
  const [recording, setRecording] = React.useState(false);
  const language = useSettingsStore(s => s.language);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // Sync local draft to persisted note if it changes externally (e.g.
  // user navigated away and back, or another surface updated it).
  React.useEffect(() => {
    if (!editing) setDraft(initialNote ?? '');
  }, [initialNote, editing]);

  const onSave = () => {
    setSessionCoachNote(sessionId, draft);
    setEditing(false);
  };

  const onCancel = () => {
    setDraft(initialNote ?? '');
    setEditing(false);
  };

  const onMicTap = async () => {
    if (recording) {
      // Stop the in-flight capture; the awaiting promise resolves with
      // whatever transcript the server returns for the partial buffer.
      void stopCapture();
      return;
    }
    if (!editing) setEditing(true);
    setRecording(true);
    try {
      const transcript = await captureUtterance(12_000, apiUrl, language);
      if (transcript && transcript.trim().length > 0) {
        setDraft(prev => {
          const sep = prev && !prev.endsWith(' ') ? ' ' : '';
          return prev + sep + transcript.trim();
        });
      }
    } catch (e) {
      console.log('[coach-note] voice capture failed:', e);
    } finally {
      setRecording(false);
    }
  };

  if (!editing && !initialNote) {
    return (
      <View
        style={[coachNoteStyles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
      >
        <View style={coachNoteStyles.headerRow}>
          <Ionicons name="create-outline" size={16} color={colors.accent} />
          <Text style={[coachNoteStyles.label, { color: colors.accent }]}>COACH NOTE</Text>
        </View>
        <Text style={[coachNoteStyles.placeholder, { color: colors.text_muted }]}>
          Type or speak your read — &ldquo;hips stalled at impact&rdquo;, &ldquo;came over the top&rdquo;.
        </Text>
        <View style={coachNoteStyles.entryRow}>
          <TouchableOpacity
            onPress={() => setEditing(true)}
            style={[coachNoteStyles.entryBtn, { borderColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Type a coach note"
          >
            <Ionicons name="keypad-outline" size={16} color={colors.accent} />
            <Text style={[coachNoteStyles.entryBtnText, { color: colors.accent }]}>Type</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { void onMicTap(); }}
            style={[
              coachNoteStyles.entryBtn,
              { borderColor: recording ? '#ef4444' : colors.accent, backgroundColor: recording ? '#ef444422' : 'transparent' },
            ]}
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording' : 'Record a coach note'}
          >
            <Ionicons name={recording ? 'stop-circle' : 'mic'} size={16} color={recording ? '#ef4444' : colors.accent} />
            <Text style={[coachNoteStyles.entryBtnText, { color: recording ? '#ef4444' : colors.accent }]}>
              {recording ? 'Stop' : 'Speak'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!editing) {
    return (
      <TouchableOpacity
        onPress={() => setEditing(true)}
        style={[coachNoteStyles.card, { borderColor: colors.accent, backgroundColor: colors.surface }]}
        accessibilityRole="button"
        accessibilityLabel="Edit coach note"
      >
        <View style={coachNoteStyles.headerRow}>
          <Ionicons name="create-outline" size={16} color={colors.accent} />
          <Text style={[coachNoteStyles.label, { color: colors.accent }]}>COACH NOTE</Text>
        </View>
        <Text style={[coachNoteStyles.body, { color: colors.text_primary }]}>{initialNote}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[coachNoteStyles.card, { borderColor: colors.accent, backgroundColor: colors.surface }]}>
      <View style={coachNoteStyles.headerRow}>
        <Ionicons name="create-outline" size={16} color={colors.accent} />
        <Text style={[coachNoteStyles.label, { color: colors.accent }]}>COACH NOTE</Text>
      </View>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Your read on the swing — say it like you'd say it to the player."
        placeholderTextColor={colors.text_muted}
        multiline
        autoFocus
        style={[
          coachNoteStyles.input,
          { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary },
        ]}
      />
      <View style={coachNoteStyles.actionsRow}>
        <TouchableOpacity onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[coachNoteStyles.cancelText, { color: colors.text_muted }]}>Cancel</Text>
        </TouchableOpacity>
        <View style={coachNoteStyles.actionsRight}>
          <TouchableOpacity
            onPress={() => { void onMicTap(); }}
            style={[
              coachNoteStyles.micBtn,
              { borderColor: recording ? '#ef4444' : colors.accent, backgroundColor: recording ? '#ef444422' : 'transparent' },
            ]}
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording' : 'Record more'}
          >
            <Ionicons name={recording ? 'stop-circle' : 'mic'} size={18} color={recording ? '#ef4444' : colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onSave}
            style={[coachNoteStyles.saveBtn, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Save coach note"
          >
            <Text style={coachNoteStyles.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// 2026-05-25 — Fix AJ Phase 2: styles for the commentary card.
// Mirrors coachNote sizing but distinct color so the two read as
// separate signals (coach note = authored, commentary = transcribed).
const commentaryStyles = StyleSheet.create({
  card: { margin: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  label: { fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  body: { fontSize: 14, lineHeight: 21, fontStyle: 'italic' },
});

const coachNoteStyles = StyleSheet.create({
  card: {
    margin: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  label: { fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  placeholder: { fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  body: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cancelText: { fontSize: 13, fontWeight: '700' },
  saveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  saveBtnText: { color: '#0d1a0d', fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  entryRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  entryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  entryBtnText: { fontSize: 13, fontWeight: '700' },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingBottom: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  back: { fontSize: 16, fontWeight: '600', width: 60 },
  title: { fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  // 2026-05-17 — bumped from maxHeight 460 to 640 so the video reads as
  // the hero of the screen instead of a postage stamp. Tim's "video takes
  // half the screen in Pro vs V3 full screen" feedback.
  // 2026-05-26 — Fix AW: Z Fold open showed the video left-aligned in
  // a narrow ~360px column with the right ⅔ of the screen empty. With
  // width 100% + aspect 9/16 + maxHeight 640, the maxHeight clamp
  // forced effective width to ~360px on landscape — but no maxWidth +
  // no alignSelf left it sitting flush-left in a 2200px container.
  // Adding maxWidth: 360 (9/16 of maxHeight) + alignSelf: 'center'
  // makes the video CENTER itself on wide form factors instead of
  // pinning to the left. Phone-portrait is unchanged (width 100% +
  // 9/16 aspect produces a frame narrower than 360 anyway).
  videoWrap: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 640,
    maxWidth: 360,
    alignSelf: 'center',
    backgroundColor: '#000',
  },
  video: { width: '100%', height: '100%' },
  toggleRow: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 12, padding: 4,
    borderRadius: 999, borderWidth: 1,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 999 },
  toggleText: { fontSize: 13, fontWeight: '700', color: '#9ca3af' },
  card: {
    marginHorizontal: 16, marginTop: 12, padding: 14,
    borderRadius: 14, borderWidth: 1,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  tsPill: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, marginRight: 8,
  },
  tsText: { fontSize: 13, fontWeight: '700' },
  tsHint: { fontSize: 11, marginTop: 8 },
  detailLine: { fontSize: 14, marginTop: 6 },
  // Phase BW — per-swing list rows
  shotRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  shotIdx: {
    fontSize: 13, fontWeight: '900', minWidth: 24,
  },
  shotIssue: { fontSize: 14, fontWeight: '600', textTransform: 'capitalize', flexShrink: 1 },
  shotIssueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shotMeta: { fontSize: 11, marginTop: 2 },
  shotChev: { fontSize: 22, fontWeight: '300', width: 14, textAlign: 'right' },
  shotRowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 4 },
  shotActionBtn: { padding: 6 },
  // Phase 403b — observation line under the shot's issue label. Two
  // lines max; readers get the analyst's specific sentence without
  // needing to open a detail card.
  shotObservation: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  // Phase 403b — fault-frame thumbnail (visual evidence). Tappable to
  // open the full-size modal. Small magnifier badge in the corner
  // signals interactivity.
  faultThumbWrap: {
    width: 52, height: 52, borderRadius: 8, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(0,200,150,0.4)',
    position: 'relative',
  },
  faultThumb: { width: '100%', height: '100%' },
  faultThumbBadge: {
    position: 'absolute', bottom: 2, right: 2,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 999, width: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  // Phase 403b — "See the moment" full-size modal.
  faultModalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.93)',
    alignItems: 'center', justifyContent: 'center',
    padding: 16,
  },
  faultModalContent: {
    width: '100%', maxWidth: 640,
    alignItems: 'center', gap: 12,
  },
  faultModalImage: {
    width: '100%', aspectRatio: 1024 / 768,
    maxHeight: 480,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,200,150,0.4)',
  },
  // Phase 404 — side-by-side comparison (user's fault frame + reference
  // illustration). Each pane sizes to half the container width with a
  // small gutter; aspect ratio preserved via the pane image's own
  // aspect rule so the modal doesn't squish portrait phone-camera
  // captures into a landscape pane.
  faultModalSideBySide: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  faultModalPane: {
    flex: 1,
    gap: 6,
  },
  faultModalPaneLabel: {
    color: '#00C896',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
    textAlign: 'center',
  },
  faultModalPaneLabelRef: {
    color: '#fbbf24',
  },
  faultModalPaneImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: 420,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.4)',
    backgroundColor: '#000',
  },
  // Phase 404 — reference callout caption (amber) distinguished from
  // the observation caption (green) so the two messages don't blur.
  faultModalCalloutRef: {
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderColor: 'rgba(251,191,36,0.5)',
  },
  faultModalCalloutRefText: {
    color: '#fbbf24',
  },
  faultModalCaption: {
    backgroundColor: 'rgba(0,200,150,0.10)',
    borderColor: 'rgba(0,200,150,0.5)',
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  faultModalCaptionText: {
    color: '#e8f5e9', fontSize: 14, fontWeight: '600',
    textAlign: 'center', lineHeight: 20,
  },
  faultModalCloseHint: {
    paddingVertical: 6, paddingHorizontal: 12,
  },
  faultModalCloseHintText: {
    color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 1,
  },
  // Phase BZ-v1 — comparison view styles
  compareBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  compareBannerText: { fontSize: 13, fontWeight: '600', flex: 1 },
  compareBannerCancel: { fontSize: 13, fontWeight: '800' },
  compareCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  compareHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  compareLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  compareExit: { fontSize: 13, fontWeight: '800' },
  compareRow: { flexDirection: 'row', gap: 6 },
  comparePane: { flex: 1, gap: 4 },
  compareCaption: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  compareVideo: { width: '100%', aspectRatio: 9 / 16, maxHeight: 360, backgroundColor: '#000' },
  compareControls: { flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'center' },
  compareCtrl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  compareCtrlText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  analyzingCard: {
    marginHorizontal: 16, padding: 16, borderRadius: 14, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  analyzingText: { fontSize: 14, fontWeight: '700' },
  analyzingSub: { fontSize: 12, marginTop: 4 },
  failedCard: {
    marginHorizontal: 16, padding: 16, borderRadius: 14, borderWidth: 1,
    gap: 8,
  },
  failedTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  failedBody: { fontSize: 14, lineHeight: 20 },
  failedBtnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 },
  failedBtn: {
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1.5,
  },
  failedBtnText: { fontSize: 13, fontWeight: '800' },
  reanalyzeBtn: {
    marginHorizontal: 16, marginTop: 12,
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1,
    alignSelf: 'flex-start',
  },
  reanalyzeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  biomechCard: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    padding: 14, borderRadius: 12, borderWidth: 1,
    gap: 6,
  },
  biomechLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  biomechSub: { fontSize: 11, fontStyle: 'italic', marginBottom: 4 },
  biomechRow: { fontSize: 13, lineHeight: 19 },
  // 2026-05-23 — Auto-suggest comparison card styles.
  subtleHint: { fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  suggestRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
  },
  suggestPct: { fontSize: 13, fontWeight: '900' },
  suggestName: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
});

// 2026-05-23 — Polished auto-suggest card. Fades in + slides up on
// mount, ranked chips with tier-colored match badge (lime ≥80,
// lime-green ≥60, amber ≥40, red below). Each chip uses Pressable
// with a scale-down + opacity feedback on press. Top match also
// gets a small "best match" tag.
function AutoSuggestCard({
  matches,
  onSelect,
  colors,
}: {
  matches: SimilarMatch[];
  onSelect: (m: SimilarMatch) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, slide, matches.length]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: fade,
          transform: [{ translateY: slide }],
        },
      ]}
    >
      <View style={autoSuggestStyles.headerRow}>
        <Text style={[styles.label, { color: colors.accent }]}>SUGGESTED COMPARISONS</Text>
        <View style={[autoSuggestStyles.countPill, { borderColor: colors.border }]}>
          <Text style={[autoSuggestStyles.countText, { color: colors.text_muted }]}>
            {matches.length} {matches.length === 1 ? 'MATCH' : 'MATCHES'}
          </Text>
        </View>
      </View>
      <Text style={[styles.subtleHint, { color: colors.text_muted }]}>
        Closest references in your library. Tap to see side-by-side.
      </Text>
      <View style={autoSuggestStyles.chipColumn}>
        {matches.map((m, i) => (
          <AutoSuggestChip
            key={m.reference.id}
            match={m}
            isBest={i === 0}
            onPress={() => onSelect(m)}
            colors={colors}
          />
        ))}
      </View>
    </Animated.View>
  );
}

function AutoSuggestChip({
  match,
  isBest,
  onPress,
  colors,
}: {
  match: SimilarMatch;
  isBest: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const press = useRef(new Animated.Value(0)).current;
  const onPressIn = () => {
    Animated.timing(press, { toValue: 1, duration: 100, useNativeDriver: true }).start();
  };
  const onPressOut = () => {
    Animated.timing(press, { toValue: 0, duration: 140, useNativeDriver: true }).start();
  };

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });
  const opacity = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });

  const tierColor =
    match.similarity >= 80 ? '#86efac' :
    match.similarity >= 60 ? '#a3e635' :
    match.similarity >= 40 ? '#fbbf24' :
                             '#f87171';

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={`Compare to ${match.reference.label} — ${match.similarity}% match`}
    >
      <Animated.View
        style={[
          autoSuggestStyles.chip,
          {
            backgroundColor: colors.background,
            borderColor: isBest ? tierColor : colors.border,
            borderWidth: isBest ? 1.5 : 1,
            opacity,
            transform: [{ scale }],
          },
        ]}
      >
        <View style={[autoSuggestStyles.pctBadge, { borderColor: tierColor }]}>
          <Text style={[autoSuggestStyles.pctValue, { color: tierColor }]}>
            {match.similarity}
          </Text>
          <Text style={[autoSuggestStyles.pctUnit, { color: tierColor }]}>%</Text>
        </View>
        <View style={autoSuggestStyles.chipBody}>
          <View style={autoSuggestStyles.chipTitleRow}>
            <Text style={[autoSuggestStyles.chipTitle, { color: colors.text_primary }]} numberOfLines={1}>
              {match.reference.label}
            </Text>
            {isBest ? (
              <View style={[autoSuggestStyles.bestTag, { borderColor: tierColor }]}>
                <Text style={[autoSuggestStyles.bestTagText, { color: tierColor }]}>BEST</Text>
              </View>
            ) : null}
          </View>
          {match.takeaways[0] ? (
            <Text style={[autoSuggestStyles.chipTakeaway, { color: colors.text_secondary }]} numberOfLines={2}>
              {match.takeaways[0]}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.text_muted} />
      </Animated.View>
    </Pressable>
  );
}

const autoSuggestStyles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countPill: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  countText: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  chipColumn: { gap: 8, marginTop: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  pctBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1.5,
    minWidth: 50,
    justifyContent: 'center',
  },
  pctValue: { fontSize: 16, fontWeight: '900', lineHeight: 18 },
  pctUnit: { fontSize: 9, fontWeight: '900', marginLeft: 1 },
  chipBody: { flex: 1, gap: 3 },
  chipTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipTitle: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
  bestTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  bestTagText: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  chipTakeaway: { fontSize: 11, lineHeight: 15 },
});
