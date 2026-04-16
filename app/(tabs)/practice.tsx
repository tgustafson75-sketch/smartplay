import { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, Platform, Animated, TextInput, Modal, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
// eslint-disable-next-line @typescript-eslint/no-deprecated
import { Audio, Video, ResizeMode } from 'expo-av';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { speak, stopSpeaking, setGlobalGender, getGlobalGender } from '../../services/voiceService';
import { useVoiceCaddie } from '../../hooks/useVoiceCaddie';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { useSwingDetector, getSwingFeedback } from '../../hooks/useSwingDetector';
import { auth } from '../../lib/firebase';
import VoiceOverlay from '../../components/VoiceOverlay';
import CaddieMicButton from '../../components/CaddieMicButton';
import { useSwingStore } from '../../store/swingStore';
import { playerProfile } from '../../store/playerProfile';
import { useUserStore } from '../../store/userStore';
import { usePlayerProfileStore, buildInitialPracticePlan } from '../../store/playerProfileStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PracticeTutorialOverlay from '../../components/PracticeTutorialOverlay';
import { useCaddieMemory } from '../../store/CaddieMemory';
import DispersionMap from '../../components/DispersionMap';
import { extractFrames } from '../../services/VideoAnalysisHelper';
import { analyzeSwing } from '../../services/SwingAnalysisEngine';
import { detectBallStart } from '../../services/BallTrackingEngine';
import {
  processFrames,
  setLowPowerMode  as vpSetLowPowerMode,
  pauseProcessing  as vpPauseProcessing,
  resumeProcessing as vpResumeProcessing,
  setBurstMode     as vpSetBurstMode,
} from '../../services/VisionProcessor';
import { saveSession as saveSessionHistory, getHistory } from '../../services/SessionHistory';
import { analyzeTrends } from '../../services/TrendEngine';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';

const ICON_RANGEFINDER = require('../../assets/images/icon-rangefinder.png');
const LOGO = require('../../assets/images/logo.png');
const PUTT_ROLL_SFX  = require('../../assets/sounds/putt-roll.mp3');
const SWING_SWOOSH_SFX = require('../../assets/sounds/swing-swoosh.mp3');

const DRILLS = [
  { id: 'putting', label: 'Putting Practice', description: 'Track putts by distance with IMU stroke detection.' },
  { id: 'short-game', label: 'Short Game', description: 'Hit chip shots to a target. Score by landing zone.' },
  { id: 'alignment', label: 'Alignment & Aim', description: 'Set up alignment rods and hit 10 shots focusing on aiming at your target.' },
  { id: 'tempo', label: 'Tempo & Rhythm', description: 'Hit 10 shots at 80% power. Focus on a smooth, consistent tempo.' },
  { id: 'driver-straight', label: 'Driver', description: 'Hit 10 driver shots. Count how many land in the fairway.' },
  { id: 'iron-accuracy', label: 'Irons', description: 'Pick a target and hit 10 iron shots. Track how many are within 20 yards.' },
  { id: 'indoor', label: 'Indoor', description: 'Small-space training with tempo trainer and rep tracking.' },
  { id: 'swing-detect', label: 'Swing Detect', description: 'IMU swing detection, camera capture and analysis.' },
];

const ZONE_POINTS: Record<string, number> = { bull: 10, inner: 5, outer: 2, miss: 0 };

// -- AI Practice Focus (pure, no deps) ----------------------------------------
type PracticeFocus = { focus: string; drill: string; cue: string };
type PracticeLevel = 'easy' | 'standard' | 'focused';

const FOCUS_DRILLS: Record<string, PracticeFocus[]> = {
  right: [
    { focus: 'Reduce right miss', drill: 'Hit 10 shots aiming slightly left. Swing from inside-out.', cue: 'Commit to the line' },
    { focus: 'Start line control', drill: 'Pick a narrow target. Hit 8 shots - count on-line starts.', cue: 'Start it on line' },
    { focus: 'Path correction', drill: 'Place a headcover outside the ball. Hit 8 shots without touching it.', cue: 'Swing from the inside' },
  ],
  left: [
    { focus: 'Reduce left miss', drill: 'Hit 10 shots holding the face slightly open through impact.', cue: 'Quiet the hands' },
    { focus: 'Face control', drill: 'Hit 8 shots at 80% effort. Focus on a square face at impact.', cue: 'Hold the finish' },
  ],
  mental: [
    { focus: 'Mental reset', drill: 'Hit 10 smooth swings at 70% effort. No rushing.', cue: 'Slow it down' },
    { focus: 'Tempo control', drill: 'Hit 8 shots counting -1-and-swing - on each rep.', cue: 'Let it flow' },
  ],
  putting: [
    { focus: 'Putting consistency', drill: 'Hit 10 putts from 6 feet. Focus on pace, not line.', cue: 'Head still, listen for it' },
    { focus: 'Short putt confidence', drill: 'Hit 10 putts from 4 feet. Count makes in a row.', cue: 'Commit to the line' },
  ],
  'short-game': [
    { focus: 'Short game feel', drill: 'Hit 10 chips from 20 yards. Land within a club of flag.', cue: 'Soft hands, trust your line' },
    { focus: 'Landing zone control', drill: 'Pick a hoop or towel. Hit 8 chips landing inside it.', cue: 'Loft it softly' },
  ],
  driver: [
    { focus: 'Driver accuracy', drill: 'Hit 10 drives to a narrow fairway target.', cue: 'Smooth tempo, full turn' },
    { focus: 'Driver tempo', drill: 'Hit 8 drives at 80% effort. Start line only.', cue: 'Wide arc, easy finish' },
  ],
  irons: [
    { focus: 'Iron consistency', drill: 'Hit 10 irons to a flag. Track how many are within 20yd.', cue: 'One shot at a time' },
    { focus: 'Contact quality', drill: 'Hit 8 irons focusing on a clean divot after the ball.', cue: 'Ball first, then turf' },
  ],
  default: [
    { focus: 'Build consistency', drill: 'Hit 10 shots at 80% effort. Count on-target starts.', cue: 'Stay in your process' },
    { focus: 'Commitment drill', drill: 'Pick 1 target. Hit 8 shots fully committed each time.', cue: 'All-in, every shot' },
  ],
};

function generatePracticeFocusSet(
  missBias: 'right' | 'left' | 'neutral' | null,
  struggle: 'driver' | 'irons' | 'short-game' | 'putting' | 'mental' | null,
): PracticeFocus[] {
  if (missBias === 'right')  return FOCUS_DRILLS.right;
  if (missBias === 'left')   return FOCUS_DRILLS.left;
  if (struggle === 'mental')     return FOCUS_DRILLS.mental;
  if (struggle === 'putting')    return FOCUS_DRILLS.putting;
  if (struggle === 'short-game') return FOCUS_DRILLS['short-game'];
  if (struggle === 'driver')     return FOCUS_DRILLS.driver;
  if (struggle === 'irons')      return FOCUS_DRILLS.irons;
  return FOCUS_DRILLS.default;
}
// -----------------------------------------------------------------------------

export default function Practice() {
  const setIsGuest = useUserStore((s) => s.setIsGuest);
  const ppMiss     = usePlayerProfileStore((s) => s.typicalMiss);
  const ppStruggle = usePlayerProfileStore((s) => s.biggestStruggle);
  const ppStrength = usePlayerProfileStore((s) => s.bigStrength);
  const ppLim      = usePlayerProfileStore((s) => s.physicalLimitation);
  const ppComplete = usePlayerProfileStore((s) => s.profileComplete);

  // ── CaddieMemory ──────────────────────────────────────────────────
  const updateMemoryFromSession = useCaddieMemory((s) => s.updateMemoryFromSession);
  const updateLongTermBias      = useCaddieMemory((s) => s.updateLongTermBias);
  const memoryMissBias          = useCaddieMemory((s) => s.missBias);

  const [selectedDrill, setSelectedDrill] = useState(DRILLS[0].id);
  const [drillCount, setDrillCount] = useState(0);
  const [goodShots, setGoodShots] = useState(0);
  const [missShots, setMissShots] = useState(0);
  const [missLeft, setMissLeft] = useState(0);
  const [missRight, setMissRight] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [difficulty, setDifficulty] = useState(1);
  const [swingPercent, setSwingPercent] = useState(50);
  const [indoorReps, setIndoorReps] = useState(0);
  const [tempoText, setTempoText] = useState('Ready');
  const [isTempoRunning, setIsTempoRunning] = useState(false);
  const [tempoGood, setTempoGood] = useState(0);
  const [tempoMiss, setTempoMiss] = useState(0);
  const [tempoStreak, setTempoStreak] = useState(0);
  const [bestTempoStreak, setBestTempoStreak] = useState(0);
  const [streak, setStreak] = useState(1);
  const [lastPracticeDate, setLastPracticeDate] = useState<string | null>(null);
  const [weeklyHistory, setWeeklyHistory] = useState<{ tempo: number; date: string }[]>([]);

  // -- Practice Mode & Scoring -------------------------------------------
  const [practiceMode, setPracticeMode] = useState<'free' | 'putting' | 'chipping'>('free');
  const [sessionPoints, setSessionPoints] = useState(0);
  const [comboStreak, setComboStreak] = useState(0);
  const [comboMult, setComboMult] = useState(1);
  const [lastHitZone, setLastHitZone] = useState<'bull' | 'inner' | 'outer' | 'miss' | null>(null);
  const [shotMapLog, setShotMapLog] = useState<{ x: number; y: number; zone: string; id: number }[]>([]);
  const shotIdRef = useRef(0);
  // Chipping Challenge
  const [chipTarget, setChipTarget] = useState(20);
  const [chipPoints, setChipPoints] = useState(0);
  const [chipStreak, setChipStreak] = useState(0);
  const [chipBestStreak, setChipBestStreak] = useState(0);
  const [chipTotal, setChipTotal] = useState(0);

  // Putting Tracker
  const [puttDistance, setPuttDistance] = useState(6);
  const [puttResults, setPuttResults] = useState<{ distance: number; made: boolean }[]>([]);
  const [puttStreak, setPuttStreak] = useState(0);

  // AI Focus session
  const [focusShots, setFocusShots] = useState<{
    result: 'good' | 'left' | 'right';
    timestamp: number;
    ballStart?: 'left' | 'straight' | 'right';
    startMismatch?: boolean;
    flightType?: string;
  }[]>([]);
  const aiFocusVoiceRef = useRef(0);
  const [practiceLevel, setPracticeLevel] = useState<PracticeLevel>('standard');
  const [pressureMode, setPressureMode] = useState(false);
  const [pressureStreak, setPressureStreak] = useState(0);
  const [drillVariantIdx, setDrillVariantIdx] = useState(0);
  const drillVariantsRef = useRef<PracticeFocus[]>([]);

  // Low Power Mode
  const [lowPowerMode, setLowPowerMode] = useState(false);
  const toggleLowPowerMode = (next: boolean) => {
    setLowPowerMode(next);
    vpSetLowPowerMode(next);
    if (next) {
      // Pause live frame processing; disable auto-detect to save battery
      vpPauseProcessing();
      setAutoDetectEnabled(false);
    } else {
      vpResumeProcessing();
    }
  };

  // Auto-detect mode — Accelerometer-based hands-free shot logging
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(false);
  const autoDetectRef    = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);
  const autoDetectCooldownRef = useRef(false); // prevent double-firing within 2 s

  // Swing Camera
  const router = useRouter();
  const [showToolsMenu, setShowToolsMenu] = useState(false);

  // Tutorial — shown on first visit; also openable via "How to Setup" in tools menu
  const [showTutorial, setShowTutorial] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('practiceTutorialSeen').then((v) => {
      if (!v) setShowTutorial(true);
    }).catch(() => {});
  }, []);
  const handleDismissTutorial = () => {
    setShowTutorial(false);
    AsyncStorage.setItem('practiceTutorialSeen', '1').catch(() => {});
  };
  const [quietMode, setQuietMode] = useState(false);
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>(getGlobalGender() as 'male' | 'female');
  const quietModeRef = useRef(false);
  quietModeRef.current = quietMode;
  const safeSpeak = (msg: string) => { if (!quietModeRef.current) void speak(msg); };
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [swingLibrary, setSwingLibrary] = useState<{ uri: string; tempo: string; time: string }[]>([]);
  const [swingFilter, setSwingFilter] = useState<'all' | 'good' | 'bad'>('all');
  const cameraRef = useRef<CameraView>(null);
  const videoRef = useRef<InstanceType<typeof Video>>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // -- IMU sensor capture for swing analysis --------------------------------
  type PracticeSwingAnalysis = {
    path: 'inside-out' | 'outside-in' | 'on-plane';
    face: 'open' | 'square' | 'closed';
    tempo: 'smooth' | 'fast' | 'slow';
    plane: 'steep' | 'flat' | 'ideal';
    wristRotation: 'early' | 'normal' | 'late';
    bodyRotation: 'restricted' | 'good' | 'over';
    rotScore: number;
    peakG: number;
    duration: number;
    speedEst: string;
    summary: string;
    cues: string[];
  };

  const recAccelRef    = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);
  const recGyroRef     = useRef<ReturnType<typeof Gyroscope.addListener> | null>(null);
  const recPeakGRef    = useRef(0);
  const recPeakXRef    = useRef(0);  // lateral ? path
  const recPeakZRef    = useRef(0);  // vertical ? plane
  const recPeakRotYRef = useRef(0);  // forearm roll (wrist release)
  const recPeakRotZRef = useRef(0);  // body yaw (hip/shoulder turn)
  const recStartRef    = useRef(0);
  const recDurRef      = useRef(0);

  const [practiceAnalysis, setPracticeAnalysis] = useState<PracticeSwingAnalysis | null>(null);
  const [showPracticeAnalysis, setShowPracticeAnalysis] = useState(false);

  // Video-based swing analysis — populated when End Session is tapped
  const [swingAnalysis, setSwingAnalysis] = useState<{ clubPath: string; faceAngle: string; tempo: string } | null>(null);

  const generatePracticeAnalysis = (): PracticeSwingAnalysis => {
    const peakG    = recPeakGRef.current;
    const peakX    = recPeakXRef.current;
    const peakZ    = recPeakZRef.current;
    const peakRotY = recPeakRotYRef.current;
    const peakRotZ = recPeakRotZRef.current;
    const duration = recDurRef.current;

    const path: PracticeSwingAnalysis['path'] = peakX > 0.35 ? 'outside-in' : peakX < -0.25 ? 'inside-out' : 'on-plane';
    const face: PracticeSwingAnalysis['face'] = peakX > 0.2 ? 'open' : peakX < -0.2 ? 'closed' : 'square';
    const plane: PracticeSwingAnalysis['plane'] = peakZ > 1.4 ? 'steep' : peakZ < 0.7 ? 'flat' : 'ideal';
    const tempo: PracticeSwingAnalysis['tempo'] = duration > 0 && duration < 1800 ? 'fast' : duration > 2800 ? 'slow' : 'smooth';
    const speedEst = peakG > 2.5 ? 'High' : peakG > 1.6 ? 'Medium' : 'Low';
    const wristRotation: PracticeSwingAnalysis['wristRotation'] =
      Math.abs(peakRotY) > 4.0 ? 'early' : Math.abs(peakRotY) > 1.5 ? 'normal' : 'late';
    const bodyRotation: PracticeSwingAnalysis['bodyRotation'] =
      Math.abs(peakRotZ) > 3.5 ? 'over' : Math.abs(peakRotZ) > 1.5 ? 'good' : 'restricted';
    const rotScore = Math.min(100,
      (bodyRotation === 'good' ? 40 : bodyRotation === 'over' ? 20 : 10) +
      (wristRotation === 'normal' ? 35 : wristRotation === 'late' ? 20 : 15) +
      (tempo === 'smooth' ? 25 : 10)
    );

    const cues: string[] = [];
    if (path === 'outside-in') cues.push('Swing from inside - feel the club drop into the slot');
    else if (path === 'inside-out') cues.push('Quiet the hands through impact - prevent the face rolling over');
    else cues.push('Path is on plane - stay consistent');
    if (face === 'open') cues.push('Rotate the forearm through impact to square the face');
    else if (face === 'closed') cues.push('Hold off the release slightly at impact');
    if (plane === 'steep') cues.push('Shallow the club on the way down - flatter elbow plane');
    else if (plane === 'flat') cues.push('More shoulder tilt - avoid a too-flat swing plane');
    if (tempo === 'fast') cues.push('Slow your transition - pause at the top for one beat');
    else if (tempo === 'slow') cues.push('Stay committed through the ball - not tentative');
    if (wristRotation === 'early') cues.push('Forearms firing too early - hold lag longer into the zone');
    else if (wristRotation === 'late') cues.push('Release is passive - let forearms roll through more freely');
    if (bodyRotation === 'restricted') cues.push('Hips and shoulders are tight - feel a full pivot through the ball');
    else if (bodyRotation === 'over') cues.push('Body spinning out - let arms catch up before firing the hips');

    const pathLabel = path === 'outside-in' ? 'Outside-in' : path === 'inside-out' ? 'Inside-out' : 'On-plane';
    const summary = `${pathLabel} path, ${face} face, ${tempo} tempo. Plane ${plane}. ${speedEst} speed. ${wristRotation} wrist release, ${bodyRotation} body turn.`;

    return { path, face, tempo, plane, wristRotation, bodyRotation, rotScore, peakG: Math.round(peakG * 10) / 10, duration, speedEst, summary, cues };
  };

  // ── Auto-detect: subscribe/unsubscribe based on toggle + activeDrill ────────
  useEffect(() => {
    if (!autoDetectEnabled || !selectedDrill || lowPowerMode) {
      autoDetectRef.current?.remove();
      autoDetectRef.current = null;
      return;
    }
    // G-force threshold for a swing impulse (same order of magnitude as
    // existing recAccelRef usage in startRecording)
    const SWING_G_THRESHOLD = 2.2;
    const COOLDOWN_MS       = 2000;

    Accelerometer.setUpdateInterval(50);
    autoDetectRef.current = Accelerometer.addListener(({ x, y, z }) => {
      if (autoDetectCooldownRef.current) return;
      const g = Math.sqrt(x * x + y * y + z * z);
      if (g >= SWING_G_THRESHOLD) {
        autoDetectCooldownRef.current = true;
        // Lateral X component infers direction: left of centre → left miss, right → right miss
        const result: 'good' | 'left' | 'right' =
          x < -0.4  ? 'left'
          : x > 0.4 ? 'right'
          : 'good';
        logFocusShot(result);
        setTimeout(() => { autoDetectCooldownRef.current = false; }, COOLDOWN_MS);
      }
    });
    return () => {
      autoDetectRef.current?.remove();
      autoDetectRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDetectEnabled, selectedDrill, lowPowerMode]);

  // Swing Detection - powered by shared useSwingDetector hook
  const [sensorTempoFeedback, setSensorTempoFeedback] = useState('No swings yet');
  const [sensorTempoGood, setSensorTempoGood]         = useState(0);
  const [sensorTempoMiss, setSensorTempoMiss]         = useState(0);
  const [sensorReps, setSensorReps]                   = useState(0);
  const setLastSwing = useSwingStore((s) => s.setLastSwing);

  const swingDetector = useSwingDetector({
    onSwing: ({ tempo, tempoMs }) => {
      const feedback = getSwingFeedback(tempo);
      setSensorTempoFeedback(feedback);
      setSensorReps((r) => r + 1);
      setLastSwing(tempo, tempoMs);
      // Play swoosh on every detected swing
      playSound(SWING_SWOOSH_SFX);
      if (tempo === 'smooth') {
        setSensorTempoGood((g) => g + 1);
        safeSpeak(feedback);
      } else {
        setSensorTempoMiss((m) => m + 1);
        safeSpeak(feedback);
      }
    },
  });

  // Convenience aliases so all existing UI references still work
  const isTracking  = swingDetector.isActive;
  const swingCount  = swingDetector.swingCount;
  const startTracking = () => swingDetector.start();
  const stopTracking  = () => swingDetector.stop();

  const [cameraMinimized, setCameraMinimized] = useState(true);

  // Putt motion tracking
  const [isPuttTracking, setIsPuttTracking] = useState(false);
  const [puttMotionFeedback, setPuttMotionFeedback] = useState('Hold phone like a putter grip and stroke');
  const [puttPathFeedback, setPuttPathFeedback] = useState('');
  const [puttStrokeDetected, setPuttStrokeDetected] = useState(false);
  const puttAccelRef = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);
  const puttPhaseRef = useRef<'ready' | 'backswing'>('ready');
  const puttPeakTimeRef = useRef(0);
  const puttMaxXDeviationRef = useRef(0);
  const lastPuttTimeRef = useRef(0);

  // -- Putting ball animation ------------------------------------------------
  // puttBallY: 0 = start of green, 1 = hole
  const puttBallY     = useRef(new Animated.Value(0)).current;
  const puttBallX     = useRef(new Animated.Value(0)).current; // lateral drift
  const puttBallScale = useRef(new Animated.Value(1)).current;
  const puttBallOpacity = useRef(new Animated.Value(0)).current;
  const [puttAnimActive, setPuttAnimActive] = useState(false);
  const [puttAnimResult, setPuttAnimResult] = useState<'made' | 'miss' | null>(null);
  // Gyroscope data for putt stroke quality
  const puttGyroRef  = useRef<ReturnType<typeof Gyroscope.addListener> | null>(null);
  const puttPeakRotRef = useRef(0); // peak rotation for stroke quality

  const playSound = async (asset: any) => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(asset, { shouldPlay: true, volume: 1.0 });
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) sound.unloadAsync();
      });
    } catch (_) {}
  };

  const animatePutt = (made: boolean, xDrift: number) => {
    setPuttAnimResult(null);
    puttBallY.setValue(0);
    puttBallX.setValue(0);
    puttBallScale.setValue(1);
    puttBallOpacity.setValue(1);
    setPuttAnimActive(true);
    const driftX = made ? xDrift * 18 : xDrift * 60 + (Math.random() > 0.5 ? 28 : -28);
    Animated.parallel([
      Animated.timing(puttBallY, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(puttBallX, { toValue: driftX, duration: 900, useNativeDriver: true }),
    ]).start(() => {
      if (made) {
        setPuttAnimResult('made');
        playSound(PUTT_ROLL_SFX);
        Animated.parallel([
          Animated.timing(puttBallScale, { toValue: 0.1, duration: 300, useNativeDriver: true }),
          Animated.timing(puttBallOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]).start(() => {
          setTimeout(() => { setPuttAnimActive(false); puttBallOpacity.setValue(0); }, 600);
        });
      } else {
        setPuttAnimResult('miss');
        // Slide away from hole
        Animated.parallel([
          Animated.timing(puttBallY, { toValue: 0.85, duration: 300, useNativeDriver: true }),
          Animated.timing(puttBallOpacity, { toValue: 0.4, duration: 400, useNativeDriver: true }),
        ]).start(() => {
          setTimeout(() => { setPuttAnimActive(false); puttBallOpacity.setValue(0); }, 1000);
        });
      }
    });
  };

  const startPuttTracking = () => {
    if (isPuttTracking) return;
    // Accelerometer not available on web
    if (Platform.OS === 'web') return;
    setIsPuttTracking(true);
    puttPhaseRef.current = 'ready';
    puttPeakTimeRef.current = 0;
    puttMaxXDeviationRef.current = 0;
    puttPeakRotRef.current = 0;
    setPuttMotionFeedback('Ready - make your stroke');
    setPuttPathFeedback('');
    setPuttStrokeDetected(false);
    Accelerometer.setUpdateInterval(50);
    puttAccelRef.current = Accelerometer.addListener(({ x, y }) => {
      const now = Date.now();
      const motion = Math.abs(y);
      if (motion > 0.15) {
        puttMaxXDeviationRef.current = Math.max(puttMaxXDeviationRef.current, Math.abs(x));
      }
      if (puttPhaseRef.current === 'ready' && motion > 0.32 && now - lastPuttTimeRef.current > 1800) {
        puttPhaseRef.current = 'backswing';
        puttPeakTimeRef.current = now;
        puttMaxXDeviationRef.current = 0;
        puttPeakRotRef.current = 0;
        setPuttMotionFeedback('Backstroke - follow through');
      } else if (puttPhaseRef.current === 'backswing' && motion > 0.32) {
        const delta = now - puttPeakTimeRef.current;
        if (delta > 80 && delta < 1600) {
          puttPhaseRef.current = 'ready';
          lastPuttTimeRef.current = now;
          const xDev = puttMaxXDeviationRef.current;
          const rotDev = puttPeakRotRef.current;
          const tempo = delta < 280 ? 'Too fast - slow your stroke' : delta <= 850 ? 'Smooth tempo' : 'Too slow - stay fluid';
          const pathQuality = xDev < 0.14 ? 'Straight path' : xDev < 0.28 ? 'Slight drift - stay on line' : 'Path deviation - check face at address';
          const faceQuality = rotDev < 0.8 ? 'Face stable' : rotDev < 1.8 ? 'Slight face rotation' : 'Face rotating - keep it square';
          setPuttMotionFeedback(tempo);
          setPuttPathFeedback(`${pathQuality} - ${faceQuality}`);
          setPuttStrokeDetected(true);
          safeSpeak(`${tempo}. ${pathQuality}.`);
          setTimeout(() => {
            setPuttStrokeDetected(false);
            setPuttMotionFeedback('Ready - make your stroke');
            setPuttPathFeedback('');
            puttPhaseRef.current = 'ready';
          }, 4500);
        }
      }
    });
    // Gyroscope tracks face rotation during stroke
    Gyroscope.setUpdateInterval(50);
    puttGyroRef.current = Gyroscope.addListener(({ z }) => {
      if (Math.abs(z) > Math.abs(puttPeakRotRef.current)) puttPeakRotRef.current = z;
    });
  };

  const stopPuttTracking = () => {
    setIsPuttTracking(false);
    puttAccelRef.current?.remove();
    puttAccelRef.current = null;
    puttGyroRef.current?.remove();
    puttGyroRef.current = null;
    setPuttMotionFeedback('Hold phone like a putter grip and stroke');
    setPuttPathFeedback('');
    setPuttStrokeDetected(false);
    puttPhaseRef.current = 'ready';
  };

  const logPutt = (made: boolean) => {
    // Lateral drift from last stroke (positive = right, negative = left)
    const xDrift = puttMaxXDeviationRef.current * (Math.random() > 0.5 ? 1 : -1);
    setPuttResults((prev) => [...prev, { distance: puttDistance, made }]);
    setPuttStreak((s) => (made ? s + 1 : 0));
    animatePutt(made, xDrift);
  };

  const getPuttingStats = (): Record<number, { made: number; total: number }> => {
    const grouped: Record<number, { made: number; total: number }> = {};
    puttResults.forEach((p) => {
      if (!grouped[p.distance]) grouped[p.distance] = { made: 0, total: 0 };
      grouped[p.distance].total++;
      if (p.made) grouped[p.distance].made++;
    });
    return grouped;
  };

  const getPuttingInsight = (): string => {
    const stats = getPuttingStats();
    const short = stats[6];
    const mid = stats[10];
    if (short && short.made / short.total < 0.5)
      return 'Focus on short putts - keep your stroke steady and confident.';
    if (mid && mid.made / mid.total < 0.4)
      return 'Work on distance control for mid-range putts.';
    return 'Putting is solid - keep building consistency.';
  };

  const drillTarget = 10;
  const streakTarget = 5;
  const tempoStreakTarget = 5;

  const drill = DRILLS.find((d) => d.id === selectedDrill) ?? DRILLS[0];
  const progress = Math.min(drillCount / drillTarget, 1);
  const successRate = drillCount > 0 ? Math.round((goodShots / drillCount) * 100) : 0;

  const getPracticeTarget = () => {
    if (difficulty === 1) return 'center';
    if (difficulty === 2) return 'left center';
    if (difficulty === 3) return 'right center';
    return 'left edge';
  };

  const getDrillRecommendation = (drillId: string): string => {
    // Prefer in-session singleton; fall back to persisted profile
    const miss = playerProfile.commonMiss ?? (ppMiss !== 'straight' ? ppMiss : null);
    const tempo = playerProfile.tempoConsistency;

    if (drillId === 'driver-straight') {
      if (miss === 'right') return 'Driver slice drill: Tee the ball lower and swing from the inside. Hit 10 drives starting left of your target.';
      if (miss === 'left') return 'Driver hook drill: Quiet your hands through impact. Focus on holding the face slightly open at the finish.';
      return 'Straightness drill: Pick a narrow fairway target and hit 10 drives. Count how many land inside your zone.';
    }
    if (drillId === 'alignment') {
      if (miss === 'right') return 'Right miss drill: Place an alignment rod outside the ball and swing from the inside - avoid clipping the rod.';
      if (miss === 'left') return 'Left miss drill: Set a rod down your target line. Focus on a smooth release without over-rotating the hands.';
      return 'Alignment drill: Set a rod at your target. Hit 10 shots and compare start line to target line.';
    }
    if (drillId === 'tempo') {
      if (tempo !== null && tempo < 60) return 'Tempo needs work: Hit 10 shots at 70% power. Count -1-and-swing - on each rep - smooth, not rushed.';
      if (tempo !== null && tempo >= 80) return 'Tempo is solid - try hitting 10 shots matching your best rhythm back-to-back.';
      return 'Rhythm drill: Hit 10 shots at 80% power. Focus on a smooth, consistent tempo throughout.';
    }
    if (drillId === 'short-game') {
      return 'Short game drill: Hit 10 chip shots from 20 yards. Focus on landing area, not distance. Check: are you missing left or right?';
    }

    // Generic fallback
    if (miss === 'right') return 'Right miss drill: Focus on an inside swing path. Place a headcover outside the ball and swing without hitting it.';
    if (miss === 'left') return 'Left miss drill: Hit 10 controlled shots aiming for the right side of your target. Quiet the hands through impact.';
    return 'Distance control drill: Hit 5 shots landing within a tight target zone. Repeat until consistent.';
  };

  const coachPhrases = ["Alright", "Here's the play", "Stay with me"];
  const coachTone = (message: string) => `${coachPhrases[Math.floor(Math.random() * coachPhrases.length)]} ${message}`;
  const addEncouragement = (message: string) => Math.random() > 0.5 ? message + " You're close - trust it." : message;

  // ─── Ball flight classifier ──────────────────────────────────
  // start × finish → shape name (9 combinations)
  const classifyFlight = (
    start: 'left' | 'straight' | 'right',
    finish: 'left' | 'straight' | 'right',
  ): string => {
    if (start === 'right'    && finish === 'right')    return 'Push';
    if (start === 'right'    && finish === 'left')     return 'Slice';
    if (start === 'right'    && finish === 'straight') return 'Push-Draw';
    if (start === 'left'     && finish === 'right')    return 'Draw';
    if (start === 'left'     && finish === 'left')     return 'Pull';
    if (start === 'left'     && finish === 'straight') return 'Pull-Fade';
    if (start === 'straight' && finish === 'right')    return 'Fade';
    if (start === 'straight' && finish === 'left')     return 'Hook';
    return 'Straight';
  };

  const logFocusShot = (result: 'good' | 'left' | 'right') => {
    // Active shot input — burst vision frames for immediate analysis
    vpSetBurstMode(true, 8000);
    // Detect ball start direction from any available vision frames
    // Uses mock VisionProcessor frames keyed on timestamp for now
    const mockFrames = [Date.now(), Date.now() + 1, Date.now() + 2];
    const trackResult = detectBallStart(mockFrames, {
      shotResult: result === 'good' ? 'straight' : result,
    });
    const ballStart = trackResult.startDirection;
    // Map 'good' result to 'straight' for comparison
    const resultDir = result === 'good' ? 'straight' : result;
    const startMismatch = ballStart !== resultDir;
    const flightType = classifyFlight(ballStart, resultDir);

    if (startMismatch) {
      setTimeout(() => {
        safeSpeak(`Start line was ${ballStart} but ball finished ${resultDir}. That\'s curve spin. Check your face angle.`);
      }, 700);
    }

    setFocusShots((prev) => {
      const updated = [...prev, { result, timestamp: Date.now(), ballStart, startMismatch, flightType }];
      const total = updated.length;
      const last2 = updated.slice(-2);
      const last3 = updated.slice(-3);
      const goodStreak = last2.length === 2 && last2.every((s) => s.result === 'good');
      const rightStreak = last2.length === 2 && last2.every((s) => s.result === 'right');
      const leftStreak  = last2.length === 2 && last2.every((s) => s.result === 'left');
      const goods3 = last3.filter((s) => s.result === 'good').length;

      // Streak voice - fires each time a streak is detected
      if (goodStreak) {
        setTimeout(() => { safeSpeak("That's two good swings. Keep it going."); }, 500);
        aiFocusVoiceRef.current = total;
      } else if (rightStreak) {
        setTimeout(() => { safeSpeak('Still missing right. Adjust more left.'); }, 500);
        aiFocusVoiceRef.current = total;
      } else if (leftStreak) {
        setTimeout(() => { safeSpeak('Two left in a row. Hold the face open.'); }, 500);
        aiFocusVoiceRef.current = total;
      } else if (total - aiFocusVoiceRef.current >= 4) {
        // Periodic cue every 4 shots when no streak
        aiFocusVoiceRef.current = total;
        const cue = goods3 >= 2 ? "Good. That's the feel." : 'Reset. Smooth swing.';
        setTimeout(() => { safeSpeak(cue); }, 600);
      }

      // Completion moment
      const drillTarget = practiceLevel === 'easy' ? 12 : 10;
      if (total === drillTarget) {
        setTimeout(() => { safeSpeak('Good work. Take that to the course.'); }, 800);
      }

      return updated;
    });

    // Pressure mode streak tracking (outside setFocusShots to avoid stale closure)
    if (pressureMode) {
      if (result === 'good') {
        setPressureStreak((s) => s + 1);
      } else {
        setPressureStreak(0);
        setTimeout(() => { safeSpeak('Start again. Stay composed.'); }, 400);
      }
    }
  };

  const getAdaptiveGoal = (): number => {
    if (weeklyHistory.length === 0) return 80;
    const latest = weeklyHistory[0].tempo;
    if (latest >= 85) return 90;
    if (latest >= 75) return 85;
    if (latest >= 65) return 80;
    if (latest >= 50) return 70;
    return 60;
  };
  const tempoGoal = getAdaptiveGoal();

  const getPracticePlan = (): string => {
    // If a full persisted profile exists, generate a rich plan from it
    if (ppComplete && (ppMiss || ppStruggle || ppStrength)) {
      return coachTone(buildInitialPracticePlan(ppMiss, ppStruggle, ppStrength, ppLim) || 'warm up with some half-swings, then build into full reps.');
    }
    const miss = playerProfile.commonMiss ?? (ppMiss !== 'straight' ? ppMiss : null);
    if (!miss) return coachTone('play a round to unlock your personalized practice plan.');
    const drill = miss === 'right' ? 'driver-straight' : 'alignment';
    return coachTone(`focus on your ${miss} miss today. ${getDrillRecommendation(drill)}`);
  };

  const getPracticeFeedback = () => {
    if (drillCount < 3) return coachTone('get a few reps in first.');
    const activeMiss = playerProfile.commonMiss ?? (ppMiss !== 'straight' ? ppMiss : null);
    if (activeMiss === 'right') {
      if (successRate >= 80) return addEncouragement(coachTone("slice tendency noted - you're handling it well. Keep the inside-out path."));
      if (successRate >= 50) return coachTone('focus on drills that correct your right miss - swing from the inside.');
      return addEncouragement(coachTone('your right miss is showing here. Slow down and feel the face staying square.'));
    }
    if (activeMiss === 'left') {
      if (successRate >= 80) return addEncouragement(coachTone('hook tendency noted - great control. Smooth release is working.'));
      if (successRate >= 50) return coachTone('focus on drills that correct your left miss - quiet the hands.');
      return addEncouragement(coachTone('your left miss is showing here. Soften the grip and slow the hand rotation.'));
    }
    if (successRate >= 80) return addEncouragement(coachTone("you're dialed in - increase difficulty or tighten your target."));
    if (successRate >= 60) return coachTone('solid work - keep building consistency.');
    if (successRate >= 40) return addEncouragement(coachTone("you're close - focus on clean contact and tempo."));
    return coachTone('reset and slow it down - focus on fundamentals.');
  };

  const getFeedbackColor = () => {
    if (drillCount < 3) return '#333';
    if (successRate >= 80) return '#2e7d32';
    if (successRate >= 60) return '#f9a825';
    return '#c62828';
  };

  const updateStreak = () => {
    const today = new Date().toDateString();
    if (!lastPracticeDate) {
      setLastPracticeDate(today);
      return;
    }
    const diffDays = (new Date(today).getTime() - new Date(lastPracticeDate).getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays === 1) setStreak((prev) => prev + 1);
    else if (diffDays > 1) setStreak(1);
    setLastPracticeDate(today);
  };

  const getSwingInsight = (best: { tempo: string } | null, latest: { tempo: string } | null): string => {
    if (!best || !latest) return '';
    if (best.tempo === latest.tempo) return addEncouragement(coachTone('consistent swing - keep it up.'));
    if (best.tempo.includes('Good') && !latest.tempo.includes('Good')) return coachTone('this swing was less smooth than your best - focus on tempo.');
    if (!best.tempo.includes('Good') && latest.tempo.includes('Good')) return addEncouragement(coachTone('nice improvement - that tempo was much better.'));
    if (latest.tempo.includes('fast')) return coachTone("you're rushing - slow down your transition.");
    if (latest.tempo.includes('slow')) return coachTone('tempo is a bit slow - stay smooth.');
    return coachTone('keep working on consistency.');
  };

  const startRecording = async () => {
    if (!cameraRef.current || recording) return;
    setRecording(true);
    setVideoUri(null);
    setPracticeAnalysis(null);
    setShowPracticeAnalysis(false);
    // Start IMU capture
    recPeakGRef.current    = 0;
    recPeakXRef.current    = 0;
    recPeakZRef.current    = 0;
    recPeakRotYRef.current = 0;
    recPeakRotZRef.current = 0;
    recStartRef.current    = Date.now();
    Accelerometer.setUpdateInterval(50);
    recAccelRef.current = Accelerometer.addListener(({ x, y, z }) => {
      const g = Math.sqrt(x * x + y * y + z * z);
      if (g > recPeakGRef.current) recPeakGRef.current = g;
      if (Math.abs(x) > Math.abs(recPeakXRef.current)) recPeakXRef.current = x;
      if (Math.abs(z) > Math.abs(recPeakZRef.current)) recPeakZRef.current = z;
    });
    Gyroscope.setUpdateInterval(50);
    recGyroRef.current = Gyroscope.addListener(({ y, z }) => {
      if (Math.abs(y) > Math.abs(recPeakRotYRef.current)) recPeakRotYRef.current = y;
      if (Math.abs(z) > Math.abs(recPeakRotZRef.current)) recPeakRotZRef.current = z;
    });
    const video = await cameraRef.current.recordAsync();
    // Stop sensors
    recAccelRef.current?.remove(); recAccelRef.current = null;
    recGyroRef.current?.remove();  recGyroRef.current  = null;
    recDurRef.current = Date.now() - recStartRef.current;
    if (video) {
      setVideoUri(video.uri);
      setSwingLibrary((prev) => [{ uri: video.uri, tempo: 'Manual', time: new Date().toLocaleTimeString() }, ...prev]);
    }
    setRecording(false);
  };

  const stopRecording = () => {
    if (cameraRef.current) cameraRef.current.stopRecording();
  };

  const getIndoorSummary = () => {
    if (indoorReps < 3) return 'Complete a few swings to see your session summary.';
    const tempoTotal = tempoGood + tempoMiss;
    const tempoScore = tempoTotal > 0 ? Math.round((tempoGood / tempoTotal) * 100) : 0;
    let summary = `Swings: ${indoorReps}. Tempo: ${tempoScore}%. Best streak: ${bestTempoStreak}.`;
    if (tempoScore >= 80) summary += ' Excellent tempo \u2014 very repeatable.';
    else if (tempoScore >= 60) summary += ' Good rhythm \u2014 keep refining.';
    else summary += ' Focus on slowing down your transition.';
    return summary;
  };

  const getTempoFeedback = () => {
    const tempoTotal = tempoGood + tempoMiss;
    if (tempoTotal < 3) return 'Build your rhythm.';
    const score = Math.round((tempoGood / tempoTotal) * 100);
    if (score >= 80) return 'Great tempo - very repeatable swing.';
    if (score >= 60) return 'Good rhythm - keep smoothing it out.';
    return 'Focus on slowing down your transition.';
  };

  const startTempo = () => {
    if (isTempoRunning) return;
    setIsTempoRunning(true);
    setTempoText('1');
    setTimeout(() => {
      setTempoText('2');
      setTimeout(() => {
        setTempoText('SWING');
        setTimeout(() => {
          setTempoText('Ready');
          setIsTempoRunning(false);
        }, 600);
      }, 600);
    }, 600);
  };

  const getDifficultyFeedback = () => {
    if (drillCount < 3) return '';
    if (successRate >= 80) return "You're ready for a tougher challenge.";
    if (successRate <= 40) return "Let's simplify and build consistency.";
    return "You're in a good training zone.";
  };

  const saveSession = () => {
    const tempoTotal = tempoGood + tempoMiss;
    const tempo = tempoTotal > 0 ? Math.round((tempoGood / tempoTotal) * 100) : 0;
    setWeeklyHistory((prev) => [{ tempo, date: new Date().toDateString() }, ...prev]);
  };

  // -- Zone scoring ---------------------------------------------------------
  const logZoneHit = (zone: 'bull' | 'inner' | 'outer' | 'miss') => {
    setLastHitZone(zone);
    const base = ZONE_POINTS[zone];
    const newCombo = zone !== 'miss' ? comboStreak + 1 : 0;
    const mult = newCombo >= 5 ? 3 : newCombo >= 3 ? 2 : 1;
    setComboStreak(newCombo);
    setComboMult(mult);
    setSessionPoints((p) => p + base * mult);
    // Map position - scatter by zone
    const px =
      zone === 'bull'  ? 0.47 + (Math.random() - 0.5) * 0.06
    : zone === 'inner' ? 0.35 + Math.random() * 0.30
    : zone === 'outer' ? 0.15 + Math.random() * 0.70
    : Math.random() > 0.5 ? 0.04 + Math.random() * 0.18 : 0.78 + Math.random() * 0.18;
    const py =
      zone === 'miss'  ? (Math.random() > 0.5 ? 0.04 + Math.random() * 0.14 : 0.80 + Math.random() * 0.16)
    : 0.18 + Math.random() * 0.62;
    shotIdRef.current += 1;
    setShotMapLog((prev) => [...prev, { x: px, y: py, zone, id: shotIdRef.current }]);
    if (zone !== 'miss') {
      setGoodShots((g) => g + 1);
      const nc = currentStreak + 1;
      setBestStreak((bs) => Math.max(bs, nc));
      setCurrentStreak(nc);
      if (nc >= streakTarget) { setDifficulty((d) => d + 1); setCurrentStreak(0); }
    } else {
      setMissShots((m) => m + 1);
      if (shotIdRef.current % 2 === 0) {
        setMissRight((r) => r + 1);
      } else {
        setMissLeft((l) => l + 1);
      }
      setCurrentStreak(0);
      if (difficulty > 1 && successRate < 40) setDifficulty((d) => Math.max(1, d - 1));
    }
    setDrillCount((c) => c + 1);
  };

  /**
   * Build a "What / Why / Fix" coaching breakdown from available session data.
   * Returns null when there is insufficient data to produce a meaningful tip.
   */
  const buildCoachMode = (
    bias:   'left' | 'right' | 'neutral',
    face:   string,
    path:   string,
    tempo:  string,
  ): { what: string; why: string; fix: string } | null => {
    // ── Right-miss scenarios ───────────────────────────────────────────────
    if (bias === 'right' && face === 'open' && path === 'out-to-in')
      return { what: 'Shots missing right', why: 'Open face + outside-in path (classic slice)', fix: 'Strengthen grip and feel the club drop inside on the downswing' };
    if (bias === 'right' && face === 'open')
      return { what: 'Shots missing right', why: 'Open clubface at impact', fix: 'Strengthen grip slightly — rotate left hand more on top of the handle' };
    if (bias === 'right' && path === 'out-to-in')
      return { what: 'Shots starting right then curving further right', why: 'Out-to-in swing path', fix: 'Feel the club drop into the slot — swing from 4 o\'clock down to 10 o\'clock' };
    if (bias === 'right' && path === 'in-to-out')
      return { what: 'Shots pushing right', why: 'In-to-out path with a square or closed face', fix: 'Quiet the release — let the face hold slightly open through impact' };
    // ── Left-miss scenarios ────────────────────────────────────────────────
    if (bias === 'left' && face === 'closed' && path === 'in-to-out')
      return { what: 'Shots missing left', why: 'Closed face + in-to-out path (hook)', fix: 'Weaken grip slightly and hold the finish higher to keep the face from rolling over' };
    if (bias === 'left' && face === 'closed')
      return { what: 'Shots missing left', why: 'Closed clubface at impact', fix: 'Weaken grip slightly — rotate right hand more on top of the grip' };
    if (bias === 'left' && path === 'in-to-out')
      return { what: 'Shots pulling left', why: 'In-to-out swing path', fix: 'Stay behind the ball — let the body lead and prevent the hands from flipping early' };
    // ── Tempo issues (regardless of bias) ─────────────────────────────────
    if (tempo === 'fast' && bias === 'right')
      return { what: 'Rushed swing causing right miss', why: 'Fast tempo collapses the swing arc — face flips open', fix: 'Pause at the top for one beat before starting down' };
    if (tempo === 'fast' && bias === 'left')
      return { what: 'Rushed swing causing left miss', why: 'Fast tempo fires the hands too early', fix: 'Hold lag into the impact zone — feel the arms lead before the hands release' };
    if (tempo === 'fast')
      return { what: 'Swing tempo too fast', why: 'Rushing the transition reduces control', fix: 'Count "one back, pause, two through" on every swing' };
    if (tempo === 'slow')
      return { what: 'Swing tempo too slow', why: 'Passive tempo reduces power and path consistency', fix: 'Stay committed — start with a smooth but committed takeaway and keep it flowing' };
    // ── Neutral / all good ─────────────────────────────────────────────────
    if (bias === 'neutral' && face === 'square' && path === 'neutral' && tempo === 'smooth')
      return { what: 'Swing is balanced', why: 'Face, path and tempo are all within range', fix: 'Maintain what you are doing — small, repeatable swings build lasting consistency' };
    // ── Mismatch fallback ──────────────────────────────────────────────────
    if (bias === 'right' || bias === 'left')
      return { what: `Shots trending ${bias}`, why: 'Pattern detected but cause is unclear from this swing', fix: 'Record another swing after focusing on one key feeling — grip, path or tempo' };
    return null;
  };

  const getClusterInsight = (): string => {
    if (shotMapLog.length < 4) return 'Log a few more shots to reveal your miss pattern.';
    const misses = shotMapLog.filter((s) => s.zone === 'miss' || s.zone === 'outer');
    if (misses.length === 0) return "You're finding the target zone consistently \u2014 great accuracy.";
    const avgX = misses.reduce((s, m) => s + m.x, 0) / misses.length;
    const avgY = misses.reduce((s, m) => s + m.y, 0) / misses.length;
    const xLabel = avgX < 0.38 ? 'left' : avgX > 0.62 ? 'right' : null;
    const yLabel = avgY < 0.35 ? 'short' : avgY > 0.65 ? 'long' : null;
    if (xLabel && yLabel) return `You're missing ${yLabel} ${xLabel} most often \u2014 ${yLabel === 'short' ? 'check follow-through and club selection' : 'dial back swing speed and check weight transfer'}.`;
    if (xLabel) return `You're missing ${xLabel} most often \u2014 check alignment and swing path.`;
    if (yLabel) return `You're missing ${yLabel} most often \u2014 work on distance control and tempo.`;
    return 'Misses are well spread \u2014 solid overall pattern.';
  };

  const getWeeklyTrend = () => {
    if (weeklyHistory.length < 2) return null;
    return weeklyHistory[0].tempo - weeklyHistory[1].tempo;
  };

  const getYesterdaySession = () => weeklyHistory.length >= 2 ? weeklyHistory[1] : null;

  const getDayComparison = () => {
    const yesterday = getYesterdaySession();
    if (!yesterday) return null;
    const tempoTotal = tempoGood + tempoMiss;
    const current = tempoTotal > 0 ? Math.round((tempoGood / tempoTotal) * 100) : 0;
    return current - yesterday.tempo;
  };

  const getMemoryInsight = (delta: number | null) => {
    if (delta === null) return '';
    if (delta > 10) return coachTone('big improvement from yesterday - great work.');
    if (delta > 0) return coachTone("you're trending better than yesterday.");
    if (delta < 0) return coachTone('slight drop from yesterday - focus on tempo.');
    return coachTone('holding steady from yesterday.');
  };

  const resetPracticeCounters = useCallback(() => {
    setDrillCount(0);
    setGoodShots(0);
    setMissShots(0);
    setMissLeft(0);
    setMissRight(0);
    setCurrentStreak(0);
    setBestStreak(0);
    setDifficulty(1);
  }, []);

  /**
   * Flush current session stats into CaddieMemory, then clear counters.
   * Skips the update if no shots were logged this session.
   */
  const handleEndPracticeSession = useCallback(async () => {
    // Extract frames from the recorded video and derive swing characteristics
    if (videoUri) {
      try {
        const frames = await extractFrames(videoUri);
        const analysis = analyzeSwing(frames);
        setSwingAnalysis(analysis);
      } catch (_) {}
    }

    if (drillCount > 0) {
      // Build shotShapeData from AI Focus session shots (ballStart + finish direction)
      const shotShapeData = focusShots
        .filter((s) => s.ballStart !== undefined)
        .map((s) => ({
          ballStart: (s.ballStart === 'straight' ? 'neutral' : s.ballStart) as 'left' | 'right' | 'neutral',
          finish:    s.result === 'good' ? 'straight' : s.result as 'left' | 'right' | 'straight',
        }));

      updateMemoryFromSession({
        totalShots:    drillCount,
        leftCount:     missLeft,
        rightCount:    missRight,
        straightCount: goodShots,
        fatCount:      0,   // practice.tsx does not capture contact type
        thinCount:     0,
        cleanCount:    goodShots,
        shotShapeData: shotShapeData.length > 0 ? shotShapeData : undefined,
      });

      // ── Persist session + run trend analysis ──────────────────────────
      const dominantShape = shotShapeData.length > 0
        ? (() => {
            const counts: Record<string, number> = {};
            shotShapeData.forEach(({ ballStart, finish }) => {
              const shape =
                ballStart === 'right' && finish === 'right'     ? 'push'
                : ballStart === 'right' && finish === 'left'    ? 'slice'
                : ballStart === 'right' && finish === 'straight'? 'fade'
                : ballStart === 'left'  && finish === 'right'   ? 'draw'
                : ballStart === 'left'  && finish === 'left'    ? 'pull'
                : ballStart === 'left'  && finish === 'straight'? 'hook'
                : ballStart === 'neutral' && finish === 'right' ? 'fade'
                : ballStart === 'neutral' && finish === 'left'  ? 'draw'
                : 'straight';
              counts[shape] = (counts[shape] ?? 0) + 1;
            });
            return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'straight';
          })()
        : 'straight';

      try {
        await saveSessionHistory({
          totalShots:    drillCount,
          goodShots,
          missLeft,
          missRight,
          shotShapeData: shotShapeData.length > 0 ? shotShapeData : undefined,
          missBias:      missRight > missLeft ? 'right' : missLeft > missRight ? 'left' : 'neutral',
          shapeTrend:    dominantShape,
        });

        // Re-analyse last 5 sessions and push long-term bias to CaddieMemory
        const history  = await getHistory();
        const trends   = analyzeTrends(history);
        updateLongTermBias(trends.longTermMissBias, trends.confidenceScore);
      } catch (_) { /* non-critical — session still ends cleanly */ }
    }
    setDrillCount(0);
    setGoodShots(0);
    setMissShots(0);
    setMissLeft(0);
    setMissRight(0);
    setCurrentStreak(0);
    setBestStreak(0);
    setDifficulty(1);
    setComboStreak(0);
    setComboMult(1);
    setLastHitZone(null);
    setShotMapLog([]);
    setSessionPoints(0);
  }, [drillCount, focusShots, goodShots, missLeft, missRight, updateMemoryFromSession, videoUri]);

  const handleSelectDrill = useCallback((drillId: string) => {
    setSelectedDrill(drillId);
    resetPracticeCounters();
    if (drillId === 'putting') setPracticeMode('putting');
    else if (drillId === 'short-game') setPracticeMode('chipping');
    else setPracticeMode('free');
  }, [resetPracticeCounters]);

  const handleOpenProfile = useCallback(() => {
    setShowToolsMenu(false);
    router.push('/profile-setup');
  }, [router]);

  /**
   * Share a recorded swing video using the native share sheet.
   * Falls back to saving to the camera roll when sharing is unavailable.
   */
  const handleShareSwing = useCallback(async (uri: string) => {
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType:  'video/mp4',
          dialogTitle: 'Share Swing Video',
          UTI: 'com.apple.quicktime-movie',
        });
      } else {
        // Fallback: save to camera roll
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          await MediaLibrary.saveToLibraryAsync(uri);
          safeSpeak('Swing saved to your camera roll.');
        }
      }
    } catch {
      // share cancelled or failed — no UI feedback needed
    }
  }, []);

  /**
   * Save a swing video to the device camera roll.
   */
  const handleSaveSwingToLibrary = useCallback(async (uri: string) => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') return;
      await MediaLibrary.saveToLibraryAsync(uri);
      safeSpeak('Saved to camera roll.');
    } catch {}
  }, []);

  const handleLogout = useCallback(async () => {
    setShowToolsMenu(false);
    try {
      await signOut(auth);
    } catch {}
    setIsGuest(false);
    router.replace('/auth');
  }, [router, setIsGuest]);

  // ── Live voice caddie (same system as play screen) ────────────────────────
  const { startMaxWindow, cancelSilence } = useVoiceCaddie();
  const [listening, setListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [pulse, setPulse] = useState(1);
  const [listeningPhase, setListeningPhase] = useState<'listening' | 'processing'>('listening');
  const [caddieResponse, setCaddieResponse] = useState('');
  const pulseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSpeakingRef = useRef(false);

  // Speak with pulse animation + isSpeaking state
  const speakWithOverlay = async (text: string) => {
    if (!text.trim() || quietModeRef.current) return;
    if (isSpeakingRef.current) return;
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    let growing = true;
    const si = setInterval(() => {
      setPulse((prev) => {
        if (prev >= 1.25) growing = false;
        if (prev <= 1.0) growing = true;
        return growing ? prev + 0.02 : prev - 0.02;
      });
    }, 60);
    try {
      await speak(text, voiceGender);
    } finally {
      clearInterval(si);
      setPulse(1);
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    }
  };

  const practiceVoiceCommand = async (transcript: string) => {
    const lower = transcript.toLowerCase();
    setIsThinking(true);
    setCaddieResponse('');

    const reply = (msg: string) => {
      setIsThinking(false);
      setCaddieResponse(msg);
    };

    // Tempo / rhythm
    if (lower.includes('tempo') || lower.includes('rhythm') || lower.includes('timing')) {
      const msg = 'Smooth tempo: count one back, pause, two through. Never rush the transition.';
      reply(msg); void speakWithOverlay(msg); return;
    }
    // Mental
    if (lower.includes('mental') || lower.includes('focus') || lower.includes('nervous') || lower.includes('pressure')) {
      const msg = 'Pick one target, commit fully. One shot, one thought.';
      reply(msg); void speakWithOverlay(msg); return;
    }
    // Club help
    if (lower.includes('what club') || lower.includes('which club') || lower.includes('club for')) {
      const msg = 'Take one more club than you think. Most amateurs miss short.';
      reply(msg); void speakWithOverlay(msg); return;
    }
    // Slice / hook fix
    if (lower.includes('slice') || lower.includes('right miss') || lower.includes('push') || lower.includes('fade')) {
      const msg = 'Drop your right elbow into your side on the downswing and swing out toward right field through impact.';
      reply(msg); void speakWithOverlay(msg); return;
    }
    if (lower.includes('hook') || lower.includes('pull') || lower.includes('left miss')) {
      const msg = 'Hold the face slightly open through impact. Feel your left arm stay connected to your chest.';
      reply(msg); void speakWithOverlay(msg); return;
    }
    // Putting / chipping
    if (lower.includes('putt') || lower.includes('chip') || lower.includes('short game') || lower.includes('green')) {
      const msg = 'Pace over line. Land the chip on the fringe and let it roll. Commit to your spot.';
      reply(msg); void speakWithOverlay(msg); return;
    }
    // Rules
    if (lower.includes('rule') || lower.includes('penalty') || lower.includes('relief')) {
      const msg = 'Know your relief options before your round. When in doubt, play two balls and ask the committee.';
      reply(msg); void speakWithOverlay(msg); return;
    }
    // Generic fallback
    const fallback = 'Pick your target. Trust your swing. One shot at a time.';
    reply(fallback); void speakWithOverlay(fallback);
  };

  const processPracticeListeningResult = (text?: string) => {
    cancelSilence();
    if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
    setListeningPhase('processing');
    setTimeout(() => {
      setListening(false);
      setPulse(1);
      if (text && text.trim()) {
        void practiceVoiceCommand(text.trim());
      } else {
        const fallback = 'Pick your target. Trust your swing. One shot at a time.';
        setIsThinking(false);
        setCaddieResponse(fallback);
        void speakWithOverlay(fallback);
      }
    }, 600);
  };

  const startPracticeListening = () => {
    if (listening) return;
    void stopSpeaking();
    setListeningPhase('listening');
    setListening(true);
    setPulse(1);
    let growing = true;
    pulseIntervalRef.current = setInterval(() => {
      setPulse((prev) => {
        if (prev >= 1.35) growing = false;
        if (prev <= 1.0) growing = true;
        return growing ? prev + 0.025 : prev - 0.025;
      });
    }, 50);
    startMaxWindow(() => processPracticeListeningResult());
  };

  const stopPracticeListening = () => {
    cancelSilence();
    if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
    setListening(false);
    setPulse(1);
  };

  const handlePracticeListeningToggle = () => {
    if (listening) {
      stopPracticeListening();
      void speakWithOverlay('Quiet.');
    } else {
      startPracticeListening();
      void speak('Listening.', voiceGender);
    }
  };

  // ── Ask Caddie AI Q&A ─────────────────────────────────────────────────────
  const [showAskCaddie, setShowAskCaddie] = useState(false);
  const [askText, setAskText] = useState('');
  const [askAnswer, setAskAnswer] = useState('');
  const [askLoading, setAskLoading] = useState(false);

  /** Local golf knowledge engine — answers without needing an API key */
  const localCaddieAnswer = (q: string): string => {
    const lq = q.toLowerCase();
    // Club selection
    if (/what club|which club|club for|club selection|7 iron|8 iron|9 iron|driver|wedge/.test(lq))
      return 'Club selection depends on your carry distance, wind, and lie. Play one more club than you think — most amateurs come up short. From the fairway, use your average carry, not your best.';
    // Distance
    if (/how far|distance|yardage|carry|120|150|180/.test(lq))
      return 'For distance, commit to one solid swing at 80% power. Tension kills distance. Take enough club, make a smooth turn, and let the club do the work.';
    // Slice / hook fix
    if (/slice|right miss|fading|push/.test(lq))
      return 'A slice comes from an outside-in swing path with an open face. Key fix: feel your right elbow drop into your side on the downswing, and swing out toward right field through impact.';
    if (/hook|left miss|draw|pull/.test(lq))
      return 'A hook is an over-rotation of the forearms. Keep your grip pressure light, hold the face slightly open through impact, and feel your left arm staying connected to your chest.';
    // Putting
    if (/putt|putting|green|hole|short game|chip|chipping/.test(lq))
      return 'On the greens, aim for pace over line — most 3-putts come from distance control, not alignment. For chips, land the ball on the fringe and let it roll. Commit to a spot, not the hole.';
    // Mental game
    if (/nervous|mental|pressure|focus|routine|stress|choke|yips/.test(lq))
      return 'Mental game starts before the swing. Pick one specific target — not the fairway, not the green, but a precise spot. Then take 2 slow breaths, and commit fully. One shot, one target, one swing.';
    // Tempo
    if (/tempo|rhythm|timing|slow down|too fast|rushing/.test(lq))
      return 'Great tempo starts at the top. Feel a 1-second pause at the peak of your backswing before you fire. Count "one" on the way back and "two" through impact. Most rushed swings happen in the transition.';
    // Wind
    if (/wind|windy|into the wind|downwind|crosswind/.test(lq))
      return 'Into the wind: take 1-2 extra clubs and swing at 75% — a harder swing creates more spin and balloons the ball. Crosswind: aim into it and trust the push. Downwind: full swing, one less club.';
    // Bunker / sand
    if (/bunker|sand|trap|splash/.test(lq))
      return 'From a greenside bunker: open your stance, open the clubface, and splash the sand 2 inches behind the ball. Swing the full finish — your swing through is more important than the takeaway.';
    // Warm up
    if (/warm up|warmup|stretch|before round/.test(lq))
      return 'Best warm-up: start with half-wedge shots to feel tempo, then work up through your irons to driver. Spend 10 minutes on putts — 3 footers first to build confidence. No full swings on your first shot of the day.';
    // Strategy
    if (/strategy|course management|where to aim|layup|miss short|miss long/.test(lq))
      return 'Smart course management: always miss on the side with the most room. On par 4s with trouble right, aim left-center every time. Know your shot patterns — play to your misses, not against them.';
    // Grip / setup
    if (/grip|stance|setup|alignment|ball position|posture|address/.test(lq))
      return 'Setup fundamentals: feet shoulder-width for irons, slightly wider for driver. Ball position moves forward as loft decreases. Grip pressure should be a 4 out of 10 — light, controlled, and consistent.';
    // Default intelligent reply
    return `Great question. Here's my read: focus on the fundamentals for this shot — club selection, a clear target, and a committed swing. Keep your routine consistent and trust what you've built in practice. You've got this.`;
  };

  const askCaddie = async () => {
    const q = askText.trim();
    if (!q) return;
    setAskLoading(true);
    setAskAnswer('');
    try {
      // Try OpenAI if a public key is configured
      const apiKey = (process.env as any).EXPO_PUBLIC_OPENAI_API_KEY;
      let answer: string | null = null;
      if (apiKey && apiKey !== 'sk-your-key-here' && apiKey.length > 20) {
        try {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              max_tokens: 200,
              messages: [
                { role: 'system', content: 'You are an expert golf caddie AI. Give direct, specific, practical advice in 2-3 sentences. No filler. Address the exact question asked.' },
                { role: 'user', content: q },
              ],
            }),
          });
          if (res.ok) {
            const json = await res.json();
            answer = (json.choices?.[0]?.message?.content as string) ?? null;
          }
        } catch (_) { answer = null; }
      }
      // Fall back to local knowledge engine
      if (!answer) answer = localCaddieAnswer(q);
      setAskAnswer(answer);
      if (!quietMode) safeSpeak(answer);
    } finally {
      setAskLoading(false);
    }
  };

  return (
    <>
    <PracticeTutorialOverlay visible={showTutorial} onDismiss={handleDismissTutorial} />

    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, marginBottom: 8, paddingHorizontal: 4 }}>
        {/* Logo mic — unified caddie mic button */}
        <CaddieMicButton size={56} showLabel={true} />
        <Text style={[styles.heading, { flex: 1, marginLeft: 10, fontSize: 18 }]}>Practice</Text>
        {/* Score HUD */}
        <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
          <Text style={{ color: '#FFE600', fontSize: 17, fontWeight: '800', lineHeight: 20 }}>{sessionPoints} pts</Text>
          {comboMult > 1 && <Text style={{ color: '#f9a825', fontSize: 10, fontWeight: '700' }}>{comboMult}x COMBO</Text>}
        </View>
        <Pressable
          onPress={() => setShowToolsMenu((v) => !v)}
          style={{ backgroundColor: showToolsMenu ? '#143d22' : '#1a1a1a', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: showToolsMenu ? '#4caf50' : '#333' }}
        >
          <Text style={{ fontSize: 18 }}>⚙️</Text>
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
            onPress={() => { setShowToolsMenu(false); setShowTutorial(true); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#0d2318', borderWidth: 1, borderColor: '#4ade80' }}
          >
            <Text style={{ fontSize: 18 }}>🏌️</Text>
            <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '600' }}>How to Setup</Text>
          </Pressable>
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
            <Text style={{ fontSize: 18 }}>{quietMode ? '🔇' : '🔊'}</Text>
            <Text style={{ color: quietMode ? '#A7F3D0' : '#aaa', fontSize: 13, fontWeight: '600' }}>{quietMode ? 'Voice Off' : 'Voice On'}</Text>
          </Pressable>
          {/* Low Power Mode toggle */}
          <Pressable
            onPress={() => { toggleLowPowerMode(!lowPowerMode); setShowToolsMenu(false); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: lowPowerMode ? '#1a2a0e' : '#1a1a1a', borderWidth: 1, borderColor: lowPowerMode ? '#84cc16' : '#2a2a2a' }}
          >
            <Text style={{ fontSize: 18 }}>🔋</Text>
            <Text style={{ color: lowPowerMode ? '#bef264' : '#aaa', fontSize: 13, fontWeight: '600' }}>Low Power {lowPowerMode ? 'On' : 'Off'}</Text>
          </Pressable>
          {/* Voice gender — explicit Male / Female toggle */}
          <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 4 }}>
            <Pressable
              onPress={() => { setVoiceGender('male'); setGlobalGender('male'); }}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                paddingVertical: 8, borderRadius: 10,
                backgroundColor: voiceGender === 'male' ? '#1a2e4a' : '#111',
                borderWidth: 1, borderColor: voiceGender === 'male' ? '#60a5fa' : '#2a2a2a' }}
            >
              <Text style={{ fontSize: 14 }}>👨</Text>
              <Text style={{ color: voiceGender === 'male' ? '#93c5fd' : '#555', fontSize: 12, fontWeight: '700' }}>Male</Text>
            </Pressable>
            <Pressable
              onPress={() => { setVoiceGender('female'); setGlobalGender('female'); }}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                paddingVertical: 8, borderRadius: 10,
                backgroundColor: voiceGender === 'female' ? '#2d1b69' : '#111',
                borderWidth: 1, borderColor: voiceGender === 'female' ? '#a78bfa' : '#2a2a2a' }}
            >
              <Text style={{ fontSize: 14 }}>👩</Text>
              <Text style={{ color: voiceGender === 'female' ? '#c4b5fd' : '#555', fontSize: 12, fontWeight: '700' }}>Female</Text>
            </Pressable>
          </View>
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


      {/* Low Power Mode banner */}
      {lowPowerMode && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: '#1a2a0e', borderRadius: 10, paddingVertical: 8,
          paddingHorizontal: 14, marginBottom: 10, marginHorizontal: 0,
          borderWidth: 1, borderColor: '#84cc16',
        }}>
          <Text style={{ fontSize: 16 }}>🔋</Text>
          <Text style={{ color: '#bef264', fontSize: 12, fontWeight: '700', flex: 1 }}>Battery-saving mode active</Text>
          <Pressable onPress={() => toggleLowPowerMode(false)}>
            <Text style={{ color: '#6b7280', fontSize: 11 }}>Turn off</Text>
          </Pressable>
        </View>
      )}

      {/* AI Today's Focus */}
      {(() => {
        const miss = ppMiss !== 'straight' ? ppMiss : 'neutral';
        const variants = generatePracticeFocusSet(miss as 'right' | 'left' | 'neutral', ppStruggle);
        // Stabilise variants reference for current session
        if (drillVariantsRef.current.length === 0) drillVariantsRef.current = variants;
        const safeIdx = drillVariantIdx % drillVariantsRef.current.length;
        const plan = drillVariantsRef.current[safeIdx];
        const total = focusShots.length;
        const rights = focusShots.filter((s) => s.result === 'right').length;
        const lefts  = focusShots.filter((s) => s.result === 'left').length;
        const goods  = focusShots.filter((s) => s.result === 'good').length;
        const last2 = focusShots.slice(-2);
        const goodStreak2 = last2.length === 2 && last2.every((s) => s.result === 'good');
        const missStreak2R = last2.length === 2 && last2.every((s) => s.result === 'right');
        const missStreak2L = last2.length === 2 && last2.every((s) => s.result === 'left');
        const drillTarget = practiceLevel === 'easy' ? 12 : 10;
        const done = total >= drillTarget;

        let feedback: string | null = null;
        if (done) {
          feedback = goods >= Math.ceil(total * 0.6) ? 'You\'re improving. Stay with it.' : 'Adjust more. Trust the change.';
        } else if (total >= 5) {
          if (rights >= Math.ceil(total * 0.5)) feedback = practiceLevel === 'focused' ? 'Still missing right - you need a bigger path correction.' : 'Still missing right. Adjust more left.';
          else if (goods >= Math.ceil(total * 0.6)) feedback = 'Better. Keep that feel.';
          else feedback = 'Keep going - stay focused on the cue.';
        }

        // Pressure mode required streak
        const pressureRequired = 3;
        const pressureComplete = pressureMode && pressureStreak >= pressureRequired;

        return (
          <View style={[styles.card, { marginBottom: 12 }]}>
            {/* Header + level selector + pressure toggle */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6, marginBottom: 0 }}>
                <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Today's Focus</Text>
                {drillCount > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3,
                    backgroundColor: '#1b4332', borderRadius: 8, paddingHorizontal: 7,
                    paddingVertical: 2, borderWidth: 1, borderColor: '#2d6a4f' }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ade80' }} />
                    <Text style={{ color: '#86efac', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>SESSION ACTIVE</Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                {(['easy', 'standard', 'focused'] as PracticeLevel[]).map((lv) => (
                  <Pressable key={lv} onPress={() => setPracticeLevel(lv)}
                    style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
                      backgroundColor: practiceLevel === lv ? '#1a3a2a' : '#111',
                      borderWidth: 1, borderColor: practiceLevel === lv ? '#2e7d32' : '#333' }}>
                    <Text style={{ color: practiceLevel === lv ? '#A7F3D0' : '#555', fontSize: 10, fontWeight: '700' }}>
                      {lv === 'easy' ? 'Easy' : lv === 'standard' ? 'Std' : '🔥'}
                    </Text>
                  </Pressable>
                ))}
                {/* Pressure mode toggle — right side of header */}
                <Pressable onPress={() => { setPressureMode((p) => !p); setPressureStreak(0); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4,
                    backgroundColor: pressureMode ? '#3a1a1a' : '#1a1a1a', borderRadius: 8,
                    paddingHorizontal: 8, paddingVertical: 4,
                    borderWidth: 1, borderColor: pressureMode ? '#c62828' : '#333' }}>
                  <Text style={{ color: pressureMode ? '#ef9a9a' : '#666', fontSize: 10, fontWeight: '700' }}>
                    ⚡ {pressureMode ? 'ON' : 'OFF'}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Plan */}
            <Text style={{ color: '#A7F3D0', fontSize: 16, fontWeight: '700', marginBottom: 4 }}>{plan.focus}</Text>
            <Text style={{ color: '#ccc', fontSize: 13, marginBottom: 4 }}>{plan.drill}</Text>
            <Text style={{ color: '#9CA3AF', fontSize: 12, fontStyle: 'italic', marginBottom: 10 }}>{plan.cue}</Text>

            {pressureMode && (
              <Text style={{ color: '#9CA3AF', fontSize: 12, marginBottom: 8 }}>
                {pressureComplete ? 'Drill complete!' : `${pressureStreak} / ${pressureRequired} in a row`}
              </Text>
            )}

            {/* Auto-detect toggle */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
              paddingHorizontal: 4,
              paddingVertical: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: autoDetectEnabled ? 'rgba(74,222,128,0.35)' : 'rgba(255,255,255,0.08)',
              backgroundColor: autoDetectEnabled ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.02)',
            }}>
              <View>
                <Text style={{ color: autoDetectEnabled ? '#4ade80' : '#9ca3af', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>
                  {autoDetectEnabled ? '🎙️ Auto-detect ON' : '👆 Manual mode'}
                </Text>
                <Text style={{ color: '#6b7280', fontSize: 10, marginTop: 1 }}>
                  {autoDetectEnabled
                    ? 'Swing detected by accelerometer'
                    : 'Tap Good / Left / Right to log'}
                </Text>
              </View>
              <Pressable
                onPress={() => setAutoDetectEnabled((v) => !v)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 20,
                  backgroundColor: autoDetectEnabled ? '#166534' : '#1f2937',
                  borderWidth: 1,
                  borderColor: autoDetectEnabled ? '#4ade80' : '#374151',
                }}
              >
                <Text style={{ color: autoDetectEnabled ? '#4ade80' : '#9ca3af', fontSize: 11, fontWeight: '700' }}>
                  {autoDetectEnabled ? 'Disable' : 'Enable'}
                </Text>
              </Pressable>
            </View>

            {/* Log buttons */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8, opacity: autoDetectEnabled ? 0.45 : 1 }}>
              <Pressable onPress={() => logFocusShot('good')}
                style={{ flex: 1, backgroundColor: '#1a3a2a', borderRadius: 10, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#2e7d32' }}>
                <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 15 }}>Good</Text>
              </Pressable>
              <Pressable onPress={() => logFocusShot('left')}
                style={{ flex: 1, backgroundColor: '#1a1a2e', borderRadius: 10, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#3949ab' }}>
                <Text style={{ color: '#90caf9', fontWeight: '700', fontSize: 15 }}>Left</Text>
              </Pressable>
              <Pressable onPress={() => logFocusShot('right')}
                style={{ flex: 1, backgroundColor: '#2e1a1a', borderRadius: 10, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#c62828' }}>
                <Text style={{ color: '#ef9a9a', fontWeight: '700', fontSize: 15 }}>Right</Text>
              </Pressable>
            </View>

            {/* Streak feedback */}
            {goodStreak2 && <Text style={{ color: '#A7F3D0', fontSize: 13, marginBottom: 4 }}>That's two good swings. Keep it going.</Text>}
            {missStreak2R && <Text style={{ color: '#fca5a5', fontSize: 13, marginBottom: 4 }}>Still missing right. Adjust more left.</Text>}
            {missStreak2L && <Text style={{ color: '#90caf9', fontSize: 13, marginBottom: 4 }}>Two left in a row. Hold the face open.</Text>}

            {/* Rep counter */}
            {total > 0 && (
              <Text style={{ color: '#aaa', fontSize: 12, marginBottom: 4 }}>
                {total} rep{total !== 1 ? 's' : ''} - Last: {focusShots[focusShots.length - 1].result}
              </Text>
            )}

            {/* Session feedback */}
            {feedback && (
              <Text style={{ color: done && goods >= Math.ceil(total * 0.6) ? '#A7F3D0' : feedback.startsWith('Better') ? '#A7F3D0' : feedback.startsWith('Keep going') ? '#e2e8b0' : '#fca5a5', fontSize: 13, marginBottom: 6 }}>
                {feedback}
              </Text>
            )}

            {/* Completion moment */}
            {done && <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '700', marginBottom: 6 }}>Good work. That's your feel.</Text>}

            {/* Footer actions */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              {total > 0 && (
                <Pressable onPress={() => { setFocusShots([]); aiFocusVoiceRef.current = 0; setPressureStreak(0); }} style={{ flex: 1 }}>
                  <Text style={{ color: '#aaa', fontSize: 12 }}>Reset</Text>
                </Pressable>
              )}
              {drillVariantsRef.current.length > 1 && (
                <Pressable onPress={() => { setDrillVariantIdx((i) => (i + 1) % drillVariantsRef.current.length); setFocusShots([]); aiFocusVoiceRef.current = 0; setPressureStreak(0); }} style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={{ color: '#aaa', fontSize: 12 }}>Next Drill</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })()}

      {/* Drill tiles - compact 3-column grid */}
      {(() => {
        const DRILL_ICONS: Record<string, string> = {
          putting: '⛳', alignment: '🎯', tempo: '🎵',
          'short-game': '🏌️', 'driver-straight': '🏌️‍♂️', 'iron-accuracy': '🏑',
          indoor: '🏠', 'swing-detect': '📱',
        };
        const DRILL_SHORT: Record<string, string> = {
          putting: 'Putting', alignment: 'Aim', tempo: 'Tempo',
          'short-game': 'Chipping', 'driver-straight': 'Driver', 'iron-accuracy': 'Irons',
          indoor: 'Indoor', 'swing-detect': 'Swing',
        };
        return (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12, paddingHorizontal: 4 }}>
            {DRILLS.map((d) => {
              const active = selectedDrill === d.id;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => handleSelectDrill(d.id)}
                  style={{
                    width: '30%', flexGrow: 1,
                    backgroundColor: active ? '#1b5e20' : '#1a1a1a',
                    borderRadius: 12, paddingVertical: 10, alignItems: 'center',
                    borderWidth: 1.5, borderColor: active ? '#4caf50' : '#2a2a2a',
                  }}
                >
                  <Text style={{ fontSize: 20, marginBottom: 3 }}>{DRILL_ICONS[d.id] ?? '?'}</Text>
                  <Text style={{ color: active ? '#A7F3D0' : '#aaa', fontSize: 11, fontWeight: '700', textAlign: 'center' }}>{DRILL_SHORT[d.id] ?? d.label}</Text>
                </Pressable>
              );
            })}
          </View>
        );
      })()}

      {/* Active Drill - selected shortcut only */}
      {selectedDrill !== 'putting' && selectedDrill !== 'short-game' && selectedDrill !== 'indoor' && selectedDrill !== 'swing-detect' && (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{drill.label}</Text>
        <Text style={styles.description}>{drill.description}</Text>

        {/* Target */}
        <Text style={{ color: '#66bb6a', fontWeight: '600', fontSize: 14, marginBottom: 10 }}>
          Target: {getPracticeTarget().toUpperCase()}
        </Text>

        {/* Progress Bar */}
        <Text style={styles.progressText}>Progress: {drillCount} / {drillTarget}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
        </View>

        {/* Success Rate */}
        {drillCount > 0 && (
          <View style={{ marginTop: 12 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
              Success Rate: {Math.round((goodShots / drillCount) * 100)}%
            </Text>
            <Text style={{ color: '#aaa', fontSize: 13, marginTop: 2 }}>
              Good: {goodShots} | Miss: {missShots}
            </Text>
          </View>
        )}

        {/* Shot Dispersion */}
        {focusShots.length > 0 && (
          <View style={{ marginTop: 20, alignItems: 'center' }}>
            <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 }}>
              Shot Dispersion
            </Text>
            <DispersionMap
              shots={focusShots.map((s) => ({
                result: s.result === 'good' ? 'straight' : s.result,
                target: 'center',
              }))}
            />

            {/* Start-line vs result mismatch indicator */}
            {(() => {
              const mismatches = focusShots.filter((s) => s.startMismatch);
              if (mismatches.length === 0) return null;
              const lastMismatch = mismatches[mismatches.length - 1];
              return (
                <View style={{
                  marginTop: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(251,191,36,0.35)',
                  backgroundColor: 'rgba(251,191,36,0.07)',
                  width: 300,
                }}>
                  <Text style={{ color: '#fbbf24', fontSize: 12, fontWeight: '800', marginBottom: 4 }}>
                    ⚠️ Start line vs result mismatch ({mismatches.length} shot{mismatches.length > 1 ? 's' : ''})
                  </Text>
                  <Text style={{ color: '#d1d5db', fontSize: 11, lineHeight: 16 }}>
                    Last: started <Text style={{ color: '#60a5fa', fontWeight: '700' }}>{lastMismatch.ballStart}</Text>
                    {' '}but finished <Text style={{ color: '#ef4444', fontWeight: '700' }}>{lastMismatch.result === 'good' ? 'straight' : lastMismatch.result}</Text>.
                  </Text>
                  <Text style={{ color: '#9ca3af', fontSize: 10, marginTop: 4 }}>
                    Ball is curving after launch — check face angle at impact.
                  </Text>
                </View>
              );
            })()}

            {/* Ball flight analysis card */}
            {(() => {
              const shotsWithFlight = focusShots.filter((s) => s.flightType);
              if (shotsWithFlight.length === 0) return null;

              // Count each flight type
              const counts: Record<string, number> = {};
              shotsWithFlight.forEach((s) => {
                const t = s.flightType!;
                counts[t] = (counts[t] ?? 0) + 1;
              });
              // Sort by frequency desc
              const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
              const dominant = sorted[0][0];
              const lastShot = shotsWithFlight[shotsWithFlight.length - 1];

              const flightColor = (ft: string) =>
                ft === 'Straight' ? '#4ade80'
                : ft === 'Draw' || ft === 'Fade' ? '#60a5fa'
                : ft === 'Push-Draw' || ft === 'Pull-Fade' ? '#a78bfa'
                : ft === 'Slice' || ft === 'Hook' ? '#ef4444'
                : '#fbbf24';

              return (
                <View style={{
                  marginTop: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(167,243,208,0.20)',
                  backgroundColor: 'rgba(10,26,15,0.85)',
                  width: 300,
                }}>
                  {/* Header */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ color: '#A7F3D0', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>
                      BALL FLIGHT ANALYSIS
                    </Text>
                    <View style={{
                      paddingHorizontal: 8, paddingVertical: 2,
                      borderRadius: 12,
                      backgroundColor: `${flightColor(dominant)}22`,
                      borderWidth: 1,
                      borderColor: `${flightColor(dominant)}55`,
                    }}>
                      <Text style={{ color: flightColor(dominant), fontSize: 10, fontWeight: '800' }}>
                        {dominant}
                      </Text>
                    </View>
                  </View>

                  {/* Last shot */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Text style={{ color: '#6b7280', fontSize: 10 }}>Last shot:</Text>
                    <Text style={{ color: flightColor(lastShot.flightType!), fontSize: 11, fontWeight: '700' }}>
                      {lastShot.flightType}
                    </Text>
                    <Text style={{ color: '#6b7280', fontSize: 10 }}>
                      (start <Text style={{ color: '#60a5fa' }}>{lastShot.ballStart}</Text>
                      {' → '}
                      finish <Text style={{ color: '#d1d5db' }}>{lastShot.result === 'good' ? 'straight' : lastShot.result}</Text>)
                    </Text>
                  </View>

                  {/* Frequency breakdown */}
                  {sorted.map(([ft, count]) => (
                    <View key={ft} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 6 }}>
                      <View style={{
                        width: Math.max(4, (count / shotsWithFlight.length) * 160),
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: flightColor(ft),
                        opacity: 0.75,
                      }} />
                      <Text style={{ color: flightColor(ft), fontSize: 10, fontWeight: '700', width: 70 }}>{ft}</Text>
                      <Text style={{ color: '#6b7280', fontSize: 10 }}>{count}x</Text>
                    </View>
                  ))}
                </View>
              );
            })()}
          </View>
        )}

        {/* Target rings */}
        <View style={{ alignItems: 'center', marginVertical: 14 }}>
          <View style={{ width: 160, height: 160, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ position: 'absolute', width: 160, height: 160, borderRadius: 80, backgroundColor: '#3a1a1a', borderWidth: 2, borderColor: '#c62828' }} />
            <View style={{ position: 'absolute', width: 118, height: 118, borderRadius: 59, backgroundColor: '#1a2e3a', borderWidth: 2, borderColor: '#448aff' }} />
            <View style={{ position: 'absolute', width: 74, height: 74, borderRadius: 37, backgroundColor: '#0d2b0d', borderWidth: 2, borderColor: '#66bb6a' }} />
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFE600', borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: '#000', fontSize: 9, fontWeight: '800' }}>10</Text>
            </View>
            <Text style={{ position: 'absolute', top: 5, color: '#c62828', fontSize: 9, fontWeight: '700' }}>MISS</Text>
            <Text style={{ position: 'absolute', top: 25, color: '#90caf9', fontSize: 9, fontWeight: '700' }}>2</Text>
            <Text style={{ position: 'absolute', top: 46, color: '#66bb6a', fontSize: 9, fontWeight: '700' }}>5</Text>
          </View>
          {lastHitZone !== null && (
            <Text style={{ fontSize: 14, fontWeight: '800', marginTop: 8, color: lastHitZone === 'bull' ? '#FFE600' : lastHitZone === 'inner' ? '#66bb6a' : lastHitZone === 'outer' ? '#90caf9' : '#ff5252' }}>
              {lastHitZone === 'bull' ? `\uD83C\uDFAF BULL! +${10 * comboMult}` : lastHitZone === 'inner' ? `\u2713 Inner +${5 * comboMult}` : lastHitZone === 'outer' ? `Outer +${2 * comboMult}` : `\u2717 Miss`}
              {comboMult > 1 ? ` \u2014 ${comboMult}x COMBO \uD83D\uDD25` : ''}
            </Text>
          )}
          <Text style={{ color: '#aaa', fontSize: 11, marginTop: 4 }}>Streak: {comboStreak}{comboMult > 1 ? ` \u2014 ${comboMult}x` : ''}</Text>
        </View>

        {/* Zone shot buttons */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
          {(['bull', 'inner', 'outer', 'miss'] as const).map((zone) => {
            const cfg = {
              bull:  { label: '\uD83C\uDFAF Bull',  sub: '10 pts', bg: '#b8a000', fg: '#000' },
              inner: { label: 'Inner', sub: '5 pts',  bg: '#2e7d32', fg: '#fff' },
              outer: { label: 'Outer', sub: '2 pts',  bg: '#1565c0', fg: '#fff' },
              miss:  { label: 'Miss',  sub: '0',      bg: '#c62828', fg: '#fff' },
            }[zone];
            return (
              <Pressable
                key={zone}
                onPress={() => logZoneHit(zone)}
                style={({ pressed }) => ({ flex: 1, backgroundColor: pressed ? '#111' : cfg.bg, padding: 12, borderRadius: 10, alignItems: 'center' })}
              >
                <Text style={{ color: cfg.fg, fontWeight: '800', fontSize: 13 }}>{cfg.label}</Text>
                <Text style={{ color: cfg.fg === '#fff' ? 'rgba(255,255,255,0.85)' : '#555', fontSize: 10 }}>{cfg.sub}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Reset row */}
        <Pressable
          onPress={handleEndPracticeSession}
          style={({ pressed }) => ({ alignSelf: 'flex-end', backgroundColor: pressed ? '#333' : '#1e1e1e', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, marginBottom: 4 })}
        >
          <Text style={{ color: '#aaa', fontSize: 12 }}>End Session</Text>
        </Pressable>

        {/* ── Video Swing Analysis ─────────────────────────────────── */}
        {swingAnalysis && (
          <View style={{ marginTop: 16, backgroundColor: '#0f1f2e', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1e4a6e' }}>
            <Text style={{ color: '#7dd3fc', fontWeight: '800', fontSize: 15, marginBottom: 12, letterSpacing: 0.3 }}>
              Swing Analysis
            </Text>

            {/* Club Path */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 }}>Club Path</Text>
              <Text style={{
                color: swingAnalysis.clubPath === 'neutral' ? '#4ade80' : swingAnalysis.clubPath === 'in-to-out' ? '#60a5fa' : '#f87171',
                fontWeight: '700',
                fontSize: 13,
                textTransform: 'capitalize',
              }}>
                {swingAnalysis.clubPath}
              </Text>
            </View>

            {/* Face Angle */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 }}>Face Angle</Text>
              <Text style={{
                color: swingAnalysis.faceAngle === 'square' ? '#4ade80' : swingAnalysis.faceAngle === 'open' ? '#f87171' : '#60a5fa',
                fontWeight: '700',
                fontSize: 13,
                textTransform: 'capitalize',
              }}>
                {swingAnalysis.faceAngle}
              </Text>
            </View>

            {/* Tempo */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 }}>Tempo</Text>
              <Text style={{
                color: swingAnalysis.tempo === 'smooth' ? '#4ade80' : '#fbbf24',
                fontWeight: '700',
                fontSize: 13,
                textTransform: 'capitalize',
              }}>
                {swingAnalysis.tempo}
              </Text>
            </View>

            {/* ── Combined Pattern Insight ─────────────────────────── */}
            {(() => {
              const bias  = memoryMissBias;
              const face  = swingAnalysis.faceAngle;
              const path  = swingAnalysis.clubPath;

              // Confirmed matches — swing data explains the miss pattern
              if (bias === 'right' && face === 'open')
                return { text: 'Confirmed: Open face causing right miss', color: '#f87171', confirmed: true };
              if (bias === 'left'  && face === 'closed')
                return { text: 'Confirmed: Closed face causing left miss', color: '#f87171', confirmed: true };
              if (bias === 'right' && path === 'out-to-in')
                return { text: 'Confirmed: Out-to-in path contributing to right miss', color: '#f87171', confirmed: true };
              if (bias === 'left'  && path === 'in-to-out')
                return { text: 'Confirmed: In-to-out path contributing to left miss', color: '#f87171', confirmed: true };

              // Mismatch — data doesn't align with pattern history
              if ((bias === 'right' || bias === 'left') && (face !== 'square' || path !== 'neutral'))
                return { text: 'Inconsistent pattern — review setup', color: '#fbbf24', confirmed: false };

              // Neutral / no useful bias data
              if (bias === 'neutral' && face === 'square' && path === 'neutral')
                return { text: 'Swing looks balanced — keep it consistent', color: '#4ade80', confirmed: true };

              return null;
            })() !== null && (() => {
              const insight = (() => {
                const bias  = memoryMissBias;
                const face  = swingAnalysis.faceAngle;
                const path  = swingAnalysis.clubPath;
                if (bias === 'right' && face === 'open')
                  return { text: 'Confirmed: Open face causing right miss', color: '#f87171' };
                if (bias === 'left'  && face === 'closed')
                  return { text: 'Confirmed: Closed face causing left miss', color: '#f87171' };
                if (bias === 'right' && path === 'out-to-in')
                  return { text: 'Confirmed: Out-to-in path contributing to right miss', color: '#f87171' };
                if (bias === 'left'  && path === 'in-to-out')
                  return { text: 'Confirmed: In-to-out path contributing to left miss', color: '#f87171' };
                if ((bias === 'right' || bias === 'left') && (face !== 'square' || path !== 'neutral'))
                  return { text: 'Inconsistent pattern — review setup', color: '#fbbf24' };
                if (bias === 'neutral' && face === 'square' && path === 'neutral')
                  return { text: 'Swing looks balanced — keep it consistent', color: '#4ade80' };
                return null;
              })();
              if (!insight) return null;
              return (
                <View style={{ marginTop: 12, backgroundColor: '#0a0f1a', borderRadius: 10, padding: 10, borderLeftWidth: 3, borderLeftColor: insight.color }}>
                  <Text style={{ color: insight.color, fontWeight: '700', fontSize: 12, lineHeight: 18 }}>
                    {insight.text}
                  </Text>
                </View>
              );
            })()}

            {/* ── Coach Mode ───────────────────────────────────────── */}
            {(() => {
              const tip = buildCoachMode(
                memoryMissBias,
                swingAnalysis.faceAngle,
                swingAnalysis.clubPath,
                swingAnalysis.tempo,
              );
              if (!tip) return null;
              return (
                <View style={{ marginTop: 14, backgroundColor: '#111827', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#374151' }}>
                  <Text style={{ color: '#a78bfa', fontWeight: '800', fontSize: 13, marginBottom: 10, letterSpacing: 0.3 }}>
                    🏇 Coach Mode
                  </Text>
                  {/* What */}
                  <View style={{ flexDirection: 'row', marginBottom: 8, gap: 8 }}>
                    <Text style={{ color: '#f87171', fontWeight: '800', fontSize: 11, width: 36, paddingTop: 1 }}>WHAT</Text>
                    <Text style={{ color: '#e5e7eb', fontSize: 12, flex: 1, lineHeight: 18 }}>{tip.what}</Text>
                  </View>
                  {/* Why */}
                  <View style={{ flexDirection: 'row', marginBottom: 8, gap: 8 }}>
                    <Text style={{ color: '#fbbf24', fontWeight: '800', fontSize: 11, width: 36, paddingTop: 1 }}>WHY</Text>
                    <Text style={{ color: '#e5e7eb', fontSize: 12, flex: 1, lineHeight: 18 }}>{tip.why}</Text>
                  </View>
                  {/* Fix */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={{ color: '#4ade80', fontWeight: '800', fontSize: 11, width: 36, paddingTop: 1 }}>FIX</Text>
                    <Text style={{ color: '#e5e7eb', fontSize: 12, flex: 1, lineHeight: 18 }}>{tip.fix}</Text>
                  </View>
                </View>
              );
            })()}

            <Pressable
              onPress={() => setSwingAnalysis(null)}
              style={{ alignSelf: 'flex-end', marginTop: 12 }}
            >
              <Text style={{ color: '#475569', fontSize: 11 }}>Dismiss</Text>
            </Pressable>
          </View>
        )}

        {/* Streak */}
        {drillCount > 0 && (
          <View style={{ marginTop: 12 }}>
            <Text style={{ color: currentStreak >= streakTarget ? '#66bb6a' : '#fff', fontSize: 14, fontWeight: '600' }}>
              Streak: {currentStreak} / {streakTarget}
            </Text>
            <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>Best: {bestStreak}</Text>
            <Text style={{ color: '#ccc', fontSize: 12, marginTop: 2 }}>Difficulty Level: {difficulty}</Text>
            {getDifficultyFeedback() !== '' && (
              <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{getDifficultyFeedback()}</Text>
            )}
            {difficulty >= 3 && (
              <Text style={{ color: '#66bb6a', fontSize: 12, marginTop: 2 }}>Difficulty increased - tighter target</Text>
            )}
          </View>
        )}

        {drillCount >= drillTarget && (
          <Text style={styles.complete}>Drill complete. Great work.</Text>
        )}
        {currentStreak >= streakTarget && (
          <Text style={[styles.complete, { color: '#FFD700' }]}>{streakTarget} in a row - great consistency!</Text>
        )}

        {/* Coaching Feedback */}
        <View style={{ backgroundColor: getFeedbackColor(), padding: 12, borderRadius: 12, marginTop: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '600', marginBottom: 4 }}>Coaching Feedback</Text>
          <Text style={{ color: drillCount < 3 ? '#aaa' : '#fff', fontSize: 13 }}>{getPracticeFeedback()}</Text>
        </View>

        {/* Practice Plan */}
        <View style={{ backgroundColor: '#0d2b0d', padding: 12, borderRadius: 12, marginTop: 10, borderWidth: 1, borderColor: '#2e7d32' }}>
          <Text style={{ color: '#A7F3D0', fontWeight: '600', marginBottom: 4 }}>Practice Plan</Text>
          <Text style={{ color: '#ccc', fontSize: 13, lineHeight: 20 }}>{getPracticePlan()}</Text>
        </View>

        {/* Personalized Drill Tip */}
        <View style={{ backgroundColor: '#1a2e1a', padding: 12, borderRadius: 12, marginTop: 10 }}>
          <Text style={{ color: '#66bb6a', fontWeight: '600', marginBottom: 4 }}>Drill for {drill.label}</Text>
          <Text style={{ color: '#ccc', fontSize: 13, lineHeight: 20 }}>{getDrillRecommendation(selectedDrill)}</Text>
        </View>
      </View>
      )}

      {/* Chipping Challenge */}
      {selectedDrill === 'short-game' && (
      <View style={styles.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={styles.sectionTitle}>\uD83C\uDFCC\uFE0F Chipping Challenge</Text>
          <Text style={{ color: '#FFE600', fontSize: 16, fontWeight: '700' }}>{chipPoints} pts</Text>
        </View>
        <Text style={{ color: '#aaa', fontSize: 13, marginBottom: 12 }}>Hit chip shots to a target. Score by landing zone. Build your streak!</Text>

        {/* Distance selector */}
        <Text style={{ color: '#A7F3D0', fontWeight: '600', fontSize: 13, marginBottom: 8 }}>Target Distance</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {[10, 20, 30, 40, 50].map((d) => (
            <Pressable key={d} onPress={() => setChipTarget(d)}
              style={[styles.drillOption, chipTarget === d && styles.drillSelected, { flex: 1, alignItems: 'center' }]}>
              <Text style={[styles.drillLabel, chipTarget === d && { color: '#fff' }]}>{d}y</Text>
            </Pressable>
          ))}
        </View>

        {/* Target rings */}
        <View style={{ alignItems: 'center', marginBottom: 14 }}>
          <View style={{ width: 160, height: 160, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ position: 'absolute', width: 160, height: 160, borderRadius: 80, backgroundColor: '#3a1a1a', borderWidth: 2, borderColor: '#c62828' }} />
            <View style={{ position: 'absolute', width: 118, height: 118, borderRadius: 59, backgroundColor: '#1a2e3a', borderWidth: 2, borderColor: '#448aff' }} />
            <View style={{ position: 'absolute', width: 74, height: 74, borderRadius: 37, backgroundColor: '#0d2b0d', borderWidth: 2, borderColor: '#66bb6a' }} />
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFE600', borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: '#000', fontSize: 9, fontWeight: '800' }}>10</Text>
            </View>
            <Text style={{ position: 'absolute', top: 5, color: '#c62828', fontSize: 9, fontWeight: '700' }}>MISS</Text>
            <Text style={{ position: 'absolute', top: 25, color: '#90caf9', fontSize: 9, fontWeight: '700' }}>2</Text>
            <Text style={{ position: 'absolute', top: 46, color: '#66bb6a', fontSize: 9, fontWeight: '700' }}>5</Text>
          </View>
          <Text style={{ color: '#aaa', fontSize: 12, marginTop: 6 }}>Target: {chipTarget} yards to flag</Text>
          {chipStreak >= 3 && <Text style={{ color: '#FFE600', fontWeight: '700', marginTop: 4 }}>\uD83D\uDD25 {chipStreak} in a row!</Text>}
        </View>

        {/* Zone buttons */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
          {(['bull', 'inner', 'outer', 'miss'] as const).map((zone) => {
            const cfg = {
              bull:  { label: '\uD83C\uDFAF Stiff', base: 10, bg: '#b8a000', fg: '#000' },
              inner: { label: 'Close',    base: 5,  bg: '#2e7d32', fg: '#fff' },
              outer: { label: 'On Green', base: 2,  bg: '#1565c0', fg: '#fff' },
              miss:  { label: 'Miss',     base: 0,  bg: '#c62828', fg: '#fff' },
            }[zone];
            return (
              <Pressable
                key={zone}
                onPress={() => {
                  const mult = chipStreak >= 5 ? 3 : chipStreak >= 3 ? 2 : 1;
                  const newCs = zone !== 'miss' ? chipStreak + 1 : 0;
                  setChipBestStreak((bs) => Math.max(bs, newCs));
                  setChipStreak(newCs);
                  setChipPoints((p) => p + cfg.base * mult);
                  setChipTotal((t) => t + 1);
                  logZoneHit(zone);
                }}
                style={({ pressed }) => ({ flex: 1, backgroundColor: pressed ? '#111' : cfg.bg, padding: 10, borderRadius: 10, alignItems: 'center' })}
              >
                <Text style={{ color: cfg.fg, fontWeight: '800', fontSize: 12 }}>{cfg.label}</Text>
                <Text style={{ color: cfg.fg === '#fff' ? 'rgba(255,255,255,0.6)' : '#555', fontSize: 10 }}>+{cfg.base}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Stats row */}
        {chipTotal > 0 && (
          <View style={{ flexDirection: 'row', backgroundColor: '#121212', borderRadius: 10, padding: 12, gap: 8, marginBottom: 10 }}>
            {[['Shots', String(chipTotal), '#fff'],['Points', String(chipPoints), '#FFE600'],['Streak', String(chipStreak), chipStreak >= 3 ? '#FFE600' : '#fff'],['Best', String(chipBestStreak), '#66bb6a']].map(([l, v, c]) => (
              <View key={l} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: '#aaa', fontSize: 10, textTransform: 'uppercase' }}>{l}</Text>
                <Text style={{ color: c, fontSize: 18, fontWeight: '700' }}>{v}</Text>
              </View>
            ))}
          </View>
        )}
        <Pressable onPress={() => { setChipPoints(0); setChipStreak(0); setChipBestStreak(0); setChipTotal(0); setShotMapLog([]); setSessionPoints(0); }}
          style={{ alignSelf: 'flex-end' }}>
          <Text style={{ color: '#aaa', fontSize: 12 }}>Reset</Text>
        </Pressable>
      </View>
      )}

      {/* Indoor Practice */}
      {selectedDrill === 'indoor' && (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Indoor Practice</Text>
        <Text style={styles.description}>Small-space training. Focus on control, tempo, and balance.</Text>

        {/* Swing % Selector */}
        <Text style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>Swing Percentage</Text>
        <View style={{ flexDirection: 'row' }}>
          {[25, 50, 75, 100].map((percent) => (
            <Pressable
              key={percent}
              onPress={() => setSwingPercent(percent)}
              style={[styles.drillOption, swingPercent === percent && styles.drillSelected, { flex: 1, marginRight: 6, alignItems: 'center' }]}
            >
              <Text style={[styles.drillLabel, swingPercent === percent && { color: '#fff' }]}>{percent}%</Text>
            </Pressable>
          ))}
        </View>

        <Text style={{ color: '#ccc', fontSize: 13, marginTop: 10, lineHeight: 20 }}>
          Practice smooth {swingPercent}% swings. Focus on control and balance.
        </Text>

        {/* Rep Tracking */}
        <Pressable
          onPress={() => setIndoorReps((r) => r + 1)}
          style={({ pressed }) => ({
            backgroundColor: pressed ? '#0d47a1' : '#1565c0',
            padding: 12,
            borderRadius: 10,
            marginTop: 12,
            alignItems: 'center',
          })}
        >
          <Text style={{ color: '#fff', fontWeight: '600' }}>Log Swing</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <Text style={{ color: '#ccc', fontSize: 13 }}>Swings: {indoorReps}</Text>
          <Pressable onPress={() => setIndoorReps(0)}>
            <Text style={{ color: '#aaa', fontSize: 12 }}>Reset</Text>
          </Pressable>
        </View>

        {/* Tempo Trainer */}
        <View style={{ marginTop: 20, alignItems: 'center' }}>
          <Text style={{ color: '#A7F3D0', fontSize: 12, fontWeight: 'bold', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Tempo Trainer</Text>
          <Text style={{
            color: tempoText === 'SWING' ? '#FFD700' : tempoText === 'Ready' ? '#555' : '#66bb6a',
            fontSize: 36,
            fontWeight: '700',
            marginBottom: 14,
            letterSpacing: 2,
          }}>
            {tempoText}
          </Text>
          <Pressable
            onPress={startTempo}
            style={({ pressed }) => ({
              backgroundColor: isTempoRunning ? '#333' : pressed ? '#1b5e20' : '#2e7d32',
              padding: 12,
              borderRadius: 10,
              paddingHorizontal: 24,
            })}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>{isTempoRunning ? 'Running...' : 'Start Tempo'}</Text>
          </Pressable>

          {/* On Tempo / Off Tempo */}
          <View style={{ flexDirection: 'row', marginTop: 14 }}>
            <Pressable
              onPress={() => {
                const newStreak = tempoStreak + 1;
                setTempoStreak(newStreak);
                const newGood = tempoGood + 1;
                setTempoGood(newGood);
                const newReps = indoorReps + 1;
                setIndoorReps(newReps);
                if (newStreak > bestTempoStreak) setBestTempoStreak(newStreak);
                if (newReps === 3) updateStreak();
                if (newReps === 10) saveSession();
                const total = newGood + tempoMiss;
                if (total > 0) playerProfile.tempoConsistency = Math.round((newGood / total) * 100);
              }}
              style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? '#1b5e20' : '#2e7d32', marginRight: 8 }]}
            >
              <Text style={styles.btnText}>? On Tempo</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setTempoStreak(0);
                const newMiss = tempoMiss + 1;
                setTempoMiss(newMiss);
                const newReps = indoorReps + 1;
                setIndoorReps(newReps);
                if (newReps === 3) updateStreak();
                if (newReps === 10) saveSession();
                const total = tempoGood + newMiss;
                if (total > 0) playerProfile.tempoConsistency = Math.round((tempoGood / total) * 100);
              }}
              style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? '#b71c1c' : '#c62828' }]}
            >
              <Text style={styles.btnText}>? Off Tempo</Text>
            </Pressable>
          </View>

          {/* Tempo Score */}
          {(tempoGood + tempoMiss) > 0 && (
            <View style={{ marginTop: 10, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                Tempo Score: {Math.round((tempoGood / (tempoGood + tempoMiss)) * 100)}%
              </Text>
              {/* Indoor Drill Tip */}
              <View style={{ backgroundColor: '#1a2e1a', padding: 10, borderRadius: 10, marginTop: 10, width: '100%' }}>
                <Text style={{ color: '#66bb6a', fontWeight: '600', fontSize: 12, marginBottom: 4 }}>Indoor Drill</Text>
                <Text style={{ color: '#ccc', fontSize: 12, lineHeight: 18 }}>{getDrillRecommendation('tempo')}</Text>
              </View>
              <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>
                Good: {tempoGood} | Off: {tempoMiss}
              </Text>
              <Text style={{ color: '#66bb6a', fontSize: 12, marginTop: 4 }}>{getTempoFeedback()}</Text>

              {/* Tempo Goal */}
              {(() => {
                const tempoScore = Math.round((tempoGood / (tempoGood + tempoMiss)) * 100);
                const goalMet = tempoScore >= tempoGoal;
                return (
                  <View style={{ marginTop: 12, alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Goal: {tempoGoal}% tempo</Text>
                    <Text style={{ color: goalMet ? '#66bb6a' : '#ccc', marginTop: 4 }}>Current: {tempoScore}%</Text>
                    {goalMet && (
                      <Text style={{ color: '#66bb6a', marginTop: 6, fontWeight: '600' }}>Goal achieved -. Great work.</Text>
                    )}
                    {goalMet && tempoGoal < 95 && (
                      <Pressable onPress={() => { /* goal advances automatically via getAdaptiveGoal */ }} style={{ marginTop: 6 }}>
                        <Text style={{ color: '#A7F3D0', fontSize: 12 }}>Next goal: {Math.min(tempoGoal + 5, 95)}% - tap to advance</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })()}

              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', marginTop: 10 }}>
                Tempo Streak: {tempoStreak} / {tempoStreakTarget}
              </Text>
              <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>Best: {bestTempoStreak}</Text>
              {tempoStreak >= tempoStreakTarget && (
                <Text style={{ color: '#66bb6a', fontSize: 13, fontWeight: '600', marginTop: 6 }}>
                  Challenge complete - elite tempo ??
                </Text>
              )}
            </View>
          )}
        </View>
      </View>
      )}

      {/* Indoor Session Summary */}
      {selectedDrill === 'indoor' && indoorReps >= 3 && (() => {
        const dayDelta = getDayComparison();
        return (
          <View style={{ backgroundColor: '#121212', padding: 12, borderRadius: 12, marginTop: 8 }}>
            <Text style={{ color: '#A7F3D0', fontSize: 12, fontWeight: 'bold', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>Session Summary</Text>
            <Text style={{ color: '#ccc', fontSize: 13, lineHeight: 20 }}>{getIndoorSummary()}</Text>
            <Text style={{ color: '#66bb6a', fontWeight: '600', marginTop: 12 }}>?? Streak: {streak} day{streak !== 1 ? 's' : ''}</Text>
            {dayDelta !== null && (
              <Text style={{ marginTop: 6, color: dayDelta >= 0 ? '#66bb6a' : '#ff5252', fontWeight: '600' }}>
                {dayDelta >= 0 ? `+${dayDelta}% vs yesterday` : `${dayDelta}% vs yesterday`}
              </Text>
            )}
            {dayDelta !== null && (
              <Text style={{ color: '#ccc', fontSize: 13, marginTop: 4 }}>{getMemoryInsight(dayDelta)}</Text>
            )}
            {indoorReps >= 10 && weeklyHistory.length === 0 && (
              <Pressable onPress={saveSession} style={{ marginTop: 10 }}>
                <Text style={{ color: '#A7F3D0', fontSize: 12 }}>Save session to history</Text>
              </Pressable>
            )}
            {indoorReps >= 10 && weeklyHistory.length > 0 && (() => {
              const trend = getWeeklyTrend();
              return trend !== null ? (
                <Text style={{ color: trend >= 0 ? '#66bb6a' : '#ff5252', fontSize: 12, marginTop: 6 }}>
                  {trend >= 0 ? `+${trend}% vs last session` : `${trend}% vs last session`}
                </Text>
              ) : null;
            })()}
          </View>
        );
      })()}

      {/* Putting Practice */}
      {selectedDrill === 'putting' && (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Putting Practice</Text>
        <Text style={{ color: '#aaa', fontSize: 13, marginBottom: 12 }}>Hold phone like a putter grip. Motion + gyro detects your stroke - then log result.</Text>

        {/* -- Video-game putting green animation ----------------------------- */}
        <View style={{ backgroundColor: '#0a2212', borderRadius: 14, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: '#1a4a1a' }}>
          {/* Green surface */}
          <View style={{ height: 220, position: 'relative', backgroundColor: '#133a1e' }}>
            {/* Faint grain lines for green texture */}
            {[0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((pos) => (
              <View key={pos} style={{ position: 'absolute', left: 0, right: 0, top: `${pos * 100}%` as any, height: 1, backgroundColor: 'rgba(255,255,255,0.04)' }} />
            ))}
            {/* Distance indicator */}
            <View style={{ position: 'absolute', top: 10, left: 14 }}>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600' }}>{puttDistance} ft</Text>
            </View>
            {/* Cup */}
            <View style={{ position: 'absolute', top: 14, left: '50%' as any, transform: [{ translateX: -12 }] }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#000', borderWidth: 2, borderColor: '#222', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#111' }} />
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, textAlign: 'center', marginTop: 2 }}>CUP</Text>
            </View>
            {/* Ball path guide line */}
            <View style={{ position: 'absolute', top: 36, bottom: 40, left: '50%' as any, width: 1, backgroundColor: 'rgba(255,255,255,0.07)', transform: [{ translateX: -0.5 }] }} />
            {/* Animated ball */}
            {puttAnimActive && (() => {
              const greenHeight = 220;
              const ballTranslateY = puttBallY.interpolate({ inputRange: [0, 1], outputRange: [greenHeight - 36, 36] });
              return (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute', bottom: 28, left: '50%' as any,
                    transform: [
                      { translateX: -10 },
                      { translateY: Animated.multiply(puttBallY, -(greenHeight - 72)) },
                      { translateX: puttBallX },
                      { scale: puttBallScale },
                    ],
                    opacity: puttBallOpacity,
                  }}
                >
                  {/* Ball shadow */}
                  <View style={{ position: 'absolute', bottom: -3, left: 1, width: 18, height: 6, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.4)' }} />
                  {/* Ball */}
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
                    shadowColor: '#fff', shadowOpacity: 0.6, shadowRadius: 4,
                    borderWidth: 1, borderColor: '#ddd',
                  }}>
                    {/* Golf ball dimple pattern */}
                    <View style={{ position: 'absolute', top: 4, left: 4, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.12)' }} />
                    <View style={{ position: 'absolute', top: 4, right: 4, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.12)' }} />
                    <View style={{ position: 'absolute', bottom: 4, left: 7, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.12)' }} />
                  </View>
                </Animated.View>
              );
            })()}
            {/* Result overlay */}
            {puttAnimResult === 'made' && (
              <View style={{ position: 'absolute', inset: 0 as any, backgroundColor: 'rgba(0,80,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#FFD700', fontSize: 32, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 8 }}>? IN THE HOLE!</Text>
              </View>
            )}
            {puttAnimResult === 'miss' && (
              <View style={{ position: 'absolute', inset: 0 as any, backgroundColor: 'rgba(80,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#ff5252', fontSize: 26, fontWeight: '900' }}>? MISS</Text>
              </View>
            )}
            {/* Logo watermark on putting screen */}
            <Image source={LOGO} style={{ position: 'absolute', bottom: 8, right: 10, width: 44, height: 22, opacity: 0.35 }} resizeMode="contain" />
          </View>
        </View>

        {/* Motion Tracking */}
        <View style={{ backgroundColor: '#121212', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: isPuttTracking ? '#2e7d32' : '#222' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: '#A7F3D0', fontWeight: '600', fontSize: 13 }}>IMU Stroke Tracking</Text>
            {!isPuttTracking ? (
              <Pressable
                onPress={startPuttTracking}
                style={({ pressed }) => ({ backgroundColor: pressed ? '#1b5e20' : '#2e7d32', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 })}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Start</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={stopPuttTracking}
                style={({ pressed }) => ({ backgroundColor: pressed ? '#b71c1c' : '#c62828', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 })}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Stop</Text>
              </Pressable>
            )}
          </View>
          {isPuttTracking && (
            <View style={{ alignItems: 'center', paddingVertical: 6 }}>
              <Text style={{ color: '#66bb6a', fontSize: 13, fontWeight: '600', marginBottom: 4 }}>? Accel + Gyro Live</Text>
              <Text style={{
                color: puttMotionFeedback.includes('?') ? '#66bb6a' : puttMotionFeedback.includes('fast') || puttMotionFeedback.includes('slow') || puttMotionFeedback.includes('deviation') ? '#ff5252' : '#fff',
                fontSize: 15, fontWeight: '700', textAlign: 'center',
              }}>
                {puttMotionFeedback}
              </Text>
              {puttPathFeedback !== '' && (
                <Text style={{ color: puttPathFeedback.includes('?') ? '#66bb6a' : '#f9a825', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                  {puttPathFeedback}
                </Text>
              )}
              {puttStrokeDetected && (
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                  <Pressable
                    onPress={() => { logPutt(true); setPuttStrokeDetected(false); setPuttMotionFeedback('Ready - make your stroke'); setPuttPathFeedback(''); }}
                    style={({ pressed }) => ({ backgroundColor: pressed ? '#1b5e20' : '#2e7d32', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10 })}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>? Made</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { logPutt(false); setPuttStrokeDetected(false); setPuttMotionFeedback('Ready - make your stroke'); setPuttPathFeedback(''); }}
                    style={({ pressed }) => ({ backgroundColor: pressed ? '#b71c1c' : '#c62828', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10 })}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>? Miss</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </View>

        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 6 }}>Distance: {puttDistance} ft</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {[3, 5, 6, 8, 10, 12, 15, 20].map((d) => (
            <Pressable
              key={d}
              onPress={() => setPuttDistance(d)}
              style={[styles.drillOption, puttDistance === d && styles.drillSelected, { flex: 0, paddingHorizontal: 14 }]}
            >
              <Text style={[styles.drillLabel, puttDistance === d && { color: '#fff' }]}>{d} ft</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable
            onPress={() => logPutt(true)}
            style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? '#1b5e20' : '#2e7d32', flex: 1 }]}
          >
            <Text style={[styles.btnText, { fontSize: 16 }]}>? Made</Text>
          </Pressable>
          <Pressable
            onPress={() => logPutt(false)}
            style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? '#b71c1c' : '#c62828', flex: 1 }]}
          >
            <Text style={[styles.btnText, { fontSize: 16 }]}>? Miss</Text>
          </Pressable>
        </View>

        {puttStreak > 0 && (
          <Text style={{ color: '#FFD700', fontWeight: '700', fontSize: 14, marginTop: 10 }}>
            ?? Streak: {puttStreak}
          </Text>
        )}

        {puttResults.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: '#A7F3D0', fontWeight: '600', marginBottom: 8 }}>Make % by Distance</Text>
            {Object.entries(getPuttingStats())
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([dist, data]) => {
                const pct = Math.round((data.made / data.total) * 100);
                return (
                  <View key={dist} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ color: '#ccc', width: 52, fontSize: 13 }}>{dist} ft</Text>
                    <View style={{ flex: 1, height: 8, backgroundColor: '#222', borderRadius: 4, marginRight: 8 }}>
                      <View style={{ width: `${pct}%` as any, height: 8, backgroundColor: pct >= 60 ? '#2e7d32' : pct >= 40 ? '#f9a825' : '#c62828', borderRadius: 4 }} />
                    </View>
                    <Text style={{ color: '#ccc', fontSize: 13, width: 38, textAlign: 'right' }}>{pct}%</Text>
                  </View>
                );
              })}
            <View style={{ backgroundColor: '#0d2b0d', padding: 12, borderRadius: 10, marginTop: 10, borderWidth: 1, borderColor: '#2e7d32' }}>
              <Text style={{ color: '#66bb6a', fontSize: 13 }}>{getPuttingInsight()}</Text>
            </View>
            <Pressable onPress={() => { setPuttResults([]); setPuttStreak(0); }} style={{ marginTop: 10, alignSelf: 'flex-end' }}>
              <Text style={{ color: '#aaa', fontSize: 12 }}>Reset</Text>
            </Pressable>
          </View>
        )}
      </View>
      )}

      {/* Shot Map */}
      {(selectedDrill === 'swing-detect' || shotMapLog.length > 0) && (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Shot Map</Text>
        {/* Range background */}
        <View style={{ position: 'relative', marginTop: 8 }}>
          <View style={{ flexDirection: 'row', height: 200, borderRadius: 10, overflow: 'hidden' }}>
            <View style={{ flex: 1, backgroundColor: '#4a3728' }} />
            <View style={{ flex: 1.5, backgroundColor: '#2E7D32' }} />
            <View style={{ flex: 1, backgroundColor: '#388e3c' }} />
            <View style={{ flex: 1.5, backgroundColor: '#2E7D32' }} />
            <View style={{ flex: 1, backgroundColor: '#4a3728' }} />
          </View>
          {/* Ring overlays at center */}
          {[80, 48, 24].map((r) => (
            <View key={r} style={{ position: 'absolute', top: '50%', left: '50%',
              transform: [{ translateX: -r }, { translateY: -r }],
              width: r * 2, height: r * 2, borderRadius: r,
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }} />
          ))}
          {/* Pin */}
          <View style={{ position: 'absolute', left: '50%', top: 0, marginLeft: -1, width: 2, height: 200, backgroundColor: 'rgba(255,255,255,0.12)' }} />
          <View style={{ position: 'absolute', left: '50%', top: 12, marginLeft: -12, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 10 }}>\uD83C\uDFAF</Text>
          </View>
          {/* Shot dots - last 40 */}
          {shotMapLog.slice(-40).map((shot) => (
            <View key={shot.id} style={{
              position: 'absolute',
              left: `${shot.x * 100}%` as any,
              top: shot.y * 200 - 5,
              width: 10, height: 10, borderRadius: 5, marginLeft: -5,
              backgroundColor:
                shot.zone === 'bull'  ? '#FFE600'
              : shot.zone === 'inner' ? '#66bb6a'
              : shot.zone === 'outer' ? '#448aff'
              : '#ff5252',
              borderWidth: 1, borderColor: 'rgba(0,0,0,0.3)',
            }} />
          ))}
        </View>
        {/* Legend */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 8 }}>
          {[['#FFE600','Bull'],['#66bb6a','Inner'],['#448aff','Outer'],['#ff5252','Miss']].map(([c, l]) => (
            <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
              <Text style={{ color: '#aaa', fontSize: 10 }}>{l}</Text>
            </View>
          ))}
        </View>
        {/* Cluster insight */}
        {shotMapLog.length >= 4 && (
          <View style={{ backgroundColor: '#0d2b0d', borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#2e7d32' }}>
            <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 12, marginBottom: 4 }}>\uD83D\uDCCD Miss Pattern</Text>
            <Text style={{ color: '#ccc', fontSize: 13, lineHeight: 20 }}>{getClusterInsight()}</Text>
          </View>
        )}
        {shotMapLog.length === 0 && selectedDrill === 'swing-detect' && (
          <Text style={{ color: '#aaa', fontSize: 12, textAlign: 'center', marginTop: 10 }}>Log shots using the zone buttons to populate the map</Text>
        )}
        {shotMapLog.length > 0 && (
          <Pressable onPress={() => setShotMapLog([])} style={{ marginTop: 8, alignSelf: 'flex-end' }}>
            <Text style={{ color: '#aaa', fontSize: 12 }}>Clear Map</Text>
          </Pressable>
        )}
      </View>
      )}

      {/* Swing Detection */}
      {selectedDrill === 'swing-detect' && (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Swing Detection</Text>
        <Text style={{ color: '#ccc', fontSize: 13, marginBottom: 12 }}>
          Hold your phone like a club and swing. The accelerometer counts detected swings.
        </Text>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 4 }}>
          Swings: {swingCount}
        </Text>
        {sensorReps > 0 && (
          <View style={{ marginBottom: 10 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
              Tempo Score: {Math.round((sensorTempoGood / sensorReps) * 100)}%
            </Text>
            <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>
              Good: {sensorTempoGood} | Miss: {sensorTempoMiss}
            </Text>
            <Text style={{ color: '#aaa', fontSize: 11, marginTop: 2 }}>Auto scoring active</Text>
          </View>
        )}
        <Text style={{ color: '#66bb6a', fontSize: 14, fontWeight: '600', marginBottom: 12 }}>
          {sensorTempoFeedback}
        </Text>
        {!isTracking ? (
          <Pressable
            onPress={startTracking}
            style={({ pressed }) => ({ backgroundColor: pressed ? '#1b5e20' : '#2e7d32', padding: 12, borderRadius: 10, alignItems: 'center' })}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>Start Swing Tracking</Text>
          </Pressable>
        ) : (
          <View>
            <Text style={{ color: '#66bb6a', fontWeight: '600', marginBottom: 10 }}>? Tracking active...</Text>
            <Pressable
              onPress={stopTracking}
              style={({ pressed }) => ({ backgroundColor: pressed ? '#b71c1c' : '#c62828', padding: 12, borderRadius: 10, alignItems: 'center' })}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Stop Tracking</Text>
            </Pressable>
          </View>
        )}
        {swingCount > 0 && (
          <Pressable
            onPress={() => { swingDetector.reset(); setSensorTempoGood(0); setSensorTempoMiss(0); setSensorReps(0); setSensorTempoFeedback('No swings yet'); }}
            style={{ marginTop: 10, alignItems: 'flex-end' }}
          >
            <Text style={{ color: '#aaa', fontSize: 12 }}>Reset</Text>
          </Pressable>
        )}
      </View>
      )}

      {/* Swing Camera */}
      {selectedDrill === 'swing-detect' && (
      <View style={styles.card}>
        <Pressable
          onPress={() => setCameraMinimized((v) => !v)}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={styles.sectionTitle}>Swing Camera</Text>
          <Text style={{ color: '#A7F3D0', fontSize: 18, lineHeight: 22 }}>{cameraMinimized ? '\u25BC' : '\u25B2'}</Text>
        </Pressable>
        {!cameraMinimized && (
          <View>
        <Text style={[styles.description, { marginTop: 6 }]}>Record your swing for instant playback and self-review.</Text>

        {/* Permission prompts */}
        {!cameraPermission?.granted && (
          <Pressable
            onPress={requestCameraPermission}
            style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? '#333' : '#1e1e1e', marginTop: 10 }]}
          >
            <Text style={styles.btnText}>Allow Camera Access</Text>
          </Pressable>
        )}
        {cameraPermission?.granted && !micPermission?.granted && (
          <Pressable
            onPress={requestMicPermission}
            style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? '#333' : '#1e1e1e', marginTop: 10 }]}
          >
            <Text style={styles.btnText}>Enable Video Recording</Text>
          </Pressable>
        )}

        {/* Camera preview - shown as soon as camera permission granted */}
        {cameraPermission?.granted && !videoUri && (
          <CameraView
            ref={cameraRef}
            mode="video"
            style={{ height: 300, borderRadius: 12, marginTop: 12, overflow: 'hidden' }}
          />
        )}

        {/* Video playback */}
        {videoUri && (
          <View style={{ marginTop: 12 }}>
            {/* Video with logo watermark overlay */}
            <View style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
              <Video
                ref={videoRef}
                source={{ uri: videoUri }}
                style={{ height: 300 }}
                resizeMode={ResizeMode.CONTAIN}
                onPlaybackStatusUpdate={(status) => {
                  if (status.isLoaded) setIsPlaying(status.isPlaying);
                }}
              />
              {/* Logo watermark - bottom-right corner of video */}
              <View pointerEvents="none" style={{ position: 'absolute', bottom: 10, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 }}>
                <Image source={LOGO} style={{ width: 52, height: 20 }} resizeMode="contain" />
              </View>
            </View>
            {/* Circular icon controls */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <Pressable
                onPress={() => { if (isPlaying) { videoRef.current?.pauseAsync(); } else { videoRef.current?.playAsync(); } }}
                style={({ pressed }) => ({ backgroundColor: pressed ? '#1b5e20' : '#2e7d32', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' })}
              >
                <Text style={{ fontSize: 22 }}>{isPlaying ? '?' : '?'}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (videoUri) {
                    setSwingLibrary((prev) => [{ uri: videoUri, tempo: 'Manual', time: new Date().toLocaleTimeString() }, ...prev]);
                  }
                }}
                style={({ pressed }) => ({ backgroundColor: pressed ? '#1a237e' : '#283593', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' })}
              >
                <Text style={{ fontSize: 22 }}>??</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const a = generatePracticeAnalysis();
                  setPracticeAnalysis(a);
                  setShowPracticeAnalysis(true);
                  // Feed swing path result into shot map
                  const zone = a.path === 'on-plane' ? (a.face === 'square' ? 'bull' : 'inner') : a.path !== undefined ? 'outer' : 'miss';
                  const mapX = a.path === 'outside-in' ? 0.62 + Math.random() * 0.12 : a.path === 'inside-out' ? 0.26 + Math.random() * 0.12 : 0.44 + Math.random() * 0.12;
                  const mapY = 0.3 + Math.random() * 0.35;
                  setShotMapLog((prev) => [...prev, { x: mapX, y: mapY, zone, id: shotIdRef.current++ }]);
                }}
                style={({ pressed }) => ({ backgroundColor: pressed ? '#4a148c' : '#6a1b9a', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' })}
              >
                <Text style={{ fontSize: 22 }}>??</Text>
              </Pressable>
              <Pressable
                onPress={() => { setVideoUri(null); setIsPlaying(false); }}
                style={({ pressed }) => ({ backgroundColor: pressed ? '#b71c1c' : '#c62828', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' })}
              >
                <Text style={{ fontSize: 22 }}>??</Text>
              </Pressable>
              <Pressable
                onPress={() => { setVideoUri(null); setIsPlaying(false); }}
                style={({ pressed }) => ({ backgroundColor: pressed ? '#444' : '#555', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' })}
              >
                <Text style={{ fontSize: 22 }}>??</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 4 }}>
              {[isPlaying ? 'Pause' : 'Play', 'Save', 'Analyze', 'Delete', 'Retake'].map((label) => (
                <Text key={label} style={{ width: 56, color: '#aaa', fontSize: 10, textAlign: 'center' }}>{label}</Text>
              ))}
            </View>

            {/* Swing Analysis Card - shown after tapping Analyze */}
            {showPracticeAnalysis && practiceAnalysis && (() => {
              const a = practiceAnalysis;
              return (
                <View style={{ marginTop: 16, backgroundColor: '#121212', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#6a1b9a' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <Text style={{ color: '#ce93d8', fontWeight: '700', fontSize: 15 }}>Swing Analysis</Text>
                    <Pressable onPress={() => setShowPracticeAnalysis(false)}>
                      <Text style={{ color: '#aaa', fontSize: 14 }}>?</Text>
                    </Pressable>
                  </View>
                  <Text style={{ color: '#ccc', fontSize: 12, lineHeight: 19, marginBottom: 10 }}>{a.summary}</Text>

                  {/* Shot tracer mini-chart */}
                  {(() => {
                    const traceColor = a.path === 'on-plane' ? '#66bb6a' : '#ef4444';
                    const lateralShift = a.path === 'outside-in' ? 34 : a.path === 'inside-out' ? -34 : 0;
                    const peakX = 50 + lateralShift * 0.5;
                    const endX  = 50 + lateralShift;
                    const bx = (t: number) => (1-t)*(1-t)*50 + 2*(1-t)*t*peakX + t*t*endX;
                    const by = (t: number) => (1-t)*(1-t)*88 + 2*(1-t)*t*28 + t*t*16;
                    return (
                      <View style={{ backgroundColor: '#0a1a0a', borderRadius: 10, height: 110, marginBottom: 12, position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: '#1a2a1a' }}>
                        {/* Green surface */}
                        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 24, backgroundColor: '#133a1e' }} />
                        {/* Center line */}
                        <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.06)', transform: [{ translateX: -0.5 }] }} />
                        {/* Target */}
                        <View style={{ position: 'absolute', top: 8, left: '50%', transform: [{ translateX: -8 }], width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff' }} />
                        </View>
                        {/* Tracer segments */}
                        {[0,1,2,3,4,5,6,7].map((i) => {
                          const t0 = i/8; const t1 = (i+1)/8;
                          const x0 = bx(t0); const y0 = by(t0);
                          const x1 = bx(t1); const y1 = by(t1);
                          const dx = x1-x0; const dy = y0-y1;
                          const len = Math.sqrt(dx*dx + dy*dy) * 1.1;
                          const angle = Math.atan2(dx, dy) * (180/Math.PI);
                          return (
                            <View key={i} style={{ position: 'absolute', left: `${x0}%` as any, top: `${y0}%` as any,
                              width: 2.5, height: len, backgroundColor: traceColor, borderRadius: 2, opacity: 0.85,
                              transform: [{ translateX: -1.25 }, { rotate: `${angle}deg` }, { translateY: -len/2 }],
                              shadowColor: traceColor, shadowOpacity: 0.6, shadowRadius: 3 }} />
                          );
                        })}
                        {/* Landing dot */}
                        <View style={{ position: 'absolute', left: `${endX}%` as any, top: '14%', width: 7, height: 7, borderRadius: 4, backgroundColor: traceColor, opacity: 0.9, transform: [{ translateX: -3.5 }] }} />
                        {/* Label */}
                        <View style={{ position: 'absolute', bottom: 5, right: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Text style={{ color: traceColor, fontSize: 9, fontWeight: '700' }}>
                            {a.path === 'outside-in' ? '? Out?In' : a.path === 'inside-out' ? '? In?Out' : '? On-Plane'} - {a.face} face
                          </Text>
                        </View>
                      </View>
                    );
                  })()}

                  {/* Visual tile row */}
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                    {/* Path */}
                    <View style={{ flex: 1, backgroundColor: '#0a0a0a', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                      <Text style={{ color: '#aaa', fontSize: 9, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.7 }}>Path</Text>
                      <View style={{ width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }}>
                        <View style={{ position: 'absolute', width: 48, height: 2, backgroundColor: '#333' }} />
                        <View style={{ position: 'absolute', width: 44, height: 3, backgroundColor: a.path === 'outside-in' ? '#ff5252' : a.path === 'inside-out' ? '#448aff' : '#66bb6a', borderRadius: 2, transform: [{ rotate: a.path === 'outside-in' ? '-18deg' : a.path === 'inside-out' ? '18deg' : '0deg' }] }} />
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff', position: 'absolute' }} />
                      </View>
                      <Text style={{ color: a.path === 'outside-in' ? '#ff5252' : a.path === 'inside-out' ? '#448aff' : '#66bb6a', fontSize: 10, fontWeight: '700', marginTop: 3 }}>
                        {a.path === 'outside-in' ? 'Out?In' : a.path === 'inside-out' ? 'In?Out' : 'On Plane'}
                      </Text>
                    </View>
                    {/* Face */}
                    <View style={{ flex: 1, backgroundColor: '#0a0a0a', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                      <Text style={{ color: '#aaa', fontSize: 9, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.7 }}>Face</Text>
                      <View style={{ width: 36, height: 48, justifyContent: 'center', alignItems: 'center' }}>
                        <View style={{ width: 10, height: 34, backgroundColor: a.face === 'open' ? '#ff5252' : a.face === 'closed' ? '#448aff' : '#66bb6a', borderRadius: 3, transform: [{ rotate: a.face === 'open' ? '15deg' : a.face === 'closed' ? '-15deg' : '0deg' }] }} />
                      </View>
                      <Text style={{ color: a.face === 'open' ? '#ff5252' : a.face === 'closed' ? '#448aff' : '#66bb6a', fontSize: 10, fontWeight: '700', textTransform: 'capitalize' }}>{a.face}</Text>
                    </View>
                    {/* Tempo */}
                    <View style={{ flex: 1, backgroundColor: '#0a0a0a', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                      <Text style={{ color: '#aaa', fontSize: 9, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.7 }}>Tempo</Text>
                      <Text style={{ color: a.tempo === 'smooth' ? '#66bb6a' : '#f9a825', fontSize: 22, fontWeight: '800' }}>
                        {a.tempo === 'smooth' ? '?' : a.tempo === 'fast' ? '?' : '?'}
                      </Text>
                      <Text style={{ color: a.tempo === 'smooth' ? '#66bb6a' : '#f9a825', fontSize: 10, fontWeight: '700', textTransform: 'capitalize' }}>{a.tempo}</Text>
                      <Text style={{ color: '#aaa', fontSize: 10 }}>{a.speedEst} spd</Text>
                    </View>
                    {/* Rotation */}
                    <View style={{ flex: 1, backgroundColor: '#0a0a0a', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                      <Text style={{ color: '#aaa', fontSize: 9, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.7 }}>Rotation</Text>
                      <View style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}>
                        <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 3, borderColor: a.bodyRotation === 'good' ? '#66bb6a' : a.bodyRotation === 'over' ? '#f9a825' : '#555', borderTopColor: 'transparent', transform: [{ rotate: '45deg' }] }} />
                      </View>
                      <Text style={{ color: a.bodyRotation === 'good' ? '#66bb6a' : a.bodyRotation === 'over' ? '#f9a825' : '#ff5252', fontSize: 10, fontWeight: '700' }}>
                        {a.bodyRotation === 'good' ? 'Good' : a.bodyRotation === 'over' ? 'Over' : 'Low'}
                      </Text>
                      <Text style={{ color: '#aaa', fontSize: 10 }}>{a.rotScore}/100</Text>
                    </View>
                  </View>

                  {/* Metrics strip */}
                  <View style={{ flexDirection: 'row', backgroundColor: '#0a0a0a', borderRadius: 8, padding: 10, marginBottom: 12, gap: 6 }}>
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={{ color: '#aaa', fontSize: 9, textTransform: 'uppercase' }}>Plane</Text>
                      <Text style={{ color: a.plane === 'ideal' ? '#66bb6a' : '#f9a825', fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{a.plane}</Text>
                    </View>
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={{ color: '#aaa', fontSize: 9, textTransform: 'uppercase' }}>Peak G</Text>
                      <Text style={{ color: '#ccc', fontSize: 12, fontWeight: '700' }}>{a.peakG}g</Text>
                    </View>
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={{ color: '#aaa', fontSize: 9, textTransform: 'uppercase' }}>Duration</Text>
                      <Text style={{ color: '#ccc', fontSize: 12, fontWeight: '700' }}>{(a.duration / 1000).toFixed(1)}s</Text>
                    </View>
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={{ color: '#aaa', fontSize: 9, textTransform: 'uppercase' }}>Wrist</Text>
                      <Text style={{ color: a.wristRotation === 'normal' ? '#66bb6a' : '#f9a825', fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{a.wristRotation}</Text>
                    </View>
                  </View>

                  {/* Coaching cues */}
                  <View style={{ backgroundColor: '#1a0a2e', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#6a1b9a' }}>
                    <Text style={{ color: '#ce93d8', fontWeight: '700', fontSize: 12, marginBottom: 6 }}>Coaching Cues</Text>
                    {a.cues.map((cue, ci) => (
                      <Text key={ci} style={{ color: '#ccc', fontSize: 12, lineHeight: 18, marginBottom: 2 }}>{cue}</Text>
                    ))}
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Record / Retake controls */}
        {cameraPermission?.granted && (
          <View style={{ flexDirection: 'row', marginTop: 12 }}>
            {!videoUri ? (
              !micPermission?.granted ? (
                <Pressable
                  onPress={requestMicPermission}
                  style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? '#333' : '#1e1e1e' }]}
                >
                  <Text style={styles.btnText}>Enable Video Recording</Text>
                </Pressable>
              ) : !recording ? (
                <Pressable
                  onPress={startRecording}
                  style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? '#1b5e20' : '#2e7d32', marginRight: 8 }]}
                >
                  <Text style={styles.btnText}>? Start Video</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={stopRecording}
                  style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? '#b71c1c' : '#c62828' }]}
                >
                  <Text style={styles.btnText}>? Stop Video</Text>
                </Pressable>
              )
            ) : null}
          </View>
        )}
          </View>
        )}
      </View>
      )}

      {/* Swing Library */}
      {selectedDrill === 'swing-detect' && swingLibrary.length > 0 && (() => {
        const filteredSwings = swingLibrary.filter((swing) => {
          if (swingFilter === 'good') return swing.tempo.includes('Good') || swing.tempo === 'Manual';
          if (swingFilter === 'bad') return !swing.tempo.includes('Good') && swing.tempo !== 'Manual';
          return true;
        });
        const bestSwing = swingLibrary.find((s) => s.tempo.includes('Good')) ?? null;
        const latestSwing = swingLibrary[0];
        return (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.sectionTitle}>Swing Library</Text>
              <Pressable onPress={() => setSwingLibrary([])}>
                <Text style={{ color: '#c62828', fontSize: 12 }}>Clear All</Text>
              </Pressable>
            </View>
            <Text style={{ color: '#aaa', fontSize: 12, marginBottom: 10 }}>{swingLibrary.length} swing{swingLibrary.length !== 1 ? 's' : ''} saved</Text>

            {/* Best Swing */}
            {bestSwing && (
              <View style={{ backgroundColor: '#2e7d32', padding: 12, borderRadius: 12, marginBottom: 16 }}>
                <Text style={{ color: '#fff', fontWeight: '600', marginBottom: 6 }}>Best Swing ??</Text>
                <Video source={{ uri: bestSwing.uri }} style={{ height: 180, borderRadius: 8 }} useNativeControls resizeMode={ResizeMode.CONTAIN} />
                <Text style={{ color: '#e0f2f1', fontSize: 12, marginTop: 6 }}>Use this as your reference</Text>
              </View>
            )}

            {/* Compare */}
            {bestSwing && latestSwing && bestSwing.uri !== latestSwing.uri && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: '#fff', fontWeight: '600', marginBottom: 10 }}>Compare Swings</Text>
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1, marginRight: 4 }}>
                    <Text style={{ color: '#66bb6a', fontSize: 12, marginBottom: 4 }}>Best</Text>
                    <Video source={{ uri: bestSwing.uri }} style={{ height: 140, borderRadius: 8 }} useNativeControls resizeMode={ResizeMode.CONTAIN} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 4 }}>
                    <Text style={{ color: '#ccc', fontSize: 12, marginBottom: 4 }}>Latest</Text>
                    <Video source={{ uri: latestSwing.uri }} style={{ height: 140, borderRadius: 8 }} useNativeControls resizeMode={ResizeMode.CONTAIN} />
                  </View>
                </View>
                <Text style={{ color: '#66bb6a', fontSize: 13, fontWeight: '600', marginTop: 10 }}>
                  {getSwingInsight(bestSwing, latestSwing)}
                </Text>
              </View>
            )}

            {/* Filter */}
            <View style={{ flexDirection: 'row', marginBottom: 12 }}>
              {(['all', 'good', 'bad'] as const).map((type) => (
                <Pressable key={type} onPress={() => setSwingFilter(type)}
                  style={{ backgroundColor: swingFilter === type ? '#2e7d32' : '#1e1e1e', padding: 8, borderRadius: 8, marginRight: 6 }}>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: swingFilter === type ? '700' : '400' }}>{type.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>

            {filteredSwings.length === 0 ? (
              <Text style={{ color: '#aaa', fontSize: 13 }}>No swings match this filter.</Text>
            ) : (
              filteredSwings.map((swing, index) => (
                <View key={index} style={{ backgroundColor: '#1e1e1e', padding: 10, borderRadius: 10, marginBottom: 10 }}>
                  <Video source={{ uri: swing.uri }} style={{ height: 150, borderRadius: 8 }} useNativeControls resizeMode={ResizeMode.CONTAIN} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <View>
                      <Text style={{ color: '#ccc', fontSize: 12 }}>{swing.time}</Text>
                      <Text style={{ color: swing.tempo.includes('Good') ? '#66bb6a' : swing.tempo === 'Manual' ? '#aaa' : '#ff5252', fontSize: 12, marginTop: 2 }}>{swing.tempo}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable
                        onPress={() => handleSaveSwingToLibrary(swing.uri)}
                        style={({ pressed }) => [{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: pressed ? '#1565c0' : '#1976d2' }]}
                      >
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Save</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleShareSwing(swing.uri)}
                        style={({ pressed }) => [{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: pressed ? '#555' : '#37474f' }]}
                      >
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Share</Text>
                      </Pressable>
                      <Pressable onPress={() => setSwingLibrary((prev) => prev.filter((_, i) => i !== index))}>
                        <Text style={{ color: '#c62828', fontSize: 12 }}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        );
      })()}
    </ScrollView>

    {/* Rangefinder FAB - bottom-right */}
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

    {/* ── Ask Caddie AI Modal ─────────────────────────────────────────────── */}
    <Modal visible={showAskCaddie} animationType="slide" transparent onRequestClose={() => setShowAskCaddie(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#0d2b1a', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, borderTopWidth: 1.5, borderColor: '#16a34a' }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <Image source={require('../../assets/images/logo.png')} style={{ width: 36, height: 36, borderRadius: 999 }} resizeMode="cover" />
              <Text style={{ color: '#A7F3D0', fontSize: 17, fontWeight: '800', marginLeft: 10, flex: 1 }}>Ask Your Caddie 🎙</Text>
              <Pressable onPress={() => setShowAskCaddie(false)} style={{ padding: 6 }}>
                <Text style={{ color: '#6b7280', fontSize: 20 }}>✕</Text>
              </Pressable>
            </View>

            {/* Input */}
            <TextInput
              autoFocus
              multiline
              placeholder="Ask anything — rules, club selection, mental game..."
              placeholderTextColor="#3d7a5a"
              value={askText}
              onChangeText={setAskText}
              style={{ backgroundColor: '#0a1f14', borderRadius: 12, padding: 14, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#1e4d2e', minHeight: 80, textAlignVertical: 'top', marginBottom: 12 }}
            />

            {/* Ask button */}
            <Pressable
              onPress={() => void askCaddie()}
              disabled={askLoading || askText.trim().length === 0}
              style={({ pressed }) => ({ backgroundColor: askLoading || askText.trim().length === 0 ? '#1a3d28' : pressed ? '#14532d' : '#16a34a', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 12, borderWidth: 1.5, borderColor: '#4ade80' })}
            >
              {askLoading
                ? <ActivityIndicator color="#A7F3D0" />
                : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>🎙 Ask Caddie</Text>}
            </Pressable>

            {/* Answer card */}
            {askAnswer.length > 0 && !askLoading && (
              <View style={{ backgroundColor: '#0a2e1a', borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: '#16a34a' }}>
                <Text style={{ color: '#A7F3D0', fontSize: 14, lineHeight: 22 }}>{askAnswer}</Text>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#0B3D2E',
  },
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  heading: {
    color: '#A7F3D0',
    fontSize: 22,
    fontFamily: 'Outfit_700Bold',
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#A7F3D0',
    fontSize: 11,
    fontFamily: 'Outfit_700Bold',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  drillOption: {
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#1e1e1e',
    borderWidth: 1,
    borderColor: '#333',
  },
  drillSelected: {
    backgroundColor: '#2e7d32',
    borderColor: '#66bb6a',
  },
  drillLabel: {
    color: '#ccc',
    fontSize: 14,
    fontFamily: 'Outfit_500Medium',
  },
  description: {
    color: '#bbb',
    fontSize: 13,
    fontFamily: 'Outfit_400Regular',
    lineHeight: 20,
    marginBottom: 14,
  },
  progressText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Outfit_400Regular',
    marginBottom: 6,
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#1e1e1e',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: 10,
    backgroundColor: '#2e7d32',
    borderRadius: 5,
  },
  btn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 14,
  },
  complete: {
    color: '#66bb6a',
    marginTop: 14,
    fontSize: 14,
    fontFamily: 'Outfit_600SemiBold',
    textAlign: 'center',
  },
});