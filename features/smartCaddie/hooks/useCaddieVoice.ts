/**
 * features/smartCaddie/hooks/useCaddieVoice.ts
 *
 * Caddie voice cue helpers — thin wrappers around VoiceManager.
 *
 * ALL TTS goes through VoiceManager (ElevenLabs). expo-speech is NOT used.
 * VoiceManager handles dedup, priority queuing, and gender settings natively.
 */

import { speak as vmSpeak, stop as vmStop, PRIORITY } from '../../../core/voice/VoiceManager';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Speak text via VoiceManager at AMBIENT priority.
 * Fire-and-forget; safe to call from any component or hook.
 */
export const speak = (text: string): void => {
  void vmSpeak(text, PRIORITY.AMBIENT);
};

/**
 * Stop any caddie voice in progress.
 */
export const stopSpeaking = (): void => {
  vmStop();
};

// ─────────────────────────────────────────────────────────────────────────────
// Preset libraries
// ─────────────────────────────────────────────────────────────────────────────

const SWING_THOUGHTS = [
  'Smooth tempo today. Let the swing happen.',
  'Commit to every shot. No hesitation.',
  'Play your game. Trust your distances.',
  'Stay balanced and finish your swing.',
  "One shot at a time. That's all it takes.",
];

export const speakSwingThought = (): void => {
  const thought = SWING_THOUGHTS[Math.floor(Math.random() * SWING_THOUGHTS.length)];
  void vmSpeak(thought, PRIORITY.AMBIENT);
};

export const speakPressureCue = (): void => {
  void vmSpeak('Stay composed. Play smart here.', PRIORITY.STRATEGY);
};

export const speakHoleChange = (hole: number): void => {
  void vmSpeak(`Hole ${hole}. Let's go.`, PRIORITY.STRATEGY);
};

