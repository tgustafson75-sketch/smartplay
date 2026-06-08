import { useEffect, useRef, useState } from 'react';
import { Platform, Alert } from 'react-native';
import { Audio } from 'expo-av';
// 2026-06-08 (audit M1) — route audio-mode writes through the serial queue
// so an Auto-Listen mic restart can't race a TTS playback mode write and
// flip routing / silent-mode mid-utterance.
import { setAudioModeSerial } from '../services/voiceService';

// ─── TUNABLE CONSTANTS ────────────────────
// Phase AB — SILENCE_DURATION_MS bumped from 1500 → 2800. Natural
// conversational pauses (thinking, breathing, mid-sentence ellipses)
// regularly hit 1.5–2.5s; the prior cap finalised the recording on
// every pause and submitted partial utterances, leaving Kevin stumped.
// 2.8s leaves enough room for thought without making "I'm done" obvious.

export const SPEECH_THRESHOLD_DB   = -40;
export const SILENCE_DURATION_MS   = 2800;
export const MIN_SPEECH_DURATION_MS = 500;

// ─── TYPES ────────────────────────────────

type VADState = 'IDLE' | 'SPEAKING' | 'TRAILING';

interface UseVoiceActivityDetectionOptions {
  enabled: boolean;
  onSpeechStart: () => void;
  onSpeechEnd: (audioUri: string) => void;
}

interface UseVoiceActivityDetectionResult {
  isListening: boolean;
  currentLevel: number;
}

// ─── RECORDING OPTIONS ────────────────────

const VAD_RECORDING_OPTIONS: Audio.RecordingOptions = {
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
  isMeteringEnabled: true,
};

// ─── HOOK ─────────────────────────────────

export function useVoiceActivityDetection({
  enabled,
  onSpeechStart,
  onSpeechEnd,
}: UseVoiceActivityDetectionOptions): UseVoiceActivityDetectionResult {
  const [isListening, setIsListening] = useState(false);
  const [currentLevel, setCurrentLevel] = useState(-160);

  const recordingRef    = useRef<Audio.Recording | null>(null);
  const vadStateRef     = useRef<VADState>('IDLE');
  const speakStartRef   = useRef<number>(0);
  const silenceStartRef = useRef<number>(0);
  const aboveCountRef   = useRef<number>(0);

  // Use refs for callbacks to avoid stale closures in the status handler
  const onSpeechStartRef = useRef(onSpeechStart);
  const onSpeechEndRef   = useRef(onSpeechEnd);
  useEffect(() => { onSpeechStartRef.current = onSpeechStart; }, [onSpeechStart]);
  useEffect(() => { onSpeechEndRef.current   = onSpeechEnd;   }, [onSpeechEnd]);
  // 2026-06-08 (audit M3) — read `enabled` through a ref in
  // finishRecording's restart check; the status-update callback captured
  // the value at recording-creation time, so a TRAILING→finish in flight
  // could re-acquire the mic with a stale `true` after Auto-Listen was off.
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const startRecording = async (): Promise<void> => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert(
          'Microphone Required',
          'Auto-Listen needs microphone access. Please enable it in Settings, or turn off Auto-Listen.',
        );
        return;
      }

      await setAudioModeSerial({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const { recording } = await Audio.Recording.createAsync(VAD_RECORDING_OPTIONS);
      recording.setProgressUpdateInterval(100);
      recording.setOnRecordingStatusUpdate((status) => {
        if (!status.isRecording) return;

        const db = status.metering ?? -160;
        setCurrentLevel(db);

        const now = Date.now();
        const state = vadStateRef.current;
        const isAbove = db > SPEECH_THRESHOLD_DB;

        if (isAbove) {
          aboveCountRef.current += 1;
        } else {
          aboveCountRef.current = 0;
        }

        if (state === 'IDLE') {
          // Two consecutive above-threshold samples → SPEAKING
          if (aboveCountRef.current >= 2) {
            vadStateRef.current = 'SPEAKING';
            speakStartRef.current = now;
            onSpeechStartRef.current();
          }
        } else if (state === 'SPEAKING') {
          if (!isAbove) {
            vadStateRef.current = 'TRAILING';
            silenceStartRef.current = now;
          }
        } else if (state === 'TRAILING') {
          if (isAbove) {
            // Sound came back — stay in SPEAKING, reset silence timer
            vadStateRef.current = 'SPEAKING';
          } else {
            const silenceDuration = now - silenceStartRef.current;
            const speechDuration  = silenceStartRef.current - speakStartRef.current;
            if (
              silenceDuration >= SILENCE_DURATION_MS &&
              speechDuration  >= MIN_SPEECH_DURATION_MS
            ) {
              vadStateRef.current = 'IDLE';
              aboveCountRef.current = 0;
              finishRecording();
            }
          }
        }
      });

      recordingRef.current = recording;
      vadStateRef.current  = 'IDLE';
      aboveCountRef.current = 0;
      setIsListening(true);
    } catch (err) {
      console.log('[VAD] startRecording error:', err);
      setIsListening(false);
    }
  };

  const finishRecording = async (): Promise<void> => {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;

    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (uri) {
        onSpeechEndRef.current(uri);
      }
    } catch (err) {
      console.log('[VAD] finishRecording error:', err);
    }

    // Restart immediately to keep listening
    if (enabledRef.current) {
      startRecording();
    } else {
      setIsListening(false);
      setCurrentLevel(-160);
    }
  };

  const stopRecording = async (): Promise<void> => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    vadStateRef.current = 'IDLE';
    aboveCountRef.current = 0;
    setIsListening(false);
    setCurrentLevel(-160);

    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
      } catch {}
    }
  };

  useEffect(() => {
    if (enabled && Platform.OS !== 'web') {
      startRecording();
    } else {
      stopRecording();
    }
    return () => {
      stopRecording();
    };
  }, [enabled]);

  // Web has no VAD recording path; return idle. AFTER all hooks so hook
  // order stays stable (rules-of-hooks).
  if (Platform.OS === 'web') return { isListening: false, currentLevel: -160 };
  return { isListening, currentLevel };
}
