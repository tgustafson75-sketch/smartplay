/**
 * app/cage/session.tsx — CageSession
 *
 * Live hitting screen. Supports phone video capture + slow-motion playback
 * when session.videoSource === 'phone'. Text-only when videoSource === 'none'.
 * Reads activeSession from cageStore.
 * On each LOG SHOT: addShot → detectPatterns → POST /api/cage-caddie → speak.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  SafeAreaView,
  Modal,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import SwingPositionOverlay from '../../components/SwingOverlay';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useCageStore } from '../../store/cageStore';
import type { ShotFeel, ShotShape, Deviation } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { speakJob, PRIORITY, configureAudioForRecording, configureAudioForSpeech } from '../../services/voice';
import { getApiBaseUrl } from '../../utils/apiUrl';
import { detectPatterns } from '../../services/cagePattern';
import { extractKeyFrame, analyzeSingleAngle, analyzeDualAngle, analyzePOVAngle } from '../../services/cageVision';
import { getLatestClip, downloadLatestClip, pollForNewClip } from '../../services/goProBridge';
import { metaGlassesBridge } from '../../services/metaGlassesBridge';
import { watchDataBridge } from '../../services/watchDataBridge';
import * as FileSystem from 'expo-file-system';
import DualVideoPlayer from '../../components/DualVideoPlayer';

// ── Club list (same as index.tsx) ──────────────────────────────────────────

const CLUB_ROWS = [
  ['Driver', '3W', '5W', 'Hybrid'],
  ['4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW'],
];
const ALL_CLUBS = CLUB_ROWS.flat();

// ── Feel / Shape options ───────────────────────────────────────────────────

const FEELS: { label: string; value: ShotFeel }[] = [
  { label: 'Flush',  value: 'flush'  },
  { label: 'Thin',   value: 'thin'   },
  { label: 'Fat',    value: 'fat'    },
  { label: 'Shank',  value: 'shank'  },
];

const SHAPES: { label: string; value: ShotShape }[] = [
  { label: 'Pull',     value: 'pull'     },
  { label: 'Draw',     value: 'draw'     },
  { label: 'Straight', value: 'straight' },
  { label: 'Fade',     value: 'fade'     },
  { label: 'Push',     value: 'push'     },
];

// ── Constants ──────────────────────────────────────────────────────────────

const BG      = '#060f09';
const ACCENT  = '#00C896';
const SURFACE = '#0e2018';
const BORDER  = '#1c3a28';
const WHITE   = '#FFFFFF';

// ── UUID helper (pre-generate shot IDs for updateShotAnalysis) ───────────

function genUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CageSession() {
  const router = useRouter();

  const activeSession       = useCageStore((s) => s.activeSession);
  const addShot             = useCageStore((s) => s.addShot);
  const endSession          = useCageStore((s) => s.endSession);
  const updateShotAnalysis  = useCageStore((s) => s.updateShotAnalysis);
  const updateShotWatchData  = useCageStore((s) => s.updateShotWatchData);
  const voiceEnabled        = useSettingsStore((s) => s.voiceEnabled);

  const [feel,          setFeel]          = useState<ShotFeel | null>(null);
  const [shape,         setShape]         = useState<ShotShape | null>(null);
  const [caddieLine,    setCaddieLine]    = useState('Ready. Hit when you\'re set.');
  const [loading,       setLoading]       = useState(false);
  const [patternAlert,  setPatternAlert]  = useState<string | null>(null);
  const [showClubSheet, setShowClubSheet] = useState(false);

  // Club can change mid-session; start from active session's club
  const [currentClub, setCurrentClub] = useState(activeSession?.club ?? '7i');

  // ── Phone video state (only used when videoSource === 'phone') ───────────
  const videoRef              = useRef<Video>(null);
  const [pendingVideoUri,   setPendingVideoUri]   = useState<string | null>(null);
  const [lastShotVideoUri,  setLastShotVideoUri]  = useState<string | null>(null);
  const [isPlaying,         setIsPlaying]         = useState(false);
  const [playbackSpeed,     setPlaybackSpeed]     = useState(1);
  const [sliderPos,         setSliderPos]         = useState(0);
  const [durationMillis,    setDurationMillis]    = useState(1);

  // ── Vision analysis state ────────────────────────────────────────────────
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionLine,    setVisionLine]    = useState<string | null>(null);

  // ── Device-derived flags ─────────────────────────────────────────────────
  const devices = activeSession?.devices ?? {
    phoneCamera: true, watch: false, glasses: false, earbuds: false,
  };
  const isPhoneSession    = activeSession?.videoSource === 'phone';
  const isGoProSession    = activeSession?.videoSource === 'gopro';
  const isWatchSession    = devices.watch;
  const isGlassesSession  = devices.glasses || activeSession?.videoSource === 'glasses';

  // ── Glasses state ─────────────────────────────────────────────────────────
  const [glassesStatus, setGlassesStatus] = useState<'idle' | 'waiting' | 'analyzing' | 'done' | 'no-clip'>('idle');
  const [glassesClipUri, setGlassesClipUri] = useState<string | null>(null);

  // ── GoPro state ──────────────────────────────────────────────────────────
  const lastGoProFilenameRef = useRef<string | null>(null);
  const [goProClipUri,  setGoProClipUri]  = useState<string | null>(null);
  const [goProStatus,   setGoProStatus]   = useState<'idle' | 'waiting' | 'downloading'>('idle');

  // ── Watch state ───────────────────────────────────────────────────────────
  const [showWatchSheet,    setShowWatchSheet]    = useState(false);
  const [watchHRInput,      setWatchHRInput]      = useState('');
  const [watchTempoInput,   setWatchTempoInput]   = useState<'rushed' | 'normal' | 'smooth' | null>(null);
  const [latestHR,          setLatestHR]          = useState<number | null>(null);
  const lastShotIdRef = useRef<string | null>(null);

  // ── Ask Fix sheet state ───────────────────────────────────────────────────
  const [showAskFixSheet,   setShowAskFixSheet]   = useState(false);
  const [askFixLoading,     setAskFixLoading]     = useState(false);

  const shotCount        = activeSession?.shots.length ?? 0;
  const getClubProfile   = useCageStore((s) => s.getClubProfile);
  const sessionHistory   = useCageStore((s) => s.sessionHistory);
  const screenW          = Dimensions.get('window').width;
  const [swingKeyFrame, setSwingKeyFrame] = useState<'address' | 'top' | 'impact'>('impact');

  // On session end, clear watch bridge data
  const handleEndSession = () => {
    watchDataBridge.clearSession();
    endSession();
    router.push('/cage/summary');
  };

  // Ask Fix — send a preset question to cage-caddie and speak the reply
  const handleAskFix = useCallback(async (question: string) => {
    if (!activeSession) return;
    setAskFixLoading(true);
    setShowAskFixSheet(false);
    setCaddieLine('Thinking...');
    try {
      const shots = activeSession.shots;
      const lastShot = shots[shots.length - 1];
      const pattern = detectPatterns(shots, currentClub as string | null);
      const isShotHistory =
        question.toLowerCase().includes('what am i doing wrong') ||
        question.toLowerCase().includes('pattern') ||
        question.toLowerCase().includes('drill') ||
        question.toLowerCase().includes('miss');
      const shotHistory = isShotHistory
        ? shots.map((s) => ({ club: s.club, feel: s.feel, shape: s.shape, aiAnalysis: s.aiAnalysis ?? null }))
        : null;

      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/cage-caddie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          club: currentClub,
          feel: lastShot?.feel ?? null,
          shape: lastShot?.shape ?? null,
          shotNumber: shots.length,
          goal: activeSession.goal ?? null,
          recentPattern: pattern,
          isSummary: false,
          shots: null,
          cageMode: 'multi-device',
          isVoiceQuery: true,
          voiceTranscript: question,
          shotHistory,
        }),
      });
      const data = res.ok ? await res.json() : null;
      const reply = data?.message ?? 'Keep focused — you\'re doing great work in here.';
      setCaddieLine(reply);
      const gender = useSettingsStore.getState().voiceGender ?? 'male';
      await speakJob(reply, PRIORITY.STRATEGY, gender as 'male' | 'female', () => {});
    } catch {
      setCaddieLine('Keep focused — you\'re doing great work in here.');
    } finally {
      setAskFixLoading(false);
    }
  }, [activeSession, currentClub]);

  // Seed lastGoProFilenameRef with current clip on mount so the first poll
  // waits for a genuinely new recording rather than resolving immediately.
  useEffect(() => {
    if (!isGoProSession) return;
    void (async () => {
      try {
        const clip = await getLatestClip();
        if (clip) lastGoProFilenameRef.current = clip.filename;
      } catch { /* GoPro may not be connected yet */ }
    })();
  }, [isGoProSession]);

  // ── Compute analysisMode for a new shot ─────────────────────────────────
  function computeAnalysisMode() {
    const hasCamera  = isPhoneSession || isGoProSession;
    const hasGlasses = isGlassesSession;
    const hasWatch   = isWatchSession;
    if (hasCamera && hasGlasses && hasWatch) return 'all'           as const;
    if (hasCamera && hasGlasses)             return 'phone-glasses' as const;
    if (hasCamera && hasWatch)               return 'phone-watch'   as const;
    if (hasGlasses && hasWatch)              return 'glasses-watch' as const;
    if (hasCamera)                           return 'phone-only'    as const;
    if (hasGlasses)                          return 'glasses-only'  as const;
    if (hasWatch)                            return 'watch-only'    as const;
    return 'none' as const;
  }

  const handleLogShot = useCallback(async () => {
    if (!activeSession) return;

    // Pre-generate shot ID so we can update analysis later
    const shotId = genUuid();
    lastShotIdRef.current = shotId;

    // Capture beforeTimestamp at the very top — before ANY device operation —
    // so the glasses clip comparison is accurate (see waitForNewGlassesClip).
    const beforeTimestamp = Date.now();

    // Capture feel/shape before they're reset at end of function
    const capturedFeel  = feel;
    const capturedShape = shape;
    const capturedGoal  = activeSession.goal ?? null;

    // ── Step 1: Configure audio for recording (prevents BT conflict) ─────
    if (isPhoneSession) {
      try { await configureAudioForRecording(); } catch { /* non-fatal */ }
    }

    // ── Phone video capture ───────────────────────────────────────────────
    let capturedVideoUri: string | null = pendingVideoUri;
    if (isPhoneSession && !capturedVideoUri) {
      try {
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: 'videos' as any,
          videoMaxDuration: 8,
          videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
        });
        if (!result.canceled && result.assets?.[0]?.uri) {
          capturedVideoUri = result.assets[0].uri;
        }
      } catch {
        // camera unavailable — continue without video
      }
    }

    // ── Step 3: Restore audio for speech before any API/voice calls ───────
    try { await configureAudioForSpeech(); } catch { /* non-fatal */ }

    // a. Add shot to store
    addShot({
      id:            shotId,
      club:          currentClub,
      feel:          capturedFeel,
      shape:         capturedShape,
      phoneVideoUri:  capturedVideoUri,
      phoneKeyFrame:  null,
      goProVideoUri:  null,
      goProKeyFrame:  null,
      analysisMode:   computeAnalysisMode(),
      aiAnalysis:    null,
      swingData:     null,
      patternFlag:   null,
      watchData:     null,
      glassesVideoUri: null,
    });

    // ── Background phone vision analysis (non-blocking) ───────────────────
    if (isPhoneSession && capturedVideoUri) {
      const capturedAngle = activeSession.phoneAngle;
      setVisionLoading(true);
      setVisionLine(null);
      void (async () => {
        try {
          const frame = await extractKeyFrame(capturedVideoUri);
          const { analysis, swingData } = await analyzeSingleAngle(
            frame, currentClub, capturedFeel, capturedShape, capturedGoal, capturedAngle,
          );
          updateShotAnalysis(shotId, analysis, swingData as import('../../store/cageStore').SwingPosition | null, { phoneAnalysis: analysis });
          setVisionLine(analysis);
          if (voiceEnabled) void speakJob(analysis, PRIORITY.STRATEGY);
        } catch {
          // vision is best-effort — fail silently
        } finally {
          setVisionLoading(false);
        }
      })();
    }

    // ── GoPro clip polling (gopro sessions only) ──────────────────────────
    if (isGoProSession) {
      const prevFilename   = lastGoProFilenameRef.current;
      const gAngle         = activeSession.goProAngle ?? 'down-the-line';
      const gPhoneUri      = capturedVideoUri;
      setGoProStatus('waiting');
      setGoProClipUri(null);
      setVisionLoading(false);
      setVisionLine(null);
      void (async () => {
        try {
          const clip = await pollForNewClip(prevFilename);
          lastGoProFilenameRef.current = clip.filename;
          setGoProStatus('downloading');
          const dest = ((FileSystem as any).cacheDirectory ?? '') + 'gopro_' + shotId + '.MP4';
          const localUri = await downloadLatestClip(dest);
          if (!localUri) { setGoProStatus('idle'); return; }
          setGoProClipUri(localUri);
          setGoProStatus('idle');
          setVisionLoading(true);
          try {
            if (gPhoneUri) {
              const [phoneFrame, goProFrame] = await Promise.all([
                extractKeyFrame(gPhoneUri),
                extractKeyFrame(localUri),
              ]);
              const faceOnFrame = activeSession.phoneAngle === 'face-on' ? phoneFrame : goProFrame;
              const dtlFrame    = activeSession.phoneAngle === 'face-on' ? goProFrame : phoneFrame;
              const { analysis, swingData } = await analyzeDualAngle(
                faceOnFrame, dtlFrame, currentClub, capturedFeel, capturedShape, capturedGoal,
              );
              updateShotAnalysis(shotId, analysis, swingData as import('../../store/cageStore').SwingPosition | null, { phoneAnalysis: analysis, goProVideoUri: localUri, goProKeyFrame: goProFrame });
              setVisionLine(analysis);
              if (voiceEnabled) void speakJob(analysis, PRIORITY.STRATEGY);
            } else {
              const frame = await extractKeyFrame(localUri);
              const { analysis, swingData } = await analyzeSingleAngle(
                frame, currentClub, capturedFeel, capturedShape, capturedGoal, gAngle,
              );
              updateShotAnalysis(shotId, analysis, swingData as import('../../store/cageStore').SwingPosition | null, { phoneAnalysis: analysis, goProVideoUri: localUri, goProKeyFrame: frame });
              setVisionLine(analysis);
              if (voiceEnabled) void speakJob(analysis, PRIORITY.STRATEGY);
            }
          } catch { /* vision is best-effort */ }
          finally { setVisionLoading(false); }
        } catch {
          setGoProStatus('idle');
          setPatternAlert('GoPro clip not received — logging without video');
        }
      })();
    }

    // ── Meta Glasses clip wait (background, never await directly) ─────────
    if (isGlassesSession) {
      // beforeTimestamp was captured at the very top of handleLogShot
      const currentShotId   = shotId;
      setGlassesStatus('waiting');
      setGlassesClipUri(null);
      metaGlassesBridge.waitForNewGlassesClip(beforeTimestamp, 25000)
        .then(async (clip: any) => {
          setGlassesStatus('analyzing');
          const uri = await metaGlassesBridge.getClipLocalUri(clip);
          setGlassesClipUri(uri);
          const glassesFrame   = await extractKeyFrame(uri);
          const glassesResult  = await analyzePOVAngle(
            glassesFrame, activeSession.club, capturedFeel, capturedShape, capturedGoal,
          );
          updateShotAnalysis(currentShotId, glassesResult.analysis, null, {
            glassesVideoUri: uri,
            glassesAnalysis: glassesResult.analysis,
          });
          setCaddieLine((prev) => prev + '\n\n👓 ' + glassesResult.analysis);
          setGlassesStatus('done');
          // Ensure audio is in speech mode before speaking from async callback
          if (voiceEnabled) {
            try { await configureAudioForSpeech(); } catch { /* non-fatal */ }
            void speakJob(glassesResult.analysis, PRIORITY.STRATEGY);
          }
        })
        .catch((err: Error) => {
          // Timeout / media-library error — silent fail, hide glasses indicator
          console.log('[Glasses] clip not received:', err.message);
          setGlassesStatus('idle');
        });
    }

    // Promote pending video to last-shot player
    if (capturedVideoUri) {
      setLastShotVideoUri(capturedVideoUri);
      setPendingVideoUri(null);
      setIsPlaying(false);
      setSliderPos(0);
      setPlaybackSpeed(1);
    }

    // b. Pattern detection
    const updatedShots = [...(activeSession.shots), {
      id: shotId,
      timestamp: Date.now(),
      club: currentClub,
      feel: capturedFeel,
      shape: capturedShape,
      phoneVideoUri:  capturedVideoUri,
      phoneKeyFrame:  null,
      phoneAnalysis:  null,
      goProVideoUri:  null,
      goProKeyFrame:  null,
      glassesVideoUri: null,
      glassesKeyFrame: null,
      glassesAnalysis: null,
      analysisMode:   computeAnalysisMode(),
      aiAnalysis:    null,
      swingData:     null,
      patternFlag:   null,
      watchData:     null,
    }];
    const pattern = detectPatterns(updatedShots, currentClub as string | null);
    if (pattern) setPatternAlert(pattern);

    // c. POST to /api/cage-caddie
    setLoading(true);
    setCaddieLine('Thinking...');

    try {
      const base = getApiBaseUrl();

      // Include watch data from the latest entry (entered for previous shot)
      // so the brain can use HR/tempo trends in its response.
      const latestWatchEntry = isWatchSession ? watchDataBridge.getLatestEntry() : null;
      const watchPayload = latestWatchEntry
        ? { heartRate: latestWatchEntry.heartRate, tempoFeel: latestWatchEntry.tempoFeel, source: 'manual' as const }
        : null;

      // Include club profile (cageData) so the AI references historical miss/root-cause data.
      const clubProf = getClubProfile(currentClub);
      const cageDataPayload = clubProf && clubProf.shotCount >= 5
        ? {
            dominantMiss: clubProf.dominantMiss,
            missRate:     Math.round(clubProf.missFrequency * 100) + '%',
            rootCause:    clubProf.rootCause,
            shotCount:    clubProf.shotCount,
            confidence:   clubProf.shotCount >= 30 ? 'high' : clubProf.shotCount >= 10 ? 'medium' : 'low',
          }
        : null;

      const res = await fetch(`${base}/api/cage-caddie`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          club:          currentClub,
          feel:          capturedFeel   ?? null,
          shape:         capturedShape  ?? null,
          shotNumber:    shotCount + 1,
          goal:          activeSession.goal ?? null,
          recentPattern: pattern ?? null,
          isSummary:     false,
          shots:         null,
          cageMode:      'multi-device',
          devices,
          analysisMode:  computeAnalysisMode(),
          watchData:     watchPayload,
          cageData:      cageDataPayload,
        }),
      });

      const data = await res.json();
      const message: string = data.message ?? 'No feedback available.';

      // d. Display + voice
      setCaddieLine(message);
      if (voiceEnabled) void speakJob(message, PRIORITY.STRATEGY);

    } catch {
      setCaddieLine('Caddie offline. Keep hitting.');
    } finally {
      setLoading(false);
    }

    // e. Reset selectors
    setFeel(null);
    setShape(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, addShot, currentClub, feel, isGlassesSession, isGoProSession, isPhoneSession,
      isWatchSession, pendingVideoUri, shape, shotCount, updateShotAnalysis, voiceEnabled, devices]);

  if (!activeSession) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No active session.</Text>
          <Pressable onPress={() => router.replace('/cage' as any)} style={styles.startBtn}>
            <Text style={styles.startBtnText}>START ONE</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Text style={styles.chevron}>‹</Text>
          </Pressable>

          <Pressable onPress={() => setShowClubSheet(true)} style={styles.headerCenter}>
            <Text style={styles.headerTitle}>
              {currentClub} · Shot {shotCount + 1}
            </Text>
            <Text style={styles.headerSubtitle}>tap to change club ›</Text>
          </Pressable>

          {/* Device status pills */}
          <View style={styles.headerPills}>
            {isWatchSession && (
              <View style={[styles.hrPill, {
                backgroundColor: latestHR === null ? '#1c3a28'
                  : latestHR < 85  ? '#0e2018'
                  : latestHR < 95  ? '#2a2000'
                  : '#2a0a0a',
              }]}>
                <Text style={[styles.hrText, {
                  color: latestHR === null ? '#8cb8a2'
                    : latestHR < 85  ? ACCENT
                    : latestHR < 95  ? '#F5A623'
                    : '#f05050',
                }]}>
                  ❤️ {latestHR ?? '--'} bpm
                </Text>
              </View>
            )}
            {isGlassesSession && glassesStatus !== 'idle' && (
              <View style={styles.glassesStatusPill}>
                <Text style={styles.glassesStatusPillText}>
                  {glassesStatus === 'waiting'   ? '👓 Waiting...'
                   : glassesStatus === 'analyzing' ? '👓 Analyzing...'
                   :                                 '👓 Analysis ready'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Pattern alert ───────────────────────────────────────────── */}
        {patternAlert && (
          <View style={styles.patternBanner}>
            <Text style={styles.patternText} numberOfLines={3}>{patternAlert}</Text>
            <Pressable onPress={() => setPatternAlert(null)} hitSlop={10} style={styles.dismissBtn}>
              <Text style={styles.dismissText}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* ── Phone video player ──────────────────────────────────────── */}
        {isPhoneSession && lastShotVideoUri && (
          <View style={styles.videoBlock}>
            <Video
              ref={videoRef}
              source={{ uri: lastShotVideoUri }}
              style={styles.videoPlayer}
              resizeMode={ResizeMode.CONTAIN}
              isLooping={false}
              shouldPlay={false}
              rate={playbackSpeed}
              onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                if (!status.isLoaded) return;
                setIsPlaying(status.isPlaying);
                if (status.durationMillis) setDurationMillis(status.durationMillis);
                const pos = status.durationMillis
                  ? status.positionMillis / status.durationMillis
                  : 0;
                setSliderPos(pos);
              }}
            />
            {/* Playback controls */}
            <View style={styles.videoControls}>
              <Pressable
                onPress={() => {
                  if (!videoRef.current) return;
                  if (isPlaying) {
                    void videoRef.current.pauseAsync();
                  } else {
                    void videoRef.current.playAsync();
                  }
                }}
                style={styles.playBtn}
              >
                <Text style={styles.playBtnText}>{isPlaying ? '⏸' : '▶'}</Text>
              </Pressable>
              <View style={styles.speedButtons}>
                {([1, 0.5, 0.25] as const).map((spd) => (
                  <Pressable
                    key={spd}
                    onPress={() => {
                      setPlaybackSpeed(spd);
                      void videoRef.current?.setRateAsync(spd, true);
                    }}
                    style={[styles.speedBtn, playbackSpeed === spd && styles.speedBtnActive]}
                  >
                    <Text style={[styles.speedBtnText, playbackSpeed === spd && styles.speedBtnTextActive]}>
                      {spd === 1 ? '1×' : spd === 0.5 ? '½×' : '¼×'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {/* Scrub bar */}
            <Slider
              style={styles.scrubBar}
              minimumValue={0}
              maximumValue={1}
              value={sliderPos}
              minimumTrackTintColor={ACCENT}
              maximumTrackTintColor={BORDER}
              thumbTintColor={ACCENT}
              onValueChange={(val) => {
                setSliderPos(val);
                void videoRef.current?.setPositionAsync(
                  Math.round(val * durationMillis),
                );
              }}
            />
          </View>
        )}

        {/* ── Feel row ────────────────────────────────────────────────── */}
        <Text style={styles.label}>How did it feel?</Text>
        <View style={styles.chipRow}>
          {FEELS.map(({ label, value }) => (
            <Pressable
              key={value}
              style={[styles.chip, feel === value && styles.chipActive]}
              onPress={() => setFeel(feel === value ? null : value)}
            >
              <Text style={[styles.chipText, feel === value && styles.chipTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Shape row ───────────────────────────────────────────────── */}
        <Text style={[styles.label, { marginTop: 20 }]}>Shot shape?</Text>
        <View style={styles.chipRow}>
          {SHAPES.map(({ label, value }) => (
            <Pressable
              key={value}
              style={[styles.chip, shape === value && styles.chipActive]}
              onPress={() => setShape(shape === value ? null : value)}
            >
              <Text style={[styles.chipText, shape === value && styles.chipTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Phone camera hint ──────────────────────────────────────── */}
        {isPhoneSession && !lastShotVideoUri && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: 'rgba(0,200,150,0.08)', borderRadius: 10,
            padding: 10, marginTop: 12,
            borderWidth: 1, borderColor: 'rgba(0,200,150,0.25)',
          }}>
            <Text style={{ fontSize: 16 }}>📱</Text>
            <Text style={{ color: '#7adfc0', fontSize: 12, flex: 1 }}>
              Phone Camera active — camera opens when you tap LOG SHOT
            </Text>
          </View>
        )}

        {/* ── LOG SHOT + Watch button ──────────────────────────────── */}
        <View style={styles.logShotRow}>
          <Pressable
            style={[styles.logBtn, loading && styles.logBtnDisabled, isWatchSession && styles.logBtnFlex]}
            onPress={handleLogShot}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.logBtnText}>LOG SHOT</Text>
            }
          </Pressable>

          {isWatchSession && (
            <Pressable
              style={styles.watchBtn}
              onPress={() => {
                setWatchHRInput('');
                setWatchTempoInput(null);
                setShowWatchSheet(true);
              }}
            >
              <Text style={styles.watchBtnText}>⌚{'\n'}Watch</Text>
            </Pressable>
          )}
        </View>

        {/* ── Caddie feedback ─────────────────────────────────────────── */}
        <View style={styles.caddieCard}>
          <Text style={styles.caddieLabel}>CADDIE</Text>
          <Text style={[styles.caddieText, loading && styles.caddieTextMuted]}>
            {caddieLine}
          </Text>
        </View>

        {/* ── GoPro status + player ─────────────────────────────────────── */}
        {isGoProSession && (goProStatus !== 'idle' || goProClipUri) && (
          <View style={styles.goProBlock}>
            {(goProStatus === 'waiting' || goProStatus === 'downloading') && (
              <View style={styles.goProStatusRow}>
                <ActivityIndicator size="small" color={ACCENT} />
                <Text style={styles.goProStatusText}>
                  {goProStatus === 'waiting' ? 'Waiting for GoPro clip…' : 'Downloading GoPro clip…'}
                </Text>
              </View>
            )}
            {goProClipUri && (
              <DualVideoPlayer
                leftUri={null}
                rightUri={goProClipUri}
                leftLabel={activeSession.phoneAngle ?? 'Face-On'}
                rightLabel={activeSession.goProAngle ?? 'Down-the-Line'}
              />
            )}
          </View>
        )}

        {/* ── Glasses clip status ────────────────────────────────────── */}
        {isGlassesSession && (glassesStatus !== 'idle' || glassesClipUri) && (
          <View style={styles.glassesBlock}>
            {glassesStatus === 'waiting' && (
              <View style={styles.glassesStatusRow}>
                <ActivityIndicator size="small" color={ACCENT} />
                <Text style={styles.glassesStatusText}>Waiting for glasses clip…</Text>
              </View>
            )}
            {glassesClipUri && (
              <Video
                source={{ uri: glassesClipUri }}
                style={styles.glassesVideo}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay={false}
                isLooping={false}
              />
            )}
          </View>
        )}

        {/* ── Swing Vision (phone / gopro / glasses, after a shot with video) */}
        {(isPhoneSession || isGoProSession || isGlassesSession) && (visionLoading || visionLine) && (
          <View style={styles.visionCard}>
            <Text style={styles.visionLabel}>SWING VISION</Text>
            {visionLoading ? (
              <View style={styles.visionPendingRow}>
                <ActivityIndicator size="small" color={ACCENT} />
                <Text style={styles.visionPendingText}>Analyzing swing...</Text>
              </View>
            ) : (
              <Text style={styles.visionText}>{visionLine}</Text>
            )}
          </View>
        )}

        {/* ── Your Swing Pattern (GolfFix-style) ─────────────────────── */}
        {(() => {
          const profile = getClubProfile(currentClub);

          // Most recent shot with AI swingData for current club
          const allShots = [
            ...sessionHistory.flatMap((sess) => sess.shots),
            ...(activeSession?.shots ?? []),
          ].filter((sh) => sh.club === currentClub);
          const lastWithData = [...allShots].reverse().find((sh) => sh.swingData !== null);
          const raw = lastWithData?.swingData as any;
          const playerPos    = raw?.playerPosition ?? null;
          const devList: Deviation[] | null = raw?.deviations ?? null;
          const primaryIssue: string | null = raw?.primaryIssue ?? null;

          if (!profile) {
            return (
              <View style={styles.swingPatternCard}>
                <Text style={styles.swingPatternTitle}>Your Swing Pattern</Text>
                <Text style={styles.swingNoDataText}>
                  Log 5+ shots to unlock your personal swing profile for {currentClub}.
                </Text>
                <Text style={styles.swingNoDataSub}>
                  Cage AI will build your position data automatically.
                </Text>
              </View>
            );
          }

          const confidence = profile.shotCount >= 30 ? 'high' : profile.shotCount >= 10 ? 'medium' : 'low';

          return (
            <View style={styles.swingPatternCard}>
              {/* Header */}
              <Text style={styles.swingPatternTitle}>Your Swing Pattern</Text>
              <Text style={styles.swingPatternSub}>
                Based on {profile.shotCount} cage shots \u2022 {confidence} confidence
              </Text>

              {/* Key frame tabs */}
              <View style={styles.keyFrameTabRow}>
                {(['address', 'top', 'impact'] as const).map((kf) => (
                  <Pressable
                    key={kf}
                    style={[styles.keyFrameTab, swingKeyFrame === kf && styles.keyFrameTabActive]}
                    onPress={() => setSwingKeyFrame(kf)}
                  >
                    <Text style={[styles.keyFrameTabText, swingKeyFrame === kf && styles.keyFrameTabTextActive]}>
                      {kf.charAt(0).toUpperCase() + kf.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Stick-figure position overlay */}
              <View style={{ alignItems: 'center', marginVertical: 12 }}>
                <SwingPositionOverlay
                  keyFrame={swingKeyFrame}
                  playerPosition={playerPos}
                  deviations={devList}
                  width={screenW - 48}
                  height={320}
                />
              </View>

              {/* Deviation list */}
              {devList && devList.length > 0 && (
                <View style={{ marginBottom: 8 }}>
                  {devList.map((dev, i) => (
                    <Text key={i} style={styles.deviationItem}>
                      \u2022 {dev.joint}: {dev.label} ({dev.delta > 0 ? '+' : ''}{dev.delta}\u00b0)
                    </Text>
                  ))}
                </View>
              )}

              {/* Primary issue */}
              {primaryIssue && (
                <View style={styles.primaryIssueCard}>
                  <Text style={styles.primaryIssueText}>{primaryIssue}</Text>
                </View>
              )}
            </View>
          );
        })()}

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Pressable onPress={() => setShowClubSheet(true)} style={styles.changeClubBtn}>
            <Text style={styles.changeClubText}>Change Club</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowAskFixSheet(true)}
            style={styles.askFixBtn}
            disabled={askFixLoading}
          >
            <Text style={styles.askFixBtnText}>
              {askFixLoading ? '...' : '🏌️ Ask Fix'}
            </Text>
          </Pressable>
          <Pressable onPress={handleEndSession} style={styles.endBtn}>
            <Text style={styles.endBtnText}>End Session</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* ── Watch Quick-Check bottom sheet ──────────────────────── */}
      <Modal
        visible={showWatchSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWatchSheet(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setShowWatchSheet(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Quick Watch Check</Text>

            <Text style={styles.watchSheetLabel}>HR (bpm)</Text>
            <TextInput
              style={styles.watchHRInput}
              value={watchHRInput}
              onChangeText={setWatchHRInput}
              keyboardType="number-pad"
              placeholder="e.g. 82"
              placeholderTextColor="#4a7a60"
              maxLength={3}
            />

            <Text style={[styles.watchSheetLabel, { marginTop: 16 }]}>Tempo feel</Text>
            <View style={styles.tempoPills}>
              {(['rushed', 'normal', 'smooth'] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.tempoPill, watchTempoInput === t && styles.tempoPillActive]}
                  onPress={() => setWatchTempoInput(watchTempoInput === t ? null : t)}
                >
                  <Text style={[styles.tempoPillText, watchTempoInput === t && styles.tempoPillTextActive]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={styles.watchSaveBtn}
              onPress={() => {
                const hrNum    = parseInt(watchHRInput, 10);
                const heartRate = !isNaN(hrNum) && hrNum > 0 ? hrNum : null;
                const shotId   = lastShotIdRef.current;
                if (shotId) {
                  watchDataBridge.recordManualEntry(shotId, { heartRate, tempoFeel: watchTempoInput });
                  updateShotWatchData(shotId, { heartRate, tempoFeel: watchTempoInput, source: 'manual' });
                  if (heartRate !== null) setLatestHR(heartRate);
                }
                setShowWatchSheet(false);
              }}
            >
              <Text style={styles.watchSaveBtnText}>SAVE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Club change bottom sheet ─────────────────────────────────── */}
      <Modal
        visible={showClubSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowClubSheet(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setShowClubSheet(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Select Club</Text>
            {CLUB_ROWS.map((row, ri) => (
              <View key={ri} style={styles.clubRow}>
                {row.map((c) => (
                  <Pressable
                    key={c}
                    style={[styles.sheetClubPill, currentClub === c && styles.sheetClubPillActive]}
                    onPress={() => { setCurrentClub(c); setShowClubSheet(false); }}
                  >
                    <Text style={[styles.sheetClubText, currentClub === c && styles.sheetClubTextActive]}>
                      {c}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Ask Fix bottom sheet ────────────────────────────────────── */}
      <Modal
        visible={showAskFixSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAskFixSheet(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setShowAskFixSheet(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Ask Golf Fix</Text>
            <Text style={{ color: '#6b9e88', fontSize: 12, marginBottom: 14, textAlign: 'center' }}>
              Cage Fix mode — questions use your session data
            </Text>
            {[
              'What am I doing wrong?',
              'What is my dominant miss?',
              'Give me a drill for this session.',
              'How am I doing?',
              'Should I change my approach?',
            ].map((q) => (
              <Pressable
                key={q}
                style={styles.askFixPreset}
                onPress={() => handleAskFix(q)}
              >
                <Text style={styles.askFixPresetText}>{q}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingBottom: 48,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  emptyText: {
    color: WHITE,
    fontSize: 16,
  },
  startBtn: {
    backgroundColor: ACCENT,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
  },
  startBtnText: {
    color: '#000',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 1.5,
  },

  // Header pills (HR + glasses status)
  headerPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  hrPill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: BORDER,
  },
  hrText: {
    fontSize: 11,
    fontWeight: '700',
  },
  glassesStatusPill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#071a10',
    borderWidth: 1,
    borderColor: ACCENT + '44',
  },
  glassesStatusPillText: {
    color: '#8cb8a2',
    fontSize: 11,
    fontWeight: '600',
  },

  // LOG SHOT row (with optional Watch button)
  logShotRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 28,
  },
  logBtnFlex: {
    flex: 1,
  },
  watchBtn: {
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 60,
  },
  watchBtnText: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },

  // Watch quick-check sheet
  watchSheetLabel: {
    color: '#8cb8a2',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  watchHRInput: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: WHITE,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  tempoPills: {
    flexDirection: 'row',
    gap: 10,
  },
  tempoPill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  tempoPillActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  tempoPillText: {
    color: '#8cb8a2',
    fontSize: 14,
    fontWeight: '600',
  },
  tempoPillTextActive: {
    color: '#000',
  },
  watchSaveBtn: {
    marginTop: 20,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  watchSaveBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  backBtn: {
    width: 32,
  },
  chevron: {
    color: WHITE,
    fontSize: 32,
    lineHeight: 34,
    marginTop: -2,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: WHITE,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: '#4a7a60',
    fontSize: 11,
    marginTop: 1,
  },
  headerSpacer: {
    width: 70,
  },
  goalBadge: {
    backgroundColor: '#0e2018',
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 110,
  },
  goalBadgeText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '600',
  },

  // Pattern banner
  patternBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F5A623',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  patternText: {
    flex: 1,
    color: '#1a0f00',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  dismissBtn: {
    paddingTop: 1,
  },
  dismissText: {
    color: '#1a0f00',
    fontSize: 16,
    fontWeight: '700',
  },

  // Section label
  label: {
    color: '#8cb8a2',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  // Feel / shape chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chipActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  chipText: {
    color: '#8cb8a2',
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#000',
  },

  // GoPro status + player
  goProBlock: {
    marginBottom: 20,
    gap: 12,
  },
  goProStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  goProStatusText: {
    color: '#8cb8a2',
    fontSize: 14,
    fontStyle: 'italic',
  },

  // Glasses clip block
  glassesBlock: {
    marginTop: 12,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  glassesStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  glassesStatusText: {
    color: '#8cb8a2',
    fontSize: 14,
    fontStyle: 'italic',
  },
  glassesVideo: {
    width: '100%',
    height: 200,
  },

  // Swing Vision card
  visionCard: {
    marginTop: 12,
    backgroundColor: '#071a10',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ACCENT + '55',
    padding: 16,
    minHeight: 60,
  },
  visionLabel: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },
  visionPendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  visionPendingText: {
    color: '#4a7a60',
    fontSize: 14,
    fontStyle: 'italic',
  },
  visionText: {
    color: WHITE,
    fontSize: 14,
    lineHeight: 21,
  },

  // Phone video player
  videoBlock: {
    marginBottom: 24,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: BORDER,
  },
  videoPlayer: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  videoControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: SURFACE,
  },
  playBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnText: {
    color: '#000',
    fontSize: 16,
  },
  speedButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  speedBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  speedBtnActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  speedBtnText: {
    color: '#8cb8a2',
    fontSize: 13,
    fontWeight: '600',
  },
  speedBtnTextActive: {
    color: '#000',
  },
  scrubBar: {
    width: '100%',
    height: 36,
    paddingHorizontal: 8,
    backgroundColor: SURFACE,
  },

  // Log shot button
  logBtn: {
    marginTop: 28,
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 20,
    alignItems: 'center',
  },
  logBtnDisabled: {
    opacity: 0.6,
  },
  logBtnText: {
    color: '#000',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 2,
  },

  // Caddie card
  caddieCard: {
    marginTop: 20,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    minHeight: 90,
  },
  caddieLabel: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },
  caddieText: {
    color: WHITE,
    fontSize: 15,
    lineHeight: 22,
  },
  caddieTextMuted: {
    color: '#4a7a60',
  },

  // Footer
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 32,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  changeClubBtn: {
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  changeClubText: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '600',
  },
  endBtn: {
    borderWidth: 1.5,
    borderColor: '#c94040',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  endBtnText: {
    color: '#c94040',
    fontSize: 14,
    fontWeight: '700',
  },

  // Ask Fix button
  askFixBtn: {
    borderWidth: 1.5,
    borderColor: ACCENT,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  askFixBtnText: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '700',
  },
  // Ask Fix preset questions
  askFixPreset: {
    backgroundColor: '#0a1a10',
    borderWidth: 1,
    borderColor: '#1c3a28',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  askFixPresetText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },

  // Club change sheet
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0e2018',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: BORDER,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 18,
    letterSpacing: 0.5,
  },
  clubRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  sheetClubPill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sheetClubPillActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  sheetClubText: {
    color: '#8cb8a2',
    fontSize: 14,
    fontWeight: '600',
  },
  sheetClubTextActive: {
    color: '#000',
  },

  // ── Swing Pattern (GolfFix-style) ──────────────────────────────────────
  swingPatternCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginTop: 20,
    marginBottom: 4,
  },
  swingPatternTitle: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  swingPatternSub: {
    color: '#4a7a60',
    fontSize: 12,
    marginBottom: 14,
  },
  swingNoDataText: {
    color: '#8cb8a2',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  swingNoDataSub: {
    color: '#4a7a60',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
  },
  keyFrameTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  keyFrameTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#0a1a0f',
    borderWidth: 1,
    borderColor: BORDER,
  },
  keyFrameTabActive: {
    backgroundColor: 'rgba(0,200,150,0.12)',
    borderColor: ACCENT,
  },
  keyFrameTabText: {
    color: '#4a7a60',
    fontSize: 13,
    fontWeight: '700',
  },
  keyFrameTabTextActive: {
    color: ACCENT,
  },
  deviationItem: {
    color: '#FF4444',
    fontSize: 12,
    lineHeight: 20,
  },
  primaryIssueCard: {
    marginTop: 10,
    backgroundColor: '#0a1a0f',
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: ACCENT,
    padding: 12,
  },
  primaryIssueText: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 21,
  },
});
