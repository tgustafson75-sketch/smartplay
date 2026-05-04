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
import { openYouTubeChannel } from '../../services/youtubeLinks';
import { type RoundMode, ROUND_MODE_LABELS, ROUND_MODE_CARDS } from '../../types/patterns';
import { getCourse as getApiCourse, courseToHoles } from '../../services/golfCourseApi';
import { generateRecap } from '../../services/recapGenerator';
import { buildFullPracticeContext } from '../../services/tutorialContext';
import { generatePatternInsights } from '../../services/patternDetection';
import { useGhostStore } from '../../store/ghostStore';
import { useVoiceCaddie } from '../../hooks/useVoiceCaddie';
import { useKevin, type ToolAction } from '../../hooks/useKevin';
import { useKevinPresence } from '../../contexts/KevinPresenceContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useVoiceActivityDetection } from '../../hooks/useVoiceActivityDetection';
import { useVolumeButtonTrigger } from '../../hooks/useVolumeButtonTrigger';
import { speak, configureAudioForSpeech, captureUtterance } from '../../services/voiceService';
// Phase Y — shotDetectionService lifecycle moved to app/_layout.tsx so it
// survives tab focus changes. Only the orchestrator's runtime configure()
// stays here (apiUrl/voice/language can change at any time).
import { conversationalLoggingOrchestrator } from '../../services/conversationalLoggingOrchestrator';
import { fetchCourseGeometry } from '../../services/courseGeometryService';
import WindArrow from '../../components/caddie/WindArrow';
import { useCurrentWeather } from '../../hooks/useCurrentWeather';
import { playsLikeDistance } from '../../utils/playsLike';
import SmartFinderCard from '../../components/smartfinder/SmartFinderCard';
import { useTrustLevelStore, TRUST_LEVEL_META, type TrustLevel } from '../../store/trustLevelStore';
// Phase U2 — KevinAvatar import removed. The L1 SmartPlay-badge mic-trigger
// it used to wrap was deleted in Phase AU; the import sat as orphan dead
// code with no JSX consumer. The component file itself is preserved for
// future re-use (see services/README.md). If a surface needs the
// liveliness ring again, re-import here from '../../components/kevin/KevinAvatar'.
import L1HolePreview from '../../components/caddie/L1HolePreview';
import { getFirstToolHint } from '../../services/voiceOnboardingService';
// Phase AT — KevinHelpButton import removed; ? button no longer rendered
// on caddie home (Tutorials in Tool menu is the discoverability path).
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
  // Phase AP — themed container background so theme + high-contrast toggles
  // produce immediate, visible change on the home tab. Brand accent and
  // L2/L3 avatar treatments stay literal (intentional brand consistency).
  const theme = useTheme();

  // Phase F — kevinAvatarState was derived below from voiceState/kevinThinking
  // for L1's mic-button KevinAvatar wrapping. Phase U2 removed the
  // declaration alongside the orphaned KevinAvatar import (Phase AU killed
  // L1's standalone badge mic-trigger, leaving this state unused).
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
  const _avatarMaxH = H - insets.top - insets.bottom - 56 - 160;
  const avatarFrameHeight = Math.min(Math.round(W * 16 / 9), _avatarMaxH);

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
  // Phase AY — yardageMode setting drives whether the data strip shows
  // GPS-driven (live) or static (preround/scorecard) yardage. Live mode
  // queries getGreenYardagesSync against the most recent GPS fix; if no
  // fix yet, falls back to static so the strip never renders "—".
  const yardageMode = useSettingsStore(s => s.yardageMode);
  const setYardageMode = useSettingsStore(s => s.setYardageMode);
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
  const liveYardage = useMemo(() => {
    if (yardageMode !== 'live' || !isRoundActive) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getGreenYardagesSync } = require('../../services/smartFinderService');
      const y = getGreenYardagesSync(currentHole);
      return y?.middle ?? null;
    } catch { return null; }
  }, [yardageMode, isRoundActive, currentHole, markTick]);

  const displayYardage = liveYardage ?? currentYardage;

  const playsLikeYardage = useMemo(() => {
    if (displayYardage == null) return displayYardage;
    if (!caddieWeather) return displayYardage;
    return playsLikeDistance(displayYardage, caddieWeather, caddieShotBearing).plays_like_yards;
  }, [displayYardage, caddieWeather, caddieShotBearing]);

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

  const currentPar = getCurrentPar();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const _totalScore  = useMemo(() => getTotalScore(),  [scores]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const _scoreVsPar  = useMemo(() => getScoreVsPar(),  [scores, courseHoles]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const _holesPlayed = useMemo(() => getHolesPlayed(), [scores]);

  // Derived early so animation effects can reference it.
  // Phase AB — also gate on voiceState !== 'speaking' so VAD pauses while
  // Kevin is talking. Otherwise VAD picks up Kevin's TTS as user input
  // (and a fast 1.5–2.5s silence after Kevin's last word would trigger an
  // empty submission). VAD restarts naturally once voiceState returns to
  // 'idle' via the useEffect dep on `vadEnabled` in
  // useVoiceActivityDetection.
  const vadEnabled = autoListenEnabled && isRoundActive && appActive && voiceState !== 'speaking';

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

    // Phase AV — SmartVision now routes to the dedicated GolfShot-class
    // screen (app/smartvision.tsx). The legacy hole-view (badge rows,
    // club selectors) remains available at /hole-view for fallback.
    router.push('/smartvision' as never);
    // Reference unused locals so existing destructure stays intact
    // for the back-compat hole-view payload below if we ever want it.
    void holeData; void hole; void currentYardage; void roundActive;
    return;
    // eslint-disable-next-line no-unreachable
    router.push({
      pathname: '/hole-view',
      params: {
        hole: String(hole),
        par: String(holeData?.par ?? 4),
        distance: String(currentYardage ?? holeData?.distance ?? 150),
        courseName: activeCourse ?? '',
        // Phase AG followup — courseId enables per-user GPS anchor capture
        // (override store lookup keyed by courseId+hole).
        courseId: useRoundStore.getState().activeCourseId ?? '',
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

  // Phase U2 — kevinAvatarState removed (dead code; see Phase F comment
  // above). Re-derive here if a future surface uses KevinAvatar again.

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
        // Phase BR Component 9 — active tutorial practice context.
        // buildFullPracticeContext returns null when no tutorials are
        // flagged active; api/recap.ts skips the practice block in that
        // case, so pre-BR rounds without tutorials are unchanged.
        practiceContext: buildFullPracticeContext(),
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
          // Phase Z/AA — post-round destination is the Scorecard tab. The
          // restored scorecard renders Kevin's recap inline + club summary
          // + share, so users get the round's story in one place. The
          // standalone /recap/[id] route is still available for deep-dive
          // hole-by-hole comparison via the Scorecard's recap link.
          router.replace('/(tabs)/scorecard' as never);
        })
        .catch(() => {
          setRecapLoading(false);
          setCaddieResponse("Round saved. Your recap will be ready next time you open the app — something went sideways on my end.");
          // Even on recap failure, route to scorecard — the round itself
          // saved and the user gets the all-holes view + club summary.
          try { router.replace('/(tabs)/scorecard' as never); } catch {}
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
        // Phase AY — fire a fresh fix + propagate immediately so all
        // hole-1 yardage displays (SmartFinder, DataStrip plays-like)
        // reflect the player's actual position at Start Round. Acts
        // like a synthetic Mark event without persisting it.
        const sf = await import('../../services/smartFinderService');
        await sf.refreshFix();
        const bus = await import('../../services/positionMarkBus');
        await bus.forceMarkPosition().catch(() => {});
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
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>

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
        // Phase AU — embedded SmartFinder card removed. Cells now only
        // need to clear the green-arrow dropdown row (bottom: 92 + ib,
        // height 52 → top at H − 144 − ib) plus a small buffer.
        const cellMaxBottom = H - (150 + insets.bottom);
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
        // Stacked layout for narrow / Fold-closed. Two cells stacked
        // with a 10px gap; each cell capped so the bottom of the
        // bottom cell stays clear of the SmartFinder card.
        const cellW = W - 24;
        const cellH = Math.min(220, Math.floor((cellMaxBottom - cellTop - 10) / 2));
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
        // his lower edge sits just above the dropdown row.
        <>
          {/* L3 SmartVision INLAY — Tim: "in bottom left of Kevin box,
              overlayed, not so big horizontally". Compact 140×100 tile
              anchored bottom-left of the Kevin avatar zone, zIndex
              above Kevin so it overlays. */}
          <View
            style={{
              position: 'absolute',
              left: 12,
              bottom: 158 + insets.bottom,
              width: 140,
              height: 100,
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
            <L1HolePreview onOpenSmartVision={openSmartVision} width={140} height={100} />
          </View>
          {/* L3 Kevin avatar — full L3 zone now that SmartVision is an
              overlay inlay (not a top card). Top clamp ensures Kevin
              starts at least below the topNav/banner row. */}
          <View
            style={{
              position: 'absolute',
              left: 0,
              width: W,
              bottom: 150 + insets.bottom,
              height: Math.min(
                Math.round(H * 2 / 3 * (W >= 540 ? 0.8 : 1)),
                H - (insets.top + 80) - (150 + insets.bottom),
              ),
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
        // ╔══════════════════════════════════════════════════════════╗
        // ║  LOCKED: Kevin photoreal portrait container (Phase AU)   ║
        // ║  Canonical: commit 19165fb (2026-04-26 12:43 PDT)        ║
        // ║                                                          ║
        // ║  Single rule for every aspect (Fold closed, Fold open,   ║
        // ║  standard phones): natural 9:16 frame at top: insets.top ║
        // ║  + 56 (clears the SmartPlay banner row uniformly), left: ║
        // ║  0, width = W, height = W·16/9. The +56 offset applies   ║
        // ║  to every aspect — it's NOT an aspect branch.            ║
        // ║                                                          ║
        // ║  Cover-mode in CaddieAvatar then frames Kevin canonically║
        // ║  without over-zoom on any device.                        ║
        // ║                                                          ║
        // ║  DO NOT add aspect-ratio branches, top:-70 nudges, or    ║
        // ║  per-fold offsets here. If a phase needs space above or  ║
        // ║  below Kevin, add it to the OTHER element, not the Kevin ║
        // ║  frame. See CLAUDE.md "Locked elements".                 ║
        // ╚══════════════════════════════════════════════════════════╝
        <View
          style={{ position: 'absolute', top: insets.top + 56, left: 0, width: W, height: avatarFrameHeight }}
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
              Voice entry on L1 lives in the universal green-arrow
              dropdown (mic icon, state-aware) — see the Phase AU note
              just below. The lie-analysis camera lives on the right
              edge via the placements block below. SmartVision
              (L1HolePreview) and SmartFinder cards stack in the body
              so the player has hole context without Kevin's face on
              screen. */}
          {/* Phase AU — L1 standalone SmartPlay badge mic-trigger removed.
              Voice entry on L1 now lives inside the universal green-arrow
              dropdown (mic icon, state-aware). Frees the upper-left
              corner of the Quiet surface per Tim's "move it to the green
              arrow tools for space" feedback. */}

          {/* L1 Quiet — SmartVision card. Green border, no scope ticks
              (those belong to SmartFinder). Card stretches from below the
              badge area to just above the SmartFinder card so the hole
              preview gets real estate.
              Phase AR follow-up — cardTop bumped insets.top+150 → +220
              so SmartVision sits lower on screen, closer to SmartFinder
              (per "too much space between SmartVision and SmartFinder"
              feedback). Card bottom remains anchored to (SmartFinder top
              - 4px), so the visual gap between the two cards is now
              minimal instead of empty middle-third real-estate. */}
          {(() => {
            // L1 SmartVision card. Top anchored at insets.top + 80.
            // Tim: "make box and holeview taller toward the bottom
            // with clean space above next card." Card extends down
            // to 24px above the dropdown chevron row (no aspect-ratio
            // cap on height — fills the available space).
            const cardTop = insets.top + 80;
            const dropdownTop = H - 144 - insets.bottom;
            const cardH = Math.max(200, dropdownTop - cardTop - 24);
            const cardW = W - 32;
            const headerH = 26;
            const innerW = cardW - 28;
            const innerH = Math.max(120, cardH - 6 - 4 - headerH);
            return (
              <View
                style={{
                  position: 'absolute',
                  left: 16,
                  right: 16,
                  top: cardTop,
                  height: cardH,
                  zIndex: 7,
                  backgroundColor: 'rgba(13, 36, 24, 0.92)',
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: '#00C896',
                  paddingHorizontal: 12,
                  paddingTop: 6,
                  paddingBottom: 4,
                  shadowColor: '#00C896',
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.5,
                  shadowRadius: 10,
                  elevation: 8,
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
          {/* Phase AR — Caddie word now consumes theme.text_primary so it
              flips white-on-dark / black-on-light. Was hardcoded white,
              which washed against the light-mode background. */}
          <Text style={[styles.brandSub, { color: theme.colors.text_primary }]}> Caddie</Text>
        </View>
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
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => router.replace('/(tabs)/scorecard' as never)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color="#6b7d72" />
        </TouchableOpacity>

        <View style={styles.modeBadgePlaceholder} />

        <View style={{ alignItems: 'flex-end' }}>
          {/* Tool ••• — ALWAYS visible in upper right (Tim: "Make sure
              tools pill is ALWAYS in upper right"). At L4 the green-arrow
              dropdown also contains a Tools entry as a convenience, but
              this corner pill remains the canonical anchor. */}
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => setShowMoreMenu(true)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="ellipsis-horizontal" size={24} color="#6b7d72" />
          </TouchableOpacity>
          {/* Phase AT follow-up — FREE PLAY mode badge removed from main
              view per Tim "we can see that in upper right tools dropdown".
              Mode is still displayed (and editable) in the Tools dropdown
              status row. */}
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
          is visible without weather data. */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 160,
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
          Position bottom: 92 + insets.bottom keeps it above DataStrip. */}
      {isRoundActive && (
        <View
          style={{
            position: 'absolute',
            bottom: 92 + insets.bottom,
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

              {/* SmartFinder rangefinder reticle */}
              <TouchableOpacity
                onPress={() => {
                  setL4ActionsExpanded(false);
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

              {/* MARK */}
              <TouchableOpacity
                onPress={async () => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  setL4ActionsExpanded(false);
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

              {/* Phase AU — Tools (•••) removed from inside the dropdown.
                  The upper-right corner pill is the canonical Tools
                  anchor; duplicating it here was the "duplicated tools
                  pill shortcut" Tim flagged. */}
            </ScrollView>
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
          yardage={displayYardage}
          playsLike={playsLikeYardage}
          hole={{ current: currentHole, total: totalHoles }}
          targetDirection={targetDirection}
          stroke={currentStroke}
          visible={true}
          // Phase AT — Tim wants the strip as LOW as possible. bottom: 0
          // pins it to the very bottom edge of the screen.
          bottomOffset={0}
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
                        courseId: useRoundStore.getState().activeCourseId ?? '',
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
              // Phase AY — Live / Pre-round yardage toggle. Switching to
              // 'live' fires a fresh GPS read (acts as a Mark backup if
              // the regular Mark didn't refresh things). 'preround' shows
              // static scorecard yardages (planning, or when GPS is
              // unreliable). Pinned to the top so it's always reachable
              // mid-round if the data strip's middle yardage looks stale.
              { icon: yardageMode === 'live' ? 'navigate-circle' as IconName : 'navigate-circle-outline' as IconName,
                label: `Yardage: ${yardageMode === 'live' ? 'LIVE (GPS)' : 'PRE-ROUND (static)'}`,
                sub: yardageMode === 'live' ? 'Tap to switch to scorecard yardages' : 'Tap to refresh GPS and go live',
                action: () => { setYardageMode(yardageMode === 'live' ? 'preround' : 'live'); } },
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
              { icon: 'tv-outline',          label: castMode ? 'Cast Mode On' : 'Cast Mode',     sub: 'Mirror to TV',                  action: () => { setShowMoreMenu(false); setCastMode(!castMode); } },
              { icon: voiceEnabled ? 'volume-high-outline' : 'volume-mute-outline', label: voiceEnabled ? 'Voice On' : 'Voice Off',  sub: "Toggle Kevin's voice", action: () => { setShowMoreMenu(false); setVoiceEnabled(!voiceEnabled); } },
              { icon: 'library-outline',     label: 'Tutorials',        sub: 'How each tool works',      action: () => { setShowMoreMenu(false); router.push('/tutorials' as never); } },
              { icon: 'book-outline',        label: 'Rules & Handicap', sub: 'Quick reference + WHS calculator', action: () => { setShowMoreMenu(false); router.push('/reference' as never); } },
              // Phase V.7+ — user-initiated GPS recalibration. Drops the
              // current subscription + cached fix, pulls a single Highest-
              // accuracy fix, restarts the watch in active mode. Useful when
              // yardages feel off (under trees, by water, after backgrounding).
              { icon: 'compass-outline',     label: 'GPS Calibration',  sub: 'Refresh signal & accuracy', action: async () => {
                  setShowMoreMenu(false);
                  // Phase V.7+ — haptic confirms the tap; single Alert when
                  // the result is in (avoids stacked Android alerts).
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  try {
                    const gps = await import('../../services/gpsManager');
                    const fix = await gps.recalibrateGps();
                    if (fix) {
                      const acc = fix.accuracy_m != null ? `~${Math.round(fix.accuracy_m)}m` : 'unknown';
                      Alert.alert('GPS', `Locked. Accuracy ${acc}.`);
                    } else {
                      Alert.alert('GPS', "Couldn't get a fresh fix. Step into the open and try again.");
                    }
                  } catch (e) {
                    console.log('[gps-calibration] error', e);
                    Alert.alert('GPS', 'Calibration failed. Try again in a moment.');
                  }
                } },
              { icon: 'logo-youtube',        label: 'YouTube Channel',  sub: '@smartplaycaddie',         action: () => { void openYouTubeChannel('@smartplaycaddie'); setShowMoreMenu(false); } },
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
