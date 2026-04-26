import { useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import { Vibration } from 'react-native';
import {
  configureAudioForRecording,
  speak,
  stopSpeaking,
  isSpeaking,
} from '../services/voiceService';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { useCageStore } from '../store/cageStore';
import { useWatchStore } from '../store/watchStore';
import { VoiceState } from '../components/CaddieAvatar';

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
}

export const useVoiceCaddie = ({
  onVoiceStateChange,
  onResponseReceived,
  onHeroMoment,
  onVisionTrigger,
  onHeroReelView,
}: UseVoiceCaddieOptions) => {

  const recordingRef    = useRef<Audio.Recording | null>(null);
  const isProcessingRef = useRef(false);
  const autoStopTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    isRoundActive,
    currentHole,
    currentYardage,
    activeCourse,
    club,
    scores,
    isCompetition,
    getCurrentPar,
  } = useRoundStore();

  const {
    voiceGender,
    voiceEnabled,
    discreteMode,
    language,
    responseMode,
  } = useSettingsStore();

  const {
    name,
    firstName,
    handicap,
    dominantMiss,
    physicalLimitation,
    goal,
    personalBest,
  } = usePlayerProfileStore();

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

  const sendToBrain = async (message: string): Promise<string> => {
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

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(apiUrl + '/api/brain', {
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

      if (!res.ok) return 'One shot at a time.';
      const data = await res.json() as { response?: string };
      return data.response || 'One shot at a time.';

    } catch (err) {
      console.log('[voice] brain error:', err);
      return 'One shot at a time.';
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

      const response = await sendToBrain(transcript);
      onResponseReceived(response);
      onVoiceStateChange('speaking');
      await speakResponse(response);
      onVoiceStateChange('idle');

    } catch (err) {
      console.log('[voice] process error:', err);
      onVoiceStateChange('idle');
    } finally {
      isProcessingRef.current = false;
    }
  }, [language, voiceEnabled, discreteMode, voiceGender, currentYardage, currentHole, club, isRoundActive]);

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
