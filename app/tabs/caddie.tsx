import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import Svg, { Path, Circle } from 'react-native-svg';
import ShotCorrectionPrompt from '../../components/ShotCorrectionPrompt';
import { analyzePatterns, getRecommendedClub } from '../../services/patternEngine';
import {
  speakJob,
  cancelAll as engineCancelAll,
  PRIORITY as ENGINE_PRIORITY,
  getEngineState,
  setGlobalGender,
  configureAudioForSpeech,
  speak as voiceSpeak,
  VoiceTimingController,
} from '../../services/voice';
import { DS, Palette, Space, Type, Radius } from '../../constants/theme';
import { useLayout } from '../../hooks/use-layout';
import {
  View, Text, Pressable, StyleSheet, Image, Animated,
  ScrollView, Modal, Linking, Platform, TextInput,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BrandHeader from '../../components/BrandHeader';
import CaddieToolsStrip from '../../components/CaddieToolsStrip';
import GlobalMenu from '../../components/GlobalMenu';
import SaveProgressModal from '../../components/SaveProgressModal';
import SmartHint from '../../components/SmartHint';
import HoleViewer from '../../components/HoleViewer';
import { SplitLayout } from '../../components/SplitLayout';
import { useSmartHint } from '../../hooks/useSmartHint';
import { useTranslation } from '../../hooks/useTranslation';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import CaddieMicButton from '../../components/CaddieMicButton';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { signOut } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useMemoryStore } from '../../store/memoryStore';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useVoiceStore } from '../../store/voiceStore';
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
import { CameraView, useCameraPermissions } from 'expo-camera';
import { buildFocusContext } from '../../engine/contextBuilder';
import { getAIResponse as _focusAICaller } from '../../services/aiService';
import { updateLearnedDistance } from '../../services/clubTracker';
import { startSTT, stopSTT } from '../../services/sttService';
import { usePointsStore } from '../../store/pointsStore';
import { getApiBaseUrl } from '../../utils/apiUrl';
import { watchDataBridge } from '../../services/watchDataBridge';
import DrillVideoCard from '../../components/DrillVideoCard';
import { searchDrillVideos } from '../../services/contentSearch';
import CaddieAvatar from '../../components/CaddieAvatar';
const ICON_RANGEFINDER  = require('../../assets/images/icon-rangefinder.png');
const STRATEGY_SCREENSHOTS_KEY = 'smartvision:preRoundShots';

type StrategyShot = {
  id: string;
  createdAt: number;
  uri: string;
  hole: number;
  par: number;
  distance: number;
  courseName: string;
  analysisText?: string;
};

type RoundStoreState = ReturnType<typeof useRoundStore.getState>;

const DEFAULT_CLUB_YARDS: Record<string, number> = {
  Driver: 230, '3 Wood': 215, '5 Wood': 200,
  '3 Iron': 185, '4 Iron': 175, '5 Iron': 165, '6 Iron': 155,
  '7 Iron': 145, '8 Iron': 135, '9 Iron': 125,
  PW: 115, GW: 100, SW: 85, LW: 70, Putter: 10,
};

const HOLE_DISTANCES = [380, 160, 520, 410, 370, 180, 400, 540, 390];

const SmartMotionSwingIcon = ({ size = 14, color = '#3B82F6' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="8" cy="4.75" r="2" stroke={color} strokeWidth="1.8" />
    <Path d="M8 7 L8 11" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M8 9.5 L4.5 12" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M8 9.5 L12.5 11" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M8 11 L6 17.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M8 11 L12 16.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M12.8 9.2 L18.2 4.8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M13.5 11.2 C16.2 10.2 19 10.5 21 12" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

// Placeholder URLs removed � local fallback View is used when no real URL is set
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

// Per-hole normalized shot line coordinates (0�1). If null, defaults to straight-line tee?green.
// Palms course: tee = bottom of image (y�0.88), green = top (y�0.12).
// Dogleg/offset holes use shifted x values to match the real hole shape.
type HoleOverlay = { start: { x: number; y: number }; target: { x: number; y: number } };
const HOLE_OVERLAYS: (HoleOverlay | null)[] = [
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 1  � straight, wide landing
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.38, y: 0.12 } }, // 2  � slight left of center at green (water short-left)
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.65, y: 0.12 } }, // 3  � dogleg right
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 4  � par 5, straight
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.38, y: 0.12 } }, // 5  � dogleg left
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 6  � par 3, center
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.35, y: 0.12 } }, // 7  � water right, aim left
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 8  � straight
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 9  � par 5, straight
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.62, y: 0.12 } }, // 10 � slight dogleg right
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 11 � long par 4, straight
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 12 � par 3, center
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.42, y: 0.12 } }, // 13 � par 5, slight left
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 14 � straight par 4
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.38, y: 0.12 } }, // 15 � subtle dogleg left, water short
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.50, y: 0.12 } }, // 16 � par 3, island green center
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.35, y: 0.12 } }, // 17 � water left off tee, bail right ? aim left of center
  { start: { x: 0.50, y: 0.88 }, target: { x: 0.55, y: 0.12 } }, // 18 � par 5 finishing hole
];

const LOGO             = require('../../assets/images/logo.png');
const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

type FamousCourseProfile = {
  canonical: string;
  aliases: string[];
  par: number;
  difficultyToPar: number;
};

const FAMOUS_COURSE_PROFILES: FamousCourseProfile[] = [
  { canonical: 'Pebble Beach Golf Links', aliases: ['pebble beach', 'pebble beach golf links'], par: 72, difficultyToPar: 2 },
  { canonical: 'Augusta National Golf Club', aliases: ['augusta', 'augusta national', 'masters course'], par: 72, difficultyToPar: 3 },
  { canonical: 'St Andrews Old Course', aliases: ['st andrews', 'old course', 'old course at st andrews'], par: 72, difficultyToPar: 1 },
  { canonical: 'TPC Sawgrass Stadium Course', aliases: ['sawgrass', 'tpc sawgrass', 'stadium course'], par: 72, difficultyToPar: 2 },
  { canonical: 'Pinehurst No. 2', aliases: ['pinehurst', 'pinehurst no 2', 'pinehurst number 2'], par: 70, difficultyToPar: 3 },
  { canonical: 'Bethpage Black', aliases: ['bethpage', 'bethpage black'], par: 71, difficultyToPar: 4 },
  { canonical: 'Torrey Pines South Course', aliases: ['torrey pines', 'torrey pines south'], par: 72, difficultyToPar: 2 },
  { canonical: 'Whistling Straits', aliases: ['whistling straits', 'straits course'], par: 72, difficultyToPar: 3 },
  { canonical: 'Kiawah Island Ocean Course', aliases: ['kiawah', 'ocean course', 'kiawah ocean'], par: 72, difficultyToPar: 4 },
  { canonical: 'Riviera Country Club', aliases: ['riviera', 'riviera country club'], par: 71, difficultyToPar: 2 },
  { canonical: 'Oakmont Country Club', aliases: ['oakmont', 'oakmont country club'], par: 71, difficultyToPar: 5 },
  { canonical: 'Winged Foot West Course', aliases: ['winged foot', 'winged foot west'], par: 70, difficultyToPar: 4 },
  { canonical: 'Merion Golf Club', aliases: ['merion', 'merion golf club'], par: 70, difficultyToPar: 3 },
];

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function extractRequestedCourse(query: string): string | null {
  const text = query.toLowerCase();
  const match = text.match(/(?:at|on)\s+([a-z0-9'&.\-\s]{3,60})/i);
  if (!match?.[1]) return null;
  return match[1].replace(/[?.!,]+$/g, '').trim();
}

function findCourseProfile(query: string): FamousCourseProfile | null {
  const text = query.toLowerCase();
  for (const profile of FAMOUS_COURSE_PROFILES) {
    if (profile.aliases.some((a) => text.includes(a))) return profile;
  }
  return null;
}

export default function Caddie() {
  const router       = useRouter();
  const { screenW, isLarge, isSmall, hPad, cardPadding } = useLayout();
  const ultraSmall = screenW < 360;
  const tabBarHeight = useBottomTabBarHeight();
  const { t } = useTranslation();
  // ── Stores ──────────────────────────────────────────────────────────────
  const setIsGuest      = useUserStore((s) => s.setIsGuest);
  const isGuest         = useUserStore((s) => s.isGuest);
  const caddieName      = useUserStore((s) => s.caddieName);
  const playerName      = useUserStore((s) => s.name);
  const playerFirstName = useUserStore((s) => s.firstName);

  const courseMemory    = useMemoryStore((s) => s.courseMemory);
  const clubUsage       = useMemoryStore((s) => s.clubUsage);
  const currentHole     = useRoundStore((s: RoundStoreState) => s.currentHole);
  const setCurrentHole  = useRoundStore((s: RoundStoreState) => s.setCurrentHole);
  const nineHoleMode    = useRoundStore((s: RoundStoreState) => s.nineHoleMode);
  const setNineHoleMode = useRoundStore((s: RoundStoreState) => s.setNineHoleMode);
  const isCompetition   = useRoundStore((s: RoundStoreState) => s.isCompetition);
  const setIsCompetition = useRoundStore((s: RoundStoreState) => s.setIsCompetition);
  const roundNotes      = useRoundStore((s: RoundStoreState) => s.roundNotes);
  const setRoundNotes   = useRoundStore((s: RoundStoreState) => s.setRoundNotes);
  const isRoundActive   = useRoundStore((s: RoundStoreState) => s.isRoundActive);
  const goalMode        = useRoundStore((s: RoundStoreState) => s.goalMode);
  const strategyMode    = useRoundStore((s: RoundStoreState) => s.strategyMode);
  const setStrategyMode = useRoundStore((s: RoundStoreState) => s.setStrategyMode);
  const storePar        = useRoundStore((s: RoundStoreState) => s.currentPar);
  const setCurrentPar   = useRoundStore((s: RoundStoreState) => s.setCurrentPar);
  const activeCourse       = useRoundStore((s: RoundStoreState) => s.activeCourse) || 'Menifee Lakes Palms';
  const selectedCourseIdx  = useRoundStore((s: RoundStoreState) => s.selectedCourseIdx);
  const club            = useRoundStore((s: RoundStoreState) => s.club);
  const setClub         = useRoundStore((s: RoundStoreState) => s.setClub);
  const targetDistance  = useRoundStore((s: RoundStoreState) => s.targetDistance);
  const scores              = useRoundStore((s: RoundStoreState) => s.scores);
  const setScore            = useRoundStore((s: RoundStoreState) => s.setScore);
  const gridScores          = useRoundStore((s: RoundStoreState) => s.gridScores);
  const gridPlayerNames     = useRoundStore((s: RoundStoreState) => s.gridPlayerNames);
  const activePlayerCount   = useRoundStore((s: RoundStoreState) => s.activePlayerCount);
  const setCourseHoleScore  = useRoundStore((s: RoundStoreState) => s.setCourseHoleScore);
  const holePutts           = useRoundStore((s: RoundStoreState) => s.holePutts);
  const setPuttForHole      = useRoundStore((s: RoundStoreState) => s.setPuttForHole);
  const shots               = useRoundStore((s: RoundStoreState) => s.shots);
  const addShot             = useRoundStore((s: RoundStoreState) => s.addShot);
  const adjustLastShot      = useRoundStore((s: RoundStoreState) => s.adjustLastShot);
  const tagLastShotMedia    = useRoundStore((s: RoundStoreState) => s.tagLastShotMedia);
  const clearRound          = useRoundStore((s: RoundStoreState) => s.clearRound);
  const setIsRoundActive    = useRoundStore((s: RoundStoreState) => s.setIsRoundActive);
  const addPenalty          = useRoundStore((s: RoundStoreState) => s.addPenalty);
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

  // -- Voice store � caddie response subscription ---------------------------
  const caddieResponse  = useVoiceStore((s) => s.caddieResponse);
  const voiceState      = useVoiceStore((s) => s.voiceState);
  const setVoiceCaddieResponse = useVoiceStore((s) => s.setCaddieResponse);

  // -- Drill video state for voice-triggered search -------------------------
  const [voiceDrillVideo, setVoiceDrillVideo] = React.useState<any>(null);
  const [voiceDrillLoading, setVoiceDrillLoading] = React.useState(false);

  // -- Club picker: player override for post-round analysis -----------------
  const [showClubPicker, setShowClubPicker] = React.useState(false);
  const [playerClubOverride, setPlayerClubOverride] = React.useState<string | null>(null);

  const VIDEO_TRIGGER_PHRASES = [
    'show me a drill',
    'find me a drill',
    'show me a video',
    'find a video',
    'drill for this',
    'youtube drill',
    'watch a drill',
    'show drill',
    'give me a drill',
    'drill video',
  ];


  // -- Smart hints --------------------------------------------------------------
  const { hint: smartHint, showHint } = useSmartHint();

  // Sync voiceGender ? voiceService whenever it changes
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

  // Smart hint � show 'caddie' hint once on first mount, 'course' once round starts
  useEffect(() => { showHint('caddie'); }, []);

  // Round setup lives on the Play tab. If the user lands on the Caddie tab
  // without an active round (cold launch, deep link, etc.), bounce them to Play.
  useEffect(() => {
    if (!isRoundActive) {
      router.replace('/tabs/play');
    }
  }, [isRoundActive, router]);


  // -- Resume round prompt on app startup -----------------------------------
  useEffect(() => {
    const { isRoundActive: roundActive, activeCourse, currentHole: hole } = useRoundStore.getState();
    if (roundActive && activeCourse) {
      setShowResumePrompt(true);
    }
  }, []);

  // -- Contextual welcome message on mount -----------------------------------
  useEffect(() => {
    const hour = new Date().getHours();
    const tod = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const first = (playerFirstName || playerName?.split(' ')[0] || '').trim();
    setOpeningPrompt('Good ' + tod + (first ? ' ' + first : '') + '. What can I help with today?');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerFirstName, playerName]);

  // -- Send yardage to Galaxy Watch when it changes --------------------------
  useEffect(() => {
    if (isRoundActive && (currentHole || club)) {
      const state = useRoundStore.getState() as any;
      const yardage = state.currentYardage || state.courseHoles?.[currentHole - 1]?.yards || targetDistance || 150;
      void watchDataBridge.sendToWatch({
        yards: Math.round(yardage),
        hole: currentHole,
        club: club ?? '',
      });
    }
  }, [isRoundActive, currentHole, club, targetDistance]);

  useEffect(() => {
    if (isRoundActive) {
      showHint('course');
      // Tip: let user know caddie handles everything
      checkAndShow('round_start', () => showTip('round_start', "You can just play. Caddie handles tracking, planning, and shot analysis."));
    }
  }, [isRoundActive]);

  // -- Caddie voice cues ----------------------------------------------------
  // Speak hole number when hole changes (skip hole 1 � swing thought already spoken)
  const prevHoleRef = useRef<number>(currentHole);
  useEffect(() => {
    if (!isRoundActive) return;
    if (currentHole !== prevHoleRef.current && currentHole > 1) {
      if (voiceEnabled) speakHoleChange(currentHole);
    }

    if (
      prevHoleRef.current === 9 &&
      currentHole === 10 &&
      !nineHoleMode
    ) {
      const front9scores = scores.slice(0, 9).map((s: any) => s || 0);
      const front9total = front9scores.reduce((a: any, b: any) => a + b, 0);
      const frontShots = (useRoundStore.getState().shots ?? []).filter((s: any) => (s.hole ?? 0) <= 9);
      const rights = frontShots.filter((s: any) => s.result === 'right').length;
      const lefts = frontShots.filter((s: any) => s.result === 'left').length;
      const miss = rights > lefts ? 'right' : lefts > rights ? 'left' : 'straight';
      const msg = `${front9total} shots on the front nine. Missing ${miss} today. Stay patient on the back nine.`;
      setTimeout(() => {
        speakCaddie(msg, 'decision');
      }, 1000);
    }

    prevHoleRef.current = currentHole;
    // Clear post-shot visualization when moving to a new hole
    setShotStartPixel(null);
    setActualShotResult(null);
  }, [currentHole, isRoundActive, voiceEnabled, nineHoleMode, scores, voiceGender]);

  // ── Local state ──────────────────────────────────────────────────────────
  const [gpsMiddle,       setGpsMiddle]       = useState<number | null>(null);

  // -- GPS: single continuous source of truth ------------------------------
  // useUnifiedGPS = continuous watch + smoothing + last-known fallback.
  const unifiedGPS = useUnifiedGPS();
  // Derive an accuracy tier from the live horizontal accuracy (metres).
  const gpsAccuracyLevel: 'high' | 'balanced' | 'weak' | null =
    unifiedGPS.accuracy == null ? null
      : unifiedGPS.accuracy <= 5  ? 'high'
      : unifiedGPS.accuracy <= 15 ? 'balanced'
      : 'weak';

  // When a round starts, force-refresh GPS so the first hole's yardages,
  // hole-progression, and SmartFinder readings come from a fresh fix instead
  // of whatever stale last-known position was sitting in the watch.
  const prevRoundActiveRef = useRef<boolean>(isRoundActive);
  useEffect(() => {
    const prev = prevRoundActiveRef.current;
    if (!prev && isRoundActive) {
      void unifiedGPS.retry();
    }
    prevRoundActiveRef.current = isRoundActive;
  }, [isRoundActive, unifiedGPS]);
  const { playSoundTap, playSoundConfirm } = useSmartAudio();
  const [lockedDistance,  setLockedDistance]  = useState<number | null>(null);

  // -- Point-to-point rangefinder (SmartFinder green icon) -----------------
  const [showPointRanger, setShowPointRanger] = useState(false);
  const [pointA,          setPointA]          = useState<{ lat: number; lng: number } | null>(null);
  const [pointB,          setPointB]          = useState<{ lat: number; lng: number } | null>(null);
  const [pointAAccuracy,  setPointAAccuracy]  = useState<number | null>(null);
  const [pointBAccuracy,  setPointBAccuracy]  = useState<number | null>(null);
  const [pointALocking,   setPointALocking]   = useState(false);
  const [pointBLocking,   setPointBLocking]   = useState(false);
  const pointDist = pointA && pointB ? Math.round(haversineYards(pointA, pointB)) : null;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraGranted = cameraPermission?.granted ?? false;
  const insets = useSafeAreaInsets();
  // Pulse ring animation for locking state
  const lockPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (pointALocking || pointBLocking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(lockPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(lockPulse, { toValue: 0, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      lockPulse.stopAnimation();
      lockPulse.setValue(0);
    }
  }, [pointALocking, pointBLocking, lockPulse]);

  // -- Wind + Elevation -----------------------------------------------------
  const [wind,      setWind]      = useState<WindState>({ speed: 10, direction: 'head' });
  const [elevation, setElevation] = useState<ElevationState>('flat');

  const [caddieMsg,       setCaddieMsg]       = useState('');
  const [isSpeaking,      setIsSpeaking]      = useState(false);
  const [roundModeChoice, setRoundModeChoice] = useState<'safe' | 'neutral' | 'attack'>(strategyMode);
  const [mentalState, setMentalState] = useState<'locked' | 'neutral' | 'nervous' | 'frustrated'>('neutral');
  const [isDictating, setIsDictating] = useState(false);
  const dictationPulse = useRef(new Animated.Value(1)).current;
  const [earbudMode,      setEarbudMode]      = useState(false);
  const [focusMode,       setFocusMode]       = useState(false);
  // lowPowerMode is persisted in settingsStore � single source of truth shared across screens
  const lowPowerMode    = useSettingsStore((s) => s.lowPowerMode);
  const setLowPowerMode = useSettingsStore((s) => s.setLowPowerMode);
  const hasOnboarded    = useSettingsStore((s) => s.hasOnboarded);
  const setHasOnboarded = useSettingsStore((s) => s.setHasOnboarded);
  const [shakeWakeEnabled, setShakeWakeEnabled] = useState(false);
  const biometricEnabled    = useUserStore((s) => s.biometricEnabled);
  const setBiometricEnabled = useUserStore((s) => s.setBiometricEnabled);
  const [showToolsMenu,   setShowToolsMenu]   = useState(false);
  const [showShotCard, setShowShotCard] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [openingPrompt, setOpeningPrompt] = useState('');
  const [showTeeTime,     setShowTeeTime]     = useState(false);
  const [teeTimeUrl,      setTeeTimeUrl]      = useState('');
  const [teeTimeTitle,    setTeeTimeTitle]    = useState('');
  const [showSaveProgress, setShowSaveProgress] = useState(false);
  const [showStrategyShots, setShowStrategyShots] = useState(false);
  const [strategyShots, setStrategyShots] = useState<StrategyShot[]>([]);
  const [strategyShotsLoading, setStrategyShotsLoading] = useState(false);
  const [showShotVision,  setShowShotVision]  = useState(false);
  const [showShotCamera,  setShowShotCamera]  = useState(false);
  const [caddieVisionLoading, setCaddieVisionLoading] = useState(false);
  const [lastVideoUri,    setLastVideoUri]    = useState<string | null>(null);
  const [showSmartMotion, setShowSmartMotion] = useState(false);
  const [smTools, setSMTools] = useState({
    capture: true,
    golfFix: false,
    sound: false,
    trace: false,
  });
  const [smAnalysis, setSMAnalysis] = useState('');
  const [smCapturing, setSMCapturing] = useState(false);
  // SmartVision is always active � no toggle
  const autoShotVision = true;


  // -- Post-shot visualization state --------------------------------------------
  const [shotStartPixel,  setShotStartPixel]  = useState<{ x: number; y: number } | null>(null);
  const [actualShotResult, setActualShotResult] = useState<'good' | 'left' | 'right' | 'short' | 'long' | null>(null);
  const actualShotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markShotUsedRef   = useRef(false);   // prevent double-trigger per shot
  const isRecordingRef    = useRef(false);   // SmartVision recording in progress
  const lastShotTimeRef   = useRef<number>(0); // timestamp of last marked shot
  const lastGpsRef        = useRef<{ lat: number; lng: number } | null>(null); // for stationary check
  const [holeScore,       setHoleScore]       = useState(0);
  const [activePlayerIdx, setActivePlayerIdx] = useState(0);
  const [showPenaltySheet, setShowPenaltySheet] = useState(false);
  const [showHolePreview, setShowHolePreview] = useState(false);
  const [showCourseInfo,  setShowCourseInfo]  = useState(false);
  const [thumbError,      setThumbError]      = useState(false);

  // -- Contextual tip system -------------------------------------------------
  const { checkAndShow } = useTips();
  const [activeTip, setActiveTip] = useState<{ key: string; text: string } | null>(null);
  const showTip = useCallback((key: string, text: string) => {
    setActiveTip({ key, text });
  }, []);
  const [previewImgSize,  setPreviewImgSize]  = useState({ w: 1, h: 1 });
  const previewFadeAnim = useRef(new Animated.Value(0)).current;
  const [showCorrection,  setShowCorrection]  = useState(false);
  // -- Golfshot-style interactive hole map state ------------------------------
  // Normalized (0�1) coordinates matching HOLE_OVERLAYS convention (y=0.82 = tee, y=0.18 = green)
  const [ballPosition,    setBallPosition]    = useState({ x: 0.5, y: 0.82 });
  // Pixel coords within the rendered image (null = no target set)
  const [targetPosition,  setTargetPosition]  = useState<{ px: number; py: number } | null>(null);
  // Original tap coord � stored when user first taps, held for "Your Aim" line
  const [originalTarget, setOriginalTarget]  = useState<{ px: number; py: number } | null>(null);
  const originalFadeAnim = useRef(new Animated.Value(1)).current;
  const originalFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapSize,         setMapSize]         = useState({ w: 1, h: 1 });
  // -- Putt Mode (green reading) ----------------------------------------------
  const [puttMode,        setPuttMode]        = useState(false);
  const [puttBall,        setPuttBall]        = useState<{ x: number; y: number } | null>(null);
  const [puttStrokes,     setPuttStrokes]     = useState(0);  // putts taken this hole (local mirror for puttMode reset)
  const scoreMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // -- Hole progression toast ------------------------------------------------
  const [holeAdvanceToast, setHoleAdvanceToast] = useState<{ from: number; to: number } | null>(null);
  const holeToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [puttHole,        setPuttHole]        = useState<{ x: number; y: number } | null>(null);
  const [slopeDirection,  setSlopeDirection]  = useState<SlopeDirection>(null);
  const holePar = storePar > 0 ? storePar : 4;

  // -- Validation Mode --------------------------------------------------------
  const {
    validationMode, setValidationMode,
    validations,
    getHoleValidation, setYardageAdjustment, setParOverride, toggleTag, clearHole,
    getSummary,
  } = useValidationStore();
  const [showValidationSummary, setShowValidationSummary] = useState(false);
  // -- Post-round summary modal -----------------------------------------------
  const [showPostRound,      setShowPostRound]      = useState(false);
  const [showResumePrompt,   setShowResumePrompt]   = useState(false);
  const [postRoundAnalysis,  setPostRoundAnalysis]  = useState<RoundAnalysis | null>(null);
  const [postRoundInsights,  setPostRoundInsights]  = useState<RoundInsight[]>([]);
  const pendingNavRef = useRef<() => void>(() => {});  // nav action deferred until user dismisses

  const loadStrategyShots = useCallback(async () => {
    setStrategyShotsLoading(true);
    try {
      const raw = await AsyncStorage.getItem(STRATEGY_SCREENSHOTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setStrategyShots(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
      console.log('[caddie] load strategy screenshots failed', e);
      setStrategyShots([]);
    } finally {
      setStrategyShotsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showStrategyShots) return;
    void loadStrategyShots();
  }, [showStrategyShots, loadStrategyShots]);
  // -- Course-derived hole images ---------------------------------------------
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
  const holeThumbSource =
    activeCourseData?.holes[currentHole - 1]?.thumbnail;
  const holeFullSource =
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

  // -- Swing Thought Suggestion -----------------------------------------------
  const [swingThought,           setSwingThought]           = useState<string | null>(null);
  const [swingThoughtSuggestion, setSwingThoughtSuggestion] = useState<string | null>(null);
  const dismissedAtHoleRef = useRef<number>(-99);
  const SUGGESTION_COOLDOWN_HOLES = 4;
  // Per-thought cooldown: prevent re-triggering within 30 s of last suggestion
  const lastSuggestionTimeRef = useRef<number>(0);

  // -- SmartVision result overlay --------------------------------------------
  const [visionOverlay, setVisionOverlay] = useState<string | null>(null);
  const visionOverlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pointsToast, setPointsToast] = useState<string | null>(null);
  const pointsToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalPoints = usePointsStore((s) => s.totalPoints);
  const pointsTier = usePointsStore((s) => s.tier);
  const lastAward = usePointsStore((s) => s.lastAward);
  const lastAwardSeenRef = useRef<number>(0);
  // Latest hazard-on-line warnings (updated by map useMemo, read by voice follow-up)
  const hazardWarningsRef = useRef<import('../../features/voice/FollowUpEngine').HazardInfo[]>([]);

  // Pulse animation for Ask Caddie
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef  = useRef<Animated.CompositeAnimation | null>(null);
  const rfScale   = useRef(new Animated.Value(1)).current;

  // -- Processing guard � prevents double-trigger on rapid shot button taps --
  const isProcessingShotRef = useRef(false);

  // -- Hole-map drag interaction refs --------------------------------
  // Debounce drag updates to 60ms � avoids excessive re-renders during move
  const dragDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track last hazard nudge so voice tip fires once per hazard, not per frame
  const lastNudgedHazardRef = useRef<string | null>(null);
  // Pulse animation on target ring when hazard nudge is applied (scale 1?1.25?1)
  const nudgeAnim = useRef(new Animated.Value(1)).current;

  // -- SmartVision premium animations --------------------------------------
  // Fade-in for shot line, hazard overlays and yardage cards when target is set
  const svFadeAnim     = useRef(new Animated.Value(0)).current;
  // Smoothly animate the target ring to its new position instead of jumping
  const animatedTarget = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // -- Haptic cooldown � prevents vibration spam during fast drags -------
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

  // ── Computed ─────────────────────────────────────────────────────────────
  const holeDistance   = HOLE_DISTANCES[Math.min(currentHole - 1, HOLE_DISTANCES.length - 1)];

  // Live GPS distance to the hole's green center � same source as SmartFinder CTR.
  // Priority: locked ? manual target ? live GPS middle ? legacy gpsMiddle ? static fallback.
  // Cap at 700 yds � anything higher means GPS hasn't locked on yet; show nothing rather than garbage.
  const GPS_MAX_YARDS = 700;
  const unifiedMiddleDist = useMemo(() => {
    const holeData = activeCourseData?.holes[currentHole - 1];
    if (!holeData?.middle || !unifiedGPS.location) return null;
    const d = unifiedGPS.distanceTo(holeData.middle.lat, holeData.middle.lng);
    if (d === null) return null;
    const rounded = Math.round(d);
    return rounded <= GPS_MAX_YARDS ? rounded : null; // discard bad GPS lock
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

  // -- Automatic shot detection (GPS movement) -------------------------------
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
      // -- Predict club from distance + context ----------------------------
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
        void updateLearnedDistance(predictedClub, detected.yards);
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

  // -- Per-club dispersion model ----------------------------------------------
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
      if (voiceEnabled) speakPressureCue();
    }
    prevPressureRef.current = caddie.pressure ?? 'normal';
  }, [caddie.pressure, voiceEnabled]);

  // -- Auto course detection ------------------------------------------------
  const setActiveCourseInStore   = useRoundStore((s: RoundStoreState) => s.setActiveCourse);
  const setSelectedCourseIdxFn   = useRoundStore((s: RoundStoreState) => s.setSelectedCourseIdx);
  const { detectedCourse, clearDetection } = useCourseDetection(
    unifiedGPS.location,
    { disabled: isRoundActive },
  );

  // -- Automatic hole progression --------------------------------------------
  useHoleProgression({
    location:       unifiedGPS.location,
    currentHole,
    setCurrentHole,
    isRoundActive,
    courseData:     activeCourseData ?? null,
    stale:          unifiedGPS.stale,
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

  // -- Live GPS ? ball dot (unified continuous GPS) -------------------------
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

  // -- Hazard-aware target nudge ---------------------------------------------
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
          // Pulse target ring once per hazard encounter � no re-entry during drag
          const hazardKey = `${h.x},${h.y}`;
          if (lastNudgedHazardRef.current !== hazardKey) {
            lastNudgedHazardRef.current = hazardKey;
            nudgeAnim.setValue(1);
            Animated.sequence([
              Animated.timing(nudgeAnim, { toValue: 1.3, duration: 120, useNativeDriver: true }),
              Animated.timing(nudgeAnim, { toValue: 1,   duration: 100, useNativeDriver: true }),
            ]).start();
            // Ambient voice tip � fires only on first encounter, won't interrupt speech
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
      // Hazard calculation error � return original untouched coords
      return { x: px, y: py };
    }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voiceEnabled, voiceGender, nudgeAnim]
  );

  // -- Swing suggestion detection (runs after each shot) --------------------
  const detectRecentMissPattern = useCallback((): 'right' | 'left' | null => {
    const recent = shots.slice(-3);
    const right = recent.filter((s: any) => s.result === 'right').length;
    const left  = recent.filter((s: any) => s.result === 'left').length;
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

  // Clear thought + suggestion + club override when hole changes
  useEffect(() => {
    setSwingThought(null);
    setSwingThoughtSuggestion(null);
    setPlayerClubOverride(null);
  }, [currentHole]);

  // -- Unmount cleanup � clear all pending timers to prevent setState after unmount --
  useEffect(() => {
    return () => {
      if (visionOverlayTimer.current) clearTimeout(visionOverlayTimer.current);
      if (feedbackTimer.current)      clearTimeout(feedbackTimer.current);
      if (dragDebounceRef.current)    clearTimeout(dragDebounceRef.current);
      if (pointsToastTimerRef.current) clearTimeout(pointsToastTimerRef.current);
    };
  }, []);

  // -- SmartVision result helper --------------------------------------------
  const analyzeVisionResult = (uri: string): string => {
    // Simple heuristic placeholder � real analysis happens in ShotVisionPlayer.
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
    const mem = courseMemory[activeCourse] ?? courseMemory['Menifee Lakes'] ?? courseMemory['Menifee Lakes Palms'];
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

  // -- Local bias: derived from current round's shots (no AI, purely local) ----
  const localBias = useMemo(() => deriveLocalBias(shots), [shots]);

  const getContextualAdvice = useCallback((): string => {
    // Bail before invoking the brain when GPS hasn't produced a fix yet —
    // otherwise buildRecommendation produces "0 yards. Chip..." which is
    // misleading. Wait until we have a real yardage.
    const y = displayDistance ?? 0;
    if (y <= 0) return applyPersonality('Stay smooth and commit.', caddiePersonality);
    try {
      const base = buildRecommendation({
        yardage:             y,
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
      // Recommendation engine failed (corrupt profile/memory) - return base yardage string
      return applyPersonality(`${y} yards. ${club} - commit and stay smooth.`, caddiePersonality);
    }
  }, [displayDistance, club, holePar, currentHole, aiProfile, localBias, courseMemory, activeCourse, goalMode, strategyMode, shots.length, caddiePersonality]);

  const buildCourseScorePrediction = useCallback((query: string): string | null => {
    const normalized = query.toLowerCase();
    const askingScore = /(what|how).*(shoot|score)|\bshoot\b.*\b(at|on)\b|\bscore\b.*\b(at|on)\b/.test(normalized);
    if (!askingScore) return null;

    const known = findCourseProfile(normalized);
    const extractedName = extractRequestedCourse(query);
    const courseName = known?.canonical ?? (extractedName ? extractedName.replace(/\b\w/g, (c) => c.toUpperCase()) : null);
    if (!courseName) return null;

    const handicap = useUserStore.getState().handicap ?? 0;
    const roundsPlayed = aiProfile.roundsPlayed ?? 0;

    const baselineToPar = handicap > 0 ? handicap : 12;
    const difficulty = known?.difficultyToPar ?? 2;
    const experienceAdj = roundsPlayed >= 15 ? -1 : roundsPlayed <= 3 ? 1 : 0;
    const expectedToPar = Math.round(clamp(baselineToPar + difficulty + experienceAdj, -2, 36));
    const spread = roundsPlayed >= 12 ? 3 : roundsPlayed >= 6 ? 4 : 6;
    const par = known?.par ?? 72;

    const lowToPar = expectedToPar - spread;
    const highToPar = expectedToPar + spread;
    const lowScore = par + lowToPar;
    const expectedScore = par + expectedToPar;
    const highScore = par + highToPar;

    const confidence = known
      ? 'Course profile matched from famous-course data.'
      : 'I do not have a dedicated profile for that course yet, so this is a neutral-course estimate.';

    return `${courseName}: expected around ${expectedScore} (${expectedToPar > 0 ? '+' : ''}${expectedToPar}). Likely range ${lowScore}-${highScore}. ${confidence}`;
  }, [aiProfile.roundsPlayed]);

  // ── Animations ───────────────────────────────────────────────────────────
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

  // ── Rangefinder ───────────────────────────────────────────────────────────
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
    // Continuous watch already provides live position; just reflect status into gpsMiddle.
    if (unifiedGPS.location) {
      setGpsMiddle(holeDistance - 10);
    } else {
      setGpsMiddle(null);
    }
  };

  // ── Ask Caddie ────────────────────────────────────────────────────────────
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

  const runCaddieSmartVision = useCallback(async () => {
    const holeData = activeCourseData?.holes[currentHole - 1];
    if (!holeData || caddieVisionLoading) return;

    setCaddieVisionLoading(true);
    setVoiceCaddieResponse('Analyzing hole with SmartVision...');

    try {
      let base64 = '';
      const fs = FileSystem as any;
      const readAsStringAsync: ((uri: string, opts: any) => Promise<string>) | undefined =
        typeof fs?.readAsStringAsync === 'function' ? fs.readAsStringAsync.bind(fs) : undefined;
      const downloadAsync: ((url: string, fileUri: string) => Promise<{ uri: string }>) | undefined =
        typeof fs?.downloadAsync === 'function' ? fs.downloadAsync.bind(fs) : undefined;
      const bundledImage = holeData.fullImage ?? holeData.thumbnail ?? null;

      try {
        if (typeof bundledImage === 'number' && readAsStringAsync) {
          const asset = Asset.fromModule(bundledImage);
          await asset.downloadAsync();
          base64 = await readAsStringAsync(asset.localUri ?? asset.uri, {
            encoding: fs.EncodingType.Base64,
          });
        } else if (
          bundledImage &&
          typeof bundledImage === 'object' &&
          'uri' in (bundledImage as any) &&
          typeof (bundledImage as any).uri === 'string' &&
          readAsStringAsync &&
          downloadAsync &&
          fs?.cacheDirectory
        ) {
          const sourceUri = (bundledImage as any).uri as string;
          const dest = `${fs.cacheDirectory}caddie_smartvision_hole_${currentHole}_source.jpg`;
          const dl = await downloadAsync(sourceUri, dest);
          base64 = await readAsStringAsync(dl.uri, {
            encoding: fs.EncodingType.Base64,
          });
        }
      } catch (imageReadError) {
        console.warn('[caddie] SmartVision image read failed, continuing without image:', imageReadError);
      }

      try {
        if (!base64 && GOOGLE_MAPS_KEY && holeData.middle?.lat && holeData.middle?.lng && readAsStringAsync && downloadAsync && fs?.cacheDirectory) {
          const satelliteUrl =
            'https://maps.googleapis.com/maps/api/staticmap' +
            `?center=${holeData.middle.lat},${holeData.middle.lng}` +
            '&zoom=17' +
            '&size=600x400' +
            '&maptype=satellite' +
            `&key=${GOOGLE_MAPS_KEY}`;

          const dest = `${fs.cacheDirectory}caddie_smartvision_hole_${currentHole}.jpg`;
          const dl = await downloadAsync(satelliteUrl, dest);
          base64 = await readAsStringAsync(dl.uri, {
            encoding: fs.EncodingType.Base64,
          });
        }
      } catch (satelliteError) {
        console.warn('[caddie] SmartVision satellite fallback failed, continuing metadata-only:', satelliteError);
      }

      const expoHostRaw: string | undefined =
        (Constants as any)?.expoGoConfig?.debuggerHost ??
        (Constants as any)?.expoConfig?.hostUri ??
        (Constants as any)?.manifest?.debuggerHost;
      const fallbackHost = expoHostRaw?.split(':')?.[0];
      const fallbackPort = expoHostRaw?.split(':')?.[1] ?? '8081';
      const fallbackUrl = fallbackHost ? `http://${fallbackHost}:${fallbackPort}/api/vision` : null;
      const primaryUrl = `${getApiBaseUrl()}/api/vision`;
      const endpointCandidates = [primaryUrl, fallbackUrl].filter(
        (u, i, arr): u is string => Boolean(u) && arr.indexOf(u as string) === i
      );
      const smartVisionDistance = isRoundActive
        ? (displayDistance ?? holeData.distance)
        : (holeData.distance ?? displayDistance ?? holeDistance);

      let res: Response | null = null;
      let lastNetworkError: unknown = null;
      for (const endpoint of endpointCandidates) {
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'hole',
              ...(base64 ? { image: base64, mimeType: 'image/jpeg' } : {}),
              holeData: {
                hole: currentHole,
                par: holeData.par ?? holePar,
                distance: smartVisionDistance,
                note: holeData.note ?? '',
              },
            }),
          });
          if (res.ok) break;
        } catch (networkError) {
          lastNetworkError = networkError;
          console.warn(`[caddie] SmartVision network failed at ${endpoint}:`, networkError);
        }
      }

      if (!res && lastNetworkError) {
        throw lastNetworkError;
      }

      if (!res?.ok) {
        const msg = 'SmartVision analysis unavailable.';
        setVoiceCaddieResponse(msg);
        if (voiceEnabled) await speakJob(msg, ENGINE_PRIORITY.STRATEGY, voiceGender);
        return;
      }

      const payload = (await res.json()) as { message?: string };
      const msg = (payload.message ?? '').trim() || 'SmartVision analysis unavailable.';
      setVoiceCaddieResponse(msg);
      if (voiceEnabled) await speakJob(msg, ENGINE_PRIORITY.STRATEGY, voiceGender);
    } catch (err) {
      console.error('[caddie] SmartVision failed:', err);
      const msg = 'SmartVision analysis unavailable.';
      setVoiceCaddieResponse(msg);
      if (voiceEnabled) await speakJob(msg, ENGINE_PRIORITY.STRATEGY, voiceGender);
    } finally {
      setCaddieVisionLoading(false);
    }
  }, [
    activeCourseData,
    caddieVisionLoading,
    currentHole,
    displayDistance,
    holeDistance,
    holePar,
    isRoundActive,
    setVoiceCaddieResponse,
    voiceEnabled,
    voiceGender,
  ]);

  const openSmartVision = useCallback(() => {
    const holeData = activeCourseData?.holes[currentHole - 1];
    if (!holeData) return;

    setTargetPosition(null);
    setOriginalTarget(null);
    setShowToolsMenu(false);
    setShowHolePreview(false);
    router.push({
      pathname: '/hole-view',
      params: {
        hole: String(holeData.hole ?? currentHole),
        par: String(holeData.par ?? holePar),
        distance: String(holeData.distance ?? holeDistance),
        note: String(holeData.note ?? ''),
        teeLat: String(holeData.tee?.lat ?? ''),
        teeLng: String(holeData.tee?.lng ?? ''),
        frontLat: String(holeData.front?.lat ?? ''),
        frontLng: String(holeData.front?.lng ?? ''),
        middleLat: String(holeData.middle?.lat ?? ''),
        middleLng: String(holeData.middle?.lng ?? ''),
        backLat: String(holeData.back?.lat ?? ''),
        backLng: String(holeData.back?.lng ?? ''),
        courseId: String(activeCourseData.id ?? ''),
        courseName: String(activeCourseData.name ?? ''),
        isRoundActive: String(isRoundActive),
      },
    });
  }, [activeCourseData, currentHole, holeDistance, holePar, isRoundActive, router]);

  // -- Shot recording ------------------------------------------------------------
  const recordShot = useCallback(async (result: 'left' | 'right' | 'center' | 'short' | 'long') => {
    // Guard: prevent double-trigger from rapid taps (e.g. two-finger press on shot buttons)
    if (isProcessingShotRef.current) return;
    isProcessingShotRef.current = true;
    try {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}

    // -- Capture shot start pixel for post-shot visualization -----------------
    if (mapSize.w > 1) {
      setShotStartPixel({
        x: ballPosition.x * mapSize.w,
        y: ballPosition.y * mapSize.h,
      });
    }

    const directionalResult: 'left' | 'right' | 'center' =
      result === 'left' || result === 'right' ? result : 'center';

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
      gpsLat: unifiedGPS.location?.lat,
      gpsLng: unifiedGPS.location?.lng,
      yardsBefore: displayDistance ?? undefined,
    });

    // Logging a shot via the result card also bumps the live hole score so
    // the SHOTS stepper, scorecard, and post-round analysis stay in sync.
    {
      const cur = gridScores[activePlayerIdx]?.[currentHole - 1] ?? 0;
      setCourseHoleScore(activePlayerIdx, currentHole - 1, Math.min(15, cur + 1));
    }

    // Persist learned distance for this club
    if (displayDistance) void updateLearnedDistance(club, displayDistance);

    // Re-analyze with updated shots
    const updatedShots = useRoundStore.getState().shots;
    const pat = analyzePatterns(updatedShots);

    // Show feedback overlay
    const dirLabel =
      result === 'left' ? 'Left' :
      result === 'right' ? 'Right' :
      result === 'short' ? 'Short' :
      result === 'long' ? 'Long' :
      'Straight';
    const insight  = pat.patternInsight || (result === 'center' ? 'Good contact.' : `${dirLabel} miss.`);
    setShotFeedback({ visible: true, result, insight });

    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setShotFeedback((f) => ({ ...f, visible: false })), 1750);

    // -- Advance ball position using hole direction vector -----------------
    // If a target was tapped, move ball there (normalized). Otherwise advance
    // along the tee?pin direction vector by the shot-distance ratio.
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
            const lateralOffset = directionalResult === 'left' ? -0.04 : directionalResult === 'right' ? 0.04 : 0;
            const nx = b.x + dirX * ratio + (-dirY * lateralOffset);
            const ny = b.y + dirY * ratio + ( dirX * lateralOffset);
            // Guard: if computation produced NaN, keep last valid position
            if (!Number.isFinite(nx) || !Number.isFinite(ny)) return b;
            return {
              x: Math.max(0, Math.min(1, nx)),
              y: Math.max(0, Math.min(1, ny)),
            };
          } catch {
            // Unexpected calc error � keep last valid ball position
            return b;
          }
        });
      }
      return null;
    });

    // Update caddie message with latest pattern
    if (pat.patternInsight) setCaddieMsg(pat.patternInsight);

    // -- Post-shot visualization: classify miss + auto-log to learning system --
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
        const lateralOffset = directionalResult === 'left' ? -0.04 : directionalResult === 'right' ? 0.04 : 0;
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

    // Voice timing � only fires if pattern is strong + cooldown elapsed
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
  }, [addShot, addRoundShot, club, aimTarget, displayDistance, currentHole, voiceEnabled, voiceGender, setCaddieMsg, autoShotVision, lastVideoUri, mapSize, ballPosition, targetPosition, caddie.recommendedClub, gridScores, activePlayerIdx, setCourseHoleScore, unifiedGPS]);
  // -- Mark Shot (voice-first + manual fallback) -------------------------------
  const handleMarkShot = useCallback(async () => {
    // Per-shot double-trigger guard
    if (markShotUsedRef.current) return;
    markShotUsedRef.current = true;
    setTimeout(() => { markShotUsedRef.current = false; }, 1500);

    // Cooldown: prevent repeat within 5 s of last marked shot
    const now = Date.now();
    if (now - lastShotTimeRef.current < 5000) return;
    lastShotTimeRef.current = now;

    // Capture advice BEFORE recordShot mutates shots/state � ensures consistency
    const nextAdvice = getContextualAdvice();

    // Log the shot (non-blocking � direction from aim target)
    await recordShot('center');

    // Brief caddie confirm � AMBIENT won't interrupt active speech
    if (voiceEnabled) void speakJob('Got it.', ENGINE_PRIORITY.AMBIENT, voiceGender);

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

  // -- Galaxy Watch sync � publishes yardage/hole to watch; handles watch actions --
  useWatchSync({
    yardage:    displayDistance ?? 0,
    onMarkShot: () => {
      usePointsStore.getState().addPoints(1, 'watch-shot');
      void handleMarkShot();
    },
    // onTriggerVoice: handled by CaddieMicButton on the phone screen
  });

  // -- Voice controller � mic button ? STT ? command ? ElevenLabs response --
  const {
    listening: micListening,
    transcript: micTranscript,
    toggle: toggleMic,
    handleShot,
    shots: hookShots,
    speakCaddie,
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
    onOpenSmartMotion: () => void router.push('/swing-lab'),
    onPuttMode:      () => setPuttMode(true),
    onShowScorecard: () => void router.push('/tabs/scorecard'),
    onLogShot:       () => void handleMarkShot(),
    onStartVideo:    openSmartVision,
    onGetAdvice:     getContextualAdvice,
    onFreeformQuery: async (query: string) => {
      const predicted = buildCourseScorePrediction(query);
      if (predicted) {
        return predicted;
      }
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

  const isRecording = micListening;
  const isProcessing = voiceState === 'PROCESSING';
  const isSpeakingState = voiceState === 'SPEAKING' || isSpeaking;
  const mappedVoiceState =
    isRecording ? 'listening'
    : isProcessing ? 'thinking'
    : isSpeakingState ? 'speaking'
    : 'idle';

  // -- Voice-triggered drill video search --------------------------------
  useEffect(() => {
    if (!micTranscript) return;
    const t = micTranscript.toLowerCase();
    const isVideoReq = VIDEO_TRIGGER_PHRASES.some((p) => t.includes(p));
    if (!isVideoReq) return;
    void (async () => {
      try {
        setVoiceDrillLoading(true);
        setVoiceDrillVideo(null);
        const missPattern = getMissPattern();
        const fault = missPattern && missPattern !== "balanced" ? missPattern : null;
        const videos = await (searchDrillVideos as any)({
          fault,
          isOnCourse: true,
          maxResults: 1,
        });
        setVoiceDrillVideo(videos[0] ?? null);
      } catch (e: any) {
        console.log('[caddie] voice video:', e?.message);
      } finally {
        setVoiceDrillLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micTranscript]);

  // -- SmartVision capture: safety-gated, non-blocking
  const _isUserStationary = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return true; // no GPS = assume stationary (fail open)
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const prev = lastGpsRef.current;
      lastGpsRef.current = cur;
      if (!prev) return true; // first reading � assume stationary
      // Haversine-lite: 1 degree lat � 111 000 m
      const dlat = (cur.lat - prev.lat) * 111000;
      const dlng = (cur.lng - prev.lng) * 111000 * Math.cos((cur.lat * Math.PI) / 180);
      const meters = Math.sqrt(dlat * dlat + dlng * dlng);
      return meters < 2; // < 2 m = stationary
    } catch {
      return true; // GPS error = assume stationary, fail open
    }
  }, []);

  const _attemptSmartVision = useCallback(async () => {
    // Safety checks � fail silently on any condition
    if (isRecordingRef.current) return;
    if (getEngineState() !== 'idle') return; // don't interrupt voice
    const stationary = await _isUserStationary();
    if (!stationary) return;

    // Start camera � runs fully independently, never blocks UI or voice
    try {
      isRecordingRef.current = true;
      setShowShotCamera(true);

      // Auto-stop safety timeout (5 s max) � closes camera if capture never happens
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

  // -- End round -------------------------------------------------------------
  const handleEndRound = useCallback(() => {
    void engineCancelAll();
    // Snapshot before clearing � fire background AI analysis (non-blocking)
    const completedRoundState = useRoundStore.getState();
    const completedShots = completedRoundState.shots;
    const completedRoundShots = getRoundShotsSnapshot();
    void analyzeRoundInBackground(completedShots);

    // Build local post-round insights
    const analysis  = analyzeRound(completedShots, completedRoundShots);
    const newInsights = analysis ? generateInsights(analysis) : [];

    // Persist compact round summary for local learning / experience tier
    if (completedShots.length >= 3) {
      addRoundHistory(buildRoundSummary(completedShots, analysis));
    }

    const playedHoles = completedRoundState.scores.filter((score: number) => score > 0).length;
    const totalScore = completedRoundState.scores.reduce((sum: number, score: number) => sum + (score || 0), 0);
    if (playedHoles > 0) {
      usePointsStore.getState().addPoints(20, 'round-complete');
      if (playedHoles >= 18 && totalScore > 0 && totalScore <= 89) {
        usePointsStore.getState().addPoints(100, 'break-90');
      }
    }

    // Capture analysis BEFORE clearing the round so the modal has data to show.
    // setIsRoundActive(false) is deferred to the modal's onDismiss so the
    // tabs/_layout redirect doesn't yank us away before the summary mounts.
    if (analysis && newInsights.length > 0) {
      setPostRoundAnalysis(analysis);
      setPostRoundInsights(newInsights);
      pendingNavRef.current = () => {
        clearRound();
        resetCaddieRound();
        setIsRoundActive(false);
        router.replace('/tabs/play');
      };
      setShowPostRound(true);
      checkAndShow('replay', () => showTip('replay', "Your round is ready to replay and share in Dashboard."));
    } else {
      clearRound();
      resetCaddieRound();
      setIsRoundActive(false);
      router.replace('/tabs/play');
    }
  }, [clearRound, resetCaddieRound, setIsRoundActive, router, addRoundHistory]);

  useEffect(() => {
    if (!lastAward) return;
    if (lastAward.timestamp <= lastAwardSeenRef.current) return;
    lastAwardSeenRef.current = lastAward.timestamp;
    const reasonLabel = lastAward.reason.replace(/-/g, ' ');
    setPointsToast(`+${lastAward.points} pts | ${reasonLabel}`);
    if (pointsToastTimerRef.current) clearTimeout(pointsToastTimerRef.current);
    pointsToastTimerRef.current = setTimeout(() => {
      setPointsToast(null);
      pointsToastTimerRef.current = null;
    }, 2000);
  }, [lastAward]);

  const captureSwingFrame = async (): Promise<string> => Promise.resolve('frame-captured');
  const analyzeSwingFrame = async (_frame: string): Promise<string> =>
    Promise.resolve('Video analysis: path and face are slightly open through impact.');
  const analyzeImpactSound = async (): Promise<string> =>
    Promise.resolve('Audio analysis: contact quality is clean with a slight toe strike.');

  const runSmartMotion = useCallback(async () => {
    setSMCapturing(true);
    try {
      const results: string[] = [];
      if (smTools.capture) {
        const frame = await captureSwingFrame();
        const analysis = await analyzeSwingFrame(frame);
        results.push(analysis);
      }
      if (smTools.sound) {
        const contactQuality = await analyzeImpactSound();
        results.push(contactQuality);
      }
      if (smTools.golfFix) {
        results.push('GolfFix: compare your top-of-backswing against reference before next rep.');
      }
      if (smTools.trace) {
        results.push('Trace: club path visualized - keep the downswing shallower.');
      }
      // SmartMotion output disabled — V2 brain handles all responses
      // const combined = results.join(' ');
      // setSMAnalysis(combined);
      // useVoiceStore.getState().setCaddieResponse(combined);
      // await configureAudioForSpeech();
      // if (voiceEnabled && combined) {
      //   await voiceSpeak(combined);
      // }
      setSMAnalysis('');
      usePointsStore.getState().addPoints(3, 'smartmotion');
    } finally {
      setSMCapturing(false);
    }
  }, [smTools, voiceEnabled]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const handleLogout = useCallback(async () => {
    setShowToolsMenu(false);
    try { await signOut(auth); } catch {}
    setIsGuest(false);
    router.replace('/auth');
  }, [router]);

  const missComputed = useMemo(() => getMissPattern(), [getMissPattern]);
  const missColor = missComputed === 'right' ? '#f87171' : missComputed === 'left' ? '#60a5fa' : '#A7F3D0';

  // Manual override � tap the badge to cycle miss direction
  const [missOverride, setMissOverride] = useState<'right' | 'left' | 'balanced' | null>(null);
  const miss = missOverride ?? missComputed;
  const missLabel = miss === 'right' ? 'Tends right' : miss === 'left' ? 'Tends left' : 'Balanced';
  const cycleMiss = useCallback(() => {
    setMissOverride((cur) => {
      const current = cur ?? missComputed;
      if (current === 'balanced') return 'right';
      if (current === 'right')    return 'left';
      return 'balanced';
    });
  }, [missComputed]);

  // Manual pressure override � tap the badge to cycle Normal / High
  const [pressureOverride, setPressureOverride] = useState<'normal' | 'high' | null>(null);
  const effectivePressure = pressureOverride ?? (caddie.pressure as 'normal' | 'high' | undefined) ?? 'normal';
  const cyclePressure = useCallback(() => {
    setPressureOverride((cur) => {
      const current = cur ?? (caddie.pressure === 'high' ? 'high' : 'normal');
      return current === 'normal' ? 'high' : 'normal';
    });
  }, [caddie.pressure]);

  // ── Shot intelligence ─────────────────────────────────────────────────
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
      setPuttMode(false); setPuttBall(null); setPuttHole(null); setSlopeDirection(null); setPuttStrokes(0);
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

  const dictateNote = useCallback(async () => {
    if (isDictating) {
      try { await stopSTT(() => {}); } catch {}
      return;
    }
    setIsDictating(true);
    try {
      const text = await startSTT(() => {});
      const cleaned = (text ?? '').trim();
      if (cleaned) {
        setRoundNotes(roundNotes ? `${roundNotes} ${cleaned}` : cleaned);
      }
    } catch (e) {
      console.log('[dictateNote]', e);
    } finally {
      setIsDictating(false);
    }
  }, [isDictating, roundNotes, setRoundNotes]);

  useEffect(() => {
    if (!isDictating) {
      dictationPulse.stopAnimation();
      dictationPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dictationPulse, { toValue: 1.12, duration: 420, useNativeDriver: true }),
        Animated.timing(dictationPulse, { toValue: 1, duration: 420, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isDictating, dictationPulse]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      {false && (
        <>
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
          <Text style={s.headerSub}>Hole {currentHole} - {activeCourse}</Text>
          {/* Hole stats row � par + yardage at a glance */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <Text style={{ color: Palette.positive, fontSize: 13, fontWeight: '800', letterSpacing: 0.3 }}>H{currentHole}</Text>
            <View style={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.12)' }} />
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: '600' }}>Par {holePar}</Text>
            <View style={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.12)' }} />
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '500' }}>{activeCourseData?.holes[currentHole - 1]?.distance ?? holeDistance} yds</Text>
          </View>
          <SmartHint hint={smartHint} />
        </View>
        {(() => {
          // Use course-derived image; fall back to null (renders local fallback View)
          const thumbSource = thumbError ? undefined : holeThumbSource;
          // Always show a tappable hole preview � local fallback when no image is set
          const holeInfo = activeCourseData?.holes[currentHole - 1];
          return (
            <Pressable
              onPress={openSmartVision}
              onLongPress={() => setShowCourseInfo(true)}
              delayLongPress={250}
              style={{ marginRight: 4 }}
            >
              {thumbSource ? (
                <View
                  style={[
                    { borderRadius: 10, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(46,204,113,0.35)' },
                    isLarge && { alignSelf: 'center', marginLeft: 'auto', marginRight: 'auto' }
                  ]}
                >
                  <Image
                    source={thumbSource as ImageSourcePropType}
                    style={[
                      { width: 74, height: 56, backgroundColor: '#1a2e1a' },
                      isLarge && { alignSelf: 'center', marginLeft: 'auto', marginRight: 'auto' }
                    ]}
                    resizeMode="cover"
                    onError={() => setThumbError(true)}
                  />
                </View>
              ) : (
                // Local fallback � no image configured for this hole yet
                <View style={{
                  width: 74, height: 56, borderRadius: 10,
                  backgroundColor: '#0d2b18',
                  borderWidth: 1.5, borderColor: 'rgba(46,204,113,0.4)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: Palette.positive, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, opacity: 0.6 }}>TAP</Text>
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', lineHeight: 26 }}>{currentHole}</Text>
                </View>
              )}
            </Pressable>
          );
        })()}
        {isGuest && (
          <Pressable
            onPress={() => setShowSaveProgress(true)}
            hitSlop={8}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#052e1e', borderWidth: 1, borderColor: '#059669', justifyContent: 'center', alignItems: 'center' }}
          >
            <MCIcon name="content-save-outline" size={18} color="#A7F3D0" />
          </Pressable>
        )}
      </View>
        </>
      )}

      <SaveProgressModal
        visible={showSaveProgress}
        onDismiss={() => setShowSaveProgress(false)}
      />

      <PostRoundSummary
        visible={showPostRound}
        analysis={postRoundAnalysis}
        insights={postRoundInsights}
        onDismiss={() => {
          setShowPostRound(false);
          const nav = pendingNavRef.current;
          pendingNavRef.current = () => {};
          nav?.();
        }}
      />

      <Modal
        visible={showStrategyShots}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStrategyShots(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' }}>
          <View style={{ maxHeight: '82%', backgroundColor: '#0d1f16', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: '#1a3326', padding: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ color: '#A7F3D0', fontSize: 16, fontWeight: '800' }}>Saved Pre-Round Strategies</Text>
              <Pressable onPress={() => setShowStrategyShots(false)} hitSlop={10}>
                <MCIcon name="close" size={20} color="rgba(255,255,255,0.65)" />
              </Pressable>
            </View>

            <Pressable
              onPress={() => { void loadStrategyShots(); }}
              style={{ alignSelf: 'flex-start', marginBottom: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#1f7a5d', backgroundColor: '#0f2018' }}
            >
              <Text style={{ color: '#7ee4be', fontSize: 12, fontWeight: '700' }}>{strategyShotsLoading ? 'Refreshing...' : 'Refresh'}</Text>
            </Pressable>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
              {!strategyShotsLoading && strategyShots.length === 0 && (
                <View style={{ borderRadius: 10, borderWidth: 1, borderColor: '#1f3a2e', backgroundColor: '#0f2018', padding: 12 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>No pre-round strategy screenshots saved yet.</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.52)', fontSize: 12, marginTop: 4 }}>Open SmartVision Pre-Round Planner and tap Save Pre-Round Strategy Screenshot.</Text>
                </View>
              )}

              {strategyShots.map((shot) => (
                <View
                  key={shot.id}
                  style={{ borderRadius: 12, borderWidth: 1, borderColor: '#1f3a2e', backgroundColor: '#0f2018', marginBottom: 10, overflow: 'hidden' }}
                >
                  <Image source={{ uri: shot.uri }} style={{ width: '100%', height: 180, backgroundColor: '#111' }} resizeMode="cover" />
                  <View style={{ padding: 10 }}>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                      {shot.courseName || activeCourse} - Hole {shot.hole} - Par {shot.par}
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 2 }}>
                      {new Date(shot.createdAt).toLocaleString()} - {shot.distance} yds
                    </Text>
                    {Boolean(shot.analysisText) && (
                      <Text numberOfLines={2} style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12, marginTop: 5 }}>
                        {shot.analysisText}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Resume round prompt */}
      <Modal
        visible={showResumePrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setShowResumePrompt(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }}>
          <View style={{ backgroundColor: '#141414', borderRadius: 16, borderWidth: 1, borderColor: '#222', padding: 20, gap: 16, minWidth: '80%' }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Resume Round?</Text>
            <Text style={{ color: '#9ca3af', fontSize: 14, lineHeight: 20 }}>
              {activeCourse} - Hole {currentHole}
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                onPress={() => {
                  setShowResumePrompt(false);
                }}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#4ade80', alignItems: 'center' }}
              >
                <Text style={{ color: '#000', fontWeight: '600', fontSize: 14 }}>Continue Round</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  useRoundStore.getState().clearRound();
                  setShowResumePrompt(false);
                }}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#374151', alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Start New Round</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Penalty sheet */}
      <Modal
        visible={showPenaltySheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPenaltySheet(false)}
      >
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} onPress={() => setShowPenaltySheet(false)}>
          <View style={{ backgroundColor: '#141414', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: '#222', padding: 20, paddingBottom: 36, gap: 12 }}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 4 }}>What happened?</Text>
            {([
              { icon: 'water', label: 'Water Hazard', type: 'water', strokes: 1 },
              { icon: 'close-octagon-outline', label: 'Out of Bounds', type: 'ob', strokes: 2 },
              { icon: 'magnify', label: 'Lost Ball', type: 'lost-ball', strokes: 1 },
            ] as const).map((p) => (
              <Pressable
                key={p.type}
                style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: '#2a2a2a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                onPress={() => {
                  addPenalty({ hole: currentHole, strokes: p.strokes, reason: p.type });
                  setShowPenaltySheet(false);
                  const msg = p.type === 'water'
                    ? 'Drop and reload. Smooth swing.'
                    : p.type === 'ob'
                    ? 'Back to the tee - play 3.'
                    : 'Provisional in. Move forward.';
                  if (voiceEnabled) void speakJob(msg, ENGINE_PRIORITY.AMBIENT, voiceGender);
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <MCIcon name={p.icon} size={16} color="#e5e7eb" />
                  <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: '600' }}>{p.label}</Text>
                </View>
                <Text style={{ color: '#f59e0b', fontSize: 13, fontWeight: '700' }}>+{p.strokes}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setShowPenaltySheet(false)} style={{ alignItems: 'center', marginTop: 4 }}>
              <Text style={{ color: '#6b7280', fontSize: 14 }}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <GlobalMenu
        visible={showToolsMenu}
        onClose={() => setShowToolsMenu(false)}
        title="Caddie Tools"
        extraItems={(
          <>
            {isGuest && (
              <Pressable onPress={() => { setShowSaveProgress(true); setShowToolsMenu(false); }} style={s.menuItem}>
                <MCIcon name="content-save-outline" size={16} color={Palette.muted} />
                <Text style={s.menuItemText}>Save Progress</Text>
              </Pressable>
            )}
            {isRoundActive && (
              <Pressable onPress={() => { setShowToolsMenu(false); handleEndRound(); }} style={[s.menuItem, { borderColor: '#7a3030', backgroundColor: '#1e0808' }]}>
                <MCIcon name="flag-checkered" size={16} color="#f4a0a0" />
                <Text style={[s.menuItemText, { color: '#f4a0a0' }]}>End Round</Text>
              </Pressable>
            )}
            <Pressable onPress={() => { setShowToolsMenu(false); router.push('/rangefinder'); }} style={[s.menuItem, { borderColor: Palette.accent, backgroundColor: 'rgba(240,192,48,0.06)' }]}>
              <Text style={[s.menuItemText, { color: Palette.accent }]}>AR Rangefinder</Text>
            </Pressable>
            <Pressable onPress={openSmartVision} style={s.menuItem}>
              <MCIcon name="eye-outline" size={16} color={Palette.muted} />
              <Text style={s.menuItemText}>SmartVision</Text>
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
            <Pressable onPress={() => setFocusMode((v) => !v)} style={[s.menuItem, focusMode && s.menuItemActive]}>
              <MCIcon name="target" size={16} color={focusMode ? Palette.positiveFaint : Palette.muted} />
              <Text style={[s.menuItemText, focusMode && { color: Palette.positiveFaint }]}>Focus Mode {focusMode ? 'On' : 'Off'}</Text>
            </Pressable>
            <Pressable onPress={() => setHighContrast(!highContrast)} style={[s.menuItem, highContrast && s.menuItemActive]}>
              <MCIcon name="contrast-circle" size={16} color={highContrast ? Palette.positiveFaint : Palette.muted} />
              <Text style={[s.menuItemText, highContrast && { color: Palette.positiveFaint }]}>{highContrast ? 'High Contrast' : 'Normal'}</Text>
            </Pressable>
            <Pressable onPress={() => setBrightMode(!brightMode)} style={[s.menuItem, brightMode && s.menuItemActive]}>
              <MCIcon name="white-balance-sunny" size={16} color={brightMode ? Palette.positiveFaint : Palette.muted} />
              <Text style={[s.menuItemText, brightMode && { color: Palette.positiveFaint }]}>Bright Mode {brightMode ? 'On' : 'Off'}</Text>
            </Pressable>
            <Pressable onPress={() => { setShowToolsMenu(false); router.push('/profile-setup' as any); }} style={s.menuItem}>
              <MCIcon name="account-circle-outline" size={16} color={Palette.muted} />
              <Text style={s.menuItemText}>Profile</Text>
            </Pressable>
            <Pressable onPress={() => { setShowToolsMenu(false); router.push('/settings' as any); }} style={s.menuItem}>
              <MCIcon name="cog-outline" size={16} color={Palette.muted} />
              <Text style={s.menuItemText}>Settings</Text>
            </Pressable>
            <Pressable onPress={() => { const next = !biometricEnabled; setBiometricEnabled(next); BiometricLayoutControls._setBiometricEnabled?.(next); }} style={s.menuItem}>
              <MCIcon name="face-recognition" size={16} color={Palette.muted} />
              <Text style={s.menuItemText}>Face ID {biometricEnabled ? 'On' : 'Off'}</Text>
            </Pressable>
            <Pressable onPress={() => { setValidationMode((v) => !v); }} style={[s.menuItem, validationMode && { borderColor: '#3B82F6', backgroundColor: '#0d1e30' }]}>
              <MCIcon name="shield-check-outline" size={16} color={validationMode ? '#93c5fd' : Palette.muted} />
              <Text style={[s.menuItemText, validationMode && { color: '#93c5fd' }]}>Validation {validationMode ? 'On' : 'Off'}</Text>
            </Pressable>
          </>
        )}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.body, { paddingBottom: tabBarHeight + 16 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* Brand header — SmartPlay Caddie wordmark + tagline, with the tools pill
            anchored on the right side of the header. */}
        <BrandHeader rightSlot={
          <Pressable
            onPress={() => setShowToolsMenu((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={showToolsMenu ? 'Close tools menu' : 'Open tools menu'}
            style={[s.toolsPill, showToolsMenu && s.toolsPillActive]}
          >
            {[0,1,2].map((i) => (
              <View key={i} style={[s.dot, showToolsMenu && s.dotActive]} />
            ))}
          </Pressable>
        } />

        {/* Avatar with the green-arrow tools strip overlaid on its right side.
            Tools pill is on the opposite (left) side above. */}
        <View style={{ position: 'relative' }}>
          <CaddieAvatar
            gender={voiceGender === 'female' ? 'female' : 'male'}
            isOnCourse={isRoundActive}
            isCageMode={!isRoundActive}
            voiceState={mappedVoiceState}
            hole={currentHole}
            par={holePar}
            yards={displayDistance ?? null}
            wind={wind}
            playsLike={effectiveDistance ?? null}
            openingPrompt={openingPrompt}
            caddieResponse={caddieResponse || caddieMsg || currentAdvice}
            onTap={toggleMic}
          />

          <View style={{ position: 'absolute', top: 12, right: 0 }}>
            <CaddieToolsStrip
              onOpenSmartFinder={openRangefinder}
              onOpenPointfinder={() => { setPointA(null); setPointB(null); setShowPointRanger(true); }}
              onOpenSmartVision={openSmartVision}
              onOpenSwingLab={() => router.push('/tabs/swinglab')}
              onOpenRound={() => setShowToolsMenu(true)}
              onOpenShotCard={() => setShowShotCard(true)}
              onOpenMore={() => setShowMoreMenu(true)}
            />
          </View>
        </View>


        {/* ── Hole / Shots / Putts Steppers ──────────────────────────────────── */}
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
              <Text style={s.stepperLabel}>SHOTS</Text>
              {(() => {
                const sc   = gridScores[activePlayerIdx]?.[currentHole - 1] ?? 0;
                const diff = sc > 0 ? sc - holePar : null;
                const clr  = diff === null ? Palette.muted : diff < 0 ? Palette.positive : diff === 0 ? Palette.positiveFaint : diff === 1 ? Palette.warn : Palette.miss;
                const sub  = diff === null ? '--' : diff < -1 ? 'Eagle' : diff === -1 ? 'Birdie' : diff === 0 ? 'Par' : diff === 1 ? 'Bogey' : `+${diff}`;
                return (
                  <>
                    <View style={s.stepperControls}>
                      <Pressable style={s.stepperBtn} onPress={() => { const cur = gridScores[activePlayerIdx]?.[currentHole - 1] ?? 0; setCourseHoleScore(activePlayerIdx, currentHole - 1, Math.max(1, cur - 1)); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} }}>
                        <MCIcon name="minus" size={16} color={Palette.positiveFaint} />
                      </Pressable>
                      <Text style={[s.stepperValue, { color: clr }]}>{sc > 0 ? sc : '--'}</Text>
                      <Pressable style={s.stepperBtn} onPress={() => { const cur = gridScores[activePlayerIdx]?.[currentHole - 1] ?? 0; const next = Math.min(15, cur + 1); setCourseHoleScore(activePlayerIdx, currentHole - 1, next); const advice = getScoreAwareAdvice(next, holePar); setCaddieMsg(advice); if (voiceEnabled && cur === 0) void speakJob(advice, ENGINE_PRIORITY.STRATEGY, voiceGender); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} }}>
                        <MCIcon name="plus" size={16} color={Palette.positiveFaint} />
                      </Pressable>
                    </View>
                    <Text style={[s.stepperSub, { color: clr }]}>{sub}</Text>
                  </>
                );
              })()}
            </View>

            <View style={s.stepperDivider} />

            <View style={s.stepperCard}>
              <Text style={s.stepperLabel}>PUTTS</Text>
              {(() => {
                const putts = holePutts[currentHole - 1] ?? 0;
                return (
                  <>
                    <View style={s.stepperControls}>
                      <Pressable style={s.stepperBtn} onPress={() => { const cur = holePutts[currentHole - 1] ?? 0; if (cur > 0) setPuttForHole(currentHole - 1, cur - 1); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} }}>
                        <MCIcon name="minus" size={16} color={Palette.positiveFaint} />
                      </Pressable>
                      <Text style={s.stepperValue}>{putts > 0 ? putts : '--'}</Text>
                      <Pressable style={s.stepperBtn} onPress={() => { const cur = holePutts[currentHole - 1] ?? 0; setPuttForHole(currentHole - 1, Math.min(10, cur + 1)); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} }}>
                        <MCIcon name="plus" size={16} color={Palette.positiveFaint} />
                      </Pressable>
                    </View>
                    <Text style={s.stepperSub}>{putts === 1 ? '1-putt' : putts === 2 ? '2-putt' : putts >= 3 ? `${putts}-putt` : '--'}</Text>
                  </>
                );
              })()}
            </View>
          </View>

        <Pressable onPress={openRangefinder}>
          <Animated.View style={[s.distanceCard, { transform: [{ scale: rfScale }] }]}>
                {/* -- Corner brackets � rangefinder reticle ----------- */}
                <View pointerEvents="none" style={{ position: 'absolute', top: 0,    left: 0,  width: 16, height: 16, borderTopWidth: 1.5,    borderLeftWidth: 1.5,  borderColor: 'rgba(46,204,113,0.50)', borderTopLeftRadius: Radius.lg }} />
                <View pointerEvents="none" style={{ position: 'absolute', top: 0,    right: 0, width: 16, height: 16, borderTopWidth: 1.5,    borderRightWidth: 1.5, borderColor: 'rgba(46,204,113,0.50)', borderTopRightRadius: Radius.lg }} />
                <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0,  width: 16, height: 16, borderBottomWidth: 1.5, borderLeftWidth: 1.5,  borderColor: 'rgba(46,204,113,0.50)', borderBottomLeftRadius: Radius.lg }} />
                <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, right: 0, width: 16, height: 16, borderBottomWidth: 1.5, borderRightWidth: 1.5, borderColor: 'rgba(46,204,113,0.50)', borderBottomRightRadius: Radius.lg }} />

                {/* -- Header: brand left, icons right ------------------- */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 6 }}>
                  <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 1.8 }}>
                    <Text style={{ color: Palette.positive }}>SMART</Text>
                    <Text style={{ color: '#ffffff' }}> FINDER</Text>
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {/* Green rangefinder button � opens point-to-point modal */}
                    <Pressable
                      onPress={(e: GestureResponderEvent) => { e.stopPropagation(); setPointA(null); setPointB(null); setShowPointRanger(true); }}
                      hitSlop={8}
                      style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(46,204,113,0.18)', borderWidth: 1, borderColor: 'rgba(46,204,113,0.5)', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Image source={ICON_RANGEFINDER} style={{ width: 16, height: 16, tintColor: Palette.positive }} resizeMode="contain" />
                    </Pressable>
                  </View>
                </View>

                <Text style={[s.distanceNum, lockedDistance !== null && { color: Palette.positive }]}>
                  {displayDistance}
                </Text>
                <Text style={s.distanceUnit}>
                  {lockedDistance !== null ? `${t('locked')} \u00b7 ${t('yardsToPin')}` : t('yardsToPin')}
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
                  // CTR reuses unifiedMiddleDist � same value shown as the main YARDS TO PIN number
                  const front  = fDist !== null ? Math.round(fDist) : (unifiedMiddleDist !== null ? unifiedMiddleDist - 15 : null);
                  const center = unifiedMiddleDist;
                  const back   = bDist !== null ? Math.round(bDist) : (unifiedMiddleDist !== null ? unifiedMiddleDist + 15 : null);
                  if (front === null && center === null && back === null) return null;
                  return (
                    <View style={{
                      flexDirection: 'row',
                      marginTop: 10,
                      borderRadius: 10,
                      overflow: 'hidden',
                      borderWidth: 1,
                      borderColor: 'rgba(46,204,113,0.20)',
                    }}>
                      {/* FRONT */}
                      <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(0,0,0,0.22)' }}>
                        <Text style={{ color: 'rgba(251,191,36,0.7)', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>{t('front')}</Text>
                        <Text style={{ color: 'rgba(251,191,36,0.85)', fontSize: 17, fontWeight: '700', marginTop: 2, lineHeight: 20 }}>{front ?? '--'}</Text>
                      </View>
                      {/* CENTER */}
                      <View style={{ flex: 1.2, alignItems: 'center', paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.30)' }}>
                        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>{t('center')}</Text>
                        <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: '800', marginTop: 1, lineHeight: 28 }}>{center ?? '--'}</Text>
                      </View>
                      {/* BACK */}
                      <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(0,0,0,0.22)' }}>
                        <Text style={{ color: 'rgba(251,191,36,0.7)', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>{t('back')}</Text>
                        <Text style={{ color: 'rgba(251,191,36,0.85)', fontSize: 17, fontWeight: '700', marginTop: 2, lineHeight: 20 }}>{back ?? '--'}</Text>
                      </View>
                    </View>
                  );
                })()}
                {gpsMiddle !== null && (
                  <View style={s.gpsBadge}>
                    <Text style={{ color: Palette.positiveFaint, fontSize: 14, fontWeight: '600', letterSpacing: 0.5 }}>
                      {gpsAccuracyLevel === 'high' ? 'GPS - High' :
                       gpsAccuracyLevel === 'balanced' ? 'GPS - Balanced' :
                       gpsAccuracyLevel === 'weak' ? 'GPS - Weak' :
                       'GPS active'}
                    </Text>
                  </View>
                )}
                {!unifiedGPS.ready && gpsMiddle === null && !unifiedGPS.permissionDenied && (
                  <View style={s.gpsBadge}>
                    <Text style={{ color: Palette.warn, fontSize: 13, fontWeight: '600' }}>Locating GPS…</Text>
                  </View>
                )}
                {unifiedGPS.permissionDenied && (
                  <Pressable onPress={() => { void unifiedGPS.retry(); }} style={s.gpsBadge}>
                    <Text style={{ color: Palette.warn, fontSize: 13, fontWeight: '600' }}>Location off — tap to enable</Text>
                  </Pressable>
                )}
                {unifiedGPS.stale && unifiedGPS.ready && (
                  <Pressable onPress={() => { void unifiedGPS.retry(); }} style={s.gpsBadge}>
                    <Text style={{ color: Palette.warn, fontSize: 13, fontWeight: '600' }}>GPS lost — tap to retry</Text>
                  </Pressable>
                )}
                {lockedDistance !== null && (
                  <Pressable onPress={(e: GestureResponderEvent) => { e.stopPropagation(); setLockedDistance(null); }} style={{ marginTop: 4 }}>
                    <Text style={{ color: Palette.textSub, fontSize: 14 }}>clear lock</Text>
                  </Pressable>
                )}

          </Animated.View>
        </Pressable>

        {/* -- Wind + Elevation Controls � only shown in validation mode ---------- */}
        {validationMode && (
        <View style={{ marginHorizontal: 0, marginBottom: 6 }}>
          {/* Wind direction row */}
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
            {(['head', 'tail', 'left', 'right'] as const).map((dir) => {
              const labels: Record<string, string> = { head: 'Head', tail: 'Tail', left: 'Cross L', right: 'Cross R' };
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
                const elLabels: Record<string, string> = { up: 'Up', flat: 'Flat', down: 'Down' };
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
        )}

        {/* Bottom Caddie strategy/response card removed — the strategy text and
            caddie response are already shown in the avatar HUD overlay above,
            and SmartVision / SmartMotion live in the green-arrow tools strip. */}
        {/* -- Voice-triggered drill video ---------------------------------- */}
        {voiceDrillVideo && (
          <DrillVideoCard
            video={voiceDrillVideo}
            onDismiss={() => setVoiceDrillVideo(null)}
          />
        )}
        {voiceDrillLoading && (
          <View style={{ padding: 16, alignItems: 'center' }}>
            <Text style={{ color: '#6b7280', fontSize: 13 }}>Finding drill...</Text>
          </View>
        )}


        <Modal
          visible={showSmartMotion}
          transparent
          animationType="slide"
          onRequestClose={() => setShowSmartMotion(false)}
        >
          <View style={s.smOverlay}>
            <View style={s.smPanel}>
              <View style={s.smHeader}>
                <Text style={s.smTitle}>SmartMotion</Text>
                <Pressable onPress={() => setShowSmartMotion(false)}>
                  <Text style={s.smClose}>X</Text>
                </Pressable>
              </View>

              <View style={s.smTools}>
                {[
                  { key: 'capture', label: 'Capture', desc: 'Video + AI frame analysis' },
                  { key: 'golfFix', label: 'GolfFix', desc: 'Swing overlay vs reference' },
                  { key: 'sound', label: 'Sound', desc: 'Contact quality from audio' },
                  { key: 'trace', label: 'Trace', desc: 'Club path visualization' },
                ].map((tool) => (
                  <Pressable
                    key={tool.key}
                    style={[s.smTool, smTools[tool.key as keyof typeof smTools] && s.smToolActive]}
                    onPress={() =>
                      setSMTools((prev) => ({
                        ...prev,
                        [tool.key]: !prev[tool.key as keyof typeof prev],
                      }))
                    }
                  >
                    <Text style={s.smToolLabel}>{tool.label}</Text>
                    <Text style={s.smToolDesc}>{tool.desc}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={s.smActive}>
                {'Active: ' + Object.entries(smTools).filter(([, v]) => v).map(([k]) => k).join(' + ')}
              </Text>

              <Pressable style={s.smStartBtn} onPress={() => void runSmartMotion()} disabled={smCapturing}>
                <Text style={s.smStartText}>{smCapturing ? 'Analyzing...' : 'Start Capture'}</Text>
              </Pressable>

              {Boolean(smAnalysis) && (
                <View style={s.smResult}>
                  <Text style={s.smResultText}>{smAnalysis}</Text>
                </View>
              )}
            </View>
          </View>
        </Modal>



        {/* -- Point-to-Point Rangefinder Modal (SmartFinder green icon) ------------ */}
        <Modal
          visible={showPointRanger}
          transparent={false}
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setShowPointRanger(false)}
        >
          <View style={{ flex: 1, backgroundColor: '#000' }}>

            {/* -- Live camera background ----------------------------------- */}
            {cameraGranted && Platform.OS !== 'web' ? (
              <CameraView style={StyleSheet.absoluteFill} facing="back" />
            ) : !cameraGranted && Platform.OS !== 'web' ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#071e16', justifyContent: 'center', alignItems: 'center' }]}>
                <MCIcon name="camera-off" size={36} color="rgba(46,204,113,0.3)" />
                <Text style={{ color: '#ffffff', fontSize: 11, marginTop: 8 }}>Camera helps you aim</Text>
                <Pressable onPress={() => requestCameraPermission()} style={{ marginTop: 12, paddingVertical: 8, paddingHorizontal: 20, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(46,204,113,0.4)' }}>
                  <Text style={{ color: Palette.positive, fontSize: 11, fontWeight: '700' }}>Allow Camera</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#071e16' }]} />
            )}

            {/* -- Dim overlay so text is readable over camera ------------- */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.38)' }]} pointerEvents="none" />

            {/* -- Rangefinder corner brackets ----------------------- */}
            {[
              { top: 0,    left: 0,    borderTopWidth: 2,    borderLeftWidth: 2    },
              { top: 0,    right: 0,   borderTopWidth: 2,    borderRightWidth: 2   },
              { bottom: 0, left: 0,    borderBottomWidth: 2, borderLeftWidth: 2    },
              { bottom: 0, right: 0,   borderBottomWidth: 2, borderRightWidth: 2   },
            ].map((corner, ci) => (
              <View key={ci} pointerEvents="none" style={[{
                position: 'absolute', width: 30, height: 30,
                borderColor: '#2ecc71',
              }, corner]} />
            ))}
            {/* Scanline sweep */}
            <View pointerEvents="none" style={{
              position: 'absolute', left: 0, right: 0, height: 1,
              top: '50%', backgroundColor: 'rgba(46,204,113,0.18)',
            }} />

            {/* -- TOP BAR ------------------------------------------------- */}
            <View style={{ position: 'absolute', top: insets.top + 10, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(46,204,113,0.18)', borderWidth: 1.5, borderColor: Palette.positive, alignItems: 'center', justifyContent: 'center' }}>
                  <MCIcon name="map-marker-distance" size={18} color={Palette.positive} />
                </View>
                <View>
                  <Text style={{ color: Palette.positive, fontSize: 12, fontWeight: '800', letterSpacing: 1.8 }}>POINT RANGER</Text>
                  <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '500' }}>GPS point-to-point distance</Text>
                </View>
              </View>
              <Pressable onPress={() => setShowPointRanger(false)} hitSlop={14} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
                <MCIcon name="close" size={18} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>

            {/* -- CENTER: Animated crosshair + distance AR bubble --------- */}
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }} pointerEvents="none">

              {/* Distance AR bubble */}
              <View style={{
                backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 20,
                borderWidth: 1.5, borderColor: pointDist !== null ? Palette.positive : 'rgba(46,204,113,0.35)',
                paddingHorizontal: 28, paddingVertical: 14, marginBottom: 40,
                alignItems: 'center',
                shadowColor: pointDist !== null ? '#2ecc71' : 'transparent',
                shadowOpacity: 0.6, shadowRadius: 12,
              }}>
                <Text style={{ color: '#ffffff', fontSize: 9, fontWeight: '800', letterSpacing: 2, marginBottom: 2 }}>DISTANCE</Text>
                <Text style={{ color: pointDist !== null ? Palette.positive : 'rgba(46,204,113,0.35)', fontSize: 58, fontWeight: '900', lineHeight: 60 }}>
                  {pointDist !== null ? pointDist : '- - -'}
                </Text>
                <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>yards</Text>
                {(pointAAccuracy !== null || pointBAccuracy !== null) && (
                  <Text style={{ color: 'rgba(46,204,113,0.55)', fontSize: 9, marginTop: 4 }}>
                    {[pointAAccuracy !== null && `A +/-${Math.round(pointAAccuracy)}m`, pointBAccuracy !== null && `B +/-${Math.round(pointBAccuracy)}m`].filter(Boolean).join('  |  ')}
                  </Text>
                )}
              </View>

              {/* Animated targeting crosshair */}
              {(() => {
                const isLocking = pointALocking || pointBLocking;
                const locked = (pointALocking ? !!pointA : false) || (pointBLocking ? !!pointB : false);
                const ringScale = lockPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
                const ringOpacity = lockPulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.9, 0.4, 0.0] });
                const col = '#2ecc71';
                const SZ = 72, BW = 2.5, ARM = 18, GAP = 10;
                const glow = { shadowColor: col, shadowOpacity: 0.9, shadowRadius: 8 };
                return (
                  <View style={{ width: SZ * 2, height: SZ * 2, justifyContent: 'center', alignItems: 'center' }}>
                    {isLocking && (
                      <Animated.View style={{
                        position: 'absolute', width: SZ * 2, height: SZ * 2, borderRadius: SZ,
                        borderWidth: 2, borderColor: col,
                        opacity: ringOpacity,
                        transform: [{ scale: ringScale }],
                      }} />
                    )}
                    <View style={{ position: 'absolute', width: SZ * 2, height: SZ * 2, borderRadius: SZ, borderWidth: 1, borderColor: `rgba(46,204,113,${isLocking ? 0.6 : 0.35})` }} />
                    <View style={{ position: 'absolute', left: 0, top: SZ - BW / 2, width: SZ - GAP, height: BW, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', right: 0, top: SZ - BW / 2, width: SZ - GAP, height: BW, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', left: SZ - BW / 2, top: 0, width: BW, height: SZ - GAP, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', left: SZ - BW / 2, bottom: 0, width: BW, height: SZ - GAP, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', top: 0, left: 0, width: ARM, height: BW, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', top: 0, left: 0, width: BW, height: ARM, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', top: 0, right: 0, width: ARM, height: BW, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', top: 0, right: 0, width: BW, height: ARM, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', bottom: 0, left: 0, width: ARM, height: BW, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', bottom: 0, left: 0, width: BW, height: ARM, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', bottom: 0, right: 0, width: ARM, height: BW, backgroundColor: col, ...glow }} />
                    <View style={{ position: 'absolute', bottom: 0, right: 0, width: BW, height: ARM, backgroundColor: col, ...glow }} />
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: isLocking ? '#fff' : col, ...glow }} />
                    <View style={{ position: 'absolute', bottom: -28 }}>
                      <Text style={{ color: isLocking ? '#fbbf24' : locked ? col : '#ffffff', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textAlign: 'center' }}>
                        {isLocking ? 'ACQUIRING GPS...' : !pointA ? 'STAND AT POINT A' : !pointB ? 'STAND AT POINT B' : 'MEASUREMENT READY'}
                      </Text>
                    </View>
                  </View>
                );
              })()}
            </View>

            {/* -- BOTTOM CONTROLS ----------------------------------------- */}
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.75)', paddingTop: 20, paddingBottom: insets.bottom + 20, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: 'rgba(46,204,113,0.2)' }}>

              {/* GPS status bar */}
              <Text style={{ color: unifiedGPS.location ? 'rgba(46,204,113,0.7)' : Palette.warn, fontSize: 9, fontWeight: '600', letterSpacing: 0.5, textAlign: 'center', marginBottom: 14 }}>
                {unifiedGPS.location ? 'GPS ready - walk to each point and tap to mark' : 'GPS unavailable - enable location to use this tool'}
              </Text>

              {/* Point A & B buttons */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
                {/* Point A */}
                <Pressable
                  disabled={pointALocking}
                  onPress={async () => {
                    setPointALocking(true);
                    try {
                      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
                      setPointA({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                      setPointAAccuracy(pos.coords.accuracy);
                      try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); } catch {}
                    } catch {
                      const loc = unifiedGPS.location;
                      if (loc) { setPointA({ lat: loc.lat, lng: loc.lng }); setPointAAccuracy(null); }
                    } finally {
                      setPointALocking(false);
                    }
                  }}
                  style={{
                    flex: 1, paddingVertical: 16, borderRadius: 14,
                    backgroundColor: pointA ? 'rgba(46,204,113,0.22)' : 'rgba(255,255,255,0.07)',
                    borderWidth: 1.5, borderColor: pointA ? Palette.positive : 'rgba(255,255,255,0.2)',
                    alignItems: 'center', gap: 5, opacity: pointALocking ? 0.7 : 1,
                  }}
                >
                  <MCIcon name={pointALocking ? 'crosshairs-gps' : pointA ? 'map-marker-check' : 'map-marker-plus'} size={26} color={pointA ? Palette.positive : pointALocking ? '#fbbf24' : '#ffffff'} />
                  <Text style={{ color: pointA ? Palette.positive : pointALocking ? '#fbbf24' : '#ffffff', fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>
                    {pointALocking ? 'LOCKING...' : 'POINT  A'}
                  </Text>
                  <Text style={{ color: pointA ? '#4ade80' : 'rgba(255,255,255,0.65)', fontSize: 9 }}>
                    {pointA && !pointALocking ? (pointAAccuracy !== null ? `+/-${Math.round(pointAAccuracy)}m accurate` : 'marked') : 'tap to mark'}
                  </Text>
                </Pressable>

                {/* Divider arrow */}
                <View style={{ justifyContent: 'center', alignItems: 'center', width: 24 }}>
                  <MCIcon name="arrow-right-bold" size={18} color={pointA && pointB ? Palette.positive : '#ffffff'} />
                </View>

                {/* Point B */}
                <Pressable
                  disabled={pointBLocking}
                  onPress={async () => {
                    setPointBLocking(true);
                    try {
                      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
                      setPointB({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                      setPointBAccuracy(pos.coords.accuracy);
                      try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); } catch {}
                    } catch {
                      const loc = unifiedGPS.location;
                      if (loc) { setPointB({ lat: loc.lat, lng: loc.lng }); setPointBAccuracy(null); }
                    } finally {
                      setPointBLocking(false);
                    }
                  }}
                  style={{
                    flex: 1, paddingVertical: 16, borderRadius: 14,
                    backgroundColor: pointB ? 'rgba(46,204,113,0.22)' : 'rgba(255,255,255,0.07)',
                    borderWidth: 1.5, borderColor: pointB ? Palette.positive : 'rgba(255,255,255,0.2)',
                    alignItems: 'center', gap: 5, opacity: pointBLocking ? 0.7 : 1,
                  }}
                >
                  <MCIcon name={pointBLocking ? 'crosshairs-gps' : pointB ? 'map-marker-check' : 'map-marker-plus'} size={26} color={pointB ? Palette.positive : pointBLocking ? '#fbbf24' : '#ffffff'} />
                  <Text style={{ color: pointB ? Palette.positive : pointBLocking ? '#fbbf24' : '#ffffff', fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>
                    {pointBLocking ? 'LOCKING...' : 'POINT  B'}
                  </Text>
                  <Text style={{ color: pointB ? '#4ade80' : 'rgba(255,255,255,0.65)', fontSize: 9 }}>
                    {pointB && !pointBLocking ? (pointBAccuracy !== null ? `+/-${Math.round(pointBAccuracy)}m accurate` : 'marked') : 'tap to mark'}
                  </Text>
                </Pressable>
              </View>

              {/* Reset */}
              {(pointA || pointB) && (
                <Pressable
                  onPress={() => { setPointA(null); setPointB(null); setPointAAccuracy(null); setPointBAccuracy(null); }}
                  style={{ alignSelf: 'center', paddingVertical: 7, paddingHorizontal: 24, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
                >
                  <Text style={{ color: '#ffffff', fontSize: 11 }}>Reset Points</Text>
                </Pressable>
              )}
            </View>
          </View>
        </Modal>

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
        {/* ── Shot Correction Prompt ─────────────────────────────────────── */}
        {/* -- SHOT CARD — unified quality + direction rows ------------------- */}
        <View style={s.shotCard}>
          <Text style={s.shotCardLabel}>SHOT RESULT</Text>

          {/* Row 1 — result quality */}
          <View style={[s.shotBtnRow, isSmall && s.shotBtnRowCompact]}>
            <Pressable
              style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: Palette.positive, backgroundColor: 'rgba(0,200,150,0.08)' }]}
              onPress={() => { void recordShot('center'); handleShot('center'); }}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: Palette.positive }]}>{'\u2713  Good'}</Text>
            </Pressable>
            <Pressable
              style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)' }]}
              onPress={() => { void recordShot('short'); handleShot('short'); }}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: '#f59e0b' }]}>{'\u2193  Short'}</Text>
            </Pressable>
            <Pressable
              style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)' }]}
              onPress={() => { void recordShot('long'); handleShot('long'); }}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: '#f59e0b' }]}>{'\u2191  Long'}</Text>
            </Pressable>
          </View>

          {/* Row 2 — direction */}
          <View style={[s.shotBtnRow, isSmall && s.shotBtnRowCompact]}>
            <Pressable
              style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: '#4a90d9', backgroundColor: 'rgba(74,144,217,0.09)' }]}
              onPress={() => { void recordShot('left'); handleShot('left'); }}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: '#4a90d9' }]}>{'\u2190 Left'}</Text>
            </Pressable>
            <Pressable
              style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: Palette.positive, backgroundColor: 'rgba(0,200,150,0.08)' }]}
              onPress={() => { void recordShot('center'); handleShot('center'); }}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: Palette.positive }]}>{'\u2191 Straight'}</Text>
            </Pressable>
            <Pressable
              style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: Palette.miss, backgroundColor: 'rgba(239,68,68,0.08)' }]}
              onPress={() => { void recordShot('right'); handleShot('right'); }}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: Palette.miss }]}>{'Right \u2192'}</Text>
            </Pressable>
            <Pressable
              style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: 'rgba(251,146,60,0.55)', backgroundColor: 'rgba(251,146,60,0.08)', flexDirection: 'row', gap: 4 }]}
              onPress={() => void handleMarkShot()}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <MCIcon name="crosshairs-gps" size={12} color="#fb923c" />
              <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: '#fb923c' }]}>{t('mark')}</Text>
            </Pressable>
          </View>

          {/* Shot tracker — Caddie Brain V2 */}
          {hookShots.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 12, paddingTop: 4, paddingHorizontal: 4 }}>
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>Shots: {hookShots.length}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>Last: {hookShots[hookShots.length - 1]?.result}</Text>
            </View>
          )}
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

        {/* Bottom CADDIE advice card removed — caddie advice text is shown
            on the avatar HUD overlay (caddieResponse prop) instead. */}

      </ScrollView>

      <Modal
        visible={showShotCard}
        transparent
        animationType="slide"
        onRequestClose={() => setShowShotCard(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setShowShotCard(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.handle} />
            <Text style={s.moreTitle}>Shot Card</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
              <Text style={s.moreSub}>Quick log from the avatar panel.</Text>

              <View style={[s.shotBtnRow, isSmall && s.shotBtnRowCompact, { marginTop: 10 }]}>
                <Pressable
                  style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: Palette.positive, backgroundColor: 'rgba(0,200,150,0.08)' }]}
                  onPress={() => { void recordShot('center'); handleShot('center'); }}
                >
                  <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: Palette.positive }]}>{'✓  Good'}</Text>
                </Pressable>
                <Pressable
                  style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)' }]}
                  onPress={() => { void recordShot('short'); handleShot('short'); }}
                >
                  <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: '#f59e0b' }]}>{'↓  Short'}</Text>
                </Pressable>
                <Pressable
                  style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)' }]}
                  onPress={() => { void recordShot('long'); handleShot('long'); }}
                >
                  <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: '#f59e0b' }]}>{'↑  Long'}</Text>
                </Pressable>
              </View>

              <View style={[s.shotBtnRow, isSmall && s.shotBtnRowCompact]}>
                <Pressable
                  style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: '#4a90d9', backgroundColor: 'rgba(74,144,217,0.09)' }]}
                  onPress={() => { void recordShot('left'); handleShot('left'); }}
                >
                  <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: '#4a90d9' }]}>{'← Left'}</Text>
                </Pressable>
                <Pressable
                  style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: Palette.positive, backgroundColor: 'rgba(0,200,150,0.08)' }]}
                  onPress={() => { void recordShot('center'); handleShot('center'); }}
                >
                  <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: Palette.positive }]}>{'↑ Straight'}</Text>
                </Pressable>
                <Pressable
                  style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: Palette.miss, backgroundColor: 'rgba(239,68,68,0.08)' }]}
                  onPress={() => { void recordShot('right'); handleShot('right'); }}
                >
                  <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: Palette.miss }]}>{'Right →'}</Text>
                </Pressable>
                <Pressable
                  style={[s.shotUnifiedBtn, isSmall && s.shotUnifiedBtnCompact, { borderColor: 'rgba(251,146,60,0.55)', backgroundColor: 'rgba(251,146,60,0.08)', flexDirection: 'row', gap: 4 }]}
                  onPress={() => void handleMarkShot()}
                >
                  <MCIcon name="crosshairs-gps" size={12} color="#fb923c" />
                  <Text numberOfLines={1} style={[s.shotUnifiedText, isSmall && s.shotUnifiedTextCompact, { color: '#fb923c' }]}>{t('mark')}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showMoreMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMoreMenu(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setShowMoreMenu(false)}>
          <View style={s.moreSheet}>
            <View style={s.handle} />
            <Text style={s.moreTitle}>More</Text>
            <Pressable
              style={s.moreItem}
              onPress={() => {
                setShowMoreMenu(false);
                setShowToolsMenu(true);
              }}
            >
              <Text style={s.moreIcon}>⚙️</Text>
              <View>
                <Text style={s.moreText}>Tools</Text>
                <Text style={s.moreLabel}>Open caddie controls and settings</Text>
              </View>
            </Pressable>
            <Pressable
              style={s.moreItem}
              onPress={() => {
                setShowMoreMenu(false);
                openSmartVision();
              }}
            >
              <Text style={s.moreIcon}>🛰️</Text>
              <View>
                <Text style={s.moreText}>SmartVision</Text>
                <Text style={s.moreLabel}>Open hole view and planner</Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* First-launch onboarding tips */}
      <Modal visible={!hasOnboarded} transparent animationType="fade" onRequestClose={() => setHasOnboarded(true)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'flex-end', padding: 24, paddingBottom: 40 }}>
          <View style={{ backgroundColor: '#0B1E13', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(74,222,128,0.25)', padding: 24 }}>
            <Text style={{ color: '#4ade80', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 4 }}>Welcome to SmartPlay Caddie</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 20 }}>3 things to know</Text>
            {[
              { icon: '🎙️', title: 'Ask anything using the mic', body: 'Tap the SmartPlay logo mic at the top and speak - club, distance, strategy, or any question.' },
              { icon: '⛳', title: 'Tap to track your shots', body: 'After each shot, tap Left, Straight, or Right to log it. Your caddie learns your game.' },
              { icon: '🤖', title: 'Your caddie guides you automatically', body: 'Advice updates every hole. The more you play, the smarter it gets.' },
            ].map((tip, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 28, lineHeight: 36 }}>{tip.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#e2e8f0', fontSize: 15, fontWeight: '700', marginBottom: 3 }}>{tip.title}</Text>
                  <Text style={{ color: '#6b7280', fontSize: 13, lineHeight: 20 }}>{tip.body}</Text>
                </View>
              </View>
            ))}
            <Pressable
              onPress={() => setHasOnboarded(true)}
              style={{ backgroundColor: '#4ade80', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 }}
            >
              <Text style={{ color: '#071E16', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 }}>Let&apos;s Play</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── SmartVision HoleViewer with interactive planner ────────────────────────────────── */}
      {activeCourseData && (
        <HoleViewer
          visible={showHolePreview}
          initialHole={currentHole}
          course={activeCourseData as any}
          onClose={() => setShowHolePreview(false)}
          isRoundActive={isRoundActive}
          currentHole={currentHole}
          recommendedClub={clubRec.club ?? undefined}
          windSpeed={wind.speed}
          windDir={wind.direction === 'head' ? 'headwind' : wind.direction === 'tail' ? 'tailwind' : wind.direction}
          playsLike={effectiveDistance ?? null}
          gpsYards={{
            front: displayDistance !== null ? Math.max(0, Math.round(displayDistance) - 15) : null,
            middle: displayDistance !== null ? Math.round(displayDistance) : null,
            back: displayDistance !== null ? Math.round(displayDistance) + 15 : null,
          }}
          onNavigateHole={(hole) => setCurrentHole(Math.max(1, Math.min(18, hole)))}
          ballPosition={ballPosition}
          setBallPosition={setBallPosition}
          targetPosition={targetPosition}
          setTargetPosition={setTargetPosition}
          mapSize={mapSize}
          setMapSize={setMapSize}
          puttMode={puttMode}
          setPuttMode={setPuttMode}
          puttBall={puttBall}
          setPuttBall={setPuttBall}
          puttHole={puttHole}
          setPuttHole={setPuttHole}
          slopeDirection={slopeDirection}
          setSlopeDirection={setSlopeDirection}
        />
      )}

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
    paddingVertical: 14, paddingHorizontal: 8,
  },
  stepperDivider: { width: 1, backgroundColor: Palette.border, marginVertical: 12 },
  stepperLabel: {
    color: Palette.muted, fontSize: 11,
    fontWeight: Type.bold, letterSpacing: 1.4,
    textTransform: 'uppercase', marginBottom: 8,
  },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepperBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Palette.brandDeep,
    borderWidth: 1.5, borderColor: 'rgba(46,204,113,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  stepperBtnText: { color: Palette.positiveFaint, fontSize: 20, fontWeight: Type.bold, lineHeight: 24 },
  stepperValue: {
    color: Palette.textPrimary, fontSize: 28, fontWeight: Type.bold,
    minWidth: 36, textAlign: 'center' as const,
  },
  stepperSub: { color: Palette.muted, fontSize: 11, fontWeight: Type.semibold, marginTop: 5 },

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

  // Caddie card + SmartMotion styles
  caddieCard: {
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 12,
    marginBottom: 10,
    gap: 8,
    // Force the card to size to its container; long advice/response text
    // gets clipped by overflow:hidden + numberOfLines on each Text child below.
    width: '100%',
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  caddieStrategyText: { color: Palette.textPrimary, fontSize: Type.sm, lineHeight: 20, fontWeight: Type.semibold },
  pointsBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(46,204,113,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.35)',
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pointsBadgeText: { color: Palette.positive, fontSize: Type.xs, fontWeight: Type.bold },
  caddieCardDivider: { height: 1, backgroundColor: Palette.border },
  caddieResponseText: { color: Palette.textPrimary, fontSize: Type.body, lineHeight: 21, fontWeight: Type.medium },
  smartToolsTitle: { fontSize: Type.body, lineHeight: 21, fontWeight: Type.bold },
  smartToolsSmart: { color: Palette.positive },
  smartToolsTools: { color: Palette.textPrimary },
  startRoundBtn: {
    backgroundColor: '#0E2A1F',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#00C896',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  startRoundBtnText: {
    color: '#A7F3D0',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  caddieVoiceState: { color: Palette.positive, fontSize: Type.xs, fontWeight: Type.bold },
  caddieActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  caddieActionsRowCompact: { gap: 6 },
  caddieActionsRowUltraCompact: { gap: 4 },
  caddieActionBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 8,
  },
  caddieActionBtnCompact: {
    minHeight: 52,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
    flexDirection: 'column',
  },
  caddieActionBtnUltraCompact: {
    minHeight: 46,
    paddingHorizontal: 4,
    paddingVertical: 5,
    gap: 3,
  },
  caddieActionLabel: { fontSize: Type.sm, fontWeight: Type.bold, flexShrink: 1, minWidth: 0 },
  caddieActionLabelCompact: {
    fontSize: 11,
    lineHeight: 13,
    textAlign: 'center',
    flexShrink: 1,
  },
  caddieActionLabelUltraCompact: {
    fontSize: 10,
    lineHeight: 11,
    textAlign: 'center',
  },
  caddieActionBtnMotion: {
    borderColor: '#3B82F6',
    backgroundColor: 'rgba(59,130,246,0.16)',
  },
  caddieActionLabelMotion: {
    color: '#93C5FD',
  },
  smOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 16,
  },
  smPanel: {
    backgroundColor: Palette.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 14,
    gap: 10,
  },
  smHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  smTitle: { color: Palette.textPrimary, fontSize: Type.lg, fontWeight: Type.bold },
  smClose: { color: Palette.muted, fontSize: 16, fontWeight: Type.bold },
  smTools: { gap: 8 },
  smTool: {
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.brandDeep,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  smToolActive: {
    borderColor: Palette.positive,
    backgroundColor: 'rgba(46,204,113,0.1)',
  },
  smToolLabel: { color: Palette.textPrimary, fontSize: Type.sm, fontWeight: Type.bold },
  smToolDesc: { color: Palette.textSub, fontSize: Type.xs, marginTop: 2 },
  smActive: { color: Palette.muted, fontSize: Type.xs, fontWeight: Type.medium },
  smStartBtn: {
    backgroundColor: Palette.positive,
    borderRadius: Radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  smStartText: { color: '#071E16', fontSize: Type.body, fontWeight: Type.bold },
  smResult: {
    backgroundColor: Palette.brandDeep,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    padding: 10,
  },
  smResultText: { color: Palette.textPrimary, fontSize: Type.sm, lineHeight: 20 },

  // ── Strategy + Aim Row ───────────────────────────────────────────────────
  strategyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginBottom: 4 },
  strategyLine: { color: Palette.muted, fontSize: Type.xs, fontWeight: Type.semibold, letterSpacing: 0.5 },
  aimRow: { flexDirection: 'row', gap: 5 },
  aimBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.cardBg },
  aimBtnActive: { backgroundColor: Palette.bgActive, borderColor: Palette.borderActive },
  aimBtnText: { color: Palette.textSub, fontSize: Type.sm, fontWeight: Type.semibold },
  aimBtnTextActive: { color: Palette.positive },

  // -- Unified SHOT CARD styles ----------------------------------------
  shotCard: { backgroundColor: Palette.cardBgDark, borderRadius: Radius.lg, borderWidth: 1, borderColor: Palette.border, padding: 14, marginHorizontal: 0, marginBottom: Space.xs, gap: 10 },
  shotCardLabel: { color: Palette.textMuted, fontSize: 10, fontWeight: Type.bold, letterSpacing: 1.4, textTransform: 'uppercase' as const, marginBottom: 2 },
  shotBtnRow: { flexDirection: 'row' as const, gap: 7 },
  shotBtnRowCompact: { gap: 5 },
  shotUnifiedBtn: { flex: 1, height: 42, borderRadius: 10, borderWidth: 1, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' as const, gap: 3 },
  shotUnifiedBtnCompact: { height: 40, borderRadius: 9, paddingHorizontal: 4 },
  shotUnifiedText: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.2 },
  shotUnifiedTextCompact: { fontSize: 10.5, letterSpacing: 0, textAlign: 'center' },
  shotRow: { flexDirection: 'row' as const, gap: 8, marginBottom: 4 },
  shotBtn: { flex: 1, height: 42, borderRadius: 10, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  shotBtnLeft:     { borderColor: '#263A52', backgroundColor: '#111E2E' },
  shotBtnRight:    { borderColor: '#52252A', backgroundColor: '#2A1414' },
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

  micBtn: {
    marginTop: 10,
    alignSelf: 'center',
    minWidth: 170,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.45)',
    backgroundColor: 'rgba(5,30,22,0.9)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  micBtnActive: {
    borderColor: '#4ade80',
    backgroundColor: 'rgba(22,101,52,0.45)',
  },
  micIcon: { fontSize: 16 },
  micLabel: { color: '#dcfce7', fontSize: 13, fontWeight: '700' },

  navRow: {
    marginTop: 12,
    marginBottom: 8,
    flexDirection: 'row',
    gap: 10,
  },
  navBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIcon: { fontSize: 16, marginBottom: 2 },
  navLabel: { color: '#e5e7eb', fontSize: 12, fontWeight: '700' },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0f1720',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: '#253244',
    paddingHorizontal: 18,
    paddingBottom: 26,
    paddingTop: 10,
  },
  moreSheet: {
    backgroundColor: '#0b131e',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: '#27354a',
    paddingHorizontal: 18,
    paddingBottom: 28,
    paddingTop: 10,
  },
  handle: {
    width: 54,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginBottom: 12,
  },
  moreTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  moreItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  moreIcon: { fontSize: 17 },
  moreText: { color: '#f1f5f9', fontSize: 14, fontWeight: '700' },
  moreLabel: { color: '#94a3b8', fontSize: 12, marginTop: 1 },
  moreSub: { color: '#94a3b8', fontSize: 13 },
});


