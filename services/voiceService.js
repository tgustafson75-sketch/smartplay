/**
 * voiceService.js — ElevenLabs TTS (fetch-based, global gender)
 *
 * Converts text to speech via ElevenLabs and plays it immediately with expo-av.
 * Uses fetch (not axios) for reliable binary handling in React Native / Hermes.
 * Gender is stored globally so all tabs share the same voice preference.
 *
 * ElevenLabs is the ONLY voice engine — there is no fallback to device TTS.
 * If playback fails, the error is logged and the call returns silently.
 *
 * Usage:
 *   import { speak, setGlobalGender } from '../services/voiceService';
 *   await speak('Take a smooth swing.');        // uses global gender
 *   await speak('Commit to your target.', 'female');  // explicit override
 *   setGlobalGender('female');                  // toggle from any tab
 */

import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ELEVEN_API_KEY_RAW =
  process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ?? '';
const ELEVEN_API_KEY = String(ELEVEN_API_KEY_RAW).replace(/^['"]|['"]$/g, '').trim();

// ElevenLabs keys are either "sk_..." format or a 64-char hex string.
const IS_VALID_API_KEY = ELEVEN_API_KEY.length >= 32;

// Voice IDs — your custom ElevenLabs voices
// If your account cannot access a custom voice, it will fall back to Adam (free pre-made voice)
const VOICES = {
  male:   '1fz2mW1imKTf5Ryjk5su', // Kevin
  female: 'RGb96Dcl0k5eVje8EBch', // Serena
};
// Pre-made ElevenLabs voices available on all plans (fallback)
const FALLBACK_VOICES = {
  male:   'pNInz6obpgDQGcFmaJgB', // Adam
  female: '21m00Tcm4TlvDq8ikWAM', // Rachel
};

// ---------------------------------------------------------------------------
// Global gender state — shared by ALL tabs and screens
// ---------------------------------------------------------------------------
let _globalGender = 'male';

/** Set the active voice gender. Call this from any tab tools toggle. */
export const setGlobalGender = (gender) => {
  _globalGender = gender === 'female' ? 'female' : 'male';
};

/** Read the current global gender. */
export const getGlobalGender = () => _globalGender;

// ---------------------------------------------------------------------------
// Internal playback state
// ---------------------------------------------------------------------------
let _currentSound = null;
let _lastSpokenAt = 0;
let _isSpeaking = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Safe ArrayBuffer -> base64 (Hermes-compatible)
// ---------------------------------------------------------------------------
const arrayBufferToBase64 = (buffer) => {
  const uint8 = new Uint8Array(buffer);
  const chunkSize = 4096;
  let binary = '';
  for (let i = 0; i < uint8.length; i += chunkSize) {
    // Array.from ensures TypedArray spreading works correctly in Hermes
    binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
};

// ---------------------------------------------------------------------------
// speak(text, gender?) — primary entry point
// ---------------------------------------------------------------------------

/**
 * Convert text to speech via ElevenLabs and await playback completion.
 * If gender is omitted, uses the global gender set via setGlobalGender().
 *
 * @param {string} text
 * @param {'male'|'female'} [gender] — optional override; defaults to global gender
 */
export const speak = async (text, gender = null) => {
  if (!text?.trim()) return;

  const activeGender = (gender === 'male' || gender === 'female') ? gender : _globalGender;

  const now = Date.now();
  // 1200ms throttle — prevents dropped messages in fast-fire practice scenarios.
  // Preemption (stop + restart) is handled at the PlayScreenClean layer after the
  // 4s rate-limit window; the 1200ms guard here stops true rapid-fire at the
  // service level regardless of calling layer.
  if (now - _lastSpokenAt < 1200) return;

  try {
    _isSpeaking = true;
    _lastSpokenAt = now;

    // Stop any currently playing audio before starting the new request.
    // Placed AFTER the rate-limit check so rapid-fire calls don't repeatedly
    // stop+start; only calls that pass the gate reach here.
    if (_currentSound) {
      try { await _currentSound.stopAsync(); } catch {}
      try { await _currentSound.unloadAsync(); } catch {}
      _currentSound = null;
    }

    await wait(80);

    const voiceId = VOICES[activeGender] ?? VOICES.male;

    if (!IS_VALID_API_KEY) {
      console.error('[voiceService] No valid ElevenLabs API key. Set EXPO_PUBLIC_ELEVENLABS_API_KEY in .env. Voice disabled.');
      return;
    }

    /**
     * fetchTTS — attempt TTS with the given voice ID.
     * Returns the ArrayBuffer on success, throws on failure.
     */
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
      // Fall back to pre-made voices on ANY HTTP 4xx error (custom voice not on plan, quota exceeded, etc.)
      const httpStatus = primaryErr.status ?? 0;
      if (httpStatus >= 400 || primaryErr.message?.includes('ElevenLabs')) {
        const fallbackId = FALLBACK_VOICES[activeGender] ?? FALLBACK_VOICES.male;
        console.warn(`[voiceService] Custom voice rejected (${primaryErr.message}). Falling back to pre-made voice ${fallbackId}.`);
        try {
          arrayBuffer = await fetchTTS(fallbackId);
        } catch (fallbackErr) {
          console.error('[voiceService] Fallback voice also failed:', fallbackErr?.message ?? fallbackErr);
          return; // Give up silently — no device TTS
        }
      } else {
        throw primaryErr;
      }
    }
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('ElevenLabs returned empty audio buffer');
    }

    const base64Audio = arrayBufferToBase64(arrayBuffer);

    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

    // Write to a temp file — Android cannot play data: URIs via expo-av
    const tmpUri = FileSystem.cacheDirectory + 'caddie_tts_' + Date.now() + '.mp3';
    await FileSystem.writeAsStringAsync(tmpUri, base64Audio, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const sound = new Audio.Sound();
    _currentSound = sound;
    await sound.loadAsync({ uri: tmpUri });
    await sound.playAsync();

    // Await playback completion
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded || status.didJustFinish) finish();
      });
      setTimeout(finish, Math.min(15000, Math.max(2000, text.length * 100)));
    });

  } catch (error) {
    console.error('[voiceService] ElevenLabs error:', error?.message ?? error);
  } finally {
    if (_currentSound) {
      try { await _currentSound.unloadAsync(); } catch {}
      _currentSound = null;
    }
    _isSpeaking = false;
    // Clean up temp audio file
    try {
      const tmpFiles = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory);
      for (const f of tmpFiles) {
        if (f.startsWith('caddie_tts_')) {
          await FileSystem.deleteAsync(FileSystem.cacheDirectory + f, { idempotent: true });
        }
      }
    } catch {}
  }
};

// ---------------------------------------------------------------------------
// stopSpeaking() — interrupt current playback immediately
// ---------------------------------------------------------------------------
export const stopSpeaking = async () => {
  if (_currentSound) {
    try { await _currentSound.stopAsync(); } catch {}
    try { await _currentSound.unloadAsync(); } catch {}
    _currentSound = null;
  }
  _isSpeaking = false;
};

// ---------------------------------------------------------------------------
// Convenience shortcuts
// ---------------------------------------------------------------------------
export const speakMale   = (text) => speak(text, 'male');
export const speakFemale = (text) => speak(text, 'female');
