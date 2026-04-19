/**
 * VoiceController.js — Backward-compatible adapter over VoiceEngine
 *
 * All actual voice logic lives in VoiceEngine.js.
 * This module exists solely to preserve the existing import paths used by hooks
 * and screens that were written before VoiceEngine existed.
 *
 * DO NOT add logic here — put it in VoiceEngine.js instead.
 *
 * Public API (unchanged from old VoiceController):
 *   VoiceController.startListening(startSTT, setVoiceState) → Promise<string|null>
 *   VoiceController.stopListening(stopSTT)
 *   VoiceController.speak(text, setVoiceState, gender?)
 *   VoiceController.queueSpeak(text, priority, setVoiceState, gender?)
 *   VoiceController.stopSpeaking(setVoiceState?)
 *   VoiceController.cancel(setVoiceState?)
 *   VoiceController.getState() → { isListening, isSpeaking }
 *   VoiceController.PRIORITY
 */

import {
  speakJob,
  startListening as _engineStartListening,
  stopListening  as _engineStopListening,
  forceStop,
  cancelAll,
  getEngineState,
  PRIORITY,
} from './VoiceEngine';

export { PRIORITY };

export const VoiceController = {

  /** Export priority constants for callers */
  PRIORITY,

  /** Read current voice state snapshot */
  getState() {
    const s = getEngineState();
    return { isListening: s === 'listening', isSpeaking: s === 'speaking' };
  },

  /**
   * startListening(startSTT, setVoiceState)
   *
   * Registers a mic session with VoiceEngine (immediately stops any speech),
   * runs startSTT, then closes the session.
   * Returns transcript string, or null if a session was already active.
   */
  async startListening(startSTT, setVoiceState) {
    // Guard: don't start a new session if we're already listening
    if (getEngineState() === 'listening') return null;

    const endListening = await _engineStartListening(setVoiceState);
    try {
      const transcript = await startSTT();
      return transcript ?? '';
    } catch (e) {
      console.error('[VoiceController] STT error:', e);
      return '';
    } finally {
      endListening();
    }
  },

  /**
   * stopListening(stopSTT)
   *
   * Cancels any active STT session gracefully.
   */
  async stopListening(stopSTT) {
    if (getEngineState() !== 'listening') return;
    _engineStopListening();
    try { if (stopSTT) await stopSTT(); } catch {}
  },

  /**
   * speak(text, setVoiceState, gender?)
   *
   * Direct speech at CRITICAL priority — always preempts lower-priority speech.
   * Used for the full mic → AI response pipeline.
   */
  async speak(text, setVoiceState, gender = null) {
    if (!text?.trim()) {
      setVoiceState?.('IDLE');
      return;
    }
    await speakJob(text, PRIORITY.CRITICAL, gender, setVoiceState);
  },

  /**
   * queueSpeak(text, priority, setVoiceState, gender?)
   *
   * Priority-aware speak request — delegates entirely to VoiceEngine.
   * SHOT/CRITICAL preempts current speech; STRATEGY/AMBIENT drop if busy.
   */
  queueSpeak(text, priority = PRIORITY.AMBIENT, setVoiceState, gender = null) {
    void speakJob(text, priority, gender, setVoiceState);
  },

  /**
   * stopSpeaking(setVoiceState?)
   *
   * Immediately stop any in-progress playback and reset to IDLE.
   */
  async stopSpeaking(setVoiceState) {
    await forceStop(setVoiceState);
  },

  /**
   * cancel(setVoiceState?)
   *
   * Cancel all voice activity — mic, speech, queue. Reset to IDLE.
   */
  cancel(setVoiceState) {
    void cancelAll(setVoiceState);
  },
};

