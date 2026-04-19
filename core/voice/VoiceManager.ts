/**
 * VoiceManager — centralized voice output facade.
 *
 * ARCHITECTURE
 * ────────────
 *   VoiceManager.speak()
 *       │
 *       ▼
 *   VoiceEngine.speakJob()   ← priority queue, dedup, lock
 *       │
 *       ▼
 *   voiceService.speak()     ← ElevenLabs API + expo-av playback
 *       │
 *       ▼
 *   ElevenLabs TTS           ← ONLY TTS output path
 *
 * RULES
 * ─────
 *   • ALL voice output in the app MUST call VoiceManager.speak().
 *   • Do NOT call expo-speech, expo-av, or voiceService directly.
 *   • Do NOT call VoiceEngine.speakJob() directly outside this file.
 *   • Priority constants are re-exported here so callers never import VoiceEngine.
 *
 * USAGE
 * ─────
 *   import { speak, stop, setGender, PRIORITY } from '../../core/voice/VoiceManager';
 *
 *   await speak('180 yards. 7-iron — commit and stay smooth.');
 *   await speak('Watch the water left.', PRIORITY.STRATEGY);
 *   stop();
 *   setGender('female');
 */

import {
  speakJob,
  cancelAll,
  PRIORITY as _PRIORITY,
  forceStop,
  onStateChange as _onStateChange,
  canSpeak as _canSpeak,
} from '../../services/VoiceEngine';
import {
  setGlobalGender as _setGlobalGender,
  getGlobalGender as _getGlobalGender,
} from '../../services/voiceService';

// ─────────────────────────────────────────────────────────────────────────────
// Re-export priorities so callers don't need to import VoiceEngine directly
// ─────────────────────────────────────────────────────────────────────────────

export const PRIORITY = _PRIORITY as {
  AMBIENT:  number;
  STRATEGY: number;
  SHOT:     number;
  CRITICAL: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Core API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Speak `text` aloud via ElevenLabs.
 *
 * @param text     The message to speak.
 * @param priority One of PRIORITY.AMBIENT | STRATEGY | SHOT | CRITICAL. Defaults to AMBIENT.
 * @param gender   'male' | 'female' | null (uses the global gender setting).
 * @param eventId  Optional dedup key — same eventId is blocked for 15 s.
 * @returns        true if speech started, false if dropped (dedup, lock, etc.)
 */
export async function speak(
  text: string,
  priority: number = _PRIORITY.AMBIENT,
  gender: 'male' | 'female' | null = null,
  eventId: string | null = null,
): Promise<boolean> {
  if (!text?.trim()) return false;
  return speakJob(text, priority, gender, null, eventId);
}

/**
 * Stop all current and queued speech immediately.
 */
export async function stop(): Promise<void> {
  await cancelAll();
}

/**
 * Force-stop with an optional React state setter (for legacy callers).
 */
export async function forceStopVoice(
  setVoiceState?: ((s: string) => void) | null,
): Promise<void> {
  await forceStop(setVoiceState ?? null);
}

/**
 * Set the global TTS gender used when `gender` is not passed to `speak()`.
 */
export function setGender(gender: 'male' | 'female'): void {
  _setGlobalGender(gender);
}

/** Read the current global TTS gender. */
export function getGender(): 'male' | 'female' {
  return _getGlobalGender() as 'male' | 'female';
}

/**
 * Returns true if the given text can be spoken right now
 * (not deduped, not mic-active, not blocked by higher-priority speech).
 */
export function canSpeak(text: string, priority: number = _PRIORITY.AMBIENT): boolean {
  return _canSpeak(text, priority);
}

/**
 * Subscribe to voice-engine state changes: 'idle' | 'speaking' | 'listening'.
 * Returns an unsubscribe function.
 */
export function onStateChange(fn: (state: string) => void): () => void {
  return _onStateChange(fn);
}
