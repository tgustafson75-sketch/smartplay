/**
 * Dashboard tab — combines Stats overview + Live round logging + Past rounds history.
 * Three sub-sections accessed via a segmented toggle: STATS | ROUND | HISTORY
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  Image, Animated,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { speak } from '../../services/voiceService';
import { useUserStore } from '../../store/userStore';
import { useMemoryStore } from '../../store/memoryStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRoundStore } from '../../store/roundStore';

const ICON_RANGEFINDER = require('../../assets/images/icon-rangefinder.png');

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
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
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
  const [section, setSection] = useState<'stats' | 'round' | 'history'>('stats');
  const [dash, setDash] = useState<DashData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cloudRounds, setCloudRounds] = useState<any[]>([]);
  const [localRounds, setLocalRounds] = useState<Array<{ date: string; shots: any[] }>>([]);
  const [showRangefinder, setShowRangefinder] = useState(false);
  const rfScale = useRef(new Animated.Value(1)).current;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const displayName = useUserStore((s) => s.displayName || s.name || 'Golfer');
  const handicap    = useUserStore((s) => s.handicap);
  const goal        = useUserStore((s) => s.goal);
  const clubUsage   = useMemoryStore((s) => s.clubUsage);
  const typicalMiss = usePlayerProfileStore((s) => s.typicalMiss);
  const biggestStruggle = usePlayerProfileStore((s) => s.biggestStruggle);
  const activeCourseStore = useRoundStore((s) => s.activeCourse);

  const shots        = useRoundStore((s) => s.shots);
  const shotResult   = useRoundStore((s) => s.shotResult);
  const aim          = useRoundStore((s) => s.aim);
  const club         = useRoundStore((s) => s.club);
  const addShot      = useRoundStore((s) => s.addShot);
  const clearRound   = useRoundStore((s) => s.clearRound);

  const defaultSlope = COURSE_RATINGS[activeCourseStore]?.slope ?? 120;
  const [slopeRating, setSlopeRating] = useState(defaultSlope);

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('rounds');
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
    const q = query(collection(db, 'users', userId, 'rounds'), orderBy('createdAt', 'desc'));
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
      setTimeout(() => { void speak(cue); }, 1200);
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

  const logShot = (result: string) => {
    addShot({ result, mental: '', club, aim, timestamp: Date.now(), hole: 0, distance: 0 });
    if (result === 'left') void speak('Pulled left.');
    else if (result === 'right') void speak('Missed right.');
    else void speak('Straight.');
  };

  const getClubStats = () => {
    const stats: Record<string, { left: number; right: number; straight: number; total: number }> = {};
    shots.forEach((s) => {
      if (!stats[s.club]) stats[s.club] = { left: 0, right: 0, straight: 0, total: 0 };
      stats[s.club].total++;
      if (s.result === 'left') stats[s.club].left++;
      else if (s.result === 'right') stats[s.club].right++;
      else stats[s.club].straight++;
    });
    return stats;
  };

  const getPattern = () => {
    if (shots.length === 0) return null;
    const left = shots.filter((s) => s.result === 'left').length;
    const right = shots.filter((s) => s.result === 'right').length;
    const straight = shots.filter((s) => s.result === 'straight').length;
    return {
      left: Math.round((left / shots.length) * 100),
      right: Math.round((right / shots.length) * 100),
      straight: Math.round((straight / shots.length) * 100),
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
    const wideCount = recent.filter((s) => s.result !== 'straight').length;
    const tightCount = recent.filter((s) => s.result === 'straight').length;
    if (wideCount > tightCount) return "You tend to struggle when shots spread out -- play safer.";
    if (tightCount > wideCount) return "You perform best when dialled in -- trust your swing.";
    return "You're showing a balanced pattern today.";
  };

  const aimPct = aim === 'left edge' ? 10 : aim === 'left center' ? 30 : aim === 'center' ? 50 : aim === 'right center' ? 70 : 90;

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#A7F3D0" />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()},</Text>
            <Text style={styles.playerName}>{displayName}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            {handicap > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>HCP {handicap}</Text>
              </View>
            )}
            {goal && (
              <View style={[styles.badge, { backgroundColor: '#1a4a2e' }]}>
                <Text style={[styles.badgeText, { color: '#fbbf24' }]}>
                  {goal === 'break90' ? 'Goal: Break 90' : 'Goal: Break 100'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Segmented Toggle */}
        <View style={styles.segmented}>
          {(['stats', 'round', 'history'] as const).map((s) => (
            <Pressable key={s} onPress={() => setSection(s)} style={[styles.segBtn, section === s && styles.segBtnActive]}>
              <Text style={[styles.segLabel, section === s && styles.segLabelActive]}>
                {s === 'stats' ? 'Stats' : s === 'round' ? 'Round' : 'History'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* STATS */}
        {section === 'stats' && (
          <>
            <View style={styles.tileRow}>
              <View style={styles.tile}>
                <Text style={styles.tileNum}>{dash?.totalRounds ?? 0}</Text>
                <Text style={styles.tileLabel}>Rounds</Text>
              </View>
              <View style={[styles.tile, { borderColor: '#fbbf24' }]}>
                <Text style={[styles.tileNum, { color: '#fbbf24' }]}>{accuracy}%</Text>
                <Text style={styles.tileLabel}>Accuracy</Text>
              </View>
              <View style={[styles.tile, { borderColor: '#60a5fa' }]}>
                <Text style={[styles.tileNum, { color: '#60a5fa' }]}>{dash?.bestScore ?? '--'}</Text>
                <Text style={styles.tileLabel}>Best</Text>
              </View>
            </View>

            {(dash?.streak ?? 0) > 0 && (
              <View style={[styles.card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
                <View>
                  <Text style={styles.cardTitle}>Active Streak</Text>
                  <Text style={styles.cardSub}>{dash!.streak === 1 ? 'Round logged today' : `${dash!.streak} days in a row`}</Text>
                </View>
                <Text style={{ fontSize: 28 }}>{dash!.streak >= 3 ? 'FIRE' : 'GOLF'} {dash!.streak}</Text>
              </View>
            )}

            {dash && dash.totalShots > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Shot Direction Split</Text>
                <Text style={styles.cardSub}>{dash.totalShots} total shots</Text>
                <View style={{ gap: 8, marginTop: 8 }}>
                  {[
                    { label: 'Straight', count: dash.straight, color: '#66bb6a' },
                    { label: 'Right',    count: dash.right,    color: '#f87171' },
                    { label: 'Left',     count: dash.left,     color: '#60a5fa' },
                  ].map(({ label, count, color }) => {
                    const pct = dash.totalShots > 0 ? count / dash.totalShots : 0;
                    return (
                      <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: '#ccc', fontSize: 12, width: 52 }}>{label}</Text>
                        <View style={{ flex: 1, height: 12, backgroundColor: '#0a1a0a', borderRadius: 6, overflow: 'hidden' }}>
                          <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: 6 }} />
                        </View>
                        <Text style={{ color, fontSize: 12, width: 36, textAlign: 'right', fontWeight: '700' }}>{Math.round(pct * 100)}%</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {dash && dash.recentScores.length >= 2 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Score Trend</Text>
                <Text style={styles.cardSub}>Last {dash.recentScores.length} rounds (lower = better)</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 52, marginTop: 8 }}>
                  {dash.recentScores.map((score, i) => {
                    const pct = sparkMax > sparkMin ? (score - sparkMin) / (sparkMax - sparkMin) : 0.5;
                    const barH = Math.round(8 + pct * 40);
                    const isLast = i === dash.recentScores.length - 1;
                    const barColor = pct < 0.4 ? '#66bb6a' : pct > 0.7 ? '#f87171' : '#fbbf24';
                    return (
                      <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <Text style={{ color: '#ccc', fontSize: 9, marginBottom: 2 }}>{score}</Text>
                        <View style={{ width: '85%', height: barH, backgroundColor: barColor, borderRadius: 3, opacity: isLast ? 1 : 0.6, borderWidth: isLast ? 1 : 0, borderColor: '#fff' }} />
                      </View>
                    );
                  })}
                </View>
                {(() => {
                  const first = dash.recentScores[0];
                  const last  = dash.recentScores[dash.recentScores.length - 1];
                  const delta = last - first;
                  const label = delta < -1 ? 'Improving' : delta > 2 ? 'Regressing' : 'Consistent';
                  const color = delta < -1 ? '#66bb6a' : delta > 2 ? '#f87171' : '#fbbf24';
                  return <Text style={{ color, fontSize: 13, fontWeight: '700', marginTop: 8 }}>{label}</Text>;
                })()}
              </View>
            )}

            {topClub && (
              <View style={[styles.card, { flexDirection: 'row', justifyContent: 'space-between' }]}>
                <View>
                  <Text style={styles.cardTitle}>Most Used Club</Text>
                  <Text style={styles.cardSub}>From all tracked rounds</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 20 }}>CLUB</Text>
                  <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 13, marginTop: 2 }}>{topClub}</Text>
                </View>
              </View>
            )}

            <View style={[styles.card, { borderColor: '#2e5533', backgroundColor: '#0d2b0d' }]}>
              <Text style={[styles.cardTitle, { color: '#A7F3D0' }]}>Today’s Focus</Text>
              <Text style={{ color: '#d1fae5', fontSize: 14, lineHeight: 21, marginTop: 6 }}>{tip}</Text>
            </View>

            <Text style={styles.sectionHeader}>Recent Rounds</Text>
            {(dash?.recentActivity.length ?? 0) === 0 ? (
              <View style={styles.card}>
                <Text style={{ color: '#aaa', fontSize: 13, textAlign: 'center' }}>
                  No rounds logged yet -- play a round to see history here.
                </Text>
              </View>
            ) : (
              dash!.recentActivity.map((item, i) => (
                <View key={i} style={[styles.card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{item.shots} shots</Text>
                    <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{msToDateStr(item.date)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    <View style={[styles.miniChip, {
                      backgroundColor: item.missBias === 'Straight' ? '#14532d' : item.missBias === 'Right' ? '#450a0a' : '#1e3a5f',
                    }]}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: item.missBias === 'Straight' ? '#86efac' : item.missBias === 'Right' ? '#fca5a5' : '#93c5fd' }}>
                        {item.missBias}
                      </Text>
                    </View>
                    {item.topClub !== '--' && <Text style={{ color: '#aaa', fontSize: 11 }}>{item.topClub}</Text>}
                  </View>
                </View>
              ))
            )}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Handicap &amp; Profile</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 20 }}>
                    {handicap % 1 === 0 ? handicap : handicap.toFixed(1)}
                  </Text>
                  <Text style={styles.cardSub}>Handicap Index</Text>
                </View>
                <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 20 }}>
                    {Math.round(handicap * (slopeRating / 113))}
                  </Text>
                  <Text style={styles.cardSub}>Course Hcp</Text>
                  <Text style={{ color: '#aaa', fontSize: 10, marginTop: 1 }}>Slope {slopeRating}</Text>
                </View>
                <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
                  <Pressable onPress={() => setSlopeRating((p) => Math.max(55, p - 1))} style={{ backgroundColor: '#1e1e1e', borderRadius: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 18 }}>-</Text>
                  </Pressable>
                  <Text style={{ color: '#ccc', fontSize: 11 }}>Slope</Text>
                  <Pressable onPress={() => setSlopeRating((p) => Math.min(155, p + 1))} style={{ backgroundColor: '#1e1e1e', borderRadius: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 18 }}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </>
        )}

        {/* ROUND */}
        {section === 'round' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Player Profile</Text>
              <Text style={{ fontSize: 14, lineHeight: 22, marginTop: 6, color: shots.length < 10 ? '#aaa' : '#A7F3D0' }}>{getPlayerMemory()}</Text>
            </View>

            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text style={styles.cardTitle}>Log Shot</Text>
                {shots.length > 0 && (
                  <Pressable onPress={clearRound}>
                    <Text style={{ color: '#f87171', fontSize: 13, fontWeight: '600' }}>Clear Round</Text>
                  </Pressable>
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['left', 'straight', 'right'] as const).map((val) => (
                  <Pressable
                    key={val}
                    onPress={() => logShot(val)}
                    style={({ pressed }) => ({
                      flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center',
                      backgroundColor: shotResult === val ? (val === 'left' ? '#1565c0' : val === 'right' ? '#b71c1c' : '#1b5e20') : pressed ? '#222' : '#1a1a1a',
                      borderWidth: 1.5, borderColor: getShotColor(val),
                    })}
                  >
                    <Text style={{ color: getShotColor(val), fontWeight: '800', fontSize: 15 }}>
                      {val === 'left' ? '<- Left' : val === 'right' ? 'Right ->' : '^ Straight'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ color: '#aaa', fontSize: 12, marginTop: 8, textAlign: 'center' }}>
                {shots.length} shot{shots.length !== 1 ? 's' : ''} logged this round
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Shot Map</Text>
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
                  {shots.slice(-10).map((shot, index) => {
                    const leftPct = shot.result === 'left' ? 15 : shot.result === 'right' ? 85 : 50;
                    const dotColor = shot.result === 'left' ? '#ff5252' : shot.result === 'right' ? '#448aff' : '#ffffff';
                    return <View key={index} style={{ position: 'absolute', left: `${leftPct}%`, top: 24 + (index % 3) * 8, width: 10, height: 10, borderRadius: 5, backgroundColor: dotColor, marginLeft: -5, opacity: 0.9, borderWidth: 1, borderColor: 'rgba(0,0,0,0.4)' }} />;
                  })}
                </View>
              </View>
              <View style={{ flexDirection: 'row', marginTop: 4 }}>
                {[{ label: 'ROUGH', flex: 1 }, { label: 'FAIRWAY', flex: 1.5 }, { label: 'CENTER', flex: 1 }, { label: 'FAIRWAY', flex: 1.5 }, { label: 'ROUGH', flex: 1 }].map((z, i) => (
                  <Text key={i} style={{ flex: z.flex, color: '#aaa', fontSize: 9, textAlign: 'center' }}>{z.label}</Text>
                ))}
              </View>
              {shots.length === 0 && <Text style={{ color: '#aaa', fontSize: 12, textAlign: 'center', marginTop: 8 }}>Log shots to see dispersion</Text>}
              <Text style={{ color: '#aaa', fontSize: 10, marginTop: 6, textAlign: 'center' }}>green=aim  red=left  white=straight  blue=right  (last 10)</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Shot Record</Text>
              {shots.length === 0 ? (
                <Text style={{ color: '#aaa', fontSize: 13, marginTop: 4 }}>No shots this round yet.</Text>
              ) : (
                <View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 }}>
                    {shots.slice().reverse().map((shot, i) => (
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
                      onPress={() => { void speak(getInsight()); }}
                        style={({ pressed }) => ({ backgroundColor: pressed ? '#1b5e20' : '#1a1a1a', borderRadius: 8, padding: 8, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#2e7d32' })}
                      >
                        <Text style={{ color: '#A7F3D0', fontSize: 13 }}>Speak Insight</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Club Info</Text>
              {shots.length < 3 ? (
                <Text style={{ color: '#aaa', fontSize: 13, marginTop: 4 }}>Log at least 3 shots to see club stats.</Text>
              ) : (
                <View style={{ marginTop: 8 }}>
                  {Object.entries(getClubStats()).map(([c, d]) => {
                    const acc = Math.round((d.straight / d.total) * 100);
                    const tendency = d.left > d.right ? 'left' : d.right > d.left ? 'right' : null;
                    return (
                      <View key={c} style={{ backgroundColor: '#111', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{c}</Text>
                          <Text style={{ color: acc >= 60 ? '#66bb6a' : acc >= 40 ? '#f9a825' : '#f87171', fontWeight: '700', fontSize: 13 }}>{acc}% accurate</Text>
                        </View>
                        <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8, marginBottom: 6 }}>
                          <View style={{ flex: d.left, backgroundColor: '#60a5fa' }} />
                          <View style={{ flex: d.straight, backgroundColor: '#A7F3D0' }} />
                          <View style={{ flex: d.right, backgroundColor: '#f87171' }} />
                        </View>
                        <View style={{ flexDirection: 'row', gap: 12 }}>
                          <Text style={{ color: '#60a5fa', fontSize: 11 }}>L: {d.left}</Text>
                          <Text style={{ color: '#A7F3D0', fontSize: 11 }}>S: {d.straight}</Text>
                          <Text style={{ color: '#f87171', fontSize: 11 }}>R: {d.right}</Text>
                          {tendency && <Text style={{ color: '#fbbf24', fontSize: 11, marginLeft: 'auto' }}>tends {tendency}</Text>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}

        {/* HISTORY */}
        {section === 'history' && (
          <>
            {(() => {
              const summaries = deriveRoundSummaries(localRounds);
              const { avgScore, commonMiss } = getOverallTendencies(summaries);
              const progress = getProgressLabel(summaries);
              const progressColor = progress === 'Trending better' ? '#A7F3D0' : progress === 'Slight regression' ? '#fca5a5' : '#d1fae5';
              if (summaries.length === 0 && cloudRounds.length === 0) return (
                <View style={styles.card}>
                  <Text style={{ color: '#aaa', fontSize: 13, textAlign: 'center' }}>No round history yet. Play a round and it will appear here.</Text>
                </View>
              );
              return (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Tendencies</Text>
                  {avgScore !== null && <Text style={{ color: '#fff', fontSize: 15, marginTop: 4, fontWeight: '700' }}>Avg Score: {avgScore}</Text>}
                  <Text style={{ color: '#d1fae5', fontSize: 14, marginTop: 2 }}>Common Miss: {commonMiss}</Text>
                  <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: progressColor, fontSize: 14, fontWeight: '700' }}>{progress}</Text>
                  </View>
                  {summaries.length >= 2 && (
                    <Pressable
                      onPress={() => {
                        const cue = progress === 'Trending better'
                          ? `You're trending better. Miss is ${commonMiss.toLowerCase()}.`
                          : progress === 'Slight regression'
                          ? `Slight regression. Watch the ${commonMiss.toLowerCase()} miss.`
                          : `You're consistent. Common miss is ${commonMiss.toLowerCase()}.`;
                        void speak(cue);
                      }}
                      style={{ marginTop: 8, backgroundColor: '#1a1a1a', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#2e7d32' }}
                    >
                      <Text style={{ color: '#A7F3D0', fontSize: 13 }}>Speak Summary</Text>
                    </Pressable>
                  )}
                </View>
              );
            })()}

            {cloudRounds.map((r) => (
              <View key={r.id} style={styles.card}>
                <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 15 }}>{r.course ?? 'Round'}</Text>
                <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{r.date ? new Date(r.date).toLocaleDateString() : ''}</Text>
                {Array.isArray(r.players) && r.totals && r.players.map((p: string, i: number) => (
                  <Text key={i} style={{ color: p === r.winner ? '#66bb6a' : '#d1fae5', fontSize: 13, marginTop: 2 }}>
                    {p}: {r.totals[i]}{p === r.winner ? ' Trophy' : ''}
                  </Text>
                ))}
              </View>
            ))}

            {localRounds.map((r, index) => (
              <View key={`local-${index}`} style={styles.card}>
                <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 14 }}>Round {index + 1}</Text>
                <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{r.date ? new Date(r.date).toLocaleDateString() : 'Date unknown'}</Text>
                <Text style={{ color: '#d1fae5', fontSize: 13, marginTop: 4 }}>Shots: {r.shots.length}</Text>
              </View>
            ))}

            {cloudRounds.length === 0 && localRounds.length === 0 && (
              <View style={styles.card}>
                <Text style={{ color: '#aaa', fontSize: 13, textAlign: 'center' }}>No past rounds saved yet.</Text>
              </View>
            )}
          </>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Rangefinder FAB */}
      <Animated.View style={{ position: 'absolute', bottom: 24, right: 20, transform: [{ scale: rfScale }] }}>
        <Pressable
          onPress={() => {
            Animated.sequence([
              Animated.timing(rfScale, { toValue: 1.25, duration: 110, useNativeDriver: true }),
              Animated.timing(rfScale, { toValue: 1, duration: 110, useNativeDriver: true }),
            ]).start();
            setShowRangefinder(true);
          }}
          style={{ backgroundColor: '#0a2e1a', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#2e7d32', shadowColor: '#4ade80', shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 }}
        >
          <Image source={ICON_RANGEFINDER} style={{ width: 28, height: 28, tintColor: '#A7F3D0' }} resizeMode="contain" />
        </Pressable>
      </Animated.View>

      {showRangefinder && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 999, justifyContent: 'center', alignItems: 'center' }}>
          <Pressable
            onPress={() => setShowRangefinder(false)}
            style={{ position: 'absolute', top: 44, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.15)', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>X</Text>
          </Pressable>
          <Text style={{ color: '#A7F3D0', fontSize: 20, fontWeight: '700', position: 'absolute', top: 50, left: 20 }}>Rangefinder</Text>
          {cameraPermission?.granted ? (
            <CameraView style={{ width: '100%', height: '100%' }} facing="back" />
          ) : (
            <View style={{ alignItems: 'center', paddingHorizontal: 32 }}>
              <Text style={{ color: '#fff', fontSize: 18, textAlign: 'center', marginBottom: 24 }}>Camera access needed for rangefinder</Text>
              <Pressable onPress={requestCameraPermission} style={{ backgroundColor: '#2e7d32', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Allow Camera</Text>
              </Pressable>
            </View>
          )}
          {cameraPermission?.granted && (
            <View style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -15 }, { translateY: -15 }] }}>
              <View style={{ width: 30, height: 2, backgroundColor: '#66bb6a' }} />
              <View style={{ width: 2, height: 30, backgroundColor: '#66bb6a', position: 'absolute', left: 14, top: -14 }} />
            </View>
          )}
        </View>
      )}
    </>
  );
}

// Styles
const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0B3D2E' },
  content:        { padding: 20, paddingTop: 60, paddingBottom: 40 },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  greeting:       { fontSize: 13, color: '#6ee7b7', fontWeight: '500' },
  playerName:     { fontSize: 26, fontWeight: '800', color: '#ffffff', marginTop: 2 },
  badge:          { backgroundColor: '#0f3d26', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#2e7d32' },
  badgeText:      { color: '#A7F3D0', fontSize: 11, fontWeight: '700' },
  segmented:      { flexDirection: 'row', backgroundColor: '#0a1f12', borderRadius: 12, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: '#1a5e30' },
  segBtn:         { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segBtnActive:   { backgroundColor: '#2e7d32' },
  segLabel:       { color: '#6ee7b7', fontWeight: '700', fontSize: 13 },
  segLabelActive: { color: '#fff' },
  tileRow:        { flexDirection: 'row', gap: 10, marginBottom: 14 },
  tile:           { flex: 1, backgroundColor: '#0a2e1a', borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1a5e30' },
  tileNum:        { fontSize: 24, fontWeight: '800', color: '#A7F3D0' },
  tileLabel:      { fontSize: 11, color: '#6ee7b7', marginTop: 3, fontWeight: '600' },
  card:           { backgroundColor: '#0a2e1a', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#1a5e30' },
  cardTitle:      { fontSize: 14, fontWeight: '700', color: '#6ee7b7', marginBottom: 2 },
  cardSub:        { fontSize: 12, color: '#aaa', marginTop: 1 },
  sectionHeader:  { fontSize: 16, fontWeight: '700', color: '#A7F3D0', marginTop: 6, marginBottom: 10 },
  miniChip:       { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
});
