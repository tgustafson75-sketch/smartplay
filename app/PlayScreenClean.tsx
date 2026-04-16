import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { speak as playElevenLabsAudio, stopSpeaking, setGlobalGender } from '../services/voiceService';
import { runCaddie } from '../services/caddieOrchestrator';
import { buildContext, getAdvancedPatterns } from '../services/contextBuilder';
import { updatePlayerModel } from '../services/playerModel';
import { recordClubDistance } from '../services/clubTracker';
import { updateCourseMemory } from '../services/courseMemory';
import { updateScore, resetRoundState } from '../services/scoringEngine';
import { useVoiceCaddie } from '../hooks/useVoiceCaddie';
import { getAIResponse } from '../services/aiCoach';
import { getCaddieAdvice as getAICaddieAdvice } from '../services/caddieBrain';
import { speakCaddie as speakCaddieAI } from '../services/voice';
import { getDispersion as getClubMissDispersion } from '../services/dispersion';
import { getTargetStrategy } from '../services/strategy';
import { holeData } from '../data/holeData';
import { getClubStats as computeClubDistances } from '../services/clubStats';
import { selectClub } from '../services/clubSelector';
import { calculateStrokesGained } from '../services/strokesGained';
import { getRoundInsights } from '../services/roundInsights';
import CaddieMicButton from '../components/CaddieMicButton';
import { useVoiceStore } from '../store/voiceStore';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Image, Animated, Platform, Modal, Share, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { Picker } from '@react-native-picker/picker';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Video, ResizeMode, Audio } from 'expo-av';
import { playerProfile } from '../store/playerProfile';
import { usePlayerProfileStore, buildProfileHint } from '../store/playerProfileStore';
import { useRoundStore } from '../store/roundStore';
import type { Shot } from '../store/roundStore';
import { useUserStore } from '../store/userStore';
import { useSettingsStore } from '../store/settingsStore';
import { collection, addDoc, onSnapshot, doc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { useSwingDetector, getSwingFeedback } from '../hooks/useSwingDetector';
import { useSwingStore } from '../store/swingStore';
import { useCaddieMemory } from '../store/CaddieMemory';
import { BiometricLayoutControls } from './_layout';
import { checkBiometricSupport } from '../services/BiometricService';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Svg, { Line as SvgLine, Circle as SvgCircle } from 'react-native-svg';
import {
  setLowPowerMode  as vpSetLowPowerMode,
  pauseProcessing  as vpPauseProcessing,
  resumeProcessing as vpResumeProcessing,
  setBurstMode     as vpSetBurstMode,
} from '../services/VisionProcessor';

const LOGO = require('../assets/images/logo.png');
const ICON_RANGEFINDER = require('../assets/images/icon-rangefinder.png');
const SWING_SWOOSH_SFX = require('../assets/sounds/swing-swoosh.mp3');
const PUTT_ROLL_SFX   = require('../assets/sounds/putt-roll.mp3');
const IMG_SWING_FACE_OPEN_CLOSED = require('../assets/images/swing-face-open-closed.jpg');
const IMG_SWING_PATH_INSIDE_OUT = require('../assets/images/swing-path-inside-out.jpg');
const IMG_SWING_DRIVER_IMPACT = require('../assets/images/swing-driver-impact.jpg');
const IMG_SWING_DRIVER_SETUP = require('../assets/images/swing-driver-setup.jpg');
const IMG_SWING_FACE_DIAGRAM = require('../assets/images/swing-face-diagram.jpg');

const HOLE_IMAGES: Record<number, number> = {
  1: require('../assets/images/hole1.jpg'),
  2: require('../assets/images/hole2.jpg'),
  3: require('../assets/images/hole3.jpg'),
  4: require('../assets/images/hole4.jpg'),
  5: require('../assets/images/hole5.jpg'),
  6: require('../assets/images/hole6.jpg'),
  7: require('../assets/images/hole7.jpg'),
  8: require('../assets/images/hole8.jpg'),
  9: require('../assets/images/hole9.jpg'),
};

type CourseHole = { hole: number; par: number; distance: number; note: string; front: { lat: number; lng: number }; middle: { lat: number; lng: number }; back: { lat: number; lng: number } };
type Course = { name: string; slope: number; rating: number; holes: CourseHole[] };

const COURSE_DB: Course[] = [
  {
    name: 'Menifee Lakes – Palms',
    slope: 118,
    rating: 69.8,
    holes: [
      { hole: 1,  par: 4, distance: 356, note: 'Wide landing area, open tee shot',   front: { lat: 33.6892, lng: -117.1820 }, middle: { lat: 33.6891, lng: -117.1820 }, back: { lat: 33.6890, lng: -117.1820 } },
      { hole: 2,  par: 4, distance: 355, note: 'Water short-left, aim center',        front: { lat: 33.6896, lng: -117.1832 }, middle: { lat: 33.6895, lng: -117.1832 }, back: { lat: 33.6894, lng: -117.1832 } },
      { hole: 3,  par: 4, distance: 356, note: 'Dogleg right, trees on corner',       front: { lat: 33.6903, lng: -117.1845 }, middle: { lat: 33.6902, lng: -117.1845 }, back: { lat: 33.6901, lng: -117.1845 } },
      { hole: 4,  par: 5, distance: 489, note: 'Reachable par 5, bunkers right',      front: { lat: 33.6911, lng: -117.1858 }, middle: { lat: 33.6910, lng: -117.1858 }, back: { lat: 33.6909, lng: -117.1858 } },
      { hole: 5,  par: 4, distance: 371, note: 'Long par 4, slight dogleg left',      front: { lat: 33.6919, lng: -117.1870 }, middle: { lat: 33.6918, lng: -117.1870 }, back: { lat: 33.6917, lng: -117.1870 } },
      { hole: 6,  par: 3, distance: 170, note: 'Bunker guards green, aim center',     front: { lat: 33.6926, lng: -117.1883 }, middle: { lat: 33.6925, lng: -117.1883 }, back: { lat: 33.6924, lng: -117.1883 } },
      { hole: 7,  par: 4, distance: 375, note: 'Water right of green, lay up left',   front: { lat: 33.6934, lng: -117.1896 }, middle: { lat: 33.6933, lng: -117.1896 }, back: { lat: 33.6932, lng: -117.1896 } },
      { hole: 8,  par: 4, distance: 375, note: 'Tight fairway, bunker short-left',    front: { lat: 33.6941, lng: -117.1908 }, middle: { lat: 33.6940, lng: -117.1908 }, back: { lat: 33.6939, lng: -117.1908 } },
      { hole: 9,  par: 5, distance: 491, note: 'Finishing front nine, birdie chance', front: { lat: 33.6949, lng: -117.1921 }, middle: { lat: 33.6948, lng: -117.1921 }, back: { lat: 33.6947, lng: -117.1921 } },
      { hole: 10, par: 4, distance: 390, note: 'Slight dogleg right, open approach',  front: { lat: 33.6957, lng: -117.1934 }, middle: { lat: 33.6956, lng: -117.1934 }, back: { lat: 33.6955, lng: -117.1934 } },
      { hole: 11, par: 4, distance: 410, note: 'Long par 4, elevated green',          front: { lat: 33.6964, lng: -117.1947 }, middle: { lat: 33.6963, lng: -117.1947 }, back: { lat: 33.6962, lng: -117.1947 } },
      { hole: 12, par: 3, distance: 155, note: 'Short iron to elevated green',        front: { lat: 33.6972, lng: -117.1960 }, middle: { lat: 33.6971, lng: -117.1960 }, back: { lat: 33.6970, lng: -117.1960 } },
      { hole: 13, par: 5, distance: 480, note: 'Long par 5, bunkers both sides',      front: { lat: 33.6980, lng: -117.1972 }, middle: { lat: 33.6979, lng: -117.1972 }, back: { lat: 33.6978, lng: -117.1972 } },
      { hole: 14, par: 4, distance: 365, note: 'Straight hole, tight landing zone',   front: { lat: 33.6987, lng: -117.1985 }, middle: { lat: 33.6986, lng: -117.1985 }, back: { lat: 33.6985, lng: -117.1985 } },
      { hole: 15, par: 4, distance: 380, note: 'Subtle dogleg left, water short',     front: { lat: 33.6995, lng: -117.1998 }, middle: { lat: 33.6994, lng: -117.1998 }, back: { lat: 33.6993, lng: -117.1998 } },
      { hole: 16, par: 3, distance: 160, note: 'Island green, all carry required',    front: { lat: 33.7003, lng: -117.2011 }, middle: { lat: 33.7002, lng: -117.2011 }, back: { lat: 33.7001, lng: -117.2011 } },
      { hole: 17, par: 4, distance: 375, note: 'Water left off tee, bail right',      front: { lat: 33.7010, lng: -117.2024 }, middle: { lat: 33.7009, lng: -117.2024 }, back: { lat: 33.7008, lng: -117.2024 } },
      { hole: 18, par: 5, distance: 501, note: 'Finishing hole, risk-reward approach',front: { lat: 33.7018, lng: -117.2037 }, middle: { lat: 33.7017, lng: -117.2037 }, back: { lat: 33.7016, lng: -117.2037 } },
    ],
  },
  {
    name: 'Menifee Lakes – Lakes',
    slope: 121,
    rating: 70.4,
    holes: [
      { hole: 1,  par: 4, distance: 395, note: 'Lake left, wide tee',   front: { lat: 33.6900, lng: -117.1900 }, middle: { lat: 33.6899, lng: -117.1900 }, back: { lat: 33.6898, lng: -117.1900 } },
      { hole: 2,  par: 4, distance: 375, note: 'Over water hazard',      front: { lat: 33.6908, lng: -117.1912 }, middle: { lat: 33.6907, lng: -117.1912 }, back: { lat: 33.6906, lng: -117.1912 } },
      { hole: 3,  par: 5, distance: 545, note: 'Creek crosses fairway',  front: { lat: 33.6915, lng: -117.1925 }, middle: { lat: 33.6914, lng: -117.1925 }, back: { lat: 33.6913, lng: -117.1925 } },
      { hole: 4,  par: 3, distance: 170, note: 'Carry over water',       front: { lat: 33.6923, lng: -117.1937 }, middle: { lat: 33.6922, lng: -117.1937 }, back: { lat: 33.6921, lng: -117.1937 } },
      { hole: 5,  par: 4, distance: 415, note: 'Dogleg right, bunker',   front: { lat: 33.6930, lng: -117.1950 }, middle: { lat: 33.6929, lng: -117.1950 }, back: { lat: 33.6928, lng: -117.1950 } },
      { hole: 6,  par: 4, distance: 385, note: 'Water right of green',   front: { lat: 33.6938, lng: -117.1962 }, middle: { lat: 33.6937, lng: -117.1962 }, back: { lat: 33.6936, lng: -117.1962 } },
      { hole: 7,  par: 3, distance: 185, note: 'Island green, par 3',    front: { lat: 33.6945, lng: -117.1975 }, middle: { lat: 33.6944, lng: -117.1975 }, back: { lat: 33.6943, lng: -117.1975 } },
      { hole: 8,  par: 5, distance: 560, note: 'Two lakes in play',      front: { lat: 33.6953, lng: -117.1988 }, middle: { lat: 33.6952, lng: -117.1988 }, back: { lat: 33.6951, lng: -117.1988 } },
      { hole: 9,  par: 4, distance: 400, note: 'Finishing nine, uphill', front: { lat: 33.6960, lng: -117.2000 }, middle: { lat: 33.6959, lng: -117.2000 }, back: { lat: 33.6958, lng: -117.2000 } },
      { hole: 10, par: 4, distance: 370, note: 'Lake along right side',  front: { lat: 33.6968, lng: -117.2013 }, middle: { lat: 33.6967, lng: -117.2013 }, back: { lat: 33.6966, lng: -117.2013 } },
      { hole: 11, par: 3, distance: 155, note: 'Short iron over creek',  front: { lat: 33.6975, lng: -117.2025 }, middle: { lat: 33.6974, lng: -117.2025 }, back: { lat: 33.6973, lng: -117.2025 } },
      { hole: 12, par: 5, distance: 525, note: 'Reachable eagle hole',   front: { lat: 33.6983, lng: -117.2038 }, middle: { lat: 33.6982, lng: -117.2038 }, back: { lat: 33.6981, lng: -117.2038 } },
      { hole: 13, par: 4, distance: 420, note: 'Tight tee, water left',  front: { lat: 33.6990, lng: -117.2050 }, middle: { lat: 33.6989, lng: -117.2050 }, back: { lat: 33.6988, lng: -117.2050 } },
      { hole: 14, par: 4, distance: 390, note: 'Bunkers guard green',    front: { lat: 33.6998, lng: -117.2063 }, middle: { lat: 33.6997, lng: -117.2063 }, back: { lat: 33.6996, lng: -117.2063 } },
      { hole: 15, par: 3, distance: 165, note: 'Wind off the lake',      front: { lat: 33.7005, lng: -117.2075 }, middle: { lat: 33.7004, lng: -117.2075 }, back: { lat: 33.7003, lng: -117.2075 } },
      { hole: 16, par: 4, distance: 405, note: 'Dogleg around lake',     front: { lat: 33.7013, lng: -117.2088 }, middle: { lat: 33.7012, lng: -117.2088 }, back: { lat: 33.7011, lng: -117.2088 } },
      { hole: 17, par: 5, distance: 540, note: 'Eagle opportunity',      front: { lat: 33.7020, lng: -117.2100 }, middle: { lat: 33.7019, lng: -117.2100 }, back: { lat: 33.7018, lng: -117.2100 } },
      { hole: 18, par: 4, distance: 430, note: 'Lake behind green',      front: { lat: 33.7028, lng: -117.2113 }, middle: { lat: 33.7027, lng: -117.2113 }, back: { lat: 33.7026, lng: -117.2113 } },
    ],
  },
  {
    name: 'Temecula Creek',
    slope: 125,
    rating: 71.2,
    holes: [
      { hole: 1,  par: 4, distance: 400, note: 'Open tee shot',      front: { lat: 33.5010, lng: -117.0800 }, middle: { lat: 33.5009, lng: -117.0800 }, back: { lat: 33.5008, lng: -117.0800 } },
      { hole: 2,  par: 5, distance: 530, note: 'Creek right',        front: { lat: 33.5017, lng: -117.0813 }, middle: { lat: 33.5016, lng: -117.0813 }, back: { lat: 33.5015, lng: -117.0813 } },
      { hole: 3,  par: 3, distance: 165, note: 'Elevated tee',       front: { lat: 33.5025, lng: -117.0826 }, middle: { lat: 33.5024, lng: -117.0826 }, back: { lat: 33.5023, lng: -117.0826 } },
      { hole: 4,  par: 4, distance: 385, note: 'Dogleg right',       front: { lat: 33.5032, lng: -117.0838 }, middle: { lat: 33.5031, lng: -117.0838 }, back: { lat: 33.5030, lng: -117.0838 } },
      { hole: 5,  par: 4, distance: 415, note: 'Bunker at 220',      front: { lat: 33.5040, lng: -117.0851 }, middle: { lat: 33.5039, lng: -117.0851 }, back: { lat: 33.5038, lng: -117.0851 } },
      { hole: 6,  par: 3, distance: 190, note: 'Wind factor',        front: { lat: 33.5047, lng: -117.0864 }, middle: { lat: 33.5046, lng: -117.0864 }, back: { lat: 33.5045, lng: -117.0864 } },
      { hole: 7,  par: 5, distance: 545, note: 'Birdie opportunity', front: { lat: 33.5055, lng: -117.0876 }, middle: { lat: 33.5054, lng: -117.0876 }, back: { lat: 33.5053, lng: -117.0876 } },
      { hole: 8,  par: 4, distance: 375, note: 'Tight tee shot',     front: { lat: 33.5062, lng: -117.0889 }, middle: { lat: 33.5061, lng: -117.0889 }, back: { lat: 33.5060, lng: -117.0889 } },
      { hole: 9,  par: 4, distance: 395, note: 'Long par 4',         front: { lat: 33.5070, lng: -117.0902 }, middle: { lat: 33.5069, lng: -117.0902 }, back: { lat: 33.5068, lng: -117.0902 } },
      { hole: 10, par: 4, distance: 410, note: 'Slight uphill',      front: { lat: 33.5077, lng: -117.0915 }, middle: { lat: 33.5076, lng: -117.0915 }, back: { lat: 33.5075, lng: -117.0915 } },
      { hole: 11, par: 3, distance: 155, note: 'Club up into the wind',    front: { lat: 33.5085, lng: -117.0927 }, middle: { lat: 33.5084, lng: -117.0927 }, back: { lat: 33.5083, lng: -117.0927 } },
      { hole: 12, par: 5, distance: 520, note: 'Reachable in 2',     front: { lat: 33.5092, lng: -117.0940 }, middle: { lat: 33.5091, lng: -117.0940 }, back: { lat: 33.5090, lng: -117.0940 } },
      { hole: 13, par: 4, distance: 365, note: 'Water left',         front: { lat: 33.5100, lng: -117.0953 }, middle: { lat: 33.5099, lng: -117.0953 }, back: { lat: 33.5098, lng: -117.0953 } },
      { hole: 14, par: 4, distance: 430, note: 'Hardest hole',       front: { lat: 33.5107, lng: -117.0965 }, middle: { lat: 33.5106, lng: -117.0965 }, back: { lat: 33.5105, lng: -117.0965 } },
      { hole: 15, par: 3, distance: 170, note: 'Over the creek',     front: { lat: 33.5115, lng: -117.0978 }, middle: { lat: 33.5114, lng: -117.0978 }, back: { lat: 33.5113, lng: -117.0978 } },
      { hole: 16, par: 4, distance: 390, note: 'Fairway bunkers',    front: { lat: 33.5122, lng: -117.0991 }, middle: { lat: 33.5121, lng: -117.0991 }, back: { lat: 33.5120, lng: -117.0991 } },
      { hole: 17, par: 5, distance: 560, note: 'Big par 5 finish',   front: { lat: 33.5130, lng: -117.1004 }, middle: { lat: 33.5129, lng: -117.1004 }, back: { lat: 33.5128, lng: -117.1004 } },
      { hole: 18, par: 4, distance: 405, note: 'Home hole',          front: { lat: 33.5137, lng: -117.1016 }, middle: { lat: 33.5136, lng: -117.1016 }, back: { lat: 33.5135, lng: -117.1016 } },
    ],
  },
  {
    name: 'Moreno Valley Ranch',
    slope: 122,
    rating: 70.5,
    holes: [
      { hole: 1,  par: 5, distance: 520, note: 'Wide open par 5',   front: { lat: 33.9250, lng: -117.2200 }, middle: { lat: 33.9249, lng: -117.2200 }, back: { lat: 33.9248, lng: -117.2200 } },
      { hole: 2,  par: 4, distance: 390, note: 'Fairway slopes right', front: { lat: 33.9257, lng: -117.2213 }, middle: { lat: 33.9256, lng: -117.2213 }, back: { lat: 33.9255, lng: -117.2213 } },
      { hole: 3,  par: 3, distance: 155, note: 'Small green',        front: { lat: 33.9265, lng: -117.2226 }, middle: { lat: 33.9264, lng: -117.2226 }, back: { lat: 33.9263, lng: -117.2226 } },
      { hole: 4,  par: 4, distance: 405, note: 'Uphill approach',    front: { lat: 33.9272, lng: -117.2238 }, middle: { lat: 33.9271, lng: -117.2238 }, back: { lat: 33.9270, lng: -117.2238 } },
      { hole: 5,  par: 4, distance: 375, note: 'Dogleg left',        front: { lat: 33.9280, lng: -117.2251 }, middle: { lat: 33.9279, lng: -117.2251 }, back: { lat: 33.9278, lng: -117.2251 } },
      { hole: 6,  par: 3, distance: 185, note: 'Over water',         front: { lat: 33.9287, lng: -117.2264 }, middle: { lat: 33.9286, lng: -117.2264 }, back: { lat: 33.9285, lng: -117.2264 } },
      { hole: 7,  par: 5, distance: 535, note: 'Reachable eagle chance', front: { lat: 33.9295, lng: -117.2277 }, middle: { lat: 33.9294, lng: -117.2277 }, back: { lat: 33.9293, lng: -117.2277 } },
      { hole: 8,  par: 4, distance: 360, note: 'Short par 4',        front: { lat: 33.9302, lng: -117.2289 }, middle: { lat: 33.9301, lng: -117.2289 }, back: { lat: 33.9300, lng: -117.2289 } },
      { hole: 9,  par: 4, distance: 415, note: 'Long uphill',        front: { lat: 33.9310, lng: -117.2302 }, middle: { lat: 33.9309, lng: -117.2302 }, back: { lat: 33.9308, lng: -117.2302 } },
      { hole: 10, par: 4, distance: 380, note: 'Bunker fronts green', front: { lat: 33.9317, lng: -117.2315 }, middle: { lat: 33.9316, lng: -117.2315 }, back: { lat: 33.9315, lng: -117.2315 } },
      { hole: 11, par: 3, distance: 160, note: 'Wind exposed',       front: { lat: 33.9325, lng: -117.2328 }, middle: { lat: 33.9324, lng: -117.2328 }, back: { lat: 33.9323, lng: -117.2328 } },
      { hole: 12, par: 5, distance: 525, note: 'Two-shot par 5',     front: { lat: 33.9332, lng: -117.2340 }, middle: { lat: 33.9331, lng: -117.2340 }, back: { lat: 33.9330, lng: -117.2340 } },
      { hole: 13, par: 4, distance: 395, note: 'Tough driving hole', front: { lat: 33.9340, lng: -117.2353 }, middle: { lat: 33.9339, lng: -117.2353 }, back: { lat: 33.9338, lng: -117.2353 } },
      { hole: 14, par: 4, distance: 370, note: 'Approach over bunker', front: { lat: 33.9347, lng: -117.2366 }, middle: { lat: 33.9346, lng: -117.2366 }, back: { lat: 33.9345, lng: -117.2366 } },
      { hole: 15, par: 3, distance: 140, note: 'Short iron',         front: { lat: 33.9355, lng: -117.2379 }, middle: { lat: 33.9354, lng: -117.2379 }, back: { lat: 33.9353, lng: -117.2379 } },
      { hole: 16, par: 5, distance: 515, note: 'Scoring opportunity', front: { lat: 33.9362, lng: -117.2391 }, middle: { lat: 33.9361, lng: -117.2391 }, back: { lat: 33.9360, lng: -117.2391 } },
      { hole: 17, par: 4, distance: 400, note: 'Signature hole',     front: { lat: 33.9370, lng: -117.2404 }, middle: { lat: 33.9369, lng: -117.2404 }, back: { lat: 33.9368, lng: -117.2404 } },
      { hole: 18, par: 4, distance: 425, note: 'Uphill home hole',   front: { lat: 33.9377, lng: -117.2417 }, middle: { lat: 33.9376, lng: -117.2417 }, back: { lat: 33.9375, lng: -117.2417 } },
    ],
  },
];

const MENIFEE_LAKES = COURSE_DB[0];

const SWING_FIXES: Record<string, { title: string; cause: string; fix: string; drill: string; cue: string; image: number }> = {
  right: {
    title: 'Slice / Miss Right',
    cause: 'Open clubface or outside-in swing path',
    fix: 'Focus on closing the clubface and swinging from the inside',
    drill: 'Place a headcover outside the ball and avoid hitting it',
    cue: "Feel like you're swinging out to right field",
    image: IMG_SWING_FACE_OPEN_CLOSED,
  },
  left: {
    title: 'Pull / Miss Left',
    cause: 'Over-rotation or early release',
    fix: 'Slow down tempo and control release',
    drill: 'Pause at the top of your backswing',
    cue: 'Feel smooth, not fast',
    image: IMG_SWING_PATH_INSIDE_OUT,
  },
  balanced: {
    title: 'Solid Contact',
    cause: 'Consistent path and face angle',
    fix: 'Maintain tempo and stay committed through impact',
    drill: 'Hit 10 shots at 80% speed focusing on center contact',
    cue: 'Trust the process — smooth and through',
    image: IMG_SWING_DRIVER_IMPACT,
  },
};

// -- Sim Engine (isolated, pure functions) -------------------------------------
type SimProfile = {
  missBias: 'left' | 'right' | 'neutral';
  pressureBias: 'left' | 'right' | 'neutral';
  mentalBias: Record<string, 'left' | 'right' | 'straight'>;
  consistency: number;
};
type SimContext = {
  situation: 'normal' | 'pressure';
  mental: string;
  difficulty: 'easy' | 'medium' | 'hard';
  distance: 'short' | 'mid' | 'long';
};
type SimResult = {
  averageScore: number;
  bestScore: number;
  worstScore: number;
  toPar: number;
  missLabel: string;
  pressureLabel: string;
  courseName: string;
  holeCount: number;
  sampleHoles: Array<{ par: number; difficulty: string; score: number; strategy: string }>;
};

type SimCourse = { name: string; difficulty: number };
const SIM_COURSES: Record<string, SimCourse> = {
  easy:     { name: 'Easy Course',       difficulty: 0.85 },
  standard: { name: 'Standard Course',   difficulty: 1.0  },
  hard:     { name: 'Difficult Course',  difficulty: 1.18 },
};

function buildSimProfile(shotList: Shot[]): SimProfile {
  if (shotList.length === 0) {
    return { missBias: 'neutral', pressureBias: 'neutral', mentalBias: {}, consistency: 0.33 };
  }
  const l = shotList.filter((s) => s.result === 'left').length;
  const r = shotList.filter((s) => s.result === 'right').length;
  const st = shotList.filter((s) => s.result === 'straight').length;
  const total = shotList.length;
  let missBias: SimProfile['missBias'] = 'neutral';
  if (r > l && r > st) missBias = 'right';
  else if (l > r && l > st) missBias = 'left';

  const pressure = shotList.filter((s) => s.situation === 'pressure' || shotList.indexOf(s) >= total - 3);
  const pl = pressure.filter((s) => s.result === 'left').length;
  const pr = pressure.filter((s) => s.result === 'right').length;
  let pressureBias: SimProfile['pressureBias'] = 'neutral';
  if (pr > pl) pressureBias = 'right';
  else if (pl > pr) pressureBias = 'left';

  const mentalBias: Record<string, 'left' | 'right' | 'straight'> = {};
  const groups: Record<string, { left: number; right: number; straight: number }> = {};
  shotList.forEach((s) => {
    const m = s.mental || 'unknown';
    if (!groups[m]) groups[m] = { left: 0, right: 0, straight: 0 };
    groups[m][s.result as 'left' | 'right' | 'straight']++;
  });
  Object.keys(groups).forEach((m) => {
    const g = groups[m];
    if (g.right >= g.left && g.right >= g.straight) mentalBias[m] = 'right';
    else if (g.left >= g.right && g.left >= g.straight) mentalBias[m] = 'left';
    else mentalBias[m] = 'straight';
  });

  return { missBias, pressureBias, mentalBias, consistency: st / total };
}

function getSimProbabilities(profile: SimProfile, ctx: SimContext): { left: number; right: number; straight: number } {
  let s = 0.33, left = 0.335, right = 0.335;
  if (profile.missBias === 'right') { right += 0.1; s -= 0.05; left -= 0.05; }
  else if (profile.missBias === 'left') { left += 0.1; s -= 0.05; right -= 0.05; }
  if (ctx.situation === 'pressure') {
    if (profile.pressureBias === 'right') { right += 0.08; s -= 0.04; left -= 0.04; }
    else if (profile.pressureBias === 'left') { left += 0.08; s -= 0.04; right -= 0.04; }
  }
  const mentalTend = profile.mentalBias[ctx.mental];
  if (mentalTend === 'right') { right += 0.06; s -= 0.03; left -= 0.03; }
  else if (mentalTend === 'left') { left += 0.06; s -= 0.03; right -= 0.03; }
  else if (mentalTend === 'straight') { s += 0.06; left -= 0.03; right -= 0.03; }
  if (ctx.difficulty === 'easy') { s += 0.1; left -= 0.05; right -= 0.05; }
  else if (ctx.difficulty === 'hard') { s -= 0.1; left += 0.05; right += 0.05; }
  if (ctx.distance === 'long') { left += 0.04; right += 0.04; s -= 0.08; }
  else if (ctx.distance === 'short') { s += 0.06; left -= 0.03; right -= 0.03; }
  const total = s + left + right;
  return { straight: s / total, left: left / total, right: right / total };
}

function simShot(profile: SimProfile, ctx: SimContext): 'left' | 'right' | 'straight' {
  const p = getSimProbabilities(profile, ctx);
  const r = Math.random();
  if (r < p.straight) return 'straight';
  if (r < p.straight + p.left) return 'left';
  return 'right';
}

function generateSimHole(): { par: 3 | 4 | 5; difficulty: SimContext['difficulty'] } {
  const p = Math.random();
  const par: 3 | 4 | 5 = p < 0.2 ? 3 : p < 0.8 ? 4 : 5;
  const d = Math.random();
  const difficulty: SimContext['difficulty'] = d < 0.3 ? 'easy' : d < 0.8 ? 'medium' : 'hard';
  return { par, difficulty };
}

function getSimStrategy(profile: SimProfile, hole: { difficulty: SimContext['difficulty'] }): 'safe' | 'normal' | 'aggressive' {
  if (hole.difficulty === 'hard' || profile.consistency < 0.5) return 'safe';
  if (profile.consistency >= 0.7 && hole.difficulty === 'easy' && Math.random() < 0.3) return 'aggressive';
  return 'normal';
}

function simHole(profile: SimProfile, course: SimCourse): { score: number; par: number; difficulty: string; strategy: string; stats: { left: number; right: number; straight: number } } {
  const hole = generateSimHole();
  const strategy = getSimStrategy(profile, hole);
  // Shot count by par
  const baseShots = hole.par === 3 ? (1 + Math.floor(Math.random() * 2))
    : hole.par === 4 ? (2 + Math.floor(Math.random() * 2))
    : (3 + Math.floor(Math.random() * 2));
  const stats = { left: 0, right: 0, straight: 0 };
  const distances: SimContext['distance'][] = ['long', ...Array(Math.max(baseShots - 2, 0)).fill('mid'), 'short'];
  for (let i = 0; i < baseShots; i++) {
    const situation: SimContext['situation'] = i >= baseShots - 2 ? 'pressure' : 'normal';
    const baseCtx: SimContext = { situation, mental: 'smooth', difficulty: hole.difficulty, distance: distances[i] ?? 'mid' };
    // Apply strategy modifier to straight probability inline
    let result = simShot(profile, baseCtx);
    if (strategy === 'safe' && result !== 'straight' && Math.random() < 0.15) result = 'straight';
    if (strategy === 'aggressive' && result === 'straight' && Math.random() < 0.1) result = Math.random() < 0.5 ? 'left' : 'right';
    stats[result]++;
  }
  const misses = stats.left + stats.right;
  // Par-relative scoring
  let score: number;
  if (hole.par === 3) {
    score = stats.straight >= baseShots - 1 ? 2 + Math.floor(Math.random() * 2)
      : misses >= 2 ? 5
      : 4;
  } else if (hole.par === 4) {
    if (stats.straight >= baseShots - 1) score = 4;
    else if (misses >= 2) score = 5 + Math.min(misses - 1, 2);
    else score = 5;
  } else { // par 5
    if (strategy === 'aggressive' && stats.straight >= baseShots - 1) score = 4;
    else if (stats.straight >= baseShots - 1) score = 5;
    else score = Math.min(5 + misses, 7);
  }
  // Consistency variance
  const variance = profile.consistency >= 0.7 ? 0 : profile.consistency < 0.5 ? (Math.random() < 0.3 ? 1 : 0) : 0;
  score = Math.round((score + variance) * course.difficulty);
  return { score, par: hole.par, difficulty: hole.difficulty, strategy, stats };
}

function simRound(profile: SimProfile, course: SimCourse, holeCount = 18): { score: number; toPar: number; stats: { left: number; right: number; straight: number }; holes: Array<{ par: number; difficulty: string; score: number; strategy: string }> } {
  let totalScore = 0;
  let totalPar = 0;
  const agg = { left: 0, right: 0, straight: 0 };
  const holes: Array<{ par: number; difficulty: string; score: number; strategy: string }> = [];
  for (let h = 0; h < holeCount; h++) {
    const hole = simHole(profile, course);
    totalScore += hole.score;
    totalPar += hole.par;
    agg.left += hole.stats.left; agg.right += hole.stats.right; agg.straight += hole.stats.straight;
    holes.push({ par: hole.par, difficulty: hole.difficulty, score: hole.score, strategy: hole.strategy });
  }
  return { score: totalScore, toPar: totalScore - totalPar, stats: agg, holes };
}

function runSimRounds(profile: SimProfile, count = 15, course: SimCourse = SIM_COURSES.standard, holeCount = 18): SimResult {
  let totalScore = 0;
  let totalToPar = 0;
  let bestScore = Infinity;
  let worstScore = -Infinity;
  const agg = { left: 0, right: 0, straight: 0 };
  let lastHoles: SimResult['sampleHoles'] = [];
  for (let i = 0; i < count; i++) {
    const r = simRound(profile, course, holeCount);
    totalScore += r.score;
    totalToPar += r.toPar;
    if (r.score < bestScore) { bestScore = r.score; lastHoles = r.holes.filter((h) => h.difficulty === 'hard').slice(0, 2); }
    if (r.score > worstScore) worstScore = r.score;
    agg.left += r.stats.left; agg.right += r.stats.right; agg.straight += r.stats.straight;
  }
  const avg = Math.round(totalScore / count);
  const avgToPar = Math.round(totalToPar / count);
  const missLabel = agg.right > agg.left && agg.right > agg.straight ? 'Mostly right'
    : agg.left > agg.right && agg.left > agg.straight ? 'Mostly left'
    : 'Neutral';
  const pressureBias = profile.pressureBias;
  const pressureLabel = pressureBias === 'right' ? 'Right under pressure'
    : pressureBias === 'left' ? 'Left under pressure'
    : 'Steady under pressure';
  return { averageScore: avg, bestScore, worstScore, toPar: avgToPar, missLabel, pressureLabel, courseName: course.name, holeCount, sampleHoles: lastHoles };
}

// -- Pre-Round & Live Intelligence (isolated) ----------------------------------
type GamePlan = { strategy: string; focus: string; warning: string };
type LiveInsights = { trend: 'improving' | 'struggling' | 'neutral'; streak: 'right' | 'left' | null; pressure: boolean };

function generateGamePlan(profile: SimProfile, sim: SimResult | null): GamePlan {
  const strategy = profile.pressureBias !== 'neutral' || profile.consistency < 0.5
    ? 'Play safe on hard holes'
    : profile.consistency >= 0.7
    ? 'Be aggressive — you\'re consistent today'
    : 'Stay patient and pick your spots';

  const worstMental = Object.entries(profile.mentalBias)
    .find(([, v]) => v !== 'straight')?.[0];
  const focus = worstMental
    ? `Avoid rushing — your ${worstMental} tempo causes misses`
    : 'Commit to smooth tempo on every shot';

  const warning = profile.pressureBias === 'right' ? 'You tend to miss right under pressure'
    : profile.pressureBias === 'left'  ? 'You tend to miss left under pressure'
    : profile.missBias === 'right'     ? 'Watch the right miss — aim a touch left'
    : profile.missBias === 'left'      ? 'Watch the left miss — stay centered'
    : sim ? `Sim avg: ${sim.averageScore} — stay within yourself`
    : 'Trust your swing';
  return { strategy, focus, warning };
}

function getLiveInsights(shotList: Shot[], holeCount = 18): LiveInsights {
  if (shotList.length === 0) return { trend: 'neutral', streak: null, pressure: false };
  const last3 = shotList.slice(-3);
  const straights = last3.filter((s) => s.result === 'straight').length;
  const misses   = last3.filter((s) => s.result !== 'straight').length;
  const trend = straights >= 2 ? 'improving' : misses >= 2 ? 'struggling' : 'neutral';
  const last2 = shotList.slice(-2);
  const streak: 'right' | 'left' | null =
    last2.length === 2 && last2[0].result === last2[1].result && last2[0].result !== 'straight'
      ? (last2[0].result as 'right' | 'left')
      : null;
  const pressureThreshold = holeCount === 9 ? 4 : 6;
  const pressure = shotList.length >= pressureThreshold;
  return { trend, streak, pressure };
}
// -----------------------------------------------------------------------------

// Default amateur carry distances (yards) — used when the player has no
// personal history yet for a club.  Ordered longest ? shortest.
const DEFAULT_CLUB_YARDS: [string, number][] = [
  ['Driver',  230],
  ['3 Wood',  215],
  ['5 Wood',  200],
  ['3 Iron',  185],
  ['4 Iron',  175],
  ['5 Iron',  165],
  ['6 Iron',  155],
  ['7 Iron',  145],
  ['8 Iron',  135],
  ['9 Iron',  125],
  ['PW',      115],
  ['GW',      100],
  ['SW',       85],
  ['LW',       70],
  ['Putter',   10],
];

// ─── AimLine ─────────────────────────────────────────────────────────────────
// Draws the aim-assist line overlay inside the fullscreen camera modal.
//   screenOffset  — horizontal pixel offset applied to the vertical aim line
//                   (negative = left, positive = right, 0 = center)
//   lineColor     — stroke colour (reflects CaddieMemory bias)
//   target        — locked tap target { x, y } or null
function AimLine({
  screenOffset,
  lineColor,
  target,
}: {
  screenOffset: number;
  lineColor: string;
  target: { x: number; y: number } | null;
}) {
  const { width, height } = useWindowDimensions();
  const cx = width / 2 + screenOffset;  // horizontal centre of aim line

  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFillObject}
      pointerEvents="none"
    >
      {/* Vertical aim line — full screen height, dashed when target locked */}
      <SvgLine
        x1={cx} y1={height}
        x2={cx} y2={0}
        stroke={lineColor}
        strokeWidth={2}
        strokeDasharray={target ? '10 8' : undefined}
        opacity={0.65}
      />

      {/* Line from bottom-center to locked target */}
      {target && (
        <SvgLine
          x1={cx}      y1={height}
          x2={target.x} y2={target.y}
          stroke={lineColor}
          strokeWidth={2.5}
          opacity={0.9}
        />
      )}

      {/* Target crosshair ring */}
      {target && (
        <>
          <SvgCircle
            cx={target.x} cy={target.y}
            r={14}
            stroke={lineColor}
            strokeWidth={2}
            fill="transparent"
            opacity={0.9}
          />
          <SvgLine
            x1={target.x - 20} y1={target.y}
            x2={target.x + 20} y2={target.y}
            stroke={lineColor} strokeWidth={1.5} opacity={0.8}
          />
          <SvgLine
            x1={target.x} y1={target.y - 20}
            x2={target.x} y2={target.y + 20}
            stroke={lineColor} strokeWidth={1.5} opacity={0.8}
          />
        </>
      )}
    </Svg>
  );
}

export default function PlayScreenClean() {
  const [mentalState, setMentalState] = useState('neutral');
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [simCourse, setSimCourse] = useState<keyof typeof SIM_COURSES>('standard');
  const [roundLength, setRoundLength] = useState<9 | 18>(18);
  const [gamePlan, setGamePlan] = useState<GamePlan | null>(null);
  const club = useRoundStore((s) => s.club);
  const setClub = useRoundStore((s) => s.setClub);
  const targetDistance = useRoundStore((s) => s.targetDistance);
  const setTargetDistance = useRoundStore((s) => s.setTargetDistance);
  const setCurrentHole = useRoundStore((s) => s.setCurrentHole);
  const shots = useRoundStore((s) => s.shots);
  const addShot = useRoundStore((s) => s.addShot);
  const shotResult = useRoundStore((s) => s.shotResult);
  const aim = useRoundStore((s) => s.aim);
  const storeSetAim = useRoundStore((s) => s.setAim);

  // ── Safe fallback constants — always usable, never undefined ─────────
  // Prefer live store values; fall back to sensible mid-iron defaults so
  // every downstream function receives a valid value on first render and
  // during store hydration.
  const safeClub     = club     || '7i';
  const safeAim      = aim      || 'center';
  const clearRound = useRoundStore((s) => s.clearRound);
  const setActiveCourse = useRoundStore((s) => s.setActiveCourse);
  const [distance, setDistance] = useState('150');
  const [hole, setHole] = useState(1);
  const [isOnline, setIsOnline] = useState(true);
  const [par, setPar] = useState(4);
  const [strokes, setStrokes] = useState(0);
  const [round, setRound] = useState<number[]>([]);
  const [roundPars, setRoundPars] = useState<number[]>([]);
  const registeredName = useUserStore((s) => s.name);
  const setName = useUserStore((s) => s.setName);
  const handicapIndex = useUserStore((s) => s.handicap);
  const setHandicap = useUserStore((s) => s.setHandicap);
  const setIsGuest = useUserStore((s) => s.setIsGuest);

  // Persisted player profile (survives restarts)
  const ppMiss       = usePlayerProfileStore((s) => s.typicalMiss);
  const ppStruggle   = usePlayerProfileStore((s) => s.biggestStruggle);
  const ppStrength   = usePlayerProfileStore((s) => s.bigStrength);
  const ppLimitation = usePlayerProfileStore((s) => s.physicalLimitation);
  const ppComplete   = usePlayerProfileStore((s) => s.profileComplete);
  const ppCoachingStyle = usePlayerProfileStore((s) => s.coachingStyle);

  // CaddieMemory — player tendencies derived from practice sessions
  const cmMissBias       = useCaddieMemory((s) => s.missBias);
  const cmConfidence     = useCaddieMemory((s) => s.confidence);
  const cmUpdated        = useCaddieMemory((s) => s.lastUpdated);
  const cmSwingPath      = useCaddieMemory((s) => s.swingPath);
  const cmFaceAngle      = useCaddieMemory((s) => s.faceAngle);
  const cmBallStartBias  = useCaddieMemory((s) => s.ballStartBias);
  const cmShotShapeTrend = useCaddieMemory((s) => s.shotShapeTrend);
  const [loading, setLoading] = useState(false);
  const [lastInsight, setLastInsight] = useState<string | null>(null);
  const [milestoneMessage, setMilestoneMessage] = useState<string | null>(null);
  const milestoneShotRef = useRef<number>(0); // last shot count that triggered a milestone
  const [roundSummary, setRoundSummary] = useState<{ totalShots: number; bias: string | null; biasConfidence: number | null; keyMessage: string } | null>(null);
  const lastConfidenceBoostRef = useRef<number>(0);
  const pressureInsightShotRef = useRef<number>(0); // shot count at last pressure-voice trigger
  const mentalInsightShotRef = useRef<number>(0);   // shot count at last mental/trend voice trigger
  const previousPatternRef = useRef<string | null>(null); // tracks missBias for pattern-interrupt moment
  const lastPreShotRef = useRef('');
  const [caddieMessage, setCaddieMessage] = useState('');
  const [confidence, setConfidence] = useState(50);
  const [currentRound, setCurrentRound] = useState<Shot[]>([]);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [savedRounds, setSavedRounds] = useState<Array<{ date: string; shots: Shot[] }>>([]);
  const [longTermPattern, setLongTermPattern] = useState<'push' | 'pull' | 'neutral' | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [quietMode, setQuietMode] = useState(false);
  const lastSpokenRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const [lastSpokenTime, setLastSpokenTime] = useState(0); // kept for any read-only display consumers
  const [quickMode, setQuickMode] = useState(false);
  const [lastShotTime, setLastShotTime] = useState(0);
  // Increments each time a shot is recorded — drives post-shot decision refresh.
  const [lastShotEpoch, setLastShotEpoch] = useState(0);
  const [shotTarget, setShotTarget] = useState<'left' | 'center' | 'right'>('center');
  const [pocketMode, setPocketMode] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [localGender, setLocalGender] = useState<'male' | 'female'>('male');
  const [voiceStyle, setVoiceStyle] = useState<'calm' | 'aggressive'>('calm');

  // Sync persisted settings into local state on first render
  const _settings = useSettingsStore.getState();
  const [_settingsSynced] = useState(() => {
    // Runs once synchronously before first render
    return {
      voiceEnabled:  _settings.voiceEnabled,
      localGender:   _settings.voiceGender,
      voiceStyle:    _settings.voiceStyle,
      goalMode:      _settings.playerMode,
      strategyMode:  _settings.riskDefault,
      highContrast:  _settings.highContrast,
    };
  });
  // Override the initial useState values with persisted settings
  // This is done via a ref-gate so it only fires once after hydration.
  const _settingAppliedRef = useRef(false);
  useEffect(() => {
    if (_settingAppliedRef.current) return;
    _settingAppliedRef.current = true;
    const s = useSettingsStore.getState();
    setVoiceEnabled(s.voiceEnabled);
    setLocalGender(s.voiceGender);
    setVoiceStyle(s.voiceStyle);
    setGoalMode(s.playerMode);
    setStrategyMode(s.riskDefault);
    setHighContrast(s.highContrast);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync-back: write setting changes back to the persisted store
  useEffect(() => { useSettingsStore.getState().setVoiceEnabled(voiceEnabled); }, [voiceEnabled]);
  useEffect(() => { useSettingsStore.getState().setVoiceStyle(voiceStyle); }, [voiceStyle]);
  useEffect(() => { useSettingsStore.getState().setVoiceGender(localGender); }, [localGender]);

  // Focus Mode+ state (additive — no existing logic affected)
  const [focusMode, setFocusMode] = useState(false);
  const [focusMessage, setFocusMessage] = useState('');
  const [lastQuickReply, setLastQuickReply] = useState('');
  const [priorityFlag, setPriorityFlag] = useState<'low' | 'urgent' | null>(null);
  const [lastResetTime, setLastResetTime] = useState(0);
  const [lastVoiceTime, setLastVoiceTime] = useState(0);
  const FOCUS_MESSAGES = [
    'Pick the target. Trust it.',
    'One shot. Fully committed.',
    'Smooth swing. No rush.',
    'See it. Hit it.',
    'Tempo first. Everything follows.',
    'Quiet mind. Clear target.',
    'Commit and swing through.',
    'Breathe. Aim small. Miss small.',
    'Stay through the shot.',
    'Full finish. Every time.',
  ];
  const [swingThought, setSwingThought] = useState(FOCUS_MESSAGES[0]);
  const QUICK_REPLIES = [
    'In a round — will respond after',
    "Can't talk right now, call if urgent",
    'Give me 30 min',
    'On the course — text if urgent',
  ];
  const [players, setPlayers] = useState(() => [registeredName || 'You', 'Player 2', 'Player 3', 'Player 4']);
  const [activePlayerCount, setActivePlayerCount] = useState(1);
  const [multiRound, setMultiRound] = useState<Array<{ hole: number; par: number; scores: number[] }>>([]);
  const [skins, setSkins] = useState<number[]>([0, 0, 0, 0]);
  const [caddieMode, setCaddieMode] = useState(0);
  const [strategyMode, setStrategyMode] = useState<'safe' | 'neutral' | 'attack'>('neutral');
  const [goalMode, setGoalMode] = useState<'beginner' | 'break90' | 'break80'>('beginner');
  const goalColor = goalMode === 'beginner' ? '#66bb6a' : goalMode === 'break90' ? '#2196f3' : '#f59e0b';

  /**
   * PLAYER_MODE_CONFIG — per-mode defaults for aggressiveness and messaging prefix.
   * aggressiveness: how willingly the strategy engine recommends attacking.
   * label: display name for UI.
   * riskBias: feeds getStrategy() risk engine.
   */
  const PLAYER_MODE_CONFIG = {
    beginner:  { label: 'Beginner',  riskBias: 'safe',    color: '#66bb6a', emoji: '🌱' },
    break90:   { label: 'Break 90',  riskBias: 'neutral', color: '#2196f3', emoji: '🎯' },
    break80:   { label: 'Break 80',  riskBias: 'attack',  color: '#f59e0b', emoji: '🔥' },
  } as const;
  const [quickCommand, setQuickCommand] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [commandResponse, setCommandResponse] = useState('');
  const [selectedCourseIdx, setSelectedCourseIdx] = useState(0);
  // Calibrated green positions — user walks to each green and presses "Set Green".
  // Persisted to AsyncStorage so calibrations survive app restarts.
  const [calibratedGreens, setCalibratedGreens] = useState<Record<string, { lat: number; lng: number }>>({});
  const [showCourseSelect, setShowCourseSelect] = useState(false);
  const [showQuickCommands, setShowQuickCommands] = useState(false);
  const [showClubStrip, setShowClubStrip] = useState(false);
  const activeCourse = COURSE_DB[selectedCourseIdx] ?? COURSE_DB[0];
  const currentHoleData = activeCourse.holes[Math.min(hole - 1, activeCourse.holes.length - 1)];
  const courseSlope = activeCourse.slope;
  const courseRating = activeCourse.rating;
  // Safe aliases — guards against undefined Zustand slices during first render
  const safeShots = shots ?? [];
  const safeMultiRound = multiRound ?? [];

  /** Persisted setMultiRound — writes through to AsyncStorage so scores survive crashes. */
  const setMultiRoundPersisted = (
    updater: Array<{ hole: number; par: number; scores: number[] }> |
             ((prev: Array<{ hole: number; par: number; scores: number[] }>) => Array<{ hole: number; par: number; scores: number[] }>)
  ) => {
    setMultiRound((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      AsyncStorage.setItem('draftMultiRound', JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  // Swing Camera
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [aimMode, setAimMode] = useState(false);
  const [aimTarget, setAimTarget] = useState<{ x: number; y: number } | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [autoRecording, setAutoRecording] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const videoRef = useRef<InstanceType<typeof Video>>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  type SwingAnalysis = {
    path: 'inside-out' | 'outside-in' | 'on-plane';
    face: 'open' | 'square' | 'closed';
    tempo: 'smooth' | 'fast' | 'slow';
    plane: 'steep' | 'flat' | 'ideal';
    peakG: number;
    duration: number;
    missDir: 'right' | 'left' | 'straight';
    pathDeg: number;
    faceDeg: number;
    speedEst: string;
    // IMU rotation metrics (gyroscope)
    wristRotation: 'early' | 'normal' | 'late';
    bodyRotation: 'restricted' | 'good' | 'over';
    rotScore: number;  // 0—100, higher = better rotation sequence
    summary: string;
    cues: string[];
  };

  const [savedSwings, setSavedSwings] = useState<{ uri: string; time: string; result: string; tempo: string; analysis?: SwingAnalysis }[]>([]);
  const [coachingSwing, setCoachingSwing] = useState<{ uri: string; time: string; result: string; tempo: string; analysis?: SwingAnalysis } | null>(null);
  const [expandedAnalysis, setExpandedAnalysis] = useState<number | null>(null);
  const [lastSwingAnalysis, setLastSwingAnalysis] = useState<SwingAnalysis | null>(null);

  // Accel + Gyro capture during recording
  const recordingAccelRef     = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);
  const recordingGyroRef      = useRef<ReturnType<typeof Gyroscope.addListener> | null>(null);
  const recordingPeakGRef     = useRef(0);
  const recordingPeakXRef     = useRef(0);
  const recordingPeakZRef     = useRef(0);
  const recordingPeakRotYRef  = useRef(0);  // forearm roll (wrist release)
  const recordingPeakRotZRef  = useRef(0);  // body yaw (hip/shoulder turn)
  const recordingStartRef     = useRef(0);
  const recordingDurationRef  = useRef(0);

  const generateSwingAnalysis = (result: string, tempo: string): SwingAnalysis => {
    const peakG    = recordingPeakGRef.current;
    const peakX    = recordingPeakXRef.current;   // lateral deviation ? path
    const peakZ    = recordingPeakZRef.current;   // vertical ? plane
    const peakRotY = recordingPeakRotYRef.current; // forearm roll (rad/s) ? wrist release
    const peakRotZ = recordingPeakRotZRef.current; // body yaw (rad/s) ? hip/shoulder turn
    const duration = recordingDurationRef.current;

    // Path: inferred from lateral accel (x-axis) relative to forward swing (y-axis)
    const path: SwingAnalysis['path'] = peakX > 0.35 ? 'outside-in' : peakX < -0.25 ? 'inside-out' : 'on-plane';
    const pathDeg = Math.round(peakX * 12);

    // Face: inferred from shot result + path combination
    const face: SwingAnalysis['face'] =
      result === 'right' ? (path === 'outside-in' ? 'open' : 'open') :
      result === 'left' ? (path === 'inside-out' ? 'closed' : 'closed') : 'square';
    const faceDeg = result === 'right' ? Math.round(peakX * 8 + 4) : result === 'left' ? -Math.round(peakX * 8 + 4) : 0;

    // Plane: z-axis shows upright vs flat
    const plane: SwingAnalysis['plane'] = peakZ > 1.4 ? 'steep' : peakZ < 0.7 ? 'flat' : 'ideal';

    // Tempo
    const tempoLabel: SwingAnalysis['tempo'] = tempo.includes('fast') ? 'fast' : tempo.includes('slow') ? 'slow' : 'smooth';

    // Speed estimate from peak G
    const speedEst = peakG > 2.5 ? 'High' : peakG > 1.6 ? 'Medium' : 'Low';

    // -- Gyroscope-derived metrics ------------------------------------------
    // peakRotY (forearm roll): high = fast release / flip, low = lag preserved
    //   > 4.0 rad/s = early flip,  1.5—4.0 = normal release,  < 1.5 = late/held
    const wristRotation: SwingAnalysis['wristRotation'] =
      Math.abs(peakRotY) > 4.0 ? 'early' :
      Math.abs(peakRotY) > 1.5 ? 'normal' : 'late';

    // peakRotZ (body yaw): higher = more hip/shoulder turn
    //   > 3.5 rad/s = over-rotation,  1.5—3.5 = good turn,  < 1.5 = restricted
    const bodyRotation: SwingAnalysis['bodyRotation'] =
      Math.abs(peakRotZ) > 3.5 ? 'over' :
      Math.abs(peakRotZ) > 1.5 ? 'good' : 'restricted';

    // Rotation score: rewards good body turn + normal wrist release (0—100)
    const bodyScore  = bodyRotation === 'good' ? 40 : bodyRotation === 'over' ? 20 : 10;
    const wristScore = wristRotation === 'normal' ? 35 : wristRotation === 'late' ? 20 : 15;
    const tempoScore = tempoLabel === 'smooth' ? 25 : 10;
    const rotScore   = Math.min(100, bodyScore + wristScore + tempoScore);

    // Cues — accelerometer-based
    const cues: string[] = [];
    if (path === 'outside-in') cues.push('Swing from the inside — feel the club drop into the slot at the top');
    else if (path === 'inside-out') cues.push('Quiet your hands — prevent the face from rolling over');
    else cues.push('Path is on plane — focus on a consistent tempo');
    if (face === 'open') cues.push('Rotate the forearm through impact to square the face');
    else if (face === 'closed') cues.push('Hold off the release slightly — delay the forearm rotation');
    if (plane === 'steep') cues.push('Shallow the club on the downswing — feel a flatter elbow plane');
    else if (plane === 'flat') cues.push('Get more shoulder tilt — avoid a too-flat swing plane');
    if (tempoLabel === 'fast') cues.push('Slow your transition — pause at the top for one beat');
    else if (tempoLabel === 'slow') cues.push('Commit through the ball — stay fluid, not tentative');
    // Gyro-based cues
    if (wristRotation === 'early') cues.push('Forearms are firing too early — hold lag longer into the hitting zone');
    else if (wristRotation === 'late') cues.push('Release is a bit passive — let the forearms roll through more freely');
    if (bodyRotation === 'restricted') cues.push('Hips and shoulders are restricting — feel a full pivot through the ball');
    else if (bodyRotation === 'over') cues.push('Body is spinning out — let the arms catch up before firing the hips');

    // Summary
    const pathLabel = path === 'outside-in' ? 'outside-in' : path === 'inside-out' ? 'inside-out' : 'on-plane';
    const rotLabel  = `${wristRotation} release, ${bodyRotation} body turn`;
    const summary   = `${pathLabel.charAt(0).toUpperCase() + pathLabel.slice(1)} path, ${face} face, ${tempoLabel} tempo. ${plane === 'ideal' ? 'Swing plane solid.' : `Plane ${plane}.`} ${speedEst} speed. ${rotLabel}.`;

    return { path, face, tempo: tempoLabel, plane, peakG: Math.round(peakG * 10) / 10, duration, missDir: result as any, pathDeg, faceDeg, speedEst, wristRotation, bodyRotation, rotScore, summary, cues };
  };

  // Conversational single-line feedback spoken after each recording
  const buildFeedbackLine = (a: SwingAnalysis): string => {
    if (a.tempo === 'fast') return "Tempo was a bit quick — let's smooth that out.";
    if (a.tempo === 'slow') return 'Tempo was a touch slow — stay committed through the ball.';
    if (a.peakG > 3.0) return 'Balance got a little unstable — try to stay centered through impact.';
    if (a.path === 'outside-in') return "Swing path came a little outside-in — let's shallow it on the way down.";
    if (a.path === 'inside-out') return 'Nice in-to-out path. Keep that forearm rotation through impact.';
    if (a.plane === 'steep') return 'Swing got a little steep — focus on a flatter elbow slot.';
    if (a.plane === 'flat') return 'Swing plane ran a touch flat — get some more shoulder tilt at address.';
    return 'Smooth swing. Tempo and path look solid.';
  };

  const [watchMode, setWatchMode] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // Load stored rounds on mount
  useEffect(() => {
    const loadRounds = async () => {
      try {
        const stored = await AsyncStorage.getItem('rounds');
        if (stored) {
          const parsedData = JSON.parse(stored);
          setSavedRounds(parsedData);
          setLongTermPattern(analyzeLongTermPatterns(parsedData));
        }
      } catch (e) {
        console.log('Error loading rounds:', e);
      }
    };
    loadRounds();
  }, []);

  // Read pending sync count from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem('offlineRounds').then((stored) => {
      if (stored) {
        try { setPendingSyncCount((JSON.parse(stored) as any[]).length); } catch { /* ignore */ }
      }
    });
  }, []);

  // Network status — instant via NetInfo subscription (replaces 10s poll)
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable));
    });
    // Fetch current state immediately
    NetInfo.fetch().then((state) => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable));
    });
    return () => unsub();
  }, []);

  // Real-time user profile sync + draft round restore on mount
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    let unsub: (() => void) | undefined;
    if (uid) {
      unsub = onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (typeof data.name === 'string') setName(data.name);
            if (typeof data.handicap === 'number') setHandicap(data.handicap);
          }
        },
        () => { /* snapshot error — profile stays as-is */ }
      );
    }
    // Restore draft shots saved from a previous session
    AsyncStorage.getItem('draftShots').then((stored) => {
      if (stored) {
        try {
          const draft: Shot[] = JSON.parse(stored);
          draft.forEach((s) => addShot(s));
        } catch {
          // corrupted draft — ignore
        }
      }
    });
    // Restore per-hole scores (multiRound) saved mid-round
    AsyncStorage.getItem('draftMultiRound').then((stored) => {
      if (stored) {
        try {
          const draft: Array<{ hole: number; par: number; scores: number[] }> = JSON.parse(stored);
          if (draft.length > 0) setMultiRound(draft);
        } catch {
          // corrupted draft — ignore
        }
      }
    }).finally(() => setLoading(false));
    return () => unsub?.();
  }, [addShot, setHandicap, setMultiRound, setName]);

  // Sync active course name into store whenever the selection changes
  useEffect(() => {
    setActiveCourse(activeCourse.name);
  }, [activeCourse.name, setActiveCourse]);

  // Keep stale-closure refs in sync with state so the GPS watcher callback
  // always computes yardages for the CURRENT hole, not the hole at mount time.
  useEffect(() => {
    holeRef.current = hole;
    // Reset GPS baseline on hole change so the first reading of the new hole
    // always passes the jump-clamp filter regardless of how far the green moved.
    gpsYardsRef.current = null;
  }, [hole]);
  useEffect(() => { selectedCourseIdxRef.current = selectedCourseIdx; }, [selectedCourseIdx]);

  // Milestone triggers — fire exactly once at 5 shots and 10 shots
  useEffect(() => {
    const n = shots.length;
    if (n < 5 || n === milestoneShotRef.current) return;
    if (n === 5) {
      const mb = getMissBias();
      const biasLine = mb && mb.bias !== 'straight'
        ? ` You're trending ${mb.bias} — caddie is adjusting.`
        : ' Ball flight looks neutral so far.';
      const msg = `First insight unlocked!${biasLine}`;
      setMilestoneMessage(msg);
      milestoneShotRef.current = n;
      if (isRoundActive) { stopSpeaking(); void playElevenLabsAudio(msg); }
    } else if (n === 10) {
      const mb = getMissBias();
      const patternLine = mb
        ? (mb.bias === 'right'
            ? `Strong right miss pattern (${mb.confidence}% confidence). Aim well left.`
            : mb.bias === 'left'
            ? `Strong left miss pattern (${mb.confidence}% confidence). Aim well right.`
            : `Consistent straight ball flight (${mb.confidence}% confidence). Trust it.`)
        : 'Pattern building — keep swinging.';
      const msg = `10 shots in. ${patternLine}`;
      setMilestoneMessage(msg);
      milestoneShotRef.current = n;
      if (isRoundActive) { stopSpeaking(); void playElevenLabsAudio(msg); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots.length]);

  // Auto-voice: speak club + aim when hole changes (new hole = new decision)
  useEffect(() => {
    if (!isRoundActive) return;
    // Prefix with hole number, then canonical decision phrase
    const d = getCaddieDecision();
    const yards = d.distance;
    // Append CaddieMemory tip when practice data is strong enough and no live
    // in-round bias has formed yet (avoids duplicating the aim offset text).
    const cmTip = (() => {
      if (cmMissBias === 'neutral' || cmConfidence < 30 || cmUpdated === 0) return '';
      if (getMissBias() !== null) return ''; // live bias already in the main text
      return cmMissBias === 'right'
        ? "You've been missing right. Let's aim slightly left here."
        : "You've been missing left. Let's aim slightly right here.";
    })();
    const text = [
      `Hole ${hole}.`,
      yards ? `${yards} yards.` : '',
      d.club === '—' ? 'Select a club.' : `${d.club}.`,
      `Aim ${d.aimLabel}.`,
      d.miss,
      cmTip,
    ].filter(Boolean).join(' ');
    void speak(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole]);

  // Post-shot decision refresh — fires after the coaching chain settles (~5.5 s).
  // UI already updates immediately (getCaddieDecision re-runs on every render via
  // reactive Zustand shots state). This effect adds:
  //   1. Voice: speaks the updated aim/club for the NEXT shot.
  //   2. Subtle insight: if bias is directional, updates caddieMessage with new aim.
  // React 18 batches addShot + setLastShotEpoch → closure captures updated shots.
  useEffect(() => {
    if (lastShotEpoch === 0) return; // skip mount
    const delay = activityLevelRef.current === 'active'
      ? ANALYTICS_DELAY_ACTIVE_MS
      : ANALYTICS_DELAY_IDLE_MS;
    const t = setTimeout(() => {
      const d = getCaddieDecision();
      // Subtle insight: caddieMessage update only when bias is directional (non-neutral)
      if (d.aim !== 'center') {
        setCaddieMessage(`Next shot: ${d.aimLabel}. ${d.miss}`);
      }
      // speak() internally guards voiceEnabled + quietMode — always safe to call
      speakDecision();
    }, 5500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastShotEpoch]);

  // Auto-voice: speak updated club recommendation when manual distance changes (debounced 1.8s).
  // Cancels any pending GPS voice timer so the two never double-speak.
  const autoVoiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isRoundActive) return;
    // Cancel pending GPS-triggered voice so we don't double-speak
    if (typeof gpsVoiceTimerRef !== 'undefined' && gpsVoiceTimerRef.current) {
      clearTimeout(gpsVoiceTimerRef.current);
      gpsVoiceTimerRef.current = null;
    }
    if (autoVoiceTimerRef.current) clearTimeout(autoVoiceTimerRef.current);
    autoVoiceTimerRef.current = setTimeout(() => {
      const dist = parseInt(distance, 10) || 150;
      if (dist < 10) return;
      speakDecision(dist);
    }, 1800);
    return () => { if (autoVoiceTimerRef.current) clearTimeout(autoVoiceTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distance]);

  // Load user-calibrated green coordinates from persistent storage on mount.
  useEffect(() => {
    AsyncStorage.getItem('calibratedGreens').then((v) => {
      if (v) try { setCalibratedGreens(JSON.parse(v)); } catch { /* corrupt data — ignore */ }
    }).catch(() => {});
  }, []);

  // Battery-safe GPS \u2014 start watcher on mount, tear down on unmount
  useEffect(() => {
    startGpsWatch();
    return () => stopGpsWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-compute displayed yardages when the hole changes (watcher is already running).
  // Uses calibrated green coords when available; falls back to COURSE_DB coords with
  // a sanity check — distances > 3× course yardage indicate bad/placeholder coords
  // and are suppressed (shown as null / '--') rather than displayed as garbage values.
  useEffect(() => {
    const c = gpsCoordsRef.current;
    if (!c) return;
    const courseIdx = selectedCourseIdxRef.current;
    const holeNum   = hole;
    const hd = (COURSE_DB[courseIdx] ?? COURSE_DB[0]).holes[Math.min(holeNum - 1, 17)];
    const calKey = `${courseIdx}_${holeNum}`;
    const cal = calibratedGreens[calKey];
    if (cal) {
      // User has calibrated this green — compute accurate distance to the flagstick.
      const midYards = haversineYards(c.latitude, c.longitude, cal.lat, cal.lng);
      const depth = Math.max(12, Math.round((hd?.distance ?? 360) * 0.04));
      setGpsYards({
        front:  Math.max(1, midYards - depth),
        middle: midYards,
        back:   midYards + depth,
      });
    } else {
      // No calibration — use COURSE_DB coords but suppress implausible results.
      const maxYards = Math.max((hd?.distance ?? 500) * 3, 900);
      const safe = (y: number) => (y > 0 && y <= maxYards ? y : null);
      setGpsYards({
        front:  safe(haversineYards(c.latitude, c.longitude, hd?.front?.lat  ?? 0, hd?.front?.lng  ?? 0)),
        middle: safe(haversineYards(c.latitude, c.longitude, hd?.middle?.lat ?? 0, hd?.middle?.lng ?? 0)),
        back:   safe(haversineYards(c.latitude, c.longitude, hd?.back?.lat   ?? 0, hd?.back?.lng   ?? 0)),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole, calibratedGreens]);

  // Sync offline rounds when connection is restored
  useEffect(() => {
    if (!isOnline) return;
    const syncOffline = async () => {
      const userId = auth.currentUser?.uid;
      if (!userId) return;
      const stored = await AsyncStorage.getItem('offlineRounds').catch(() => null);
      if (!stored) return;
      let rounds: any[];
      try { rounds = JSON.parse(stored); } catch { await AsyncStorage.removeItem('offlineRounds'); return; }
      if (!rounds.length) return;

      const failed: any[] = [];
      for (const r of rounds) {
        try {
          await addDoc(collection(db, 'users', userId, 'rounds'), r);
        } catch {
          failed.push(r); // keep for next reconnect
        }
      }
      if (failed.length === 0) {
        await AsyncStorage.removeItem('offlineRounds').catch(() => {});
        setPendingSyncCount(0);
        // Clear draftMultiRound only after successful full sync
        await AsyncStorage.removeItem('draftMultiRound').catch(() => {});
      } else {
        await AsyncStorage.setItem('offlineRounds', JSON.stringify(failed)).catch(() => {});
        setPendingSyncCount(failed.length);
      }
    };
    syncOffline();
  }, [isOnline]);
  const [cameraMinimized, setCameraMinimized] = useState(true);
  // Card collapse states (IN PLAY is excluded)
  const [strategyCollapsed,     setStrategyCollapsed]     = useState(false);
  const [aiClubHint,            setAiClubHint]            = useState<string | null>(null);
  // Per-hole stats for scoring analytics (reset each hole)
  const [puttsThisHole,   setPuttsThisHole]   = useState(0);
  const [firThisHole,     setFirThisHole]     = useState<boolean | null>(null); // null = not applicable (par 3)
  const [girThisHole,     setGirThisHole]     = useState<boolean | null>(null);
  // Accumulates completed-hole stats for round insights
  const [holeStatsLog,    setHoleStatsLog]    = useState<Array<{ hole: number; strokes: number; putts: number; fairwayHit: boolean | null; gir: boolean | null }>>([]);
  const [aiRoundInsights, setAiRoundInsights] = useState<string | null>(null);
  const [swingAnalysisCollapsed, setSwingAnalysisCollapsed] = useState(false);
  const [caddieCollapsed,       setCaddieCollapsed]       = useState(false);
  const [cameraCollapsed,       setCameraCollapsed]       = useState(true);
  const [swingGalleryCollapsed, setSwingGalleryCollapsed] = useState(false);
  const [focusCollapsed,        setFocusCollapsed]        = useState(false);
  const [roundHistory, setRoundHistory] = useState<Array<{ date: string; scores: number[]; winner: string }>>([]);
  const [listening, setListening] = useState(false);
  const [listeningPhase, setListeningPhase] = useState<'listening' | 'processing'>('listening');
  const [isThinking, setIsThinking] = useState(false);
  const [pulse, setPulse] = useState(1);
  const pulseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showCoachingVideo, setShowCoachingVideo] = useState(false);
  const [clubDistances, setClubDistances] = useState<Record<string, { total: number; count: number }>>({});
  const [playerModel, setPlayerModel] = useState<{
    clubs: Record<string, { samples: number[]; avg: number | null }>;
  }>({ clubs: {} });
  // GPS — coords stored in ref to avoid re-render on every update;
  // gpsYards state is debounced (750ms active / 5s low-power) to prevent rapid re-renders
  const gpsCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const gpsWatchRef  = useRef<Location.LocationSubscription | null>(null);
  // Refs that always hold the current hole / courseIdx — used inside the watcher
  // callback to avoid the stale-closure bug (the callback captures values at
  // startGpsWatch call time; reading from refs gives the live value instead).
  const holeRef = useRef(hole);
  const selectedCourseIdxRef = useRef(selectedCourseIdx);
  const [gpsYards, setGpsYards] = useState<{ front: number | null; middle: number | null; back: number | null } | null>(null);
  // GPS shot tracking refs — snapshot yardsBefore at shot mark, compute real carry once player walks to ball
  const gpsYardsRef = useRef<{ front: number | null; middle: number | null; back: number | null } | null>(null);
  const prevShotYardsRef = useRef<number | null>(null);
  const prevShotClubRef = useRef<string | null>(null);
  const [lastShotBadge, setLastShotBadge] = useState<{ yardsCarried: number; yardsRemaining: number; club: string } | null>(null);
  const [lastShotTrace, setLastShotTrace] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [earbudMode, setEarbudMode] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  // Sync-back: goalMode, strategyMode, highContrast (declared here and below)
  useEffect(() => { useSettingsStore.getState().setPlayerMode(goalMode); }, [goalMode]);
  useEffect(() => { useSettingsStore.getState().setRiskDefault(strategyMode); }, [strategyMode]);
  useEffect(() => { useSettingsStore.getState().setHighContrast(highContrast); }, [highContrast]);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const traceOpacity = useRef(new Animated.Value(1)).current;

  // ── Biometric settings (surface-level; actual lock lives in _layout.tsx) ──────
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  useEffect(() => {
    // Reflect current hardware capability on mount so the toggle starts correct
    checkBiometricSupport().then((supported) => setBiometricEnabled(supported));
  }, []);

  const handleBiometricToggle = async () => {
    if (biometricEnabled) {
      // Disable — propagate to layout
      setBiometricEnabled(false);
      BiometricLayoutControls._setBiometricEnabled?.(false);
    } else {
      const supported = await checkBiometricSupport();
      if (!supported) {
        // Use caddieMessage as a lightweight toast — no extra Alert dependency
        setCaddieMessage('Biometric authentication is not available on this device.');
        return;
      }
      setBiometricEnabled(true);
      BiometricLayoutControls._setBiometricEnabled?.(true);
    }
  };

  // ── Round Summary Share ───────────────────────────────────────────────────
  const handleShareRoundSummary = useCallback(async (summary: typeof roundSummary) => {
    if (!summary) return;
    const lines: string[] = [
      '🏌️ SmartPlay Caddie — Round Summary',
      '',
      `Shots tracked: ${summary.totalShots ?? 'N/A'}`,
      summary.bias ? `Miss bias: ${summary.bias} (confidence: ${summary.biasConfidence ?? '--'}%)` : '',
      '',
      summary.keyMessage ?? '',
      '',
      '⛳ Powered by SmartPlay Caddie — smartplaycaddie.com',
    ];
    try {
      await Share.share({ message: lines.filter(Boolean).join('\n') });
    } catch { /* share cancelled */ }
  }, []);

  // ── Low Power Mode ────────────────────────────────────────────────────────
  const [lowPowerMode, setLowPowerMode] = useState(false);
  // Ref mirror of lowPowerMode — safe to read inside useCallback / GPS callbacks
  // without stale closure issues.
  const lowPowerModeRef = useRef(false);
  useEffect(() => { lowPowerModeRef.current = lowPowerMode; }, [lowPowerMode]);
  // Animated dim value: 1.0 = fully visible, 0.25 = energy-save dim
  const dimAnim = useRef(new Animated.Value(1)).current;
  // Tracks whether the screen was temporarily woken by a tap
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isWoken, setIsWoken] = useState(false);
  // Optional shake-to-wake: subscribes to Accelerometer while screen is dimmed
  const [shakeWakeEnabled, setShakeWakeEnabled] = useState(false);
  const shakeSubRef = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);
  const SHAKE_G_THRESHOLD = 2.8; // G-force required to trigger wake (avoids pocket bumps)
  // Idle-auto-dim: restarted on every user interaction; fires after 90 s of inactivity.
  // 10 s was too aggressive for golf — a player may stand at the tee for 30-60 s
  // between shots without touching the screen.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const IDLE_TIMEOUT_MS = 90_000;
  // Activity level: 'active' when user is mid-play; 'idle' between shots
  const activityLevelRef = useRef<'active' | 'idle'>('idle');
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // How long after a shot the screen stays in "active" (burst) mode
  const ACTIVE_WINDOW_MS = 10_000;
  // Analytics delay: shorter when active, longer when idle
  const ANALYTICS_DELAY_ACTIVE_MS = 1_500;
  const ANALYTICS_DELAY_IDLE_MS   = 5_500;

  /** Called on any meaningful user interaction (shot log, GPS mark, tap wake). */
  const markUserActive = () => {
    activityLevelRef.current = 'active';
    // Burst vision frames for the active window
    vpSetBurstMode(true, ACTIVE_WINDOW_MS);
    // Reset the active→idle countdown
    if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
    activityTimerRef.current = setTimeout(() => {
      activityLevelRef.current = 'idle';
      activityTimerRef.current = null;
      // Drop back to normal (non-burst) stride; low-power handles further throttle
      vpSetBurstMode(false, 0);
    }, ACTIVE_WINDOW_MS);
  };

  const resetIdleTimer = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    // Any interaction that resets the idle timer counts as user activity
    markUserActive();
    idleTimerRef.current = setTimeout(() => {
      // Only auto-dim during an active round — not on menus / loading screens
      if (!lowPowerMode) toggleLowPowerMode(true);
    }, IDLE_TIMEOUT_MS);
  };

  const applyDim = (dimmed: boolean) => {
    Animated.timing(dimAnim, {
      toValue: dimmed ? 0.25 : 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  };

  const handleTapToWake = () => {
    if (!lowPowerMode) return;
    // Clear any existing dim timer
    if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
    setIsWoken(true);
    applyDim(false);
    // Restart the idle countdown so screen re-dims after 10 s of inactivity
    resetIdleTimer();
    // Redim after 8 seconds of inactivity
    wakeTimerRef.current = setTimeout(() => {
      setIsWoken(false);
      applyDim(true);
    }, 8000);
  };

  const toggleLowPowerMode = (next: boolean) => {
    setLowPowerMode(next);
    applyDim(next);
    // Propagate to VisionProcessor so frame stride / idle timeout adjust
    vpSetLowPowerMode(next);
    if (!next) {
      // Exiting low power — resume vision, cancel redim, restart idle countdown
      vpResumeProcessing();
      if (wakeTimerRef.current) { clearTimeout(wakeTimerRef.current); wakeTimerRef.current = null; }
      setIsWoken(false);
      resetIdleTimer();
    } else {
      // Entering low power — pause vision processing; voice-first mode; cancel idle timer
      vpPauseProcessing();
      setVoiceEnabled(true);
      if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    }
  };

  // Cleanup wake timer on unmount
  useEffect(() => () => {
    if (wakeTimerRef.current)      clearTimeout(wakeTimerRef.current);
    if (idleTimerRef.current)      clearTimeout(idleTimerRef.current);
    if (activityTimerRef.current)  clearTimeout(activityTimerRef.current);
  }, []);

  // Shake-to-wake: subscribe while dimmed + shake enabled; unsubscribe otherwise
  useEffect(() => {
    if (lowPowerMode && !isWoken && shakeWakeEnabled) {
      Accelerometer.setUpdateInterval(200);
      shakeSubRef.current = Accelerometer.addListener(({ x, y, z }) => {
        const g = Math.sqrt(x * x + y * y + z * z);
        if (g >= SHAKE_G_THRESHOLD) {
          shakeSubRef.current?.remove();
          shakeSubRef.current = null;
          handleTapToWake();
        }
      });
    } else {
      shakeSubRef.current?.remove();
      shakeSubRef.current = null;
    }
    return () => {
      shakeSubRef.current?.remove();
      shakeSubRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowPowerMode, isWoken, shakeWakeEnabled]);
  const router = useRouter();

  const updateClubDistance = (clubName: string, dist: number) => {
    if (!clubName || !dist) return;
    // Also keep legacy clubDistances in sync for any call-sites that still read it
    setClubDistances((prev) => {
      const existing = prev[clubName] ?? { total: 0, count: 0 };
      return { ...prev, [clubName]: { total: existing.total + dist, count: existing.count + 1 } };
    });
    setPlayerModel((prev) => {
      const existing = prev.clubs[clubName]?.samples ?? [];
      const filtered = [...existing, dist]
        .slice(-15)
        .filter((d) => d > 20 && d < 350);
      if (filtered.length === 0) return prev;
      const avg = Math.round(filtered.reduce((a, b) => a + b, 0) / filtered.length);
      return {
        ...prev,
        clubs: {
          ...prev.clubs,
          [clubName]: { samples: filtered, avg },
        },
      };
    });
  };

  const getClubAverage = (clubName: string): number | null => {
    const model = playerModel?.clubs?.[clubName] ?? null;
    if (model && model.avg !== null && (model.samples?.length ?? 0) >= 1) return model.avg;
    const legacy = clubDistances[clubName];
    if (!legacy || legacy.count === 0) return null;
    return Math.round(legacy.total / legacy.count);
  };

  // Build a live yardage map: prefer playerModel sampled avg (≥2 shots), fall back to defaults
  const getClubYardageMap = (): [string, number][] =>
    DEFAULT_CLUB_YARDS.map(([name, defaultYds]) => {
      const model = playerModel?.clubs?.[name] ?? null;
      if (model && model.avg !== null && (model.samples?.length ?? 0) >= 2) return [name, model.avg] as [string, number];
      const avg = getClubAverage(name);
      return [name, avg !== null && (clubDistances[name]?.count ?? 0) >= 2 ? avg : defaultYds] as [string, number];
    });

  // Find closest club to a given yardage (pure — no side effects)
  // Priority: 1) playerModel learned avg (≥1 sample)  2) DEFAULT_CLUB_YARDS  3) '7i' fallback
  // If any clubs have learned data, search learned-only map first — closest wins.
  // Unlearned clubs fill in from defaults so a recommendation is always returned.
  const recommendClubForDistance = (yards: number): string => {
    const FALLBACK = '7i';
    try {
      // Build two lists: learned clubs and default clubs
      const learned: [string, number][] = [];
      const withDefaults: [string, number][] = [];

      for (const [name, defaultYds] of DEFAULT_CLUB_YARDS) {
        const entry = playerModel?.clubs?.[name] ?? null;
        if (entry && entry.avg !== null && (entry.samples?.length ?? 0) >= 1) {
          learned.push([name, entry.avg]);
          withDefaults.push([name, entry.avg]);
        } else {
          withDefaults.push([name, defaultYds]);
        }
      }

      // Use learned-only map when we have data; otherwise fall back to defaults
      const base = learned.length >= 2 ? learned : withDefaults;

      // Exclude Putter for shots ≥ 30 yds
      const candidates = yards >= 30 ? base.filter(([c]) => c !== 'Putter') : base;
      if (candidates.length === 0) return FALLBACK;

      let best = candidates[0][0];
      let bestDiff = Math.abs(candidates[0][1] - yards);
      for (const [name, yds] of candidates) {
        const diff = Math.abs(yds - yards);
        if (diff < bestDiff) { bestDiff = diff; best = name; }
      }
      return best || FALLBACK;
    } catch {
      return FALLBACK;
    }
  };

  // Track last auto-recommended club so we only call setClub when it changes
  const lastAutoClubRef = useRef<string | null>(null);

  // Auto club recommendation — fires when GPS yardage updates (every 25 s) or
  // when the player's learned distances change. Only calls setClub when the
  // recommendation actually changes — no flicker, no re-render churn.
  // Does NOT override a manual club selection mid-hole (strokes > 0).
  useEffect(() => {
    const yards = gpsYards?.middle;
    if (!yards || yards < 1 || yards > 700) return;
    // After tee shot (strokes > 0), let GPS guide club — recommends approach iron
    // On the tee (strokes === 0) GPS distance >= 200 yds → always Driver
    const recommended = (strokes === 0 && yards >= 200) ? 'Driver' : recommendClubForDistance(yards);
    if (recommended !== lastAutoClubRef.current) {
      lastAutoClubRef.current = recommended;
      setClub(recommended);
      setCaddieMessage(`${yards} yards. ${recommended}.`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsYards, clubDistances]);

  // GPS carry computation — fires each time GPS updates (player walked to ball)
  // Computes yardsCarried = yardsBefore - yardsAfter → feeds real club distance into learning engine
  useEffect(() => {
    const after = gpsYards?.middle;
    if (after == null || !prevShotYardsRef.current || !prevShotClubRef.current) return;
    const yardsCarried = Math.round(prevShotYardsRef.current - after);
    if (yardsCarried < 10 || yardsCarried > 700) return;  // filter GPS noise or same-position taps
    const shotClub = prevShotClubRef.current;
    recordClubDistance(shotClub, yardsCarried);   // feeds AI caddie service
    updateClubDistance(shotClub, yardsCarried);   // feeds playerModel samples + legacy clubDistances
    setLastShotBadge({ yardsCarried, yardsRemaining: Math.round(after), club: shotClub });
    prevShotYardsRef.current = null;
    prevShotClubRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsYards]);

  // GPS voice trigger — speaks only when GPS distance changes by > 10 yards.
  // Prevents voice spam from minor positioning jitter (1–5 yd GPS drift).
  // Debounced 750 ms to absorb rapid successive ticks before comparing.
  // Cross-cancels the manual-distance timer so the two never double-speak.
  const gpsVoiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce timer for GPS state updates — prevents rapid re-renders from GPS ticks.
  // The ref (gpsYardsRef) is always updated immediately so shot-carry detection stays accurate;
  // only the React state that drives UI is debounced.
  const gpsStateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const GPS_STATE_DEBOUNCE_MS = 750; // 750 ms — matches existing voice debounce window
  // ── GPS signal health ────────────────────────────────────────────────────
  // gpsWeak becomes true when no GPS tick arrives within GPS_WEAK_TIMEOUT_MS.
  // Last-known gpsYards is always retained so the display never goes blank;
  // only the label changes to warn the player the distance may be stale.
  const [gpsWeak, setGpsWeak] = useState(false);
  const gpsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const GPS_WEAK_TIMEOUT_MS = 30000; // 30 s — 3× the nominal 10 s watcher interval
  const rescheduleGpsWatchdog = () => {
    if (gpsWatchdogRef.current) clearTimeout(gpsWatchdogRef.current);
    gpsWatchdogRef.current = setTimeout(() => {
      gpsWatchdogRef.current = null;
      setGpsWeak(true);
    }, GPS_WEAK_TIMEOUT_MS);
  };
  const lastSpokenYardsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isRoundActive) return;
    const yards = gpsYards?.middle;
    if (!yards || yards < 10 || yards > 700) return;
    // Significant-change gate: ignore updates ≤ 10 yards from the last spoken value.
    // This filters walk-to-ball micro-drift while still reacting when the player
    // actually moves (approaching the green, advancing after a big drive, etc.).
    const last = lastSpokenYardsRef.current;
    if (last !== null && Math.abs(yards - last) <= 10) return;
    // Cancel any pending manual-distance voice so we don't double-speak
    if (autoVoiceTimerRef.current) { clearTimeout(autoVoiceTimerRef.current); autoVoiceTimerRef.current = null; }
    if (gpsVoiceTimerRef.current) clearTimeout(gpsVoiceTimerRef.current);
    gpsVoiceTimerRef.current = setTimeout(() => {
      lastSpokenYardsRef.current = yards;
      speakDecision(yards);
    }, 750);
    return () => { if (gpsVoiceTimerRef.current) clearTimeout(gpsVoiceTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsYards]);

  // --- Voice trigger: new hole -----------------------------------------------
  // Fires once when the hole number changes (player advances). Skips hole 1 on
  // mount (isRoundActive guard) so the app doesn't speak on first load.
  const prevHoleRef = useRef<number>(1);
  useEffect(() => {
    if (!isRoundActive || hole === prevHoleRef.current) return;
    prevHoleRef.current = hole;
    // Reset spoken-yards tracker so the first GPS read on the new hole always speaks
    lastSpokenYardsRef.current = null;
    // Rotate swing thought on each new hole
    setSwingThought(FOCUS_MESSAGES[(hole - 1) % FOCUS_MESSAGES.length]);
    // Auto-select club for new hole:
    // - If GPS has a live distance use that
    // - Otherwise use the hole's default distance from course DB
    // - First shot of hole (strokes === 0): prefer Driver for long holes (>= 200 yds)
    const liveYards = gpsYards?.middle;
    const holeYards = currentHoleData.distance;
    const dist = liveYards ?? holeYards;
    const newClub = dist >= 200 ? 'Driver' : recommendClubForDistance(dist);
    lastAutoClubRef.current = newClub;
    setClub(newClub);
    maybeSpeakPreShot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole]);

  // --- Controlled pre-shot trigger: club change only -------------------------
  // prevClubRef starts null so we don't speak on mount. Only speaks when the
  // player deliberately changes club — auto-GPS recommendations are silent.
  const prevClubRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevClubRef.current === null) { prevClubRef.current = club; return; }
    if (club === prevClubRef.current) return;
    if (club !== lastAutoClubRef.current) {
      maybeSpeakPreShot();
    }
    prevClubRef.current = club;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club]);

  // Battery-safe GPS watcher — Balanced accuracy, updates every 25 s, no re-render on every tick
  const startGpsWatch = async () => {
    if (gpsWatchRef.current) return; // already watching
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      // Helper: compute calibration-aware yardages for a given player position.
      // Reads from refs so it is safe to call inside the watchPositionAsync callback.
      const computeYards = (lat: number, lng: number) => {
        const courseIdx = selectedCourseIdxRef.current;
        const holeNum   = holeRef.current;
        const hd = (COURSE_DB[courseIdx] ?? COURSE_DB[0]).holes[Math.min(holeNum - 1, 17)];
        const calKey = `${courseIdx}_${holeNum}`;
        // calibratedGreens is captured by the closure; initial value is fine for the
        // seed call, and the watcher re-reads it via the outer-scope ref each tick.
        const cal = calibratedGreens[calKey];
        if (cal) {
          const midYards = haversineYards(lat, lng, cal.lat, cal.lng);
          const depth = Math.max(12, Math.round((hd?.distance ?? 360) * 0.04));
          return { front: Math.max(1, midYards - depth), middle: midYards, back: midYards + depth };
        }
        const maxYards = Math.max((hd?.distance ?? 500) * 3, 900);
        const safe = (y: number) => (y > 0 && y <= maxYards ? y : null);
        return {
          front:  safe(haversineYards(lat, lng, hd?.front?.lat  ?? 0, hd?.front?.lng  ?? 0)),
          middle: safe(haversineYards(lat, lng, hd?.middle?.lat ?? 0, hd?.middle?.lng ?? 0)),
          back:   safe(haversineYards(lat, lng, hd?.back?.lat   ?? 0, hd?.back?.lng   ?? 0)),
        };
      };

      // Seed immediately so first yardage appears right away
      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      gpsCoordsRef.current = initial.coords;
      const seeds = computeYards(initial.coords.latitude, initial.coords.longitude);
      gpsYardsRef.current = seeds;  // sync ref immediately so handleShot reads latest value
      setGpsYards(seeds);
      setGpsWeak(false);
      rescheduleGpsWatchdog(); // start watchdog — will fire if ticks stop arriving
      if (earbudMode && seeds.middle && seeds.middle > 0 && seeds.middle < 700) {
        void voiceSpeak(`${seeds.middle} yards to the middle`, 'calm');
      }

      gpsWatchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10000,   // 10 seconds between updates (was 25 s — too slow for play)
          distanceInterval: 5,   // or 5 m movement — whichever comes first
        },
        (loc) => {
          // Store in ref — zero re-render cost
          gpsCoordsRef.current = loc.coords;
          // computeYards reads holeRef/selectedCourseIdxRef — always current hole
          const yards = computeYards(loc.coords.latitude, loc.coords.longitude);

          // ── GPS smoothing ────────────────────────────────────────────────
          // 1. Noise gate: ignore sub-3-yard changes — GPS drift on a stationary
          //    device can move 1–5 yards between ticks with no real movement.
          // 2. Jump clamp: reject jumps > 50 yards between ticks unless the hole
          //    has changed (hole change resets the baseline, so the first reading
          //    on a new hole always passes through regardless of magnitude).
          const prev = gpsYardsRef.current;
          if (prev?.middle != null && yards.middle != null) {
            const delta = Math.abs(yards.middle - prev.middle);
            // Noise gate — discard micro-jitter
            if (delta < 3) return;
            // Jump clamp — treat large leaps as GPS anomalies and silently drop
            // them unless the hole just changed (holeRef tracks the current hole).
            if (delta > 50) return;
          }
          // ────────────────────────────────────────────────────────────────

          // Signal is alive — clear any weak-GPS flag and restart watchdog.
          setGpsWeak(false);
          rescheduleGpsWatchdog();

          // Update ref immediately so handleShot always reads the latest GPS value
          // even if the React state hasn't been flushed yet.
          gpsYardsRef.current = yards;
          // Debounce the state update to prevent rapid re-renders from every GPS tick.
          // In low power mode the display is dimmed, so a 5 s debounce is sufficient
          // and avoids unnecessary renders that drain battery.
          const gpsDebounceMs = lowPowerModeRef.current ? 5_000 : GPS_STATE_DEBOUNCE_MS;
          if (gpsStateDebounceRef.current) clearTimeout(gpsStateDebounceRef.current);
          gpsStateDebounceRef.current = setTimeout(() => {
            gpsStateDebounceRef.current = null;
            setGpsYards(yards);
          }, gpsDebounceMs);
        }
      );
    } catch {
      // GPS unavailable — mark as weak so UI shows the indicator.
      // Last-known gpsYards (if any) is retained for display.
      setGpsWeak(true);
    }
  };

  const stopGpsWatch = () => {
    // Cancel any pending debounced state update before removing the watcher.
    if (gpsStateDebounceRef.current) {
      clearTimeout(gpsStateDebounceRef.current);
      gpsStateDebounceRef.current = null;
    }
    // Cancel the watchdog — GPS is intentionally stopped, not weak.
    if (gpsWatchdogRef.current) {
      clearTimeout(gpsWatchdogRef.current);
      gpsWatchdogRef.current = null;
    }
    setGpsWeak(false);
    gpsWatchRef.current?.remove();
    gpsWatchRef.current = null;
  };

  // Save the current GPS position as the calibrated green center for this hole.
  // Walk to the middle of the green, press "Set Green", and every future round
  // will have accurate GPS yardages for this hole on this course.
  const saveGreenLocation = async () => {
    const c = gpsCoordsRef.current;
    if (!c) {
      void voiceSpeak('GPS not ready yet. Try again once you are outdoors.', 'calm');
      return;
    }
    const calKey = `${selectedCourseIdx}_${hole}`;
    const newCal = { lat: c.latitude, lng: c.longitude };
    const updated = { ...calibratedGreens, [calKey]: newCal };
    setCalibratedGreens(updated);
    await AsyncStorage.setItem('calibratedGreens', JSON.stringify(updated)).catch(() => {});
    // Immediately recompute now that calibration is saved
    const hd = activeCourse.holes[Math.min(hole - 1, activeCourse.holes.length - 1)];
    const midYards = haversineYards(c.latitude, c.longitude, newCal.lat, newCal.lng); // 0 — player is AT the green
    const depth = Math.max(12, Math.round((hd?.distance ?? 360) * 0.04));
    setGpsYards({ front: Math.max(1, midYards - depth), middle: midYards, back: midYards + depth });
    void voiceSpeak(`Green saved for hole ${hole}.`, 'calm');
  };

  // Alias kept so existing earbudMode / other call-sites still work
  const getLocation = startGpsWatch;

  // Accurate Haversine formula — matches Garmin to ±1 yard at golf distances
  const haversineYards = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000;
    const f1 = lat1 * Math.PI / 180;
    const f2 = lat2 * Math.PI / 180;
    const df = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    const meters = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(meters * 1.09361);
  };

  const calculateDistance = (target: { lat: number; lng: number }): number | null => {
    const c = gpsCoordsRef.current;
    if (!c) return null;
    return haversineYards(c.latitude, c.longitude, target.lat, target.lng);
  };

  // Reads the pre-computed gpsYards state (updated every 25 s) — no live calc in render
  const getYardages = () => gpsYards ?? { front: null, middle: null, back: null };

  const getGpsDistance = (): number | null => gpsYards?.middle ?? null;

  const triggerAutoRecording = async () => {
    if (!cameraRef.current || autoRecording || recording) return;
    setAutoRecording(true);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 3 });
      if (video) {
        setVideoUri(video.uri);
      }
    } catch {
      // recording unavailable
    }
    setAutoRecording(false);
  };

  const startRecording = async () => {
    if (!cameraRef.current || recording) return;
    setRecording(true);
    setVideoUri(null);
    // Start capturing accelerometer + gyroscope data for analysis
    recordingPeakGRef.current    = 0;
    recordingPeakXRef.current    = 0;
    recordingPeakZRef.current    = 0;
    recordingPeakRotYRef.current = 0;
    recordingPeakRotZRef.current = 0;
    recordingStartRef.current    = Date.now();
    Accelerometer.setUpdateInterval(50);
    recordingAccelRef.current = Accelerometer.addListener(({ x, y, z }) => {
      const g = Math.sqrt(x * x + y * y + z * z);
      if (g > recordingPeakGRef.current) recordingPeakGRef.current = g;
      if (Math.abs(x) > Math.abs(recordingPeakXRef.current)) recordingPeakXRef.current = x;
      if (Math.abs(z) > Math.abs(recordingPeakZRef.current)) recordingPeakZRef.current = z;
    });
    Gyroscope.setUpdateInterval(50);
    recordingGyroRef.current = Gyroscope.addListener(({ y, z }) => {
      if (Math.abs(y) > Math.abs(recordingPeakRotYRef.current)) recordingPeakRotYRef.current = y;
      if (Math.abs(z) > Math.abs(recordingPeakRotZRef.current)) recordingPeakRotZRef.current = z;
    });
    const video = await cameraRef.current.recordAsync();
    recordingAccelRef.current?.remove();
    recordingAccelRef.current = null;
    recordingGyroRef.current?.remove();
    recordingGyroRef.current = null;
    recordingDurationRef.current = Date.now() - recordingStartRef.current;
    if (video) {
      setVideoUri(video.uri);
    }
    setRecording(false);

    // Auto-detect swing direction from peak lateral acceleration (x-axis)
    const peakX = recordingPeakXRef.current;
    const autoResult = peakX > 1.5 ? 'right' : peakX < -1.5 ? 'left' : 'straight';
    if (autoResult !== 'straight') handleShot(autoResult);

    // Instant analysis — tempo inferred from recording duration
    const dur = recordingDurationRef.current;
    const autoTempo = dur > 0 && dur < 1800 ? 'fast' : dur > 2800 ? 'slow' : 'smooth';
    const analysis = generateSwingAnalysis(autoResult, autoTempo);
    setLastSwingAnalysis(analysis);
    // Speak the single-line feedback after a short pause
    setTimeout(() => { void voiceSpeak(buildFeedbackLine(analysis), 'calm'); }, 800);
  };

  const stopRecording = () => {
    if (cameraRef.current) cameraRef.current.stopRecording();
  };

  const getCaddieAdvice = () => {
    if (shots.length < 3) return "Let's see a few more swings first.";

    let strategy = '';
    if (par === 5) strategy = "Par 5 — no need to force it. Stay in control.";
    else if (par === 3) strategy = "Par 3 — commit to your line.";
    else strategy = "Stay patient and pick your target.";

    let pressure = '';
    if (hole >= 16) pressure = ' Stay calm — this is where rounds are saved.';

    const dist = parseInt(distance, 10) || 150;
    let clubAdvice = '';
    if (dist > 180 && club !== 'Driver') clubAdvice = ' Take one more club here.';
    if (dist < 120 && club === 'Driver') clubAdvice = " That's too much stick. Drop down a club.";
    if (mentalState === 'nervous') clubAdvice += ' Play the safe side.';
    if (mentalState === 'aggressive') clubAdvice += ' Back yourself and commit.';

    const clubBias = (() => {
      let score = 0;
      shots.forEach((shot) => {
        if (shot.club === club) {
          if (shot.result === 'right') score += 1;
          if (shot.result === 'left') score -= 1;
        }
      });
      if (score >= 2) return 'right';
      if (score <= -2) return 'left';
      return 'neutral';
    })();

    let decision = '';
    if (clubBias === 'right') decision = `Your ${club} tends to miss right. Favor the left side.`;
    else if (clubBias === 'left') decision = `Your ${club} tends to miss left. Favor the right side.`;
    else decision = `Your ${club} is reliable. Take a direct line.`;

    let aimFeedback = '';
    if (clubBias === 'right') {
      aimFeedback = aim.includes('left') ? 'Good adjustment — aim left center.' : 'Favor left center on this one.';
    } else if (clubBias === 'left') {
      aimFeedback = aim.includes('right') ? 'Good adjustment — aim right center.' : 'Shade it right center on this one.';
    } else {
      aimFeedback = 'Stay on your center line.';
    }

    return `${strategy} ${decision} ${aimFeedback}${pressure}${clubAdvice}`;
  };

  const getSwingPattern = () => {
    if (shots.length === 0) return null;
    let right = 0; let left = 0; let straight = 0;
    shots.forEach((s) => {
      if (s.result === 'right') right++;
      if (s.result === 'left') left++;
      if (s.result === 'straight') straight++;
    });
    const total = shots.length;
    return {
      right: Math.round((right / total) * 100),
      left: Math.round((left / total) * 100),
      straight: Math.round((straight / total) * 100),
    };
  };

  const getPrimaryMiss = () => {
    const pattern = getSwingPattern();
    if (!pattern) return null;
    if (pattern.right > pattern.left && pattern.right > pattern.straight) return 'right';
    if (pattern.left > pattern.right && pattern.left > pattern.straight) return 'left';
    return 'balanced';
  };

  // Shot window constants
  const SHOT_MAX  = 50; // maximum stored shots
  const SHOT_WINDOW = 6; // analysis window
  const BIAS_THRESHOLD = 0.65; // 65 %

  /**
   * analyzeShotPattern
   * O(SHOT_WINDOW) — no heavy loops, no full-list scans.
   * Returns:
   *   bias       — detected direction bias or 'neutral'
   *   confidence — 0-100, how strong the current pattern is
   */
  const analyzeShotPattern = (
    shotList: Shot[]
  ): { bias: 'right' | 'left' | 'neutral'; confidence: number } => {
    const window = shotList.slice(-SHOT_WINDOW);
    const n = window.length;
    if (n === 0) return { bias: 'neutral', confidence: 50 };

    let right = 0, left = 0, straight = 0;
    for (let i = 0; i < n; i++) {
      const r = window[i].result;
      if (r === 'right') right++;
      else if (r === 'left') left++;
      else straight++;
    }

    // Bias detection — only fires if one direction meets the threshold
    let bias: 'right' | 'left' | 'neutral' = 'neutral';
    if (right / n >= BIAS_THRESHOLD) bias = 'right';
    else if (left / n >= BIAS_THRESHOLD) bias = 'left';

    // Confidence: straight % over the window, scaled 0-100
    // Minimum 30 so confidence never reads as completely hopeless on short windows
    const confidence = Math.max(30, Math.round((straight / n) * 100));

    return { bias, confidence };
  };

  /**
   * getMissBias
   * Full-session bias over all shots (min 5).
   * Returns bias direction + confidence % (share of shots in that direction).
   */
  const getMissBias = (): { bias: string; confidence: number } | null => {
    if (shots.length < 5) return null;
    const counts: Record<string, number> = { left: 0, right: 0, straight: 0 };
    shots.forEach((s) => { if (s.result in counts) counts[s.result]++; });
    let bias: string | null = null;
    let max = 0;
    Object.entries(counts).forEach(([k, v]) => {
      if (v > max) { max = v; bias = k; }
    });
    return { bias: bias ?? 'straight', confidence: Math.round((max / shots.length) * 100) };
  };

  /**
   * getRecentBias
   * Looks at the last 5 shots only. If 3+ share a direction, returns that direction.
   * Used for mid-round "Adjust left/right" prompts that react faster than full-session bias.
   */
  const getRecentBias = (): 'left' | 'right' | 'straight' | null => {
    const recent = shots.slice(-5);
    if (recent.length < 5) return null;
    const counts: Record<string, number> = { left: 0, right: 0, straight: 0 };
    recent.forEach((s) => { if (s.result in counts) counts[s.result]++; });
    if (counts.right >= 3) return 'right';
    if (counts.left >= 3) return 'left';
    if (counts.straight >= 3) return 'straight';
    return null;
  };

  // Keep backward compat — existing call-sites that only need a number still work
  const calculateConfidence = (shotList: Shot[]): number =>
    analyzeShotPattern(shotList).confidence;

  const getPatternConfidence = (shotList: Shot[]): number => {
    const { bias } = analyzeShotPattern(shotList);
    if (shotList.length < 3 || bias === 'neutral') return 0;
    const recent = shotList.slice(-SHOT_WINDOW);
    const matches = recent.filter((s) => s.result === bias).length;
    return matches / Math.max(recent.length, 1);
  };

  const shouldGiveDirectionalAdvice = (): boolean => {
    const confidence = getPatternConfidence(shots);
    return confidence >= 0.65;
  };

  const analyzeLongTermPatterns = (rounds: Array<{ date: string; shots: Shot[] }>): 'push' | 'pull' | 'neutral' | null => {
    const allShots = rounds.flatMap((r) => r.shots);
    if (allShots.length < 10) return null;
    const rightMiss = allShots.filter((s) => s.result === 'right').length;
    const leftMiss = allShots.filter((s) => s.result === 'left').length;
    if (rightMiss > leftMiss) return 'push';
    if (leftMiss > rightMiss) return 'pull';
    return 'neutral';
  };

  /**
   * applyVoiceStyle — transforms caddie text based on the active voice style.
   * calm  : no change (measured, trust-based phrasing).
   * aggressive : strips hedging words, prepends a power cue, uppercases the key verb.
   */
  const applyVoiceStyle = (text: string): string => {
    if (voiceStyle !== 'aggressive') return text;
    // Strip soft hedging phrases
    let t = text
      .replace(/\b(smooth(ly)?|easy|just|maybe|try to|let it|trust it)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // Prepend a fire cue (deterministic — rotates by text length so it varies)
    const cues = ['Commit.', 'Fire at it.', 'Attack.', 'Lock in.'];
    const cue = cues[t.length % cues.length];
    return `${cue} ${t}`;
  };

  /**
   * Single ElevenLabs voice pipeline.
   * Rules:
   *   - Silenced by quietMode or voiceEnabled=false
   *   - Rate-limited to 2.5 s between utterances (matches service-level guard)
   *   - Never overlaps while audio is active
   *   - Always awaits ElevenLabs playback completion
   */
  const VOICE_RATE_LIMIT_MS = 4000; // 4 s cooldown — prevents speech spam between calls

  const speak = useCallback(async (text: string): Promise<void> => {
    const message = text?.trim();
    const now = Date.now();

    if (!message || quietMode || !voiceEnabled) return;
    if (now - lastSpokenRef.current < VOICE_RATE_LIMIT_MS) return;

    // Preempt any in-progress audio — the cooldown gate above already prevents
    // rapid-fire spam; if we're past it and audio is still playing (long phrase),
    // stop it so the latest advice is never silently dropped.
    if (isSpeakingRef.current) {
      await stopSpeaking(); // clears voiceService._isSpeaking + unloads current sound
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    }

    try {
      isSpeakingRef.current = true;
      setIsSpeaking(true);
      lastSpokenRef.current = now;
      setLastSpokenTime(now);
      // Start pulsing logo while caddie speaks
      let speakGrowing = true;
      const speakPulseInterval = setInterval(() => {
        setPulse((prev) => {
          if (prev >= 1.25) speakGrowing = false;
          if (prev <= 1.0) speakGrowing = true;
          return speakGrowing ? prev + 0.02 : prev - 0.02;
        });
      }, 60);
      try {
        await playElevenLabsAudio(applyVoiceStyle(message), localGender);
      } finally {
        clearInterval(speakPulseInterval);
        setPulse(1);
      }
    } catch (e) {
      console.log('Voice error', e);
    } finally {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    }
  }, [localGender, quietMode, voiceEnabled, voiceStyle, applyVoiceStyle]);

  const voiceSpeak = useCallback((message: string, _style?: string | null): void => {
    void speak(message);
  }, [speak]);

  // Backward-compat alias — existing callers of speakMessage keep working
  const speakMessage = (message: string, style?: string | null): void => {
    void voiceSpeak(message, style);
  };

  const speakAICaddie = (message: string): void => {
    void speak(message);
  };

  const shouldCallAI = (shotList: Array<{ result: string }>): boolean => {
    if (shotList.length < 2) return false;
    const lastTwo = shotList.slice(-2).map((s) => s.result);
    return lastTwo[0] === lastTwo[1]; // only when pattern is forming
  };

  const getFallback = (shotList: Array<{ result: string }>, conf: number): string => {
    const acks = ['Good number.', 'That\'s your shot.', 'Perfect yardage.'];
    const ack = acks[Math.floor(Math.random() * acks.length)];
    const recent = shotList.slice(-3).map((s) => s.result);
    if (recent.filter((r) => r === 'right').length >= 2) return 'Finish left. Front side.';
    if (recent.filter((r) => r === 'left').length >= 2) return 'Smooth tempo. Through target.';
    if (conf > 70) return `${ack} Trust it.`;
    return `${ack} Smooth swing.`;
  };

  // Returns 'pressure' when the round is deep (6+ shots logged) — simulates end-of-round tension
  const getShotSituation = (currentCount: number): 'pressure' | 'normal' =>
    currentCount >= 5 ? 'pressure' : 'normal';

  // Returns dominant miss under pressure-tagged shots only
  const getPressurePattern = (shotList: Shot[]): 'right' | 'left' | 'neutral' => {
    const ps = shotList.filter((s) => s.situation === 'pressure');
    if (ps.length < 3) return 'neutral';
    const r = ps.filter((s) => s.result === 'right').length;
    const l = ps.filter((s) => s.result === 'left').length;
    if (r > l && r / ps.length > 0.4) return 'right';
    if (l > r && l / ps.length > 0.4) return 'left';
    return 'neutral';
  };

  // Groups shots by mental state — returns dominant tendency per state
  const getMentalPatterns = (shotList: Shot[]): Record<string, 'right' | 'left' | 'straight'> => {
    const groups: Record<string, { left: number; right: number; straight: number }> = {};
    shotList.forEach((s) => {
      const m = s.mental || 'unknown';
      if (!groups[m]) groups[m] = { left: 0, right: 0, straight: 0 };
      groups[m][s.result as 'left' | 'right' | 'straight'] = (groups[m][s.result as 'left' | 'right' | 'straight'] ?? 0) + 1;
    });
    const result: Record<string, 'right' | 'left' | 'straight'> = {};
    Object.keys(groups).forEach((m) => {
      const g = groups[m];
      const total = g.left + g.right + g.straight;
      if (total < 2) return;
      if (g.right >= g.left && g.right >= g.straight) result[m] = 'right';
      else if (g.left >= g.right && g.left >= g.straight) result[m] = 'left';
      else result[m] = 'straight';
    });
    return result;
  };

  // Last-3-shot momentum: 'improving' | 'struggling' | 'neutral'
  const getTrend = (shotList: Shot[]): 'improving' | 'struggling' | 'neutral' => {
    if (shotList.length < 3) return 'neutral';
    const last3 = shotList.slice(-3).map((s) => s.result);
    const straights = last3.filter((r) => r === 'straight').length;
    const misses = last3.filter((r) => r !== 'straight').length;
    if (straights >= 2) return 'improving';
    if (misses >= 2) return 'struggling';
    return 'neutral';
  };

  const autoPreShotCue = (): void => {
    if (!quickMode || quietMode) return;
    maybeSpeakPreShot();
  };

  const getHoleHazards = (note?: string): string[] => {
    const lower = String(note ?? '').toLowerCase();
    const hazards: string[] = [];
    if (lower.includes('water') && lower.includes('left')) hazards.push('water-left');
    if (lower.includes('water') && lower.includes('right')) hazards.push('water-right');
    if (lower.includes('bunker') && lower.includes('left')) hazards.push('bunker-left');
    if (lower.includes('bunker') && lower.includes('right')) hazards.push('bunker-right');
    return hazards;
  };

  const getStrategicCue = (ctx: any): string => {
    const recommendedClub = ctx?.clubRecommendation?.club || club || '7 iron';
    const clubPart = ctx?.learnedDistance ? `${recommendedClub}, ${ctx.learnedDistance} carry` : recommendedClub;

    const leftBias =
      ctx?.dispersion?.expectedMiss === 'right' ||
      ctx?.playerModel?.missBias === 'right' ||
      ctx?.courseBias === 'right' ||
      ctx?.holeStrategy?.targetBias === 'left' ||
      String(ctx?.holeData?.danger ?? '').toLowerCase().includes('right');

    const rightBias =
      ctx?.dispersion?.expectedMiss === 'left' ||
      ctx?.playerModel?.missBias === 'left' ||
      ctx?.courseBias === 'left' ||
      ctx?.holeStrategy?.targetBias === 'right' ||
      String(ctx?.holeData?.danger ?? '').toLowerCase().includes('left');

    let target = 'Center target';
    if (ctx?.handicapMode?.mode === 'protect') target = 'Center green';
    else if (leftBias && !rightBias) target = 'Favor left';
    else if (rightBias && !leftBias) target = 'Favor right';

    let intent = 'Smooth swing';
    if (ctx?.handicapMode?.mode === 'attack' || ctx?.riskProfile?.riskLevel === 'high') intent = 'Commit fully';
    else if (ctx?.handicapMode?.mode === 'protect' || ctx?.riskProfile?.riskLevel === 'low') intent = 'Play safe';

    return trimTo12(`${clubPart}. ${target}. ${intent}.`);
  };

  const getPreShotMessage = useCallback((): string => {
    const context: any = buildContext({
      shots,
      distance,
      lastShot: shotResult,
      par,
      holeNumber: hole,
      hazards: getHoleHazards(currentHoleData?.note),
      club,
    });

    const pattern = context?.dispersion?.expectedMiss === 'left'
      ? 'miss_left'
      : context?.dispersion?.expectedMiss === 'right'
        ? 'miss_right'
        : 'center';

    const mode = strategyMode === 'attack' || context?.riskProfile?.riskLevel === 'high'
      ? 'aggressive'
      : strategyMode === 'safe' ? 'safe' : 'normal';

    if (!shouldGiveDirectionalAdvice()) {
      return 'Commit to the shot.';
    }

    if (pattern === 'miss_left') {
      return 'Start right. Smooth tempo.';
    }

    if (pattern === 'miss_right') {
      return 'Start left. Stay balanced.';
    }

    if (mode === 'aggressive') {
      return 'Attack center. Commit.';
    }

    return 'Center target. Easy swing.';
  }, [shots, distance, shotResult, par, hole, currentHoleData?.note, club, strategyMode]);

  const maybeSpeakPreShot = useCallback((): void => {
    if (!voiceEnabled || quietMode) return;
    const message = getPreShotMessage();
    if (!message) return;
    if (message !== lastPreShotRef.current) {
      lastPreShotRef.current = message;
      setCaddieMessage(message);
      void speak(message);
    }
  }, [getPreShotMessage, quietMode, speak, voiceEnabled]);

  // Fired when player talks to the caddie — concise, context-aware response
  const runConversation = (userInput: string): void => {
    if (!voiceEnabled || quietMode) return;
    const context = buildContext({
      shots,
      distance,
      lastShot: shotResult,
      par,
      holeNumber: hole,
      hazards: getHoleHazards(currentHoleData?.note),
      club,
    });
    runCaddie({
      type: 'manual',
      context: { ...context, userIntent: userInput },
      speak,
      getCaddieAdvice: (ctx: any) => getStrategicCue(ctx),
    });
  };

  const speakPreShot = useCallback((): void => {
    maybeSpeakPreShot();
  }, [maybeSpeakPreShot]);

  const analyzePattern = (shotList: Shot[]): 'push' | 'pull' | 'neutral' | null => {
    if (shotList.length < 3) return null;
    const recentShots = shotList.slice(-5);
    const rightMiss = recentShots.filter((s) => s.result === 'right').length;
    const leftMiss  = recentShots.filter((s) => s.result === 'left').length;
    if (rightMiss >= 3) return 'push';
    if (leftMiss >= 3) return 'pull';
    return 'neutral';
  };

  const startRound = () => {
    clearRound();
    resetRoundState();
    lastPreShotRef.current = '';
    setCurrentRound([]);
    setIsRoundActive(true);
    // Reset scoring analytics
    setPuttsThisHole(0);
    setFirThisHole(par === 3 ? null : null);
    setGirThisHole(null);
    setHoleStatsLog([]);
    setAiRoundInsights(null);
    // Hole 1 is always a tee shot — start on Driver
    lastAutoClubRef.current = 'Driver';
    setClub('Driver');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void playSound(SWING_SWOOSH_SFX);
    setCaddieMessage('Round started. Stay smooth.');
    // If CaddieMemory has a strong practice bias, speak it as the opening tip
    const cmOpeningTip = (() => {
      if (cmMissBias === 'neutral' || cmConfidence < 30 || cmUpdated === 0) return '';
      return cmMissBias === 'right'
        ? " You've been missing right. Let's aim slightly left today."
        : " You've been missing left. Let's aim slightly right today.";
    })();
    void voiceSpeak(`Round started. Stay smooth.${cmOpeningTip}`, 'calm');
  };

  const endRound = async () => {
    try {
      const existingRounds = await AsyncStorage.getItem('rounds');
      const parsedRounds = existingRounds ? JSON.parse(existingRounds) : [];

      const newRoundData = {
        date: new Date().toISOString(),
        shots: currentRound,
      };

      const updatedRounds = [...parsedRounds, newRoundData];

      await AsyncStorage.setItem('rounds', JSON.stringify(updatedRounds));

      setIsRoundActive(false);
      setCaddieMessage('Round saved.');
      setSavedRounds(updatedRounds);

      // Generate AI round insights in the background (non-blocking)
      getRoundInsights(holeStatsLog, shots).then((insights) => {
        if (insights) setAiRoundInsights(insights);
      }).catch(() => {});
    } catch (error) {
      console.log('Error saving round:', error);
    }
  };

  // -- AI Caddie Pipeline -----------------------------------------------------
  const buildPrompt = (shotList: Shot[], mental: string, history: Array<{ date: string; shots: Shot[] }>): string => {
    const recent = shotList.slice(-5);
    const rRight    = recent.filter((s) => s.result === 'right').length;
    const rLeft     = recent.filter((s) => s.result === 'left').length;
    const rStraight = recent.filter((s) => s.result === 'straight').length;

    const allHistoryShots = history.flatMap((r) => r.shots);
    const ltRight = allHistoryShots.filter((s) => s.result === 'right').length;
    const ltLeft  = allHistoryShots.filter((s) => s.result === 'left').length;

    return (
      `You are a smart golf caddie AI. Give one short, direct coaching tip (1-2 sentences max).\n\n` +
      `Recent shots (last ${recent.length}): ${rRight} right, ${rLeft} left, ${rStraight} straight.\n` +
      `Mental state: ${mental}.\n` +
      `Long-term history across ${history.length} rounds: ${ltRight} right misses, ${ltLeft} left misses.\n\n` +
      `Be specific, encouraging, and direct. No filler phrases.`
    );
  };

  const callOpenAI = async (prompt: string, context?: { hole?: number; par?: number; yardage?: number; club?: string; pattern?: string }): Promise<string | null> => {
    const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (!apiKey || apiKey === 'sk-your-key-here') return null;
    const ctx = context ?? {};
    const systemPrompt =
      `You are an expert golf caddie AI assistant. You know every USGA and R&A rule in detail. ` +
      `You give concise, direct, actionable advice in 1-3 sentences. No filler phrases. ` +
      (ctx.hole ? `Current hole: ${ctx.hole}, par ${ctx.par ?? '?'}. ` : '') +
      (ctx.yardage ? `Remaining distance: ~${ctx.yardage} yards. ` : '') +
      (ctx.club ? `Club in hand: ${ctx.club}. ` : '') +
      (ctx.pattern ? `Player shot tendency: ${ctx.pattern}. ` : '') +
      `If the question is about a golf rule, cite the rule number if you know it.`;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 150,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return (json.choices?.[0]?.message?.content as string)?.trim() ?? null;
    } catch {
      return null;
    }
  };

  /** Build context object for OpenAI calls from current game state */
  const getAIContext = () => ({
    hole,
    par,
    yardage: gpsYards?.middle ?? undefined,
    club,
    pattern: longTermPattern ?? undefined,
  });
  // ---------------------------------------------------------------------------

  const generateCaddieResponse = (pattern: 'push' | 'pull' | 'neutral' | null, mental: string, conf: number, ltPattern: 'push' | 'pull' | 'neutral' | null): string => {
    if (pattern === 'push') {
      if (ltPattern === 'push') return 'You tend to miss right. Commit to your front side and release left.';
      if (mental === 'rushed') return 'Slow it down. Smooth tempo and finish on your front side.';
      return "You're hanging back. Finish on your front side.";
    }
    if (pattern === 'pull') {
      if (ltPattern === 'pull') return 'You tend to miss left. Stay smooth and swing through your target.';
      if (mental === 'nervous') return 'Stay calm. Trust your swing and aim small.';
      return 'Stay smooth and swing through your target.';
    }
    if (conf > 70) return "You're dialed in. Trust it.";
    return 'Stay committed to your target.';
  };

  // Returns a single dominant-pattern insight when =60% of shots share one direction (5+ shots required)
  const detectPattern = (): string | null => {
    if (shots.length < 5) return null;
    const pattern = getSwingPattern();
    if (!pattern) return null;
    if (pattern.right > 60) return "You're starting to leak right — something to note.";
    if (pattern.left > 60) return "You've been pulling it left — let's work on that.";
    if (pattern.straight > 60) return "You're absolutely flushing it. Keep that up.";
    return null;
  };

  const getCoachingTip = (pattern: string): string | null => {
    if (pattern.includes('right')) return 'Favor the left side a touch.';
    if (pattern.includes('left')) return 'Keep the face square through impact.';
    if (pattern.includes('straight')) return "Keep that tempo — you're dialed in.";
    return null;
  };

  const detectMentalPattern = (shotList: Shot[]): string | null => {
    if (shotList.length < 5) return null;
    const filtered = shotList.filter((s) => s.mental && s.result === 'right');
    if (filtered.length >= 3) return "You tend to leak right when you're not fully committed — back yourself and trust it.";
    return null;
  };

  const updatePlayerProfile = (pattern: string, shotList?: Shot[], conf?: number): void => {
    if (pattern.includes('missing right')) {
      playerProfile.miss = 'right';
      playerProfile.strength = null;
    } else if (pattern.includes('missing left')) {
      playerProfile.miss = 'left';
      playerProfile.strength = null;
    } else if (pattern.includes('striking it really straight')) {
      playerProfile.miss = null;
      playerProfile.strength = 'straight';
    }
    playerProfile.lastUpdated = Date.now();

    // Update Zustand profile store with latest tendency + confidence
    if (shotList && shotList.length > 0) {
      const rightMiss = shotList.filter((s) => s.result === 'right').length;
      const leftMiss  = shotList.filter((s) => s.result === 'left').length;
      if (rightMiss > leftMiss) {
        usePlayerProfileStore.getState().setTypicalMiss('right');
      } else if (leftMiss > rightMiss) {
        usePlayerProfileStore.getState().setTypicalMiss('left');
      } else if (rightMiss === 0 && leftMiss === 0) {
        usePlayerProfileStore.getState().setTypicalMiss('straight');
      }
    }

    // Dynamically adjust coaching style based on confidence + mental state
    const currentStyle = usePlayerProfileStore.getState().coachingStyle;
    let newStyle: import('../store/playerProfileStore').CoachingStyle = currentStyle;
    if (conf !== undefined && conf < 40) {
      newStyle = 'encouraging';
    } else if (mentalState === 'rushed') {
      newStyle = 'calm';
    } else if (conf !== undefined && conf > 75) {
      newStyle = 'focused';
    }
    if (newStyle !== currentStyle) {
      usePlayerProfileStore.getState().setCoachingStyle(newStyle);
    }
  };

  const getSwingInsight = () => {
    const miss = getPrimaryMiss();
    if (miss === 'right') return "You're leaking right — open face or outside path. Release through from the inside.";
    if (miss === 'left') return "You're pulling left — probably early release. Slow the tempo and stay connected.";
    if (miss === 'balanced') return "Ball striking is solid. Focus on distance control and you'll be in great shape.";
    return "Hit a few more and I'll have a read on you.";
  };

  // Raw left/right/straight counts — available from shot 1+
  const getDispersionCounts = () => {
    const n = safeShots.length;
    if (n === 0) return null;
    let left = 0, right = 0, straight = 0;
    for (const s of safeShots) {
      if (s.result === 'left') left++;
      else if (s.result === 'right') right++;
      else straight++;
    }
    return { left, right, straight, total: n };
  };

  // Derived analytics — percentages + threshold-based insight text.
  // Recomputes on every render; no extra state needed.
  const getLiveAnalytics = () => {
    const dc = getDispersionCounts();
    if (!dc) return null;
    const { left, right, straight, total } = dc;
    const leftPct   = Math.round((left   / total) * 100);
    const rightPct  = Math.round((right  / total) * 100);
    const strPct    = Math.round((straight / total) * 100);
    let insight: string | null = null;
    if (rightPct > 60)       insight = 'You are consistently missing right';
    else if (leftPct > 60)  insight = 'You are consistently missing left';
    else if (strPct  > 60)  insight = 'Solid — over 60% straight';
    return { left, right, straight, total, leftPct, rightPct, strPct, insight };
  };

  // Target-aware push/pull pattern detection.
  // Only shots aimed at center are analysed so corrective aim doesn't skew results.
  // Returns null when fewer than 3 qualifying shots have been logged.
  const getPatternDetection = () => {
    const centerShots = safeShots.filter((s) => s.target === 'center');
    const n = centerShots.length;
    if (n < 3) return null;
    const pushCount = centerShots.filter((s) => s.result === 'right').length;
    const pullCount = centerShots.filter((s) => s.result === 'left').length;
    const pushPct   = Math.round((pushCount / n) * 100);
    const pullPct   = Math.round((pullCount / n) * 100);
    if (pushPct > 50) {
      return {
        pattern: 'push' as const,
        pct: pushPct,
        label: 'Push bias detected',
        coaching: 'Push bias — likely open face',
      };
    }
    if (pullPct > 50) {
      return {
        pattern: 'pull' as const,
        pct: pullPct,
        label: 'Pull bias detected',
        coaching: 'Pull bias — likely closed face',
      };
    }
    return null;
  };

  const getDispersion = () => {
    if (shots.length < 5) return null;
    const lastTen = shots.slice(-10);
    let score = 0;
    lastTen.forEach((shot) => {
      if (shot.result === 'right') score += 1;
      if (shot.result === 'left') score -= 1;
    });
    return score;
  };

  const getAimAdjustment = () => {
    const dispersion = getDispersion();
    if (dispersion === null) return '';
    if (dispersion >= 3) return "Starting to leak right — aim well left of center.";
    if (dispersion === 2) return 'Slight right lean — favor left center.';
    if (dispersion <= -3) return "You're pulling left — aim right of center.";
    if (dispersion === -2) return 'Slight left lean — favor right center.';
    return "Balanced — stay on your center line.";
  };

  const getTargetRecommendation = () => {
    const dispersion = getDispersion();
    if (dispersion === null) return '';
    if (dispersion >= 3) return 'Favor left center';
    if (dispersion === 2) return 'Shade it left center';
    if (dispersion <= -3) return 'Favor right center';
    if (dispersion === -2) return 'Shade it right center';
    return 'Stay on your center line';
  };

  // Bias-driven strategy — uses full-session getMissBias() so output
  // updates the moment the dominant direction shifts.
  const getBiasStrategy = (): { label: string; color: string } => {
    const bias = getMissBias();
    if (!bias) return { label: 'Attack the target', color: '#6ee7b7' };
    if (bias.bias === 'right') return { label: `Aim left — correcting ${bias.confidence}% right bias`, color: '#93c5fd' };
    if (bias.bias === 'left')  return { label: `Aim right — correcting ${bias.confidence}% left bias`,  color: '#fcd34d' };
    return { label: 'Attack — straight ball striking', color: '#6ee7b7' };
  };

  // Aim offset: right miss → play 5 yds shorter (aim left of flag),
  // left miss → play 5 yds longer (aim right of flag).
  // First-round magic: when fewer than 5 shots have been logged, falls back to
  // the persisted player profile miss tendency (ppMiss) so the caddie gives
  // directional guidance from hole 1, shot 1 — not just after 5 shots.
  // Returns: target (aim direction), miss (danger warning), yards (offset), label, color.
  const getAimOffset = (): { yards: number; label: string; color: string; target: string; miss: string } | null => {
    // Priority 1: live in-round shot pattern
    // Priority 2: CaddieMemory (practice-derived tendencies, requires confidence ≥ 30)
    // Priority 3: persisted player profile miss
    const liveBias = getMissBias();
    const cmBias =
      !liveBias && cmMissBias !== 'neutral' && cmConfidence >= 30
        ? { bias: cmMissBias as 'right' | 'left', confidence: cmConfidence }
        : null;
    const bias = liveBias
      ?? cmBias
      ?? (ppMiss === 'right' ? { bias: 'right' as const, confidence: 50 } :
          ppMiss === 'left'  ? { bias: 'left'  as const, confidence: 50 } :
          null);
    if (!bias) return null;
    if (bias.bias === 'right') return { yards: -5, label: '\u22125 yds (aim left)', color: '#93c5fd', target: 'left center', miss: 'Right miss is danger \u2014 aim left.' };
    if (bias.bias === 'left')  return { yards: +5, label: '+5 yds (aim right)', color: '#fcd34d', target: 'right center', miss: 'Left miss is danger \u2014 aim right.' };










    return { yards: 0, label: '±0 yds (on target)', color: '#6ee7b7', target: 'center', miss: 'Ball flight is neutral — trust the center line.' };
  };

  /**
   * getContextAdjustment — In-Round Adaptation engine.
   * Synthesises four live signals into a real-time strategy override:
   *   1. Recent shot quality   — 2+ misses in last 3 → pull back
   *   2. Score vs par          — bleeding strokes → protect; under par → press
   *   3. Late-hole pressure    — holes 15+ tighten risk tolerance
   *   4. Mental state          — frustrated/pressure → safe; confident → attack
   * Priority (highest → lowest): shot pattern, score vs par, mental state, hole.
   */
  const getContextAdjustment = (): 'safe' | 'neutral' | 'attack' => {
    // 1. Recent shot quality — immediate concern overrides everything else
    const recent = shots.slice(-3);
    if (recent.length >= 3 && recent.filter((s) => s.result !== 'straight').length >= 2) {
      return 'safe';
    }

    // 2. Score vs par — only meaningful once ≥3 holes are scored
    const scoredHoles = round.filter((s) => s > 0).length;
    if (scoredHoles >= 3 && roundPars.length >= scoredHoles) {
      const totalStrokes = round.slice(0, scoredHoles).reduce((a, b) => a + b, 0);
      const totalPar    = roundPars.slice(0, scoredHoles).reduce((a, b) => a + b, 0);
      const diff = totalStrokes - totalPar;
      // 5+ over par through played holes → protect score
      if (diff >= 5) return 'safe';
      // 2+ under par → player is in form, press the advantage
      if (diff <= -2) return 'attack';
      // 3–4 over with only a few holes left → don't gamble
      if (diff >= 3 && hole >= 14) return 'safe';
    }

    // 3. Mental state
    if (mentalState === 'confident') return 'attack';
    if (mentalState === 'frustrated' || mentalState === 'pressure') return 'safe';

    // 4. Late-hole pressure — tighten to neutral if no other signal says attack
    if (hole >= 16) return 'neutral';

    return 'neutral';
  };

  /**
   * getConfidence
   * Returns a 0-100 confidence score for the current recommendation.
   * Baseline from shot count; bonus from consistent bias pattern.
   * Early-round (< 5 shots): intentionally lower — prevents overconfident
   * directional calls before an in-round pattern has established.
   */
  const getConfidence = (): number => {
    const hasProfileMiss = ppMiss && ppMiss !== 'straight';
    // < 5 shots: cap at 42 (no profile) or 50 (known profile miss) — "warming up" tier
    let base = shots.length < 5
      ? (hasProfileMiss ? 50 : 42)
      : shots.length < 10 ? 75 : 90;
    const mb = getMissBias();
    // Consistent bias pattern adds up to 8 pts
    if (mb && mb.bias !== 'straight' && mb.confidence >= 70) base = Math.min(98, base + 8);
    else if (mb && mb.confidence >= 55) base = Math.min(98, base + 4);
    // Struggling recent form reduces confidence slightly
    const ctx = getContextAdjustment();
    if (ctx === 'safe') base = Math.max(40, base - 10);
    if (ctx === 'attack') base = Math.min(98, base + 5);
    return base;
  };

  /**
   * getSwingTendencyAdjustment
   * Reads the player's persisted swing tendencies (faceAngle + swingPath +
   * ballStartBias + shotShapeTrend) from CaddieMemory and returns aim / club
   * adjustments when confidence is sufficient.
   *
   * Shot-shape strategy:
   *   Slice (start right, curve right) → avoid right hazards, aim left side
   *   Fade  (neutral start, curve right) → slight left aim, normal club
   *   Draw  (start left, curve right)   → aggressive lines, right-side aim ok
   *   Hook  (start left, curve left)    → aim right to offset, consider less club
   *   Push  (start right, stay right)   → aim left center
   *   Pull  (start left, stay left)     → aim right center
   *
   * Returns null when there is not enough data to make a swing-informed suggestion.
   */
  const getSwingTendencyAdjustment = (): {
    aimOverride:        'left center' | 'right center' | null;
    clubNote:           string | null;
    label:              string;
    detail:             string;
    avoidFade:          boolean;
    aggressiveLine:     boolean;   // true for draw players → use full attack line
    avoidRightHazard:   boolean;   // true for slice/push → steer away from right
    strategyAdjusted:   boolean;   // drives "Strategy adjusted for shot shape" badge
  } | null => {
    if (cmConfidence < 30 || cmUpdated === 0) return null;

    const face  = cmFaceAngle;
    const path  = cmSwingPath;
    const shape = cmShotShapeTrend;

    let aimOverride:       'left center' | 'right center' | null = null;
    let clubNote:          string | null = null;
    let detail             = '';
    let avoidFade          = false;
    let aggressiveLine     = false;
    let avoidRightHazard   = false;
    let hasAdjustment      = false;

    // ── Shot-shape rules (highest specificity — use tracking data) ────────────
    if (shape === 'slice') {
      aimOverride      = 'left center';
      avoidRightHazard = true;
      clubNote         = 'Aim well left — your slice will bring it back';
      detail           = 'Slice tendency — aim left side, avoid right hazards';
      hasAdjustment    = true;
    } else if (shape === 'fade') {
      aimOverride   = 'left center';
      clubNote      = 'Slight fade player — aim a fraction left';
      detail        = 'Fade tendency — aim left center';
      hasAdjustment = true;
    } else if (shape === 'draw') {
      aimOverride     = 'right center';
      aggressiveLine  = true;
      clubNote        = 'Draw player — use aggressive lines';
      detail          = 'Draw tendency — aim right, trust the curve';
      hasAdjustment   = true;
    } else if (shape === 'hook') {
      aimOverride   = 'right center';
      clubNote      = 'Strong hook — aim right and consider one less club';
      detail        = 'Hook tendency — aim right, reduce club to control shape';
      hasAdjustment = true;
    } else if (shape === 'push') {
      aimOverride      = 'left center';
      avoidRightHazard = true;
      detail           = 'Push tendency — aim left center to compensate';
      hasAdjustment    = true;
    } else if (shape === 'pull') {
      aimOverride   = 'right center';
      detail        = 'Pull tendency — aim right center to compensate';
      hasAdjustment = true;
    } else {
      // ── Fallback: face/path rules (no tracking data or straight player) ─────
      if (face === 'open') {
        aimOverride = 'left center';
        clubNote    = 'Consider one club less to stay within your natural shape';
        detail      = 'Open face — aim left, reduce club if needed';
        hasAdjustment = true;
      } else if (face === 'closed') {
        aimOverride = 'right center';
        detail      = 'Closed face — aim right to offset draw';
        hasAdjustment = true;
      }
      if (path === 'out-to-in') {
        avoidFade   = true;
        if (!aimOverride) aimOverride = 'left center';
        detail      = detail
          ? `${detail}; out-to-in path — avoid fade shots`
          : 'Out-to-in path — avoid fade shots, aim left';
        hasAdjustment = true;
      } else if (path === 'in-to-out') {
        aggressiveLine = true;
        if (!aimOverride) aimOverride = 'right center';
        detail = detail
          ? `${detail}; in-to-out path — play for a draw`
          : 'In-to-out path — play for a draw, aim right';
        hasAdjustment = true;
      }
    }

    if (!hasAdjustment) return null;

    return {
      aimOverride,
      clubNote,
      label:            'Strategy adjusted for shot shape',
      detail,
      avoidFade,
      aggressiveLine,
      avoidRightHazard,
      strategyAdjusted: true,
    };
  };

  /**
   * getCaddieDecision — single source of truth for ALL caddie output.
   * UI, voice, and AI all consume this object. No duplicate logic anywhere.
   *
   * Returns:
   *   club       — recommended club name
   *   aim        — 'center' | 'left center' | 'right center'
   *   aimLabel   — display label ("Aim Left Center" etc.)
   *   miss       — danger-side sentence ("Right miss is danger — aim left.")
   *   missColor  — hex colour matching the miss severity
   *   confidence — 0-100 integer
   *   distance   — numeric distance in play (GPS > target > hole default)
   *   mode       — current strategyMode
   *   context    — 'safe' | 'neutral' | 'attack' from in-round adaptation
   *   message    — full strategy sentence for card / voice
   *   voicePhrase — pre-built, ready-to-speak string
   *   aimOffset  — raw getAimOffset() result (for aim-diagram consumers)
   *   bias       — raw getMissBias() result (for dispersion-diagram consumers)
   */
  const getCaddieDecision = () => {
    const bias    = getMissBias();
    const context = getContextAdjustment();
    const recClub = getRecommendedClub() || '7i';
    const conf    = getConfidence();
    const ao      = getAimOffset();
    const sta     = getSwingTendencyAdjustment(); // swing-tendency overrides
    const dist    = targetDistance ?? gpsYards?.middle ?? currentHoleData?.distance ?? 150;

    // ── Early-round guard ──────────────────────────────────────────────────────
    // Fewer than 5 in-round shots: pattern hasn't established. Force neutral aim,
    // safe strategy, and capped confidence to prevent bad early calls.
    // Profile miss (ppMiss) is still used for club selection upstream — only the
    // directional aim / danger warning is neutralised here.
    if (shots.length < 5) {
      const earlyConf = Math.min(conf, 50);
      const distPart  = dist ? `${dist} yards.` : '';
      const clubPart  = recClub === '—' || !recClub ? 'Select a club.' : `${recClub}.`;
      const earlyPhrase = [distPart, clubPart, 'Aim Center.', 'Play neutral — building your pattern.'].filter(Boolean).join(' ');
      return {
        club:        recClub || '—',
        aim:         'center' as const,
        aimLabel:    'Play Center',
        miss:        'Play neutral — building your pattern.',
        missColor:   '#6ee7b7',
        confidence:  earlyConf,
        distance:    dist ?? null,
        mode:        strategyMode,
        context:     'safe' as const,
        message:     'Hit a few shots — your caddie is calibrating.',
        voicePhrase: earlyPhrase,
        aimOffset:   null,
        bias:        null,
      };
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Derive aim + miss from bias
    let aimKey: 'center' | 'left center' | 'right center' = 'center';
    let missText  = 'Ball flight is neutral — trust the center line.';
    let missColor = '#6ee7b7';
    if (bias?.bias === 'right') {
      aimKey    = 'left center';
      missText  = 'Right miss is danger — aim left.';
      missColor = '#93c5fd';
    } else if (bias?.bias === 'left') {
      aimKey    = 'right center';
      missText  = 'Left miss is danger — aim right.';
      missColor = '#fcd34d';
    }

    // Use richer aim offset miss text when available (getAimOffset may have exact yards)
    if (ao && ao.miss) { missText = ao.miss; missColor = ao.color; }

    // ── Swing-tendency override ───────────────────────────────────────────────────
    // Applied when confidence is high enough and no strong live-round bias exists
    // (live in-round data always takes priority over practice tendencies).
    if (sta && !bias) {
      if (sta.aimOverride) aimKey = sta.aimOverride;
      missText  = `${sta.detail}.`;
      missColor = sta.aimOverride === 'left center' ? '#93c5fd' : '#fcd34d';
    }

    // Aggressive line: draw players with no hazard override get an attack message
    const isAggressiveLine = !!(sta?.aggressiveLine && !bias);
    if (isAggressiveLine && missText === 'Ball flight is neutral — trust the center line.') {
      missText = 'Draw player — use an aggressive line.';
      missColor = '#86efac';
    }

    const aimLabel = aimKey === 'left center'  ? 'Aim Left Center'
                   : aimKey === 'right center' ? 'Aim Right Center'
                   : 'Play Center';

    const message = getStrategy();

    // Canonical voice phrase: "{dist} yards. {club}. Aim {aim}. {miss}"
    const distPart = dist  ? `${dist} yards.` : '';
    const clubPart = recClub === '—' || !recClub ? 'Select a club.' : `${recClub}.`;
    const aimPart  = `Aim ${aimLabel}.`;
    const voicePhrase = [distPart, clubPart, aimPart, missText].filter(Boolean).join(' ');

    return {
      club:       recClub || '—',
      aim:        aimKey,
      aimLabel,
      miss:       missText,
      missColor,
      confidence: conf,
      distance:   dist ?? null,
      mode:       strategyMode,
      context,
      message,
      voicePhrase,
      aimOffset:  ao,
      bias,
      swingTendency:    sta,
      strategyAdjusted: !!(sta?.strategyAdjusted),
      aggressiveLine:   isAggressiveLine,
    };
  };

  /**
   * buildVoicePhrase — thin wrapper around getCaddieDecision().
   * Kept for backward-compatibility with existing call-sites.
   * Optionally accepts an explicit distance override.
   * Canonical format: "{distance} yards. {club}. Aim {aim}. {miss}"
   */
  const buildVoicePhrase = (dist?: number | string): string => {
    const d = getCaddieDecision();
    const yards = dist ?? d.distance;
    const distPart  = yards ? `${yards} yards.` : '';
    const clubPart  = d.club === '—' ? 'Select a club.' : `${d.club}.`;
    const aimPart   = `Aim ${d.aimLabel}.`;
    const missPart  = d.miss;
    return [distPart, clubPart, aimPart, missPart].filter(Boolean).join(' ');
  };

  /**
   * buildAdvancedCoachingPhrase
   * Combines shot history (missBias, recent pattern) with swing analysis
   * (faceAngle, swingPath from CaddieMemory) to produce a single, natural-
   * sounding coaching sentence ready for ElevenLabs.
   *
   * Returns null when there is insufficient data for a meaningful phrase
   * (prevents generic or redundant output on early rounds).
   */
  const buildAdvancedCoachingPhrase = (): string | null => {
    const d        = getCaddieDecision();
    const face     = cmFaceAngle;   // 'open' | 'closed' | 'square'
    const path     = cmSwingPath;   // 'in-to-out' | 'out-to-in' | 'neutral'
    const bias     = cmMissBias;    // 'left' | 'right' | 'neutral'
    const conf     = cmConfidence;
    const hasSwing = conf >= 30 && cmUpdated !== 0;

    // Live in-round shots give richer context — use them when available
    const liveBias = d.bias?.bias ?? null;  // 'right' | 'left' | null

    // ── Scenario 1: swing data + shot history both point the same way ──────
    if (hasSwing && (liveBias || bias !== 'neutral')) {
      const effectiveBias = liveBias ?? (bias !== 'neutral' ? bias : null);

      if (effectiveBias === 'right' && face === 'open') {
        const aimLine = d.aim === 'left center' ? 'left edge' : 'left center';
        return `You've got an open face and a right miss tendency. Let's aim ${aimLine} and commit.`;
      }
      if (effectiveBias === 'right' && path === 'out-to-in') {
        return `Your path is out-to-in and you're missing right — classic fade spin. Aim left center and swing easy through it.`;
      }
      if (effectiveBias === 'right' && face === 'open' && path === 'out-to-in') {
        return `Open face, out-to-in path, missing right — that's a slice pattern. Aim well left and feel the face close through impact.`;
      }
      if (effectiveBias === 'left' && face === 'closed') {
        const aimLine = d.aim === 'right center' ? 'right center' : 'right side';
        return `Closed face and left miss tendency showing. Aim ${aimLine} and hold your finish high.`;
      }
      if (effectiveBias === 'left' && path === 'in-to-out') {
        return `In-to-out path with a left bias — you're releasing too early. Aim right center and hold the lag a beat longer.`;
      }
    }

    // ── Scenario 2: swing data only (no strong live in-round pattern yet) ──
    if (hasSwing && face !== 'square') {
      if (face === 'open' && path === 'out-to-in') {
        return `Practice data shows an open face and out-to-in swing. Let's play left edge — stay committed.`;
      }
      if (face === 'open') {
        return `Your swing data shows an open face pattern. Aim just left of the flag and trust the adjustment.`;
      }
      if (face === 'closed') {
        return `Closed face tendency from practice. Aim slightly right and hold the face through impact.`;
      }
    }

    // ── Scenario 3: shot history only (no swing analysis available) ────────
    if (liveBias === 'right') {
      return `You're trending right today. Aim left center — pick a spot and fire at it.`;
    }
    if (liveBias === 'left') {
      return `Left miss pattern building. Aim right center and stay balanced through the ball.`;
    }

    // ── Not enough data ─────────────────────────────────────────────────────
    return null;
  };

  /**
   * speakDecision — canonical voice trigger.
   * Reads getCaddieDecision() and produces the standardised phrase:
   *   "{distance} yards. {club}. Aim {aim}. {miss}"
   * When advanced coaching data is available (swing + shot history), prepends
   * a human-like coaching sentence to the standard decision phrase.
   * Routes through the speak() pipeline (rate-limit + voice style + gender).
   */
  const speakDecision = (distOverride?: number | string): void => {
    const d = getCaddieDecision();
    const yards = distOverride ?? d.distance;

    // Standard decision phrase: "{dist} yards. {club}. Aim {aim}. {miss}"
    const standardPhrase = [
      yards ? `${yards} yards.` : '',
      d.club === '—' ? 'Select a club.' : `${d.club}.`,
      `Aim ${d.aimLabel}.`,
      d.miss,
    ].filter(Boolean).join(' ');

    // Prepend advanced coaching sentence when data is rich enough.
    // Only fires when the round is active (5+ shots or strong CaddieMemory data)
    // to avoid generic phrases on the first hole.
    const advancedPhrase = (shots.length >= 5 || cmConfidence >= 30)
      ? buildAdvancedCoachingPhrase()
      : null;

    const fullText = advancedPhrase
      ? `${advancedPhrase} ${standardPhrase}`
      : standardPhrase;

    void speak(fullText);
  };

  // Legacy alias — keep getDecision() pointing to getCaddieDecision() so any
  // remaining call-sites still compile without change.
  const getDecision = () => {
    const d = getCaddieDecision();
    return { club: d.club, aim: d.aimLabel, confidence: d.confidence, message: d.message };
  };

  const coachPhrases = ["Alright —", "Here's the play —", "Stay with me —"];
  const coachTone = (message: string) => `${coachPhrases[Math.floor(Math.random() * coachPhrases.length)]} ${message}`;
  const addEncouragement = (message: string) => Math.random() > 0.5 ? message + " You're close — trust it." : message;

  const coachingMessages: Record<string, string[]> = {
    right: [
      'Starting to leak right. Keep the face square.',
      'Right again — check your alignment.',
      "You're drifting right — stay connected through it.",
      'That slipped right. Square the face at impact.',
    ],
    left: [
      'Pulled that one. Ease your tempo.',
      'Left miss — stay balanced through the ball.',
      'Coming over the top. Trust the inside path.',
      'Pulled left. Let the club release naturally.',
    ],
    straight: [
      'Great shot. Stay with that.',
      'Pure strike. Repeat that.',
      "Right on the line. That's your move.",
      'Dialed in. Lock that feeling in.',
    ],
  };

  const getCoaching = (result: string): string => {
    const options = coachingMessages[result] ?? ['Stay focused. Next shot.'];
    return options[Math.floor(Math.random() * options.length)];
  };

  // Pattern escalation: if the same miss occurs 3+ times in a row, acknowledge it
  const patternMessages: Record<string, string[]> = {
    right: [
      "You're consistently missing right — stay patient through it.",
      "Three right in a row — back off the pace and let it release.",
      "That's a pattern right now — trust the inside path and commit.",
    ],
    left: [
      "You're consistently pulling left — ease the tempo and trust it.",
      "Three left misses — slow down and stay on plane.",
      "That's a pattern pulling left — breathe and let the club do the work.",
    ],
    straight: [
      "Three straight — you're locked in, keep trusting it.",
      "Consistent contact — don't change a thing.",
      "You're repeating it perfectly — stay in this zone.",
    ],
  };

  const getPatternCoaching = (result: string, recentShots: Shot[]): string => {
    const last3 = recentShots.slice(-3);
    const isPattern = last3.length === 3 && last3.every((s) => s.result === result);
    if (isPattern) {
      const options = patternMessages[result] ?? coachingMessages[result] ?? ['Stay focused.'];
      return options[Math.floor(Math.random() * options.length)];
    }
    return getCoaching(result);
  };

  const getHoleStrategy = () => {
    const completedStrokes = round.reduce((sum, s) => sum + (s || 0), 0);
    const completedPar = roundPars.reduce((sum, p) => sum + (p || 0), 0);
    const scoreDiff = completedStrokes - completedPar;

    if (par === 3) {
      return 'Par 3 — take dead aim and trust it.';
    }
    if (par === 5) {
      if (scoreDiff <= 0) return "Par 5 — opportunity here, let's go after it.";
      return 'Par 5 — play in segments and stay out of trouble.';
    }
    if (par === 4) {
      if (scoreDiff >= 3) return 'Par 4 — fairway first, keep it smart.';
      return 'Par 4 — pick a smart target and commit.';
    }
    return '';
  };

  const getStrategy = () => {
    const dist = parseInt(distance, 10) || 150;
    const miss = playerProfile.commonMiss;

    // Early-round guard — fewer than 5 shots, no reliable pattern yet.
    // Force safe/neutral strategy regardless of strategyMode or context.
    if (shots.length < 5) {
      return 'Play safe — build your pattern first. Centre green.';
    }

    // Manual override always wins
    if (strategyMode === 'safe') {
      if (dist > 180) return 'Lay up. Avoid the big number.';
      return 'Center green. Safe club. Bogey is fine.';
    }
    if (strategyMode === 'attack') {
      if (dist < 130) return 'Fire at the flag. Commit fully.';
      if (dist < 180) return 'Attack the pin. Aggressive line.';
      return 'Go for it — pick your line and trust it.';
    }

    // neutral — let context adjustment narrow it further
    const ctx = getContextAdjustment();
    if (ctx === 'safe') {
      if (dist > 180) return 'Shots are off — lay up and reset.';
      return 'Keep it simple. Center green, take your medicine.';
    }
    if (ctx === 'attack') {
      if (dist < 150) return 'You\'re locked in. Attack this pin.';
      return 'Feeling good — pick an aggressive line and commit.';
    }
    if (handicapIndex > 20) {
      if (dist > 150) return 'Focus on contact. Lay up and keep it safe.';
      return 'Focus on contact. No big numbers — stay safe.';
    }
    if (handicapIndex < 10) {
      if (dist < 160) return 'You can attack this pin. Trust your swing.';
      return 'You have the game for this. Pick your line and commit.';
    }
    if (goalMode === 'beginner') {
      if (dist > 150) return 'No big numbers. Centre green — safe side always.';
      if (dist > 100) return 'Pick the middle of the green and make contact.';
      return 'Short shot — smooth swing, no hero attempt.';
    }
    if (goalMode === 'break90') {
      if (dist < 150) return 'Attack the pin if the approach is clear.';
      return 'Aggressive but controlled — pick your line.';
    }
    if (goalMode === 'break80') {
      if (dist < 130) return 'Fire at the flag. Own this shot.';
      if (dist < 180) return 'Attack the pin — you have the game for this.';
      return 'Commit to an aggressive line and trust your swing.';
    }
    if (miss === 'right') return 'Favor the left side a touch.';
    if (miss === 'left') return 'Shade it right to compensate.';
    return 'Play your stock shot and trust it.';
  };

  const getFullCaddieDecision = () => {
    if (shots.length < 5) return coachTone("let's get more swings in first.");

    const bestClub = getBestClub();
    const dispersion = getDispersion();
    const lastClub = club;

    const parts: string[] = [];

    // Auto strategy based on dispersion confidence
    const confidence = getConfidenceLevel();
    let autoStrategy = '';
    if (confidence === 'wide' && strategyMode === 'attack') {
      autoStrategy = "We can still go for it — but let's be smart about it.";
    } else if (confidence === 'wide') {
      autoStrategy = "Things are a bit loose — let's play this safe.";
    } else if (confidence === 'tight' && strategyMode === 'safe') {
      autoStrategy = "You're dialed in — we could be a bit more aggressive here.";
    } else if (confidence === 'tight') {
      autoStrategy = "You're dialed in — let's be aggressive.";
    }
    if (autoStrategy) parts.push(autoStrategy);

    const holeStrategy = getHoleStrategy();
    if (holeStrategy) parts.push(holeStrategy);

    const strategyTone = strategyMode === 'attack'
      ? "Trust your swing and commit to it."
      : strategyMode === 'safe' ? "Let's play this smart and stay in control."
      : "Pick your target and stay committed.";
    parts.push(strategyTone);

    // Prefer live GPS distance over the typed distance string for accuracy.
    const liveDist = targetDistance ?? gpsYards?.middle ?? (parseInt(distance, 10) || null);
    if (liveDist && bestClub) {
      parts.push(`${liveDist} out — I like ${bestClub} here.`);
    }

    // Yardage remaining after current club
    const yardageLeft = getYardageLeft();
    if (yardageLeft !== null && yardageLeft > 30) {
      const nextSuggestion = recommendClubForDistance(yardageLeft);
      parts.push(`Your ${club} gets you ~${Object.fromEntries(getClubYardageMap())[club] ?? '?'} yards, leaving ~${yardageLeft} yards — setting up a ${nextSuggestion} for your next shot.`);
    } else if (yardageLeft !== null && yardageLeft <= 30) {
      parts.push(`Your ${club} should get you to the green from here.`);
    }

    if (lastClub !== bestClub && bestClub) {
      if (strategyMode === 'safe') {
        parts.push(`${lastClub} hasn't been great today — go with the ${bestClub}.`);
      } else {
        parts.push(`${lastClub} is workable — commit and make a good swing.`);
      }
    }

    if (dispersion !== null && dispersion >= 3) {
      parts.push("You're leaking right — favor the left side.");
    } else if (dispersion !== null && dispersion <= -3) {
      parts.push("You've been pulling left — shade it right.");
    }

    if (dispersion !== null && dispersion >= 2 && !aim.includes('left')) {
      parts.push(`Aim ${aim === 'center' ? 'left center' : 'left edge'} and trust it.`);
    } else if (dispersion !== null && dispersion <= -2 && !aim.includes('right')) {
      parts.push(`Aim ${aim === 'center' ? 'right center' : 'right edge'} and commit.`);
    } else {
      const target = getTargetRecommendation();
      if (target) parts.push(`${target} — ${strategyMode === 'attack' ? 'fire at the flag.' : 'stay committed.'}`);
    }

    // Pressure: late holes
    if (hole >= 16) {
      parts.push("This is a key stretch — stay composed.");
    }

    // Score vs par status
    if (round.length > 0 && roundPars.length > 0) {
      const totalStrokes = round.reduce((sum, s) => sum + (s || 0), 0);
      const totalPar = roundPars.reduce((sum, p) => sum + (p || 0), 0);
      const scoreDiff = totalStrokes - totalPar;
      if (scoreDiff >= 3) {
        parts.push("You're over par — play smart and go center.");
      } else if (scoreDiff <= -1) {
        parts.push("You're under par — back yourself a bit.");
      }
    }

    // Player memory
    const memory = getPlayerMemory();
    if (memory !== 'Building player profile...') parts.push(memory);

    // Hole-specific conditions from course data — use computed hazard distances when available
    const haz = getHazardDistances();
    const note = currentHoleData.note.toLowerCase();
    if (haz.water !== null) {
      if (note.includes('short') || note.includes('carry') || note.includes('over'))
        parts.push(`Carry the water at ${haz.water} yards — take enough club.`);
      else
        parts.push(`Water hazard ~${haz.water} yards out — play for the safe side.`);
    } else if (note.includes('water')) {
      parts.push('Water in play — take the safe side.');
    }
    if (haz.bunker !== null)
      parts.push(`Bunker at ~${haz.bunker} yards — take one more club to clear it.`);
    else if (note.includes('bunker'))
      parts.push('Bunker in play — go one more club to clear it.');
    if (note.includes('tight')) parts.push('Tight fairway — grip down and stay in play.');
    if (note.includes('dogleg')) parts.push('Play to the corner of the dogleg.');
    if (note.includes('layup')) parts.push('This is a layup hole — pick your landing zone.');
    if (currentHoleData.distance > 500) parts.push('Long hole — think in segments.');

    // Swing fix
    const fix = getSwingFix();
    if (!fix.includes('Hit a few') && !fix.includes('balanced')) parts.push(fix);

    // Club-specific miss pattern
    const clubMiss = getClubMiss(club);
    if (clubMiss === 'right') parts.push(`You tend to miss right with the ${club} — favor the left side.`);
    else if (clubMiss === 'left') parts.push(`You tend to miss left with the ${club} — favor the right side.`);

    // Global profile — miss tendency
    playerProfile.preferredStrategy = strategyMode === 'attack' ? 'aggressive' : strategyMode === 'neutral' ? 'safe' : strategyMode;
    if (playerProfile.commonMiss === 'right') parts.push("Your miss is right — favor the left side.");
    else if (playerProfile.commonMiss === 'left') parts.push("Your miss is left — shade it right.");

    return addEncouragement(coachTone(parts.join(' ')));
  };

  // Caddie says — ≤12 words, direct and clear
  const getShortCaddieDecision = (): string => {
    if (shots.length < 5) return coachTone("let's get more swings in first.");
    const full = getFullCaddieDecision();
    const w = full.trim().split(/\s+/);
    return w.length <= 12 ? full : w.slice(0, 12).join(' ') + '.';
  };

  // -- AI Caddie Brain: full-context OpenAI advice with ElevenLabs voice --------
  // Ref-based in-flight guard so concurrent GPS ticks can't stack API calls.
  const caddieCallInFlightRef = useRef(false);
  const handleCaddie = async () => {
    if (caddieCallInFlightRef.current) return; // already in progress
    try {
      caddieCallInFlightRef.current = true;
      setAiThinking(true);
      setIsThinking(true); // drive the fullscreen overlay

      // Club-specific dispersion (miss pattern for the current club)
      const dispersionModel = getClubMissDispersion(shots, club);

      // GPS-aware strategy: aim point + hazard avoidance
      const rawCoords = gpsCoordsRef.current;
      const playerLocation = rawCoords
        ? { latitude: rawCoords.latitude, longitude: rawCoords.longitude }
        : null;
      const currentHoleLayout = (holeData as Record<string, any>)[String(hole)] ?? null;
      const strategy = getTargetStrategy({ playerLocation, hole: currentHoleLayout, dispersion: dispersionModel });

      // Club distance learning
      const learnedClubDist = computeClubDistances(shots);
      const distanceToPin = gpsYards?.middle ?? (parseInt(distance, 10) || (currentHoleData?.distance ?? 150));
      const aiClub = selectClub(distanceToPin, learnedClubDist);
      setAiClubHint(aiClub);

      const advice = await getAICaddieAdvice({
        hole,
        distance: gpsYards?.middle ?? (parseInt(distance, 10) || (currentHoleData?.distance ?? 150)),
        lie: 'fairway',
        wind: 'calm',
        playerProfile: {
          commonMiss: ppMiss,
          miss: ppMiss,
          strength: ppStrength,
          struggle: ppStruggle,
          limitation: ppLimitation,
          preferredStrategy: strategyMode,
        },
        shots,
        mode: strategyMode,
        strategy: strategy?.strategyNote,
        dispersion: dispersionModel.tendency,
        recommendedClub: aiClub,
        clubStats: Object.keys(learnedClubDist).length > 0 ? learnedClubDist : null,
      });
      setCaddieMessage(advice);
      // Route caddie voice through the local speak hook so it respects quietMode, voiceEnabled,
      // and shares the same in-flight guard as all other voice calls on this screen.
      void speak(advice);
    } catch (err) {
      console.log('[handleCaddie] error:', err);
    } finally {
      caddieCallInFlightRef.current = false;
      setAiThinking(false);
      setIsThinking(false);
    }
  };

  // -- Smart GPS trigger: auto-call caddie when player moves 10+ yards ----------
  // Fires on every GPS update but only escalates to the OpenAI / ElevenLabs
  // pipeline when the distance to the pin has changed by ≥10 yards since the
  // last caddie call. Prevents spam while still keeping advice current.
  const lastCaddieDistanceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isRoundActive) return;
    const yards = gpsYards?.middle;
    if (!yards || yards < 1 || yards > 700) return;
    const last = lastCaddieDistanceRef.current;
    if (last === null || Math.abs(yards - last) >= 10) {
      lastCaddieDistanceRef.current = yards;
      void handleCaddie();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsYards]);

  const askCaddie = () => {
    let message = '';

    if (caddieMode === 0) {
      message = getContextualCaddieResponse() || getFullCaddieDecision();
    } else if (caddieMode === 1) {
      message = 'Stay smooth. Commit to your line and let it go.';
    } else if (caddieMode === 2) {
      message = getAimInsights() || 'Stay still through impact and follow it through.';
    }

    if (!message) return;
    respond(message);
    setCaddieMode((prev) => (prev + 1) % 3);
  };

  // speakCaddie -- routes through voiceSpeak for unified rate-limiting + stop behaviour
  const speakCaddie = (text: string): void => voiceSpeak(text, 'calm');

  const { respond, getTempoCue, checkMissPattern, getFrustrationReply, proactiveCoach, setVoiceGender, setMuted, getSpeakOpts, handleSpeech, startMaxWindow, cancelSilence } = useVoiceCaddie();

  // Keep the hook's mute gate in sync whenever quietMode or voiceEnabled changes
  useEffect(() => { setMuted(quietMode, voiceEnabled); }, [quietMode, voiceEnabled, setMuted]);

  // -- Watch Motion / Swing Detector -----------------------------------------
  const setLastSwing = useSwingStore((s) => s.setLastSwing);
  const [swingToast, setSwingToast] = useState<string | null>(null);
  const [swingTempoLabel, setSwingTempoLabel] = useState<string | null>(null);
  const swingToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep getSpeakOpts in a ref so the stable onSwing closure always calls the latest version
  const getSpeakOptsRef = useRef(getSpeakOpts);
  getSpeakOptsRef.current = getSpeakOpts;

  const playSound = async (asset: any) => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(asset, { shouldPlay: true, volume: 1.0 });
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) sound.unloadAsync();
      });
    } catch (_) {}
  };

  const swingDetector = useSwingDetector({
    onSwing: ({ tempo, tempoMs }) => {
      const feedback = getSwingFeedback(tempo);
      playSound(SWING_SWOOSH_SFX);
      void voiceSpeak(feedback, 'calm');
      setLastSwing(tempo, tempoMs);
      setSwingToast(feedback);
      setSwingTempoLabel(tempo);
      if (swingToastTimerRef.current) clearTimeout(swingToastTimerRef.current);
      swingToastTimerRef.current = setTimeout(() => setSwingToast(null), 2500);
    },
  });

  // Auto-start swing detection when the Play screen mounts; stop on unmount
  useEffect(() => {
    swingDetector.start();
    return () => {
      swingDetector.stop();
      if (swingToastTimerRef.current) clearTimeout(swingToastTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Round-start greeting — fires once on mount, after a short delay so the UI is settled
  const hasGreetedRef = useRef(false);
  useEffect(() => {
    if (hasGreetedRef.current) return;
    hasGreetedRef.current = true;
    // Sync persisted profile into the session singleton so all advice functions pick it up
    if (ppMiss && ppMiss !== 'straight') {
      playerProfile.commonMiss = ppMiss as 'left' | 'right';
      playerProfile.miss = ppMiss as 'left' | 'right';
    }
    if (ppStrength === 'accuracy' || ppStrength === 'consistency') {
      playerProfile.strength = 'straight';
    }
    const openings = [
      "Let's go. Smooth tempo — trust your swing.",
      "Ready to play. Pick your target and commit.",
      "Good. One shot at a time — keep it simple.",
      "Let's do this. Stay present and stay patient.",
    ];
    const msg = openings[Math.floor(Math.random() * openings.length)];
    setTimeout(() => {
      void voiceSpeak(msg, 'calm');
    }, 1200);
  }, [ppMiss, ppStrength, voiceSpeak]);

  const getYardage = () => {
    return `${currentHoleData.distance} yards to the hole.`;
  };

  // Helper — cap any caddie reply at 12 words (single sentence / display line)
  const trimTo12 = (msg: string): string => {
    const w = msg.trim().split(/\s+/);
    return w.length <= 12 ? msg : w.slice(0, 12).join(' ') + '.';
  };

  // Returns bunker and water yardages derived from hole note + par/distance heuristics
  const getHazardDistances = (): { hole: number; bunker: number | null; water: number | null } => {
    const dist = targetDistance ?? gpsYards?.middle ?? currentHoleData?.distance ?? 150;
    const note = currentHoleData.note.toLowerCase();
    // Bunker yardage — typically 30-40 yds short of the green for fairway bunkers
    let bunker: number | null = null;
    if (note.includes('bunker')) {
      bunker = note.includes('bunker right') || note.includes('bunker left')
        ? Math.round(dist * 0.78)   // fairway bunker ~78% of hole distance
        : Math.round(dist * 0.60);  // front bunker closer in
    }
    // Water yardage — typically carries across the hazard from current position
    let water: number | null = null;
    if (note.includes('water') || note.includes('lake') || note.includes('creek') || note.includes('hazard')) {
      if (note.includes('short') || note.includes('front'))  water = Math.round(dist * 0.55);
      else if (note.includes('right') || note.includes('left')) water = Math.round(dist * 0.88);
      else if (note.includes('carry') || note.includes('over')) water = Math.round(dist * 0.50);
      else water = Math.round(dist * 0.70);
    }
    return { hole: dist, bunker, water };
  };

  // ── Yardage remaining after current club selection ────────────────────
  // Returns the # of yards still left to the pin after the selected club's
  // expected carry. Returns null when either piece of data is missing.
  const getYardageLeft = (): number | null => {
    const totalYds = targetDistance ?? gpsYards?.middle ?? currentHoleData?.distance ?? null;
    if (totalYds == null) return null;
    const yardMap = Object.fromEntries(getClubYardageMap());
    const clubYds = yardMap[safeClub] ?? null;
    if (clubYds == null) return null;
    const left = totalYds - clubYds;
    return left > 0 ? left : 0;
  };

  // Returns the best club for the current yardage using learned distances first,
  // falling back to static defaults. This keeps the CADDIE badge and all voice
  // advice consistent with the auto-GPS recommendation.
  const getRecommendedClub = (): string => {
    const dist = targetDistance ?? gpsYards?.middle ?? currentHoleData?.distance ?? 150;
    return recommendClubForDistance(dist) || '7i';
  };

  const getClubAdvice = (): string => {
    const activeMiss = playerProfile.miss ?? (ppMiss !== 'straight' ? ppMiss : null);
    const activeStrength = playerProfile.strength ?? (ppStrength === 'accuracy' || ppStrength === 'consistency' ? 'straight' : null);
    if (activeMiss === 'right') return `Start it just left of the flag and let the ${getRecommendedClub()} work.`;
    if (activeMiss === 'left') return `Favor the right side — go with the ${getRecommendedClub()} and make a smooth pass.`;
    if (activeStrength === 'straight') return `You're dialed in — go right at it with the ${getRecommendedClub()}.`;
    return `Go with a smooth ${getRecommendedClub()}.`;
  };

  const getSituationalAdvice = (): string | null => {
    if (strokes >= 3) return "Let's just get it back in play.";
    if (strokes === 1) return 'Smooth swing. Start the hole clean.';
    return null;
  };

  const getSmartInsight = (): string | null => {
    const activeMiss = playerProfile.miss ?? (ppMiss !== 'straight' ? ppMiss : null);
    const activeStrength = playerProfile.strength ?? (ppStrength === 'accuracy' || ppStrength === 'consistency' ? 'straight' : null);
    if (activeMiss === 'right' && strokes >= 2) return "You've been leaking right this hole. Pick a stronger line and commit.";
    if (activeMiss === 'left' && strokes >= 2) return "You're pulling it left. Stay through the ball and let the club do the work.";
    if (activeStrength === 'straight') return "You're hitting it pure. Stay aggressive.";
    if (ppStruggle === 'driver' && strokes === 0) return "Driver day — commit to the line, smooth and through.";
    if (ppStruggle === 'mental') return "Pick your target, trust it, commit. One shot at a time.";
    return null;
  };

  const getDeepCoaching = () => {
    let msg = "Here's what I'm seeing. ";
    let offTee = 0; let approach = 0;
    shots.forEach((shot, i) => {
      if (shot.result !== 'straight') { if (i === 0) offTee++; else if (i === 1) approach++; }
    });
    if (offTee > 0) msg += `Tee shots are costing you ${offTee} shot${offTee > 1 ? 's' : ''}. `;
    if (approach > 0) msg += `Approach shots costing you ${approach}. `;
    let right = 0; let left = 0;
    shots.forEach((s) => { if (s.result === 'right') right++; if (s.result === 'left') left++; });
    if (right > left) msg += "Miss is right — check your face angle and swing path. ";
    else if (left > right) msg += "Miss is left — slow the release and stay connected. ";
    msg += "Work on that in your next range session.";
    return msg;
  };

  const getRelevantSwing = () => {
    if (savedSwings.length === 0) return null;
    let right = 0; let left = 0;
    shots.forEach((s) => { if (s.result === 'right') right++; if (s.result === 'left') left++; });
    if (right > left) return savedSwings.find((s) => s.result === 'right') ?? savedSwings[0];
    if (left > right) return savedSwings.find((s) => s.result === 'left') ?? savedSwings[0];
    return savedSwings[0];
  };

  const handleVoiceCommand = async (transcript: string) => {
    const lower = transcript.toLowerCase();

    // Show "Thinking—" state immediately
    setIsThinking(true);
    setCommandResponse('');

    const reply = (msg: string) => {
      setIsThinking(false);
      setCommandResponse(msg);
    };

    // Emotional awareness — catch frustration before anything else
    const calmReply = getFrustrationReply(lower);
    if (calmReply) {
      reply(calmReply);
      respond(calmReply);
      return;
    }

    let detectedClub = club;
    let detectedResult: string | null = null;

    // Rules questions — try local first, fall back to OpenAI for anything unrecognized
    if (
      lower.includes('rule') || lower.includes('penalty') ||
      lower.includes('free relief') || lower.includes('drop') ||
      lower.includes('out of bounds') || lower.includes('ob') ||
      lower.includes('unplayable') || lower.includes('water hazard') ||
      lower.includes('can i') || lower.includes('am i allowed') ||
      lower.includes('is it legal') || lower.includes('what happens if')
    ) {
      let rulesMsg = '';
      if (lower.includes('free relief') || lower.includes('relief')) {
        rulesMsg = 'Free relief here — drop within one club of the nearest point, no closer to the hole.';
      } else if (lower.includes('out of bounds') || lower.includes('ob')) {
        rulesMsg = "Stroke and distance. Play a provisional if there's any doubt. Rule 18.";
      } else if (lower.includes('unplayable')) {
        rulesMsg = 'For an unplayable lie you have three options: stroke and distance, two club lengths no closer to hole, or back on a line from the hole. All cost one stroke. Rule 19.';
      } else if (lower.includes('water') || lower.includes('hazard') || lower.includes('penalty area')) {
        rulesMsg = 'Penalty area is one stroke. Drop behind where it crossed on a line from the hole, or replay from the original spot. Rule 17.';
      } else if (lower.includes('mark') || lower.includes('lift')) {
        rulesMsg = 'Place a marker directly behind the ball before lifting. You may clean it on the green. Rule 14.1.';
      } else {
        // Unknown rule — ask OpenAI
        const aiRules = await callOpenAI(transcript, getAIContext());
        if (aiRules) {
          reply(aiRules);
          respond(aiRules);
        } else {
          const fallback = "Tell me the specific situation and I'll walk you through the rule.";
          reply(fallback);
          respond(fallback);
        }
        return;
      }
      reply(rulesMsg);
      respond(rulesMsg);
      return;
    }

    // Swing coaching video trigger
    if (lower.includes('show swing') || lower.includes('show me')) {
      const swing = getRelevantSwing();
      if (swing) {
        setCoachingSwing(swing);
        setShowCoachingVideo(true);
        respond(getSwingInsight());
      } else {
        respond("Nothing saved yet — let's get one on video.");
      }
      return;
    }

    // Swing analysis trigger
    if (lower.includes('swing') || lower.includes('analyze') || lower.includes('my pattern') || lower.includes('my miss')) {
      const insight = trimTo12(getSwingInsight());
      reply(insight);
      respond(insight);
      return;
    }

    // Club recommendation — responds with standardised decision phrase (distance. club. aim. miss)
    if (lower.includes('what should i hit') || lower.includes('what club') || lower.includes('which club')) {
      const d = getCaddieDecision();
      const dist = targetDistance ?? gpsYards?.middle ?? currentHoleData?.distance ?? 150;
      const phrase = buildVoicePhrase(dist);
      reply(phrase);
      speakDecision(dist);
      return;
    }

    // Fix coaching trigger
    if (lower.includes('fix') || lower.includes('how do i fix') || lower.includes('what should i do')) {
      const fix = getSwingFixData();
      if (fix) {
        const msg = trimTo12(`${fix.title}. ${fix.fix}.`);
        reply(msg);
        respond(msg);
      } else {
        const msg = "Hit a few more — read coming soon.";
        reply(msg);
        respond(msg);
      }
      return;
    }

    // Deep coaching trigger
    if (lower.includes('why') || lower.includes('explain') || lower.includes('more detail') || lower.includes('what happened')) {
      const deep = getDeepCoaching();
      reply(deep);
      respond(deep);
      return;
    }

    // Strategy mode commands — "play safe", "go for it", "play normal"
    if (lower.includes('play safe') || lower.includes('go safe') || lower.includes('lay up')) {
      setStrategyMode('safe');
      const msg = 'Playing safe. Center green target.';
      reply(msg);
      respond(msg);
      return;
    }
    if (lower.includes('go aggressive') || lower.includes('play aggressive') || lower.includes('go for it') || lower.includes('attack the pin')) {
      setStrategyMode('attack');
      const msg = 'Going aggressive. Attack the pin.';
      reply(msg);
      respond(msg);
      return;
    }
    if (lower.includes('play normal') || lower.includes('reset strategy') || lower.includes('back to normal')) {
      setStrategyMode('neutral');
      const msg = 'Back to neutral strategy.';
      reply(msg);
      respond(msg);
      return;
    }

    // Low power mode commands
    if (lower.includes('low power') || lower.includes('power save') || lower.includes('battery mode') || lower.includes('save battery')) {
      const next = !lowPowerMode;
      toggleLowPowerMode(next);
      const msg = next ? 'Low power mode on. Screen dimmed, voice active.' : 'Low power mode off. Full display restored.';
      reply(msg);
      respond(msg);
      return;
    }

    // Voice style commands
    if (lower.includes('voice calm') || lower.includes('caddie calm') || lower.includes('calm voice')) {
      setVoiceStyle('calm');
      const msg = 'Calm voice on. Measured and clean.';
      reply(msg);
      respond(msg);
      return;
    }
    if (lower.includes('voice aggressive') || lower.includes('caddie aggressive') || lower.includes('aggressive voice') || lower.includes('fire up')) {
      setVoiceStyle('aggressive');
      const msg = 'Aggressive voice on. Locked and loaded.';
      reply(msg);
      respond(msg);
      return;
    }

    // Player mode commands
    if (lower.includes('beginner mode') || lower.includes('beginner')) {
      setGoalMode('beginner');
      const msg = 'Beginner mode on. Safe targets, no big numbers.';
      reply(msg);
      respond(msg);
      return;
    }
    if (lower.includes('break ninety') || lower.includes('break 90') || lower.includes('break90')) {
      setGoalMode('break90');
      const msg = 'Break 90 mode. Controlled aggression.';
      reply(msg);
      respond(msg);
      return;
    }
    if (lower.includes('break eighty') || lower.includes('break 80') || lower.includes('break80')) {
      setGoalMode('break80');
      const msg = 'Break 80 mode. Attack mode engaged.';
      reply(msg);
      respond(msg);
      return;
    }

    // Hazard distance queries — bunker / water / pin
    if (
      lower.includes('bunker') ||
      lower.includes('water') || lower.includes('lake') || lower.includes('creek') ||
      (lower.includes('how far') && (lower.includes('hazard') || lower.includes('carry'))) ||
      lower.includes('distance to the hole') || lower.includes('how far to the hole') ||
      lower.includes('to the pin') || lower.includes('pin distance')
    ) {
      const haz = getHazardDistances();
      if (lower.includes('bunker')) {
        const msg = haz.bunker
          ? trimTo12(`Bunker is ~${haz.bunker} yards out.`)
          : 'No bunker data for this hole.';
        reply(msg); respond(msg);
      } else if (lower.includes('water') || lower.includes('lake') || lower.includes('creek') || (lower.includes('how far') && lower.includes('hazard'))) {
        const msg = haz.water
          ? trimTo12(`Water carry is ~${haz.water} yards.`)
          : 'No water hazard on this hole.';
        reply(msg); respond(msg);
      } else {
        const msg = trimTo12(`${haz.hole} yards to the middle of the green.`);
        reply(msg); respond(msg);
      }
      return;
    }

    // Yardage / club distance trigger
    if (lower.includes('yardage') || lower.includes('distance') || lower.includes('how far') || lower.includes('my distance')) {
      const y = getYardages();
      let msg = '';
      if (y.front !== null && y.middle !== null && y.back !== null) {
        msg = `${y.front} front, ${y.middle} middle, ${y.back} back.`;
      } else {
        msg = trimTo12(`${getYardage()}`);
      }
      reply(msg);
      respond(msg);
      return;
    }

    // Shot logging — explicit "log <direction>" commands
    if (lower.includes('log left')) {
      handleShot('left');
      reply('Left logged.');
      respond('Left logged.');
      return;
    }
    if (lower.includes('log right')) {
      handleShot('right');
      reply('Right logged.');
      respond('Right logged.');
      return;
    }
    if (lower.includes('log straight') || lower.includes('log center')) {
      handleShot('straight');
      reply('Straight logged.');
      respond('Straight logged.');
      return;
    }

    // Club detection
    if (lower.includes('driver')) detectedClub = 'Driver';
    else if (lower.includes('3 wood') || lower.includes('three wood')) detectedClub = '3 Wood';
    else if (lower.includes('5 wood') || lower.includes('five wood')) detectedClub = '5 Wood';
    else if (lower.includes('3 iron') || lower.includes('three iron')) detectedClub = '3 Iron';
    else if (lower.includes('4 iron') || lower.includes('four iron')) detectedClub = '4 Iron';
    else if (lower.includes('5 iron') || lower.includes('five iron')) detectedClub = '5 Iron';
    else if (lower.includes('6 iron') || lower.includes('six iron')) detectedClub = '6 Iron';
    else if (lower.includes('7 iron') || lower.includes('seven iron') || lower.includes('7')) detectedClub = '7 Iron';
    else if (lower.includes('8 iron') || lower.includes('eight iron')) detectedClub = '8 Iron';
    else if (lower.includes('9 iron') || lower.includes('nine iron')) detectedClub = '9 Iron';
    else if (lower.includes('pitching') || lower.includes('pw')) detectedClub = 'PW';
    else if (lower.includes('sand') || lower.includes('sw')) detectedClub = 'SW';
    else if (lower.includes('putter') || lower.includes('putt')) detectedClub = 'Putter';
    else if (lower.includes('iron')) detectedClub = 'Iron';

    // Result detection
    if (lower.includes('left')) detectedResult = 'left';
    else if (lower.includes('right')) detectedResult = 'right';
    else if (lower.includes('straight') || lower.includes('center')) detectedResult = 'straight';

    // Aim command detection — "aim left", "aim center", "aim right edge", etc.
    if (
      lower.includes('aim left edge') || lower.includes('left edge')
    ) {
      storeSetAim('left edge');
      reply('Aim: left edge');
      respond('Aiming left edge.');
      return;
    }
    if (lower.includes('aim left') || lower.includes('aim left center')) {
      storeSetAim('left center');
      reply('Aim: left center');
      respond('Aiming left center.');
      return;
    }
    if (lower.includes('aim right edge') || lower.includes('right edge')) {
      storeSetAim('right edge');
      reply('Aim: right edge');
      respond('Aiming right edge.');
      return;
    }
    if (lower.includes('aim right') || lower.includes('aim right center')) {
      storeSetAim('right center');
      reply('Aim: right center');
      respond('Aiming right center.');
      return;
    }
    if (lower.includes('aim center') || lower.includes('aim middle') || lower.includes('aim straight')) {
      storeSetAim('center');
      reply('Aim: center');
      respond('Aiming center.');
      return;
    }

    if (detectedResult) {
      const confirmMsg = detectedClub !== club
        ? `Got it — ${detectedClub}, ${detectedResult}. Logged.`
        : `${detectedResult} logged.`;
      reply(confirmMsg);
      setClub(detectedClub);
      handleShot(detectedResult);
      return;
    }

    // Video / recording commands
    if (lower.includes('record') || lower.includes('start recording') || lower.includes('record swing')) {
      if (cameraPermission?.granted && !recording && !autoRecording) {
        reply('On it — recording your swing.');
        void voiceSpeak('Recording swing now.', 'calm');
        startRecording();
      } else if (!cameraPermission?.granted) {
        reply('Camera permission needed to record.');
        void voiceSpeak('Camera permission required', 'calm');
      } else {
        reply('Already recording.');
      }
      return;
    }
    if (lower.includes('stop') || lower.includes('stop recording')) {
      if (recording) {
        stopRecording();
        reply('Recording stopped.');
        void voiceSpeak('Recording stopped', 'calm');
      } else {
        reply('Nothing is recording right now.');
      }
      return;
    }
    if (lower.includes('delete') || lower.includes('delete video') || lower.includes('delete swing')) {
      if (videoUri) {
        setVideoUri(null);
        reply('Video deleted.');
        void voiceSpeak('Video deleted', 'calm');
      } else {
        reply('No video to delete.');
      }
      return;
    }
    if (lower.includes('reset video') || lower.includes('clear video') || lower.includes('new video')) {
      setVideoUri(null);
      reply('Video cleared. Ready to record again.');
      void voiceSpeak('Ready to record a new swing', 'calm');
      return;
    }

    // Score recording via voice: "got a 5", "John got a 5", "got a birdie", etc.
    // Check for named-player pattern: "[name] got a [score]"
    const namedPlayerMatch = players.findIndex((p) => p && lower.includes(p.toLowerCase()));
    if (namedPlayerMatch !== -1 && (lower.includes('got a') || lower.includes('scored a'))) {
      const wordToNum: Record<string, number> = {
        birdie: par - 1, eagle: par - 2, par: par, bogey: par + 1,
        'double bogey': par + 2, double: par + 2,
        one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      };
      let score: number | null = null;
      const digitMatch = lower.match(/\b(\d+)\b/);
      if (digitMatch) score = parseInt(digitMatch[1], 10);
      if (!score) {
        for (const [word, val] of Object.entries(wordToNum)) {
          if (lower.includes(word)) { score = val; break; }
        }
      }
      if (score && score > 0 && score <= 15) {
        const playerName = players[namedPlayerMatch];
        setMultiRoundPersisted((prev) => {
          const idx = prev.findIndex((h) => h.hole === hole);
          if (idx === -1) {
            const scores = [0, 0, 0, 0];
            scores[namedPlayerMatch] = score!;
            return [...prev, { hole, par, scores }];
          }
          return prev.map((h, hi) =>
            hi === idx
              ? { ...h, scores: h.scores.map((s, si) => si === namedPlayerMatch ? score! : s) }
              : h,
          );
        });
        const msg = `${playerName} scored ${score} on hole ${hole}.`;
        reply(msg);
        respond(msg);
      } else {
        setIsThinking(false);
        respond(`I didn't catch ${players[namedPlayerMatch]}'s score. Try "${players[namedPlayerMatch]} got a 5".`);
      }
      return;
    }

    if (lower.includes('got a') || lower.includes('i got a') || lower.includes('scored a')) {
      const wordToNum: Record<string, number> = {
        birdie: par - 1, eagle: par - 2, par: par, bogey: par + 1,
        'double bogey': par + 2, double: par + 2,
        one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      };
      let score: number | null = null;
      // Try numeric digit first
      const digitMatch = lower.match(/\b(\d+)\b/);
      if (digitMatch) score = parseInt(digitMatch[1], 10);
      // Then word-based
      if (!score) {
        for (const [word, val] of Object.entries(wordToNum)) {
          if (lower.includes(word)) { score = val; break; }
        }
      }
      if (score && score > 0 && score <= 15) {
        setStrokes(score);
        const msg = `Score of ${score} recorded for hole ${hole}.`;
        reply(msg);
        respond(msg);
      } else {
        setIsThinking(false);
        respond('I didn\'t catch the score. Try "got a 5" or "got a bogey".');
      }
      return;
    }

    // Swing thought update
    if (
      lower.includes('swing thought') ||
      lower.includes('new thought') ||
      lower.includes('change thought') ||
      lower.includes('update thought') ||
      lower.includes('give me a thought') ||
      lower.includes('different thought')
    ) {
      const idx = Math.floor(Math.random() * FOCUS_MESSAGES.length);
      const newThought = FOCUS_MESSAGES[idx];
      setSwingThought(newThought);
      const confirm = `${newThought}. Solid — Let's Go.`;
      reply(confirm);
      void speak(confirm);
      return;
    }

    // Caddie advice — try OpenAI first for open-ended questions, fall back to local engine
    setTimeout(async () => {
      const aiAnswer = await callOpenAI(transcript, getAIContext());
      if (aiAnswer) {
        reply(aiAnswer);
        respond(aiAnswer);
      } else {
        const advice = getShortCaddieDecision();
        reply(advice);
        respond(advice);
      }
    }, 300);
  };

  const saveRound = async () => {
    const activePlayers = players.slice(0, activePlayerCount);
    const totals = activePlayers.map((_, i) => safeMultiRound.reduce((sum, h) => sum + (h.scores[i] ?? 0), 0));
    const best = Math.min(...totals.length ? totals : [0]);
    const winnerIdx = totals.indexOf(best);
    setRoundHistory((prev) => [{ date: new Date().toLocaleDateString(), scores: totals, winner: activePlayers[winnerIdx] ?? activePlayers[0] }, ...prev]);

    const roundData = {
      date: new Date().toISOString(),
      course: activeCourse?.name ?? 'Unknown',
      players: activePlayers,
      totals,
      winner: activePlayers[winnerIdx] ?? activePlayers[0],
      multiRound: safeMultiRound,
      shots: safeShots,
      createdAt: Date.now(),
    };

    const userId = auth.currentUser?.uid;
    if (isOnline && userId) {
      // Online — save to Firestore
      try {
        await addDoc(collection(db, 'users', userId, 'rounds'), roundData);
        await AsyncStorage.removeItem('draftShots');
        await AsyncStorage.removeItem('draftMultiRound');
      } catch {
        // save will retry on next session
      }
    } else {
      // Offline — queue locally
      try {
        const stored = await AsyncStorage.getItem('offlineRounds');
        const queue: any[] = stored ? JSON.parse(stored) : [];
        queue.push(roundData);
        await AsyncStorage.setItem('offlineRounds', JSON.stringify(queue));
        await AsyncStorage.removeItem('draftShots');
        await AsyncStorage.removeItem('draftMultiRound');
        setPendingSyncCount(queue.length);
      } catch {
        // local queue unavailable
      }
    }
  };

  const getContextualCaddieResponse = () => {
    const parts: string[] = [];

    // Yardage lead-in
    const yardages = getYardages();
    const yardage = targetDistance ?? yardages.middle ?? currentHoleData?.distance ?? 150;
    if (yardage) parts.push(`${yardage} yards to the middle.`);

    // Club average vs distance
    const clubAvg = getClubAverage(safeClub);
    if (clubAvg) {
      parts.push(`Your ${club} typically goes ${clubAvg} yards.`);
      if (yardage > clubAvg + 20) parts.push('You\'ll need more club to reach that target.');
      else if (yardage < clubAvg - 20) parts.push('That\'s too much club — consider something shorter.');
      else parts.push('That\'s a good number for this club.');
    }

    // Yardage left after this club
    const ydsLeft = getYardageLeft();
    if (ydsLeft !== null && ydsLeft > 30) {
      const nextClub = recommendClubForDistance(ydsLeft);
      parts.push(`After this shot you'll have ~${ydsLeft} yards left — lining up a ${nextClub}.`);
    } else if (ydsLeft !== null && ydsLeft <= 30) {
      parts.push(`This ${club} should put you on the green.`);
    }

    // Primary miss direction
    const miss = getPrimaryMiss();
    if (miss === 'right') parts.push('You\'ve been missing right — favor the left side.');
    else if (miss === 'left') parts.push('You\'ve been pulling it left — favor the right.');

    // Dispersion refinement
    const dispersion = getDispersion();
    if (dispersion !== null && Math.abs(dispersion) >= 2 && miss === 'right') parts.push('Strong right bias confirmed — aim well left of target.');
    else if (dispersion !== null && Math.abs(dispersion) >= 2 && miss === 'left') parts.push('Strong left bias confirmed — aim right of target.');

    // Club-specific miss
    const clubMiss = getClubMiss(club);
    if (clubMiss === 'right' && miss !== 'right') parts.push(`Your ${club} has been going right — aim left.`);
    else if (clubMiss === 'left' && miss !== 'left') parts.push(`Your ${club} has been going left — aim slightly right.`);

    // Score vs par
    if (round.length > 0 && roundPars.length > 0) {
      const scoreDiff = round.reduce((s, v) => s + v, 0) - roundPars.reduce((s, v) => s + v, 0);
      if (scoreDiff >= 3) parts.push('Play smart here — avoid unnecessary risk.');
      else if (scoreDiff <= -1) parts.push("You're in a good position — you can be slightly aggressive.");
    }

    // Hole note hazards — inject specific yardages when available
    const haz = getHazardDistances();
    const note = currentHoleData.note.toLowerCase();
    if (haz.water !== null) {
      if (note.includes('short') || note.includes('carry') || note.includes('over'))
        parts.push(`Carry the water at ${haz.water} yards — take enough club.`);
      else
        parts.push(`Water hazard is ~${haz.water} yards out — be aware.`);
    } else if (note.includes('water') || note.includes('lake') || note.includes('creek')) {
      parts.push('Water in play — stay safe.');
    }
    if (haz.bunker !== null)
      parts.push(`Bunker at ~${haz.bunker} yards — avoid or clear it cleanly.`);
    else if (note.includes('bunker'))
      parts.push('Bunker in play — take enough club to clear it.');
    if (note.includes('tight')) parts.push('Tight fairway — pick your line carefully.');

    // Hole strategy
    const strategy = getHoleStrategy();
    if (strategy) parts.push(strategy);

    // Closing commitment cue
    parts.push('Commit to your swing.');

    return parts.filter(Boolean).join(' ');
  };

  const handleSpeechInput = (text?: string) => handleSpeech(text, processListeningResult);

  const processListeningResult = (text?: string) => {
    cancelSilence();
    if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
    setListeningPhase('processing');
    setTimeout(() => {
      setListening(false);
      setPulse(1);
      if (text && text.trim()) {
        void handleVoiceCommand(text.trim());
      } else {
        const response = getContextualCaddieResponse() || getFullCaddieDecision();
        setIsThinking(false);
        setCommandResponse(response);
        respond(response);
      }
    }, 600);
  };

  const startListening = () => {
    if (listening) return;
    // Interruption: cancel any ongoing AI speech the moment user starts speaking
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
    // Maximum window: 4000 ms — silence debounce can fire earlier via handleSpeechInput
    startMaxWindow(() => processListeningResult());
  };

  const stopListening = () => {
    cancelSilence();
    if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
    setListening(false);
    setPulse(1);
  };

  const handleToggleEarbudMode = () => {
    const next = !earbudMode;
    setEarbudMode(next);
    setQuietMode(false);
    if (next) {
      startListening();
      void speak('Listening.');
    } else {
      stopListening();
      void speak('Quiet.');
    }
  };

  // Remote-control friendly toggle — call from hardware media button handler or logo press
  const handleListeningVoiceToggle = () => {
    if (listening) {
      stopListening();
      void speak('Quiet.');
    } else {
      startListening();
      void speak('Listening.');
    }
  };

  const handleListeningToggle = () => {
    if (listening) stopListening();
    else startListening();
  };

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

  const getAimInsights = () => {
    if (shots.length < 5) return "Not enough data yet — hit a few more.";
    let mismatchRight = 0;
    let mismatchLeft = 0;
    const lastFive = shots.slice(-5);
    lastFive.forEach((shot) => {
      if (shot.aim === 'left' && shot.result === 'right') mismatchRight++;
      if (shot.aim === 'right' && shot.result === 'left') mismatchLeft++;
    });
    if (mismatchRight >= 2) return "Even aiming left — you're still leaking right. Check the face.";
    if (mismatchLeft >= 2) return "Even aiming right — you're still pulling it. Hold through impact.";
    return 'Aim and ball flight are lining up well.';
  };

  const getSwingFix = () => {
    if (shots.length < 5) return "Hit a few shots — I'll read your pattern soon.";
    let rightMiss = 0;
    let leftMiss = 0;
    shots.slice(-10).forEach((shot) => {
      if (shot.result === 'right') rightMiss++;
      if (shot.result === 'left') leftMiss++;
    });
    if (rightMiss > leftMiss && rightMiss >= 3) {
      playerProfile.commonMiss = 'right';
      return "You're leaking right — close the face and swing from the inside.";
    }
    if (leftMiss > rightMiss && leftMiss >= 3) {
      playerProfile.commonMiss = 'left';
      return "Pulling left — smooth the release and hold the face through impact.";
    }
    playerProfile.commonMiss = null;
    return 'Ball flight is balanced — keep it up.';
  };

  const getSwingFixData = () => {
    const miss = getPrimaryMiss();
    if (!miss || miss === 'balanced') return null;
    return SWING_FIXES[miss] ?? null;
  };

  const getClubPatterns = () => {
    const clubData: Record<string, { left: number; right: number; straight: number }> = {};
    shots.forEach((shot) => {
      if (!shot?.club) return;
      if (!clubData[shot.club]) clubData[shot.club] = { left: 0, right: 0, straight: 0 };
      const r = shot.result as 'left' | 'right' | 'straight';
      if (r === 'left' || r === 'right' || r === 'straight') clubData[shot.club][r]++;
    });
    return clubData;
  };

  const getClubMiss = (selectedClub: string): 'right' | 'left' | 'straight' | null => {
    const data = getClubPatterns()[selectedClub];
    if (!data) return null;
    const total = data.left + data.right + data.straight;
    if (total < 3) return null;
    if (data.right > data.left && data.right > data.straight) return 'right';
    if (data.left > data.right && data.left > data.straight) return 'left';
    return 'straight';
  };

  const getClubStats = () => {
    const stats: Record<string, { total: number; straight: number; left: number; right: number }> = {};
    shots.forEach((shot) => {
      if (!shot?.club) return;
      if (!stats[shot.club]) stats[shot.club] = { total: 0, straight: 0, left: 0, right: 0 };
      stats[shot.club].total++;
      if (shot.result === 'straight') stats[shot.club].straight++;
      if (shot.result === 'left') stats[shot.club].left++;
      if (shot.result === 'right') stats[shot.club].right++;
    });
    return stats;
  };

  const getClubInsights = () => {
    if (shots.length < 5) return 'Not enough data';

    const clubStats: Record<string, { left: number; right: number; straight: number; total: number }> = {};

    shots.forEach((shot) => {
      if (!shot?.club) return;
      if (!clubStats[shot.club]) {
        clubStats[shot.club] = { left: 0, right: 0, straight: 0, total: 0 };
      }
      const r = shot.result as 'left' | 'right' | 'straight';
      if (r === 'left' || r === 'right' || r === 'straight') clubStats[shot.club][r]++;
      clubStats[shot.club].total++;
    });

    let insight = '';

    Object.keys(clubStats).forEach((club) => {
      const stats = clubStats[club];
      if (stats.total < 3) return;
      if (stats.right > stats.left && stats.right > stats.straight) {
        insight += `${club}: miss right\n`;
      } else if (stats.left > stats.right && stats.left > stats.straight) {
        insight += `${club}: miss left\n`;
      } else if (stats.straight >= stats.left && stats.straight >= stats.right) {
        insight += `${club}: reliable\n`;
      }
    });

    return insight.trim() || 'No clear club patterns yet';
  };

  const getClubDispersion = () => {
    if (shots.length < 6) return 'Not enough club data';
    const clubStats: Record<string, number> = {};
    shots.forEach((shot) => {
      if (!shot?.club) return;
      if (clubStats[shot.club] === undefined) clubStats[shot.club] = 0;
      if (shot.result === 'right') clubStats[shot.club] += 1;
      if (shot.result === 'left') clubStats[shot.club] -= 1;
    });
    let output = '';
    Object.keys(clubStats).forEach((club) => {
      const score = clubStats[club];
      if (score >= 2) output += `${club}: right miss\n`;
      else if (score <= -2) output += `${club}: left miss\n`;
      else output += `${club}: neutral\n`;
    });
    return output.trim() || 'Not enough club data';
  };

  const getClubConfidence = () => {
    if (shots.length < 6) return 'Not enough data';
    const clubStats: Record<string, { total: number; straight: number; left: number; right: number }> = {};
    shots.forEach((shot) => {
      if (!shot?.club) return;
      if (!clubStats[shot.club]) clubStats[shot.club] = { total: 0, straight: 0, left: 0, right: 0 };
      clubStats[shot.club].total++;
      if (shot.result === 'straight') clubStats[shot.club].straight++;
      if (shot.result === 'left') clubStats[shot.club].left++;
      if (shot.result === 'right') clubStats[shot.club].right++;
    });
    let bestClub: string | null = null;
    let worstClub: string | null = null;
    let bestScore = -Infinity;
    let worstScore = Infinity;
    Object.keys(clubStats).forEach((c) => {
      const s = clubStats[c];
      const score = (s.straight / s.total) - ((s.left + s.right) / s.total);
      if (score > bestScore) { bestScore = score; bestClub = c; }
      if (score < worstScore) { worstScore = score; worstClub = c; }
    });
    return `Most reliable: ${bestClub}\nNeeds work: ${worstClub}`;
  };

  const getClubRecommendation = () => {
    if (shots.length < 6) return '';
    const clubStats: Record<string, { total: number; straight: number; left: number; right: number }> = {};
    shots.forEach((shot) => {
      if (!shot?.club) return;
      if (!clubStats[shot.club]) clubStats[shot.club] = { total: 0, straight: 0, left: 0, right: 0 };
      clubStats[shot.club].total++;
      if (shot.result === 'straight') clubStats[shot.club].straight++;
      if (shot.result === 'left') clubStats[shot.club].left++;
      if (shot.result === 'right') clubStats[shot.club].right++;
    });
    let worstClub: string | null = null;
    let worstScore = Infinity;
    Object.keys(clubStats).forEach((c) => {
      const s = clubStats[c];
      const score = (s.straight / s.total) - ((s.left + s.right) / s.total);
      if (score < worstScore) { worstScore = score; worstClub = c; }
    });
    if (worstClub === club) return `Consider a safer option than ${club}.`;
    return '';
  };

  const getBestClub = () => {
    if (shots.length < 6) return null;
    const clubStats: Record<string, { total: number; straight: number }> = {};
    shots.forEach((shot) => {
      if (!shot?.club) return;
      if (!clubStats[shot.club]) clubStats[shot.club] = { total: 0, straight: 0 };
      clubStats[shot.club].total++;
      if (shot.result === 'straight') clubStats[shot.club].straight++;
    });
    let bestClub: string | null = null;
    let bestAccuracy = 0;
    Object.keys(clubStats).forEach((c) => {
      const accuracy = clubStats[c].straight / clubStats[c].total;
      if (accuracy > bestAccuracy) { bestAccuracy = accuracy; bestClub = c; }
    });
    return bestClub;
  };

  const getDistanceRecommendation = () => {
    if (!distance) return '';
    const bestClub = getBestClub();
    if (!bestClub) return '';
    return `${distance} yards — go with the ${bestClub}, your most reliable.`;
  };

  const getDispersionSpread = () => {
    if (shots.length < 5) return null;
    const positions = shots.slice(-10).map((shot) =>
      shot.result === 'left' ? 0 : shot.result === 'straight' ? 1 : 2
    );
    return Math.max(...positions) - Math.min(...positions);
  };

  const getConfidenceLevel = () => {
    const spread = getDispersionSpread();
    if (spread === null) return 'neutral';
    if (spread === 0) return 'tight';
    if (spread === 1) return 'medium';
    return 'wide';
  };

  const getPlayerMemory = () => {
    if (shots.length < 10) return 'Building player profile...';
    const recent = shots.slice(-10);
    let wideCount = 0;
    let tightCount = 0;
    recent.forEach((shot) => {
      if (shot.result === 'left' || shot.result === 'right') wideCount++;
      if (shot.result === 'straight') tightCount++;
    });
    if (wideCount > tightCount) return "You tend to spray it when things get loose — play it safer.";
    if (tightCount > wideCount) return "You're at your best when dialed in — trust the swing.";
    return "Balanced pattern today — nice work.";
  };

  const getRoundSummary = () => {
    if (round.length < 3) return 'Finish a few holes to see your round summary.';

    const totalScore = round.reduce((sum, s) => sum + (s || 0), 0);

    const clubStats: Record<string, { total: number; straight: number }> = {};
    shots.forEach((shot) => {
      if (!shot?.club) return;
      if (!clubStats[shot.club]) clubStats[shot.club] = { total: 0, straight: 0 };
      clubStats[shot.club].total++;
      if (shot.result === 'straight') clubStats[shot.club].straight++;
    });

    let bestClub: string | null = null;
    let bestAccuracy = 0;
    Object.keys(clubStats).forEach((c) => {
      const accuracy = clubStats[c].straight / clubStats[c].total;
      if (accuracy > bestAccuracy) { bestAccuracy = accuracy; bestClub = c; }
    });

    let rightMiss = 0;
    let leftMiss = 0;
    shots.forEach((shot) => {
      if (shot.result === 'right') rightMiss++;
      if (shot.result === 'left') leftMiss++;
    });
    const missInsight = rightMiss > leftMiss
      ? 'Most common miss: right.'
      : leftMiss > rightMiss
      ? 'Most common miss: left.'
      : 'Misses were balanced.';

    const accuracyPct = bestClub ? Math.round(bestAccuracy * 100) : 0;
    const roundLabel = roundLength === 9 ? 'Solid 9-hole round.' : '';
    const trend = getTrend(shots);
    const trendLabel = trend === 'improving' ? 'Trend: Improving.' : trend === 'struggling' ? 'Trend: Needs reset.' : '';
    const missLabel = rightMiss > leftMiss ? 'Miss tendency: Right.' : leftMiss > rightMiss ? 'Miss tendency: Left.' : '';
    const base = `Score: ${totalScore} over ${round.length} holes. Best club: ${bestClub ?? 'N/A'} (${accuracyPct}% fairways). ${missInsight}`;
    return [roundLabel, base, missLabel, trendLabel].filter(Boolean).join(' ');
  };

  const getShotColor = (result: string) => {
    if (result === 'left') return '#e53935';
    if (result === 'right') return '#1e88e5';
    if (result === 'straight') return '#43a047';
    return '#999';
  };

  const generateTrace = (result: string) => {
    const curve = result === 'left' ? -40 : result === 'right' ? 40 : 0;
    setLastShotTrace({ startX: 50, startY: 90, endX: 50 + curve, endY: 20 });
    traceOpacity.setValue(1);
    Animated.timing(traceOpacity, {
      toValue: 0,
      duration: 2800,
      useNativeDriver: true,
    }).start(() => setLastShotTrace(null));
  };

  // -- Confidence boost moments ----------------------------------------------
  // Fires at most once every 3 shots to avoid over-praising
  const getConfidenceBoost = (result: string, allShots: Shot[]): string | null => {
    if (result !== 'straight') return null;

    const now = allShots.length;
    // Enforce sparing use: at least 3 shots between boosts
    if (now - lastConfidenceBoostRef.current < 3) return null;

    const straightShots = allShots.filter((s) => s.result === 'straight');
    const prevShots = allShots.slice(0, -1);
    const prevStraight = prevShots.filter((s) => s.result === 'straight').length;

    // Trigger 1 — best shot of round: first straight after 3+ misses in a row
    const recentMisses = prevShots.slice(-3).filter((s) => s.result !== 'straight').length;
    if (recentMisses === 3) {
      lastConfidenceBoostRef.current = now;
      return "That's your best one today.";
    }

    // Trigger 2 — great strike: 2+ straights in a row and total improves
    const lastTwo = allShots.slice(-2);
    if (lastTwo.length === 2 && lastTwo.every((s) => s.result === 'straight') && straightShots.length > prevStraight) {
      lastConfidenceBoostRef.current = now;
      return "That's exactly it.";
    }

    // Trigger 3 — consistent improvement: 3 straights in a row
    const lastThree = allShots.slice(-3);
    if (lastThree.length === 3 && lastThree.every((s) => s.result === 'straight')) {
      lastConfidenceBoostRef.current = now;
      return "That's the swing right there.";
    }

    return null;
  };

  // -- Response variation pools ---------------------------------------------
  const positivePool = [
    'Nice swing.',
    "That's solid.",
    'Good strike.',
    "That's better.",
    "That's your swing.",
  ];

  const correctionPool = [
    'Stay smooth.',
    'Stay patient.',
    'Easy tempo.',
    "Let's slow that down.",
  ];

  // Rare personality phrases — fire ~1-in-5 straight shots to feel human without overdoing it
  const personalityPool = [
    "We'll take that all day.",
    'That plays.',
    'Trust that one.',
  ];

  const pickRandom = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)];

  // --- Pre-shot caddie cue (confidence-gated, <10 words) --------------------
  // Only fires if confidence >= 65 — low confidence = player is struggling, stay quiet
  const getPreShotCue = (): string | null => {
    if (confidence < 65) return null;
    const { bias } = analyzeShotPattern(shots);
    const trend = getTrend(shots);
    if (bias === 'right')    return 'Finish left. Stay through it.';
    if (bias === 'left')     return 'Stay centered. Smooth release.';
    if (trend === 'improving') return 'You own this. Trust the swing.';
    if (trend === 'struggling') return 'One shot. Smooth and through.';
    const pool = ['Commit.', 'Pick your target.', 'Trust it.', 'One smooth swing.'];
    return pool[shots.length % pool.length];
  };

  // --- Post-shot caddie cue (short, human, non-robotic) --------------------
  const getPostShotMessage = (result: string, severity: 'small' | 'big' = 'small'): string => {
    if (severity === 'big') {
      return 'Reset. Back in play.';
    }

    if (result === 'straight') {
      return pickRandom(['Pure.', 'That’s a golf shot.', 'Love that.']);
    }

    return pickRandom(['That’s fine.', 'We’re good.', 'Playable.']);
  };

  const getShotSeverity = (result: string, shotList: Shot[]): 'small' | 'big' => {
    if (result === 'straight') return 'small';
    const recent = shotList.slice(-3);
    const sameMisses = recent.filter((s) => s.result === result).length;
    return sameMisses >= 2 ? 'big' : 'small';
  };

  const getPostShotCue = (result: string, shotList: Shot[]): string => {
    const severity = getShotSeverity(result, shotList);
    return getPostShotMessage(result, severity);
  };

  const giveFeedback = (result: string) => {
    // On straight shots, ~20% chance to swap in a personality phrase instead
    if (result === 'straight' && Math.random() < 0.2) {
      void voiceSpeak(pickRandom(personalityPool), 'calm');
      return;
    }
    const byResult: Record<string, string[]> = {
      straight: [getTempoCue(), ...positivePool],
      left:  ['Just a little left.', 'Came off a touch left.', 'Slight pull — no big deal.', pickRandom(correctionPool)],
      right: ['Just a little right.', 'Came off a touch right.', 'Slight push — shake it off.', pickRandom(correctionPool)],
    };
    const pool = byResult[result] ?? byResult.straight;
    void voiceSpeak(pickRandom(pool), 'calm');
  };

  const handleShot = useCallback(async (result: string) => {
    const now = Date.now();
    if (now - lastShotTime < 1500) return;

    setLastShotTime(now);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const yardsBefore = gpsYardsRef.current?.middle ?? null;
    const gpsCoords = gpsCoordsRef.current;
    const estimatedDistance = yardsBefore ?? currentHoleData.distance / 2;
    const newShot: Shot = {
      result,
      mental: mentalState,
      club,
      aim,
      target: shotTarget,
      timestamp: Date.now(),
      hole: currentHoleData.hole,
      distance: estimatedDistance,
      situation: getShotSituation(shots.length),
      gpsLat: gpsCoords?.latitude,
      gpsLng: gpsCoords?.longitude,
      yardsBefore: yardsBefore ?? undefined,
    };

    const updatedShots = [...shots, newShot].slice(-SHOT_MAX);
    const updatedRound = [...currentRound, newShot];

    addShot(newShot);
    updatePlayerModel(newShot);
    updateCourseMemory(currentHoleData.hole, result);
    // Wake the screen if dimmed so the player sees shot feedback, then restart
    // the idle countdown. toggleLowPowerMode(false) already calls resetIdleTimer
    // internally, so only call resetIdleTimer when the screen is already active.
    if (lowPowerModeRef.current) {
      toggleLowPowerMode(false);
    } else {
      resetIdleTimer();
    }
    setStrokes((prev) => prev + 1);
    setCurrentRound(updatedRound);

    AsyncStorage.setItem('draftShots', JSON.stringify(updatedShots)).catch(() => {});
    // GPS active: defer club-distance recording to after-walk GPS update for real carry distance
    // No GPS: record estimate immediately so club learning still works indoors / range sessions
    if (yardsBefore !== null) {
      prevShotYardsRef.current = yardsBefore;
      prevShotClubRef.current = club;
    } else {
      recordClubDistance(club, estimatedDistance);
      updateClubDistance(club, estimatedDistance);
    }
    setLastShotBadge(null);  // clear previous badge; GPS effect will populate once player walks
    generateTrace(result);

    const severity = getShotSeverity(result, updatedShots);
    const post = getPostShotMessage(result, severity);
    setCaddieMessage(post);

    if (voiceEnabled && !quietMode) {
      void speak(post);
    }

    const { bias: shotBias, confidence: newConfidence } = analyzeShotPattern(updatedShots);
    setConfidence(newConfidence);

    // Signal post-shot decision refresh (useEffect below re-runs getCaddieDecision
    // after the coaching chain settles — React 18 batches this with the other
    // state updates so the effect closure sees the updated shots array).
    setLastShotEpoch((e) => e + 1);

    if (shotBias !== 'neutral') {
      usePlayerProfileStore.getState().setTypicalMiss(shotBias);
    }

    if (shouldCallAI(updatedShots)) {
      setAiThinking(true);
      const aiMessage = await getAIResponse({
        shots: updatedShots,
        mentalState,
        confidence: newConfidence,
        longTermPattern,
        playerProfile,
        coachingStyle: usePlayerProfileStore.getState().coachingStyle,
      });
      setAiThinking(false);
      setCaddieMessage(aiMessage);
    } else {
      setCaddieMessage(getPostShotCue(result, updatedShots));
    }

    setTimeout(() => {
      if (result === 'left') {
        setCaddieMessage(getPatternCoaching('left', updatedShots));
      } else if (result === 'right') {
        setCaddieMessage(getPatternCoaching('right', updatedShots));
      } else if (result === 'straight') {
        const base = getPatternCoaching('straight', updatedShots);
        setCaddieMessage(`${pickRandom(positivePool)} ${base}`);
      }
    }, 1800);

    setTimeout(() => {
      const boost = getConfidenceBoost(result, updatedShots);
      if (boost && boost !== lastInsight) {
        setLastInsight(boost);
        setCaddieMessage(boost);
        return;
      }

      const insight = getSmartInsight();
      if (insight && insight !== lastInsight) {
        setLastInsight(insight);
        setCaddieMessage(insight);
      }
    }, 3500);

    setTimeout(() => {
      const timeoutConfidence = calculateConfidence(updatedShots);
      const mentalPattern = detectMentalPattern(updatedShots);
      if (mentalPattern && mentalPattern !== lastInsight) {
        setLastInsight(mentalPattern);
        updatePlayerProfile(mentalPattern, updatedShots, timeoutConfidence);
        setCaddieMessage(mentalPattern);
        return;
      }

      const pattern = detectPattern();
      if (pattern && pattern !== lastInsight) {
        setLastInsight(pattern);
        updatePlayerProfile(pattern, updatedShots, timeoutConfidence);
        const tip = getCoachingTip(pattern);
        setCaddieMessage(tip ?? pattern);
        return;
      }

      const recentResults = updatedShots.slice(-5).map((s) => s.result);
      const missWarning = checkMissPattern(recentResults);
      if (missWarning && missWarning !== lastInsight) {
        setLastInsight(missWarning);
        setCaddieMessage(missWarning);
      }
    }, 5000);
  }, [
    addShot,
    aim,
    club,
    currentHoleData.distance,
    currentHoleData.hole,
    currentRound,
    getSmartInsight,
    lastInsight,
    lastShotTime,
    longTermPattern,
    mentalState,
    playerProfile,
    quietMode,
    shots,
    speak,
    voiceEnabled,
    setLastShotEpoch,
  ]);

  const onShotLeftPress = useCallback(() => { void handleShot('left'); }, [handleShot]);
  const onShotStraightPress = useCallback(() => { void handleShot('straight'); }, [handleShot]);
  const onShotRightPress = useCallback(() => { void handleShot('right'); }, [handleShot]);

  // 📍 Mark Ball — player has walked to their ball; snapshot current GPS to force carry compute
  const handleMarkBall = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      let currentYards: number | null = gpsYardsRef.current?.middle ?? null;
      // Try a fresh fix if GPS is available
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const { latitude, longitude } = pos.coords;
        // Use stored green coords to compute fresh yardage
        const { latitude: gLat, longitude: gLng } = (activeCourse as any)?.holes?.[holeRef.current - 1] ?? {};
        if (gLat && gLng) {
          const toRad = (d: number) => d * Math.PI / 180;
          const R = 6371000;
          const dLat = toRad(gLat - latitude);
          const dLng = toRad(gLng - longitude);
          const a = Math.sin(dLat/2)**2 + Math.cos(toRad(latitude)) * Math.cos(toRad(gLat)) * Math.sin(dLng/2)**2;
          const meters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          currentYards = Math.round(meters * 1.09361);
          // front = front edge of green (closer = fewer yards), back = back edge (more yards)
          gpsYardsRef.current = { front: Math.max(1, currentYards - 5), middle: currentYards, back: currentYards + 5 };
          setGpsYards({ front: Math.max(1, currentYards - 5), middle: currentYards, back: currentYards + 5 });
        }
      } catch (_) { /* use last known */ }

      // Compute carry if we have a shot pending
      if (prevShotYardsRef.current && currentYards !== null) {
        const yardsCarried = Math.round(prevShotYardsRef.current - currentYards);
        if (yardsCarried >= 10 && yardsCarried <= 700) {
          const shotClub = prevShotClubRef.current ?? club;
          recordClubDistance(shotClub, yardsCarried);
          updateClubDistance(shotClub, yardsCarried);   // feeds playerModel samples + legacy clubDistances
          markUserActive(); // GPS mark = shot confirmed; burst vision + fast analytics
          setLastShotBadge({ yardsCarried, yardsRemaining: Math.round(currentYards), club: shotClub });
          setCaddieMessage(`📍 ${yardsCarried} yds with ${shotClub}. ${Math.round(currentYards)} yds to pin.`);
          prevShotYardsRef.current = null;
          prevShotClubRef.current = null;
          if (voiceEnabled && !quietMode) void respond(`Marked. ${yardsCarried} yards with ${shotClub}. ${Math.round(currentYards)} to the pin.`);
        } else {
          setCaddieMessage('GPS location updated.');
        }
      } else if (currentYards !== null) {
        // No pending shot — just update yardage display
        setCaddieMessage(`📍 ${Math.round(currentYards)} yds to pin.`);
        if (voiceEnabled && !quietMode) void respond(`${Math.round(currentYards)} yards to the pin.`);
      }
    } catch (e) {
      setCaddieMessage('GPS unavailable.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCourse, club, voiceEnabled, quietMode]);

  // Keep screen awake only when NOT in low power mode
  useEffect(() => {
    if (!lowPowerMode) {
      void activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }
    return () => { deactivateKeepAwake(); };
  }, [lowPowerMode]);

  // Start idle timer when round becomes active; clear it when round ends.
  useEffect(() => {
    if (isRoundActive) {
      resetIdleTimer();
    } else {
      if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
      // Exit low power if round ends so the screen is fully visible on the summary screen
      if (lowPowerMode) toggleLowPowerMode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRoundActive]);

  if (loading) {
    return (
      <View style={styles.loadingCenter}>
        <Text style={{ color: '#A7F3D0', fontSize: 16, fontWeight: '600' }}>Loading...</Text>
      </View>
    );
  }

  // Pre-compute heavy values once per render — keep JSX lightweight
  // useMemo ensures these only recalculate when their inputs actually change,
  // preventing lag spikes on every keystroke / tap / scroll.
  const decision = useMemo(
    () => getCaddieDecision(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // gpsYards included: getCaddieDecision reads gpsYards?.middle as primary dist source.
    [shots, distance, strategyMode, mentalState, targetDistance, hole, par, gpsYards]
  );
  const caddieAdvice = useMemo(
    () => getShortCaddieDecision(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shots, distance, strategyMode, mentalState, gpsYards]
  );
  const holeStrategy = useMemo(
    () => getHoleStrategy(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round, roundPars, par]
  );
  const recommendedClub = decision.club || safeClub;   // sourced from single engine, fallback 7i
  const voiceOverlayActive = useVoiceStore((s) => s.voiceState !== 'IDLE');
  const tabBarHeight = useBottomTabBarHeight();

  return (
    <>
    <Animated.View
      style={{ flex: 1, opacity: dimAnim }}
      onStartShouldSetResponder={() => { resetIdleTimer(); return false; }}
    >

    {/* Quick Mode overlay */}
    {quickMode ? (
      <View style={{ flex: 1, backgroundColor: '#0B3D2E', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
        <Text style={{ color: '#A7F3D0', fontSize: 22, fontWeight: '700', marginBottom: 8 }}>Quick Caddie</Text>
        {aiThinking && (
          <Text style={{ color: '#6ee7b7', fontSize: 13, fontStyle: 'italic', marginBottom: 8 }}>Thinking...</Text>
        )}
        {!pocketMode && caddieMessage !== '' && (
          <Text style={{ color: '#fff', fontSize: 17, textAlign: 'center', marginBottom: 20, lineHeight: 24 }}>{caddieMessage}</Text>
        )}
        {!pocketMode && shots.length >= 3 && (
          <Text style={{ color: '#6ee7b7', fontSize: 13, marginBottom: 24 }}>Confidence: {confidence}%</Text>
        )}
        {/* Target selector — Quick Mode */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {(['left', 'center', 'right'] as const).map((t) => (
            <Pressable key={t} onPress={() => setShotTarget(t)}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                borderWidth: shotTarget === t ? 2 : 1,
                borderColor: shotTarget === t ? '#6ee7b7' : '#374151',
                backgroundColor: shotTarget === t ? 'rgba(110,231,183,0.12)' : 'transparent' }}>
              <Text style={{ color: shotTarget === t ? '#6ee7b7' : '#6b7280', fontSize: 11, fontWeight: shotTarget === t ? '800' : '400' }}>
                {t === 'left' ? '← Left' : t === 'center' ? '● Center' : 'Right →'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 20, marginBottom: 32 }}>
          <Pressable onPress={onShotLeftPress} style={{ width: 78, height: 78, backgroundColor: '#1a1a1a', borderRadius: 39, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#ef4444' }}>
            <Text style={{ fontSize: 22, lineHeight: 24 }}>↙️</Text>
            <Text style={{ color: '#ef4444', fontSize: 11, fontWeight: '800', marginTop: 1 }}>LEFT</Text>
          </Pressable>
          <Pressable onPress={onShotStraightPress} style={{ width: 78, height: 78, backgroundColor: '#1a1a1a', borderRadius: 39, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#6ee7b7' }}>
            <Text style={{ fontSize: 22, lineHeight: 24 }}>⬆️</Text>
            <Text style={{ color: '#6ee7b7', fontSize: 11, fontWeight: '800', marginTop: 1 }}>STR</Text>
          </Pressable>
          <Pressable onPress={onShotRightPress} style={{ width: 78, height: 78, backgroundColor: '#1a1a1a', borderRadius: 39, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#f59e0b' }}>
            <Text style={{ fontSize: 22, lineHeight: 24 }}>↘️</Text>
            <Text style={{ color: '#f59e0b', fontSize: 11, fontWeight: '800', marginTop: 1 }}>RIGHT</Text>
          </Pressable>
        </View>
        {lastShotBadge && (
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
            <View style={{ backgroundColor: '#064e3b', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#6ee7b7', fontSize: 12, fontWeight: '700' }}>~{lastShotBadge.yardsCarried} yd · {lastShotBadge.club}</Text>
            </View>
            <View style={{ backgroundColor: '#1a2a1a', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#a7f3d0', fontSize: 12 }}>{lastShotBadge.yardsRemaining} yd to pin</Text>
            </View>
          </View>
        )}
        {(() => {
          const la = getLiveAnalytics();
          const pd = getPatternDetection();
          return la ? (
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
                <View style={{ backgroundColor: '#1e3a5f', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: '#93c5fd', fontSize: 11, fontWeight: '700' }}>← {la.left} ({la.leftPct}%)</Text>
                </View>
                <View style={{ backgroundColor: '#14532d', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: '#86efac', fontSize: 11, fontWeight: '700' }}>● {la.straight} ({la.strPct}%)</Text>
                </View>
                <View style={{ backgroundColor: '#7c2d12', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '700' }}>{la.right} ({la.rightPct}%) →</Text>
                </View>
              </View>
              {la.insight && (
                <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: '700', marginTop: 5, fontStyle: 'italic' }}>
                  {la.insight}
                </Text>
              )}
              {pd && (
                <Text style={{ color: pd.pattern === 'push' ? '#fca5a5' : '#93c5fd', fontSize: 11, fontWeight: '700', marginTop: 4, fontStyle: 'italic' }}>
                  {pd.coaching} ({pd.pct}%)
                </Text>
              )}
            </View>
          ) : null;
        })()}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={speakPreShot} style={{ backgroundColor: '#1f2937', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1, borderColor: '#374151' }}>
            <Text style={{ color: '#A7F3D0', fontSize: 13 }}>🎙 Cue</Text>
          </Pressable>
          <Pressable onPress={() => setQuietMode((q) => !q)} style={{ backgroundColor: '#1f2937', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1, borderColor: quietMode ? '#6ee7b7' : '#374151' }}>
            <Text style={{ color: quietMode ? '#6ee7b7' : '#9CA3AF', fontSize: 13 }}>{quietMode ? '🔕 Quiet' : '🔊 Sound'}</Text>
          </Pressable>
          <Pressable onPress={() => setPocketMode((p) => !p)} style={{ backgroundColor: '#1f2937', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1, borderColor: pocketMode ? '#6ee7b7' : '#374151' }}>
            <Text style={{ color: pocketMode ? '#6ee7b7' : '#9CA3AF', fontSize: 13 }}>{pocketMode ? '📱 Pocket' : '👁 Visible'}</Text>
          </Pressable>
          <Pressable onPress={() => setQuickMode(false)} style={{ backgroundColor: '#1f2937', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1, borderColor: '#374151' }}>
            <Text style={{ color: '#9CA3AF', fontSize: 13 }}>Full View</Text>
          </Pressable>
        </View>
      </View>
    ) : (
    <>

    {/* Offline banner */}
    {(!isOnline || pendingSyncCount > 0) && (
      <View style={{ backgroundColor: isOnline ? '#e65100' : '#b71c1c', paddingVertical: 6, alignItems: 'center' }}>
        {!isOnline
          ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
              {pendingSyncCount > 0
                ? `📡 Offline · ${pendingSyncCount} round${pendingSyncCount > 1 ? 's' : ''} queued`
                : '📡 Offline Mode · round will sync when connected'}
            </Text>
          : <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
              ? 🔄 Syncing {pendingSyncCount} round{pendingSyncCount > 1 ? 's' : ''}
            </Text>
        }
      </View>
    )}
    {watchMode && (
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        {!isRoundActive ? (
          // Course mode Start Round gate
          <View style={{ alignItems: 'center', paddingHorizontal: 32 }}>
            {/* ── Round Summary (shown after finishing a round) ── */}
            {roundSummary && (
              <View style={{ width: '100%', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 18,
                borderWidth: 1.5, borderColor: '#10B981', paddingHorizontal: 20, paddingVertical: 18,
                marginBottom: 28, alignItems: 'center' }}>
                <Text style={{ color: '#6ee7b7', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 10 }}>ROUND SUMMARY</Text>
                {/* Total shots */}
                <View style={{ flexDirection: 'row', gap: 24, marginBottom: 12 }}>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900' }}>{roundSummary.totalShots}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 }}>SHOTS</Text>
                  </View>
                  {roundSummary.bias && (
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{
                        color: roundSummary.bias === 'right' ? '#fca5a5' : roundSummary.bias === 'left' ? '#93c5fd' : '#6ee7b7',
                        fontSize: 32, fontWeight: '900', textTransform: 'uppercase',
                      }}>{roundSummary.bias}</Text>
                      <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 }}>MISS TREND</Text>
                    </View>
                  )}
                  {roundSummary.biasConfidence != null && (
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: '#facc15', fontSize: 32, fontWeight: '900' }}>{roundSummary.biasConfidence}%</Text>
                      <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 }}>CONFIDENCE</Text>
                    </View>
                  )}
                </View>
                {/* Key message */}
                <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(110,231,183,0.2)', paddingTop: 10, width: '100%' }}>
                  <Text style={{ color: '#A7F3D0', fontSize: 14, fontWeight: '700', textAlign: 'center', lineHeight: 20 }}>
                    {roundSummary.keyMessage}
                  </Text>
                </View>
                {/* Share text */}
                <View style={{ marginTop: 12, backgroundColor: 'rgba(16,185,129,0.10)', borderRadius: 10,
                  paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(110,231,183,0.25)',
                  width: '100%', alignItems: 'center' }}>
                  <Text style={{ color: '#6ee7b7', fontSize: 13, fontWeight: '700', textAlign: 'center' }}>
                    🏌️ You saved strokes today with AI Caddie
                  </Text>
                  <Text style={{ color: 'rgba(110,231,183,0.45)', fontSize: 10, marginTop: 2, letterSpacing: 0.5 }}>
                    SmartPlay Caddie · smartplaycaddie.com
                  </Text>
                  <Pressable
                    onPress={() => handleShareRoundSummary(roundSummary)}
                    style={({ pressed }) => ({
                      marginTop: 10, backgroundColor: pressed ? '#14532d' : '#16a34a',
                      borderRadius: 8, paddingVertical: 6, paddingHorizontal: 18,
                    })}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Share Round Summary</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => setRoundSummary(null)}
                  style={{ marginTop: 10 }}>
                  <Text style={{ color: 'rgba(110,231,183,0.4)', fontSize: 11 }}>Dismiss</Text>
                </Pressable>
              </View>
            )}
            <Image source={LOGO} style={{ width: 80, height: 80, borderRadius: 999, marginBottom: 20 }} resizeMode="cover" />
            <Text style={{ color: '#A7F3D0', fontSize: 22, fontWeight: '800', marginBottom: 8, textAlign: 'center' }}>Course Mode</Text>
            <Text style={{ color: '#6ee7b7', fontSize: 13, textAlign: 'center', marginBottom: 28, lineHeight: 20 }}>Tap Start Round to activate live GPS distances, club recommendations, and swing coaching.</Text>
            <Pressable
              onPress={startRound}
              style={({ pressed }) => ({ backgroundColor: pressed ? '#14532d' : '#16a34a', borderRadius: 16, paddingVertical: 15, paddingHorizontal: 36, borderWidth: 2, borderColor: '#4ade80' })}>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>⛳ Start Round</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ backgroundColor: '#111', borderRadius: 28, padding: 24, alignItems: 'center', borderWidth: 2, borderColor: '#2e7d32', width: 220, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}>
            <Text style={{ color: '#ccc', fontSize: 13, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 }}>HOLE {currentHoleData.hole} — PAR {currentHoleData.par}</Text>
            <Text style={{ color: '#fff', fontSize: 68, fontWeight: '800', lineHeight: 74 }}>
              {targetDistance ?? currentHoleData.distance}
            </Text>
            <Text style={{ color: '#ccc', fontSize: 13, marginBottom: 12 }}>yds to middle</Text>
            {/* Caddie Adjusted indicator — visible when swing-tendency strategy is active */}
            {getCaddieDecision().strategyAdjusted && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                backgroundColor: 'rgba(134,239,172,0.12)', borderRadius: 8,
                paddingHorizontal: 9, paddingVertical: 3, marginBottom: 8,
                borderWidth: 1, borderColor: 'rgba(134,239,172,0.30)' }}>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#4ade80' }} />
                <Text style={{ color: '#86efac', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>CADDIE ADJUSTED</Text>
              </View>
            )}
            <View style={{ backgroundColor: '#1b5e20', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 6, marginBottom: 14 }}>
              <Text style={{ color: '#A7F3D0', fontSize: 18, fontWeight: '700' }}>{recommendedClub}</Text>
            </View>
            <Text style={{ color: '#ccc', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>Strokes: {strokes}</Text>
            {/* Swing tempo readout — updates live on detected swings */}
            {swingTempoLabel && (
              <View style={{
                backgroundColor:
                  swingTempoLabel === 'smooth' ? '#1b5e20' :
                  swingTempoLabel === 'fast'   ? '#7f3e00' : '#1a3a5c',
                borderRadius: 10, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 8,
              }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                  {swingTempoLabel === 'smooth' ? '✅ Good tempo' :
                   swingTempoLabel === 'fast'   ? '⚡ Quick' : '🐢 Slow'}
                </Text>
              </View>
            )}
            {/* Gyro rotation readout — wrist + body from last swing */}
            {lastSwingAnalysis && (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                <View style={{ backgroundColor: '#1a2e1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center' }}>
                  <Text style={{ color: '#aaa', fontSize: 9, textTransform: 'uppercase' }}>Body</Text>
                  <Text style={{ color: lastSwingAnalysis.bodyRotation === 'good' ? '#66bb6a' : '#f9a825', fontSize: 11, fontWeight: '700' }}>
                    {lastSwingAnalysis.bodyRotation === 'good' ? '✅ Good' : lastSwingAnalysis.bodyRotation === 'over' ? '⚠️ Over' : '↓ Low'}
                  </Text>
                </View>
                <View style={{ backgroundColor: '#1a2e1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center' }}>
                  <Text style={{ color: '#aaa', fontSize: 9, textTransform: 'uppercase' }}>Wrist</Text>
                  <Text style={{ color: lastSwingAnalysis.wristRotation === 'normal' ? '#66bb6a' : '#f9a825', fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }}>
                    {lastSwingAnalysis.wristRotation}
                  </Text>
                </View>
                <View style={{ backgroundColor: '#1a2e1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center' }}>
                  <Text style={{ color: '#aaa', fontSize: 9, textTransform: 'uppercase' }}>Score</Text>
                  <Text style={{ color: lastSwingAnalysis.rotScore >= 60 ? '#66bb6a' : '#f9a825', fontSize: 11, fontWeight: '700' }}>
                    {lastSwingAnalysis.rotScore}
                  </Text>
                </View>
              </View>
            )}
            <Text style={{ color: swingDetector.isActive ? '#4caf50' : '#aaa', fontSize: 11, marginBottom: 10 }}>
              {swingDetector.isActive ? `📡 Motion + Gyro · ${swingDetector.swingCount} swing${swingDetector.swingCount !== 1 ? 's' : ''}` : '📡 Motion off'}
            </Text>
            <Pressable
              onPress={() => setWatchMode(false)}
              style={{ backgroundColor: '#1a1a1a', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#333' }}
            >
              <Text style={{ color: '#ccc', fontSize: 13 }}>Full View</Text>
            </Pressable>
          </View>
        )}
      </View>
    )}

    {/* ── Mode toggle: absolute, always visible, upper-left ─────────────── */}
    {!watchMode && (
      <View style={{
        position: 'absolute', top: 10, left: 12, zIndex: 100,
        flexDirection: 'row',
        backgroundColor: '#0a1f0f',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#1e4620',
        overflow: 'hidden',
        elevation: 8,
        shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6,
      }}>
        <Pressable
          onPress={() => setShowDetails(false)}
          style={{
            paddingHorizontal: 16, paddingVertical: 7,
            backgroundColor: !showDetails ? '#1b5e20' : 'transparent',
          }}
        >
          <Text style={{ color: !showDetails ? '#fff' : '#aaa', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>COURSE</Text>
        </Pressable>
        <View style={{ width: 1, backgroundColor: '#1e4620' }} />
        <Pressable
          onPress={() => setShowDetails(true)}
          style={{
            paddingHorizontal: 16, paddingVertical: 7,
            backgroundColor: showDetails ? '#1b5e20' : 'transparent',
          }}
        >
          <Text style={{ color: showDetails ? '#fff' : '#aaa', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>PRO</Text>
        </Pressable>
      </View>
    )}

    {/* ── Clean play screen (no scroll) ────────────────────────────────────── */}
    {!watchMode && !showDetails && !isRoundActive && (
      <View style={{ flex: 1, backgroundColor: highContrast ? '#000' : '#0B3D2E', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, paddingBottom: Math.max(tabBarHeight, 16) }}>
        <Image source={LOGO} style={{ width: 90, height: 90, borderRadius: 999, marginBottom: 24 }} resizeMode="cover" />
        <Text style={{ color: '#A7F3D0', fontSize: 26, fontWeight: '800', letterSpacing: 0.5, marginBottom: 6, textAlign: 'center' }}>Ready to Play?</Text>
        <Text style={{ color: '#6ee7b7', fontSize: 14, textAlign: 'center', marginBottom: 32, lineHeight: 20 }}>Start your round and SmartPlay Caddie will track every shot, carry distance, and give live coaching.</Text>
        <Pressable
          onPress={startRound}
          style={({ pressed }) => ({ backgroundColor: pressed ? '#14532d' : '#16a34a', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 40, borderWidth: 2, borderColor: '#4ade80',
            shadowColor: '#4ade80', shadowOpacity: 0.5, shadowRadius: 12, elevation: 8 })}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.8 }}>⛳ Start Round</Text>
        </Pressable>
        <Text style={{ color: '#2d6a4f', fontSize: 12, marginTop: 20 }}>Hole {hole} · {activeCourse.name}</Text>

        {/* Post-round insights — shown after a round completes */}
        {(aiRoundInsights || holeStatsLog.length > 0) && (() => {
          const sg = calculateStrokesGained(shots);
          return (
            <View style={{ marginTop: 28, width: '100%', backgroundColor: '#0d2b1a', borderRadius: 14, borderWidth: 1, borderColor: '#1e4d2b', padding: 14 }}>
              <Text style={{ color: '#4ade80', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 }}>LAST ROUND INSIGHTS</Text>
              {/* Strokes Gained summary */}
              {(sg.driving !== 0 || sg.approach !== 0 || sg.putting !== 0) && (
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                  {[['Drive', sg.driving], ['Appr', sg.approach], ['Putt', sg.putting]] .map(([label, val]) => (
                    <View key={label as string} style={{ flex: 1, alignItems: 'center', backgroundColor: '#000', borderRadius: 8, paddingVertical: 6, borderWidth: 1, borderColor: (val as number) >= 0 ? '#16a34a' : '#7f1d1d' }}>
                      <Text style={{ color: '#aaa', fontSize: 8, fontWeight: '700', letterSpacing: 1 }}>{label}</Text>
                      <Text style={{ color: (val as number) >= 0 ? '#4ade80' : '#f87171', fontSize: 14, fontWeight: '800', marginTop: 2 }}>
                        {(val as number) >= 0 ? '+' : ''}{val}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              {/* AI insights text */}
              {aiRoundInsights
                ? <Text style={{ color: '#D1FAE5', fontSize: 12, lineHeight: 19 }}>{aiRoundInsights}</Text>
                : <Text style={{ color: '#6ee7b7', fontSize: 12, fontStyle: 'italic' }}>Generating insights...</Text>
              }
            </View>
          );
        })()}
      </View>
    )}
    {!watchMode && !showDetails && isRoundActive && (
      <View
        style={{ flex: 1, backgroundColor: highContrast ? '#000' : '#0B3D2E', paddingTop: 48, paddingBottom: Math.max(tabBarHeight, 16) }}
      >

        {/* Swing toast (absolute so it floats over all sections) */}
        {swingToast && (
          <View style={{
            position: 'absolute', top: 10, left: 14, right: 14, zIndex: 999,
            backgroundColor: swingTempoLabel === 'smooth' ? 'rgba(27,94,32,0.97)' : swingTempoLabel === 'fast' ? 'rgba(127,62,0,0.97)' : 'rgba(26,58,92,0.97)',
            paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12,
            flexDirection: 'row', alignItems: 'center', gap: 8,
          }}>
            <Text style={{ fontSize: 18 }}>{swingTempoLabel === 'smooth' ? '✅' : swingTempoLabel === 'fast' ? '⚡' : '🔷'}</Text>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', flex: 1 }}>{swingToast}</Text>
          </View>
        )}

        {/* Listening / Thinking / Speaking fullscreen overlay */}
        <VoiceOverlay
          visible={listening || isThinking || isSpeaking}
          phase={isSpeaking ? 'speaking' : isThinking ? 'thinking' : listeningPhase as any}
          text={isSpeaking ? caddieMessage : undefined}
          onCancel={listening && !isSpeaking ? stopListening : undefined}
        />

        {/* ── HEADER: Logo mic · Hole · Strategy ─────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 6 }}>
          <Pressable
            onPress={handleListeningVoiceToggle}
            style={({ pressed }) => ({
              backgroundColor: listening ? '#1b5e20' : pressed ? '#1b5e20' : '#143d22',
              borderRadius: 999, width: 52, height: 52,
              justifyContent: 'center', alignItems: 'center',
              borderWidth: 2, borderColor: listening ? '#4ade80' : '#4caf50',
              shadowColor: '#4ade80', shadowOpacity: listening ? 0.9 : 0.5, shadowRadius: 10, elevation: 6,
            })}
          >
            <Image source={LOGO} style={{ width: 42, height: 42, borderRadius: 999 }} resizeMode="cover" />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Pressable onPress={() => setShowCourseSelect((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ color: '#6ee7b7', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{activeCourse.name}</Text>
              <Text style={{ color: '#4ade80', fontSize: 14 }}>{showCourseSelect ? '▴' : '▾'}</Text>
            </Pressable>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
              H{currentHoleData.hole} · Par {currentHoleData.par}{currentHoleData.note ? <Text style={{ color: '#6ee7b7', fontSize: 12, fontWeight: '400' }}>  {currentHoleData.note}</Text> : null}
            </Text>
          </View>
          <Pressable
            onPress={() => setStrategyMode((s) => s === 'safe' ? 'neutral' : s === 'neutral' ? 'attack' : 'safe')}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
              backgroundColor: strategyMode === 'attack' ? '#7f1d1d' : strategyMode === 'safe' ? '#1a3a2a' : '#1a1a1a',
              borderWidth: 1, borderColor: strategyMode === 'attack' ? '#f87171' : strategyMode === 'safe' ? '#4ade80' : '#6b7280' }}>
            <Text style={{ color: strategyMode === 'attack' ? '#f87171' : strategyMode === 'safe' ? '#4ade80' : '#d1d5db', fontSize: 12, fontWeight: '800' }}>
              {strategyMode === 'attack' ? '🔥 ATK' : strategyMode === 'safe' ? '🛡 SAFE' : '⚖️ NEU'}
            </Text>
          </Pressable>
        </View>

        {/* Inline course selector — expands when course name tapped */}
        {showCourseSelect && (
          <View style={{ marginHorizontal: 16, marginBottom: 6, backgroundColor: '#0d1f14', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 8 }}>
            {COURSE_DB.map((course, idx) => (
              <Pressable
                key={idx}
                onPress={() => {
                  const h1 = COURSE_DB[idx].holes[0];
                  setSelectedCourseIdx(idx);
                  setActiveCourse(COURSE_DB[idx].name);
                  setHole(1);
                  setStrokes(h1.par);
                  setPar(h1.par);
                  setDistance(String(h1.distance));
                  setLastShotBadge(null);
                  setShowCourseSelect(false);
                  void voiceSpeak(`${course.name} selected.`, 'calm');
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: idx === selectedCourseIdx ? '#1b5e20' : pressed ? '#222' : 'transparent',
                  borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 2,
                  borderWidth: 1, borderColor: idx === selectedCourseIdx ? '#66bb6a' : 'transparent',
                })}
              >
                <Text style={{ color: idx === selectedCourseIdx ? '#fff' : '#A7F3D0', fontWeight: idx === selectedCourseIdx ? '700' : '400', fontSize: 13, flex: 1 }}>{course.name}</Text>
                {idx === selectedCourseIdx && <Text style={{ color: '#66bb6a' }}>✓</Text>}
              </Pressable>
            ))}
          </View>
        )}

        {/* ── SECTION 1: DISTANCE BLOCK ─────────────────────────────────────── */}
        <View style={{ alignItems: 'center', paddingHorizontal: 16, marginBottom: 6 }}>

          {/* BIG: distance */}
          <Text style={{ color: '#ffffff', fontSize: 88, fontWeight: '900', lineHeight: 90, letterSpacing: -3 }}>
            {targetDistance ?? gpsYards?.middle ?? currentHoleData.distance}
          </Text>

          {/* Source label */}
          <Text style={{ color: gpsWeak ? '#f59e0b' : gpsYards ? '#4ade80' : '#6ee7b7', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginTop: -2, marginBottom: 4 }}>
            {gpsWeak ? '⚠️ GPS WEAK' : gpsYards ? '📡 GPS · MID' : 'YDS TO PIN'}
          </Text>

          {/* SMALL: front / back — only when GPS active */}
          {gpsYards && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 8 }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: '#94a3b8', fontSize: 20, fontWeight: '700' }}>{gpsYards.front ?? '--'}</Text>
                <Text style={{ color: '#64748b', fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>FRONT</Text>
              </View>
              <View style={{ width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.1)' }} />
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: '#94a3b8', fontSize: 20, fontWeight: '700' }}>{gpsYards.back ?? '--'}</Text>
                <Text style={{ color: '#64748b', fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>BACK</Text>
              </View>
            </View>
          )}

          {/* No GPS — start button */}
          {!gpsYards && (
            <Pressable onPress={startGpsWatch} style={{ marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 6 }}>
              <Text style={{ color: '#4caf50', fontSize: 12, fontWeight: '700' }}>📍 Start GPS</Text>
            </Pressable>
          )}

          {/* Recommended club pill — tap to open club strip */}
          <Pressable
            onPress={() => setShowClubStrip((v) => !v)}
            style={{ backgroundColor: '#1b5e20', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 6, marginBottom: 8, borderWidth: 1, borderColor: '#4caf50' }}>
            <Text style={{ color: '#A7F3D0', fontSize: 16, fontWeight: '800' }}>{recommendedClub} {showClubStrip ? '▴' : '▾'}</Text>
          </Pressable>
          {/* Club chip strip — shown on demand */}
          {showClubStrip && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8, maxHeight: 56 }}>
              <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 2 }}>
                {(() => {
                  const yardMap = Object.fromEntries(getClubYardageMap());
                  return ['Driver','3 Wood','5 Wood','4 Iron','5 Iron','6 Iron','7 Iron','8 Iron','9 Iron','PW','GW','SW','LW','Putter'].map((c) => (
                    <Pressable key={c} onPress={() => { setClub(c); setShowClubStrip(false); }}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                        backgroundColor: club === c ? '#2e7d32' : '#1a1a1a',
                        borderWidth: 1, borderColor: club === c ? '#4caf50' : '#2a2a2a' }}>
                      <Text style={{ color: club === c ? '#fff' : '#A7F3D0', fontSize: 13, fontWeight: '700' }}>
                        {c.replace(' Wood','W').replace(' Iron','i')}
                      </Text>
                      <Text style={{ color: club === c ? '#86efac' : '#6ee7b7', fontSize: 10, marginTop: 1 }}>
                        {yardMap[c] ?? '—'}
                      </Text>
                    </Pressable>
                  ));
                })()}
              </View>
            </ScrollView>
          )}
          {/* ±10 nudge */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 6 }}>
            <Pressable
              onPress={() => { const cur = parseInt(distance, 10) || (targetDistance ?? currentHoleData?.distance ?? 150); const next = Math.max(10, cur - 10); setDistance(String(next)); setTargetDistance(next); }}
              style={{ backgroundColor: '#1f2937', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 7, borderWidth: 1, borderColor: '#374151' }}>
              <Text style={{ color: '#A7F3D0', fontSize: 15, fontWeight: '700' }}>−10</Text>
            </Pressable>
            <Pressable
              onPress={() => { const cur = parseInt(distance, 10) || (targetDistance ?? currentHoleData?.distance ?? 150); const next = Math.min(700, cur + 10); setDistance(String(next)); setTargetDistance(next); }}
              style={{ backgroundColor: '#1f2937', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 7, borderWidth: 1, borderColor: '#374151' }}>
              <Text style={{ color: '#A7F3D0', fontSize: 15, fontWeight: '700' }}>+10</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Milestone Banner ───────────────────────────────────────────── */}
        {milestoneMessage && (
          <Pressable onPress={() => setMilestoneMessage(null)}
            style={{ marginHorizontal: 16, marginBottom: 6, borderRadius: 14,
              backgroundColor: 'rgba(16,185,129,0.15)', borderWidth: 1.5, borderColor: '#10B981',
              paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 20 }}>{shots.length >= 10 ? '🔥' : '⚡'}</Text>
            <Text style={{ flex: 1, color: '#6ee7b7', fontSize: 13, fontWeight: '700', lineHeight: 18 }}>
              {milestoneMessage}
            </Text>
            <Text style={{ color: 'rgba(110,231,183,0.5)', fontSize: 11 }}>✕</Text>
          </Pressable>
        )}

        {/* ── DECISION CARD: Club + Strategy ───────────────────────────────── */}
        {(() => {
          // All output comes from the single decision engine
          const d = decision;
          const confColor = d.confidence >= 85 ? '#4ade80' : d.confidence >= 70 ? '#facc15' : '#f97316';
          const confBg = d.confidence >= 85 ? 'rgba(74,222,128,0.15)' : d.confidence >= 70 ? 'rgba(250,204,21,0.15)' : 'rgba(249,115,22,0.15)';
          const rb = shots.length >= 5 ? getRecentBias() : null;
          const biasKey = rb ?? d.bias?.bias ?? null;
          const insightText = biasKey === 'right'
            ? (rb ? 'Adjust left today — last 5 shots trending right.' : "You're missing right today — aim slightly left.")
            : biasKey === 'left'
            ? (rb ? 'Adjust right today — last 5 shots trending left.' : "You're missing left today — aim slightly right.")
            : biasKey === 'straight' ? 'Straight ball flight — stay the course.'
            : null;
          const insightColor = biasKey === 'right' ? '#fca5a5' : biasKey === 'left' ? '#93c5fd' : '#6ee7b7';
          return (
            <View style={{ marginHorizontal: 16, marginBottom: 6, backgroundColor: 'rgba(0,0,0,0.45)',
              borderRadius: 18, paddingHorizontal: 20, paddingVertical: 16, alignItems: 'center',
              borderWidth: 1.5, borderColor: '#10B981' }}>

              {/* BIG: Club — Aim */}
              <Text style={{ color: '#ffffff', fontSize: 32, fontWeight: '900', letterSpacing: 0.3, textAlign: 'center', lineHeight: 38 }}>
                {d.club}{' — '}{d.aimLabel}
              </Text>

              {/* SMALL: Miss danger */}
              <Text style={{ color: d.missColor, fontSize: 14, fontWeight: '700', marginTop: 5, textAlign: 'center', letterSpacing: 0.2 }}>
                {d.miss}
              </Text>

              {/* Confidence badge */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <View style={{ backgroundColor: confBg, borderRadius: 20, borderWidth: 1.5, borderColor: confColor,
                  paddingHorizontal: 14, paddingVertical: 4 }}>
                  <Text style={{ color: confColor, fontSize: 13, fontWeight: '800', letterSpacing: 0.3 }}>
                    {d.confidence}% Confidence
                  </Text>
                </View>
              </View>

              {/* Insight text — shown once 5 shots logged */}
              {insightText && (
                <Text style={{ color: insightColor, fontSize: 13, fontWeight: '600', marginTop: 8, textAlign: 'center', fontStyle: 'italic' }}>
                  {insightText}
                </Text>
              )}

              {/* Shot-shape strategy badge */}
              {d.swingTendency && (
                <View style={{ marginTop: 8, gap: 4 }}>
                  {/* "Strategy adjusted for shot shape" pill */}
                  <View style={{
                    backgroundColor: d.aggressiveLine
                      ? 'rgba(134,239,172,0.15)'   // green tint for draw/aggressive
                      : d.swingTendency.avoidRightHazard
                        ? 'rgba(251,191,36,0.12)'   // amber for slice/push hazard avoid
                        : 'rgba(167,243,208,0.10)',
                    borderRadius: 10,
                    paddingHorizontal: 12, paddingVertical: 7,
                    borderWidth: 1,
                    borderColor: d.aggressiveLine
                      ? 'rgba(134,239,172,0.40)'
                      : d.swingTendency.avoidRightHazard
                        ? 'rgba(251,191,36,0.35)'
                        : 'rgba(167,243,208,0.28)',
                    alignItems: 'center', gap: 2,
                  }}>
                    <Text style={{
                      color: d.aggressiveLine ? '#86efac'
                           : d.swingTendency.avoidRightHazard ? '#fbbf24'
                           : '#6ee7b7',
                      fontSize: 11, fontWeight: '800', letterSpacing: 0.5,
                    }}>
                      {d.aggressiveLine ? '🏹 Strategy adjusted for shot shape'
                       : d.swingTendency.avoidRightHazard ? '⚠️ Strategy adjusted for shot shape'
                       : '🎯 Strategy adjusted for shot shape'}
                    </Text>
                    <Text style={{
                      color: d.aggressiveLine ? '#bbf7d0'
                           : d.swingTendency.avoidRightHazard ? '#fde68a'
                           : '#a7f3d0',
                      fontSize: 11, textAlign: 'center', lineHeight: 16,
                    }}>
                      {d.swingTendency.detail}
                      {d.swingTendency.clubNote ? `\n${d.swingTendency.clubNote}` : ''}
                    </Text>
                  </View>
                </View>
              )}

              {/* Strategy message */}
              <Text style={{ color: 'rgba(167,243,208,0.75)', fontSize: 11, marginTop: 5, textAlign: 'center', fontStyle: 'italic' }}>
                {d.message}
              </Text>

              {/* Action buttons row */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                {/* Hear Advice */}
                <Pressable
                  onPress={() => {
                    stopSpeaking();
                    speakDecision();
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 18, paddingVertical: 8,
                    borderRadius: 20, borderWidth: 1.5, borderColor: '#10B981',
                    backgroundColor: pressed ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.08)' })}>
                  <Text style={{ fontSize: 15 }}>🔊</Text>
                  <Text style={{ color: '#6ee7b7', fontSize: 13, fontWeight: '700', letterSpacing: 0.4 }}>Hear Advice</Text>
                </Pressable>

                {/* Aim Assist */}
                <Pressable
                  onPress={async () => {
                    if (!cameraPermission?.granted) {
                      await requestCameraPermission();
                    }
                    setAimMode(true);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 18, paddingVertical: 8,
                    borderRadius: 20, borderWidth: 1.5, borderColor: '#60a5fa',
                    backgroundColor: pressed ? 'rgba(96,165,250,0.18)' : 'rgba(96,165,250,0.08)' })}>
                  <Text style={{ fontSize: 15 }}>🎯</Text>
                  <Text style={{ color: '#93c5fd', fontSize: 13, fontWeight: '700', letterSpacing: 0.4 }}>Aim Assist</Text>
                </Pressable>
              </View>
            </View>
          );
        })()}

        {/* ── SECTION 2: CADDIE CALL ────────────────────────────────────────── */}
        <Pressable
          onPress={() => setSwingThought(FOCUS_MESSAGES[Math.floor(Math.random() * FOCUS_MESSAGES.length)])}
          style={{ marginHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 16,
            paddingHorizontal: 18, paddingVertical: 12, marginBottom: 6, alignItems: 'center' }}>
          {aiThinking ? (
            <Text style={{ color: '#6ee7b7', fontSize: 16, fontStyle: 'italic' }}>Thinking...</Text>
          ) : (
            <Text style={{ color: '#A7F3D0', fontSize: 18, fontWeight: '700', textAlign: 'center', lineHeight: 26 }} numberOfLines={3}>
              {caddieMessage || caddieAdvice || 'Commit to your target.'}
            </Text>
          )}
          {shots.length >= 3 && (
            <Text style={{ color: '#4ade80', fontSize: 11, marginTop: 4 }}>Confidence {decision.confidence}%</Text>
          )}
          <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(110,231,183,0.2)', marginTop: 8, paddingTop: 6, alignItems: 'center', width: '100%' }}>
            <Text style={{ color: '#6ee7b7', fontSize: 8, fontWeight: '700', letterSpacing: 1.1, marginBottom: 2 }}>SWING THOUGHT · TAP TO REFRESH</Text>
            <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '600', textAlign: 'center', fontStyle: 'italic' }}>{swingThought}</Text>
          </View>
        </Pressable>

        {/* ── SECTION 3: VISUAL AIM AREA ───────────────────────────────────────── */}
        <View style={{ marginHorizontal: 16, marginBottom: 6, alignItems: 'center' }}>

          {/* ── Visual Aim Diagram ── */}
          {(() => {
            const mb = decision.bias;
            const dangerRight = mb?.bias === 'right';
            const dangerLeft  = mb?.bias === 'left';
            const noBias      = !mb;
            const aimRotate   = aim === 'left center' ? '-18deg' : aim === 'right center' ? '18deg' : '0deg';
            const circlePct   = aim === 'left center' ? 33 : aim === 'right center' ? 57 : 45;
            return (
              <View style={{ width: '100%', maxWidth: 320, height: 120, marginBottom: 10, borderRadius: 16,
                backgroundColor: '#071f13', overflow: 'hidden',
                borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)' }}>

                {/* Left danger zone */}
                <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '28%',
                  backgroundColor: (dangerLeft ? 'rgba(239,68,68,0.25)' : noBias ? 'rgba(239,68,68,0.07)' : 'transparent') }}>
                  {dangerLeft && (
                    <Text style={{ color: '#ef4444', fontSize: 8, fontWeight: '800',
                      position: 'absolute', top: 8, width: '100%', textAlign: 'center', letterSpacing: 0.6 }}>
                      DANGER
                    </Text>
                  )}
                </View>

                {/* Fairway strip */}
                <View style={{ position: 'absolute', top: 0, bottom: 0, left: '28%', right: '28%',
                  backgroundColor: 'rgba(16,185,129,0.12)',
                  borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(16,185,129,0.28)' }} />

                {/* Right danger zone */}
                <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '28%',
                  backgroundColor: (dangerRight ? 'rgba(239,68,68,0.25)' : noBias ? 'rgba(239,68,68,0.07)' : 'transparent') }}>
                  {dangerRight && (
                    <Text style={{ color: '#ef4444', fontSize: 8, fontWeight: '800',
                      position: 'absolute', top: 8, width: '100%', textAlign: 'center', letterSpacing: 0.6 }}>
                      DANGER
                    </Text>
                  )}
                </View>

                {/* Blue aim line — rotates around its bottom via translate trick */}
                <View style={{ position: 'absolute', bottom: 26, left: '50%', marginLeft: -1.5,
                  width: 3, height: 72, backgroundColor: '#3b82f6', borderRadius: 2,
                  transform: [{ rotate: aimRotate }] }} />

                {/* Landing circle at player end */}
                <View style={{ position: 'absolute', bottom: 18, left: `${circlePct}%`, marginLeft: -8,
                  width: 16, height: 16, borderRadius: 8,
                  backgroundColor: '#0f172a', borderWidth: 2.5, borderColor: '#ffffff' }} />

                {/* Hole flag */}
                <Text style={{ position: 'absolute', top: 6, left: '50%', marginLeft: -9, fontSize: 18 }}>⛳</Text>

                {/* Aim label */}
                <Text style={{ position: 'absolute', bottom: 4, width: '100%', textAlign: 'center',
                  color: 'rgba(255,255,255,0.35)', fontSize: 8, fontWeight: '800', letterSpacing: 1.2 }}>
                  {aim === 'left center' ? '← AIMING LEFT' : aim === 'right center' ? 'AIMING RIGHT →' : '● CENTER LINE'}
                </Text>
              </View>
            );
          })()}

          {/* Aim buttons — centered, max width matches diagram */}
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 5, width: '100%', maxWidth: 320 }}>
            {(['left center','center','right center'] as const).map((a) => (
              <Pressable key={a} onPress={() => storeSetAim(a)}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                  backgroundColor: aim === a ? '#10B981' : '#1a1a1a',
                  borderWidth: 1, borderColor: aim === a ? '#fff' : '#2a2a2a' }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                  {a === 'left center' ? '← L' : a === 'center' ? '● CTR' : 'R →'}
                </Text>
              </Pressable>
            ))}
          </View>
          {/* Bias strategy */}
          {(() => { const bs = getBiasStrategy(); return (
            <Text style={{ color: bs.color, fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 2 }}>⚡ {bs.label}</Text>
          ); })()}
          {/* Aim offset pill */}
          {(() => { const ao = decision.aimOffset; return ao ? (
            <View style={{ alignItems: 'center', marginBottom: 3 }}>
              <View style={{ backgroundColor: '#1a1a2a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 3, borderWidth: 1, borderColor: ao.color }}>
                <Text style={{ color: ao.color, fontSize: 11, fontWeight: '700' }}>🎯 {ao.target === 'center' ? 'Center line' : ao.target === 'left center' ? 'Aim Left' : 'Aim Right'} · {ao.label}</Text>
              </View>
              <Text style={{ color: ao.color, fontSize: 10, fontWeight: '600', marginTop: 3, fontStyle: 'italic', opacity: 0.85 }}>{ao.miss}</Text>
            </View>
          ) : null; })()}
          {/* Caddie Tip — practice memory */}
          {(() => {
            if (cmMissBias === 'neutral' || cmConfidence < 30 || cmUpdated === 0) return null;
            // Only show when live round hasn't yet generated its own bias signal
            if (getMissBias() !== null) return null;
            const color   = cmMissBias === 'right' ? '#93c5fd' : '#fcd34d';
            const aimText = cmMissBias === 'right' ? 'Aim slightly left' : 'Aim slightly right';
            const noteText = cmMissBias === 'right'
              ? 'You tend to miss right — adjust aim'
              : 'You tend to miss left — adjust aim';
            return (
              <View style={{ alignItems: 'center', marginTop: 4, marginBottom: 2 }}>
                <View style={{ backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, borderWidth: 1, borderColor: color, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center', gap: 2 }}>
                  <Text style={{ color, fontSize: 12, fontWeight: '800' }}>🧠 {aimText}</Text>
                  <Text style={{ color: '#9ca3af', fontSize: 10, fontStyle: 'italic' }}>{noteText} ({cmConfidence}% confidence)</Text>
                </View>
              </View>
            );
          })()}
          {/* Dispersion counts */}
          {(() => {
            const la = getLiveAnalytics();
            const pd = getPatternDetection();
            return la ? (
              <View style={{ alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
                  <View style={{ backgroundColor: '#1e3a5f', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ color: '#93c5fd', fontSize: 11, fontWeight: '700' }}>← {la.left} ({la.leftPct}%)</Text>
                  </View>
                  <View style={{ backgroundColor: '#14532d', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ color: '#86efac', fontSize: 11, fontWeight: '700' }}>● {la.straight} ({la.strPct}%)</Text>
                  </View>
                  <View style={{ backgroundColor: '#7c2d12', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '700' }}>{la.right} ({la.rightPct}%) →</Text>
                  </View>
                </View>
                {la.insight && (
                  <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: '700', marginTop: 4, fontStyle: 'italic' }}>
                    {la.insight}
                  </Text>
                )}
                {pd && (
                  <Text style={{ color: pd.pattern === 'push' ? '#fca5a5' : '#93c5fd', fontSize: 11, fontWeight: '700', marginTop: 3, fontStyle: 'italic' }}>
                    {pd.coaching} ({pd.pct}%)
                  </Text>
                )}
              </View>
            ) : null;
          })()}
        </View>

        {/* ── SECTION 4: ACTION BUTTONS ────────────────────────────────────── */}
        {/* Target selector */}
        <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 6 }}>
          {(['left', 'center', 'right'] as const).map((t) => (
            <Pressable key={t} onPress={() => setShotTarget(t)}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                borderWidth: shotTarget === t ? 2 : 1,
                borderColor: shotTarget === t ? '#6ee7b7' : '#374151',
                backgroundColor: shotTarget === t ? 'rgba(110,231,183,0.12)' : 'transparent' }}>
              <Text style={{ color: shotTarget === t ? '#6ee7b7' : '#6b7280', fontSize: 11, fontWeight: shotTarget === t ? '800' : '400' }}>
                {t === 'left' ? '← Left' : t === 'center' ? '● Center' : 'Right →'}
              </Text>
            </Pressable>
          ))}
        </View>
        {/* Large 3-up shot result row */}
        <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 6 }}>
          <Pressable onPress={onShotLeftPress}
            style={({ pressed }) => ({ flex: 1, height: 96, borderRadius: 18, justifyContent: 'center', alignItems: 'center',
              backgroundColor: pressed ? '#7f1d1d' : '#1c0f0f',
              borderWidth: 2.5, borderColor: '#ef4444',
              shadowColor: '#ef4444', shadowOpacity: pressed ? 0.55 : 0.25, shadowRadius: 10, elevation: 5 })}>
            <Text style={{ fontSize: 30 }}>↙️</Text>
            <Text style={{ color: '#ef4444', fontSize: 15, fontWeight: '900', marginTop: 3, letterSpacing: 0.5 }}>LEFT</Text>
          </Pressable>
          <Pressable onPress={onShotStraightPress}
            style={({ pressed }) => ({ flex: 1, height: 96, borderRadius: 18, justifyContent: 'center', alignItems: 'center',
              backgroundColor: pressed ? '#064e3b' : '#0c1f18',
              borderWidth: 2.5, borderColor: '#6ee7b7',
              shadowColor: '#6ee7b7', shadowOpacity: pressed ? 0.65 : 0.35, shadowRadius: 12, elevation: 7 })}>
            <Text style={{ fontSize: 32 }}>⬆️</Text>
            <Text style={{ color: '#6ee7b7', fontSize: 15, fontWeight: '900', marginTop: 3, letterSpacing: 0.5 }}>STRAIGHT</Text>
          </Pressable>
          <Pressable onPress={onShotRightPress}
            style={({ pressed }) => ({ flex: 1, height: 96, borderRadius: 18, justifyContent: 'center', alignItems: 'center',
              backgroundColor: pressed ? '#78350f' : '#1c1508',
              borderWidth: 2.5, borderColor: '#f59e0b',
              shadowColor: '#f59e0b', shadowOpacity: pressed ? 0.55 : 0.25, shadowRadius: 10, elevation: 5 })}>
            <Text style={{ fontSize: 30 }}>↘️</Text>
            <Text style={{ color: '#f59e0b', fontSize: 15, fontWeight: '900', marginTop: 3, letterSpacing: 0.5 }}>RIGHT</Text>
          </Pressable>
        </View>
        {/* GPS Mark row */}
        <View style={{ marginHorizontal: 16, marginBottom: 6, alignItems: 'center' }}>
          <Pressable onPress={() => { void handleMarkBall(); }}
            style={({ pressed }) => ({ flexDirection: 'row', gap: 8, alignItems: 'center',
              paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12,
              backgroundColor: pressed ? '#1a2e1a' : prevShotYardsRef.current ? '#132b13' : '#141a14',
              borderWidth: prevShotYardsRef.current ? 2 : 1.5,
              borderColor: prevShotYardsRef.current ? '#4ade80' : '#2a4a2a',
              shadowColor: '#4ade80', shadowOpacity: prevShotYardsRef.current ? 0.45 : 0.08, shadowRadius: 8, elevation: 3 })}>
            <Text style={{ fontSize: 16 }}>📍</Text>
            <Text style={{ color: prevShotYardsRef.current ? '#4ade80' : '#6ee7b7', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 }}>MARK GPS</Text>
          </Pressable>
        </View>
        {lastShotBadge && (
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 4 }}>
            <View style={{ backgroundColor: '#064e3b', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: '#6ee7b7', fontSize: 12, fontWeight: '700' }}>~{lastShotBadge.yardsCarried} yd · {lastShotBadge.club}</Text>
            </View>
            <View style={{ backgroundColor: '#1a2a1a', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: '#a7f3d0', fontSize: 12 }}>{lastShotBadge.yardsRemaining} yd to pin</Text>
            </View>
          </View>
        )}

        {/* ── MENTAL STATE ─────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: 16, marginBottom: 6 }}>
          {(['confident', 'neutral', 'pressure', 'frustrated'] as const).map((state) => {
            const active = mentalState === state;
            const cfg = {
              confident:  { emoji: '💪', label: 'Confident',  border: '#4ade80', bg: 'rgba(74,222,128,0.15)'  },
              neutral:    { emoji: '😐', label: 'Neutral',    border: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
              pressure:   { emoji: '😬', label: 'Pressure',   border: '#f59e0b', bg: 'rgba(245,158,11,0.15)'  },
              frustrated: { emoji: '😤', label: 'Frustrated', border: '#ef4444', bg: 'rgba(239,68,68,0.15)'   },
            }[state];
            return (
              <Pressable key={state} onPress={() => setMentalState(state)}
                style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? cfg.border : 'rgba(255,255,255,0.10)',
                  backgroundColor: active ? cfg.bg : 'transparent' }}>
                <Text style={{ fontSize: 14 }}>{cfg.emoji}</Text>
                <Text style={{ color: active ? cfg.border : '#6b7280', fontSize: 9, fontWeight: '700',
                  marginTop: 2, letterSpacing: 0.3 }}>{cfg.label.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── SECTION 5: SHOT INPUT (SCORING) ──────────────────────────────── */}
        <View style={{ marginHorizontal: 16, gap: 5 }}>
          {/* Player score rows — one row per active player */}
          {Array.from({ length: activePlayerCount }).map((_, i) => {
            // Player 0 uses the main `strokes` state (drives shot tracking).
            // Other players read/write multiRound[hole].scores[i] directly.
            const isMainPlayer = i === 0;
            const otherScore = (() => {
              const entry = multiRound.find((h) => h.hole === hole);
              return entry ? (entry.scores[i] ?? 0) : 0;
            })();
            const displayScore = isMainPlayer ? strokes : otherScore;
            return (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: i === 0 ? '#2e7d32' : '#2a2a2a', gap: 6 }}>
                <Text style={{ color: i === 0 ? '#A7F3D0' : '#9CA3AF', fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>{players[i]}</Text>
                <Pressable
                  onPress={() => {
                    if (isMainPlayer) {
                      setStrokes((s) => Math.max(0, s - 1));
                    } else {
                      setMultiRoundPersisted((prev) => {
                        const idx = prev.findIndex((h) => h.hole === hole);
                        if (idx === -1) return [...prev, { hole, par, scores: [strokes, 0, 0, 0].map((s, si) => si === i ? 0 : s) }];
                        return prev.map((h, hi) => hi === idx ? { ...h, scores: h.scores.map((s, si) => si === i ? Math.max(0, s - 1) : s) } : h);
                      });
                    }
                  }}
                  style={{ width: 34, height: 34, backgroundColor: '#2a2a2a', borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 22 }}>−</Text>
                </Pressable>
                <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', minWidth: 28, textAlign: 'center' }}>{displayScore}</Text>
                <Pressable
                  onPress={() => {
                    if (isMainPlayer) {
                      setStrokes((s) => s + 1);
                    } else {
                      setMultiRoundPersisted((prev) => {
                        const idx = prev.findIndex((h) => h.hole === hole);
                        if (idx === -1) return [...prev, { hole, par, scores: [strokes, 0, 0, 0].map((s, si) => si === i ? 1 : s) }];
                        return prev.map((h, hi) => hi === idx ? { ...h, scores: h.scores.map((s, si) => si === i ? s + 1 : s) } : h);
                      });
                    }
                  }}
                  style={{ width: 34, height: 34, backgroundColor: '#2e7d32', borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 22 }}>+</Text>
                </Pressable>
              </View>
            );
          })}

          {/* Stats row: Putts + FIR + GIR */}
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 2 }}>
            {/* Putts */}
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', paddingHorizontal: 8, paddingVertical: 4, gap: 4 }}>
              <Pressable onPress={() => setPuttsThisHole((p) => Math.max(0, p - 1))} style={{ width: 26, height: 26, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: '#aaa', fontSize: 16, fontWeight: '700' }}>−</Text>
              </Pressable>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: '#aaa', fontSize: 8, fontWeight: '700', letterSpacing: 1 }}>PUTTS</Text>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{puttsThisHole}</Text>
              </View>
              <Pressable onPress={() => setPuttsThisHole((p) => p + 1)} style={{ width: 26, height: 26, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2e7d32', borderRadius: 6 }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>+</Text>
              </Pressable>
            </View>
            {/* FIR — not shown for par 3 */}
            {par !== 3 && (
              <View style={{ flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', paddingVertical: 4 }}>
                <Text style={{ color: '#aaa', fontSize: 8, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>FIR</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable onPress={() => setFirThisHole(true)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: firThisHole === true ? '#16a34a' : '#2a2a2a' }}>
                    <Text style={{ color: firThisHole === true ? '#fff' : '#aaa', fontSize: 11, fontWeight: '700' }}>✓</Text>
                  </Pressable>
                  <Pressable onPress={() => setFirThisHole(false)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: firThisHole === false ? '#991b1b' : '#2a2a2a' }}>
                    <Text style={{ color: firThisHole === false ? '#fff' : '#aaa', fontSize: 11, fontWeight: '700' }}>✗</Text>
                  </Pressable>
                </View>
              </View>
            )}
            {/* GIR */}
            <View style={{ flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', paddingVertical: 4 }}>
              <Text style={{ color: '#aaa', fontSize: 8, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>GIR</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable onPress={() => setGirThisHole(true)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: girThisHole === true ? '#16a34a' : '#2a2a2a' }}>
                  <Text style={{ color: girThisHole === true ? '#fff' : '#aaa', fontSize: 11, fontWeight: '700' }}>✓</Text>
                </Pressable>
                <Pressable onPress={() => setGirThisHole(false)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: girThisHole === false ? '#991b1b' : '#2a2a2a' }}>
                  <Text style={{ color: girThisHole === false ? '#fff' : '#aaa', fontSize: 11, fontWeight: '700' }}>✗</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Next hole / Finish */}
          <Pressable
            onPress={() => {
              const s = strokes;
              if (s < par) respond("Let's go! Birdie.");
              else if (s === par) respond('Solid par. Keep it going.');
              else if (s >= par + 2) respond('Shake it off. Next one.');
              // Capture hole stats before advancing
              setHoleStatsLog((prev) => [...prev, { hole, strokes: s, putts: puttsThisHole, fairwayHit: par === 3 ? null : firThisHole, gir: girThisHole }]);
              setRound((prev) => { const u = [...prev]; u[hole - 1] = s; return u; });
              setRoundPars((prev) => { const u = [...prev]; u[hole - 1] = par; return u; });
              // Persist player 0's strokes into multiRound so scorecard is complete
              setMultiRoundPersisted((prev) => {
                const idx = prev.findIndex((h) => h.hole === hole);
                if (idx === -1) return [...prev, { hole, par, scores: [s, 0, 0, 0] }];
                return prev.map((h, hi) => hi === idx ? { ...h, scores: h.scores.map((sc, si) => si === 0 ? s : sc) } : h);
              });
              updateScore(par, s);
              // Reset per-hole stats for next hole
              setPuttsThisHole(0);
              setFirThisHole(null);
              setGirThisHole(null);
              if (hole < roundLength) {
                const nextH = hole + 1;
                setHole(nextH);
                const hd = activeCourse.holes[Math.min(nextH - 1, activeCourse.holes.length - 1)];
                setPar(hd.par);
                setDistance(String(hd.distance));
                setStrokes(hd.par);  // default to par so +/- reflects over/under immediately
              } else {
                // Capture round summary before ending
                const mb = getMissBias();
                const rb = getRecentBias();
                const finalBias = rb ?? mb?.bias ?? null;
                const keyMsg = finalBias === 'right'
                  ? 'You pushed right all round — aim left next time.'
                  : finalBias === 'left'
                  ? 'You pulled left all round — aim right next time.'
                  : shots.length >= 5
                  ? 'Straight ball flight — great consistency!'
                  : 'Not enough shots for a pattern. Keep tracking!';
                setRoundSummary({
                  totalShots: shots.length,
                  bias: finalBias,
                  biasConfidence: mb?.confidence ?? null,
                  keyMessage: keyMsg,
                });
                void endRound();
                setStrokes(0);
              }
              setLastShotBadge(null);
            }}
            style={({ pressed }) => ({ backgroundColor: pressed ? '#0d4a1a' : '#1b5e20', borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#4caf50' })}
          >
            <Text style={{ color: '#A7F3D0', fontSize: 14, fontWeight: '800' }}>
              {hole < roundLength ? `Next Hole → ${hole + 1}` : '🏁 Finish Round'}
            </Text>
          </Pressable>
        </View>

      </View>
    )}

    {/* ── Full details (original ScrollView, shown on demand) ─────────────── */}
    {!watchMode && showDetails && <ScrollView style={[styles.scroll, { backgroundColor: highContrast ? '#000' : '#0B3D2E' }]} contentContainerStyle={[styles.container, { paddingTop: 48 }]} scrollEnabled={!voiceOverlayActive}>
      {/* -- Swing Toast Overlay ---------------------------------------------- */}
      {swingToast && (
        <View style={{
          position: 'absolute',
          top: 10,
          left: 20,
          right: 20,
          zIndex: 998,
          backgroundColor:
            swingTempoLabel === 'smooth' ? 'rgba(27,94,32,0.95)' :
            swingTempoLabel === 'fast'   ? 'rgba(127,62,0,0.95)' : 'rgba(26,58,92,0.95)',
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderRadius: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 8,
          elevation: 6,
        }}>
          <Text style={{ fontSize: 18 }}>
            {swingTempoLabel === 'smooth' ? '✅' : swingTempoLabel === 'fast' ? '⚡' : '🔵'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{swingToast}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
              Swing #{swingDetector.swingCount}
            </Text>
          </View>
        </View>
      )}

      {/* Listening / Thinking / Speaking overlay */}
      <CaddieMicButton
        size={60}
        showLabel={true}
        style={{ marginBottom: 10 }}
        context={{ hole: currentHoleData.hole, par: currentHoleData.par, distance: currentHoleData.distance }}
      />

      {/* Voice Response Card — shows last caddie response after listening */}
      {commandResponse.length > 0 && !isThinking && !listening && (
        <View style={{
          marginHorizontal: 0,
          marginBottom: 4,
          backgroundColor: '#0f2d1f',
          borderRadius: 14,
          padding: 14,
          borderWidth: 1,
          borderColor: '#2e7d32',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
        }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ade80', marginTop: 5 }} />
          <Text style={{ color: '#e0ffe8', fontSize: 14, lineHeight: 20, flex: 1 }}>{commandResponse}</Text>
        </View>
      )}

      {/* Quick Insight Banner */}
      {(() => {
        const dominantPattern = detectPattern();
        const miss = playerProfile.commonMiss;
        const pd = getPatternDetection();
        const insight = pd?.coaching
          ?? dominantPattern
          ?? (miss === 'right'
            ? 'Today: aim slightly left — you tend to miss right'
            : miss === 'left'
            ? 'Today: aim slightly right — you tend to miss left'
            : 'Play your stock shot — pattern looks balanced');
        return (
          <Text style={styles.insightBanner}>{insight}</Text>
        );
      })()}

      {/* ── IN PLAY Card ──────────────────────────────────────────────────── */}
      <View style={styles.card}>

        {/* ROW 1: Thumbnail · course/hole info · action icons */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Image
            source={HOLE_IMAGES[Math.min(currentHoleData.hole, 9)] ?? HOLE_IMAGES[1]}
            style={{ width: 72, height: 52, borderRadius: 8, marginRight: 12 }}
            resizeMode="cover"
          />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <Text style={[styles.courseName, { flex: 1 }]} numberOfLines={1} adjustsFontSizeToFit>{activeCourse.name} — Hole {currentHoleData.hole}</Text>
              <Pressable
                onPress={() => setShowCourseSelect((v) => !v)}
                style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, backgroundColor: pressed ? '#1b5e20' : '#143d22', borderWidth: 1, borderColor: '#2e7d32', justifyContent: 'center', alignItems: 'center' })}
              >
                <Text style={{ fontSize: 16 }}>⛳</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowQuickCommands((v) => !v)}
                style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, backgroundColor: pressed ? '#1b5e20' : '#143d22', borderWidth: 1, borderColor: showQuickCommands ? '#4caf50' : '#2e7d32', justifyContent: 'center', alignItems: 'center', marginLeft: 4 })}
              >
                <Text style={{ color: '#A7F3D0', fontSize: 14, fontWeight: '800' }}>⚡</Text>
              </Pressable>
              <CaddieMicButton
                size={32}
                showLabel={false}
                style={{ marginLeft: 4 }}
                context={{ hole: currentHoleData.hole, par: currentHoleData.par, distance: currentHoleData.distance }}
              />
            </View>
            <Text style={styles.holeInfo}>Par {currentHoleData.par} · {currentHoleData.distance} yds · Strokes {strokes}</Text>
            {currentHoleData.note ? <Text style={{ color: '#ccc', fontSize: 12, marginTop: 1 }}>{currentHoleData.note}</Text> : null}
            <Text style={{ color: '#aaa', fontSize: 10, marginTop: 2 }}>Rating {courseRating} · Slope {courseSlope} · Course Hcp {Math.round(handicapIndex * (courseSlope / 113))}</Text>
          </View>
        </View>

        {/* Quick Commands panel */}
        {showQuickCommands && (
          <View style={{ marginBottom: 10, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingBottom: 10 }}>
            <Text style={{ color: '#A7F3D0', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>QUICK COMMANDS</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={quickCommand}
                onValueChange={(val) => {
                  if (!val) return;
                  if (val === 'record-swing') { handleVoiceCommand('record swing'); setQuickCommand(''); setShowQuickCommands(false); return; }
                  if (val === 'stop-recording') { handleVoiceCommand('stop recording'); setQuickCommand(''); setShowQuickCommands(false); return; }
                  if (val === 'delete-video') { handleVoiceCommand('delete video'); setQuickCommand(''); setShowQuickCommands(false); return; }
                  if (val === 'dist-hole') { handleVoiceCommand('distance to the hole'); setQuickCommand(''); setShowQuickCommands(false); return; }
                  if (val === 'dist-bunker') { handleVoiceCommand('how far to bunker'); setQuickCommand(''); setShowQuickCommands(false); return; }
                  if (val === 'dist-water') { handleVoiceCommand('how far to water'); setQuickCommand(''); setShowQuickCommands(false); return; }
                  if (val === 'what-club') { handleVoiceCommand('what club'); setQuickCommand(''); setShowQuickCommands(false); return; }
                  const commands: Record<string, { club: string; result: string }> = {
                    'driver-right': { club: 'Driver', result: 'right' },
                    'driver-left': { club: 'Driver', result: 'left' },
                    'driver-straight': { club: 'Driver', result: 'straight' },
                    '7iron-right': { club: '7 Iron', result: 'right' },
                    '7iron-left': { club: '7 Iron', result: 'left' },
                    '7iron-straight': { club: '7 Iron', result: 'straight' },
                  };
                  const cmd = commands[val];
                  if (cmd) { setClub(cmd.club); handleShot(cmd.result); }
                  setQuickCommand('');
                  setShowQuickCommands(false);
                }}
                style={{ height: 50, width: '100%' }}
              >
                <Picker.Item label="Select a command..." value="" style={{ fontSize: 14 }} />
                <Picker.Item label="📍 Distance to Hole" value="dist-hole" style={{ fontSize: 14 }} />
                <Picker.Item label="⛳ Distance to Bunker" value="dist-bunker" style={{ fontSize: 14 }} />
                <Picker.Item label="💧 Distance to Water" value="dist-water" style={{ fontSize: 14 }} />
                <Picker.Item label="🏌️ What Club Should I Hit?" value="what-club" style={{ fontSize: 14 }} />
                <Picker.Item label="🎬 Record Swing" value="record-swing" style={{ fontSize: 14 }} />
                <Picker.Item label="⏹ Stop Recording" value="stop-recording" style={{ fontSize: 14 }} />
                <Picker.Item label="🗑 Delete Video" value="delete-video" style={{ fontSize: 14 }} />
                <Picker.Item label="Driver - Right" value="driver-right" style={{ fontSize: 14 }} />
                <Picker.Item label="Driver - Left" value="driver-left" style={{ fontSize: 14 }} />
                <Picker.Item label="Driver - Straight" value="driver-straight" style={{ fontSize: 14 }} />
                <Picker.Item label="7 Iron - Right" value="7iron-right" style={{ fontSize: 14 }} />
                <Picker.Item label="7 Iron - Left" value="7iron-left" style={{ fontSize: 14 }} />
                <Picker.Item label="7 Iron - Straight" value="7iron-straight" style={{ fontSize: 14 }} />
              </Picker>
            </View>
          </View>
        )}

        {/* Course selector panel */}
        {showCourseSelect && (
          <View style={{ marginBottom: 10, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingBottom: 10 }}>
            <Text style={{ color: '#A7F3D0', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>SELECT COURSE</Text>
            {COURSE_DB.map((course, idx) => (
              <Pressable
                key={idx}
                onPress={() => {
                  const h1 = COURSE_DB[idx].holes[0];
                  setSelectedCourseIdx(idx);
                  setActiveCourse(COURSE_DB[idx].name);
                  setHole(1);
                  setStrokes(h1.par);
                  setPar(h1.par);
                  setDistance(String(h1.distance));
                  setLastShotBadge(null);
                  setShowCourseSelect(false);
                  void voiceSpeak(`${course.name} selected.`, 'calm');
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: idx === selectedCourseIdx ? '#1b5e20' : pressed ? '#222' : '#161616',
                  borderRadius: 10, padding: 10, marginBottom: 4,
                  borderWidth: 1, borderColor: idx === selectedCourseIdx ? '#66bb6a' : 'rgba(255,255,255,0.07)',
                })}
              >
                <Text style={{ fontSize: 14, marginRight: 8 }}>⛳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: idx === selectedCourseIdx ? '#fff' : '#ccc', fontWeight: idx === selectedCourseIdx ? '700' : '400', fontSize: 14 }}>{course.name}</Text>
                  <Text style={{ color: '#aaa', fontSize: 11, marginTop: 1 }}>Rating {course.rating} — Slope {course.slope}</Text>
                </View>
                {idx === selectedCourseIdx && <Text style={{ color: '#66bb6a', fontSize: 12 }}>✓</Text>}
              </Pressable>
            ))}
          </View>
        )}

        {/* DIVIDER */}
        <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', paddingTop: 8, marginBottom: 8 }}>

          {/* ROW 2: Par selector */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {/* Par buttons */}
            <View style={{ flexDirection: 'row', gap: 6, flex: 1 }}>
              {([3, 4, 5] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPar(p)}
                  style={({ pressed }) => ({
                    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                    backgroundColor: par === p ? '#10B981' : pressed ? '#333' : '#1e1e1e',
                    borderWidth: 1, borderColor: par === p ? '#ffffff' : '#444',
                  })}
                >
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Par {p}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* ROW 3: Club dropdown — caddie-suggested default */}
          <View style={{ marginBottom: 10 }}>
            <Text style={{ color: '#aaa', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 }}>CLUB</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {/* Suggested badge */}
              <View style={{ backgroundColor: '#0d2b14', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#2e7d32', minWidth: 90, alignItems: 'center' }}>
                <Text style={{ color: '#aaa', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 2 }}>CADDIE</Text>
                <Text style={{ color: '#6ee7b7', fontSize: 16, fontWeight: '800' }}>{recommendedClub}</Text>
                <Text style={{ color: '#444', fontSize: 10, marginTop: 1 }}>{Object.fromEntries(getClubYardageMap())[recommendedClub] ?? '--'} yds</Text>
              </View>
              {/* Picker to override */}
              <View style={[styles.pickerContainer, { flex: 1, marginTop: 0 }]}>
                <Picker
                  selectedValue={club}
                  onValueChange={(val) => { setClub(val); if (earbudMode) void voiceSpeak(String(val), 'calm'); }}
                  style={{ height: 50, width: '100%' }}
                >
                  {(() => {
                    const yardMap = Object.fromEntries(getClubYardageMap());
                    return ['Driver','3 Wood','5 Wood','3 Iron','4 Iron','5 Iron','6 Iron','7 Iron','8 Iron','9 Iron','PW','GW','SW','LW','Putter'].map((c) => (
                      <Picker.Item key={c} label={`${c}  —  ${yardMap[c] ?? '--'} yds`} value={c} style={{ fontSize: 14 }} />
                    ));
                  })()}
                </Picker>
              </View>
            </View>
          </View>

          {/* ROW 4: Multi-player stroke tracking */}
          <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', paddingTop: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: '#A7F3D0', fontSize: 11, fontWeight: '600', flex: 1 }}>PLAYERS IN ROUND</Text>
              {([1, 2, 3, 4] as const).map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setActivePlayerCount(n)}
                  style={({ pressed }) => ({
                    backgroundColor: activePlayerCount === n ? '#2e7d32' : pressed ? '#333' : '#1e1e1e',
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginLeft: 4,
                    borderWidth: 1, borderColor: activePlayerCount === n ? '#ffffff' : '#444',
                  })}
                >
                  <Text style={{ color: '#fff', fontSize: 12 }}>{n}</Text>
                </Pressable>
              ))}
            </View>
            {Array.from({ length: activePlayerCount }).map((_, i) => {
              const currentScore = (() => {
                const holeEntry = multiRound.find((h) => h.hole === hole);
                return holeEntry ? (holeEntry.scores[i] ?? 0) : 0;
              })();
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ color: '#ccc', flex: 1, fontSize: 13 }}>{players[i]}</Text>
                  <Pressable
                    onPress={() => {
                      setMultiRoundPersisted((prev) => {
                        const idx = prev.findIndex((h) => h.hole === hole);
                        if (idx === -1) {
                          const scores = [0, 0, 0, 0];
                          if (scores[i] > 0) scores[i]--;
                          return [...prev, { hole, par, scores }];
                        }
                        const updated = prev.map((h, hi) => hi === idx ? { ...h, scores: h.scores.map((s, si) => si === i ? Math.max(0, s - 1) : s) } : h);
                        return updated;
                      });
                    }}
                    style={{ backgroundColor: '#333', width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 18, lineHeight: 22 }}>−</Text>
                  </Pressable>
                  <Text style={{ color: '#A7F3D0', fontSize: 18, fontWeight: '700', minWidth: 28, textAlign: 'center' }}>{currentScore}</Text>
                  <Pressable
                    onPress={() => {
                      setMultiRoundPersisted((prev) => {
                        const idx = prev.findIndex((h) => h.hole === hole);
                        if (idx === -1) {
                          const scores = [0, 0, 0, 0];
                          scores[i] = 1;
                          return [...prev, { hole, par, scores }];
                        }
                        const updated = prev.map((h, hi) => hi === idx ? { ...h, scores: h.scores.map((s, si) => si === i ? s + 1 : s) } : h);
                        return updated;
                      });
                    }}
                    style={{ backgroundColor: '#2e7d32', width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 18, lineHeight: 22 }}>+</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          {/* ROW 5: Next Hole / Finish */}
          <Pressable
            onPress={() => {
              const scoreForHole = strokes;
              // Micro-delight: birdie, par, bogey+ feedback
              if (scoreForHole < par) {
                respond("Let's go! Birdie. That's what we're here for.");
              } else if (scoreForHole === par) {
                const parDelights = ['Solid par. Keep that going.', 'Par saved. Take it.', 'Good par. Stay steady.'];
                respond(parDelights[Math.floor(Math.random() * parDelights.length)]);
              } else if (scoreForHole >= par + 2) {
                respond('Shake it off. Next one.');
              }
              setRound((prevRound) => {
                const updated = [...prevRound];
                updated[hole - 1] = scoreForHole;
                return updated;
              });
              setRoundPars((prev) => {
                const updated = [...prev];
                updated[hole - 1] = par;
                return updated;
              });
              // Compute updated multiRound upfront so skins uses the same snapshot (avoids stale closure)
              const nextMultiRound = (() => {
                const exists = multiRound.findIndex((h) => h.hole === hole);
                if (exists === -1) {
                  return [...multiRound, { hole, par, scores: [scoreForHole, 0, 0, 0] }];
                }
                return multiRound.map((h) =>
                  h.hole === hole ? { ...h, scores: h.scores.map((s, i) => i === 0 ? scoreForHole : s) } : h
                );
              })();
              setMultiRoundPersisted(nextMultiRound);
              // Recalculate skins from the same nextMultiRound — no stale closure
              setSkins(() => {
                let carry = 1;
                const results = [0, 0, 0, 0];
                nextMultiRound.forEach((h) => {
                  const scores = h.scores.slice(0, activePlayerCount);
                  if (scores.length === 0) return;
                  const lowest = Math.min(...scores);
                  const winners = scores.map((s, i) => s === lowest ? i : -1).filter((i) => i !== -1);
                  if (winners.length === 1) { results[winners[0]] += carry; carry = 1; }
                  else { carry++; }
                });
                return results;
              });
              updateScore(par, strokes);
              // Capture hole stats before advancing
              setHoleStatsLog((prev) => [...prev, { hole, strokes: scoreForHole, putts: puttsThisHole, fairwayHit: par === 3 ? null : firThisHole, gir: girThisHole }]);
              // Reset per-hole stats for next hole
              setPuttsThisHole(0);
              setFirThisHole(null);
              setGirThisHole(null);
              if (hole < 18) {
                const nextHole = hole + 1;
                setHole(nextHole);
                proactiveCoach(nextHole);
                const nextData = activeCourse.holes[Math.min(nextHole - 1, activeCourse.holes.length - 1)];
                setPar(nextData.par);
                setDistance(String(nextData.distance));
                setStrokes(nextData.par);  // default to par so +/- is relative from the start
                setLastShotBadge(null);
              } else {
                // Round complete — auto-save to cloud
                saveRound();
              }
            }}
            style={({ pressed }) => ({
              backgroundColor: hole < 18 ? (pressed ? '#0d4a1a' : '#1b5e20') : '#374151',
              paddingVertical: 14, borderRadius: 12, alignItems: 'center',
              marginTop: 12, borderWidth: 1,
              borderColor: hole < 18 ? '#4caf50' : '#555',
            })}
          >
            <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 15, letterSpacing: 0.3 }}>
              {hole < 18 ? `Next Hole → ${hole + 1}` : 'Round Complete'}
            </Text>
          </Pressable>

        </View>{/* end divider section */}
      </View>{/* end combined card */}

      {/* ── STRATEGY Card ── */}
      <View style={styles.card}>
        {/* ── STRATEGY collapse header ── */}
        <Pressable onPress={() => setStrategyCollapsed(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, marginBottom: strategyCollapsed ? 0 : 10 }}>
          <Text style={{ color: '#A7F3D0', fontWeight: '800', fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase' }}>STRATEGY</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {strategyCollapsed && (
              <Text style={{ color: '#aaa', fontSize: 12 }}>{PLAYER_MODE_CONFIG[goalMode].label} · {strategyMode === 'attack' ? '🔥 ATK' : strategyMode === 'safe' ? '🛡 SAFE' : '⚖️ NEU'}</Text>
            )}
            <Text style={{ color: '#4ade80', fontSize: 22, fontWeight: '700' }}>{strategyCollapsed ? '▸' : '▾'}</Text>
          </View>
        </Pressable>
        {!strategyCollapsed && (<>

        {/* HEADER: Goal + Safe/Aggressive row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['beginner', 'break90', 'break80'] as const).map((g) => (
              <Pressable
                key={g}
                onPress={() => setGoalMode(g)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                  backgroundColor: goalMode === g ? '#1a2a1a' : '#1a1a1a',
                  borderWidth: 1, borderColor: goalMode === g ? PLAYER_MODE_CONFIG[g].color : '#333',
                }}
              >
                <Text style={{ color: goalMode === g ? PLAYER_MODE_CONFIG[g].color : '#888', fontSize: 12, fontWeight: '700' }}>
                  {PLAYER_MODE_CONFIG[g].emoji} {PLAYER_MODE_CONFIG[g].label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['safe', 'neutral', 'attack'] as const).map((mode) => (
              <Pressable
                key={mode}
                onPress={() => setStrategyMode(mode)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                  backgroundColor: strategyMode === mode ? (mode === 'attack' ? '#7f1d1d' : mode === 'safe' ? '#1b5e20' : '#1a2a3a') : '#1a1a1a',
                  borderWidth: 1, borderColor: strategyMode === mode ? (mode === 'attack' ? '#f87171' : mode === 'safe' ? '#4caf50' : '#6b7280') : '#333',
                }}
              >
                <Text style={{ color: strategyMode === mode ? (mode === 'attack' ? '#f87171' : mode === 'safe' ? '#A7F3D0' : '#d1d5db') : '#888', fontSize: 12, fontWeight: '700' }}>
                  {mode === 'safe' ? '🛡 SAFE' : mode === 'attack' ? '🔥 ATK' : '⚖️ NEU'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Distance: tap for rangefinder */}

        <Pressable
          onPress={() => {
            const y = getYardages();
            const yardage = targetDistance ?? y.middle ?? currentHoleData.distance;
            router.push({ pathname: '/rangefinder', params: {
              yardage: String(yardage), hole: String(hole),
              // Prefer calibrated green coords so the rangefinder satellite zoom
              // opens over the actual green, not the placeholder COURSE_DB location.
              frontLat:  String(calibratedGreens[`${selectedCourseIdx}_${hole}`]?.lat ?? currentHoleData.front.lat),
              frontLng:  String(calibratedGreens[`${selectedCourseIdx}_${hole}`]?.lng ?? currentHoleData.front.lng),
              middleLat: String(calibratedGreens[`${selectedCourseIdx}_${hole}`]?.lat ?? currentHoleData.middle.lat),
              middleLng: String(calibratedGreens[`${selectedCourseIdx}_${hole}`]?.lng ?? currentHoleData.middle.lng),
              backLat:   String(calibratedGreens[`${selectedCourseIdx}_${hole}`]?.lat ?? currentHoleData.back.lat),
              backLng:   String(calibratedGreens[`${selectedCourseIdx}_${hole}`]?.lng ?? currentHoleData.back.lng),
            } });
          }}
          style={{ paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)', marginBottom: 8 }}
        >
          <Text style={{ color: '#A7F3D0', fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginBottom: 6 }}>DISTANCE</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {/* Big yardage number + ±10 nudge buttons */}
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={{ color: '#fff', fontSize: 52, fontWeight: '800', lineHeight: 56 }}>
                {gpsYards?.middle ?? targetDistance ?? currentHoleData?.distance ?? '--'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={() => {
                    const cur = parseInt(distance, 10) || (targetDistance ?? currentHoleData?.distance ?? 150);
                    const next = Math.max(10, cur - 10);
                    setDistance(String(next));
                    setTargetDistance(next);
                  }}
                  style={{ backgroundColor: '#1f2937', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: '#374151' }}>
                  <Text style={{ color: '#A7F3D0', fontSize: 14, fontWeight: '700' }}>−10</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const cur = parseInt(distance, 10) || (targetDistance ?? currentHoleData?.distance ?? 150);
                    const next = Math.min(700, cur + 10);
                    setDistance(String(next));
                    setTargetDistance(next);
                  }}
                  style={{ backgroundColor: '#1f2937', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: '#374151' }}>
                  <Text style={{ color: '#A7F3D0', fontSize: 14, fontWeight: '700' }}>+10</Text>
                </Pressable>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              {gpsYards ? (
                // GPS data available (live or last-known) — show Front/Mid/Back trio.
                // gpsWeak controls whether values are shown in green (live) or amber (stale).
                <>
                  <View style={{
                    flexDirection: 'row', justifyContent: 'space-between',
                    backgroundColor: gpsWeak ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.04)',
                    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 5,
                    borderWidth: gpsWeak ? 1 : 0, borderColor: gpsWeak ? 'rgba(245,158,11,0.3)' : 'transparent',
                  }}>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: '#ccc', fontSize: 12, fontWeight: '700' }}>{gpsYards.front ?? '--'}</Text>
                      <Text style={{ color: '#777', fontSize: 9, fontWeight: '700', marginTop: 1 }}>FRNT</Text>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: gpsWeak ? '#fcd34d' : '#A7F3D0', fontSize: 14, fontWeight: '800' }}>{gpsYards.middle ?? '--'}</Text>
                      <Text style={{ color: gpsWeak ? '#f59e0b' : '#4ade80', fontSize: 9, fontWeight: '700', marginTop: 1 }}>MID</Text>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: '#ccc', fontSize: 12, fontWeight: '700' }}>{gpsYards.back ?? '--'}</Text>
                      <Text style={{ color: '#777', fontSize: 9, fontWeight: '700', marginTop: 1 }}>BACK</Text>
                    </View>
                  </View>
                  {gpsWeak ? (
                    <Text style={{ color: '#f59e0b', fontSize: 9, textAlign: 'center' }}>⚠️ GPS WEAK · last known</Text>
                  ) : calibratedGreens[`${selectedCourseIdx}_${hole}`] ? (
                    <Text style={{ color: '#4caf50', fontSize: 9, textAlign: 'center' }}>🎯 Calibrated</Text>
                  ) : (
                    <Pressable onPress={saveGreenLocation} style={{ alignItems: 'center' }}>
                      <Text style={{ color: '#f59e0b', fontSize: 9, fontWeight: '700' }}>📍 Tap to set green</Text>
                    </Pressable>
                  )}
                </>
              ) : (
                <Pressable onPress={startGpsWatch} style={{ alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8, paddingVertical: 10 }}>
                  <Text style={{ color: '#4caf50', fontSize: 13, fontWeight: '700' }}>📍 Start GPS</Text>
                  <Text style={{ color: '#777', fontSize: 10, marginTop: 2 }}>F / M / B</Text>
                </Pressable>
              )}
            </View>
            {/* ── Mini Shot Map ─────────────────────────────────── */}
            {(() => {
              const MAPW = 143, MAPH = 90;
              const lastResult = shots.length > 0 ? shots[shots.length - 1]?.result : null;
              const aimToX: Record<string, number> = {
                'left edge': 18, 'left center': 39, 'center': 72, 'right center': 104, 'right edge': 125,
              };
              const resultToX: Record<string, number> = { left: 23, straight: 72, right: 120 };
              const sx = 72, sy = MAPH - 10, ey = 14;
              const aimEndX = aimToX[aim] ?? 72;
              const lastEndX = lastResult ? (resultToX[lastResult] ?? 72) : null;
              const renderLine = (x1: number, y1: number, x2: number, y2: number, color: string) => {
                const dx = x2 - x1, dy = y2 - y1;
                const len = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                return (
                  <View style={{
                    position: 'absolute',
                    left: (x1 + x2) / 2 - len / 2,
                    top: (y1 + y2) / 2 - 1.5,
                    width: len, height: 3,
                    backgroundColor: color, borderRadius: 1.5,
                    transform: [{ rotate: `${angle}deg` }],
                  }} />
                );
              };
              return (
                <View style={{ width: MAPW, height: MAPH, backgroundColor: '#0a2218', borderRadius: 8, borderWidth: 1, borderColor: '#2e7d32', overflow: 'hidden', marginLeft: 6 }}>
                  {/* Fairway strip */}
                  <View style={{ position: 'absolute', left: 39, right: 39, top: 10, bottom: 14, backgroundColor: '#0f3d1e', borderRadius: 4 }} />
                  {/* Pin */}
                  <View style={{ position: 'absolute', top: 12, left: 66, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFE600', opacity: 0.9 }} />
                  {/* Last shot trace — blue */}
                  {lastEndX !== null && renderLine(sx, sy, lastEndX, ey, '#60a5fa')}
                  {/* Desired aim line — green */}
                  {renderLine(sx, sy, aimEndX, ey, '#4ade80')}
                  {/* Ball position */}
                  <View style={{ position: 'absolute', left: sx - 4, top: sy - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', opacity: 0.85 }} />
                  {/* Legend */}
                  <View style={{ position: 'absolute', bottom: 1, left: 3, right: 3, flexDirection: 'row', justifyContent: 'space-between' }}>
                    {lastEndX !== null && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                        <View style={{ width: 6, height: 2, backgroundColor: '#60a5fa', borderRadius: 1 }} />
                        <Text style={{ color: '#60a5fa', fontSize: 7, fontFamily: 'Outfit_700Bold' }}>LAST</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                      <View style={{ width: 6, height: 2, backgroundColor: '#4ade80', borderRadius: 1 }} />
                      <Text style={{ color: '#4ade80', fontSize: 7, fontFamily: 'Outfit_700Bold' }}>AIM</Text>
                    </View>
                  </View>
                  {/* Yardage */}
                  <Text style={{ position: 'absolute', top: 2, right: 4, color: '#A7F3D0', fontSize: 8, fontFamily: 'Outfit_700Bold' }}>
                    {(targetDistance ?? getYardages().middle ?? currentHoleData?.distance ?? '--') + 'y'}
                  </Text>
                </View>
              );
            })()}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Image source={ICON_RANGEFINDER} style={{ width: 13, height: 13, tintColor: '#FFE600' }} resizeMode="contain" />
            <Text style={{ color: '#ccc', fontSize: 11 }}>yds  —  tap for rangefinder</Text>
          </View>
          {/* Hazard chips — shown when hole note contains bunker / water data */}
          {(() => {
            const haz = getHazardDistances();
            if (!haz.bunker && !haz.water) return null;
            return (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {haz.water !== null && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0c2a4a', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: '#1e4d7b' }}>
                    <Text style={{ fontSize: 13 }}>💧</Text>
                    <Text style={{ color: '#90caf9', fontSize: 12, fontWeight: '700' }}>Water ~{haz.water} yd</Text>
                  </View>
                )}
                {haz.bunker !== null && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#2a2010', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: '#6b5a30' }}>
                    <Text style={{ fontSize: 13 }}>⛳</Text>
                    <Text style={{ color: '#fde68a', fontSize: 12, fontWeight: '700' }}>Bunker ~{haz.bunker} yd</Text>
                  </View>
                )}
              </View>
            );
          })()}
          {/* Yardage left after this club */}
          {(() => {
            const left = getYardageLeft();
            if (left === null) return null;
            const nextClub = recommendClubForDistance(left);
            const yardMap = Object.fromEntries(getClubYardageMap());
            const clubCarry = yardMap[club];
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' }}>
                <View>
                  <Text style={{ color: '#aaa', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 }}>AFTER THIS SHOT</Text>
                  <Text style={{ color: '#f59e0b', fontSize: 26, fontWeight: '800', lineHeight: 28 }}>
                    {left} <Text style={{ color: '#aaa', fontSize: 11, fontWeight: '400' }}>yds left</Text>
                  </Text>
                  {clubCarry != null && (
                    <Text style={{ color: '#aaa', fontSize: 10, marginTop: 1 }}>{club} carries ~{clubCarry} yds</Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: '#aaa', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 }}>NEXT CLUB</Text>
                  <Text style={{ color: '#A7F3D0', fontSize: 18, fontWeight: '800' }}>{nextClub}</Text>
                  <Text style={{ color: '#aaa', fontSize: 10, marginTop: 1 }}>{Object.fromEntries(getClubYardageMap())[nextClub] ?? '--'} yds</Text>
                </View>
              </View>
            );
          })()}
        </Pressable>

        {/* ── CADDIE STRATEGY: 4 tiles in one row ── */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
          {/* CLUB tile */}
          <View style={{ flex: 1, backgroundColor: '#0d2b14', borderRadius: 10, borderWidth: 1, borderColor: aiClubHint && aiClubHint !== club ? '#f59e0b' : '#2e7d32', paddingVertical: 8, alignItems: 'center' }}>
            <Text style={{ color: aiClubHint && aiClubHint !== club ? '#fbbf24' : '#4ade80', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginBottom: 2 }}>CLUB</Text>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit>{club.replace(' Wood','W').replace(' Iron','i')}</Text>
            {aiClubHint
              ? <Text style={{ color: aiClubHint !== club ? '#fbbf24' : '#6ee7b7', fontSize: 9, marginTop: 1 }} numberOfLines={1} adjustsFontSizeToFit>
                  {aiClubHint !== club ? `AI: ${aiClubHint.replace(' Wood','W').replace(' Iron','i')}` : '✓ match'}
                </Text>
              : (() => { const y = Object.fromEntries(getClubYardageMap())[club]; return y ? <Text style={{ color: '#6ee7b7', fontSize: 9, marginTop: 1 }}>{y}y</Text> : null; })()}
          </View>

          {/* AIM tile */}
          <View style={{ flex: 1, backgroundColor: '#0d2b14', borderRadius: 10, borderWidth: 1, borderColor: '#2e7d32', paddingVertical: 8, alignItems: 'center' }}>
            <Text style={{ color: '#4ade80', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginBottom: 2 }}>AIM</Text>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
              {aim === 'left center' ? '← L CTR' : aim === 'right center' ? 'R CTR →' : aim === 'left edge' ? '← L EDG' : aim === 'right edge' ? 'R EDG →' : '↑ CTR'}
            </Text>
          </View>

          {/* MODE tile */}
          <Pressable
            onPress={() => setStrategyMode((s) => s === 'safe' ? 'neutral' : s === 'neutral' ? 'attack' : 'safe')}
            style={{ flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 8, alignItems: 'center',
              backgroundColor: strategyMode === 'attack' ? '#3d0000' : strategyMode === 'safe' ? '#0d2b14' : '#1a1a2a',
              borderColor: strategyMode === 'attack' ? '#f87171' : strategyMode === 'safe' ? '#2e7d32' : '#6b7280' }}>
            <Text style={{ fontSize: 8, fontWeight: '800', letterSpacing: 1, marginBottom: 2, color: strategyMode === 'attack' ? '#f87171' : strategyMode === 'safe' ? '#4ade80' : '#d1d5db' }}>MODE</Text>
            <Text style={{ fontSize: 11, fontWeight: '800', color: strategyMode === 'attack' ? '#fca5a5' : '#fff' }}>
              {strategyMode === 'attack' ? '🔥 ATK' : strategyMode === 'safe' ? '🛡 SAFE' : '⚖️ NEU'}
            </Text>
          </Pressable>

          {/* LEFT yds tile — shows yardage remaining after this club, or FEEL state */}
          <View style={{ flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 8, alignItems: 'center',
            backgroundColor: '#0d2b14', borderColor: getYardageLeft() !== null ? '#f59e0b' : '#2e7d32' }}>
            <Text style={{ color: getYardageLeft() !== null ? '#fbbf24' : '#4ade80', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginBottom: 2 }}>
              {getYardageLeft() !== null ? 'LEFT' : 'FEEL'}
            </Text>
            <Text style={{ color: getYardageLeft() !== null ? '#fde68a' : '#A7F3D0', fontSize: 11, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit>
              {getYardageLeft() !== null ? `${getYardageLeft()}y` : (mentalState || 'neutral')}
            </Text>
          </View>
        </View>

        {/* Recommendation note — shown when caddie has a specific insight */}
        {getTargetRecommendation() !== '' && (
          <Text style={{ color: '#66bb6a', fontSize: 12, marginBottom: 4, fontStyle: 'italic' }}>🎯 {getTargetRecommendation()}</Text>
        )}
        {/* Bias strategy — updates as soon as 5 shots logged or bias shifts */}
        {(() => { const bs = getBiasStrategy(); return (
          <Text style={{ color: bs.color, fontSize: 12, marginBottom: 4, fontWeight: '700' }}>⚡ {bs.label}</Text>
        ); })()}
        {/* Aim offset pill */}
        {(() => { const ao = getAimOffset(); return ao ? (
          <View style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <View style={{ backgroundColor: '#1a1a2a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: ao.color }}>
                <Text style={{ color: ao.color, fontSize: 12, fontWeight: '700' }}>🎯 {ao.target === 'center' ? 'Center line' : ao.target === 'left center' ? 'Aim Left' : 'Aim Right'} · {ao.label}</Text>
              </View>
            </View>
            <Text style={{ color: ao.color, fontSize: 11, fontWeight: '600', fontStyle: 'italic', opacity: 0.85 }}>{ao.miss}</Text>
          </View>
        ) : null; })()}
        {/* Caddie Tip — practice memory */}
        {(() => {
          if (cmMissBias === 'neutral' || cmConfidence < 30 || cmUpdated === 0) return null;
          if (getMissBias() !== null) return null;
          const color   = cmMissBias === 'right' ? '#93c5fd' : '#fcd34d';
          const aimText = cmMissBias === 'right' ? 'Aim slightly left' : 'Aim slightly right';
          const noteText = cmMissBias === 'right'
            ? 'You tend to miss right — adjust aim'
            : 'You tend to miss left — adjust aim';
          return (
            <View style={{ marginBottom: 10, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, borderWidth: 1, borderColor: color, paddingHorizontal: 14, paddingVertical: 8, gap: 2 }}>
              <Text style={{ color, fontSize: 13, fontWeight: '800' }}>🧠 {aimText}</Text>
              <Text style={{ color: '#9ca3af', fontSize: 11, fontStyle: 'italic' }}>{noteText} ({cmConfidence}% confidence)</Text>
            </View>
          );
        })()}

        {/* FEEL — mental state buttons, influence caddie data and AI recommendations */}
        <View style={{ marginTop: 4, marginBottom: 8 }}>
          <Text style={{ color: '#aaa', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 5 }}>FEEL</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['confident', 'nervous', 'aggressive'] as const).map((val) => (
              <Pressable
                key={val}
                onPress={() => setMentalState(val)}
                style={[styles.option, mentalState === val && styles.selected, { flex: 1, padding: 7, marginRight: 0 }]}
              >
                <Text style={[styles.optionText, { textAlign: 'center' }]} numberOfLines={1} adjustsFontSizeToFit>
                  {val.charAt(0).toUpperCase() + val.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Scorecard strip: inline when scores exist */}
        {round.length > 0 && (
          <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', paddingTop: 10, marginTop: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ color: '#ccc', fontSize: 10, fontWeight: '700', letterSpacing: 1.2 }}>SCORECARD</Text>
              <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '800' }}>
                {round.reduce((s, v) => s + (v || 0), 0)} strokes
                {roundPars.length > 0 && (() => {
                  const diff = round.reduce((s, v) => s + (v||0), 0) - roundPars.reduce((s, v) => s + (v||0), 0);
                  const col = diff < 0 ? '#4ade80' : diff === 0 ? '#A7F3D0' : '#f87171';
                  return <Text style={{ color: col, fontWeight: '700' }}>{' (' + (diff > 0 ? '+' : '') + diff + ')'}</Text>;
                })()}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {round.map((score, index) => {
                  const hPar = roundPars[index] ?? 4;
                  const diff = score - hPar;
                  const bg = diff < 0 ? '#1b5e20' : diff === 0 ? '#1a2e1a' : diff === 1 ? '#2d1a00' : '#3d0a00';
                  const col = diff < 0 ? '#4ade80' : diff === 0 ? '#A7F3D0' : diff === 1 ? '#f59e0b' : '#f87171';
                  return (
                    <View key={index} style={{ alignItems: 'center', backgroundColor: bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 36 }}>
                      <Text style={{ color: '#ccc', fontSize: 9, fontWeight: '700' }}>H{index + 1}</Text>
                      <Text style={{ color: col, fontSize: 15, fontWeight: '800' }}>{score || '-'}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}

        </>)}
      </View>

      {/* Insight */}
      <View style={styles.card}>
        {/* ── Caddie collapse header ── */}
        <Pressable onPress={() => setCaddieCollapsed(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, marginBottom: caddieCollapsed ? 0 : 10 }}>
          <Text style={styles.sectionTitle}>Caddie</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {caddieCollapsed && (
              <Text style={{ color: '#aaa', fontSize: 12 }} numberOfLines={1}>{caddieAdvice.split(' ').slice(0, 6).join(' ')}…</Text>
            )}
            {/* Camera quick-access icon */}
            <Pressable onPress={(e) => { e.stopPropagation(); setCameraCollapsed(false); }}
              style={{ backgroundColor: '#132b13', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#2e7d32' }}>
              <Text style={{ fontSize: 14 }}>🎥</Text>
            </Pressable>
            <Text style={{ color: '#4ade80', fontSize: 22, fontWeight: '700' }}>{caddieCollapsed ? '▸' : '▾'}</Text>
          </View>
        </Pressable>
        {!caddieCollapsed && (<>
        {shots.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 10 }}>
            <Text style={{ color: '#9CA3AF', fontSize: 12 }}>Shots: <Text style={{ color: '#fff', fontWeight: '700' }}>{shots.length}</Text></Text>
            <Text style={{ color: '#9CA3AF', fontSize: 12 }}>Last: <Text style={{ color: '#A7F3D0', fontWeight: '700' }}>{shots[shots.length - 1]?.result ?? '—'}</Text></Text>
          </View>
        )}

        {/* ── Shot pattern bar — always visible once shots are logged ── */}
        {shots.length >= 1 && (() => {
          const pattern = getSwingPattern();
          if (!pattern) return null;
          return (
            <View style={{ marginBottom: 14 }}>
              {/* Colored distribution bar */}
              <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
                <View style={{ flex: Math.max(pattern.left, 0.5), backgroundColor: '#60a5fa' }} />
                <View style={{ flex: Math.max(pattern.straight, 0.5), backgroundColor: '#A7F3D0' }} />
                <View style={{ flex: Math.max(pattern.right, 0.5), backgroundColor: '#f87171' }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: '#60a5fa', fontSize: 11, fontWeight: '600' }}>← {pattern.left}%</Text>
                <Text style={{ color: '#A7F3D0', fontSize: 11, fontWeight: '600' }}>↑ {pattern.straight}%</Text>
                <Text style={{ color: '#f87171', fontSize: 11, fontWeight: '600' }}>{pattern.right}% →</Text>
              </View>
              {/* Caddie pattern insight — replaces the old Swing Analysis card message */}
              {shots.length >= 3 && (
                <Text style={{ color: '#ddd', fontSize: 12, lineHeight: 18, marginTop: 6, fontStyle: 'italic' }}>
                  {getSwingInsight()}
                </Text>
              )}
            </View>
          );
        })()}

        {/* Context state pills — caddie perspective on current mode/feel */}
        {(strategyMode === 'attack' || mentalState === 'nervous' || mentalState === 'confident') && (
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {strategyMode === 'attack' && (
              <View style={{ backgroundColor: '#7f1d1d', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '600' }}>ATTACK</Text>
              </View>
            )}
            {strategyMode === 'safe' && (
              <View style={{ backgroundColor: '#14532d', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                <Text style={{ color: '#86efac', fontSize: 11, fontWeight: '600' }}>SAFE</Text>
              </View>
            )}
            {mentalState === 'nervous' && (
              <View style={{ backgroundColor: '#1e3a5f', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                <Text style={{ color: '#93c5fd', fontSize: 11, fontWeight: '600' }}>NERVOUS</Text>
              </View>
            )}
            {mentalState === 'confident' && (
              <View style={{ backgroundColor: '#14532d', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                <Text style={{ color: '#86efac', fontSize: 11, fontWeight: '600' }}>CONFIDENT</Text>
              </View>
            )}
          </View>
        )}
        <Text style={styles.caddie}>{caddieAdvice}</Text>
        {aiThinking && (
          <Text style={{ marginTop: 12, fontSize: 13, color: '#6ee7b7', fontStyle: 'italic' }}>Thinking...</Text>
        )}
        {caddieMessage !== '' && (
          <Text style={{ marginTop: 20, fontSize: 16, color: '#A7F3D0' }}>{caddieMessage}</Text>
        )}
        {shots.length >= 3 && (
          <Text style={{ marginTop: 10, fontSize: 14, color: '#6ee7b7' }}>Confidence: {confidence}%</Text>
        )}
        <Text style={{ marginTop: 10, fontSize: 13, color: '#9CA3AF' }}>Style: {ppCoachingStyle}</Text>
        {shots.length >= (roundLength === 9 ? 3 : 6) && (() => {
          const pp = getPressurePattern(shots);
          if (pp === 'neutral') return null;
          return (
            <Text style={{ marginTop: 5, fontSize: 11, color: '#6b7280' }}>
              {pp === 'right' ? '⚠️ Tends right under pressure' : '⚠️ Tends left under pressure'}
            </Text>
          );
        })()}
        {shots.length >= (roundLength === 9 ? 3 : 6) && (() => {
          const trend = getTrend(shots);
          const mentalMap = getMentalPatterns(shots);
          const lines: string[] = [];
          if (trend === 'improving') lines.push('📈 Trending better');
          else if (trend === 'struggling') lines.push('📉 Last 3 off target');
          if (mentalMap['rushed'] && mentalMap['rushed'] !== 'straight') {
            lines.push(`When rushed: miss ${mentalMap['rushed']}`);
          }
          if (mentalMap['smooth'] === 'straight') lines.push('When smooth: consistent');
          if (lines.length === 0) return null;
          return (
            <Text style={{ marginTop: 5, fontSize: 11, color: '#6b7280', lineHeight: 17 }}>
              {lines.join('  —  ')}
            </Text>
          );
        })()}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Pressable
            onPress={() => setQuietMode((q) => !q)}
            style={{ flex: 1, backgroundColor: quietMode ? '#374151' : '#1f2937', borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: quietMode ? '#6ee7b7' : '#374151' }}
          >
            <Text style={{ color: quietMode ? '#6ee7b7' : '#9CA3AF', fontSize: 13 }}>{quietMode ? '🔕 Quiet' : '🔊 Sound'}</Text>
          </Pressable>
          <Pressable
            onPress={speakPreShot}
            style={{ flex: 1, backgroundColor: '#1f2937', borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: '#374151' }}
          >
            <Text style={{ color: '#A7F3D0', fontSize: 13 }}>🎙 Pre-Shot</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setCameraMinimized(false);
              if (!recording) {
                startRecording();
              } else {
                stopRecording();
              }
            }}
            style={{ flex: 1, backgroundColor: recording ? '#3d1a00' : '#1f2937', borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: recording ? '#f97316' : '#374151' }}
          >
            <Text style={{ color: recording ? '#f97316' : '#A7F3D0', fontSize: 13 }}>{recording ? '⏹ Stop' : '🎥 Swing'}</Text>
          </Pressable>
        </View>
        {holeStrategy !== '' && (
          <Text style={{ color: '#ccc', fontSize: 13, marginTop: 8 }}>Strategy: {holeStrategy}</Text>
        )}
        {/* Ask Caddie — AI Brain with voice */}
        <Pressable
          onPress={() => void handleCaddie()}
          disabled={aiThinking}
          style={{
            marginTop: 12,
            backgroundColor: aiThinking ? '#1a2e1a' : '#14532d',
            borderRadius: 10,
            paddingVertical: 12,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: aiThinking ? '#2e7d32' : '#4caf50',
            opacity: aiThinking ? 0.7 : 1,
          }}
        >
          <Text style={{ color: '#A7F3D0', fontSize: 15, fontWeight: '700' }}>
            {aiThinking ? '🤔 Thinking...' : '🎙 Ask Caddie'}
          </Text>
        </Pressable>
        {/* Edit Profile */}
        {!ppComplete && (
          <Pressable onPress={() => router.push('/profile-setup')}
            style={{ marginTop: 10, backgroundColor: '#1a2e1a', borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: '#2e7d32' }}>
            <Text style={{ color: '#A7F3D0', fontSize: 12 }}>⚡ Set Up Player Profile — improve AI accuracy</Text>
          </Pressable>
        )}
        {ppComplete && (
          <Pressable onPress={() => router.push('/profile-setup')}
            style={{ marginTop: 10, alignSelf: 'flex-end' }}>
            <Text style={{ color: '#374151', fontSize: 11 }}>Edit Profile</Text>
          </Pressable>
        )}
        {/* Sim My Game */}
        {/* Round length + course selector */}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
          {([9, 18] as const).map((n) => (
            <Pressable key={n} onPress={() => setRoundLength(n)}
              style={{ flex: 1, paddingVertical: 6, borderRadius: 7, alignItems: 'center',
                backgroundColor: roundLength === n ? '#1a3a2a' : '#111',
                borderWidth: 1, borderColor: roundLength === n ? '#2e7d32' : '#333' }}>
              <Text style={{ color: roundLength === n ? '#A7F3D0' : '#888', fontSize: 11, fontWeight: '600' }}>{n} Holes</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
          {(Object.keys(SIM_COURSES) as Array<keyof typeof SIM_COURSES>).map((key) => (
            <Pressable
              key={key}
              onPress={() => setSimCourse(key)}
              style={{ flex: 1, paddingVertical: 6, borderRadius: 7, alignItems: 'center',
                backgroundColor: simCourse === key ? '#1a3a2a' : '#111',
                borderWidth: 1, borderColor: simCourse === key ? '#2e7d32' : '#333' }}
            >
              <Text style={{ color: simCourse === key ? '#A7F3D0' : '#888', fontSize: 11, fontWeight: '600' }}>
                {key === 'easy' ? 'Easy' : key === 'standard' ? 'Standard' : 'Hard'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => {
            const profile = buildSimProfile(shots);
            const course = SIM_COURSES[simCourse];
            const result = runSimRounds(profile, shots.length < 5 ? 10 : 20, course, roundLength);
            setSimResult(result);
            const plan = generateGamePlan(profile, result);
            setGamePlan(plan);
            if (voiceEnabled) speakAICaddie(`Play smart today. ${plan.warning}.`);
          }}
          style={{ marginTop: 8, backgroundColor: '#1a3a2a', borderRadius: 8, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: '#2e7d32' }}
        >
          <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '700' }}>🎮 Sim My Game</Text>
        </Pressable>
        {simResult && (
          <View style={{ marginTop: 8, gap: 2 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
              Expected Score ({simResult.holeCount}): {simResult.averageScore} ({simResult.toPar >= 0 ? '+' : ''}{simResult.toPar})
            </Text>
            {simResult.holeCount === 9 && (
              <Text style={{ color: '#9CA3AF', fontSize: 12 }}>Projected 18: {simResult.averageScore * 2}</Text>
            )}
            <Text style={{ color: '#9CA3AF', fontSize: 12 }}>Best: {simResult.bestScore}  |  Worst: {simResult.worstScore}</Text>
            <Text style={{ color: '#9CA3AF', fontSize: 12 }}>Course: {simResult.courseName}</Text>
            <Text style={{ color: '#9CA3AF', fontSize: 12 }}>Miss: {simResult.missLabel}</Text>
            {simResult.sampleHoles.length > 0 && (
              <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 3 }}>
                {simResult.sampleHoles.map((h) => {
                  const rel = h.score - h.par;
                  const label = rel === 0 ? 'Par' : rel === 1 ? 'Bogey' : rel === -1 ? 'Birdie' : rel >= 2 ? `+${rel}` : `${rel}`;
                  return `Par ${h.par} (${h.difficulty}) ? ${label}`;
                }).join('  —  ')}
              </Text>
            )}
          </View>
        )}
        {/* Today's Game Plan */}
        {gamePlan && (
          <View style={{ marginTop: 12, backgroundColor: 'rgba(16,185,129,0.07)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(167,243,208,0.15)' }}>
            <Text style={{ color: '#A7F3D0', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>TODAY’S PLAN</Text>
            <Text style={{ color: '#fff', fontSize: 13, marginBottom: 3 }}>📋 {gamePlan.strategy}</Text>
            <Text style={{ color: '#d1fae5', fontSize: 12, marginBottom: 3 }}>🎯 {gamePlan.focus}</Text>
            <Text style={{ color: '#fca5a5', fontSize: 12 }}>⚠️ {gamePlan.warning}</Text>
          </View>
        )}
        {/* Live Round Intelligence */}
        {shots.length >= (roundLength === 9 ? 2 : 3) && (() => {
          const li = getLiveInsights(shots, roundLength);
          const lines: string[] = [];
          if (li.trend === 'improving') lines.push('📈 Trending better');
          else if (li.trend === 'struggling') lines.push('📉 Last few off target');
          if (li.streak === 'right') lines.push('Two right in a row');
          else if (li.streak === 'left') lines.push('Two left in a row');
          if (li.pressure) lines.push('Pressure zone');
          if (lines.length === 0) return null;
          return (
            <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 6 }}>{lines.join('  —  ')}</Text>
          );
        })()}
        </>)}
      </View>

      {/* Coaching Swing Video */}
      {showCoachingVideo && coachingSwing && (
        <View style={{ backgroundColor: '#1e1e1e', padding: 16, borderRadius: 14, marginTop: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: '#A7F3D0', fontWeight: '600', fontSize: 14 }}>Coaching Swing</Text>
            <Pressable onPress={() => setShowCoachingVideo(false)}>
              <Text style={{ color: '#aaa', fontSize: 13 }}>✕ Dismiss</Text>
            </Pressable>
          </View>
          <View style={{ position: 'relative' }}>
            <Video
              source={{ uri: coachingSwing.uri }}
              style={{ height: 200, borderRadius: 10 }}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
            />
            {/* Insight overlay on video */}
            <View style={{
              position: 'absolute', bottom: 8, left: 8, right: 8,
              backgroundColor: 'rgba(0,0,0,0.72)', padding: 10, borderRadius: 10,
            }}>
              <Text style={{ color: '#A7F3D0', fontSize: 12, fontWeight: '700', marginBottom: 3 }}>Caddie Insight</Text>
              <Text style={{ color: '#fff', fontSize: 13, lineHeight: 18 }}>{getSwingInsight()}</Text>
            </View>
            {/* Logo watermark */}
            <View pointerEvents="none" style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
              <Image source={LOGO} style={{ width: 48, height: 18 }} resizeMode="contain" />
            </View>
          </View>
          <Text style={{ color: '#ccc', fontSize: 12, marginTop: 6 }}>
            {coachingSwing.result === 'right' ? 'Right miss swing' : coachingSwing.result === 'left' ? 'Left miss swing' : 'Reference swing'} — {coachingSwing.time}
          </Text>
        </View>
      )}

      {/* Swing Camera — inline panel, collapsible */}
      <View style={[styles.card, { paddingTop: 10 }]}>
        {/* ── Swing Camera collapse header ── */}
        <Pressable onPress={() => setCameraCollapsed(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, marginBottom: cameraCollapsed ? 0 : 8 }}>
          <Text style={styles.sectionTitle}>🎥 Swing Camera</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {cameraCollapsed && (
              <Text style={{ color: '#aaa', fontSize: 12 }}>{recording ? '● Recording' : savedSwings.length > 0 ? `${savedSwings.length} saved` : 'Tap to open'}</Text>
            )}
            <Text style={{ color: '#4ade80', fontSize: 22, fontWeight: '700' }}>{cameraCollapsed ? '▸' : '▾'}</Text>
          </View>
        </Pressable>
        {!cameraCollapsed && (<>

          {/* Permission states */}
          {!cameraPermission?.granted && cameraPermission?.status !== 'undetermined' && (
            <Text style={{ color: '#ff5252', fontSize: 13 }}>Camera access denied. Enable it in device settings.</Text>
          )}
          {!cameraPermission?.granted && (
            <Pressable
              onPress={async () => { await requestCameraPermission(); if (!micPermission?.granted) requestMicPermission(); }}
              style={({ pressed }) => ({ backgroundColor: pressed ? '#333' : '#1e1e1e', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#555' })}
            >
              <Text style={{ color: '#A7F3D0' }}>Allow Camera Access</Text>
            </Pressable>
          )}

          {/* Live preview */}
          {cameraPermission?.granted && !videoUri && (
            <CameraView
              ref={cameraRef}
              mode="video"
              style={{ height: 260, borderRadius: 12, marginTop: 4, overflow: 'hidden' }}
            />
          )}

          {/* Recording indicator */}
          {(recording || autoRecording) && (
            <Text style={{ color: '#ff5252', marginTop: 6, fontWeight: '600' }}>
              {autoRecording ? '🎥 Recording swing...' : '🎥 Recording...'}
            </Text>
          )}

          {/* Instant analysis */}
          {lastSwingAnalysis && !recording && !autoRecording && (
            <View style={{ backgroundColor: '#0d2b0d', borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: '#2e7d32' }}>
              <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '700', marginBottom: 6 }}>⚡ Instant Analysis</Text>
              <Text style={{ color: '#e0e0e0', fontSize: 14, lineHeight: 21, marginBottom: 10 }}>{buildFeedbackLine(lastSwingAnalysis)}</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <View style={{ backgroundColor: '#0a1a0a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#1e4620' }}>
                  <Text style={{ color: lastSwingAnalysis.tempo === 'smooth' ? '#66bb6a' : '#f9a825', fontSize: 12, fontWeight: '700' }}>
                    {lastSwingAnalysis.tempo === 'smooth' ? '✅' : lastSwingAnalysis.tempo === 'fast' ? '⚡' : '🐢'} {lastSwingAnalysis.tempo} tempo
                  </Text>
                </View>
                <View style={{ backgroundColor: '#0a1a0a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#1e4620' }}>
                  <Text style={{ color: lastSwingAnalysis.peakG > 3.0 ? '#f9a825' : '#66bb6a', fontSize: 12, fontWeight: '700' }}>
                    {lastSwingAnalysis.peakG > 3.0 ? '⚠️ unstable' : '✅ stable'} balance
                  </Text>
                </View>
                <View style={{ backgroundColor: '#0a1a0a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#1e4620' }}>
                  <Text style={{ color: lastSwingAnalysis.plane === 'ideal' ? '#66bb6a' : '#f9a825', fontSize: 12, fontWeight: '700' }}>
                    {lastSwingAnalysis.plane} plane
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Video playback */}
          {videoUri && (
            <View style={{ position: 'relative' }}>
              <Video
                ref={videoRef}
                source={{ uri: videoUri }}
                style={{ height: 260, borderRadius: 12, marginTop: 6 }}
                resizeMode={ResizeMode.CONTAIN}
                onPlaybackStatusUpdate={(status) => {
                  if (status.isLoaded) setIsPlaying(status.isPlaying);
                }}
              />
              <Image
                source={require('../assets/images/logo-transparent.png')}
                style={{ position: 'absolute', bottom: 10, right: 10, width: 40, height: 40, opacity: 0.8 }}
                resizeMode="contain"
              />
            </View>
          )}

          {/* Controls */}
          {cameraPermission?.granted && (
            <View style={{ flexDirection: 'row', marginTop: 10 }}>
              {!videoUri ? (
                !recording ? (
                  <Pressable
                    onPress={startRecording}
                    style={({ pressed }) => ({ backgroundColor: pressed ? '#1b5e20' : '#2e7d32', padding: 12, borderRadius: 10, marginRight: 8 })}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>🎥 Start Recording</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={stopRecording}
                    style={({ pressed }) => ({ backgroundColor: pressed ? '#b71c1c' : '#c62828', padding: 12, borderRadius: 10 })}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>⏹ Stop Recording</Text>
                  </Pressable>
                )
              ) : (
                <View style={{ flex: 1, marginTop: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
                    <Pressable
                      onPress={() => { if (isPlaying) videoRef.current?.pauseAsync(); else videoRef.current?.playAsync(); }}
                      style={({ pressed }) => ({ backgroundColor: pressed ? '#1b5e20' : '#2e7d32', width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' })}
                    >
                      <Text style={{ fontSize: 20 }}>{isPlaying ? '⏸' : '▶'}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (videoUri) {
                          const newSwing = { uri: videoUri, time: new Date().toLocaleTimeString(), result: shotResult || 'straight', tempo: 'Manual', analysis: generateSwingAnalysis(shotResult || 'straight', 'smooth') };
                          setSavedSwings((prev) => [newSwing, ...prev]);
                        }
                      }}
                      style={({ pressed }) => ({ backgroundColor: pressed ? '#1a237e' : '#283593', width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' })}
                    >
                      <Text style={{ fontSize: 20 }}>💾</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { setVideoUri(null); setIsPlaying(false); }}
                      style={({ pressed }) => ({ backgroundColor: pressed ? '#b71c1c' : '#c62828', width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' })}
                    >
                      <Text style={{ fontSize: 20 }}>🗑</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { setVideoUri(null); setIsPlaying(false); }}
                      style={({ pressed }) => ({ backgroundColor: pressed ? '#444' : '#555', width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' })}
                    >
                      <Text style={{ fontSize: 20 }}>↩</Text>
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 4 }}>
                    {[isPlaying ? 'Pause' : 'Play', 'Save', 'Delete', 'Retake'].map((label) => (
                      <Text key={label} style={{ width: 52, color: '#aaa', fontSize: 10, textAlign: 'center' }}>{label}</Text>
                    ))}
                  </View>
                  {savedSwings.length > 0 && (
                    <Text style={{ color: '#66bb6a', fontSize: 12, marginTop: 8, textAlign: 'center' }}>{savedSwings.length} swing{savedSwings.length !== 1 ? 's' : ''} saved</Text>
                  )}
                </View>
              )}
            </View>
          )}
          </>)}
        </View>

      {/* Saved Swings — AI Analysis Gallery */}
      {savedSwings.length > 0 && (
        <View style={styles.card}>
          {/* ── AI Swing Gallery collapse header ── */}
          <Pressable onPress={() => setSwingGalleryCollapsed(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, marginBottom: swingGalleryCollapsed ? 0 : 10 }}>
            <Text style={styles.sectionTitle}>AI Swing Analysis</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {swingGalleryCollapsed && (
                <Text style={{ color: '#aaa', fontSize: 12 }}>{savedSwings.length} swing{savedSwings.length !== 1 ? 's' : ''}</Text>
              )}
              <Text style={{ color: '#4ade80', fontSize: 22, fontWeight: '700' }}>{swingGalleryCollapsed ? '▸' : '▾'}</Text>
            </View>
          </Pressable>
          {!swingGalleryCollapsed && (<>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <View />
            <Pressable onPress={() => setSavedSwings([])}>
              <Text style={{ color: '#c62828', fontSize: 12 }}>Clear All</Text>
            </Pressable>
          </View>
          {savedSwings.map((swing, idx) => {
            const a = swing.analysis;
            const isOpen = expandedAnalysis === idx;
            const missColor = swing.result === 'right' ? '#448aff' : swing.result === 'left' ? '#ff5252' : '#66bb6a';
            return (
              <View key={idx} style={{ backgroundColor: '#121212', borderRadius: 12, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: isOpen ? '#2e7d32' : '#1e1e1e' }}>
                {/* Header row */}
                <Pressable
                  onPress={() => setExpandedAnalysis(isOpen ? null : idx)}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: missColor }} />
                    <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Swing #{savedSwings.length - idx}</Text>
                    <Text style={{ color: '#aaa', fontSize: 12 }}>{swing.time}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: missColor, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' }}>{swing.result}</Text>
                    <Text style={{ color: '#aaa', fontSize: 14 }}>{isOpen ? '▲' : '▼'}</Text>
                  </View>
                </Pressable>

                {/* Expanded analysis */}
                {isOpen && a && (
                  <View style={{ paddingHorizontal: 12, paddingBottom: 14 }}>
                    {/* Summary */}
                    <Text style={{ color: '#ccc', fontSize: 13, lineHeight: 20, marginBottom: 12 }}>{a.summary}</Text>

                    {/* Visual indicators row */}
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                      {/* Path diagram */}
                      <View style={{ flex: 1, backgroundColor: '#0a0a0a', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                        <Text style={{ color: '#ccc', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Club Path</Text>
                        <View style={{ width: 52, height: 52, justifyContent: 'center', alignItems: 'center' }}>
                          {/* Target line */}
                          <View style={{ position: 'absolute', width: 52, height: 2, backgroundColor: '#333' }} />
                          {/* Path arrow */}
                          <View style={{
                            position: 'absolute',
                            width: 48,
                            height: 3,
                            backgroundColor: a.path === 'outside-in' ? '#ff5252' : a.path === 'inside-out' ? '#448aff' : '#66bb6a',
                            borderRadius: 2,
                            transform: [{ rotate: a.path === 'outside-in' ? '-18deg' : a.path === 'inside-out' ? '18deg' : '0deg' }],
                          }} />
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', position: 'absolute' }} />
                        </View>
                        <Text style={{ color: a.path === 'outside-in' ? '#ff5252' : a.path === 'inside-out' ? '#448aff' : '#66bb6a', fontSize: 11, fontWeight: '700', marginTop: 4 }}>
                          {a.path === 'outside-in' ? 'Out?In' : a.path === 'inside-out' ? 'In?Out' : 'On Plane'}
                        </Text>
                        {a.pathDeg !== 0 && <Text style={{ color: '#aaa', fontSize: 10 }}>{a.pathDeg > 0 ? '+' : ''}{a.pathDeg}—</Text>}
                      </View>

                      {/* Face angle diagram */}
                      <View style={{ flex: 1, backgroundColor: '#0a0a0a', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                        <Text style={{ color: '#ccc', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Face Angle</Text>
                        <View style={{ width: 36, height: 48, justifyContent: 'center', alignItems: 'center' }}>
                          {/* Club face rect */}
                          <View style={{
                            width: 10,
                            height: 36,
                            backgroundColor: a.face === 'open' ? '#ff5252' : a.face === 'closed' ? '#448aff' : '#66bb6a',
                            borderRadius: 3,
                            transform: [{ rotate: a.face === 'open' ? '15deg' : a.face === 'closed' ? '-15deg' : '0deg' }],
                          }} />
                        </View>
                        <Text style={{ color: a.face === 'open' ? '#ff5252' : a.face === 'closed' ? '#448aff' : '#66bb6a', fontSize: 11, fontWeight: '700', marginTop: 4, textTransform: 'capitalize' }}>{a.face}</Text>
                        {a.faceDeg !== 0 && <Text style={{ color: '#aaa', fontSize: 10 }}>{a.faceDeg > 0 ? '+' : ''}{a.faceDeg}—</Text>}
                      </View>

                      {/* Tempo + Speed */}
                      <View style={{ flex: 1, backgroundColor: '#0a0a0a', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                        <Text style={{ color: '#ccc', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Tempo</Text>
                        <Text style={{ color: a.tempo === 'smooth' ? '#66bb6a' : '#f9a825', fontSize: 22, fontWeight: '800' }}>
                          {a.tempo === 'smooth' ? '✅' : a.tempo === 'fast' ? '⚡' : '🐢'}
                        </Text>
                        <Text style={{ color: a.tempo === 'smooth' ? '#66bb6a' : '#f9a825', fontSize: 11, fontWeight: '700', marginTop: 2, textTransform: 'capitalize' }}>{a.tempo}</Text>
                        <Text style={{ color: '#aaa', fontSize: 10 }}>{a.speedEst} speed</Text>
                      </View>

                      {/* Rotation tile (gyroscope-derived) */}
                      <View style={{ flex: 1, backgroundColor: '#0a0a0a', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                        <Text style={{ color: '#ccc', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Rotation</Text>
                        {/* Arc indicator */}
                        <View style={{ width: 36, height: 36, justifyContent: 'center', alignItems: 'center' }}>
                          <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 3,
                            borderColor: a.bodyRotation === 'good' ? '#66bb6a' : a.bodyRotation === 'over' ? '#f9a825' : '#555',
                            borderTopColor: 'transparent', transform: [{ rotate: a.bodyRotation === 'good' ? '45deg' : '90deg' }] }} />
                        </View>
                        <Text style={{ color: a.bodyRotation === 'good' ? '#66bb6a' : a.bodyRotation === 'over' ? '#f9a825' : '#ff5252', fontSize: 10, fontWeight: '700', marginTop: 2, textTransform: 'capitalize' }}>
                          {a.bodyRotation === 'good' ? 'Good turn' : a.bodyRotation === 'over' ? 'Over-rotate' : 'Restricted'}
                        </Text>
                        <Text style={{ color: '#aaa', fontSize: 10 }}>{a.rotScore}/100</Text>
                      </View>
                    </View>

                    {/* Metrics strip */}
                    <View style={{ flexDirection: 'row', backgroundColor: '#0a0a0a', borderRadius: 8, padding: 10, marginBottom: 12, gap: 8 }}>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: '#aaa', fontSize: 10, textTransform: 'uppercase' }}>Plane</Text>
                        <Text style={{ color: a.plane === 'ideal' ? '#66bb6a' : '#f9a825', fontSize: 13, fontWeight: '700', textTransform: 'capitalize' }}>{a.plane}</Text>
                      </View>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: '#aaa', fontSize: 10, textTransform: 'uppercase' }}>Peak G</Text>
                        <Text style={{ color: '#ccc', fontSize: 13, fontWeight: '700' }}>{a.peakG}g</Text>
                      </View>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: '#aaa', fontSize: 10, textTransform: 'uppercase' }}>Duration</Text>
                        <Text style={{ color: '#ccc', fontSize: 13, fontWeight: '700' }}>{(a.duration / 1000).toFixed(1)}s</Text>
                      </View>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: '#aaa', fontSize: 10, textTransform: 'uppercase' }}>Wrist</Text>
                        <Text style={{ color: a.wristRotation === 'normal' ? '#66bb6a' : '#f9a825', fontSize: 13, fontWeight: '700', textTransform: 'capitalize' }}>{a.wristRotation}</Text>
                      </View>
                    </View>

                    {/* Coaching cues */}
                    <View style={{ backgroundColor: '#0d2b0d', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#2e7d32' }}>
                      <Text style={{ color: '#A7F3D0', fontWeight: '700', fontSize: 12, marginBottom: 6 }}>Coaching Cues</Text>
                      {a.cues.map((cue, ci) => (
                        <Text key={ci} style={{ color: '#ccc', fontSize: 12, lineHeight: 18, marginBottom: 2 }}>— {cue}</Text>
                      ))}
                    </View>

                    {/* Speak button */}
                    <Pressable
                      onPress={() => { void voiceSpeak(`${a.summary} ${a.cues.join('. ')}`, 'calm'); }}
                      style={({ pressed }) => ({ backgroundColor: pressed ? '#1b5e20' : '#1e1e1e', borderRadius: 8, padding: 8, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#333' })}
                    >
                      <Text style={{ color: '#A7F3D0', fontSize: 12 }}>🎙 Speak Analysis</Text>
                    </Pressable>
                  </View>
                )}

                {isOpen && !a && (
                  <View style={{ padding: 12 }}>
                    <Text style={{ color: '#aaa', fontSize: 13 }}>No sensor data captured — record a new swing for AI analysis.</Text>
                  </View>
                )}

                {/* Video thumbnail strip — with shot tracer + logo watermark */}
                <View style={{ position: 'relative' }}>
                  <Video
                    source={{ uri: swing.uri }}
                    style={{ height: isOpen ? 200 : 0, opacity: isOpen ? 1 : 0 }}
                    resizeMode={ResizeMode.CONTAIN}
                    useNativeControls={isOpen}
                  />
                  {/* Shot tracer overlay — red arc showing ball flight based on analysis */}
                  {isOpen && a && (() => {
                    // x offset: outside-in curves right, inside-out curves left, on-plane straight
                    const missDir = a.missDir ?? a.path;
                    const lateralShift = a.path === 'outside-in' ? 38 : a.path === 'inside-out' ? -38 : 0;
                    const peakX = 50 + (lateralShift * 0.6); // control point peak
                    const endX  = 50 + lateralShift;         // landing x%
                    const traceColor = a.path === 'on-plane' ? '#66bb6a' : '#ef4444';
                    return (
                      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 200 }}>
                        {/* Ball flight arc — 3 line segments approximating a quadratic curve */}
                        {[0,1,2,3,4,5,6,7].map((i) => {
                          const t0 = i / 8;
                          const t1 = (i + 1) / 8;
                          // Quadratic bezier: start=(50%,90%), ctrl=(peakX,30%), end=(endX,18%)
                          const bx = (t: number) => (1-t)*(1-t)*50 + 2*(1-t)*t*peakX + t*t*endX;
                          const by = (t: number) => (1-t)*(1-t)*88 + 2*(1-t)*t*30 + t*t*18;
                          const x0 = bx(t0); const y0 = by(t0);
                          const x1 = bx(t1); const y1 = by(t1);
                          const dx = x1 - x0; const dy = y0 - y1; // screen y flipped
                          const len = Math.sqrt(dx*dx + dy*dy) * 2;
                          const angle = Math.atan2(dx, dy) * (180/Math.PI);
                          return (
                            <View key={i} pointerEvents="none" style={{
                              position: 'absolute',
                              left: `${x0}%` as any,
                              top: `${y0}%` as any,
                              width: 3, height: len,
                              backgroundColor: traceColor,
                              borderRadius: 2,
                              opacity: 0.82,
                              transform: [
                                { translateX: -1.5 },
                                { rotate: `${angle}deg` },
                                { translateY: -len / 2 },
                              ],
                              shadowColor: traceColor, shadowOpacity: 0.7, shadowRadius: 4,
                            }} />
                          );
                        })}
                        {/* Landing dot */}
                        <View pointerEvents="none" style={{ position: 'absolute', left: `${endX}%` as any, top: '16%', width: 8, height: 8, borderRadius: 4, backgroundColor: traceColor, opacity: 0.9, transform: [{ translateX: -4 }], shadowColor: traceColor, shadowOpacity: 0.8, shadowRadius: 6 }} />
                        {/* Tracer label */}
                        <View style={{ position: 'absolute', top: 6, left: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ color: traceColor, fontSize: 10, fontWeight: '700' }}>
                            {a.path === 'outside-in' ? '↙ Out-In' : a.path === 'inside-out' ? '↗ In-Out' : '✔ On-Plane'}
                          </Text>
                        </View>
                      </View>
                    );
                  })()}
                  {isOpen && (
                    <View pointerEvents="none" style={{ position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                      <Image source={LOGO} style={{ width: 52, height: 20 }} resizeMode="contain" />
                    </View>
                  )}
                </View>
              </View>
            );
          })}
          </>)}
        </View>
      )}

      {/* Round History */}
      {roundHistory.length > 0 && (
        <View style={{ marginTop: 20 }}>
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15, marginBottom: 10 }}>Round History</Text>

          {/* Performance Trends */}
          <View style={{ backgroundColor: '#121212', padding: 16, borderRadius: 14, marginBottom: 12 }}>
            <Text style={{ color: '#A7F3D0', fontWeight: '600', marginBottom: 8 }}>Performance Trends</Text>
            <Text style={{ color: '#ccc', fontSize: 13 }}>Avg Score: {roundHistory.length ? Math.round(roundHistory.reduce((sum, r) => sum + (r.scores[0] ?? 0), 0) / roundHistory.length) : '—'}</Text>
            <Text style={{ color: '#ccc', fontSize: 13 }}>Best Score: {roundHistory.length ? Math.min(...roundHistory.map((r) => r.scores[0] ?? 999)) : '—'}</Text>
            {roundHistory.length >= 2 && (() => {
              const trend = (roundHistory[1].scores[0] ?? 0) - (roundHistory[0].scores[0] ?? 0);
              return (
                <Text style={{ color: trend > 0 ? '#66bb6a' : '#ff5252', fontSize: 13, marginTop: 4 }}>
                  {trend > 0 ? `Improving by ${trend} strokes` : `Declined by ${Math.abs(trend)} strokes`}
                </Text>
              );
            })()}
            {/* Score bar graph */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 12, gap: 6 }}>
              {roundHistory.slice(0, 10).reverse().map((r, i) => {
                const max = Math.max(...roundHistory.map((h) => h.scores[0] ?? 0), 100);
                const height = Math.max(8, Math.round(((r.scores[0] ?? 0) / max) * 80));
                return (
                  <View key={i} style={{ width: 14, height, backgroundColor: '#66bb6a', borderRadius: 3 }} />
                );
              })}
            </View>
            <Text style={{ color: '#aaa', fontSize: 10, marginTop: 4 }}>◄ older    newer ►</Text>
          </View>

          {/* History list */}
          {roundHistory.map((r, index) => (
            <View key={index} style={{ backgroundColor: '#1e1e1e', padding: 12, borderRadius: 12, marginBottom: 8 }}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{r.date}</Text>
              <Text style={{ color: '#A7F3D0', fontSize: 13, marginTop: 2 }}>Winner: {r.winner}</Text>
              <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>Scores: {r.scores.join(' / ')}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Focus tools panel — shown when Focus Mode is ON (toggled from tools menu) */}
      {focusMode && (
          <View style={{ marginTop: 14 }}>
            <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>FOCUS TOOLS</Text>

            {/* Reset Focus cue */}
            <Pressable
              onPress={() => {
                const now = Date.now();
                if (now - lastResetTime < 500) return;
                setLastResetTime(now);
                const idx = Math.floor(Math.random() * FOCUS_MESSAGES.length);
                const msg = FOCUS_MESSAGES[idx];
                setFocusMessage(msg);
                speakCaddie(msg);
                console.log('Focus Event:', { type: 'focus_reset', timestamp: now });
              }}
              style={{ backgroundColor: '#0f2d1f', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#2e7d32' }}
            >
              <Text style={{ color: '#A7F3D0', fontSize: 14, fontWeight: '600' }}>🔄 Reset Focus</Text>
            </Pressable>
            {focusMessage !== '' && (
              <Text style={{ color: '#e0ffe8', fontSize: 15, fontStyle: 'italic', textAlign: 'center', marginTop: 8, paddingHorizontal: 8 }}>
                {'“'}{focusMessage}{'”'}
              </Text>
            )}

            {/* Quick Replies */}
            <Text style={{ color: '#aaa', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginTop: 14, marginBottom: 6 }}>QUICK REPLIES</Text>
            {QUICK_REPLIES.map((msg, i) => (
              <Pressable
                key={i}
                onPress={async () => {
                  setLastQuickReply(msg);
                  try {
                    const Clipboard = require('expo-clipboard');
                    if (Clipboard?.setStringAsync) {
                      await Clipboard.setStringAsync(msg);
                      console.log('Copied to clipboard:', msg);
                    } else {
                      console.log('Clipboard unavailable:', msg);
                    }
                  } catch {
                    console.log('Quick Reply fallback:', msg);
                  }
                }}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? '#1b2b1b' : '#111',
                  borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12,
                  marginBottom: 6, borderWidth: 1, borderColor: '#2a2a2a',
                })}
              >
                <Text style={{ color: '#9CA3AF', fontSize: 13 }}>{msg}</Text>
              </Pressable>
            ))}
            {lastQuickReply !== '' && (
              <Text style={{ color: '#4ade80', fontSize: 12, marginTop: 4 }}>✓ Copied: {'“'}{lastQuickReply}{'”'}</Text>
            )}

            {/* Priority flag */}
            <Text style={{ color: '#aaa', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginTop: 14, marginBottom: 6 }}>INTERRUPTION PRIORITY</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['low', 'urgent', null] as const).map((flag) => (
                <Pressable
                  key={String(flag)}
                  onPress={() => setPriorityFlag(flag)}
                  style={{
                    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                    backgroundColor: priorityFlag === flag
                      ? flag === 'urgent' ? '#7f1d1d' : flag === 'low' ? '#1a3a2a' : '#1e1e1e'
                      : '#111',
                    borderWidth: 1,
                    borderColor: priorityFlag === flag
                      ? flag === 'urgent' ? '#f87171' : flag === 'low' ? '#4ade80' : '#555'
                      : '#2a2a2a',
                  }}
                >
                  <Text style={{
                    color: priorityFlag === flag
                      ? flag === 'urgent' ? '#fca5a5' : flag === 'low' ? '#86efac' : '#9CA3AF'
                      : '#555',
                    fontSize: 12, fontWeight: '700',
                  }}>
                    {flag === null ? 'Clear' : flag === 'urgent' ? '🚨 Urgent' : '🟢 Low'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {priorityFlag && (
              <Text style={{ color: priorityFlag === 'urgent' ? '#f87171' : '#86efac', fontSize: 12, marginTop: 6, textAlign: 'center' }}>
                Priority Mode: {priorityFlag.toUpperCase()}
              </Text>
            )}

          </View>
        )}

    </ScrollView>}

    {/* Shot Trace Overlay */}
    {lastShotTrace && (() => {
      const dx = lastShotTrace.endX - lastShotTrace.startX;
      const dy = lastShotTrace.startY - lastShotTrace.endY;
      const length = Math.sqrt(dx * dx + dy * dy) * 2.2;
      const angleDeg = Math.atan2(dx, dy) * (180 / Math.PI);
      const traceColor = Math.abs(dx) < 5 ? '#66bb6a' : dx < 0 ? '#60a5fa' : '#f87171';
      return (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${lastShotTrace.startX}%` as any,
            top: `${lastShotTrace.startY}%` as any,
            width: 4,
            height: length,
            backgroundColor: traceColor,
            borderRadius: 2,
            opacity: traceOpacity,
            transform: [
              { translateX: -2 },
              { rotate: `${angleDeg}deg` },
              { translateY: -length / 2 },
            ],
            shadowColor: traceColor,
            shadowOpacity: 0.8,
            shadowRadius: 6,
          }}
        />
      );
    })()}



    {/* ── Tools dropdown ─────────────────────────────────────────────── */}
    {!watchMode && (
      <>
        {/* Transparent backdrop — closes dropdown when user taps anywhere else */}
        {showToolsMenu && (
          <Pressable
            onPress={() => setShowToolsMenu(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}
          />
        )}

        {/* ⚙️ Gear button — upper-right */}
        <Pressable
          onPress={() => setShowToolsMenu((v) => !v)}
          style={{
            position: 'absolute', top: 52, right: 14, zIndex: 51,
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: showToolsMenu ? '#143d22' : '#111',
            borderWidth: 1.5, borderColor: showToolsMenu ? '#4caf50' : '#2a2a2a',
            justifyContent: 'center', alignItems: 'center',
            shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, elevation: 6,
          }}
        >
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </Pressable>

        {/* Dropdown panel */}
        {showToolsMenu && (
          <View style={{
            position: 'absolute', top: 100, right: 14, zIndex: 52,
            backgroundColor: '#111', borderRadius: 14,
            borderWidth: 1, borderColor: '#2a2a2a',
            padding: 10, gap: 8, minWidth: 190,
            shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, elevation: 8,
          }}>
            {/* GPS watch toggle */}
            <Pressable
              onPress={() => {
                if (gpsWatchRef.current) {
                  stopGpsWatch();
                  setGpsYards(null);
                } else {
                  void startGpsWatch();
                }
              }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: gpsWatchRef.current ? '#143d22' : '#1a1a1a',
                borderWidth: 1, borderColor: gpsWatchRef.current ? '#4caf50' : '#2a2a2a',
              }}
            >
              <Text style={{ fontSize: 18 }}>📡</Text>
              <Text style={{ color: gpsWatchRef.current ? '#A7F3D0' : '#aaa', fontSize: 13, fontWeight: '600' }}>GPS {gpsWatchRef.current ? 'On' : 'Off'}</Text>
            </Pressable>

            {/* Audio mute toggle */}
            <Pressable
              onPress={() => setQuietMode((q) => !q)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: quietMode ? '#143d22' : '#1a1a1a',
                borderWidth: 1, borderColor: quietMode ? '#4caf50' : '#2a2a2a',
              }}
            >
              <Text style={{ fontSize: 18 }}>{quietMode ? '🔕' : '🔊'}</Text>
              <Text style={{ color: quietMode ? '#A7F3D0' : '#aaa', fontSize: 13, fontWeight: '600' }}>{quietMode ? 'Voice Off' : 'Voice On'}</Text>
            </Pressable>

            {/* Voice style — calm / aggressive */}
            <Pressable
              onPress={() => setVoiceStyle((s) => s === 'calm' ? 'aggressive' : 'calm')}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: voiceStyle === 'aggressive' ? '#3b0f0f' : '#1a1a1a',
                borderWidth: 1, borderColor: voiceStyle === 'aggressive' ? '#ef4444' : '#2a2a2a',
              }}
            >
              <Text style={{ fontSize: 18 }}>{voiceStyle === 'aggressive' ? '🔥' : '🧘'}</Text>
              <Text style={{ color: voiceStyle === 'aggressive' ? '#fca5a5' : '#aaa', fontSize: 13, fontWeight: '600' }}>
                {voiceStyle === 'aggressive' ? 'Aggressive' : 'Calm'} Voice
              </Text>
            </Pressable>

            {/* Voice gender */}
            <Pressable
              onPress={() => {
                const next = localGender === 'male' ? 'female' : 'male';
                setLocalGender(next);
                setVoiceGender(next);
                setGlobalGender(next);
              }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a',
              }}
            >
              <Text style={{ color: '#A7F3D0', fontSize: 14, fontWeight: '800', minWidth: 18, textAlign: 'center' }}>{localGender === 'male' ? 'M' : 'F'}</Text>
              <Text style={{ color: '#aaa', fontSize: 13, fontWeight: '600' }}>{localGender === 'male' ? 'Male Voice' : 'Female Voice'}</Text>
            </Pressable>

            {/* Earbud / Active mode */}
            <Pressable
              onPress={handleToggleEarbudMode}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: earbudMode ? '#143d22' : '#1a1a1a',
                borderWidth: 1, borderColor: earbudMode ? '#4caf50' : '#2a2a2a',
              }}
            >
              <Text style={{ fontSize: 18 }}>🎧</Text>
              <Text style={{ color: earbudMode ? '#A7F3D0' : '#aaa', fontSize: 13, fontWeight: '600' }}>Earbuds {earbudMode ? 'On' : 'Off'}</Text>
            </Pressable>

            <Pressable
              onPress={handleListeningToggle}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: listening ? '#143d22' : '#1a1a1a',
                borderWidth: 1, borderColor: listening ? '#4caf50' : '#2a2a2a',
              }}
            >
              <Text style={{ fontSize: 18 }}>{listening ? '🛑' : '🎙️'}</Text>
              <Text style={{ color: listening ? '#A7F3D0' : '#aaa', fontSize: 13, fontWeight: '600' }}>{listening ? 'Stop Listening' : 'Start Listening'}</Text>
            </Pressable>

            {/* High / Low contrast */}
            <Pressable
              onPress={() => setHighContrast((h) => !h)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: highContrast ? '#332900' : '#1a1a1a',
                borderWidth: 1, borderColor: highContrast ? '#FFD700' : '#2a2a2a',
              }}
            >
              <Text style={{ fontSize: 18 }}>{highContrast ? '☀️' : '🌙'}</Text>
              <Text style={{ color: highContrast ? '#FFE600' : '#aaa', fontSize: 13, fontWeight: '600' }}>{highContrast ? 'High Contrast' : 'Low Contrast'}</Text>
            </Pressable>

            {/* Focus Mode+ */}
            <Pressable
              onPress={() => {
                setFocusMode((prev) => {
                  const next = !prev;
                  if (!next) { setFocusMessage(''); setLastQuickReply(''); }
                  return next;
                });
              }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: focusMode ? '#143d22' : '#1a1a1a',
                borderWidth: 1, borderColor: focusMode ? '#4ade80' : '#2a2a2a',
              }}
            >
              <Text style={{ fontSize: 18 }}>🎯</Text>
              <Text style={{ color: focusMode ? '#A7F3D0' : '#aaa', fontSize: 13, fontWeight: '600' }}>Focus Mode {focusMode ? 'On' : 'Off'}</Text>
            </Pressable>

            {/* Start / End Round */}
            <Pressable
              onPress={() => { isRoundActive ? void endRound() : startRound(); setShowToolsMenu(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: isRoundActive ? '#2a1111' : '#143d22',
                borderWidth: 1.5, borderColor: isRoundActive ? '#ef4444' : '#4ade80',
              }}
            >
              <Text style={{ fontSize: 18 }}>{isRoundActive ? '🏁' : '⛳'}</Text>
              <Text style={{ color: isRoundActive ? '#fca5a5' : '#A7F3D0', fontSize: 13, fontWeight: '700' }}>{isRoundActive ? 'End Round' : 'Start Round'}</Text>
            </Pressable>

            {/* Watch mode */}
            <Pressable
              onPress={() => { setWatchMode((w) => !w); setShowToolsMenu(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: watchMode ? '#143d22' : '#1a1a1a',
                borderWidth: 1, borderColor: watchMode ? '#4caf50' : '#2a2a2a',
              }}
            >
              <Text style={{ fontSize: 18 }}>⌚</Text>
              <Text style={{ color: watchMode ? '#A7F3D0' : '#aaa', fontSize: 13, fontWeight: '600' }}>Watch Mode {watchMode ? 'On' : 'Off'}</Text>
            </Pressable>

            {/* Low Power mode */}
            <Pressable
              onPress={() => { toggleLowPowerMode(!lowPowerMode); setShowToolsMenu(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: lowPowerMode ? '#1a2a0e' : '#1a1a1a',
                borderWidth: 1, borderColor: lowPowerMode ? '#84cc16' : '#2a2a2a',
              }}
            >
              <Text style={{ fontSize: 18 }}>🔋</Text>
              <Text style={{ color: lowPowerMode ? '#bef264' : '#aaa', fontSize: 13, fontWeight: '600' }}>Low Power {lowPowerMode ? 'On' : 'Off'}</Text>
            </Pressable>

            {/* Shake-to-wake — only relevant when Low Power is on */}
            <Pressable
              onPress={() => { setShakeWakeEnabled((v) => !v); setShowToolsMenu(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: shakeWakeEnabled ? '#1a2a0e' : '#1a1a1a',
                borderWidth: 1, borderColor: shakeWakeEnabled ? '#84cc16' : '#2a2a2a',
                opacity: lowPowerMode ? 1 : 0.45,
              }}
            >
              <Text style={{ fontSize: 18 }}>📳</Text>
              <Text style={{ color: shakeWakeEnabled ? '#bef264' : '#aaa', fontSize: 13, fontWeight: '600' }}>Shake to Wake {shakeWakeEnabled ? 'On' : 'Off'}</Text>
            </Pressable>

            <Pressable
              onPress={handleOpenProfile}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: '#143d22', borderWidth: 1, borderColor: '#4caf50',
              }}
            >
              <Text style={{ fontSize: 18 }}>👤</Text>
              <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '600' }}>Profile</Text>
            </Pressable>

            <Pressable
              onPress={() => { setShowToolsMenu(false); router.push('/settings' as any); }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#6366f1',
              }}
            >
              <Text style={{ fontSize: 18 }}>⚙️</Text>
              <Text style={{ color: '#a5b4fc', fontSize: 13, fontWeight: '600' }}>Settings</Text>
            </Pressable>

            <Pressable
              onPress={() => { void handleLogout(); }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: '#2a1111', borderWidth: 1, borderColor: '#ef4444',
              }}
            >
              <Text style={{ fontSize: 18 }}>↩️</Text>
              <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '600' }}>Log Out</Text>
            </Pressable>

            {/* Biometric toggle */}
            <Pressable
              onPress={() => { void handleBiometricToggle(); setShowToolsMenu(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: biometricEnabled ? '#1a1a2e' : '#1a1a1a',
                borderWidth: 1, borderColor: biometricEnabled ? '#818cf8' : '#2a2a2a',
              }}
            >
              <Text style={{ fontSize: 18 }}>🔒</Text>
              <Text style={{ color: biometricEnabled ? '#a5b4fc' : '#aaa', fontSize: 13, fontWeight: '600' }}>
                Face ID / Fingerprint {biometricEnabled ? 'On' : 'Off'}
              </Text>
            </Pressable>

            {/* Manual lock */}
            <Pressable
              onPress={() => { BiometricLayoutControls._lockApp?.(); setShowToolsMenu(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#374151',
                opacity: biometricEnabled ? 1 : 0.4,
              }}
            >
              <Text style={{ fontSize: 18 }}>🔐</Text>
              <Text style={{ color: '#9ca3af', fontSize: 13, fontWeight: '600' }}>Lock App</Text>
            </Pressable>
          </View>
        )}

        {/* 📍 Rangefinder FAB — bottom-right */}
        <Pressable
          onPress={() => {
            const y = getYardages();
            const yardage = targetDistance ?? y.middle ?? currentHoleData?.distance;
            router.push({ pathname: '/rangefinder', params: {
              yardage: String(yardage ?? ''),
              hole: String(hole),
              frontLat: String(currentHoleData?.front?.lat ?? ''),
              frontLng: String(currentHoleData?.front?.lng ?? ''),
              middleLat: String(currentHoleData?.middle?.lat ?? ''),
              middleLng: String(currentHoleData?.middle?.lng ?? ''),
              backLat: String(currentHoleData?.back?.lat ?? ''),
              backLng: String(currentHoleData?.back?.lng ?? ''),
            } });
          }}
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
      </>
    )}



    </>
    )} {/* end quickMode ternary */}

    {/* ── Low Power tap-to-wake overlay ────────────────────────────────────── */}
    {lowPowerMode && !isWoken && (
      <Pressable
        onPress={handleTapToWake}
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 9000, justifyContent: 'center', alignItems: 'center',
          backgroundColor: 'transparent',
        }}
      >
        <View style={{
          backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 14, paddingHorizontal: 28,
          borderRadius: 18, borderWidth: 1, borderColor: '#2d6a4f', alignItems: 'center', gap: 4,
        }}>
          <Text style={{ color: '#A7F3D0', fontSize: 28 }}>🔋</Text>
          <Text style={{ color: '#A7F3D0', fontSize: 14, fontWeight: '700' }}>Low Power</Text>
          <Text style={{ color: '#6b7280', fontSize: 11 }}>
            {shakeWakeEnabled ? 'Tap or shake to wake' : 'Tap to wake'}
          </Text>
        </View>
      </Pressable>
    )}

    </Animated.View>

    {/* ── AIM MODE: fullscreen camera + overlay ──────────────────────────── */}
    {aimMode && (() => {
      // Pixel offset applied to aim line based on CaddieMemory miss bias
      // right-bias → shift left (negative), left-bias → shift right (positive)
      const aimOffset =
        cmMissBias === 'right' && cmConfidence >= 30 ? -28 :
        cmMissBias === 'left'  && cmConfidence >= 30 ?  28 : 0;
      const aimAdjusted = aimOffset !== 0;
      const aimColor = aimOffset < 0 ? '#93c5fd' : aimOffset > 0 ? '#fcd34d' : 'rgba(167,243,208,0.85)';

      return (
        <Modal
          visible={aimMode}
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => setAimMode(false)}
        >
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            {cameraPermission?.granted ? (
              <CameraView style={{ flex: 1 }} facing="back">
                {/* ── Tap-to-lock layer (must be first / lowest for touch) ── */}
                <Pressable
                  style={StyleSheet.absoluteFillObject}
                  onPress={(e) => {
                    const { locationX, locationY } = e.nativeEvent;
                    setAimTarget({ x: locationX, y: locationY });
                  }}
                />

                {/* ── Visual overlay (pointer-transparent so tap passes through) ── */}
                <View
                  style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', paddingBottom: 48 }}
                  pointerEvents="box-none"
                >
                  {/* Top bar */}
                  <View style={{
                    paddingTop: 56, paddingHorizontal: 20,
                    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <View style={{
                      backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12,
                      paddingHorizontal: 14, paddingVertical: 6, gap: 2,
                    }}>
                      <Text style={{ color: '#6ee7b7', fontSize: 13, fontWeight: '700' }}>🎯 Aim Assist</Text>
                      {aimAdjusted && (
                        <Text style={{ color: aimColor, fontSize: 10, fontWeight: '600' }}>
                          Aim adjusted for your tendency
                        </Text>
                      )}
                      {aimTarget && (
                        <Text style={{ color: '#a7f3d0', fontSize: 10 }}>🔒 Target locked</Text>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {aimTarget && (
                        <Pressable
                          onPress={() => setAimTarget(null)}
                          style={({ pressed }) => ({
                            backgroundColor: pressed ? 'rgba(251,191,36,0.3)' : 'rgba(0,0,0,0.55)',
                            borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
                            borderWidth: 1, borderColor: 'rgba(251,191,36,0.5)',
                          })}>
                          <Text style={{ color: '#fcd34d', fontSize: 12, fontWeight: '700' }}>Clear</Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => { setAimMode(false); setAimTarget(null); }}
                        style={({ pressed }) => ({
                          backgroundColor: pressed ? 'rgba(239,68,68,0.35)' : 'rgba(0,0,0,0.55)',
                          borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7,
                          borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)',
                        })}>
                        <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '700' }}>✕ Close</Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* ── Aim lines ── */}
                  <View style={{ ...StyleSheet.absoluteFillObject }} pointerEvents="none">
                    {/* Vertical aim line — bottom center upward, offset by bias */}
                    <AimLine screenOffset={aimOffset} lineColor={aimColor} target={aimTarget} />
                  </View>

                  {/* ── Tap hint when no target yet ── */}
                  {!aimTarget && (
                    <View style={{ alignItems: 'center', marginBottom: 120 }} pointerEvents="none">
                      <View style={{
                        backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20,
                        paddingHorizontal: 16, paddingVertical: 6,
                      }}>
                        <Text style={{ color: 'rgba(167,243,208,0.7)', fontSize: 12 }}>Tap to lock target</Text>
                      </View>
                    </View>
                  )}

                  {/* Bottom caddie hint */}
                  {(() => {
                    const d = getCaddieDecision();
                    return (
                      <View style={{
                        marginHorizontal: 24,
                        backgroundColor: 'rgba(0,0,0,0.65)',
                        borderRadius: 16, padding: 14,
                        borderWidth: 1, borderColor: 'rgba(74,222,128,0.25)',
                        gap: 4,
                      }}>
                        <Text style={{ color: '#6ee7b7', fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textAlign: 'center' }}>
                          {d.aimLabel.toUpperCase()}
                        </Text>
                        <Text style={{ color: '#a7f3d0', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                          {d.club !== '—' ? `${d.club}  ·  ` : ''}{d.distance ? `${d.distance} yds` : ''}
                        </Text>
                        {d.swingTendency && (
                          <Text style={{ color: '#fbbf24', fontSize: 11, textAlign: 'center', fontStyle: 'italic' }}>
                            {d.swingTendency?.detail}
                          </Text>
                        )}
                      </View>
                    );
                  })()}
                </View>
              </CameraView>
            ) : (
              /* Permission denied fallback */
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' }}>Camera permission required</Text>
                <Text style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>Enable camera access in your device settings to use Aim Assist.</Text>
                <Pressable
                  onPress={() => requestCameraPermission()}
                  style={{ backgroundColor: '#10B981', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Grant Permission</Text>
                </Pressable>
                <Pressable onPress={() => setAimMode(false)}>
                  <Text style={{ color: '#6b7280', fontSize: 13, marginTop: 8 }}>Cancel</Text>
                </Pressable>
              </View>
            )}
          </View>
        </Modal>
      );
    })()}
    </>
  );
}  // end PlayScreenClean

const styles = StyleSheet.create({
  loadingCenter: {
    flex: 1,
    backgroundColor: '#0B3D2E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    flex: 1,
    backgroundColor: '#0B3D2E',
  },
  container: {
    padding: 16,
    paddingTop: 0,
    paddingBottom: 40,
    gap: 16,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.11)',
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  courseName: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Outfit_700Bold',
    color: '#fff',
    marginBottom: 4,
  },
  holeInfo: {
    fontSize: 14,
    fontFamily: 'Outfit_400Regular',
    color: 'rgba(255,255,255,0.75)',
  },
  distance: {
    fontSize: 48,
    fontWeight: '700',
    fontFamily: 'Outfit_700Bold',
    color: '#fff',
    textAlign: 'center',
  },
  subText: {
    fontSize: 15,
    fontFamily: 'Outfit_400Regular',
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    marginTop: 4,
  },
  sectionTitle: {
    color: '#A7F3D0',
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'Outfit_700Bold',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardLogoImg: {
    width: 16,
    height: 16,
    marginRight: 6,
    opacity: 0.85,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  option: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    marginRight: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  selected: {
    backgroundColor: '#10B981',
    borderColor: '#ffffff',
  },
  optionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Outfit_600SemiBold',
  },
  debugText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontFamily: 'Outfit_400Regular',
    marginTop: 2,
  },
  secondaryText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    fontFamily: 'Outfit_400Regular',
    marginTop: 4,
    lineHeight: 22,
  },
  insightBanner: {
    backgroundColor: '#1b3a20',
    color: '#A7F3D0',
    padding: 12,
    borderRadius: 12,
    textAlign: 'center',
    marginBottom: 10,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Outfit_600SemiBold',
    borderWidth: 1,
    borderColor: '#2e7d32',
    lineHeight: 22,
  },
  pickerContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    color: '#111827',
  },
  strategy: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Outfit_600SemiBold',
    marginBottom: 8,
  },
  goalToggleContainer: {
    flexDirection: 'row',
    marginTop: 12,
    marginBottom: 6,
    gap: 8,
  },
  goalButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  goalButtonActive: {
    backgroundColor: '#1b5e20',
    borderColor: '#ffffff',
  },
  goalText: {
    color: '#fff',
    fontWeight: '700',
    fontFamily: 'Outfit_700Bold',
    fontSize: 13,
  },
  caddie: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Outfit_700Bold',
  },
});
