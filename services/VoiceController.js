/**
 * VoiceController.js — Global voice pipeline singleton
 *
 * Enforces the ONLY legal voice flow in the entire app:
 *   IDLE → LISTENING → PROCESSING → SPEAKING → IDLE
 *
 * Rules:
 *   - Only one pipeline active at a time (mutual exclusion)
 *   - Starting a new listen call while speaking stops the current speech first
 *   - All state transitions go through setVoiceState (→ voiceStore → all UIs update)
 *   - Never call speak() or STT from UI directly — always use VoiceController
 */

import { speak, stopSpeaking } from './voiceService';
import { setListening as viSetListening } from './VoiceIntelligence';

// ── Singleton flags ───────────────────────────────────────────────────────────
let _isListening = false;
let _isSpeaking  = false;
let _aborted     = false;
// Session counter — increments on every new startListening() call.
// speak() captures the session ID at call-time and only sets IDLE if
// no newer session has started by the time finally{} runs.
let _sessionId   = 0;

// ── Internal helpers ──────────────────────────────────────────────────────────
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const VoiceController = {

  /** Returns a snapshot of the current singleton flags */
  getState() {
    return { isListening: _isListening, isSpeaking: _isSpeaking };
  },

  /**
   * startListening(startSTT, setVoiceState)
   *
   * Starts the STT layer and sets global state to LISTENING.
   * Returns the transcript string when STT resolves.
   * Guards against double-start and concurrent speech.
   */
  async startListening(startSTT, setVoiceState) {
    // If already speaking, kill it first so we don't overlap
    if (_isSpeaking) {
      await this.stopSpeaking(setVoiceState);
      await wait(100);
    }

    if (_isListening) return null;

    _isListening = true;
    _aborted     = false;
    _sessionId   += 1;
    const sessionId = _sessionId;
    viSetListening(true);  // suppress auto-speech while mic is open
    setVoiceState('LISTENING');
    console.log(`[VoiceController] LISTENING (session ${sessionId})`);

    try {
      const transcript = await startSTT();
      return transcript ?? '';
    } catch (e) {
      console.error('[VoiceController] STT error:', e);
      return '';
    } finally {
      _isListening = false;
      viSetListening(false);  // re-enable auto-speech
    }
  },

  /**
   * stopListening(stopSTT)
   *
   * Cancels any active STT session gracefully.
   */
  async stopListening(stopSTT) {
    if (!_isListening) return;
    _isListening = false;
    _aborted = true;
    try {
      if (stopSTT) await stopSTT();
    } catch {}
  },

  /**
   * speak(text, setVoiceState, gender?)
   *
   * Runs the SPEAKING phase. Shows the text in the overlay, plays ElevenLabs
   * audio, then returns to IDLE.
   * Guards against double-speak via _isSpeaking flag.
   */
  async speak(text, setVoiceState, gender = null) {
    if (!text?.trim()) {
      setVoiceState('IDLE');
      return;
    }

    // Stop any active listening before speaking
    if (_isListening) {
      _isListening = false;
      _aborted = true;
    }

    if (_isSpeaking) {
      try { await stopSpeaking(); } catch {}
      await wait(80);
    }

    // Capture session at speak-start so stale finally blocks don't overwrite state
    const speakSession = _sessionId;
    _isSpeaking = true;
    setVoiceState('SPEAKING');
    console.log(`[VoiceController] SPEAKING (session ${speakSession})`);

    try {
      await speak(text, gender);
    } catch (e) {
      console.error('[VoiceController] speak error:', e);
    } finally {
      _isSpeaking = false;
      // Only reset to IDLE if no newer session has started since we began speaking
      if (!_aborted && _sessionId === speakSession) {
        setVoiceState('IDLE');
        console.log(`[VoiceController] IDLE (session ${speakSession})`);
      }
    }
  },

  /**
   * stopSpeaking(setVoiceState)
   *
   * Immediately stop any in-progress ElevenLabs playback and reset to IDLE.
   */
  async stopSpeaking(setVoiceState) {
    _aborted = true;
    _isSpeaking = false;
    _isListening = false;
    try { await stopSpeaking(); } catch {}
    if (setVoiceState) setVoiceState('IDLE');
  },

  /** Called by any UI cancel button — resets everything cleanly */
  cancel(setVoiceState) {
    _aborted = true;
    _isSpeaking = false;
    _isListening = false;
    _sessionId += 1; // Invalidate any pending speak() finally blocks
    viSetListening(false);
    try { stopSpeaking(); } catch {}
    if (setVoiceState) setVoiceState('IDLE');
    console.log('[VoiceController] CANCELLED → IDLE');
  },
};
