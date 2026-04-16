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

import { speak, stopSpeaking, getIsSpeaking } from './voiceService';
import { setListening as viSetListening } from './VoiceIntelligence';

// ── Singleton flags ───────────────────────────────────────────────────────────
let _isListening  = false;
let _isSpeaking   = false;  // local mirror — updated in sync with voiceService
let _aborted      = false;
// Session counter — increments on every new startListening() call.
// speak() captures the session ID at call-time and only sets IDLE if
// no newer session has started by the time finally{} runs.
let _sessionId    = 0;

// ── Priority queue ────────────────────────────────────────────────────────────
// Holds { text, priority, setVoiceState, gender } entries.
// When speak() is called while already speaking, higher-priority items preempt;
// lower-priority items are dropped so they never stack.
let _queue = [];
let _isProcessingQueue = false;

const PRIORITY = { CRITICAL: 4, SHOT: 3, STRATEGY: 2, AMBIENT: 1 };

const _processQueue = async () => {
  if (_isProcessingQueue) return;
  _isProcessingQueue = true;
  while (_queue.length > 0) {
    const item = _queue.shift();
    if (!item) continue;
    await VoiceController.speak(item.text, item.setVoiceState, item.gender);
  }
  _isProcessingQueue = false;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const VoiceController = {

  /** Export priority constants for callers */
  PRIORITY,

  /** Returns a snapshot of the current singleton flags (reads voiceService for _isSpeaking) */
  getState() {
    return { isListening: _isListening, isSpeaking: getIsSpeaking() };
  },

  /**
   * startListening(startSTT, setVoiceState)
   *
   * Starts the STT layer and sets global state to LISTENING.
   * Returns the transcript string when STT resolves.
   * Guards against double-start and concurrent speech.
   */
  async startListening(startSTT, setVoiceState) {
    // If voiceService is actively speaking, kill it first so we don't overlap
    if (getIsSpeaking()) {
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
   * Uses voiceService.getIsSpeaking() as the single source of truth.
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

    // If voiceService is already playing, stop it before starting new audio
    if (getIsSpeaking()) {
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
   * queueSpeak(text, priority, setVoiceState, gender?)
   *
   * Priority-aware speak request.
   * CRITICAL (4) / SHOT (3): preempts current speech and clears queue.
   * STRATEGY (2) / AMBIENT (1): dropped if something is already speaking or queued.
   */
  queueSpeak(text, priority = PRIORITY.AMBIENT, setVoiceState, gender = null) {
    if (!text?.trim()) return;

    if (priority >= PRIORITY.SHOT && (getIsSpeaking() || _queue.length > 0)) {
      // High-priority: abort current + clear stale queue, then jump to front
      _queue = [];
      void stopSpeaking();
    } else if (getIsSpeaking() || _queue.length > 0) {
      // Low-priority: drop the request — don't stack
      console.log(`[VoiceController] queueSpeak dropped (priority ${priority}) — already speaking`);
      return;
    }

    _queue.push({ text, priority, setVoiceState, gender });
    void _processQueue();
  },

  /**
   * stopSpeaking(setVoiceState)
   *
   * Immediately stop any in-progress ElevenLabs playback and reset to IDLE.
   */
  async stopSpeaking(setVoiceState) {
    _aborted     = true;
    _isSpeaking  = false;
    _isListening = false;
    _queue       = [];
    try { await stopSpeaking(); } catch {}
    if (setVoiceState) setVoiceState('IDLE');
  },

  /** Called by any UI cancel button — resets everything cleanly */
  cancel(setVoiceState) {
    _aborted     = true;
    _isSpeaking  = false;
    _isListening = false;
    _queue       = [];
    _sessionId += 1; // Invalidate any pending speak() finally blocks
    viSetListening(false);
    try { stopSpeaking(); } catch {}
    if (setVoiceState) setVoiceState('IDLE');
    console.log('[VoiceController] CANCELLED → IDLE');
  },
};
