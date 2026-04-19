import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import Svg, { Path, Circle } from 'react-native-svg';
import ShotCorrectionPrompt from '../../components/ShotCorrectionPrompt';
import { analyzePatterns, getRecommendedClub } from '../../services/patternEngine';
import { VoiceTimingController } from '../../services/voiceTimingController';
import { DS, Palette, Space, Type, Radius } from '../../constants/theme';
import { useLayout } from '../../hooks/use-layout';
import {
  View, Text, Pressable, StyleSheet, Image, Animated,
  ScrollView, Modal, Linking,
} from 'react-native';
import BrandHeader from '../../components/BrandHeader';
import SaveProgressModal from '../../components/SaveProgressModal';
import SmartHint from '../../components/SmartHint';
import { useSmartHint } from '../../hooks/useSmartHint';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { speakJob, cancelAll as engineCancelAll, PRIORITY as ENGINE_PRIORITY, getEngineState } from '../../services/VoiceEngine';
import { setGlobalGender } from '../../services/voiceService';
import CaddieMicButton from '../../components/CaddieMicButton';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useMemoryStore } from '../../store/memoryStore';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { BiometricLayoutControls } from '../_layout';
import { useUserStore } from '../../store/userStore';
import { COURSE_DB } from '../../data/courses';
import type { ImageSourcePropType } from 'react-native';


import { MaterialCommunityIcons as MCIcon } from '@expo/vector-icons';
import { useAiProfileStore, buildAiHint } from '../../store/aiProfileStore';
import { analyzeRoundInBackground } from '../../services/roundAnalyzer';
import { analyzeRound } from '../../features/smartCaddie/engine/RoundAnalysis';
import { generateInsights } from '../../features/smartCaddie/engine/InsightEngine';
import type { RoundInsight } from '../../features/smartCaddie/engine/InsightEngine';
import type { RoundAnalysis } from '../../features/smartCaddie/engine/RoundAnalysis';
import { PostRoundSummary } from '../../features/postRound/PostRoundSummary';
import { buildRecommendation } from '../../services/caddieRecommendationEngine';
import { applyPersonality, scoreAdvice } from '../../features/caddie/personalities';
import { deriveLocalBias, buildRoundSummary } from '../../services/localLearning';
import ShotVisionPlayer from '../../components/ShotVisionPlayer';
import { SmartVisionIcon } from '../../components/icons/IconBase';
import ShotCamera from '../../components/ShotCamera';
import { useWatchSync } from '../../hooks/useWatchSync';
import { useGolfGPS } from '../../hooks/useGolfGPS';
import { useUnifiedGPS } from '../../core/hooks/useUnifiedGPS';
import { useSmartAudio } from '../../core/hooks/useSmartAudio';
import { buildClubDispersion, predictClubMiss, aimAdjustment, missLabel as clubMissLabel } from '../../features/smartCaddie/engine/ClubDispersion';
import { useCourseDetection } from '../../features/courses/engine/detectCourse';
import { COURSE_GPS } from '../../features/courses/data/courseGPS';
import TeeTimeModal from '../../components/TeeTimeModal';
import { useHoleProgression } from '../../hooks/useHoleProgression';
import { useValidationStore } from '../../features/course/useValidationStore';
import ValidationPanel from '../../features/course/ValidationPanel';
import { useTips } from '../../features/tutorial/useTips';
import TipCard from '../../features/tutorial/TipCard';
import ValidationSummary from '../../features/course/ValidationSummary';
import { useSmartCaddie } from '../../features/smartCaddie/hooks/useSmartCaddie';
import { CaddieCard } from '../../features/smartCaddie/components/CaddieCard';
import { useShotTracking } from '../../features/smartCaddie/hooks/useShotTracking';
import { useShotDetection } from '../../features/smartCaddie/hooks/useShotDetection';
import { detectClub, resolvePlayerDistances } from '../../features/smartCaddie/engine/ClubDetection';
import { useBagStore } from '../../store/bagStore';
import { getClubAdjustment } from '../../features/smartCaddie/engine/PlayerAdaptation';
import { buildPlayerModel } from '../../features/smartCaddie/engine/PlayerLearning';
import { adjustClub } from '../../features/smartCaddie/engine/ClubEngine';
import { useRoundStore as useCaddieRoundStore, getRoundShotsSnapshot } from '../../features/smartCaddie/hooks/useRoundStore';
import { buildTodaySwing } from '../../features/smartCaddie/engine/TodaySwing';
import { combineModels } from '../../features/smartCaddie/engine/CombinedPlayerModel';
import { speakHoleChange, speakPressureCue } from '../../features/smartCaddie/hooks/useCaddieVoice';
import { useVoiceController } from '../../features/voice/useVoiceController';
import { VoiceMicButton } from '../../features/voice/VoiceMicButton';
import { PuttLine } from '../../features/playView/components/PuttLine';
import { calculateBreak, type SlopeDirection } from '../../features/playView/engine/GreenRead';
import { detectHazardsOnLine } from '../../features/playView/engine/LineProjection';
import { getEffectiveDistance } from '../../features/smartCaddie/engine/EffectiveDistance';
import type { WindState } from '../../features/smartCaddie/engine/WindEngine';
import type { ElevationState } from '../../features/smartCaddie/engine/ElevationEngine';
import { handleFocusInput } from '../../engine/focusEngine';
import { haversineYards, pixelToGPS } from '../../utils/gpsMapping';
import { buildFocusContext } from '../../engine/contextBuilder';
import { getAIResponse as _focusAICaller } from '../../services/aiService';
const ICON_RANGEFINDER  = require('../../assets/images/icon-rangefinder.png');

const DEFAULT_CLUB_YARDS: Record<string, number> = {
  Driver: 230, '3 Wood': 215, '5 Wood': 200,
  '3 Iron': 185, '4 Iron': 175, '5 Iron': 165, '6 Iron': 155,
  '7 Iron': 145, '8 Iron': 135, '9 Iron': 125,
  PW: 115, GW: 100, SW: 85, LW: 70, Putter: 10,
};

const HOLE_DISTANCES = [380, 160, 520, 410, 370, 180, 400, 540, 390];

// Placeholder URLs removed — local fallback View is used when no real URL is set
const FULL_PLACEHOLDER  = '';

// NOTE: Hole images are now derived dynamically from COURSE_DB via selectedCourseIdx.
// The static arrays below are kept for backwards-compat but are ignored at runtime.
// Per-hole thumbnail URIs (<50 KB each). Replace with real URLs.
const HOLE_THUMBNAILS: (string | null)[] = [
  null, null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null, null, null,
];

// Per-hole full-resolution images. Replace with real URLs.
const HOLE_FULL_IMAGES: (string | null)[] = [
  null, null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null, null, null,
];

// Per-hole normalized shot line coordinates (0–1). If null, defaults to straight-line tee→green.
// Palms course: tee = bottom of image (y≈0.88), green = top (y≈0.12).
// Dogleg/offset holes use shifted x values to match the real hole shape.
type HoleOverlay = { start: { x: number; y: number }; target: { x: number; y: number } };
const HOLE_OVERLAYS: (HoleOverlay | null)[] = [
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 1  – straight, wide landing
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.38, y: 0.12 } }, // 2  – slight left of center at green (water short-left)
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.65, y: 0.12 } }, // 3  – dogleg right
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 4  – par 5, straight
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.38, y: 0.12 } }, // 5  – dogleg left
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 6  – par 3, center
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.35, y: 0.12 } }, // 7  – water right, aim left
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 8  – straight
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 9  – par 5, straight
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.62, y: 0.12 } }, // 10 – slight dogleg right
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 11 – long par 4, straight
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 12 – par 3, center
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.42, y: 0.12 } }, // 13 – par 5, slight left
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 14 – straight par 4
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.38, y: 0.12 } }, // 15 – subtle dogleg left, water short
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 16 – par 3, island green center
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.35, y: 0.12 } }, // 17 – water left off tee, bail right → aim left of center
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.55, y: 0.12 } }, // 18 – par 5 finishing hole
];

const LOGO             = require('../../assets/images/logo.png');

export default function Caddie() {
  const router       = useRouter();
  const { screenW, isLarge, hPad, cardPadding } = useLayout();
  const tabBarHeight = useBottomTabBarHeight();

  // â”€â”€ Stores â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const setIsGuest      = useUserStore((s) => s.setIsGuest);
  const isGuest         = useUserStore((s) => s.isGuest);
  const caddieName      = useUserStore((s) => s.caddieName);

  const courseMemory    = useMemoryStore((s) => s.courseMemory);
  const clubUsage       = useMemoryStore((s) => s.clubUsage);
  const currentHole     = useRoundStore((s) => s.currentHole);
  const setCurrentHole  = useRoundStore((s) => s.setCurrentHole);
  const isRoundActive   = useRoundStore((s) => s.isRoundActive);
  const goalMode        = useRoundStore((s) => s.goalMode);
  const strategyMode    = useRoundStore((s) => s.strategyMode);
  const storePar        = useRoundStore((s) => s.currentPar);
  const setCurrentPar   = useRoundStore((s) => s.setCurrentPar);
  const activeCourse       = useRoundStore((s) => s.activeCourse) || 'Menifee Lakes — Palms';
  const selectedCourseIdx  = useRoundStore((s) => s.selectedCourseIdx);
  const club            = useRoundStore((s) => s.club);
  const setClub         = useRoundStore((s) => s.setClub);
  const targetDistance  = useRoundStore((s) => s.targetDistance);
  const scores              = useRoundStore((s) => s.scores);
  const setScore            = useRoundStore((s) => s.setScore);
  const gridScores          = useRoundStore((s) => s.gridScores);
  const gridPlayerNames     = useRoundStore((s) => s.gridPlayerNames);
  const activePlayerCount   = useRoundStore((s) => s.activePlayerCount);
  const setCourseHoleScore  = useRoundStore((s) => s.setCourseHoleScore);
  const shots               = useRoundStore((s) => s.shots);
  const addShot             = useRoundStore((s) => s.addShot);
  const adjustLastShot      = useRoundStore((s) => s.adjustLastShot);
  const tagLastShotMedia    = useRoundStore((s) => s.tagLastShotMedia);
  const clearRound          = useRoundStore((s) => s.clearRound);
  const setIsRoundActive    = useRoundStore((s) => s.setIsRoundActive);
  const caddiePersonality = useSettingsStore((s) => s.caddiePersonality);
  const voiceStyle      = useSettingsStore((s) => s.voiceStyle);
  const setVoiceStyle   = useSettingsStore((s) => s.setVoiceStyle);
  const voiceGender     = useSettingsStore((s) => s.voiceGender);
  const setVoiceGender  = useSettingsStore((s) => s.setVoiceGender);
  const voiceEnabled    = useSettingsStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useSettingsStore((s) => s.setVoiceEnabled);
  const highContrast    = useSettingsStore((s) => s.highContrast);
  const setHighContrast = useSettingsStore((s) => s.setHighContrast);
  const brightMode      = useSettingsStore((s) => s.brightMode);
  const setBrightMode   = useSettingsStore((s) => s.setBrightMode);


  // ── Smart hints ──────────────────────────────────────────────────────────────
  const { hint: smartHint, showHint } = useSmartHint();

  // Sync voiceGender → voiceService whenever it changes
  useEffect(() => { setGlobalGender(voiceGender); }, [voiceGender]);

  // Reset thumb error + ball position to tee on hole change; prefetch next hole thumbnail
  useEffect(() => {
    setThumbError(false);
    // Clear any visible shot feedback from the previous hole
    setShotFeedback({ visible: false, result: '', insight: '' });
    setShowCorrection(false);
    // Auto-populate caddie message so advice card is never blank on hole load
    setCaddieMsg('');   // clear previous hole msg; currentAdvice useMemo will show inline
    // Init ball at hole tee (from HOLE_OVERLAYS if available, else default tee position)
    const overlay = HOLE_OVERLAYS[currentHole - 1];
    setBallPosition({ x: overlay?.start.x ?? 0.5, y: overlay?.start.y ?? 0.9 });
    setTargetPosition(null);
    setOriginalTarget(null);
    originalFadeAnim.setValue(1);
    if (originalFadeTimer.current) { clearTimeout(originalFadeTimer.current); originalFadeTimer.current = null; }
    const nextUri = HOLE_THUMBNAILS[currentHole]; // index = next hole (currentHole is 1-based)
    if (nextUri) { Image.prefetch(nextUri).catch(() => {}); }
  }, [currentHole]);

  // Smart hint — show 'caddie' hint once on first mount, 'course' once round starts
  useEffect(() => { showHint('caddie'); }, []);
  useEffect(() => {
    if (isRoundActive) {
      showHint('course');
      // Tip: let user know caddie handles everything
      checkAndShow('round_start', () => showTip('round_start', "You can just play. Caddie handles tracking, planning, and shot analysis."));
    }
  }, [isRoundActive]);

  // ── Caddie voice cues ────────────────────────────────────────────────────
  // Speak hole number when hole changes (skip hole 1 — swing thought already spoken)
  const prevHoleRef = useRef<number>(0);
  useEffect(() => {
    if (!isRoundActive) return;
    if (currentHole !== prevHoleRef.current && currentHole > 1) {
      speakHoleChange(currentHole);
    }
    prevHoleRef.current = currentHole;
    // Clear post-shot visualization when moving to a new hole
    setShotStartPixel(null);
    setActualShotResult(null);
  }, [currentHole, isRoundActive]);

  // â”€â”€ Local state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [gpsMiddle,       setGpsMiddle]       = useState<number | null>(null);

  // ── Golf GPS hooks ──────────────────────────────────────────────────────
  const golfGPS    = useGolfGPS();
  // Continuous smoothed GPS — drives live ball dot on map + putt distance
  const unifiedGPS = useUnifiedGPS();
  const { playSoundTap, playSoundConfirm } = useSmartAudio();
  const [lockedDistance,  setLockedDistance]  = useState<number | null>(null);

  // ── Wind + Elevation ─────────────────────────────────────────────────────
  const [wind,      setWind]      = useState<WindState>({ speed: 10, direction: 'head' });
  const [elevation, setElevation] = useState<ElevationState>('flat');

  const [caddieMsg,       setCaddieMsg]       = useState('');
  const [isSpeaking,      setIsSpeaking]      = useState(false);
  const [earbudMode,      setEarbudMode]      = useState(false);
  const [focusMode,       setFocusMode]       = useState(false);
  // lowPowerMode is persisted in settingsStore — single source of truth shared across screens
  const lowPowerMode    = useSettingsStore((s) => s.lowPowerMode);
  const setLowPowerMode = useSettingsStore((s) => s.setLowPowerMode);
  const [shakeWakeEnabled, setShakeWakeEnabled] = useState(false);
  const biometricEnabled    = useUserStore((s) => s.biometricEnabled);
  const setBiometricEnabled = useUserStore((s) => s.setBiometricEnabled);
  const [showToolsMenu,   setShowToolsMenu]   = useState(false);
  const [showTeeTime,     setShowTeeTime]     = useState(false);
  const [teeTimeUrl,      setTeeTimeUrl]      = useState('');
  const [teeTimeTitle,    setTeeTimeTitle]    = useState('');
  const [showSaveProgress, setShowSaveProgress] = useState(false);
  const [showShotVision,  setShowShotVision]  = useState(false);
  const [showShotCamera,  setShowShotCamera]  = useState(false);
  const [lastVideoUri,    setLastVideoUri]    = useState<string | null>(null);
  // SmartVision is always active — no toggle
  const autoShotVision = true;


  // ── Post-shot visualization state ────────────────────────────────────────────
  const [shotStartPixel,  setShotStartPixel]  = useState<{ x: number; y: number } | null>(null);
  const [actualShotResult, setActualShotResult] = useState<'good' | 'left' | 'right' | 'short' | 'long' | null>(null);
  const actualShotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markShotUsedRef   = useRef(false);   // prevent double-trigger per shot
  const isRecordingRef    = useRef(false);   // SmartVision recording in progress
  const lastShotTimeRef   = useRef<number>(0); // timestamp of last marked shot
  const lastGpsRef        = useRef<{ lat: number; lng: number } | null>(null); // for stationary check
  const [holeScore,       setHoleScore]       = useState(0);
  const [activePlayerIdx, setActivePlayerIdx] = useState(0);
  const [showHolePreview, setShowHolePreview] = useState(false);
  const [showCourseInfo,  setShowCourseInfo]  = useState(false);
  const [thumbError,      setThumbError]      = useState(false);

  // ── Contextual tip system ─────────────────────────────────────────────────
  const { checkAndShow } = useTips();
  const [activeTip, setActiveTip] = useState<{ key: string; text: string } | null>(null);
  const showTip = useCallback((key: string, text: string) => {
    setActiveTip({ key, text });
  }, []);
  const [previewImgSize,  setPreviewImgSize]  = useState({ w: 1, h: 1 });
  const previewFadeAnim = useRef(new Animated.Value(0)).current;
  const [showCorrection,  setShowCorrection]  = useState(false);
  // ── Golfshot-style interactive hole map state ──────────────────────────────
  // Normalized (0–1) coordinates matching HOLE_OVERLAYS convention (y=0.82 = tee, y=0.18 = green)
  const [ballPosition,    setBallPosition]    = useState({ x: 0.5, y: 0.82 });
  // Pixel coords within the rendered image (null = no target set)
  const [targetPosition,  setTargetPosition]  = useState<{ px: number; py: number } | null>(null);
  // Original tap coord — stored when user first taps, held for "Your Aim" line
  const [originalTarget, setOriginalTarget]  = useState<{ px: number; py: number } | null>(null);
  const originalFadeAnim = useRef(new Animated.Value(1)).current;
  const originalFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapSize,         setMapSize]         = useState({ w: 1, h: 1 });
  // ── Putt Mode (green reading) ──────────────────────────────────────────────
  const [puttMode,        setPuttMode]        = useState(false);
  const [puttBall,        setPuttBall]        = useState<{ x: number; y: number } | null>(null);
  // ── Hole progression toast ────────────────────────────────────────────────
  const [holeAdvanceToast, setHoleAdvanceToast] = useState<{ from: number; to: number } | null>(null);
  const holeToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [puttHole,        setPuttHole]        = useState<{ x: number; y: number } | null>(null);
  const [slopeDirection,  setSlopeDirection]  = useState<SlopeDirection>(null);
  const holePar = storePar > 0 ? storePar : 4;

  // ── Validation Mode ────────────────────────────────────────────────────────
  const {
    validationMode, setValidationMode,
    validations,
    getHoleValidation, setYardageAdjustment, setParOverride, toggleTag, clearHole,
    getSummary,
  } = useValidationStore();
  const [showValidationSummary, setShowValidationSummary] = useState(false);
  // ── Post-round summary modal ───────────────────────────────────────────────
  const [showPostRound,      setShowPostRound]      = useState(false);
  const [postRoundAnalysis,  setPostRoundAnalysis]  = useState<RoundAnalysis | null>(null);
  const [postRoundInsights,  setPostRoundInsights]  = useState<RoundInsight[]>([]);
  const pendingNavRef = useRef<() => void>(() => {});  // nav action deferred until user dismisses
  // ── Course-derived hole images ─────────────────────────────────────────────
  // Pull thumbnail/fullImage from the active course in COURSE_DB, indexed by currentHole.
  // Falls back to undefined (renders local fallback View) when no image is configured.
  const activeCourseData = COURSE_DB[selectedCourseIdx] ?? COURSE_DB[0];
  const baseHolesForSummary = (activeCourseData?.holes ?? []).map(
    (h: { par?: number; distance?: number }, i: number) => ({
      hole: i + 1,
      par: h.par ?? 4,
      yardage: h.distance ?? HOLE_DISTANCES[i] ?? 350,
    })
  );
  const holeThumbSource: ImageSourcePropType | undefined =
    activeCourseData?.holes[currentHole - 1]?.thumbnail;
  const holeFullSource: ImageSourcePropType | undefined =
    activeCourseData?.holes[currentHole - 1]?.fullImage;

  // Shot tracking
  const [aimTarget,    setAimTarget]    = useState<'left' | 'center' | 'right'>('center');
  const [shotFeedback, setShotFeedback] = useState<{ visible: boolean; result: string; insight: string }>({ visible: false, result: '', insight: '' });
  // Auto-detection toast + club correction
  const [autoShotToast, setAutoShotToast]     = useState<string | null>(null);
  const autoShotToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detectedShotClub, setDetectedShotClub] = useState<import('../../types/club').ClubName | null>(null);
  const [detectedShotYards, setDetectedShotYards] = useState<number | null>(null);
  const [showClubCorrection, setShowClubCorrection] = useState(false);
  const detectedShotTsRef = useRef<number | null>(null);

  // ── Swing Thought Suggestion ───────────────────────────────────────────────
  const [swingThought,           setSwingThought]           = useState<string | null>(null);
  const [swingThoughtSuggestion, setSwingThoughtSuggestion] = useState<string | null>(null);
  const dismissedAtHoleRef = useRef<number>(-99);
  const SUGGESTION_COOLDOWN_HOLES = 4;
  // Per-thought cooldown: prevent re-triggering within 30 s of last suggestion
  const lastSuggestionTimeRef = useRef<number>(0);

  // ── SmartVision result overlay ────────────────────────────────────────────
  const [visionOverlay, setVisionOverlay] = useState<string | null>(null);
  const visionOverlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest hazard-on-line warnings (updated by map useMemo, read by voice follow-up)
  const hazardWarningsRef = useRef<import('../../features/voice/FollowUpEngine').HazardInfo[]>([]);

  // Pulse animation for Ask Caddie
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef  = useRef<Animated.CompositeAnimation | null>(null);
  const rfScale   = useRef(new Animated.Value(1)).current;

  // ── Processing guard — prevents double-trigger on rapid shot button taps ──
  const isProcessingShotRef = useRef(false);

  // ── Hole-map drag interaction refs ────────────────────────────────
  // Debounce drag updates to 60ms — avoids excessive re-renders during move
  const dragDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track last hazard nudge so voice tip fires once per hazard, not per frame
  const lastNudgedHazardRef = useRef<string | null>(null);
  // Pulse animation on target ring when hazard nudge is applied (scale 1→1.25→1)
  const nudgeAnim = useRef(new Animated.Value(1)).current;

  // ── SmartVision premium animations ──────────────────────────────────────
  // Fade-in for shot line, hazard overlays and yardage cards when target is set
  const svFadeAnim     = useRef(new Animated.Value(0)).current;
  // Smoothly animate the target ring to its new position instead of jumping
  const animatedTarget = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // ── Haptic cooldown — prevents vibration spam during fast drags ───────
  const lastHapticRef = useRef<number>(0);
  const triggerHaptic = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light, minGap = 300) => {
    const now = Date.now();
    if (now - lastHapticRef.current < minGap) return;
    lastHapticRef.current = now;
    try { void Haptics.impactAsync(style); } catch {}
  };

  // Trigger fade-in + target glide when a target is placed/moved
  useEffect(() => {
    if (!targetPosition) return;
    svFadeAnim.setValue(0);
    Animated.timing(svFadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    Animated.timing(animatedTarget, {
      toValue: { x: targetPosition.px - 13, y: targetPosition.py - 13 },
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [targetPosition]);

  // â”€â”€ Computed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const holeDistance   = HOLE_DISTANCES[Math.min(currentHole - 1, HOLE_DISTANCES.length - 1)];

  // Live GPS distance to the hole's green center — same source as SmartFinder CTR.
  // Priority: locked → manual target → live GPS middle → legacy gpsMiddle → static fallback.
  const unifiedMiddleDist = useMemo(() => {
    const holeData = activeCourseData?.holes[currentHole - 1];
    if (!holeData?.middle || !unifiedGPS.location) return null;
    const d = unifiedGPS.distanceTo(holeData.middle.lat, holeData.middle.lng);
    return d !== null ? Math.round(d) : null;
  }, [activeCourseData, currentHole, unifiedGPS.location, unifiedGPS.distanceTo]);

  const displayDistance = lockedDistance ?? targetDistance ?? unifiedMiddleDist ?? gpsMiddle ?? holeDistance;

  // Effective distance = raw distance adjusted for wind + elevation
  const effectiveDistResult = useMemo(
    () => getEffectiveDistance({ baseDistance: displayDistance ?? 0, wind, elevation }),
    [displayDistance, wind, elevation],
  );
  const effectiveDistance = effectiveDistResult.effective;

  const { shots: clubShots, logShot, recordResult } = useShotTracking();
  const { roundShots, addRoundShot, resetRound: resetCaddieRound } = useCaddieRoundStore();

  // ── Automatic shot detection (GPS movement) ───────────────────────────────
  // Bag store for club detection
  const bagClubs        = useBagStore((s) => s.selectedClubs);
  const clubDistances   = useBagStore((s) => s.clubDistances);
  const learnClubDist   = useBagStore((s) => s.learnClubDistance);

  const { phase: detectPhase } = useShotDetection({
    location: unifiedGPS.location,
    enabled:  isRoundActive,
    suppressIf: () =>
      showHolePreview ||           // putt/map modal open
      isProcessingShotRef.current, // manual shot already being recorded
    onShot: (detected) => {
      // ── Predict club from distance + context ────────────────────────────
      const playerDist = resolvePlayerDistances(clubDistances);
      const { club: predictedClub, confidence: clubConf } = detectClub({
        yards:           detected.yards,
        playerDistances: playerDist,
        bagClubs:        bagClubs.length > 0 ? bagClubs : [],
        context: {
          // Tee shot heuristic: first shot on par-4/5 (shot index tracked via addShot call count)
          isTeeShot: false,
          isOnGreen: false,
        },
      });

      // Log into the same round store used by the manual button
      addShot({
        result:            'center',
        club:              predictedClub,
        aim:               aimTarget,
        target:            aimTarget,
        gpsDistance:       detected.yards,
        adjustedDistance:  null,
        distanceOffset:    0,
        directionOffset:   null,
        mental:            'neutral',
        distance:          detected.yards,
        timestamp:         detected.timestamp,
        hole:              currentHole,
      });

      // Feed into learning system
      addRoundShot({
        recommended: caddie.recommendedClub ?? predictedClub,
        selected:    predictedClub,
        distance:    detected.yards,
        result:      'good',
        timestamp:   detected.timestamp,
      });

      // Auto-learn distance for predicted club (only if confident enough)
      if (clubConf >= 0.7) {
        learnClubDist(predictedClub, detected.yards);
      }

      // Store for correction UI
      setDetectedShotClub(predictedClub);
      setDetectedShotYards(detected.yards);
      detectedShotTsRef.current = detected.timestamp;
      setShowClubCorrection(false);

      // Brief toast
      if (autoShotToastTimer.current) clearTimeout(autoShotToastTimer.current);
      setAutoShotToast(`${detected.yards} yds`);
      autoShotToastTimer.current = setTimeout(() => {
        setAutoShotToast(null);
        setDetectedShotClub(null);
        setDetectedShotYards(null);
        setShowClubCorrection(false);
      }, 8_000);

      // Contextual tip: first auto-detected shot
      checkAndShow('shot_detected', () => showTip('shot_detected', "Caddie just tracked your shot automatically."));

      // Update last-shot timestamp so manual cooldown guard stays in sync
      lastShotTimeRef.current = detected.timestamp;
    },
  });
  const learnedModel  = buildPlayerModel(clubShots);

  // ── Per-club dispersion model ──────────────────────────────────────────────
  const dispersionMap  = buildClubDispersion(
    roundShots.map((s) => ({ club: s.selected, result: s.result as any, distance: s.distance }))
  );
  const currentMiss    = predictClubMiss(dispersionMap[club ?? '']);
  const dispersionNudge = aimAdjustment(currentMiss);
  const todayModel    = buildTodaySwing(roundShots);
  const combinedModel = combineModels(learnedModel, todayModel);
  // Combined model unifies long-term and today bias for club adjustment
  const adjustment = combinedModel.clubBias !== 0
    ? Math.round(combinedModel.clubBias)
    : getClubAdjustment(clubShots);

  const caddie = useSmartCaddie({ holeNumber: currentHole, distance: effectiveDistance, adjustment, roundShots });

  // Speak pressure cue once when pressure transitions to 'high'
  const prevPressureRef = useRef<string>('normal');
  useEffect(() => {
    if (caddie.pressure === 'high' && prevPressureRef.current !== 'high') {
      speakPressureCue();
    }
    prevPressureRef.current = caddie.pressure ?? 'normal';
  }, [caddie.pressure]);

  // ── Auto course detection ────────────────────────────────────────────────
  const setActiveCourseInStore   = useRoundStore((s) => s.setActiveCourse);
  const setSelectedCourseIdxFn   = useRoundStore((s) => s.setSelectedCourseIdx);
  const { detectedCourse, clearDetection } = useCourseDetection(
    unifiedGPS.location,
    { disabled: isRoundActive },
  );

  // ── Automatic hole progression ────────────────────────────────────────────
  useHoleProgression({
    location:       unifiedGPS.location,
    currentHole,
    setCurrentHole,
    isRoundActive,
    courseData:     activeCourseData ?? null,
    onHoleAdvance: (from, to) => {
      if (holeToastTimerRef.current) clearTimeout(holeToastTimerRef.current);
      setHoleAdvanceToast({ from, to });
      holeToastTimerRef.current = setTimeout(() => {
        setHoleAdvanceToast(null);
        holeToastTimerRef.current = null;
      }, 4_000);
    },
  });
  const handleConfirmCourse = () => {
    if (!detectedCourse) return;
    const idx = COURSE_DB.findIndex((c) => c.id === detectedCourse.id);
    if (idx !== -1) {
      setSelectedCourseIdxFn(idx);
      setActiveCourseInStore(detectedCourse.name);
    }
    clearDetection();
  };

  // ── Live GPS → ball dot (unified continuous GPS) ─────────────────────────
  // Drives the ball-position dot on the hole map when the preview is open.
  // Requires the course to have teeCoords + pinCoords per hole; silently
  // skips when those fields are absent (no false movement).
  useEffect(() => {
    if (!showHolePreview || !isRoundActive) return;
    const loc = unifiedGPS.location;
    if (!loc) return;
    const overlay = HOLE_OVERLAYS[currentHole - 1];
    if (!overlay) return;
    const courseHole = activeCourseData?.holes[currentHole - 1] as any;
    if (!courseHole?.teeCoords || !courseHole?.pinCoords) return;
    const { lat: tLat, lng: tLng } = courseHole.teeCoords as { lat: number; lng: number };
    const { lat: pLat, lng: pLng } = courseHole.pinCoords as { lat: number; lng: number };
    const holeDx  = pLat - tLat;
    const holeDy  = pLng - tLng;
    const holeLen2 = holeDx * holeDx + holeDy * holeDy;
    if (holeLen2 === 0) return;
    const t = Math.max(0, Math.min(1,
      ((loc.lat - tLat) * holeDx + (loc.lng - tLng) * holeDy) / holeLen2
    ));
    const nx = overlay.start.x + (overlay.target.x - overlay.start.x) * t;
    const ny = overlay.start.y + (overlay.target.y - overlay.start.y) * t;
    setBallPosition((prev) => {
      if (Math.abs(prev.x - nx) < 0.005 && Math.abs(prev.y - ny) < 0.005) return prev;
      return { x: nx, y: ny };
    });
  }, [unifiedGPS.location, showHolePreview, isRoundActive, currentHole, activeCourseData]);

  // ── Hazard-aware target nudge ─────────────────────────────────────────────
  // Pure pixel transform: returns safe {x, y} for drawing the shot line endpoint.
  // If nudge is applied, fires a one-time ambient voice tip & pulses the target ring.
  // useCallback deps are stable refs so this never needs re-creation.
  const applyHazardNudge = useCallback(
    (px: number, py: number, mw: number, mh: number, hazards: import('../../data/courses').Hazard[]): { x: number; y: number } => {
      try {
      let x = px;
      let y = py;
      const nudgePx = mw * 0.045;
      for (const h of hazards) {
        const hx = h.x * mw;
        const hy = h.y * mh;
        const hr = (h.r ?? 0.06) * mw;
        const dist = Math.sqrt((x - hx) ** 2 + (y - hy) ** 2);
        if (dist < hr) {
          switch (h.avoidDir) {
            case 'left':  x -= nudgePx; break;
            case 'right': x += nudgePx; break;
            case 'short': y += nudgePx; break;
            case 'long':  y -= nudgePx; break;
          }
          // Pulse target ring once per hazard encounter — no re-entry during drag
          const hazardKey = `${h.x},${h.y}`;
          if (lastNudgedHazardRef.current !== hazardKey) {
            lastNudgedHazardRef.current = hazardKey;
            nudgeAnim.setValue(1);
            Animated.sequence([
              Animated.timing(nudgeAnim, { toValue: 1.3, duration: 120, useNativeDriver: true }),
              Animated.timing(nudgeAnim, { toValue: 1,   duration: 100, useNativeDriver: true }),
            ]).start();
            // Ambient voice tip — fires only on first encounter, won't interrupt speech
            if (voiceEnabled) {
              const tip = h.avoidDir === 'left' || h.avoidDir === 'right'
                ? `Avoid ${h.avoidDir}.`
                : h.avoidDir === 'short' ? 'Take less club.' : 'Aim a little deeper.';
              void speakJob(tip, ENGINE_PRIORITY.AMBIENT, voiceGender);
            }
          }
          break;
        }
      }
      // Reset hazard key if we've moved away from all hazards
      if (x === px && y === py) lastNudgedHazardRef.current = null;
      // Clamp to map bounds so nudge never pushes target outside the image
      return { x: Math.max(0, Math.min(mw, x)), y: Math.max(0, Math.min(mh, y)) };
    } catch {
      // Hazard calculation error — return original untouched coords
      return { x: px, y: py };
    }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voiceEnabled, voiceGender, nudgeAnim]
  );

  // ── Swing suggestion detection (runs after each shot) ────────────────────
  const detectRecentMissPattern = useCallback((): 'right' | 'left' | null => {
    const recent = shots.slice(-3);
    const right = recent.filter((s) => s.result === 'right').length;
    const left  = recent.filter((s) => s.result === 'left').length;
    if (right >= 2) return 'right';
    if (left  >= 2) return 'left';
    return null;
  }, [shots]);

  const getPatternThought = (pattern: 'right' | 'left'): string =>
    pattern === 'right' ? 'Start it left' : 'Aim center';

  useEffect(() => {
    if (shots.length < 3) return;
    if (swingThought) return;
    if (swingThoughtSuggestion) return;
    if (currentHole - dismissedAtHoleRef.current < SUGGESTION_COOLDOWN_HOLES) return;
    // Time-based cooldown: never re-suggest within 30 s of last suggestion
    if (Date.now() - lastSuggestionTimeRef.current < 30_000) return;
    const p = detectRecentMissPattern();
    if (p) {
      lastSuggestionTimeRef.current = Date.now();
      setSwingThoughtSuggestion(getPatternThought(p));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots.length]);

  // Clear thought + suggestion when hole changes
  useEffect(() => {
    setSwingThought(null);
    setSwingThoughtSuggestion(null);
  }, [currentHole]);

  // ── Unmount cleanup — clear all pending timers to prevent setState after unmount ──
  useEffect(() => {
    return () => {
      if (visionOverlayTimer.current) clearTimeout(visionOverlayTimer.current);
      if (feedbackTimer.current)      clearTimeout(feedbackTimer.current);
      if (dragDebounceRef.current)    clearTimeout(dragDebounceRef.current);
    };
  }, []);

  // ── SmartVision result helper ────────────────────────────────────────────
  const analyzeVisionResult = (uri: string): string => {
    // Simple heuristic placeholder — real analysis happens in ShotVisionPlayer.
    // This returns a start-line label used for the visual-only overlay.
    return 'On line';
  };

  const showVisionFeedback = useCallback((uri: string) => {
    const result = analyzeVisionResult(uri);
    if (visionOverlayTimer.current) clearTimeout(visionOverlayTimer.current);
    setVisionOverlay(result);
    // If user has an active swing thought, reinforce it after 1 s (visual only)
    if (swingThought) {
      visionOverlayTimer.current = setTimeout(() => {
        setVisionOverlay(swingThought);
        visionOverlayTimer.current = setTimeout(() => setVisionOverlay(null), 2500);
      }, 1000);
    } else {
      visionOverlayTimer.current = setTimeout(() => setVisionOverlay(null), 2500);
    }
  }, [swingThought]);

  const getMissPattern = useCallback((): 'right' | 'left' | 'balanced' => {
    const mem = courseMemory[activeCourse] ?? courseMemory['Menifee Lakes'] ?? courseMemory['Menifee Lakes — Palms'];
    if (!mem) return 'balanced';
    let left = 0; let right = 0;
    Object.values(mem).forEach((h) => { left += h.missesLeft; right += h.missesRight; });
    if (right > left + 1) return 'right';
    if (left > right + 1) return 'left';
    return 'balanced';
  }, [courseMemory, activeCourse]);

  const getFavoriteClub = useCallback((): string => {
    const entries = Object.entries(clubUsage);
    if (!entries.length) return club;
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  }, [clubUsage, club]);

  const aiProfile      = useAiProfileStore();
  const addRoundHistory = useAiProfileStore((s) => s.addRoundHistory);

  // ── Local bias: derived from current round's shots (no AI, purely local) ────
  const localBias = useMemo(() => deriveLocalBias(shots), [shots]);

  const getContextualAdvice = useCallback((): string => {
    try {
      const base = buildRecommendation({
        yardage:             displayDistance ?? 0,
        club,
        par:                 holePar,
        holeNumber:          currentHole,
        roundsPlayed:        aiProfile.roundsPlayed,
        localMissBias:       localBias.missBias,
        localBiasConfidence: localBias.confidence,
        aiProfile,
        holeMemory:          courseMemory[activeCourse]?.[currentHole] ?? null,
        goalMode,
        strategyMode,
        shotsThisRound:      shots.length,
      });
      return applyPersonality(base, caddiePersonality);
    } catch {
      // Recommendation engine failed (corrupt profile/memory) — return base yardage string
      const y = displayDistance ?? 0;
      const fallback = y > 0 ? `${y} yards. ${club} — commit and stay smooth.` : 'Stay smooth and commit.';
      return applyPersonality(fallback, caddiePersonality);
    }
  }, [displayDistance, club, holePar, currentHole, aiProfile, localBias, courseMemory, activeCourse, goalMode, strategyMode, shots.length, caddiePersonality]);

  // â”€â”€ Animations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const startPulse = useCallback(() => {
    if (pulseRef.current) pulseRef.current.stop();
    pulseRef.current = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.12, duration: 500, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1.0,  duration: 500, useNativeDriver: true }),
    ]));
    pulseRef.current.start();
  }, [pulseAnim]);
  const stopPulse = useCallback(() => {
    pulseRef.current?.stop();
    Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [pulseAnim]);

  // â”€â”€ Rangefinder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openRangefinder = useCallback(() => {
    router.push({
      pathname: '/rangefinder',
      params: {
        yardage: String(displayDistance ?? ''),
        hole: String(currentHole),
      },
    });
  }, [displayDistance, currentHole, router]);

  const getGPS = async () => {
    await golfGPS.refresh();
    // Reflect GPS result into gpsMiddle — use coords if available, else clear
    if (golfGPS.coords) {
      setGpsMiddle(holeDistance - 10);
    } else if (golfGPS.isManual) {
      setGpsMiddle(null);
    }
  };

  // â”€â”€ Ask Caddie â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const ask = useCallback(async () => {
    const advice = getContextualAdvice();
    setCaddieMsg(advice);
    startPulse();
    setIsSpeaking(true);
    try {
      if (voiceEnabled) {
        // cancelAll resets dedup + time-guard so re-taps always work
        await engineCancelAll();
        await speakJob(advice, ENGINE_PRIORITY.STRATEGY, voiceGender);
      }
    } finally {
      stopPulse();
      setIsSpeaking(false);
    }
  }, [getContextualAdvice, startPulse, stopPulse, voiceEnabled, voiceGender]);

  const stop = useCallback(() => {
    stopPulse();
    setIsSpeaking(false);
    void engineCancelAll();
  }, [stopPulse]);

  // ── Shot recording ────────────────────────────────────────────────────────────
  const recordShot = useCallback(async (result: 'left' | 'right' | 'center') => {
    // Guard: prevent double-trigger from rapid taps (e.g. two-finger press on shot buttons)
    if (isProcessingShotRef.current) return;
    isProcessingShotRef.current = true;
    try {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}

    // ── Capture shot start pixel for post-shot visualization ─────────────────
    if (mapSize.w > 1) {
      setShotStartPixel({
        x: ballPosition.x * mapSize.w,
        y: ballPosition.y * mapSize.h,
      });
    }

    addShot({
      result,
      club,
      aim: aimTarget,
      target: aimTarget,
      gpsDistance: displayDistance,
      adjustedDistance: null,
      distanceOffset: 0,
      directionOffset: null,
      mental: 'neutral',
      distance: displayDistance ?? 0,
      timestamp: Date.now(),
      hole: currentHole,
    });

    // Re-analyze with updated shots
    const updatedShots = useRoundStore.getState().shots;
    const pat = analyzePatterns(updatedShots);

    // Show feedback overlay
    const dirLabel = result === 'center' ? 'Straight' : result === 'left' ? 'Left' : 'Right';
    const insight  = pat.patternInsight || (result === 'center' ? 'Good contact.' : `${dirLabel} miss.`);
    setShotFeedback({ visible: true, result, insight });

    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setShotFeedback((f) => ({ ...f, visible: false })), 1750);

    // ── Advance ball position using hole direction vector ─────────────────
    // If a target was tapped, move ball there (normalized). Otherwise advance
    // along the tee→pin direction vector by the shot-distance ratio.
    setTargetPosition((prev) => {
      if (prev !== null && mapSize.w > 1) {
        const nx = prev.px / mapSize.w;
        const ny = prev.py / mapSize.h;
        // Guard: NaN coords (mapSize not yet set) fall back to tee position
        if (Number.isFinite(nx) && Number.isFinite(ny)) {
          setBallPosition({
            x: Math.max(0, Math.min(1, nx)),
            y: Math.max(0, Math.min(1, ny)),
          });
        }
      } else {
        setBallPosition((b) => {
          try {
            const ov     = HOLE_OVERLAYS[currentHole - 1];
            const teeX   = ov?.start.x  ?? 0.5;  const teeY   = ov?.start.y  ?? 0.9;
            const pinX   = ov?.target.x ?? 0.5;  const pinY   = ov?.target.y ?? 0.1;
            const holeDist = activeCourseData?.holes[currentHole - 1]?.distance ?? 350;
            const shotYards = displayDistance ?? Math.round(holeDist * 0.35);
            const ddx = pinX - teeX;  const ddy = pinY - teeY;
            const len = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
            const dirX = ddx / len;   const dirY = ddy / len;
            const ratio = Math.min((shotYards / holeDist) * len, len * 0.9);
            const lateralOffset = result === 'left' ? -0.04 : result === 'right' ? 0.04 : 0;
            const nx = b.x + dirX * ratio + (-dirY * lateralOffset);
            const ny = b.y + dirY * ratio + ( dirX * lateralOffset);
            // Guard: if computation produced NaN, keep last valid position
            if (!Number.isFinite(nx) || !Number.isFinite(ny)) return b;
            return {
              x: Math.max(0, Math.min(1, nx)),
              y: Math.max(0, Math.min(1, ny)),
            };
          } catch {
            // Unexpected calc error — keep last valid ball position
            return b;
          }
        });
      }
      return null;
    });

    // Update caddie message with latest pattern
    if (pat.patternInsight) setCaddieMsg(pat.patternInsight);

    // ── Post-shot visualization: classify miss + auto-log to learning system ──
    // Compute new ball end pixel synchronously (mirrors the setBallPosition logic below)
    if (mapSize.w > 1) {
      const ov      = HOLE_OVERLAYS[currentHole - 1];
      const teeX    = ov?.start.x  ?? 0.5;  const teeY = ov?.start.y ?? 0.9;
      const pinX    = ov?.target.x ?? 0.5;  const pinY = ov?.target.y ?? 0.1;
      const holeDist = activeCourseData?.holes[currentHole - 1]?.distance ?? 350;
      const ddx = pinX - teeX;  const ddy = pinY - teeY;
      const len = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      const dirX = ddx / len;   const dirY = ddy / len;

      // Where will the ball land?
      let endNormX: number;
      let endNormY: number;
      if (targetPosition && mapSize.w > 1) {
        endNormX = targetPosition.px / mapSize.w;
        endNormY = targetPosition.py / mapSize.h;
      } else {
        const shotYards = displayDistance ?? Math.round(holeDist * 0.35);
        const lateralOffset = result === 'left' ? -0.04 : result === 'right' ? 0.04 : 0;
        const ratio = Math.min((shotYards / holeDist) * len, len * 0.9);
        endNormX = Math.max(0, Math.min(1, ballPosition.x + dirX * ratio + (-dirY * lateralOffset)));
        endNormY = Math.max(0, Math.min(1, ballPosition.y + dirY * ratio + ( dirX * lateralOffset)));
      }

      const endX = endNormX * mapSize.w;
      const endY = endNormY * mapSize.h;

      // Target reference (tap position or pin)
      const tgtX = targetPosition ? targetPosition.px : pinX * mapSize.w;
      const tgtY = targetPosition ? targetPosition.py : pinY * mapSize.h;

      const deltaX = endX - tgtX;
      const deltaY = endY - tgtY;

      let missResult: 'good' | 'left' | 'right' | 'short' | 'long' = 'good';
      if (Math.abs(deltaX) > 18 || Math.abs(deltaY) > 18) {
        if (Math.abs(deltaX) >= Math.abs(deltaY)) {
          missResult = deltaX > 0 ? 'right' : 'left';
        } else {
          // Higher Y in image coords = lower on screen = closer to tee = short
          missResult = deltaY > 0 ? 'short' : 'long';
        }
      }

      setActualShotResult(missResult);
      try { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      playSoundConfirm();

      // Feed dispersion model with result mapped to canonical miss direction
      // (recordResult already called above via useShotTracking)

      // Auto-log shot to caddie learning store
      addRoundShot({
        recommended: caddie.recommendedClub ?? club ?? '',
        selected:    club ?? '',
        distance:    displayDistance ?? 0,
        result:      missResult,
        timestamp:   Date.now(),
      });

      // Auto-reset visualization after 6 seconds
      if (actualShotTimerRef.current) clearTimeout(actualShotTimerRef.current);
      actualShotTimerRef.current = setTimeout(() => {
        setShotStartPixel(null);
        setActualShotResult(null);
      }, 6000);
    }

    // Auto-trigger Shot Vision if enabled and a video is available
    if (autoShotVision && lastVideoUri) {
      setTimeout(() => setShowShotVision(true), 400);
    }

    // Voice timing — only fires if pattern is strong + cooldown elapsed
    if (voiceEnabled) {
      await VoiceTimingController.afterShot(
        pat.currentPattern,
        pat.patternConfidence / 100,
        pat.patternInsight,
        (msg) => void speakJob(msg, ENGINE_PRIORITY.SHOT, voiceGender),
      );
    }
    } finally {
      isProcessingShotRef.current = false;
    }
  }, [addShot, addRoundShot, club, aimTarget, displayDistance, currentHole, voiceEnabled, voiceGender, setCaddieMsg, autoShotVision, lastVideoUri, mapSize, ballPosition, targetPosition, caddie.recommendedClub]);
  // ── Mark Shot (voice-first + manual fallback) ───────────────────────────────
  const handleMarkShot = useCallback(async () => {
    // Per-shot double-trigger guard
    if (markShotUsedRef.current) return;
    markShotUsedRef.current = true;
    setTimeout(() => { markShotUsedRef.current = false; }, 1500);

    // Cooldown: prevent repeat within 5 s of last marked shot
    const now = Date.now();
    if (now - lastShotTimeRef.current < 5000) return;
    lastShotTimeRef.current = now;

    // Capture advice BEFORE recordShot mutates shots/state — ensures consistency
    const nextAdvice = getContextualAdvice();

    // Log the shot (non-blocking — direction from aim target)
    await recordShot('center');

    // Brief caddie confirm — AMBIENT won't interrupt active speech
    void speakJob('Got it.', ENGINE_PRIORITY.AMBIENT, voiceGender);

    // Post-shot recommendation: use pre-captured advice so output is deterministic
    setTimeout(() => {
      if (nextAdvice) {
        setCaddieMsg(nextAdvice);
        if (voiceEnabled) void speakJob(nextAdvice, ENGINE_PRIORITY.STRATEGY, voiceGender);
      }
    }, 400);

    // Attempt SmartVision after a short settle delay (always on)
    setTimeout(() => { void _attemptSmartVision(); }, 1500);
  }, [recordShot, voiceGender, getContextualAdvice, voiceEnabled, setCaddieMsg]);

  // ── Galaxy Watch sync — publishes yardage/hole to watch; handles watch actions ──
  useWatchSync({
    yardage:    displayDistance ?? 0,
    onMarkShot: handleMarkShot,
    // onTriggerVoice: handled by CaddieMicButton on the phone screen
  });

  // ── Voice controller — mic button → STT → command → ElevenLabs response ──
  const {
    listening: micListening,
    transcript: micTranscript,
    toggle: toggleMic,
  } = useVoiceController({
    distance:        displayDistance,
    recommendedClub: caddie.recommendedClub ?? club,
    currentHole,
    onNextHole:      () => setCurrentHole(Math.min(18, currentHole + 1)),
    onPrevHole:      () => setCurrentHole(Math.max(1,  currentHole - 1)),
    onShowMap:       () => {
      setTargetPosition(null);
      setShowHolePreview(true);
    },
    onPuttMode:      () => setPuttMode(true),
    onShowScorecard: () => void router.push('/(tabs)/scorecard'),
    onLogShot:       () => void handleMarkShot(),
    onStartVideo:    () => void _attemptSmartVision(),
    onGetAdvice:     getContextualAdvice,
    onFreeformQuery: async (query: string) => {
      const focusCtx = buildFocusContext({
        hole:     currentHole,
        distance: displayDistance ?? null,
        shots,
        holeNote: activeCourseData?.holes[currentHole - 1]?.note ?? null,
      });
      const aiCaller = (q: string) => _focusAICaller(q, { hole: currentHole, distance: displayDistance ?? undefined });
      return handleFocusInput(query, focusCtx, aiCaller);
    },
    followUpContext: {
      wind,
      elevation,
      effectiveDistance:  effectiveDistance ?? null,
      baseDistance:       displayDistance   ?? null,
      adjustmentDelta:    effectiveDistResult.delta,
      hazards:            hazardWarningsRef.current,
      missPattern:        (() => { const m = getMissPattern(); return m === 'balanced' ? null : (m ?? null) as 'left' | 'right' | null; })(),
      currentHole,
    },
    followUpPersonality: caddiePersonality as import('../../features/voice/FollowUpEngine').FollowUpPersonality,
  });

  // -- SmartVision capture: safety-gated, non-blocking
  const _isUserStationary = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return true; // no GPS = assume stationary (fail open)
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const prev = lastGpsRef.current;
      lastGpsRef.current = cur;
      if (!prev) return true; // first reading — assume stationary
      // Haversine-lite: 1 degree lat ≈ 111 000 m
      const dlat = (cur.lat - prev.lat) * 111000;
      const dlng = (cur.lng - prev.lng) * 111000 * Math.cos((cur.lat * Math.PI) / 180);
      const meters = Math.sqrt(dlat * dlat + dlng * dlng);
      return meters < 2; // < 2 m = stationary
    } catch {
      return true; // GPS error = assume stationary, fail open
    }
  }, []);

  const _attemptSmartVision = useCallback(async () => {
    // Safety checks — fail silently on any condition
    if (isRecordingRef.current) return;
    if (getEngineState() !== 'idle') return; // don't interrupt voice
    const stationary = await _isUserStationary();
    if (!stationary) return;

    // Start camera — runs fully independently, never blocks UI or voice
    try {
      isRecordingRef.current = true;
      setShowShotCamera(true);

      // Auto-stop safety timeout (5 s max) — closes camera if capture never happens
      setTimeout(() => {
        if (isRecordingRef.current) {
          isRecordingRef.current = false;
          setShowShotCamera(false);
        }
      }, 5000);
    } catch {
      isRecordingRef.current = false;
    }
  }, [_isUserStationary]);

  // ── End round ─────────────────────────────────────────────────────────────
  const handleEndRound = useCallback(() => {
    void engineCancelAll();
    // Snapshot before clearing — fire background AI analysis (non-blocking)
    const completedShots = useRoundStore.getState().shots;
    const completedRoundShots = getRoundShotsSnapshot();
    void analyzeRoundInBackground(completedShots);

    // Build local post-round insights
    const analysis  = analyzeRound(completedShots, completedRoundShots);
    const newInsights = analysis ? generateInsights(analysis) : [];

    // Persist compact round summary for local learning / experience tier
    if (completedShots.length >= 3) {
      addRoundHistory(buildRoundSummary(completedShots, analysis));
    }

    clearRound();
    resetCaddieRound();
    setIsRoundActive(false);

    if (analysis && newInsights.length > 0) {
      setPostRoundAnalysis(analysis);
      setPostRoundInsights(newInsights);
      pendingNavRef.current = () => router.replace('/(tabs)/play');
      setShowPostRound(true);
      // Tip: replay is ready
      checkAndShow('replay', () => showTip('replay', "Your round is ready to replay and share in the History tab."));
    } else {
      router.replace('/(tabs)/play');
    }
  }, [clearRound, resetCaddieRound, setIsRoundActive, router, addRoundHistory]);

  // â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleLogout = useCallback(async () => {
    setShowToolsMenu(false);
    try { await signOut(auth); } catch {}
    setIsGuest(false);
    router.replace('/auth');
  }, [router]);

  const miss      = useMemo(() => getMissPattern(), [getMissPattern]);
  const missColor = miss === 'right' ? '#f87171' : miss === 'left' ? '#60a5fa' : '#A7F3D0';
  const missLabel = miss === 'right' ? 'Tends right' : miss === 'left' ? 'Tends left' : 'Balanced';

  // â”€â”€ Shot intelligence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const pattern    = useMemo(() => analyzePatterns(shots), [shots]);
  const clubRec    = useMemo(
    () => getRecommendedClub(effectiveDistance, shots, club),
    [effectiveDistance, shots, club],
  );
  // Pre-compute advice so render path never calls getContextualAdvice() inline
  const currentAdvice = useMemo(() => getContextualAdvice(), [getContextualAdvice]);

  // Show correction prompt when a new shot is added
  const prevShotCount = useRef(shots.length);
  useEffect(() => {
    if (!showShotVision) return;
    const t = setTimeout(() => setShowShotVision(false), 3000);
    return () => clearTimeout(t);
  }, [showShotVision]);
  // Auto-dismiss correction prompt after 8 s if user doesn't interact
  useEffect(() => {
    if (!showCorrection) return;
    const t = setTimeout(() => setShowCorrection(false), 8000);
    return () => clearTimeout(t);
  }, [showCorrection]);
  // Fade-in overlay when preview opens
  useEffect(() => {
    if (!showHolePreview) {
      setPuttMode(false); setPuttBall(null); setPuttHole(null); setSlopeDirection(null);
    }
    if (showHolePreview) {
      previewFadeAnim.setValue(0);
      Animated.timing(previewFadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [showHolePreview, previewFadeAnim]);
  useEffect(() => {
    if (shots.length > prevShotCount.current) {
      setShowCorrection(true);
    }
    prevShotCount.current = shots.length;
  }, [shots.length]);

  const getScoreAwareAdvice = useCallback((score: number, par: number): string => {
    return scoreAdvice(score - par, caddiePersonality);
  }, [caddiePersonality]);

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      <BrandHeader rightSlot={
        <Pressable
          onPress={() => setShowToolsMenu((v) => !v)}
          style={[s.toolsPill, showToolsMenu && s.toolsPillActive]}
        >
          {[0,1,2].map((i) => (
            <View key={i} style={[s.dot, showToolsMenu && s.dotActive]} />
          ))}
        </Pressable>
      } />
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerSub}>Hole {currentHole} · {activeCourse}</Text>
          <SmartHint hint={smartHint} />
        </View>
        {(() => {
          // Use course-derived image; fall back to null (renders local fallback View)
          const thumbSource = thumbError ? undefined : holeThumbSource;
          // Always show a tappable hole preview — local fallback when no image is set
          return (
            <Pressable
              onPress={() => setShowCourseInfo(true)}
              style={{ marginRight: 8 }}
            >
              {thumbSource ? (
                <Image
                  source={thumbSource}
                  style={{ width: 60, height: 60, borderRadius: 8, backgroundColor: '#1a2e1a' }}
                  resizeMode="cover"
                  onError={() => setThumbError(true)}
                />
              ) : (
                // Local fallback — no image configured for this hole yet
                <View style={{
                  width: 60, height: 60, borderRadius: 8,
                  backgroundColor: '#0d2b18',
                  borderWidth: 1.5, borderColor: Palette.positive,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: Palette.positive, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>HOLE</Text>
                  <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 24 }}>{currentHole}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>tap</Text>
                </View>
              )}
            </Pressable>
          );
        })()}
        {isGuest && (
          <Pressable
            onPress={() => setShowSaveProgress(true)}
            style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#052e1e', borderRadius: 10, borderWidth: 1, borderColor: '#059669' }}
          >
            <Text style={{ color: '#A7F3D0', fontSize: 11, fontWeight: '700' }}>Save Progress</Text>
          </Pressable>
        )}
      </View>

      {/* Tools backdrop */}
      {showToolsMenu && (
        <Pressable
          onPress={() => setShowToolsMenu(false)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}
        />
      )}

      <SaveProgressModal
        visible={showSaveProgress}
        onDismiss={() => setShowSaveProgress(false)}
      />

      {/* Tools dropdown */}
      {showToolsMenu && (
        <ScrollView
          style={s.toolsMenu}
          contentContainerStyle={{ padding: 10, gap: 8 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={() => { void getGPS(); }} style={[s.menuItem, gpsMiddle !== null && s.menuItemActive]}>
            <MCIcon name="map-marker-radius" size={16} color={gpsMiddle !== null ? Palette.positiveFaint : Palette.muted} />
            <Text style={[s.menuItemText, gpsMiddle !== null && { color: Palette.positiveFaint }]}>
              {golfGPS.loading ? 'GPS…' : golfGPS.isManual ? 'GPS: Manual' : gpsMiddle !== null ? 'GPS On' : 'GPS Off'}
            </Text>
          </Pressable>
          <Pressable onPress={() => setVoiceEnabled(!voiceEnabled)} style={[s.menuItem, !voiceEnabled && s.menuItemActive]}>
            <MCIcon name={voiceEnabled ? 'volume-high' : 'volume-off'} size={16} color={voiceEnabled ? Palette.positiveFaint : Palette.muted} />
            <Text style={[s.menuItemText, !voiceEnabled && { color: Palette.positiveFaint }]}>{voiceEnabled ? 'Voice On' : 'Voice Off'}</Text>
          </Pressable>
          <Pressable onPress={() => setVoiceStyle(voiceStyle === 'calm' ? 'aggressive' : 'calm')} style={s.menuItem}>
            <MCIcon name={voiceStyle === 'aggressive' ? 'bullhorn-outline' : 'meditation'} size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>{voiceStyle === 'aggressive' ? 'Aggressive' : 'Calm'} Voice</Text>
          </Pressable>
          <Pressable onPress={() => { const g = voiceGender === 'male' ? 'female' : 'male'; setVoiceGender(g); setGlobalGender(g); }} style={s.menuItem}>
            <MCIcon name="account-voice" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>{voiceGender === 'male' ? 'Male' : 'Female'} Voice</Text>
          </Pressable>
          <Pressable onPress={() => setEarbudMode((v) => !v)} style={[s.menuItem, earbudMode && s.menuItemActive]}>
            <MCIcon name="headphones" size={16} color={earbudMode ? Palette.positiveFaint : Palette.muted} />
            <Text style={[s.menuItemText, earbudMode && { color: Palette.positiveFaint }]}>Earbuds {earbudMode ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable onPress={() => setHighContrast(!highContrast)} style={[s.menuItem, highContrast && s.menuItemActive]}>
            <MCIcon name="contrast-circle" size={16} color={highContrast ? Palette.positiveFaint : Palette.muted} />
            <Text style={[s.menuItemText, highContrast && { color: Palette.positiveFaint }]}>{highContrast ? 'High Contrast' : 'Normal'}</Text>
          </Pressable>
          <Pressable onPress={() => setBrightMode(!brightMode)} style={[s.menuItem, brightMode && s.menuItemActive]}>
            <MCIcon name="white-balance-sunny" size={16} color={brightMode ? Palette.positiveFaint : Palette.muted} />
            <Text style={[s.menuItemText, brightMode && { color: Palette.positiveFaint }]}>Bright Mode {brightMode ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable onPress={() => setFocusMode((v) => !v)} style={[s.menuItem, focusMode && s.menuItemActive]}>
            <MCIcon name="target" size={16} color={focusMode ? Palette.positiveFaint : Palette.muted} />
            <Text style={[s.menuItemText, focusMode && { color: Palette.positiveFaint }]}>Focus Mode {focusMode ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable onPress={() => { setShowToolsMenu(false); router.push('/rangefinder'); }} style={[s.menuItem, { borderColor: Palette.accent }]}>
            <Image source={ICON_RANGEFINDER} style={{ width: 16, height: 16, tintColor: Palette.accent }} resizeMode="contain" />
            <Text style={[s.menuItemText, { color: Palette.accent }]}>AR Rangefinder</Text>
          </Pressable>
          <Pressable onPress={() => { setShowToolsMenu(false); router.push('/profile-setup'); }} style={s.menuItem}>
            <MCIcon name="account-circle-outline" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>Profile</Text>
          </Pressable>
          <Pressable onPress={() => { setShowToolsMenu(false); router.push('/tutorial'); }} style={s.menuItem}>
            <MCIcon name="compass-outline" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>CADDIE Guidance</Text>
          </Pressable>
          <Pressable onPress={() => { setShowToolsMenu(false); router.push('/settings' as any); }} style={s.menuItem}>
            <MCIcon name="cog-outline" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>Settings</Text>
          </Pressable>

          <Pressable onPress={() => { const next = !biometricEnabled; setBiometricEnabled(next); BiometricLayoutControls._setBiometricEnabled?.(next); setShowToolsMenu(false); }} style={s.menuItem}>
            <MCIcon name="face-recognition" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>Face ID {biometricEnabled ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable onPress={() => { void handleLogout(); }} style={[s.menuItem, { borderColor: '#6b2020', backgroundColor: '#1a0c0c' }]}>
            <MCIcon name="logout" size={16} color="#e8a0a0" />
            <Text style={[s.menuItemText, { color: '#e8a0a0' }]}>Sign Out</Text>
          </Pressable>
          {/* ─ Book Tee Time ─────────────────────────────────────────── */}
          <Pressable
            onPress={() => {
              const gpsEntry = COURSE_GPS.find((c) => c.id === COURSE_DB[selectedCourseIdx]?.id);
              const url   = gpsEntry?.bookingUrl ?? 'https://golfnow.com';
              const title = COURSE_DB[selectedCourseIdx]?.name ?? 'Book Tee Time';
              setTeeTimeUrl(url);
              setTeeTimeTitle(`Book • ${title}`);
              setShowTeeTime(true);
              setShowToolsMenu(false);
            }}
            style={[s.menuItem, { borderColor: '#1a3a1a', backgroundColor: '#0a2010', marginTop: 4 }]}
          >
            <MCIcon name="calendar-clock" size={16} color={Palette.positive} />
            <Text style={[s.menuItemText, { color: Palette.positive }]}>Book Tee Time</Text>
          </Pressable>
          {isRoundActive && (
            <Pressable onPress={() => { setShowToolsMenu(false); handleEndRound(); }} style={[s.menuItem, { borderColor: '#7a3030', backgroundColor: '#1e0808', marginTop: 4 }]}>
              <MCIcon name="flag-checkered" size={16} color="#f4a0a0" />
              <Text style={[s.menuItemText, { color: '#f4a0a0' }]}>End Round</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      {/* ── Auto-detected course banner ───────────────────────────────── */}
      {detectedCourse && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 999,
          backgroundColor: '#071E16',
          borderBottomWidth: 1, borderBottomColor: Palette.positive,
          paddingTop: 52, paddingBottom: 14, paddingHorizontal: 20,
          flexDirection: 'column', gap: 8,
        }}>
          <Text style={{ color: Palette.positive, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            💚  Course Detected
          </Text>
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>
            {detectedCourse.name}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
            You’ve arrived. Ready to set up your round?
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Pressable
              onPress={handleConfirmCourse}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 20,
                backgroundColor: Palette.positive, alignItems: 'center',
              }}
            >
              <Text style={{ color: '#071E16', fontWeight: '800', fontSize: 14 }}>Start Round →</Text>
            </Pressable>
            <Pressable
              onPress={clearDetection}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 20,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center',
              }}
            >
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Change Course</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Auto shot detection toast + club correction ─────────────── */}
      {autoShotToast && detectedShotClub && (
        <View
          style={{
            position: 'absolute', bottom: tabBarHeight + 72,
            alignSelf: 'center', zIndex: 1200,
            backgroundColor: 'rgba(7,30,22,0.97)',
            borderRadius: 28, paddingVertical: 10, paddingHorizontal: 18,
            borderWidth: 1.5, borderColor: '#60a5fa',
            flexDirection: 'column', alignItems: 'center', gap: 6,
          }}
        >
          {/* Top row: distance + predicted club */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ color: '#60a5fa', fontSize: 13, fontWeight: '700' }}>📍</Text>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
              Shot detected — {autoShotToast}
            </Text>
            {/* Club chip — tap to open correction */}
            <Pressable
              onPress={() => setShowClubCorrection((v) => !v)}
              style={{
                backgroundColor: 'rgba(96,165,250,0.15)',
                borderWidth: 1, borderColor: '#60a5fa',
                borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3,
              }}
            >
              <Text style={{ color: '#60a5fa', fontSize: 13, fontWeight: '800' }}>
                {detectedShotClub} ✎
              </Text>
            </Pressable>
          </View>

          {/* Club correction dropdown */}
          {showClubCorrection && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 280 }}>
              {(bagClubs.length > 0 ? bagClubs : (['Driver','3W','5W','5I','6I','7I','8I','9I','PW','GW','SW','LW'] as import('../../types/club').ClubName[]))
                .map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => {
                      // Update the last auto-detected shot with the corrected club
                      if (detectedShotTsRef.current !== null) {
                        // Learn distance for corrected club
                        if (detectedShotYards !== null) {
                          learnClubDist(c, detectedShotYards);
                        }
                      }
                      setDetectedShotClub(c);
                      setShowClubCorrection(false);
                      // Dismiss toast after short delay
                      if (autoShotToastTimer.current) clearTimeout(autoShotToastTimer.current);
                      autoShotToastTimer.current = setTimeout(() => {
                        setAutoShotToast(null);
                        setDetectedShotClub(null);
                        setDetectedShotYards(null);
                      }, 1_500);
                    }}
                    style={[
                      {
                        paddingHorizontal: 10, paddingVertical: 4,
                        borderRadius: 10, borderWidth: 1,
                        borderColor: c === detectedShotClub ? '#60a5fa' : 'rgba(255,255,255,0.2)',
                        backgroundColor: c === detectedShotClub ? 'rgba(96,165,250,0.2)' : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{
                      color: c === detectedShotClub ? '#60a5fa' : 'rgba(255,255,255,0.7)',
                      fontSize: 12, fontWeight: c === detectedShotClub ? '800' : '500',
                    }}>{c}</Text>
                  </Pressable>
                ))
              }
            </View>
          )}
        </View>
      )}

      {/* ── Hole advance toast ───────────────────────────────────────── */}
      {holeAdvanceToast && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', bottom: tabBarHeight + 24,
            alignSelf: 'center', zIndex: 1200,
            backgroundColor: 'rgba(7,30,22,0.95)',
            borderRadius: 28, paddingVertical: 12, paddingHorizontal: 22,
            borderWidth: 1.5, borderColor: Palette.positive,
            flexDirection: 'row', alignItems: 'center', gap: 10,
          }}
        >
          <Text style={{ color: Palette.positive, fontSize: 18, fontWeight: '800' }}>
            Hole {holeAdvanceToast.from}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 16 }}>→</Text>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>
            Hole {holeAdvanceToast.to}
          </Text>
        </View>
      )}

      {/* ── Contextual tip card ───────────────────────────────────── */}
      {activeTip && (
        <TipCard
          key={activeTip.key}
          text={activeTip.text}
          onDismiss={() => setActiveTip(null)}
          bottomOffset={130}
        />
      )}

      {/* ── Post-round AI summary ─────────────────────────────────── */}
      <PostRoundSummary
        visible={showPostRound}
        analysis={postRoundAnalysis}
        insights={postRoundInsights}
        onDismiss={() => {
          setShowPostRound(false);
          pendingNavRef.current();
        }}
      />

      {/* ── Tee Time WebView modal ────────────────────────────────── */}
      <TeeTimeModal
        visible={showTeeTime}
        url={teeTimeUrl}
        title={teeTimeTitle}
        onClose={() => setShowTeeTime(false)}
      />



      {/* Hole Preview Modal — Golfshot-style interactive map */}
      {(() => {
        const fullSource = holeFullSource;
        const overlay    = HOLE_OVERLAYS[currentHole - 1];
        const holeYards  = activeCourseData?.holes[currentHole - 1]?.distance ?? 350;

        // ── Hole map definition (normalized 0–1) ───────────────────────────
        const teeNorm = { x: overlay?.start.x  ?? 0.5, y: overlay?.start.y  ?? 0.9 };
        const pinNorm = { x: overlay?.target.x ?? 0.5, y: overlay?.target.y ?? 0.1 };
        // Direction vector tee → pin
        const rawDX = pinNorm.x - teeNorm.x;
        const rawDY = pinNorm.y - teeNorm.y;
        const dirLen = Math.sqrt(rawDX * rawDX + rawDY * rawDY) || 1;
        const dirX = rawDX / dirLen;  const dirY = rawDY / dirLen;

        // Convert normalized ball pos → pixel
        const bx = ballPosition.x * mapSize.w;
        const by = ballPosition.y * mapSize.h;

        // Green pin pixel pos
        const gx = pinNorm.x * mapSize.w;
        const gy = pinNorm.y * mapSize.h;

        // Hole GPS data — needed for haversine distance calcs below
        const holeInfo = activeCourseData?.holes[currentHole - 1];

        // Distance to pin: GPS haversine when live location available, else pixel projection fallback
        const distToPin = (() => {
          if (unifiedGPS.location && holeInfo?.middle) {
            return Math.max(0, Math.round(haversineYards(unifiedGPS.location, holeInfo.middle)));
          }
          const ballToPinX = pinNorm.x - ballPosition.x;
          const ballToPinY = pinNorm.y - ballPosition.y;
          const projDist   = ballToPinX * dirX + ballToPinY * dirY;
          return Math.max(0, Math.round((projDist / dirLen) * holeYards));
        })();

        // Target pixel pos & distance
        const tx = targetPosition?.px ?? null;
        const ty = targetPosition?.py ?? null;
        // Distance to target: GPS haversine from player position to tapped GPS point when anchors available
        const distToTarget = (tx !== null && ty !== null && mapSize.w > 1)
          ? (() => {
              if (holeInfo?.tee && (unifiedGPS.location || holeInfo.middle)) {
                const playerGPS = unifiedGPS.location ?? holeInfo.tee;
                const tapGPS = pixelToGPS(tx, ty, mapSize.w, mapSize.h, teeNorm, pinNorm, holeInfo.tee, holeInfo.middle);
                return Math.max(1, Math.round(haversineYards(playerGPS, tapGPS)));
              }
              // Pixel-ratio fallback (no tee GPS or no live GPS)
              const tnx = tx / mapSize.w;  const tny = ty / mapSize.h;
              const btX = tnx - ballPosition.x;  const btY = tny - ballPosition.y;
              const proj = Math.abs(btX * dirX + btY * dirY);
              return Math.max(1, Math.round((proj / dirLen) * holeYards));
            })()
          : null;

        // Default target when no tap: project ahead from ball by distToPin (stop at pin)
        const defaultTargetNorm = (() => {
          const ahead = Math.min(distToPin, holeYards) / holeYards * dirLen;
          return {
            x: Math.max(0, Math.min(1, ballPosition.x + dirX * ahead)),
            y: Math.max(0, Math.min(1, ballPosition.y + dirY * ahead)),
          };
        })();
        const defaultGx = defaultTargetNorm.x * mapSize.w;
        const defaultGy = defaultTargetNorm.y * mapSize.h;

        // Shot line endpoint — uses applyHazardNudge + per-club dispersion nudge
        const holeHazards = activeCourseData?.holes[currentHole - 1]?.hazards ?? [];

        // ── Auto safe target selection ─────────────────────────────────────
        // Generate 5 lateral candidates at the default distance, score by
        // minimum clearance from every hazard, pick the highest-scoring one.
        const autoSafeTarget = (() => {
          if (mapSize.w < 2) return { px: defaultGx, py: defaultGy, dist: distToPin };
          const ratio = (Math.min(distToPin, holeYards) / holeYards) * dirLen;
          type Candidate = { px: number; py: number; score: number };
          const candidates: Candidate[] = [-0.10, -0.05, 0, 0.05, 0.10].map((lat) => {
            const nx = Math.max(0, Math.min(1, ballPosition.x + dirX * ratio + perpX * lat));
            const ny = Math.max(0, Math.min(1, ballPosition.y + dirY * ratio + perpY * lat));
            const cpx = nx * mapSize.w;
            const cpy = ny * mapSize.h;
            let minClearance = Infinity;
            for (const h of holeHazards) {
              const hpx = h.x * mapSize.w;
              const hpy = h.y * mapSize.h;
              const hr  = (h.r ?? 0.06) * mapSize.w;
              const d   = Math.sqrt((cpx - hpx) ** 2 + (cpy - hpy) ** 2) - hr;
              if (d < minClearance) minClearance = d;
            }
            return { px: cpx, py: cpy, score: holeHazards.length === 0 ? 999 : minClearance };
          });
          const best = candidates.reduce((a, b) => b.score > a.score ? b : a);
          let autoDistVal = distToPin;
          if (holeInfo?.tee) {
            const gpsPt = pixelToGPS(best.px, best.py, mapSize.w, mapSize.h, teeNorm, pinNorm, holeInfo.tee, holeInfo.middle);
            const playerGPS = unifiedGPS.location ?? holeInfo.tee;
            autoDistVal = Math.max(1, Math.round(haversineYards(playerGPS, gpsPt)));
          } else {
            const tnx2 = best.px / mapSize.w;
            const tny2 = best.py / mapSize.h;
            const proj2 = Math.abs((tnx2 - ballPosition.x) * dirX + (tny2 - ballPosition.y) * dirY);
            autoDistVal = Math.max(1, Math.round((proj2 / dirLen) * holeYards));
          }
          return { px: best.px, py: best.py, dist: autoDistVal };
        })();
        const rawEnd = (tx !== null && ty !== null && mapSize.w > 1)
          ? applyHazardNudge(tx, ty, mapSize.w, mapSize.h, holeHazards)
          : { x: defaultGx, y: defaultGy };
        // Crosswind lateral pixel shift — perpendicular to the hole direction
        // wind.direction 'left' → shift target right (+perp), 'right' → left (-perp)
        const crosswindShiftPx = wind.direction === 'left' ?  wind.speed * 1.5
                               : wind.direction === 'right' ? -wind.speed * 1.5
                               : 0;
        // Perpendicular direction to hole (left of ball→pin)
        const perpX = -dirY;
        const perpY =  dirX;
        // Shift aim point: dispersion nudge + crosswind (both in pixel space)
        const safeEnd = {
          x: rawEnd.x + dispersionNudge.dx + perpX * crosswindShiftPx,
          y: rawEnd.y + dispersionNudge.dy + perpY * crosswindShiftPx,
        };
        const shotPath = `M ${bx} ${by} L ${safeEnd.x} ${safeEnd.y}`;

        // Whether the caddie actually moved the target away from the user's tap
        // (hazard nudge, wind, or dispersion shifted safeEnd more than 8 px from raw tx/ty)
        const isAdjusted = tx !== null && ty !== null
          && (Math.abs(safeEnd.x - tx) > 8 || Math.abs(safeEnd.y - ty) > 8);
        // Mid-point of the adjusted (green) line — for the "Caddie" label
        const adjMidX = (bx + safeEnd.x) / 2;
        const adjMidY = (by + safeEnd.y) / 2;

        // ── Hazard-on-line detection ───────────────────────────────────────
        // Only run when a target is explicitly set (tx/ty non-null) and map is laid out
        const hazardWarnings: { label: string; type: string; carry: number; clear: number; projPx: { x: number; y: number } }[] = [];
        if (tx !== null && ty !== null && mapSize.w > 1 && holeHazards.length > 0) {
          const lineA = { x: bx,        y: by };
          const lineB = { x: safeEnd.x, y: safeEnd.y };
          const lineLenPx = Math.sqrt((lineB.x - lineA.x) ** 2 + (lineB.y - lineA.y) ** 2);
          if (lineLenPx > 1) {
            const pxPerYard = lineLenPx / Math.max(1, holeYards);
            // Convert normalized hazards to pixel circles
            const pixelHazards = holeHazards.map((h) => ({
              cx:  h.x * mapSize.w,
              cy:  h.y * mapSize.h,
              rPx: (h.r ?? 0.06) * mapSize.w,
              label: h.type === 'water' ? 'Water' : h.type === 'ob' ? 'OB' : 'Bunker',
              type:  h.type,
            }));
            const hits = detectHazardsOnLine(lineA, lineB, pixelHazards);
            for (const hit of hits) {
              const carry = Math.round(hit.carryPx / pxPerYard);
              const clear = Math.round(hit.clearPx / pxPerYard);
              if (carry > 0 && carry < holeYards) {
                hazardWarnings.push({
                  label:  pixelHazards[hit.index].label,
                  type:   pixelHazards[hit.index].type,
                  carry,
                  clear,
                  projPx: hit.proj,
                });
              }
            }
          }
        }

        // Keep voice follow-up context in sync with current shot-line hazards
        hazardWarningsRef.current = hazardWarnings.map((hw) => ({
          label: hw.label,
          type:  hw.type as 'water' | 'bunker' | 'ob' | string,
          carry: hw.carry,
          clear: hw.clear,
        }));

        const holePar    = holeInfo?.par ?? 4;
        // Golfshot-style yardages from player GPS to front / center / back of green
        const centerDist = (() => {
          if (unifiedGPS.location && holeInfo?.middle)
            return Math.max(0, Math.round(haversineYards(unifiedGPS.location, holeInfo.middle)));
          return distToPin;
        })();
        const frontDist = (() => {
          if (unifiedGPS.location && holeInfo?.front)
            return Math.max(0, Math.round(haversineYards(unifiedGPS.location, holeInfo.front)));
          return Math.max(1, distToPin - 14);
        })();
        const backDist = (() => {
          if (unifiedGPS.location && holeInfo?.back)
            return Math.max(0, Math.round(haversineYards(unifiedGPS.location, holeInfo.back)));
          return distToPin + 14;
        })();
        // Midpoint of shot line (for distance label overlay)
        const midX = (bx + gx) / 2;
        const midY = (by + gy) / 2;
        // Target midpoint for distance label when target is set
        const tMidX = tx !== null ? (bx + safeEnd.x) / 2 : null;
        const tMidY = ty !== null ? (by + safeEnd.y) / 2 : null;

        return (
          <Modal
            visible={showHolePreview}
            animationType="slide"
            transparent={false}
            onRequestClose={() => setShowHolePreview(false)}
          >
          <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top','left','right','bottom']}>

            {/* ── Header: hole nav ─────────────────────────────── */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
              <Pressable
                onPress={() => { if (currentHole > 1) setCurrentHole(currentHole - 1); }}
                style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: currentHole > 1 ? '#f0f4f0' : 'transparent' }}
              >
                <Text style={{ fontSize: 22, color: currentHole > 1 ? '#1a1a1a' : '#ccc', fontWeight: '600', lineHeight: 26 }}>‹</Text>
              </Pressable>
              <Text style={{ flex: 1, textAlign: 'center', color: '#1a1a1a', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 }}>
                Hole {currentHole}  ·  Par {holePar}  ·  {holeYards} yds
              </Text>
              <Pressable
                onPress={() => { if (currentHole < 18) setCurrentHole(currentHole + 1); }}
                style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: currentHole < 18 ? '#f0f4f0' : 'transparent' }}
              >
                <Text style={{ fontSize: 22, color: currentHole < 18 ? '#1a1a1a' : '#ccc', fontWeight: '600', lineHeight: 26 }}>›</Text>
              </Pressable>
              <Pressable onPress={() => setShowHolePreview(false)} style={{ marginLeft: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 18, color: '#999' }}>✕</Text>
              </Pressable>
            </View>

            {/* ── Main content: left yardage sidebar + right map ─ */}
            <View style={{ flex: 1, flexDirection: 'row' }}>

              {/* Left sidebar — Back / Green Center / Front / Par */}
              <View style={{ width: '38%', justifyContent: 'center', paddingLeft: 22, paddingRight: 8, backgroundColor: '#fff' }}>
                <Text style={{ color: '#888', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' }}>Hole</Text>
                <Text style={{ color: '#111', fontSize: 52, fontWeight: '900', lineHeight: 56, marginBottom: 4 }}>{currentHole}</Text>

                <View style={{ height: 1, backgroundColor: '#ebebeb', marginVertical: 10 }} />
                <Text style={{ color: '#666', fontSize: 13 }}>Back Edge</Text>
                <Text style={{ color: '#111', fontSize: 34, fontWeight: '800', lineHeight: 38 }}>{backDist}</Text>

                <View style={{ height: 1, backgroundColor: '#ebebeb', marginVertical: 10 }} />
                <Text style={{ color: '#27ae60', fontSize: 13, fontWeight: '700' }}>Green Center</Text>
                <Text style={{ color: '#27ae60', fontSize: 40, fontWeight: '900', lineHeight: 44 }}>{centerDist}</Text>

                <View style={{ height: 1, backgroundColor: '#ebebeb', marginVertical: 10 }} />
                <Text style={{ color: '#666', fontSize: 13 }}>Front Edge</Text>
                <Text style={{ color: '#111', fontSize: 34, fontWeight: '800', lineHeight: 38 }}>{frontDist}</Text>

                <View style={{ height: 1, backgroundColor: '#ebebeb', marginVertical: 10 }} />
                <Text style={{ color: '#666', fontSize: 13 }}>Par</Text>
                <Text style={{ color: '#111', fontSize: 28, fontWeight: '800' }}>{holePar}</Text>

                {/* Target distance (shows when user taps the map) */}
                {distToTarget !== null && (
                  <>
                    <View style={{ height: 1, backgroundColor: '#ebebeb', marginVertical: 10 }} />
                    <Text style={{ color: '#2563eb', fontSize: 12, fontWeight: '600' }}>To Target</Text>
                    <Text style={{ color: '#2563eb', fontSize: 28, fontWeight: '900' }}>{distToTarget}</Text>
                  </>
                )}

                {/* Auto safe target distance (shows when no user tap) */}
                {distToTarget === null && mapSize.w > 1 && (
                  <>
                    <View style={{ height: 1, backgroundColor: '#ebebeb', marginVertical: 10 }} />
                    <Text style={{ color: '#16a34a', fontSize: 12, fontWeight: '700' }}>Safe Zone</Text>
                    <Text style={{ color: '#16a34a', fontSize: 28, fontWeight: '900' }}>{autoSafeTarget.dist}</Text>
                  </>
                )}

                {/* Plays like — wind/elevation adjustment */}
                {effectiveDistResult.isAdjusted && (
                  <>
                    <View style={{ height: 1, backgroundColor: '#ebebeb', marginVertical: 10 }} />
                    <Text style={{ color: '#d97706', fontSize: 11, fontWeight: '700' }}>
                      {wind.direction === 'head' ? '↑' : wind.direction === 'tail' ? '↓' : wind.direction === 'left' ? '←' : wind.direction === 'right' ? '→' : ''}
                      {wind.speed > 0 ? ` ${wind.speed} mph` : ''}
                      {elevation !== 'flat' ? ` · ${elevation === 'up' ? '▲' : '▼'}` : ''}
                    </Text>
                    <Text style={{ color: '#d97706', fontSize: 13, fontWeight: '800' }}>
                      {displayDistance} plays like {effectiveDistance}
                    </Text>
                  </>
                )}
              </View>

              {/* Right map panel */}
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fafafa' }}>
                <View
                  style={{ width: '88%', flex: 1, maxHeight: '96%', borderRadius: 48, overflow: 'hidden', backgroundColor: '#d0e8d0' }}
                  onLayout={(e) => {
                    const { width: w, height: h } = e.nativeEvent.layout;
                    setMapSize({ w, h });
                    setPreviewImgSize({ w, h });
                  }}
                >
                  {/* Background hole image */}
                  {fullSource ? (
                    <Image
                      source={fullSource}
                      style={{ position: 'absolute', width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={{ position: 'absolute', width: '100%', height: '100%', backgroundColor: '#2d5a27' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.15)', fontSize: 60, fontWeight: '900', textAlign: 'center', marginTop: '40%' }}>{currentHole}</Text>
                    </View>
                  )}

                  {/* Touch surface */}
                  <View
                    style={{ position: 'absolute', width: '100%', height: '100%' }}
                    onStartShouldSetResponder={() => true}
                    onResponderGrant={(e) => {
                      const { locationX, locationY } = e.nativeEvent;
                      if (puttMode) {
                        if (!puttBall) { setPuttBall({ x: locationX, y: locationY }); try { void Haptics.selectionAsync(); } catch {} }
                        else { setPuttHole({ x: locationX, y: locationY }); triggerHaptic(Haptics.ImpactFeedbackStyle.Medium); }
                        return;
                      }
                      lastNudgedHazardRef.current = null;
                      // Capture original tap for "Your Aim" line (held until hole changes)
                      const newTarget = { px: locationX, py: locationY };
                      setOriginalTarget(newTarget);
                      originalFadeAnim.setValue(1);
                      if (originalFadeTimer.current) clearTimeout(originalFadeTimer.current);
                      // Auto-fade "Your Aim" line after 2 seconds
                      originalFadeTimer.current = setTimeout(() => {
                        Animated.timing(originalFadeAnim, {
                          toValue: 0, duration: 600, useNativeDriver: true,
                        }).start();
                      }, 2000);
                      setTargetPosition({ px: locationX, py: locationY });
                      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
                      playSoundTap();
                    }}
                    onResponderMove={(e) => {
                      if (!targetPosition) return;
                      const { locationX, locationY } = e.nativeEvent;
                      if (dragDebounceRef.current) return;
                      dragDebounceRef.current = setTimeout(() => {
                        dragDebounceRef.current = null;
                        setTargetPosition({ px: locationX, py: locationY });
                        triggerHaptic(Haptics.ImpactFeedbackStyle.Light, 500);
                      }, 60);
                    }}
                    onResponderRelease={() => {
                      if (dragDebounceRef.current) { clearTimeout(dragDebounceRef.current); dragDebounceRef.current = null; }
                    }}
                  />

                  {/* ── Before/After: "Your Aim" fading layer + comparison legend ─── */}
                  {originalTarget && targetPosition && mapSize.w > 1 && (
                    <Animated.View
                      style={{ position: 'absolute', width: '100%', height: '100%', opacity: originalFadeAnim }}
                      pointerEvents="none"
                    >
                      <Svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
                        {/* Yellow dashed "Your Aim" line */}
                        <Path
                          d={`M ${bx} ${by} L ${originalTarget.px} ${originalTarget.py}`}
                          stroke="#facc15"
                          strokeWidth={2.5}
                          strokeDasharray="7,5"
                          fill="none"
                          strokeLinecap="round"
                          opacity={0.85}
                        />
                        {/* Small yellow circle at original tap point */}
                        <Circle cx={originalTarget.px} cy={originalTarget.py} r={7} fill="none" stroke="#facc15" strokeWidth="2" opacity={0.85} />
                        <Circle cx={originalTarget.px} cy={originalTarget.py} r={3} fill="#facc15" opacity={0.85} />
                      </Svg>

                      {/* "Your Aim" label at midpoint of yellow line */}
                      <View
                        style={{
                          position: 'absolute',
                          left: (bx + originalTarget.px) / 2 + 6,
                          top: (by + originalTarget.py) / 2 - 18,
                          backgroundColor: 'rgba(250,204,21,0.92)',
                          borderRadius: 5,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                        }}
                        pointerEvents="none"
                      >
                        <Text style={{ color: '#000', fontSize: 10, fontWeight: '700' }}>Your Aim</Text>
                      </View>

                      {/* Comparison legend — top-left corner, only when adjustment is visible */}
                      {isAdjusted && (
                        <View style={{
                          position: 'absolute', top: 10, left: 10,
                          backgroundColor: 'rgba(0,0,0,0.72)',
                          borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
                          gap: 5,
                        }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 20, height: 2, backgroundColor: '#facc15', borderRadius: 1, borderStyle: 'dashed' }} />
                            <Text style={{ color: '#facc15', fontSize: 11, fontWeight: '700' }}>Your Aim</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 20, height: 2.5, backgroundColor: '#4ade80', borderRadius: 1 }} />
                            <Text style={{ color: '#4ade80', fontSize: 11, fontWeight: '700' }}>Caddie</Text>
                          </View>
                        </View>
                      )}
                    </Animated.View>
                  )}

                  {/* "Caddie Adjusted" label on green line — appears when adjustment is active */}
                  {isAdjusted && targetPosition && mapSize.w > 1 && (
                    <View
                      style={{
                        position: 'absolute',
                        left: adjMidX + 6,
                        top: adjMidY - 18,
                        backgroundColor: 'rgba(74,222,128,0.92)',
                        borderRadius: 5,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                      }}
                      pointerEvents="none"
                    >
                      <Text style={{ color: '#000', fontSize: 10, fontWeight: '700' }}>Caddie</Text>
                    </View>
                  )}

                  {/* SVG overlay */}
                  {mapSize.w > 1 && (
                    <Svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
                      {/* Shot line: ball → target or ball → pin (Caddie adjusted line) */}
                      <Path
                        d={shotPath}
                        stroke={targetPosition ? '#4ade80' : 'rgba(255,255,255,0.9)'}
                        strokeWidth={targetPosition ? 2.5 : 2}
                        strokeDasharray={targetPosition ? undefined : '8,6'}
                        fill="none"
                        strokeLinecap="round"
                      />
                      {/* Pin ring (teal/cyan like Golfshot) */}
                      <Circle cx={gx} cy={gy} r={22} fill="none" stroke="rgba(0,200,180,0.7)" strokeWidth="3" />
                      <Circle cx={gx} cy={gy} r={14} fill="rgba(0,200,180,0.35)" />
                      <Circle cx={gx} cy={gy} r={4} fill="#fff" />

                      {/* Auto safe target (green) — visible when no user tap */}
                      {mapSize.w > 1 && (
                        <>
                          <Circle
                            cx={autoSafeTarget.px}
                            cy={autoSafeTarget.py}
                            r={16}
                            fill="rgba(34,197,94,0.22)"
                            stroke="#22c55e"
                            strokeWidth="2"
                            opacity={targetPosition ? 0.45 : 0.9}
                          />
                          <Circle cx={autoSafeTarget.px} cy={autoSafeTarget.py} r={5} fill="#22c55e" opacity={targetPosition ? 0.4 : 0.9} />
                        </>
                      )}

                      {/* Target ring (user tap — blue) */}
                      {tx !== null && ty !== null && (
                        <Animated.View
                          style={{ position: 'absolute', width: 30, height: 30, left: animatedTarget.x, top: animatedTarget.y, transform: [{ scale: nudgeAnim }] }}
                          pointerEvents="none"
                        >
                          <Svg width="30" height="30">
                            <Circle cx={15} cy={15} r={12} fill="none" stroke="#facc15" strokeWidth="2.5" />
                            <Circle cx={15} cy={15} r={4} fill="#facc15" />
                          </Svg>
                        </Animated.View>
                      )}

                      {/* Actual shot line — after shot logged */}
                      {shotStartPixel && (
                        <Path d={`M ${shotStartPixel.x} ${shotStartPixel.y} L ${bx} ${by}`} stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity={0.85} />
                      )}

                      {/* Tee ball (blue like Golfshot) */}
                      <Circle cx={bx} cy={by} r={12} fill="rgba(255,255,255,0.9)" />
                      <Circle cx={bx} cy={by} r={9} fill="#4FC8E8" />
                      <Circle cx={bx} cy={by} r={4} fill="#fff" />

                      {/* Hazard diamonds */}
                      {hazardWarnings.map((hw, i) => {
                        const col = hw.type === 'water' ? '#3b82f6' : hw.type === 'ob' ? '#ef4444' : '#f59e0b';
                        const cx = hw.projPx.x; const cy = hw.projPx.y; const s = 7;
                        return (
                          <React.Fragment key={`hz-${i}`}>
                            <Path d={`M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`} fill={col} opacity={0.9} />
                          </React.Fragment>
                        );
                      })}
                    </Svg>
                  )}

                  {/* Distance label on shot line — center of line */}
                  {mapSize.w > 1 && (
                    <View
                      style={{ position: 'absolute', left: (tMidX ?? midX) - 28, top: (tMidY ?? midY) - 14, width: 56, height: 28, alignItems: 'center', justifyContent: 'center' }}
                      pointerEvents="none"
                    >
                      <View style={{ backgroundColor: 'rgba(0,0,0,0.58)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900', textAlign: 'center' }}>
                          {distToTarget !== null ? distToTarget : centerDist}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Hazard warnings */}
                  {hazardWarnings.length > 0 && (
                    <View style={{ position: 'absolute', bottom: 10, left: 8, right: 8 }} pointerEvents="none">
                      {hazardWarnings.map((hw, i) => {
                        const col = hw.type === 'water' ? '#3b82f6' : hw.type === 'ob' ? '#ef4444' : '#f59e0b';
                        const icon = hw.type === 'water' ? '💧' : hw.type === 'ob' ? '⚠️' : '⛳';
                        return (
                          <View key={i} style={{ backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 4, borderLeftWidth: 3, borderLeftColor: col }}>
                            <Text style={{ color: col, fontSize: 12, fontWeight: '800' }}>{icon} {hw.label}: Carry {hw.carry} / Clear {hw.clear}</Text>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Putt mode overlays */}
                  {puttMode && puttBall && puttHole && (
                    <PuttLine start={puttBall} end={puttHole} slope={slopeDirection} />
                  )}
                </View>
              </View>
            </View>

            {/* ── Bottom bar: Clear / Putt Mode / Done ─────────── */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' }}>
              {puttMode ? (
                <Pressable onPress={() => { setPuttBall(null); setPuttHole(null); setSlopeDirection(null); }} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#d8b4fe' }}>
                  <Text style={{ color: '#7c3aed', fontSize: 12, fontWeight: '600' }}>Reset Putt</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setTargetPosition(null)} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#e5e7eb' }}>
                  <Text style={{ color: '#6b7280', fontSize: 12 }}>Clear Target</Text>
                </Pressable>
              )}

              {/* Putt mode slope selector */}
              {puttMode && puttBall && puttHole && (() => {
                const dx = puttHole.x - puttBall.x;
                const dy = puttHole.y - puttBall.y;
                const pxDist = Math.sqrt(dx * dx + dy * dy);
                const pixelsPerYard = mapSize.h > 1 ? mapSize.h / holeYards : 2;
                const puttFt = Math.round((pxDist / pixelsPerYard) * 3);
                const { speedHint, slopeLabel } = calculateBreak({ start: puttBall, end: puttHole, slope: slopeDirection });
                return (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: '#7c3aed', fontSize: 14, fontWeight: '700' }}>{puttFt} ft · {slopeLabel}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 11 }}>{speedHint}</Text>
                  </View>
                );
              })()}

              <Pressable
                onPress={() => { const next = !puttMode; setPuttMode(next); if (next) { setPuttBall(null); setPuttHole(null); setSlopeDirection(null); checkAndShow('putt_mode', () => showTip('putt_mode', "Tap your ball position, then the hole to read your putt.")); } }}
                style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: puttMode ? '#7c3aed' : '#e5e7eb', backgroundColor: puttMode ? 'rgba(124,58,237,0.08)' : 'transparent' }}
              >
                <Text style={{ color: puttMode ? '#7c3aed' : '#6b7280', fontSize: 12, fontWeight: '700' }}>
                  🟣 {puttMode ? 'Exit Putt' : 'Putt Mode'}
                </Text>
              </Pressable>

              <Pressable onPress={() => setShowHolePreview(false)} style={{ paddingHorizontal: 20, paddingVertical: 9, borderRadius: 20, backgroundColor: '#111' }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Done</Text>
              </Pressable>
            </View>

            {/* Putt mode instructions */}
            {puttMode && (
              <View style={{ alignItems: 'center', paddingBottom: 8 }}>
                {(['left','right','uphill','downhill'] as SlopeDirection[]).length > 0 && (
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 12 }}>
                    {(['left','right','uphill','downhill'] as SlopeDirection[]).map((dir) => {
                      const labels: Record<string, string> = { left:'⬅️ Left', right:'➡️ Right', uphill:'⬆️ Up', downhill:'⬇️ Down' };
                      const active = slopeDirection === dir;
                      return (
                        <Pressable key={dir!} onPress={() => setSlopeDirection(active ? null : dir)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1.5, borderColor: active ? '#7c3aed' : '#e5e7eb', backgroundColor: active ? 'rgba(124,58,237,0.1)' : 'transparent' }}>
                          <Text style={{ color: active ? '#7c3aed' : '#6b7280', fontSize: 12 }}>{labels[dir!]}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                <Text style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>
                  {!puttBall ? 'Tap ball position on map' : !puttHole ? 'Tap hole on map' : 'Select break direction'}
                </Text>
              </View>
            )}

          </SafeAreaView>
          

              {/* Map area — tappable to set target */}
              <View
                style={{ flex: 1 }}
                onLayout={(e) => {
                  const { width: w, height: h } = e.nativeEvent.layout;
                  setMapSize({ w, h });
                  setPreviewImgSize({ w, h });
                }}
              >
                {/* Background image or solid fallback */}
                {fullSource ? (
                  <Image
                    source={fullSource}
                    style={{ position: 'absolute', width: '100%', height: '100%' }}
                    resizeMode="cover"
                    onError={() => setShowHolePreview(false)}
                  />
                ) : (
                  <View style={{ position: 'absolute', width: '100%', height: '100%', backgroundColor: '#0a1f0e' }} />
                )}

                {/* Touch surface — tap to set target; drag to move it (drag enabled after first tap) */}
                <View
                  style={{ position: 'absolute', width: '100%', height: '100%' }}
                  onStartShouldSetResponder={() => true}
                  onResponderGrant={(e) => {
                    const { locationX, locationY } = e.nativeEvent;
                    if (puttMode) {
                      if (!puttBall) {
                        setPuttBall({ x: locationX, y: locationY });
                        try { void Haptics.selectionAsync(); } catch {}
                      } else {
                        setPuttHole({ x: locationX, y: locationY });
                        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                      }
                      return;
                    }
                    lastNudgedHazardRef.current = null; // reset on new gesture
                    setTargetPosition({ px: locationX, py: locationY });
                    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
                    playSoundTap();
                    // Tip: first time user taps the map
                    checkAndShow('target_tap', () => showTip('target_tap', "Tap anywhere to plan your shot. Caddie will handle the rest."));
                  }}
                  onResponderMove={(e) => {
                    // Only drag-update after target is already set
                    if (!targetPosition) return;
                    const { locationX, locationY } = e.nativeEvent;
                    // Debounce at 60ms — prevents excessive re-renders during fast moves
                    if (dragDebounceRef.current) return;
                    dragDebounceRef.current = setTimeout(() => {
                      dragDebounceRef.current = null;
                      setTargetPosition({ px: locationX, py: locationY });
                      triggerHaptic(Haptics.ImpactFeedbackStyle.Light, 500);
                    }, 60);
                  }}
                  onResponderRelease={() => {
                    if (dragDebounceRef.current) {
                      clearTimeout(dragDebounceRef.current);
                      dragDebounceRef.current = null;
                    }
                  }}
                />

                {/* SVG overlay — ball, pin, target, shot line; no re-renders per frame */}
                {mapSize.w > 1 && (
                  <Animated.View
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                      opacity: targetPosition ? svFadeAnim : 1 }}
                    pointerEvents="none"
                  >
                  <Svg
                    width="100%" height="100%"
                    style={{ position: 'absolute', top: 0, left: 0 }}
                    pointerEvents="none"
                  >
                    {/* Shot line: ball → target (solid) or ball → pin (dashed) */}
                    <Path
                      d={shotPath}
                      stroke={targetPosition ? Palette.positive : 'rgba(255,255,255,0.25)'}
                      strokeWidth="2"
                      strokeDasharray={targetPosition ? undefined : '6,5'}
                      fill="none"
                      strokeLinecap="round"
                    />
                    {/* Green pin */}
                    <Circle cx={gx} cy={gy} r={8} fill="#e63946" opacity={0.9} />
                    <Circle cx={gx} cy={gy} r={3} fill="#fff" />
                    {/* Target ring — animates to tap position smoothly */}
                    {tx !== null && ty !== null && (
                      <Animated.View
                        style={[
                          { position: 'absolute', width: 26, height: 26,
                            left: animatedTarget.x,
                            top:  animatedTarget.y,
                            transform: [{ scale: nudgeAnim }] },
                        ]}
                        pointerEvents="none"
                      >
                        <Svg width="26" height="26">
                          <Circle cx={13} cy={13} r={10} fill="none" stroke={Palette.positive} strokeWidth="2.5" />
                          <Circle cx={13} cy={13} r={3}  fill={Palette.positive} />
                        </Svg>
                      </Animated.View>
                    )}
                    {/* Actual shot line — blue, shown after shot is hit */}
                    {shotStartPixel && (
                      <Path
                        d={`M ${shotStartPixel.x} ${shotStartPixel.y} L ${bx} ${by}`}
                        stroke="#38BDF8"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray="none"
                        fill="none"
                        opacity={0.85}
                      />
                    )}
                    {/* Ball (white outer, dark inner) */}
                    <Circle cx={bx} cy={by} r={8} fill="#fff" />
                    <Circle cx={bx} cy={by} r={5} fill="#1a1a1a" />
                    {/* Hazard markers on line — diamond at carry position */}
                    {hazardWarnings.map((hw, i) => {
                      const col = hw.type === 'water' ? '#60a5fa' : hw.type === 'ob' ? '#f87171' : '#fcd34d';
                      const cx  = hw.projPx.x;
                      const cy  = hw.projPx.y;
                      const s   = 7; // half-size of diamond
                      return (
                        <React.Fragment key={`hz-${i}`}>
                          <Path
                            d={`M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`}
                            fill={col}
                            opacity={0.88}
                          />
                        </React.Fragment>
                      );
                    })}
                  </Svg>
                  </Animated.View>
                )}

                {/* Post-shot result badge — auto-fades after 6s */}
                {actualShotResult !== null && (
                  <View style={{
                    position: 'absolute', top: 10, left: 10,
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: 'rgba(0,0,0,0.72)',
                    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
                    borderWidth: 1, borderColor: '#38BDF8',
                  }} pointerEvents="none">
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#38BDF8' }} />
                    <Text style={{ color: '#38BDF8', fontSize: 13, fontWeight: '700' }}>
                      Shot: {actualShotResult === 'good' ? 'On target' : actualShotResult}
                    </Text>
                  </View>
                )}

                {/* Legend: green = planned, blue = actual */}
                {shotStartPixel !== null && (
                  <View style={{
                    position: 'absolute', top: 10, right: 10,
                    flexDirection: 'column', gap: 4,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
                  }} pointerEvents="none">
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <View style={{ width: 14, height: 2, backgroundColor: Palette.positive, borderRadius: 1 }} />
                      <Text style={{ color: Palette.positive, fontSize: 10 }}>Planned</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <View style={{ width: 14, height: 2, backgroundColor: '#38BDF8', borderRadius: 1 }} />
                      <Text style={{ color: '#38BDF8', fontSize: 10 }}>Actual</Text>
                    </View>
                  </View>
                )}
              </View>

          </Modal>
        );
      })()}

      {/* ── Course Info Modal ─────────────────────────────────────────────── */}
      <Modal
        visible={showCourseInfo}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowCourseInfo(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#0a1f0a' }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(74,222,128,0.2)' }}>
            <Pressable onPress={() => setShowCourseInfo(false)} style={{ marginRight: 16, padding: 8 }}>
              <Text style={{ color: Palette.positive, fontSize: 24, lineHeight: 24 }}>✕</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.3 }}>{activeCourseData?.name ?? activeCourse}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 2 }}>{activeCourseData?.location ?? ''}</Text>
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {/* Course stats row */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 20, marginHorizontal: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>Slope</Text>
                <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 4 }}>{activeCourseData?.slope ?? '–'}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>Rating</Text>
                <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 4 }}>{activeCourseData?.rating ?? '–'}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>Holes</Text>
                <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 4 }}>{activeCourseData?.holes?.length ?? 18}</Text>
              </View>
            </View>

            {/* Hole image gallery — all holes that have images */}
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginLeft: 20, marginTop: 24, marginBottom: 12 }}>Hole Tour</Text>
            {activeCourseData?.holes.filter(h => h.fullImage || h.thumbnail).map(h => (
              <View key={h.hole} style={{ marginHorizontal: 20, marginBottom: 16, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0d2b18' }}>
                <Image
                  source={(h.fullImage ?? h.thumbnail) as ImageSourcePropType}
                  style={{ width: '100%', height: 200 }}
                  resizeMode="cover"
                />
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Hole {h.hole}  ·  Par {h.par}</Text>
                  <Text style={{ color: Palette.positive, fontWeight: '700', fontSize: 14 }}>{h.distance} yds</Text>
                </View>
              </View>
            ))}

            {/* Book tee time button */}
            {activeCourseData?.teeTimeUrl && (
              <Pressable
                onPress={() => { if (activeCourseData?.teeTimeUrl) Linking.openURL(activeCourseData.teeTimeUrl); }}
                style={{ marginHorizontal: 20, marginTop: 12, backgroundColor: Palette.positive, borderRadius: 14, paddingVertical: 18, alignItems: 'center' }}
              >
                <Text style={{ color: '#000', fontWeight: '900', fontSize: 17, letterSpacing: 0.5 }}>Book a Tee Time</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Shot Camera Modal */}
      <Modal
        visible={showShotCamera}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setShowShotCamera(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <ShotCamera
            onCapture={(uri) => {
              // Empty URI = permission denied or camera error — close modal, don't open player
              if (!uri) { setShowShotCamera(false); return; }
              setLastVideoUri(uri);
              setShowShotCamera(false);
              setShowShotVision(true);
              // Auto-link media to the most recently logged shot
              tagLastShotMedia(uri);
              showVisionFeedback(uri);
            }}
          />
          <Pressable
            onPress={() => setShowShotCamera(false)}
            style={{ position: 'absolute', top: 48, left: 20, padding: 8 }}
          >
            <Text style={{ color: '#fff', fontSize: 14 }}>✕ Cancel</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Shot Vision Overlay */}
      {showShotVision && lastVideoUri ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 50 }}
        >
          <ShotVisionPlayer uri={lastVideoUri} insight="That's your fade." />
        </View>
      ) : null}

      {/* SmartVision result / swing thought reinforcement overlay */}
      {!!visionOverlay && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', bottom: 120, left: 0, right: 0, alignItems: 'center', zIndex: 55 }}
        >
          <View style={{ backgroundColor: 'rgba(10,30,15,0.88)', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#1F6F54' }}>
            <Text style={{ color: '#A7F3D0', fontSize: 15, fontWeight: '700', textAlign: 'center' }}>{visionOverlay}</Text>
          </View>
        </View>
      )}

      {/* Body � fixed layout, no scroll */}

      {/* Shot feedback overlay — auto hides after 1.75 s */}
      {shotFeedback.visible && (
        <View style={s.feedbackOverlay} pointerEvents="none">
          <View style={[
            s.feedbackBadge,
            shotFeedback.result === 'left'     && { borderColor: '#60a5fa' },
            shotFeedback.result === 'right'    && { borderColor: Palette.miss },
            shotFeedback.result === 'center' && { borderColor: Palette.positive },
          ]}>
            <Text style={[
              s.feedbackDir,
              shotFeedback.result === 'left'     && { color: '#60a5fa' },
              shotFeedback.result === 'right'    && { color: Palette.miss },
              shotFeedback.result === 'center' && { color: Palette.positive },
            ]}>
              {shotFeedback.result === 'left' ? '← Left' : shotFeedback.result === 'right' ? 'Right →' : 'Straight'}
            </Text>
            {!!shotFeedback.insight && (
              <Text style={s.feedbackInsight} numberOfLines={2}>{shotFeedback.insight}</Text>
            )}
          </View>
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* Player tabs */}
        {activePlayerCount > 1 && (
          <View style={s.playerTabs}>
            {Array.from({ length: activePlayerCount }, (_, i) => (
              <Pressable
                key={i}
                onPress={() => setActivePlayerIdx(i)}
                style={[s.playerTab, activePlayerIdx === i && s.playerTabActive]}
              >
                <Text style={[s.playerTabText, activePlayerIdx === i && s.playerTabTextActive]}>
                  {gridPlayerNames[i] ?? `P${i + 1}`}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* â”€â”€ Hole + Score Steppers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {/* ── Strategy + Aim Row ────────────────────────────────────────── */}
        <View style={s.strategyRow}>
          <Text style={s.strategyLine}>
            {strategyMode === 'attack' ? 'Attack' : strategyMode === 'safe' ? 'Play safe' : 'Balanced'}
            {' · '}
            {goalMode === 'break90' ? 'Break 90' : goalMode === 'break80' ? 'Break 80' : 'Enjoy'}
          </Text>
          <View style={s.aimRow}>
            {(['left', 'center', 'right'] as const).map((a) => (
              <Pressable
                key={a}
                style={[s.aimBtn, aimTarget === a && s.aimBtnActive]}
                onPress={() => setAimTarget(a)}
              >
                <Text style={[s.aimBtnText, aimTarget === a && s.aimBtnTextActive]}>
                  {a === 'left' ? 'L' : a === 'center' ? 'CTR' : 'R'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={s.stepperRow}>
          <View style={s.stepperCard}>
            <Text style={s.stepperLabel}>HOLE</Text>
            <View style={s.stepperControls}>
              <Pressable style={s.stepperBtn} onPress={() => { const h = Math.max(1, currentHole - 1); setCurrentHole(h); try { Haptics.selectionAsync(); } catch {} }}>
                <MCIcon name="minus" size={16} color={Palette.positiveFaint} />
              </Pressable>
              <Text style={s.stepperValue}>{currentHole}</Text>
              <Pressable style={s.stepperBtn} onPress={() => { const h = Math.min(18, currentHole + 1); setCurrentHole(h); try { Haptics.selectionAsync(); } catch {} }}>
                <MCIcon name="plus" size={16} color={Palette.positiveFaint} />
              </Pressable>
            </View>
            <Text style={s.stepperSub}>Par {holePar}</Text>
          </View>

          <View style={s.stepperDivider} />

          <View style={s.stepperCard}>
            <Text style={s.stepperLabel}>SCORE</Text>
            {(() => {
              const sc   = gridScores[activePlayerIdx]?.[currentHole - 1] ?? 0;
              const diff = sc > 0 ? sc - holePar : null;
              const clr  = diff === null ? Palette.muted : diff < 0 ? Palette.positive : diff === 0 ? Palette.positiveFaint : diff === 1 ? Palette.warn : Palette.miss;
              const sub  = diff === null ? '—' : diff < -1 ? 'Eagle' : diff === -1 ? 'Birdie' : diff === 0 ? 'Par' : diff === 1 ? 'Bogey' : `+${diff}`;
              return (
                <>
                  <View style={s.stepperControls}>
                    <Pressable style={s.stepperBtn} onPress={() => { const cur = gridScores[activePlayerIdx]?.[currentHole - 1] ?? 0; setCourseHoleScore(activePlayerIdx, currentHole - 1, Math.max(1, cur - 1)); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} }}>
                      <MCIcon name="minus" size={16} color={Palette.positiveFaint} />
                    </Pressable>
                    <Text style={[s.stepperValue, { color: clr }]}>{sc > 0 ? sc : '—'}</Text>
                    <Pressable style={s.stepperBtn} onPress={() => { const cur = gridScores[activePlayerIdx]?.[currentHole - 1] ?? 0; const next = Math.min(15, cur + 1); setCourseHoleScore(activePlayerIdx, currentHole - 1, next); const advice = getScoreAwareAdvice(next, holePar); setCaddieMsg(advice); // speak only on first tap per hole — subsequent taps update text silently
                      if (voiceEnabled && cur === 0) void speakJob(advice, ENGINE_PRIORITY.STRATEGY, voiceGender); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} }}>
                      <MCIcon name="plus" size={16} color={Palette.positiveFaint} />
                    </Pressable>
                  </View>
                  <Text style={[s.stepperSub, { color: clr }]}>{sub}</Text>
                </>
              );
            })()}
          </View>
        </View>

        {/* â”€â”€ Distance Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <Pressable onPress={openRangefinder}>
          <Animated.View style={[s.distanceCard, { transform: [{ scale: rfScale }] }]}>
                <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(74,222,128,0.12)', borderRadius: 8, padding: 5, borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)' }}>
                  <Image source={ICON_RANGEFINDER} style={{ width: 18, height: 18, tintColor: Palette.positive }} resizeMode="contain" />
                </View>
                <Text style={[s.distanceNum, lockedDistance !== null && { color: Palette.positive }]}>
                  {displayDistance}
                </Text>
                <Text style={s.distanceUnit}>
                  {lockedDistance !== null ? 'LOCKED \u00b7 YARDS TO PIN' : 'YARDS TO PIN'}
                </Text>
                {effectiveDistResult.isAdjusted && (
                  <Text style={{ color: Palette.warn, fontSize: 13, fontWeight: '700', marginTop: 2 }}>
                    Plays like {effectiveDistance} yds{effectiveDistResult.delta > 0 ? ` (+${effectiveDistResult.delta})` : ` (${effectiveDistResult.delta})`}
                  </Text>
                )}
                {clubRec.club && (
                  <Text style={s.distanceClub}>{clubRec.club}</Text>
                )}
                {/* SmartFinder: front / center / back yardage strip */}
                {(() => {
                  const holeData = activeCourseData?.holes[currentHole - 1];
                  const loc = unifiedGPS.location;
                  if (!holeData || !loc) return null;
                  const fDist = holeData.front
                    ? unifiedGPS.distanceTo(holeData.front.lat, holeData.front.lng)
                    : null;
                  const bDist = holeData.back
                    ? unifiedGPS.distanceTo(holeData.back.lat, holeData.back.lng)
                    : null;
                  // CTR reuses unifiedMiddleDist — same value shown as the main YARDS TO PIN number
                  const front  = fDist !== null ? Math.round(fDist) : (unifiedMiddleDist !== null ? unifiedMiddleDist - 15 : null);
                  const center = unifiedMiddleDist;
                  const back   = bDist !== null ? Math.round(bDist) : (unifiedMiddleDist !== null ? unifiedMiddleDist + 15 : null);
                  if (front === null && center === null && back === null) return null;
                  return (
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: 'rgba(0,0,0,0.28)',
                      paddingVertical: 5,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      marginTop: 8,
                      borderWidth: 1,
                      borderColor: 'rgba(74,222,128,0.18)',
                    }}>
                      {/* FRONT — small, left */}
                      <View style={{ flex: 1, alignItems: 'flex-start' }}>
                        <Text style={{ color: Palette.textSub, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 }}>FRNT</Text>
                        <Text style={{ color: '#aaa', fontSize: 15, fontWeight: '600', marginTop: 1 }}>{front ?? '--'}</Text>
                      </View>
                      {/* CENTER — dominant, centered */}
                      <View style={{ alignItems: 'center', paddingHorizontal: 16 }}>
                        <Text style={{ color: Palette.positiveFaint, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 }}>CTR</Text>
                        <Text style={{ color: Palette.positive, fontSize: 26, fontWeight: '800', lineHeight: 30, marginTop: 1 }}>{center ?? '--'}</Text>
                      </View>
                      {/* BACK — small, right */}
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <Text style={{ color: Palette.textSub, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 }}>BACK</Text>
                        <Text style={{ color: '#aaa', fontSize: 15, fontWeight: '600', marginTop: 1 }}>{back ?? '--'}</Text>
                      </View>
                    </View>
                  );
                })()}
                {gpsMiddle !== null && (
                  <View style={s.gpsBadge}>
                    <Text style={{ color: Palette.positiveFaint, fontSize: 14, fontWeight: '600', letterSpacing: 0.5 }}>
                      {golfGPS.accuracyLevel === 'high' ? 'GPS • High' :
                       golfGPS.accuracyLevel === 'balanced' ? 'GPS • Balanced' :
                       golfGPS.accuracyLevel === 'lastknown' ? 'GPS • Last Known' :
                       golfGPS.accuracyLevel === 'manual' ? 'GPS • Manual' :
                       'GPS active'}
                    </Text>
                  </View>
                )}
                {golfGPS.isManual && gpsMiddle === null && (
                  <View style={s.gpsBadge}>
                    <Text style={{ color: Palette.warn, fontSize: 13, fontWeight: '600' }}>Tap map to set position</Text>
                  </View>
                )}
                {lockedDistance !== null && (
                  <Pressable onPress={(e) => { e.stopPropagation(); setLockedDistance(null); }} style={{ marginTop: 4 }}>
                    <Text style={{ color: Palette.textSub, fontSize: 14 }}>clear lock</Text>
                  </Pressable>
                )}

          </Animated.View>
        </Pressable>

        {/* ── Wind + Elevation Controls ────────────────────────────────────── */}
        <View style={{ marginHorizontal: 0, marginBottom: 6 }}>
          {/* Wind direction row */}
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
            {(['head', 'tail', 'left', 'right'] as const).map((dir) => {
              const labels: Record<string, string> = { head: '⬆ Head', tail: '⬇ Tail', left: '← Cross L', right: 'Cross R →' };
              const active = wind.direction === dir;
              return (
                <Pressable
                  key={dir}
                  onPress={() => setWind((w) => ({ ...w, direction: dir }))}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8,
                    backgroundColor: active ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.05)',
                    borderWidth: 1, borderColor: active ? Palette.positive : Palette.border,
                  }}
                >
                  <Text style={{ color: active ? Palette.positive : Palette.muted, fontSize: 11, fontWeight: active ? '700' : '500' }}>
                    {labels[dir]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* Wind speed + elevation row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Speed stepper */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: Palette.border }}>
              <Pressable onPress={() => setWind((w) => ({ ...w, speed: Math.max(0, w.speed - 5) }))}>
                <MCIcon name="minus" size={14} color={Palette.muted} />
              </Pressable>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', minWidth: 46, textAlign: 'center' }}>{wind.speed} mph</Text>
              <Pressable onPress={() => setWind((w) => ({ ...w, speed: Math.min(40, w.speed + 5) }))}>
                <MCIcon name="plus" size={14} color={Palette.muted} />
              </Pressable>
            </View>
            {/* Elevation toggle */}
            <View style={{ flex: 1, flexDirection: 'row', gap: 5 }}>
              {(['up', 'flat', 'down'] as const).map((el) => {
                const elLabels: Record<string, string> = { up: '↑ Up', flat: '— Flat', down: '↓ Down' };
                const active = elevation === el;
                return (
                  <Pressable
                    key={el}
                    onPress={() => setElevation(el)}
                    style={{
                      flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8,
                      backgroundColor: active ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.05)',
                      borderWidth: 1, borderColor: active ? Palette.positive : Palette.border,
                    }}
                  >
                    <Text style={{ color: active ? Palette.positive : Palette.muted, fontSize: 11, fontWeight: active ? '700' : '500' }}>
                      {elLabels[el]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* -- SmartCaddie Advice Card -- */}
        <CaddieCard advice={caddie.advice} distance={caddie.distance} recommendedClub={caddie.recommendedClub} logShot={logShot} recordResult={recordResult} target={caddie.target} risk={caddie.risk} todayStatus={todayModel.statusLabel} confidence={caddie.confidence} pressure={caddie.pressure} style={caddie.style} predictedMiss={caddie.predictedMiss} />

        {/* â”€â”€ Ask Caddie — primary CTA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Animated.View style={{ flex: 1, transform: [{ scale: pulseAnim }] }}>
            <Pressable
              onPress={() => { isSpeaking ? stop() : void ask(); }}
              style={[s.askBtn, isSpeaking && s.askBtnActive]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={[s.logoBtnRing, isSpeaking && { borderColor: Palette.miss }]}>
                  <Image source={LOGO} style={s.logoBtnImg} resizeMode="cover" />
                </View>
                <Text style={s.askBtnText}>{isSpeaking ? 'Stop' : 'Ask Caddie'}</Text>
              </View>
            </Pressable>
          </Animated.View>
          <VoiceMicButton
            listening={micListening}
            onPress={toggleMic}
            transcript={micTranscript}
            size={48}
          />
        </View>

        {/* â”€â”€ Secondary Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={s.secondaryRow}>
          {/* SmartVision: opens interactive target map (Golfshot-style) */}
          <Pressable
            style={[s.secondaryBtn, { borderColor: Palette.positive }]}
            onPress={() => {
              setTargetPosition(null);
              setShowHolePreview(true);
            }}
          >
            <SmartVisionIcon size={16} active />
            <Text style={[s.secondaryLabel, { color: Palette.positive }]}>SmartVision</Text>
          </Pressable>
          <Pressable style={[s.secondaryBtn, { borderColor: Palette.accent }]} onPress={() => void handleMarkShot()}>
            <MCIcon name="flag-variant" size={16} color={Palette.accent} />
            <Text style={[s.secondaryLabel, { color: Palette.accent }]}>Mark Shot</Text>
          </Pressable>
          <View style={[s.secondaryBtn, { borderColor: miss !== 'balanced' ? Palette.warn : Palette.border }]}>
            {miss === 'right' ? (
              <MCIcon name="arrow-right-bold" size={16} color={Palette.warn} />
            ) : miss === 'left' ? (
              <MCIcon name="arrow-left-bold" size={16} color={Palette.warn} />
            ) : (
              <MCIcon name="approximately-equal" size={14} color={Palette.muted} />
            )}
            <Text style={[s.secondaryLabel, { color: miss !== 'balanced' ? Palette.warn : Palette.muted }]}>{missLabel}</Text>
          </View>
        </View>


        {/* -- Validation Mode toggle + panel -- */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 8, marginBottom: 4 }}>
          <Pressable
            onPress={() => setValidationMode((v) => !v)}
            style={[
              { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1 },
              validationMode
                ? { backgroundColor: '#1E3A5F', borderColor: '#3B82F6' }
                : { backgroundColor: '#111E14', borderColor: '#1F3A22' },
            ]}
          >
            <View style={[{ width: 8, height: 8, borderRadius: 4 }, validationMode ? { backgroundColor: '#3B82F6' } : { backgroundColor: '#1F3A22' }]} />
            <Text style={{ color: validationMode ? '#93C5FD' : '#4B5563', fontSize: 11, fontWeight: '600' }}>
              {validationMode ? 'Validation ON' : 'Validation Mode'}
            </Text>
          </Pressable>
          {validationMode && Object.keys(validations).length > 0 && (
            <Pressable
              onPress={() => setShowValidationSummary(true)}
              style={{ marginLeft: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: '#059669', backgroundColor: '#052e1e' }}
            >
              <Text style={{ color: '#A7F3D0', fontSize: 11, fontWeight: '600' }}>Summary</Text>
            </Pressable>
          )}
        </View>

        {validationMode && (
          <ValidationPanel
            holeId={currentHole}
            basePar={holePar}
            baseYardage={activeCourseData?.holes?.[currentHole - 1]?.distance ?? HOLE_DISTANCES[Math.min(currentHole - 1, HOLE_DISTANCES.length - 1)]}
            validation={getHoleValidation(currentHole)}
            onYardageAdjust={(delta) => setYardageAdjustment(currentHole, delta)}
            onParOverride={(par) => setParOverride(currentHole, par)}
            onToggleTag={(tag) => toggleTag(currentHole, tag)}
            onClear={() => clearHole(currentHole)}
          />
        )}

        <ValidationSummary
          visible={showValidationSummary}
          validations={validations}
          baseHoles={baseHolesForSummary.length > 0 ? baseHolesForSummary : HOLE_DISTANCES.map((y, i) => ({ hole: i + 1, par: 4, yardage: y }))}
          onClose={() => setShowValidationSummary(false)}
        />
        {/* â”€â”€ Shot Correction Prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {/* ── Shot Buttons [LEFT / STRAIGHT / RIGHT] ────────────── */}
        <View style={s.shotRow}>
          {([
            { r: 'left',     l: 'Left',     style: s.shotBtnLeft     },
            { r: 'center',   l: 'Straight', style: s.shotBtnStraight },
            { r: 'right',    l: 'Right',    style: s.shotBtnRight    },
          ] as const).map(({ r, l, style }) => (
            <Pressable
              key={r}
              style={[s.shotBtn, style]}
              onPress={() => void recordShot(r)}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Text style={s.shotBtnText}>{l}</Text>
            </Pressable>
          ))}
        </View>

        {/* Pattern preview — hidden when swing thought suggestion is active to avoid info overload */}
        {pattern.currentPattern !== 'neutral' && pattern.patternConfidence > 30 && !swingThoughtSuggestion && (
          <View style={s.patternRow}>
            <MCIcon
              name={pattern.currentPattern.includes('right') ? 'trending-up' : 'trending-down'}
              size={13}
              color={Palette.warn}
            />
            <Text style={s.patternText} numberOfLines={1}>
              {pattern.patternInsight.split('.')[0]} · {pattern.patternConfidence}%
            </Text>
          </View>
        )}

        {showCorrection && (
          <ShotCorrectionPrompt
            visible={showCorrection}
            onCorrect={(correction) => adjustLastShot(correction)}
            onDismiss={() => setShowCorrection(false)}
          />
        )}


        {/* Swing thought suggestion banner */}
        {!!swingThoughtSuggestion && !swingThought && (
          <View style={{ backgroundColor: 'rgba(15,40,20,0.95)', borderRadius: 10, borderWidth: 1, borderColor: '#1F6F54', marginBottom: 8, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#6ee7b7', fontSize: 10, fontWeight: '700', letterSpacing: 0.7, marginBottom: 2 }}>SUGGESTION</Text>
              <Text style={{ color: '#d1fae5', fontSize: 13, fontWeight: '600' }}>{swingThoughtSuggestion}</Text>
            </View>
            <Pressable
              onPress={() => { setSwingThought(swingThoughtSuggestion); setSwingThoughtSuggestion(null); }}
              style={{ backgroundColor: '#14532d', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#4ade80' }}
            >
              <Text style={{ color: '#4ade80', fontSize: 12, fontWeight: '700' }}>Use</Text>
            </Pressable>
            <Pressable
              onPress={() => { dismissedAtHoleRef.current = currentHole; setSwingThoughtSuggestion(null); }}
              style={{ paddingHorizontal: 6, paddingVertical: 6 }}
            >
              <Text style={{ color: '#6b7280', fontSize: 12 }}>Dismiss</Text>
            </Pressable>
          </View>
        )}

        {/* Active swing thought pill */}
        {!!swingThought && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(31,111,84,0.15)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(31,111,84,0.4)', paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8, gap: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ade80' }} />
            <Text style={{ color: '#86efac', fontSize: 12, fontWeight: '600', flex: 1 }}>Focus: {swingThought}</Text>
            <Pressable onPress={() => setSwingThought(null)}>
              <Text style={{ color: '#6b7280', fontSize: 11 }}>{String.fromCharCode(10005)}</Text>
            </Pressable>
          </View>
        )}

        {/* â”€â”€ Advice Card — always visible, max 2 lines â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={s.adviceCard}>
          <View style={s.adviceHeader}>
            <Text style={s.adviceLabel}>CADDIE</Text>
            {isSpeaking && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: Palette.positive }} />
                <Text style={{ color: Palette.positive, fontSize: 14, fontWeight: '600' }}>Speaking</Text>
              </View>
            )}
          </View>
          <Text style={s.adviceText} numberOfLines={2}>
            {caddieMsg || (clubRec.reason ?? currentAdvice)}
          </Text>
        </View>

      </ScrollView>

    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: DS.screen,

  // Header
  header:          DS.header,
  headerTitle:     { color: Palette.textPrimary, fontSize: Type.lg, fontWeight: Type.semibold },
  headerSub:       { color: Palette.muted, fontSize: Type.sm, marginTop: 1 },
  toolsPill:       DS.toolsPill,
  toolsPillActive: DS.toolsPillActive,
  dot:             DS.dot,
  dotActive:       DS.dotActive,
  rfBtn:           DS.rfBtn,

  // Tools menu
  toolsMenu:      { ...DS.toolsMenu, top: 84 },
  menuItem:       DS.menuItem,
  menuItemActive: { backgroundColor: Palette.bgActive, borderColor: Palette.borderActive },
  menuItemIcon:   { color: Palette.muted, fontSize: 12, width: 14 },
  menuItemText:   DS.menuItemText,

  // Body — fixed, no scroll
  body: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 22,
    gap: 9,
  },

  // Player tabs
  playerTabs:          { flexDirection: 'row', gap: 6 },
  playerTab:           { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.cardBg },
  playerTabActive:     { backgroundColor: Palette.bgActive, borderColor: Palette.borderActive },
  playerTabText:       { color: Palette.textSub, fontSize: Type.body, fontWeight: Type.semibold },
  playerTabTextActive: { color: Palette.positiveFaint, fontWeight: Type.bold },

  // Hole + Score steppers
  stepperRow: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Palette.border,
    overflow: 'hidden',
  },
  stepperCard: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, paddingHorizontal: 6,
  },
  stepperDivider: { width: 1, backgroundColor: Palette.border, marginVertical: 8 },
  stepperLabel: {
    color: Palette.muted, fontSize: 9,
    fontWeight: Type.medium, letterSpacing: 1.4,
    textTransform: 'uppercase', marginBottom: 4,
  },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: Palette.brandDeep,
    borderWidth: 1, borderColor: Palette.border,
    justifyContent: 'center', alignItems: 'center',
  },
  stepperBtnText: { color: Palette.positiveFaint, fontSize: 16, fontWeight: Type.bold, lineHeight: 20 },
  stepperValue: {
    color: Palette.textPrimary, fontSize: 22, fontWeight: Type.bold,
    minWidth: 26, textAlign: 'center' as const,
  },
  stepperSub: { color: Palette.muted, fontSize: 10, fontWeight: Type.semibold, marginTop: 3 },

  // Distance card — styled as rangefinder
  distanceCard: {
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 2, borderColor: Palette.positive,
    padding: 14, alignItems: 'center',
    shadowColor: Palette.positive,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  distanceNum:  { color: Palette.textPrimary, fontSize: Type.dist, fontWeight: Type.bold, lineHeight: 52 },
  distanceUnit: { color: Palette.textSub, fontSize: Type.sm, fontWeight: Type.semibold, letterSpacing: 1.2, textTransform: 'uppercase' as const, marginTop: 2 },
  distanceClub: { color: Palette.positive, fontSize: Type.md, fontWeight: Type.medium, marginTop: 4 },
  gpsBadge: {
    marginTop: 6, backgroundColor: Palette.brandDeep,
    borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 3,
    borderWidth: 1, borderColor: Palette.border,
  },





  // Ask Caddie — primary CTA
  askBtn: {
    backgroundColor: Palette.positive,
    borderRadius: Radius.lg,
    paddingVertical: 14, paddingHorizontal: Space.xl,
    alignItems: 'center',
  },
  askBtnActive: { backgroundColor: Palette.miss },
  askBtnText: { color: '#071E16', fontSize: Type.lg, fontWeight: Type.bold, letterSpacing: 0.3 },
  logoBtnRing: {
    width: 38, height: 38, borderRadius: 19,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.25)',
    backgroundColor: 'rgba(0,0,0,0.20)',
    justifyContent: 'center', alignItems: 'center',
  },
  logoBtnImg: { width: 30, height: 30, borderRadius: Radius.pill },

  // Secondary row
  secondaryRow: { flexDirection: 'row', gap: 8 },
  secondaryBtn: {
    flex: 1, backgroundColor: Palette.cardBg,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Palette.border,
    paddingVertical: 9, alignItems: 'center', gap: 4,
  },
  secondaryLabel: { color: Palette.textSub, fontSize: Type.sm, fontWeight: Type.medium, letterSpacing: 0.3 },
  secondaryMissDir: { fontSize: Type.md, fontWeight: Type.bold },

  // Advice card
  adviceCard: {
    flex: 1,
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Palette.border,
    padding: 12,
    borderLeftWidth: 2, borderLeftColor: Palette.positive,
  },
  adviceHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 },
  adviceLabel:   { color: Palette.muted, fontSize: Type.xs, fontWeight: Type.medium, letterSpacing: 1.4, textTransform: 'uppercase' as const },
  adviceText:    { color: Palette.textPrimary, fontSize: Type.md, lineHeight: 23, fontWeight: Type.regular },

  // ── Strategy + Aim Row ───────────────────────────────────────────────────
  strategyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginBottom: 4 },
  strategyLine: { color: Palette.muted, fontSize: Type.xs, fontWeight: Type.semibold, letterSpacing: 0.5 },
  aimRow: { flexDirection: 'row', gap: 5 },
  aimBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.cardBg },
  aimBtnActive: { backgroundColor: Palette.bgActive, borderColor: Palette.borderActive },
  aimBtnText: { color: Palette.textSub, fontSize: Type.sm, fontWeight: Type.semibold },
  aimBtnTextActive: { color: Palette.positive },

  // ── Shot Buttons ─────────────────────────────────────────────────────────
  shotRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  shotBtn: { flex: 1, height: 42, borderRadius: 10, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  shotBtnLeft:     { borderColor: '#263A52', backgroundColor: '#111E2E' },
  shotBtnRight:    { borderColor: '#52252A', backgroundColor: '#2A1014' },
  shotBtnStraight: { borderColor: Palette.border, backgroundColor: Palette.bgActive },
  shotBtnText: { color: Palette.textPrimary, fontSize: Type.body, fontWeight: Type.semibold },

  // ── Pattern Preview Row ───────────────────────────────────────────────────
  patternRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4, marginBottom: 4 },
  patternText: { color: Palette.warn, fontSize: Type.xs, fontWeight: Type.semibold },

  // ── Shot Feedback Overlay ─────────────────────────────────────────────────
  feedbackOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 60,
    pointerEvents: 'none',
  },
  feedbackBadge: {
    backgroundColor: 'rgba(10,30,20,0.93)',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 32,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Palette.positive,
  },
  feedbackDir:     { color: Palette.textPrimary, fontSize: 28, fontWeight: '700' },
  feedbackInsight: { color: Palette.positiveFaint, fontSize: Type.body, marginTop: 8, textAlign: 'center' },
});

