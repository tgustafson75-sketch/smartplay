import { useEffect, useRef, useState } from 'react';
import { Platform, Alert } from 'react-native';
import { Audio } from 'expo-av';
// 2026-06-08 (audit M1) — route audio-mode writes through the serial queue
// so an Auto-Listen mic restart can't race a TTS playback mode write and
// flip routing / silent-mode mid-utterance.
import { setAudioModeSerial } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';

// ─── TUNABLE CONSTANTS ────────────────────
// Phase AB — SILENCE_DURATION_MS bumped from 1500 → 2800. Natural
// conversational pauses (thinking, breathing, mid-sentence ellipses)
// regularly hit 1.5–2.5s; the prior cap finalised the recording on
// every pause and submitted partial utterances, leaving Kevin stumped.
// 2.8s leaves enough room for thought without making "I'm done" obvious.

export const SPEECH_THRESHOLD_DB   = -40;
export const SILENCE_DURATION_MS   = 2800;
export const MIN_SPEECH_DURATION_MS = 500;

// 2026-06-16 (Tim — voice sensitivity in background noise) — same adaptive
// ambient floor as captureUtterance (services/voiceService.ts). A fixed -40 dB
// bar treats any room louder than ~-40 ambient as perpetual speech, so the VAD
// never endpoints. We lift the speech bar relative to the live ambient floor,
// clamped to SPEECH_THRESHOLD_DB so a quiet room is unchanged.
const NOISE_FLOOR_INIT_DB = -50;
const NOISE_FLOOR_MIN_DB = -60;
const NOISE_FLOOR_FALL_ALPHA = 0.15;
const NOISE_FLOOR_RISE_ALPHA = 0.02;
const SPEECH_MARGIN_DB = 14;

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
  const noiseFloorRef   = useRef<number>(NOISE_FLOOR_INIT_DB);

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
  // 2026-06-14 (audit — lifecycle races) — guard concurrent starts (the
  // finishRecording→startRecording restart racing a manual start) and give
  // stopRecording a cancel token so a start in flight when stop/disable lands
  // doesn't end up owning the mic with a second, orphaned recorder.
  const startingRef = useRef(false);
  const stopTokenRef = useRef(0);

  const startRecording = async (): Promise<void> => {
    if (startingRef.current || recordingRef.current) return;
    startingRef.current = true;
    const myToken = stopTokenRef.current;
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        // 2026-06-11 (audit) — flip the toggle OFF so it stops lying. Before
        // this, a denied mic left Auto-Listen showing ON while nothing was
        // listening — the user thought the caddie was hearing them. Turning it
        // off makes the UI reflect reality; they re-enable after granting.
        try { useSettingsStore.getState().setAutoListenEnabled(false); } catch { /* noop */ }
        Alert.alert(
          'Microphone Required',
          'Auto-Listen needs microphone access. Enable it in Settings, then turn Auto-Listen back on.',
        );
        return;
      }

      await setAudioModeSerial({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const { recording } = await Audio.Recording.createAsync(VAD_RECORDING_OPTIONS);
      // A stop()/disable landed while we were acquiring the recorder → don't keep
      // the mic. Unload this one and bail so we never run two recorders. (audit)
      if (stopTokenRef.current !== myToken || !enabledRef.current) {
        try { await recording.stopAndUnloadAsync(); } catch { /* noop */ }
        setIsListening(false);
        return;
      }
      recording.setProgressUpdateInterval(100);
      recording.setOnRecordingStatusUpdate((status) => {
        if (!status.isRecording) return;

        const db = status.metering ?? -160;
        setCurrentLevel(db);

        // Adaptive ambient floor: fall fast toward quiet, rise slowly so speech
        // doesn't inflate it; clamp the input so a dropout can't crash the floor.
        const m = Math.max(db, NOISE_FLOOR_MIN_DB);
        const a = m < noiseFloorRef.current ? NOISE_FLOOR_FALL_ALPHA : NOISE_FLOOR_RISE_ALPHA;
        noiseFloorRef.current += (m - noiseFloorRef.current) * a;
        const effThresholdDb = Math.max(SPEECH_THRESHOLD_DB, noiseFloorRef.current + SPEECH_MARGIN_DB);

        const now = Date.now();
        const state = vadStateRef.current;
        const isAbove = db > effThresholdDb;

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
      noiseFloorRef.current = NOISE_FLOOR_INIT_DB;
      setIsListening(true);
    } catch (err) {
      console.log('[VAD] startRecording error:', err);
      setIsListening(false);
    } finally {
      startingRef.current = false;
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
    stopTokenRef.current += 1; // cancel any startRecording in flight (audit)
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
