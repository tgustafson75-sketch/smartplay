/**
 * voiceService.js — ElevenLabs TTS (fetch-based, no filesystem)
 *
 * Playback strategy — no disk writes:
 *   Web   : blob → URL.createObjectURL → Audio.Sound
 *   Native: ArrayBuffer → base64 → data:audio/mpeg;base64,… → Audio.Sound
 *
 * Primary TTS: ElevenLabs. Falls back to expo-speech when no API key is set.
 * Route all calls via core/voice/VoiceManager.ts.
 */

import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ELEVEN_API_KEY_RAW =
  process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ?? '';
const ELEVEN_API_KEY = String(ELEVEN_API_KEY_RAW).replace(/^['"]/,'').replace(/['"]/g,'').trim();

const IS_VALID_API_KEY = ELEVEN_API_KEY.length >= 32;

const VOICES = {
  male:   '1fz2mW1imKTf5Ryjk5su', // Kevin
  female: 'RGb96Dcl0k5eVje8EBch', // Serena
};
const FALLBACK_VOICES = {
  male:   'pNInz6obpgDQGcFmaJgB', // Adam
  female: '21m00Tcm4TlvDq8ikWAM', // Rachel
};

// ---------------------------------------------------------------------------
// Global gender state
// ---------------------------------------------------------------------------
let _globalGender = 'male';

/** Set the active voice gender. Call this from any tab tools toggle. */
export const setGlobalGender = (gender) => {
  _globalGender = gender === 'female' ? 'female' : 'male';
};

/** Read the current global gender. */
export const getGlobalGender = () => _globalGender;

export const configureAudioForSpeech = async () => {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch {}
};

export const configureAudioForRecording = async () => {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
  } catch {}
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------
let _currentSound   = null;
let _isSpeaking     = false;
let _fetchAbortCtrl = null;
let _blobUrl        = null;

export const getIsSpeaking = () => _isSpeaking;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// ArrayBuffer → base64 (Hermes-compatible)
// ---------------------------------------------------------------------------
const arrayBufferToBase64 = (buffer) => {
  const uint8 = new Uint8Array(buffer);
  const chunkSize = 4096;
  let binary = '';
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
};

// ---------------------------------------------------------------------------
// Build audio URI — no file writes
// ---------------------------------------------------------------------------
const buildAudioUri = (arrayBuffer) => {
  if (Platform.OS === 'web' && typeof URL !== 'undefined' && URL.createObjectURL) {
    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    _blobUrl = url;
    return url;
  }
  // Native: data URI loaded directly by expo-av AVPlayer
  const base64 = arrayBufferToBase64(arrayBuffer);
  return `data:audio/mpeg;base64,${base64}`;
};

// ---------------------------------------------------------------------------
// speak(text, gender?) — primary entry point
// ---------------------------------------------------------------------------
export const speak = async (text, gender = null) => {
  if (!text?.trim()) return;

  console.log(`[voiceService] SPEAKING — "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
  const activeGender = (gender === 'male' || gender === 'female') ? gender : _globalGender;

  // Cancel any in-flight fetch
  if (_fetchAbortCtrl) {
    _fetchAbortCtrl.abort();
    _fetchAbortCtrl = null;
  }
  // Revoke previous web blob URL
  if (_blobUrl) {
    try { URL.revokeObjectURL(_blobUrl); } catch {}
    _blobUrl = null;
  }

  try {
    _isSpeaking = true;

    // Stop any currently playing audio
    if (_currentSound) {
      try { await _currentSound.stopAsync(); } catch {}
      try { await _currentSound.unloadAsync(); } catch {}
      _currentSound = null;
    }

    await wait(80);

    const voiceId = VOICES[activeGender] ?? VOICES.male;

    if (!IS_VALID_API_KEY) {
      console.warn('[voiceService] No ElevenLabs key — falling back to system TTS.');
      await new Promise((resolve) => {
        Speech.speak(text, {
          language: 'en-US',
          rate: 0.92,
          pitch: activeGender === 'female' ? 1.1 : 0.9,
          onDone: resolve,
          onError: resolve,
        });
      });
      return;
    }

    const abortCtrl = new AbortController();
    _fetchAbortCtrl = abortCtrl;

    const fetchTTS = async (vid) => {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${vid}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVEN_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability: 0.45,
              similarity_boost: 0.80,
              speed: 1.08,
              use_speaker_boost: true,
            },
          }),
          signal: abortCtrl.signal,
        },
      );
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const errBody = await res.json();
          detail = errBody?.detail?.message ?? errBody?.detail ?? JSON.stringify(errBody);
        } catch {}
        const err = new Error(`ElevenLabs ${res.status}: ${detail}`);
        err.status = res.status;
        throw err;
      }
      return res.arrayBuffer();
    };

    let arrayBuffer;
    try {
      arrayBuffer = await fetchTTS(voiceId);
    } catch (primaryErr) {
      if (primaryErr.name === 'AbortError') return;
      const httpStatus = primaryErr.status ?? 0;
      if (httpStatus >= 400 || primaryErr.message?.includes('ElevenLabs')) {
        console.warn(`[voiceService] Primary voice failed (${primaryErr.message}). Retrying once…`);
        try {
          arrayBuffer = await fetchTTS(voiceId);
        } catch (retryErr) {
          if (retryErr.name === 'AbortError') return;
          const fallbackId = FALLBACK_VOICES[activeGender] ?? FALLBACK_VOICES.male;
          console.warn(`[voiceService] Retry failed. Falling back to pre-made voice ${fallbackId}.`);
          try {
            arrayBuffer = await fetchTTS(fallbackId);
          } catch (fallbackErr) {
            if (fallbackErr.name === 'AbortError') return;
            console.error('[voiceService] All ElevenLabs voices failed:', fallbackErr?.message ?? fallbackErr);
            // Last-resort: device-native TTS via expo-speech so the caddie never
            // goes fully silent. Pitch nudged so female still sounds different
            // than male even on the system voice.
            try {
              await new Promise((resolve) => {
                Speech.speak(text, {
                  language: 'en-US',
                  rate: 0.92,
                  pitch: activeGender === 'female' ? 1.1 : 0.9,
                  onDone: resolve,
                  onError: resolve,
                });
              });
            } catch {/* ignore — already best-effort */}
            return;
          }
        }
      } else {
        throw primaryErr;
      }
    }

    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('ElevenLabs returned empty audio buffer');
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,   // restore A2DP — BT earbuds play at full quality
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,  // route to BT headset / loudspeaker, not earpiece
    });

    const audioUri = buildAudioUri(arrayBuffer);
    const sound = new Audio.Sound();
    _currentSound = sound;

    try {
      await sound.loadAsync({ uri: audioUri });
      await sound.playAsync();

      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded || status.didJustFinish) finish();
        });
        setTimeout(finish, Math.min(15000, Math.max(2000, text.length * 100)));
      });
    } catch (avErr) {
      // expo-av failed to play audio — silent fail (ElevenLabs is the only output path)
      console.warn('[voiceService] expo-av playback failed:', avErr?.message ?? avErr);
    }

    console.log('[voiceService] VOICE DONE');

  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.log('[ELEVEN ERROR]', error?.message ?? error);
  } finally {
    _fetchAbortCtrl = null;
    if (_currentSound) {
      try { await _currentSound.unloadAsync(); } catch {}
      _currentSound = null;
    }
    if (_blobUrl) {
      try { URL.revokeObjectURL(_blobUrl); } catch {}
      _blobUrl = null;
    }
    _isSpeaking = false;
  }
};

// ---------------------------------------------------------------------------
// stopSpeaking() — interrupt current playback
// ---------------------------------------------------------------------------
export const stopSpeaking = async () => {
  if (_fetchAbortCtrl) {
    _fetchAbortCtrl.abort();
    _fetchAbortCtrl = null;
  }
  if (_currentSound) {
    try { await _currentSound.stopAsync(); } catch {}
    try { await _currentSound.unloadAsync(); } catch {}
    _currentSound = null;
  }
  if (_blobUrl) {
    try { URL.revokeObjectURL(_blobUrl); } catch {}
    _blobUrl = null;
  }
  _isSpeaking = false;
};

// ---------------------------------------------------------------------------
// Convenience shortcuts
// ---------------------------------------------------------------------------
export const speakMale   = (text) => {
  // DISABLED: legacy voice output (migrated to V2)
  // return speak(text, 'male');
  return undefined;
};
export const speakFemale = (text) => {
  // DISABLED: legacy voice output (migrated to V2)
  // return speak(text, 'female');
  return undefined;
};
