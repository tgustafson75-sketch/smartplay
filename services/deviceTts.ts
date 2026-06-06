/**
 * 2026-06-05 — Device-local TTS fallback (expo-speech wrapper).
 *
 * Last-resort speech path when:
 *   - OpenAI TTS (/api/voice) is unreachable AND
 *   - the persona cache has no entry for this text.
 *
 * Plays the EXACT text the brain produces (greeting, response, follow-up)
 * using the device's built-in TTS engine (iOS AVSpeechSynthesizer,
 * Android TextToSpeech). The voice is the system default — not the
 * persona's OpenAI voice — but the WORDS are correct and context-aware,
 * which is what Tim asked for ("logical Caddie feedback with context")
 * instead of silence or a wrong-content bundled mp3.
 *
 * CRITICAL — DEFENSIVE LOADING:
 *
 * This module is shipped via OTA to APKs that may NOT have the expo-
 * speech native module bundled (current production APK doesn't include
 * it; only the next APK build will). All access to the native module
 * MUST go through dynamic require + try/catch. If the module isn't
 * present, isAvailable() returns false and speakDevice() resolves
 * immediately with played=false — the caller then knows to fall back
 * further (bundled mp3 / silent caption-only).
 *
 * This means CURRENT APK testers who get this OTA WILL NOT crash —
 * they just continue to use the existing bundled-mp3 last-resort path.
 * NEW APK testers get the upgraded path with device-TTS as the
 * second-to-last-resort speaking the brain's actual text.
 */

import { logVoiceSilentFail } from './voiceErrorLog';

type SpeechOptions = {
  language?: string;
  rate?: number;
  pitch?: number;
  voice?: string;
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (err: Error) => void;
};

type SpeechModule = {
  speak: (text: string, options?: SpeechOptions) => void;
  stop: () => Promise<void>;
  isSpeakingAsync: () => Promise<boolean>;
  // getAvailableVoicesAsync exists too but we don't need it for fallback —
  // system default voice is fine; we just need words spoken.
};

let cachedModule: SpeechModule | null = null;
let probeAttempted = false;

function getModule(): SpeechModule | null {
  if (probeAttempted) return cachedModule;
  probeAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech') as SpeechModule;
    // Validate the shape — typeof check guards against partial installs
    // or stub modules from RN's module map.
    if (typeof mod?.speak === 'function' && typeof mod?.stop === 'function') {
      cachedModule = mod;
      console.log('[deviceTts] expo-speech available');
    } else {
      console.log('[deviceTts] expo-speech shape unexpected — treating as unavailable');
    }
  } catch (e) {
    // Module not bundled (current APK) or native side missing — expected
    // on the current production APK. Silent log, no error surface.
    console.log('[deviceTts] expo-speech not available:', e instanceof Error ? e.message : String(e));
  }
  return cachedModule;
}

/** True iff expo-speech is loadable. Cheap; cached after first call. */
export function isDeviceTtsAvailable(): boolean {
  return getModule() !== null;
}

type DeviceTtsOpts = {
  /** ISO code: 'en' / 'es' / 'zh'. Mapped to a device-supported tag. */
  language?: 'en' | 'es' | 'zh';
  /** Persona — used to pick a rate/pitch tweak that approximates the
   *  caddie's character on system voice. Tank speaks faster + lower
   *  pitch; Serena slower + neutral; Harry slower + lower; Kevin neutral. */
  persona?: 'kevin' | 'serena' | 'tank' | 'harry' | string | null;
};

const LANG_TAG: Record<'en' | 'es' | 'zh', string> = {
  en: 'en-US',
  es: 'es-US',
  zh: 'zh-CN',
};

const PERSONA_TUNING: Record<string, { rate: number; pitch: number }> = {
  kevin:  { rate: 1.05, pitch: 1.00 },
  serena: { rate: 1.00, pitch: 1.05 },
  tank:   { rate: 1.15, pitch: 0.90 },
  harry:  { rate: 0.95, pitch: 0.90 },
};

/**
 * Speak text via the device's built-in TTS engine. Resolves to true if
 * the engine completed the utterance, false if the module isn't loaded
 * or the engine errored. Always resolves (never rejects) — callers
 * shouldn't have to wrap.
 */
export function speakDevice(text: string, opts?: DeviceTtsOpts): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const mod = getModule();
    if (!mod) {
      resolve(false);
      return;
    }
    if (!text || typeof text !== 'string') {
      resolve(false);
      return;
    }
    const lang = opts?.language ?? 'en';
    const tuning = opts?.persona ? PERSONA_TUNING[opts.persona] ?? PERSONA_TUNING.kevin : PERSONA_TUNING.kevin;
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      mod.speak(text, {
        language: LANG_TAG[lang],
        rate: tuning.rate,
        pitch: tuning.pitch,
        onDone: () => finish(true),
        onStopped: () => finish(false),
        onError: (e) => {
          console.log('[deviceTts] engine error:', e?.message);
          logVoiceSilentFail('device_tts_engine_error', { error: e?.message ?? String(e), textHead: text.slice(0, 60) });
          finish(false);
        },
      });
    } catch (e) {
      console.log('[deviceTts] speak threw:', e);
      logVoiceSilentFail('device_tts_speak_threw', { error: e instanceof Error ? e.message : String(e), textHead: text.slice(0, 60) });
      finish(false);
    }
    // Safety net: if neither onDone / onError fires (some Android TTS
    // engines silently no-op), resolve false after a generous cap so
    // the caller can move on instead of hanging the greeting.
    // 18 words/sec average system TTS × ~3s of caddie line × 1.5 buffer.
    setTimeout(() => finish(false), Math.max(8000, text.length * 70));
  });
}

/** Stop any in-flight device TTS. Idempotent. Safe to call when unavailable. */
export async function stopDeviceTts(): Promise<void> {
  const mod = getModule();
  if (!mod) return;
  try {
    await mod.stop();
  } catch (e) {
    console.log('[deviceTts] stop error (non-fatal):', e);
  }
}
