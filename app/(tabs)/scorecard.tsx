import { View, Text, StyleSheet, ScrollView, Pressable, Image, TextInput, Animated } from 'react-native';
import { useState, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { speak } from '../../services/voiceService';
import { auth } from '../../lib/firebase';
import { useRoundStore } from '../../store/roundStore';

const ICON_RANGEFINDER = require('../../assets/images/icon-rangefinder.png');
import { useMemoryStore } from '../../store/memoryStore';
import { useUserStore } from '../../store/userStore';

type ShotEntry = { result: string; club: string; hole?: number };
type HoleEntry = { hole: number; par: number; scores: number[] };

export default function Scorecard() {
  const logoScale = useRef(new Animated.Value(1)).current;

  const animateLogo = () => {
    Animated.sequence([
      Animated.timing(logoScale, { toValue: 1.22, duration: 100, useNativeDriver: true }),
      Animated.timing(logoScale, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  };
  const { round, shots: shotsParam, pars: parsedParsParam, players: playersParam, multiRound: multiRoundParam, skins: skinsParam, course: courseParam } =
    useLocalSearchParams<{ round?: string; shots?: string; pars?: string; players?: string; multiRound?: string; skins?: string; course?: string }>();

  const storedCourse = useRoundStore((s) => s.activeCourse);
  const courseName: string = courseParam ?? (storedCourse || 'Scorecard');
  const parsedRound: number[] = round ? JSON.parse(round) : [];
  const parsedShots: ShotEntry[] = shotsParam ? JSON.parse(shotsParam) : [];
  const parsedPars: number[] = parsedParsParam ? JSON.parse(parsedParsParam) : [];
  const players: string[] = playersParam ? JSON.parse(playersParam) : ['You'];
  const multiRound: HoleEntry[] = multiRoundParam ? JSON.parse(multiRoundParam) : [];
  const skinsData: number[] = skinsParam ? JSON.parse(skinsParam) : players.map(() => 0);

  const storeScores = useRoundStore((s) => s.scores);
  const scores = parsedRound.length > 0 ? parsedRound : storeScores;
  const pars = parsedPars.length > 0 ? parsedPars : [];
  const total = scores.reduce((sum, s) => sum + s, 0);
  const totalPar = pars.reduce((sum, p) => sum + p, 0);
  const totalVsPar = pars.length > 0 ? total - totalPar : null;
  const clubUsage = useMemoryStore((s) => s.clubUsage);
  const clubList = Object.entries(clubUsage).sort((a, b) => b[1] - a[1]);

  // ── Shot grouping ─────────────────────────────────────────────
  const getShotsByHole = (): Record<string, ShotEntry[]> => {
    const grouped: Record<string, ShotEntry[]> = {};
    parsedShots.forEach((shot) => {
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
      byHole[holeKey].forEach((shot) => {
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
    parsedShots.forEach((s) => { if (s.result === 'right') right++; if (s.result === 'left') left++; });
    return { right, left };
  };

  // ── Multi-player helpers ──────────────────────────────────────
  const getPlayerTotals = () => players.map((_, i) => multiRound.reduce((sum, h) => sum + (h.scores[i] ?? 0), 0));

  const getHoleWinner = (holeEntry: HoleEntry): number[] => {
    const relevant = holeEntry.scores.slice(0, players.length);
    const lowest = Math.min(...relevant);
    return relevant.map((s, i) => s === lowest ? i : -1).filter((i) => i !== -1);
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
    if (skinsData.every((s) => s === 0)) return 'No skins yet';
    const best = Math.max(...skinsData);
    return skinsData.map((s, i) => s === best ? players[i] : null).filter(Boolean).join(', ');
  };

  const getClubInsights = () => {
    if (parsedShots.length < 5) return 'Not enough data';
    const clubStats: Record<string, { left: number; right: number; straight: number; total: number }> = {};
    parsedShots.forEach((shot) => {
      if (!clubStats[shot.club]) clubStats[shot.club] = { left: 0, right: 0, straight: 0, total: 0 };
      clubStats[shot.club][shot.result as 'left' | 'right' | 'straight']++;
      clubStats[shot.club].total++;
    });
    let insight = '';
    Object.keys(clubStats).forEach((club) => {
      const s = clubStats[club];
      if (s.total < 3) return;
      if (s.right > s.left && s.right > s.straight) insight += `${club}: miss right\n`;
      else if (s.left > s.right && s.left > s.straight) insight += `${club}: miss left\n`;
      else if (s.straight >= s.left && s.straight >= s.right) insight += `${club}: reliable\n`;
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

  const registeredName = useUserStore((s) => s.name);
  const handicapIndex = useUserStore((s) => s.handicap);
  const setIsGuest = useUserStore((s) => s.setIsGuest);
  const [activePlayer, setActivePlayer] = useState(0);
  const router = useRouter();
  const rfScale = useRef(new Animated.Value(1)).current;
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
  // Always maintain 4 player slots; Player 1 = registered user (not editable here)
  const [tabNames, setTabNames] = useState<string[]>(() => {
    const defaults = [registeredName || 'You', 'Player 2', 'Player 3', 'Player 4'];
    players.forEach((p, i) => { if (i < 4) defaults[i] = i === 0 ? (registeredName || p) : p; });
    return defaults;
  });
  const [editingTab, setEditingTab] = useState<number | null>(null);

  // ── 18-hole manual scores: manualScores[playerIdx][holeIdx 0..17] ──
  const [manualScores, setManualScores] = useState<number[][]>(() => {
    const grid = Array.from({ length: 4 }, () => Array(18).fill(0));
    // Pre-fill from multiRound if available
    multiRound.forEach((h) => {
      const idx = h.hole - 1;
      if (idx >= 0 && idx < 18) {
        h.scores.forEach((s, pi) => { if (pi < 4) grid[pi][idx] = s; });
      }
    });
    // Pre-fill player 0 from parsedRound
    parsedRound.forEach((s, idx) => { if (idx < 18) grid[0][idx] = s; });
    return grid;
  });

  const adjustScore = (playerIdx: number, holeIdx: number, delta: number) => {
    setManualScores((prev) => {
      const next = prev.map((row) => [...row]);
      next[playerIdx][holeIdx] = Math.max(0, (next[playerIdx][holeIdx] ?? 0) + delta);
      return next;
    });
  };

  // Build 18 par values — use parsedPars first, else use course default pars
  const DEFAULT_PARS = [4,3,5,4,4,3,4,5,4, 4,3,5,4,4,3,5,4,5];
  const holePars: number[] = Array.from({ length: 18 }, (_, i) => parsedPars[i] ?? DEFAULT_PARS[i] ?? 4);

  // Default stroke index (USGA standard allocation: front odd, back even)
  const DEFAULT_STROKE_INDEXES = [5,17,3,15,1,11,7,13,9, 6,16,4,14,2,12,8,10,18];
  // courseHandicap for player 0 (slope 120 default — no slope input on scorecard)
  const courseHandicap = Math.round(handicapIndex * (120 / 113));
  const getStrokesForHole = (strokeIdx: number): number => {
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
      const winners = netScores.reduce<number[]>((acc, s, pi) => {
        if (s === lowest && lowest < Infinity) acc.push(pi);
        return acc;
      }, []);
      if (winners.length === 1) { netSkins[winners[0]] += carry; carry = 1; }
      else { carry++; }
    }
    return netSkins;
  };

  const front9Par = holePars.slice(0, 9).reduce((a, b) => a + b, 0);
  const back9Par  = holePars.slice(9, 18).reduce((a, b) => a + b, 0);
  const totalPar18 = front9Par + back9Par;

  const getPlayerManualTotal = (pi: number) => manualScores[pi].reduce((a, b) => a + b, 0);
  const getPlayerFront9 = (pi: number) => manualScores[pi].slice(0, 9).reduce((a, b) => a + b, 0);
  const getPlayerBack9  = (pi: number) => manualScores[pi].slice(9).reduce((a, b) => a + b, 0);

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
    <View style={styles.container}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingBottom: 8, paddingHorizontal: 16 }}>
        <Pressable onPress={() => {
          animateLogo();
          if (!quietMode) void speak('Great golfers review their scorecards to find patterns. What hole cost you strokes today?');
        }}>
          <Animated.View style={{ transform: [{ scale: logoScale }], shadowColor: '#4ade80', shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 }}>
            <Image source={require('../../assets/images/logo.png')} style={{ width: 48, height: 48, borderRadius: 999, overflow: 'hidden' }} resizeMode="cover" />
          </Animated.View>
        </Pressable>
        <View style={{ flex: 1, marginLeft: 12, alignItems: 'center' }}>
          <Text style={styles.title}>Scorecard</Text>
          {courseName !== 'Scorecard' && (
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', marginTop: -12, textAlign: 'center' }} numberOfLines={1}>{courseName}</Text>
          )}
        </View>
        <Pressable
          onPress={() => setShowToolsMenu((v) => !v)}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: showToolsMenu ? '#143d22' : '#1a1a1a', borderWidth: 1.5, borderColor: showToolsMenu ? '#4caf50' : '#2a2a2a', justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </Pressable>
      </View>

      {/* Tools dropdown */}
      {showToolsMenu && (
        <View style={{
          position: 'absolute', top: 106, right: 16, zIndex: 52,
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

      {/* Rangefinder FAB — bottom-right */}
      <Pressable
        onPress={() => router.push('/rangefinder')}
        style={{
          position: 'absolute', bottom: 90, right: 16, zIndex: 51,
          width: 52, height: 52, borderRadius: 26,
          backgroundColor: '#0B3D2E', borderWidth: 2, borderColor: '#FFE600',
          justifyContent: 'center', alignItems: 'center',
          shadowColor: '#FFE600', shadowOpacity: 0.35, shadowRadius: 8, elevation: 7,
        }}
      >
        <Image source={ICON_RANGEFINDER} style={{ width: 28, height: 28, tintColor: '#FFE600' }} resizeMode="contain" />
      </Pressable>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>

        {/* ── 4-player tab bar ── */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <Pressable
              key={i}
              onPress={() => { setActivePlayer(i); setEditingTab(null); }}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 10,
                borderRadius: 12,
                alignItems: 'center',
                backgroundColor: activePlayer === i ? '#2e7d32' : pressed ? '#222' : '#111',
                borderWidth: 1,
                borderColor: activePlayer === i ? '#66bb6a' : 'rgba(255,255,255,0.1)',
              })}
            >
              <Text style={{ color: activePlayer === i ? '#fff' : '#aaa', fontWeight: activePlayer === i ? '700' : '400', fontSize: 12 }} numberOfLines={1}>
                {tabNames[i]}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Player 1: registered name badge (read-only) ── */}
        {activePlayer === 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
            <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 15 }}>{tabNames[0]}</Text>
            <View style={{ backgroundColor: '#2e7d32', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>YOU</Text>
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
                style={{ backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: '#66bb6a' }}
                placeholder="Enter player name"
                placeholderTextColor="#555"
                maxLength={20}
              />
            ) : (
              <Pressable onPress={() => setEditingTab(activePlayer)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 15 }}>{tabNames[activePlayer]}</Text>
                <Text style={{ color: '#aaa', fontSize: 12 }}>✏ tap to edit</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── 18-hole scorecard with +/- buttons ── */}
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
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', width: 36 }}>P{par}</Text>
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
                    <Text style={{ color: '#ffcc00', fontSize: 11, fontWeight: '600', marginLeft: 2 }}>NET {netScore}</Text>
                  )}
                </View>
              </View>
            );
          })}
          <View style={styles.subtotalRow}>
            <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 14 }}>Front 9</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {(() => { const f = getPlayerFront9(activePlayer); const vsp = formatVsPar(f, front9Par); return vsp ? <Text style={{ color: vspColor(f, front9Par), fontWeight: '600', fontSize: 13 }}>{vsp}</Text> : null; })()}
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{getPlayerFront9(activePlayer) || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Back 9 */}
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
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', width: 36 }}>P{par}</Text>
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
                    <Text style={{ color: '#ffcc00', fontSize: 11, fontWeight: '600', marginLeft: 2 }}>NET {netScore}</Text>
                  )}
                </View>
              </View>
            );
          })}
          <View style={styles.subtotalRow}>
            <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 14 }}>Back 9</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {(() => { const b = getPlayerBack9(activePlayer); const vsp = formatVsPar(b, back9Par); return vsp ? <Text style={{ color: vspColor(b, back9Par), fontWeight: '600', fontSize: 13 }}>{vsp}</Text> : null; })()}
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{getPlayerBack9(activePlayer) || '—'}</Text>
            </View>
          </View>
        </View>

        {/* ── Total ── */}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{tabNames[activePlayer]} Total</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {(() => { const t = getPlayerManualTotal(activePlayer); const vsp = formatVsPar(t, totalPar18); return vsp ? <Text style={{ fontSize: 15, fontWeight: '700', color: vspColor(t, totalPar18) }}>{vsp} vs par</Text> : null; })()}
            <Text style={styles.totalScore}>{getPlayerManualTotal(activePlayer) || '—'}</Text>
          </View>
        </View>

        {/* ── Net Total (shows when handicap > 0) ── */}
        {handicapIndex > 0 && (() => {
          const netTotal = manualScores[activePlayer].reduce((sum, s, i) => {
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
            <Text style={{ color: '#ccc', fontSize: 14, lineHeight: 21 }}>{getPlayerInsights()}</Text>
            {multiRound.map((holeEntry, idx) => {
              const winners = getHoleWinner(holeEntry);
              return (
                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginTop: 4 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Hole {holeEntry.hole}</Text>
                  <Text style={{ color: '#66bb6a', fontSize: 13 }}>W: {winners.map((i) => tabNames[i] ?? players[i]).join(', ')}</Text>
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
            <Text style={styles.sectionTitle}>Hole Review</Text>
            {Object.keys(shotsByHole).sort((a, b) => Number(a) - Number(b)).map((holeKey) => (
              <View key={holeKey} style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 12, marginBottom: 12 }}>
                <Text style={{ color: '#fff', fontWeight: '600', marginBottom: 6 }}>Hole {holeKey}</Text>
                {/* Shot dispersion map */}
                <View style={{ height: 120, backgroundColor: '#1a4d2e', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
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
                  {[['#ff5252', 'Left'], ['#66bb6a', 'Center'], ['#42a5f5', 'Right']].map(([c, l]) => (
                    <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
                      <Text style={{ color: '#aaa', fontSize: 11 }}>{l}</Text>
                    </View>
                  ))}
                </View>
                {shotsByHole[holeKey].map((shot, idx) => (
                  <Text key={idx} style={{ color: '#ccc', fontSize: 13, lineHeight: 20 }}>
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
            {clubList.map(([club, count]) => (
              <View style={styles.clubUsageRow} key={club}>
                <Text style={styles.clubName}>{club}</Text>
                <Text style={styles.clubCount}>{count}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Club insights ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Club Insights</Text>
          <Text style={{ color: '#ccc', fontSize: 14, lineHeight: 22, marginTop: 4 }}>{getClubInsights()}</Text>
        </View>

        {/* ── Strokes lost ── */}
        {parsedShots.length >= 3 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Strokes Lost</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: '#ff5252', fontSize: 22, fontWeight: '700' }}>{strokesLost.offTee}</Text>
                <Text style={{ color: '#aaa', fontSize: 12 }}>Off the Tee</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: '#ffa726', fontSize: 22, fontWeight: '700' }}>{strokesLost.approach}</Text>
                <Text style={{ color: '#aaa', fontSize: 12 }}>Approach</Text>
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
          <Text style={styles.sectionTitle}>Round Summary</Text>
          {players.length > 1 && multiRound.length > 0 && (
            <>
              <Text style={{ color: '#66bb6a', fontSize: 14, marginBottom: 4 }}>🏆 Winner: {getRoundWinner()}</Text>
              <Text style={{ color: '#ffcc00', fontSize: 14, marginBottom: 8 }}>💰 Skins: {getSkinsWinner()}</Text>
            </>
          )}
          <Text style={{ color: scores.length < 3 ? '#aaa' : '#ccc', fontSize: 14, lineHeight: 22 }}>
            {getAdvancedCoaching()}
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

      {/* Floating Rangefinder Button */}
      <Animated.View style={[{ position: 'absolute', bottom: 24, right: 20 }, { transform: [{ scale: rfScale }] }]}>
        <Pressable
          onPress={() => {
            Animated.sequence([
              Animated.timing(rfScale, { toValue: 1.25, duration: 110, useNativeDriver: true }),
              Animated.timing(rfScale, { toValue: 1, duration: 110, useNativeDriver: true }),
            ]).start();
            router.push('/rangefinder');
          }}
          style={{ backgroundColor: '#0a2e1a', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#2e7d32', shadowColor: '#4ade80', shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 }}
        >
          <Image source={ICON_RANGEFINDER} style={{ width: 28, height: 28, tintColor: '#A7F3D0' }} resizeMode="contain" />
        </Pressable>
      </Animated.View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B3D2E',
    paddingTop: 32,
    paddingHorizontal: 18,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Outfit_700Bold',
    color: '#fff',
    marginBottom: 18,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  list: {
    paddingBottom: 40,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    marginBottom: 4,
  },
  holeNum: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Outfit_500Medium',
  },
  score: {
    fontSize: 16,
    color: '#A7F3D0',
    fontFamily: 'Outfit_700Bold',
  },
  scoreEmpty: {
    fontSize: 16,
    color: '#888',
    fontFamily: 'Outfit_700Bold',
    minWidth: 24,
    textAlign: 'center',
  },
  adjBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2e7d32',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjBtnText: {
    color: '#A7F3D0',
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
    lineHeight: 22,
  },
  vspLabel: {
    fontSize: 12,
    fontFamily: 'Outfit_600SemiBold',
    minWidth: 28,
    textAlign: 'right',
  },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    marginTop: 6,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    marginTop: 12,
  },
  totalLabel: {
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
    color: '#fff',
  },
  totalScore: {
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
    color: '#A7F3D0',
  },
  clubUsageSection: {
    marginTop: 20,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  section: {
    marginTop: 20,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Outfit_700Bold',
    color: '#A7F3D0',
    marginBottom: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  clubUsageTitle: {
    fontSize: 11,
    fontFamily: 'Outfit_700Bold',
    color: '#A7F3D0',
    marginBottom: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  clubUsageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  clubName: {
    fontSize: 14,
    fontFamily: 'Outfit_400Regular',
    color: 'rgba(255,255,255,0.75)',
  },
  clubCount: {
    fontSize: 14,
    color: '#66bb6a',
    fontFamily: 'Outfit_700Bold',
  },
});