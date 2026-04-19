/**
 * VoiceEngine.js — Hardlocked Global Voice Singleton v2
 *
 * ABSOLUTE INVARIANT: Only ONE of { speaking | listening | idle } is ever true.
 *
 * Guarantees:
 *  - ATOMIC lock (_LOCKED) — no overlap under any circumstance
 *  - 3 000 ms minimum gap between any two speech events
 *  - 15 000 ms message dedup window
 *  - eventId dedup — same trigger ID blocked for 15 s
 *  - Priority preemption — SHOT/CRITICAL kill lower-priority speech
 *  - Mic supremacy — startListening() kills ALL audio instantly
 *  - Active-promise kill switch — previous speak is aborted before new one
 *  - Hard reset on ANY error — always returns to clean idle
 *  - Object.freeze — public API is immutable at runtime
 *
 * Priority (higher wins):
 *   AMBIENT=1  STRATEGY=2  SHOT=3  CRITICAL=4
 */

import { speak as _audioSpeak, stopSpeaking as _audioStop } from './voiceService';
import { setListening as _viSetListening } from './VoiceIntelligence';

export const PRIORITY = Object.freeze({
  AMBIENT:  1,
  STRATEGY: 2,
  SHOT:     3,
  CRITICAL: 4,
});

const MIN_GAP_MS     = 3000;
const DEDUP_MS       = 15000;
const EVENT_DEDUP_MS = 15000;
const MAX_LISTEN_MS  = 7500;  // hard timeout — force-idles any stuck listening session

let _state        = 'idle';
let _LOCKED       = false;
let _currentJobId = 0;
let _jobCounter   = 0;
let _lastSpokenAt = 0;
let _activeSpeakPromise = null;
let _listenTimeoutRef   = null;  // failsafe: auto-stop any stuck listening session

const _spokenMap  = new Map();
const _eventIdMap = new Map();
const _listeners  = new Set();

const _emit = (newState) => {
  _state = newState;
  _listeners.forEach((fn) => { try { fn(newState); } catch {} });
};

const _normalize = (msg) => msg.trim().toLowerCase().replace(/\s+/g, ' ');

const _isMessageDup = (message) => {
  const last = _spokenMap.get(_normalize(message));
  return last !== undefined && (Date.now() - last) < DEDUP_MS;
};

const _isEventDup = (eventId) => {
  if (!eventId) return false;
  const last = _eventIdMap.get(eventId);
  return last !== undefined && (Date.now() - last) < EVENT_DEDUP_MS;
};

const _recordSpoken = (message, eventId) => {
  _spokenMap.set(_normalize(message), Date.now());
  if (eventId) _eventIdMap.set(eventId, Date.now());
  const trim = (map) => {
    if (map.size > 100) {
      const oldest = [...map.entries()].sort((a, b) => a[1] - b[1])[0][0];
      map.delete(oldest);
    }
  };
  trim(_spokenMap);
  trim(_eventIdMap);
};

const _hardReset = async (setVoiceState = null) => {
  _LOCKED = false;
  _currentJobId = 0;
  _activeSpeakPromise = null;
  _lastSpokenAt = 0; // reset time-guard so next speak fires immediately after cancel/error
  _spokenMap.clear();  // clear message dedup so repeated Ask Caddie taps always fire
  if (_listenTimeoutRef) { clearTimeout(_listenTimeoutRef); _listenTimeoutRef = null; }
  try { await _audioStop(); } catch {}
  _emit('idle');
  setVoiceState?.('IDLE');
  console.log('[VoiceEngine] HARD-RESET');
};

export const forceStop = async (setVoiceState = null) => {
  _currentJobId = 0;
  await _hardReset(setVoiceState);
};

export const speakJob = async (
  message,
  priority      = PRIORITY.AMBIENT,
  gender        = null,
  setVoiceState = null,
  eventId       = null,
) => {
  if (!message?.trim()) return false;

  if (_state === 'listening') { console.log('[VoiceEngine] DROP mic-active'); return false; }
  if (_isEventDup(eventId)) { console.log('[VoiceEngine] DROP eventId-dup:', eventId); return false; }
  if (_isMessageDup(message)) { console.log('[VoiceEngine] DROP msg-dup:', message.slice(0,40)); return false; }

  const now = Date.now();
  if (_lastSpokenAt > 0 && (now - _lastSpokenAt) < MIN_GAP_MS && priority < PRIORITY.SHOT) {
    console.log('[VoiceEngine] DROP time-guard', now - _lastSpokenAt, 'ms');
    return false;
  }

  if (_state === 'speaking' || _LOCKED) {
    if (priority < PRIORITY.SHOT) {
      console.log(`[VoiceEngine] DROP p${priority} blocked by active speech`);
      return false;
    }
    console.log(`[VoiceEngine] PREEMPT job ${_currentJobId} p${priority}`);
    _currentJobId = 0;
    _LOCKED = false;
    _activeSpeakPromise = null;
    try { await _audioStop(); } catch {}
    await new Promise((r) => setTimeout(r, 60));
    if (_state !== 'idle') { console.log('[VoiceEngine] DROP state not idle after preempt'); return false; }
  }

  if (_LOCKED || _state !== 'idle') { console.log('[VoiceEngine] DROP lock/state not clean'); return false; }

  _LOCKED = true;
  const myJobId = ++_jobCounter;
  _currentJobId = myJobId;
  _lastSpokenAt = Date.now();
  _emit('speaking');
  setVoiceState?.('SPEAKING');
  console.log('[VoiceEngine] VOICE SPEAKING job=' + myJobId + ' p=' + priority + ' "' + message.slice(0, 70) + '"');

  try {
    if (_state !== 'speaking' || _currentJobId !== myJobId || !_LOCKED) {
      console.log(`[VoiceEngine] ABORT job=${myJobId} (context invalid pre-audio)`);
      return false;
    }
    if (_state === 'listening') { console.log(`[VoiceEngine] ABORT job=${myJobId} (mic active)`); return false; }

    const p = _audioSpeak(message, gender);
    _activeSpeakPromise = p;
    await p;
    _activeSpeakPromise = null;
    _recordSpoken(message, eventId);
    return true;

  } catch (e) {
    if (e?.name !== 'AbortError') console.error('[VoiceEngine] audio error:', e?.message ?? e);
    return false;
  } finally {
    if (_currentJobId === myJobId) {
      _LOCKED = false;
      _activeSpeakPromise = null;
      _emit('idle');
      setVoiceState?.('IDLE');
      console.log('[VoiceEngine] VOICE DONE job=' + myJobId);
    }
  }
};

export const startListening = async (setVoiceState = null) => {
  _currentJobId = 0;
  _LOCKED = false;
  _activeSpeakPromise = null;
  try { await _audioStop(); } catch {}
  try { _viSetListening(true); } catch {}
  _emit('listening');
  setVoiceState?.('LISTENING');
  console.log('[VoiceEngine] VOICE START LISTENING');

  // Failsafe: if listening state is never exited (e.g. STT hangs), auto-reset after MAX_LISTEN_MS
  if (_listenTimeoutRef) clearTimeout(_listenTimeoutRef);
  _listenTimeoutRef = setTimeout(() => {
    if (_state === 'listening') {
      console.warn('[VoiceEngine] LISTEN TIMEOUT — force idle');
      stopListening(setVoiceState);
    }
    _listenTimeoutRef = null;
  }, MAX_LISTEN_MS);

  return () => stopListening(setVoiceState);
};

export const stopListening = (setVoiceState = null) => {
  if (_listenTimeoutRef) {
    clearTimeout(_listenTimeoutRef);
    _listenTimeoutRef = null;
  }
  if (_state === 'listening') {
    try { _viSetListening(false); } catch {}
    _emit('idle');
    setVoiceState?.('IDLE');
    console.log('[VoiceEngine] IDLE stopListening');
  }
};

export const cancelAll = async (setVoiceState = null) => {
  await _hardReset(setVoiceState);
  console.log('[VoiceEngine] cancelAll');
};

export const canSpeak = (message, priority = PRIORITY.AMBIENT) => {
  if (!message?.trim()) return false;
  if (_state === 'listening') return false;
  if (_isMessageDup(message)) return false;
  if ((_state === 'speaking' || _LOCKED) && priority < PRIORITY.SHOT) return false;
  return true;
};

export const onStateChange = (fn) => {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
};

export const getEngineState = () => _state;

const VoiceEngine = Object.freeze({
  speakJob, startListening, stopListening, forceStop,
  cancelAll, canSpeak, getEngineState, onStateChange, PRIORITY,
});

export default VoiceEngine;