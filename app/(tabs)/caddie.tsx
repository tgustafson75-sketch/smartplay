import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Image,
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
  Linking,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';
import CaddieAvatar, { VoiceState } from '../../components/CaddieAvatar';
import { useRoundStore } from '../../store/roundStore';
import type { ShotResult } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useCageStore } from '../../store/cageStore';
import { usePointsStore } from '../../store/pointsStore';
import { getCourseList, getCourse } from '../../data/courses';
import CoursePicker, { type PickedCourse } from '../../components/CoursePicker';
import StartRoundCourseCard from '../../components/course/StartRoundCourseCard';
import { openTeeTimeSearch } from '../../services/teeTimeLink';
import { type RoundMode, ROUND_MODE_LABELS, ROUND_MODE_CARDS } from '../../types/patterns';
import { getCourse as getApiCourse, courseToHoles } from '../../services/golfCourseApi';
import { generateRecap } from '../../services/recapGenerator';
import { generatePatternInsights } from '../../services/patternDetection';
import { useGhostStore } from '../../store/ghostStore';
import { useVoiceCaddie } from '../../hooks/useVoiceCaddie';
import { useKevin, type ToolAction } from '../../hooks/useKevin';
import { useKevinPresence } from '../../contexts/KevinPresenceContext';
import { useVoiceActivityDetection } from '../../hooks/useVoiceActivityDetection';
import { useVolumeButtonTrigger } from '../../hooks/useVolumeButtonTrigger';
import { speak, configureAudioForSpeech, captureUtterance } from '../../services/voiceService';
import { shotDetectionService } from '../../services/shotDetectionService';
import { conversationalLoggingOrchestrator } from '../../services/conversationalLoggingOrchestrator';
import { fetchCourseGeometry } from '../../services/courseGeometryService';
import WindArrow from '../../components/caddie/WindArrow';
import { useCurrentWeather } from '../../hooks/useCurrentWeather';
import { playsLikeDistance } from '../../utils/playsLike';
import SmartFinderCard from '../../components/smartfinder/SmartFinderCard';
import { useTrustLevelStore, TRUST_LEVEL_META, type TrustLevel } from '../../store/trustLevelStore';
import KevinAvatar, { type AvatarState } from '../../components/kevin/KevinAvatar';
import L1HolePreview from '../../components/caddie/L1HolePreview';
import { getFirstToolHint } from '../../services/voiceOnboardingService';
import KevinHelpButton from '../../components/KevinHelpButton';
import ScorecardChip from '../../components/caddie/ScorecardChip';
import AppIcon, { type IconName } from '../../components/AppIcon';
import * as ImagePicker from 'expo-image-picker';
import VocabBanner from '../../components/VocabBanner';
import CaddieDataStrip from '../../components/CaddieDataStrip';
import { canAccess, trialDaysLeft } from '../../services/featureAccess';
import { triggerPaywall } from '../../services/paywallGuard';
import { subscribeBattery } from '../../services/batteryMonitor';
import { noteAudioActivity } from '../../services/audioLifecycle';
import {
  shouldFireProactive,
  markProactiveFired,
  resetProactiveState,
} from '../../services/proactiveKevin';
import { resolvePenalty } from '../../services/rulesEngine';
import { OUTCOME_LABELS, OUTCOME_EMOJI } from '../../types/shot';
import type { ShotOutcome } from '../../types/shot';
import type { RulesDecision } from '../../types/penalty';

const NULL_HUD = { hole: null, par: null, yards: null, wind: null, playsLike: null };

export default function CaddieTab() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pre_course_id, _t: preCourseNonce } = useLocalSearchParams<{ pre_course_id?: string; _t?: string }>();
  const trustLevel = useTrustLevelStore(s => s.level);
  const setTrustLevel = useTrustLevelStore(s => s.setLevel);

  // Phase F — kevinAvatarState derived below after voiceState/kevinThinking
  // are declared. Consumed by L1's mic-button KevinAvatar wrapping.
  const { width: W, height: H } = useWindowDimensions();
  // Natural 9:16 frame height — shows Kevin's full portrait without over-zoom
  const avatarFrameHeight = Math.round(W * 16 / 9);

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

  // ── Stores ──────────────────────────────
  const {
    isRoundActive,
    currentHole,
    currentYardage,
    club,
    activeCourse,
    courseHoles,
    scores,
    nineHoleMode,
    startRound,
    endRound,
    setCurrentHole,
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
    computeHoleScore,
  } = useRoundStore();

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
  const playsLikeYardage = useMemo(() => {
    if (currentYardage == null) return currentYardage;
    if (!caddieWeather) return currentYardage;
    return playsLikeDistance(currentYardage, caddieWeather, caddieShotBearing).plays_like_yards;
  }, [currentYardage, caddieWeather, caddieShotBearing]);

  const {
    voiceGender,
    voiceEnabled,
    discreteMode,
    castMode,
    language,
    autoListenEnabled,
    setVoiceEnabled,
    setCastMode,
  } = useSettingsStore();

  const { firstName, goal, subscription_status, trial_started_at, dominantMiss } = usePlayerProfileStore();
  const { skip_briefings, proactive_kevin_enabled } = useSettingsStore();
  const daysLeft = useMemo(
    () => trialDaysLeft(trial_started_at),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscription_status, trial_started_at],
  );

  const {
    roundsTogether,
    sessionsTogether,
    currentMentalState,
    heroMoments,
    incrementRounds,
    isSpiralRisk,
  } = useRelationshipStore();

  const { setMode } = useKevinPresence();

  useFocusEffect(
    useCallback(() => {
      setMode('full');
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);

      // Fire round_start_handoff when caddie regains focus with an active round on hole 1
      // (covers: briefing dismissed, skip_briefings path, any other entry)
      const storeNow = useRoundStore.getState();
      const settingsNow = useSettingsStore.getState();
      if (
        settingsNow.proactive_kevin_enabled &&
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
            const { voiceEnabled, discreteMode, voiceGender: vg, language: lang } = useSettingsStore.getState();
            if (voiceEnabled && !discreteMode) {
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
          ScreenOrientation.unlockAsync();
        };
      }

      return () => {
        setMode('badge');
        ScreenOrientation.unlockAsync();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setMode]),
  );

  // ── Local state ─────────────────────────
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [appActive, setAppActive] = useState(true);
  const [kevinEmotion, setKevinEmotion] = useState<string | null>(null);
  const [openingPrompt, setOpeningPrompt] = useState('');
  const [caddieResponse, setCaddieResponse] = useState('');
  const [showShotCard, setShowShotCard] = useState(false);
  const [showRoundSetup, setShowRoundSetup] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
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

  // ── Ghost rehydration on mount ───────────
  useEffect(() => {
    if (!isRoundActive || !active_ghost) return;
    if (useGhostStore.getState().ghostRecord != null) return; // already live
    const record = roundHistory.find(r => r.id === active_ghost.source_round_id);
    if (record) useGhostStore.getState().activateGhost(record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // ── Floating response text ───────────────
  const displayText = caddieResponse || openingPrompt;
  const [shownText, setShownText] = useState(displayText);
  const responseFade = useRef(new Animated.Value(1)).current;

  // Pre-beta — battery-saver state for the L1 badge dot color.
  const [saverActive, setSaverActive] = useState(false);
  useEffect(() => subscribeBattery((s) => setSaverActive(s.saverActive)), []);

  // Sim-report gap 3 — L4 long-press on the SmartFinder reticle expands
  // the embedded SmartFinderCard inline (instead of forcing a full-screen
  // route push). Tap-anywhere on the overlay collapses it. Long-press
  // again toggles closed.
  const [l4FinderExpanded, setL4FinderExpanded] = useState(false);
  useEffect(() => {
    if (trustLevel !== 4) setL4FinderExpanded(false);
  }, [trustLevel]);

  // Sim-report — same long-press pattern for SmartVision on L4 so the
  // player can glance at the hole layout without leaving the full Kevin
  // screen. Short tap routes to the full /hole-view; long-press toggles
  // an inline preview.
  const [l4VisionExpanded, setL4VisionExpanded] = useState(false);
  useEffect(() => {
    if (trustLevel !== 4) setL4VisionExpanded(false);
  }, [trustLevel]);

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

  const currentPar = getCurrentPar();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const _totalScore  = useMemo(() => getTotalScore(),  [scores]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const _scoreVsPar  = useMemo(() => getScoreVsPar(),  [scores, courseHoles]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const _holesPlayed = useMemo(() => getHolesPlayed(), [scores]);

  // Derived early so animation effects can reference it
  const vadEnabled = autoListenEnabled && isRoundActive && appActive;

  // ── Keep Vercel warm ────────────────────
  useEffect(() => {
    const keepWarm = async () => {
      try {
        await fetch(apiUrl + '/api/brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: '__ping__', language: 'en' }),
        });
      } catch {}
    };
    keepWarm();
    const interval = setInterval(keepWarm, 4 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── AppState guard (battery) ─────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      setAppActive(nextState === 'active');
    });
    return () => sub.remove();
  }, []);

  // ── Opening prompt ───────────────────────
  useEffect(() => {
    const hour = new Date().getHours();
    const tod =
      hour < 12 ? 'morning' :
      hour < 17 ? 'afternoon' : 'evening';
    const name = firstName || '';
    const lastHero = heroMoments.slice(-1)[0];

    let prompt = '';

    if (roundsTogether === 0 && sessionsTogether === 0) {
      prompt =
        'Hey' + (name ? ' ' + name : '') +
        ". I'm Kevin. Let's go play some golf.";
    } else if (sessionsTogether > 0 && roundsTogether === 0) {
      prompt =
        'Good ' + tod + (name ? ' ' + name : '') +
        '. Ready to take that range work to the course?';
    } else if (roundsTogether > 0 && currentMentalState === 'confident') {
      prompt =
        'Good ' + tod + (name ? ' ' + name : '') +
        ". You've been playing well. What are we working on?";
    } else if (roundsTogether >= 10) {
      prompt =
        'Good ' + tod + (name ? ' ' + name : '') +
        (goal ? '. Still chasing ' + goal + '?' : '. What can I help with?');
    } else if (lastHero && roundsTogether > 0) {
      prompt =
        'Good ' + tod + (name ? ' ' + name : '') +
        '. Ready to add to the reel?';
    } else {
      prompt =
        'Good ' + tod + (name ? ' ' + name : '') +
        '. What can I help with today?';
    }

    setOpeningPrompt(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── SmartVision ──────────────────────────
  const openSmartVision = () => {
    if (!canAccess('smartvision', subscription_status)) {
      void triggerPaywall('smartvision', () => router.push('/paywall' as never));
      return;
    }
    const state = useRoundStore.getState();
    const {
      currentHole: hole,
      activeCourse,
      currentYardage,
      courseHoles,
      isRoundActive: roundActive,
    } = state;

    const holeData = courseHoles.find(h => h.hole === hole);

    router.push({
      pathname: '/hole-view',
      params: {
        hole: String(hole),
        par: String(holeData?.par ?? 4),
        distance: String(currentYardage ?? holeData?.distance ?? 150),
        courseName: activeCourse ?? '',
        isRoundActive: String(roundActive),
        autoRunVision: 'true',
        teeLat: String(holeData?.teeLat ?? 0),
        teeLng: String(holeData?.teeLng ?? 0),
        middleLat: String(holeData?.middleLat ?? 0),
        middleLng: String(holeData?.middleLng ?? 0),
        front: String(holeData?.front ?? 0),
        back: String(holeData?.back ?? 0),
      },
    } as never);
  };

  // ── Kevin programmatic hook ──────────────
  const { isThinking: kevinThinking } = useKevin();

  // Phase F — Kevin liveliness state derived from existing voice/think signals.
  const kevinAvatarState: AvatarState =
    kevinThinking ? 'thinking'
    : voiceState === 'listening' ? 'listening'
    : voiceState === 'speaking' ? 'speaking'
    : 'idle';

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
      case 'log_score':
        setShowShotCard(true);
        break;
      case 'record_swing':
        router.push('/(tabs)/swinglab?mode=record' as never);
        break;
      case 'open_smartfinder':
        if (!canAccess('smartfinder', subscription_status)) {
          setCaddieResponse("SmartFinder is part of the Pro plan. Want to unlock it?");
          return;
        }
        router.push('/smartfinder' as never);
        break;
      default:
    }
    // Phase A.4: first-tool hint after first launch in first round.
    const hint = getFirstToolHint();
    if (hint) setCaddieResponse(hint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSmartVision, club, router]);

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
    if (resolution.kevin_voice_line && voiceEnabled && !discreteMode) {
      speak(resolution.kevin_voice_line, voiceGender, language, apiUrl).catch(() => {});
    }
  }, [currentHole, club, logShot, clearShotPending, voiceEnabled, discreteMode, voiceGender, language, apiUrl]);

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
      if (resolution.kevin_voice_line && voiceEnabled && !discreteMode) {
        speak(resolution.kevin_voice_line, voiceGender, language, apiUrl).catch(() => {});
      }
      // Auto-resolve as play_forward after 15 seconds if user walks away.
      // Plays a voice line before committing so the user isn't surprised by a silent decision.
      outcomeAutoTimerRef.current = setTimeout(() => {
        outcomeAutoTimerRef.current = null;
        if (voiceEnabled && !discreteMode) {
          speak("Locked in as play forward — let me know if I got that wrong.", voiceGender, language, apiUrl).catch(() => {});
        }
        commitShot(pendingDirection, outcome, 'play_forward');
      }, 15000);
      return;
    }
    commitShot(pendingDirection, outcome);
  }, [pendingDirection, commitShot, voiceEnabled, discreteMode, voiceGender, language, apiUrl]);

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
  });

  const handleMicPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    _handleMicPress();
  };

  // ── Conversational shot logging — Phase A.2 ──
  useEffect(() => {
    conversationalLoggingOrchestrator.configure({
      apiUrl,
      voiceGender,
      language,
      captureUtterance: (timeoutMs) => captureUtterance(timeoutMs, apiUrl, language),
      onFallbackToManual: () => setShowShotCard(true),
    });
    if (isRoundActive) {
      shotDetectionService.start().catch(() => {});
      conversationalLoggingOrchestrator.start();
    } else {
      conversationalLoggingOrchestrator.stop();
      shotDetectionService.stop();
    }
    return () => {
      conversationalLoggingOrchestrator.stop();
      shotDetectionService.stop();
    };
  }, [isRoundActive, apiUrl, voiceGender, language]);

  // Suspend orchestrator while modals or other voice flows are active.
  useEffect(() => {
    conversationalLoggingOrchestrator.setSuspended(showShotCard || showRoundSetup || showMoreMenu);
  }, [showShotCard, showRoundSetup, showMoreMenu]);

  // ── VAD — continuous listening ───────────
  const { isListening: _vadListening } = useVoiceActivityDetection({
    enabled: vadEnabled,
    onSpeechStart: () => {
      setKevinEmotion('listening');
      setVoiceState('listening');
    },
    onSpeechEnd: (uri) => {
      setKevinEmotion(null);
      processAudioUri(uri);
    },
  });

  // ── Volume button trigger ────────────────
  useVolumeButtonTrigger({
    enabled: isRoundActive,
    onTrigger: handleMicPress,
  });

  // ── Round summary ────────────────────────
  const generateRoundSummary = async () => {
    const total = getTotalScore();
    const vspar = getScoreVsPar();
    const played = getHolesPlayed();
    const relState = useRelationshipStore.getState();

    let summary = '';

    if (played < 9) {
      summary = 'Short round. What you can control — you controlled.';
    } else if (vspar <= -3) {
      summary =
        "That's a strong round. " + Math.abs(vspar) + ' under is real golf.';
    } else if (vspar === 0) {
      summary = 'Even par. That takes real discipline. Well done.';
    } else if (vspar <= 3) {
      summary =
        total + " on the card. Solid effort today. Let's review what worked.";
    } else if (vspar <= 7) {
      summary =
        'Tough one. The game does that sometimes. We know what to work on.';
    } else {
      summary =
        'Hard day out there. Every round teaches you something. We\'ll build on it.';
    }

    const best = usePlayerProfileStore.getState().personalBest;
    if (best && total > 0 && total < best) {
      summary = 'New personal best — ' + total + ". That's what we came for.";
      relState.recordBreakthrough(
        'New personal best: ' + total,
        relState.roundsTogether,
      );
    }

    setCaddieResponse(summary);

    if (voiceEnabled) {
      await configureAudioForSpeech();
      await speak(summary, voiceGender, language, apiUrl);
    }

    usePointsStore.getState().addPoints(
      Math.max(10, 50 - Math.max(0, vspar * 2)),
      'Round completed',
    );

    // Kick off recap generation asynchronously — don't block the summary
    const storeState = useRoundStore.getState();
    const roundId = storeState.currentRoundId;
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
        plans: storeState.plans,
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
      })
        .then(recap => {
          setRecapLoading(false);
          router.push(('/recap/' + recap.round_id) as never);
        })
        .catch(() => {
          setRecapLoading(false);
          setCaddieResponse("Round saved. Your recap will be ready next time you open the app — something went sideways on my end.");
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
    },
  ): Promise<void> => {
    if (!canAccess('round_start', subscription_status)) {
      setShowRoundSetup(false);
      void triggerPaywall('round_start', () => router.push('/paywall' as never));
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    let courseName = picked.name ?? 'Unknown Course';
    let holes = getCourse('palms')?.holes ?? [];
    let courseId: string | null = null;

    if (picked.isLocal) {
      const localId = picked.id.replace('local:', '');
      const local = getCourse(localId);
      courseName = local?.name ?? picked.name;
      holes = local?.holes ?? [];
    } else {
      courseId = picked.id;
      courseName = picked.name;
      try {
        const apiCourse = await getApiCourse(courseId);
        if (apiCourse && apiCourse.tees.length > 0) {
          holes = courseToHoles(apiCourse);
          courseName = apiCourse.club_name;
        }
      } catch {
        setCaddieResponse("Couldn't load the course layout — starting with yardages only. You can still play.");
      }
    }

    if (holes.length === 0) {
      holes = getCourse('palms')?.holes ?? [];
    }

    startRound(courseName, holes, {
      nineHole: opts.nineHole,
      isCompetition: opts.isCompetition,
      notes: opts.notes,
      goal: null,
      courseId,
      mode: opts.mode,
    });

    if (courseId) {
      fetchCourseGeometry(courseId).catch(err => console.log('[caddie] geometry warm failed:', err));
    }

    // Phase V.7+ — pre-warm GPS at round start so the foreground permission
    // prompt fires NOW (in the parking lot, not on hole 1 mid-shot) and the
    // first GPS fix is already cached by the time the user looks at hole-view
    // yardage. Idempotent — gpsManager.start is a no-op if already running.
    void (async () => {
      try {
        const Location = await import('expo-location');
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) {
          console.log('[caddie] location permission not granted at round start');
          return;
        }
        const gps = await import('../../services/gpsManager');
        await gps.startGpsManager();
      } catch (e) {
        console.log('[caddie] gps prewarm failed:', e);
      }
    })();

    if (opts.ghostRoundId) {
      const ghostRecord = roundHistory.find(r => r.id === opts.ghostRoundId);
      if (ghostRecord) {
        const label = `${ghostRecord.courseName ?? 'Past round'} (${ghostRecord.totalScore})`;
        setActiveGhost({ source_round_id: opts.ghostRoundId, label });
        useGhostStore.getState().activateGhost(ghostRecord);
      }
    } else {
      clearActiveGhost();
      useGhostStore.getState().deactivateGhost();
    }

    incrementRounds();
    resetProactiveState();
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
  const handleLogHole = async () => {
    if (holeScore === 0) return;
    logScore(currentHole, holeScore);
    logPutts(currentHole, holePutts);
    useGhostStore.getState().updateHole(currentHole, holeScore);

    const par = getCurrentPar();
    const maxHole = nineHoleMode ? 9 : 18;
    const nextHole = currentHole + 1;

    useRelationshipStore.getState().updateMentalState(holeScore, par ?? 4);

    if (nextHole > maxHole) {
      clearShotPending();
      endRound();
      setShowShotCard(false);
      await generateRoundSummary();
      return;
    }

    setCurrentHole(nextHole);
    setHoleScore(0);
    setHolePutts(0);
    clearShotPending();
    setShowShotCard(false);

    const holePar = par ?? 4;
    const diff = holeScore - holePar;
    const nextHoleData = courseHoles.find(h => h.hole === nextHole);
    const scoreVsParSoFar = getScoreVsPar();

    let scoreWord = '';
    if (diff <= -2)       scoreWord = 'Eagle.';
    else if (diff === -1) scoreWord = 'Birdie.';
    else if (diff === 0)  scoreWord = 'Par.';
    else if (diff === 1)  scoreWord = 'Bogey.';
    else if (diff === 2)  scoreWord = 'Double.';
    else                   scoreWord = 'Leave it there.';

    let nextInfo = '';
    if (nextHoleData) {
      nextInfo =
        'Hole ' + nextHole +
        '. Par ' + nextHoleData.par +
        '. ' + nextHoleData.distance + ' yards.';
    }

    let contextLine = '';
    if (diff <= -1) {
      contextLine = diff === -1 ? ' Keep that going.' : " That's yours.";
    } else if (diff >= 2 && isSpiralRisk()) {
      contextLine = ' Reset now. Next hole is a fresh start.';
    } else if (diff === 1) {
      contextLine = ' Move on.';
    }

    let scoreContext = '';
    if (scoreVsParSoFar <= -3) {
      scoreContext =
        " You're " + Math.abs(scoreVsParSoFar) + ' under through ' + currentHole + '.';
    }

    const transition = scoreWord + contextLine + (nextInfo ? ' ' + nextInfo : '') + scoreContext;
    setCaddieResponse(transition);

    if (voiceEnabled && !discreteMode) {
      speak(transition, voiceGender, language, apiUrl).catch(() => {});
    }

    // ── Proactive Kevin evaluation (post-hole-transition) ──────────────
    if (proactive_kevin_enabled) {
      const storeNow = useRoundStore.getState();
      const recentScores: number[] = [];
      for (let h = Math.max(1, nextHole - 3); h < nextHole; h++) {
        const s = storeNow.scores[h];
        const hd = storeNow.courseHoles.find(ch => ch.hole === h);
        if (s != null && hd) recentScores.push(s - hd.par);
      }
      const ghostDelta = useGhostStore.getState().getSnapshot()?.overall_delta ?? null;
      const proactiveTrigger = shouldFireProactive({
        holesPlayed: nextHole - 1,
        currentHole: nextHole,
        recentScores,
        ghostDelta,
        dominantMiss: dominantMiss ?? null,
        firstName: firstName || '',
        mode: storeNow.mode,
        trustLevel,
      });
      if (proactiveTrigger) {
        markProactiveFired(proactiveTrigger.id);
        setTimeout(() => {
          setCaddieResponse(proactiveTrigger.message);
          setVoiceState('proactive');
          if (voiceEnabled && !discreteMode) {
            speak(proactiveTrigger.message, voiceGender, language, apiUrl)
              .catch(() => {})
              .finally(() => setVoiceState('idle'));
          } else {
            setTimeout(() => setVoiceState('idle'), 3000);
          }
        }, 2200);
      }
    }
  };

  // ── Mid-round mode change ────────────────
  const handleChangeModePress = () => {
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
  const totalHoles = nineHoleMode ? 9 : (courseHoles.length || 18);
  // targetDirection: not yet in aim engine — show CENTER until wired
  const targetDirection = 'CENTER';

  const currentStroke = useMemo(() => {
    // All penalties now flow through ShotResult (including More Menu addPenalty).
    // Legacy penalties[] field is no longer written to, so we read only from shots.
    const holeShots = shots.filter(s => s.hole === currentHole);
    if (holeShots.length > 0) {
      return holeShots.length + holeShots.reduce((acc, s) => acc + (s.penalty_strokes ?? 0), 0);
    }
    return 1; // no shots yet — first stroke
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
  return (
    <View style={styles.container}>

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
        if (isWide) {
          const cellW = (W - 36) / 2;
          const cellH = 280;
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
                  gender={voiceGender === 'female' ? 'female' : 'male'}
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
                  trustLevel={trustLevel as 1 | 2 | 3 | 4}
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
        // Stacked layout for narrow / Fold-closed. Cells shrunk to 180 tall
        // so the SmartVision card's bottom edge doesn't overlap the
        // SmartFinder card (which sits at bottom: 130 + insets.bottom).
        const cellW = W - 24;
        const cellH = 180;
        const gap = 10;
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
                gender={voiceGender === 'female' ? 'female' : 'male'}
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
                trustLevel={trustLevel as 1 | 2 | 3 | 4}
              />
            </View>
            <View
              style={{ position: 'absolute', top: cellTop + cellH + gap, left: 12, zIndex: 6 }}
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
        // his lower edge sits just above the SmartFinder card.
        <>
          {/* Sim-report — SmartVision card on L3, both pre-round and
              in-round. Palms behavior preserved by L1HolePreview's own
              fallback chain (default Palms image pre-round, Palms hole
              imagery in-round). New tile fills the empty top region of
              the L3 layout. */}
          <View
            style={{
              position: 'absolute',
              top: insets.top + 92,
              left: 16, right: 80,
              height: 100,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: '#00C896',
              overflow: 'hidden',
              backgroundColor: '#0d2418',
              zIndex: 6,
            }}
            pointerEvents="box-none"
          >
            <L1HolePreview onOpenSmartVision={openSmartVision} width={W - 96} height={100} />
          </View>
          <View
            style={{
              position: 'absolute',
              left: 0,
              width: W,
              bottom: 200 + insets.bottom,
              height: Math.round(H * 2 / 3 * (W >= 540 ? 0.8 : 1)),
            }}
          >
            <CaddieAvatar
              gender={voiceGender === 'female' ? 'female' : 'male'}
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
              trustLevel={trustLevel as 1 | 2 | 3 | 4}
            />
          </View>
        </>
      )}
      {trustLevel === 4 && (
        // L4 Full — Fold-open keeps the explicit 9:16 frame nudged up.
        // Fold-closed fills the entire space above the data strip so Kevin
        // isn't pushed off the top. Overlay icons (wind, ?, SmartFinder
        // reticle) all keep their existing absolute positions and zIndex
        // ordering above the avatar.
        <View
          style={
            W >= 540
              ? { position: 'absolute', top: -70, left: 0, width: W, height: avatarFrameHeight }
              : { position: 'absolute', top: 60, left: 0, right: 0, bottom: 130 + insets.bottom }
          }
        >
          <CaddieAvatar
            gender={voiceGender === 'female' ? 'female' : 'male'}
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
            trustLevel={trustLevel as 1 | 2 | 3 | 4}
          />
        </View>
      )}
      {trustLevel === 1 && (
        <>
          {/* L1 Quiet — locked design. Kevin's face does NOT show.
              The SmartPlay Caddie badge in the upper-left is the mic
              tap target (KevinAvatar wraps it for the liveliness ring).
              The lie-analysis camera lives on the right edge via the
              placements block below. SmartVision (L1HolePreview) and
              SmartFinder cards stack in the body so the player has
              hole context without Kevin's face on screen. */}
          <View style={{ position: 'absolute', top: insets.top + 60, left: 16, zIndex: 12 }}>
            <TouchableOpacity
              onPress={handleMicPress}
              accessibilityRole="button"
              accessibilityLabel="Talk to Kevin (Quiet Mode)"
            >
              <Animated.View style={{ position: 'relative', opacity: quietPulse }}>
                <KevinAvatar
                  state={kevinAvatarState}
                  presenceLevel={1}
                  sizeOverride={72}
                >
                  <Image
                    source={require('../../assets/avatars/smartplay_caddie_badge.png')}
                    style={{ width: 64, height: 64 }}
                    resizeMode="contain"
                  />
                </KevinAvatar>
                {/* Quiet/saver dot on the badge. Gray = quiet (Kevin
                    intentionally silent); orange = battery saver. */}
                <View
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    right: 2,
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: saverActive ? '#F5A623' : '#6b7280',
                    borderWidth: 2,
                    borderColor: '#060f09',
                  }}
                />
              </Animated.View>
            </TouchableOpacity>
          </View>

          {/* L1 Quiet — SmartVision card. Green border, no scope ticks
              (those belong to SmartFinder). Card stretches from below the
              badge area to just above the SmartFinder card so the hole
              preview gets real estate. */}
          {(() => {
            const cardTop = insets.top + 150;
            // SmartFinder card sits at bottom: 130 + insets.bottom and is
            // ~120px tall; leave an 8px gap so the two cards never touch.
            const smartFinderTopApprox = H - (130 + insets.bottom) - 120;
            const cardH = Math.max(180, smartFinderTopApprox - cardTop - 8);
            const cardW = W - 32;
            const headerH = 26;
            const innerW = cardW - 28;
            const innerH = cardH - headerH - 16;
            return (
              <View
                style={{
                  position: 'absolute',
                  left: 16,
                  right: 16,
                  top: cardTop,
                  zIndex: 7,
                  backgroundColor: 'rgba(13, 36, 24, 0.92)',
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: '#00C896',
                  paddingHorizontal: 14,
                  paddingTop: 8,
                  paddingBottom: 8,
                  shadowColor: '#00C896',
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.5,
                  shadowRadius: 10,
                  elevation: 8,
                  height: cardH,
                }}
                pointerEvents="box-none"
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: headerH }}>
                  <Text style={{ color: '#00C896', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }}>
                    SMARTVISION{isRoundActive ? ` · HOLE ${currentHole}` : ''}
                  </Text>
                </View>
                <View style={{ alignSelf: 'center', borderRadius: 8, overflow: 'hidden', width: innerW, height: innerH }}>
                  <L1HolePreview onOpenSmartVision={openSmartVision} width={innerW} height={innerH} />
                </View>
              </View>
            );
          })()}
        </>
      )}

      {/* TOP BANNER — SmartPlay Caddie wordmark across the very top, always
           visible. Sits above the existing top-nav row. */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 4,
          left: 0,
          right: 0,
          alignItems: 'center',
          zIndex: 22,
        }}
        pointerEvents="none"
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={styles.brandName}>SmartPlay</Text>
          <Text style={styles.brandSub}> Caddie</Text>
        </View>
      </View>

      {/* TOP NAV — sits below the SmartPlay banner. Free Play (mode badge)
           is now stacked above the right-side tools button rather than
           occupying the centered spot. */}
      <View style={[styles.topNav, { top: insets.top + 38 }]}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => router.replace('/(tabs)/scorecard' as never)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color="#6b7d72" />
        </TouchableOpacity>

        <View style={styles.modeBadgePlaceholder} />

        <View style={{ alignItems: 'flex-end' }}>
          {isRoundActive && (
            <TouchableOpacity
              style={[styles.modeBadge, { marginBottom: 4 }]}
              onPress={handleChangeModePress}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.modeBadgeText}>{ROUND_MODE_LABELS[mode]}</Text>
            </TouchableOpacity>
          )}
          {/* Phase R — quick scorecard glance */}
          <ScorecardChip />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexShrink: 0 }}>
          {/* SmartFinder quick-launch removed from the top nav — the
              SmartFinder card already renders on the side at L1/L2/L3
              (in-round) and as the L4 reticle, so the duplicate top-nav
              icon was redundant. SmartFinder is still reachable via the
              ••• tools menu. */}
          {/* Phase R round photo capture moved to the ••• tools menu so
              the top nav doesn't show two camera icons (lie-analysis
              camera on the right edge is the primary in-round affordance). */}
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => setShowMoreMenu(true)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="ellipsis-horizontal" size={24} color="#6b7d72" />
          </TouchableOpacity>
        </View>
        </View>
      </View>

      {/* TRIAL INDICATOR — only in final 3 days to avoid persistent clutter */}
      {subscription_status === 'trial' && daysLeft !== null && daysLeft <= 3 && (
        <View style={[styles.trialBanner, { top: insets.top + 52 }]}>
          <Text style={styles.trialBannerText}>
            {daysLeft > 0
              ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left in trial`
              : 'Trial ends today'}
          </Text>
        </View>
      )}
      {subscription_status === 'expired' && (
        <TouchableOpacity
          style={[styles.trialBanner, styles.trialBannerExpired, { top: insets.top + 52 }]}
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
      {(trustLevel === 2 || trustLevel === 3) && (
        <View style={{ position: 'absolute', top: insets.top + 240, right: 12, zIndex: 13 }}>
          <KevinHelpButton surface="caddie" />
        </View>
      )}

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
      {isRoundActive && (
        <View style={{ position: 'absolute', top: insets.top + (trustLevel === 4 ? 145 : 110), right: 12, zIndex: 11 }} pointerEvents="none">
          <WindArrow weather={caddieWeather} shotBearingDeg={caddieShotBearing} compact />
        </View>
      )}

      {/* SMARTFINDER CARD — Phase D-2 embedded rangefinder. Hidden at
           L4 (Full — collapses to a right-side reticle). At L1 Quiet
           the card renders both pre-round and in-round so the player
           keeps hole / yardage context without Kevin's face on screen. */}
      {((isRoundActive && trustLevel !== 4) || trustLevel === 1) && (
        <View
          style={{ position: 'absolute', left: 16, right: 16, bottom: 130 + insets.bottom, zIndex: 8 }}
          pointerEvents="box-none"
        >
          <SmartFinderCard />
        </View>
      )}

      {/* LIE ANALYSIS camera icon — placement varies by Trust Spectrum level.
           Spec (Phase H v2):
             L1 — paired with the SmartVision card at the top.
             L2 — adjacent to the ? help button on the right side.
             L3 — visible near Kevin / SmartFinder area.
             L4 — smaller, LEFT of the yellow SmartFinder reticle (which sits
                  at right: 12, bottom: 200 + insets.bottom). Voice is primary.
           Banner / Kevin avatar / yellow SmartFinder tappable / wind label /
           BREAK 90 badge / detail bar all unchanged across these moves. */}
      {isRoundActive && (() => {
        const baseStyle = {
          position: 'absolute' as const,
          backgroundColor: 'rgba(13, 36, 24, 0.85)',
          borderWidth: 1.5,
          borderColor: '#00C896',
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          shadowColor: '#00C896',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.55,
          shadowRadius: 8,
          elevation: 6,
        };
        // Per-level position + size
        const placements: Record<number, { top?: number; right?: number; bottom?: number; left?: number; size: number; zIndex: number }> = {
          1: { top: Math.round(H / 2) - 22, right: 12, size: 44, zIndex: 14 },
          2: { top: insets.top + 290, right: 12, size: 44, zIndex: 14 },
          3: { top: insets.top + 290, right: 12, size: 44, zIndex: 14 },
          4: { right: 12, bottom: 136 + insets.bottom, size: 56, zIndex: 14 },
        };
        const p = placements[trustLevel] ?? placements[2];
        return (
          <TouchableOpacity
            onPress={() => router.push('/lie-analysis' as never)}
            style={[baseStyle, {
              ...(p.top != null && { top: p.top }),
              ...(p.right != null && { right: p.right }),
              ...(p.bottom != null && { bottom: p.bottom }),
              ...(p.left != null && { left: p.left }),
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              zIndex: p.zIndex,
            }]}
            accessibilityRole="button"
            accessibilityLabel="Open Lie Analysis"
          >
            <Ionicons name="camera" size={Math.round(p.size * 0.46)} color="#00C896" />
          </TouchableOpacity>
        );
      })()}

      {/* L4 SmartVision ICON — telescope affordance to open hole-view
           or peek inline. Sits above the lie-analysis camera (which is
           at insets.top + 60 → mid-right via placements; SmartVision lives
           on the LEFT edge so they don't crowd each other). */}
      {trustLevel === 4 && (
        <>
          <TouchableOpacity
            onPress={openSmartVision}
            onLongPress={() => setL4VisionExpanded(v => !v)}
            delayLongPress={400}
            style={{
              position: 'absolute',
              left: 12,
              top: insets.top + 100,
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: 'rgba(13, 36, 24, 0.85)',
              borderWidth: 1.5,
              borderColor: '#00C896',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 14,
              shadowColor: '#00C896',
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.55,
              shadowRadius: 8,
              elevation: 6,
            }}
            accessibilityRole="button"
            accessibilityLabel="Open SmartVision · long-press to peek inline"
          >
            <Ionicons name="telescope-outline" size={20} color="#00C896" />
          </TouchableOpacity>
          {l4VisionExpanded && (
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setL4VisionExpanded(false)}
              style={{
                position: 'absolute', left: 64, right: 16,
                top: insets.top + 100, height: 160, zIndex: 13,
                borderRadius: 12, overflow: 'hidden',
                borderWidth: 1.5, borderColor: '#00C896', backgroundColor: '#0d2418',
              }}
            >
              <L1HolePreview onOpenSmartVision={openSmartVision} width={W - 80} height={160} />
            </TouchableOpacity>
          )}
        </>
      )}

      {/* L4 SmartFinder ICON — replaces the embedded card at L4. Sits on
           the right edge. Tap routes to /smartfinder; sim-report gap 3:
           long-press toggles an inline expanded SmartFinderCard overlay
           so the player can read yardages without leaving the L4 screen. */}
      {isRoundActive && trustLevel === 4 && (
        <>
          <TouchableOpacity
            onPress={() => router.push('/smartfinder' as never)}
            onLongPress={() => setL4FinderExpanded(v => !v)}
            delayLongPress={400}
            style={{
              position: 'absolute',
              right: 12,
              bottom: 200 + insets.bottom,
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: 'rgba(13, 36, 24, 0.85)',
              borderWidth: 1.5,
              borderColor: '#00C896',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 14,
              shadowColor: '#00C896',
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.55,
              shadowRadius: 8,
              elevation: 6,
            }}
            accessibilityRole="button"
            accessibilityLabel="Open SmartFinder · long-press to expand inline"
          >
            <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ position: 'absolute', width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#00C896' }} />
              <View style={{ position: 'absolute', width: 18, height: 1.5, backgroundColor: '#ffffff' }} />
              <View style={{ position: 'absolute', width: 1.5, height: 18, backgroundColor: '#ffffff' }} />
            </View>
          </TouchableOpacity>
          {l4FinderExpanded && (
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setL4FinderExpanded(false)}
              style={{
                position: 'absolute', left: 16, right: 80,
                bottom: 200 + insets.bottom, zIndex: 13,
              }}
            >
              <SmartFinderCard />
            </TouchableOpacity>
          )}
        </>
      )}

      {/* L1 SmartVision card is now rendered inside the L1 Quiet block
           above (stacked under Kevin's tile). This previous standalone
           bottom-anchored copy was removed when L1 was restructured to
           mirror the L2 Companion stack. */}

      {/* GREETING BUBBLE — pre-round only, sits in negative space above Start Round.
          Bottom = startRoundBtn (40 + 60 height) + 24 clearance = 124. */}
      {!isRoundActive && shownText && trustLevel !== 1 ? (
        <Animated.View
          style={[styles.bubble, { bottom: 124 + insets.bottom, opacity: responseFade }]}
        >
          {/* Backdrop deliberately almost-transparent so Kevin's face shows through.
              Text legibility is preserved by the textShadow on bubbleText. */}
          <View style={[StyleSheet.absoluteFill, styles.bubbleTint]} />
          <Text style={styles.bubbleText} numberOfLines={3}>
            {shownText}
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
          yardage={currentYardage}
          playsLike={playsLikeYardage}
          hole={{ current: currentHole, total: totalHoles }}
          targetDirection={targetDirection}
          stroke={currentStroke}
          visible={true}
          bottomOffset={insets.bottom}
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
          style={[styles.startRoundBtn, { bottom: 40 + insets.bottom }]}
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
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Start Round</Text>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            <Text style={styles.sheetLabel}>Course</Text>
            <CoursePicker
              selected={selectedPickedCourse}
              onSelect={setSelectedPickedCourse}
              onInfo={(courseId) => {
                setShowRoundSetup(false);
                router.push(`/course/${courseId}` as never);
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
        </TouchableOpacity>
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
              {useRoundStore.getState().getPlanForHole(currentHole) && !useRoundStore.getState().getPlanForHole(currentHole)?.locked_at && (
                <TouchableOpacity
                  style={styles.holeViewNudge}
                  onPress={() => {
                    setShowShotCard(false);
                    const hd = courseHoles.find(h => h.hole === currentHole);
                    router.push({
                      pathname: '/hole-view',
                      params: {
                        hole: String(currentHole),
                        par: String(hd?.par ?? currentPar ?? 4),
                        distance: String(currentYardage ?? hd?.distance ?? 150),
                        courseName: activeCourse ?? '',
                        isRoundActive: String(isRoundActive),
                        autoRunVision: 'false',
                        teeLat: String(hd?.teeLat ?? 0),
                        teeLng: String(hd?.teeLng ?? 0),
                        middleLat: String(hd?.middleLat ?? 0),
                        middleLng: String(hd?.middleLng ?? 0),
                        front: String(hd?.front ?? 0),
                        back: String(hd?.back ?? 0),
                      },
                    } as never);
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <AppIcon name="clipboard-outline" size={14} color="#00C896" />
                    <Text style={styles.holeViewNudgeText}>Lock Plan</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

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
              <Text style={styles.startBtnText}>Next Hole</Text>
            </TouchableOpacity>

            {isRoundActive && (
              <TouchableOpacity
                style={styles.endRoundBtn}
                onPress={async () => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                  endRound();
                  clearShotPending();
                  setShowShotCard(false);
                  await generateRoundSummary();
                }}
              >
                <Text style={styles.endRoundText}>End Round</Text>
              </TouchableOpacity>
            )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── MORE MENU SHEET ─────────────────── */}
      <Modal
        visible={showMoreMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMoreMenu(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          onPress={() => setShowMoreMenu(false)}
          activeOpacity={1}
        >
          <View style={styles.moreSheet}>
            <View style={styles.handle} />
            <Text style={styles.moreTitle}>Tools</Text>

            {/* Status row — pinned at the top of the sheet so the round
                state is visible at a glance whenever Tools is open. */}
            {isRoundActive && (
              <View style={styles.toolsStatusRow}>
                <View style={styles.toolsStatusItem}>
                  <Text style={styles.toolsStatusLabel}>MODE</Text>
                  <Text style={styles.toolsStatusValue}>{ROUND_MODE_LABELS[mode]}</Text>
                </View>
                <View style={styles.toolsStatusDivider} />
                <View style={styles.toolsStatusItem}>
                  <Text style={styles.toolsStatusLabel}>HOLE</Text>
                  <Text style={styles.toolsStatusValue}>{currentHole}</Text>
                </View>
                <View style={styles.toolsStatusDivider} />
                <View style={styles.toolsStatusItem}>
                  <Text style={styles.toolsStatusLabel}>SCORE</Text>
                  <Text style={styles.toolsStatusValue}>{getTotalScore() || '—'}</Text>
                </View>
                <View style={styles.toolsStatusDivider} />
                <View style={styles.toolsStatusItem}>
                  <Text style={styles.toolsStatusLabel}>VOICE</Text>
                  <Text style={[styles.toolsStatusValue, { color: voiceEnabled ? '#00C896' : '#6b7280' }]}>
                    {voiceEnabled ? 'ON' : 'OFF'}
                  </Text>
                </View>
              </View>
            )}

            <ScrollView
              style={styles.moreScroll}
              contentContainerStyle={styles.moreScrollContent}
              showsVerticalScrollIndicator
            >

            {(([
              // Pre-beta — Discrete Mode quick-toggle. First entry by design:
              // when a player needs Kevin silent right now (quiet group, on a
              // tee, etc.), the action must be the very first thing in the
              // menu. Label flips between Quiet ↔ Resume based on current
              // trust level.
              { icon: trustLevel === 1 ? 'volume-high-outline' as IconName : 'volume-mute-outline' as IconName,
                label: trustLevel === 1 ? 'Resume Kevin' : 'Quiet Mode',
                sub: trustLevel === 1 ? 'Bring Kevin back to Companion' : "Mute Kevin until I'm ready",
                action: () => { setShowMoreMenu(false); setTrustLevel(trustLevel === 1 ? 2 : 1); } },
              { icon: 'options-outline',     label: `Kevin's Presence: ${TRUST_LEVEL_META[trustLevel].label}`, sub: `${TRUST_LEVEL_META[trustLevel].one_liner} · Tap to cycle`, action: () => { const next = (((trustLevel) % 4) + 1) as TrustLevel; setTrustLevel(next); } },
              { icon: 'golf-outline',        label: 'Practice',         sub: 'Cage & swing lab',         action: () => { setShowMoreMenu(false); router.push('/(tabs)/swinglab' as never); } },
              { icon: 'videocam-outline',    label: 'Cage Mode',        sub: 'Range session',            action: () => { setShowMoreMenu(false); if (!canAccess('cage_mode', subscription_status)) { void triggerPaywall('cage_mode', () => router.push('/paywall' as never)); return; } router.push('/cage' as never); } },
              { icon: 'telescope-outline',   label: 'SmartVision',      sub: 'Analyze the hole',         action: () => { setShowMoreMenu(false); openSmartVision(); } },
              { icon: 'locate-outline',      label: 'SmartFinder',      sub: 'Tap-to-lock rangefinder',  action: () => { setShowMoreMenu(false); if (!canAccess('smartfinder', subscription_status)) { void triggerPaywall('smartfinder', () => router.push('/paywall' as never)); return; } router.push('/smartfinder' as never); } },
              { icon: 'warning-outline',     label: 'Penalty Stroke',   sub: 'Water · OB · Lost ball',   action: () => { if (isRoundActive) addPenalty(currentHole); setShowMoreMenu(false); } },
              ...(isRoundActive ? [{
                icon: 'camera-outline' as IconName, label: 'Capture Photo', sub: 'Add a memory to this round',
                action: async () => {
                  setShowMoreMenu(false);
                  try {
                    const perm = await ImagePicker.requestCameraPermissionsAsync();
                    if (!perm.granted) {
                      Alert.alert('Camera permission needed', 'Allow camera access to capture round photos.');
                      return;
                    }
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    const result = await ImagePicker.launchCameraAsync({
                      mediaTypes: ImagePicker.MediaTypeOptions.Images,
                      quality: 0.7, allowsEditing: false,
                    });
                    if (result.canceled || !result.assets[0]?.uri) return;
                    useRoundStore.getState().addRoundPhoto(result.assets[0].uri);
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  } catch (e) { console.log('[capture-photo] error', e); }
                },
              }] : []),
              ...(isRoundActive ? [{
                icon: 'flag-outline' as IconName, label: 'End Round',   sub: 'Finish and get summary',   action: async () => { setShowMoreMenu(false); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); clearShotPending(); endRound(); await generateRoundSummary(); },
              }] : []),
              { icon: 'tv-outline',          label: castMode ? 'Cast Mode On' : 'Cast Mode',     sub: 'Mirror to TV',                  action: () => setCastMode(!castMode) },
              { icon: voiceEnabled ? 'volume-high-outline' : 'volume-mute-outline', label: voiceEnabled ? 'Voice On' : 'Voice Off',  sub: "Toggle Kevin's voice", action: () => setVoiceEnabled(!voiceEnabled) },
              { icon: 'library-outline',     label: 'Tutorials',        sub: 'How each tool works',      action: () => { setShowMoreMenu(false); router.push('/tutorials' as never); } },
              { icon: 'book-outline',        label: 'Rules & Handicap', sub: 'Quick reference + WHS calculator', action: () => { setShowMoreMenu(false); router.push('/reference' as never); } },
              { icon: 'logo-youtube',        label: 'YouTube Channel',  sub: '@smartplaycaddie',         action: () => { Linking.openURL('https://youtube.com/@smartplaycaddie').catch(() => {}); setShowMoreMenu(false); } },
              { icon: 'settings-outline',    label: 'Settings',         sub: 'App preferences',          action: () => { setShowMoreMenu(false); router.push('/settings' as never); } },
            ]) as { icon: IconName; label: string; sub: string; action: () => void | Promise<void> }[]).map(item => (
              <TouchableOpacity
                key={item.label}
                style={styles.moreItem}
                onPress={item.action}
                activeOpacity={0.8}
              >
                <View style={styles.moreIconWrap}>
                  <AppIcon name={item.icon} size={22} color="#00C896" />
                </View>
                <View style={styles.moreText}>
                  <Text style={styles.moreLabel}>{item.label}</Text>
                  <Text style={styles.moreSub}>{item.sub}</Text>
                </View>
              </TouchableOpacity>
            ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  topNav: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    backgroundColor: '#060f09',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
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
    zIndex: 5,
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
    backgroundColor: '#0d2418',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
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
    borderTopColor: '#1e3a28',
    maxHeight: '85%',
  },
  moreScroll: {
    flexGrow: 0,
  },
  toolsStatusRow: {
    flexDirection: 'row',
    backgroundColor: '#0d2418',
    borderWidth: 1,
    borderColor: '#1e3a28',
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 14,
    alignItems: 'center',
  },
  toolsStatusItem: { flex: 1, alignItems: 'center' },
  toolsStatusLabel: { color: '#6b7280', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  toolsStatusValue: { color: '#ffffff', fontSize: 13, fontWeight: '800', marginTop: 2 },
  toolsStatusDivider: { width: 1, height: 26, backgroundColor: '#1e3a28' },
  moreScrollContent: {
    paddingBottom: 24,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#1e3a28',
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
    borderColor: '#1e3a28',
    backgroundColor: '#060f09',
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
    backgroundColor: '#0d1a0d',
    borderColor: '#1e3a28',
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
    backgroundColor: '#1e3a28',
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
    backgroundColor: '#0d2418',
    borderWidth: 1,
    borderColor: '#1e3a28',
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
    borderBottomColor: '#1e3a28',
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
    borderColor: '#1e3a28',
    backgroundColor: '#0d2418',
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
    borderColor: '#1e3a28',
    backgroundColor: '#060f09',
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
    borderColor: '#1e3a28',
    backgroundColor: '#060f09',
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
    backgroundColor: '#0d2418',
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
    borderColor: '#1e3a28',
    backgroundColor: '#0d2418',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  shotChipText: {
    color: '#9ca3af',
    fontSize: 11,
  },
});
