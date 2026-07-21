import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { QuickTutorial } from '../../components/QuickTutorial';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  Animated,
  Easing,
  AppState,
  AppStateStatus,
  ScrollView,
  useWindowDimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { pushCourseGuarded } from '../../utils/courseNav';
import { prewarmVoice } from '../../services/voiceWarmup';
import { clearScreenContext, getScreenContext } from '../../services/screenContext';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';
import CaddieAvatar, { VoiceState } from '../../components/CaddieAvatar';
import { ActiveListeningPill } from '../../components/caddie/ActiveListeningPill';
import { PermissionBanner } from '../../components/PermissionBanner';
import { useRoundStore } from '../../store/roundStore';
import type { ShotLocation, ShotResult } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
// Phase Cockpit — alternate Caddie tab layout (v3-style). Gated by
// useSettingsStore.cockpitMode; off by default. Voice/avatar code
// below is byte-identical to pre-Cockpit when the toggle is off.
import CockpitCaddieScreen from '../../components/caddie/CockpitCaddieScreen';
import { type FrontMiddleBack } from '../../components/caddie/cockpit/DistanceCard';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useCustomCaddieMediaStore } from '../../store/customCaddieMediaStore';
import { useFamilyStore } from '../../store/familyStore';
import { useShallow } from 'zustand/react/shallow';
import { getCaddieName, ACTIVE_PERSONAS, type Persona } from '../../lib/persona';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useCageStore } from '../../store/cageStore';
import { usePointsStore } from '../../store/pointsStore';
import { getCourseList, getCourse, getCourseHoleCount, getBundledHoles } from '../../data/courses';
import { useCustomCourseStore } from '../../store/customCourseStore';
import { useCaddieMemoryStore } from '../../store/caddieMemoryStore';
import CoursePicker, { type PickedCourse } from '../../components/CoursePicker';
import StartRoundCourseCard from '../../components/course/StartRoundCourseCard';
import { openTeeTimeSearch } from '../../services/teeTimeLink';
import { openYouTubeChannel } from '../../services/youtubeLinks';
import { isSmartMotionActive, isSmartMotionRecording, emitSmartMotionCommand, emitDrillConfig, subscribeSmartMotionVoiceEvent, subscribeSmartMotionUtterance } from '../../services/smartMotionRecordBus';
import { type RoundMode, ROUND_MODE_LABELS, ROUND_MODE_CARDS } from '../../types/patterns';
import { getCourse as getApiCourse, courseToHoles, searchCourses } from '../../services/golfCourseApi';
import { generateRecap } from '../../services/recapGenerator';
import { buildFullPracticeContext } from '../../services/tutorialContext';
import { generatePatternInsights } from '../../services/patternDetection';
import { useGhostStore } from '../../store/ghostStore';
import { useVoiceCaddie } from '../../hooks/useVoiceCaddie';
import { usePipecatVoice } from '../../hooks/usePipecatVoice';
import { useKevin, type ToolAction } from '../../hooks/useKevin';
import { useKevinPresence } from '../../contexts/KevinPresenceContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useVoiceActivityDetection } from '../../hooks/useVoiceActivityDetection';
import { speak, speakChunked, configureAudioForSpeech, captureUtterance, playLocalFile, subscribeToSpeaking, isSpeaking, primeMicPipeline, speakDeviceNotice } from '../../services/voiceService';
import { answerOffline } from '../../services/offlineCaddie';
// 2026-05-25 — Bestround celebration: when the round-end summary
// detects a new personal best, play Kevin's D-ID bestround clip
// instead of TTS-ing the text summary. Asset is resolved at fire
// time via getCaddieClip; falls back to TTS if the asset fails.
import { getCaddieClip } from '../../services/getCaddieClip';
import { Asset } from 'expo-asset';
import { getOpenerAssetForPersona } from '../../services/kevinGreetingManifest';
import { awaitGreetingComplete } from '../greeting';
// Phase Y — shotDetectionService lifecycle moved to app/_layout.tsx so it
// survives tab focus changes. Only the orchestrator's runtime configure()
// stays here (apiUrl/voice/language can change at any time).
import { conversationalLoggingOrchestrator } from '../../services/conversationalLoggingOrchestrator';
import { setActiveSurface, clearActiveSurface } from '../../services/activeSurfaceRegistry';
import { evaluateRoundProgress } from '../../services/teamIntelligence';
import QuickLogShotSheet from '../../components/QuickLogShotSheet';
import { fetchCourseGeometry } from '../../services/courseGeometryService';
import WindArrow from '../../components/caddie/WindArrow';
import { useCurrentWeather } from '../../hooks/useCurrentWeather';
import { playsLikeDistance } from '../../utils/playsLike';
import { useElevationDeltaStatus } from '../../hooks/useElevationDelta';
import { useTrustLevelStore, TRUST_LEVEL_META, TRUST_LEVEL_SLIDER_ORDER } from '../../store/trustLevelStore';
import { useToastStore } from '../../store/toastStore';
import { useToolsMenuStore } from '../../store/toolsMenuStore';
import L1HolePreview from '../../components/caddie/L1HolePreview';
import { getFirstToolHint } from '../../services/voiceOnboardingService';
// Phase AT — KevinHelpButton import removed; ? button no longer rendered
// on caddie home (Tutorials in Tool menu is the discoverability path).
import ScorecardChip from '../../components/caddie/ScorecardChip';
import AppIcon, { type IconName } from '../../components/AppIcon';
// ImagePicker import removed when Capture Photo was pulled from the
// Tools menu (Tim flagged it as not belonging there). Re-add when the
// dedicated round-active camera button surfaces it elsewhere.
import VocabBanner from '../../components/VocabBanner';
import CaddieDataStrip from '../../components/CaddieDataStrip';
import { canAccess, trialDaysLeft, SUBSCRIPTIONS_ENABLED } from '../../services/featureAccess';
import { triggerPaywall } from '../../services/paywallGuard';
import { subscribeBattery } from '../../services/batteryMonitor';
import { noteAudioActivity } from '../../services/audioLifecycle';
import {
  shouldFireProactive,
  markProactiveFired,
  resetProactiveState,
} from '../../services/proactiveKevin';
import { useMovementModeStore } from '../../services/movementModeDetector';
import { resolvePenalty } from '../../services/rulesEngine';
import { OUTCOME_LABELS, OUTCOME_EMOJI } from '../../types/shot';
import type { ShotOutcome } from '../../types/shot';
import type { RulesDecision } from '../../types/penalty';
import { getApiBaseUrl } from '../../services/apiBase';
import { buildRoundEndSummary } from '../../services/roundEndSummary';

const NULL_HUD = { hole: null, par: null, yards: null, wind: null, playsLike: null };

// 2026-06-06 — Module-level once-per-process flag for the post-splash
// opener. Set true AFTER playLocalFile resolves successfully (Lesson
// from prior 6 failed attempts: setting it BEFORE play meant silent
// failures stuck the opener as "spoken" with no recovery).
// Module-level (not useRef) so it survives tab cycles within the
// same app process — opener fires exactly once per cold launch.
let openerPlayedThisProcess = false;

export default function CaddieTab() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pre_course_id, _t: preCourseNonce } = useLocalSearchParams<{ pre_course_id?: string; _t?: string }>();
  const trustLevel = useTrustLevelStore(s => s.level);
  const setTrustLevel = useTrustLevelStore(s => s.setLevel);
  // Phase AP — themed container background so theme + high-contrast toggles
  // produce immediate, visible change on the home tab. Brand accent and
  // L2/L3 avatar treatments stay literal (intentional brand consistency).
  const theme = useTheme();
  // 2026-05-26 — Fix CN: theme the bottom StyleSheet so the Caddie
  // tab respects light mode like every other tab. makeStyles is at
  // the bottom of the file; the FAB sub-components (ToolFabIcon,
  // ToolFabIconCycler) use inline styles so they're unaffected.
  const styles = useMemo(() => makeStyles(theme.colors), [theme.colors]);

  const { width: W, height: H } = useWindowDimensions();
  // Natural 9:16 frame height — shows Kevin's full portrait without over-zoom
  // Phase AU.1 — natural 9:16 frame for Kevin (canonical).
  // Phase AU.2 — capped on wide aspects so Kevin doesn't extend below
  // the visible viewport on Fold open (Tim: "L4 Kevin way too low and
  // big"). The cap preserves canonical aspect (cover-mode + 9:16
  // proportion) up to the maximum height the viewport can show above
  // the dropdown row + DataStrip + insets. On phones the natural
  // W·16/9 fits within viewport so the cap doesn't trigger and the
  // canonical look is preserved.
  // Phase BJ — pre-round Start Round CTA budget. Standard phones reserve
  // 200px below the avatar; Fold Z open (W >= 540) reserves 280px because
  // the wider avatar pushes its bottom gradient further down the visible
  // viewport and a 200px reservation was clipping the CTA top edge.
  // In-round both aspects share the 160px DataStrip + dropdown budget.
  const _isRoundActiveForLayout = useRoundStore(s => s.isRoundActive);
  const _preRoundBudget = W >= 540 ? 280 : 200;
  const _avatarMaxH = H - insets.top - insets.bottom - 56 - (_isRoundActiveForLayout ? 160 : _preRoundBudget);
  const _avatarFrameHeight = Math.min(Math.round(W * 16 / 9), _avatarMaxH);

  const apiUrl = getApiBaseUrl();
  const familyMembers = useFamilyStore(s => s.members);
  const activeFamilyMemberId = useFamilyStore(s => s.active_member_id);
  const _activeFamilyMember = useMemo(
    () => familyMembers.find(m => m.id === activeFamilyMemberId && !m.archived) ?? null,
    [familyMembers, activeFamilyMemberId],
  );
  const _activeFamilyCount = useMemo(
    () => familyMembers.filter(m => !m.archived).length,
    [familyMembers],
  );
  // 2026-06-04 — Coach Mode toggle. Hides the "Coach X" pill below
  // when off. Toggle lives in the L4 green-arrow expandable row.
  const _coachModeEnabled = useSettingsStore(s => s.coachModeEnabled);
  const _setCoachModeEnabled = useSettingsStore(s => s.setCoachModeEnabled);

  // ── Stores ──────────────────────────────
  // Audit 101 / W1 — useShallow subscribes only to the listed fields with
  // shallow equality. Prior code used `useRoundStore()` which subscribed
  // to the whole store; ANY field write (per-shot logScore, per-tick
  // currentYardage updates, etc.) re-rendered the entire caddie.tsx
  // tree even when only one unrelated field had changed.
  const {
    isRoundActive,
    currentHole,
    currentYardage,
    club,
    activeCourse: _activeCourse,
    courseHoles,
    scores: _scores,
    nineHoleMode,
    startRound,
    endRound,
    logScore,
    logPutts,
    addPenalty,
    getCurrentPar,
    getTotalScore,
    getHolesPlayed,
    getScoreVsPar,
    mode,
    setCurrentRoundMode,
    active_ghost,
    setActiveGhost,
    clearActiveGhost,
    roundHistory,
    shots,
    logShot,
    logEmotionalState,
    computeHoleScore,
  } = useRoundStore(useShallow((s) => ({
    isRoundActive: s.isRoundActive,
    currentHole: s.currentHole,
    currentYardage: s.currentYardage,
    club: s.club,
    activeCourse: s.activeCourse,
    courseHoles: s.courseHoles,
    scores: s.scores,
    nineHoleMode: s.nineHoleMode,
    startRound: s.startRound,
    endRound: s.endRound,
    logScore: s.logScore,
    logPutts: s.logPutts,
    addPenalty: s.addPenalty,
    getCurrentPar: s.getCurrentPar,
    getTotalScore: s.getTotalScore,
    getHolesPlayed: s.getHolesPlayed,
    getScoreVsPar: s.getScoreVsPar,
    mode: s.mode,
    setCurrentRoundMode: s.setCurrentRoundMode,
    active_ghost: s.active_ghost,
    setActiveGhost: s.setActiveGhost,
    clearActiveGhost: s.clearActiveGhost,
    roundHistory: s.roundHistory,
    shots: s.shots,
    logShot: s.logShot,
    logEmotionalState: s.logEmotionalState,
    computeHoleScore: s.computeHoleScore,
  })));

  // Pre-beta — Start Round handoff from the Play tab is a DIRECT launch.
  // The Play tab sets roundStore.pendingStartCourseId when the user taps
  // Start Round on the course card; Caddie consumes the signal here,
  // resolves the course, and immediately calls runStartRound() with
  // sensible defaults (free play, full 18, no ghost). The legacy
  // round-setup modal is no longer part of the Play→Caddie path; it
  // only opens when the user explicitly invokes setShowRoundSetup(true)
  // from inside Caddie. Kills the "Start Round loop" where the modal
  // re-appeared after the Play tab handed off control.
  //
  // runStartRoundRef is filled by an effect below (after the function is
  // declared) so we can reference the latest closure here without a TDZ
  // error from forward-referencing the const.
  const runStartRoundRef = useRef<((picked: PickedCourse, opts: {
    nineHole: boolean;
    isCompetition: boolean;
    notes: string;
    mode: RoundMode;
    ghostRoundId: string | null;
    mentalState?: string;
  }) => Promise<void>) | null>(null);
  const pendingStartCourseId = useRoundStore(s => s.pendingStartCourseId);
  const clearPendingStart = useRoundStore(s => s.setPendingStartCourse);
  useEffect(() => {
    if (!pendingStartCourseId) return;
    const id = pendingStartCourseId;
    clearPendingStart(null);
    void (async () => {
      let picked: PickedCourse | null = null;
      if (id.startsWith('local:')) {
        const slug = id.slice('local:'.length);
        const local = getCourse(slug);
        picked = {
          id, // keep the local: prefix so runStartRound takes the local branch
          name: local?.name ?? slug,
          fullName: local?.name ?? slug,
          isLocal: true,
        };
      } else if (id.startsWith('custom:')) {
        // 2026-07-01 (Tim) — a course added from a scorecard photo (customCourseStore). isLocal
        // so runStartRound takes the local branch, where getBundledHoles resolves the custom holes.
        const cc = useCustomCourseStore.getState().getCustomCourse(id);
        picked = { id, name: cc?.name ?? 'My Course', fullName: cc?.name ?? 'My Course', isLocal: true };
      } else {
        try {
          const apiCourse = await getApiCourse(id);
          if (apiCourse) {
            picked = {
              id: apiCourse.id,
              name: apiCourse.club_name,
              fullName: `${apiCourse.club_name} — ${apiCourse.location.city}, ${apiCourse.location.state}`,
              isLocal: false,
            };
          }
        } catch (e) {
          console.log('[caddie] pendingStart getCourse failed:', e);
        }
      }
      if (!picked) {
        // Resolution failed — fall back to opening the setup card so the
        // user can pick again rather than silently dropping the request.
        setShowRoundSetup(true);
        return;
      }
      setSelectedPickedCourse(picked);
      // Pre-beta — consume + clear factors UP FRONT so a downstream
      // paywall block / runStartRound throw doesn't leave stale factors
      // hanging around for the next session pick.
      const factors = useRoundStore.getState().pendingStartFactors;
      useRoundStore.getState().setPendingStartFactors(null);
      const fn = runStartRoundRef.current;
      if (fn) {
        await fn(picked, {
          nineHole: factors?.nineHole ?? false,
          isCompetition: factors?.isCompetition ?? false,
          notes: factors?.notes ?? '',
          mode: factors?.mode ?? 'free_play',
          ghostRoundId: null,
          mentalState: factors?.mentalState,
        });
      }
    })();
  }, [pendingStartCourseId, clearPendingStart]);

  // Legacy pre_course_id param path — kept for older callers (Course
  // Detail's "Start Round Here" historic deep link). Same direct-launch
  // semantics as pendingStartCourseId: skip the modal.
  useEffect(() => {
    if (!pre_course_id) return;
    void (async () => {
      let picked: PickedCourse | null = null;
      if (pre_course_id.startsWith('local:')) {
        const slug = pre_course_id.slice('local:'.length);
        const local = getCourse(slug);
        picked = {
          id: pre_course_id,
          name: local?.name ?? slug,
          fullName: local?.name ?? slug,
          isLocal: true,
        };
      } else {
        try {
          const apiCourse = await getApiCourse(pre_course_id);
          if (apiCourse) {
            picked = {
              id: apiCourse.id,
              name: apiCourse.club_name,
              fullName: `${apiCourse.club_name} — ${apiCourse.location.city}, ${apiCourse.location.state}`,
              isLocal: false,
            };
          }
        } catch (e) {
          console.log('[caddie] pre_course_id getCourse failed:', e);
        }
      }
      if (!picked) {
        setShowRoundSetup(true);
        return;
      }
      setSelectedPickedCourse(picked);
      const fn = runStartRoundRef.current;
      if (fn) {
        await fn(picked, {
          nineHole: false,
          isCompetition: false,
          notes: '',
          mode: 'free_play',
          ghostRoundId: null,
        });
      }
    })();
    // Nonce ensures every navigation with the same course id re-fires.
     
  }, [pre_course_id, preCourseNonce]);

  // Phase C plays-like wiring — non-layout. Computes the value flowing into the
  // CaddieDataStrip playsLike prop. Falls back to actual yardage when weather is
  // unavailable so the user never sees a placeholder, just the unadjusted number.
  const { weather: caddieWeather, shotBearingDeg: caddieShotBearing } = useCurrentWeather();
  // Phase AY — yardageMode setting drives whether the data strip shows
  // GPS-driven (live) or static (preround/scorecard) yardage. Live mode
  // queries getGreenYardagesSync against the most recent GPS fix; if no
  // fix yet, falls back to static so the strip never renders "—".
  const yardageMode = useSettingsStore(s => s.yardageMode);
  const setYardageMode = useSettingsStore(s => s.setYardageMode);
  // 2026-06-04 — Cockpit is now Trust Level 1 (Quiet). The 2026-06-04
  // collapse merged the prior L5 Cockpit + Harry binding into L1 and
  // removed L4 / L5. The early-return below uses trustLevel === 1.
  const cockpitMode = trustLevel === 1;
  // markTick increments on every position-mark event AND every 4s tick
  // during an active round so liveYardage recomputes both on push (Mark
  // fires) and pull (organic GPS movement during walking). Phase BG —
  // before the 4s poll, the data-strip middle yardage was stale until
  // the user explicitly tapped Mark or changed hole.
  const [markTick, setMarkTick] = useState(0);
  useEffect(() => {
    let active = true;
    let unsub: (() => void) | null = null;
    void (async () => {
      try {
        const bus = await import('../../services/positionMarkBus');
        if (!active) return;
        unsub = bus.subscribeToMark(() => setMarkTick(t => t + 1));
      } catch (e) { console.log('[caddie] mark bus subscribe failed:', e); }
    })();
    return () => { active = false; if (unsub) unsub(); };
  }, []);
  // Phase BG — 4s poll while round active so data-strip yardage refreshes
  // as the player walks. Cadence matches SmartFinderCard's existing poll.
  useEffect(() => {
    if (!isRoundActive) return;
    const id = setInterval(() => setMarkTick(t => t + 1), 4000);
    return () => clearInterval(id);
  }, [isRoundActive]);

  // 2026-05-25 — Fix G + Fix AC: keep screen awake during active round.
  // Z Fold sleeps quickly (default ~30s) which kills GPS subscription
  // continuity and creates the "GPS warming up" gap Tim hit at Palms.
  // Battery-aware policy (Fix AC per Marc/Rohit feedback): activate
  // only when round is active AND we believe the user has power (cart
  // mode active, OR battery charging). Otherwise the user can opt in
  // via Settings — but we DON'T silently drain a non-charging phone.
  // expo-keep-awake auto-releases on unmount; tag = caddie tab.
  useEffect(() => {
    if (!isRoundActive) return;
    let cancelled = false;
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const KeepAwake = require('expo-keep-awake') as typeof import('expo-keep-awake');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Battery = require('expo-battery') as typeof import('expo-battery');
        const state = await Battery.getBatteryStateAsync().catch(() => null);
        if (cancelled) return;
        // BatteryState 2 = CHARGING, 3 = FULL. Treat both as "powered."
        // When unknown / discharging, don't hijack the screen.
        const charging = state === 2 || state === 3;
        if (charging) {
          await KeepAwake.activateKeepAwakeAsync('caddie-active-round').catch(() => {});
        }
      } catch (e) {
        console.log('[caddie] keep-awake gate failed (non-fatal):', e);
      }
    })();
    return () => {
      cancelled = true;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const KeepAwake = require('expo-keep-awake') as typeof import('expo-keep-awake');
        KeepAwake.deactivateKeepAwake('caddie-active-round');
      } catch { /* non-fatal */ }
    };
  }, [isRoundActive]);

  // 2026-05-22 — Auto-reconcile on GPS accuracy improvement.
  // When the player goes from a weak fix (>30m, the threshold the
  // reconciliation service refuses to act on) to a strong fix (<15m,
  // tight enough we're confident the position is real), automatically
  // run a non-force reconcile. The 55y non-force margin keeps this
  // conservative — it only acts on a CLEAR hole correction, not a
  // borderline parallel-hole guess. Quiet on no-op (just devLog);
  // toasts only on apparent action so we don't spam the user mid-round.
  useEffect(() => {
    if (!isRoundActive) return;
    let prevAccuracy: number | null = null;
    let unsub: (() => void) | null = null;
    void (async () => {
      const gps = await import('../../services/gpsManager');
      unsub = gps.subscribe((fix) => {
        const cur = fix.accuracy_m;
        if (cur == null) { prevAccuracy = null; return; }
        if (prevAccuracy != null && prevAccuracy > 30 && cur < 15) {
          console.log(`[reconcile] accuracy improved ${Math.round(prevAccuracy)}m → ${Math.round(cur)}m, auto-reconciling`);
          const result = useRoundStore.getState().reconcileHole();
          if (result.applied) {
            void (async () => {
              const toastMod = await import('../../store/toastStore');
              toastMod.useToastStore.getState().show(
                `Snapped to hole ${result.hole_number} · ${result.confidence}% confidence`,
              );
            })();
          }
        }
        prevAccuracy = cur;
      });
    })();
    return () => { if (unsub) unsub(); };
  }, [isRoundActive]);
  // Phase 107 / B1 — also bump markTick on every smartFinderService fix
  // change (live GPS push). The 4s poll above stays as a safety net but
  // this gives sub-second yardage refresh when gps is in active mode.
  useEffect(() => {
    let active = true;
    let unsub: (() => void) | null = null;
    void (async () => {
      try {
        const sf = await import('../../services/smartFinderService');
        if (!active) return;
        unsub = sf.subscribeFixChange(() => setMarkTick(t => t + 1));
      } catch (e) { console.log('[caddie] smartFinder subscribe failed:', e); }
    })();
    return () => { active = false; if (unsub) unsub(); };
  }, []);

  // 2026-05-20 — Day 1 / Fix 7 (Option A): hole-transition GPS refresh
  // seam. On `currentHole` change, immediately pulse gpsManager for a
  // fresh fix and bump markTick so the fmb memo recomputes against the
  // NEW hole's green with the freshest possible position. Closes the
  // gap between the hole-detection transition firing and the next GPS
  // poll — the source of the 2-5y upward yardage drift Tim hit on
  // holes 13/16/17 of the synthetic round. On the sim path,
  // getOneShotFix short-circuits to the cached fix (per Day 1 / Fix 4)
  // and the markTick bump is what nudges the memo to recompute; on
  // real GPS a stale (>10s) cache pulses a fresh device read.
  useEffect(() => {
    if (!isRoundActive) return;
    let cancelled = false;
    void (async () => {
      try {
        const gps = await import('../../services/gpsManager');
        await gps.getOneShotFix();
        if (cancelled) return;
        setMarkTick(t => t + 1);
      } catch (e) { console.log('[caddie] hole-transition GPS refresh failed:', e); }
    })();
    return () => { cancelled = true; };
  }, [currentHole, isRoundActive]);
  const liveYardage = useMemo(() => {
    if (yardageMode !== 'live' || !isRoundActive) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getGreenYardagesSync } = require('../../services/smartFinderService');
      const y = getGreenYardagesSync(currentHole);
      // 2026-07-06 (course audit) — only count as LIVE when the read is genuinely
      // GPS-live ('ok') or a walking tee-relative estimate ('estimated'). 'no_fix' /
      // 'no_geometry' / 'no_hole' return the FROZEN scorecard number — badging that
      // "live" is a lie (it doesn't count down as you walk). Those → null → 'static'.
      return (y && (y.reason === 'ok' || y.reason === 'estimated')) ? (y.middle ?? null) : null;
    } catch { return null; }
    // markTick listed as a re-render signal: getGreenYardagesSync reads
    // from a cache the Mark handler writes; without it, the data-strip
    // middle yardage was stale until next hole change (Phase BG fix).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yardageMode, isRoundActive, currentHole, markTick]);

  // 2026-05-25 — Fix L: route the displayed yardage through the unified
  // resolver so userStatedYardage (Tier 3 voice anchor) AND static-card
  // fallback (Tier 2 when GPS is soft) both surface to the UI. The
  // resolver returns { value, source, confidence, reason } — we still
  // collapse to a number for the existing display contract, but the
  // source/confidence are available for honest labeling in a follow-up
  // (e.g. "STATIC CARD" badge below the number when is_fallback).
  // markTick + userStatedYardage in deps so the memo re-runs on mark
  // captures and voice-stated number changes.
  const userStatedYardage = useRoundStore(s => s.userStatedYardage);
  const resolvedYardage = useMemo(() => {
    if (!isRoundActive) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveYardage } = require('../../services/yardageResolver') as typeof import('../../services/yardageResolver');
      return resolveYardage(currentHole);
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRoundActive, currentHole, markTick, userStatedYardage]);

  const displayYardage = resolvedYardage?.value ?? liveYardage ?? currentYardage;

  // L1 Quiet's new SmartFinder hero needs the F/M/B triplet, not just
  // the middle. Pulled the same way liveYardage is (sync read + markTick
  // re-subscribe) so we don't add another GPS subscription.
  const _fmb = useMemo<FrontMiddleBack | null>(() => {
    if (!isRoundActive) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getGreenYardagesSync } = require('../../services/smartFinderService');
      const y = getGreenYardagesSync(currentHole);
      if (!y) return null;
      if (y.front == null && y.middle == null && y.back == null) return null;
      // 2026-05-21 — Consolidation 5: pass the reason through so the
      // DistanceCard can label "SCORECARD ~Xy" when the middle value
      // is the scorecard tee→green total (no per-hole green geometry
      // for this course) instead of a live GPS read.
      return { front: y.front, middle: y.middle, back: y.back, reason: y.reason };
    } catch { return null; }
    // markTick listed as a re-render signal — same rationale as liveYardage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRoundActive, currentHole, markTick]);

  // 2026-06-25 — Wire REAL elevation into the caddie HUD's plays-like. Player =
  // live GPS fix; target = the current hole's green (resolveGreenCoords). The
  // elevationService caches per ~11m grid (one lookup per tee/green), and the
  // hook returns 0 with hasData=false whenever either point is missing or the
  // lookup fails — so a missing elevation NEVER blocks or corrupts the yardage,
  // it just falls back to flat. markTick re-derives the coords on mark captures.
  const elevPlayerCoord = useMemo(() => {
    if (!isRoundActive) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getLastFix } = require('../../services/smartFinderService');
      const fix = getLastFix();
      return fix ? { lat: fix.location.lat, lng: fix.location.lng } : null;
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRoundActive, currentHole, markTick]);
  const elevGreenCoord = useMemo(() => {
    if (!isRoundActive) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveGreenCoords } = require('../../services/smartFinderService');
      const g = resolveGreenCoords(currentHole);
      const mid = g?.middle;
      return mid ? { lat: mid.lat, lng: mid.lng } : null;
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRoundActive, currentHole, markTick]);
  const caddieElevation = useElevationDeltaStatus(elevPlayerCoord, elevGreenCoord);

  const playsLikeYardage = useMemo(() => {
    if (displayYardage == null) return displayYardage;
    const elevFt = caddieElevation.deltaFeet;
    // With weather we get the full wind+temp+elevation model. With no weather we
    // still honor real elevation so uphill/downhill never goes dark (same spirit
    // as cnsShotRead). Flat read (elevFt === 0) leaves the number untouched.
    if (!caddieWeather) {
      return elevFt !== 0 ? Math.round(displayYardage + elevFt / 3) : displayYardage;
    }
    return playsLikeDistance(displayYardage, caddieWeather, caddieShotBearing, elevFt).plays_like_yards;
  }, [displayYardage, caddieWeather, caddieShotBearing, caddieElevation.deltaFeet]);

  // Audit 101 / W1 — useShallow subscriptions (see useRoundStore note above).
  const {
    voiceGender,
    voiceEnabled,
    language,
    autoListenEnabled,
    setVoiceEnabled,
    voiceOrchestrator,
  } = useSettingsStore(useShallow((s) => ({
    voiceGender: s.voiceGender,
    voiceEnabled: s.voiceEnabled,
    language: s.language,
    autoListenEnabled: s.autoListenEnabled,
    setVoiceEnabled: s.setVoiceEnabled,
    voiceOrchestrator: s.voiceOrchestrator,
  })));

  const { firstName: _firstName, goal: _goal, subscription_status, trial_started_at, dominantMiss: _dominantMiss, useCustomCaddie, customCaddiePortraitB64, customCaddieName } = usePlayerProfileStore(useShallow((s) => ({
    firstName: s.firstName,
    goal: s.goal,
    subscription_status: s.subscription_status,
    trial_started_at: s.trial_started_at,
    dominantMiss: s.dominantMiss,
    useCustomCaddie: s.useCustomCaddie,
    customCaddiePortraitB64: s.customCaddiePortraitB64,
    customCaddieName: s.customCaddieName,
  })));
  const setUseCustomCaddie = usePlayerProfileStore((s) => s.setUseCustomCaddie);
  // 2026-06-11 (audit 4c) — portrait moved to its own store; read it there,
  // fall back to the legacy profile field until migration completes.
  const mediaPortrait = useCustomCaddieMediaStore((s) => s.customCaddiePortraitB64);
  const activeCustomPortrait = useCustomCaddie ? (mediaPortrait ?? customCaddiePortraitB64) : null;
  const { skip_briefings, proactive_kevin_enabled: _proactive_kevin_enabled } = useSettingsStore(useShallow((s) => ({
    skip_briefings: s.skip_briefings,
    proactive_kevin_enabled: s.proactive_kevin_enabled,
  })));
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const setCaddiePersonality = useSettingsStore(s => s.setCaddiePersonality);
  // 2026-05-30 — Fix FY: Local Mode indicator subscription. Re-renders
  // the leaf icon when the user toggles Local Mode in Settings.
  const localMode = useSettingsStore(s => s.localMode);
  const daysLeft = useMemo(
    () => trialDaysLeft(trial_started_at),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscription_status, trial_started_at],
  );

  const {
    roundsTogether: _roundsTogether,
    sessionsTogether: _sessionsTogether,
    currentMentalState: _currentMentalState,
    heroMoments: _heroMoments,
    incrementRounds,
    isSpiralRisk,
  } = useRelationshipStore();

  const { setMode } = useKevinPresence();

  useFocusEffect(
    useCallback(() => {
      setMode('full');
      // Phase 105 — register active surface so caddieResolver can route
      // round-pillar caddie selection to voice / brain / avatar paths.
      // Cleanup runs when this tab loses focus.
      setActiveSurface('caddie');
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);

      // 2026-06-16 (Tim — "first try is always longer than every one after") — warm
      // the voice endpoints the MOMENT the caddie tab is focused, not just on tap.
      // The tap-time force-warm raced the user's (often short) utterance, so the
      // first response still paid cold-start. Warming on focus means transcribe /
      // voice-intent / kevin / TTS are hot by the time they tap. Passive (30s
      // dedupe) so re-focus doesn't spam.
      if (useSettingsStore.getState().voiceEnabled) {
        prewarmVoice();
        // 2026-06-16 — also warm the mic/capture pipeline (once, self-guarded) so the
        // first tap-to-talk isn't cold. Backup to the opener-tail prime for re-entry.
        void primeMicPipeline();
      }

      // Fire round_start_handoff when caddie regains focus with an active round on hole 1
      // (covers: briefing dismissed, skip_briefings path, any other entry)
      const storeNow = useRoundStore.getState();
      const settingsNow = useSettingsStore.getState();
      if (
        settingsNow.proactive_kevin_enabled &&
        !settingsNow.localMode && // Local Mode = conservation: no proactive speech (#10 conflict fix)
        storeNow.isRoundActive &&
        storeNow.currentHole === 1 &&
        Object.keys(storeNow.scores).length === 0
      ) {
        const t = setTimeout(() => {
          const trigger = shouldFireProactive({
            holesPlayed: 0,
            currentHole: 1,
            recentScores: [],
            ghostDelta: null,
            dominantMiss: usePlayerProfileStore.getState().dominantMiss ?? null,
            firstName: usePlayerProfileStore.getState().firstName || '',
            mode: storeNow.mode,
            trustLevel: useTrustLevelStore.getState().level,
          });
          if (trigger) {
            markProactiveFired(trigger.id);
            setCaddieResponse(trigger.message);
            setVoiceState('proactive');
            const { voiceEnabled, voiceGender: vg, language: lang } = useSettingsStore.getState();
            if (voiceEnabled) {
              speak(trigger.message, vg, lang, apiUrl)
                .catch(() => {})
                .finally(() => setVoiceState('idle'));
            } else {
              setTimeout(() => setVoiceState('idle'), 3000);
            }
          }
        }, 2500);
        return () => {
          clearTimeout(t);
          setMode('badge');
          clearActiveSurface('caddie');
          ScreenOrientation.unlockAsync();
        };
      }

      return () => {
        setMode('badge');
        clearActiveSurface('caddie');
        ScreenOrientation.unlockAsync();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setMode]),
  );

  // 2026-07-08 (Tim — get-to-know-you rework) — the dashboard card / settings row prime
  // the brain with a "getting to know the golfer" screenContext before opening this tab.
  // Nothing else clears it, so without this it would leak into EVERY later voice turn
  // (an on-course "what club here?" would be mis-framed as get-to-know chatter). Clear it
  // when the caddie tab loses focus. clearScreenContext(label) only clears if that label
  // is still current, so it can't stomp another screen's context.
  useFocusEffect(
    useCallback(() => {
      return () => clearScreenContext('getting to know the golfer');
    }, []),
  );

  // 2026-07-10 (Tim — "#5 interview loops back to the caddie tab / no indication it's an
  // interview"; picker choice: "Kevin speaks first"). When the get-to-know context is
  // active on entry, the caddie PROACTIVELY opens the conversation — greets + asks the
  // first open question ALOUD, then hands the mic to the player so the answer is captured
  // and (post-fix) ingested into the CNS profile. Fires once per entry; off-round + voice-
  // on only. Turns a silent "you're just on the caddie tab" into an obvious interview.
  const getToKnowOpenedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (getToKnowOpenedRef.current) return;
      if (getScreenContext()?.screen !== 'getting to know the golfer') return;
      if (useRoundStore.getState().isRoundActive) return; // off-round only
      getToKnowOpenedRef.current = true;
      // 2026-07-10 (audit V4) — claim the process-level opener slot so the persona mp3 opener
      // (guarded by openerPlayedThisProcess) stands down. Without this, a cold launch into the
      // get-to-know card fired BOTH → double-speak, or the persona opener barged in after the
      // interview mic already opened, cutting off the player's captured answer.
      openerPlayedThisProcess = true;
      const opener =
        "Alright — let's actually get to know your game. No wrong answers, just us talking. " +
        "To start: how'd you get into golf, and how much time do you really have to play and practice these days?";
      const t = setTimeout(() => {
        setCaddieResponse(opener);
        const { voiceEnabled, voiceGender: vg, language: lang } = useSettingsStore.getState();
        if (voiceEnabled) {
          setVoiceState('proactive');
          speak(opener, vg, lang, apiUrl)
            .catch(() => {})
            .finally(() => {
              setVoiceState('idle');
              // Hand the mic to the player so the answer is heard without hunting for a
              // button — hands-free is the product. Best-effort; a failure just means a tap.
              try { handleMicPressRef.current(); } catch { /* best-effort */ }
            });
        }
      }, 1400);
      return () => { clearTimeout(t); getToKnowOpenedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // ── Local state ─────────────────────────
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [appActive, setAppActive] = useState(true);
  const [kevinEmotion, setKevinEmotion] = useState<string | null>(null);
  const [openingPrompt, setOpeningPrompt] = useState('');
  const [caddieResponse, setCaddieResponse] = useState('');
  // 2026-06-27 (A2 offline degrade) — when voice can't reach the backend, offer
  // a typed question routed to the on-device offline caddie (services/offlineCaddie).
  const [offlineFallbackOpen, setOfflineFallbackOpen] = useState(false);
  const [offlineFallbackText, setOfflineFallbackText] = useState('');
  const [showShotCard, setShowShotCard] = useState(false);
  const [showRoundSetup, setShowRoundSetup] = useState(false);
  // 2026-07-04 (elite-clean audit) — the legacy MORE MENU SHEET (~220 lines) was
  // deleted: nothing ever opened it (no setShowMoreMenu(true) anywhere) and it
  // duplicated GlobalToolsMenu with drifted entries (legacy /cage, a 3rd End Round).
  // 2026-07-04 (elite-clean audit) — the flag-off pre-round Quick Tools FAB
  // (SHOW_QUICK_TOOLS_FAB=false since 2026-06-13; ~140 dead lines incl. a 2nd voice
  // toggle + a 4th trust cycler) was deleted along with its toolsExpanded state.
  // The ••• Tools menu (GlobalToolsMenu) is the single canonical tools entry.
  // Phase 109-followup — Quick Log Shot modal visibility.
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [selectedPickedCourse, setSelectedPickedCourse] = useState<PickedCourse | null>(
    { id: 'local:palms', name: 'Palms', fullName: 'Palms Golf Course', isLocal: true },
  );
  const [nineHole, setNineHole] = useState(false);
  const [isCompetition, setIsCompetition] = useState(false);
  const [roundNotes, setRoundNotes] = useState('');
  const [notesDictating, setNotesDictating] = useState(false);
  const [holeScore, setHoleScore] = useState(0);
  const [holePutts, setHolePutts] = useState(0);

  const [selectedMode, setSelectedMode] = useState<RoundMode>('free_play');

  const [_recapLoading, setRecapLoading] = useState(false);
  const [selectedGhostId, setSelectedGhostId] = useState<string | null>(null);

  // ── Shot tracking state (within shot card) ───
  const [pendingDirection, setPendingDirection] = useState<ShotResult['direction'] | null>(null);
  const [showOutcomeRow, setShowOutcomeRow] = useState(false);
  const [showRulesChoice, setShowRulesChoice] = useState(false);
  const [pendingOutcomeForRules, setPendingOutcomeForRules] = useState<'ob' | 'lost' | null>(null);
  const outcomeAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against double-commit: timer fire + near-simultaneous user tap can both call
  // commitShot before React flushes the state update that would hide the outcome row.
  const shotCommittedRef = useRef(false);

  // FIX M6 — GPS stop-detection proactive: debounce timer + single-fire gate.
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTriggeredRef = useRef(false);

  // Clear the 15s OB/lost outcome timer whenever the round ends or is discarded
  // so a stale timer can't fire after the round is gone.
  useEffect(() => {
    if (!isRoundActive && outcomeAutoTimerRef.current) {
      clearTimeout(outcomeAutoTimerRef.current);
      outcomeAutoTimerRef.current = null;
    }
  }, [isRoundActive]);

  // ── Ghost rehydration on mount ───────────
  useEffect(() => {
    if (!isRoundActive || !active_ghost) return;
    if (useGhostStore.getState().ghostRecord != null) return; // already live
    const record = roundHistory.find(r => r.id === active_ghost.source_round_id);
    if (record) {
      // Rebuild the running delta from the round scores already logged before
      // the restart (was resetting to zero with a bare activateGhost).
      const currentScores = useRoundStore.getState().scores ?? {};
      useGhostStore.getState().rehydrateProgress(record, currentScores);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // ── Floating response text ───────────────
  const displayText = caddieResponse || openingPrompt;
  const [shownText, setShownText] = useState(displayText);
  const responseFade = useRef(new Animated.Value(1)).current;
  // 2026-06-04 — Silence-aware caption fade. Mirror of the CaptionStrip
  // behavior for the Caddie tab's own bubble (CaptionStrip is suppressed
  // here at pathname '/'). When Kevin stops speaking, hold the bubble
  // visible for 6s, then fade opacity to 0 over 1s. New speech cancels
  // the fade and snaps opacity back to 1. The 8s hard auto-clear of
  // caddieResponse below still runs as a belt-and-suspenders timeout.
  const silenceFade = useRef(new Animated.Value(1)).current;
  const silenceFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceFadeAnim = useRef<Animated.CompositeAnimation | null>(null);
  const clearSilenceFade = useRef(() => {
    if (silenceFadeTimer.current) { clearTimeout(silenceFadeTimer.current); silenceFadeTimer.current = null; }
    if (silenceFadeAnim.current) { silenceFadeAnim.current.stop(); silenceFadeAnim.current = null; }
  }).current;

  // Pre-beta — battery-saver state for the L1 badge dot color.
  const [_saverActive, setSaverActive] = useState(false);
  useEffect(() => subscribeBattery((s) => setSaverActive(s.saverActive)), []);

  // Stable ref to handleMicPress — allows SmartMotion voice events and
  // onReadyToListen to call the latest version without a stale closure.
  const handleMicPressRef = useRef<() => void>(() => {});

  // SmartMotion voice layer — Kevin greets on open and reacts to session results.
  useEffect(() => {
    return subscribeSmartMotionVoiceEvent((event) => {
      const { voiceEnabled: ve, voiceGender: vg, language: lang } = useSettingsStore.getState();
      if (!ve) return;
      if (event.type === 'entered') {
        // 2026-07-18 (Tim — "when you go to a drill it auto-prompts and breaks the pipeline")
        // — SmartMotion/drill entry now says NOTHING. The old drill heads-up fired speak() on
        // navigation, which (one-voice invariant) CANCELLED any in-progress caddie conversation
        // and injected an unsolicited prompt — an interruption, not a help. The drill name is
        // already on-screen, and the caddie mic badge is right there to TAP ("what's up?") when
        // the user actually wants to engage. Generic entry was already silent (2026-06-29); this
        // extends the same rule to drill entry so the unified voice pipeline is never interrupted
        // just by moving to a screen. (Drill CONFIG still applies via subscribeDrillConfig.)
        void event; // no-op: entry is intentionally silent
      } else if (event.type === 'session_complete') {
        // 2026-07-07 (Tim — "prompt for another round so I never go back to the phone")
        // — after the per-swing reads, offer the NEXT ROUND explicitly. A "yes / run it
        // back" fires record_swing → beginNextRecording (auto-saves the finished set,
        // camera rolling). Naming a club/drill reconfigures first (SESSION_DONE_FOCUS).
        const line = `${event.summary} Want another round? Say run it back and I'll start it — or name a club or drill and I'll set that up instead.`;
        configureAudioForSpeech()
          .then(() => speak(line, vg, lang, apiUrl, { userInitiated: true }))
          .then(() => new Promise<void>((r) => setTimeout(r, 500)))
          .then(() => { handleMicPressRef.current(); })
          .catch(() => {});
      }
    });
  }, [apiUrl]);

  // Phase AT follow-up — L4 long-press inline expand for SmartVision
  // and SmartFinder removed; both icons now live inside the green-arrow
  // dropdown row and short-tap routes to their full screens.

  // Phase AU — universal collapsible green dropdown across L1/L2/L3/L4.
  // Tim: "All levels get the green arrow treatment we did in L4 so all
  // icons expand horizontally from the right to left." Default collapsed
  // → shows just the chevron pill; tap expands to reveal the icon row
  // to the LEFT. Auto-collapses after any action.
  const [l4ActionsExpanded, setL4ActionsExpanded] = useState(false);

  // Sim-report gap 2 — pre-warm audio engine when entering Quiet (L1) so
  // the first mic tap doesn't pay the ~200ms cold→warm cost. Fires once
  // per L1 entry; the audioLifecycle 90s idle timer still sweeps it back
  // to cold if the user never taps.
  useEffect(() => {
    if (trustLevel === 1) noteAudioActivity('l1_badge_visible');
  }, [trustLevel]);

  // Pre-beta — Discrete Mode badge pulse. Brief opacity dip + restore
  // when the user enters Quiet, so the mute dot landing reads as an
  // intentional transition instead of a static state change.
  const quietPulse = useRef(new Animated.Value(1)).current;
  const prevTrustLevel = useRef(trustLevel);
  useEffect(() => {
    if (prevTrustLevel.current !== 1 && trustLevel === 1) {
      Animated.sequence([
        Animated.timing(quietPulse, { toValue: 0.35, duration: 180, useNativeDriver: true }),
        Animated.timing(quietPulse, { toValue: 1,    duration: 320, useNativeDriver: true }),
      ]).start();
    }
    prevTrustLevel.current = trustLevel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trustLevel]);

  useEffect(() => {
    if (shownText === displayText) return;
    Animated.timing(responseFade, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setShownText(displayText);
      Animated.timing(responseFade, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayText]);

  // Phase BH — auto-clear an in-round caddieResponse after 8s so the bubble
  // doesn't linger over the data strip across multiple shots.
  useEffect(() => {
    if (!isRoundActive || !caddieResponse) return;
    const id = setTimeout(() => setCaddieResponse(''), 8000);
    return () => clearTimeout(id);
  }, [isRoundActive, caddieResponse]);

  // 2026-06-04 — Silence-fade wiring. Subscribes to speaking-state and
  // (a) cancels any pending fade + snaps opacity back to 1 when Kevin
  // starts a new line, (b) starts a 6s timer when Kevin stops, after
  // which the bubble fades out over 1s. New caption content also resets
  // the fade so a fresh line is always fully visible.
  useEffect(() => {
    const unsub = subscribeToSpeaking((nowSpeaking) => {
      if (nowSpeaking) {
        clearSilenceFade();
        silenceFade.setValue(1);
      } else {
        clearSilenceFade();
        silenceFadeTimer.current = setTimeout(() => {
          silenceFadeAnim.current = Animated.timing(silenceFade, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: true,
          });
          silenceFadeAnim.current.start();
        }, 6000);
      }
    });
    return () => { clearSilenceFade(); unsub(); };
  }, [silenceFade, clearSilenceFade]);

  // Reset silence-fade when new caption content arrives so the user
  // always sees a freshly-rendered line at full opacity.
  useEffect(() => {
    if (shownText || caddieResponse) {
      clearSilenceFade();
      silenceFade.setValue(1);
    }
  }, [shownText, caddieResponse, silenceFade, clearSilenceFade]);

  // Bubble opacity is responseFade × silenceFade — the swap-in/out
  // fade composes with the silence-driven fade.
  const bubbleOpacity = useRef(Animated.multiply(responseFade, silenceFade)).current;

  const currentPar = getCurrentPar();

  // Phase 106 — evaluate round-progress triggers when the active hole
  // changes. Conservative: detector only fires if cumulative score-vs-par
  // over the most recent N holes crosses a real-spiral threshold.
  useEffect(() => {
    if (!isRoundActive) return;
    try { evaluateRoundProgress(); } catch (e) { console.warn('[teamIntelligence] round-eval threw:', e); }
  }, [currentHole, isRoundActive]);

  // FIX M9 — proactive Kevin: score-streak triggers evaluated after each score write.
  // Covers: miss_streak_3, good_streak_3, rough_streak_3.
  // Must use _scores (the subscribed reactive value) as the dep so the effect fires
  // on every score write, not just on hole transitions.
  useEffect(() => {
    if (!isRoundActive || !_proactive_kevin_enabled || localMode) return; // Local Mode = no proactive (#10)
    const storeNow = useRoundStore.getState();
    const holesPlayed = Object.keys(storeNow.scores).length;
    if (holesPlayed < 3) return; // streaks require at least 3 holes
    // Build recentScores (last 3, relative to par) for the proactive engine.
    const scoreEntries = Object.entries(storeNow.scores)
      .map(([h, s]) => {
        const par = storeNow.courseHoles.find(c => c.hole === Number(h))?.par ?? 4;
        return { hole: Number(h), offset: s - par };
      })
      .sort((a, b) => a.hole - b.hole);
    const recentScores = scoreEntries.slice(-3).map(e => e.offset);
    const ghostDelta = useGhostStore.getState().overall_delta ?? null;
    const trigger = shouldFireProactive({
      holesPlayed,
      currentHole: storeNow.currentHole,
      recentScores,
      ghostDelta,
      dominantMiss: usePlayerProfileStore.getState().dominantMiss ?? null,
      firstName: usePlayerProfileStore.getState().firstName || '',
      mode: storeNow.mode,
      trustLevel: useTrustLevelStore.getState().level,
    });
    if (trigger) {
      markProactiveFired(trigger.id);
      setCaddieResponse(trigger.message);
      setVoiceState('proactive');
      const { voiceEnabled: ve, voiceGender: vg, language: lang } = useSettingsStore.getState();
      if (ve) {
        speak(trigger.message, vg, lang, apiUrl)
          .catch(() => {})
          .finally(() => setVoiceState('idle'));
      } else {
        setTimeout(() => setVoiceState('idle'), 3000);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_scores, isRoundActive, _proactive_kevin_enabled, localMode, apiUrl]);

  // FIX M9 — proactive Kevin: hole-transition triggers (front_9_summary at hole 10,
  // hole_transition_pattern_aware on every hole change). Augments the existing
  // focus-effect which only fires the round_start_handoff on hole 1.
  useEffect(() => {
    if (!isRoundActive || !_proactive_kevin_enabled || localMode) return; // Local Mode = no proactive (#10)
    const storeNow = useRoundStore.getState();
    const holesPlayed = Object.keys(storeNow.scores).length;
    const scoreEntries = Object.entries(storeNow.scores)
      .map(([h, s]) => {
        const par = storeNow.courseHoles.find(c => c.hole === Number(h))?.par ?? 4;
        return { hole: Number(h), offset: s - par };
      })
      .sort((a, b) => a.hole - b.hole);
    const recentScores = scoreEntries.slice(-3).map(e => e.offset);
    const ghostDelta = useGhostStore.getState().overall_delta ?? null;
    const baseCtx = {
      holesPlayed,
      currentHole,
      recentScores,
      ghostDelta,
      dominantMiss: usePlayerProfileStore.getState().dominantMiss ?? null,
      firstName: usePlayerProfileStore.getState().firstName || '',
      mode: storeNow.mode,
      trustLevel: useTrustLevelStore.getState().level as 1 | 2 | 3,
    };
    // front_9_summary fires exactly when currentHole advances to 10.
    // hole_transition_pattern_aware fires on any hole change (holes 2+).
    const triggerType = currentHole === 10 ? 'front_9_summary' : currentHole > 1 ? 'hole_transition_pattern_aware' : null;
    if (!triggerType) return;
    const trigger = shouldFireProactive({ ...baseCtx });
    // shouldFireProactive picks the highest-priority eligible trigger, which may
    // be front_9_summary or hole_transition_pattern_aware. Only act if the
    // returned trigger matches a hole-transition type so we don't double-fire
    // streak triggers (those are handled by the _scores effect above).
    if (
      trigger &&
      (trigger.id === 'front_9_summary' || trigger.id === 'hole_transition_pattern_aware')
    ) {
      markProactiveFired(trigger.id);
      setCaddieResponse(trigger.message);
      setVoiceState('proactive');
      const { voiceEnabled: ve, voiceGender: vg, language: lang } = useSettingsStore.getState();
      if (ve) {
        speak(trigger.message, vg, lang, apiUrl)
          .catch(() => {})
          .finally(() => setVoiceState('idle'));
      } else {
        setTimeout(() => setVoiceState('idle'), 3000);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHole, isRoundActive, _proactive_kevin_enabled, localMode, apiUrl]);

  // FIX M6 — GPS stop-detection proactive: subscribe to movementMode and fire a
  // proactive shot_strategy when the player stops walking mid-round.
  // Logic: stationary → 5s debounce → check guards → analyze → speak.
  //        walking     → clear debounce + reset gate so the next stop can re-fire.
  const movementMode = useMovementModeStore(s => s.mode);
  useEffect(() => {
    if (!isRoundActive || !_proactive_kevin_enabled || localMode || currentHole < 1) return; // Local Mode = no proactive (#10)

    if (movementMode === 'walking') {
      // Clear any pending debounce and reset gate so the NEXT stop can fire.
      if (stopDebounceRef.current) {
        clearTimeout(stopDebounceRef.current);
        stopDebounceRef.current = null;
      }
      stopTriggeredRef.current = false;
      return;
    }

    if (movementMode === 'stationary') {
      if (stopTriggeredRef.current) return; // already fired this stop cycle
      if (stopDebounceRef.current) return;  // debounce already running
      stopDebounceRef.current = setTimeout(() => {
        stopDebounceRef.current = null;
        // Guards: don't interrupt an active Kevin session.
        if (isSpeaking()) return;
        if (voiceState !== 'idle') return;
        if (stopTriggeredRef.current) return;
        stopTriggeredRef.current = true;
        void (async () => {
          try {
            const engine = await import('../../services/smartAnalysisEngine');
            const env = await engine.analyze({ kind: 'shot_strategy' });
            const text = env.voice_summary;
            if (!text) return;
            setCaddieResponse(text);
            setVoiceState('proactive');
            const { voiceEnabled: ve, voiceGender: vg, language: lang } = useSettingsStore.getState();
            if (ve) {
              speak(text, vg, lang, apiUrl)
                .catch(() => {})
                .finally(() => setVoiceState('idle'));
            } else {
              setTimeout(() => setVoiceState('idle'), 3000);
            }
          } catch (e) {
            console.log('[caddie] M6 stop-detection shot_strategy failed (non-fatal):', e);
          }
        })();
      }, 5000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movementMode, isRoundActive, _proactive_kevin_enabled, currentHole, localMode, apiUrl]);

  // Audit 101 / W2 — removed three orphan useMemos (_totalScore, _scoreVsPar,
  // _holesPlayed) that were unused. They invalidated and recomputed on every
  // score write because [scores] is a Record (new ref each write), and the
  // results were never read.

  // Derived early so animation effects can reference it.
  // 2026-05-16 — Reported at Mariners: active listening was either
  // hot-mic'd on TV noise (working as designed) OR push-to-talk taps
  // got no response. Root cause for the no-response side: VAD and
  // push-to-talk both call Audio.Recording.createAsync; whoever
  // doesn't own the mic right now silently fails. The old condition
  // (voiceState !== 'speaking') kept VAD active during 'listening',
  // 'thinking', and 'responding' — exactly the states where the
  // other path needs the mic. Now VAD only runs when voiceState
  // is 'idle' so push-to-talk can take the mic cleanly.
  // Phase AB — also gate on voiceState === 'idle' so VAD pauses while
  // Kevin is talking. Otherwise VAD picks up Kevin's TTS as user input
  // (and a fast 1.5–2.5s silence after Kevin's last word would trigger an
  // empty submission). VAD restarts naturally once voiceState returns to
  // 'idle' via the useEffect dep on `vadEnabled` in
  // useVoiceActivityDetection.
  // 2026-07-06 (voice-parity F1) — also gate on SmartMotion: while the camera
  // capture surface is mounted/recording it OWNS the mic, and a continuous VAD
  // recorder starting under it is a phantom mic (two Audio.Recording sessions
  // racing). The MANUAL mic handler already guards this (useVoiceCaddie
  // isSmartMotionActive → return); the VAD path had no equivalent. Gate here at
  // the single chokepoint so VAD pauses under SmartMotion and resumes on exit.
  // 2026-07-10 (Tim — "#10 check for conflicting settings"). Local Mode's own copy
  // promises "tap-to-talk / only speaks when you ask", but at runtime it ONLY changed
  // the brain tier — Active Listening kept auto-opening the mic, contradicting the
  // toggle the user flipped. Local Mode is the master conservation switch: it now truly
  // suppresses always-listening (and Proactive, below). Settings greys these out under
  // Local Mode so the conflict is visible, not silent.
  const vadEnabled = autoListenEnabled && !localMode && isRoundActive && appActive && voiceState === 'idle'
    && !isSmartMotionActive() && !isSmartMotionRecording();

  // ── Keep Vercel warm ────────────────────
  // 2026-06-16 (Tim — voice cleanup) — REMOVED the per-tab keepWarm setInterval that
  // pinged /api/kevin with {message:'__ping__'} every 4 min. It was redundant with
  // the app-wide heartbeat in useVoiceCaddie (services/voiceWarmup.prewarmVoice),
  // which warms ALL FOUR voice endpoints (voice/transcribe/voice-intent/kevin) on a
  // 240s cadence while foregrounded. Two 4-minute timers = double idle chatter; the
  // single heartbeat is the canonical keep-warm now.

  // ── AppState guard (battery) ─────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      setAppActive(nextState === 'active');
    });
    return () => sub.remove();
  }, []);

  // ── Opening prompt + post-splash opener audio ──
  // 2026-06-06 — RESTORED after a week-long search. Prior 6 attempts
  // (Stage 3, voice-launch heuristic, awaitGreetingComplete signal,
  // live voiceEnabled read, live voiceGender+language reads,
  // audioRouting queue, clean linear rebuild) all failed because they
  // depended on /api/voice TTS succeeding mid-cold-launch on flaky
  // networks. With bundled persona opener mp3s (assets/audio/openers/
  // <persona>.mp3, generated 2026-06-06), the opener uses the same
  // proven path Kevin's greeting has always used — playLocalFile of a
  // bundled asset. Zero network. Same reliability as the greeting.
  //
  // The four prior-bug avoidances baked in here:
  //   1) Live-read settings AFTER awaitGreetingComplete (not closure
  //      capture before hydration) — covers Fix FS pattern.
  //   2) Set openerPlayedThisProcess flag AFTER playLocalFile resolves
  //      (not before) — silent failure leaves flag false, next launch
  //      retries cleanly.
  //   3) Use awaitGreetingComplete signal + 10s safety race — never
  //      use a static setTimeout that could race splash audio.
  //   4) Bundled mp3 only — no /api/voice fetch in the opener path.
  useEffect(() => {
    setOpeningPrompt('Tap to talk.');

    void (async () => {
      if (openerPlayedThisProcess) return;
      // Wait for greeting to actually finish (or 10s safety net in
      // case greeting never resolved — force-quit mid-splash, etc.)
      await Promise.race([
        awaitGreetingComplete(),
        new Promise<void>(res => setTimeout(res, 10_000)),
      ]);
      // Re-check guard in case a concurrent mount won the race (hot
      // reload, tab cycle).
      if (openerPlayedThisProcess) return;
      // Live-read settings from store — post-hydration values, not
      // stale closure captures from first render.
      const liveSettings = useSettingsStore.getState();
      if (!liveSettings.voiceEnabled) {
        console.log('[caddie] opener skipped: voiceEnabled=false');
        return;
      }
      // If audio is already playing (greeting tail still finishing,
      // user already tapped to talk, brain reply mid-stream), skip
      // the opener — don't double-speak.
      if (isSpeaking()) {
        console.log('[caddie] opener skipped: audio already in flight');
        return;
      }
      try {
        const openerMod = getOpenerAssetForPersona(liveSettings.caddiePersonality);
        const asset = Asset.fromModule(openerMod);
        await asset.downloadAsync();
        if (!asset.localUri) {
          console.log('[caddie] opener skipped: asset has no localUri', { persona: liveSettings.caddiePersonality });
          return;
        }
        console.log('[caddie] opener playing:', { persona: liveSettings.caddiePersonality });
        // userInitiated:true — cold launch IS user-initiated; lets
        // L1 Quiet through (voiceEnabled is the hard kill switch above).
        await playLocalFile(asset.localUri, undefined, { userInitiated: true });
        // Set the flag ONLY after play resolves. Silent failures leave
        // it false so the next launch (or hot-reload remount) retries.
        openerPlayedThisProcess = true;
      } catch (e) {
        console.log('[caddie] opener failed (non-fatal):', e);
      }
      // 2026-06-16 (Tim — "fix that first-turn slowness") — greeting + opener are done,
      // the caddie is idle: warm the mic/audio-capture pipeline now (once, off-path) so
      // the user's first real tap-to-talk isn't cold. Self-guarded + best-effort.
      void primeMicPipeline();
    })();
  }, []);

  // ── SmartVision ──────────────────────────
  const openSmartVision = () => {
    if (!canAccess('smartvision', subscription_status)) {
      void triggerPaywall('smartvision', () => router.push('/paywall' as never));
      return;
    }
    // Phase AV — SmartVision now routes to the dedicated GolfShot-class
    // screen (app/smartvision.tsx). The legacy hole-view fallback was
    // removed in Phase BJ; reach hole-view directly via /hole-view if a
    // future regression makes that necessary.
    router.push('/smartvision' as never);
  };

  // ── Kevin programmatic hook ──────────────
  const { isThinking: kevinThinking } = useKevin();

  // ── Tool action handler ──────────────────
  const handleToolAction = useCallback((action: ToolAction) => {
    switch (action.type) {
      case 'open_smartvision':
        if (!canAccess('smartvision', subscription_status)) {
          setCaddieResponse("SmartVision is part of the Pro plan. Want to unlock it?");
          return;
        }
        openSmartVision();
        break;
      case 'open_swinglab':
        router.push('/(tabs)/swinglab' as never);
        break;
      case 'log_score': {
        // Phase BJ — Kevin's structured args now persist instead of just
        // opening the modal. `hole` is optional; default to currentHole.
        const targetHole = (action as { hole?: number }).hole ?? currentHole;
        const score = (action as { score: number }).score;
        if (typeof score === 'number' && Number.isFinite(score)) {
          const rounded = Math.round(score);
          // Once-per-hole mental-state advance (mirrors handleLogHole).
          // logScore is also the per-tap edit primitive, so only advance the
          // spiral on the FIRST score for this hole (a genuine completion) —
          // snapshot the prior score (>0) BEFORE logScore overwrites it.
          const alreadyScored = (useRoundStore.getState().scores[targetHole] ?? 0) > 0;
          logScore(targetHole, rounded);
          if (!alreadyScored) {
            const targetPar = useRoundStore.getState().courseHoles.find(c => c.hole === targetHole)?.par ?? 4;
            useRelationshipStore.getState().updateMentalState(rounded, targetPar);
          }
        } else {
          // Score missing — fall back to manual modal so Tim can finish entry.
          setShowShotCard(true);
        }
        break;
      }
      case 'log_shot': {
        // Phase BJ — map Kevin's free-text fields to the existing
        // ShotResult shape. Wider direction enum (pull/push/hook/slice/
        // fade/draw) collapses to left/straight/right for analytics that
        // already key on the closed enum; the original word survives in
        // shape/swing_feel/outcome_text fields.
        const a = action as {
          direction?: string;
          contactQuality?: string;
          outcome?: string;
          feel?: string;
          club?: string;
          // 2026-07-04 (Tim — compound statements) — the brain now passes the full
          // context it parsed: which hole, which shot, and how far it went.
          hole?: number;
          shot_number?: number;
          distance_yards?: number;
        };
        const dirMap: Record<string, 'left' | 'straight' | 'right' | null> = {
          left: 'left', pull: 'left', hook: 'left',
          right: 'right', push: 'right', slice: 'right',
          straight: 'straight', fade: 'straight', draw: 'straight',
        };
        const shapeMap: Record<string, 'draw' | 'straight' | 'fade' | null> = {
          draw: 'draw', hook: 'draw',
          fade: 'fade', slice: 'fade', push: 'fade',
          pull: 'draw',
          straight: 'straight',
        };
        const feelMap: Record<string, ShotResult['feel']> = {
          fat: 'fat', thin: 'thin', heel: 'heel', toe: 'toe',
          pure: 'pure', topped: 'topped',
        };
        const direction: ShotResult['direction'] = a.direction ? dirMap[a.direction] ?? null : null;
        const shape: ShotResult['shape'] = a.direction ? shapeMap[a.direction] ?? null : null;
        const feel: ShotResult['feel'] = a.contactQuality ? feelMap[a.contactQuality] ?? null : null;
        // FIX B9 — use the club from the tool args first; fall back to the store's
        // last-known club so the shot is never silently de-clubbed when Kevin
        // extracts a club name from the player's utterance.
        const shotClub: string | null = a.club ?? useRoundStore.getState().club ?? null;
        // FIX B9 — snapshot GPS position at log time so start_location is the
        // player's actual position when the shot was hit, not stale or null.
        let shotStartLocation: ShotLocation | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const gpsMod = require('../../services/gpsManager') as typeof import('../../services/gpsManager');
          const fix = gpsMod.getLastFix();
          if (fix) shotStartLocation = { lat: fix.lat, lng: fix.lng };
        } catch { /* non-fatal — start_location stays null */ }
        // FIX M8 — snapshot Kevin's pending rec before building the shot so
        // adherence is stamped, then clear the slot.
        const brainPendingRec = useRoundStore.getState().pendingKevinRec ?? null;
        const brainKevinRecClub = brainPendingRec?.club ?? null;
        const brainKevinAdhered =
          brainKevinRecClub != null && shotClub != null
            ? shotClub === brainKevinRecClub
            : null;
        // 2026-07-04 (Tim — compound statements) — honor a hole/distance the player
        // named ("...on hole 3 with 210 yards") instead of dropping them: log the shot
        // against the stated hole, and stamp the stated yardage when nothing measured it.
        const shotHole = typeof a.hole === 'number' && a.hole > 0 ? Math.round(a.hole) : currentHole;
        const shotDistance = typeof a.distance_yards === 'number' && a.distance_yards > 0 && a.distance_yards <= 500
          ? Math.round(a.distance_yards) : null;
        const shot: ShotResult = {
          hole: shotHole,
          timestamp: Date.now(),
          feel,
          direction,
          shape,
          club: shotClub,
          acousticContact: null,
          outcome_text: a.outcome ?? null,
          swing_feel: a.feel ?? null,
          logged_via: 'voice',
          start_location: shotStartLocation,
          distance_yards: shotDistance,
          // 2026-07-04 (clean-audit M1) — stop dropping the stated shot ordinal.
          shot_number: typeof a.shot_number === 'number' && a.shot_number > 0 ? Math.round(a.shot_number) : null,
          kevin_rec_club: brainKevinRecClub,
          kevin_rec_shape: brainPendingRec?.shape ?? null,
          kevin_adhered: brainKevinAdhered,
        };
        logShot(shot);
        useRoundStore.getState().clearPendingKevinRec();
        break;
      }
      case 'plan_shot': {
        // 2026-07-04 (Tim — "parse anything I say into context") — a PRE-shot plan:
        // "I'm going to hit a 5 wood for my second shot on hole 3 with 210 to go."
        // Set the club + stated-yardage context (so the caddie's next reads use it) and
        // confirm it back. Does NOT log a completed shot.
        const p = action as { club?: string; distance_yards?: number; shot_number?: number; hole?: number; target?: string };
        const rs = useRoundStore.getState();
        if (typeof p.club === 'string' && p.club.trim()) rs.setClub(p.club.trim());
        if (typeof p.distance_yards === 'number' && p.distance_yards > 0 && p.distance_yards <= 700) {
          rs.setUserStatedYardage(Math.round(p.distance_yards), 'user');
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const toast = require('../../store/toastStore') as typeof import('../../store/toastStore');
          const bits = [
            typeof p.club === 'string' && p.club.trim() ? p.club.trim() : null,
            typeof p.distance_yards === 'number' && p.distance_yards > 0 ? `${Math.round(p.distance_yards)}y` : null,
            typeof p.shot_number === 'number' && p.shot_number > 0 ? `shot ${Math.round(p.shot_number)}` : null,
            // 2026-07-04 (clean-audit M1) — surface the stated target too.
            typeof p.target === 'string' && p.target.trim() ? `→ ${p.target.trim()}` : null,
          ].filter(Boolean).join(' · ');
          toast.useToastStore.getState().show(bits ? `Plan set — ${bits}` : 'Plan noted');
        } catch (e) { console.log('[caddie] plan_shot toast failed (non-fatal):', e); }
        break;
      }
      case 'set_reminder': {
        // 2026-07-04 (Tim — verbal reminders) — "remind me to work on my putting
        // Thursday" → a SmartPlan reminder the caddie surfaces + considers all week.
        const rem = action as { text?: string; when?: string };
        if (typeof rem.text === 'string' && rem.text.trim()) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const plan = require('../../store/practicePlanStore') as typeof import('../../store/practicePlanStore');
            plan.usePracticePlanStore.getState().addReminder(rem.text.trim(), rem.when ?? null);
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const toast = require('../../store/toastStore') as typeof import('../../store/toastStore');
            toast.useToastStore.getState().show(`⏰ Reminder set${rem.when ? ` — ${rem.when.trim()}` : ''}`);
          } catch (e) { console.log('[caddie] set_reminder failed (non-fatal):', e); }
        }
        break;
      }
      case 'log_emotional_state': {
        const a = action as { state: string; valence: 'positive' | 'neutral' | 'negative' };
        logEmotionalState(a.state, a.valence, currentHole);
        // 2026-06-23 (Tim — "don't see the emotion state pickup in the builds") —
        // the log was wired into the brain but had NO visible surface, so a pickup
        // was invisible (and Tim tests outside a round, where it's easy to miss).
        // Append works regardless of round state; this just makes it VISIBLE with a
        // warm, valence-aware confirmation so you can see the caddie register it.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const toast = require('../../store/toastStore') as typeof import('../../store/toastStore');
          const emoji = a.valence === 'positive' ? '💚' : a.valence === 'negative' ? '🫶' : '👍';
          const label = (a.state || '').trim();
          toast.useToastStore.getState().show(
            label ? `Noted — ${label} ${emoji}` : `Got it ${emoji}`,
          );
        } catch (e) { console.log('[caddie] emotion toast failed (non-fatal):', e); }
        break;
      }
      case 'log_issue': {
        // 2026-06-26 (Tim) — "log this issue" via voice writes a REAL issue-log
        // entry (not a conversational "noted"). addUserIssue self-builds context
        // and owner-gates, so this works regardless of voice orchestrator. The
        // brain already spoke the confirmation; this just persists it.
        const a = action as { note: string };
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const issue = require('../../store/issueLogStore') as typeof import('../../store/issueLogStore');
          issue.useIssueLogStore.getState().addUserIssue(a.note ?? '');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const toast = require('../../store/toastStore') as typeof import('../../store/toastStore');
          toast.useToastStore.getState().show('📝 Logged to the issue log');
        } catch (e) { console.log('[caddie] log_issue write failed (non-fatal):', e); }
        break;
      }
      case 'record_swing':
        // 2026-06-15 (Tim) — if Smart Motion is already open, ARM the recorder in
        // place (the bus) instead of navigating to the wrong screen. The old route
        // pushed /(tabs)/swinglab?mode=record — NOT the Smart Motion recorder the
        // user is standing in — so a brain-fired record_swing never actually rolled.
        if (isSmartMotionActive()) {
          emitSmartMotionCommand('start');
        } else {
          // 2026-06-30 (Tim — "watch this swing" on the course) — open Smart Motion STRAIGHT
          // into recording (autoRecord arms the camera's onCameraReady). Course mode is
          // auto-forced there when a round is active, so this lands in the COURSE capture
          // interface, camera ready, rolling — not the setup screen.
          router.push('/swinglab/smartmotion?autoRecord=1' as never);
        }
        break;
      case 'configure_drill':
        // 2026-07-06 (nav audit) — open SmartMotion (rolling) with the shot count when
        // it's closed, instead of emitting into a bus with no listeners.
        if (isSmartMotionActive()) {
          emitDrillConfig({
            club: (action as { type: string; club?: string }).club,
            shotCount: (action as { type: string; shot_count?: number }).shot_count,
          });
        } else {
          const sc = (action as { shot_count?: number }).shot_count;
          const cl = (action as { club?: string }).club;
          const parts = ['autoRecord=1'];
          if (typeof sc === 'number' && sc > 0) parts.push(`drillShots=${Math.round(sc)}`);
          // 2026-07-10 (audit V7) — carry the club on the closed-app launch too (was dropped).
          if (cl) parts.push(`club=${encodeURIComponent(String(cl))}`);
          router.push(`/swinglab/smartmotion?${parts.join('&')}` as never);
        }
        break;
      case 'close_swinglab':
        emitSmartMotionCommand('close');
        break;
      case 'set_angle': {
        // 2026-06-29 (Tim) — voice camera-angle on the SmartMotion screen.
        // 2026-07-06 (nav audit) — open it set to that angle + rolling when closed.
        const a = (action as { angle?: string }).angle;
        if (isSmartMotionActive()) {
          if (a === 'face_on') emitSmartMotionCommand('angleFaceOn');
          else if (a === 'putt') emitSmartMotionCommand('puttOn');
          else emitSmartMotionCommand('angleDtl');
        } else {
          const angleParam = a === 'face_on' ? 'face_on' : a === 'putt' ? 'putt' : 'down_the_line';
          router.push(`/swinglab/smartmotion?angle=${angleParam}&autoRecord=1` as never);
        }
        break;
      }
      case 'set_golfer': {
        // 2026-06-29 (Tim) — voice golfer attribution: "this is Luis" / "back to me".
        const name = (action as { name?: string }).name?.trim();
        const fam = useFamilyStore.getState();
        if (!name || /^(me|myself|i)$/i.test(name)) {
          fam.setActiveMember(null);
        } else {
          const lower = name.toLowerCase();
          const m = fam.members.find(mm => (mm.firstName ?? '').toLowerCase() === lower)
            ?? fam.members.find(mm => (mm.firstName ?? '').toLowerCase().startsWith(lower));
          if (m) fam.setActiveMember(m.id);
        }
        break;
      }
      case 'switch_caddie': {
        // 2026-07-06 (voice-lifecycle audit #13) — this tab case had drifted from the
        // service dispatcher: it excluded 'custom' and skipped the setUseCustomCaddie
        // sync (stale avatar/voice overrides). Delegate to the ONE implementation.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('../../services/voice/conversationalToolDispatch') as typeof import('../../services/voice/conversationalToolDispatch'))
            .dispatchConversationalToolActions([action]);
        } catch (e) { console.log('[caddie] switch_caddie dispatch failed:', e); }
        break;
      }
      case 'mark_tee':
        // 2026-07-09 — persist the GPS override (was signal-only → "marked" saved nothing off
        // the SmartVision screen). Still signal a mounted SmartVision.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        void (require('../../services/gpsMarkOverride') as typeof import('../../services/gpsMarkOverride')).writeGpsMarkOverride('tee');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('../../store/smartVisionSignalStore') as typeof import('../../store/smartVisionSignalStore')).useSmartVisionSignalStore.getState().signalMark('tee');
        break;
      case 'mark_green':
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        void (require('../../services/gpsMarkOverride') as typeof import('../../services/gpsMarkOverride')).writeGpsMarkOverride('green');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('../../store/smartVisionSignalStore') as typeof import('../../store/smartVisionSignalStore')).useSmartVisionSignalStore.getState().signalMark('pin');
        break;
      case 'open_smartfinder':
        if (!canAccess('smartfinder', subscription_status)) {
          setCaddieResponse("SmartFinder is part of the Pro plan. Want to unlock it?");
          return;
        }
        router.push('/smartfinder' as never);
        break;
      case 'navigate':
        // 2026-06-04 — Deferred navigation from openToolHandler. The
        // handler used to call router.push synchronously inside its
        // execute() body, which raced TTS for any destination that
        // claimed audio/camera on mount (SmartMotion, Cage Mode,
        // SmartFinder). Path is fully constructed (query params
        // already appended) by the handler.
        router.push(action.path as never);
        break;
      case 'navigate_replace':
        // Used after end_round so the back button doesn't return to the
        // active-caddie screen — replace instead of push.
        router.replace(action.path as never);
        break;
      case 'open_url': {
        // 2026-07-06 (voice-lifecycle audit #13) — this tab case opened ANY url with
        // no https/host allowlist and no internal-path handling, while the service
        // dispatcher enforced both. Delegate to the ONE implementation.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('../../services/voice/conversationalToolDispatch') as typeof import('../../services/voice/conversationalToolDispatch'))
            .dispatchConversationalToolActions([action]);
        } catch (e) { console.log('[caddie] open_url dispatch failed:', e); }
        break;
      }
      default:
        // 2026-07-06 (audit L6) — log unknown tool types instead of silently swallowing.
        console.log('[caddie] unhandled tool action type:', (action as { type?: string }).type);
    }
    // Phase A.4: first-tool hint after first launch in first round.
    const hint = getFirstToolHint();
    if (hint) setCaddieResponse(hint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSmartVision, club, router, currentHole, logScore, logShot, logEmotionalState]);

  // ── Shot tracking callbacks ──────────────
  const clearShotPending = useCallback(() => {
    if (outcomeAutoTimerRef.current) {
      clearTimeout(outcomeAutoTimerRef.current);
      outcomeAutoTimerRef.current = null;
    }
    shotCommittedRef.current = false;
    setPendingDirection(null);
    setShowOutcomeRow(false);
    setShowRulesChoice(false);
    setPendingOutcomeForRules(null);
  }, []);

  const commitShot = useCallback((
    direction: ShotResult['direction'],
    outcome: ShotOutcome,
    rulesDecision?: RulesDecision,
  ) => {
    if (shotCommittedRef.current) return; // already committed — timer + tap race guard
    shotCommittedRef.current = true;
    // Phase BM — cancel the 15s auto-resolve timer so it can't fire and
    // re-speak after the user has already committed via tap.
    if (outcomeAutoTimerRef.current) {
      clearTimeout(outcomeAutoTimerRef.current);
      outcomeAutoTimerRef.current = null;
    }
    const resolution = resolvePenalty(outcome, rulesDecision);
    const shot: ShotResult = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      feel: null,
      direction,
      shape: null,
      club: club ?? null,
      hole: currentHole,
      timestamp: Date.now(),
      acousticContact: null,
      outcome: resolution.outcome,
      penalty_strokes: resolution.penalty_strokes,
      rules_decision: resolution.rules_decision,
    };
    logShot(shot);
    const suggested = useRoundStore.getState().computeHoleScore(currentHole);
    if (suggested != null) setHoleScore(suggested);
    clearShotPending();
    if (resolution.kevin_voice_line && voiceEnabled) {
      speak(resolution.kevin_voice_line, voiceGender, language, apiUrl).catch(() => {});
    }
  }, [currentHole, club, logShot, clearShotPending, voiceEnabled, voiceGender, language, apiUrl]);

  const handleDirectionTap = useCallback((direction: ShotResult['direction']) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPendingDirection(direction);
    setShowOutcomeRow(true);
    setShowRulesChoice(false);
    setPendingOutcomeForRules(null);
    if (outcomeAutoTimerRef.current) clearTimeout(outcomeAutoTimerRef.current);
    outcomeAutoTimerRef.current = setTimeout(() => {
      outcomeAutoTimerRef.current = null;
      commitShot(direction, 'clean');
    }, 1500);
  }, [commitShot]);

  const handleOutcomeTap = useCallback((outcome: ShotOutcome) => {
    if (!pendingDirection) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (outcome === 'ob' || outcome === 'lost') {
      if (outcomeAutoTimerRef.current) {
        clearTimeout(outcomeAutoTimerRef.current);
        outcomeAutoTimerRef.current = null;
      }
      setShowRulesChoice(true);
      setPendingOutcomeForRules(outcome);
      const resolution = resolvePenalty(outcome);
      if (resolution.kevin_voice_line && voiceEnabled) {
        speak(resolution.kevin_voice_line, voiceGender, language, apiUrl).catch(() => {});
      }
      // Auto-resolve as play_forward after 15 seconds if user walks away.
      // Plays a voice line before committing so the user isn't surprised by a silent decision.
      outcomeAutoTimerRef.current = setTimeout(() => {
        outcomeAutoTimerRef.current = null;
        if (voiceEnabled) {
          speak("Locked in as play forward — let me know if I got that wrong.", voiceGender, language, apiUrl).catch(() => {});
        }
        commitShot(pendingDirection, outcome, 'play_forward');
      }, 15000);
      return;
    }
    commitShot(pendingDirection, outcome);
  }, [pendingDirection, commitShot, voiceEnabled, voiceGender, language, apiUrl]);

  const handleRulesChoice = useCallback((decision: RulesDecision) => {
    if (!pendingDirection || !pendingOutcomeForRules) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    commitShot(pendingDirection, pendingOutcomeForRules, decision);
  }, [pendingDirection, pendingOutcomeForRules, commitShot]);

  const currentHoleShots = useMemo(
    () => shots.filter(s => s.hole === currentHole),
    [shots, currentHole],
  );

  // Auto-prefill score when shot card opens if shots already logged
  useEffect(() => {
    if (!showShotCard) return;
    const suggested = computeHoleScore(currentHole);
    if (suggested != null) setHoleScore(suggested);
  }, [showShotCard]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pipecat voice orchestrator (Phase 2) ─
  const pipecatVoice = usePipecatVoice({
    onUIEvent: (event) => {
      // UI tool events from Claude → dispatch through existing handleToolAction
      handleToolAction({ type: event } as Parameters<typeof handleToolAction>[0]);
    },
    onKevinSpoke: (text) => {
      setCaddieResponse(text);
    },
    onToolAction: handleToolAction,
    onVoiceStateChange: (state) => {
      setVoiceState(state);
      if (state !== 'listening') setKevinEmotion(null);
    },
    onReadyToListen: () => { handleMicPressRef.current(); },
  });

  // ── Voice hook ───────────────────────────
  const { handleMicPress: _handleMicPress, processAudioUri } = useVoiceCaddie({
    onVoiceStateChange: (state) => {
      setVoiceState(state);
      if (state !== 'listening') setKevinEmotion(null);
    },
    onResponseReceived: (text) => {
      setCaddieResponse(text);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    },
    onHeroMoment: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    },
    onVisionTrigger: openSmartVision,
    onHeroReelView: () => {
      setCaddieResponse('Here are your best moments.');
      router.push('/(tabs)/dashboard' as never);
    },
    onToolAction: handleToolAction,
    // 2026-06-27 (A2) — voice couldn't reach the backend; open the typed
    // offline-caddie fallback so a dead network degrades to "type it".
    onOfflineFallback: () => setOfflineFallbackOpen(true),
    // Pipecat override — when active, Claude handles brain + TTS + tools
    processTranscriptOverride: voiceOrchestrator === 'pipecat'
      ? pipecatVoice.processTurn
      : undefined,
  });

  // 2026-06-29 (Tim — "single brain everywhere") — the SmartMotion screen's mic
  // forwards its transcribed words here so the SAME pipecat brain handles them: it
  // speaks the reply (dialogue-first prompt intact) AND dispatches tools through the
  // normal handleToolAction path (record_swing → SmartMotion bus, configure_drill,
  // navigate, switch_caddie). One brain, one TTS pipeline — no second voice instance.
  const smProcessTurnRef = useRef(pipecatVoice.processTurn);
  useEffect(() => { smProcessTurnRef.current = pipecatVoice.processTurn; }, [pipecatVoice.processTurn]);
  useEffect(() => {
    return subscribeSmartMotionUtterance((text) => {
      const t = (text ?? '').trim();
      if (t) void smProcessTurnRef.current(t);
    });
  }, []);

  // 2026-06-27 (A2 offline degrade) — answer a typed question with ZERO network
  // via the on-device offline caddie (round state + golf KB), spoken through the
  // device voice (expo-speech, offline-capable). Honest when neither layer can help.
  const handleOfflineAsk = () => {
    const q = offlineFallbackText.trim();
    if (!q) return;
    const langSafe = (['en', 'es', 'zh'] as const).includes(language as 'en' | 'es' | 'zh')
      ? (language as 'en' | 'es' | 'zh')
      : 'en';
    const ans = answerOffline(q, langSafe);
    const reply = ans?.text ?? "I can't answer that one offline — it needs a connection. I've got yardages, club calls and the basics covered without signal.";
    setCaddieResponse(reply);
    if (voiceEnabled) void speakDeviceNotice(reply, language, voiceGender).catch(() => {});
    setOfflineFallbackText('');
    setOfflineFallbackOpen(false);
  };

  const handleMicPress = () => {
    // Phase BH — stronger haptic so the tap is unmistakable when Kevin's
    // visual ring takes a beat to appear (audio init / permission resolve).
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    _handleMicPress();
  };
  // Keep the ref in sync with the latest handleMicPress closure so that
  // SmartMotion events and onReadyToListen always call the current version.
  handleMicPressRef.current = handleMicPress;

  // ── Conversational shot logging — Phase A.2 / Phase Y ──
  // Phase Y — start/stop now lives in app/_layout.tsx so the lifecycle
  // survives tab focus changes (briefly leaving the caddie tab no longer
  // tears down the GPS shot subscription). This effect now only wires the
  // configure() call (apiUrl/voice/language can change at runtime) and the
  // fallback callback that needs caddie-screen state.
  useEffect(() => {
    conversationalLoggingOrchestrator.configure({
      apiUrl,
      voiceGender,
      language,
      captureUtterance: (timeoutMs) => captureUtterance(timeoutMs, apiUrl, language),
      onFallbackToManual: () => setShowShotCard(true),
    });
  }, [apiUrl, voiceGender, language]);

  // Suspend orchestrator while modals or other voice flows are active.
  useEffect(() => {
    conversationalLoggingOrchestrator.setSuspended(showShotCard || showRoundSetup);
  }, [showShotCard, showRoundSetup]);

  // ── VAD — continuous listening ───────────
  const { isListening: _vadListening } = useVoiceActivityDetection({
    enabled: vadEnabled,
    onSpeechStart: () => {
      setKevinEmotion('listening');
      setVoiceState('listening');
    },
    onSpeechEnd: (uri) => {
      setKevinEmotion(null);
      // source: 'vad' is a breadcrumb only — there is NO wake-word gate.
      // The gate was removed because it broke nameless queries like "how
      // are you". VAD-detected speech is routed to the brain exactly like a
      // tap; VAD itself is already scoped to in-round idle.
      processAudioUri(uri, { source: 'vad' });
    },
  });

  // 2026-05-17 — useVolumeButtonTrigger removed. The native
  // react-native-volume-manager dep was stripped earlier and the
  // hook body was a no-op; the import + call were dead weight here.

  // ── Round summary ────────────────────────
  // 2026-05-19 — accept the snapshot as params. Caller MUST capture
  // total/vspar/played BEFORE calling endRound(), because endRound resets
  // scores to {} and getTotalScore/getScoreVsPar/getHolesPlayed would
  // all return 0 afterward. Previously this read straight from the
  // store and always saw 0, so every round-end fired the < 9 "Short
  // round" branch even when 18 holes were filled.
  const generateRoundSummary = async (snapshot?: {
    total: number;
    vspar: number;
    played: number;
    // 2026-06-21 — Callers must capture scores/courseHoles/activeCourse
    // BEFORE calling endRound(), because endRound() resets them to
    // {}/[]/null. buildContextualSummary uses these for best/worst hole
    // analysis; without the pre-reset snapshot it always returned the
    // "0 holes" fallback.
    scores: Record<number, number>;
    courseHoles: Array<{ hole: number; par: number }>;
    activeCourse: string | null;
  }, roundId?: string) => {
    const total = snapshot?.total ?? getTotalScore();
    const vspar = snapshot?.vspar ?? getScoreVsPar();
    const played = snapshot?.played ?? getHolesPlayed();
    const relState = useRelationshipStore.getState();

    // 2026-05-18 — Contextual summary instead of generic "Short round /
    // Solid effort" buckets. Pulls the live scores + courseHoles +
    // active course name out of the store and builds a summary that
    // references SOMETHING specific (best hole, worst hole, course
    // name, holes played, score vs par). The full AI recap arrives
    // ~5-10s later; this is the *immediate* spoken line and should
    // still sound like Kevin is in the round with you.
    // 2026-06-21 — Use snapshot fields (captured pre-endRound) rather than
    // re-reading the live store (which endRound() has already reset).
    const snapshotScores = snapshot?.scores ?? useRoundStore.getState().scores;
    const snapshotCourseHoles = snapshot?.courseHoles ?? useRoundStore.getState().courseHoles;
    const cName = snapshot?.activeCourse ?? useRoundStore.getState().activeCourse ?? 'this course';
    // 2026-07-04 (elite-clean audit) — the contextual summary builder moved to
    // services/roundEndSummary.ts (ONE implementation; GlobalToolsMenu had a
    // drifting verbatim copy).
    let summary = buildRoundEndSummary({
      total, vspar, played,
      scores: snapshotScores,
      courseHoles: snapshotCourseHoles,
      activeCourse: cName,
    });

    const best = usePlayerProfileStore.getState().personalBest;
    const isNewPersonalBest = !!(best && total > 0 && total < best);
    if (isNewPersonalBest) {
      summary = 'New personal best — ' + total + ". That's what we came for.";
      relState.recordBreakthrough(
        'New personal best: ' + total,
        relState.roundsTogether,
      );
    }

    setCaddieResponse(summary);

    // 2026-06-14 (audit fix) — the audio/TTS block must NOT be able to throw past
    // the points award + recap navigation below. On a course, configureAudioForSpeech
    // or speakChunked can reject (weak signal / TTS fail); previously that threw out
    // of generateRoundSummary so the round "ended" with NO recap and NO points. Wrap
    // it so a mute caddie still credits points and opens the recap.
    if (voiceEnabled) {
      try {
        await configureAudioForSpeech();
        // 2026-05-25 — On personal best, play the D-ID bestround clip
        // (Kevin's real voice celebrating) instead of TTS'ing the text
        // summary. The video itself isn't shown — we're just routing the
        // celebration audio through the same speak surface so the user
        // hears Kevin congratulate them in his actual recorded voice.
        // Defensive: if the clip resolves to a bundled module but the
        // asset.downloadAsync/localUri pipeline fails (rare), fall back
        // to the standard TTS speak so the user still hears SOMETHING.
        let playedBestroundClip = false;
        if (isNewPersonalBest) {
          try {
            const bestroundMod = getCaddieClip('kevin', 'bestround');
            if (bestroundMod != null) {
              const asset = Asset.fromModule(bestroundMod);
              await asset.downloadAsync();
              if (asset.localUri) {
                await playLocalFile(asset.localUri, undefined, { userInitiated: true });
                playedBestroundClip = true;
              }
            }
          } catch (e) {
            console.log('[caddie] bestround clip play failed (falling back to TTS):', e);
          }
        }
        if (!playedBestroundClip) {
          await speakChunked(summary, voiceGender, language, apiUrl);
        }
      } catch (e) {
        console.log('[caddie] round-summary speak failed (non-fatal, continuing to points + recap):', e);
      }
    }

    usePointsStore.getState().addPoints(
      Math.max(10, 50 - Math.max(0, vspar * 2)),
      'Round completed',
    );

    // Kick off recap generation asynchronously — don't block the summary
    // 2026-06-21 — Use the roundId passed by the caller (captured BEFORE
    // endRound() set currentRoundId → null). Reading it from the live store
    // here always returned null, so generateRecap() never fired.
    const storeState = useRoundStore.getState();
    if (roundId) {
      setRecapLoading(true);
      const patternInsights = generatePatternInsights(storeState.shots, {
        currentRoundMode: storeState.mode,
        scores: storeState.scores,
        courseHoles: storeState.courseHoles,
        handicap: usePlayerProfileStore.getState().handicap,
        dominantMiss: usePlayerProfileStore.getState().dominantMiss as 'left' | 'right' | 'straight' | null,
      });
      // Phase U — bundle recent cage practice + pre-round notes for recap context.
      // 14-day window picks up the most recent practice work without surfacing
      // stale issues. Cage data drives the "your work on X is showing" honesty
      // bar in the Sonnet recap prompt.
      const cageContext = (() => {
        const cs = useCageStore.getState();
        const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const recent = cs.sessionHistory.filter(s => s.date >= cutoff);
        if (recent.length === 0) return null;
        const issues = recent
          .filter(s => s.primary_issue)
          .map(s => ({
            issue_name: s.primary_issue!.name,
            severity: s.primary_issue!.severity,
            occurrence_count: s.primary_issue!.occurrence_count,
            session_date: new Date(s.date).toISOString().slice(0, 10),
          }));
        const drills = recent
          .filter(s => s.drill_recommendation)
          .map(s => ({
            drill_name: s.drill_recommendation!.drill_name,
            target_issue: s.primary_issue?.name ?? 'general',
          }));
        return {
          recent_sessions_count: recent.length,
          primary_issues: issues,
          drill_recommendations: drills,
          most_recent_session_date: recent[recent.length - 1]
            ? new Date(recent[recent.length - 1].date).toISOString().slice(0, 10)
            : null,
        };
      })();
      // Phase V Component 2 — Arena practice context. Reads pointsStore
      // history within the same 14-day window as cage_context. Lets the
      // recap connect Skills/CTP/Sim work to on-course outcomes.
      const arenaContext = (() => {
        const ps = usePointsStore.getState();
        const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const recent = ps.history.filter(h => h.timestamp >= cutoff);
        if (recent.length === 0) return null;
        return {
          recent_sessions_count: recent.length,
          recent_sessions: recent.map(h => ({
            reason: h.reason,
            points: h.points,
            date: new Date(h.timestamp).toISOString().slice(0, 10),
          })),
          most_recent_date: recent[recent.length - 1]
            ? new Date(recent[recent.length - 1].timestamp).toISOString().slice(0, 10)
            : null,
        };
      })();
      generateRecap(roundId, {
        courseName: storeState.activeCourse ?? 'Unknown Course',
        courseId: storeState.activeCourseId,
        mode: storeState.mode,
        startedAt: storeState.roundStartTime ?? Date.now(),
        endedAt: Date.now(),
        totalScore: total,
        scoreVsPar: vspar,
        scores: storeState.scores,
        shots: storeState.shots,
        courseHoles: storeState.courseHoles,
        patternInsights: patternInsights.insights,
        playerName: usePlayerProfileStore.getState().firstName || usePlayerProfileStore.getState().name || 'the player',
        apiUrl,
        // IMPORTANT: getSnapshot() must run before any future deactivateGhost() call —
        // ghost store is in-memory only and deactivation clears all hole results.
        ghostSnapshot: useGhostStore.getState().getSnapshot(),
        cageContext,
        preRoundNotes: storeState.roundNotes || null,
        arenaContext,
        // Phase BR Component 9 — active tutorial practice context.
        // buildFullPracticeContext returns null when no tutorials are
        // flagged active; api/recap.ts skips the practice block in that
        // case, so pre-BR rounds without tutorials are unchanged.
        practiceContext: buildFullPracticeContext(),
        voiceGender,
      })
        .then(_recap => {
          setRecapLoading(false);
          // Phase AQ — synthesize Sonnet round-memory note + check if
          // periodic pattern pass is due. Fire-and-forget; results land
          // in roundStore.recentInsights / playerProfileStore.persistentPatterns
          // and get injected into future Kevin system prompts.
          void (async () => {
            try {
              const ctx = await import('../../services/contextSynthesizer');
              const lastRound = useRoundStore.getState().roundHistory[useRoundStore.getState().roundHistory.length - 1];
              if (lastRound) {
                await ctx.synthesizeRoundInsight(lastRound, patternInsights.insights ?? []);
              }
              await ctx.maybeSynthesizePatterns();
            } catch (e) { console.log('[round-end] context synth error', e); }
          })();
          // 2026-06-21 — Navigation removed from here. Callers push to
          // /recap/[roundId] themselves; the deferred router.replace was
          // yanking the user off the recap screen ~5-10s after arrival.
        })
        .catch(() => {
          setRecapLoading(false);
          setCaddieResponse("Round saved. Your recap will be ready next time you open the app — something went sideways on my end.");
          // Navigation left to the caller — no router.replace here.
        });
    }
  };

  // ── Start round ──────────────────────────
  /**
   * Pre-beta — single round-launch entry point. Takes a picked course and
   * options explicitly so it can be called from EITHER the round-setup
   * modal (handleStartRound) OR the Play tab Start-Round flow via the
   * pendingStartCourseId effect (no modal — direct launch). This kills
   * the "Start Round loop" where the modal kept reappearing after the
   * Play tab handed off control.
   */
  const runStartRound = useCallback(async (
    picked: PickedCourse,
    opts: {
      nineHole: boolean;
      isCompetition: boolean;
      notes: string;
      mode: RoundMode;
      ghostRoundId: string | null;
      mentalState?: string;
    },
  ): Promise<void> => {
    if (!canAccess('round_start', subscription_status)) {
      setShowRoundSetup(false);
      void triggerPaywall('round_start', () => router.push('/paywall' as never));
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // FIX B5 — snapshot selectedTee and transportMode from store at call time so
    // the values reflect the user's current selection rather than ambient state
    // that may change between the time the opts were built and startRound fires.
    const storeSnap = useRoundStore.getState();
    const selectedTeeSnapshot = storeSnap.selectedTee ?? 'unspecified';
    const transportModeSnapshot = storeSnap.transportMode ?? 'walking';

    let courseName = picked.name ?? 'Unknown Course';
    // 2026-05-31 — Fix FZ: NO MORE PALMS FALLBACK.
    // Prior code (this line + line below where holes.length===0 also
    // re-substituted palms) caused EVERY round at any non-Palms course
    // where bundled hole data wasn't found OR the golfcourseapi fetch
    // failed to start with Palms's California lat/lng baked in as
    // course geometry. offCourseDetector then measured the player's
    // real location against Palms (Menifee CA) and got thousands of
    // miles → flipped off-course in 20s and stayed there. Same
    // wrong-coords poisoned yardages, hole detection, and every
    // downstream geo check.
    //
    // Right fallback: empty holes. Downstream is already wired to
    // handle this honestly:
    //   - offCourseDetector exits early when no usable geometry
    //   - smartFinderService falls back to scorecard yardages
    //   - SmartVision's pixel-interpolation path uses bundled distance
    //   - UI cells render "—" instead of misleading numbers
    // Honest "unknown" beats wrong-course substituted as truth.
    let holes: import('../../store/roundStore').CourseHole[] = [];
    let courseId: string | null = null;
    let courseLocation: ShotLocation | null = null;

    if (picked.isLocal) {
      const localId = picked.id.replace('local:', '');
      const local = getCourse(localId);
      courseName = local?.name ?? picked.name;
      // 2026-07-01 (Tim) — fall back to getBundledHoles, which also resolves `custom:` scorecard
      // courses (customCourseStore). No-op for local courses that getCourse already populated.
      holes = local?.holes ?? getBundledHoles(picked.id);

      // 2026-06-21 — API fallback for local-image courses without a data/courses.ts entry.
      // Greenhill (and future local: courses) have bundled images + centroid but no hardcoded
      // hole data. Search the golf course API by name and pull par/yardage so Kevin, SmartFinder,
      // and the scorecard all have real numbers. Fire before startRound() so holes is populated.
      if (holes.length === 0) {
        try {
          const results = await searchCourses(courseName);
          const match = results.find(r => !r._error && r.id);
          if (match?.id) {
            const apiCourse = await getApiCourse(match.id);
            if (apiCourse && apiCourse.tees.length > 0) {
              holes = courseToHoles(apiCourse);
              courseName = apiCourse.club_name;
              console.log('[startRound] local API fallback: got', holes.length, 'holes for', courseName, 'via id', match.id);
            }
          }
        } catch {
          // Non-fatal — proceed with empty holes, geometry fetch covers GPS coords below
        }
      }

      // 2026-05-19 — pass the full picked.id (e.g. 'local:sunnyvale') as
      // courseId for local courses. Previously left null, which silently
      // broke fetchCourseGeometry (never fired), the SmartVision image
      // cascade (fell through to homeCourse → Palms images on Sunnyvale),
      // hole-detection course matching, voice-intent course context, and
      // the smartFinder geometry-cache fallback. Local courses route
      // through 'local:slug' downstream — courseGeometryService strips the
      // prefix and resolves to the upstream golfcourseapi id.
      courseId = picked.id;
    } else {
      courseId = picked.id;
      courseName = picked.name;
      try {
        const apiCourse = await getApiCourse(courseId);
        if (apiCourse && apiCourse.tees.length > 0) {
          holes = courseToHoles(apiCourse);
          courseName = apiCourse.club_name;
          if (
            typeof apiCourse.location?.latitude === 'number' &&
            typeof apiCourse.location?.longitude === 'number' &&
            Number.isFinite(apiCourse.location.latitude) &&
            Number.isFinite(apiCourse.location.longitude) &&
            Math.abs(apiCourse.location.latitude) <= 90 &&
            Math.abs(apiCourse.location.longitude) <= 180 &&
            !(Math.abs(apiCourse.location.latitude) < 0.001 && Math.abs(apiCourse.location.longitude) < 0.001)
          ) {
            courseLocation = {
              lat: apiCourse.location.latitude,
              lng: apiCourse.location.longitude,
            };
          }
        }
      } catch {
        setCaddieResponse("Couldn't load the course layout — starting with yardages only. You can still play.");
      }
    }

    // 2026-05-31 — Fix FZ: killed the `holes = palms` fallback.
    // When holes is empty here, the right answer is to START with
    // empty + kick off fetchCourseGeometry in the background so it
    // populates from golfcourseapi → OSM → Mapbox cache. Empty
    // courseHoles is HONEST — every downstream surface degrades
    // gracefully (offCourseDetector exits early, smartFinder uses
    // scorecard yardages, UI shows "—"). What we never do again is
    // pretend a non-Palms course IS Palms.
    if (holes.length === 0) {
      console.log('[startRound] no holes loaded for', courseName, '— starting empty; geometry fetch will populate async');
      // Fire-and-forget geometry fetch. When it lands, it caches into
      // courseGeometryService for subsequent reads; users in active
      // rounds can re-enter via the geometry-aware paths (SmartVision,
      // smartFinder) and pick up the cached data on the next call.
      if (courseId) {
        void (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const geomMod = require('../../services/courseGeometryService') as typeof import('../../services/courseGeometryService');
            await geomMod.fetchCourseGeometry(courseId, { courseLocation });
            console.log('[startRound] async geometry fetch landed for', courseId);
          } catch (e) {
            console.log('[startRound] async geometry fetch failed (non-fatal):', e);
          }
        })();
      }
    }

    startRound(courseName, holes, {
      nineHole: opts.nineHole,
      isCompetition: opts.isCompetition,
      notes: opts.notes,
      goal: null,
      courseId,
      courseLocation,
      mode: opts.mode,
      // FIX B5 — pass snapshotted tee/transport so startRound never falls back to ambient store.
      selectedTee: selectedTeeSnapshot,
      transportMode: transportModeSnapshot,
    });
    // FIX B1 — apply mentalState from pendingStartFactors so the player's
    // pre-round mental check-in survives into Kevin's first-hole context.
    if (opts.mentalState) {
      useRoundStore.getState().setMentalState(opts.mentalState);
    }

    // 2026-07-15 (Tim — "look up the public data for the scorecards, cheat the paid DB"):
    // anchor the auto-looked-up PUBLIC SCORECARD (par + yardage per hole, from the Golf Course
    // API above) into the offline CNS course book so the range book is complete without a
    // network round-trip and the brain can cite real per-hole numbers. Best-effort, additive
    // (saveCourseBook plausibility-gates + merges — never wipes existing tips/about/geometry).
    if (courseId && holes.length > 0) {
      try {
        const scorecardHoles = holes
          .filter(h => typeof h.hole === 'number')
          .map(h => ({ hole: h.hole, par: h.par ?? null, yardage: h.distance ?? null }));
        useCaddieMemoryStore.getState().saveCourseBook({
          course_id: courseId,
          name: courseName,
          holes: scorecardHoles,
          nowMs: Date.now(),
        });
      } catch (e) {
        console.log('[startRound] scorecard→CNS anchor failed (non-fatal):', e);
      }
    }

    if (courseId) {
      fetchCourseGeometry(courseId, { courseLocation }).catch(err => console.log('[caddie] geometry warm failed:', err));
    }

    // 2026-05-21 — Fix N: the pre-warm GPS block that used to live
    // here (requestForegroundPermissionsAsync + startGpsManager +
    // refreshFix + forceMarkPosition) is now handled inside
    // store/roundStore.ts startRound's orchestration block. Two
    // concurrent startGpsManager calls ~30ms apart raced the
    // foreground-service registration check, which was a contributing
    // factor to the Start Round crash on Samsung One UI. Now there's
    // ONE call site (the orchestration in roundStore.startRound).
    // The refreshFix + forceMarkPosition initial-fix sync still
    // matters for SmartFinder / DataStrip hole-1 yardages, so we
    // schedule them lazily after the GPS subscription is in place.
    void (async () => {
      try {
        // Brief wait so roundStore's GPS orchestration has a chance
        // to land the subscription before we ask for a fresh fix.
        // Empirically gpsManager.startGpsManager completes in well
        // under 500ms; 800ms is safe headroom.
        await new Promise(r => setTimeout(r, 800));
        const sf = await import('../../services/smartFinderService');
        await sf.refreshFix();
        const bus = await import('../../services/positionMarkBus');
        await bus.forceMarkPosition().catch(() => {});
      } catch (e) {
        console.log('[caddie] initial-fix sync failed (non-fatal):', e);
      }
    })();

    // 2026-05-22 — Ghost Rounds as first-class.
    // Priority order:
    //   1. Explicit picker selection wins (opts.ghostRoundId).
    //   2. Auto-activate the most-recent prior round on the SAME course
    //      when settings.ghostAutoActivate is true (default).
    //   3. Otherwise clear any stale ghost.
    // Golf-aware: only matches when courseId is set AND equal. Defensive:
    // skips rounds with totalScore <= 0 or holesPlayed < 1 (incomplete /
    // discarded). Picks the latest by endedAt so the most-recent visit
    // anchors the comparison.
    if (opts.ghostRoundId) {
      const ghostRecord = roundHistory.find(r => r.id === opts.ghostRoundId);
      if (ghostRecord) {
        const label = `${ghostRecord.courseName ?? 'Past round'} (${ghostRecord.totalScore})`;
        setActiveGhost({ source_round_id: opts.ghostRoundId, label });
        useGhostStore.getState().activateGhost(ghostRecord);
        console.log(`[ghost] auto-activated picker: ${label}`);
      }
    } else if (useSettingsStore.getState().ghostAutoActivate && courseId) {
      const priorOnCourse = roundHistory
        .filter(r => r.courseId === courseId && r.totalScore > 0 && r.holesPlayed >= 1)
        .sort((a, b) => b.endedAt - a.endedAt);
      const auto = priorOnCourse[0];
      if (auto) {
        const label = `${auto.courseName ?? 'Past round'} (${auto.totalScore})`;
        setActiveGhost({ source_round_id: auto.id, label });
        useGhostStore.getState().activateGhost(auto);
        console.log(`[ghost] auto-activated: ${label} (course=${courseId} prior=${priorOnCourse.length})`);
      } else {
        clearActiveGhost();
        useGhostStore.getState().deactivateGhost();
        console.log(`[ghost] no prior round on course ${courseId} — no ghost`);
      }
    } else {
      clearActiveGhost();
      useGhostStore.getState().deactivateGhost();
    }

    incrementRounds();
    resetProactiveState();
    // Phase V.7+ — the briefing OR the skip-briefings inline message always
    // covers the round-1 intro. Mark round_start_handoff as already-fired
    // so the focus-effect proactive trigger doesn't speak a second redundant
    // intro ("Alright Tim. Course is yours. Let's go.") right on top of it.
    // Fixes the double-speak glitch on round start.
    markProactiveFired('round_start_handoff');
    setShowRoundSetup(false);
    setSelectedGhostId(null);

    if (skip_briefings) {
      const hole1 = useRoundStore.getState().courseHoles.find(h => h.hole === 1);
      if (hole1) {
        const msg = 'Hole 1. Par ' + hole1.par + '. ' + hole1.distance + ' yards. Let\'s go.';
        setCaddieResponse(msg);
        // Phase V.7+ — Quiet (L1) is text-only. Voice only fires at L2+.
        // Closes the leak where skip-briefings spoke "Hole 1, Par X" even
        // when the user had set Quiet Mode.
        if (voiceEnabled && trustLevel !== 1) {
          speak(msg, voiceGender, language, apiUrl).catch(() => {});
        }
      }
      return;
    }

    router.push('/round/briefing' as never);
  }, [
    subscription_status, router, startRound, roundHistory, setActiveGhost,
    clearActiveGhost, incrementRounds, skip_briefings, voiceEnabled, voiceGender,
    language, apiUrl, trustLevel,
  ]);

  // Wire the latest runStartRound into the forward-referenced ref. Done
  // inline during render (NOT in a useEffect) so the ref is populated
  // before the pendingStartCourseId / pre_course_id effects run on the
  // first mount. Previously this lived in a useEffect, which created a
  // race: the local-course async branch had no awaits before reading
  // the ref, so it observed null and silently dropped the round-start.
  // API courses worked because their getApiCourse await yielded the
  // microtask queue, letting the ref-wiring effect run first.
  runStartRoundRef.current = runStartRound;

  // Modal "Start Round" button — collects modal state and delegates.
  const handleStartRound = async () => {
    if (!selectedPickedCourse) return;
    await runStartRound(selectedPickedCourse, {
      nineHole, isCompetition, notes: roundNotes,
      mode: selectedMode, ghostRoundId: selectedGhostId,
    });
  };

  // ── Log hole score ───────────────────────
  // Fix T (2026-05-23) — score logging no longer advances the hole.
  // After two real rounds of GPS+score auto-advance racing ahead of the
  // player (1→3→4), hole state is now strictly player-driven: this
  // handler ONLY logs the score and resets local inputs. To advance,
  // the player taps the cockpit/data-strip arrow or says "next hole" /
  // "I'm on hole 4". The end-of-round detection still fires here
  // because logging a final-hole score IS the player's explicit signal
  // that the round is done.
  const handleLogHole = async () => {
    if (holeScore === 0) return;
    // Snapshot BEFORE logScore overwrites scores[currentHole] so editing an
    // already-scored hole doesn't double-count the mental-state coach.
    // Mirrors the once-per-hole guard at the voice score-log sites.
    const alreadyScored = (useRoundStore.getState().scores[currentHole] ?? 0) > 0;
    logScore(currentHole, holeScore);
    logPutts(currentHole, holePutts);
    useGhostStore.getState().updateHole(currentHole, holeScore);

    const par = getCurrentPar();
    // 2026-06-04 — Bundled-aware end-of-round detection so 9-hole
    // executive courses (Echo Hills, Mariners Point) end at 9, not 18.
    const maxHole = nineHoleMode ? 9 : getCourseHoleCount(useRoundStore.getState().activeCourseId, courseHoles.length);

    if (!alreadyScored) useRelationshipStore.getState().updateMentalState(holeScore, par ?? 4);

    if (currentHole >= maxHole) {
      clearShotPending();
      // Snapshot the score state BEFORE endRound() resets it. The summary
      // copy ("Short round" / "Even par" / etc.) is driven by these values;
      // reading them after the reset always yields zero/null/[].
      // 2026-06-21 — also capture scores/courseHoles/activeCourse so
      // buildContextualSummary has the pre-reset data for best/worst hole.
      const preRound = useRoundStore.getState();
      const snapshot = {
        total: getTotalScore(),
        vspar: getScoreVsPar(),
        played: getHolesPlayed(),
        scores: { ...preRound.scores },
        courseHoles: [...preRound.courseHoles],
        activeCourse: preRound.activeCourse,
      };
      // 2026-06-21 — Capture roundId and navigate to recap (HIGH-9 audit fix).
      // FIX M15 — route through feelings screen first so player can log
      // post-round energy/focus/vibe before the recap renders.
      const roundId = endRound();
      setShowShotCard(false);
      await generateRoundSummary(snapshot, roundId ?? undefined);
      if (roundId) router.push(`/recap/feelings?roundId=${roundId}` as never);
      return;
    }

    setHoleScore(0);
    setHolePutts(0);
    clearShotPending();
    setShowShotCard(false);

    // Post-log commentary is about the JUST-logged hole only. The
    // next-hole intro now fires from Fix S when the player actually
    // advances via cockpit/data-strip/voice — not here.
    const holePar = par ?? 4;
    const diff = holeScore - holePar;
    const scoreVsParSoFar = getScoreVsPar();

    let scoreWord = '';
    if (diff <= -2)       scoreWord = 'Eagle.';
    else if (diff === -1) scoreWord = 'Birdie.';
    else if (diff === 0)  scoreWord = 'Par.';
    else if (diff === 1)  scoreWord = 'Bogey.';
    else if (diff === 2)  scoreWord = 'Double.';
    else                   scoreWord = 'Leave it there.';

    let contextLine = '';
    if (diff <= -1) {
      contextLine = diff === -1 ? ' Keep that going.' : " That's yours.";
    } else if (diff >= 2 && isSpiralRisk()) {
      contextLine = ' Reset and stay on it.';
    } else if (diff === 1) {
      contextLine = ' Move on.';
    }

    let scoreContext = '';
    if (scoreVsParSoFar <= -3) {
      scoreContext =
        " You're " + Math.abs(scoreVsParSoFar) + ' under through ' + currentHole + '.';
    }

    const transition = scoreWord + contextLine + scoreContext;
    setCaddieResponse(transition);

    if (voiceEnabled) {
      speak(transition, voiceGender, language, apiUrl).catch(() => {});
    }
  };

  // ── Mid-round mode change ────────────────
  const _handleChangeModePress = () => {
    const options: RoundMode[] = ['break_100', 'break_90', 'break_80', 'free_play'];
    Alert.alert(
      'Change Mode',
      "Kevin's recommendations will adjust.",
      [
        ...options
          .filter(m => m !== mode)
          .map(m => ({
            text: ROUND_MODE_CARDS[m].title,
            onPress: () => setCurrentRoundMode(m),
          })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  // Local course list kept for pre-round brief fallback
  const _courses = getCourseList();

  // ── Strip / start-round data ─────────────
  // 2026-06-04 — nineHoleMode override stays (user-stated 9-hole play);
  // otherwise use the bundled-aware count so Echo Hills + Mariners Point
  // don't default to 18 when their bundled scorecard says 9.
  const totalHoles = nineHoleMode ? 9 : getCourseHoleCount(useRoundStore.getState().activeCourseId, courseHoles.length);
  // targetDirection: there is no aim engine computing a real LEFT/CENTER/RIGHT
  // target yet, so show "—" rather than a hardcoded "CENTER" that reads like a
  // live value. Wire to a real aim recommendation before showing a direction.
  // (2026-06-09 honesty fix — was a frozen 'CENTER' placeholder.)
  const targetDirection = '—';

  const currentStroke = useMemo(() => {
    // 2026-05-19 — STROKE = "the next stroke you're about to hit",
    // = shots_taken + penalties + 1. Previously this returned
    // `holeShots.length + penalties` (just the count of shots taken),
    // which meant the strip showed STROKE=1 both before AND after the
    // first shot — never ticked during the hole. Tim hit this on the
    // harness: tee shot logged at mid-fairway but the strip stayed
    // at 1 the whole way. The +1 makes the strip read like a real
    // stroke counter (1 before hitting tee, 2 after, etc.).
    const holeShots = shots.filter(s => s.hole === currentHole);
    if (holeShots.length > 0) {
      return holeShots.length + 1 + holeShots.reduce((acc, s) => acc + (s.penalty_strokes ?? 0), 0);
    }
    return 1; // no shots yet — first stroke upcoming
  }, [shots, currentHole]);

  // ── Cross-transition: strip ↔ start-round CTA ───
  const stripOpacity = useRef(new Animated.Value(isRoundActive ? 1 : 0)).current;
  const ctaOpacity   = useRef(new Animated.Value(isRoundActive ? 0 : 1)).current;

  useEffect(() => {
    if (isRoundActive) {
      // Round started: fade out CTA → 80ms gap → fade in strip
      Animated.sequence([
        Animated.timing(ctaOpacity,   { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.delay(80),
        Animated.timing(stripOpacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    } else {
      // Round ended: fade out strip → 80ms gap → fade in CTA
      Animated.sequence([
        Animated.timing(stripOpacity, { toValue: 0, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.delay(80),
        Animated.timing(ctaOpacity,   { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRoundActive]);

  // ── RENDER ───────────────────────────────

  // Phase Cockpit — opt-in alternate Caddie tab layout. Voice plumbing
  // (useVoiceCaddie, useKevin, audio session, recording) initializes
  // above this point — voiceState / caddieResponse / handleMicPress are
  // stable. Passing them as props to CockpitCaddieScreen means the
  // recording session is shared with Full Mode and flipping the toggle
  // does NOT interrupt an in-flight reply. Default OFF; user opts in
  // via Settings → "Cockpit Mode".
  if (cockpitMode) {
    return (
      <CockpitCaddieScreen
        voiceState={voiceState}
        caddieResponse={caddieResponse}
        onMicPress={handleMicPress}
        // 2026-06-23 — pass the SAME paywall-gated openers the standard
        // layout uses so cockpit's Vision pill + DistanceCard tap-through
        // can't bypass the canAccess/triggerPaywall gate.
        onOpenSmartVision={openSmartVision}
        onOpenSmartFinder={() => {
          if (!canAccess('smartfinder', subscription_status)) {
            void triggerPaywall('smartfinder', () => router.push('/paywall' as never));
            return;
          }
          router.push('/smartfinder' as never);
        }}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>

      {/* 2026-06-10 — Smart Finder floating shortcut. The rangefinder reticle
          used to live on every surface but only survived on the Play tab. This
          main return is L2/L3 ONLY (L1 returns the cockpit screen above, which
          has its own yardage-card → SmartFinder path), so the shortcut shows on
          L2/L3 — and intentionally even with no active round, so it's testable
          any time (e.g. putting distance). Right side, floating, above the
          bottom controls. */}
      <TouchableOpacity
        style={{
          position: 'absolute', right: 14, bottom: insets.bottom + 168, zIndex: 20,
          width: 46, height: 46, borderRadius: 12, borderWidth: 1.5,
          borderColor: '#00C896', backgroundColor: 'rgba(6,15,9,0.7)',
          alignItems: 'center', justifyContent: 'center',
        }}
        onPress={() => {
          if (!canAccess('smartfinder', subscription_status)) {
            void triggerPaywall('smartfinder', () => router.push('/paywall' as never));
            return;
          }
          router.push('/smartfinder' as never);
        }}
        accessibilityRole="button"
        accessibilityLabel="Open Smart Finder rangefinder"
      >
        <AppIcon name="locate-outline" size={22} color="#00C896" />
      </TouchableOpacity>

      {/* KEVIN — Phase E Trust Spectrum gating.
           L2 path is byte-identical to the locked elite Kevin layout (the
           original 9:16 frame anchored at top with no over-zoom). L3 and L4
           render the same CaddieAvatar with position/size adjustments. L1
           skips the avatar entirely; the L1 mic-button overlay below
           takes its place. */}
      {trustLevel === 2 && (() => {
        // L2 Companion split. Fold-open (wide) → side-by-side. Fold-closed
        // (narrow) → stacked vertically, both full width. Wind arrow allowed
        // to overlay freely; its zIndex (11) sits above these cells (6).
        // Threshold 540 catches Fold-open (~673px) reliably while keeping
        // typical phone widths (~390-430px) in the stacked layout.
        const isWide = W >= 540;
        const cellTop = insets.top + 100;
        // Phase AU — embedded SmartFinder card removed. Cells need to clear the
        // green-arrow dropdown row (bottom 92 + ib, height 52).
        // 2026-06-13 (Tim) — they ALSO must clear the greeting/response BUBBLE so the
        // SmartVision preview and the text never overlap. The bubble sits at
        // bottom (isRoundActive ? 168 : 108) + ib and is up to 3 lines (~104px) tall;
        // end the cells above it (never tighter than the prior 150 dropdown clearance).
        const bubbleClearance = (isRoundActive ? 168 : 108) + insets.bottom + 104;
        const cellMaxBottom = H - Math.max(150 + insets.bottom, bubbleClearance);
        if (isWide) {
          const cellW = (W - 36) / 2;
          const cellH = Math.min(360, cellMaxBottom - cellTop);
          return (
            <>
              <View
                style={{
                  position: 'absolute', top: cellTop, left: 12,
                  width: cellW, height: cellH,
                  borderRadius: 14, borderWidth: 1.5, borderColor: '#1e3a28',
                  overflow: 'hidden', backgroundColor: '#060f09', zIndex: 6,
                }}
              >
                <CaddieAvatar
                  key={`${W}x${H}-${insets.top}`}
                  gender={voiceGender === 'female' ? 'female' : 'male'}
                  persona={caddiePersonality}
                  isOnCourse={isRoundActive}
                  isCageMode={false}
                  voiceState={voiceState}
                  hud={NULL_HUD}
                  openingPrompt=""
                  caddieResponse=""
                  onTap={handleMicPress}
                  emotion={kevinEmotion}
                  fillMode="cover"
                  isThinking={kevinThinking}
                  trustLevel={trustLevel}
                  customPortraitB64={activeCustomPortrait}
                />
              </View>
              <View
                style={{ position: 'absolute', top: cellTop, right: 12, zIndex: 6 }}
                pointerEvents="box-none"
              >
                <L1HolePreview onOpenSmartVision={openSmartVision} width={cellW} height={cellH} />
              </View>
            </>
          );
        }
        // Stacked layout for narrow / Fold-closed. Two cells stacked
        // with a 10px gap; each cell capped so the bottom of the
        // bottom cell stays clear of the SmartFinder card.
        const cellW = W - 24;
        const gap = 10;
        const cellH = Math.min(220, Math.floor((cellMaxBottom - cellTop - gap) / 2));
        // 2026-06-13 (Tim) — when the cells are capped (slack below them), LOWER the
        // whole block so it fills the gap above Start Round instead of floating high.
        // Bottom-bias to ~8px above cellMaxBottom (already clears the bubble); never
        // higher than the original cellTop. Cells keep their size; only the block moves.
        const blockTop = Math.max(cellTop, cellMaxBottom - (cellH * 2 + gap) - 8);
        return (
          <>
            <View
              style={{
                position: 'absolute', top: blockTop, left: 12,
                width: cellW, height: cellH,
                borderRadius: 14, borderWidth: 1.5, borderColor: '#1e3a28',
                overflow: 'hidden', backgroundColor: '#060f09', zIndex: 6,
              }}
            >
              <CaddieAvatar
                key={`${W}x${H}-${insets.top}`}
                gender={voiceGender === 'female' ? 'female' : 'male'}
                persona={caddiePersonality}
                isOnCourse={isRoundActive}
                isCageMode={false}
                voiceState={voiceState}
                hud={NULL_HUD}
                openingPrompt=""
                caddieResponse=""
                onTap={handleMicPress}
                emotion={kevinEmotion}
                fillMode="cover"
                isThinking={kevinThinking}
                trustLevel={trustLevel}
                customPortraitB64={activeCustomPortrait}
              />
            </View>
            <View
              style={{ position: 'absolute', top: blockTop + cellH + gap, left: 12, zIndex: 6 }}
              pointerEvents="box-none"
            >
              <L1HolePreview onOpenSmartVision={openSmartVision} width={cellW} height={cellH} />
            </View>
          </>
        );
      })()}
      {trustLevel === 3 && (
        // L3 Active — Kevin takes 2/3 of screen height (80% of that on
        // Fold-open / wide screens, per Tim). Anchored from the bottom so
        // his lower edge sits just above the dropdown row.
        <>
          {/* L3 SmartVision INLAY — Tim: "in bottom left of Kevin box,
              overlayed, not so big horizontally". Compact tile anchored
              bottom-left of the Kevin avatar zone, zIndex above Kevin
              so it overlays.

              Phase BS-followup Issue 4 — shrunk 140×100 → 120×86 and
              dropped bottom 158 → 132 so the tile sits flush at the
              bottom-left corner of the avatar zone instead of floating
              8px inside it. Previously the tile was covering the
              SmartPlay shirt logo on Serena's chest. Smaller footprint
              + lower anchor preserves the L3 overlay design intent
              while clearing the wardrobe brand mark. */}
          <View
            style={{
              position: 'absolute',
              left: 12,
              bottom: 132 + insets.bottom,
              width: 120,
              height: 86,
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor: '#00C896',
              overflow: 'hidden',
              backgroundColor: '#0d2418',
              zIndex: 12,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.5,
              shadowRadius: 4,
              elevation: 8,
            }}
            pointerEvents="box-none"
          >
            <L1HolePreview onOpenSmartVision={openSmartVision} width={120} height={86} />
          </View>
          {/* L3 Kevin avatar — full L3 zone now that SmartVision is an
              overlay inlay (not a top card). Top clamp ensures Kevin
              starts at least below the topNav/banner row. */}
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 150 + insets.bottom,
              height: Math.min(
                Math.round(H * 2 / 3 * (W >= 540 ? 0.8 : 1)),
                H - (insets.top + 80) - (150 + insets.bottom),
              ),
            }}
          >
            <CaddieAvatar
              key={`${W}x${H}`}
              gender={voiceGender === 'female' ? 'female' : 'male'}
              persona={caddiePersonality}
              isOnCourse={isRoundActive}
              isCageMode={false}
              voiceState={voiceState}
              hud={NULL_HUD}
              openingPrompt=""
              caddieResponse=""
              onTap={handleMicPress}
              emotion={kevinEmotion}
              fillMode="cover"
              isThinking={kevinThinking}
              trustLevel={trustLevel}
              customPortraitB64={activeCustomPortrait}
            />
            {/* 2026-06-04 — Coach Mode badge overlay removed. The
                toggle now lives as a single entry in the central ⋯
                Tools menu (components/tools/GlobalToolsMenu.tsx). */}
          </View>
        </>
      )}
      {/* 2026-06-04 — L4 'Full' photoreal portrait + old L1 SmartFinder-
          hero layout both removed. Trust spectrum collapsed to {1,2,3};
          L1 is now Cockpit (rendered by the early-return at line ~1775
          via CockpitCaddieScreen), so anything-below-here only ever
          renders for L2 Companion / L3 Active. */}

      {/* TOP BRAND ROW — shared v3 BrandHeaderRow so the Caddie tab matches
           Dashboard / SwingLab / Play / Scorecard exactly. Absolute-positioned
           BELOW the topNav row (zIndex 18 < topNav 20) so the chevron-back
           and Tool ••• icons render on top of the brand row — Tim reported
           both icons disappeared visually when the brand row was at zIndex
           22. pointerEvents="none" still passes taps through. */}
      <View
        style={{
          position: 'absolute',
          top: insets.top,
          left: 0,
          right: 0,
          zIndex: 18,
        }}
        // 2026-05-25 — Fix AK: was pointerEvents="none" which made ALL
        // taps on the brand row (including the logo mic badge) pass
        // through to whatever was rendered below — Tim hit a scorecard
        // chip beneath and the badge tap routed there instead of
        // toggling listening. "box-none" lets children (CaddieMicBadge,
        // wordmark) receive their own taps while empty space still
        // falls through to the layers below.
        pointerEvents="box-none"
      >
        {/* 2026-05-25 — Fix AK follow-up: the Caddie tab has its OWN
            dedicated mic in the L4 actions row. Hide the brand badge's
            built-in mic chip on this tab so the user doesn't see two
            mic icons. Trust chip stays visible. */}
        <BrandHeaderRow hideToolsPill hideLogoMicIcon />
      </View>

      {/* TOP NAV — sits below the SmartPlay banner.
           Phase AD — right column now anchors Tool ••• at the TOP of the
           stack so the locked top-right semantic position is never obscured
           by the Free Play (mode) badge or ScorecardChip pills that stack
           BELOW it during an active round. Previously Tool was the last
           child and got pushed downward into the avatar/SmartVision area
           (cellTop = insets.top + 100), making the tap target overlap and
           the menu effectively unreachable at L2 mid-round.
           Parent alignItems flipped from 'center' to 'flex-start' so the
           three columns (back, placeholder, right) all align at the top
           edge of the bar — Tool stays pinned at insets.top+38, pills
           extend downward without crossing into the avatar zone. */}
      <View style={[styles.topNav, { top: insets.top + 38 }]}>
        {/* 2026-05-25 — Fix AK follow-up: the chevron-back is a
            shortcut to scorecard; its 12px top hitSlop was extending
            UP into the brand row above (insets.top to insets.top+38)
            and intercepting CaddieMicBadge taps — that's why tapping
            the logo went to scorecard. Zeroed the top hitSlop so the
            badge's own tap zone wins for any contact in the brand
            row area. */}
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => router.replace('/(tabs)/scorecard' as never)}
          hitSlop={{ top: 0, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color="#6b7d72" />
        </TouchableOpacity>

        {/* 2026-06-04 — Coach Mode wide pill removed from the brand row (now the C★
            badge on Kevin's avatar). 2026-07-04 (elite-clean audit) — collapsed the
            constant-false conditional that wrapped this placeholder. */}
        <View style={styles.modeBadgePlaceholder} />

        {/* 2026-06-13 (Tim) — drop the Tools pill + leaf into the gap BELOW the
            tagline ("real-time caddie intelligence") and ABOVE Kevin's box
            (cellTop = insets.top + 100). The accented pill was kissing the end of the
            tagline at the row's insets.top+38 anchor; +22 seats it cleanly in the gap. */}
        <View style={{ alignItems: 'flex-end', flexDirection: 'row', gap: 6, marginTop: 30 }}>
          {/* 2026-05-30 — Fix FY: Local Mode indicator. Subtle leaf
              next to the Tools pill when localMode is ON. Honest "you
              are here" — NOT a warning, NOT an error state. Tap routes
              to Settings so the user can toggle off without hunting. */}
          {localMode && (
            <TouchableOpacity
              onPress={() => router.push('/settings' as never)}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Local Mode is on. Tap to open Settings."
              style={[styles.navBtn, { paddingHorizontal: 4 }]}
            >
              <Ionicons name="leaf-outline" size={20} color="#00C896" />
            </TouchableOpacity>
          )}
          {/* Tool ••• — ALWAYS visible in upper right (Tim: "Make sure
              tools pill is ALWAYS in upper right"). At L4 the green-arrow
              dropdown also contains a Tools entry as a convenience, but
              this corner pill remains the canonical anchor. */}
          {/* 2026-06-13 (Tim) — single tools entry (crowded quick-tools FAB retired).
              Just the accented three-dot circle — no label needed, people know the
              dots; the accent ring keeps it from getting lost on small screens. */}
          <TouchableOpacity
            style={{
              width: 30, height: 30, borderRadius: 15,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1.5, borderColor: '#00C896',
              backgroundColor: 'rgba(0,200,150,0.12)',
            }}
            // 2026-05-15 — universal Tools menu. Opens the same
            // sectioned GlobalToolsMenu the ••• pill on every other tab uses.
            onPress={() => useToolsMenuStore.getState().open()}
            accessibilityRole="button"
            accessibilityLabel="Open the Tools menu"
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color="#00C896" />
          </TouchableOpacity>
          {/* Phase AT follow-up — FREE PLAY mode badge removed from main
              view per Tim "we can see that in upper right tools dropdown".
              Mode is still displayed (and editable) in the Tools dropdown
              status row. */}
        </View>
      </View>

      {/* 2026-05-16 — Permission banner (location ungranted) + Active
          Listening pill (mic hot). Both sit just below the topNav so the
          user always knows whether GPS is on AND whether the mic is hot.
          Banner only renders when foreground location is denied; pill
          only renders when VAD is actually live. */}
      <View style={{ position: 'absolute', top: insets.top + 78, left: 0, right: 0, zIndex: 18, gap: 6 }}
            pointerEvents="box-none">
        <PermissionBanner />
        <View style={{ alignItems: 'center' }}>
          <ActiveListeningPill />
        </View>
      </View>

      {/* Phase AL — Mark button. Yellow accent (capture/action treatment).
           Renders only during an active round per spec (round-gated also
           inside forceMarkPosition for safety). Single tap fires fresh
           GPS read, emits position-marked event to all GPS-dependent
           services, brief haptic + Alert feedback. Anchored top-right
           corner BELOW the topNav so it doesn't compete with the Tool
           ••• button, but is the most prominent action target on the
           screen. */}
      {/* Phase AU — standalone MARK button removed at all trust levels.
          MARK now lives exclusively inside the universal green-arrow
          dropdown (rendered later in this file). */}

      {/* Phase AE follow-up — ScorecardChip on the LEFT side.
           Phase AR follow-up — anchored at top: insets.top + 145 so it
           sits BELOW the L1 Kevin badge (top + 60 + ~64px badge ≈ +124)
           rather than colliding with it on the L1 surface. At L2/L3 the
           avatar cell starts at insets.top + 100 — chip overlays the
           avatar cell briefly but at zIndex 12 stays tappable. */}
      {/* Phase AU — standalone ScorecardChip removed at all trust
          levels. Score lives exclusively inside the universal
          green-arrow dropdown. */}

      {/* TRIAL INDICATOR — only in final 3 days to avoid persistent clutter.
          Hard-gated on SUBSCRIPTIONS_ENABLED so even if a stored profile
          still has subscription_status==='trial' (from a prior bundle),
          neither banner ever renders until billing infra is wired.
          Re-enable by flipping SUBSCRIPTIONS_ENABLED back to true. */}
      {SUBSCRIPTIONS_ENABLED && subscription_status === 'trial' && daysLeft !== null && daysLeft <= 3 && (
        <View style={[styles.trialBanner, { top: insets.top + 78 }]}>
          <Text style={styles.trialBannerText}>
            {daysLeft > 0
              ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left in trial`
              : 'Trial ends today'}
          </Text>
        </View>
      )}
      {SUBSCRIPTIONS_ENABLED && subscription_status === 'expired' && (
        <TouchableOpacity
          style={[styles.trialBanner, styles.trialBannerExpired, { top: insets.top + 78 }]}
          onPress={() => triggerPaywall('trial_expired_banner', () => router.push('/paywall' as never))}
        >
          <Text style={[styles.trialBannerText, styles.trialBannerExpiredText]}>
            Trial ended — Subscribe
          </Text>
        </TouchableOpacity>
      )}

      {/* (Pre-round brand wordmark removed — the always-visible top banner
           now serves as the single SmartPlay Caddie heading across all
           round states. Was duplicating the banner pre-round.) */}

      {/* "?" help button — visible at L2 and L3 only. L1 has no Kevin
          presence to ask about; L4 users are past discovery (Tutorials in
          Tools menu covers anyone who wants a refresher). */}
      {/* Phase AT — KevinHelpButton (?) removed from caddie home.
          Redundant with Tools menu → Tutorials, and was contributing to
          the right-side button noise per Tim's "too many buttons"
          feedback. Discoverability: Tutorials surfaces in the ••• Tool
          menu when needed. */}

      {/* Phase O — Tap to Talk fallback button hidden on Caddie home. Tapping
          Kevin's avatar (handleMicPress) already serves the same function;
          the floating chip duplicates that affordance. The component remains
          available for surfaces without an avatar tap target (Cage summary,
          Arena landing). */}

      {/* VOCAB BANNER — fires once after the user crosses the voice-shot threshold */}
      <View style={{ position: 'absolute', top: insets.top + 100, left: 0, right: 0, zIndex: 12 }} pointerEvents="box-none">
        <VocabBanner />
      </View>

      {/* WIND ARROW — Caddie-mode wind indicator, only during active rounds */}
      {/* Phase AU — WindArrow wrapped in a clean circular badge that
          overlays any card/Kevin/cell beneath it. zIndex 16 +
          pointerEvents 'none' so touches pass through.
          Top: insets.top + 200 sits below the SmartVision header +
          hole number graphic (Tim: "put windage circle below hole
          number that shows on SmartVision"). Pre-round renders a
          static N-pointing arrow placeholder so the circle's purpose
          is visible without weather data.

          Phase BS-followup Issue 3 — Fold-aware top. On Fold-open
          (W >= 540) the avatar lives in the side-by-side layout and
          the wind circle at top: 160 sits cleanly above her face.
          On Fold-closed, the avatar is full-bleed and 160 lands on
          her cheek/eye line. Bump to 240 on Fold-closed so the
          circle clears the eye-line of the canonical face framing. */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + (W >= 540 ? 160 : 240),
          right: 12,
          zIndex: 16,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: 'rgba(13, 28, 56, 0.85)',
          borderWidth: 1.5,
          borderColor: '#3b82f6',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#3b82f6',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.5,
          shadowRadius: 6,
          elevation: 6,
        }}
        pointerEvents="none"
      >
        {isRoundActive ? (
          <WindArrow weather={caddieWeather} shotBearingDeg={caddieShotBearing} compact />
        ) : (
          <Ionicons name="navigate" size={22} color="#3b82f6" />
        )}
      </View>

      {/* SMARTFINDER CARD — Phase D-2 embedded rangefinder. Hidden at
           L4 (Full — collapses to a right-side reticle). At L1 Quiet
           the card renders both pre-round and in-round so the player
           keeps hole / yardage context without Kevin's face on screen. */}
      {/* Phase AU — embedded SmartFinder card removed at all trust
          levels. SmartFinder is now accessed via the SmartFinder icon
          inside the universal green-arrow dropdown (which routes to
          the full /smartfinder screen). Frees the bottom-third of the
          Caddie home so SmartVision can stretch down to the dropdown
          row, eliminating the previous L1/L2/L3 card overlap class. */}

      {/* LIE ANALYSIS camera icon — placement varies by Trust Spectrum level.
           Spec (Phase H v2):
             L1 — paired with the SmartVision card at the top.
             L2 — adjacent to the ? help button on the right side.
             L3 — visible near Kevin / SmartFinder area.
             L4 — smaller, LEFT of the yellow SmartFinder reticle (which sits
                  at right: 12, bottom: 200 + insets.bottom). Voice is primary.
           Banner / Kevin avatar / yellow SmartFinder tappable / wind label /
           BREAK 90 badge / detail bar all unchanged across these moves. */}
      {/* Phase AT — at L4, the camera + Mark + Tool live in a horizontal
          action row across the bottom (rendered separately below) so the
          per-button scattered placements are skipped here. */}
      {/* Phase AU — standalone TightLie camera button removed at all
          trust levels. TightLie now lives exclusively inside the
          universal green-arrow dropdown. */}

      {/* Phase AT follow-up — L4 standalone SmartVision telescope removed.
          SmartVision now lives inside the green-arrow dropdown row. */}

      {/* Phase AU — universal green dropdown across L1/L2/L3/L4.
          Default = just a chevron pill on the right; tap to expand
          LEFT into the row of contextual round icons (Scorecard /
          SmartVision / SmartFinder / MARK / TightLie / Tools).
          Position bottom: (W >= 540 ? 110 : 92) + insets.bottom keeps it
          above DataStrip; the Fold-open bump is detailed in the BS-followup
          paragraph below.

          Phase BS-followup Issue 5 — on Fold-open / wide screens
          (W >= 540), the SmartVision card on the right side of the
          split layout extends low enough that the chevron's default
          position visually butts up against the card's bottom edge.
          Add 18px clearance on Fold-open so the chevron sits cleanly
          below the card. Fold-closed keeps the original 92 since the
          single-column layout doesn't have this collision. */}
      {isRoundActive && (
        <View
          style={{
            position: 'absolute',
            bottom: (W >= 540 ? 110 : 92) + insets.bottom,
            left: 12, right: 12,
            zIndex: 15,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
          }}
          pointerEvents="box-none"
        >
          {l4ActionsExpanded && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ alignItems: 'center', gap: 10, paddingRight: 4 }}
              style={{ flexGrow: 0, flexShrink: 1 }}
            >
              {/* Caddie mic — actual mic button (not a shortcut). Tapping
                  toggles listen/stop directly via handleMicPress. Icon
                  reflects voiceState: mic (idle) / stop (listening) /
                  ellipsis (thinking) / volume-high (speaking). Dropdown
                  stays open while voice is active so the user sees the
                  state change. */}
              <TouchableOpacity
                onPress={() => handleMicPress()}
                style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: voiceState === 'listening' ? '#00C896' : 'rgba(13, 36, 24, 0.92)',
                  borderWidth: 1.5,
                  borderColor: voiceState === 'thinking' || kevinThinking ? '#F5A623' : '#00C896',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: voiceState === 'thinking' || kevinThinking ? '#F5A623' : '#00C896',
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.6, shadowRadius: 8, elevation: 6,
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  voiceState === 'listening' ? 'Stop listening' :
                  voiceState === 'thinking' ? 'Kevin is thinking' :
                  voiceState === 'speaking' ? 'Kevin is speaking' :
                  'Talk to Kevin'
                }
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={
                    voiceState === 'listening' ? 'stop' :
                    voiceState === 'thinking' || kevinThinking ? 'ellipsis-horizontal' :
                    voiceState === 'speaking' ? 'volume-high' :
                    'mic'
                  }
                  size={22}
                  color={voiceState === 'listening' ? '#04140c' : '#00C896'}
                />
              </TouchableOpacity>

              {/* Scorecard pill — same compact circle used elsewhere. */}
              <View pointerEvents="box-none" style={{ alignItems: 'center', justifyContent: 'center' }}>
                <ScorecardChip />
              </View>

              {/* SmartVision telescope */}
              <TouchableOpacity
                onPress={() => {
                  setL4ActionsExpanded(false);
                  openSmartVision();
                }}
                style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: 'rgba(13, 36, 24, 0.92)',
                  borderWidth: 1.5, borderColor: '#00C896',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#00C896', shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.55, shadowRadius: 8, elevation: 6,
                }}
                accessibilityRole="button"
                accessibilityLabel="Open SmartVision"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="telescope-outline" size={22} color="#00C896" />
              </TouchableOpacity>

              {/* SmartFinder rangefinder reticle.
                  2026-07-04 (elite-clean audit, menu finding #13) — this was the ONE
                  SmartFinder entry with no paywall gate (the other four gate). Inert
                  while SUBSCRIPTIONS_ENABLED=false, but a real bypass the day billing
                  turns on. Gate it like its siblings. */}
              <TouchableOpacity
                onPress={() => {
                  setL4ActionsExpanded(false);
                  if (!canAccess('smartfinder', subscription_status)) {
                    void triggerPaywall('smartfinder', () => router.push('/paywall' as never));
                    return;
                  }
                  router.push('/smartfinder' as never);
                }}
                style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: 'rgba(13, 36, 24, 0.92)',
                  borderWidth: 1.5, borderColor: '#00C896',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#00C896', shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.55, shadowRadius: 8, elevation: 6,
                }}
                accessibilityRole="button"
                accessibilityLabel="Open SmartFinder"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <View style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: '#00C896' }} />
                  <View style={{ position: 'absolute', width: 16, height: 1.5, backgroundColor: '#ffffff' }} />
                  <View style={{ position: 'absolute', width: 1.5, height: 16, backgroundColor: '#ffffff' }} />
                </View>
              </TouchableOpacity>

              {/* MARK — Phase BH: on hole 1 the first Mark also runs a full
                  GPS recalibrate so the round starts on a fresh, high-accuracy
                  fix. Course-loaded yardages depend on this first fix being
                  trustworthy; without recalibrate, a stale tower-triangulation
                  fix can push hole-1 yardages off by 30-60 yards. */}
              <TouchableOpacity
                onPress={async () => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  setL4ActionsExpanded(false);
                  if (currentHole === 1) {
                    try {
                      const gps = await import('../../services/gpsManager');
                      setCaddieResponse('Recalibrating GPS…');
                      await gps.recalibrateGps();
                    } catch (e) { console.log('[mark:hole1] recalibrate failed', e); }
                  }
                  const mod = await import('../../services/positionMarkBus');
                  const r = await mod.forceMarkPosition();
                  if (r.kind === 'ok') {
                    const acc = r.mark.accuracy_m != null ? `~${Math.round(r.mark.accuracy_m)}m` : '';
                    setCaddieResponse(`Marked${acc ? ' (accuracy ' + acc + ')' : ''}.`);
                  } else if (r.kind === 'no_round') setCaddieResponse('Start a round first.');
                  else if (r.kind === 'no_permission') setCaddieResponse('Location permission needed to mark.');
                  else setCaddieResponse("Couldn't mark — GPS not ready.");
                }}
                style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: '#F5A623',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#F5A623', shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.6, shadowRadius: 8, elevation: 6,
                }}
                accessibilityRole="button"
                accessibilityLabel="Mark position"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="location" size={20} color="#1a1a1a" />
              </TouchableOpacity>

              {/* TightLie camera */}
              <TouchableOpacity
                onPress={() => {
                  setL4ActionsExpanded(false);
                  router.push('/lie-analysis' as never);
                }}
                style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: 'rgba(13, 36, 24, 0.92)',
                  borderWidth: 1.5, borderColor: '#00C896',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#00C896', shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.55, shadowRadius: 8, elevation: 6,
                }}
                accessibilityRole="button"
                accessibilityLabel="Open TightLie"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="camera" size={22} color="#00C896" />
              </TouchableOpacity>

              {/* 2026-06-04 — Coach Mode L4 toggle removed. Lives in
                  the central ⋯ Tools menu instead (single source). */}

              {/* Phase AU — Tools (•••) removed from inside the dropdown.
                  The upper-right corner pill is the canonical Tools
                  anchor; duplicating it here was the "duplicated tools
                  pill shortcut" Tim flagged. */}
            </ScrollView>
          )}

          {/* 2026-05-26 — Trust-level cycle pill, gated on
              l4ActionsExpanded so it ONLY appears when the chevron is
              open (no extra screen noise when collapsed — that was
              Tim's explicit ask). Lives OUTSIDE the ScrollView so it
              stays visible without horizontal scrolling — the prior
              "last item in ScrollView" placement put it off-screen
              right whenever the row overflowed the viewport (6+ tools
              on a 400px screen), which is exactly why Tim couldn't see
              it after the earlier OTA. Same cycle order + haptic +
              toast as the More entry (caddie.tsx:3280). */}
          {l4ActionsExpanded && (
            <TouchableOpacity
              onPress={() => {
                const cur  = TRUST_LEVEL_SLIDER_ORDER.indexOf(trustLevel);
                const next = TRUST_LEVEL_SLIDER_ORDER[(cur + 1) % TRUST_LEVEL_SLIDER_ORDER.length];
                setTrustLevel(next);
                void Haptics.selectionAsync().catch(() => undefined);
                useToastStore.getState().show(`Now in ${TRUST_LEVEL_META[next].label}`);
              }}
              style={{
                width: 48, height: 48, borderRadius: 24,
                backgroundColor: 'rgba(13, 36, 24, 0.92)',
                borderWidth: 1.5, borderColor: '#00C896',
                alignItems: 'center', justifyContent: 'center',
                shadowColor: '#00C896', shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.55, shadowRadius: 8, elevation: 6,
              }}
              accessibilityRole="button"
              accessibilityLabel={`Cycle trust level (now ${TRUST_LEVEL_META[trustLevel].label})`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="sync" size={22} color="#00C896" />
            </TouchableOpacity>
          )}

          {/* Single green dropdown chevron — always visible at L4.
              Chevron-back when collapsed (hints at "more →" expanding
              left); chevron-forward when expanded (hints "collapse"). */}
          <TouchableOpacity
            onPress={() => {
              void Haptics.selectionAsync().catch(() => {});
              setL4ActionsExpanded(v => !v);
            }}
            style={{
              width: 52, height: 52, borderRadius: 26,
              backgroundColor: '#00C896',
              alignItems: 'center', justifyContent: 'center',
              shadowColor: '#00C896', shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.65, shadowRadius: 10, elevation: 8,
            }}
            accessibilityRole="button"
            accessibilityLabel={l4ActionsExpanded ? 'Collapse actions' : 'Expand actions'}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={l4ActionsExpanded ? 'chevron-forward' : 'chevron-back'}
              size={26}
              color="#04140c"
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Phase AT follow-up — L4 standalone SmartFinder reticle removed.
          SmartFinder now lives inside the green-arrow dropdown row. */}

      {/* L1 SmartVision card is now rendered inside the L1 Quiet block
           above (stacked under Kevin's tile). This previous standalone
           bottom-anchored copy was removed when L1 was restructured to
           mirror the L2 Companion stack. */}

      {/* GREETING BUBBLE — pre-round shows opening prompt; in-round shows the
          most recent caddieResponse so a tap on Kevin produces visible
          feedback even when voice is muted. Pre-round bottom is derived from
          the Start Round CTA (bottom 24+ib, height 60) + 24pt gap = 108+ib
          uniform across all aspects (Phase BN — Tim: "one freaking button
          that needs to move down so it never goes up into elements above
          it"). In-round bottom sits above the data strip (168 + insets) so
          it doesn't overlap the dropdown chevron. */}
      {((!isRoundActive && shownText) || (isRoundActive && caddieResponse)) ? (
        <Animated.View
          style={[
            styles.bubble,
            {
              bottom: (isRoundActive ? 168 : 108) + insets.bottom,
              opacity: bubbleOpacity,
            },
          ]}
          pointerEvents="none"
        >
          <View style={[StyleSheet.absoluteFill, styles.bubbleTint]} />
          {/* 2026-06-13 (Tim) — 3 lines let the bubble top ride up over the caddie's
              mouth on the big-avatar view. 2 lines keeps it just above the shirt line.
              (If it still rides up, lower the bubble `bottom` offset — single knob.) */}
          <Text style={styles.bubbleText} numberOfLines={2}>
            {isRoundActive ? caddieResponse : shownText}
          </Text>
        </Animated.View>
      ) : null}

      {/* DATA STRIP — cross-fades in when round starts. Hidden pre-round
           on every trust level (no round, no data). */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: stripOpacity }]}
        pointerEvents={isRoundActive ? 'box-none' : 'none'}
      >
        <CaddieDataStrip
          yardage={displayYardage}
          playsLike={playsLikeYardage}
          // 2026-07-21 (Tim — plays-like must read as real/useful) — the yards the adjustment moved
          // it (uphill/into-wind +, downhill/downwind −). Shown as "(+3)" beside PLAYS so it's clear
          // the number is ADJUSTED, not the raw distance (the portrait strip dropped the yards cell).
          playsLikeDelta={playsLikeYardage != null && displayYardage != null ? playsLikeYardage - displayYardage : null}
          hole={{ current: currentHole, total: totalHoles }}
          targetDirection={targetDirection}
          stroke={currentStroke}
          visible={true}
          // Phase AT — Tim wants the strip as LOW as possible. bottom: 0
          // pins it to the very bottom edge of the screen.
          bottomOffset={0}
          // Phase 400-followup — surface whether the strip's PLAYS yardage
          // came from live GPS or scorecard fallback. liveYardage is non-null
          // only when yardageMode='live' AND GPS resolved a haversine yards
          // value; otherwise we're rendering the static scorecard yardage
          // and the user deserves to know.
          yardageSource={displayYardage == null ? null : (liveYardage != null ? 'live' : 'static')}
          // 2026-05-19 — totalScore/scoreVsPar wiring temporarily removed.
          // Strip displays STROKE only (per Tim's "don't show score in
          // the data bar, scoring goes in the expandable tool arrow"
          // call). The props remain on CaddieDataStripProps for future
          // use; passing them on every render kept getTotalScore/
          // getScoreVsPar running through inline reads on every state
          // change, suspected as a source of end-round re-render churn.
          onPress={() => setShowShotCard(true)}
        />
      </Animated.View>


      {/* PENALTY QUICK-TAP — only visible when the scoring tool is open. */}
      {isRoundActive && showShotCard && (
        <TouchableOpacity
          style={[styles.penaltyQuickBtn, { bottom: 96 + insets.bottom }]}
          onPress={() => { addPenalty(currentHole); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <AppIcon name="warning-outline" size={14} color="#fbbf24" />
            <Text style={styles.penaltyQuickBtnText}>+Penalty</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* START ROUND CTA — cross-fades out when round starts */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: ctaOpacity }]}
        pointerEvents={isRoundActive ? 'none' : 'box-none'}
      >
        <TouchableOpacity
          // Phase BN — Anchor uniformly at bottom 24 + ib across ALL aspects
          // (phones AND Fold open). Earlier aspect-branched values
          // (40 vs 80 + ib) kept producing overlap with the greeting bubble
          // or the L2 Companion cells above. zIndex 50 (in styles.startRoundBtn)
          // makes the button visually invincible against anything it could
          // overlap (L2 cells zIndex 6, L3 SmartVision inlay zIndex 12,
          // dropdown row zIndex 15, bubble zIndex 6).
          style={[styles.startRoundBtn, { bottom: 24 + insets.bottom }]}
          // Caddie's Start Round button now routes to the Play tab (Course
          // Discovery). After a course is picked there, the Selected Course
          // card's "Start Round" button navigates back here with
          // pre_course_id, which triggers setShowRoundSetup(true) via the
          // existing effect — round-config sheet still gets the same
          // course-prefilled flow it had before, just one step earlier in
          // the navigation.
          onPress={() => router.push('/(tabs)/play' as never)}
          activeOpacity={0.88}
        >
          <Text style={styles.startRoundText}>Start Round</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── ROUND SETUP SHEET ──────────────── */}
      <Modal
        visible={showRoundSetup}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRoundSetup(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          onPress={() => setShowRoundSetup(false)}
          activeOpacity={1}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Start Round</Text>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              // Phase AA — the Start button at the bottom of this sheet was
              // getting clipped on shorter aspects (Galaxy Fold closed). Add
              // bottom padding to clear the system bar + give the CTA room.
              contentContainerStyle={{ paddingBottom: 80 }}
            >

            <Text style={styles.sheetLabel}>Course</Text>
            <CoursePicker
              selected={selectedPickedCourse}
              onSelect={setSelectedPickedCourse}
              onInfo={(courseId) => {
                setShowRoundSetup(false);
                pushCourseGuarded(router, courseId);
              }}
            />

            {selectedPickedCourse && !selectedPickedCourse.isLocal && (
              <StartRoundCourseCard
                courseId={selectedPickedCourse.id}
                courseName={selectedPickedCourse.name}
              />
            )}
            {selectedPickedCourse?.isLocal && (
              <StartRoundCourseCard
                courseId={null}
                courseName={selectedPickedCourse.name}
              />
            )}

            <Text style={styles.sheetLabel}>Holes</Text>
            <View style={styles.pillRow}>
              {([
                { label: '18 Holes', value: false },
                { label: '9 Holes',  value: true },
              ] as const).map(opt => (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.pill, nineHole === opt.value && styles.pillActive]}
                  onPress={() => setNineHole(opt.value)}
                >
                  <Text style={[
                    styles.pillText,
                    nineHole === opt.value && styles.pillTextActive,
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sheetLabel}>Format</Text>
            <View style={styles.pillRow}>
              {([
                { label: 'Casual',      value: false },
                { label: 'Competition', value: true },
              ] as const).map(opt => (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.pill, isCompetition === opt.value && styles.pillActive]}
                  onPress={() => setIsCompetition(opt.value)}
                >
                  <Text style={[
                    styles.pillText,
                    isCompetition === opt.value && styles.pillTextActive,
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sheetLabel}>Mode</Text>
            <View style={[styles.modeGrid, W > 500 && styles.modeGridWide]}>
              {((['break_100', 'break_90', 'break_80', 'free_play'] as RoundMode[]).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.modeCard,
                    W > 500 && styles.modeCardWide,
                    selectedMode === m && styles.modeCardActive,
                  ]}
                  onPress={() => setSelectedMode(m)}
                >
                  <Text style={[styles.modeCardTitle, selectedMode === m && styles.modeCardTitleActive]}>
                    {ROUND_MODE_CARDS[m].title}
                  </Text>
                  <Text style={styles.modeCardDesc}>{ROUND_MODE_CARDS[m].description}</Text>
                </TouchableOpacity>
              )))}
            </View>

            {/* GHOST PICKER */}
            {(() => {
              const courseKey = selectedPickedCourse?.isLocal
                ? selectedPickedCourse.name.toLowerCase()
                : selectedPickedCourse?.id ?? null;
              const eligible = roundHistory.filter(r => {
                if (!courseKey) return false;
                if (selectedPickedCourse?.isLocal) {
                  return (r.courseName ?? '').toLowerCase().includes(courseKey);
                }
                return r.courseId === courseKey;
              }).slice(-5).reverse();

              const relDate = (ts: number) => {
                const days = Math.floor((Date.now() - ts) / 86400000);
                if (days === 0) return 'Today';
                if (days === 1) return 'Yesterday';
                if (days < 7) return `${days} days ago`;
                if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
                return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
              };

              return (
                <View style={styles.ghostPickerSection}>
                  <Text style={styles.sheetLabel}>Play against a past round?</Text>
                  <Text style={styles.ghostPickerSub}>Optional — Kevin runs the match hole by hole.</Text>
                  {eligible.length === 0 ? (
                    <Text style={styles.ghostPickerEmpty}>No past rounds on this course yet. Play one to unlock ghost mode.</Text>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.ghostRow, selectedGhostId === null && styles.ghostRowSelected]}
                        onPress={() => setSelectedGhostId(null)}
                      >
                        <Text style={[styles.ghostRowText, selectedGhostId === null && styles.ghostRowTextSelected]}>
                          Solo round (skip)
                        </Text>
                        {selectedGhostId === null && <Text style={styles.ghostRowCheck}>✓</Text>}
                      </TouchableOpacity>
                      {eligible.map(r => (
                        <TouchableOpacity
                          key={r.id}
                          style={[styles.ghostRow, selectedGhostId === r.id && styles.ghostRowSelected]}
                          onPress={() => setSelectedGhostId(r.id)}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.ghostRowText, selectedGhostId === r.id && styles.ghostRowTextSelected]}>
                              {r.totalScore} strokes · {ROUND_MODE_LABELS[r.mode] ?? r.mode}
                            </Text>
                            <Text style={styles.ghostRowDate}>{relDate(r.endedAt)}</Text>
                          </View>
                          {selectedGhostId === r.id && <Text style={styles.ghostRowCheck}>✓</Text>}
                        </TouchableOpacity>
                      ))}
                    </>
                  )}
                </View>
              );
            })()}

            {/* Notes for Caddie — typed or voice-dictated, surfaces to Kevin's
                round-context analysis on briefings and during play. */}
            <Text style={styles.sheetLabel}>Notes for Kevin</Text>
            <View style={styles.notesWrap}>
              <TextInput
                style={styles.notesInput}
                value={roundNotes}
                onChangeText={setRoundNotes}
                placeholder="Conditions, focus, anything Kevin should know…"
                placeholderTextColor="#4b5563"
                multiline
                numberOfLines={3}
              />
              <TouchableOpacity
                style={styles.notesMicBtn}
                disabled={notesDictating}
                onPress={async () => {
                  setNotesDictating(true);
                  try {
                    const text = await captureUtterance(8000, apiUrl, language);
                    if (text) {
                      setRoundNotes(prev => (prev ? prev + ' ' : '') + text);
                    }
                  } finally {
                    setNotesDictating(false);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Dictate notes"
              >
                <AppIcon name={notesDictating ? 'radio-outline' : 'mic'} size={18} color="#00C896" />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              {selectedPickedCourse && (
                <TouchableOpacity
                  style={styles.findTeeBtn}
                  onPress={() => { void openTeeTimeSearch(selectedPickedCourse.name); }}
                >
                  <Text style={styles.findTeeBtnText}>Find Tee Time</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.startBtn, !selectedPickedCourse && styles.startBtnDisabled, selectedPickedCourse && { flex: 1 }]}
                onPress={handleStartRound}
                disabled={!selectedPickedCourse}
              >
                <Text style={styles.startBtnText}>
                  {selectedPickedCourse ? 'Start Round' : 'Select a course to start'}
                </Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {/* ── OFFLINE FALLBACK SHEET (A2) ──────────────────
          Voice couldn't reach the backend. Let the player TYPE the question and
          answer it with ZERO network via the on-device offline caddie (round
          state + golf KB), spoken through the device voice. [[offline-caddie-plan]] */}
      <Modal
        visible={offlineFallbackOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOfflineFallbackOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)', padding: 24 }}
        >
          <View style={{ backgroundColor: '#111827', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#1f2937' }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
              No signal — ask me anyway
            </Text>
            <Text style={{ color: '#9ca3af', fontSize: 13, marginBottom: 6 }}>
              I can't hear you without a connection, but I can still answer yardages, club calls and the basics from what's on your phone.
            </Text>
            {/* 2026-06-28 (Tim) — the keyboard's own dictation mic (Gboard / iOS) is a
                reliable, often-offline talk-to-text that works in this box for free —
                more dependable than our network/on-device STT. Make it discoverable. */}
            <Text style={{ color: '#00C896', fontSize: 12, fontWeight: '600', marginBottom: 14 }}>
              🎤 Prefer to talk? Tap the mic on your keyboard, then Send.
            </Text>
            <TextInput
              style={{ backgroundColor: '#0b0f17', color: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#1f2937', padding: 12, fontSize: 15, minHeight: 44 }}
              value={offlineFallbackText}
              onChangeText={setOfflineFallbackText}
              placeholder="Type, or tap 🎤 on the keyboard to talk…"
              placeholderTextColor="#4b5563"
              autoFocus
              returnKeyType="send"
              onSubmitEditing={handleOfflineAsk}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#374151' }}
                onPress={() => { setOfflineFallbackText(''); setOfflineFallbackOpen(false); }}
              >
                <Text style={{ color: '#9ca3af', fontWeight: '600' }}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#00C896' }}
                onPress={handleOfflineAsk}
              >
                <Text style={{ color: '#04241c', fontWeight: '700' }}>Ask</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── SHOT CARD SHEET ─────────────────── */}
      <Modal
        visible={showShotCard}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowShotCard(false); clearShotPending(); }}
      >
        <TouchableOpacity
          style={styles.backdrop}
          onPress={() => { setShowShotCard(false); clearShotPending(); }}
          activeOpacity={1}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>
                {'Hole ' + currentHole + (currentPar ? ' · Par ' + currentPar : '')}
              </Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              // Phase AE follow-up — guarantee the green Next Hole / End
              // Round CTAs at the bottom of this sheet aren't clipped by
              // the system bar or restored tab bar (sheet renders above
              // tab bar but the sheet's own bottom padding wasn't enough
              // on Galaxy Fold closed).
              contentContainerStyle={{ paddingBottom: 100 }}
            >

            {/* ── Shot logging ── */}
            <Text style={styles.sheetLabel}>Log Shot</Text>
            <View style={styles.directionRow}>
              {(['left', 'straight', 'right'] as const).map(dir => (
                <TouchableOpacity
                  key={dir}
                  style={[styles.directionBtn, pendingDirection === dir && styles.directionBtnActive]}
                  onPress={() => handleDirectionTap(dir)}
                >
                  <Text style={styles.directionBtnIcon}>
                    {dir === 'left' ? '←' : dir === 'right' ? '→' : '●'}
                  </Text>
                  <Text style={[
                    styles.directionBtnText,
                    pendingDirection === dir && styles.directionBtnTextActive,
                  ]}>
                    {dir === 'left' ? 'Left' : dir === 'right' ? 'Right' : 'Straight'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {showOutcomeRow && (
              <View style={styles.outcomeRow}>
                {(['clean', 'water', 'ob', 'lost', 'hazard_drop', 'unplayable'] as ShotOutcome[]).map(o => (
                  <TouchableOpacity
                    key={o}
                    style={[styles.outcomePill, o === 'clean' && styles.outcomePillHighlight]}
                    onPress={() => handleOutcomeTap(o)}
                  >
                    <Text style={styles.outcomePillEmoji}>{OUTCOME_EMOJI[o]}</Text>
                    <Text style={styles.outcomePillText}>{OUTCOME_LABELS[o]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {showRulesChoice && (
              <View style={styles.rulesChoiceRow}>
                <TouchableOpacity
                  style={styles.rulesChoiceBtn}
                  onPress={() => handleRulesChoice('play_forward')}
                >
                  <Text style={styles.rulesChoiceBtnText}>Play Forward{'\n'}(+1 stroke)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rulesChoiceBtn}
                  onPress={() => handleRulesChoice('stroke_and_distance')}
                >
                  <Text style={styles.rulesChoiceBtnText}>Stroke & Distance{'\n'}(+2 strokes)</Text>
                </TouchableOpacity>
              </View>
            )}

            {currentHoleShots.length > 0 && (
              <View style={styles.shotChipsRow}>
                {currentHoleShots.map((s, i) => (
                  <View key={s.id ?? i} style={styles.shotChip}>
                    <Text style={styles.shotChipText}>
                      {i + 1}. {s.direction ?? '?'}
                      {s.outcome && s.outcome !== 'clean' ? ' ' + OUTCOME_EMOJI[s.outcome] : ''}
                      {(s.penalty_strokes ?? 0) > 0 ? ' +' + s.penalty_strokes : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sheetLabel}>Score</Text>
            <View style={styles.scoreRow}>
              <TouchableOpacity
                style={styles.scoreBtn}
                onPress={() => setHoleScore(Math.max(1, holeScore - 1))}
              >
                <Text style={styles.scoreBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.scoreValue}>{holeScore === 0 ? '—' : holeScore}</Text>
              <TouchableOpacity
                style={styles.scoreBtn}
                onPress={() => setHoleScore(holeScore + 1)}
              >
                <Text style={styles.scoreBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sheetLabel}>Putts</Text>
            <View style={styles.scoreRow}>
              <TouchableOpacity
                style={styles.scoreBtn}
                onPress={() => setHolePutts(Math.max(0, holePutts - 1))}
              >
                <Text style={styles.scoreBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.scoreValue}>{holePutts}</Text>
              <TouchableOpacity
                style={styles.scoreBtn}
                onPress={() => setHolePutts(holePutts + 1)}
              >
                <Text style={styles.scoreBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.startBtn, holeScore === 0 && styles.startBtnDisabled]}
              onPress={handleLogHole}
              disabled={holeScore === 0}
            >
              <Text style={styles.startBtnText}>Log Score</Text>
            </TouchableOpacity>

            {isRoundActive && (
              <TouchableOpacity
                style={styles.endRoundBtn}
                onPress={async () => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                  // Snapshot BEFORE endRound zeroes scores/course/id.
                  // 2026-06-21 — include scores/courseHoles/activeCourse so
                  // buildContextualSummary has pre-reset data.
                  const preRound = useRoundStore.getState();
                  const snapshot = {
                    total: getTotalScore(),
                    vspar: getScoreVsPar(),
                    played: getHolesPlayed(),
                    scores: { ...preRound.scores },
                    courseHoles: [...preRound.courseHoles],
                    activeCourse: preRound.activeCourse,
                  };
                  // 2026-06-12 (Tim) — ending from the Caddie tab spoke a line but never
                  // opened the recap screen (only play.tsx did), so a round — partial or
                  // full — "didn't summarize". Capture the id and open the recap, matching
                  // play.tsx. endRound builds the RoundRecord from whatever holes were
                  // played, so a 9-of-18 round recaps fine.
                  // FIX M15 — route through feelings screen first.
                  const roundId = endRound();
                  clearShotPending();
                  setShowShotCard(false);
                  await generateRoundSummary(snapshot, roundId ?? undefined);
                  if (roundId) router.push(`/recap/feelings?roundId=${roundId}` as never);
                }}
              >
                <Text style={styles.endRoundText}>End Round</Text>
              </TouchableOpacity>
            )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Phase 109-followup — Quick Log Shot tap UI. */}
      <QuickLogShotSheet visible={quickLogOpen} onClose={() => setQuickLogOpen(false)} />

      <QuickTutorial
        slug="caddie_intro"
        title="Caddie"
        lines={[
          "This is your round home — start a round, see live yardages, log shots.",
          "Tap the mic badge or call my name to ask anything during the round.",
          "I'll surface honest distances, watch your swings, and call the play.",
        ]}
        spokenText="Your caddie home. Tap the mic or call my name during the round."
      />

    </View>
  );
}

// 2026-05-20 — Tools FAB expanded icon. Small green circle with a
// tool icon inside; tapping fires the parent's route push and
// auto-collapses the FAB.
function ToolFabIcon({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0, 200, 150, 0.18)',
        borderWidth: 1.5,
        borderColor: '#00C896',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={20} color="#00C896" />
    </TouchableOpacity>
  );
}

/**
 * 2026-05-26 — Trust-cycle FAB: head silhouette inside the standard
 * green pill, with a tiny sync badge in the top-right corner so the
 * icon reads as "tap to cycle through who's listening." Mirrors Tim's
 * verbal spec — "head silhouette with recycle circle around it" —
 * without needing a custom SVG.
 */
function ToolFabIconCycler({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0, 200, 150, 0.18)',
        borderWidth: 1.5,
        borderColor: '#00C896',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="person-circle-outline" size={22} color="#00C896" />
      <View style={{
        position: 'absolute',
        right: -2,
        top: -2,
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#060f09',
        borderWidth: 1,
        borderColor: '#00C896',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Ionicons name="sync" size={10} color="#00C896" />
      </View>
    </TouchableOpacity>
  );
}

// ─── STYLES ───────────────────────────────

// 2026-05-26 — Fix CN: themed StyleSheet via makeStyles(colors). Hex codes
// matching dark-theme tokens pulled from `c` so light mode renders.
function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  topNav: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Phase AD — was 'center'; now flex-start so the right column stack
    // (Tool / Free Play / Score) extends downward without re-centering and
    // pushing Tool into the avatar zone below.
    alignItems: 'flex-start',
    zIndex: 20,
  },
  navBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smartFinderBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#00C896',
    backgroundColor: 'rgba(0,200,150,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bubble: {
    position: 'absolute',
    left: 24,
    right: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 40, 0.25)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    overflow: 'hidden',
    zIndex: 6,
    alignItems: 'center',
  },
  bubbleTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  bubbleText: {
    fontSize: 17,
    fontWeight: '600',
    fontStyle: 'italic',
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: 24,
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  modeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 200, 150, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 150, 0.25)',
  },
  modeBadgePlaceholder: {
    width: 80,
    height: 28,
  },
  modeBadgeText: {
    color: 'rgba(0, 200, 150, 0.7)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  modeGrid: {
    gap: 8,
  },
  modeGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  modeCard: {
    backgroundColor: c.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 2,
  },
  modeCardWide: {
    flex: 1,
    minWidth: '45%',
  },
  modeCardActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  modeCardTitle: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
  },
  modeCardTitleActive: {
    color: '#00C896',
  },
  modeCardDesc: {
    color: '#4b5563',
    fontSize: 11,
    lineHeight: 15,
  },
  penaltyQuickBtn: {
    position: 'absolute',
    right: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    zIndex: 10,
  },
  penaltyQuickBtnText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  startRoundBtn: {
    position: 'absolute',
    alignSelf: 'center',
    left: 40,
    right: 40,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#00C896',
    alignItems: 'center',
    justifyContent: 'center',
    // Phase BN — zIndex bumped 5 → 50 so the CTA always renders above any
    // element it could geometrically overlap: L2 Companion cells (zIndex 6),
    // greeting bubble (zIndex 6), L3 SmartVision inlay (zIndex 12), and the
    // in-round dropdown row (zIndex 15). Wind arrow (zIndex 11) is unaffected
    // because it lives in the top portion of the screen.
    zIndex: 50,
  },
  startRoundText: {
    color: '#00C896',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: c.surface_elevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: c.border,
    maxHeight: '80%',
  },
  moreSheet: {
    backgroundColor: '#0a1a0a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: c.border,
    maxHeight: '85%',
  },
  moreScroll: {
    flexGrow: 0,
  },
  toolsStatusRow: {
    flexDirection: 'row',
    backgroundColor: c.surface_elevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 14,
    alignItems: 'center',
  },
  toolsStatusItem: { flex: 1, alignItems: 'center' },
  toolsStatusLabel: { color: '#6b7280', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  toolsStatusValue: { color: '#ffffff', fontSize: 13, fontWeight: '800', marginTop: 2 },
  toolsStatusDivider: { width: 1, height: 26, backgroundColor: c.border },
  moreScrollContent: {
    paddingBottom: 24,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: c.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  sheetTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    flex: 1,
    textAlign: 'center',
  },
  holeViewNudge: {
    backgroundColor: 'rgba(0,200,150,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.25)',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  holeViewNudgeText: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '700',
  },
  sheetLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 16,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  pill: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.background,
    alignItems: 'center',
    minWidth: 80,
  },
  pillActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  pillText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#00C896',
  },
  startBtn: {
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 0,
    flex: 1,
  },
  findTeeBtn: {
    backgroundColor: '#3a2a08',
    borderColor: '#F5A623',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findTeeBtnText: { color: '#F5A623', fontSize: 14, fontWeight: '800' },
  notesWrap: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    marginTop: 8,
    alignItems: 'flex-start',
  },
  notesInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  notesMicBtn: {
    width: 38, height: 38, borderRadius: 8,
    backgroundColor: 'rgba(0,200,150,0.12)',
    alignItems: 'center', justifyContent: 'center',
    margin: 4,
  },
  startBtnDisabled: {
    backgroundColor: c.border,
    opacity: 0.5,
  },
  startBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  endRoundBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  endRoundText: {
    color: '#6b7280',
    fontSize: 14,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 8,
  },
  scoreBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.surface_elevated,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreBtnText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '300',
  },
  scoreValue: {
    color: '#ffffff',
    fontSize: 48,
    fontWeight: '900',
    minWidth: 60,
    textAlign: 'center',
  },
  moreTitle: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
    textAlign: 'center',
  },
  moreItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  moreIcon: {
    fontSize: 22,
    width: 32,
    textAlign: 'center',
  },
  moreIconWrap: {
    width: 32, height: 32, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  moreText: {
    flex: 1,
  },
  moreLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  moreSub: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  ghostPickerSection: {
    marginTop: 4,
    marginBottom: 4,
  },
  ghostPickerSub: {
    color: '#4b5563',
    fontSize: 12,
    marginBottom: 10,
    marginTop: -4,
  },
  ghostPickerEmpty: {
    color: '#374151',
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  ghostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface_elevated,
    marginBottom: 6,
  },
  ghostRowSelected: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  ghostRowText: {
    flex: 1,
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  ghostRowTextSelected: {
    color: '#ffffff',
  },
  ghostRowDate: {
    color: '#4b5563',
    fontSize: 11,
    marginRight: 6,
  },
  ghostRowCheck: {
    color: '#00C896',
    fontSize: 14,
    fontWeight: '800',
  },
  brandWordmark: {
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  brandName: {
    color: '#00C896',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  brandSub: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  trialBanner: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 200, 150, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 150, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    zIndex: 15,
  },
  trialBannerExpired: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  trialBannerText: {
    color: 'rgba(0, 200, 150, 0.7)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  trialBannerExpiredText: {
    color: '#ef4444',
  },
  directionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  directionBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.background,
    alignItems: 'center',
    paddingVertical: 10,
    gap: 2,
  },
  directionBtnActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  directionBtnIcon: {
    fontSize: 18,
    color: '#9ca3af',
  },
  directionBtnText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#6b7280',
  },
  directionBtnTextActive: {
    color: '#00C896',
  },
  outcomeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  outcomePill: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.background,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
    minWidth: 80,
    flex: 1,
  },
  outcomePillHighlight: {
    borderColor: '#00C896',
    backgroundColor: 'rgba(0, 200, 150, 0.08)',
  },
  outcomePillEmoji: {
    fontSize: 14,
  },
  outcomePillText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: '#9ca3af',
    marginTop: 2,
  },
  rulesChoiceRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  rulesChoiceBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: c.surface_elevated,
    paddingVertical: 12,
    alignItems: 'center',
  },
  rulesChoiceBtnText: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600' as const,
    textAlign: 'center',
    lineHeight: 17,
  },
  shotChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
    marginBottom: 12,
  },
  shotChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface_elevated,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  shotChipText: {
    color: '#9ca3af',
    fontSize: 11,
  },
});
}
