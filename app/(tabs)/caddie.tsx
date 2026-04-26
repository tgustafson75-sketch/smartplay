import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import CaddieAvatar, { VoiceState } from '../../components/CaddieAvatar';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { getCourseList, getCourse } from '../../data/courses';
import { useVoiceCaddie } from '../../hooks/useVoiceCaddie';
import { speak } from '../../services/voiceService';

export default function CaddieTab() {
  useKeepAwake();
  const router = useRouter();

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
  } = useRoundStore();

  const {
    voiceGender,
    voiceEnabled,
    discreteMode,
    castMode,
    language,
    setVoiceEnabled,
    setCastMode,
  } = useSettingsStore();

  const { firstName, goal } = usePlayerProfileStore();

  const {
    roundsTogether,
    sessionsTogether,
    currentMentalState,
    heroMoments,
    incrementRounds,
  } = useRelationshipStore();

  // ── Local state ─────────────────────────
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [openingPrompt, setOpeningPrompt] = useState('');
  const [caddieResponse, setCaddieResponse] = useState('');
  const [showShotCard, setShowShotCard] = useState(false);
  const [showRoundSetup, setShowRoundSetup] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState('palms');
  const [nineHole, setNineHole] = useState(false);
  const [isCompetition, setIsCompetition] = useState(false);
  const [roundNotes, setRoundNotes] = useState('');
  const [holeScore, setHoleScore] = useState(0);
  const [holePutts, setHolePutts] = useState(0);

  const currentPar = getCurrentPar();

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

  // ── Voice hook ───────────────────────────
  const { handleMicPress } = useVoiceCaddie({
    onVoiceStateChange: (state) => setVoiceState(state),
    onResponseReceived: (text) => setCaddieResponse(text),
    onHeroMoment: () => {},
    onVisionTrigger: openSmartVision,
    onHeroReelView: () => {
      setCaddieResponse('Here are your best moments.');
      router.push('/(tabs)/dashboard' as never);
    },
  });

  // ── Start round ──────────────────────────
  const handleStartRound = () => {
    const course = getCourse(selectedCourse);
    if (!course) return;
    startRound(course.name, course.holes, {
      nineHole,
      isCompetition,
      notes: roundNotes,
      goal: null,
    });
    incrementRounds();
    setShowRoundSetup(false);
    setCaddieResponse("Let's go. One shot at a time.");
  };

  // ── Log hole score ───────────────────────
  const handleLogHole = () => {
    if (holeScore === 0) return;
    logScore(currentHole, holeScore);
    logPutts(currentHole, holePutts);

    // Capture par before setCurrentHole updates the store
    const par = getCurrentPar();

    const maxHole = nineHoleMode ? 9 : 18;
    const nextHole = currentHole + 1;

    if (nextHole > maxHole) {
      endRound();
      setShowShotCard(false);
      const finalMsg = "That's the round. Good work out there.";
      setCaddieResponse(finalMsg);
      if (voiceEnabled) {
        const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
        speak(finalMsg, voiceGender, language, apiUrl).catch(() => {});
      }
      useRelationshipStore.getState().updateMentalState(holeScore, par ?? 4);
      return;
    }

    setCurrentHole(nextHole);
    setHoleScore(0);
    setHolePutts(0);
    setShowShotCard(false);

    // Build hole transition message
    const diff = par ? holeScore - par : null;
    const scoreWord =
      diff === null  ? '' :
      diff <= -2     ? 'Eagle! ' :
      diff === -1    ? 'Birdie! ' :
      diff === 0     ? 'Par. ' :
      diff === 1     ? 'Bogey. ' :
      diff === 2     ? 'Double. ' :
                       'Moving on. ';

    const nextHoleData = courseHoles.find(h => h.hole === nextHole);
    const nextPar = nextHoleData?.par;
    const nextYards = nextHoleData?.distance;

    const nextInfo = nextHoleData
      ? `Hole ${nextHole}, par ${nextPar}${nextYards ? ', ' + nextYards + ' yards' : ''}.`
      : `Hole ${nextHole}.`;

    const message = scoreWord + nextInfo;
    setCaddieResponse(message);

    if (voiceEnabled && !discreteMode) {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
      speak(message, voiceGender, language, apiUrl).catch(() => {});
    }

    useRelationshipStore.getState().updateMentalState(holeScore, par ?? 4);
  };

  // ── HUD data ─────────────────────────────
  const hudData = {
    hole: isRoundActive ? currentHole : null,
    par: isRoundActive ? currentPar : null,
    yards: currentYardage,
    wind: null,
    playsLike: currentYardage,
  };

  const courses = getCourseList();

  // ── RENDER ───────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* KEVIN */}
      <CaddieAvatar
        gender={voiceGender === 'female' ? 'female' : 'male'}
        isOnCourse={isRoundActive}
        isCageMode={false}
        voiceState={voiceState}
        hud={hudData}
        openingPrompt={openingPrompt}
        caddieResponse={caddieResponse}
        onTap={handleMicPress}
      />

      {/* MIC BUTTON */}
      <TouchableOpacity
        style={[
          styles.micBtn,
          voiceState === 'listening' && styles.micBtnActive,
        ]}
        onPress={handleMicPress}
        activeOpacity={0.85}
      >
        <Text style={styles.micIcon}>
          {voiceState === 'listening' ? '⏹' : '🎙'}
        </Text>
        <Text style={styles.micLabel}>
          {voiceState === 'idle'      ? 'Tap to talk to Kevin' :
           voiceState === 'listening' ? 'Listening...' :
           voiceState === 'thinking'  ? 'Kevin is thinking...' :
                                        'Kevin is speaking...'}
        </Text>
      </TouchableOpacity>

      {/* THREE NAV ICONS */}
      <View style={styles.navRow}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() =>
            isRoundActive ? setShowShotCard(true) : setShowRoundSetup(true)
          }
        >
          <Text style={styles.navIcon}>⛳</Text>
          <Text style={styles.navLabel}>
            {isRoundActive ? 'Round' : 'Start'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => router.push('/(tabs)/swinglab' as never)}
        >
          <Text style={styles.navIcon}>🏌️</Text>
          <Text style={styles.navLabel}>Practice</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setShowMoreMenu(true)}
        >
          <Text style={styles.navIcon}>···</Text>
          <Text style={styles.navLabel}>More</Text>
        </TouchableOpacity>
      </View>

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

            <Text style={styles.sheetLabel}>Course</Text>
            <View style={styles.pillRow}>
              {courses.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.pill, selectedCourse === c.id && styles.pillActive]}
                  onPress={() => setSelectedCourse(c.id)}
                >
                  <Text style={[
                    styles.pillText,
                    selectedCourse === c.id && styles.pillTextActive,
                  ]}>
                    {c.id === 'palms' ? 'Palms' : c.id === 'lakes' ? 'Lakes' : 'Rancho'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

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

            <TouchableOpacity style={styles.startBtn} onPress={handleStartRound}>
              <Text style={styles.startBtnText}>Let's Go</Text>
            </TouchableOpacity>
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
                onPress={() => {
                  const isFirstRound = roundsTogether === 1;
                  endRound();
                  setShowShotCard(false);
                  const msg = isFirstRound
                    ? "First round together. I'll remember this one."
                    : "Good round. Let's review.";
                  setCaddieResponse(msg);
                  if (voiceEnabled && !discreteMode) {
                    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
                    speak(msg, voiceGender, language, apiUrl).catch(() => {});
                  }
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
                icon: '🔭',
                label: 'SmartVision',
                sub: 'Analyze the hole',
                action: () => {
                  setShowMoreMenu(false);
                  openSmartVision();
                },
              },
              {
                icon: '🏌️',
                label: 'SmartMotion',
                sub: 'In-round swing analysis',
                action: () => setShowMoreMenu(false),
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

    </SafeAreaView>
  );
}

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  micBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0d2418',
    borderWidth: 1.5,
    borderColor: '#00C896',
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  micBtnActive: {
    backgroundColor: '#003d20',
    borderColor: '#4ade80',
  },
  micIcon: {
    fontSize: 20,
  },
  micLabel: {
    color: '#00C896',
    fontSize: 15,
    fontWeight: '700',
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 24,
    paddingBottom: 8,
    paddingTop: 4,
    backgroundColor: '#060f09',
    flexShrink: 0,
  },
  navBtn: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  navIcon: {
    fontSize: 22,
  },
  navLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
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
});
