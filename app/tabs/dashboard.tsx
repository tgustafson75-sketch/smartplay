/**
 * Dashboard tab — combines Stats overview + Live round logging + Past rounds history.
 * Three sub-sections accessed via a segmented toggle: STATS | ROUND | HISTORY
 */
import GlobalMenu from '../../components/GlobalMenu';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { speakJob, PRIORITY as ENGINE_PRIORITY } from '../../services/voice';
import { useUserStore } from '../../store/userStore';
import { useMemoryStore } from '../../store/memoryStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRoundStore } from '@/store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useCageStore } from '../../store/cageStore';
import { usePointsStore } from '../../store/pointsStore';
import { useTranslation } from '../../hooks/useTranslation';
import BrandHeader from '../../components/BrandHeader';
import { SplitLayout } from '../../components/SplitLayout';
import { useLayout } from '../../hooks/use-layout';
import { DS, Palette, Radius, Space, Type } from '../../constants/theme';

// Types
interface RoundEntry { date?: number | string; shots: { result: string; club?: string }[] }
interface DashData {
  totalRounds: number; totalShots: number;
  straight: number; right: number; left: number;
  bestScore: number | null; recentScores: number[];
  streak: number; recentActivity: ActivityItem[];
}
interface ActivityItem { date: number; shots: number; missBias: 'Left' | 'Right' | 'Straight'; topClub: string }
type RoundSummary = { date: number; score: number; toPar: number; missBias: string };

// Helpers
function msToDateStr(ms: number): string {
  if (!ms) return '--';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function toTimestamp(raw: any): number {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const n = Date.parse(raw);
  return isNaN(n) ? 0 : n;
}
function computeDash(rounds: RoundEntry[]): DashData {
  let totalShots = 0, straight = 0, right = 0, left = 0;
  let bestScore: number | null = null;
  const recentScores: number[] = [];
  const recentActivity: ActivityItem[] = [];
  const daysSeen = new Set<string>();
  for (const r of rounds) {
    const shots = Array.isArray(r.shots) ? r.shots : [];
    const count = shots.length;
    totalShots += count;
    straight += shots.filter((s) => s.result === 'straight').length;
    right    += shots.filter((s) => s.result === 'right').length;
    left     += shots.filter((s) => s.result === 'left').length;
    if (bestScore === null || count < bestScore) bestScore = count;
    const ts = toTimestamp(r.date);
    if (ts) daysSeen.add(new Date(ts).toDateString());
    recentScores.push(count);
  }
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    if (daysSeen.has(d.toDateString())) streak++;
    else if (i > 0) break;
  }
  const sorted = [...rounds].sort((a, b) => toTimestamp(b.date) - toTimestamp(a.date));
  for (const r of sorted.slice(0, 5)) {
    const shots = Array.isArray(r.shots) ? r.shots : [];
    const l = shots.filter((s) => s.result === 'left').length;
    const ri = shots.filter((s) => s.result === 'right').length;
    const missBias: ActivityItem['missBias'] = l > ri ? 'Left' : ri > l ? 'Right' : 'Straight';
    const clubCounts: Record<string, number> = {};
    shots.forEach((s) => { if (s.club) clubCounts[s.club] = (clubCounts[s.club] ?? 0) + 1; });
    const topClub = Object.entries(clubCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '--';
    recentActivity.push({ date: toTimestamp(r.date), shots: shots.length, missBias, topClub });
  }
  return { totalRounds: rounds.length, totalShots, straight, right, left, bestScore, recentScores: recentScores.slice(-6), streak, recentActivity };
}
function focusTip(typicalMiss: string | null, biggestStruggle: string | null): string {
  if (biggestStruggle === 'putting') return 'Focus on lag putting today -- speed control saves strokes.';
  if (biggestStruggle === 'short-game') return 'Spend an extra 10 min on chip finesse before your round.';
  if (biggestStruggle === 'driver') return 'Tee it low and swing at 80% -- tempo beats power off the tee.';
  if (typicalMiss === 'right') return 'Check grip pressure -- a tight grip often causes a push/slice.';
  if (typicalMiss === 'left') return 'Rotate your hips fully through impact to prevent pulling left.';
  return 'Stay in your routine and trust your pre-shot process today.';
}
function getOverallTendencies(summaries: RoundSummary[]) {
  if (summaries.length === 0) return { avgScore: null, commonMiss: 'Unknown' };
  const avgScore = Math.round(summaries.reduce((s, r) => s + r.score, 0) / summaries.length);
  const counts: Record<string, number> = {};
  summaries.forEach((r) => { counts[r.missBias] = (counts[r.missBias] ?? 0) + 1; });
  const commonMiss = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Mixed';
  return { avgScore, commonMiss };
}
function getProgressLabel(summaries: RoundSummary[]): string {
  if (summaries.length < 2) return 'Not enough rounds yet';
  const last3 = summaries.slice(-3);
  if (last3.length < 2) return 'Keep playing to see progress';
  const delta = last3[last3.length - 1].score - last3[0].score;
  if (delta <= -2) return 'Trending better';
  if (delta >= 3)  return 'Slight regression';
  return 'Consistent';
}
function deriveRoundSummaries(localRounds: { date?: any; shots: any[] }[]): RoundSummary[] {
  return localRounds.map((r) => {
    const shots = Array.isArray(r.shots) ? r.shots : [];
    const left  = shots.filter((s: any) => s.result === 'left').length;
    const right = shots.filter((s: any) => s.result === 'right').length;
    const missBias = left > right ? 'Left' : right > left ? 'Right' : 'Mixed';
    const ts = r.date ? (typeof r.date === 'number' ? r.date : new Date(r.date).getTime()) : 0;
    return { date: ts, score: shots.length, toPar: 0, missBias };
  });
}

const COURSE_RATINGS: Record<string, { slope: number; rating: number }> = {
  'Menifee Lakes':         { slope: 118, rating: 69.8 },
  'Menifee Lakes – Palms': { slope: 118, rating: 69.8 },
  'Menifee Lakes – Lakes': { slope: 121, rating: 70.4 },
  'Temecula Creek':      { slope: 125, rating: 71.2 },
  'Moreno Valley Ranch': { slope: 122, rating: 70.5 },
};

// Component
export default function DashboardScreen() {
  const { t } = useTranslation();
  const layout = useLayout();
  const fontScale = layout.isSmall ? 0.92 : layout.isLarge ? 1.08 : 1;
  const getGreeting = () => { const h = new Date().getHours(); if (h < 12) return t('goodMorning'); if (h < 17) return t('goodAfternoon'); return t('goodEvening'); }
  const router = useRouter();
  const [roundTab, setRoundTab] = useState<'current' | 'past'>('current');
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [dash, setDash] = useState<DashData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cloudRounds, setCloudRounds] = useState<any[]>([]);
  const [localRounds, setLocalRounds] = useState<Array<{ date: string; shots: any[] }>>([]);

  const displayName = useUserStore((s) => s.displayName || s.name || 'Golfer');
  const handicap    = useUserStore((s) => s.handicap);
  const goal        = useUserStore((s) => s.goal);
  const clubUsage   = useMemoryStore((s) => s.clubUsage);
  const typicalMiss = usePlayerProfileStore((s) => s.typicalMiss);
  const biggestStruggle = usePlayerProfileStore((s) => s.biggestStruggle);
  const activeCourseStore = useRoundStore((s: any) => s.activeCourse);
  const voiceEnabled = useSettingsStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useSettingsStore((s) => s.setVoiceEnabled);
  const brightMode = useSettingsStore((s) => s.brightMode);
  const setBrightMode = useSettingsStore((s) => s.setBrightMode);
  const cageHistory  = useCageStore((s) => s.sessionHistory);
  const totalPoints = usePointsStore((s) => s.totalPoints);
  const pointsTier = usePointsStore((s) => s.tier);

  const shots        = useRoundStore((s: any) => s.shots);
  const shotResult   = useRoundStore((s: any) => s.shotResult);
  const aim          = useRoundStore((s: any) => s.aim);
  const club         = useRoundStore((s: any) => s.club);
  const addShot      = useRoundStore((s: any) => s.addShot);
  const clearRound   = useRoundStore((s: any) => s.clearRound);

  const defaultSlope = COURSE_RATINGS[activeCourseStore]?.slope ?? 120;
  const [slopeRating, setSlopeRating] = useState(defaultSlope);

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(t('rounds'));
      const rounds: RoundEntry[] = raw ? JSON.parse(raw) : [];
      setDash(computeDash(rounds));
      setLocalRounds(rounds as any);
    } catch { setDash(computeDash([])); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    const q = query(collection(db, 'users', userId, t('rounds')), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => setCloudRounds(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, []);

  const hasSpokeRef = useRef(false);
  useEffect(() => {
    if (hasSpokeRef.current || localRounds.length < 2) return;
    const summaries = deriveRoundSummaries(localRounds);
    const { commonMiss } = getOverallTendencies(summaries);
    const progress = getProgressLabel(summaries);
    hasSpokeRef.current = true;
    const cue = progress === 'Trending better'
      ? `You're trending better. Miss is ${commonMiss.toLowerCase()}.`
      : progress === 'Slight regression'
      ? `Slight regression. Watch the ${commonMiss.toLowerCase()} miss.`
      : `You're consistent. Common miss is ${commonMiss.toLowerCase()}.`;
      setTimeout(() => { if (voiceEnabled) void speakJob(cue); }, 1200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localRounds]);

  const topClubEntry = Object.entries(clubUsage ?? {}).sort((a, b) => b[1] - a[1])[0];
  const topClub = topClubEntry ? `${topClubEntry[0]} (${topClubEntry[1]}x)` : null;
  const accuracy = dash && dash.totalShots > 0 ? Math.round((dash.straight / dash.totalShots) * 100) : 0;
  const tip = focusTip(typicalMiss, biggestStruggle);
  const sparkMax = dash ? Math.max(...dash.recentScores, 1) : 1;
  const sparkMin = dash ? Math.min(...dash.recentScores, sparkMax) : 0;

  const getShotColor = (result: string) =>
    result === 'left' ? '#60a5fa' : result === 'right' ? '#f87171' : '#A7F3D0';

  const logShot = (result: import('@/store/roundStore').ShotResult) => {
    addShot({ result, mental: '', club, aim, timestamp: Date.now(), hole: 0, distance: 0 });
    if (result === 'left') { if (voiceEnabled) void speakJob('Pulled left.'); }
    else if (result === 'right') { if (voiceEnabled) void speakJob('Missed right.'); }
    else { if (voiceEnabled) void speakJob('Straight.'); }
  };

  const getClubStats = () => {
    const stats: Record<string, { left: number; right: number; center: number; total: number }> = {};
    shots.forEach((s: any) => {
      if (!stats[s.club]) stats[s.club] = { left: 0, right: 0, center: 0, total: 0 };
      stats[s.club].total++;
      if (s.result === 'left') stats[s.club].left++;
      else if (s.result === 'right') stats[s.club].right++;
      else stats[s.club].center++;
    });
    return stats;
  };

  const getPattern = () => {
    if (shots.length === 0) return null;
    const left = shots.filter((s: any) => s.result === 'left').length;
    const right = shots.filter((s: any) => s.result === 'right').length;
    const center = shots.filter((s: any) => s.result === 'center').length;
    return {
      left: Math.round((left / shots.length) * 100),
      right: Math.round((right / shots.length) * 100),
      straight: Math.round((center / shots.length) * 100),
    };
  };

  const getInsight = () => {
    const p = getPattern();
    if (!p) return 'Log shots to see insights here.';
    if (p.left > 50) return `Pulling left on ${p.left}% of shots -- check path and face.`;
    if (p.right > 50) return `Missing right on ${p.right}% -- check face angle at impact.`;
    if (p.straight >= 60) return `Strong round -- ${p.straight}% on target. Keep the tempo.`;
    return `${p.straight}% straight, ${p.left}% left, ${p.right}% right.`;
  };

  const getPlayerMemory = () => {
    if (shots.length < 10) return 'Building player profile -- keep logging shots.';
    const recent = shots.slice(-10);
    const wideCount = recent.filter((s: any) => s.result !== 'center').length;
    const tightCount = recent.filter((s: any) => s.result === 'center').length;
    if (wideCount > tightCount) return "You tend to struggle when shots spread out -- play safer.";
    if (tightCount > wideCount) return "You perform best when dialled in -- trust your swing.";
    return "You're showing a balanced pattern today.";
  };

  const aimPct = aim === 'left edge' ? 10 : aim === 'left center' ? 30 : aim === 'center' ? 50 : aim === 'right center' ? 70 : 90;

  // Derived values for new card layout
  const totalShotCount = dash?.totalShots ?? 0;
  const progressText = totalShotCount < 20
    ? `${totalShotCount} shots logged — keep going`
    : 'Player profile active';
  const lastRound = localRounds.length > 0 ? localRounds[localRounds.length - 1] : null;
  const lastRoundDate = lastRound ? msToDateStr(toTimestamp(lastRound.date)) : null;

  const hasCageData = cageHistory.length > 0;
  const lastCageSession = hasCageData ? cageHistory[0] : null;
  const totalCageShots = hasCageData ? cageHistory.reduce((acc: any, s: any) => acc + s.shots.length, 0) : 0;
  const lastCageDate = lastCageSession ? msToDateStr(lastCageSession.endTime ?? lastCageSession.startTime) : '--';
  const dominantCageMiss = (() => {
    if (!lastCageSession) return null;
    const counts: Record<string, number> = {};
    lastCageSession.shots.forEach((s: any) => { const k = s.shape ?? 'straight'; counts[k] = (counts[k] ?? 0) + 1; });
    return Object.entries(counts).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] ?? null;
  })();

  const personalBest = (dash?.bestScore ?? 0) > 0 ? dash!.bestScore! : null;
  const bestRoundEntry = personalBest ? localRounds.find((r) => r.shots.length === personalBest) : null;
  const bestRoundDate = bestRoundEntry ? msToDateStr(toTimestamp((bestRoundEntry as any).date)) : '--';

  return (
    <>
      <BrandHeader rightSlot={
        <Pressable
          onPress={() => setShowToolsMenu((v) => !v)}
          style={{ backgroundColor: showToolsMenu ? '#143d22' : '#1a1a1a', height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: showToolsMenu ? '#4caf50' : '#333', flexDirection: 'row', gap: 3 }}
        >
          {[0,1,2].map((i) => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: showToolsMenu ? '#4ade80' : '#aaa' }} />)}
        </Pressable>
      } />

      <GlobalMenu
        visible={showToolsMenu}
        onClose={() => setShowToolsMenu(false)}
        title="Dashboard Tools"
        extraItems={(
          <>
            <Pressable
              onPress={() => { setShowToolsMenu(false); router.push('/analytics'); }}
              style={{ paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#1a1535', borderWidth: 1, borderColor: '#a78bfa' }}
            >
              <Text style={{ color: '#c4b5fd', fontSize: 14, fontWeight: '700' }}>Deep Analytics</Text>
            </Pressable>
            <Pressable
              onPress={() => { setShowToolsMenu(false); router.push('/rangefinder'); }}
              style={{ paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#332900', borderWidth: 1, borderColor: '#FFE600' }}
            >
              <Text style={{ color: '#FFE600', fontSize: 14, fontWeight: '700' }}>Rangefinder</Text>
            </Pressable>
            <Pressable
              onPress={() => setVoiceEnabled(!voiceEnabled)}
              style={{ paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, backgroundColor: voiceEnabled ? '#143d22' : '#1a1a1a', borderWidth: 1, borderColor: voiceEnabled ? '#4caf50' : '#2a2a2a' }}
            >
              <Text style={{ color: voiceEnabled ? '#A7F3D0' : '#aaa', fontSize: 14, fontWeight: '600' }}>{voiceEnabled ? 'Voice On' : 'Voice Off'}</Text>
            </Pressable>
            <Pressable
              onPress={() => setBrightMode(!brightMode)}
              style={{ paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, backgroundColor: brightMode ? '#143d22' : '#1a1a1a', borderWidth: 1, borderColor: brightMode ? '#4caf50' : '#2a2a2a' }}
            >
              <Text style={{ color: brightMode ? '#A7F3D0' : '#aaa', fontSize: 14, fontWeight: '600' }}>Bright Mode {brightMode ? 'On' : 'Off'}</Text>
            </Pressable>
            <Pressable
              onPress={() => { setShowToolsMenu(false); router.push('/settings' as any); }}
              style={{ paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#141414', borderWidth: 1, borderColor: '#2a2a2a' }}
            >
              <Text style={{ color: '#d1d5db', fontSize: 14, fontWeight: '600' }}>Settings</Text>
            </Pressable>
          </>
        )}
      />

      <SplitLayout
        left={
          <ScrollView
            style={styles.container}
            contentContainerStyle={[
              styles.content,
              layout.isWide ? styles.contentSplit : styles.contentSingle,
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#A7F3D0" />}
          >
        {/* ── CARD 1: WELCOME ─────────────────────────────────────── */}
        <View style={[styles.card, { marginBottom: 12 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '500' }}>{getGreeting()}</Text>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 22, marginTop: 2 }}>{displayName}</Text>
              {/* One-line pill row: HCP · Break Goal · Points */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 7 }}>
                {handicap > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>HCP {handicap}</Text></View>
                )}
                {goal && (
                  <View style={[styles.badge, { backgroundColor: '#1a4a2e' }]}>
                    <Text style={[styles.badgeText, { color: '#fbbf24' }]}>
                      {goal === 'break80' ? 'Break 80' : goal === 'break90' ? 'Break 90' : goal === 'break100' ? 'Break 100' : 'Enjoy Game'}
                    </Text>
                  </View>
                )}
                <View style={{ backgroundColor: '#1a1a00', borderColor: '#F5A623', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: '#F5A623', fontSize: 11, fontWeight: '800' }}>{totalPoints} pts · {pointsTier}</Text>
                </View>
              </View>
            </View>
          </View>
          {/* Three stat tiles: Rounds / Accuracy / Shots */}
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={styles.tileNum}>{dash?.totalRounds ?? 0}</Text>
              <Text style={styles.tileLabel}>{t('rounds')}</Text>
            </View>
            <View style={[styles.tile, { borderColor: '#fbbf24' }]}>
              <Text style={[styles.tileNum, { color: '#fbbf24' }]}>{accuracy}%</Text>
              <Text style={styles.tileLabel}>{t('accuracy')}</Text>
            </View>
            <View style={[styles.tile, { borderColor: '#60a5fa' }]}>
              <Text style={[styles.tileNum, { color: '#60a5fa' }]}>{totalShotCount}</Text>
              <Text style={styles.tileLabel}>{t('shots')}</Text>
            </View>
          </View>
          {/* Handicap row: Index / Course Hcp / Slope */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 18 }}>
                {handicap % 1 === 0 ? handicap : handicap.toFixed(1)}
              </Text>
              <Text style={styles.cardSub}>Index</Text>
            </View>
            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 18 }}>
                {Math.round(handicap * (slopeRating / 113))}
              </Text>
              <Text style={styles.cardSub}>Course Hcp</Text>
            </View>
            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: 4 }}>
              <Pressable onPress={() => setSlopeRating((p) => Math.max(55, p - 1))} style={{ backgroundColor: '#1e1e1e', borderRadius: 6, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 16 }}>-</Text>
              </Pressable>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 18 }}>{slopeRating}</Text>
                <Text style={styles.cardSub}>Slope</Text>
              </View>
              <Pressable onPress={() => setSlopeRating((p) => Math.min(155, p + 1))} style={{ backgroundColor: '#1e1e1e', borderRadius: 6, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 16 }}>+</Text>
              </Pressable>
            </View>
          </View>
          {/* Progress text */}
          <Text style={{ color: totalShotCount < 20 ? '#aaa' : '#A7F3D0', fontSize: 12, marginTop: 10 }}>
            {progressText}
          </Text>
          {lastRoundDate && (
            <Text style={{ color: '#aaa', fontSize: 11, marginTop: 2 }}>Last round: {lastRoundDate}</Text>
          )}
        </View>

        {/* ── CARD 2: SHOT MAP (once) ──────────────────────────────── */}
        <View style={[styles.card, { marginBottom: 12 }]}>
          <Text style={styles.cardTitle}>{t('shotDispersion')}</Text>
          <View style={{ position: 'relative', marginTop: 8 }}>
            <View style={{ flexDirection: 'row', height: 110, borderRadius: 8, overflow: 'hidden' }}>
              <View style={{ flex: 1, backgroundColor: '#5D4037' }} />
              <View style={{ flex: 1.5, backgroundColor: '#2E7D32' }} />
              <View style={{ flex: 1, backgroundColor: '#4CAF50' }} />
              <View style={{ flex: 1.5, backgroundColor: '#2E7D32' }} />
              <View style={{ flex: 1, backgroundColor: '#5D4037' }} />
            </View>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 110 }}>
              <View style={{ position: 'absolute', left: '50%', top: 0, marginLeft: -1, width: 2, height: 110, backgroundColor: 'rgba(255,255,255,0.2)' }} />
              <View style={{ position: 'absolute', left: `${aimPct}%`, top: 2, marginLeft: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: '#10B981', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 8, color: '#fff' }}>V</Text>
              </View>
              {shots.slice(-10).map((shot: any, index: any) => {
                const leftPct = shot.result === 'left' ? 15 : shot.result === 'right' ? 85 : 50;
                const dotColor = shot.result === 'left' ? '#ff5252' : shot.result === 'right' ? '#448aff' : '#ffffff';
                return <View key={index} style={{ position: 'absolute', left: `${leftPct}%`, top: 24 + (index % 3) * 8, width: 10, height: 10, borderRadius: 5, backgroundColor: dotColor, marginLeft: -5, opacity: 0.9, borderWidth: 1, borderColor: 'rgba(0,0,0,0.4)' }} />;
              })}
            </View>
          </View>
          {/* Color legend */}
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            {[{ label: 'ROUGH', flex: 1 }, { label: 'FAIRWAY', flex: 1.5 }, { label: 'CENTER', flex: 1 }, { label: 'FAIRWAY', flex: 1.5 }, { label: 'ROUGH', flex: 1 }].map((z, i) => (
              <Text key={i} style={{ flex: z.flex, color: '#aaa', fontSize: 9, textAlign: 'center' }}>{z.label}</Text>
            ))}
          </View>
          {shots.length === 0 && <Text style={{ color: '#aaa', fontSize: 12, textAlign: 'center', marginTop: 8 }}>Log shots to see dispersion</Text>}
          <Text style={{ color: '#aaa', fontSize: 10, marginTop: 6, textAlign: 'center' }}>green=aim  red=left  white=straight  blue=right  (last 10)</Text>
        </View>

        {/* ── CARD 3: PERFORMANCE (once) ───────────────────────────── */}
        <View style={[styles.card, { marginBottom: 12 }]}>
          <Text style={styles.cardTitle}>Shot Record</Text>
          {shots.length === 0 ? (
            <Text style={{ color: '#aaa', fontSize: 13, marginTop: 4 }}>No shots this round yet.</Text>
          ) : (
            <View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 }}>
                {shots.slice().reverse().map((shot: any, i: any) => (
                  <View key={i} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: getShotColor(shot.result), borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }} />
                ))}
              </View>
              {getPattern() && (
                <View style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                    <View style={{ flex: getPattern()!.left, backgroundColor: '#60a5fa' }} />
                    <View style={{ flex: getPattern()!.straight, backgroundColor: '#A7F3D0' }} />
                    <View style={{ flex: getPattern()!.right, backgroundColor: '#f87171' }} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: '#60a5fa', fontSize: 12 }}>Left {getPattern()!.left}%</Text>
                    <Text style={{ color: '#A7F3D0', fontSize: 12 }}>Straight {getPattern()!.straight}%</Text>
                    <Text style={{ color: '#f87171', fontSize: 12 }}>Right {getPattern()!.right}%</Text>
                  </View>
                  <Text style={{ color: '#d1fae5', fontSize: 14, marginTop: 10, lineHeight: 20 }}>{getInsight()}</Text>
                  <Pressable
                    onPress={() => { void speakJob(getInsight()); }}
                    style={({ pressed }) => [styles.btnPrimary, pressed && styles.btnPrimaryPressed, { marginTop: 10 }]}
                  >
                    <Text style={styles.btnPrimaryText}>Speak Insight</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
          {/* Club Info breakdown */}
          {shots.length >= 3 && (
            <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 10 }}>
              <Text style={[styles.cardTitle, { marginBottom: 8 }]}>Club Info</Text>
              {Object.entries(getClubStats()).map(([c, d]) => {
                const acc = Math.round((d.center / d.total) * 100);
                const tendency = d.left > d.right ? 'left' : d.right > d.left ? 'right' : null;
                return (
                  <View key={c} style={{ backgroundColor: '#111', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{c}</Text>
                      <Text style={{ color: acc >= 60 ? '#66bb6a' : acc >= 40 ? '#f9a825' : '#f87171', fontWeight: '700', fontSize: 13 }}>{acc}% accurate</Text>
                    </View>
                    <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8, marginBottom: 6 }}>
                      <View style={{ flex: d.left, backgroundColor: '#60a5fa' }} />
                      <View style={{ flex: d.center, backgroundColor: '#A7F3D0' }} />
                      <View style={{ flex: d.right, backgroundColor: '#f87171' }} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Text style={{ color: '#60a5fa', fontSize: 11 }}>L: {d.left}</Text>
                      <Text style={{ color: '#A7F3D0', fontSize: 11 }}>S: {d.center}</Text>
                      <Text style={{ color: '#f87171', fontSize: 11 }}>R: {d.right}</Text>
                      {tendency && <Text style={{ color: '#fbbf24', fontSize: 11, marginLeft: 'auto' }}>tends {tendency}</Text>}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── CARD 4: CAGE SESSIONS (conditional) ─────────────────── */}
        {hasCageData && (
          <View style={[styles.card, { marginBottom: 12 }]}>
            <Text style={styles.cardTitle}>Cage Sessions</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 8, rowGap: 10 }}>
              <View style={{ alignItems: 'center', minWidth: 90, flex: 1 }}>
                <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 20 }}>{totalCageShots}</Text>
                <Text style={styles.cardSub}>Total Shots</Text>
              </View>
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 8, alignSelf: 'stretch' }} />
              <View style={{ alignItems: 'center', minWidth: 90, flex: 1 }}>
                <Text style={{ color: '#fbbf24', fontWeight: '700', fontSize: 16, textTransform: 'capitalize' }}>{dominantCageMiss ?? '--'}</Text>
                <Text style={styles.cardSub}>Dominant Miss</Text>
              </View>
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 8, alignSelf: 'stretch' }} />
              <View style={{ alignItems: 'center', minWidth: 90, flex: 1 }}>
                <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 15 }}>{lastCageDate}</Text>
                <Text style={styles.cardSub}>Last Session</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── CARD 5: PERSONAL BEST (conditional) ─────────────────── */}
        {personalBest !== null && (
          <View style={[styles.card, { marginBottom: 12 }]}>
            <Text style={styles.cardTitle}>Personal Best</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <View>
                <Text style={{ color: '#fbbf24', fontWeight: '800', fontSize: 28 }}>{personalBest}</Text>
                <Text style={styles.cardSub}>shots</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '600' }}>{activeCourseStore || '--'}</Text>
                <Text style={{ color: '#aaa', fontSize: 11, marginTop: 2 }}>{bestRoundDate}</Text>
              </View>
            </View>
            {dash && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {dash.totalRounds >= 10 && (
                  <View style={[styles.badge, { backgroundColor: '#1a4a2e' }]}><Text style={[styles.badgeText, { color: '#fbbf24' }]}>10 Rounds</Text></View>
                )}
                {dash.totalShots >= 100 && (
                  <View style={[styles.badge, { backgroundColor: '#1a4a2e' }]}><Text style={[styles.badgeText, { color: '#fbbf24' }]}>100 Shots</Text></View>
                )}
                {accuracy >= 60 && (
                  <View style={[styles.badge, { backgroundColor: '#1a4a2e' }]}><Text style={[styles.badgeText, { color: '#A7F3D0' }]}>60%+ Accuracy</Text></View>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── CARD 6: ROUND HISTORY (always at bottom) ─────────────── */}
        <View style={[styles.card, { marginBottom: 12 }]}>
          {/* Internal toggle */}
          <View style={[styles.segmented, { marginBottom: 12 }]}>
            {(['current', 'past'] as const).map((t) => (
              <Pressable key={t} onPress={() => setRoundTab(t)} style={[styles.segBtn, roundTab === t && styles.segBtnActive]}>
                <Text style={[styles.segLabel, roundTab === t && styles.segLabelActive]}>
                  {t === 'current' ? 'Current Round' : 'Past Rounds'}
                </Text>
              </Pressable>
            ))}
          </View>

          {roundTab === 'current' && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text style={styles.cardTitle}>Log Shot</Text>
                {shots.length > 0 && (
                  <Pressable onPress={clearRound}>
                    <Text style={styles.clearRoundText}>Clear Round</Text>
                  </Pressable>
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['left', 'center', 'right'] as const).map((val) => (
                  <Pressable
                    key={val}
                    onPress={() => logShot(val)}
                    style={({ pressed }) => [
                      styles.shotBtnBase,
                      layout.isSmall && styles.shotBtnBaseSmall,
                      shotResult === val && { backgroundColor: val === 'left' ? '#12385a' : val === 'right' ? '#4a1111' : '#153722' },
                      pressed && shotResult !== val && styles.shotBtnPressed,
                      { borderColor: getShotColor(val) },
                    ]}
                  >
                    <Text style={[styles.shotBtnLabel, layout.isSmall && styles.shotBtnLabelSmall, { color: getShotColor(val) }]}>
                      {val === 'left' ? '← L' : val === 'right' ? 'R →' : '↑ Str'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ color: Palette.textSub, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
                {shots.length} shot{shots.length !== 1 ? 's' : ''} logged this round
              </Text>
            </>
          )}

          {roundTab === 'past' && (
            <>
              {(() => {
                const summaries = deriveRoundSummaries(localRounds);
                const { avgScore, commonMiss } = getOverallTendencies(summaries);
                const progress = getProgressLabel(summaries);
                const progressColor = progress === 'Trending better' ? '#A7F3D0' : progress === 'Slight regression' ? '#fca5a5' : '#d1fae5';
                if (summaries.length === 0 && cloudRounds.length === 0) return (
                  <Text style={{ color: '#aaa', fontSize: 13, textAlign: 'center', paddingVertical: 8 }}>No round history yet. Play a round and it will appear here.</Text>
                );
                return (
                  <>
                    {avgScore !== null && <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 }}>Avg Score: {avgScore}</Text>}
                    <Text style={{ color: '#d1fae5', fontSize: 13, marginBottom: 4 }}>Common Miss: {commonMiss}</Text>
                    <Text style={{ color: progressColor, fontSize: 13, fontWeight: '700', marginBottom: 10 }}>{progress}</Text>
                    {cloudRounds.map((r) => (
                      <View key={r.id} style={{ backgroundColor: '#0a2e1a', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                        <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 14 }}>{r.course ?? 'Round'}</Text>
                        <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{r.date ? new Date(r.date).toLocaleDateString() : ''}</Text>
                        {Array.isArray(r.players) && r.totals && r.players.map((p: string, i: number) => (
                          <Text key={i} style={{ color: p === r.winner ? '#66bb6a' : '#d1fae5', fontSize: 13, marginTop: 2 }}>
                            {p}: {r.totals[i]}{p === r.winner ? ' Trophy' : ''}
                          </Text>
                        ))}
                      </View>
                    ))}
                    {localRounds.map((r, index) => (
                      <View key={`local-${index}`} style={{ backgroundColor: '#0a2e1a', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                        <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 13 }}>Round {index + 1}</Text>
                        <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{r.date ? new Date(r.date).toLocaleDateString() : 'Date unknown'}</Text>
                        <Text style={{ color: '#d1fae5', fontSize: 13, marginTop: 4 }}>Shots: {r.shots.length}</Text>
                      </View>
                    ))}
                  </>
                );
              })()}
            </>
          )}

          {/* Replay / Watch Highlights — always at bottom of card */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' }}>
            <Pressable
              onPress={() => router.push('/round-replay' as any)}
              style={({ pressed }) => [styles.btnPrimary, styles.btnHalf, pressed && styles.btnPrimaryPressed]}
            >
              <Text style={styles.btnPrimaryText}>Replay Round</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/highlight-reel' as any)}
              style={({ pressed }) => [styles.btnInfo, styles.btnHalf, pressed && styles.btnInfoPressed]}
            >
              <Text style={styles.btnInfoText}>Watch Highlights</Text>
            </Pressable>
          </View>
        </View>

        {/* ── CARD 7: CAGE BUILD PROMPT (no cage data) ─────────────── */}
        {!hasCageData && (
          <View style={[styles.card, { marginBottom: 12, borderColor: '#2e5533', backgroundColor: '#0d2b0d', paddingBottom: 40 }]}>
            <Text style={[styles.cardTitle, { color: '#A7F3D0', fontSize: 15 }]}>Build Your Swing Profile</Text>
            <Text style={{ color: '#d1fae5', fontSize: 13, lineHeight: 20, marginTop: 6 }}>
              Hit the cage before your next round.{'\n'}20 shots gives your caddie real data.
            </Text>
            <Pressable
              onPress={() => router.push('/cage' as any)}
              style={({ pressed }) => [styles.btnPrimary, pressed && styles.btnPrimaryPressed, { marginTop: 12 }]}
            >
              <Text style={styles.btnPrimaryText}>Open Cage</Text>
            </Pressable>
          </View>
        )}

            <View style={{ height: 40 }} />
          </ScrollView>
        }
        right={
          <ScrollView
            style={styles.splitPanel}
            contentContainerStyle={styles.splitPanelContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.splitTitle, { fontSize: 15 * fontScale }]}>Live Snapshot</Text>
            <View style={styles.splitStatCard}>
              <Text style={styles.splitStatLabel}>ACCURACY</Text>
              <Text style={[styles.splitStatValue, { fontSize: 28 * fontScale }]}>{accuracy}%</Text>
            </View>
            <View style={styles.splitStatCard}>
              <Text style={styles.splitStatLabel}>TOTAL SHOTS</Text>
              <Text style={[styles.splitStatValue, { fontSize: 28 * fontScale }]}>{dash?.totalShots ?? 0}</Text>
            </View>
            <View style={styles.splitStatCard}>
              <Text style={styles.splitStatLabel}>TOP CLUB</Text>
              <Text style={[styles.splitTipText, { fontSize: 14 * fontScale }]}>{topClub ?? '--'}</Text>
            </View>
            <View style={styles.splitTipCard}>
              <Text style={styles.splitTipLabel}>FOCUS TIP</Text>
              <Text style={[styles.splitTipText, { fontSize: 14 * fontScale }]}>{tip}</Text>
            </View>
            <View style={styles.splitStatCard}>
              <Text style={styles.splitStatLabel}>POINTS</Text>
              <Text style={[styles.splitTipText, { fontSize: 14 * fontScale }]}>{totalPoints} pts · {pointsTier}</Text>
            </View>
            <View style={{ height: 16 }} />
          </ScrollView>
        }
      />
    </>
  );
}

// Styles
const styles = StyleSheet.create({
  container:      DS.screen,
  content:        { width: '100%' },
  contentSingle:  { alignSelf: 'center', maxWidth: 560, paddingHorizontal: 16, paddingTop: 60, paddingBottom: 40 },
  contentSplit:   { alignSelf: 'stretch', paddingHorizontal: 12, paddingTop: 18, paddingBottom: 24 },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  greeting:       { fontSize: Type.body, color: Palette.positive, fontWeight: Type.medium },
  playerName:     { fontSize: Type.h2, fontWeight: Type.black, color: Palette.textPrimary, marginTop: 2 },
  badge:          { backgroundColor: Palette.bgActive, borderRadius: Radius.md, paddingHorizontal: Space.sm, paddingVertical: 4, borderWidth: 1, borderColor: Palette.borderActive },
  badgeText:      { color: Palette.positiveFaint, fontSize: Type.xs, fontWeight: Type.bold },
  segmented:      { flexDirection: 'row', backgroundColor: Palette.cardBgDark, borderRadius: Radius.md, padding: 4, marginBottom: Space.lg, borderWidth: 1, borderColor: Palette.border },
  segBtn:         { flex: 1, paddingVertical: Space.sm, borderRadius: Radius.sm, alignItems: 'center' },
  segBtnActive:   { backgroundColor: Palette.bgActive },
  segLabel:       { color: Palette.textSub, fontWeight: Type.bold, fontSize: Type.sm },
  segLabelActive: { color: Palette.textPrimary },
  tileRow:        { flexDirection: 'row', gap: 10, marginBottom: 14 },
  tile:           { flex: 1, backgroundColor: Palette.cardBg, borderRadius: Radius.lg, padding: Space.md, alignItems: 'center', borderWidth: 1, borderColor: Palette.border },
  tileNum:        { fontSize: Type.xl, fontWeight: Type.black, color: Palette.positiveFaint },
  tileLabel:      { fontSize: Type.xs, color: Palette.positive, marginTop: 3, fontWeight: Type.semibold },
  card:           { ...DS.card, marginBottom: Space.sm },
  cardTitle:      { fontSize: Type.body, fontWeight: Type.bold, color: Palette.positive, marginBottom: 2 },
  cardSub:        { fontSize: Type.sm, color: Palette.textMuted, marginTop: 1 },
  sectionHeader:  { fontSize: Type.md, fontWeight: Type.bold, color: Palette.positiveFaint, marginTop: 6, marginBottom: 10 },
  miniChip:       { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  splitPanel: {
    flex: 1,
    backgroundColor: Palette.cardBgDark,
    borderLeftWidth: 1,
    borderLeftColor: Palette.border,
  },
  splitPanelContent: {
    padding: 16,
    gap: 10,
    paddingBottom: 26,
  },
  splitTitle: {
    color: Palette.positiveFaint,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  splitStatCard: {
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 14,
  },
  splitStatLabel: {
    color: Palette.positive,
    fontSize: Type.xs,
    fontWeight: Type.bold,
    letterSpacing: 1,
    marginBottom: 6,
  },
  splitStatValue: {
    color: Palette.textPrimary,
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
  btnPrimary: {
    backgroundColor: '#123126',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2ECC71',
  },
  btnPrimaryPressed: {
    backgroundColor: '#164332',
  },
  btnPrimaryText: {
    color: '#C5FFE7',
    fontWeight: '700',
    fontSize: 13,
  },
  btnInfo: {
    backgroundColor: '#0f2533',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3A7CA8',
  },
  btnInfoPressed: {
    backgroundColor: '#163244',
  },
  btnInfoText: {
    color: '#BEE7FF',
    fontWeight: '700',
    fontSize: 13,
  },
  btnHalf: {
    flex: 1,
  },
  clearRoundText: {
    color: '#FF9D9D',
    fontSize: 13,
    fontWeight: '700',
  },
  shotBtnBase: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#111a16',
    borderWidth: 1.5,
  },
  shotBtnBaseSmall: {
    paddingVertical: 11,
    borderRadius: 10,
  },
  shotBtnPressed: {
    backgroundColor: '#1a2a24',
  },
  shotBtnLabel: {
    fontWeight: '800',
    fontSize: 15,
  },
  shotBtnLabelSmall: {
    fontSize: 13,
  },
});






