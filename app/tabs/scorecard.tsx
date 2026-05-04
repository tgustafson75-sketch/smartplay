import { View, Text, StyleSheet, ScrollView, Pressable, Image, TextInput, Animated, Modal, TouchableOpacity, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, useRef } from 'react';
import GlobalMenu from '../../components/GlobalMenu';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons as MCIcon } from '@expo/vector-icons';
import { DS, Palette, Space, Type, Radius } from '../../constants/theme';
import { useLayout } from '../../hooks/use-layout';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { speakJob, PRIORITY as ENGINE_PRIORITY } from '../../services/voice';
import { auth } from '../../lib/firebase';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { usePointsStore } from '../../store/pointsStore';

const ICON_RANGEFINDER = require('../../assets/images/icon-rangefinder.png');
import { useMemoryStore } from '../../store/memoryStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useUserStore } from '../../store/userStore';
import { useRoundStore } from '../../store/roundStore';
import { useTranslation } from '../../hooks/useTranslation';
import { SplitLayout } from '../../components/SplitLayout';

type ShotEntry = { result: string; club: string; hole?: number };
type HoleEntry = { hole: number; par: number; scores: number[] };
const PERSONAL_BEST_KEY = 'scorecard:personal-best';
const PERSONAL_BEST_AWARD_PREFIX = 'scorecard:personal-best-award:';

type RoundStoreState = ReturnType<typeof useRoundStore.getState>;
type UserStoreState = ReturnType<typeof useUserStore.getState>;
type SettingsStoreState = ReturnType<typeof useSettingsStore.getState>;
type MemoryStoreState = ReturnType<typeof useMemoryStore.getState>;

// ── Safe sum helper for totals ──────────────────────────────────────
const safeSum = (arr: (number | null | undefined)[]): number =>
  arr.reduce<number>((sum, val) => sum + (val ?? 0), 0);

export default function Scorecard() {
  const tabBarHeight = useBottomTabBarHeight();
  const layout = useLayout();
  const { t } = useTranslation();
  const logoScale = useRef(new Animated.Value(1)).current;

  const animateLogo = () => {
    Animated.sequence([
      Animated.timing(logoScale, { toValue: 1.22, duration: 100, useNativeDriver: true }),
      Animated.timing(logoScale, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  };
  const { round, shots: shotsParam, pars: parsedParsParam, players: playersParam, multiRound: multiRoundParam, skins: skinsParam, course: courseParam } =
    useLocalSearchParams<{ round?: string; shots?: string; pars?: string; players?: string; multiRound?: string; skins?: string; course?: string }>();

  const storedCourse          = useRoundStore((s: RoundStoreState) => s.activeCourse);
  const storePlayers          = useRoundStore((s: RoundStoreState) => s.players);
  const storeActivePlayerCount = useRoundStore((s: RoundStoreState) => s.activePlayerCount);
  const storeMultiRound       = useRoundStore((s: RoundStoreState) => s.multiRound);
  const isRoundActive         = useRoundStore((s: RoundStoreState) => s.isRoundActive);
  const nineHoleMode          = useRoundStore((s: RoundStoreState) => s.nineHoleMode ?? false);

  const courseName: string = courseParam ?? (storedCourse || t('scorecard'));
  const parsedRound: number[] = round ? JSON.parse(round) : [];
  const parsedShots: ShotEntry[] = shotsParam ? JSON.parse(shotsParam) : [];
  const parsedPars: number[] = parsedParsParam ? JSON.parse(parsedParsParam) : [];

  // Players — prefer URL params (end-of-round navigation), fall back to live store
  const players: string[] = playersParam
    ? JSON.parse(playersParam)
    : storePlayers.slice(0, storeActivePlayerCount);

  // Per-hole scores — prefer URL params, fall back to live store
  const multiRound: HoleEntry[] = multiRoundParam ? JSON.parse(multiRoundParam) : storeMultiRound;

  const skinsData: number[] = skinsParam ? JSON.parse(skinsParam) : players.map(() => 0);

  const storeScores = useRoundStore((s: RoundStoreState) => s.scores);
  const scores = parsedRound.length > 0 ? parsedRound : storeScores;
  const pars = parsedPars.length > 0 ? parsedPars : [];
  const holeCount = nineHoleMode ? 9 : 18;
  const frontTotal = safeSum(scores.slice(0, 9));
  const backTotal = safeSum(scores.slice(9, 18));
  const grandTotal = frontTotal + backTotal;
  const coursePar = safeSum(pars.length > 0 ? pars.slice(0, holeCount) : []);
  const total = grandTotal;
  const totalPar = coursePar;
  const totalVsPar = pars.length > 0 ? total - totalPar : null;
  const holesPlayed = scores.slice(0, holeCount).filter((s: any) => s > 0).length;
  const clubUsage = useMemoryStore((s: MemoryStoreState) => (s.clubUsage ?? {}) as Record<string, number>);
  const clubList = Object.entries(clubUsage ?? {}).sort((a: any, b: any) => b[1] - a[1]);

  // ── Shot grouping ─────────────────────────────────────────────
  const getShotsByHole = (): Record<string, ShotEntry[]> => {
    const grouped: Record<string, ShotEntry[]> = {};
    parsedShots.forEach((shot: any) => {
      const key = String(shot.hole ?? 'unknown');
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(shot);
    });
    return grouped;
  };

  // ── Strokes lost analysis ─────────────────────────────────────
  const getStrokesLost = () => {
    let offTee = 0;
    let approach = 0;
    const byHole = getShotsByHole();
    Object.values(byHole).forEach((holeShots) => {
      holeShots.forEach((shot, index) => {
        if (shot.result !== 'straight') {
          if (index === 0) offTee++;
          else if (index === 1) approach++;
        }
      });
    });
    return { offTee, approach };
  };

  // ── Hole analysis ─────────────────────────────────────────────
  const getHoleAnalysis = () => {
    const byHole = getShotsByHole();
    return Object.keys(byHole).map((holeKey) => {
      let mistakes = 0; let right = 0; let left = 0;
      byHole[holeKey].forEach((shot: any) => {
        if (shot.result !== 'straight') {
          mistakes++;
          if (shot.result === 'right') right++;
          if (shot.result === 'left') left++;
        }
      });
      return { hole: holeKey, mistakes, right, left };
    });
  };

  const getWorstHole = () => {
    const analysis = getHoleAnalysis();
    if (analysis.length === 0) return null;
    return analysis.reduce((worst, h) => h.mistakes > worst.mistakes ? h : worst);
  };

  const getHoleInsight = () => {
    const worst = getWorstHole();
    if (!worst || worst.mistakes === 0) return 'No major problem holes — solid consistency.';
    if (worst.right > worst.left) return `Hole ${worst.hole} cost you the most. Right misses were the issue — adjust aim and clubface.`;
    if (worst.left > worst.right) return `Hole ${worst.hole} cost you the most. Left misses hurt you — focus on tempo and release.`;
    return `Hole ${worst.hole} had the most mistakes — focus on better targets.`;
  };

  // ── Miss counts ───────────────────────────────────────────────
  const getMissCounts = () => {
    let right = 0; let left = 0;
    parsedShots.forEach((s: any) => { if (s.result === 'right') right++; if (s.result === 'left') left++; });
    return { right, left };
  };

  // ── Multi-player helpers ──────────────────────────────────────
  const getPlayerTotals = () => players.map((_, i) => multiRound.reduce((sum, h) => sum + (h.scores[i] ?? 0), 0));

  const getHoleWinner = (holeEntry: HoleEntry): number[] => {
    const relevant = holeEntry.scores.slice(0, players.length);
    const lowest = Math.min(...relevant);
    return relevant.map((s: any, i: any) => s === lowest ? i : -1).filter((i: any) => i !== -1);
  };

  const getMatchStatus = () => {
    let youWins = 0; let oppWins = 0;
    multiRound.forEach((h) => {
      const winners = getHoleWinner(h);
      if (winners.length === 1) { if (winners[0] === 0) youWins++; else oppWins++; }
    });
    const diff = youWins - oppWins;
    if (diff > 0) return `You are ${diff} up`;
    if (diff < 0) return `You are ${Math.abs(diff)} down`;
    return 'All square';
  };

  const getPlayerInsights = () => {
    const totals = getPlayerTotals();
    if (totals.every((t) => t === 0)) return 'No scores recorded yet.';
    const yourScore = totals[0];
    const best = Math.min(...totals);
    const leaderIdx = totals.indexOf(best);
    if (leaderIdx === 0) return "You're leading — keep applying pressure.";
    const diff = yourScore - best;
    const { right, left } = getMissCounts();
    if (right > left && right >= 3) return `You're ${diff} behind. Right misses are costing you — focus on your target line.`;
    if (left > right && left >= 3) return `You're ${diff} behind. Left misses are costing you — control your release.`;
    return `You're ${diff} behind. Focus on consistency and smart targets.`;
  };

  // ── Post-round analysis ───────────────────────────────────────
  const getStrokesInsight = (strokesLost: { offTee: number; approach: number }) => {
    if (strokesLost.offTee > strokesLost.approach) return "You're losing most strokes off the tee — prioritize accuracy and clubface control.";
    if (strokesLost.approach > strokesLost.offTee) return 'Approach shots are costing you — focus on distance control and tempo.';
    return 'Balanced performance — tighten up both areas slightly.';
  };

  const getPostRoundPracticePlan = () => {
    const sl = getStrokesLost();
    const worst = getWorstHole();
    const { right, left } = getMissCounts();
    const plan: string[] = [];
    if (sl.offTee > sl.approach) plan.push('Work on driving accuracy — focus on clubface control and alignment.');
    if (sl.approach > sl.offTee) plan.push('Dial in approach shots — focus on tempo and distance control.');
    if (right > left) plan.push('Fix right miss — practice inside swing path and earlier release.');
    if (left > right) plan.push('Control left miss — work on tempo and avoid over-rotation.');
    if (worst && worst.mistakes > 0) plan.push(`Review Hole ${worst.hole} — focus on smarter target selection.`);
    return plan.length > 0 ? plan : ['Keep building consistency — solid round overall.'];
  };

  const getAdvancedCoaching = () => {
    const sl = getStrokesLost();
    const worst = getWorstHole();
    const { right, left } = getMissCounts();
    let msg = '';
    if (sl.offTee > sl.approach) msg += 'Your biggest issue today was off the tee. ';
    else if (sl.approach > sl.offTee) msg += 'Approach shots cost you the most today. ';
    if (right > left) msg += "You're consistently missing right — focus on clubface control and inside path. ";
    else if (left > right) msg += 'Left misses showed up — work on tempo and release. ';
    if (worst && worst.mistakes > 0) msg += `Hole ${worst.hole} was your toughest — smarter targets would save strokes. `;
    if (!msg) return 'Solid performance — you\'re building consistency across your game.';
    return msg + 'Stay patient — you\'re close to a breakthrough.';
  };

  const getRoundWinner = () => {
    const totals = getPlayerTotals();
    if (totals.every((t) => t === 0)) return 'N/A';
    const best = Math.min(...totals);
    return totals.map((t, i) => t === best ? players[i] : null).filter(Boolean).join(', ');
  };

  const getSkinsWinner = () => {
    if (skinsData.every((s: any) => s === 0)) return 'No skins yet';
    const best = Math.max(...skinsData);
    return skinsData.map((s, i) => s === best ? players[i] : null).filter(Boolean).join(', ');
  };

  const getClubInsights = () => {
    if (parsedShots.length === 0) return 'No shots logged yet. Start hitting and log your results.';
    const clubStats: Record<string, { left: number; right: number; straight: number; total: number }> = {};
    parsedShots.forEach((shot: any) => {
      if (!clubStats[shot.club]) clubStats[shot.club] = { left: 0, right: 0, straight: 0, total: 0 };
      clubStats[shot.club][shot.result as 'left' | 'right' | 'straight']++;
      clubStats[shot.club].total++;
    });
    let insight = '';
    Object.keys(clubStats).forEach((club) => {
      const s = clubStats[club];
      if (s.total < 5) {
        insight += `${club}: ${s.total} shot${s.total !== 1 ? 's' : ''} logged so far\n`;
      } else {
        if (s.right > s.left && s.right > s.straight) insight += `${club}: miss right\n`;
        else if (s.left > s.right && s.left > s.straight) insight += `${club}: miss left\n`;
        else if (s.straight >= s.left && s.straight >= s.right) insight += `${club}: reliable\n`;
      }
    });
    return insight.trim() || 'No clear club patterns yet';
  };

  // ── Shot dispersion helper ────────────────────────────────────
  const getShotPosition = (result: string, index: number) => {
    const offset = index * 8;
    if (result === 'left') return { left: 20 - offset, top: 50 + offset };
    if (result === 'right') return { left: 80 + offset, top: 50 + offset };
    return { left: 50 + offset / 2, top: 40 + offset };
  };

  const shotsByHole = getShotsByHole();
  const strokesLost = getStrokesLost();
  const playerTotals = getPlayerTotals();

  const registeredName = useUserStore((s: UserStoreState) => s.name);
  const isGuest        = useUserStore((s: UserStoreState) => s.isGuest);
  // Player 1 display name: only show persisted name when actually logged in
  const player1DisplayName = (!isGuest && registeredName && registeredName !== 'You') ? registeredName : 'You';
  const handicapIndex = useUserStore((s: UserStoreState) => s.handicap);
  const setIsGuest = useUserStore((s: UserStoreState) => s.setIsGuest);
  const voiceEnabled    = useSettingsStore((s: SettingsStoreState) => s.voiceEnabled);
  const setVoiceEnabled = useSettingsStore((s: SettingsStoreState) => s.setVoiceEnabled);
  const voiceStyle     = useSettingsStore((s: SettingsStoreState) => s.voiceStyle);
  const setVoiceStyle  = useSettingsStore((s: SettingsStoreState) => s.setVoiceStyle);
  const voiceGender    = useSettingsStore((s: SettingsStoreState) => s.voiceGender);
  const setVoiceGender = useSettingsStore((s: SettingsStoreState) => s.setVoiceGender);
  const highContrast    = useSettingsStore((s: SettingsStoreState) => s.highContrast);
  const setHighContrast = useSettingsStore((s: SettingsStoreState) => s.setHighContrast);
  const brightMode      = useSettingsStore((s: SettingsStoreState) => s.brightMode);
  const setBrightMode   = useSettingsStore((s: SettingsStoreState) => s.setBrightMode);
  const [activePlayer, setActivePlayer] = useState(0);
  const router = useRouter();
  const rfScale = useRef(new Animated.Value(1)).current;
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showPBModal, setShowPBModal] = useState(false);
  const addPoints = usePointsStore((s) => s.addPoints);

  const handleOpenProfile = () => {
    setShowToolsMenu(false);
    router.push('/profile-setup');
  };

  const handleLogout = async () => {
    setShowToolsMenu(false);
    try {
      await signOut(auth);
    } catch {}
    setIsGuest(false);
    router.replace('/auth');
  };
  // ── Unified grid from store (single source of truth) ──────────────────
  const gridScores        = useRoundStore((s: RoundStoreState) => s.gridScores);
  const gridPlayerNames   = useRoundStore((s: RoundStoreState) => s.gridPlayerNames);
  const setCourseHoleScore = useRoundStore((s: RoundStoreState) => s.setCourseHoleScore);
  const setGridPlayerName  = useRoundStore((s: RoundStoreState) => s.setGridPlayerName);
  const storeActiveCourse  = useRoundStore((s: RoundStoreState) => s.activeCourse);
  const storeHolePutts     = useRoundStore((s: RoundStoreState) => s.holePutts);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (holesPlayed !== holeCount || grandTotal <= 0) return;
      try {
        const rawBest = await AsyncStorage.getItem(PERSONAL_BEST_KEY);
        const previousBest = rawBest ? Number(rawBest) : null;
        const isPersonalBest = previousBest == null || grandTotal < previousBest;
        if (!isPersonalBest) return;

        await AsyncStorage.setItem(PERSONAL_BEST_KEY, String(grandTotal));

        const awardKey = `${PERSONAL_BEST_AWARD_PREFIX}${courseName}:${grandTotal}:${holeCount}`;
        const alreadyAwarded = await AsyncStorage.getItem(awardKey);
        if (!alreadyAwarded) {
          addPoints(50, 'personal-best');
          await AsyncStorage.setItem(awardKey, '1');
        }

        if (mounted) {
          setShowPBModal(true);
        }
      } catch (error) {
        console.log('[scorecard] personal best check failed', error);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [addPoints, courseName, grandTotal, holeCount, holesPlayed]);

  // Alias for all helpers that still reference manualScores
  const manualScores = gridScores;

  // Always maintain 4 player slots; Player 1 = registered user (not editable here)
  const [tabNames, setTabNames] = useState<string[]>(() => {
    const defaults = [player1DisplayName, 'Player 2', 'Player 3', 'Player 4'];
    players.forEach((p, i) => { if (i < 4) defaults[i] = i === 0 ? player1DisplayName : p; });
    return defaults;
  });

  // Keep Player 1 name in sync with auth state (login/logout updates reactively)
  useEffect(() => {
    setTabNames((prev) => { const n = [...prev]; n[0] = player1DisplayName; return n; });
  }, [player1DisplayName]);

  const [editingTab, setEditingTab] = useState<number | null>(null);

  const adjustScore = (playerIdx: number, holeIdx: number, delta: number) => {
    const current = gridScores[playerIdx]?.[holeIdx] ?? 0;
    const next = Math.max(0, current + delta);
    setCourseHoleScore(playerIdx, holeIdx, next, storeActiveCourse);
  };

  // Build 18 par values — use parsedPars first, else use course default pars
  const DEFAULT_PARS = [4,3,5,4,4,3,4,5,4, 4,3,5,4,4,3,5,4,5];
  const holePars: number[] = Array.from({ length: 18 }, (_, i) => parsedPars[i] ?? DEFAULT_PARS[i] ?? 4);

  // Default stroke index (USGA standard allocation: front odd, back even)
  const DEFAULT_STROKE_INDEXES = [5,17,3,15,1,11,7,13,9, 6,16,4,14,2,12,8,10,18];
  // courseHandicap for player 0 — only applies when logged in
  const courseHandicap = (!isGuest && handicapIndex > 0) ? Math.round(handicapIndex * (120 / 113)) : 0;
  const getStrokesForHole = (strokeIdx: number): number => {
    if (isGuest || courseHandicap === 0) return 0;
    const base = Math.floor(courseHandicap / 18);
    const extra = strokeIdx <= (courseHandicap % 18) ? 1 : 0;
    return base + extra;
  };
  const getNetSkins = () => {
    const netSkins = Array(4).fill(0);
    let carry = 1;
    for (let h = 0; h < 18; h++) {
      const si = DEFAULT_STROKE_INDEXES[h];
      const activeCount = Math.max(players.length, 1);
      const netScores = Array.from({ length: activeCount }, (_, pi) => {
        const gross = manualScores[pi][h];
        return gross === 0 ? Infinity : gross - getStrokesForHole(si);
      });
      const lowest = Math.min(...netScores);
      const winners = netScores.reduce<number[]>((acc: any, s: any, pi: any) => {
        if (s === lowest && lowest < Infinity) acc.push(pi);
        return acc;
      }, []);
      if (winners.length === 1) { netSkins[winners[0]] += carry; carry = 1; }
      else { carry++; }
    }
    return netSkins;
  };

  const front9Par = holePars.slice(0, 9).reduce((a: any, b: any) => a + b, 0);
  const back9Par  = holePars.slice(9, 18).reduce((a: any, b: any) => a + b, 0);
  const totalPar18 = front9Par + back9Par;

  const getPlayerManualTotal = (pi: number) => manualScores[pi].reduce((a: any, b: any) => a + b, 0);
  const getPlayerFront9 = (pi: number) => manualScores[pi].slice(0, 9).reduce((a: any, b: any) => a + b, 0);
  const getPlayerBack9  = (pi: number) => manualScores[pi].slice(9).reduce((a: any, b: any) => a + b, 0);

  const formatVsPar = (score: number, par: number) => {
    if (score === 0) return '';
    const d = score - par;
    if (d === 0) return 'E';
    return d > 0 ? `+${d}` : `${d}`;
  };
  const vspColor = (score: number, par: number) => {
    if (score === 0) return '#888';
    const d = score - par;
    return d < 0 ? '#66bb6a' : d === 0 ? '#A7F3D0' : '#ff8a65';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingBottom: 8, paddingHorizontal: 16 }}>
        <Pressable onPress={() => {
          animateLogo();
          if (voiceEnabled && !isRoundActive) void speakJob('Great golfers review their scorecards to find patterns. What hole cost you strokes today?', ENGINE_PRIORITY.AMBIENT);
        }}>
          <Animated.View style={{ transform: [{ scale: logoScale }] }}>
            <Image source={require('../../assets/images/logo.png')} style={{ width: 48, height: 48, borderRadius: 999, overflow: 'hidden' }} resizeMode="cover" />
          </Animated.View>
        </Pressable>
        <View style={{ flex: 1, marginLeft: 12, alignItems: 'center' }}>
          <Text style={styles.title}>Scorecard</Text>
          {courseName !== t('scorecard') && (
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '500', textAlign: 'center', marginTop: 1 }} numberOfLines={1}>{courseName}</Text>
          )}
        </View>
        <Pressable
          onPress={() => setShowToolsMenu((v) => !v)}
          style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: showToolsMenu ? '#122a1e' : '#0e1612', borderWidth: 1.5, borderColor: showToolsMenu ? '#3d7a58' : '#1a3326', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 3 }}
        >
          {[0,1,2].map((i: any) => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: showToolsMenu ? '#4d8f6a' : '#556a5e' }} />)}
        </Pressable>
      </View>

      <GlobalMenu
        visible={showToolsMenu}
        onClose={() => setShowToolsMenu(false)}
        title="Scorecard Tools"
        extraItems={(
          <>
            <Pressable
              onPress={() => { setShowToolsMenu(false); router.push('/rangefinder'); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#332900', borderWidth: 1, borderColor: '#FFE600' }}
            >
              <Image source={ICON_RANGEFINDER} style={{ width: 20, height: 20, tintColor: '#FFE600' }} resizeMode="contain" />
              <Text style={{ color: '#FFE600', fontSize: 14, fontWeight: '600' }}>AR Rangefinder</Text>
            </Pressable>
            <Pressable
              onPress={() => setVoiceEnabled(!voiceEnabled)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: voiceEnabled ? '#143d22' : '#1a1a1a', borderWidth: 1, borderColor: voiceEnabled ? '#4caf50' : '#2a2a2a' }}
            >
              <MCIcon name={voiceEnabled ? 'volume-high' : 'volume-off'} size={16} color={voiceEnabled ? '#A7F3D0' : '#aaa'} />
              <Text style={{ color: voiceEnabled ? '#A7F3D0' : '#aaa', fontSize: 14, fontWeight: '600' }}>{voiceEnabled ? 'Voice On' : 'Voice Off'}</Text>
            </Pressable>
            <Pressable
              onPress={() => setVoiceStyle(voiceStyle === 'calm' ? 'aggressive' : 'calm')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#141414', borderWidth: 1, borderColor: '#2a2a2a' }}
            >
              <MCIcon name={voiceStyle === 'aggressive' ? 'bullhorn-outline' : 'meditation'} size={16} color="#9ca3af" />
              <Text style={{ color: '#d1d5db', fontSize: 14, fontWeight: '600' }}>{voiceStyle === 'aggressive' ? 'Aggressive' : 'Calm'} Voice</Text>
            </Pressable>
            <Pressable
              onPress={() => setVoiceGender(voiceGender === 'male' ? 'female' : 'male')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#141414', borderWidth: 1, borderColor: '#2a2a2a' }}
            >
              <MCIcon name="account-voice" size={16} color="#9ca3af" />
              <Text style={{ color: '#d1d5db', fontSize: 14, fontWeight: '600' }}>{voiceGender === 'male' ? 'Male' : 'Female'} Voice</Text>
            </Pressable>
            <Pressable
              onPress={handleOpenProfile}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#143d22', borderWidth: 1, borderColor: '#4caf50' }}
            >
              <MCIcon name="account-outline" size={16} color="#A7F3D0" />
              <Text style={{ color: '#A7F3D0', fontSize: 14, fontWeight: '600' }}>Profile</Text>
            </Pressable>
            <Pressable
              onPress={() => { setShowToolsMenu(false); router.push('/settings' as any); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#141414', borderWidth: 1, borderColor: '#2a2a2a' }}
            >
              <MCIcon name="cog-outline" size={16} color="#9ca3af" />
              <Text style={{ color: '#d1d5db', fontSize: 14, fontWeight: '600' }}>Settings</Text>
            </Pressable>
            <Pressable
              onPress={() => { void handleLogout(); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#2a1111', borderWidth: 1, borderColor: '#ef4444' }}
            >
              <MCIcon name="logout" size={16} color="#fca5a5" />
              <Text style={{ color: '#fca5a5', fontSize: 14, fontWeight: '600' }}>Log Out</Text>
            </Pressable>
          </>
        )}
      />

      {/* Rangefinder FAB — bottom-right (removed duplicate, see Animated.View below) */}
      <SplitLayout
        left={
          <ScrollView contentContainerStyle={[styles.list, { paddingHorizontal: layout.screenW < 340 ? 4 : layout.hPad, paddingBottom: tabBarHeight + 8 }]} showsVerticalScrollIndicator={false}>

        {/* ── 4-player tab bar ── */}
        <View style={styles.playerTabsRow}>
          {[0, 1, 2, 3].map((i: any) => (
            <Pressable
              key={i}
              onPress={() => { setActivePlayer(i); setEditingTab(null); }}
              style={({ pressed }) => [
                styles.playerTabBtn,
                activePlayer === i && styles.playerTabBtnActive,
                pressed && activePlayer !== i && styles.playerTabBtnPressed,
              ]}
            >
              <Text
                style={[
                  styles.playerTabText,
                  activePlayer === i && styles.playerTabTextActive,
                ]}
                numberOfLines={1}
              >
                {tabNames[i]}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Player 1: registered name badge (read-only) ── */}
        {activePlayer === 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
            <Text style={{ color: Palette.textPrimary, fontWeight: '600', fontSize: 15 }}>{tabNames[0]}</Text>
            <View style={{ backgroundColor: Palette.bgActive, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: Palette.positive, fontSize: 14, fontWeight: '700' }}>YOU</Text>
            </View>
          </View>
        )}

        {/* ── Players 2-4: editable name ── */}
        {activePlayer > 0 && (
          <View style={{ marginBottom: 10 }}>
            {editingTab === activePlayer ? (
              <TextInput
                value={tabNames[activePlayer]}
                onChangeText={(v) => setTabNames((prev) => { const n = [...prev]; n[activePlayer] = v; return n; })}
                onBlur={() => setEditingTab(null)}
                autoFocus
                style={{ backgroundColor: Palette.cardBgDark, color: Palette.textPrimary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: Palette.borderActive }}
                placeholder="Enter player name"
                placeholderTextColor="#555"
                maxLength={20}
              />
            ) : (
              <Pressable onPress={() => setEditingTab(activePlayer)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 15 }}>{tabNames[activePlayer]}</Text>
                <Text style={{ color: '#aaa', fontSize: 14 }}>✏ tap to edit</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── 9 or 18-hole scorecard with +/- buttons ── */}
        {/* Front 9 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Front 9</Text>
          {Array.from({ length: 9 }, (_, i) => {
            const holeIdx = i;
            const par = holePars[holeIdx];
            const score = manualScores[activePlayer][holeIdx];
            const vsp = formatVsPar(score, par);
            const si = DEFAULT_STROKE_INDEXES[holeIdx];
            const strokes = getStrokesForHole(si);
            const netScore = score > 0 ? score - strokes : 0;
            return (
              <View key={holeIdx} style={styles.row}>
                <Text style={styles.holeNum}>H{holeIdx + 1}</Text>
                <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', width: 36 }}>P{par}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Pressable onPress={() => adjustScore(activePlayer, holeIdx, -1)} style={styles.adjBtn}>
                    <Text style={styles.adjBtnText}>−</Text>
                  </Pressable>
                  <Text style={score === 0 ? styles.scoreEmpty : styles.score}>{score === 0 ? '—' : score}</Text>
                  <Pressable onPress={() => adjustScore(activePlayer, holeIdx, 1)} style={styles.adjBtn}>
                    <Text style={styles.adjBtnText}>+</Text>
                  </Pressable>
                  {vsp !== '' && <Text style={[styles.vspLabel, { color: vspColor(score, par) }]}>{vsp}</Text>}
                  {score > 0 && strokes > 0 && (
                    <Text style={{ color: '#ffcc00', fontSize: 14, fontWeight: '600', marginLeft: 2 }}>NET {netScore}</Text>
                  )}
                </View>
              </View>
            );
          })}
          <View style={styles.subtotalRow}>
            <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 14 }}>Front 9</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {(() => { const f = getPlayerFront9(activePlayer); const vsp = formatVsPar(f, front9Par); return vsp ? <Text style={{ color: vspColor(f, front9Par), fontWeight: '600', fontSize: 14 }}>{vsp}</Text> : null; })()}
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{getPlayerFront9(activePlayer) || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Back 9 — only render if 18-hole mode */}
        {!nineHoleMode && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Back 9</Text>
          {Array.from({ length: 9 }, (_, i) => {
            const holeIdx = i + 9;
            const par = holePars[holeIdx];
            const score = manualScores[activePlayer][holeIdx];
            const vsp = formatVsPar(score, par);
            const si = DEFAULT_STROKE_INDEXES[holeIdx];
            const strokes = getStrokesForHole(si);
            const netScore = score > 0 ? score - strokes : 0;
            return (
              <View key={holeIdx} style={styles.row}>
                <Text style={styles.holeNum}>H{holeIdx + 1}</Text>
                <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', width: 36 }}>P{par}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Pressable onPress={() => adjustScore(activePlayer, holeIdx, -1)} style={styles.adjBtn}>
                    <Text style={styles.adjBtnText}>−</Text>
                  </Pressable>
                  <Text style={score === 0 ? styles.scoreEmpty : styles.score}>{score === 0 ? '—' : score}</Text>
                  <Pressable onPress={() => adjustScore(activePlayer, holeIdx, 1)} style={styles.adjBtn}>
                    <Text style={styles.adjBtnText}>+</Text>
                  </Pressable>
                  {vsp !== '' && <Text style={[styles.vspLabel, { color: vspColor(score, par) }]}>{vsp}</Text>}
                  {score > 0 && strokes > 0 && (
                    <Text style={{ color: '#ffcc00', fontSize: 14, fontWeight: '600', marginLeft: 2 }}>NET {netScore}</Text>
                  )}
                </View>
              </View>
            );
          })}
          <View style={styles.subtotalRow}>
            <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 14 }}>Back 9</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {(() => { const b = getPlayerBack9(activePlayer); const vsp = formatVsPar(b, back9Par); return vsp ? <Text style={{ color: vspColor(b, back9Par), fontWeight: '600', fontSize: 14 }}>{vsp}</Text> : null; })()}
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{getPlayerBack9(activePlayer) || '—'}</Text>
            </View>
          </View>
        </View>
        )}

        {/* ── Total ── */}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{tabNames[activePlayer]} Total</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {(() => { const t = getPlayerManualTotal(activePlayer); const vsp = formatVsPar(t, totalPar18); return vsp ? <Text style={{ fontSize: 15, fontWeight: '700', color: vspColor(t, totalPar18) }}>{vsp} vs par</Text> : null; })()}
            <Text style={styles.totalScore}>{getPlayerManualTotal(activePlayer) || '—'}</Text>
          </View>
        </View>

        {/* ── Putting Stats (player 0 only, uses stored hole putts) ── */}
        {activePlayer === 0 && (() => {
          const holesPlayed = manualScores[0].filter((s: any) => s > 0).length;
          if (holesPlayed === 0) return null;
          const totalPutts = storeHolePutts.reduce((a: any, b: any) => a + b, 0);
          if (totalPutts === 0) return null;
          const onePuttCount = storeHolePutts.slice(0, 18).filter((p: any) => p === 1).length;
          const girCount = holePars.reduce((count, par, i) => {
            const score = manualScores[0][i];
            const putts = storeHolePutts[i] ?? 0;
            if (score > 0 && putts > 0 && (score - putts) <= (par - 2)) return count + 1;
            return count;
          }, 0);
          const girPct = holesPlayed > 0 ? Math.round((girCount / holesPlayed) * 100) : 0;
          const avgPutts = holesPlayed > 0 ? (totalPutts / holesPlayed).toFixed(1) : '—';
          return (
            <View style={[styles.section, { marginTop: 8 }]}>
              <Text style={styles.sectionTitle}>Putting Stats</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <View style={{ flex: 1, minWidth: 120, backgroundColor: 'rgba(46,204,113,0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(46,204,113,0.22)', padding: 12, alignItems: 'center' }}>
                  <Text style={{ color: '#A7F3D0', fontSize: 22, fontWeight: '800' }}>{totalPutts}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginTop: 2 }}>TOTAL PUTTS</Text>
                </View>
                <View style={{ flex: 1, minWidth: 120, backgroundColor: 'rgba(46,204,113,0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(46,204,113,0.22)', padding: 12, alignItems: 'center' }}>
                  <Text style={{ color: '#A7F3D0', fontSize: 22, fontWeight: '800' }}>{avgPutts}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginTop: 2 }}>AVG / HOLE</Text>
                </View>
                <View style={{ flex: 1, minWidth: 120, backgroundColor: 'rgba(46,204,113,0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(46,204,113,0.22)', padding: 12, alignItems: 'center' }}>
                  <Text style={{ color: '#A7F3D0', fontSize: 22, fontWeight: '800' }}>{girCount}<Text style={{ fontSize: 14, color: 'rgba(167,243,208,0.7)' }}> / {holesPlayed}</Text></Text>
                  <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginTop: 2 }}>GIR  {girPct}%</Text>
                </View>
                <View style={{ flex: 1, minWidth: 120, backgroundColor: 'rgba(46,204,113,0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(46,204,113,0.22)', padding: 12, alignItems: 'center' }}>
                  <Text style={{ color: '#A7F3D0', fontSize: 22, fontWeight: '800' }}>{onePuttCount}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginTop: 2 }}>1-PUTT HOLES</Text>
                </View>
              </View>
            </View>
          );
        })()}

        {/* ── Net Total (shows when logged in and handicap > 0) ── */}
        {!isGuest && handicapIndex > 0 && (() => {
          const netTotal = manualScores[activePlayer].reduce((sum: any, s: any, i: any) => {
            return sum + (s > 0 ? s - getStrokesForHole(DEFAULT_STROKE_INDEXES[i]) : 0);
          }, 0);
          return netTotal > 0 ? (
            <View style={[styles.totalRow, { backgroundColor: 'rgba(255,204,0,0.08)', borderColor: 'rgba(255,204,0,0.25)' }]}>
              <Text style={[styles.totalLabel, { color: '#ffcc00' }]}>Net Total (Hcp {courseHandicap})</Text>
              <Text style={[styles.totalScore, { color: '#ffcc00' }]}>{netTotal}</Text>
            </View>
          ) : null;
        })()}

        {/* ── Match play comparison ── */}
        {multiRound.length > 0 && players.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Player Comparison</Text>
            <Text style={{ color: '#ffcc00', fontWeight: '600', marginBottom: 6 }}>
              Match: {getMatchStatus()}
            </Text>
            <Text style={{ color: '#ccc', fontSize: 15, lineHeight: 22 }}>{getPlayerInsights()}</Text>
            {multiRound.map((holeEntry, idx) => {
              const winners = getHoleWinner(holeEntry);
              return (
                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginTop: 4 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Hole {holeEntry.hole}</Text>
                  <Text style={{ color: '#66bb6a', fontSize: 14 }}>W: {winners.map((i: any) => tabNames[i] ?? players[i]).join(', ')}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Skins game ── */}
        {multiRound.length > 0 && players.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skins Game {handicapIndex > 0 ? '(Net)' : '(Gross)'}</Text>
            {(() => {
              const netSkins = handicapIndex > 0 ? getNetSkins() : skinsData;
              return tabNames.slice(0, Math.max(players.length, 1)).map((name, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
                  <Text style={{ color: '#ccc', fontSize: 14 }}>{name}</Text>
                  <Text style={{ color: '#ffcc00', fontWeight: '700' }}>{netSkins[i] ?? 0} skins</Text>
                </View>
              ));
            })()}
          </View>
        )}

        {/* ── Hole review with shot dispersion ── */}
        {Object.keys(shotsByHole).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('shotMap')}</Text>
            {Object.keys(shotsByHole).sort((a: any, b: any) => Number(a) - Number(b)).map((holeKey) => (
              <View key={holeKey} style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 12, marginBottom: 12 }}>
                <Text style={{ color: '#fff', fontWeight: '600', marginBottom: 6 }}>Hole {holeKey}</Text>
                {/* Shot dispersion map */}
                <View style={{ height: 110, backgroundColor: Palette.bgActive, borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
                  {shotsByHole[holeKey].map((shot, idx) => {
                    const pos = getShotPosition(shot.result, idx);
                    const dotColor = shot.result === 'left' ? '#ff5252' : shot.result === 'right' ? '#42a5f5' : '#66bb6a';
                    return (
                      <View
                        key={idx}
                        style={{
                          position: 'absolute',
                          width: 10, height: 10, borderRadius: 5,
                          backgroundColor: dotColor,
                          left: `${Math.min(Math.max(pos.left, 2), 92)}%`,
                          top: `${Math.min(Math.max(pos.top, 5), 85)}%`,
                        }}
                      />
                    );
                  })}
                  <View style={{ position: 'absolute', bottom: 6, left: 0, right: 0, alignItems: 'center' }}>
                    <View style={{ width: 24, height: 14, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)' }} />
                  </View>
                </View>
                {/* Legend */}
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 8 }}>
                  {[['#ff5252', t('left')], ['#66bb6a', t('center')], ['#42a5f5', t('right')]].map(([c, l]) => (
                    <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
                      <Text style={{ color: '#aaa', fontSize: 14 }}>{l}</Text>
                    </View>
                  ))}
                </View>
                {shotsByHole[holeKey].map((shot, idx) => (
                  <Text key={idx} style={{ color: '#ccc', fontSize: 14, lineHeight: 20 }}>
                    {idx + 1}. {shot.club} → {shot.result}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* ── Club usage ── */}
        {clubList.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Club Usage</Text>
            {clubList.map(([club, count]: [string, number]) => (
              <View style={styles.clubUsageRow} key={club}>
                <Text style={styles.clubName}>{club}</Text>
                <Text style={styles.clubCount}>{count}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Club insights ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('clubInsights')}</Text>
          <Text style={{ color: '#ccc', fontSize: 14, lineHeight: 22, marginTop: 4 }}>{getClubInsights()}</Text>
        </View>

        {/* ── Strokes lost ── */}
        {parsedShots.length >= 3 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Strokes Lost</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: '#ff5252', fontSize: 22, fontWeight: '700' }}>{strokesLost.offTee}</Text>
                <Text style={{ color: '#aaa', fontSize: 14 }}>Off the Tee</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: '#ffa726', fontSize: 22, fontWeight: '700' }}>{strokesLost.approach}</Text>
                <Text style={{ color: '#aaa', fontSize: 14 }}>Approach</Text>
              </View>
            </View>
            <Text style={{ color: '#ccc', fontSize: 14, lineHeight: 21 }}>{getStrokesInsight(strokesLost)}</Text>
          </View>
        )}

        {/* ── Hole analysis ── */}
        {parsedShots.length >= 3 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hole Analysis</Text>
            <Text style={{ color: '#ff8a65', fontSize: 14, lineHeight: 21 }}>{getHoleInsight()}</Text>
          </View>
        )}

        {/* ── Post-round summary + winner ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('roundSummary')}</Text>
          {players.length > 1 && multiRound.length > 0 && (
            <>
              <Text style={{ color: '#c4d9cc', fontSize: 14, marginBottom: 4, fontWeight: '600' }}>Winner: {getRoundWinner()}</Text>
              <Text style={{ color: '#b08840', fontSize: 14, marginBottom: 8, fontWeight: '600' }}>Skins: {getSkinsWinner()}</Text>
            </>
          )}
          <Text style={{ color: grandTotal === 0 && holesPlayed === 0 ? '#aaa' : '#ccc', fontSize: 14, lineHeight: 22 }}>
            {(() => {
              if (grandTotal === 0) return t('roundInProgress');
              const toPar = grandTotal - coursePar;
              const toParStr = toPar === 0
                ? t('evenPar')
                : toPar > 0
                ? '+' + toPar + ' ' + t('overPar')
                : Math.abs(toPar) + ' ' + t('underPar');
              const rights = parsedShots.filter((s: any) => s.result === 'right').length;
              const lefts = parsedShots.filter((s: any) => s.result === 'left').length;
              const missNote = rights > lefts
                ? t('missingRightToday')
                : lefts > rights
                ? t('missingLeftToday')
                : t('hittingStraightToday');
              return toParStr + ' through ' + holesPlayed + ' holes. ' + missNote;
            })()}
          </Text>
        </View>

        {/* ── Practice plan ── */}
        {parsedShots.length >= 3 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Practice Plan</Text>
            {getPostRoundPracticePlan().map((item, idx) => (
              <Text key={idx} style={{ color: '#66bb6a', fontSize: 14, lineHeight: 22, marginBottom: 4 }}>• {item}</Text>
            ))}
          </View>
        )}

          </ScrollView>
        }
        right={
          <ScrollView
            style={styles.splitPanel}
            contentContainerStyle={styles.splitPanelContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.splitTitle}>{t('roundSnapshot')}</Text>
            <View style={styles.splitCard}>
              <Text style={styles.splitLabel}>{t('player').toUpperCase()}</Text>
              <Text style={styles.splitValue}>{tabNames[activePlayer]}</Text>
            </View>
            <View style={styles.splitCard}>
              <Text style={styles.splitLabel}>{t('total').toUpperCase()}</Text>
              <Text style={styles.splitValue}>{getPlayerManualTotal(activePlayer) || '—'}</Text>
            </View>
            <View style={styles.splitCard}>
              <Text style={styles.splitLabel}>{t('vsPar').toUpperCase()}</Text>
              <Text style={styles.splitValue}>{formatVsPar(getPlayerManualTotal(activePlayer), totalPar18) || '—'}</Text>
            </View>
            <View style={styles.splitTipCard}>
              <Text style={styles.splitTipLabel}>{t('insight').toUpperCase()}</Text>
              <Text style={styles.splitTipText}>{getHoleInsight()}</Text>
            </View>
            <View style={styles.splitTipCard}>
              <Text style={styles.splitTipLabel}>{t('clubInsights').toUpperCase()}</Text>
              <Text style={styles.splitTipText}>{getClubInsights()}</Text>
            </View>
            <View style={{ height: 16 }} />
          </ScrollView>
        }
      />

      {/* Floating Rangefinder Button */}
      <Animated.View style={[{ position: 'absolute', bottom: 90, right: 16 }, { transform: [{ scale: rfScale }] }]}>
        <Pressable
          onPress={() => {
            Animated.sequence([
              Animated.timing(rfScale, { toValue: 1.25, duration: 110, useNativeDriver: true }),
              Animated.timing(rfScale, { toValue: 1, duration: 110, useNativeDriver: true }),
            ]).start();
            router.push('/rangefinder');
          }}
          style={{ backgroundColor: Palette.cardBg, width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Palette.border }}
        >
          <Image source={ICON_RANGEFINDER} style={{ width: 24, height: 24, tintColor: Palette.accent }} resizeMode="contain" />
        </Pressable>
      </Animated.View>

      {/* Personal Best Modal */}
      <Modal visible={showPBModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#0a2e1a', borderRadius: 20, padding: 32, alignItems: 'center', maxWidth: 340 }}>
            <Text style={{ fontSize: 60, marginBottom: 16 }}>🏆</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#A7F3D0', marginBottom: 8 }}>Personal Best!</Text>
            <Text style={{ fontSize: 48, fontWeight: '900', color: '#fbbf24', marginBottom: 16 }}>{grandTotal}</Text>
            <Text style={{ fontSize: 16, color: '#ccc', marginBottom: 24, textAlign: 'center' }}>{courseName}</Text>
            <TouchableOpacity
              onPress={async () => {
                try {
                  await Share.share({
                    message: 'New personal best! ' + grandTotal + ' at ' + courseName + '. Tracked with SmartPlay Caddie 🏌️'
                  });
                } catch {}
              }}
              style={{ backgroundColor: '#2e7d32', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14, marginBottom: 10, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#4caf50' }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{t('shareRound')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowPBModal(false)}
              style={{ backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#333' }}
            >
              <Text style={{ color: '#A7F3D0', fontSize: 15, fontWeight: '700' }}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.brand,
    paddingTop: 0,
    paddingHorizontal: Space.lg + 2,
  },
  title: {
    fontSize: Type.h2,
    fontWeight: Type.bold,
    color: Palette.white,
    marginBottom: Space.lg + 2,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  list: { paddingBottom: 40 },
  playerTabsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  playerTabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#111814',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  playerTabBtnActive: {
    backgroundColor: '#123126',
    borderColor: '#2ECC71',
  },
  playerTabBtnPressed: {
    backgroundColor: '#1a2420',
  },
  playerTabText: {
    color: Palette.textSub,
    fontWeight: Type.medium,
    fontSize: 14,
  },
  playerTabTextActive: {
    color: '#E8FFF5',
    fontWeight: Type.bold,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Space.md,
    paddingHorizontal: Space.md + 2,
    borderBottomWidth: 1,
    borderColor: Palette.borderSubtle,
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.sm,
    marginBottom: Space.xs,
  },
  holeNum: {
    fontSize: Type.md,
    color: 'rgba(255,255,255,0.75)',
  },
  score: {
    fontSize: Type.lg - 1,
    color: Palette.positiveFaint,
    fontWeight: Type.semibold,
  },
  scoreEmpty: {
    fontSize: Type.lg - 1,
    color: Palette.textMuted,
    fontWeight: Type.semibold,
    minWidth: 24,
    textAlign: 'center',
  },
  adjBtn: {
    width: 30, height: 30,
    borderRadius: Radius.sm,
    backgroundColor: Palette.cardBg,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjBtnText: {
    color: Palette.positiveFaint,
    fontSize: Type.xl - 2,
    fontWeight: Type.semibold,
    lineHeight: 22,
  },
  vspLabel: {
    fontSize: Type.body,
    fontWeight: Type.medium,
    minWidth: 28,
    textAlign: 'right',
  },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Space.md - 2,
    paddingHorizontal: Space.xs,
    borderTopWidth: 1,
    borderColor: Palette.borderSubtle,
    marginTop: Space.sm,
  },
  totalRow: {
    ...DS.card,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Space.md + 2,
    marginTop: Space.md,
  },
  totalLabel: {
    fontSize: Type.xl - 2,
    fontWeight: Type.semibold,
    color: Palette.white,
  },
  totalScore: {
    fontSize: Type.xl - 2,
    fontWeight: Type.semibold,
    color: Palette.positiveFaint,
  },
  clubUsageSection: {
    ...DS.card,
    marginTop: Space.xl,
  },
  section: {
    ...DS.card,
    marginTop: Space.xl,
  },
  sectionTitle:    DS.caption as any,
  clubUsageTitle:  DS.caption as any,
  clubUsageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderColor: Palette.borderSubtle,
  },
  clubName: {
    fontSize: Type.md,
    color: 'rgba(255,255,255,0.75)',
  },
  clubCount: {
    fontSize: Type.md,
    color: Palette.positive,
    fontWeight: Type.semibold,
  },
  splitPanel: {
    flex: 1,
    backgroundColor: Palette.cardBgDark,
    borderLeftWidth: 1,
    borderLeftColor: Palette.border,
  },
  splitPanelContent: {
    padding: 16,
    gap: 10,
    paddingBottom: 24,
  },
  splitTitle: {
    color: Palette.positiveFaint,
    fontSize: Type.body,
    fontWeight: Type.black,
    letterSpacing: 0.4,
  },
  splitCard: {
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 14,
  },
  splitLabel: {
    color: Palette.positive,
    fontSize: Type.xs,
    fontWeight: Type.bold,
    letterSpacing: 1,
    marginBottom: 6,
  },
  splitValue: {
    color: Palette.textPrimary,
    fontSize: Type.xl,
    fontWeight: Type.black,
  },
  splitTipCard: {
    backgroundColor: Palette.cardBgDark,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.sm,
    padding: 12,
    gap: 6,
  },
  splitTipLabel: {
    color: Palette.positive,
    fontSize: Type.xs,
    fontWeight: Type.bold,
    letterSpacing: 1.2,
  },
  splitTipText: {
    color: Palette.textSub,
    fontSize: Type.body,
    lineHeight: 20,
  },
});







