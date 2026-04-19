/**
 * safeVoice — silent wrappers for all TTS / voice calls.
 *
 * Voice failures (TTS engine crash, network timeout, permission denied)
 * must NEVER crash the app or interrupt a round.  Every call here:
 *   1. Returns a Promise that always resolves (never rejects)
 *   2. Logs the failure in DEV only
 *   3. Is a no-op on error — the player simply hears nothing
 *
 * Usage:
 *   import { safeSpeak, safeVoiceSpeak, safeSpeakJob } from './safeVoice';
 *   await safeSpeak('10 yards to the pin');
 */

/** Generic async voice call that swallows all errors */
async function silently<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (__DEV__) console.warn(`[safeVoice] ${label} failed silently:`, err);
    return null;
  }
}

// ── Wrappers ────────────────────────────────────────────────────────────────

/**
 * Safe wrapper for the `speak` hook function from useVoiceCaddie.
 * Pass your `speak` reference in; returns a function with the same signature.
 */
export function makeSafeSpeak(
  speak: (text: string, style?: string) => Promise<void>
): (text: string, style?: string) => Promise<void> {
  return (text, style) => silently('speak', () => speak(text, style ?? 'calm')) as Promise<void>;
}

/**
 * Safe wrapper for voiceSpeak (ElevenLabs / local TTS).
 */
export function makeSafeVoiceSpeak(
  voiceSpeak: (text: string, style?: string) => Promise<void>
): (text: string, style?: string) => Promise<void> {
  return (text, style) => silently('voiceSpeak', () => voiceSpeak(text, style ?? 'calm')) as Promise<void>;
}

/**
 * Safe wrapper for speakJob (VoiceEngine priority queue).
 */
export function makeSafeSpeakJob(
  speakJob: (text: string, priority?: number, gender?: string) => Promise<void>
): (text: string, priority?: number, gender?: string) => Promise<void> {
  return (text, priority, gender) =>
    silently('speakJob', () => speakJob(text, priority, gender)) as Promise<void>;
}

/**
 * Standalone safe speak that can be used without a hook reference.
 * Returns true if spoken, false if it failed silently.
 */
export async function safeCall<T>(
  label: string,
  fn: () => Promise<T>,
  fallback?: T
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (__DEV__) console.warn(`[safeCall] ${label}:`, err);
    return fallback;
  }
}
