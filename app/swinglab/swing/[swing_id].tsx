/**
 * Phase R — Uploaded swing detail surface.
 *
 * Loads a session by id, plays the swing video, lets the user toggle
 * between embedded coach audio (if present) and Kevin's analysis voice.
 * Shows PrimaryIssueCard + DrillCard with timestamp anchors that scrub
 * the video to the detected moment.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Animated, Alert, Image, Modal,
  Pressable, Easing, PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Video, ResizeMode, type AVPlaybackStatus, type AVPlaybackStatusSuccess } from 'expo-av';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
// 2026-07-21 (BETA — swing-replay crash class) — route frame extraction through the single-flight
// queue wrapper (a drop-in re-export of expo-video-thumbnails) instead of the raw module, so this
// screen's grab-frame can never spin up a retriever concurrent with another extraction.
import * as VideoThumbnails from '../../../utils/videoThumbnail';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import SwingAnalysisSteps from '../../../components/swinglab/SwingAnalysisSteps';
import { useCageStore, OTHER_PLAYER_ID, type AnalysisStatus, type CageShot } from '../../../store/cageStore';
import { useToastStore } from '../../../store/toastStore';
import { usePlayerProfileStore } from '../../../store/playerProfileStore';
import { useFamilyStore } from '../../../store/familyStore';
import { exportCoachReport } from '../../../services/coachReport';
import { getCaptureKind, isPuttingSession } from '../../../services/swingLibrary';
import { getSwingReference } from '../../../services/swingReferences';
import { useTrustLevelStore } from '../../../store/trustLevelStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { speak, speakChunked, warmVoice, stopSpeaking, configureAudioForSpeech, captureUtterance, stopCapture } from '../../../services/voiceService';
import { runPhaseKOnSession, resolveClipUri, resolveImageUri } from '../../../services/videoUpload';
import { detectClubPath } from '../../../services/swing/clubPath';
// 2026-06-23 — Fix: the swing-detail DrillCard showed the "appear once analysis
// is available" placeholder even when analysis SUCCEEDED with a detected fault,
// because it read only the separately-stored session.drill_recommendation (null
// for sessions whose rec was never persisted). Compute the rec from the analysis'
// primary_issue.issue_id as a fallback, mirroring videoUpload.ts exactly.
import { recommendDrill } from '../../../services/drillRecommendation';
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
import SwingBodyOverlay, { faultJointsFor } from '../../../components/swinglab/SwingBodyOverlay';
import { useSwingStillCapture } from '../../../components/swinglab/SwingStillComposite';
import { BodyAnalysisRow, TempoBar, type BodyItem } from '../../../components/smartmotion/SmartMotionHud';
import VideoWatermark from '../../../components/swinglab/VideoWatermark';
import CompareReferencePickerSheet from '../../../components/swinglab/CompareReferencePickerSheet';
import ComparisonResultSheet from '../../../components/swinglab/ComparisonResultSheet';
import type { SimilarMatch, ReferenceSwing } from '../../../services/swingDatabase';
import type { PoseEstimate } from '../../../services/poseEstimator';
import type { SwingComparison } from '../../../services/swingComparisonEngine';
import { getApiBaseUrl } from '../../../services/apiBase';

// 2026-06-12 — shared Smart Motion control badges, so Library video controls match
// the SmartMotion review badges (whole-app control consistency).
const ICON_CTRL = {
  playpause: require('../../../assets/icons/smartmotion/ctrl-playpause.png'),
  slowmo: require('../../../assets/icons/smartmotion/ctrl-slowmo.png'),
};

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
  // 2026-06-15 (Tim) — the swing LIBRARY is MANUAL: an upload verifies + lands
  // STATIC; the USER initiates analysis (and biomech/mechanics) via the Analyze
  // button. No auto-analyze/auto-biomech on open — that was the on-open
  // re-processing + racing. This flag gates every auto-process-on-open path; the
  // explicit Analyze/Re-analyze button (onReanalyze) is the only trigger.
  const LIBRARY_AUTO_PROCESS = false;
  const analyzeInFlightRef = useRef(false);
  const watchFiredRef = useRef(false);
  const trustLevel = useTrustLevelStore(s => s.level);
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  // 2026-05-28 — Fix FI: caddie persona for presence brain calls.
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const apiUrl = getApiBaseUrl();

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

  // 2026-06-23 (Tim — "always able to TOUCH and correct who hit this swing")
  // — golfer attribution editor. The session.player_id resolves to a display
  // name: a family member's firstName, or "You" for the account holder
  // (email / 'account_holder' fallback). Subscribed reactively so adding a
  // golfer or reassigning re-renders the chip immediately.
  const familyMembers = useFamilyStore(s => s.members);
  const profileEmail = usePlayerProfileStore(s => s.email);
  const familyAddMember = useFamilyStore(s => s.addMember);
  const [golferSheetOpen, setGolferSheetOpen] = useState(false);
  const [addGolferOpen, setAddGolferOpen] = useState(false);
  const [newGolferName, setNewGolferName] = useState('');
  // The value derivePlayerId() yields for the account holder when no family
  // member is active: lowercased profile email, else 'account_holder'. Reused
  // verbatim (no hardcoded 'account_holder' when an email exists) so the "You"
  // row writes the SAME id ingest would have stamped.
  const accountHolderPlayerId = useMemo(
    () => (profileEmail && profileEmail.trim().length > 0 ? profileEmail.trim().toLowerCase() : 'account_holder'),
    [profileEmail],
  );
  const currentPlayerId = session?.player_id ?? accountHolderPlayerId;
  // Resolve player_id → display name. A family member id matches a roster
  // entry (firstName); 'account_holder' or any email = "You".
  const golferDisplayName = useMemo(() => {
    const member = familyMembers.find(m => m.id === currentPlayerId);
    if (member) return member.firstName;
    return 'You';
  }, [familyMembers, currentPlayerId]);
  const activeGolfers = useMemo(
    () => familyMembers.filter(m => !m.archived).sort((a, b) => a.added_at - b.added_at),
    [familyMembers],
  );
  const assignGolfer = useCallback((playerId: string) => {
    if (!swing_id) return;
    useCageStore.getState().setSessionPlayer(swing_id, playerId);
    setGolferSheetOpen(false);
    setAddGolferOpen(false);
    setNewGolferName('');
  }, [swing_id]);
  const onAddGolferSubmit = useCallback(() => {
    const name = newGolferName.trim();
    if (!name) return;
    // addMember requires the full FamilyMember shape minus id/timestamps/archived.
    // Sensible neutral defaults — this is a quick "+ Add golfer" from the swing
    // editor, not the full Family roster form; the user can flesh out details in
    // Settings → Family later.
    const newId = familyAddMember({
      firstName: name,
      relationship: 'other',
      age: null,
      skillLevel: 'developing',
      handedness: 'unknown',
      approximate_handicap: null,
      avatar_emoji: '🏌️',
    });
    assignGolfer(newId);
  }, [newGolferName, familyAddMember, assignGolfer]);

  // 2026-06-23 (Tim — "still can't play my swing library videos") — resolve the
  // stored clipUri to a path that exists under the CURRENT app container before
  // handing it to <Video>. Persisted absolute paths break when iOS regenerates
  // the container UUID on a native build/reinstall; resolveClipUri re-anchors the
  // basename under the live documentDirectory. Falls back to the raw clipUri
  // while resolving so first paint isn't blocked.
  const [playbackUri, setPlaybackUri] = useState<string | null>(shot?.clipUri ?? null);
  // 2026-06-23 (Tim — "NONE of them play") — surface the actual reason on screen
  // instead of a silent black frame, so a real failure (codec / missing file /
  // expo-av error) is visible + reportable rather than a guess.
  const [videoError, setVideoError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const raw = shot?.clipUri ?? null;
    setPlaybackUri(raw);
    setVideoError(null);
    if (raw && raw.startsWith('file://')) {
      void resolveClipUri(raw).then((r) => {
        if (cancelled) return;
        if (r) setPlaybackUri(r);
        else setVideoError('Video file not found on this device.');
      });
    }
    return () => { cancelled = true; };
  }, [shot?.clipUri]);

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
  // 2026-06-23 (RP-1) — compare panes must re-anchor stored clipUris too, exactly
  // like the main player (lines ~139-152). Without this, persisted absolute paths
  // break after iOS regenerates the container UUID on reinstall and both compare
  // panes render black while the main player works.
  const [leftPlaybackUri, setLeftPlaybackUri] = useState<string | null>(null);
  const [rightPlaybackUri, setRightPlaybackUri] = useState<string | null>(null);
  // 2026-05-22 — Compare-to-Reference picker sheet open/close.
  const [compareSheetOpen, setCompareSheetOpen] = useState(false);
  // 2026-06-14 (Tim — bilateral) — link a SECOND ANGLE of the same swing. Picks
  // another library swing → opens the bilateral read (one DTL + one face-on).
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const allSessions = useCageStore(s => s.sessionHistory);
  const otherSessions = useMemo(
    () => allSessions.filter(x => x.id !== swing_id).slice(0, 30),
    [allSessions, swing_id],
  );
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

  // 2026-06-23 (RP-1) — re-anchor each compare pane's clipUri, mirroring the main
  // player's resolve pattern (lines ~139-152) so reinstalled containers don't black out.
  useEffect(() => {
    let cancelled = false;
    const raw = leftShot?.clipUri ?? null;
    setLeftPlaybackUri(raw);
    if (raw && raw.startsWith('file://')) {
      void resolveClipUri(raw).then((r) => {
        if (cancelled) return;
        if (r) setLeftPlaybackUri(r);
      });
    }
    return () => { cancelled = true; };
  }, [leftShot?.clipUri]);
  useEffect(() => {
    let cancelled = false;
    const raw = rightShot?.clipUri ?? null;
    setRightPlaybackUri(raw);
    if (raw && raw.startsWith('file://')) {
      void resolveClipUri(raw).then((r) => {
        if (cancelled) return;
        if (r) setRightPlaybackUri(r);
      });
    }
    return () => { cancelled = true; };
  }, [rightShot?.clipUri]);

  const videoRef = useRef<Video>(null);
  // 2026-06-11 (Tim: no slow-mo controls in the library) — declarative slow-mo
  // for swing review. The `rate` prop survives native play/pause; the corner
  // button cycles ½× → ¼× → 1× → ½×.
  // 2026-07-14 (Tim) — DEFAULT to slow-mo (½×) on first view: the first pass reads easier and
  // helps analysis; the player still cycles up to full speed.
  const [playbackRate, setPlaybackRate] = useState(0.5);
  const cycleSlowMo = () => setPlaybackRate((r) => (r === 1 ? 0.5 : r === 0.5 ? 0.25 : 1));
  const leftCompareVideoRef = useRef<Video>(null);
  const rightCompareVideoRef = useRef<Video>(null);
  // Phase V.7+ — default to Kevin analysis. The has_audio probe in
  // videoUpload.probeVideo is unreliable (it returns true for any video with
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(session?.upload?.duration_sec ?? null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [seekBarW, setSeekBarW] = useState(0);
  // 2026-06-11 — tap the video to play/pause (Tim: intuitive, not hunting for the
  // button below + catching it in time). Single-tap routes through ZoomableView
  // (composed under double-tap-reset + pinch/pan), so zoom/annotation stay intact.
  const togglePlayPause = useCallback(async () => {
    // Read LIVE status (not the closure `isPlaying`) so a tap is never stale —
    // robust regardless of when the last status update landed (audit 2026-06-11).
    const v = videoRef.current;
    if (!v) return;
    try {
      const st = await v.getStatusAsync();
      if (st.isLoaded && st.isPlaying) {
        isPlayingRef.current = false;
        await v.pauseAsync();
      } else if (st.isLoaded) {
        // 2026-07-21 (BETA — swing-replay crash) — set the playing ref BEFORE ExoPlayer starts so
        // any in-flight clubhead-frame extraction aborts before the two native media pipelines can
        // touch the file at once. (The isPlaying state update from the status callback lands later.)
        isPlayingRef.current = true;
        // 2026-06-15 (Tim) — if we're at (or a hair from) the end, restart from
        // the top so a tap ALWAYS plays. expo-av's playAsync() at end-of-clip is
        // a no-op — that's why the controls felt dead after the video finished.
        const pos = st.positionMillis ?? 0;
        const dur = st.durationMillis ?? 0;
        if (dur > 0 && pos >= dur - 80) await v.setPositionAsync(0);
        await v.playAsync();
      } else {
        isPlayingRef.current = true;
        await v.loadAsync({ uri: playbackUri ?? shot?.clipUri ?? '' }, {}, false);
        await v.playAsync();
      }
    } catch (e) {
      console.error('[swing-detail] play error:', e);
    }
  }, [shot?.clipUri, playbackUri]);
  // 2026-06-16 (Tim) — fade the on-frame CONTROLS shortly after a pause so a
  // paused frame screenshots clean (no play badge / seek bar / speed chip burned
  // into the grab). They snap back the instant playback resumes. The skeleton /
  // trace overlays + watermark are intentionally left visible — those are content
  // you WANT in the shot. Tapping the bare frame still plays (togglePlayPause).
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const [controlsHidden, setControlsHidden] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 2026-06-23 (Tim — "no play/pause or slow-mo controls") — with auto-play now
  // on, the old "fade controls after play for a clean screenshot" hid every
  // control. Keep them PERSISTENTLY visible; the play/pause toggle below shows
  // the live state. (Clean-grab fade dropped — functional controls win.)
  const hasEverPlayedRef = useRef(false);
  useEffect(() => {
    if (fadeTimerRef.current) { clearTimeout(fadeTimerRef.current); fadeTimerRef.current = null; }
    if (isPlaying) hasEverPlayedRef.current = true;
    setControlsHidden(false);
    controlsOpacity.setValue(1);
  }, [isPlaying, controlsOpacity]);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showTrace, setShowTrace] = useState(true);
  // 2026-07-06 (Tim: "remove the golfer and just move the overlay in a
  // separate view") — MOTION ONLY: video keeps playing (it drives the
  // clock) but renders invisible under a dark backdrop, leaving skeleton +
  // trace alone. Forces the skeleton on while active.
  const [motionOnly, setMotionOnly] = useState(false);
  // 2026-06-23 (RP-6) — autoplay-on-open is preserved (Tim: "videos all play"),
  // but the auto-LOOP fights "scrub then analyze this moment" on a re-opened
  // pending upload — the clip keeps restarting under the held frame. Once the
  // user ACTIVELY scrubs/seeks, flip this true so isLooping goes false and the
  // frame they pointed at HOLDS. Open-time playback is untouched (only a real
  // scrub interaction trips it, not the initial autoplay).
  const [userScrubbed, setUserScrubbed] = useState(false);
  // Reset on swing change so a freshly-opened swing autoplays/loops again.
  useEffect(() => { setUserScrubbed(false); }, [swing_id]);

  const poseFrames = session?.biomechanics?.frames ?? [];
  const hasPose = poseFrames.length >= 2;

  // 2026-07-10 (Tim — "swing arc not corrected") — the swing LIBRARY drew only the
  // wrist-proxy trace; the REAL detected clubhead arc was wired in SmartMotion but
  // never here. Run the same clubhead detector across THIS swing's window and feed
  // the overlay, so the library shows the true clubhead path (falls back to the
  // honest wrist trace when the head can't be seen). One server pass per swing.
  const [clubArcPoints, setClubArcPoints] = useState<{ x: number; y: number; tMs: number }[] | null>(null);
  // 2026-07-18 (Tim — crash mp4) — run the clubhead extraction AT MOST ONCE per unique clip
  // window. The effect re-fires when `duration` settles and when the skeleton/trace toggles flip
  // mid-playback; without this guard each re-fire could launch another native frame-extraction
  // pass that overlaps the running one (two retriever loops on the live file → the native crash).
  const clubArcRunKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasPose || !shot?.clipUri || !(showSkeleton || showTrace)) { setClubArcPoints(null); return; }
    // 2026-07-21 (BETA — swing-replay crash, ROOT CAUSE) — NEVER extract clubhead frames while the
    // clip is playing. detectClubPath opens a native MediaMetadataRetriever on the file, and a
    // retriever decoding the SAME mp4 that ExoPlayer is decoding for playback SIGSEGVs the app to
    // the launcher (uncatchable from JS = the crash-after-replay with no error-log entry). The clip
    // opens STATIC, so extraction runs then; isPlaying is in the deps so a pause/finish re-runs it.
    if (isPlaying) return;
    const startMs = (shot.clipStartSeconds ?? 0) * 1000;
    const endMs = (shot.clipEndSeconds ?? duration ?? 0) * 1000;
    if (!(endMs > startMs)) { setClubArcPoints(null); return; }
    // Dedupe: a stable window (uri+start+end) that SUCCEEDED runs once. The key is set only after a
    // real result below, so an extraction aborted by playback retries the next time we're paused.
    const runKey = `${shot.clipUri}|${Math.round(startMs)}|${Math.round(endMs)}`;
    if (clubArcRunKeyRef.current === runKey) return;
    let cancelled = false;
    void (async () => {
      // 2026-07-10 (audit SM5) — heal the clip URI first (iOS rotates the container UUID on
      // reinstall/native build; the raw stored path 404s). The main player self-heals via
      // resolveClipUri; the arc detector was using the raw path and silently never drawing.
      const uri = (await resolveClipUri(shot.clipUri!).catch(() => null)) || shot.clipUri!;
      if (cancelled || isPlayingRef.current) return;
      try {
        // shouldAbort bails between frames the instant playback starts (isPlayingRef is set
        // eagerly in togglePlayPause, before ExoPlayer spins up).
        const r = await detectClubPath({ videoUri: uri, startMs, endMs, shouldAbort: () => cancelled || isPlayingRef.current });
        if (cancelled) return;
        if (r && r.points.length >= 1) {
          clubArcRunKeyRef.current = runKey; // mark THIS window done only on a real result
          setClubArcPoints(r.points.map((p) => ({ x: p.x, y: p.y, tMs: p.tMs })));
        }
        // null = aborted (playback started) OR genuinely no arc; leave the key unset so a later
        // paused pass can retry, and keep any prior points rather than blanking mid-study.
      } catch { /* best-effort — falls back to wrist trace */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPose, shot?.clipUri, shot?.clipStartSeconds, shot?.clipEndSeconds, duration, showSkeleton, showTrace, isPlaying]);

  // 2026-07-06 (Tim carry-over #2) — bake the overlay INTO an exported still.
  // Same fault joints / severity the live overlay uses (see the SwingBodyOverlay
  // mount below), so "Grab Frame" and the coach report carry the skeleton + trace
  // + fault heat, not a clean frame. Video burn-in needs a native encoder (absent
  // today) — this covers the still + reporting half now.
  const overlayFaultJoints = faultJointsFor(
    session?.primary_issue?.primary_fault ?? session?.primary_issue?.issue_id,
  );
  const overlayFaultSevere = session?.primary_issue?.severity === 'significant';
  const { capture: captureOverlayStill, element: overlayStillCaptureEl } = useSwingStillCapture({
    poseFrames,
    faultJoints: overlayFaultJoints,
    faultSevere: overlayFaultSevere,
    showSkeleton: true,
    showTrace: true,
  });

  // 2026-05-17 — dropped the Coach Audio / Kevin Analysis toggle.
  // The dual-audio path was confusing and the coach-audio detection was
  // unreliable (has_audio probe returned true for silent clips). Now the
  // video is always muted and the caddie's analysis auto-narrates once
  // per swing via the effect below. Single source of truth.
  useEffect(() => {
    void videoRef.current?.setIsMutedAsync(true);
  }, []);

  // 2026-06-15 (Tim — voice racing) — stop any in-flight/queued narration when the
  // swing CHANGES, not just on unmount. The speak queue is serial: if you open
  // swing A, its narration is mid-TTS-fetch (slow/failing network — Tim's exact
  // case) holding the queue slot, then back out and open swing B, A's audio still
  // plays to completion and B queues behind it → "voices catching up late". Keying
  // this cleanup on swing_id bumps the speak generation + aborts the in-flight
  // fetch on every swing change (covers screen-reuse where the []-unmount never
  // fires), so each swing starts from a clean voice slot.
  useEffect(() => {
    return () => { void stopSpeaking(); };
  }, [swing_id]);

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
    // 2026-06-24 — off-device usage telemetry (opt-in; no-op if off). Count one
    // swing_analyzed when the analysis lands successfully ('ok').
    if (analysisStatus === 'ok') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/usageTelemetry').track('swing_analyzed', { hasIssue: !!session?.primary_issue });
      } catch { /* telemetry never throws */ }
    }
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
    // 2026-06-15 (Tim — mechanics manual) — no auto-biomech on open; the user runs
    // it via Analyze. Static library until the user acts.
    if (!LIBRARY_AUTO_PROCESS) return;
    if (!swing_id || !shot?.clipUri) return;
    if (session?.biomechanics !== undefined) return;
    if (poseBackfillRef.current === swing_id) return;
    // 2026-06-11 (cage test) — state-aware: do NOT full-clip-backfill biomech on
    // a cage multi-swing session. Its clip is a ~60s recording with several
    // swings, so analyzeSwingFromVideo would "watch the whole minute" as one
    // swing — the 1-min-stuck Tim hit in the library. Cage biomech is computed
    // per-swing by SmartMotion's Motion step; this backfill is only for legacy
    // single-swing uploads. Extra guard: skip any implausibly-long clip
    // (a single swing is <~10s), so a long upload can't trigger it either.
    const durationMs = (session?.upload?.duration_sec ?? 3) * 1000;
    if (session?.source === 'live_cage' || durationMs > 20_000) return;
    poseBackfillRef.current = swing_id;
    void (async () => {
      try {
        const poseMod = await import('../../../services/poseAnalysisApi');
        // 2026-07-20 — re-anchor the persisted path (iOS rotates the container UUID on
        // reinstall) so post-reinstall biomech backfill reads the real file, matching every
        // other read site here; falls back to the raw path if resolution can't improve it.
        const analyzeUri = (await resolveClipUri(shot.clipUri!).catch(() => null)) || shot.clipUri!;
        const biomech = await poseMod.analyzeSwingFromVideo(analyzeUri, durationMs);
        useCageStore.getState().setSessionBiomechanics(swing_id, biomech);
      } catch (e) {
        console.log('[swing-detail] pose backfill failed', e);
        // 2026-06-11 — mark the backfill ATTEMPTED (null, not undefined) so the
        // slow full-clip analysis does NOT re-run on every re-open of a saved
        // swing (Tim: "we only need it done once, then it's saved"). null trips
        // the `biomechanics !== undefined` guard above on the next open.
        try { useCageStore.getState().setSessionBiomechanics(swing_id, null); } catch { /* non-fatal */ }
      }
    })();
  }, [swing_id, shot?.clipUri, session?.biomechanics, session?.upload?.duration_sec, session?.source]);

  // 2026-06-13 — Prewarm the TTS function WHILE the analysis is still running, so
  // the "Okay, I watched it…" read fires hot instead of paying cold-start on top
  // of generation (Tim's report-read lag). Throttled inside warmVoice; no-op if
  // voice is off or this user is trust-1 (which never auto-narrates).
  const warmedRef = useRef(false);
  useEffect(() => {
    if (warmedRef.current) return;
    const inProgress = analysisStatus === 'analyzing_frames' || analysisStatus === 'analyzing_pose'
      || analysisStatus === 'analyzing_pattern' || analysisStatus === 'pending';
    if (inProgress && voiceEnabled && trustLevel !== 1) {
      warmedRef.current = true;
      warmVoice(apiUrl);
    }
  }, [analysisStatus, voiceEnabled, trustLevel, apiUrl]);

  // 2026-07-10 (Tim — "just analyze the video") — warm the swing-analysis Lambda +
  // Gemini H2 pool THE MOMENT an unanalyzed upload opens, in parallel with the auto-
  // analyze effect's coarse-frame extraction (~1-2s). The auto pass's first call is
  // locate_swing (Gemini 2.5 Flash) — the SAME model warmup pings. Cold, that call
  // was blowing the 25s client abort (telemetry: swing_locate_fallback "Aborted"),
  // which smeared the fallback read. Warm, locate lands in ~2-3s. Fire-and-forget;
  // once per mount; no-op if already analyzed.
  const analysisWarmedRef = useRef(false);
  useEffect(() => {
    if (analysisWarmedRef.current) return;
    if (analysisStatus !== 'pending') return;
    if (session?.source !== 'uploaded_video') return;
    if (!apiUrl) return;
    analysisWarmedRef.current = true;
    void fetch(`${apiUrl}/api/swing-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'warmup' }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => { /* best-effort warmup; locate falls back on its own */ });
  }, [analysisStatus, session?.source, apiUrl]);

  // 2026-06-15 (Tim — manual analyze) — clear the in-flight guard once a manual
  // analyze leaves the brief 'pending' window (runPhaseK moves status to
  // analyzing_*). MUST live above the early returns (rules-of-hooks).
  useEffect(() => {
    if (analysisStatus === 'ok' || analysisStatus === 'failed') analyzeInFlightRef.current = false;
  }, [analysisStatus]);

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
    // 2026-06-16 (Tim — a previous read fired off later) — guard the async speak so
    // it can't fire AFTER the screen unmounts (or the swing changes). The unmount
    // stopSpeaking() only stops what's already playing; without this flag the await
    // chain could START a speak a beat after we left → a ghost read on the next
    // screen.
    let cancelled = false;
    void (async () => {
      await configureAudioForSpeech();
      if (cancelled) return;
      await speakChunked(text, voiceGender, language, apiUrl);
    })();
    return () => { cancelled = true; };
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

  // 2026-06-10 — Legacy-clip rescue. Clips uploaded/recorded before the
  // persist-to-documents path existed (or that arrived as a volatile
  // content:// pick) keep a clipUri the OS can revoke — the "won't reanalyze /
  // scrub stuck at 0:00" case. On first open, if the source still exists but
  // ISN'T already under documentDirectory, copy it in and repoint the shot so
  // replay + every future re-analyze read the durable copy. Best-effort; never
  // blocks render. Runs once per swing (guarded by the ref).
  const rescuedClipRef = useRef<string | null>(null);
  useEffect(() => {
    if (!swing_id || !shot?.clipUri || !shot.id) return;
    const uri = shot.clipUri;
    const shotId = shot.id;
    if (rescuedClipRef.current === swing_id) return;
    if (!uri.startsWith('file:') && !uri.startsWith('content:')) return; // ph://, remote — leave
    rescuedClipRef.current = swing_id;
    void (async () => {
      try {
        const FS = await import('expo-file-system/legacy');
        const docDir = FS.documentDirectory;
        if (docDir && uri.startsWith(docDir)) return; // already durable
        // Only rescue what's actually still readable; a gone file can't be saved
        // (the onReanalyze guard already gives that case an honest message).
        if (uri.startsWith('file:')) {
          const info = await FS.getInfoAsync(uri);
          if (!info.exists) return;
        }
        const { persistClipToDocuments } = await import('../../../services/videoUpload');
        const durable = await persistClipToDocuments(uri, `${swing_id}_${shotId}`);
        if (durable && durable !== uri) {
          useCageStore.getState().setShotClipUri(swing_id, shotId, durable);
          uploadLog('legacy-clip-rescued', { from_scheme: uri.split(':')[0] }, swing_id);
        }
      } catch { /* best-effort — original uri stays, onReanalyze handles gone */ }
    })();
  }, [swing_id, shot?.clipUri, shot?.id]);

  const onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    const s = status as AVPlaybackStatusSuccess;
    if (s.positionMillis != null) setPosition(s.positionMillis / 1000);
    if (s.durationMillis != null) setDuration(s.durationMillis / 1000);
    setIsPlaying(s.isPlaying === true);
    // 2026-06-15 (Tim) — NO autoplay on open. The library swing sits STATIC on
    // the first frame; the user taps to play (togglePlayPause restarts from the
    // top when at end). Autoplay was also what left the controls dead — it ran
    // the clip to the end on open, so the user's first tap hit a finished video
    // and did nothing. The ?watch=1 path below keeps its own shouldPlay.
    // 2026-05-25 — Path A: when the user routed here with ?watch=1
    // (analysis was deferred at upload time for short clips), fire
    // runPhaseKOnSession the moment the video plays through. Gated
    // by watchFiredRef so re-mounts can't double-fire, and by
    // analysisStatus so we don't clobber a result if one's already
    // present (e.g. user navigated back-and-forth after analysis ran).
    if (
      LIBRARY_AUTO_PROCESS &&
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
    // 2026-06-15 (Tim) — seek + HOLD the frame (don't force play). Scrubbing to
    // a position on a swing is a "show me this frame" action; auto-playing from
    // there fights the static-by-default behavior. Tap the frame to play.
    // 2026-06-23 (RP-6) — a real scrub is the signal to STOP the auto-loop, so
    // the held frame doesn't get yanked back to the top on the next loop tick.
    setUserScrubbed(true);
    await videoRef.current?.setPositionAsync(sec * 1000);
    await videoRef.current?.pauseAsync();
  };

  // 2026-07-10 (Tim — "missing play rewind and forward and slider controls in swing
  // library") — a real transport deck below the frame: jog ±2s, single-frame step
  // (~1/30s), restart, and a DRAGGABLE scrubber. All seek helpers hold the frame
  // (via scrubTo) so the deck is for studying a swing, not just playing it.
  const FRAME_SEC = 1 / 30;
  const seekBy = useCallback((deltaSec: number) => {
    const d = durationRef.current;
    if (!d || d <= 0) return;
    const target = Math.max(0, Math.min(d, positionRef.current + deltaSec));
    void scrubTo(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Live refs so the once-created PanResponder + the jog buttons read current
  // position/duration without stale closures.
  const positionRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  // 2026-07-21 (BETA — swing-replay crash) — live isPlaying ref so the background clubhead-arc
  // frame extraction can bail the INSTANT playback starts (a native retriever must never decode
  // the file while ExoPlayer does). Set eagerly in togglePlayPause too, so the ref is true before
  // ExoPlayer even spins up (no race window against the status-callback state update).
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  const scrubTrackWRef = useRef(0);
  const [scrubbing, setScrubbing] = useState(false);
  const seekFromTouch = (locationX: number) => {
    const w = scrubTrackWRef.current;
    const d = durationRef.current;
    if (!w || w <= 0 || !d || d <= 0) return;
    const frac = Math.max(0, Math.min(1, locationX / w));
    void scrubTo(frac * d);
  };
  const scrubPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setScrubbing(true);
        seekFromTouch(evt.nativeEvent.locationX);
      },
      onPanResponderMove: (evt) => seekFromTouch(evt.nativeEvent.locationX),
      onPanResponderRelease: () => setScrubbing(false),
      onPanResponderTerminate: () => setScrubbing(false),
    }),
  ).current;
  const fmtClock = (sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
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
    if (!LIBRARY_AUTO_PROCESS) return; // 2026-06-15 (Tim) — library is manual; no watchdog auto-fire
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

  // P1-D — analysis timeout for manual-analyze path (LIBRARY_AUTO_PROCESS = false
  // disables the auto-fire watchdog above, so stuck-on-analyzing has no recovery).
  // If status stays in any analyzing_* state for 2 minutes, surface 'failed' so the
  // user gets the Re-analyze button instead of being stranded forever.
  useEffect(() => {
    if (!swing_id) return;
    const stuck = analysisStatus === 'analyzing_frames' || analysisStatus === 'analyzing_pose' || analysisStatus === 'analyzing_pattern';
    if (!stuck) return;
    const timer = setTimeout(() => {
      const cur = useCageStore.getState().sessionHistory.find(s => s.id === swing_id)?.analysis_status;
      if (cur === 'analyzing_frames' || cur === 'analyzing_pose' || cur === 'analyzing_pattern') {
        useCageStore.getState().setSessionAnalysisStatus(swing_id, 'failed', 'Analysis is taking too long — tap Re-analyze to try again.');
      }
    }, 120_000);
    return () => clearTimeout(timer);
  }, [swing_id, analysisStatus]);

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
      // 2026-06-23 (smoke-test) — re-anchor the clip URI before sharing so a stale
      // post-reinstall absolute path doesn't "share" a non-existent file.
      const shareUri = (await resolveClipUri(shot.clipUri)) ?? shot.clipUri;
      await Sharing.shareAsync(shareUri, {
        mimeType: 'video/mp4',
        dialogTitle: 'Share session',
      });
    } catch (e) {
      console.log('[swing-detail] session share failed', e);
      Alert.alert('Share failed', 'Could not share the video. The file may no longer be on this device.');
    }
  };

  // 2026-06-29 (Tim) — SAVE THE CLIP TO PHONE PHOTOS (with permission) so the player
  // can pull it up later and re-analyze. Saves the RAW recording (the overlays render
  // separately, so the saved video is clean — no skeleton/markup baked in).
  const handleSaveToPhotos = async () => {
    if (!shot?.clipUri) {
      Alert.alert('Nothing to save', 'This session has no video file.');
      return;
    }
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photos access needed', 'Allow Photos access to save your swing video to your phone.');
        return;
      }
      const uri = (await resolveClipUri(shot.clipUri)) ?? shot.clipUri;
      await MediaLibrary.saveToLibraryAsync(uri);
      useToastStore.getState().show('Saved to your Photos');
    } catch (e) {
      console.log('[swing-detail] save to photos failed', e);
      Alert.alert('Save failed', 'Could not save the video — the file may no longer be on this device.');
    }
  };

  // 2026-06-29 (Tim) — GRAB THE CURRENT FRAME. At the slowest slow-mo you can see the
  // ball; this captures exactly the frame on screen (live positionMillis from the
  // player) as a still and saves it to Photos.
  // 2026-07-06 (Tim carry-over #2) — when the overlay is showing, bake it IN: the
  // saved still now carries the skeleton + tempo trace + fault heat exactly as on
  // screen (via SwingStillComposite). Falls back to the clean frame if pose is
  // absent, the overlay is toggled off, or the composite can't render.
  const handleGrabFrame = async () => {
    if (!shot?.clipUri) {
      Alert.alert('Nothing to capture', 'This session has no video file.');
      return;
    }
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photos access needed', 'Allow Photos access to save the frame to your phone.');
        return;
      }
      const uri = (await resolveClipUri(shot.clipUri)) ?? shot.clipUri;
      const st = await videoRef.current?.getStatusAsync();
      const timeMs = (st && st.isLoaded ? st.positionMillis : 0) ?? 0;
      // 2026-07-21 (BETA — swing-replay crash class) — PAUSE before extracting a frame so a native
      // retriever never decodes the file while ExoPlayer is actively decoding it (SIGSEGV). Grabbing
      // "the frame on screen" implies a held frame anyway, so this is also the correct behavior.
      if (st?.isLoaded && st.isPlaying) {
        isPlayingRef.current = false;
        try { await videoRef.current?.pauseAsync(); } catch { /* best-effort */ }
      }
      const overlayOn = hasPose && (showSkeleton || showTrace || motionOnly);
      let outUri: string | null = null;
      if (overlayOn) {
        outUri = await captureOverlayStill(uri, timeMs);
      }
      if (!outUri) {
        const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, { time: timeMs, quality: 1 });
        outUri = thumbUri;
      }
      await MediaLibrary.saveToLibraryAsync(outUri);
      useToastStore.getState().show(overlayOn && outUri ? 'Frame + overlay saved to your Photos' : 'Frame saved to your Photos');
    } catch (e) {
      console.log('[swing-detail] grab frame failed', e);
      Alert.alert('Capture failed', 'Could not grab this frame — try pausing on it first.');
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
    // 2026-06-23 (RP-3b) — the fault frame is an IMAGE asset under smartmotion/
    // (not a clip), so resolveClipUri (swing_clips/ only) can't heal it. Re-anchor
    // it with resolveImageUri so a post-reinstall export embeds the real picture
    // instead of a stale (UUID-rotated) path that resolves to nothing.
    const rawFaultFrame = session.fault_frame_uri ?? pi?.visual_reference_path ?? null;
    const cleanFaultFrame = (await resolveImageUri(rawFaultFrame)) ?? rawFaultFrame;
    // 2026-07-06 (Tim carry-over #2 — "report with overlays") — when we have pose,
    // feature an OVERLAY-BAKED frame (skeleton + trace + fault heat) instead of the
    // clean keyframe. Extract at peak lead-wrist speed (downswing/impact, where the
    // fault reads) off the actual clip so the skeleton aligns exactly. Falls back to
    // the clean frame if pose is absent or the composite can't render.
    let faultFrameUri = cleanFaultFrame;
    let faultFrameMime: string | undefined;
    if (hasPose && shot?.clipUri) {
      try {
        const clip = (await resolveClipUri(shot.clipUri)) ?? shot.clipUri;
        const sorted = [...poseFrames].sort((a, b) => a.timestampMs - b.timestampMs);
        const wristName = sorted.some(f => f.keypoints.some(k => k.name === 'right_wrist' && k.score >= 0.2))
          ? 'right_wrist' : 'left_wrist';
        let bestT = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.66))]?.timestampMs
          ?? sorted[sorted.length - 1].timestampMs;
        let bestSpeed = -1;
        for (let i = 0; i < sorted.length - 1; i++) {
          const ka = sorted[i].keypoints.find(k => k.name === wristName);
          const kb = sorted[i + 1].keypoints.find(k => k.name === wristName);
          if (!ka || !kb) continue;
          const dt = Math.max(1, sorted[i + 1].timestampMs - sorted[i].timestampMs);
          const sp = Math.hypot(kb.x - ka.x, kb.y - ka.y) / dt;
          if (sp > bestSpeed) { bestSpeed = sp; bestT = sorted[i + 1].timestampMs; }
        }
        const composite = await captureOverlayStill(clip, bestT);
        if (composite) { faultFrameUri = composite; faultFrameMime = 'image/png'; }
      } catch (e) {
        console.log('[swing-detail] overlay report frame failed (non-fatal)', e);
      }
    }
    const res = await exportCoachReport({
      studentName: swinger,
      instructorName: profile.name || profile.firstName || 'Your Instructor',
      instructorCredentials: profile.coachCredentials ?? null,
      sessionDateMs: session.upload?.uploaded_at ?? Date.now(),
      sessionNumber: sameStudent.length > 0 ? sameStudent.length : null,
      // 2026-07-06 — overlay-baked composite (PNG) when pose exists, else the
      // clean keyframe (JPEG). Never the video clip.
      faultFrameUri,
      faultFrameMime,
      // 2026-07-02 (Tim — the report had no metrics) — pass REAL measured values only (honest;
      // omitted when absent). Tempo + club are what we reliably have per swing today.
      metrics: (() => {
        const out: { label: string; value: string }[] = [];
        const s = session as unknown as Record<string, unknown>;
        // 2026-07-01 (audit H2/H3) — smart_motion_shot_map.tempo is an OBJECT
        // ({ ratio, backswingMs, ... }), NOT a number, and tempo_result is a
        // TempoResult ({ ratio }). The old `typeof sm.tempo === 'number'` check
        // was always false, so the PDF tempo row was dead. Read the ratio off
        // whichever shape is present.
        const sm = s.smart_motion_shot_map as { tempo?: { ratio?: number | null } | null } | undefined;
        const tr = s.tempo_result as { ratio?: number | null } | undefined;
        const smRatio = typeof sm?.tempo?.ratio === 'number' ? sm.tempo!.ratio! : null;
        const trRatio = typeof tr?.ratio === 'number' ? tr!.ratio! : null;
        const tempo = smRatio ?? trRatio;
        if (tempo != null && Number.isFinite(tempo)) out.push({ label: 'Tempo', value: `${tempo.toFixed(1)} : 1` });
        const club = typeof s.club === 'string' ? s.club : (s.upload as { club?: string } | undefined)?.club;
        if (club) out.push({ label: 'Club', value: club });
        return out.length ? out : undefined;
      })(),
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
  if (!session) {
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
  if (!shot?.clipUri) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Text style={{ color: colors.text_primary, fontWeight: '600', marginBottom: 8 }}>Video unavailable</Text>
          <Text style={{ color: colors.text_muted, textAlign: 'center', marginBottom: 20, paddingHorizontal: 24 }}>
            The video file is missing from this device. You can delete this entry or re-upload the clip.
          </Text>
          <TouchableOpacity
            onPress={() => {
              Alert.alert('Delete this swing?', 'The metadata will be removed. You can re-upload the clip later.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => { useCageStore.getState().deleteSession(swing_id); router.back(); } },
              ]);
            }}
            style={{ marginBottom: 12, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.error }}>Delete Entry</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ color: colors.accent }}>‹ Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const issueTimestamps = shot.detected_issue_timestamps_sec ?? [];

  // 2026-06-23 — DrillCard recommendation. Prefer the persisted
  // session.drill_recommendation, but FALL BACK to computing it from the
  // analysis' primary_issue.issue_id when the stored field is null (the bug:
  // a completed "over the top · MODERATE" read showed the empty placeholder
  // because only the persisted field was read). Mirrors videoUpload.ts:1031
  // exactly — same guard, same cast. recommendDrill returns null for 'none'
  // or an unmapped issue, so a genuinely-empty/un-analyzed swing still shows
  // the placeholder (no fabricated drill).
  const drillRecommendation =
    session.drill_recommendation ??
    (session.primary_issue ? recommendDrill(session.primary_issue.issue_id as never) : null);

  // 2026-06-13 (Phase 2) — capture-kind identity. Every library entry now wears a
  // badge that says WHAT it is — a live Smart Motion capture, an uploaded Coach
  // lesson, or a plain video upload — so the detail view reads as the matching
  // interface for its source instead of one generic screen. Drives the badge under
  // the title; the multi-swing reel + metric HUD already key off the carved shots.
  const captureKind = getCaptureKind(session);
  const isMultiSwing = session.shots.length > 1
    || session.shots.some(s => s.perShotAnalysis || s.clipStartSeconds != null);
  const KIND_BADGE = {
    smart_motion: { label: isMultiSwing ? 'Smart Motion · Session' : 'Smart Motion', icon: 'flash-outline' as const, tint: colors.accent },
    coach:        { label: 'Coach Lesson', icon: 'school-outline' as const, tint: '#F0C030' },
    upload:       { label: 'Upload', icon: 'cloud-upload-outline' as const, tint: colors.text_muted },
    drill:        { label: 'Drill', icon: 'barbell-outline' as const, tint: colors.accent },
  }[captureKind];

  // Phase V.7 — Re-run Phase K on this session with the post-V.6 pipeline.
  // Status transitions inside runPhaseKOnSession drive the existing analyzing
  // card automatically. Reset spokenForRef so Kevin re-narrates on completion.
  // 2026-06-15 (Tim — library manual) — 'pending' is now the STABLE "uploaded, not
  // analyzed yet" state (auto-analyze removed), so it must NOT count as in-flight or
  // the Analyze button would be permanently disabled. Only the analyzing_* states are
  // in-flight; analyzeInFlightRef bridges the brief pending→analyzing_pose window on
  // a manual tap so a double-tap can't double-fire.
  const reanalyzing =
    analysisStatus === 'analyzing_frames' ||
    analysisStatus === 'analyzing_pose' ||
    analysisStatus === 'analyzing_pattern';
  // 2026-06-09 — Uploaded phone clips have NO acoustics to auto-find the
  // swing, and a 30-60s clip can't be reliably frame-sampled (a ~2s swing
  // falls between samples). So let the user POINT at it: scrub the video to
  // their swing, tap "Analyze this moment", and we window a few seconds
  // around that position and analyze ONLY that — dense frames on the real
  // swing instead of sparse frames across a minute of setup/practice/walk-up.
  const onAnalyzeAtPosition = () => {
    if (!swing_id || !shot || reanalyzing || analyzeInFlightRef.current) return;
    analyzeInFlightRef.current = true;
    const center = position;
    const startSec = Math.max(0, center - 2.5);
    const endSec = (duration ? Math.min(duration, center + 3) : center + 3);
    useCageStore.getState().setShotClipBoundaries(swing_id, shot.id, startSec, endSec);
    useToastStore.getState().show(`Analyzing the swing at 0:${Math.floor(center).toString().padStart(2, '0')}…`);
    onReanalyze();
  };

  const onReanalyze = () => {
    if (!swing_id || reanalyzing || analyzeInFlightRef.current) return;
    analyzeInFlightRef.current = true;
    // Phase V.7 — flip status to 'pending' BEFORE clearing spokenForRef so the
    // auto-narrate effect can't fire with stale 'ok' status and re-speak the
    // old primary_issue between the ref clear and the first runPhaseK status
    // transition. Also stop any in-flight TTS from a prior auto-narration.
    uploadLog('reanalyze-start', { from_status: analysisStatus }, swing_id);
    void stopSpeaking().catch(() => {});
    void (async () => {
      // 2026-06-10 — Honest guard: re-analysis re-extracts frames FROM THE
      // VIDEO. If the source clip is gone (old upload/recording whose temp file
      // the OS cleared — the "won't reanalyze / stuck at 0:00" case), there's
      // nothing to watch. Say so plainly instead of spinning then failing.
      try {
        const clip = shot?.clipUri ?? null;
        if (clip && clip.startsWith('file:')) {
          const FS = await import('expo-file-system/legacy');
          const info = await FS.getInfoAsync(clip);
          if (!info.exists) {
            // 2026-06-23 (RP-4) — before declaring the clip gone, re-anchor the
            // stored absolute path under the LIVE documentDirectory. iOS rotates
            // the app-container UUID on a native build/reinstall, so the stored
            // path points at the OLD container even though the file survived under
            // the new one. resolveClipUri heals the basename; if the healed path
            // exists, repoint the store and continue with it. Only show the honest
            // "not on device" failure when the healed path is ALSO gone.
            const resolved = await resolveClipUri(clip);
            if (resolved && resolved !== clip && shot?.id) {
              useCageStore.getState().setShotClipUri(swing_id, shot.id, resolved);
            } else if (!resolved) {
              useCageStore.getState().setSessionAnalysisStatus(
                swing_id,
                'failed',
                "The original video isn't on this device anymore, so I can't re-watch it. Re-upload the clip and I'll analyze it fresh.",
              );
              return;
            }
          }
        }
      } catch { /* fall through — let analysis try */ }
      useCageStore.getState().setSessionAnalysisStatus(swing_id, 'pending');
      void runPhaseKOnSession(swing_id);
      spokenForRef.current = null; // cleared after analysis commits, not before
    })();
  };

  // 2026-06-29 (Tim) — AUTO-ANALYZE uploads at a smart default. Tim expected an
  // uploaded clip to play → analyze, not sit on a manual CTA. So the FIRST time an
  // uploaded swing opens unanalyzed, window + analyze the MIDDLE of the clip (the
  // swing is most often mid-clip, not in the walk-up) — windowed pose, not the old
  // smeared full-clip pass. The "Point at your swing" card stays as a one-tap
  // REFINE: scrub to the real swing + re-analyze. Fires once per mount, only when
  // never analyzed and the duration is known.
  const autoAnalyzeFiredRef = useRef(false);
  useEffect(() => {
    if (autoAnalyzeFiredRef.current) return;
    if (analysisStatus !== 'pending') return;
    if (session?.source !== 'uploaded_video') return;
    if (!swing_id || !shot || !duration || duration <= 0) return;
    if (analyzeInFlightRef.current) return;
    autoAnalyzeFiredRef.current = true;
    void (async () => {
      // 2026-07-01 (audit M2 + C1 root) — the old path blindly windowed the geometric
      // MIDDLE of the clip. For a practice-heavy upload the real swing usually isn't
      // mid-clip, so we analyzed walk-up/setup and then FEATURED a pavement/setup frame
      // (the "pretty bad report" garbage frame). Instead, LOCATE the real swing first
      // and window that; only fall back to the middle when the locator can't find it
      // (short clips where the whole clip is the swing, or a locate miss/timeout).
      let startSec: number;
      let endSec: number;
      let located = false;
      try {
        const { locateSwingWindow } = await import('../../../services/poseDetection');
        const win = await locateSwingWindow(shot.clipUri!, duration * 1000);
        if (win && win.endSec > win.startSec) {
          // Pad the located window a touch so P1/P10 aren't clipped.
          startSec = Math.max(0, win.startSec - 0.5);
          endSec = Math.min(duration, win.endSec + 0.5);
          located = true;
        } else {
          const center = duration / 2;
          startSec = Math.max(0, center - 2.5);
          endSec = Math.min(duration, center + 3);
        }
      } catch {
        const center = duration / 2;
        startSec = Math.max(0, center - 2.5);
        endSec = Math.min(duration, center + 3);
      }
      useCageStore.getState().setShotClipBoundaries(swing_id, shot.id, startSec, endSec);
      useToastStore.getState().show(
        located ? 'Found your swing — analyzing…' : 'Analyzing your swing… scrub + re-analyze to fine-tune.',
      );
      onReanalyze();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisStatus, session?.source, duration, swing_id, shot]);

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
          // Club picks the benchmark profile if this falls back to the
          // tour-benchmark path (reference has no biomechanics).
          club: session?.club ?? ref.club ?? null,
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
          const headline = (result.overall_match == null
            ? `Not enough data to compare to ${ref.label} yet. ${result.takeaways[0] ?? ''}`
            : `${result.overall_match}% match to ${ref.label}. ${result.takeaways[0] ?? ''}`).trim();
          await speakChunked(result.voice_summary || headline, voiceGender, language, apiUrl);
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
      {/* 2026-07-06 (Tim carry-over #2) — off-screen compositor for overlay-baked
          stills (Grab Frame + coach report). Mounts only while capturing. */}
      {overlayStillCaptureEl}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.back, { color: colors.accent }]}>‹ Back</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[styles.title, { color: colors.text_primary, flex: 0, maxWidth: '100%' }]} numberOfLines={1}>
              {session.upload?.notes ?? `${session.club} swing`}
            </Text>
            {/* Phase 2 — capture-kind badge: the entry identifies its own source. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <View style={[styles.kindBadge, { borderColor: KIND_BADGE.tint, marginTop: 0 }]}>
                <Ionicons name={KIND_BADGE.icon} size={11} color={KIND_BADGE.tint} />
                <Text style={[styles.kindBadgeText, { color: KIND_BADGE.tint }]} numberOfLines={1}>
                  {KIND_BADGE.label}
                </Text>
              </View>
              {/* 2026-06-23 (Tim) — GOLFER chip: always-editable golfer attribution.
                  Tap to reassign who hit this swing (you / a family member / add one). */}
              <TouchableOpacity
                onPress={() => { setAddGolferOpen(false); setGolferSheetOpen(true); }}
                style={[styles.kindBadge, { borderColor: colors.accent, marginTop: 0 }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Golfer: ${golferDisplayName}. Tap to change who hit this swing.`}
              >
                <Ionicons name="person-circle-outline" size={12} color={colors.accent} />
                <Text style={[styles.kindBadgeText, { color: colors.accent }]} numberOfLines={1}>
                  {golferDisplayName}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
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
                  // 2026-06-29 (Tim — "export only sent the video, not the analysis")
                  // — send the FULL report in the message body so the coach gets the
                  // read WITH the swing: AI focus + fix + drill, body mechanics, tempo,
                  // and the shot-map metrics. (Sharing attaches one file — the video —
                  // so the analysis rides in the body text.)
                  const ctx: string[] = [
                    `Club: ${session.club ?? 'unknown'}`,
                    `Date: ${dateStr}`,
                  ];
                  const pi = session.primary_issue;
                  if (pi?.name) {
                    ctx.push('— ANALYSIS —');
                    ctx.push(`Top focus: ${pi.name}${pi.confidence ? ` (confidence: ${pi.confidence})` : ''}`);
                    if (pi.mechanical_breakdown) ctx.push(pi.mechanical_breakdown);
                    if (pi.cause) ctx.push(`Why: ${pi.cause}`);
                    if (pi.fix) ctx.push(`Fix: ${pi.fix}`);
                    if (pi.drill) ctx.push(`Drill: ${pi.drill}`);
                  }
                  const bv = session.biomechanics?.verdicts;
                  if (bv && (bv.hipTurn || bv.shoulderTurn || bv.weightShift || bv.posture)) {
                    ctx.push('— BODY —');
                    [bv.hipTurn, bv.shoulderTurn, bv.weightShift, bv.posture]
                      .filter((v): v is string => !!v)
                      .forEach((v) => ctx.push(`• ${v}`));
                  }
                  const sm = session.smart_motion_shot_map;
                  if (sm) {
                    const bits: string[] = [];
                    if (sm.tempo?.ratio != null) bits.push(`Tempo ${sm.tempo.ratio.toFixed(1)}:1`);
                    if (sm.effortPct != null) bits.push(`Effort ${sm.effortPct}%`);
                    if (sm.estCarry != null) bits.push(`~${sm.estCarry}y carry`);
                    if (sm.trace) bits.push(`Launch ${sm.trace.side === 'left' ? `${sm.trace.divergenceDeg}° L` : sm.trace.side === 'right' ? `${sm.trace.divergenceDeg}° R` : 'straight'}`);
                    if (bits.length) ctx.push(`— METRICS — ${bits.join(' · ')}`);
                  }
                  if (session.coach_note) {
                    ctx.push(`Player note: ${session.coach_note}`);
                  }
                  // 2026-06-23 (RP-3a) — re-anchor the clip before sending so a
                  // stale post-reinstall absolute path doesn't "send" a
                  // non-existent file (false success / dead path). iOS rotates the
                  // app-container UUID on reinstall; resolveClipUri heals it.
                  void (async () => {
                    const sendUri = (await resolveClipUri(clip)) ?? clip;
                    return sendSwingToTank({
                      videoUri: sendUri,
                      swingTitle: session.upload?.notes ?? `${session.club} swing`,
                      contextLines: ctx,
                    });
                  })().then(result => {
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
            {/* 2026-06-13 (Tim) — star a swing as a round highlight. When it was
                captured on-course (carries a roundId), starring saves it to that
                round's scorecard + recap. */}
            <TouchableOpacity
              onPress={() => { useCageStore.getState().toggleSessionStarred(session.id); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={session.starred ? 'Unstar this swing' : 'Star this swing — saves it to the round scorecard'}
            >
              <Ionicons name={session.starred ? 'star' : 'star-outline'} size={21} color={session.starred ? '#F5A623' : colors.accent} />
            </TouchableOpacity>
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
              onPress={handleGrabFrame}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Save the current frame to your phone Photos"
            >
              <Ionicons name="image-outline" size={22} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSaveToPhotos}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Save this swing video to your phone Photos"
            >
              <Ionicons name="download-outline" size={22} color={colors.accent} />
            </TouchableOpacity>
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
                  source={{ uri: leftPlaybackUri ?? leftShot?.clipUri ?? '' }}
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
                  source={{ uri: rightPlaybackUri ?? rightShot?.clipUri ?? '' }}
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
              <ZoomableView style={StyleSheet.absoluteFill} onSingleTap={togglePlayPause}>
              <Video
                ref={videoRef}
                source={{ uri: playbackUri ?? shot.clipUri }}
                style={[styles.video, motionOnly && { opacity: 0 }]}
                resizeMode={ResizeMode.CONTAIN}
                // 2026-07-02 (Tim — skeleton lags behind the motion) — ~25x/s time reports (vs
                // expo-av's ~2x/s default) so the pose overlay tracks near frame-rate.
                // 2026-07-04 (elite-clean audit) — CONDITIONAL, matching smartmotion.tsx:
                // 25x/s only while the pose overlay actually renders (same gate as the
                // SwingBodyOverlay mount below). Overlay off → 4x/s, plenty for the
                // seek bar, so playback doesn't re-render the screen 25x/s for nothing.
                progressUpdateIntervalMillis={hasPose && (showSkeleton || showTrace || motionOnly) ? 40 : 250}
                // 2026-06-11 — native controls OFF: tap-anywhere toggles play/pause
                // (via ZoomableView) and a thin tap-to-seek bar replaces the native
                // scrubber, so there's no native tap-handling competing with the
                // tap-to-pause gesture. Slow-mo + frame-jump buttons unchanged.
                useNativeControls={false}
                // 2026-06-23 (Tim — "NONE play") — AUTO-PLAY on load for EVERY
                // entry path, not just ?watch=1. The library path relied on a
                // tap (ZoomableView onSingleTap → togglePlayPause) to start
                // playback; if that tap never reached the handler the video just
                // sat on a frozen frame = "won't play". Now it plays the moment it
                // loads (muted + looping for library so scrubbing/replay is calm);
                // tap still pauses. watch-then-analyze keeps its own audio path.
                shouldPlay
                // 2026-06-29 (Tim) — PLAY ONCE: the clip auto-plays through a single
                // time on open (while analysis runs in parallel); when it stops the
                // analysis is ready and the user takes over — tap to replay from the
                // top, scrub, slow-mo. No auto-loop (it was looping indefinitely).
                isLooping={false}
                isMuted={!shouldAutoplayThenAnalyze}
                rate={playbackRate}
                shouldCorrectPitch={false}
                onLoad={async () => {
                  setVideoError(null);
                  // expo-av can ignore the shouldPlay PROP on first load (the
                  // documented quirk); kick playback explicitly so it ALWAYS starts.
                  try { await videoRef.current?.playAsync(); } catch { /* best-effort */ }
                }}
                onPlaybackStatusUpdate={onPlaybackStatusUpdate}
                onError={(e) => {
                  const msg = typeof e === 'string' ? e : 'This video could not be played on this device.';
                  console.error('[swing-detail] video error:', e);
                  setVideoError(msg);
                }}
              />
              {/* 2026-06-29 (Tim — "zoom to see the ball") — the skeleton + ball trace +
                  target overlays now live INSIDE the zoom so they TRACK the video when you
                  pinch in (before, only the video scaled and the overlays drifted off the
                  ball). Markup rail + watermark stay outside — they shouldn't scale. */}
              {/* MOTION ONLY backdrop — sits above the (invisible) video,
                  below the skeleton, so the overlay reads on clean dark. */}
              {motionOnly && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0B1220' }]} pointerEvents="none" />
              )}
              {hasPose && (showSkeleton || showTrace || motionOnly) && (
                <SwingBodyOverlay
                  frames={poseFrames}
                  currentTimeMs={Number.isFinite(position) ? position * 1000 : 0}
                  showSkeleton={showSkeleton || motionOnly}
                  showTrace={showTrace}
                  resizeMode="contain"
                  // 2026-07-06 (Tim — GolfFix-style region heat) — paint the
                  // diagnosed fault's body region orange/red on the skeleton.
                  faultJoints={faultJointsFor(session?.primary_issue?.primary_fault ?? session?.primary_issue?.issue_id)}
                  faultSevere={session?.primary_issue?.severity === 'significant'}
                  clubArc={clubArcPoints}
                />
              )}
              <CageTargetingOverlay
                ballArea={session?.ball_area_norm ?? null}
                target={session?.target_norm ?? null}
              />
              </ZoomableView>
              {/* 2026-06-23 (Tim) — visible failure state instead of a black frame. */}
              {videoError && (
                <View style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.8)', padding: 24 }}>
                  <Ionicons name="alert-circle-outline" size={40} color="#F0C030" />
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 10 }}>{videoError}</Text>
                  <Text style={{ color: '#9ca3af', fontSize: 11, textAlign: 'center', marginTop: 8 }} numberOfLines={2}>
                    {(playbackUri ?? shot.clipUri ?? '').slice(-52)}
                  </Text>
                  <TouchableOpacity
                    onPress={async () => {
                      setVideoError(null);
                      const re = await resolveClipUri(shot.clipUri);
                      if (re) { setPlaybackUri(re); try { await videoRef.current?.loadAsync({ uri: re }, { shouldPlay: true }, false); } catch { /* */ } }
                      else setVideoError('Video file not found on this device.');
                    }}
                    style={{ marginTop: 14, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: '#88F700' }}
                  >
                    <Text style={{ color: '#88F700', fontSize: 13, fontWeight: '800' }}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}
              {/* 2026-05-25 — Fix AH: coach annotation overlay. DRAW
                  toggle is OFF by default so pinch-zoom + native
                  video controls work; coach taps DRAW to enter
                  freehand/circle/line/text mode. Per-shot session;
                  strokes don't persist across mount in v1. */}
              <VideoAnnotationOverlay />
              <VideoWatermark position="bottomRight" size={36} />
              {/* 2026-06-16 (Tim) — fade-on-pause wrapper for the on-frame controls
                  (slow-mo badge, center play badge, seek bar) so a paused frame
                  screenshots clean. box-none lets frame taps reach the player while
                  visible; once hidden, pointerEvents:none so a tap plays the bare
                  frame instead of hitting an invisible control. */}
              <Animated.View
                pointerEvents={controlsHidden ? 'none' : 'box-none'}
                style={[StyleSheet.absoluteFill, { opacity: controlsOpacity }]}
              >
              {/* 2026-06-11 — slow-mo toggle (1× → ½× → ¼×). Top-left corner so it
                  clears the bottom-right watermark + the bottom native scrubber and
                  doesn't intercept the pinch-zoom on the rest of the frame. Turns
                  green when slowed so the state is obvious. */}
              {/* 2026-06-12 — slow-mo badge (matches the SmartMotion control set). Top-
                  left corner; faint fill + a ½/¼ tag when slowed. */}
              <TouchableOpacity
                onPress={cycleSlowMo}
                style={{ position: 'absolute', top: 8, left: 8, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: playbackRate < 1 ? 'rgba(136,247,0,0.22)' : 'transparent' }}
                accessibilityRole="button"
                accessibilityLabel={`Playback speed ${playbackRate} times; tap to change`}
              >
                <Image source={ICON_CTRL.slowmo} style={{ width: 42, height: 42 }} resizeMode="contain" />
                {playbackRate < 1 ? <Text style={{ position: 'absolute', bottom: 2, right: 4, fontSize: 9, fontWeight: '900', color: '#88F700' }}>{playbackRate === 0.5 ? '½' : '¼'}</Text> : null}
              </TouchableOpacity>
              {/* 2026-06-23 (Tim) — always-visible play/pause toggle. Shows the
                  live state (pause while playing, play while paused) and is itself
                  tappable, so there's an obvious control even during auto-play.
                  Semi-transparent while playing so it doesn't bury the swing. */}
              <TouchableOpacity
                onPress={togglePlayPause}
                style={{ position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -32, width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', opacity: isPlaying ? 0.55 : 1 }}
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              >
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={32} color="#ffffff" />
              </TouchableOpacity>
              {/* Tap-to-seek bar — replaces the native scrubber. Tap anywhere on it
                  to jump to that fraction of the clip. Thin, bottom edge, clear of
                  the watermark; doesn't interfere with the tap-to-pause on the frame. */}
              <Pressable
                onPress={(e) => {
                  if (!duration || duration <= 0 || seekBarW <= 0) return;
                  const frac = Math.max(0, Math.min(1, e.nativeEvent.locationX / seekBarW));
                  void scrubTo(frac * duration);
                }}
                onLayout={(e) => setSeekBarW(e.nativeEvent.layout.width)}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, justifyContent: 'flex-end' }}
                accessibilityRole="adjustable"
                accessibilityLabel="Seek bar — tap to jump to a point in the swing"
              >
                <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.25)' }}>
                  <View style={{ height: 4, width: `${duration && duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0}%`, backgroundColor: '#88F700' }} />
                </View>
              </Pressable>
              </Animated.View>
            </View>
            {/* 2026-07-10 (Tim) — TRANSPORT DECK: draggable scrubber + jog/step/play
                controls below the frame. Replaces the "where are the controls?" gap
                with a real film-study deck. */}
            {!videoError && (
              <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, marginBottom: 4, marginTop: -2 }}>
                {/* Scrubber */}
                <View
                  {...scrubPanResponder.panHandlers}
                  onLayout={(e) => { scrubTrackWRef.current = e.nativeEvent.layout.width; }}
                  style={{ height: 28, justifyContent: 'center' }}
                  accessibilityRole="adjustable"
                  accessibilityLabel="Scrubber — drag to move through the swing"
                >
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(148,163,184,0.28)', overflow: 'visible' }}>
                    {(() => {
                      const frac = duration && duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
                      return (
                        <>
                          <View style={{ height: 5, borderRadius: 3, width: `${frac * 100}%`, backgroundColor: '#88F700' }} />
                          <View
                            style={{
                              position: 'absolute', top: -5, left: `${frac * 100}%`, marginLeft: -8,
                              width: 16, height: 16, borderRadius: 8, backgroundColor: '#88F700',
                              borderWidth: 2, borderColor: '#0B1220',
                              transform: [{ scale: scrubbing ? 1.25 : 1 }],
                            }}
                          />
                        </>
                      );
                    })()}
                  </View>
                </View>
                {/* Time + transport */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                  <Text style={{ color: colors.text_muted, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 78 }}>
                    {fmtClock(position)} / {fmtClock(duration ?? 0)}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <TouchableOpacity onPress={() => void scrubTo(0)} style={{ width: 38, height: 40, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Restart">
                      <Ionicons name="play-skip-back" size={19} color={colors.text_primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => seekBy(-2)} style={{ width: 38, height: 40, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Back 2 seconds">
                      <Ionicons name="play-back" size={20} color={colors.text_primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => seekBy(-FRAME_SEC)} style={{ width: 34, height: 40, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Previous frame">
                      <Ionicons name="caret-back-outline" size={17} color={colors.text_muted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={togglePlayPause} style={{ width: 46, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.accent_muted, marginHorizontal: 2 }} accessibilityRole="button" accessibilityLabel={isPlaying ? 'Pause' : 'Play'}>
                      <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color={colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => seekBy(FRAME_SEC)} style={{ width: 34, height: 40, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Next frame">
                      <Ionicons name="caret-forward-outline" size={17} color={colors.text_muted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => seekBy(2)} style={{ width: 38, height: 40, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Forward 2 seconds">
                      <Ionicons name="play-forward" size={20} color={colors.text_primary} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={cycleSlowMo}
                    style={{ minWidth: 40, height: 40, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: playbackRate < 1 ? colors.accent : colors.border }}
                    accessibilityRole="button"
                    accessibilityLabel={`Playback speed ${playbackRate} times; tap to change`}
                  >
                    <Text style={{ color: playbackRate < 1 ? colors.accent : colors.text_muted, fontSize: 12, fontWeight: '800' }}>
                      {playbackRate === 1 ? '1×' : playbackRate === 0.5 ? '½×' : '¼×'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
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
                <TouchableOpacity
                  style={[styles.toggleBtn, { flexDirection: 'row' }, motionOnly && { backgroundColor: colors.accent }]}
                  onPress={() => setMotionOnly(v => !v)}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle motion-only view (hide the golfer, keep the skeleton)"
                >
                  <Ionicons name="walk-outline" size={14} color={motionOnly ? '#fff' : colors.text_muted} style={{ marginRight: 6 }} />
                  <Text style={[styles.toggleText, motionOnly && { color: '#fff' }]}>Motion Only</Text>
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

        {/* Phase V — analysis processing / failure / done.
            2026-07-10 (Tim — "just analyze the video, don't make me find the swing;
            it keeps reintroducing") — an uploaded clip AUTO-analyzes on open: the
            auto-analyze effect above LOCATES the swing in the clip and windows the
            read on it, no manual marking. So a 'pending' upload is NOT idle — it's
            the auto pass in flight (locate can take a beat on a cold call). Show the
            ANALYZING SPINNER, never a "point at your swing" CTA. Manual scrubbing
            survives ONLY as the post-read "Swing-Point Analyzer" refine (below) and
            the failed-state fallback — never as the first-analysis step. Live
            captures (cage / Smart Motion) already carve their swings. */}
        <View style={{ marginTop: 16 }}>
          {analysisStatus === 'pending' && (
            session.source === 'uploaded_video' ? (
              <View style={[styles.analyzingCard, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'column', alignItems: 'stretch', gap: 12 }]}>
                <Text style={[styles.analyzingText, { color: colors.text_primary }]}>Analyzing your swing</Text>
                <SwingAnalysisSteps />
                <Text style={[styles.analyzingSub, { color: colors.text_muted }]}>
                  About a minute — you can stay on this screen.
                </Text>
              </View>
            ) : (
              <View style={[styles.analyzingCard, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
                <Text style={[styles.analyzingText, { color: colors.text_primary }]}>Ready to analyze</Text>
                <Text style={[styles.analyzingSub, { color: colors.text_muted }]}>
                  Your swing is saved. Analysis runs when you choose — tap to analyze this swing.
                </Text>
                <TouchableOpacity
                  onPress={onReanalyze}
                  disabled={analyzeInFlightRef.current}
                  style={[styles.failedBtn, { borderColor: colors.accent, alignSelf: 'flex-start', opacity: analyzeInFlightRef.current ? 0.5 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Analyze this swing"
                >
                  <Ionicons name="sparkles-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
                  <Text style={[styles.failedBtnText, { color: colors.accent }]}>Analyze this swing</Text>
                </TouchableOpacity>
              </View>
            )
          )}
          {(analysisStatus === 'analyzing_frames' || analysisStatus === 'analyzing_pose' || analysisStatus === 'analyzing_pattern') && (
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
              {/* Last-resort manual fallback — ONLY here, never the default
                  flow. If the AI still couldn't find the swing on its own
                  (very long clip, multiple swings it couldn't separate), let
                  the player scrub to the swing and analyze just that window. */}
              <Text style={[styles.tsHint, { color: colors.text_muted, marginTop: 12 }]}>
                Still no read? Scrub the video to your swing, then:
              </Text>
              <TouchableOpacity
                style={[styles.failedBtn, { borderColor: colors.accent, opacity: reanalyzing ? 0.5 : 1, marginTop: 8, alignSelf: 'flex-start' }]}
                onPress={onAnalyzeAtPosition}
                disabled={reanalyzing}
              >
                <Text style={[styles.failedBtnText, { color: colors.accent }]}>
                  Analyze the swing at 0:{Math.floor(position).toString().padStart(2, '0')}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 2026-06-29 (Tim) — SWING-POINT ANALYZER (option B). The auto-analyze
              above runs the WHOLE swing automatically on open; this is the explicit
              second option below it: play, pause, scrub to a specific portion, and
              analyze just that moment. Uploads only, once the auto pass is done
              (hidden while pending/analyzing/failed — those states show their own CTA). */}
          {session.source === 'uploaded_video' && analysisStatus !== 'pending' && analysisStatus !== 'failed' && !reanalyzing ? (
            <View style={[styles.analyzingCard, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'column', alignItems: 'stretch', gap: 10, marginTop: 12 }]}>
              <Text style={[styles.analyzingText, { color: colors.text_primary }]}>Swing-Point Analyzer</Text>
              <Text style={[styles.analyzingSub, { color: colors.text_muted }]}>
                Want a specific part? Play, pause, and scrub to the exact moment — then analyze just that portion.
              </Text>
              <TouchableOpacity
                onPress={onAnalyzeAtPosition}
                disabled={analyzeInFlightRef.current}
                style={[styles.failedBtn, { borderColor: colors.accent, alignSelf: 'flex-start', opacity: analyzeInFlightRef.current ? 0.5 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel={`Analyze the swing at ${Math.floor(position)} seconds`}
              >
                <Ionicons name="sparkles-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
                <Text style={[styles.failedBtnText, { color: colors.accent }]}>
                  Analyze the swing at 0:{Math.floor(position).toString().padStart(2, '0')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

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
                // 2026-07-06 (Tim's five-swing session) — title off the
                // evidence-gated primary_fault FIRST; detected_issue is
                // prompt-steered to 'none', so titling off it alone printed
                // "no clear issue" directly above an observation describing
                // the fault. Legacy sessions without primary_fault keep the
                // old behavior.
                const pf = a?.primary_fault;
                const pfDiagnostic = !!pf && pf !== 'no_dominant_fault' && pf !== 'inconclusive';
                // 2026-07-07 (Tim — chunk honesty) — a contact mishit the MOTION read
                // can't see wins the label, so a fat strike never lists as "no clear
                // issue". contact_read is 'unknown' by default (no false positives).
                const cr = a?.contact_read;
                const contactLabel = cr === 'fat' ? 'heavy / fat contact'
                  : cr === 'thin' ? 'thin contact'
                  : cr === 'topped' ? 'topped'
                  : null;
                const issueLabel = contactLabel
                  ? contactLabel
                  : pfDiagnostic
                    ? pf.replace(/_/g, ' ')
                    : a?.detected_issue && a.detected_issue !== 'none'
                      ? a.detected_issue.replace(/_/g, ' ')
                      : a
                        ? (pf === 'inconclusive' ? 'couldn\'t read this one' : 'no clear issue')
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

          {/* 2026-07-08 (Tim — "I uploaded a meta glasses putt and it won't read it") — an
              uploaded putt that wasn't tagged as one routes to the full-SWING analyzer, which
              can't read a putt (no full-body swing to locate → useless/no read). Give an
              explicit escape hatch: re-tag as a putt and re-run through the putting analyzer.
              Only shown when this upload isn't already a putting session. */}
          {session.source === 'uploaded_video' && !isPuttingSession(session) && (
            <TouchableOpacity
              style={[styles.reanalyzeBtn, { borderColor: colors.border, marginTop: 8 }]}
              onPress={() => {
                // 2026-07-08 (audit) — getAnalyzerKind returns 'swing' for perspective
                // 'watching_someone' BEFORE it checks the tag (set when a family member was
                // active at upload). So flip perspective to pov_self too, or re-tagging as a
                // putt silently no-ops and re-runs the swing analyzer again.
                useCageStore.getState().patchSessionUpload(swing_id, { tag: 'putt', perspective: 'pov_self' });
                useToastStore.getState().show('Reading this as a putt…');
                onReanalyze();
              }}
            >
              <Text style={[styles.reanalyzeText, { color: colors.accent }]}>This is a putt — read it as one</Text>
            </TouchableOpacity>
          )}

          {/* Bilateral link picker — hoisted out of analysisStatus==='ok' block so a
              re-analyze or status change doesn't unmount it mid-interaction. */}
          <Modal visible={linkPickerOpen} transparent animationType="slide" onRequestClose={() => setLinkPickerOpen(false)}>
            <View style={styles.linkBackdrop}>
              <View style={[styles.linkSheet, { backgroundColor: colors.surface }]}>
                <Text style={[styles.linkTitle, { color: colors.text_primary }]}>Pick the other angle</Text>
                <Text style={[styles.linkSub, { color: colors.text_muted }]}>Choose the same swing from the other camera (one down-the-line, one face-on).</Text>
                <ScrollView style={{ maxHeight: 360 }}>
                  {otherSessions.length === 0 ? (
                    <Text style={[styles.linkSub, { color: colors.text_muted, paddingVertical: 16 }]}>No other swings yet — upload the second angle first.</Text>
                  ) : otherSessions.map((os) => {
                    const ang = os.upload?.angleOverride;
                    const angLabel = ang === 'face_on' ? 'FACE-ON' : ang === 'down_the_line' ? 'DTL' : '—';
                    const club = os.currentClub ?? os.club ?? 'swing';
                    const d = (() => { try { return new Date(os.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } })();
                    return (
                      <TouchableOpacity
                        key={os.id}
                        style={[styles.linkRow, { borderColor: colors.border }]}
                        onPress={() => {
                          setLinkPickerOpen(false);
                          router.push(`/swinglab/bilateral?a=${swing_id}&b=${os.id}` as never);
                        }}
                      >
                        <Text style={[styles.linkRowText, { color: colors.text_primary }]} numberOfLines={1}>{club} · {d}</Text>
                        <Text style={[styles.linkRowBadge, { color: colors.accent }]}>{angLabel}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <TouchableOpacity onPress={() => setLinkPickerOpen(false)} style={styles.linkCancel}>
                  <Text style={[styles.linkCancelText, { color: colors.text_muted }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* 2026-06-23 (Tim) — golfer attribution picker. Always-editable: who hit
              this swing. Rows = You (account holder) + each family member + "Add
              golfer". The auto-detect row is a disabled future stub. Mirrors the
              link-picker bottom-sheet styling. Hoisted out of any status block so it
              survives a re-analyze. */}
          <Modal visible={golferSheetOpen} transparent animationType="slide" onRequestClose={() => setGolferSheetOpen(false)}>
            <View style={styles.linkBackdrop}>
              <View style={[styles.linkSheet, { backgroundColor: colors.surface }]}>
                <Text style={[styles.linkTitle, { color: colors.text_primary }]}>Who hit this swing?</Text>
                <Text style={[styles.linkSub, { color: colors.text_muted }]}>Tag the golfer so this swing files under the right person.</Text>
                <ScrollView style={{ maxHeight: 360 }}>
                  {/* You (account holder) */}
                  <TouchableOpacity
                    style={[styles.linkRow, { borderColor: colors.border }]}
                    onPress={() => assignGolfer(accountHolderPlayerId)}
                  >
                    <Text style={[styles.linkRowText, { color: colors.text_primary }]} numberOfLines={1}>You (account holder)</Text>
                    {currentPlayerId === accountHolderPlayerId ? (
                      <Ionicons name="checkmark" size={18} color={colors.accent} />
                    ) : null}
                  </TouchableOpacity>
                  {/* One row per family member */}
                  {activeGolfers.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.linkRow, { borderColor: colors.border }]}
                      onPress={() => assignGolfer(m.id)}
                    >
                      <Text style={[styles.linkRowText, { color: colors.text_primary }]} numberOfLines={1}>{m.firstName}</Text>
                      {currentPlayerId === m.id ? (
                        <Ionicons name="checkmark" size={18} color={colors.accent} />
                      ) : null}
                    </TouchableOpacity>
                  ))}
                  {/* 2026-06-30 (Tim) — "Other" bucket: someone else hit this swing
                      (a guest / unknown golfer). Files under the Other chip in the
                      library; re-tag to a real golfer anytime. */}
                  <TouchableOpacity
                    style={[styles.linkRow, { borderColor: colors.border }]}
                    onPress={() => assignGolfer(OTHER_PLAYER_ID)}
                  >
                    <Text style={[styles.linkRowText, { color: colors.text_primary }]} numberOfLines={1}>Other (someone else)</Text>
                    {currentPlayerId === OTHER_PLAYER_ID ? (
                      <Ionicons name="checkmark" size={18} color={colors.accent} />
                    ) : null}
                  </TouchableOpacity>
                  {/* + Add golfer — inline input, no leaving the sheet */}
                  {addGolferOpen ? (
                    <View style={[styles.linkRow, { borderColor: colors.border }]}>
                      <TextInput
                        value={newGolferName}
                        onChangeText={setNewGolferName}
                        placeholder="Golfer's name"
                        placeholderTextColor={colors.text_muted}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={onAddGolferSubmit}
                        style={{ flex: 1, marginRight: 10, color: colors.text_primary, fontSize: 14, fontWeight: '600', paddingVertical: 2 }}
                      />
                      <TouchableOpacity onPress={onAddGolferSubmit} disabled={!newGolferName.trim()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={[styles.linkRowBadge, { color: newGolferName.trim() ? colors.accent : colors.text_muted }]}>ADD</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.linkRow, { borderColor: colors.border }]}
                      onPress={() => setAddGolferOpen(true)}
                    >
                      <Text style={[styles.linkRowText, { color: colors.accent }]} numberOfLines={1}>+ Add golfer…</Text>
                    </TouchableOpacity>
                  )}
                  {/* FUTURE: biometric auto-register (face/body signature from swing frames → match to family member). Stubbed per Tim 2026-06-23 — needs consent decision before building. See memory: golfer biometric stub. */}
                  <View
                    style={[styles.linkRow, { borderColor: colors.border, opacity: 0.4 }]}
                    pointerEvents="none"
                  >
                    <Text style={[styles.linkRowText, { color: colors.text_muted }]} numberOfLines={1}>✨ Auto-detect golfer · Coming soon</Text>
                    <Ionicons name="scan-outline" size={16} color={colors.text_muted} />
                  </View>
                </ScrollView>
                <TouchableOpacity onPress={() => { setGolferSheetOpen(false); setAddGolferOpen(false); setNewGolferName(''); }} style={styles.linkCancel}>
                  <Text style={[styles.linkCancelText, { color: colors.text_muted }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

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
              {/* 2026-06-14 (Tim — bilateral / second video source) — link another
                  library swing (the other angle of the same swing) → combined read. */}
              <TouchableOpacity
                style={[styles.linkAngleBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => setLinkPickerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Link a second camera angle of this swing"
              >
                <Ionicons name="git-compare-outline" size={18} color={colors.accent} />
                <Text style={[styles.linkAngleText, { color: colors.text_primary }]}>Link a second angle (bilateral)</Text>
              </TouchableOpacity>
              {/* 2026-05-23 (Fix #5) — DrillCard gated on
                  drill_recommendation being non-null for putting
                  sessions so no empty drill placeholder appears
                  alongside the putting + primary-issue cards.
                  Full-swing sessions keep the existing placeholder
                  rendering behavior (null → "Drill suggestions will
                  appear..."). */}
              {(!session.putting_analysis || drillRecommendation) && (
                <DrillCard recommendation={drillRecommendation} />
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
                    {session.biomechanics.frames.length > 0
                      ? `Measured from ${session.biomechanics.frames.length} swing keyframes`
                      : 'Measured from on-device pose'}
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
                  {/* 2026-06-30 (audit C6) — shoulderTilt + sequencing verdicts were
                      computed (poseAnalysisApi) and persisted but never rendered here. */}
                  {session.biomechanics.verdicts.shoulderTilt && (
                    <Text style={[styles.biomechRow, { color: colors.text_primary }]}>• {session.biomechanics.verdicts.shoulderTilt}</Text>
                  )}
                  {session.biomechanics.verdicts.sequencing && (
                    <Text style={[styles.biomechRow, { color: colors.text_primary }]}>• {session.biomechanics.verdicts.sequencing}</Text>
                  )}
                </View>
              )}
              {/* 2026-06-29 (Tim — "save the WHOLE session report") — the SmartMotion
                  review report, now persisted with the session and rendered here so the
                  library swing mirrors what you saw: the BODY ANALYSIS icon card, the
                  tempo bar, and the shot map (effort / carry / launch). Saved data, no
                  recompute. */}
              {session.smart_motion_shot_map?.bodyItems && session.smart_motion_shot_map.bodyItems.length > 0 ? (
                <BodyAnalysisRow items={session.smart_motion_shot_map.bodyItems as BodyItem[]} style={{ marginTop: 12 }} />
              ) : null}
              {session.smart_motion_shot_map?.tempo?.ratio != null ? (
                <View style={{ marginTop: 12 }}>
                  <TempoBar ratio={session.smart_motion_shot_map.tempo.ratio} />
                  {/* 2026-06-30 (Tim — audit) — the tempo MS detail was persisted but never shown. */}
                  {(session.smart_motion_shot_map.tempo.backswingMs != null && session.smart_motion_shot_map.tempo.downswingMs != null) ? (
                    <Text style={[styles.biomechSub, { color: colors.text_muted, marginTop: 4 }]}>
                      Back {(session.smart_motion_shot_map.tempo.backswingMs / 1000).toFixed(1)}s · Down {(session.smart_motion_shot_map.tempo.downswingMs / 1000).toFixed(1)}s
                      {session.smart_motion_shot_map.tempo.sequencingScore != null ? ` · Transition ${Math.round(session.smart_motion_shot_map.tempo.sequencingScore)}` : ''}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {session.smart_motion_shot_map && (session.smart_motion_shot_map.effortPct != null || session.smart_motion_shot_map.estCarry != null || session.smart_motion_shot_map.trace) ? (
                <View style={[styles.biomechCard, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 12 }]}>
                  <Text style={[styles.biomechLabel, { color: colors.accent }]}>SHOT MAP</Text>
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                    {session.smart_motion_shot_map.effortPct != null ? (
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.biomechSub, { color: colors.text_muted }]}>EFFORT</Text>
                        <Text style={[styles.biomechRow, { color: colors.text_primary, fontWeight: '900' }]}>{session.smart_motion_shot_map.effortPct}%</Text>
                      </View>
                    ) : null}
                    {session.smart_motion_shot_map.estCarry != null ? (
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.biomechSub, { color: colors.text_muted }]}>CARRY</Text>
                        <Text style={[styles.biomechRow, { color: colors.text_primary, fontWeight: '900' }]}>~{session.smart_motion_shot_map.estCarry} yds</Text>
                      </View>
                    ) : null}
                    {session.smart_motion_shot_map.trace ? (
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.biomechSub, { color: colors.text_muted }]}>LAUNCH</Text>
                        <Text style={[styles.biomechRow, { color: colors.text_primary, fontWeight: '900' }]}>
                          {session.smart_motion_shot_map.trace.side === 'left' ? `${session.smart_motion_shot_map.trace.divergenceDeg}° L`
                            : session.smart_motion_shot_map.trace.side === 'right' ? `${session.smart_motion_shot_map.trace.divergenceDeg}° R`
                            : 'Straight'}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {(session.smart_motion_shot_map.canvasFeet != null || session.smart_motion_shot_map.cameraBehindFeet != null) ? (
                    <Text style={[styles.biomechSub, { color: colors.text_muted, marginTop: 8 }]}>
                      {session.smart_motion_shot_map.canvasFeet != null ? `Canvas ${session.smart_motion_shot_map.canvasFeet} ft` : ''}
                      {session.smart_motion_shot_map.cameraBehindFeet != null ? `${session.smart_motion_shot_map.canvasFeet != null ? '  ·  ' : ''}Camera ${session.smart_motion_shot_map.cameraBehindFeet} ft back` : ''}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {/* 2026-06-30 (Tim — audit) — the player's stated FEEL was captured
                  (setSessionFeel) but never shown anywhere. Surface it with the read. */}
              {session.feel_note && session.feel_note.trim() ? (
                <View style={[styles.biomechCard, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 12 }]}>
                  <Text style={[styles.biomechLabel, { color: colors.accent }]}>HOW IT FELT</Text>
                  <Text style={[styles.biomechRow, { color: colors.text_primary, marginTop: 6 }]}>{session.feel_note}</Text>
                </View>
              ) : null}
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
      const apiUrl = getApiBaseUrl();
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
  const apiUrl = getApiBaseUrl();

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
  // 2026-06-14 — bilateral link button + picker sheet
  linkAngleBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginHorizontal: 16, marginTop: 12 },
  linkAngleText: { fontSize: 14, fontWeight: '700' },
  linkBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  linkSheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 30 },
  linkTitle: { fontSize: 18, fontWeight: '900' },
  linkSub: { fontSize: 12, marginTop: 4, marginBottom: 10 },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, paddingVertical: 12 },
  linkRowText: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 10 },
  linkRowBadge: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  linkCancel: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  linkCancelText: { fontSize: 14, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  back: { fontSize: 16, fontWeight: '600', width: 60 },
  title: { fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  kindBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1,
  },
  kindBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
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
