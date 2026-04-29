import { useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import { Vibration } from 'react-native';
import {
  configureAudioForRecording,
  speak,
  speakFromBase64,
  stopSpeaking,
  isSpeaking,
  playLocalFile,
} from '../services/voiceService';
import {
  initFillerLibrary,
  isLibraryGenerated,
  getClipForCategory,
  classifyQuery,
} from '../services/fillerLibrary';
import { checkContent } from '../services/contentGuardrail';
import type { ToolAction } from '../app/api/kevin+api';
import { useSmartVision } from '../contexts/SmartVisionContext';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { useCageStore } from '../store/cageStore';
import { useWatchStore } from '../store/watchStore';
import { VoiceState } from '../components/CaddieAvatar';
import { getCourse as getApiCourse, courseSummaryForContext } from '../services/golfCourseApi';
import { generatePatternInsights } from '../services/patternDetection';
import { useGhostStore } from '../store/ghostStore';
import { useSmartFinderStore } from '../store/smartFinderStore';

// ─── CONSTANTS ────────────────────────────

const AUTO_STOP_MS = 4000;

// 16kHz mono 32kbps — 4x smaller than HIGH_QUALITY, same Whisper accuracy
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.LOW,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 32000,
  },
};

// ─── BYPASS PHRASES ───────────────────────

const YARDAGE_PHRASES = [
  "what's my yardage",
  "what is my yardage",
  "how far",
  "how many yards",
  "what's the distance",
  "distance to the pin",
  "yards to the pin",
  "how far to the green",
  "yardage",
  "cuántas yardas",
  "distancia al green",
];

const HERO_PHRASES = [
  "did you get that",
  "save that",
  "hero reel",
  "that's a keeper",
  "got that",
  "save it",
];

const HERO_VIEW_PHRASES = [
  'show me my hero reel',
  'show my best shots',
  'show me my best',
  'hero reel',
  'my best shots',
  'show me my drives',
  'show me my irons',
];

const MUTE_PHRASES = [
  "mute",
  "be quiet",
  "stop talking",
  "silence",
  "quiet",
  "silenciar",
];

const VISION_PHRASES = [
  "smart vision",
  "analyze the hole",
  "analyze this hole",
  "read the hole",
  "what do you see",
  "hole analysis",
];

// ─── HOOK ─────────────────────────────────

interface UseVoiceCaddieOptions {
  onVoiceStateChange: (state: VoiceState) => void;
  onResponseReceived: (text: string) => void;
  onHeroMoment?: () => void;
  onVisionTrigger?: () => void;
  onHeroReelView?: () => void;
  onToolAction?: (action: ToolAction) => void;
}

export const useVoiceCaddie = ({
  onVoiceStateChange,
  onResponseReceived,
  onHeroMoment,
  onVisionTrigger,
  onHeroReelView,
  onToolAction,
}: UseVoiceCaddieOptions) => {

  const recordingRef    = useRef<Audio.Recording | null>(null);
  const isProcessingRef = useRef(false);
  const autoStopTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    isRoundActive,
    currentHole,
    currentYardage,
    activeCourse,
    activeCourseId,
    club,
    scores,
    isCompetition,
    getCurrentPar,
    mode: roundMode,
    shots,
    courseHoles,
    getPlanForHole,
  } = useRoundStore();

  const {
    voiceGender,
    voiceEnabled,
    discreteMode,
    language,
    responseMode,
    fillerEnabled,
  } = useSettingsStore();

  // Load the filler library index into memory on first mount — fast, reads AsyncStorage only.
  useEffect(() => {
    initFillerLibrary().catch(() => {});
  }, []);

  const {
    name,
    firstName,
    handicap,
    dominantMiss,
    physicalLimitation,
    goal,
    personalBest,
  } = usePlayerProfileStore();

  // dominantMiss from profile has compatible type — just cast for patternDetection
  const profileDominantMiss = dominantMiss as 'left' | 'right' | 'straight' | null;

  const {
    roundsTogether,
    sessionsTogether,
    currentMentalState,
    consecutiveBadHoles,
    isSpiralRisk,
    getTopObservations,
    getRecentHeroMoments,
    addHeroMoment,
  } = useRelationshipStore();

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
  const currentPar = getCurrentPar();
  const smartVision = useSmartVision();

  // ── CLEAR AUTO STOP ───────────────────────

  const clearAutoStop = () => {
    if (autoStopTimer.current) {
      clearTimeout(autoStopTimer.current);
      autoStopTimer.current = null;
    }
  };

  // ── CHECK BYPASS PHRASES ──────────────────

  const checkBypasses = (transcript: string): {
    handled: boolean;
    response?: string;
    triggerHero?: boolean;
    triggerVision?: boolean;
    triggerHeroReelView?: boolean;
    triggerMute?: boolean;
  } => {
    const t = transcript.toLowerCase();

    if (HERO_PHRASES.some(p => t.includes(p))) {
      const kevinSaid = addHeroMoment({
        clipUri: null,
        hole: currentHole,
        club: club ?? '',
        courseName: activeCourse ?? '',
        conditions: '',
        carlosNote: null,
      });
      return { handled: true, response: kevinSaid, triggerHero: true };
    }

    if (YARDAGE_PHRASES.some(p => t.includes(p))) {
      const response = currentYardage
        ? "You're " + currentYardage + ' yards to the center.' +
          (club ? ' ' + club + ' in hand.' : '')
        : 'Check the hole view for your yardage.';
      return { handled: true, response };
    }

    if (VISION_PHRASES.some(p => t.includes(p))) {
      return { handled: true, triggerVision: true, response: 'Taking a look at the hole.' };
    }

    if (HERO_VIEW_PHRASES.some(p => t.includes(p))) {
      return { handled: true, triggerHeroReelView: true, response: 'Here are your best moments.' };
    }

    if (MUTE_PHRASES.some(p => t.includes(p))) {
      return { handled: true, triggerMute: true, response: '' };
    }

    return { handled: false };
  };

  // ── SEND TO BRAIN ─────────────────────────

  const sendToBrain = async (message: string): Promise<{ text: string; audioBase64: string | null; toolAction: ToolAction | null }> => {
    try {
      const topObs = getTopObservations();
      const heroMoments = getRecentHeroMoments(2);

      const watchState = useWatchStore.getState();
      const watchSummary = watchState.getSessionSummary();

      const recentCageSessions = useCageStore.getState()
        .sessionHistory
        .slice(-3)
        .reverse()
        .map(s => ({
          club: s.club,
          shots: s.shots.length,
          dominantMiss: s.dominantMiss,
          rootCause: s.rootCause,
          summary: s.summary,
          date: new Date(s.date).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
          }),
        }));

      const holePlan = getPlanForHole(currentHole);
      const ghostContext = useGhostStore.getState().getSummaryText();
      const smartFinderLock = useSmartFinderStore.getState().currentLock;
      const smartFinderContext = smartFinderLock
        ? `SMARTFINDER ACTIVE: User has locked distance of ${smartFinderLock.distance_yards} yards (${smartFinderLock.distance_meters} meters) at compass heading ${Math.round(smartFinderLock.compass_heading)}°. Confidence: ${smartFinderLock.distance_yards >= 50 && smartFinderLock.distance_yards <= 250 ? 'high' : smartFinderLock.distance_yards >= 10 && smartFinderLock.distance_yards <= 400 ? 'medium' : 'low'}. Treat the locked distance as the working number.`
        : null;

      // Build player pattern insights (on-device, sync — cheap enough per-request)
      const patternInsights = generatePatternInsights(shots, {
        currentRoundMode: roundMode,
        scores,
        courseHoles,
        handicap,
        dominantMiss: profileDominantMiss,
      });

      // Build penalty context from already-computed patternInsights raw_stats
      const rs = patternInsights.raw_stats;
      const penaltyLines: string[] = [];
      const totalPenalties = Object.values(rs.penalty_event_count_by_outcome ?? {}).reduce((a, b) => a + (b ?? 0), 0);
      if (totalPenalties > 0) {
        const parts = Object.entries(rs.penalty_event_count_by_outcome ?? {})
          .map(([o, c]) => `${c} ${o}`)
          .join(', ');
        penaltyLines.push(`Recent penalties: ${parts}.`);
      }
      if ((rs.recurring_trouble_holes ?? []).length > 0) {
        penaltyLines.push(`Recurring trouble holes: ${rs.recurring_trouble_holes.join(', ')}.`);
      }
      const penaltyContext = penaltyLines.length > 0 ? penaltyLines.join(' ') : null;

      // Load course context for active API rounds (cache hit = fast; miss = brief network fetch)
      let courseContext: string | null = null;
      if (isRoundActive && activeCourseId) {
        try {
          const course = await getApiCourse(activeCourseId);
          if (course) courseContext = courseSummaryForContext(course);
        } catch (e) {
          console.warn('[voiceCaddie] course context load failed:', e);
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);

      const res = await fetch(apiUrl + '/api/kevin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message,
          language,
          playerName: name,
          firstName,
          handicap,
          roundsTogether,
          sessionsTogether,
          currentHole,
          currentPar,
          currentYardage,
          activeCourse,
          activeCourseId,
          courseContext,
          roundMode,
          patternInsights,
          holePlan,
          ghostContext,
          smartFinderContext,
          penaltyContext,
          isRoundActive,
          isCompetition,
          mentalState: currentMentalState,
          consecutiveBadHoles,
          isSpiralRisk: isSpiralRisk(),
          topObservations: topObs,
          recentHeroMoments: heroMoments,
          dominantMiss,
          physicalLimitation,
          goal,
          personalBest,
          recentCageSessions,
          club,
          scores,
          courseHoles: useRoundStore.getState().courseHoles,
          responseMode,
          smartVisionContext: smartVision.isOpen ? {
            holeNumber: smartVision.holeNumber,
            par: smartVision.par,
            centerYards: smartVision.centerYards,
            measureYards: smartVision.measureYards,
            analysisText: smartVision.analysisText,
          } : null,
          watchData: watchState.isConnected && watchSummary
            ? {
                averageTempo: watchSummary.averageTempo.toFixed(1),
                dominantFault: watchSummary.dominantTempoFault,
                earlyTransitionRate: Math.round(watchSummary.earlyTransitionRate * 100),
                averageClubSpeed: Math.round(watchSummary.averageClubSpeed),
                swingCount: watchSummary.swings.length,
              }
            : null,
        }),
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) return { text: 'Sorry, lost you for a moment. Try again.', audioBase64: null, toolAction: null };
      const data = await res.json() as { text?: string; audioBase64?: string | null; toolAction?: ToolAction | null };
      return {
        text:        data.text       ?? 'Got nothing back from the brain. Try again.',
        audioBase64: data.audioBase64 ?? null,
        toolAction:  data.toolAction  ?? null,
      };

    } catch (err) {
      console.log('[voice] brain error:', err);
      return { text: 'Hit a snag on my end. Try again.', audioBase64: null, toolAction: null };
    }
  };

  // ── SPEAK RESPONSE ────────────────────────

  const speakResponse = async (text: string): Promise<void> => {
    if (!voiceEnabled || !text) return;
    if (discreteMode) {
      Vibration.vibrate(200);
      return;
    }
    await speak(text, voiceGender, language, apiUrl);
  };

  // ── PROCESS AUDIO URI (shared by manual + VAD) ────

  const processAudioUri = useCallback(async (uri: string): Promise<void> => {
    if (isProcessingRef.current) return;
    try {
      isProcessingRef.current = true;
      onVoiceStateChange('thinking');

      const formData = new FormData();
      formData.append('audio', { uri, type: 'audio/m4a', name: 'audio.m4a' } as unknown as Blob);
      formData.append('language', language);

      const transcribeController = new AbortController();
      const transcribeTimeout = setTimeout(() => transcribeController.abort(), 10000);

      const transcribeRes = await fetch(apiUrl + '/api/transcribe', {
        method: 'POST',
        body: formData,
        signal: transcribeController.signal,
      }).finally(() => clearTimeout(transcribeTimeout));

      const transcribeData = await transcribeRes.json() as { text?: string };
      const transcript = transcribeData.text ?? '';

      console.log('[voice] transcript:', transcript);

      if (!transcript.trim()) {
        onVoiceStateChange('idle');
        isProcessingRef.current = false;
        return;
      }

      const bypass = checkBypasses(transcript);

      if (bypass.handled) {
        if (bypass.triggerVision) onVisionTrigger?.();
        if (bypass.triggerHero) onHeroMoment?.();
        if (bypass.triggerHeroReelView) onHeroReelView?.();

        if (bypass.triggerMute) {
          await stopSpeaking();
          onVoiceStateChange('idle');
          isProcessingRef.current = false;
          return;
        }

        if (bypass.response) {
          onResponseReceived(bypass.response);
          onVoiceStateChange('speaking');
          await speakResponse(bypass.response);
          onVoiceStateChange('idle');
        }

        isProcessingRef.current = false;
        return;
      }

      // Fire filler clip in parallel with the brain call.
      // playLocalFile claims the audio singleton — when speakFromBase64 / speakResponse
      // runs below, it bumps speechId and naturally cancels any still-playing filler.
      if (voiceEnabled && !discreteMode && fillerEnabled && isLibraryGenerated()) {
        const clip = getClipForCategory(classifyQuery(transcript));
        if (clip) playLocalFile(clip.audio_path).catch(() => {});
      }

      const rawResponse = await sendToBrain(transcript);
      const kevinResponse = {
        ...rawResponse,
        ...checkContent(rawResponse.text, rawResponse.audioBase64),
      };
      if (kevinResponse.toolAction) onToolAction?.(kevinResponse.toolAction);
      onResponseReceived(kevinResponse.text);
      onVoiceStateChange('speaking');
      if (kevinResponse.audioBase64 && voiceEnabled && !discreteMode) {
        await speakFromBase64(kevinResponse.audioBase64);
      } else {
        await speakResponse(kevinResponse.text);
      }
      onVoiceStateChange('idle');

    } catch (err) {
      console.log('[voice] process error:', err);
      onVoiceStateChange('idle');
    } finally {
      isProcessingRef.current = false;
    }
  }, [language, voiceEnabled, discreteMode, voiceGender, fillerEnabled, currentYardage, currentHole, club, isRoundActive, roundMode]);

  // ── MAIN MIC HANDLER ─────────────────────

  const handleMicPress = useCallback(async () => {
    if (isSpeaking()) {
      await stopSpeaking();
      isProcessingRef.current = false;
      onVoiceStateChange('idle');
      return;
    }

    if (isProcessingRef.current) return;

    // ── STOP and process ──────────────────
    if (recordingRef.current) {
      clearAutoStop();

      try {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;

        if (!uri) {
          onVoiceStateChange('idle');
          return;
        }

        await processAudioUri(uri);

      } catch (err) {
        console.log('[voice] stop error:', err);
        onVoiceStateChange('idle');
      }
      return;
    }

    // ── START recording ───────────────────
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        console.log('[voice] no mic permission');
        return;
      }

      await configureAudioForRecording();

      const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);

      recordingRef.current = recording;
      onVoiceStateChange('listening');
      console.log('[voice] recording started');

      // Auto-stop after AUTO_STOP_MS
      autoStopTimer.current = setTimeout(() => {
        if (recordingRef.current) {
          handleMicPress();
        }
      }, AUTO_STOP_MS);

    } catch (err) {
      console.log('[voice] record error:', err);
      onVoiceStateChange('idle');
    }

  }, [
    language,
    voiceEnabled,
    discreteMode,
    voiceGender,
    currentYardage,
    currentHole,
    club,
    isRoundActive,
  ]);

  return { handleMicPress, processAudioUri };
};
