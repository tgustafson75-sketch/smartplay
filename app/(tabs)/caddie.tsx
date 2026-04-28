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
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';
import CaddieAvatar, { VoiceState } from '../../components/CaddieAvatar';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useCageStore } from '../../store/cageStore';
import { usePointsStore } from '../../store/pointsStore';
import { getCourseList, getCourse } from '../../data/courses';
import CoursePicker, { type PickedCourse } from '../../components/CoursePicker';
import { type RoundMode, ROUND_MODE_LABELS, ROUND_MODE_CARDS } from '../../types/patterns';
import { getCourse as getApiCourse, courseToHoles } from '../../services/golfCourseApi';
import { generateRecap } from '../../services/recapGenerator';
import { generatePatternInsights } from '../../services/patternDetection';
import { useGhostStore } from '../../store/ghostStore';
import { listArchivedRecaps } from '../../services/planStorage';
import { useVoiceCaddie } from '../../hooks/useVoiceCaddie';
import { useKevin, type ToolAction } from '../../hooks/useKevin';
import { useKevinPresence } from '../../contexts/KevinPresenceContext';
import { useVoiceActivityDetection } from '../../hooks/useVoiceActivityDetection';
import { useVolumeButtonTrigger } from '../../hooks/useVolumeButtonTrigger';
import { speak, configureAudioForSpeech } from '../../services/voiceService';
import { kevinText as kevinTextStyle } from '../../styles/typography';
import CaddieDataStrip from '../../components/CaddieDataStrip';
import { canAccess, trialDaysLeft } from '../../services/featureAccess';

const NULL_HUD = { hole: null, par: null, yards: null, wind: null, playsLike: null };

export default function CaddieTab() {
  useKeepAwake();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
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
    activeCourseId,
    courseHoles,
    scores,
    penalties,
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
  } = useRoundStore();

  const {
    voiceGender,
    voiceEnabled,
    discreteMode,
    castMode,
    language,
    autoListenEnabled,
    setVoiceEnabled,
    setCastMode,
    setAutoListenEnabled,
  } = useSettingsStore();

  const { firstName, goal, subscription_status, trial_started_at } = usePlayerProfileStore();
  const { skip_briefings } = useSettingsStore();
  const daysLeft = useMemo(
    () => trialDaysLeft(trial_started_at),
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
      return () => {
        setMode('badge');
        ScreenOrientation.unlockAsync();
      };
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
  const [holeScore, setHoleScore] = useState(0);
  const [holePutts, setHolePutts] = useState(0);

  const [selectedMode, setSelectedMode] = useState<RoundMode>('free_play');

  const [recapLoading, setRecapLoading] = useState(false);
  const [selectedGhostId, setSelectedGhostId] = useState<string | null>(null);

  // ── Ghost rehydration on mount ───────────
  useEffect(() => {
    if (!isRoundActive || !active_ghost) return;
    if (useGhostStore.getState().ghostRecord != null) return; // already live
    const record = roundHistory.find(r => r.id === active_ghost.source_round_id);
    if (record) useGhostStore.getState().activateGhost(record);
  }, []); // intentionally runs once on mount

  // ── Floating response text ───────────────
  const displayText = caddieResponse || openingPrompt;
  const [shownText, setShownText] = useState(displayText);
  const responseFade = useRef(new Animated.Value(1)).current;

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
  }, [displayText]);

  const currentPar = getCurrentPar();

  const totalScore  = useMemo(() => getTotalScore(),  [scores]);
  const scoreVsPar  = useMemo(() => getScoreVsPar(),  [scores, courseHoles]);
  const holesPlayed = useMemo(() => getHolesPlayed(), [scores]);

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
  }, []);

  // ── SmartVision ──────────────────────────
  const openSmartVision = () => {
    if (!canAccess('smartvision', subscription_status)) {
      router.push('/paywall' as never);
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
        setCaddieResponse("Rangefinder's coming — I'll use GPS for now. What's your yardage?");
        break;
      default:
    }
  }, [openSmartVision, club, router]);

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

  // ── VAD — continuous listening ───────────
  const { isListening: vadListening } = useVoiceActivityDetection({
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
        ghostSnapshot: useGhostStore.getState().getSnapshot(),
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
  const handleStartRound = async () => {
    if (!canAccess('round_start', subscription_status)) {
      setShowRoundSetup(false);
      router.push('/paywall' as never);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    let courseName = 'Unknown Course';
    let holes = getCourse('palms')?.holes ?? [];
    let courseId: string | null = null;

    if (selectedPickedCourse) {
      if (selectedPickedCourse.isLocal) {
        // Local course (Palms etc.)
        const localId = selectedPickedCourse.id.replace('local:', '');
        const local = getCourse(localId);
        courseName = local?.name ?? selectedPickedCourse.name;
        holes = local?.holes ?? [];
      } else {
        // API course
        courseId = selectedPickedCourse.id;
        courseName = selectedPickedCourse.name;
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
    }

    if (holes.length === 0) {
      holes = getCourse('palms')?.holes ?? [];
    }

    startRound(courseName, holes, {
      nineHole,
      isCompetition,
      notes: roundNotes,
      goal: null,
      courseId,
      mode: selectedMode,
    });

    // Commit ghost selection and activate runtime store
    if (selectedGhostId) {
      const ghostRecord = roundHistory.find(r => r.id === selectedGhostId);
      if (ghostRecord) {
        const label = `${ghostRecord.courseName ?? 'Past round'} (${ghostRecord.totalScore})`;
        setActiveGhost({ source_round_id: selectedGhostId, label });
        useGhostStore.getState().activateGhost(ghostRecord);
      }
    } else {
      clearActiveGhost();
      useGhostStore.getState().deactivateGhost();
    }

    incrementRounds();
    setShowRoundSetup(false);
    setSelectedGhostId(null);

    if (skip_briefings) {
      const hole1 = useRoundStore.getState().courseHoles.find(h => h.hole === 1);
      if (hole1 && voiceEnabled) {
        const msg = 'Hole 1. Par ' + hole1.par + '. ' + hole1.distance + ' yards. Let\'s go.';
        setCaddieResponse(msg);
        speak(msg, voiceGender, language, apiUrl).catch(() => {});
      }
      return;
    }

    router.push('/round/briefing' as never);
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
      endRound();
      setShowShotCard(false);
      await generateRoundSummary();
      return;
    }

    setCurrentHole(nextHole);
    setHoleScore(0);
    setHolePutts(0);
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
  const courses = getCourseList();

  // ── Strip / start-round data ─────────────
  const totalHoles = nineHoleMode ? 9 : (courseHoles.length || 18);
  // targetDirection: not yet in aim engine — show CENTER until wired
  const targetDirection = 'CENTER';
  const currentStroke = (penalties[currentHole] ?? 0) + 1;

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
  }, [isRoundActive]);

  // ── RENDER ───────────────────────────────
  return (
    <View style={styles.container}>

      {/* KEVIN — 9:16 frame anchored at top; no over-zoom on any screen */}
      <View style={{ position: 'absolute', top: -60, left: 0, width: W, height: avatarFrameHeight }}>
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
        />
      </View>

      {/* TOP NAV */}
      <View style={[styles.topNav, { top: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => router.replace('/(tabs)/scorecard' as never)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color="#6b7d72" />
        </TouchableOpacity>

        {/* Mode badge — visible only when round is active */}
        {isRoundActive ? (
          <TouchableOpacity
            style={styles.modeBadge}
            onPress={handleChangeModePress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.modeBadgeText}>{ROUND_MODE_LABELS[mode]}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.modeBadgePlaceholder} />
        )}

        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setShowMoreMenu(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="ellipsis-horizontal" size={24} color="#6b7d72" />
        </TouchableOpacity>
      </View>

      {/* TRIAL INDICATOR */}
      {subscription_status === 'trial' && daysLeft !== null && (
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
          onPress={() => router.push('/paywall' as never)}
        >
          <Text style={[styles.trialBannerText, styles.trialBannerExpiredText]}>
            Trial ended — Subscribe
          </Text>
        </TouchableOpacity>
      )}

      {/* GREETING BUBBLE — pre-round only, sits in negative space above Start Round */}
      {!isRoundActive && shownText ? (
        <Animated.View
          style={[styles.bubble, { bottom: 144 + insets.bottom, opacity: responseFade }]}
        >
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.bubbleTint]} />
          <Text style={styles.bubbleText} numberOfLines={3}>
            {shownText}
          </Text>
        </Animated.View>
      ) : null}

      {/* DATA STRIP — cross-fades in when round starts */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: stripOpacity }]}
        pointerEvents={isRoundActive ? 'box-none' : 'none'}
      >
        <CaddieDataStrip
          yardage={currentYardage}
          playsLike={currentYardage}
          hole={{ current: currentHole, total: totalHoles }}
          targetDirection={targetDirection}
          stroke={currentStroke}
          visible={true}
          bottomOffset={insets.bottom}
          onPress={() => setShowShotCard(true)}
        />
      </Animated.View>

      {/* START ROUND CTA — cross-fades out when round starts */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: ctaOpacity }]}
        pointerEvents={isRoundActive ? 'none' : 'box-none'}
      >
        <TouchableOpacity
          style={[styles.startRoundBtn, { bottom: 40 + insets.bottom }]}
          onPress={() => setShowRoundSetup(true)}
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
            />

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

            <TouchableOpacity
              style={[styles.startBtn, !selectedPickedCourse && styles.startBtnDisabled]}
              onPress={handleStartRound}
              disabled={!selectedPickedCourse}
            >
              <Text style={styles.startBtnText}>
                {selectedPickedCourse ? "Let's Go" : 'Select a course to start'}
              </Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── SHOT CARD SHEET ─────────────────── */}
      <Modal
        visible={showShotCard}
        transparent
        animationType="slide"
        onRequestClose={() => setShowShotCard(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          onPress={() => setShowShotCard(false)}
          activeOpacity={1}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>
              {'Hole ' + currentHole + (currentPar ? ' · Par ' + currentPar : '')}
            </Text>

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
                  setShowShotCard(false);
                  await generateRoundSummary();
                }}
              >
                <Text style={styles.endRoundText}>End Round</Text>
              </TouchableOpacity>
            )}
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

            {([
              {
                icon: '🏌️',
                label: 'Practice',
                sub: 'Cage & swing lab',
                action: () => {
                  setShowMoreMenu(false);
                  router.push('/(tabs)/swinglab' as never);
                },
              },
              {
                icon: '⛳',
                label: 'Cage Mode',
                sub: 'Range session',
                action: () => {
                  setShowMoreMenu(false);
                  if (!canAccess('cage_mode', subscription_status)) {
                    router.push('/paywall' as never);
                    return;
                  }
                  router.push('/cage' as never);
                },
              },
              {
                icon: '🔭',
                label: 'SmartVision',
                sub: 'Analyze the hole',
                action: () => {
                  setShowMoreMenu(false);
                  openSmartVision();
                },
              },
              {
                icon: '⚠️',
                label: 'Penalty Stroke',
                sub: 'Water · OB · Lost ball',
                action: () => {
                  if (isRoundActive) addPenalty(currentHole);
                  setShowMoreMenu(false);
                },
              },
              ...(isRoundActive ? [{
                icon: '🏁',
                label: 'End Round',
                sub: 'Finish and get summary',
                action: async () => {
                  setShowMoreMenu(false);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                  endRound();
                  await generateRoundSummary();
                },
              }] : []),
              {
                icon: '📺',
                label: castMode ? 'Cast Mode On' : 'Cast Mode',
                sub: 'Mirror to TV',
                action: () => setCastMode(!castMode),
              },
              {
                icon: voiceEnabled ? '🔊' : '🔇',
                label: voiceEnabled ? 'Voice On' : 'Voice Off',
                sub: "Toggle Kevin's voice",
                action: () => setVoiceEnabled(!voiceEnabled),
              },
              {
                icon: '⚙️',
                label: 'Settings',
                sub: 'App preferences',
                action: () => {
                  setShowMoreMenu(false);
                  router.push('/settings' as never);
                },
              },
            ] as const).map(item => (
              <TouchableOpacity
                key={item.label}
                style={styles.moreItem}
                onPress={item.action}
                activeOpacity={0.8}
              >
                <Text style={styles.moreIcon}>{item.icon}</Text>
                <View style={styles.moreText}>
                  <Text style={styles.moreLabel}>{item.label}</Text>
                  <Text style={styles.moreSub}>{item.sub}</Text>
                </View>
              </TouchableOpacity>
            ))}
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
  bubble: {
    position: 'absolute',
    left: 24,
    right: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 40, 0.5)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    overflow: 'hidden',
    zIndex: 6,
    alignItems: 'center',
  },
  bubbleTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(13, 26, 13, 0.72)',
  },
  bubbleText: {
    fontSize: 17,
    fontWeight: '500',
    fontStyle: 'italic',
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: 24,
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
    padding: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#1e3a28',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 20,
    textAlign: 'center',
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
    marginTop: 24,
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
});
