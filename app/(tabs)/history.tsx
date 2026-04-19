import { useState, useEffect, useRef } from 'react';
import { DS, Palette, Space, Type, Radius } from '../../constants/theme';
import { useLayout } from '../../hooks/use-layout';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, View, Text, ScrollView, Image, Pressable, Animated } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { MaterialCommunityIcons as MCIcon } from '@expo/vector-icons';
import { speakJob, PRIORITY as ENGINE_PRIORITY } from '../../services/VoiceEngine';

const ICON_RANGEFINDER = require('../../assets/images/icon-rangefinder.png');
import { useMemoryStore } from '../../store/memoryStore';
import { useRoundStore } from '../../store/roundStore';
import { useUserStore } from '../../store/userStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAiProfileStore } from '../../store/aiProfileStore';
import { analyzeTrends } from '../../features/smartCaddie/engine/TrendEngine';
import { generateLongTermInsights } from '../../features/smartCaddie/engine/LongTermInsights';

// Mini course data for slope/rating lookup — mirrors PlayScreenClean COURSE_DB
const COURSE_RATINGS: Record<string, { slope: number; rating: number }> = {
  'Menifee Lakes':           { slope: 118, rating: 69.8 },
  'Menifee Lakes – Palms':   { slope: 118, rating: 69.8 },
  'Menifee Lakes – Lakes':   { slope: 121, rating: 70.4 },
  'Temecula Creek':          { slope: 125, rating: 71.2 },
  'Moreno Valley Ranch':     { slope: 122, rating: 70.5 },
};

// -- Round History helpers (pure) ------------------------------------------------
type RoundSummary = { date: number; score: number; toPar: number; missBias: string };

function getOverallTendencies(summaries: RoundSummary[]): { avgScore: number | null; commonMiss: string } {
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
  const first = last3[0].score;
  const last  = last3[last3.length - 1].score;
  const delta = last - first; // lower is better
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
// -----------------------------------------------------------------------------

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'GOOD MORNING';
  if (h < 17) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

export default function History() {
  const layout = useLayout();
  const tabBarHeight = useBottomTabBarHeight();
  const courseMemory = useMemoryStore((s) => s.courseMemory);
  const courses = Object.keys(courseMemory || {});
  const handicapIndex = useUserStore((s) => s.handicap);
  const displayName = useUserStore((s) => s.displayName || s.name || 'Golfer');
  const goal = useUserStore((s) => s.goal);
  const setIsGuest = useUserStore((s) => s.setIsGuest);
  const activeCourseStore = useRoundStore((s) => s.activeCourse);
  const defaultSlope = COURSE_RATINGS[activeCourseStore]?.slope ?? 120;
  const defaultRating = COURSE_RATINGS[activeCourseStore]?.rating ?? 72.0;
  const [slopeRating, setSlopeRating] = useState(defaultSlope);

  // Current round data from store
  const shots = useRoundStore((s) => s.shots);
  const shotResult = useRoundStore((s) => s.shotResult);
  const aim = useRoundStore((s) => s.aim);
  const club = useRoundStore((s) => s.club);
  const addShot = useRoundStore((s) => s.addShot);
  const storeSetAim = useRoundStore((s) => s.setAim);
  const clearRound = useRoundStore((s) => s.clearRound);

  const [section, setSection] = useState<'current' | 'past'>('current');
  const router = useRouter();
  const brightMode    = useSettingsStore((s) => s.brightMode);
  const setBrightMode = useSettingsStore((s) => s.setBrightMode);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [quietMode, setQuietMode] = useState(false);
  const quietModeRef = useRef(false);
  quietModeRef.current = quietMode;
  const safeSpeak = (msg: string) => { if (!quietModeRef.current) void speakJob(msg, ENGINE_PRIORITY.AMBIENT); };
  const [cloudRounds, setCloudRounds] = useState<any[]>([]);

  const handleOpenProfile = () => {
    setShowToolsMenu(false);
    router.push('/profile' as any);
  };

  const handleLogout = async () => {
    setShowToolsMenu(false);
    try {
      await signOut(auth);
    } catch {}
    setIsGuest(false);
    router.replace('/auth');
  };
  const [localRounds, setLocalRounds] = useState<Array<{ date: string; shots: any[] }>>([]); 
  const [showRangefinder, setShowRangefinder] = useState(false);
  const rfScale = useRef(new Animated.Value(1)).current;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const hasSpokeRef = useRef(false);

  // Voice summary on first open � fires once per mount
  useEffect(() => {
    if (hasSpokeRef.current) return;
    const summaries = deriveRoundSummaries(localRounds);
    const { commonMiss } = getOverallTendencies(summaries);
    const progress = getProgressLabel(summaries);
    if (summaries.length >= 2) {
      hasSpokeRef.current = true;
      const cue = progress === 'Trending better'
        ? `You're trending better. Miss is still ${commonMiss.toLowerCase()}.`
        : progress === 'Slight regression'
        ? `Slight regression lately. Watch the ${commonMiss.toLowerCase()} miss.`
        : `You're consistent. Common miss is ${commonMiss.toLowerCase()}.`;
      setTimeout(() => { safeSpeak(cue); }, 1200);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localRounds]);

  // Load locally saved rounds from AsyncStorage on mount
  useEffect(() => {
    const loadLocalRounds = async () => {
      try {
        const data = await AsyncStorage.getItem('rounds');
        if (data) setLocalRounds(JSON.parse(data));
      } catch (e) {
        console.log('Error loading local rounds:', e);
      }
    };
    loadLocalRounds();
  }, []);

  // Real-time Firestore listener � syncs whenever a round is saved
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    const q = query(collection(db, 'users', userId, 'rounds'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      setCloudRounds(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  const getShotColor = (result: string) => {
    if (result === 'left') return '#60a5fa';
    if (result === 'right') return '#f87171';
    return '#A7F3D0';
  };

  const logShot = (result: import('../../store/roundStore').ShotResult) => {
    addShot({ result, mental: '', club, aim, timestamp: Date.now(), hole: 0, distance: 0 });
    if (result === 'left') safeSpeak('Pulled left.');
    else if (result === 'right') safeSpeak('Missed right.');
    else safeSpeak('Straight.');
  };

  // Club performance table
  const getClubStats = () => {
    const stats: Record<string, { left: number; right: number; center: number; total: number }> = {};
    shots.forEach((s) => {
      if (!stats[s.club]) stats[s.club] = { left: 0, right: 0, center: 0, total: 0 };
      stats[s.club].total++;
      if (s.result === 'left') stats[s.club].left++;
      else if (s.result === 'right') stats[s.club].right++;
      else stats[s.club].center++;
    });
    return stats;
  };

  // Shot pattern
  const getPattern = () => {
    if (shots.length === 0) return null;
    const left = shots.filter((s) => s.result === 'left').length;
    const right = shots.filter((s) => s.result === 'right').length;
    const center = shots.filter((s) => s.result === 'center').length;
    return {
      left: Math.round((left / shots.length) * 100),
      right: Math.round((right / shots.length) * 100),
      straight: Math.round((center / shots.length) * 100),
    };
  };

  const getInsight = () => {
    const p = getPattern();
    if (!p) return 'Log shots during your round to see insights here.';
    if (p.left > 50) return `Pulling left on ${p.left}% of shots � focus on path and face angle at impact.`;
    if (p.right > 50) return `Missing right on ${p.right}% of shots � check your face angle through impact.`;
    if (p.straight >= 60) return `Strong round � ${p.straight}% of shots on target. Keep the tempo.`;
    return `Mixed results so far. ${p.straight}% straight, ${p.left}% left, ${p.right}% right.`;
  };

  const getPlayerMemory = () => {
    if (shots.length < 10) return 'Building player profile...';
    const recent = shots.slice(-10);
    let wideCount = 0;
    let tightCount = 0;
    recent.forEach((shot) => {
      if (shot.result === 'left' || shot.result === 'right') wideCount++;
      if (shot.result === 'center') tightCount++;
    });
    if (wideCount > tightCount) return 'You tend to struggle when shots spread out � consider playing safer.';
    if (tightCount > wideCount) return 'You perform best when dialed in � trust your swing.';
    return "You're showing a balanced pattern today.";
  };

  const aimPct = aim === 'left edge' ? 10 : aim === 'left center' ? 30 : aim === 'center' ? 50 : aim === 'right center' ? 70 : 90;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.container, { paddingHorizontal: layout.hPad, paddingBottom: tabBarHeight + 8 }]}>
      {/* ── My Profile banner ─────────────────────────────────────── */}
      <Pressable
        onPress={() => router.push('/profile' as any)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(46,204,113,0.08)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(46,204,113,0.3)', marginBottom: 4 }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(46,204,113,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Palette.positive }}>
          <Text style={{ fontSize: 20 }}>👤</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>My Golf Profile</Text>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 1 }}>Stats · Trends · Highlights</Text>
        </View>
        <Text style={{ color: Palette.positive, fontSize: 18 }}>›</Text>
      </Pressable>

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, marginBottom: 12, paddingHorizontal: 4 }}>
        <Pressable onPress={() => { safeSpeak(getInsight()); }}>
          <Image source={require('../../assets/images/logo.png')} style={{ width: 48, height: 48, borderRadius: 999, overflow: 'hidden' }} resizeMode="cover" />
        </Pressable>
        <Text style={[styles.title, { flex: 1, marginLeft: 12, marginBottom: 0 }]}>Dashboard</Text>
        <Pressable
          onPress={() => setShowToolsMenu((v) => !v)}
          style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: showToolsMenu ? '#143d22' : '#1a1a1a', borderWidth: 1.5, borderColor: showToolsMenu ? '#4caf50' : '#2a2a2a', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 3 }}
        >
          {[0,1,2].map((i) => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: showToolsMenu ? '#4ade80' : '#aaa' }} />)}
        </Pressable>
      </View>

      {/* Tools dropdown */}
      {showToolsMenu && (
        <View style={{
          position: 'absolute', top: 68, right: 16, zIndex: 52,
          backgroundColor: '#111', borderRadius: 14,
          borderWidth: 1, borderColor: '#2a2a2a',
          padding: 10, gap: 8, minWidth: 190,
          shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, elevation: 8,
        }}>
          <Pressable
            onPress={() => { setShowToolsMenu(false); router.push('/rangefinder'); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#332900', borderWidth: 1, borderColor: '#FFE600' }}
          >
            <Image source={ICON_RANGEFINDER} style={{ width: 20, height: 20, tintColor: '#FFE600' }} resizeMode="contain" />
            <Text style={{ color: '#FFE600', fontSize: 14, fontWeight: '600' }}>Rangefinder</Text>
          </Pressable>
          <Pressable
            onPress={() => setQuietMode((q) => !q)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: quietMode ? '#143d22' : '#1a1a1a', borderWidth: 1, borderColor: quietMode ? '#4caf50' : '#2a2a2a' }}
          >
            <MCIcon name={quietMode ? 'volume-off' : 'volume-high'} size={18} color={quietMode ? '#A7F3D0' : '#aaa'} />
            <Text style={{ color: quietMode ? '#A7F3D0' : '#aaa', fontSize: 14, fontWeight: '600' }}>{quietMode ? 'Voice Off' : 'Voice On'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setBrightMode(!brightMode)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: brightMode ? '#143d22' : '#1a1a1a', borderWidth: 1, borderColor: brightMode ? '#4caf50' : '#2a2a2a' }}
          >
            <MCIcon name="white-balance-sunny" size={18} color={brightMode ? '#A7F3D0' : '#aaa'} />
            <Text style={{ color: brightMode ? '#A7F3D0' : '#aaa', fontSize: 14, fontWeight: '600' }}>Bright Mode {brightMode ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable
            onPress={() => { setShowToolsMenu(false); router.push('/analytics'); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#1a1535', borderWidth: 1, borderColor: '#a78bfa' }}
          >
            <MCIcon name="chart-bar" size={18} color="#c4b5fd" />
            <Text style={{ color: '#c4b5fd', fontSize: 14, fontWeight: '600' }}>Deep Analytics</Text>
          </Pressable>
          <Pressable
            onPress={handleOpenProfile}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#143d22', borderWidth: 1, borderColor: '#4caf50' }}
          >
            <MCIcon name="account-outline" size={18} color="#A7F3D0" />
            <Text style={{ color: '#A7F3D0', fontSize: 14, fontWeight: '600' }}>Profile</Text>
          </Pressable>
          <Pressable
            onPress={() => { setShowToolsMenu(false); router.push('/tutorial'); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#0f2a1e', borderWidth: 1, borderColor: '#34d399' }}
          >
            <MCIcon name="book-open-outline" size={18} color="#6ee7b7" />
            <Text style={{ color: '#6ee7b7', fontSize: 14, fontWeight: '600' }}>View Tutorial</Text>
          </Pressable>
          <Pressable
            onPress={() => { void handleLogout(); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#2a1111', borderWidth: 1, borderColor: '#ef4444' }}
          >
            <MCIcon name="logout" size={18} color="#fca5a5" />
            <Text style={{ color: '#fca5a5', fontSize: 14, fontWeight: '600' }}>Log Out</Text>
          </Pressable>
        </View>
      )}

      {/* Player Profile / Dashboard */}
      <View style={styles.card}>
        {/* Greeting row */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, fontWeight: '700', letterSpacing: 1 }}>{getGreeting()}</Text>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 2 }}>{displayName}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={{ backgroundColor: '#1b5e20', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: '#4ade80' }}>
            <Text style={{ color: '#86efac', fontSize: 14, fontWeight: '700' }}>HCP {handicapIndex % 1 === 0 ? handicapIndex : handicapIndex.toFixed(1)}</Text>
            </View>
            {goal && (
              <View style={{ backgroundColor: '#172554', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 }}>
                <Text style={{ color: '#93c5fd', fontSize: 14, fontWeight: '600' }}>{goal === 'break90' ? 'Goal: Break 90' : 'Goal: Break 100'}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Stats snapshot */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <View style={{ flex: 1, backgroundColor: '#0a1a0a', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#1b5e20' }}>
            <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 18 }}>{localRounds.length}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 2 }}>Rounds</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: '#0a1a0a', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#ca8a04' }}>
            <Text style={{ color: '#fbbf24', fontWeight: '700', fontSize: 18 }}>{shots.length > 0 ? Math.round((shots.filter((s) => s.result === 'center').length / shots.length) * 100) : 0}%</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 2 }}>Accuracy</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: '#0a1a0a', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#1e40af' }}>
            <Text style={{ color: '#93c5fd', fontWeight: '700', fontSize: 18 }}>{shots.length}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 2 }}>Shots</Text>
          </View>
        </View>

        <Text style={{ fontSize: 14, lineHeight: 22, marginBottom: 12, color: shots.length < 10 ? 'rgba(255,255,255,0.55)' : '#A7F3D0' }}>
          {getPlayerMemory()}
        </Text>

        {/* HCP / Course HCP / Slope adjuster */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 18 }}>{handicapIndex % 1 === 0 ? handicapIndex : handicapIndex.toFixed(1)}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 2 }}>Handicap Index</Text>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 18 }}>{Math.round(handicapIndex * (slopeRating / 113))}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 2 }}>Course Hcp</Text>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 1 }}>Slope {slopeRating} · CR {defaultRating}</Text>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
            <Pressable onPress={() => setSlopeRating((p) => Math.max(55, p - 1))} style={{ backgroundColor: '#1e1e1e', borderRadius: 6, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 16 }}>-</Text>
            </Pressable>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>Slope</Text>
            <Pressable onPress={() => setSlopeRating((p) => Math.min(155, p + 1))} style={{ backgroundColor: '#1e1e1e', borderRadius: 6, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 16 }}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Section Toggle */}
      <View style={{ flexDirection: 'row', backgroundColor: '#111', borderRadius: 12, padding: 4, marginBottom: 16 }}>
        <Pressable
          onPress={() => setSection('current')}
          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: section === 'current' ? '#2e7d32' : 'transparent' }}
        >
          <Text style={{ color: section === 'current' ? '#fff' : '#888', fontWeight: '700', fontSize: 14 }}>Current Round</Text>
        </Pressable>
        <Pressable
          onPress={() => setSection('past')}
          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: section === 'past' ? '#2e7d32' : 'transparent' }}
        >
          <Text style={{ color: section === 'past' ? '#fff' : '#888', fontWeight: '700', fontSize: 14 }}>Past Rounds</Text>
        </Pressable>
      </View>

      {/* -- CURRENT ROUND -- */}
      {section === 'current' && (
        <View>
          {/* Shot Result */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={styles.cardTitle}>Log Shot</Text>
              {shots.length > 0 && (
                <Pressable onPress={clearRound}>
                  <Text style={{ color: '#ef5350', fontSize: 14 }}>Clear Round</Text>
                </Pressable>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['left', 'center', 'right'] as const).map((val) => (
                <Pressable
                  key={val}
                  onPress={() => logShot(val)}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: 12,
                    alignItems: 'center',
                    backgroundColor:
                      shotResult === val ? (val === 'left' ? '#1565c0' : val === 'right' ? '#b71c1c' : '#1b5e20')
                        : pressed ? '#222' : '#1a1a1a',
                    borderWidth: 1,
                    borderColor: shotResult === val ? getShotColor(val) : '#2a2a2a',
                  })}
                >
                  <Text style={{ color: getShotColor(val), fontWeight: '700', fontSize: 15 }}>
                    {val === 'left' ? '↙ Left' : val === 'right' ? 'Right ↘' : '⬆ Straight'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
              {shots.length} shot{shots.length !== 1 ? 's' : ''} logged this round
            </Text>
            {shots.length > 0 && (
              <View style={{ gap: 8, marginTop: 10 }}>
                <Pressable
                  onPress={() => router.push('/round-replay' as any)}
                  style={{ backgroundColor: 'rgba(46,204,113,0.12)', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: Palette.positive }}
                >
                  <Text style={{ color: Palette.positive, fontWeight: '700', fontSize: 13 }}>▶ Replay Round</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push('/highlight-reel' as any)}
                  style={{ backgroundColor: 'rgba(46,204,113,0.18)', borderRadius: 10, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: Palette.positive, flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                >
                  <Text style={{ color: '#fcd34d', fontSize: 15 }}>⭐</Text>
                  <Text style={{ color: Palette.positive, fontWeight: '800', fontSize: 14, letterSpacing: 0.3 }}>Watch Highlights</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Shot Map */}
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
                  <Text style={{ fontSize: 8, color: '#fff' }}>▲</Text>
                </View>
                {shots.slice(-10).map((shot, index) => {
                  const leftPct = shot.result === 'left' ? 15 : shot.result === 'right' ? 85 : 50;
                  const dotColor = shot.result === 'left' ? '#ff5252' : shot.result === 'right' ? '#448aff' : '#ffffff';
                  return (
                    <View key={index} style={{ position: 'absolute', left: `${leftPct}%`, top: 24 + (index % 3) * 8, width: 10, height: 10, borderRadius: 5, backgroundColor: dotColor, marginLeft: -5, opacity: 0.9, borderWidth: 1, borderColor: 'rgba(0,0,0,0.4)' }} />
                  );
                })}
              </View>
            </View>
            <View style={{ flexDirection: 'row', marginTop: 4 }}>
              {[{ label: 'ROUGH', flex: 1 }, { label: 'FAIRWAY', flex: 1.5 }, { label: 'CENTER', flex: 1 }, { label: 'FAIRWAY', flex: 1.5 }, { label: 'ROUGH', flex: 1 }].map((z, i) => (
                <Text key={i} style={{ flex: z.flex, color: '#888', fontSize: 10, textAlign: 'center' }}>{z.label}</Text>
              ))}
            </View>
            {shots.length === 0 && <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', marginTop: 8 }}>Log shots to see dispersion</Text>}
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 6, textAlign: 'center' }}>🟢 aim  ·  🔴 left  ·  ⚪ straight  ·  🔵 right  (last 10)</Text>
          </View>

          {/* Shot Record / History dots */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Shot Record</Text>
            {shots.length === 0 ? (
              <Text style={{ color: '#555', fontSize: 13, marginTop: 4 }}>No shots this round yet.</Text>
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
                      <Text style={{ color: '#60a5fa', fontSize: 14 }}>Left {getPattern()!.left}%</Text>
                      <Text style={{ color: '#A7F3D0', fontSize: 14 }}>Straight {getPattern()!.straight}%</Text>
                      <Text style={{ color: '#f87171', fontSize: 14 }}>Right {getPattern()!.right}%</Text>
                    </View>
                    <Text style={{ color: '#ccc', fontSize: 14, marginTop: 10, lineHeight: 19 }}>{getInsight()}</Text>
                    <Pressable
                        onPress={() => { safeSpeak(getInsight()); }}
                      style={({ pressed }) => ({ backgroundColor: pressed ? '#1b5e20' : '#1a1a1a', borderRadius: 8, padding: 8, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#333' })}
                    >
                      <Text style={{ color: '#A7F3D0', fontSize: 14 }}>🎙 Speak Insight</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Club Info */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Club Info</Text>
            {shots.length < 3 ? (
              <Text style={{ color: '#555', fontSize: 13, marginTop: 4 }}>Log at least 3 shots to see club stats.</Text>
            ) : (
              <View style={{ marginTop: 8 }}>
                {Object.entries(getClubStats()).map(([c, d]) => {
                  const acc = Math.round((d.center / d.total) * 100);
                  const tendency = d.left > d.right ? 'left' : d.right > d.left ? 'right' : null;
                  return (
                    <View key={c} style={{ backgroundColor: '#111', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{c}</Text>
                        <Text style={{ color: acc >= 60 ? '#66bb6a' : acc >= 40 ? '#f9a825' : '#ff5252', fontWeight: '700', fontSize: 14 }}>{acc}% accurate</Text>
                      </View>
                      <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8, marginBottom: 6 }}>
                        <View style={{ flex: d.left, backgroundColor: '#60a5fa' }} />
                        <View style={{ flex: d.center, backgroundColor: '#A7F3D0' }} />
                        <View style={{ flex: d.right, backgroundColor: '#f87171' }} />
                      </View>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <Text style={{ color: '#60a5fa', fontSize: 13 }}>L: {d.left}</Text>
                        <Text style={{ color: '#A7F3D0', fontSize: 13 }}>S: {d.center}</Text>
                        <Text style={{ color: '#f87171', fontSize: 13 }}>R: {d.right}</Text>
                        {tendency && <Text style={{ color: '#f9a825', fontSize: 13, marginLeft: 'auto' }}>tends {tendency}</Text>}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      )}

      {/* -- PAST ROUNDS -- */}
      {section === 'past' && (
        <View>
          {/* Tendencies & Progress */}
          {(() => {
            const summaries = deriveRoundSummaries(localRounds);
            const { avgScore, commonMiss } = getOverallTendencies(summaries);
            const progress = getProgressLabel(summaries);
            const progressColor = progress === 'Trending better' ? '#A7F3D0' : progress === 'Slight regression' ? '#fca5a5' : '#9CA3AF';
            if (summaries.length === 0 && cloudRounds.length === 0) return null;
            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>📊 Tendencies</Text>
                {avgScore !== null && <Text style={{ color: '#fff', fontSize: 14, marginTop: 4 }}>Avg Score: {avgScore}</Text>}
                <Text style={{ color: '#ccc', fontSize: 14, marginTop: 2 }}>Common Miss: {commonMiss}</Text>
                <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: progressColor, fontSize: 14, fontWeight: '700' }}>{progress}</Text>
                  {progress === 'Trending better' && <Text style={{ color: '#A7F3D0', fontSize: 14 }}>📈</Text>}
                  {progress === 'Slight regression' && <Text style={{ color: '#fca5a5', fontSize: 14 }}>📉</Text>}
                  {progress === 'Consistent' && <Text style={{ color: '#9CA3AF', fontSize: 14 }}>—</Text>}
                </View>
                {summaries.length >= 2 && (
                  <Pressable
                    onPress={() => {
                      const cue = progress === 'Trending better'
                        ? `You're trending better. Miss is still ${commonMiss.toLowerCase()}.`
                        : progress === 'Slight regression'
                        ? `Slight regression lately. Watch the ${commonMiss.toLowerCase()} miss.`
                        : `You're consistent. Common miss is ${commonMiss.toLowerCase()}.`;
                        safeSpeak(cue);
                    }}
                    style={{ marginTop: 8, backgroundColor: '#1a1a1a', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#333' }}
                  >
                    <Text style={{ color: '#A7F3D0', fontSize: 14 }}>🎙 Speak Summary</Text>
                  </Pressable>
                )}
              </View>
            );
          })()}
          {/* ── My Trends (cross-round AI coaching) ── */}
          {(() => {
            const roundHistory = useAiProfileStore.getState().roundHistory;
            const trends = analyzeTrends(roundHistory);
            if (!trends) return null;
            const insights = generateLongTermInsights(trends);
            const toneColor = (tone: string) =>
              tone === 'positive' ? '#A7F3D0' : tone === 'warning' ? '#fca5a5' : '#fcd34d';
            const improvementText =
              trends.improvement.hasData
                ? trends.improvement.direction === 'improving'
                  ? `📈 +${trends.improvement.scoreDelta} pts — improving`
                  : trends.improvement.direction === 'declining'
                  ? `📉 ${trends.improvement.scoreDelta} pts — regressing`
                  : '→ Steady'
                : null;
            return (
              <View style={[styles.card, { marginTop: 12, borderColor: '#1a3322', borderWidth: 1 }]}>
                <Text style={[styles.cardTitle, { marginBottom: 8 }]}>🔍 My Game Trends</Text>
                {/* Stat pills row */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  <View style={{ backgroundColor: '#122', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                    <Text style={{ color: '#A7F3D0', fontSize: 12 }}>{trends.roundCount} rounds</Text>
                  </View>
                  {improvementText && (
                    <View style={{ backgroundColor: '#122', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <Text style={{ color: trends.improvement.direction === 'improving' ? '#A7F3D0' : trends.improvement.direction === 'declining' ? '#fca5a5' : '#9CA3AF', fontSize: 12 }}>{improvementText}</Text>
                    </View>
                  )}
                  {trends.topClub && (
                    <View style={{ backgroundColor: '#122', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <Text style={{ color: '#fcd34d', fontSize: 12 }}>Top club: {trends.topClub}</Text>
                    </View>
                  )}
                </View>
                {/* Insight cards */}
                {insights.map((ins) => (
                  <View
                    key={ins.id}
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor: toneColor(ins.tone),
                      paddingLeft: 10,
                      marginBottom: 8,
                      backgroundColor: '#0d1f14',
                      borderRadius: 6,
                      padding: 10,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{ins.emoji} {ins.headline}</Text>
                    <Text style={{ color: '#aaa', fontSize: 12, marginTop: 3 }}>{ins.detail}</Text>
                  </View>
                ))}
              </View>
            );
          })()}

          {/* Local rounds (from AsyncStorage) */}
          {localRounds.length > 0 && localRounds.map((r, index) => (
            <View key={`local-${index}`} style={styles.courseCard}>
              <Text style={styles.courseName}>Round {index + 1}</Text>
              <Text style={styles.courseDetail}>Date: {new Date(r.date).toLocaleDateString()}</Text>
              <Text style={{ color: '#A7F3D0', fontSize: 14 }}>Shots: {r.shots.length}</Text>
            </View>
          ))}

          {/* Cloud rounds (Firestore, real-time) */}
          {cloudRounds.length > 0 && cloudRounds.map((r) => (
            <View key={r.id} style={styles.courseCard}>
              <Text style={styles.courseName}>{r.course ?? 'Round'}</Text>
              <Text style={styles.courseDetail}>{r.date ? new Date(r.date).toLocaleDateString() : ''}</Text>
              {Array.isArray(r.players) && r.totals && r.players.map((p: string, i: number) => (
                <Text key={i} style={{ color: p === r.winner ? '#66bb6a' : '#aaa', fontSize: 14 }}>
                  {p}: {r.totals[i]}{p === r.winner ? ' ??' : ''}
                </Text>
              ))}
            </View>
          ))}

          {/* Fallback: local course memory */}
          {cloudRounds.length === 0 && courses.length === 0 && (
            <Text style={styles.empty}>No past round history yet.</Text>
          )}
          {cloudRounds.length === 0 && courses.map((course) => {
            const holesTracked = Object.keys(courseMemory[course]).length;
            const troubleHoles = Object.keys(courseMemory[course]).filter(
              (hole) => courseMemory[course][Number(hole)].totalShots > 5
            );
            return (
              <View key={course} style={styles.courseCard}>
                <Text style={styles.courseName}>{course}</Text>
                <Text style={styles.courseDetail}>{holesTracked} hole{holesTracked !== 1 ? 's' : ''} tracked</Text>
                <Text style={styles.troubleText}>
                  {troubleHoles.length > 0
                    ? `Trouble holes: ${troubleHoles.join(', ')}`
                    : 'No major trouble holes'}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>

    {/* Floating Rangefinder Button */}
    <Animated.View style={[{ position: 'absolute', bottom: 24, right: 20 }, { transform: [{ scale: rfScale }] }]}>
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

    {/* Rangefinder Fullscreen Overlay */}
    {showRangefinder && (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 999, justifyContent: 'center', alignItems: 'center' }}>
        <Pressable
          onPress={() => setShowRangefinder(false)}
          style={{ position: 'absolute', top: 44, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.15)', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>?</Text>
        </Pressable>
        <Text style={{ color: '#A7F3D0', fontSize: 20, fontWeight: '700', position: 'absolute', top: 50, left: 20 }}>?? Rangefinder</Text>
        {cameraPermission?.granted ? (
          <CameraView style={{ width: '100%', height: '100%' }} facing="back" />
        ) : (
          <View style={{ alignItems: 'center', paddingHorizontal: 32 }}>
            <Text style={{ color: '#fff', fontSize: 18, textAlign: 'center', marginBottom: 24 }}>Camera access needed for rangefinder</Text>
            <Pressable
              onPress={requestCameraPermission}
              style={{ backgroundColor: '#2e7d32', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}
            >
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

    {/* Rangefinder FAB � bottom-right */}
    <Pressable
      onPress={() => router.push('/rangefinder')}
      style={{
        position: 'absolute', bottom: tabBarHeight + 10, right: 16, zIndex: 51,
        width: 52, height: 52, borderRadius: 26,
        backgroundColor: '#0B3D2E', borderWidth: 2, borderColor: '#FFE600',
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#FFE600', shadowOpacity: 0.35, shadowRadius: 8, elevation: 7,
      }}
    >
      <Image source={ICON_RANGEFINDER} style={{ width: 28, height: 28, tintColor: '#FFE600' }} resizeMode="contain" />
    </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      DS.screen,
  scroll:    DS.screen,
  container: { padding: Space.lg, paddingBottom: 48 },
  title: {
    fontSize: Type.h2,
    fontWeight: Type.bold,
    color: Palette.positiveFaint,
    marginBottom: 0,
  },
  card: {
    ...DS.card,
    marginBottom: Space.md,
  },
  cardTitle: {
    color: Palette.positiveFaint,
    fontSize: Type.md,
    fontWeight: Type.semibold,
    marginBottom: 2,
  },
  empty: {
    fontSize: Type.md,
    color: Palette.textMuted,
    marginTop: 40,
    textAlign: 'center',
  },
  courseCard: {
    ...DS.card,
    marginBottom: Space.md,
  },
  courseName: {
    fontSize: Type.lg - 1,
    fontWeight: Type.semibold,
    color: Palette.positiveFaint,
    marginBottom: Space.xs,
  },
  courseDetail: {
    fontSize: Type.body,
    color: Palette.textMuted,
    marginBottom: Space.xs,
  },
  troubleText: {
    fontSize: Type.body,
    fontWeight: Type.medium,
    color: '#f9a825',
  },
});
