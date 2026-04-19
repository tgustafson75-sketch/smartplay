/**
 * sttService.js — Speech-to-text service
 *
 * Uses expo-camera's microphone recording + OpenAI Whisper for transcription.
 * Falls back to a contextual prompt if recording/Whisper is unavailable.
 *
 * The window is capped at 5 seconds — resolves early if silence detected.
 * All state mutations go through the callback so the UI stays reactive.
 */

import { Audio } from 'expo-av';

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_DURATION_MS     = 4000;  // absolute cap — stops after 4s regardless
const SILENCE_WINDOW_MS   = 800;   // stop early if audio power stays below threshold
const SILENCE_THRESHOLD_DB = -45;  // dBFS level considered silence

let _timeoutRef        = null;
let _resolveRef        = null;
let _recording         = null;  // expo-av Audio.Recording instance
let _silenceTimerRef   = null;  // early-stop on sustained silence
let _lastLoudTimestamp = null;  // tracks when audio last exceeded threshold

/**
 * startSTT(setTranscript, audioRecordingRef?)
 *
 * @param {(text: string) => void} setTranscript  — callback to push partial + final transcript
 * @param {React.MutableRefObject} audioRecordingRef — optional ref holding an active Audio.Recording
 * @returns {Promise<string>} resolved transcript
 */
export async function startSTT(setTranscript, audioRecordingRef = null) {
  // Guard: if a session is already running, resolve immediately with empty string
  // so the caller's VoiceController.startListening guard handles it cleanly.
  if (_resolveRef !== null) {
    console.warn('[sttService] startSTT called while already active — ignoring double-start');
    return '';
  }

  console.log('[sttService] STT START');
  return new Promise(async (resolve) => {
    _resolveRef = resolve;

    // If we have an active recording ref from a screen, use it — otherwise start our own
    if (audioRecordingRef?.current) {
      _recording = audioRecordingRef.current;
    } else {
      try {
        // Request mic permissions
        const { granted } = await Audio.requestPermissionsAsync();
        if (granted) {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            shouldDuckAndroid: true,
            // false = route to BT headset or loudspeaker, not the phone earpiece
            playThroughEarpieceAndroid: false,
          });
          const { recording } = await Audio.Recording.createAsync(
            {
              ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
              isMeteringEnabled: true,
            },
          );
          _recording = recording;
          console.log('[sttService] Recording started');
        } else {
          console.warn('[sttService] Microphone permission denied');
        }
      } catch (recErr) {
        console.error('[sttService] Failed to start recording:', recErr?.message ?? recErr);
      }
    }

    // Safety timeout — absolute failsafe, stops after MAX_DURATION_MS
    _timeoutRef = setTimeout(async () => {
      _clearSilenceTimer();
      const text = await _finalizeRecording(audioRecordingRef);
      setTranscript(text);
      console.log(`[sttService] STT RESULT (timeout): "${text || '(empty)'}"`);
      _resolveRef?.(text);
      _resolveRef = null;
    }, MAX_DURATION_MS);

    // Silence detection — poll recording metering; stop early if quiet for SILENCE_WINDOW_MS
    _lastLoudTimestamp = Date.now();
    if (_recording) {
      try {
        await _recording.setProgressUpdateIntervalAsync(100);
        _recording.setOnRecordingStatusUpdate((status) => {
          if (!_resolveRef) return;
          const db = status?.metering ?? -160;
          if (db > SILENCE_THRESHOLD_DB) {
            _lastLoudTimestamp = Date.now();
          } else if (_lastLoudTimestamp && Date.now() - _lastLoudTimestamp >= SILENCE_WINDOW_MS) {
            // Silence detected for long enough — stop early
            console.log('[sttService] Silence detected — stopping early');
            _clearSilenceTimer();
            _earlyStop(setTranscript, audioRecordingRef);
          }
        });
      } catch {
        // metering not supported on this device — fall through to timeout only
      }
    }
  });
}

function _clearSilenceTimer() {
  if (_silenceTimerRef) {
    clearTimeout(_silenceTimerRef);
    _silenceTimerRef = null;
  }
}

async function _earlyStop(setTranscript, audioRecordingRef) {
  if (!_resolveRef) return;
  if (_timeoutRef) {
    clearTimeout(_timeoutRef);
    _timeoutRef = null;
  }
  const text = await _finalizeRecording(audioRecordingRef);
  if (setTranscript) setTranscript(text);
  console.log(`[sttService] STT RESULT (silence): "${text || '(empty)'}"`);
  _resolveRef?.(text);
  _resolveRef = null;
}

/**
 * stopSTT(setTranscript, audioRecordingRef?)
 *
 * Called when the user taps Cancel or the silence window closes.
 * Cancels the timer and finalizes the recording immediately.
 */
export async function stopSTT(setTranscript, audioRecordingRef = null) {
  console.log('[sttService] STT STOP');
  _clearSilenceTimer();
  if (_timeoutRef) {
    clearTimeout(_timeoutRef);
    _timeoutRef = null;
  }

  if (_resolveRef) {
    const text = await _finalizeRecording(audioRecordingRef);
    if (setTranscript) setTranscript(text);
    console.log(`[sttService] STT RESULT (early stop): "${text || '(empty)'}"`);
    _resolveRef(text);
    _resolveRef = null;
  }
}

// ---------------------------------------------------------------------------
// Internal: stop + transcribe recording
// ---------------------------------------------------------------------------
async function _finalizeRecording(audioRecordingRef) {
  const rec = audioRecordingRef?.current ?? _recording;
  _recording = null;

  if (!rec) {
    // No real recording — return empty (caller will use local AI fallback)
    return '';
  }

  try {
    await rec.stopAndUnloadAsync();

    // Reset audio mode back to playback — critical for Bluetooth earbuds.
    // When recording, iOS routes audio through the built-in mic and can lock
    // the BT session to SCO (low-quality). Resetting here restores the A2DP
    // (high-quality) route so the caddie response plays through earbuds.
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        // Restore A2DP profile so BT earbuds receive the caddie response at full quality
        playThroughEarpieceAndroid: false,
      });
    } catch {}

    const uri = rec.getURI();
    if (!uri) return '';

    // If no OpenAI key, we can't transcribe — return empty
    if (!OPENAI_KEY || OPENAI_KEY.length < 20) return '';

    const form = new FormData();
    form.append('file', { uri, name: 'voice.m4a', type: 'audio/m4a' });
    form.append('model', 'whisper-1');
    form.append('language', 'en');

    const res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    });

    if (!res.ok) return '';
    const json = await res.json();
    return (json.text ?? '').trim().toLowerCase();
  } catch {
    return '';
  } finally {
    // Temp recording URI is managed by expo-av and cleaned up automatically
    if (rec) {
      try { rec.getURI?.(); } catch {} // no-op, just ensure no crash
    }
  }
}
