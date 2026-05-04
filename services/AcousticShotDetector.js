/**
 * AcousticShotDetector.js
 *
 * Listens to the microphone during cage / range sessions and fires a callback
 * whenever it detects an impact transient above the configured threshold.
 *
 * Impact classification:
 *   'net'   — loud transient (≥ CAGE_NET_THRESHOLD)  → ball hit the net / bullseye
 *   'clean' — medium transient (≥ IMPACT_THRESHOLD)  → clean contact, ball in flight
 *   'miss'  — never fired from here; caller handles the no-sound timeout
 *
 * Gracefully degrades: all errors are caught; the detector stays silent rather
 * than crashing the app.
 */

import { Audio } from 'expo-av';
import { configureAudioForSpeech, getIsSpeaking } from './voiceService';

// ── Thresholds (dBFS, range –160 → 0) ────────────────────────────────────────
const IMPACT_DB      = -32;  // normalized: ~0.45 of full-scale → clean contact
const CAGE_NET_DB    = -22;  // normalized: ~0.63 → loud net impact

const COOLDOWN_MS    = 1500; // ignore further impacts within this window

// ── Module-level state ────────────────────────────────────────────────────────
let _recording      = null;
let _intervalId     = null;
let _isListening    = false;
let _lastImpact     = 0;
let _callback       = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start listening for impact transients.
 *
 * @param {(type: 'clean' | 'net') => void} onImpact
 * @returns {Promise<boolean>} true if recording started, false if permission
 *   was denied or another error prevented startup. Callers should branch
 *   their UI toggle on this so the user is told the mic is off.
 */
export const startAcousticDetection = async (onImpact) => {
  if (_isListening) return true;

  try {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) return false;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS:  true,
      playsInSilentModeIOS: true,
    });

    _callback  = onImpact;
    _recording = new Audio.Recording();

    await _recording.prepareToRecordAsync({
      ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    });

    await _recording.startAsync();
    _isListening = true;

    // Poll metering every 80 ms — fast enough to catch a clean ball strike
    _intervalId = setInterval(async () => {
      if (!_recording || !_isListening) return;
      // TTS self-trigger guard: if the caddie is speaking, the phone speaker
      // is loud enough to clip the mic and produce a false 'impact'. Skip
      // and reset the cooldown clock so we don't fire as soon as TTS ends.
      if (getIsSpeaking()) {
        _lastImpact = Date.now();
        return;
      }
      try {
        const status = await _recording.getStatusAsync();
        if (!status.isRecording) return;

        const now    = Date.now();
        const dbfs   = typeof status.metering === 'number' ? status.metering : -160;

        if (now - _lastImpact < COOLDOWN_MS) return;

        if (dbfs >= CAGE_NET_DB) {
          _lastImpact = now;
          _callback?.('net');
        } else if (dbfs >= IMPACT_DB) {
          _lastImpact = now;
          _callback?.('clean');
        }
      } catch { /* ignore transient read errors */ }
    }, 80);

    return true;
  } catch (e) {
    console.warn('[AcousticShotDetector] Failed to start:', e?.message ?? e);
    _isListening = false;
    return false;
  }
};

/**
 * Stop the acoustic detector and release the microphone.
 */
export const stopAcousticDetection = async () => {
  if (!_isListening) return;

  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }

  if (_recording) {
    try { await _recording.stopAndUnloadAsync(); } catch { /* ignore */ }
    _recording = null;
  }

  // Restore the speech audio mode so subsequent TTS doesn't get stuck
  // playing through the iOS earpiece at low volume.
  try { await configureAudioForSpeech(); } catch { /* ignore */ }

  _isListening = false;
  _callback    = null;
};

/**
 * Returns true when the detector is actively listening.
 */
export const isAcousticListening = () => _isListening;
