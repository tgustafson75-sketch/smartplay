import { useState, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Image, Animated, ScrollView } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { signOut } from 'firebase/auth';
import { speak, stopSpeaking } from '../../services/voiceService';
import CaddieMicButton from '../../components/CaddieMicButton';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { auth } from '../../lib/firebase';
import { useMemoryStore } from '../../store/memoryStore';
import { useRoundStore } from '../../store/roundStore';
import { useUserStore } from '../../store/userStore';

const LOGO = require('../../assets/images/logo.png');
const ICON_RANGEFINDER = require('../../assets/images/icon-rangefinder.png');
const CLUBS = ['Driver', '3 Wood', '5 Iron', '7 Iron', '9 Iron', 'PW'];
const HOLE_DISTANCES = [380, 160, 520, 410, 370, 180, 400, 540, 390];

const DEFAULT_CLUB_YARDS: Record<string, number> = {
  Driver: 230, '3 Wood': 215, '5 Wood': 200,
  '3 Iron': 185, '4 Iron': 175, '5 Iron': 165, '6 Iron': 155,
  '7 Iron': 145, '8 Iron': 135, '9 Iron': 125,
  PW: 115, GW: 100, SW: 85, LW: 70, Putter: 10,
};

export default function Caddie() {
  const router = useRouter();
  const setIsGuest = useUserStore((s) => s.setIsGuest);
  const [gpsMiddle, setGpsMiddle] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [listeningPhase, setListeningPhase] = useState<'listening' | 'processing' | 'thinking' | 'speaking'>('listening');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [caddieText, setCaddieText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [avatarState, setAvatarState] = useState<'idle' | 'listening' | 'speaking'>('idle');
  const [showWhy, setShowWhy] = useState(false);
  const [lastAdvice, setLastAdvice] = useState('');
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);
  const rfScale = useRef(new Animated.Value(1)).current;
  const idleGlow = useRef(new Animated.Value(0.3)).current;
  const [lockedDistance, setLockedDistance] = useState<number | null>(null);

  // Idle glow loop — always running
  Animated.loop(
    Animated.sequence([
      Animated.timing(idleGlow, { toValue: 0.85, duration: 1800, useNativeDriver: true }),
      Animated.timing(idleGlow, { toValue: 0.3, duration: 1800, useNativeDriver: true }),
    ])
  ).start();

  const startListeningAnim = () => {
    if (pulseRef.current) pulseRef.current.stop();
    pulseAnim.setValue(1);
    pulseRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 600, useNativeDriver: true }),
      ])
    );
    pulseRef.current.start();
  };

  const startSpeakingAnim = () => {
    if (pulseRef.current) pulseRef.current.stop();
    pulseAnim.setValue(1);
    pulseRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.96, duration: 200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 180, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 220, useNativeDriver: true }),
      ])
    );
    pulseRef.current.start();
  };

  const stopAnim = () => {
    if (pulseRef.current) pulseRef.current.stop();
    Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  };

  const fireRangefinder = () => {
    const dist = displayDistance;
    setLockedDistance(dist);
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    Animated.sequence([
      Animated.timing(rfScale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.timing(rfScale, { toValue: 1.08, duration: 100, useNativeDriver: true }),
      Animated.timing(rfScale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    void (!quietMode && speak(`${dist} yards`));
  };

  const courseMemory = useMemoryStore((s) => s.courseMemory);
  const clubUsage = useMemoryStore((s) => s.clubUsage);
  const currentHole = useRoundStore((s) => s.currentHole);
  const setCurrentHole = useRoundStore((s) => s.setCurrentHole);
  const goal = useRoundStore((s) => s.goal);
  const activeCourse = useRoundStore((s) => s.activeCourse) || 'Menifee Lakes – Palms';
  const club = useRoundStore((s) => s.club);
  const setClub = useRoundStore((s) => s.setClub);
  const targetDistance = useRoundStore((s) => s.targetDistance);
  const scores = useRoundStore((s) => s.scores);
  const setScore = useRoundStore((s) => s.setScore);

  const [holePar, setHolePar] = useState(4);
  const [holeScore, setHoleScore] = useState(0);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [quietMode, setQuietMode] = useState(false);

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

  const holeDistance = HOLE_DISTANCES[Math.min(currentHole - 1, HOLE_DISTANCES.length - 1)];
  const displayDistance = targetDistance ?? gpsMiddle ?? holeDistance;

  const getGPS = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    await Location.getCurrentPositionAsync({});
    setGpsMiddle(holeDistance - 10);
  };

  const getMissPattern = (): 'right' | 'left' | 'balanced' => {
    const mem = courseMemory[activeCourse] ?? courseMemory['Menifee Lakes'] ?? courseMemory['Menifee Lakes – Palms'];
    if (!mem) return 'balanced';
    let left = 0; let right = 0;
    Object.values(mem).forEach((h) => { left += h.missesLeft; right += h.missesRight; });
    if (right > left + 1) return 'right';
    if (left > right + 1) return 'left';
    return 'balanced';
  };

  const getFavoriteClub = (): string => {
    const entries = Object.entries(clubUsage);
    if (!entries.length) return club;
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  };

  const getContextualAdvice = (): string => {
    const miss = getMissPattern();
    const dist = displayDistance;
    const fav = getFavoriteClub();

    // Yardage left after current club carry
    const clubCarry = DEFAULT_CLUB_YARDS[club] ?? null;
    const yardsLeft = clubCarry != null ? Math.max(0, dist - clubCarry) : null;
    const nextClubEntries = Object.entries(DEFAULT_CLUB_YARDS);
    const nextClub = yardsLeft != null && yardsLeft > 30
      ? nextClubEntries.reduce((best, [name, yds]) => {
          return Math.abs(yds - yardsLeft) < Math.abs(DEFAULT_CLUB_YARDS[best] - yardsLeft) ? name : best;
        }, nextClubEntries[0][0])
      : null;

    let advice = '';
    if (dist <= 100) {
      advice = `Inside 100 yards — take your ${club} and focus on landing zone, not power.`;
    } else if (dist <= 150) {
      advice = `${dist} yards. Your ${club} is ideal here. Commit fully to the shot.`;
    } else if (dist <= 200) {
      advice = `${dist} yards is a strong iron distance. Smooth tempo will carry you there.`;
    } else {
      advice = `${dist} yards — full swing. Your ${fav} has been reliable. Consider it.`;
    }

    // Append yardage-left context
    if (yardsLeft != null && yardsLeft > 30 && nextClub) {
      advice += ` Your ${club} carries ~${clubCarry} yds — leaving ~${yardsLeft} yds, setting up a ${nextClub}.`;
    } else if (yardsLeft != null && yardsLeft <= 30) {
      advice += ` This ${club} should reach the green.`;
    }

    if (miss === 'right') advice += ' Aim left center — your history shows a right miss tendency.';
    else if (miss === 'left') advice += ' Let the club release naturally — you tend to pull left.';
    if (goal === 'break90') advice += ' Stay out of trouble. Par is your friend today.';
    else if (goal === 'break100') advice += ' Bogey golf wins. Play to the fat part of the green.';
    return advice;
  };

  const getDeepCoaching = (): string => {
    const miss = getMissPattern();
    if (miss === 'right') return 'A consistent right miss typically means an open clubface at impact or an outside-in path. Focus on keeping grip pressure light, rotating forearms through the hitting zone, and feeling like you swing to right field. Check your grip — a weak left-hand grip often leaves the face open.';
    if (miss === 'left') return 'Missing left often means early release of the wrists or an over-the-top path. Keep lag longer in the downswing, and feel the clubhead trail your hands into impact. A slow, wide takeaway can help reset your timing.';
    return 'Balanced patterns suggest solid mechanics. To improve: focus on identical tempo every swing. Video your swing and check for hip slide or early extension that could cause occasional misses.';
  };

  const startPulse = () => startListeningAnim();
  const stopPulse = () => stopAnim();

  const respond = (text: string) => {
    setAvatarState('speaking');
    startSpeakingAnim();
    setResponse('Got it...');
    setTimeout(() => {
      setResponse(text);
      setTimeout(() => {
        stopAnim();
        setAvatarState('idle');
      }, 1200);
    }, 300);
  };

  const handleIntent = (text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes('how far')) {
      respond(`You are ${displayDistance} yards out.`);
    } else if (lower.includes('what should i hit') || lower.includes('what club')) {
      respond(`I recommend a smooth ${club}.`);
    } else if (lower.includes('record') && lower.includes('swing')) {
      setIsRecording(true);
      respond('Recording swing...');
      setTimeout(() => {
        setIsRecording(false);
        respond('Swing saved. Want analysis?');
      }, 4000);
    } else if (lower.includes('miss') || lower.includes('slice') || lower.includes('hook')) {
      const miss = getMissPattern();
      respond(miss === 'right' ? 'You tend to miss right — aim left center and rotate through.' : miss === 'left' ? 'You tend to miss left — keep lag and let the face release.' : 'Your pattern looks balanced. Trust your swing.');
    } else if (lower.includes('advice') || lower.includes('help')) {
      respond(getContextualAdvice());
    } else {
      respond('Got it. Ask me about distance, club selection, or your miss pattern.');
    }
  };

  const startListening = () => {
    setIsListening(true);
    setAvatarState('listening');
    setTranscript('');
    setResponse('Listening...');
    setTimeout(() => {
      const mockText = 'what should I hit';
      setTranscript(mockText);
      setResponse('Got it...');
      setAvatarState('speaking');
      startPulse();
      setTimeout(() => {
        handleIntent(mockText);
        setIsListening(false);
        stopPulse();
        setAvatarState('idle');
      }, 400);
    }, 1500);
  };

  const ask = async () => {
    const advice = getContextualAdvice();
    setLastAdvice(advice);
    setCaddieText(advice);
    setShowWhy(false);

    // Phase 1 — Listening animation (1.8s)
    setListeningPhase('listening');
    setListening(true);
    setIsSpeaking(false);
    setAvatarState('listening');
    startListeningAnim();
    await new Promise((r) => setTimeout(r, 1800));

    // Phase 2 — Processing animation (0.5s)
    setListeningPhase('processing');
    setAvatarState('speaking');
    startSpeakingAnim();
    await new Promise((r) => setTimeout(r, 500));

    // Phase 3 — Speaking (yellow ring, show text card)
    setListeningPhase('speaking');
    setIsSpeaking(true);
    if (!quietMode) {
      await speak(advice);
    }

    // Phase 4 — Done
    stopAnim();
    setListening(false);
    setIsSpeaking(false);
    setAvatarState('idle');
  };

  const stop = () => {
    stopAnim();
    setListening(false);
    setIsSpeaking(false);
    setAvatarState('idle');
    void stopSpeaking();
  };

  const advice = lastAdvice || getContextualAdvice();
  const miss = getMissPattern();
  const missColor = miss === 'right' ? '#f87171' : miss === 'left' ? '#60a5fa' : '#A7F3D0';
  const missLabel = miss === 'right' ? 'Tends right' : miss === 'left' ? 'Tends left' : 'Balanced';
  const tabBarHeight = useBottomTabBarHeight();

  return (
    <View style={styles.root}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Animated.View style={[styles.avatarWrap, { opacity: idleGlow }]}>
          <Image source={LOGO} style={{ width: 44, height: 44, borderRadius: 999 }} resizeMode="cover" />
        </Animated.View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerTitle}>SmartPlay AI Caddie</Text>
          <Text style={styles.headerSub}>Hole {currentHole} • {activeCourse}</Text>
        </View>
        <Pressable onPress={() => setShowToolsMenu((v) => !v)} style={[styles.gpsBtn, showToolsMenu && { backgroundColor: '#143d22', borderColor: '#4caf50' }]}>
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </Pressable>
      </View>

      {/* Tools dropdown */}
      {showToolsMenu && (
        <View style={{
          position: 'absolute', top: 100, right: 16, zIndex: 52,
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
            <Text style={{ color: '#FFE600', fontSize: 13, fontWeight: '600' }}>Rangefinder</Text>
          </Pressable>
          <Pressable
            onPress={() => setQuietMode((q) => !q)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: quietMode ? '#143d22' : '#1a1a1a', borderWidth: 1, borderColor: quietMode ? '#4caf50' : '#2a2a2a' }}
          >
            <Text style={{ fontSize: 18 }}>{quietMode ? '🔕' : '🔊'}</Text>
            <Text style={{ color: quietMode ? '#A7F3D0' : '#aaa', fontSize: 13, fontWeight: '600' }}>{quietMode ? 'Voice Off' : 'Voice On'}</Text>
          </Pressable>
          <Pressable
            onPress={handleOpenProfile}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#143d22', borderWidth: 1, borderColor: '#4caf50' }}
          >
            <Text style={{ fontSize: 18 }}>👤</Text>
            <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '600' }}>Profile</Text>
          </Pressable>
          <Pressable
            onPress={() => { void handleLogout(); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#2a1111', borderWidth: 1, borderColor: '#ef4444' }}
          >
            <Text style={{ fontSize: 18 }}>↩️</Text>
            <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '600' }}>Log Out</Text>
          </Pressable>
        </View>
      )}

      {/* ── Distance / Rangefinder ── */}
      <Pressable onPress={fireRangefinder} style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Animated.View style={[styles.distanceCard, { transform: [{ scale: rfScale }] }]}>
          <View style={styles.rfIconWrap}>
            <Image source={ICON_RANGEFINDER} style={{ width: 22, height: 22 }} resizeMode="contain" />
          </View>
          <Text style={[styles.distanceYards, lockedDistance !== null && { color: '#4ade80' }]}>
            {lockedDistance ?? displayDistance}
          </Text>
          <Text style={styles.distanceLabel}>
            {lockedDistance !== null ? 'LOCKED — yards to pin' : 'tap to range'}
          </Text>
          {/* Yardage left after current club */}
          {(() => {
            const dist = lockedDistance ?? displayDistance;
            const carry = DEFAULT_CLUB_YARDS[club] ?? null;
            if (carry == null) return null;
            const left = Math.max(0, dist - carry);
            if (left <= 0) return <Text style={{ color: '#4ade80', fontSize: 12, fontWeight: '700', marginTop: 4 }}>On the green 🎯</Text>;
            const nextClub = Object.entries(DEFAULT_CLUB_YARDS).reduce((best, [name, yds]) =>
              Math.abs(yds - left) < Math.abs(DEFAULT_CLUB_YARDS[best[0]] - left) ? [name, yds] : best
            , Object.entries(DEFAULT_CLUB_YARDS)[0]);
            return (
              <View style={{ marginTop: 8, alignItems: 'center' }}>
                <Text style={{ color: '#f59e0b', fontSize: 20, fontWeight: '800' }}>{left} <Text style={{ color: '#aaa', fontSize: 11 }}>yds left</Text></Text>
                <Text style={{ color: '#A7F3D0', fontSize: 12, fontWeight: '600', marginTop: 2 }}>next: {nextClub[0]} ({nextClub[1]} yds)</Text>
              </View>
            );
          })()}
          {lockedDistance !== null && (
            <Pressable onPress={() => setLockedDistance(null)} style={{ marginTop: 6 }}>
              <Text style={{ color: '#aaa', fontSize: 11, fontWeight: '600' }}>✕ clear</Text>
            </Pressable>
          )}
          {gpsMiddle !== null && (
            <View style={styles.gpsBadge}>
              <Text style={{ color: '#A7F3D0', fontSize: 11, fontWeight: '700' }}>📍 GPS active</Text>
            </View>
          )}
        </Animated.View>
      </Pressable>

      {/* ── Club Row — all clubs sorted by distance appropriateness ── */}
      <View style={styles.clubSection}>
        <Text style={styles.sectionLabel}>CLUB</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(() => {
              const dist = lockedDistance ?? displayDistance;
              const sorted = Object.entries(DEFAULT_CLUB_YARDS)
                .sort((a, b) => Math.abs(a[1] - dist) - Math.abs(b[1] - dist));
              return sorted.map(([c, yds]) => (
                <Pressable
                  key={c}
                  onPress={() => setClub(c)}
                  style={[styles.clubBtn, club === c && styles.clubBtnActive]}
                >
                  <Text style={[styles.clubBtnText, club === c && { color: '#fff' }]}>{c}</Text>
                  <Text style={{ color: club === c ? '#86efac' : '#555', fontSize: 10, marginTop: 2 }}>{yds}</Text>
                </Pressable>
              ));
            })()}
          </View>
        </ScrollView>
      </View>

      {/* ── Score Entry ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Text style={styles.sectionLabel}>HOLE {currentHole} SCORE</Text>
        {/* Par selector */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {([3, 4, 5] as const).map((p) => (
            <Pressable
              key={p}
              onPress={() => setHolePar(p)}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                backgroundColor: holePar === p ? '#10B981' : '#1a1a1a',
                borderWidth: 1, borderColor: holePar === p ? '#fff' : '#333',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Par {p}</Text>
            </Pressable>
          ))}
        </View>
        {/* Score stepper + result */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#2a2a2a' }}>
          <Pressable
            onPress={() => setHoleScore((s) => Math.max(1, s - 1))}
            style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>−</Text>
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 48, fontWeight: '800', lineHeight: 52 }}>{holeScore}</Text>
            {(() => {
              const diff = holeScore - holePar;
              const label = diff <= -2 ? '🦅 Eagle' : diff === -1 ? '🐦 Birdie' : diff === 0 ? '⭕ Par' : diff === 1 ? '📍 Bogey' : diff === 2 ? '🔴 Double' : `+${diff} Over`;
              const col = diff < 0 ? '#4ade80' : diff === 0 ? '#A7F3D0' : diff === 1 ? '#f59e0b' : '#f87171';
              return <Text style={{ color: holeScore === 0 ? '#555' : col, fontSize: 14, fontWeight: '700', marginTop: 2 }}>{holeScore === 0 ? '—' : label}</Text>;
            })()}
          </View>
          <Pressable
            onPress={() => setHoleScore((s) => s + 1)}
            style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: '#2e7d32', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>+</Text>
          </Pressable>
        </View>
        {/* Save & Next */}
        {holeScore > 0 && (
          <Pressable
            onPress={() => {
              setScore(currentHole - 1, holeScore);
              setHoleScore(0);
              if (currentHole < 18) setCurrentHole(currentHole + 1);
              try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
            }}
            style={{ marginTop: 10, backgroundColor: '#2e7d32', borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#4caf50' }}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Save Score · Next Hole →</Text>
          </Pressable>
        )}
      </View>

      {/* ── Caddie Advice ── */}
      <View style={styles.adviceCard}>
        {/* Distance to pin pill */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
          <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '700' }}>{lockedDistance ?? displayDistance} yds to pin</Text>
          {(() => {
            const dist = lockedDistance ?? displayDistance;
            const carry = DEFAULT_CLUB_YARDS[club] ?? null;
            if (carry == null) return null;
            const left = Math.max(0, dist - carry);
            if (left <= 10) return <Text style={{ color: '#4ade80', fontSize: 12, fontWeight: '700' }}>🎯 on green</Text>;
            return <Text style={{ color: '#f59e0b', fontSize: 12, fontWeight: '600' }}>~{left} yds remaining after {club}</Text>;
          })()}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.adviceLabel}>Caddie</Text>
            <View style={[styles.patternBadge, { borderColor: missColor, backgroundColor: missColor + '1A' }]}>
              <Text style={{ color: missColor, fontSize: 11, fontWeight: '700' }}>{missLabel}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.adviceText} numberOfLines={4}>{advice}</Text>

        {/* Inline transcript / response */}
        {response !== '' && response !== 'Listening...' && (
          <View style={styles.responseRow}>
            <Text style={styles.responseText}>{response}</Text>
          </View>
        )}
      </View>

      {/* ── Bottom Bar (horizontal icon strip) ── */}
      <View style={[styles.bottomBar, { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingBottom: Math.max(24, tabBarHeight - 20) }]}>
        {/* Speak advice */}
        <Pressable
          onPress={() => { void (!quietMode && speak(advice)); }}
          style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#1a1a1a', borderWidth: 1.5, borderColor: '#2a2a2a', justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ fontSize: 24, lineHeight: 26 }}>{quietMode ? '🔕' : '🔊'}</Text>
        </Pressable>
        {/* Ask Caddie — unified mic button */}
        <CaddieMicButton
          context={{ hole: currentHole, distance: displayDistance, club, missPattern: getMissPattern() }}
          size={72}
          showLabel={false}
        />
        {/* Rangefinder */}
        <Pressable
          onPress={() => router.push('/rangefinder')}
          style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#332900', borderWidth: 1.5, borderColor: '#FFE600', justifyContent: 'center', alignItems: 'center' }}
        >
          <Image source={ICON_RANGEFINDER} style={{ width: 26, height: 26, tintColor: '#FFE600' }} resizeMode="contain" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e0e0e' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 52, paddingBottom: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  avatarWrap: { width: 44, height: 44, borderRadius: 999, overflow: 'hidden' },
  headerTitle: { color: '#fff', fontSize: 18, fontFamily: 'Outfit_700Bold' },
  headerSub: { color: '#ccc', fontSize: 12, fontFamily: 'Outfit_400Regular', marginTop: 2 },
  gpsBtn: {
    backgroundColor: '#332900',
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, borderColor: '#FFE600',
  },
  distanceCard: {
    backgroundColor: '#0d0d0d', borderRadius: 18, padding: 20,
    alignItems: 'center',
    borderWidth: 1, borderColor: '#1a3a1a',
    shadowColor: '#4ade80', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6, overflow: 'hidden',
  },
  rfIconWrap: { position: 'absolute', top: 10, right: 10, opacity: 0.7 },
  distanceYards: { color: '#fff', fontSize: 64, fontFamily: 'Outfit_800ExtraBold', lineHeight: 70 },
  distanceLabel: { color: '#ccc', fontSize: 13, fontFamily: 'Outfit_400Regular', marginTop: 2 },
  gpsBadge: {
    marginTop: 6, backgroundColor: '#0a2e1a', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: '#1a5e30',
  },
  clubSection: { paddingHorizontal: 16, paddingTop: 14 },
  sectionLabel: {
    color: '#ccc', fontSize: 11, fontFamily: 'Outfit_700Bold',
    letterSpacing: 1.4, marginBottom: 8,
  },
  clubRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  clubBtn: {
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#161616',
  },
  clubBtnActive: { backgroundColor: '#2e7d32', borderColor: '#388e3c' },
  clubBtnText: { color: '#ddd', fontSize: 13, fontFamily: 'Outfit_600SemiBold' },
  adviceCard: {
    flex: 1,
    backgroundColor: '#111', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#2e7d32',
    margin: 16, marginTop: 14,
  },
  adviceLabel: { color: '#66bb6a', fontSize: 12, fontFamily: 'Outfit_700Bold', letterSpacing: 0.5 },
  adviceText: { color: '#f0f0f0', fontSize: 14, fontFamily: 'Outfit_400Regular', lineHeight: 22 },
  speakBtn: {
    backgroundColor: '#1a1a1a', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a',
  },
  patternBadge: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1,
  },
  responseRow: {
    backgroundColor: '#0d2a0d', borderRadius: 8, padding: 10,
    borderLeftWidth: 3, borderLeftColor: '#66bb6a',
    marginTop: 10,
  },
  responseText: { color: '#f0f0f0', fontSize: 14, fontFamily: 'Outfit_400Regular', lineHeight: 21 },
  bottomBar: {
    padding: 12, paddingBottom: 24,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
    backgroundColor: '#0e0e0e',
    alignItems: 'flex-start',
  },
  askFab: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: '#1a3a1a', borderWidth: 2, borderColor: '#4ade80',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#4ade80', shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  micBtnText: { color: '#fff', fontFamily: 'Outfit_700Bold', fontSize: 16 },
});
