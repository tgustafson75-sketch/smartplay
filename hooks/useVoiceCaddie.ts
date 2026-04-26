import { useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import { Vibration } from 'react-native';
import {
  configureAudioForRecording,
  speak,
  stopSpeaking,
} from '../services/voiceService';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { VoiceState } from '../components/CaddieAvatar';

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
}

export const useVoiceCaddie = ({
  onVoiceStateChange,
  onResponseReceived,
  onHeroMoment,
  onVisionTrigger,
}: UseVoiceCaddieOptions) => {

  const recordingRef = useRef<Audio.Recording | null>(null);
  const isProcessingRef = useRef(false);

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

  // ── CHECK BYPASS PHRASES ──────────────────

  const checkBypasses = (transcript: string): {
    handled: boolean;
    response?: string;
    triggerHero?: boolean;
    triggerVision?: boolean;
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

      const res = await fetch(apiUrl + '/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          club,
          scores,
          courseHoles: useRoundStore.getState().courseHoles,
          responseMode,
        }),
      });

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

  // ── MAIN MIC HANDLER ─────────────────────

  const handleMicPress = useCallback(async () => {
    if (isProcessingRef.current) return;

    // If already recording — stop and process
    if (recordingRef.current) {
      try {
        isProcessingRef.current = true;
        onVoiceStateChange('thinking');

        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;

        if (!uri) {
          onVoiceStateChange('idle');
          isProcessingRef.current = false;
          return;
        }

        // Send to Whisper
        const formData = new FormData();
        formData.append('audio', { uri, type: 'audio/m4a', name: 'audio.m4a' } as unknown as Blob);
        formData.append('language', language);

        const transcribeRes = await fetch(apiUrl + '/api/transcribe', {
          method: 'POST',
          body: formData,
        });

        const transcribeData = await transcribeRes.json() as { text?: string };
        const transcript = transcribeData.text ?? '';

        console.log('[voice] transcript:', transcript);

        if (!transcript.trim()) {
          onVoiceStateChange('idle');
          isProcessingRef.current = false;
          return;
        }

        // Check bypass phrases first
        const bypass = checkBypasses(transcript);

        if (bypass.handled) {
          if (bypass.triggerVision) onVisionTrigger?.();
          if (bypass.triggerHero) onHeroMoment?.();

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

        // Send to Kevin's brain
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
      return;
    }

    // Start recording
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        console.log('[voice] no mic permission');
        return;
      }

      await configureAudioForRecording();

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );

      recordingRef.current = recording;
      onVoiceStateChange('listening');
      console.log('[voice] recording started');

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

  return { handleMicPress };
};
