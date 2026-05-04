/**
 * app/arena.tsx
 *
 * SmartPlay Arena — TopGolf-style game and simulation engine
 * that runs entirely in the 10×10 cage using phone IMU,
 * acoustic detection, and the ball physics engine.
 *
 * Accessible from the Practice tab tools menu.
 * Does NOT modify: caddie brain, GPS flow, round management, voice system.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  SafeAreaView,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { speakJob, PRIORITY as ENGINE_PRIORITY } from '../services/voice';
import { useSettingsStore } from '../store/settingsStore';
import { useCaddieMemory } from '../store/CaddieMemory';
import { COURSE_DB } from '../data/courses';
import { calculateBallMetrics } from '../services/CagePhysicsEngine';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { startAcousticDetection, stopAcousticDetection } from '../services/AcousticShotDetector';
import { pushShotResult, isCastEnabled } from '../services/castService';
import {
  computeVirtualShot,
  createCTPGame,
  recordCTPShot,
  getCTPWinner,
  createScrambleGame,
  recordScrambleShot,
  createSimRound,
  recordSimShot,
  SKILLS_TARGETS,
  scoreSkillsShot,
  beatTheProScore,
  recommendSimClub,
  getArenaVoiceCue,
  buildArenaStats,
} from '../services/ArenaEngine';

// ─── Assets ──────────────────────────────────────────────────
const LOGO = require('../assets/images/logo.png');

// ─── HOLE_IMAGES (palms course — holes 1–10, fallback to hole 10 for 11+) ──
const HOLE_IMAGES: Record<number, any> = {
  1:  require('../assets/images/palms/palms-h1.jpg'),
  2:  require('../assets/images/palms/palms-h2.jpg'),
  3:  require('../assets/images/palms/palms-h3.jpg'),
  4:  require('../assets/images/palms/palms-h4.jpg'),
  5:  require('../assets/images/palms/palms-h5.jpg'),
  6:  require('../assets/images/palms/palms-h6.jpg'),
  7:  require('../assets/images/palms/palms-h7.jpg'),
  8:  require('../assets/images/palms/palms-h8.jpg'),
  9:  require('../assets/images/palms/palms-h9.jpg'),
  10: require('../assets/images/palms/palms-h10.jpg'),
};
function getHoleImage(holeNum: number) {
  return HOLE_IMAGES[holeNum] ?? HOLE_IMAGES[Math.min(holeNum, 10)] ?? HOLE_IMAGES[9];
}

// ─── Menifee Lakes Palms holes ────────────────────────────────
const MENIFEE_HOLES = COURSE_DB[0]?.holes ?? [];

// ─── Game definitions ────────────────────────────────────────
const GAMES = [
  {
    id: 'skills',
    icon: '🎯',
    title: 'Skills Challenge',
    subtitle: '7 targets · increasing distance',
    description: 'TopGolf-style progressive target game. Hit 3 shots at each distance. Score multiplies with combo.',
    color: '#2e7d32',
    borderColor: '#4ade80',
  },
  {
    id: 'ctp',
    icon: '📍',
    title: 'Closest to Pin',
    subtitle: 'Pure accuracy · 3 rounds',
    description: '1–4 players take turns. Lowest distance from pin after 3 rounds wins.',
    color: '#1565c0',
    borderColor: '#60a5fa',
  },
  {
    id: 'sim',
    icon: '⛳',
    title: 'Sim Round',
    subtitle: 'Play Menifee Lakes · 9 or 18 holes',
    description: 'Simulate a real round from your cage. Each shot carries toward the hole — putt out when you reach the green.',
    color: '#7b1fa2',
    borderColor: '#c084fc',
  },
  {
    id: 'scramble',
    icon: '🔄',
    title: 'Scramble Challenge',
    subtitle: '5 shots per hole · best ball',
    description: 'Hit 5 shots per hole and play the best one. Score your 9-hole scramble from the cage.',
    color: '#e65100',
    borderColor: '#fb923c',
  },
  {
    id: 'beatpro',
    icon: '🏌️',
    title: 'Beat the Pro',
    subtitle: 'Compare to PGA Tour benchmarks',
    description: 'Hit 10 shots with your club. See how your carry distance and consistency compare to Tour averages.',
    color: '#b71c1c',
    borderColor: '#f87171',
  },
] as const;

type GameId = typeof GAMES[number]['id'];

// ─── Types ───────────────────────────────────────────────────
interface VirtualShot {
  carryYards: number;
  lateralYards: number;
  totalMissYards: number;
  shotShape: string;
  resultLabel: string;
  sgEstimate: number;
  ballSpeedMph: number;
  zone: string;
  club: string;
  timestamp: number;
}

interface CTPGame {
  finished: boolean;
  players: { name: string; bestMiss: number; shots: VirtualShot[] }[];
  currentPlayer: number;
  round: number;
  totalRounds: number;
  targetYards: number;
}

interface SimGame {
  complete: boolean;
  totalScore: number;
  holes: any[];
  currentHole: number;
  totalStrokes: number;
}

interface BeatProResult {
  overallVsPro: number;
  playerCarryYards: number;
  tourCarryYards: number;
  label: string;
  distanceVsPro: number;
  consistencyVsPro: number;
}

interface ArenaShot {
  zone: 'bull' | 'inner' | 'outer' | 'miss';
  direction: 'good' | 'left' | 'right';
  ballStart: 'neutral' | 'left' | 'right';
  ballSpeedMph: number;
  club: string;
  virtualShot: VirtualShot;
}

interface ArenaStats {
  gamesPlayed: number;
  bestCTP: number;
  highScore: number;
  avgCarry: number;
}

// ─── Helpers ─────────────────────────────────────────────────

// Random acknowledgments for deterministic voice pipeline
const ARENA_ACKNOWLEDGMENTS = [
  'Got it.',
  'Here you go.',
  'One moment.',
  'Let me think.',
  'I see.',
  'Understood.',
  'Right.',
  'OK.',
  'Sure thing.',
];

function getArenaAcknowledgment(): string {
  const idx = Math.floor(Math.random() * ARENA_ACKNOWLEDGMENTS.length);
  return ARENA_ACKNOWLEDGMENTS[idx];
}

// Deterministic voice pipeline: immediate ack + 120ms delay + main response
// Ensures: no dead silence, consistent pacing, prevents dropped responses
function safeSpeak(text: string) {
  if (!useSettingsStore.getState().voiceEnabled || !text) return;
  
  // Immediate acknowledgment to prevent dead silence
  const ack = getArenaAcknowledgment();
  void speakJob(ack, ENGINE_PRIORITY.AMBIENT);
  
  // Schedule main response after acknowledgment finishes + 120ms gap
  setTimeout(() => {
    void speakJob(text, ENGINE_PRIORITY.AMBIENT);
  }, 120);
}

function scoreLabel(toPar: number): string {
  if (toPar <= -2) return 'Eagle';
  if (toPar === -1) return 'Birdie';
  if (toPar === 0)  return 'Par';
  if (toPar === 1)  return 'Bogey';
  if (toPar === 2)  return 'Double';
  return `+${toPar}`;
}

// ─── Main Component ───────────────────────────────────────────
export default function ArenaScreen() {
  const router = useRouter();
  const updateMemoryFromSession = useCaddieMemory((s) => s.updateMemoryFromSession);

  // ── Cage config ──────────────────────────────────────────
  const [cageDistance, setCageDistance] = useState(8);
  const [cageCalibrated, setCageCalibrated] = useState(false);
  const [handicap, setHandicap] = useState(18);
  const [club, setClub] = useState('7 iron');

  // ── Arena stats ──────────────────────────────────────────
  const [arenaStats, setArenaStats] = useState<ArenaStats | null>(null);

  // ── Game state ───────────────────────────────────────────
  const [activeGame, setActiveGame] = useState<GameId | null>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [arenaShots, setArenaShots] = useState<ArenaShot[]>([]);
  const [lastVirtualShot, setLastVirtualShot] = useState<VirtualShot | null>(null);
  const [totalPoints, setTotalPoints] = useState(0);          // Skills / Beat Pro
  const [currentTargetIdx, setCurrentTargetIdx] = useState(0); // Skills
  const [shotsAtTarget, setShotsAtTarget] = useState(0);       // Skills (3 per target)
  const [beatProShots, setBeatProShots] = useState<any[]>([]);  // Beat Pro
  const [gameComplete, setGameComplete] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);

  // ── IMU / Acoustic ───────────────────────────────────────
  const swingPeakMsRef = useRef<number>(0);
  const imuDataRef = useRef<any>(null);
  const [imuActive, setImuActive] = useState(false);
  const [acousticActive, setAcousticActive] = useState(false);

  // ── Load cage config + stats on mount ────────────────────
  useEffect(() => {
    AsyncStorage.getItem('cageDistance').then((v) => {
      if (v) { setCageDistance(parseFloat(v)); setCageCalibrated(true); }
    });
    AsyncStorage.getItem('handicap').then((v) => {
      if (v) setHandicap(parseInt(v, 10));
    });
    AsyncStorage.getItem('arenaStats').then((v) => {
      if (v) setArenaStats(JSON.parse(v));
    });
  }, []);

  // ── IMU subscription when game is active ────────────────
  useEffect(() => {
    if (!activeGame) return;

    let accelSub: any, gyroSub: any;
    Accelerometer.setUpdateInterval(16);
    Gyroscope.setUpdateInterval(16);

    accelSub = Accelerometer.addListener((d) => {
      const magnitude = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
      if (magnitude > 2.5) {
        swingPeakMsRef.current = Date.now();
        imuDataRef.current = d;
      }
    });

    gyroSub = Gyroscope.addListener(() => {}); // keep gyro warm

    setImuActive(true);
    return () => {
      accelSub?.remove();
      gyroSub?.remove();
      setImuActive(false);
    };
  }, [activeGame]);

  // ── Acoustic subscription when game is active ────────────
  useEffect(() => {
    if (!activeGame) return;

    startAcousticDetection((_type: 'clean' | 'net') => {
      const acousticMs = Date.now();
      if (!swingPeakMsRef.current) return;

      const metrics = calculateBallMetrics(
        swingPeakMsRef.current,
        acousticMs,
        cageDistance,
        imuDataRef.current ?? { x: 0, y: 0, z: 1 },
        'bull',
        club,
      );

      const ballSpeedMph = metrics?.ballSpeedMph ?? 0;
      const direction: 'good' | 'left' | 'right' =
        imuDataRef.current?.x > 0.3  ? 'right' :
        imuDataRef.current?.x < -0.3 ? 'left'  : 'good';

      logArenaShot('inner', direction, 'neutral', ballSpeedMph);
      swingPeakMsRef.current = 0;
    });

    setAcousticActive(true);
    return () => {
      stopAcousticDetection();
      setAcousticActive(false);
    };
  }, [activeGame, cageDistance, club]);

  // ── Start game ───────────────────────────────────────────
  const startGame = useCallback((id: GameId) => {
    setArenaShots([]);
    setLastVirtualShot(null);
    setTotalPoints(0);
    setCurrentTargetIdx(0);
    setShotsAtTarget(0);
    setBeatProShots([]);
    setGameComplete(false);

    if (id === 'skills') {
      setGameState({ mode: 'skills', targetIdx: 0, shotsAtTarget: 0, totalPoints: 0 });
      setActiveGame(id);
    } else if (id === 'ctp') {
      setGameState(createCTPGame(['Player 1'], 150));
      setActiveGame(id);
    } else if (id === 'sim') {
      setShowSetupModal(true);
      setActiveGame(id);
    } else if (id === 'scramble') {
      const holes = MENIFEE_HOLES.slice(0, 9);
      setGameState(createScrambleGame(holes));
      setActiveGame(id);
    } else if (id === 'beatpro') {
      setGameState({ mode: 'beatpro', shotsHit: 0, totalNeeded: 10, shots: [] });
      setActiveGame(id);
    }
  }, []);

  const startSimRound = useCallback((holeCount: 9 | 18) => {
    const holes = MENIFEE_HOLES.slice(0, holeCount);
    setGameState(createSimRound(holes, handicap));
    setShowSetupModal(false);
  }, [handicap]);

  // ── Log a shot (manual or auto) ──────────────────────────
  const logArenaShot = useCallback(
    (
      zone: 'bull' | 'inner' | 'outer' | 'miss',
      direction: 'good' | 'left' | 'right',
      ballStart: 'neutral' | 'left' | 'right',
      ballSpeedMph = 0,
    ) => {
      if (!activeGame || gameComplete) return;

      const targetYards = (() => {
        if (activeGame === 'skills') {
          return SKILLS_TARGETS[currentTargetIdx]?.yards ?? 150;
        }
        if (activeGame === 'ctp') return gameState?.targetYards ?? 150;
        if (activeGame === 'sim') {
          const hole = gameState?.holes?.[gameState.currentHole];
          return hole?.currentDistance ?? 150;
        }
        if (activeGame === 'scramble') {
          const hole = gameState?.holes?.[gameState.currentHole];
          return hole?.distance ?? 150;
        }
        return 150;
      })();

      const virtualShot = computeVirtualShot({
        ballSpeedMph,
        zone,
        direction,
        ballStart,
        club,
        handicap,
        targetYards,
      }) as VirtualShot;

      setLastVirtualShot(virtualShot);

      const shot: ArenaShot = { zone, direction, ballStart, ballSpeedMph, club, virtualShot };
      const updatedShots = [...arenaShots, shot];
      setArenaShots(updatedShots);

      // Speak result
      safeSpeak(getArenaVoiceCue(virtualShot));

      // Cast: push to TV/browser (fire-and-forget)
      if (isCastEnabled()) {
        void pushShotResult(
          {
            clubHeadSpeedMph:    0,
            ballSpeedMph:        ballSpeedMph,
            estimatedCarryYards: virtualShot.carryYards,
            zone,
            direction,
            shotShape:           virtualShot.shotShape,
          },
          {
            mode: 'arena',
            shots: updatedShots.slice(-12).map((s) => ({
              zone:  s.zone,
              carry: s.virtualShot.carryYards,
            })),
            sessionPoints: activeGame === 'skills' ? totalPoints : 0,
            comboStreak:   0,
            comboMult:     1,
            caddieMessage: getArenaVoiceCue(virtualShot),
            weather:       null,
          },
        );
      }

      // ── Update game state ──────────────────────────────
      if (activeGame === 'skills') {
        const pts = scoreSkillsShot(virtualShot, SKILLS_TARGETS[currentTargetIdx]?.points ?? 10);
        const newTotal = totalPoints + pts;
        setTotalPoints(newTotal);

        const newShotsAtTarget = shotsAtTarget + 1;
        if (newShotsAtTarget >= 3) {
          const nextIdx = currentTargetIdx + 1;
          if (nextIdx >= SKILLS_TARGETS.length) {
            setGameComplete(true);
            saveArenaResult('skills', { totalPoints: newTotal, avgCarryYards: Math.round(updatedShots.reduce((a, s) => a + s.virtualShot.carryYards, 0) / updatedShots.length) });
          } else {
            setCurrentTargetIdx(nextIdx);
            setShotsAtTarget(0);
          }
        } else {
          setShotsAtTarget(newShotsAtTarget);
        }
      } else if (activeGame === 'ctp') {
        const updated = recordCTPShot(gameState, virtualShot) as CTPGame;
        setGameState(updated);
        if (updated.finished) {
          const winner = getCTPWinner(updated) as CTPGame['players'][0];
          setGameComplete(true);
          safeSpeak(`Game over. Best shot: ${winner.bestMiss} yards from pin.`);
          saveArenaResult('ctp', { bestMiss: winner.bestMiss });
        }
      } else if (activeGame === 'sim') {
        const updated = recordSimShot(gameState, virtualShot) as SimGame;
        setGameState(updated);
        if (updated.complete) {
          setGameComplete(true);
          const avg = Math.round(updatedShots.reduce((a, s) => a + s.virtualShot.carryYards, 0) / updatedShots.length);
          saveArenaResult('sim', { totalScore: updated.totalScore, avgCarryYards: avg });
          const scoreStr = updated.totalScore >= 0 ? `+${updated.totalScore}` : `${updated.totalScore}`;
          safeSpeak(`Round complete. Final score: ${scoreStr}.`);
        }
      } else if (activeGame === 'scramble') {
        const updated = recordScrambleShot(gameState, virtualShot) as SimGame;
        setGameState(updated);
        if (updated.complete) {
          setGameComplete(true);
          saveArenaResult('scramble', { totalScore: updated.totalScore });
          const scoreStr = updated.totalScore >= 0 ? `+${updated.totalScore}` : `${updated.totalScore}`;
          safeSpeak(`Scramble complete. Score: ${scoreStr}.`);
        }
      } else if (activeGame === 'beatpro') {
        const updatedBeatPro = [...beatProShots, virtualShot];
        setBeatProShots(updatedBeatPro);
        if (updatedBeatPro.length >= 10) {
          setGameComplete(true);
          const result = beatTheProScore(updatedBeatPro, club, handicap) as BeatProResult | null;
          if (result) {
            safeSpeak(`Beat the Pro complete. You are at ${result.overallVsPro} percent of Tour level.`);
            saveArenaResult('beatpro', { totalPoints: result.overallVsPro, avgCarryYards: result.playerCarryYards });
          }
        }
      }

      // Update CaddieMemory if 10+ shots
      if (updatedShots.length >= 10) {
        updateCaddieMemory(updatedShots);
      }
    },
    [activeGame, gameState, arenaShots, club, handicap, currentTargetIdx, shotsAtTarget, totalPoints, beatProShots, gameComplete],
  );

  // ── CaddieMemory update ───────────────────────────────────
  const updateCaddieMemory = useCallback(async (shots: ArenaShot[]) => {
    // Save learned carry distances by club
    const byClub: Record<string, number[]> = {};
    shots.forEach((s) => {
      if (!byClub[s.club]) byClub[s.club] = [];
      byClub[s.club].push(s.virtualShot.carryYards);
    });

    for (const [c, carries] of Object.entries(byClub)) {
      if (carries.length >= 3) {
        const avg = Math.round(carries.reduce((a, b) => a + b, 0) / carries.length);
        await AsyncStorage.setItem(`learnedCarry_${c}`, String(avg));
      }
    }

    updateMemoryFromSession({
      totalShots:    shots.length,
      leftCount:     shots.filter((s) => s.direction === 'left').length,
      rightCount:    shots.filter((s) => s.direction === 'right').length,
      straightCount: shots.filter((s) => s.direction === 'good').length,
      fatCount:      0,
      thinCount:     0,
      cleanCount:    shots.filter((s) => s.zone === 'bull' || s.zone === 'inner').length,
    });
  }, [updateMemoryFromSession]);

  // ── Save arena result ─────────────────────────────────────
  const saveArenaResult = useCallback(async (mode: string, result: Record<string, any>) => {
    try {
      const key = 'arenaResults';
      const existing = await AsyncStorage.getItem(key);
      const results: any[] = existing ? JSON.parse(existing) : [];

      results.unshift({ mode, date: new Date().toISOString(), ...result });
      await AsyncStorage.setItem(key, JSON.stringify(results.slice(0, 100)));

      const stats = buildArenaStats(results) as ArenaStats;
      await AsyncStorage.setItem('arenaStats', JSON.stringify(stats));
      setArenaStats(stats);
    } catch {
      // Non-critical — silently ignore storage errors
    }
  }, []);

  // ── Exit game ────────────────────────────────────────────
  const exitGame = useCallback(() => {
    stopAcousticDetection();
    setActiveGame(null);
    setGameState(null);
    setGameComplete(false);
    setLastVirtualShot(null);
    setArenaShots([]);
    setCurrentTargetIdx(0);
    setShotsAtTarget(0);
    setBeatProShots([]);
    setTotalPoints(0);
  }, []);

  // ─────────────────────────────────────────────────────────
  // RENDER: Active Game
  // ─────────────────────────────────────────────────────────
  if (activeGame && gameState) {
    return (
      <ActiveGameView
        activeGame={activeGame}
        gameState={gameState}
        lastVirtualShot={lastVirtualShot}
        totalPoints={totalPoints}
        currentTargetIdx={currentTargetIdx}
        shotsAtTarget={shotsAtTarget}
        beatProShots={beatProShots}
        arenaShots={arenaShots}
        club={club}
        handicap={handicap}
        imuActive={imuActive}
        acousticActive={acousticActive}
        gameComplete={gameComplete}
        onLogShot={logArenaShot}
        onExit={exitGame}
        showSetupModal={showSetupModal}
        onStartSim={startSimRound}
      />
    );
  }

  // ─────────────────────────────────────────────────────────
  // RENDER: Arena Home
  // ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={s.backArrow}>←</Text>
        </Pressable>
        <Image source={LOGO} style={s.logo} />
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 }}>
            <Text style={{ color: '#4ade80', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>SMARTPLAY</Text>
          </View>
          <Text style={s.headerTitle}>Arena</Text>
          <Text style={s.headerSub}>Cage game modes</Text>
        </View>
      </View>

      {/* Calibration warning */}
      {!cageCalibrated && (
        <View style={s.calibBanner}>
          <Text style={{ fontSize: 20 }}>⚠️</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.calibTitle}>Set your cage distance first</Text>
            <Text style={s.calibSub}>Open Practice tab to calibrate · ball speed estimation requires this</Text>
          </View>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
        {GAMES.map((game) => (
          <Pressable
            key={game.id}
            onPress={() => startGame(game.id)}
            style={({ pressed }) => [
              s.gameCard,
              {
                backgroundColor: pressed ? game.color : `${game.color}22`,
                borderColor: game.borderColor,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <View style={s.gameCardRow}>
              <Text style={s.gameIcon}>{game.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.gameTitle}>{game.title}</Text>
                <Text style={[s.gameSub, { color: game.borderColor }]}>{game.subtitle}</Text>
                <Text style={s.gameDesc}>{game.description}</Text>
              </View>
              <Text style={[s.gameChevron, { color: game.borderColor }]}>›</Text>
            </View>
          </Pressable>
        ))}

        {/* Arena stats summary */}
        {arenaStats && arenaStats.gamesPlayed > 0 && (
          <View style={s.statsCard}>
            <Text style={s.statsTitle}>YOUR ARENA STATS</Text>
            <View style={s.statsRow}>
              {([
                { label: 'Games',      value: String(arenaStats.gamesPlayed) },
                { label: 'Best CTP',   value: arenaStats.bestCTP < 999 ? `${arenaStats.bestCTP}yd` : '--' },
                { label: 'High Score', value: String(arenaStats.highScore) },
                { label: 'Avg Carry',  value: arenaStats.avgCarry > 0 ? `${arenaStats.avgCarry}yd` : '--' },
              ] as const).map(({ label, value }) => (
                <View key={label} style={s.statItem}>
                  <Text style={s.statValue}>{value}</Text>
                  <Text style={s.statLabel}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// ACTIVE GAME VIEW
// ─────────────────────────────────────────────────────────────
interface ActiveGameViewProps {
  activeGame: GameId;
  gameState: any;
  lastVirtualShot: VirtualShot | null;
  totalPoints: number;
  currentTargetIdx: number;
  shotsAtTarget: number;
  beatProShots: any[];
  arenaShots: ArenaShot[];
  club: string;
  handicap: number;
  imuActive: boolean;
  acousticActive: boolean;
  gameComplete: boolean;
  onLogShot: (zone: 'bull' | 'inner' | 'outer' | 'miss', dir: 'good' | 'left' | 'right', bs: 'neutral' | 'left' | 'right', speed?: number) => void;
  onExit: () => void;
  showSetupModal: boolean;
  onStartSim: (holes: 9 | 18) => void;
}

function ActiveGameView({
  activeGame, gameState, lastVirtualShot, totalPoints,
  currentTargetIdx, shotsAtTarget, beatProShots, arenaShots,
  club, handicap, imuActive, acousticActive, gameComplete,
  onLogShot, onExit, showSetupModal, onStartSim,
}: ActiveGameViewProps) {
  // Current hole info for Sim / Scramble
  const currentHole = gameState?.holes?.[gameState.currentHole];

  // Header info per mode
  const scoreDisplay = (() => {
    if (activeGame === 'skills') return `${totalPoints} pts`;
    if (activeGame === 'ctp') return `Rd ${gameState.round}/${gameState.totalRounds}`;
    if (activeGame === 'sim') return gameState.totalScore >= 0 ? `+${gameState.totalScore}` : `${gameState.totalScore}`;
    if (activeGame === 'scramble') return gameState.totalScore >= 0 ? `+${gameState.totalScore}` : `${gameState.totalScore}`;
    if (activeGame === 'beatpro') return `${beatProShots.length}/10`;
    return '';
  })();

  const modeTitle = GAMES.find((g) => g.id === activeGame)?.title ?? 'Arena';
  const modeColor = GAMES.find((g) => g.id === activeGame)?.borderColor ?? '#4ade80';

  // Target card text
  const targetText = (() => {
    if (activeGame === 'skills') {
      const t = SKILLS_TARGETS[currentTargetIdx];
      return t ? `Target: ${t.label} · Shot ${shotsAtTarget + 1}/3 · ${t.points * 2} pts max` : 'Done!';
    }
    if (activeGame === 'ctp') {
      const player = gameState.players?.[gameState.currentPlayer];
      return `${player?.name ?? 'Player'}'s turn · Target: ${gameState.targetYards} yds`;
    }
    if (activeGame === 'sim' && currentHole) {
      const recommended = recommendSimClub(currentHole.currentDistance, handicap);
      return `Hole ${currentHole.hole} · Par ${currentHole.par} · ${currentHole.currentDistance} yds remaining\nRecommended: ${recommended}`;
    }
    if (activeGame === 'scramble' && currentHole) {
      return `Hole ${currentHole.hole} · Par ${currentHole.par} · Shot ${(currentHole.shots?.length ?? 0) + 1}/5`;
    }
    if (activeGame === 'beatpro') {
      return `Shot ${beatProShots.length + 1}/10 · Club: ${club}`;
    }
    return '';
  })();

  // Sim round hole image
  const showHoleImage = (activeGame === 'sim' || activeGame === 'scramble') && currentHole;

  // Beat-pro result
  const beatProResult = (activeGame === 'beatpro' && gameComplete
    ? beatTheProScore(beatProShots, club, handicap) as BeatProResult | null
    : null) as BeatProResult | null;

  return (
    <SafeAreaView style={s.root}>
      {/* Sim round setup modal */}
      <Modal visible={showSetupModal} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Sim Round Setup</Text>
            <Text style={s.modalSub}>Choose number of holes to play</Text>
            <Pressable onPress={() => onStartSim(9)} style={[s.modalBtn, { borderColor: '#c084fc' }]}>
              <Text style={[s.modalBtnText, { color: '#c084fc' }]}>9 Holes — Front</Text>
            </Pressable>
            <Pressable onPress={() => onStartSim(18)} style={[s.modalBtn, { borderColor: '#c084fc', marginTop: 10 }]}>
              <Text style={[s.modalBtnText, { color: '#c084fc' }]}>18 Holes — Full Round</Text>
            </Pressable>
            <Pressable onPress={onExit} style={{ marginTop: 16 }}>
              <Text style={{ color: '#666', textAlign: 'center' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Game header */}
      <View style={s.gameHeader}>
        <Pressable onPress={onExit} hitSlop={12}>
          <Text style={s.backArrow}>←</Text>
        </Pressable>
        <Text style={[s.gameHeaderTitle, { color: modeColor }]}>{modeTitle}</Text>
        <View style={[s.scorePill, { borderColor: modeColor }]}>
          <Text style={[s.scoreText, { color: modeColor }]}>{scoreDisplay}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Hole image — Sim / Scramble */}
        {showHoleImage && (
          <Image
            source={getHoleImage(currentHole.hole)}
            style={s.holeImage}
            resizeMode="cover"
          />
        )}

        {/* Target card */}
        {!gameComplete && (
          <View style={s.targetCard}>
            <Text style={s.targetText}>{targetText}</Text>
            {activeGame === 'sim' && currentHole && (
              <Text style={s.holeNote}>{currentHole.note}</Text>
            )}
          </View>
        )}

        {/* Game complete banner */}
        {gameComplete && (
          <View style={[s.completeBanner, { borderColor: modeColor }]}>
            <Text style={s.completeTitle}>Session Complete!</Text>
            {activeGame === 'skills' && (
              <Text style={s.completeScore}>Total: {totalPoints} pts</Text>
            )}
            {(activeGame === 'sim' || activeGame === 'scramble') && (
              <Text style={s.completeScore}>
                Score: {gameState.totalScore >= 0 ? `+${gameState.totalScore}` : `${gameState.totalScore}`}
              </Text>
            )}
            {activeGame === 'ctp' && (() => {
              const winner = getCTPWinner(gameState) as CTPGame['players'][0];
              return (
                <Text style={s.completeScore}>
                  {winner.name} wins · {winner.bestMiss} yds from pin
                </Text>
              );
            })()}
            {beatProResult && (
              <View style={{ gap: 4 }}>
                <Text style={s.completeScore}>{beatProResult.label}</Text>
                <Text style={{ color: '#ccc', textAlign: 'center' }}>
                  {beatProResult.playerCarryYards} yds avg vs {beatProResult.tourCarryYards} Tour
                </Text>
                <Text style={{ color: '#aaa', textAlign: 'center' }}>
                  {beatProResult.overallVsPro}% of Tour level
                </Text>
              </View>
            )}
            <Pressable onPress={onExit} style={[s.exitBtn, { borderColor: modeColor }]}>
              <Text style={[s.exitBtnText, { color: modeColor }]}>Done</Text>
            </Pressable>
          </View>
        )}

        {/* Last shot result */}
        {lastVirtualShot && (
          <View style={s.shotResult}>
            <Text style={s.shotResultLabel}>{lastVirtualShot.resultLabel}</Text>
            <Text style={s.shotResultDetails}>
              {`⚡ ${lastVirtualShot.ballSpeedMph > 0 ? `${Math.round(lastVirtualShot.ballSpeedMph)} mph · ` : ''}${lastVirtualShot.carryYards} yds carry · ${Math.abs(lastVirtualShot.lateralYards)} yds ${lastVirtualShot.lateralYards > 0 ? 'right' : 'left'}`}
            </Text>
            <Text style={s.shotMiss}>{lastVirtualShot.totalMissYards} yards from target</Text>
            <Text style={s.shotShape}>Shape: {lastVirtualShot.shotShape}</Text>
          </View>
        )}

        {/* Detection indicators */}
        <View style={s.detectionRow}>
          <View style={[s.detectionPill, { borderColor: imuActive ? '#4ade80' : '#333' }]}>
            <View style={[s.detectionDot, { backgroundColor: imuActive ? '#4ade80' : '#555' }]} />
            <Text style={{ color: imuActive ? '#4ade80' : '#555', fontSize: 12 }}>IMU</Text>
          </View>
          <View style={[s.detectionPill, { borderColor: acousticActive ? '#4ade80' : '#333' }]}>
            <Text style={{ color: acousticActive ? '#4ade80' : '#555', fontSize: 12 }}>🎙 Sound</Text>
          </View>
        </View>

        {/* Manual shot logging buttons */}
        {!gameComplete && (
          <View style={s.logSection}>
            <Text style={s.logLabel}>LOG SHOT</Text>

            {/* Zone buttons */}
            <View style={s.zoneRow}>
              {(['bull', 'inner', 'outer', 'miss'] as const).map((zone) => (
                <Pressable
                  key={zone}
                  onPress={() => onLogShot(zone, 'good', 'neutral')}
                  style={[s.zoneBtn, {
                    backgroundColor:
                      zone === 'bull'  ? '#2e7d3244' :
                      zone === 'inner' ? '#1565c044' :
                      zone === 'outer' ? '#e6510044' : '#33333344',
                    borderColor:
                      zone === 'bull'  ? '#4ade80' :
                      zone === 'inner' ? '#60a5fa' :
                      zone === 'outer' ? '#fb923c' : '#555',
                  }]}
                >
                  <Text style={s.zoneBtnText}>{zone.charAt(0).toUpperCase() + zone.slice(1)}</Text>
                </Pressable>
              ))}
            </View>

            {/* Direction buttons */}
            <View style={s.dirRow}>
              {([
                { dir: 'left' as const,  label: '← Left'  },
                { dir: 'good' as const,  label: '↑ Straight' },
                { dir: 'right' as const, label: 'Right →' },
              ]).map(({ dir, label }) => (
                <Pressable
                  key={dir}
                  onPress={() => onLogShot('inner', dir, 'neutral')}
                  style={s.dirBtn}
                >
                  <Text style={s.dirBtnText}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.autoNote}>
              Auto-detection fires these automatically when IMU + acoustic are active
            </Text>
          </View>
        )}

        {/* Sim round scorecard */}
        {(activeGame === 'sim' || activeGame === 'scramble') && gameState?.holes && (
          <View style={s.scorecardSection}>
            <Text style={s.scorecardTitle}>SCORECARD</Text>
            {gameState.holes
              .filter((h: any) => h.complete || gameState.holes.indexOf(h) <= gameState.currentHole)
              .slice(0, gameState.currentHole + 1)
              .map((h: any, i: number) => {
                const toPar = h.score != null ? h.score - h.par : null;
                return (
                  <View key={i} style={s.scorecardRow}>
                    <Text style={s.scorecardHole}>H{h.hole}</Text>
                    <Text style={s.scorecardPar}>Par {h.par}</Text>
                    {h.complete && h.score != null ? (
                      <Text style={[
                        s.scorecardScore,
                        { color: toPar! < 0 ? '#4ade80' : toPar! > 1 ? '#f87171' : '#fff' },
                      ]}>
                        {h.score} ({scoreLabel(toPar!)})
                      </Text>
                    ) : (
                      <Text style={s.scorecardScore}>—</Text>
                    )}
                  </View>
                );
              })}
          </View>
        )}

        {/* Beat Pro: shot history */}
        {activeGame === 'beatpro' && beatProShots.length > 0 && (
          <View style={s.scorecardSection}>
            <Text style={s.scorecardTitle}>YOUR SHOTS</Text>
            {beatProShots.map((s: any, i: number) => (
              <View key={i} style={s.scorecardRow}>
                <Text style={s.scorecardHole}>#{i + 1}</Text>
                <Text style={{ color: '#ccc', flex: 1 }}>{s.carryYards} yds · {s.shotShape}</Text>
                <Text style={{ color: '#4ade80', minWidth: 60, textAlign: 'right' }}>{s.resultLabel}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: '#060f09' },
  header:           { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  backArrow:        { color: '#4ade80', fontSize: 22, fontWeight: '700' },
  logo:             { width: 36, height: 36, borderRadius: 18 },
  headerTitle:      { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub:        { color: '#4ade80', fontSize: 11 },

  calibBanner:      { backgroundColor: '#3d1a00', margin: 16, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#f59e0b', flexDirection: 'row', alignItems: 'center', gap: 10 },
  calibTitle:       { color: '#fbbf24', fontWeight: '700' },
  calibSub:         { color: '#92400e', fontSize: 12 },

  scroll:           { padding: 16, gap: 12 },
  gameCard:         { borderRadius: 16, padding: 18, borderWidth: 1.5, marginBottom: 12 },
  gameCardRow:      { flexDirection: 'row', alignItems: 'center', gap: 14 },
  gameIcon:         { fontSize: 32 },
  gameTitle:        { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 2 },
  gameSub:          { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 },
  gameDesc:         { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 18 },
  gameChevron:      { fontSize: 24 },

  statsCard:        { backgroundColor: '#0d1f14', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#1a3a22', marginTop: 8 },
  statsTitle:       { color: '#4ade80', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 12 },
  statsRow:         { flexDirection: 'row', gap: 12 },
  statItem:         { flex: 1, alignItems: 'center' },
  statValue:        { color: '#fff', fontSize: 18, fontWeight: '800' },
  statLabel:        { color: '#555', fontSize: 10 },

  gameHeader:       { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  gameHeaderTitle:  { flex: 1, fontSize: 16, fontWeight: '800' },
  scorePill:        { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  scoreText:        { fontSize: 14, fontWeight: '700' },

  holeImage:        { width: '100%', height: 160 },
  targetCard:       { margin: 16, padding: 16, backgroundColor: '#0d2419', borderRadius: 14, borderWidth: 1, borderColor: '#1a3a22' },
  targetText:       { color: '#fff', fontSize: 14, fontWeight: '700', lineHeight: 22 },
  holeNote:         { color: '#6a9a7a', fontSize: 12, marginTop: 6 },

  completeBanner:   { margin: 16, padding: 20, backgroundColor: '#0d1f14', borderRadius: 16, borderWidth: 2, alignItems: 'center', gap: 10 },
  completeTitle:    { color: '#fff', fontSize: 20, fontWeight: '800' },
  completeScore:    { color: '#ccc', fontSize: 16 },
  exitBtn:          { marginTop: 8, borderWidth: 1.5, borderRadius: 24, paddingHorizontal: 32, paddingVertical: 10 },
  exitBtnText:      { fontSize: 15, fontWeight: '700' },

  shotResult:       { margin: 16, padding: 16, backgroundColor: '#0a1f14', borderRadius: 14, borderWidth: 1, borderColor: '#1e4a2a', gap: 4 },
  shotResultLabel:  { color: '#4ade80', fontSize: 18, fontWeight: '800' },
  shotResultDetails:{ color: '#ccc', fontSize: 13 },
  shotMiss:         { color: '#fff', fontSize: 13 },
  shotShape:        { color: '#aaa', fontSize: 12 },

  detectionRow:     { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 8 },
  detectionPill:    { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  detectionDot:     { width: 8, height: 8, borderRadius: 4 },

  logSection:       { margin: 16, gap: 10 },
  logLabel:         { color: '#4ade80', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  zoneRow:          { flexDirection: 'row', gap: 8 },
  zoneBtn:          { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  zoneBtnText:      { color: '#fff', fontSize: 12, fontWeight: '700' },
  dirRow:           { flexDirection: 'row', gap: 8 },
  dirBtn:           { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: '#0d2419', borderWidth: 1, borderColor: '#1a3a22' },
  dirBtnText:       { color: '#c4d9cc', fontSize: 12, fontWeight: '600' },
  autoNote:         { color: '#3d5a44', fontSize: 11, textAlign: 'center' },

  scorecardSection: { margin: 16, backgroundColor: '#0a1a10', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1a3a22', gap: 6 },
  scorecardTitle:   { color: '#4ade80', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  scorecardRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1a3a22' },
  scorecardHole:    { color: '#aaa', width: 28, fontSize: 12 },
  scorecardPar:     { color: '#777', width: 44, fontSize: 12 },
  scorecardScore:   { flex: 1, textAlign: 'right', fontWeight: '700', fontSize: 13, color: '#fff' },

  modalOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
  modalCard:        { backgroundColor: '#0d1f14', borderRadius: 20, padding: 28, width: 300, borderWidth: 1, borderColor: '#1a3a22', alignItems: 'center', gap: 8 },
  modalTitle:       { color: '#fff', fontSize: 18, fontWeight: '800' },
  modalSub:         { color: '#6a9a7a', fontSize: 13, marginBottom: 8 },
  modalBtn:         { width: '100%', borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalBtnText:     { fontSize: 15, fontWeight: '700' },
});
