/**
 * Phase 416 — SmartMotion two-card system.
 *
 * Premium two-card swing analysis matching Tim's reference design:
 *   CARD 1 — VISUAL: video + pose-overlay (placeholder pending TFJS in
 *            next APK) + Down-the-Line / Face-On toggle + Grid / Overlay /
 *            Draw / Speed controls + scrubber + metrics strip
 *            (real timing + estimated club/ball speed) + Record / Tag
 *            Club / Compare bottom row
 *   CARD 2 — INSIGHT: Kevin's diagnostic (from cloud analyzeSwing —
 *            REAL pose-derived analysis via /api/swing-analysis) + Top
 *            Focus + Recommended Drill + Next Swing Focus + View Full
 *            Data + Record / Tag Club / Compare bottom row
 *
 * Architectural call: pose-skeleton overlay renders a stub (the
 * StubSkeletonOverlay component below) with normalized keypoint
 * positions matching the MoveNet-17 subset we'll receive when the
 * TFJS / MoveNet integration lands in a future APK build (TFJS +
 * expo-gl native deps; same future-build scope as the Galaxy Watch
 * SDK). Card 2 insights are REAL today via the existing cloud
 * analysis path (/api/swing-analysis).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QuickTutorial } from '../../components/QuickTutorial';
import VideoAnnotationOverlay from '../../components/swinglab/VideoAnnotationOverlay';
import PriorSwingStrip from '../../components/swinglab/PriorSwingStrip';
import ClubPickerModal, { clubIdToSmashKey, clubIdLabel } from '../../components/cage/ClubPickerModal';
import type { ClubId } from '../../services/clubRecognition';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import Svg, { Line, Circle } from 'react-native-svg';
import { useTheme } from '../../contexts/ThemeContext';
import { analyzeSwing, type SwingAnalysis } from '../../services/poseDetection';
import { useCageStore, type PrimaryIssue } from '../../store/cageStore';
import { synthesizeSwingMetrics, isTruthGrade, type SwingMetric } from '../../services/swingMetricsService';
import { extractPoseFramesFromVideo, type PoseFrame, type Keypoint } from '../../services/poseAnalysisApi';
import { evaluateSwingValidity, type SwingValidity } from '../../services/swingValidity';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useFamilyStore } from '../../store/familyStore';
import { useSettingsStore } from '../../store/settingsStore';
// 2026-05-24 — Z Fold-open layout: constrain the analysis ScrollView
// to a centered max-width so the video + insight cards don't stretch
// edge-to-edge on tablet/fold. Same pattern Play / Dashboard /
// SwingLab tabs use (commit 538cfb3). Phone portrait + fold-closed
// keep current full-width layout (isWide is false on those).
import { useDeviceLayout, WIDE_CONTENT_MAX_WIDTH } from '../../hooks/useDeviceLayout';
// 2026-05-21 — Fix A: persistent caddie tap-to-talk badge so the user
// can reach the caddie from SmartMotion the same way they can from the
// Caddie tab and Cage Mode. Same `listeningSession.toggle()` pipeline.
import { CaddieMicBadge } from '../../components/caddie/CaddieMicBadge';
import GlassesStatusBadge from '../../components/GlassesStatusBadge';
import PoseSourceBadge from '../../components/PoseSourceBadge';
// 2026-05-21 — Fix D: 3-line caddie quick-start intro shown the first
// few opens (per-slug counter in settingsStore). Skippable.
import { CaddieIntroSheet, useCaddieIntro } from '../../components/caddie/CaddieIntroSheet';

type Angle = 'down_the_line' | 'face_on';
// 2026-05-20 — Body Mechanics + Grid are overlays on the same SmartMotion
// video, NOT separate tabs. User toggles them on/off independently and
// they composite on the swing playback.
// 2026-05-27 — Fix EL: removed `shot_tracer` from the overlay set
// (Tim: "looks goofy and to my knowledge is not functional"). The
// rendered SVG was a placeholder arc + two dots, not a real
// ball-tracking pipeline. Removed cleanly — when real ball detection
// lands, it can re-introduce its own overlay state.
interface OverlayState {
  body_mechanics: boolean;
  grid: boolean;
  draw: boolean;
}
type SpeedRate = 0.25 | 0.5 | 1;

// 2026-05-19 — Phase 416 — Two-card SmartMotion. See file header for
// architectural call on pose detection seam.
export default function SmartMotion() {
  const router = useRouter();
  const { colors } = useTheme();
  // 2026-05-24 (C2) — measuredBallSpeedMph is set by quick-record's
  // acoustic chain (parallel Audio.Recording → stopAndDetectImpact →
  // /api/acoustic-detect) on in-app captures only. When present, the
  // synthesizer emits source:'acoustic' for ball speed with the
  // honest estimate-tier shape per C1 (~ prefix, ±10% range, med
  // confidence). Absent on camera-roll uploads → pose-only fallback.
  const { clipUri, angle: angleParam, measuredBallSpeedMph: measuredBallSpeedParam, club: clubParam, shotType: shotTypeParam } = useLocalSearchParams<{
    clipUri?: string;
    angle?: string;
    measuredBallSpeedMph?: string;
    club?: string;
    shotType?: string;
  }>();
  // 2026-05-24 — Club tag for the captured swing. Drives the metric
  // synthesizer's smash + carry math. Sourced from (a) URL param when
  // a caller passes it (e.g. a future cage→smartmotion handoff), or
  // (b) the user tagging via the bottom-bar Tag Club button which
  // opens the existing ClubPickerModal (reused). Defaults to null
  // (honest "untagged") — NEVER silently '7I'. Until the user tags,
  // the synthesizer receives null → keyed as 'unknown' → low
  // confidence on smash / ball speed / carry.
  const [selectedClub, setSelectedClub] = useState<ClubId | null>(() => {
    if (typeof clubParam !== 'string' || clubParam.length === 0) return null;
    // Loose normalization for incoming param (e.g. "7i" / "7I" / "7-iron").
    const upper = clubParam.trim().toUpperCase().replace(/[-_\s]/g, '');
    const valid: ClubId[] = ['DR', '3W', '5W', '7W', '2H', '3H', '4H', '5H', '3I', '4I', '5I', '6I', '7I', '8I', '9I', 'PW', 'GW', 'AW', 'SW', 'LW', 'PT'];
    return valid.includes(upper as ClubId) ? (upper as ClubId) : null;
  });
  const [clubPickerOpen, setClubPickerOpen] = useState(false);
  // Parse the acoustic ball speed string param to a finite number.
  // Defensive: ignore non-numeric / negative / zero / NaN.
  const measuredBallSpeedMph = (() => {
    if (typeof measuredBallSpeedParam !== 'string' || measuredBallSpeedParam.length === 0) return null;
    const n = Number(measuredBallSpeedParam);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const profile = usePlayerProfileStore();
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const { isWide } = useDeviceLayout();
  const language = useSettingsStore(s => s.language);

  // 2026-05-21 — Fix B: angle is chosen BEFORE recording (in this
  // NoClipHero, in quick-record, or via voice "record me down the
  // line" / "face on") and persists across navigation via URL param.
  // Default is down-the-line — the common swing-analysis convention,
  // best for path / plane / over-the-top / early-extension reads.
  // Was 'face_on' which gave the analyst the wrong orientation for
  // most users' first recordings.
  const initialAngle: Angle =
    angleParam === 'face_on' || angleParam === 'face-on' ? 'face_on' : 'down_the_line';
  const [angle, setAngle] = useState<Angle>(initialAngle);
  const [overlays, setOverlays] = useState<OverlayState>({
    body_mechanics: true,
    grid: false,
    draw: false,
  });
  const toggleOverlay = (key: keyof OverlayState) =>
    setOverlays(prev => ({ ...prev, [key]: !prev[key] }));
  const [playbackSpeed, setPlaybackSpeed] = useState<SpeedRate>(0.5);
  const [analysis, setAnalysis] = useState<SwingAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  // 2026-05-22 — Path A (real pose overlay). Captured swing keyframes
  // run through /api/pose-analysis (RapidAPI MoveNet proxy). When
  // available, RealSkeletonOverlay renders these real keypoints
  // instead of StubSkeletonOverlay's normalized mock. videoDurationMs
  // captured from Video.onLoad so the SWING_POSITIONS fractions land
  // on the right times in the clip.
  const [poseFrames, setPoseFrames] = useState<PoseFrame[] | null>(null);
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  // 2026-05-23 — Persist this clip + its analysis into the Library
  // (cageStore.sessionHistory) so the player can review later. The
  // session is ingested ONCE per clipUri mount (StrictMode-safe via
  // the ref guard); the analysis result is attached AFTER analyzeSwing
  // resolves; biomechanics are attached AFTER pose-frame extraction
  // resolves. Library row then renders with thumbnail + primary
  // issue + biomechanics card automatically.
  const ingestedSessionIdRef = useRef<string | null>(null);
  const ingestedForClipUriRef = useRef<string | null>(null);

  // 2026-05-23 — Library ingestion side-effect. Fires ONCE per clipUri
  // (per-mount StrictMode guard via ref). Creates the CageSession with
  // source='live_cage' so the Library badge renders as CAGE; later
  // effects below patch in the primary_issue + biomechanics as they
  // resolve. Never blocks the analysis path — failure here is logged
  // and SmartMotion keeps rendering normally.
  //
  // 2026-05-23 (Fix #7) — Attribution: when a family member is active
  // in familyStore (coach is recording their student / parent recording
  // their kid), persist the swing under THAT member's name with
  // perspective='watching_someone' so getAnalyzerKind routes it to
  // Phase K full-body swing analysis (not the account holder's POV
  // putting branch). Closes the gap the per-upload picker had: the
  // SmartMotion record path previously hard-coded the account holder
  // regardless of who was being filmed. familyStore is read at ingest
  // time so changing the active member between recordings is honored.
  // 2026-05-27 — Fix EK: pre-warm /api/swing-analysis on hub mount so
  // the first downstream analysis (whether from quick-record or
  // re-analyze on this clip) lands on a hot Lambda. Helper throttles
  // to 1/30s so multiple SmartMotion screens in a session don't
  // hammer the warmup endpoint.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../services/swingAnalysisWarmup').prewarmSwingAnalysis();
  }, []);

  useEffect(() => {
    if (!clipUri) return;
    if (ingestedForClipUriRef.current === clipUri) return;
    try {
      const famState = useFamilyStore.getState();
      const activeMember = famState.active_member_id
        ? famState.members.find(m => m.id === famState.active_member_id) ?? null
        : null;
      const swinger = activeMember?.firstName ?? profile.firstName ?? null;
      const perspective: 'pov_self' | 'watching_someone' =
        activeMember ? 'watching_someone' : 'pov_self';
      const sessionId = useCageStore.getState().ingestUploadedSwing({
        clipUri,
        club: 'unknown',
        upload: {
          uploaded_at: Date.now(),
          notes: `SmartMotion ${angle === 'face_on' ? 'face-on' : 'down-the-line'} swing`,
          duration_sec: null,
          has_audio: false,
          source_device: 'phone',
          tag: null,
          swinger,
          perspective,
        },
        source: 'live_cage',
      });
      ingestedSessionIdRef.current = sessionId;
      ingestedForClipUriRef.current = clipUri;
      console.log('[smartmotion] ingested swing into Library', sessionId,
        '· swinger:', swinger, '· perspective:', perspective);
    } catch (e) {
      console.log('[smartmotion] Library ingest failed (non-fatal):', e);
    }
  }, [clipUri, angle, profile.firstName]);

  // 2026-05-28 — Fix FP: audio transcription is handled by
  // swingCommentaryService (started in app/_layout.tsx) which
  // subscribes to cageStore and writes shot.commentary_transcript.
  // Re-firing here would duplicate the network call.

  // Kick off cloud swing analysis on mount.
  useEffect(() => {
    if (!clipUri) return;
    let cancelled = false;
    void (async () => {
      setAnalyzing(true);
      setAnalysisError(null);
      try {
        const result = await analyzeSwing(clipUri, {
          club: 'unknown',
          swing_number: 1,
          caddie_name: caddiePersonality,
          // 2026-05-21 — Fix B: pass the angle chosen at SETUP so the
          // analyst's prompt knows the camera orientation. Reading
          // weight-shift from a down-the-line clip (or path from a
          // face-on clip) was the diagnosis-wrong-orientation bug.
          angle,
          // 2026-05-21 — Fix E: pass selected language so the analyst
          // writes the observation in Spanish/Chinese when the user
          // has flipped the setting. Previously every observation
          // came back English regardless.
          language,
          player_context: {
            handicap: profile.handicap ?? null,
            dominant_miss: profile.dominantMiss ?? null,
            first_name: profile.name?.split(' ')[0] ?? null,
          },
          // 2026-05-28 — Fix FM: SmartMotion is the speed surface.
          // tier='quick' tells the server to run Haiku 4.5 only and
          // ship whatever it returns — no OpenAI / Sonnet escalation,
          // no 30-50s climb on a clip that already has a usable read.
          // Library uploads (videoUpload.runPhaseKOnSession) stay on
          // the full chain where deeper analysis matters more.
          tier: 'quick',
          // 2026-05-28 — Fix FN: route chip/putt clips to the server's
          // PUTT_SYSTEM_PROMPT short-game branch so the analyzer
          // doesn't try to call full-swing faults (early extension,
          // over-the-top, etc.) on a chip or putt motion. Two signals
          // produce the tag: (a) voice "chip cam" / "putt cam" passed
          // shotType via quick-record forward; (b) club selection of a
          // wedge or putter. Either is sufficient. Without this tag
          // every glasses-POV chip was getting full-swing fault
          // classification → spurious "early extension" reads.
          swing_tag: (() => {
            const fromShotType =
              typeof shotTypeParam === 'string' &&
              (shotTypeParam === 'chip' || shotTypeParam === 'putt')
                ? shotTypeParam
                : null;
            if (fromShotType) return fromShotType;
            if (selectedClub === 'PT') return 'putt';
            if (selectedClub === 'LW' || selectedClub === 'SW' || selectedClub === 'GW') return 'chip';
            return null;
          })(),
        });
        if (cancelled) return;
        if (result.kind === 'ok') {
          setAnalysis(result.analysis);
          // 2026-05-23 — Persist the analysis onto the Library
          // session. Synthesize a PrimaryIssue from SwingAnalysis so
          // the Library row + swing detail screen render the same
          // shape as a video-upload session. Mapping mirrors the
          // tentative-issue fallback in videoUpload.ts.
          const sessionId = ingestedSessionIdRef.current;
          if (sessionId) {
            try {
              const a = result.analysis;
              const issueId = a.detected_issue && a.detected_issue !== 'none'
                ? a.detected_issue
                : 'smartmotion_observation';
              const primaryIssue: PrimaryIssue = {
                issue_id: issueId,
                name: issueId === 'smartmotion_observation'
                  ? 'SmartMotion observation'
                  : issueId.replace(/_/g, ' '),
                category: 'other',
                severity: (a.severity ?? 'minor') as PrimaryIssue['severity'],
                occurrence_count: 1,
                visual_reference_path: null,
                mechanical_breakdown: a.observation
                  ?? "Captured this swing — see the per-shot details below.",
                feel_cue: a.follow_up_question
                  ?? "Re-record from a different angle for a fuller read.",
                detected_in_shots: [],
                confidence: (a.confidence ?? 'medium') as PrimaryIssue['confidence'],
              };
              useCageStore.getState().setSessionAnalysis(sessionId, primaryIssue, null);
              useCageStore.getState().setSessionAnalysisStatus(sessionId, 'ok');
              console.log('[smartmotion] attached analysis to Library session', sessionId);
            } catch (e) {
              console.log('[smartmotion] attach analysis failed (non-fatal):', e);
            }
          }
        } else {
          setAnalysisError(`Analysis ${result.kind.replace('_', ' ')}`);
          const sessionId = ingestedSessionIdRef.current;
          if (sessionId) {
            try {
              useCageStore.getState().setSessionAnalysisStatus(
                sessionId,
                'failed',
                `analysis ${result.kind}`,
              );
            } catch { /* non-fatal */ }
          }
        }
      } catch (e) {
        if (!cancelled) setAnalysisError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clipUri]);

  // 2026-05-22 — Path A — fetch real pose keypoints once the clip is on
  // screen AND the video has reported its duration. Runs in parallel
  // with analyzeSwing (Card 2). Pose API is rate-limited (RapidAPI),
  // so we fire ONCE per clip mount, never on resize / scrub. Null
  // result (no env vars, network failure, or no person detected) →
  // RealSkeletonOverlay falls through to StubSkeletonOverlay so the
  // UI never regresses.
  useEffect(() => {
    if (!clipUri || videoDurationMs == null) return;
    let cancelled = false;
    void (async () => {
      try {
        const frames = await extractPoseFramesFromVideo(clipUri, videoDurationMs);
        if (!cancelled) setPoseFrames(frames);
        // 2026-05-23 — Persist biomechanics to the Library session if
        // analyzeSwingFromVideo can derive them from the same pose
        // frames. Cheap second pass — the pose API was already hit by
        // extractPoseFramesFromVideo; analyzeSwingFromVideo reuses
        // those results internally. Library row shows the
        // biomechanics card when this lands.
        const sessionId = ingestedSessionIdRef.current;
        if (sessionId && !cancelled) {
          try {
            const poseMod = await import('../../services/poseAnalysisApi');
            const bio = await poseMod.analyzeSwingFromVideo(clipUri, videoDurationMs);
            if (bio && !cancelled) {
              useCageStore.getState().setSessionBiomechanics(sessionId, bio);
              console.log('[smartmotion] persisted biomechanics to Library', sessionId);
            }
          } catch (e) {
            console.log('[smartmotion] biomechanics persist failed (non-fatal):', e);
          }
        }
      } catch (e) {
        console.log('[smartmotion] pose-frame fetch failed (non-fatal):', e);
        if (!cancelled) setPoseFrames(null);
      }
    })();
    return () => { cancelled = true; };
  }, [clipUri, videoDurationMs]);

  // Phase 418 — unified swing validity gate. SmartMotion's pose overlay,
  // metrics strip, and Insight card all consume the SAME validity
  // result so they cannot contradict each other (prior bug:
  // skeleton + fake metrics on floor footage while caddie correctly
  // said "no player visible").
  const validity: SwingValidity = useMemo(
    () => evaluateSwingValidity(analysis),
    [analysis],
  );

  // Derive Top Focus + Drill + Next Swing Focus from the analysis.
  const insight = useMemo(
    () => deriveInsight(analysis, caddiePersonality, validity),
    [analysis, caddiePersonality, validity],
  );

  // 2026-05-21 — Fix D: caddie quick-start intro. Only show pre-record
  // (no clipUri) — once a clip is on screen the user obviously knows
  // what to do. The hook checks the introOpens counter and gates
  // visibility for the first 3 opens.
  const introState = useCaddieIntro('smartmotion', !clipUri);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <CaddieIntroSheet slug="smartmotion" visible={introState.visible} onDismiss={introState.dismiss} />
      <View style={styles.header}>
        {/* 2026-05-21 — Fix A: tap-to-talk caddie badge top-left.
            Same canonical pattern as Cage Mode + every tab's
            BrandHeaderRow — toggles a listening session via the
            shared CaddieMicBadge component. */}
        <CaddieMicBadge size={40} />
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[styles.title, { color: colors.text_primary }]}>SmartMotion</Text>
          <Text style={[styles.subtitle, { color: colors.text_muted }]}>Swing Analysis</Text>
          {/* 2026-05-23 — Glasses badge surfaces when DAT is connected.
              Renders nothing on non-DAT builds (hideWhenUnavailable). */}
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <GlassesStatusBadge />
            {/* Pose source badge — On-device vs Cloud vs No pose. */}
            <PoseSourceBadge />
          </View>
        </View>
        {/* 2026-05-25 — Range Mode retired (Cage Mode + SmartMotion
            cover its use cases; Range was a redundant middle option). */}
      </View>

      {/* 2026-05-20 — Single-view overlay toggle row (not tabs). Body
          Mechanics + Grid composite on the swing playback.
          2026-05-27 — Fix EL: Shot Tracer toggle removed (Tim:
          "looks goofy and to my knowledge is not functional"). The
          rendered SVG was placeholder art, not real ball tracking. */}
      {clipUri ? (
        <View style={styles.overlayRow}>
          <OverlayToggle
            label="Body Mechanics"
            icon="body-outline"
            active={overlays.body_mechanics}
            colors={colors}
            onPress={() => toggleOverlay('body_mechanics')}
          />
          <OverlayToggle
            label="Grid"
            icon="grid-outline"
            active={overlays.grid}
            colors={colors}
            onPress={() => toggleOverlay('grid')}
          />
        </View>
      ) : null}

      {/* 2026-05-19 — Tim's call: simplify. No-clip state shows a big
          prominent Record CTA so the user gets to the camera in ONE
          tap. The full analysis view only renders when a clip exists.
          Bottom action bar is STICKY (absolute-positioned over the
          ScrollView) so Record is always visible — no more burying
          it past the fold. */}
      {!clipUri ? (
        <NoClipHero
          colors={colors}
          angle={angle}
          setAngle={setAngle}
          onRecord={() => router.push({ pathname: '/swinglab/quick-record', params: { angle } } as never)}
          onLibrary={() => router.push('/swinglab/library' as never)}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: 92 },
            isWide && { alignItems: 'center' },
          ]}
          showsVerticalScrollIndicator={false}
        >
         <View style={isWide ? { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH } : undefined}>
          <VisualCard
            clipUri={clipUri ?? null}
            angle={angle}
            setAngle={setAngle}
            overlays={overlays}
            playbackSpeed={playbackSpeed}
            setPlaybackSpeed={setPlaybackSpeed}
            analysis={analysis}
            analyzing={analyzing}
            validity={validity}
            colors={colors}
            poseFrames={poseFrames}
            onVideoDuration={(ms) => setVideoDurationMs(ms)}
            clipDurationMs={videoDurationMs}
            handicap={profile.handicap ?? null}
            measuredBallSpeedMph={measuredBallSpeedMph}
            clubSmashKey={selectedClub ? clubIdToSmashKey(selectedClub) : null}
          />
          {/* 2026-05-26 — Fix AU: prior-swing strip + cross-analyze.
              Renders the last 2 SmartMotion swings (other than the
              one on screen) as small thumbnail rows with play / info /
              compare actions. Compare hits /api/swing-compare for a
              Gemini-led diff in the caddie's voice. Hides itself when
              there's no prior swing — zero chrome on first capture. */}
          <PriorSwingStrip currentClipUri={clipUri ?? null} />
          <InsightCard
            colors={colors}
            analyzing={analyzing}
            analysisError={analysisError}
            analysis={analysis}
            validity={validity}
            insight={insight}
            caddieName={caddieDisplay(caddiePersonality)}
            dominantMiss={profile.dominantMiss ?? null}
            onRetake={() => router.push('/swinglab/quick-record' as never)}
            onPressDrill={(drillKey) => router.push(`/drills/${drillKey}` as never)}
          />
         </View>
        </ScrollView>
      )}

      {/* Sticky bottom action bar — always visible, doesn't scroll
          out of view. Hidden in no-clip state (NoClipHero has its
          own giant Record CTA). */}
      {clipUri ? (
        <View style={styles.stickyBar}>
          <BottomBar
            colors={colors}
            onRecord={() => router.push('/swinglab/quick-record' as never)}
            onTagClub={() => setClubPickerOpen(true)}
            onCompare={() => router.push('/swinglab/library' as never)}
            clubLabel={clubIdLabel(selectedClub)}
          />
        </View>
      ) : null}
      {/* 2026-05-24 — Club picker (reused cage component in standalone
          mode, no cage-store mutation). Selected club drives the
          metric synthesizer above. */}
      <ClubPickerModal
        open={clubPickerOpen}
        onClose={() => setClubPickerOpen(false)}
        selected={selectedClub}
        onPick={(c) => {
          setSelectedClub(c);
          setClubPickerOpen(false);
        }}
      />
      <QuickTutorial
        slug="smartmotion_intro"
        title="SmartMotion"
        lines={[
          "This is SmartMotion — record a swing and I'll break it down.",
          "Hit record, take your swing, I'll read the whole motion back — not just your setup.",
          "Tap any term you don't know — I'll put it in plain English.",
        ]}
        spokenText="This is SmartMotion. Hit record, take your swing, I'll read it back."
      />
    </SafeAreaView>
  );
}

// ─── No-clip hero (entry state) ─────────────────────────────────────

function NoClipHero({ colors, angle, setAngle, onRecord, onLibrary }: {
  colors: ReturnType<typeof useTheme>['colors'];
  angle: Angle;
  setAngle: (a: Angle) => void;
  onRecord: () => void;
  onLibrary: () => void;
}) {
  return (
    <View style={styles.noClipHero}>
      <View style={[styles.noClipCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
        <View style={[styles.noClipIcon, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
          <Ionicons name="videocam" size={48} color={colors.accent} />
        </View>
        <Text style={[styles.noClipTitle, { color: colors.text_primary }]}>Ready when you are.</Text>
        <Text style={[styles.noClipSub, { color: colors.text_muted }]}>
          Tap Record. AI swing analysis · body mechanics overlay · drill recommendation. Shot tracing coming.
        </Text>

        {/* 2026-05-21 — Fix B: pre-record angle picker. The analyst
            uses the SETUP angle for biomechanical reads, so it has
            to be chosen BEFORE recording. Default = down-the-line. */}
        <Text style={[styles.preRecordLabel, { color: colors.text_muted }]}>CAMERA ANGLE</Text>
        <View style={styles.preRecordAngleRow}>
          <PreRecordAnglePill
            label="Down the Line"
            sub="Path · plane · over-the-top"
            icon="trending-up-outline"
            active={angle === 'down_the_line'}
            colors={colors}
            onPress={() => setAngle('down_the_line')}
          />
          <PreRecordAnglePill
            label="Face On"
            sub="Weight · hips · reverse pivot"
            icon="person-outline"
            active={angle === 'face_on'}
            colors={colors}
            onPress={() => setAngle('face_on')}
          />
        </View>

        <TouchableOpacity
          onPress={onRecord}
          style={[styles.noClipPrimary, { backgroundColor: colors.accent }]}
          accessibilityRole="button"
          accessibilityLabel={`Record a ${angle === 'down_the_line' ? 'down-the-line' : 'face-on'} swing`}
        >
          <Ionicons name="radio-button-on" size={20} color="#060f09" />
          <Text style={[styles.noClipPrimaryText, { color: '#060f09' }]}>
            Record Swing ({angle === 'down_the_line' ? 'Down the Line' : 'Face On'})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onLibrary} style={styles.noClipSecondary}>
          <Ionicons name="albums-outline" size={16} color={colors.accent} />
          <Text style={[styles.noClipSecondaryText, { color: colors.accent }]}>Open Swing Library</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PreRecordAnglePill({ label, sub, icon, active, colors, onPress }: {
  label: string;
  sub: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${sub}`}
      style={[
        styles.preRecordAnglePill,
        active
          ? { backgroundColor: colors.accent_muted, borderColor: colors.accent }
          : { backgroundColor: 'transparent', borderColor: colors.border },
      ]}
    >
      <Ionicons name={icon} size={18} color={active ? colors.accent : colors.text_muted} />
      <Text style={[styles.preRecordAnglePillLabel, { color: active ? colors.accent : colors.text_primary }]}>{label}</Text>
      <Text style={[styles.preRecordAnglePillSub, { color: colors.text_muted }]} numberOfLines={1}>{sub}</Text>
    </TouchableOpacity>
  );
}

// ─── Card 1: Visual ─────────────────────────────────────────────────

function VisualCard({
  clipUri, angle, setAngle, overlays, playbackSpeed, setPlaybackSpeed,
  analysis, analyzing, validity, colors, poseFrames, onVideoDuration,
  clipDurationMs, handicap, measuredBallSpeedMph, clubSmashKey,
}: {
  clipUri: string | null;
  angle: Angle;
  setAngle: (a: Angle) => void;
  overlays: OverlayState;
  playbackSpeed: SpeedRate;
  setPlaybackSpeed: (s: SpeedRate) => void;
  analysis: SwingAnalysis | null;
  analyzing: boolean;
  validity: SwingValidity;
  colors: ReturnType<typeof useTheme>['colors'];
  // 2026-05-22 — Path A — real pose keypoints from /api/pose-analysis
  // when available. Null = backend unconfigured / fetch failed / no
  // person detected → render StubSkeletonOverlay (no regression).
  poseFrames: PoseFrame[] | null;
  onVideoDuration: (ms: number) => void;
  // 2026-05-23 — Threaded for swingMetricsService synthesis. Both
  // optional — null falls through to placeholder source.
  clipDurationMs: number | null;
  handicap: number | null;
  // 2026-05-24 (C2) — Acoustic ball speed in mph from the in-app
  // capture path (quick-record's parallel recorder). Null on
  // camera-roll uploads or when the acoustic chain produced no
  // value (no impact, silent clip, network failure). When non-null
  // the synthesizer emits source:'acoustic' for ball speed per C1.
  measuredBallSpeedMph: number | null;
  // 2026-05-24 — Club hint passed down from SmartMotion's selectedClub
  // state. Drives the synthesizer's smash + carry math. Null when
  // the user hasn't tagged a club — the synthesizer maps null to
  // 'unknown' (smash 1.36) and the source taxonomy labels it as a
  // low-confidence estimate. Never silently '7I'.
  clubSmashKey: string | null;
}) {
  // Phase 418 — render the pose-skeleton and shot-tracer overlays ONLY
  // when the validation gate confirms an analyzable swing AND analysis
  // has completed. During analysis we leave the overlays off so a stub
  // skeleton can't render against floor footage and falsely vanish a
  // second later.
  const overlaysGated = !analyzing && validity.valid;

  // 2026-05-21 — Fix C: skeleton + shot-tracer overlays were drawing
  // against the videoFrame CONTAINER (StyleSheet.absoluteFill), but
  // the actual video pixels live in a centered subrect created by
  // `resizeMode: COVER`. The container's aspect is fixed (4:5); the
  // source clip's aspect varies (9:21 cover-screen, 9:16 phone, etc.)
  // — COVER scales the video to fill the container and crops the
  // overflow. Drawing the SVG against the container meant a body that
  // was actually at the center of the source clip showed up offset in
  // the rendered crop, AND on Z Fold open/close the container resized
  // without the SVG remapping, so the misalignment shifted further.
  //
  // Fix: track the video's natural dimensions (via onReadyForDisplay)
  // + the container's measured size (via onLayout). Compute the
  // displayed video rect with the COVER scale formula. Position the
  // overlay SVGs at that rect, not the full container. Pose keypoints
  // are normalized to the SOURCE video, so SVG percentages now map
  // correctly to actual body pixels. useWindowDimensions is referenced
  // as a re-render trigger so a fold open/close kicks the layout
  // recompute even if the container's onLayout debounces.
  // onLayout on the videoFrame fires on fold/unfold automatically,
  // so the videoRect memo refreshes without needing window
  // dimensions in the dep array.
  useWindowDimensions();
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const [videoNatural, setVideoNatural] = useState<{ width: number; height: number } | null>(null);

  const handleVideoFrameLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize(prev => {
      if (prev && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5) return prev;
      return { width, height };
    });
  };

  const videoRect = useMemo<{ left: number; top: number; width: number; height: number } | null>(() => {
    if (!containerSize || !videoNatural) return null;
    const cW = containerSize.width;
    const cH = containerSize.height;
    const vW = videoNatural.width;
    const vH = videoNatural.height;
    if (!cW || !cH || !vW || !vH) return null;
    // COVER fit: scale to fill the container, cropping any overflow.
    const scale = Math.max(cW / vW, cH / vH);
    const renderedW = vW * scale;
    const renderedH = vH * scale;
    return {
      left: (cW - renderedW) / 2,
      top: (cH - renderedH) / 2,
      width: renderedW,
      height: renderedH,
    };
  }, [containerSize, videoNatural]);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      {/* Angle pill row — Down the Line / Face On */}
      <View style={styles.anglePillRow}>
        <AnglePill
          label="Down the Line"
          icon="checkbox-outline"
          active={angle === 'down_the_line'}
          colors={colors}
          onPress={() => setAngle('down_the_line')}
        />
        <AnglePill
          label="Face On"
          icon="ellipse-outline"
          active={angle === 'face_on'}
          colors={colors}
          onPress={() => setAngle('face_on')}
        />
        <TouchableOpacity hitSlop={8} style={styles.ellipsisBtn}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.text_muted} />
        </TouchableOpacity>
      </View>

      {/* Video frame with pose-overlay placeholder + right control rail */}
      <View style={styles.videoFrame} onLayout={handleVideoFrameLayout}>
        {clipUri ? (
          <Video
            source={{ uri: clipUri }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            shouldPlay
            isLooping
            isMuted
            rate={playbackSpeed}
            useNativeControls={false}
            onLoad={(status) => {
              // 2026-05-22 — Path A — surface real video duration so
              // the parent can extract pose frames at canonical swing
              // positions (P1 / P2 / P4 / P6 / P10 as fractions of
              // total duration). Without this the pose call would use
              // a default 2500ms guess and miss the impact frame on
              // longer clips.
              const d = (status as { durationMillis?: number })?.durationMillis;
              if (typeof d === 'number' && d > 0) onVideoDuration(d);
            }}
            onReadyForDisplay={(payload) => {
              // 2026-05-21 — Fix C: capture the clip's native dimensions
              // so the overlay SVGs can be positioned to the
              // displayed-video subrect (COVER scale + crop) instead of
              // the container box.
              const ns = (payload as { naturalSize?: { width: number; height: number } })?.naturalSize;
              if (ns && ns.width > 0 && ns.height > 0) {
                setVideoNatural(prev => {
                  if (prev && prev.width === ns.width && prev.height === ns.height) return prev;
                  return { width: ns.width, height: ns.height };
                });
              }
            }}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.videoPlaceholder]}>
            <Ionicons name="videocam-outline" size={36} color={colors.text_muted} />
            <Text style={[styles.placeholderText, { color: colors.text_muted }]}>
              No swing recorded yet
            </Text>
            <Text style={[styles.placeholderHint, { color: colors.text_muted }]}>
              Tap Record below to capture a swing
            </Text>
          </View>
        )}

        {/* Composited overlays — each layer toggles independently. */}
        {clipUri && overlays.grid && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {[1, 2, 3].map(i => (
              <Line key={`v${i}`} x1={`${i * 25}%`} y1="0%" x2={`${i * 25}%`} y2="100%" stroke="#ffffff" strokeWidth={0.5} opacity={0.2} />
            ))}
            {[1, 2, 3].map(i => (
              <Line key={`h${i}`} x1="0%" y1={`${i * 25}%`} x2="100%" y2={`${i * 25}%`} stroke="#ffffff" strokeWidth={0.5} opacity={0.2} />
            ))}
          </Svg>
        )}
        {/* 2026-05-21 — Fix C: skeleton + shot-tracer overlays are
            positioned to the DISPLAYED VIDEO RECT (COVER scale +
            crop), not the container box. Keypoint percentages are
            now relative to the actual visible video pixels, so the
            skeleton lands on the body regardless of source-clip
            aspect ratio (9:21 cover-screen, 9:16 phone, etc.) AND
            stays aligned when the Z Fold opens/closes. Falls back to
            absoluteFill when the natural-size/layout hasn't landed
            yet (first frame) — the user sees a brief container-relative
            placement that snaps correct as soon as onReadyForDisplay
            fires. */}
        {clipUri && overlays.body_mechanics && overlaysGated && videoRect && (
          // 2026-05-22 — Path A — render real pose keypoints from
          // /api/pose-analysis when available; falls back to the
          // animated stub when the backend isn't configured or no
          // person was detected.
          //
          // 2026-05-24 — Honesty hardening for launch. RealSkeletonOverlay
          // renders whenever pose data exists (today: env-gated off, so
          // effectively never). StubSkeletonOverlay is now gated behind
          // __DEV__ — production never shows the hardcoded-joint mock.
          // The result screen still surfaces the real diagnostic payload
          // (fault frame as primary visual + Sonnet observation + layman
          // explanation + metric cells with confidence tiers). The stub
          // stays in the code for dev visual-regression use; if/when
          // real pose lands (RapidAPI MoveNet env vars or TFJS native
          // build), this branch automatically uses it.
          poseFrames && poseFrames.length > 0 ? (
            <RealSkeletonOverlay videoRect={videoRect} accent={colors.accent} frames={poseFrames} />
          ) : __DEV__ ? (
            <StubSkeletonOverlay videoRect={videoRect} accent={colors.accent} />
          ) : null
        )}
        {/* 2026-05-27 — Fix EL: Shot Tracer SVG render block removed.
            Was a placeholder dashed arc with two orange dots ("ball
            star"-style markers) — not real ball tracking, looked goofy
            per Tim. When real ball detection ships, it will own its
            own overlay layer. */}

        {/* Phase 418 — honest "no swing" badge over the video when the
            validity gate rejects the footage. User sees the rejection
            reason directly on the clip rather than scrolling for the
            caddie insight to explain it. */}
        {clipUri && !analyzing && !validity.valid && overlays.body_mechanics ? (
          <View style={styles.noSwingBadge} pointerEvents="none">
            <Ionicons name="alert-circle-outline" size={16} color="#fff" />
            <Text style={styles.noSwingBadgeText} numberOfLines={2}>
              No swing detected — overlays paused
            </Text>
          </View>
        ) : null}

        {/* Speed pill — small floating control top-right (replaces
            the right rail since overlays are toggled above the video). */}
        <TouchableOpacity
          onPress={() => {
            const next = playbackSpeed === 0.25 ? 0.5 : playbackSpeed === 0.5 ? 1 : 0.25;
            setPlaybackSpeed(next);
          }}
          style={styles.speedPill}
        >
          <Ionicons name="speedometer-outline" size={14} color="#fff" />
          <Text style={styles.speedPillText}>{playbackSpeed}x</Text>
        </TouchableOpacity>

        {/* 2026-05-25 — Fix AH: coach annotation overlay. Lives ABOVE
            the pose/grid/trace overlays so freehand strokes draw over
            everything. DRAW toggle in the overlay's own toolbar; off
            by default so existing taps + scrub still work. */}
        {clipUri && <VideoAnnotationOverlay />}
      </View>

      {/* 2026-05-20 — Record button integrated INTO the video card
          (just below the playback frame). Tim: "Record/stop/play
          should be integrated into the video screen element, not at
          the bottom of the screen — that's confusing." Big circular
          record button anchored to the analysis card, not the screen
          chrome. */}
      <FrameRecordButton />

      {/* Scrubber (visual placeholder — real frame stepping ships with
          expo-video positionMillis subscription in a follow-up) */}
      <View style={styles.scrubberRow}>
        <Ionicons name="play" size={14} color={colors.accent} />
        <Text style={[styles.scrubberTime, { color: colors.text_muted }]}>
          {playbackSpeed.toFixed(2).replace(/\.?0+$/, '')}x · {analysis ? 'analyzed' : 'analyzing…'}
        </Text>
        <View style={[styles.scrubberTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.scrubberFill, { backgroundColor: colors.accent }]} />
        </View>
      </View>

      {/* Metrics strip — 2026-05-23: synthesized from real signals
          via swingMetricsService. When pose frames are present, the
          peak-wrist-velocity heuristic drives club speed → ball
          speed derives from typical-smash by club → smash factor
          falls out → carry estimates from ball speed. Each cell
          shows the value + a small source tag ("measured" /
          "pose" / "profile" / "est"). Hard-coded placeholders are
          gone — when no signal is available, we show "—". */}
      {(() => {
        const metrics = overlaysGated
          ? synthesizeSwingMetrics({
              poseFrames: poseFrames ?? null,
              clipDurationMs: clipDurationMs ?? null,
              // 2026-05-24 — Real club from user tag (Tag Club button →
              // ClubPickerModal) or URL param. Null when untagged — the
              // synthesizer maps null → 'unknown' → low-confidence smash
              // (1.36 iron average) per the existing typical-smash
              // fallback, and the source taxonomy labels that estimate
              // honestly. We never silently default to '7I'.
              club: clubSmashKey,
              profile: { handicap, clubDistances: null },
              // 2026-05-24 (C2) — Acoustic ball speed from the
              // in-app capture path (quick-record's parallel
              // recorder → /api/acoustic-detect). Null on camera-roll
              // uploads → ball speed falls back to pose-derivation
              // through the existing chain. Synthesizer emits
              // source:'acoustic' (estimate tier, per C1) when present.
              measuredBallSpeedMph,
            })
          : null;
        return (
          <View style={styles.metricsStrip}>
            <MetricCell label="Club Speed" m={metrics?.club_speed} colors={colors} />
            <MetricCell label="Ball Speed" m={metrics?.ball_speed} colors={colors} />
            <MetricCell label="Smash" m={metrics?.smash_factor} colors={colors} />
            <MetricCell label="Carry" m={metrics?.carry_yards} colors={colors} />
          </View>
        );
      })()}
      {!analyzing && !validity.valid ? (
        <Text style={[styles.metricsFooter, { color: colors.text_muted }]}>
          Metrics paused — record a swing with your full body in frame to see estimates.
        </Text>
      ) : null}
    </View>
  );
}

function Metric({ label, value, unit, estimated, colors }: {
  label: string; value: string; unit: string; estimated?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.metricCell}>
      <Text style={[styles.metricLabel, { color: colors.text_muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text_primary }]}>
        {value}{estimated ? <Text style={{ fontSize: 10, color: colors.text_muted }}>~</Text> : null}
      </Text>
      <Text style={[styles.metricUnit, { color: colors.text_muted }]}>{unit}{estimated ? ' (est)' : ''}</Text>
    </View>
  );
}

/** 2026-05-23 — Source-honest metric cell.
 *  2026-05-24 (Metrics 1A) — Now renders the full honest-presentation
 *  shape: '~' prefix on every non-measured value, the estimated range
 *  on a secondary line when present, a confidence dot, and the
 *  methodology note. Matches Cage Mode's "(single-mic, club-typical
 *  × peak)" tone — never bare confident numbers from a pose heuristic.
 *
 *  When the metric returns null with a low confidence label (e.g.
 *  compounded smash/carry suppressed because their parents were low),
 *  we render a "LOW CONFIDENCE" pill instead of a dash so the user
 *  knows the system intentionally chose not to show a number rather
 *  than a sensor failure.
 */
function MetricCell({ label, m, colors }: {
  label: string;
  m: SwingMetric | null | undefined;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  if (!m) {
    return (
      <View style={styles.metricCell}>
        <Text style={[styles.metricLabel, { color: colors.text_muted }]}>{label}</Text>
        <Text style={[styles.metricValue, { color: colors.text_primary }]}>—</Text>
        <Text style={[styles.metricUnit, { color: colors.text_muted }]}>—</Text>
      </View>
    );
  }
  // Null value with non-placeholder source is suppression-on-purpose
  // (e.g. compounded smash where a parent was low confidence). Render
  // an explicit LOW CONFIDENCE chip rather than a dash so the user
  // knows we chose not to show a number. Placeholder + low is the
  // default "no inputs at all" state which already reads as a dash.
  if (m.value == null) {
    const isSuppressed = m.source !== 'placeholder';
    return (
      <View style={styles.metricCell}>
        <Text style={[styles.metricLabel, { color: colors.text_muted }]}>{label}</Text>
        <Text style={[styles.metricValue, { color: colors.text_primary }]}>—</Text>
        <Text style={[styles.metricUnit, { color: isSuppressed ? '#F5A623' : colors.text_muted }]}>
          {isSuppressed ? 'low conf' : (m.unit || '')}
        </Text>
      </View>
    );
  }

  // 2026-05-24 — Truth-grade sources (acoustic / watch / calibrated /
  // legacy measured) skip the `~` prefix and render the raw number
  // (truth, no estimate caveat). Estimate sources (pose / profile /
  // placeholder) keep `~` so the user reads them as honest hedges.
  const truthGrade = isTruthGrade(m.source);
  const tag =
    m.source === 'acoustic'          ? 'acoustic'  :
    m.source === 'watch'             ? 'watch'     :
    m.source === 'calibrated'        ? 'calibrated':
    m.source === 'measured'          ? 'measured'  :
    m.source === 'pose'              ? 'pose'      :
    m.source === 'pose_estimated'    ? 'pose'      :
    m.source === 'profile'           ? 'profile'   :
    m.source === 'profile_estimated' ? 'profile'   :
                                       'est';
  // Cage's pattern: "~95 mph" with the tilde baked into the number.
  // Smash (ratio) gets two decimals; everything else integer.
  const numeric = m.unit === '' ? m.value.toFixed(2) : String(m.value);
  const valueDisplay = truthGrade ? numeric : `~${numeric}`;

  // Confidence dot color — high green, med amber, low red. Hidden for
  // measured (the tag itself is the credibility signal).
  const confColor =
    m.confidenceLabel === 'high' ? '#00C896' :
    m.confidenceLabel === 'med'  ? '#F5A623' :
                                   '#ef4444';

  // Range string: "78–105" for unit'd metrics, "1.32–1.42" for ratios.
  const rangeStr = m.range
    ? (m.unit === ''
        ? `${m.range[0].toFixed(2)}–${m.range[1].toFixed(2)}`
        : `${m.range[0]}–${m.range[1]}`)
    : null;

  return (
    <View style={styles.metricCell}>
      <Text style={[styles.metricLabel, { color: colors.text_muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text_primary }]}>{valueDisplay}</Text>
      <Text style={[styles.metricUnit, { color: colors.text_muted }]}>
        {m.unit}{m.unit ? ' · ' : ''}{tag}
        {!truthGrade && (
          <Text style={{ color: confColor }}>{' '}● {m.confidenceLabel}</Text>
        )}
      </Text>
      {rangeStr && (
        <Text style={[styles.metricRange, { color: colors.text_muted }]}>
          {rangeStr}{m.unit ? ` ${m.unit}` : ''}
        </Text>
      )}
      {!truthGrade && m.estimateNote && (
        <Text style={[styles.metricNote, { color: colors.text_muted }]} numberOfLines={2}>
          {m.estimateNote}
        </Text>
      )}
    </View>
  );
}

function AnglePill({ label, icon, active, colors, onPress }: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.anglePill,
        active
          ? { backgroundColor: colors.accent_muted, borderColor: colors.accent }
          : { backgroundColor: 'transparent', borderColor: colors.border },
      ]}
    >
      <Ionicons name={icon} size={14} color={active ? colors.accent : colors.text_muted} />
      <Text style={[styles.anglePillText, { color: active ? colors.accent : colors.text_muted }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function FrameRecordButton() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={styles.frameRecordWrap}>
      <TouchableOpacity
        style={[styles.frameRecordOuter, { borderColor: colors.accent }]}
        onPress={() => router.push('/swinglab/quick-record' as never)}
        accessibilityRole="button"
        accessibilityLabel="Record a new swing"
      >
        <View style={[styles.frameRecordInner, { backgroundColor: '#ef4444' }]} />
      </TouchableOpacity>
      <Text style={[styles.frameRecordHint, { color: colors.text_muted }]}>Tap to record another swing</Text>
    </View>
  );
}

function OverlayToggle({ label, icon, active, colors, onPress }: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.overlayToggle,
        active
          ? { backgroundColor: colors.accent_muted, borderColor: colors.accent }
          : { backgroundColor: 'transparent', borderColor: colors.border },
      ]}
    >
      <Ionicons name={icon} size={14} color={active ? colors.accent : colors.text_muted} />
      <Text style={[styles.overlayToggleText, { color: active ? colors.accent : colors.text_muted }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function RailButton({ icon, label, active, accent, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.railBtn,
        active ? { backgroundColor: accent + '22', borderColor: accent } : { borderColor: 'transparent' },
      ]}
    >
      <Ionicons name={icon} size={18} color={active ? accent : '#cbd5e1'} />
      <Text style={[styles.railLabel, { color: active ? accent : '#9ca3af' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function TabPill({ label, icon, active, accent, mutedBorder, onPress }: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  accent: string;
  mutedBorder: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.tabPill,
        active
          ? { backgroundColor: 'transparent', borderColor: accent }
          : { backgroundColor: 'transparent', borderColor: mutedBorder },
      ]}
    >
      <Ionicons name={icon} size={14} color={active ? accent : '#9ca3af'} />
      <Text style={[styles.tabPillText, { color: active ? accent : '#9ca3af' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Card 2: Insight ────────────────────────────────────────────────

interface DerivedInsight {
  diagnostic: string;
  topFocus: string;
  topFocusSub: string;
  drillKey: string;
  drillTitle: string;
  drillSub: string;
  nextSwingFocus: string;
  nextSwingArrow: string;
}

// 2026-06-07 — Staged progress copy for the analyzing window. The user
// previously saw "Analyzing your swing…" frozen for 8-15s; now the
// copy rotates through stages that match where the pipeline actually
// is (frame extraction → vision read → biomechanics backfill). UI-only
// rotation — no plumbing into analyzeSwing — fires while `analyzing`
// is true and resets on completion. Reduces perceived latency
// significantly even though wall-clock is unchanged.
const ANALYZE_STAGE_COPY = [
  'Pulling key frames…',      // 0-3s
  'Reading your swing…',       // 3-7s
  'Mapping the body lines…',   // 7-12s
  'Almost there…',             // 12s+
] as const;

function useAnalyzeStageText(analyzing: boolean): string {
  const [stageIdx, setStageIdx] = useState(0);
  useEffect(() => {
    if (!analyzing) {
      setStageIdx(0);
      return;
    }
    const startedAt = Date.now();
    setStageIdx(0);
    const tick = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 3_000) setStageIdx(0);
      else if (elapsed < 7_000) setStageIdx(1);
      else if (elapsed < 12_000) setStageIdx(2);
      else setStageIdx(3);
    }, 500);
    return () => clearInterval(tick);
  }, [analyzing]);
  return ANALYZE_STAGE_COPY[stageIdx];
}

function InsightCard({
  colors, analyzing, analysisError, analysis, validity, insight, caddieName, dominantMiss, onRetake, onPressDrill,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  analyzing: boolean;
  analysisError: string | null;
  analysis: SwingAnalysis | null;
  validity: SwingValidity;
  insight: DerivedInsight;
  caddieName: string;
  dominantMiss: string | null;
  onRetake: () => void;
  onPressDrill: (drillKey: string) => void;
}) {
  // Phase 418 — when the validity gate rejects the footage, the Insight
  // card collapses to an honest "I couldn't see your swing" message
  // with a Record-again CTA. No Top Focus, no Drill, no Next Swing
  // Focus — those imply a real read that doesn't exist.
  const showInvalidState = !analyzing && !analysisError && !validity.valid && analysis !== null;
  // Staged progress copy (Win #10) — rotates through phases while
  // analyzing is true; gives the user real signal that work is
  // happening instead of a single frozen "Analyzing your swing…"
  const stageText = useAnalyzeStageText(analyzing);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface_elevated, borderColor: colors.border, marginTop: 10 }]}>
      <Text style={[styles.insightHeader, { color: colors.accent }]}>{caddieName.toUpperCase()}'S INSIGHT</Text>

      {/* Diagnostic row */}
      <View style={styles.insightRow}>
        <View style={[styles.caddiePortrait, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}>
          <Ionicons name="person" size={28} color={colors.accent} />
        </View>
        <View style={[styles.bubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {analyzing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={[styles.bubbleText, { color: colors.text_muted }]}>{stageText}</Text>
            </View>
          ) : analysisError ? (
            <Text style={[styles.bubbleText, { color: colors.text_muted }]}>
              {analysisError}. Tap Record to try another swing.
            </Text>
          ) : showInvalidState ? (
            <Text style={[styles.bubbleText, { color: colors.text_primary }]}>
              I couldn&apos;t see your swing in this clip — {(validity.reason ?? 'no analyzable swing detected').toLowerCase()}. Point the camera at your full body and try again.
            </Text>
          ) : (
            <Text style={[styles.bubbleText, { color: colors.text_primary }]}>{insight.diagnostic}</Text>
          )}
        </View>
      </View>
      <Text style={[styles.caddieNameLabel, { color: colors.text_muted }]}>{caddieName.toUpperCase()}</Text>

      {showInvalidState ? (
        <>
          {/* Framing tips — visible when the validity gate rejects so
              the user knows HOW to get a usable read on the next try. */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 14 }]}>FRAMING TIPS</Text>
          <View style={[styles.focusCard, { borderColor: colors.border, alignItems: 'flex-start', flexDirection: 'column', gap: 6 }]}>
            <FramingTip text="Phone vertical, on a stable mount or leaned against your bag." />
            <FramingTip text="Stand 6-10 feet away — get your full body in frame head-to-feet." />
            <FramingTip text="Down-the-line: camera behind you, looking at the target line." />
            <FramingTip text="Face-on: camera in front of you, perpendicular to the target line." />
          </View>
          <TouchableOpacity
            onPress={onRetake}
            style={[styles.retakeBtn, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Record another swing"
          >
            <Ionicons name="radio-button-on" size={18} color="#060f09" />
            <Text style={[styles.retakeBtnText, { color: '#060f09' }]}>Record another swing</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Top Focus */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 14 }]}>TOP FOCUS</Text>
          <View style={[styles.focusCard, { borderColor: colors.border }]}>
            <View style={[styles.focusIcon, { borderColor: colors.accent }]}>
              <Ionicons name="refresh-outline" size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.focusTitle, { color: colors.text_primary }]}>{insight.topFocus}</Text>
              <Text style={[styles.focusSub, { color: colors.text_muted }]} numberOfLines={2}>{insight.topFocusSub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
          </View>

          {/* Recommended Drill */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 14 }]}>RECOMMENDED DRILL</Text>
          <TouchableOpacity
            onPress={() => onPressDrill(insight.drillKey)}
            style={[styles.drillCard, { borderColor: colors.border }]}
          >
            <View style={[styles.drillIcon, { borderColor: colors.accent }]}>
              <Ionicons name="body-outline" size={22} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.focusTitle, { color: colors.text_primary }]}>{insight.drillTitle}</Text>
              <Text style={[styles.focusSub, { color: colors.text_muted }]} numberOfLines={2}>{insight.drillSub}</Text>
            </View>
            <View style={[styles.drillThumb, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Ionicons name="play" size={18} color={colors.accent} />
            </View>
          </TouchableOpacity>

          {/* Next Swing Focus */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 14 }]}>NEXT SWING FOCUS</Text>
          <View style={[styles.focusCard, { borderColor: colors.border }]}>
            <View style={[styles.focusIcon, { borderColor: colors.accent }]}>
              <Ionicons name="locate-outline" size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.focusTitle, { color: colors.text_primary }]}>{insight.nextSwingFocus}</Text>
              <Text style={[styles.focusSub, { color: colors.accent }]} numberOfLines={1}>{insight.nextSwingArrow}</Text>
            </View>
          </View>
          {/* View Full Data */}
          <TouchableOpacity style={[styles.fullDataBtn, { borderColor: colors.border }]}>
            <Text style={[styles.fullDataLabel, { color: colors.text_primary }]}>View Full Data</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
          </TouchableOpacity>
        </>
      )}

      {analysis && validity.valid ? (
        <Text style={[styles.confidenceFooter, { color: colors.text_muted }]}>
          Analysis confidence: {analysis.confidence} · severity: {analysis.severity}
        </Text>
      ) : null}
    </View>
  );
}

function FramingTip({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.framingTipRow}>
      <Ionicons name="checkmark-circle-outline" size={14} color={colors.accent} />
      <Text style={[styles.framingTipText, { color: colors.text_muted }]} numberOfLines={2}>{text}</Text>
    </View>
  );
}

// ─── Body Mechanics tab (deeper analysis) ───────────────────────────

function BodyMechanicsCard({ analysis, colors }: {
  analysis: SwingAnalysis | null;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
      <Text style={[styles.insightHeader, { color: colors.accent }]}>BODY MECHANICS</Text>
      <Text style={[styles.bubbleText, { color: colors.text_muted, marginTop: 6 }]}>
        Spine angle, shoulder turn, hip turn, X-factor, and weight transfer visualization land with the
        on-device pose detector in the next APK build. For now, the cloud analysis surfaces the major
        fault pattern below.
      </Text>
      {analysis ? (
        <View style={{ marginTop: 12 }}>
          <Text style={[styles.focusTitle, { color: colors.text_primary }]}>{prettyIssue(analysis.detected_issue)}</Text>
          <Text style={[styles.focusSub, { color: colors.text_muted, marginTop: 4 }]}>{analysis.observation}</Text>
        </View>
      ) : (
        <Text style={[styles.focusSub, { color: colors.text_muted, marginTop: 12 }]}>Record a swing to populate this tab.</Text>
      )}
    </View>
  );
}

// 2026-05-27 — Fix EL: ShotTracerCard removed. Was dead code anyway
// (defined here, never rendered). The Shot Tracer overlay toggle +
// SVG render branch were also removed elsewhere in this file.

function BottomBar({ colors, onTagClub, onCompare, clubLabel }: {
  colors: ReturnType<typeof useTheme>['colors'];
  onRecord?: () => void; // unused — record now lives in the video card
  onTagClub: () => void;
  onCompare: () => void;
  clubLabel?: string;
}) {
  // 2026-05-20 — Record removed from the bottom bar. Tim: "integrated
  // into the video screen element, not all the way down at the bottom."
  // Bottom strip now has Tag Club + Compare only (utility actions, not
  // the primary capture). Background tinted so it reads as a separate
  // utility row when sticky at the bottom.
  // 2026-05-24 — clubLabel: shows the tagged club ("7I") or "Untagged"
  // so the user can see which club assumption drives the metrics on
  // the card. Replaces the prior hardcoded "8i" placeholder.
  return (
    <View style={[styles.bottomBar, { backgroundColor: colors.surface_elevated, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 6 }]}>
      <TouchableOpacity onPress={onTagClub} style={[styles.bottomBtn, { borderColor: colors.border, borderWidth: 1 }]}>
        <Ionicons name="flag-outline" size={16} color={colors.text_primary} />
        <View>
          <Text style={[styles.bottomBtnText, { color: colors.text_primary }]}>Tag Club</Text>
          <Text style={[styles.bottomBtnSub, { color: colors.text_muted }]}>{clubLabel ?? 'Untagged'}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCompare} style={[styles.bottomBtn, { borderColor: colors.border, borderWidth: 1 }]}>
        <Ionicons name="stats-chart-outline" size={16} color={colors.text_primary} />
        <Text style={[styles.bottomBtnText, { color: colors.text_primary }]}>Compare</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Insight derivation ─────────────────────────────────────────────

function deriveInsight(a: SwingAnalysis | null, persona: string, validity: SwingValidity): DerivedInsight {
  if (!a) {
    return {
      diagnostic: `Record a swing and ${caddieDisplay(persona)} will read it for you.`,
      topFocus: 'Awaiting first swing',
      topFocusSub: 'Tap Record below to capture a swing.',
      drillKey: 'tempo',
      drillTitle: 'Tempo Trainer',
      drillSub: '3:1 backswing-to-downswing rhythm — works on every swing.',
      nextSwingFocus: 'Smooth setup',
      nextSwingArrow: 'Relaxed → Athletic',
    };
  }
  // Phase 418 — when validity gate rejects, return a placeholder
  // insight; the InsightCard will short-circuit and render the
  // "couldn't see your swing" state + framing tips, so these fields
  // are never actually shown. We still return a well-formed
  // DerivedInsight so the type contract holds.
  if (!validity.valid) {
    return {
      diagnostic: validity.reason ?? 'No analyzable swing detected in this clip.',
      topFocus: 'No swing detected',
      topFocusSub: 'Get your full body in frame and record again.',
      drillKey: 'tempo',
      drillTitle: 'Tempo Trainer',
      drillSub: '3:1 backswing-to-downswing rhythm — works on every swing.',
      nextSwingFocus: 'Reframe & retake',
      nextSwingArrow: 'Floor → Full body',
    };
  }
  const issue = a.detected_issue;
  const observation = a.observation;
  const map = ISSUE_INSIGHTS[issue];
  return {
    diagnostic: `${prefix(persona)} ${observation}`,
    topFocus: map.topFocus,
    topFocusSub: map.topFocusSub,
    drillKey: map.drillKey,
    drillTitle: map.drillTitle,
    drillSub: map.drillSub,
    nextSwingFocus: map.nextSwingFocus,
    nextSwingArrow: map.nextSwingArrow,
  };
}

function prefix(persona: string): string {
  switch (persona) {
    case 'serena': return 'Reading your swing now —';
    case 'tank':   return "Here's what I see:";
    case 'harry':  return 'Quick read:';
    default:       return 'Solid swing!';
  }
}

function caddieDisplay(p: string): string {
  return p === 'kevin' ? 'Kevin' : p === 'serena' ? 'Serena' : p === 'tank' ? 'Tank' : p === 'harry' ? 'Harry' : 'Kevin';
}

function prettyIssue(issue: string): string {
  return issue.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

interface IssueMap {
  topFocus: string;
  topFocusSub: string;
  drillKey: string;
  drillTitle: string;
  drillSub: string;
  nextSwingFocus: string;
  nextSwingArrow: string;
}

const ISSUE_INSIGHTS: Record<string, IssueMap> = {
  over_the_top: {
    topFocus: 'Shallow the Downswing',
    topFocusSub: 'Great rotation — just work on getting the club more in front earlier.',
    drillKey: 'pump-drill',
    drillTitle: 'Pump Drill',
    drillSub: 'Feel a shallower takeaway and deliver the club from the inside.',
    nextSwingFocus: 'Tempo & Transition',
    nextSwingArrow: 'Smooth → Explode',
  },
  early_extension: {
    topFocus: 'Maintain Posture',
    topFocusSub: 'Hips moving toward the ball — stay in your spine angle through impact.',
    drillKey: 'wall-drill',
    drillTitle: 'Wall Drill',
    drillSub: 'Practice with your backside against a wall — feel the rotation, not the thrust.',
    nextSwingFocus: 'Hip Rotation',
    nextSwingArrow: 'Thrust → Rotate',
  },
  reverse_pivot: {
    topFocus: 'Weight Behind the Ball',
    topFocusSub: 'Weight stayed on the lead side at the top — load into your trail leg.',
    drillKey: 'step-drill',
    drillTitle: 'Step Drill',
    drillSub: 'Step into the shot from the trail foot to feel proper weight load.',
    nextSwingFocus: 'Weight Load',
    nextSwingArrow: 'Front → Back to Front',
  },
  chicken_wing: {
    topFocus: 'Full Extension Through Impact',
    topFocusSub: 'Lead arm collapsing through impact — extend both arms past the ball.',
    drillKey: 'towel-drill',
    drillTitle: 'Towel Under Arm Drill',
    drillSub: 'Keeps the arms connected, encourages full extension.',
    nextSwingFocus: 'Extension',
    nextSwingArrow: 'Bent → Long arms',
  },
  swing_path_outside_in: {
    topFocus: 'Inside Path',
    topFocusSub: 'Club is approaching outside-in — start the downswing from the inside.',
    drillKey: 'gate-drill',
    drillTitle: 'Gate Drill',
    drillSub: 'Tees just outside the ball line force an inside-out path.',
    nextSwingFocus: 'Swing Path',
    nextSwingArrow: 'Outside → Inside',
  },
  swing_path_inside_out: {
    topFocus: 'Square the Path',
    topFocusSub: 'Path is too far inside-out — neutralize toward the target line.',
    drillKey: 'gate-drill',
    drillTitle: 'Gate Drill',
    drillSub: 'Inside tee gates encourage a neutral path on plane.',
    nextSwingFocus: 'Swing Path',
    nextSwingArrow: 'Inside-out → Square',
  },
  attack_angle_steep: {
    topFocus: 'Shallower Attack',
    topFocusSub: 'Coming down too steep — feel a more sweeping move.',
    drillKey: 'tee-drill',
    drillTitle: 'Low Tee Drill',
    drillSub: 'Sweep the ball off a low tee for shallow contact.',
    nextSwingFocus: 'Attack Angle',
    nextSwingArrow: 'Steep → Shallow',
  },
  attack_angle_shallow: {
    topFocus: 'Pinch the Ball',
    topFocusSub: 'Attack too shallow — feel the club come down with descent.',
    drillKey: 'divot-drill',
    drillTitle: 'Divot Drill',
    drillSub: 'Place a coin past the ball — divot starts AFTER the coin.',
    nextSwingFocus: 'Attack Angle',
    nextSwingArrow: 'Sweep → Pinch',
  },
  club_face_open: {
    topFocus: 'Square the Face',
    topFocusSub: 'Face open through impact — strengthen grip or rotate forearms sooner.',
    drillKey: 'glove-drill',
    drillTitle: 'Glove Logo Drill',
    drillSub: 'Watch the back of your lead glove face the target through impact.',
    nextSwingFocus: 'Face Control',
    nextSwingArrow: 'Open → Square',
  },
  club_face_closed: {
    topFocus: 'Open the Face Slightly',
    topFocusSub: 'Face shutting through impact — weaken grip or hold off the rotation.',
    drillKey: 'glove-drill',
    drillTitle: 'Glove Logo Drill',
    drillSub: 'Hold the lead glove logo pointing target-ward through impact.',
    nextSwingFocus: 'Face Control',
    nextSwingArrow: 'Closed → Square',
  },
  none: {
    topFocus: 'Solid Pattern',
    topFocusSub: 'No specific fault detected — keep grooving this move.',
    drillKey: 'tempo',
    drillTitle: 'Tempo Trainer',
    drillSub: 'Maintain rhythm — 3:1 backswing-to-downswing.',
    nextSwingFocus: 'Repeat',
    nextSwingArrow: 'Same → Same',
  },
};

// ─── Stub skeleton overlay component ────────────────────────────────
//
// Renders the bone graph + head circle + joint nodes against the
// already-computed videoRect (the displayed-video subrect inside the
// videoFrame, per Fix C). All sizes derive from videoRect dimensions
// so they hold up at any aspect ratio (Z Fold closed ~9:21, open
// ~8:9, standard phone ~9:16) without hardcoding pixels.

// 2026-05-22 — Path A — RealSkeletonOverlay renders the actual pose
// keypoints returned by /api/pose-analysis (RapidAPI MoveNet proxy)
// for one canonical swing position — P6_impact by default (most
// diagnostic moment). Falls back to P4_top → first available frame
// if impact wasn't captured. Bone topology mirrors StubSkeletonOverlay
// so the look + feel stays consistent; only the joint positions are
// real (driven by the user's actual body in the captured frame).
//
// Keypoint coords from the pose API may be normalized 0-1 OR pixel
// values relative to the source frame; we auto-detect by checking
// the max value and convert to 0-1 either way before mapping to
// videoRect pixels.
function RealSkeletonOverlay({
  videoRect,
  accent,
  frames,
}: {
  videoRect: { left: number; top: number; width: number; height: number };
  accent: string;
  frames: PoseFrame[];
}) {
  const { width: vW, height: vH } = videoRect;
  const bodyScale = Math.min(vW, vH);

  // Prefer impact (P6) → top (P4) → first frame as the canonical pose
  // to render. Impact is the most diagnostic moment per coaching norms.
  const frame =
    frames.find(f => f.position === 'P6_impact')
    ?? frames.find(f => f.position === 'P4_top')
    ?? frames[0];

  // Build a name→keypoint map for O(1) lookup. Filter out low-confidence
  // points (score < 0.2 is noise) so we don't draw bones into nowhere.
  const kpByName = new Map<string, Keypoint>();
  for (const kp of frame.keypoints) {
    if (kp.name && kp.score > 0.2) kpByName.set(kp.name, kp);
  }
  const lShoulder = kpByName.get('left_shoulder');
  const rShoulder = kpByName.get('right_shoulder');
  const nose = kpByName.get('nose');

  // Auto-detect coordinate space: any value > 1.5 = pixel coords;
  // otherwise normalized 0-1. Compute the normalizer factor used to
  // map every keypoint into 0-1 range before percentage-rendering
  // against videoRect.
  let normX = 1, normY = 1;
  if (lShoulder || rShoulder || nose) {
    const sample = lShoulder ?? rShoulder ?? nose!;
    if (sample.x > 1.5 || sample.y > 1.5) {
      // Pixel coords — find max across all keypoints to derive bounds.
      let maxX = 0, maxY = 0;
      for (const kp of frame.keypoints) {
        if (kp.x > maxX) maxX = kp.x;
        if (kp.y > maxY) maxY = kp.y;
      }
      normX = maxX > 0 ? maxX : 1;
      normY = maxY > 0 ? maxY : 1;
    }
  }

  // Helper: kp → SVG percentage string (0-100), or null if missing.
  const pct = (kp: Keypoint | undefined, axis: 'x' | 'y'): string | null => {
    if (!kp) return null;
    const norm = axis === 'x' ? kp.x / normX : kp.y / normY;
    return `${Math.max(0, Math.min(100, norm * 100))}%`;
  };

  // Bone edges — same topology as StubSkeletonOverlay for visual continuity.
  const BONE_EDGES: [string, string][] = [
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'],
    ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'],
    ['right_knee', 'right_ankle'],
  ];

  const jointRadius = Math.max(3, Math.min(7, bodyScale * 0.011));
  const boneStrokeWidth = Math.max(1.5, Math.min(3.5, bodyScale * 0.005));
  const headStrokeWidth = boneStrokeWidth * 1.1;

  // Head circle radius derived from shoulder width (same logic as stub).
  const headRadius = (() => {
    if (!lShoulder || !rShoulder) return Math.max(8, bodyScale * 0.05);
    const dx = (rShoulder.x - lShoulder.x) / normX;
    const dy = (rShoulder.y - lShoulder.y) / normY;
    const shoulderWidthPx = Math.hypot(dx * vW, dy * vH);
    return Math.max(8, Math.min(36, (shoulderWidthPx * 0.55) / 2));
  })();

  return (
    <Svg
      style={{
        position: 'absolute',
        left: videoRect.left,
        top: videoRect.top,
        width: vW,
        height: vH,
      }}
      pointerEvents="none"
    >
      {/* Vertical alignment reference line — preserved from the prior
          overlay for continuity. */}
      <Line
        x1="50%" y1="6%" x2="50%" y2="94%"
        stroke={accent} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.55}
      />

      {/* Bones — each edge drawn only when both endpoints exist + cleared
          the confidence floor. Missing pairs silently skip (typical when
          one wrist is occluded behind the body, etc.). */}
      {BONE_EDGES.map(([a, b], i) => {
        const ka = kpByName.get(a);
        const kb = kpByName.get(b);
        if (!ka || !kb) return null;
        const x1 = pct(ka, 'x'), y1 = pct(ka, 'y');
        const x2 = pct(kb, 'x'), y2 = pct(kb, 'y');
        if (!x1 || !y1 || !x2 || !y2) return null;
        return (
          <Line
            key={`real-bone-${i}`}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={accent}
            strokeWidth={boneStrokeWidth}
            strokeLinecap="round"
            opacity={0.88}
          />
        );
      })}

      {/* Head — circle centered on nose. */}
      {nose && (
        <Circle
          cx={pct(nose, 'x') ?? '50%'}
          cy={pct(nose, 'y') ?? '10%'}
          r={headRadius}
          stroke={accent}
          strokeWidth={headStrokeWidth}
          fill="transparent"
          opacity={0.95}
        />
      )}

      {/* Joint dots — render every detected joint above confidence floor. */}
      {Array.from(kpByName.entries()).filter(([n]) => n !== 'nose').map(([n, kp]) => {
        const cx = pct(kp, 'x'), cy = pct(kp, 'y');
        if (!cx || !cy) return null;
        return (
          <Circle
            key={`real-joint-${n}`}
            cx={cx} cy={cy} r={jointRadius}
            fill={accent}
            opacity={0.95}
          />
        );
      })}
    </Svg>
  );
}

function StubSkeletonOverlay({
  videoRect,
  accent,
}: {
  videoRect: { left: number; top: number; width: number; height: number };
  accent: string;
}) {
  const { width: vW, height: vH } = videoRect;
  const bodyScale = Math.min(vW, vH);

  // Shoulder-width derived radius for the head circle. Clamped so it
  // doesn't get microscopic on a small preview or absurd on full-screen.
  const lShoulder = STUB_SKELETON_JOINTS[1];
  const rShoulder = STUB_SKELETON_JOINTS[2];
  const shoulderWidthPx = (Math.abs(rShoulder.x - lShoulder.x) / 100) * vW;
  const headRadius = Math.max(8, Math.min(36, (shoulderWidthPx * 0.55) / 2));
  const jointRadius = Math.max(3, Math.min(7, bodyScale * 0.011));
  const boneStrokeWidth = Math.max(1.5, Math.min(3.5, bodyScale * 0.005));
  const headStrokeWidth = boneStrokeWidth * 1.1;

  // Neck line ends at the BOTTOM of the head circle so the head reads
  // as a head on a neck instead of disappearing into the line. We
  // express the circle radius as a percentage of vH to keep
  // SVG-percentage math consistent.
  const head = STUB_SKELETON_JOINTS[0];
  const shoulderMidX = (lShoulder.x + rShoulder.x) / 2;
  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
  const headRadiusYPct = (headRadius / vH) * 100;
  const neckEndY = head.y + headRadiusYPct;

  return (
    <Svg
      style={{
        position: 'absolute',
        left: videoRect.left,
        top: videoRect.top,
        width: vW,
        height: vH,
      }}
      pointerEvents="none"
    >
      {/* Vertical alignment reference line — preserved from the
          prior overlay, intentionally unchanged. */}
      <Line
        x1="50%" y1="6%" x2="50%" y2="94%"
        stroke={accent} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.55}
      />

      {/* Bones — each edge is its own line. No shared apex, no closed
          polygon. Two legs are two distinct chains. */}
      {STUB_SKELETON_BONES.map(([a, b], i) => (
        <Line
          key={`bone-${i}`}
          x1={`${STUB_SKELETON_JOINTS[a].x}%`}
          y1={`${STUB_SKELETON_JOINTS[a].y}%`}
          x2={`${STUB_SKELETON_JOINTS[b].x}%`}
          y2={`${STUB_SKELETON_JOINTS[b].y}%`}
          stroke={accent}
          strokeWidth={boneStrokeWidth}
          strokeLinecap="round"
          opacity={0.88}
        />
      ))}

      {/* Neck — shoulder midpoint to bottom of head circle. */}
      <Line
        x1={`${shoulderMidX}%`}
        y1={`${shoulderMidY}%`}
        x2={`${head.x}%`}
        y2={`${neckEndY}%`}
        stroke={accent}
        strokeWidth={boneStrokeWidth}
        strokeLinecap="round"
        opacity={0.88}
      />

      {/* Head — outlined circle node, radius derived from shoulder
          width. Stroked (not filled) so it reads as a head, not a blob. */}
      <Circle
        cx={`${head.x}%`}
        cy={`${head.y}%`}
        r={headRadius}
        stroke={accent}
        strokeWidth={headStrokeWidth}
        fill="transparent"
        opacity={0.95}
      />

      {/* Joint dots — every joint except head. Wrists explicitly
          included as the club-hinge diagnostic point. */}
      {STUB_SKELETON_NODE_INDICES.map((i) => (
        <Circle
          key={`joint-${i}`}
          cx={`${STUB_SKELETON_JOINTS[i].x}%`}
          cy={`${STUB_SKELETON_JOINTS[i].y}%`}
          r={jointRadius}
          fill={accent}
          opacity={0.95}
        />
      ))}
    </Svg>
  );
}

// ─── Stub skeleton ───────────────────────────────────────────────────
//
// 2026-05-21 — Topology rewrite. The prior 8-joint stub had two
// converging-apex bugs that read as a kite, not a skeleton:
//   1. Both hips connected to a SINGLE "ankles" joint → legs drew as a
//      triangle/kite down to one point at the ball.
//   2. Head connected directly to both shoulders → triangle apex on
//      top instead of a head node on a neck.
//   Plus missing wrists (no club-hinge diagnostic point) and missing
//   knees.
//
// Now: 13 joints matching the MoveNet-17 subset we'll receive when the
// TFJS / MoveNet integration lands (nose + L/R for shoulder, elbow,
// wrist, hip, knee, ankle). Explicit bone-edge list — each bone is
// its own line, no shared apex. Two legs are two distinct chains.
// Head is rendered as a separate scaled CIRCLE node connected to the
// shoulder midpoint by a neck line. Joint dots and head radius scale
// from body dimensions (videoRect), not hardcoded px.
//
// Joint coords are positioned for a face-on golfer in setup (feet
// shoulder-width, hands meeting near center mid-body). Down-the-line
// will look slightly stylized until real keypoints land, but the
// topology is now a real human skeleton, not a polygon.

const STUB_SKELETON_JOINTS: { x: number; y: number; label: string }[] = [
  { x: 50, y: 10, label: 'nose' },           // 0
  { x: 40, y: 24, label: 'left_shoulder' },  // 1
  { x: 60, y: 24, label: 'right_shoulder' }, // 2
  { x: 32, y: 37, label: 'left_elbow' },     // 3
  { x: 68, y: 37, label: 'right_elbow' },    // 4
  { x: 42, y: 52, label: 'left_wrist' },     // 5
  { x: 58, y: 52, label: 'right_wrist' },    // 6
  { x: 44, y: 53, label: 'left_hip' },       // 7
  { x: 56, y: 53, label: 'right_hip' },      // 8
  { x: 42, y: 70, label: 'left_knee' },      // 9
  { x: 58, y: 70, label: 'right_knee' },     // 10
  { x: 38, y: 88, label: 'left_ankle' },     // 11
  { x: 62, y: 88, label: 'right_ankle' },    // 12
];

const STUB_SKELETON_BONES: [number, number][] = [
  // Torso: shoulder line, hip line, two side seams.
  [1, 2], [7, 8], [1, 7], [2, 8],
  // Left arm: shoulder → elbow → wrist.
  [1, 3], [3, 5],
  // Right arm: shoulder → elbow → wrist.
  [2, 4], [4, 6],
  // Left leg: hip → knee → ankle.
  [7, 9], [9, 11],
  // Right leg: hip → knee → ankle.
  [8, 10], [10, 12],
];

// Joint dot render set. Head (0) is drawn as a separate scaled circle
// node so it doesn't fight with the bone graph. Every other joint
// renders as a filled dot — wrists explicitly included since the
// wrist is the club-hinge diagnostic point.
const STUB_SKELETON_NODE_INDICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ─── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 12, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  title: { fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  subtitle: { fontSize: 12, marginTop: 2 },
  modeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  modeChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  tabPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  tabPillText: { fontSize: 12, fontWeight: '700' },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  anglePillRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 },
  anglePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1 },
  anglePillText: { fontSize: 12, fontWeight: '700' },
  ellipsisBtn: { marginLeft: 'auto', padding: 4 },
  videoFrame: { width: '100%', aspectRatio: 4/5, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', position: 'relative' },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16 },
  placeholderText: { fontSize: 14, fontWeight: '700' },
  placeholderHint: { fontSize: 12 },
  controlRail: { position: 'absolute', right: 8, top: '50%', transform: [{ translateY: -100 }], borderRadius: 12, borderWidth: 1, padding: 6, gap: 6 },
  railBtn: { alignItems: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1 },
  railLabel: { fontSize: 9, fontWeight: '700' },
  scrubberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  scrubberTime: { fontSize: 11, fontFamily: 'monospace' },
  scrubberTrack: { flex: 1, height: 2, borderRadius: 1 },
  scrubberFill: { height: '100%', width: '40%', borderRadius: 1 },
  metricsStrip: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  metricCell: { alignItems: 'center', flex: 1 },
  metricLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  metricValue: { fontSize: 22, fontWeight: '900' },
  metricUnit: { fontSize: 10, marginTop: 2 },
  // 2026-05-24 (Metrics 1A) — Honest-presentation rows beneath the
  // value: an estimated range when present, and a short methodology
  // note ("pose heuristic", "club speed × typical smash"). No fixed
  // heights — let text wrap.
  metricRange: { fontSize: 10, marginTop: 2, fontVariant: ['tabular-nums'] },
  metricNote: { fontSize: 9, marginTop: 3, fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 4 },
  metricsFooter: { fontSize: 11, marginTop: 8, textAlign: 'center', fontStyle: 'italic', lineHeight: 16 },
  noSwingBadge: {
    position: 'absolute', top: 10, left: 10, right: 80,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: 'rgba(239,68,68,0.85)', borderRadius: 10,
  },
  noSwingBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 },
  framingTipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 2 },
  framingTipText: { flex: 1, fontSize: 12, lineHeight: 17 },
  retakeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 12, paddingVertical: 14, borderRadius: 12,
  },
  retakeBtnText: { fontSize: 14, fontWeight: '900', letterSpacing: 0.3 },
  insightHeader: { fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
  insightRow: { flexDirection: 'row', gap: 12, marginTop: 10, alignItems: 'flex-start' },
  caddiePortrait: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  bubble: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1 },
  bubbleText: { fontSize: 13, lineHeight: 19 },
  caddieNameLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 6, marginLeft: 2 },
  sectionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.6, marginBottom: 6 },
  focusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  focusIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  focusTitle: { fontSize: 14, fontWeight: '800' },
  focusSub: { fontSize: 12, marginTop: 2 },
  drillCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  drillIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  drillThumb: { width: 56, height: 40, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fullDataBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  fullDataLabel: { fontSize: 13, fontWeight: '700' },
  confidenceFooter: { fontSize: 10, marginTop: 8, textAlign: 'center', fontStyle: 'italic' },
  bottomBar: { flexDirection: 'row', gap: 8, marginTop: 12 },
  bottomBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
  bottomBtnText: { fontSize: 13, fontWeight: '800' },
  bottomBtnSub: { fontSize: 10, fontWeight: '600' },
  // 2026-05-20 — Single-view + overlay toggles + sticky bar + no-clip hero
  overlayRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 12, paddingBottom: 8,
  },
  overlayToggle: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 8, borderRadius: 18, borderWidth: 1,
  },
  overlayToggleText: { fontSize: 12, fontWeight: '700' },
  speedPill: {
    position: 'absolute', top: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12,
  },
  speedPillText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  stickyBar: {
    position: 'absolute', left: 12, right: 12, bottom: 12,
  },
  noClipHero: {
    flex: 1, padding: 16, justifyContent: 'center',
  },
  noClipCard: {
    borderRadius: 16, borderWidth: 1, padding: 24,
    alignItems: 'center', gap: 12,
  },
  noClipIcon: {
    width: 88, height: 88, borderRadius: 44, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  noClipTitle: { fontSize: 22, fontWeight: '900', letterSpacing: 0.2 },
  noClipSub: { fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 8 },
  noClipPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 14, marginTop: 8, minWidth: 220,
  },
  noClipPrimaryText: { fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },
  noClipSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8,
  },
  noClipSecondaryText: { fontSize: 13, fontWeight: '700' },
  // 2026-05-21 — Fix B: pre-record angle picker.
  preRecordLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.6, marginTop: 6 },
  preRecordAngleRow: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 4 },
  preRecordAnglePill: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 2,
  },
  preRecordAnglePillLabel: { fontSize: 13, fontWeight: '900', marginTop: 2 },
  preRecordAnglePillSub: { fontSize: 10, fontWeight: '600', letterSpacing: 0.4 },
  // 2026-05-20 — Record button INSIDE the video card (per Tim's
  // "integrate into the video screen element" call). Big circular
  // button just below the playback frame, primary capture action.
  frameRecordWrap: {
    alignItems: 'center', gap: 8, marginTop: 12,
  },
  frameRecordOuter: {
    width: 64, height: 64, borderRadius: 32, borderWidth: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  frameRecordInner: {
    width: 48, height: 48, borderRadius: 24,
  },
  frameRecordHint: {
    fontSize: 11, fontWeight: '600',
  },
});
