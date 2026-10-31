import { useEffect, useRef, useState } from 'react';
import { Platform, Alert } from 'react-native';
import { Audio } from 'expo-av';
// 2026-06-08 (audit M1) — route audio-mode writes through the serial queue
// so an Auto-Listen mic restart can't race a TTS playback mode write and
// flip routing / silent-mode mid-utterance.
import { setAudioModeSerial, registerExternalMicCheck, registerExternalMicRelease, registerUtteranceEndpoint, type MicReleaseVerdict } from '../services/voiceService';
import { getSessionState, isSessionInFlight } from '../services/listeningSession';
import { isSmartMotionActive, isSmartMotionRecording } from '../services/smartMotionRecordBus';
import { createSpeechOnsetGate } from '../services/voice/speechOnset';

// ─── TUNABLE CONSTANTS ────────────────────
// Phase AB — SILENCE_DURATION_MS bumped from 1500 → 2800. Natural
// conversational pauses (thinking, breathing, mid-sentence ellipses)
// regularly hit 1.5–2.5s; the prior cap finalised the recording on
// every pause and submitted partial utterances, leaving Kevin stumped.
// 2.8s leaves enough room for thought without making "I'm done" obvious.

// The speech bar and ambient floor live in services/voice/speechOnset (pure, tested).
export { SPEECH_THRESHOLD_DB } from '../services/voice/speechOnset';
export const SILENCE_DURATION_MS   = 2800;
export const MIN_SPEECH_DURATION_MS = 500;
/**
 * 2026-10-28 (recheck VC-R2-2) — an utterance this long is finished whether or not the room went
 * quiet (wind, a cart engine, a TV in the clubhouse). Same cap the Caddie tab's own tap capture uses,
 * so a held noise cannot keep the avatar on 'listening' for the rest of the visit.
 */
export const MAX_UTTERANCE_MS = 18_000;

// 2026-06-16 (Tim — voice sensitivity in background noise) — the bar rides a live ambient floor.
// 2026-10-20 (practice bay) — floor seeded from the room, and a strike from the next bay no longer
// opens the mic: see services/voice/speechOnset.

// ─── TYPES ────────────────────────────────

type VADState = 'IDLE' | 'SPEAKING' | 'TRAILING';

interface UseVoiceActivityDetectionOptions {
  enabled: boolean;
  onSpeechStart: () => void;
  onSpeechEnd: (audioUri: string) => void;
  /**
   * A turn onSpeechStart announced will not reach onSpeechEnd: too short to be a word, or the mic was
   * stopped or handed to a session mid-utterance. The caller undoes what onSpeechStart did.
   */
  onSpeechAbandoned?: () => void;
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
  onSpeechAbandoned,
}: UseVoiceActivityDetectionOptions): UseVoiceActivityDetectionResult {
  const [isListening, setIsListening] = useState(false);
  /**
   * 2026-08-14 (Tim: "there's something you're doing with the microphone that's fucking this up").
   * He was right, and this was it.
   *
   * This was React state written from setOnRecordingStatusUpdate at a 100ms progress interval — TEN
   * state updates per second, forever, for as long as the mic is open. Every one of them re-rendered
   * the Caddie screen, which carries the avatar, the data strip and the yardage memos. The result is
   * a UI that paints but cannot keep up with a touch, a yardage badge that never settles, and a hot
   * mic the whole time.
   *
   * Nothing consumes it. The single call site destructures `isListening` only, so ten renders a
   * second were being spent publishing a number no one reads. A ref carries it now; the returned
   * shape is unchanged for any future consumer, which would want it throttled rather than per-frame.
   */
  const currentLevelRef = useRef(-160);

  const recordingRef    = useRef<Audio.Recording | null>(null);
  const vadStateRef     = useRef<VADState>('IDLE');
  const speakStartRef   = useRef<number>(0);
  const silenceStartRef = useRef<number>(0);
  const onsetGateRef    = useRef(createSpeechOnsetGate());

  // Use refs for callbacks to avoid stale closures in the status handler
  const onSpeechStartRef = useRef(onSpeechStart);
  const onSpeechEndRef   = useRef(onSpeechEnd);
  useEffect(() => { onSpeechStartRef.current = onSpeechStart; }, [onSpeechStart]);
  useEffect(() => { onSpeechEndRef.current   = onSpeechEnd;   }, [onSpeechEnd]);
  const onSpeechAbandonedRef = useRef(onSpeechAbandoned);
  useEffect(() => { onSpeechAbandonedRef.current = onSpeechAbandoned; }, [onSpeechAbandoned]);
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
    // 2026-07-06 (voice-parity F1) — call-time hard guard: the VAD recorder
    // self-restarts each cycle (finishRecording→startRecording), so even if the
    // caddie-tab gate didn't re-render when SmartMotion took over, this catches
    // the camera owning the mic on the next cycle. No phantom recorder under it.
    if (isSmartMotionActive() || isSmartMotionRecording()) return;
    // 2026-10-28 (recheck VC-R2-2) — and the same for a listening session (badge, bottom bar,
    // earbud): it owns the mic from the tap. The caddie-tab gate re-renders a beat later; this
    // catches the self-restart in finishRecording landing in that gap.
    if (isSessionInFlight() || getSessionState() !== 'idle') return;
    startingRef.current = true;
    const myToken = stopTokenRef.current;
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        // 2026-06-11 (audit) — flip the toggle OFF so it stops lying. Before
        // this, a denied mic left Auto-Listen showing ON while nothing was
        // listening — the user thought the caddie was hearing them. Turning it
        // off makes the UI reflect reality; they re-enable after granting.
        // 2026-09-13 — through the one owner: a denied mic makes BOTH halves impossible, and
        // flipping autoListen alone left continuousConversationMode saying "keep the mic open
        // between turns" on a device that just refused the mic. [[two-owners-is-the-root-cause]]
        try { require('../services/caddiePresence').applyListening(false); } catch { /* noop */ }
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
        currentLevelRef.current = db;

        const { above: isAbove, onset } = onsetGateRef.current.push(db);

        const now = Date.now();
        const state = vadStateRef.current;

        if (state === 'IDLE') {
          // A held sound over the room's bar → SPEAKING (a dying strike transient does not count)
          if (onset) {
            vadStateRef.current = 'SPEAKING';
            speakStartRef.current = now;
            onSpeechStartRef.current();
          }
        } else if (now - speakStartRef.current >= MAX_UTTERANCE_MS) {
          vadStateRef.current = 'IDLE';
          finishRecording();
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
              finishRecording();
            } else if (silenceDuration >= SILENCE_DURATION_MS) {
              // A cough or a click — too short to be a word. It used to sit in TRAILING until the
              // next sound, with the caller still showing 'listening'. Drop it and keep waiting.
              vadStateRef.current = 'IDLE';
              discardAndRestart();
            }
          }
        }
      });

      recordingRef.current = recording;
      vadStateRef.current  = 'IDLE';
      onsetGateRef.current.reset();
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
      currentLevelRef.current = -160;
    }
  };

  /** Throw the clip away (the turn onSpeechStart announced is not happening) and listen again. */
  const discardAndRestart = async (): Promise<void> => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    onsetGateRef.current.reset();
    try { onSpeechAbandonedRef.current?.(); } catch { /* caller's state only */ }
    if (rec) {
      try { await rec.stopAndUnloadAsync(); } catch { /* noop */ }
    }
    if (enabledRef.current) startRecording();
    else setIsListening(false);
  };

  const stopRecording = async (): Promise<void> => {
    stopTokenRef.current += 1; // cancel any startRecording in flight (audit)
    const rec = recordingRef.current;
    recordingRef.current = null;
    // A turn cut off here never reaches onSpeechEnd — tell the caller, or its 'listening' sticks.
    const midUtterance = vadStateRef.current !== 'IDLE';
    vadStateRef.current = 'IDLE';
    if (midUtterance) {
      try { onSpeechAbandonedRef.current?.(); } catch { /* caller's state only */ }
    }
    onsetGateRef.current.reset();
    setIsListening(false);
    currentLevelRef.current = -160;

    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
      } catch {}
    }
  };

  /**
   * 2026-10-28 (recheck VC-R2-2) — JOIN THE MICROPHONE-OWNER REGISTRY. This recorder held the mic for
   * the whole round and was in neither set, so a badge / bottom-bar / earbud turn could neither see it
   * nor take the mic back: its capture died on "Only one Recording object" (bail 'error', the retry,
   * then the mic-trouble line). It reports itself as a holder only while it has heard a human — the
   * idle wait is not a turn, and reporting it would hush every proactive line for the round. The
   * release always runs (voiceService asks every owner) and, like the tap path's, submits a capture
   * that heard the player rather than binning his words.
   */
  useEffect(() => {
    const leaveCheck = registerExternalMicCheck(() => recordingRef.current !== null && vadStateRef.current !== 'IDLE');
    const endUtterance = async (): Promise<MicReleaseVerdict> => {
      if (!recordingRef.current && !startingRef.current) return 'none';
      const heard = recordingRef.current !== null && vadStateRef.current !== 'IDLE'
        && Date.now() - speakStartRef.current >= MIN_SPEECH_DURATION_MS;
      if (heard) {
        vadStateRef.current = 'IDLE';
        await finishRecording();   // its restart is refused while the session holds the mic
        return 'submitted';
      }
      await stopRecording();
      return 'discarded';
    };
    const leaveRelease = registerExternalMicRelease(endUtterance);
    // 2026-10-31 (caddie-home CAD-HOME-2) — a badge or earbud tap is this utterance's endpoint (toggle()).
    const leaveEndpoint = registerUtteranceEndpoint(endUtterance);
    return () => { leaveCheck(); leaveRelease(); leaveEndpoint(); };
  }, []);

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
  return { isListening, currentLevel: currentLevelRef.current };
}
