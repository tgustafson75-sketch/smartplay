/**
 * services/onDeviceSTT.ts — Phase B of the offline-degrade build.
 *
 * On-device (offline) speech-to-text via expo-speech-recognition (iOS
 * SFSpeechRecognizer / Android SpeechRecognizer). This is the missing piece that
 * makes the offline caddie work hands-free: when the network can't be reached,
 * Deepgram STT (/api/transcribe) is dead, so until now there was no transcript
 * for the on-device brain ([[offline-caddie-plan]] services/offlineCaddie) to act
 * on. This recognizes speech with ZERO network, on the device's own model.
 *
 * GUARDED BY DESIGN: the native module does NOT exist in a binary built before
 * this dependency was added. A static `import` would call requireNativeModule()
 * at load and CRASH voice on every current OTA install. So we dynamic-require it
 * inside try/catch and report "not present" when it's absent — the OTA is a safe
 * no-op until the next native build ships the module. Same pattern as
 * withMediaPipePose / [[meta-glasses-live-sdk-plan]].
 *
 * Platform support (graceful-degrade everywhere else):
 *   - On-device recognition: Android 13+ (needs the language model installed) and
 *     iOS 17+. minSdk here is 29, so older Androids report unsupported and the
 *     caller falls back to the typed offline path (A2). [[voice-one-voice-invariant]]:
 *     the caller must ensure nothing else holds the mic while this runs.
 */

import { Platform } from 'react-native';

export type STTLanguage = 'en' | 'es' | 'zh';

const LANG_TAG: Record<STTLanguage, string> = {
  en: 'en-US',
  es: 'es-ES',
  zh: 'zh-CN',
};

// Minimal shape of the bits we use — kept local so nothing imports the package
// statically (which would defeat the runtime guard).
interface ResultEvent {
  results?: { transcript?: string }[];
  isFinal?: boolean;
}
interface Subscription { remove: () => void }
interface STTModule {
  start: (options: Record<string, unknown>) => void;
  stop: () => void;
  abort: () => void;
  addListener: (event: string, cb: (e: never) => void) => Subscription;
  isRecognitionAvailable: () => boolean;
  supportsOnDeviceRecognition: () => boolean;
  getPermissionsAsync?: () => Promise<{ granted?: boolean }>;
}

// Dynamic, guarded load. Absent native module → module stays null → all calls
// report unavailable and the caller degrades to the typed fallback.
let mod: { ExpoSpeechRecognitionModule?: STTModule } | null = null;
try {
  mod = require('expo-speech-recognition');
} catch {
  mod = null;
}

function getModule(): STTModule | null {
  const m = mod?.ExpoSpeechRecognitionModule;
  return m && typeof m.start === 'function' ? m : null;
}

/**
 * Is on-device STT usable on THIS binary + device right now? True only when the
 * native module is present AND the platform reports recognition + on-device
 * support. Cheap + synchronous — safe to gate UI/flow on.
 */
export function isOnDeviceSTTReady(): boolean {
  const m = getModule();
  if (!m) return false;
  try {
    if (m.isRecognitionAvailable() !== true) return false;
    // On-device specifically (offline). iOS 17+/Android 13+ return true.
    return m.supportsOnDeviceRecognition() === true;
  } catch {
    return false;
  }
}

/**
 * 2026-10-15 (review) — IS SPEECH RECOGNITION ALREADY ALLOWED? Never asks.
 *
 * recognizeOnceOnDevice used to call requestPermissionsAsync, and nothing else in the app requests
 * speech-recognition permission. So the first time this offline path ran on iOS, the player got a
 * surprise system "Allow Speech Recognition?" dialog in the middle of a round, at the exact moment
 * the network had gone — no context, no purpose string the player had seen before. That is the
 * request-in-context problem App Review rejected 1.0 for (5.1.1, 2026-09-16).
 *
 * So this path only runs where the permission is ALREADY granted (Android grants it with the mic;
 * on iOS it stays off until a deliberate, explained ask exists). Anything unknown — no native
 * module, an older API without getPermissionsAsync, a throw — counts as not granted: a missing
 * offline transcript degrades to the normal offline reply, while a surprise dialog cannot be undone.
 */
export async function hasOnDeviceSTTPermission(): Promise<boolean> {
  const m = getModule();
  if (!m || typeof m.getPermissionsAsync !== 'function') return false;
  try {
    const perm = await m.getPermissionsAsync();
    return perm?.granted === true;
  } catch {
    return false;
  }
}

/**
 * Run ONE on-device recognition session and resolve the final transcript, or
 * null on no-speech / error / unavailable. Zero network. Bounded by timeoutMs so
 * it can never hang the voice flow. The caller owns mic coordination — nothing
 * else may be recording/playing when this starts ([[voice-one-voice-invariant]]).
 */
export async function recognizeOnceOnDevice(
  language: STTLanguage = 'en',
  opts: { timeoutMs?: number } = {},
): Promise<string | null> {
  const m = getModule();
  if (!m) return null;
  const timeoutMs = opts.timeoutMs ?? 9000;

  // 2026-10-15 (review) — READ the permission, never REQUEST it. See hasOnDeviceSTTPermission.
  if (!(await hasOnDeviceSTTPermission())) return null;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let best = '';
    const subs: Subscription[] = [];

    const cleanup = () => {
      for (const s of subs) { try { s.remove(); } catch { /* noop */ } }
      try { clearTimeout(timer); } catch { /* noop */ }
    };
    const finish = (text: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { m.stop(); } catch { /* noop */ }
      const trimmed = (text ?? '').trim();
      resolve(trimmed ? trimmed : null);
    };

    const timer = setTimeout(() => finish(best || null), timeoutMs);

    try {
      subs.push(m.addListener('result', (e: never) => {
        const ev = e as ResultEvent;
        const t = ev?.results?.[0]?.transcript ?? '';
        if (t) best = t;
        if (ev?.isFinal) finish(best || null);
      }));
      subs.push(m.addListener('end', () => finish(best || null)));
      subs.push(m.addListener('error', () => finish(best || null)));

      m.start({
        lang: LANG_TAG[language] ?? 'en-US',
        interimResults: true,
        continuous: false,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        // iOS native audio session is owned by voiceService; let it manage that.
        ...(Platform.OS === 'ios' ? { iosTaskHint: 'dictation' } : {}),
      });
    } catch {
      finish(null);
    }
  });
}
