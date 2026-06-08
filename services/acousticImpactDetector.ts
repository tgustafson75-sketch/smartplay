/**
 * Acoustic impact detector — Phase J.1.
 *
 * Replaces the previous club-typical stub for IMPACT TIMESTAMP detection
 * with a real on-device measurement. Two-peak time-of-arrival ball-speed
 * math is still out of scope (needs raw audio samples; on-device DSP or
 * server-side processing); this module nails the simpler, more useful
 * problem: when did the strike happen?
 *
 * Technique:
 *   - Run a parallel expo-av Audio.Recording during the video capture
 *     with metering enabled.
 *   - Sample the meter (dBFS, loudness floor at -160) every 50 ms.
 *   - After stop, find the LOUDEST sample in the meter array — that's
 *     impact. Return its offset (ms from record start) plus the peak
 *     dB so callers can gate on confidence ("was this loud enough to
 *     actually be a strike, or background noise?").
 *
 * Why parallel recording instead of reading the camera's audio track:
 *   expo-camera v17's recordAsync produces an MP4 with audio, but
 *   exposes no metering or sample access during recording. To get
 *   impact timing on-device we need a separate Audio.Recording running
 *   in parallel. That Recording's file is discarded after metering is
 *   extracted — only the meter time-series is useful here.
 *
 * Calibration / confidence:
 *   peak >= -10 dBFS  → confidence 0.85 (clear strike)
 *   peak >= -20 dBFS  → confidence 0.60 (probable strike)
 *   peak >= -30 dBFS  → confidence 0.30 (faint, possibly miss-strike)
 *   peak  < -30 dBFS  → null (no detectable impact)
 *
 * The dBFS thresholds were picked from typical phone-mic recordings of
 * golf strikes ~6-10 feet from the player. Real-world calibration will
 * tighten these once we have field data.
 */

import { Audio } from 'expo-av';
// 2026-06-08 (audit M1) — serialize audio-mode writes (runs in parallel
// with the camera + can race a TTS mode write).
import { setAudioModeSerial } from './voiceService';
import {
  METER_INTERVAL_MS as CAGE_METER_INTERVAL_MS,
  METER_BUFFER_SAMPLES,
  NOISE_FLOOR_MIN_SAMPLES,
  TRANSIENT_THRESHOLD_DB,
  DECAY_MIN_DB_PER_SAMPLE,
  DEBOUNCE_MS as MULTISHOT_DEBOUNCE_MS,
} from '../constants/cageDetection';

const SINGLESHOT_METERING_INTERVAL_MS = 50;
const MIN_IMPACT_DB = -30; // anything quieter doesn't count
/**
 * Real-time impact threshold for the SINGLE-SHOT onImpactDetected
 * callback. Set looser than MIN_IMPACT_DB so a clear strike fires the
 * callback even when the global-peak detection later picks something
 * slightly louder. Callers use this to auto-stop video N seconds after
 * the strike instead of running the full fixed window.
 */
const REALTIME_IMPACT_THRESHOLD_DB = -15;

export interface ImpactReading {
  /** Offset in ms from the start of the parallel audio recording when
   *  the loudest sample landed. Sync this with the video record-start
   *  to get the impact frame. */
  impact_ms: number;
  /** Peak dBFS at impact. Useful for sanity-checking against background
   *  noise floors and for future ML feature input. */
  peak_db: number;
  /** Confidence 0-1. Derived from peak_db buckets (see header). */
  confidence: number;
  /** Local filesystem URI of the parallel audio recording. Caller can
   *  POST this to /api/acoustic-detect for server-side two-peak speed
   *  detection, or call cleanupImpactRecording(uri) to discard. */
  audio_uri: string | null;
}

export type DetectorMode = 'single-shot' | 'multi-shot';

/** Multi-shot detection event — emitted via onShotDetected. */
export interface ShotDetection {
  /** Offset in ms from recording start when the peak landed. */
  offset_ms: number;
  /** Peak dBFS at the strike sample. */
  peak_db: number;
  /** Drop in dB from peak to the verifying next sample. Higher = sharper
   *  transient (cleaner strike). */
  decay_db: number;
  /** Computed noise floor at the moment of detection (dBFS). */
  noise_floor_db: number;
}

interface RunningRecorder {
  recording: Audio.Recording;
  startedAt: number;
  mode: DetectorMode;
  // Single-shot state ─────────────────────────
  meterSamples: { offset_ms: number; db: number }[];
  metersInterval: ReturnType<typeof setInterval> | null;
  /** Single-shot: fires once when meter crosses REALTIME_IMPACT_THRESHOLD_DB. */
  onImpactDetected: ((offset_ms: number) => void) | null;
  // Multi-shot state ──────────────────────────
  /** Rolling buffer for noise-floor calculation. */
  meterBuffer: number[];
  /** Candidate peak waiting for next-sample verification (multi-shot
   *  uses peak-then-decay validation to reject sustained sound). */
  pendingPeak: { db: number; threshold: number; offset_ms: number; ts: number } | null;
  /** Last accepted detection timestamp — for DEBOUNCE_MS gating. */
  lastDetectionTs: number;
  /** Multi-shot: fires for EVERY validated strike. */
  onShotDetected: ((detection: ShotDetection) => void) | null;
}

let active: RunningRecorder | null = null;

// ─── Global strike event bus ─────────────────────────────────────────────
// Every detection (single-shot real-time impact OR multi-shot validated
// strike) is broadcast through this emitter. Lets passive surfaces
// (dashboards, drill scorers, on-round caddie tips) subscribe without
// owning the recorder. The direct callback parameters on
// startImpactRecording remain the primary path for the surface that
// started the recording — the broadcast is additive, not a replacement.

export interface StrikeEvent {
  /** Which detector mode produced this — single-shot real-time threshold
   *  crossing vs multi-shot validated peak-then-decay. */
  source: 'single-shot' | 'multi-shot';
  /** Offset in ms from the start of the current recording session. */
  offset_ms: number;
  /** Peak dBFS at impact, when available. Null for the single-shot
   *  real-time threshold trigger (we only get the global peak after
   *  stopAndDetectImpact runs). */
  peak_db: number | null;
  timestamp: number;
}

type StrikeListener = (event: StrikeEvent) => void;
const strikeListeners: Set<StrikeListener> = new Set();

/** Subscribe to every strike event from any active recording. Returns an
 *  unsubscribe function. Safe to call from React component effects. */
export function onStrike(listener: StrikeListener): () => void {
  strikeListeners.add(listener);
  return () => { strikeListeners.delete(listener); };
}

function emitStrike(event: StrikeEvent): void {
  for (const l of strikeListeners) {
    try { l(event); } catch (e) { console.log('[acoustic] strike listener threw', e); }
  }
}

/**
 * Start a parallel audio recording with metering. Returns a token used
 * by stopAndDetectImpact(). No-op (returns null) if a recording is
 * already running or permissions aren't granted.
 *
 * Caller is responsible for requesting mic permission BEFORE calling
 * this — the video record path already does that gate in cage-drill,
 * so we don't double-prompt here.
 */
export async function startImpactRecording(opts?: {
  /** Default 'single-shot' — find ONE peak across the recording.
   *  Used by single-swing captures (cage-drill, on-course shot).
   *  'multi-shot' uses noise-floor + decay validation to emit
   *  multiple detection events. Used by cage range sessions. */
  mode?: DetectorMode;
  /** Single-shot only: fires once when meter crosses
   *  REALTIME_IMPACT_THRESHOLD_DB. Use for "auto-stop N seconds
   *  after strike" flows. */
  onImpactDetected?: (offset_ms: number) => void;
  /** Multi-shot only: fires for every validated strike. Use for
   *  range/cage sessions that capture multiple swings per clip. */
  onShotDetected?: (detection: ShotDetection) => void;
}): Promise<boolean> {
  if (active) return false;
  try {
    const perm = await Audio.getPermissionsAsync();
    if (!perm.granted) return false;

    await setAudioModeSerial({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });

    const recording = new Audio.Recording();
    // Force WAV (linear PCM) on both platforms so the server can decode
    // the file in pure JS without ffmpeg. 22050 Hz mono int16 is plenty
    // for peak-pair detection (we don't need music-grade fidelity) and
    // keeps a 12s clip around 530 KB before base64.
    await recording.prepareToRecordAsync({
      android: {
        extension: '.wav',
        outputFormat: Audio.AndroidOutputFormat.DEFAULT,
        audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
        sampleRate: 22050,
        numberOfChannels: 1,
        bitRate: 128000,
      },
      ios: {
        extension: '.wav',
        audioQuality: Audio.IOSAudioQuality.HIGH,
        sampleRate: 22050,
        numberOfChannels: 1,
        bitRate: 128000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: {
        mimeType: 'audio/wav',
        bitsPerSecond: 128000,
      },
      isMeteringEnabled: true,
    });
    await recording.startAsync();

    const startedAt = Date.now();
    const mode: DetectorMode = opts?.mode ?? 'single-shot';
    const state: RunningRecorder = {
      recording,
      startedAt,
      mode,
      // Single-shot state
      meterSamples: [],
      metersInterval: null,
      onImpactDetected: opts?.onImpactDetected ?? null,
      // Multi-shot state
      meterBuffer: [],
      pendingPeak: null,
      lastDetectionTs: 0,
      onShotDetected: opts?.onShotDetected ?? null,
    };

    // Single-shot uses a faster cadence (50ms) for tight strike capture;
    // multi-shot uses the cage detector's tuned 100ms cadence + matching
    // buffer math.
    const intervalMs = mode === 'multi-shot'
      ? CAGE_METER_INTERVAL_MS
      : SINGLESHOT_METERING_INTERVAL_MS;

    state.metersInterval = setInterval(async () => {
      try {
        const status = await recording.getStatusAsync();
        if (!status.isRecording || typeof status.metering !== 'number') return;
        const offset = Date.now() - state.startedAt;
        const db = status.metering;

        if (state.mode === 'single-shot') {
          state.meterSamples.push({ offset_ms: offset, db });
          if (state.onImpactDetected && db >= REALTIME_IMPACT_THRESHOLD_DB) {
            const cb = state.onImpactDetected;
            state.onImpactDetected = null; // one-shot
            try { cb(offset); } catch (e) { console.log('[acoustic] onImpactDetected callback threw', e); }
            emitStrike({ source: 'single-shot', offset_ms: offset, peak_db: db, timestamp: Date.now() });
          }
        } else {
          // ─── Multi-shot pipeline (ported from CageSessionOverlay) ─
          // 1. Verify any pending peak from prior sample. Sharp decay +
          //    not-still-loud = real golf strike. Else reject.
          const pending = state.pendingPeak;
          if (pending) {
            state.pendingPeak = null;
            const decay = pending.db - db;
            const stillAboveThreshold = db > pending.threshold;
            const sharpDecay = decay >= DECAY_MIN_DB_PER_SAMPLE;
            if (sharpDecay && !stillAboveThreshold) {
              const ts = Date.now();
              if (ts - state.lastDetectionTs > MULTISHOT_DEBOUNCE_MS) {
                state.lastDetectionTs = ts;
                const noiseFloor = pending.threshold - TRANSIENT_THRESHOLD_DB;
                if (state.onShotDetected) {
                  try {
                    state.onShotDetected({
                      offset_ms: pending.offset_ms,
                      peak_db: pending.db,
                      decay_db: decay,
                      noise_floor_db: noiseFloor,
                    });
                  } catch (e) {
                    console.log('[acoustic] onShotDetected callback threw', e);
                  }
                }
                emitStrike({
                  source: 'multi-shot',
                  offset_ms: pending.offset_ms,
                  peak_db: pending.db,
                  timestamp: ts,
                });
              }
            }
          }
          // 2. Check current sample for a new candidate. Hold as pending
          //    until next-sample decay verification.
          //
          // 2026-05-28 — Fix FC (Path C, Pass A): per-user calibration.
          // When the user has run the test bench + applied a session
          // as their calibration, use the tuned transientThresholdDb
          // instead of the hardcoded 18dB. Falls back to the constant
          // when no calibration is applied. Live read each tick so a
          // fresh apply takes effect without a session restart.
          if (!state.pendingPeak && state.meterBuffer.length >= NOISE_FLOOR_MIN_SAMPLES) {
            const noiseFloor = state.meterBuffer.reduce((a, b) => a + b, 0) / state.meterBuffer.length;
            let thresholdOffset = TRANSIENT_THRESHOLD_DB;
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const calMod = require('../store/acousticCalibrationStore') as typeof import('../store/acousticCalibrationStore');
              const applied = calMod.useAcousticCalibrationStore.getState().appliedCalibration;
              if (applied && typeof applied.transientThresholdDb === 'number') {
                thresholdOffset = applied.transientThresholdDb;
              }
            } catch { /* ignore — fall back to constant */ }
            const threshold = noiseFloor + thresholdOffset;
            if (db > threshold) {
              state.pendingPeak = { db, threshold, offset_ms: offset, ts: Date.now() };
            }
          }
          // 3. Add current sample to the rolling buffer.
          state.meterBuffer.push(db);
          if (state.meterBuffer.length > METER_BUFFER_SAMPLES) state.meterBuffer.shift();
        }
      } catch {
        // Recording stopped between our setInterval tick and the
        // getStatusAsync call — ignore; the stop path clears the timer.
      }
    }, intervalMs);

    active = state;
    return true;
  } catch (e) {
    console.log('[acoustic] start failed:', e);
    active = null;
    return false;
  }
}

/**
 * Stop the parallel recording and return the detected impact timestamp.
 * Returns null when:
 *   - no recording is active
 *   - no meter samples were captured (rare; usually means a permission
 *     race or a sub-millisecond recording)
 *   - the loudest sample was quieter than MIN_IMPACT_DB
 */
export async function stopAndDetectImpact(): Promise<ImpactReading | null> {
  if (!active) return null;
  const state = active;
  active = null;

  if (state.metersInterval) {
    clearInterval(state.metersInterval);
    state.metersInterval = null;
  }

  try {
    await state.recording.stopAndUnloadAsync();
  } catch {
    // Already stopped or recording threw — proceed with whatever
    // meters we collected.
  }

  // Retain the audio file URI so the caller can POST it to the
  // server-side acoustic detector for two-peak speed analysis.
  // Caller responsible for cleanup via cleanupImpactRecording().
  let audio_uri: string | null = null;
  try {
    audio_uri = state.recording.getURI();
  } catch { /* noop */ }

  if (state.meterSamples.length === 0) {
    // 2026-06-08 (audit) — clean up the temp audio file on the null path;
    // the caller only cleans up when it receives a non-null reading.
    void cleanupImpactRecording(audio_uri);
    return null;
  }

  // Peak detection — single global max. Could be smarter (peak-pair
  // detection for echoes once we add server-side speed math), but for
  // impact-timestamp alone this is exactly right.
  let peak = state.meterSamples[0];
  for (const s of state.meterSamples) {
    if (s.db > peak.db) peak = s;
  }

  if (peak.db < MIN_IMPACT_DB) {
    void cleanupImpactRecording(audio_uri);
    return null;
  }

  const confidence =
    peak.db >= -10 ? 0.85 :
    peak.db >= -20 ? 0.60 :
    0.30;

  const reading: ImpactReading = {
    impact_ms: peak.offset_ms,
    peak_db: peak.db,
    confidence,
    audio_uri,
  };
  // 2026-05-22 — Cache the most-recent reading so other services
  // (acousticsAnalyzer, lieAnalysisService.enrichedLieAnalysis) can
  // opportunistically pull it without the caller having to plumb it
  // through. TTL applied in getLastImpactReading() — stale strikes
  // shouldn't bias unrelated downstream calls.
  _lastReading = { reading, capturedAt: Date.now() };
  return reading;
}

// ─── 2026-05-22 — Recent-impact cache + accessor ─────────────────────────

interface CachedReading { reading: ImpactReading; capturedAt: number }
let _lastReading: CachedReading | null = null;
/** TTL on a cached reading. Beyond this, services that pull
 *  opportunistically (enrichedLieAnalysis) treat it as absent. 60s
 *  matches the typical "swing then read the lie" window. */
const RECENT_IMPACT_TTL_MS = 60_000;

/**
 * Returns the most-recent ImpactReading captured by stopAndDetectImpact()
 * iff it landed within RECENT_IMPACT_TTL_MS. null otherwise (no recent
 * strike OR cache is stale).
 *
 * Used by lieAnalysisService.enrichedLieAnalysis to auto-fold acoustic
 * prior into a lie call without forcing every caller to plumb the
 * reading through.
 */
export function getLastImpactReading(): ImpactReading | null {
  if (!_lastReading) return null;
  if (Date.now() - _lastReading.capturedAt > RECENT_IMPACT_TTL_MS) {
    _lastReading = null;
    return null;
  }
  return _lastReading.reading;
}

/** Clears the cached recent reading. Called by round-end / cage-end
 *  teardown so a stale strike from the prior context can't carry over. */
export function clearLastImpactReading(): void {
  _lastReading = null;
}

/**
 * Multi-shot stop — tears down the parallel recording and returns the
 * audio file URI. Detections were already emitted in real-time via
 * onShotDetected, so this just cleans up. Returns null when nothing
 * was running OR the audio file is missing.
 */
export async function stopMultiShotRecording(): Promise<{ audio_uri: string | null } | null> {
  if (!active) return null;
  const state = active;
  active = null;
  if (state.metersInterval) {
    clearInterval(state.metersInterval);
    state.metersInterval = null;
  }
  try {
    await state.recording.stopAndUnloadAsync();
  } catch { /* noop */ }
  let audio_uri: string | null = null;
  try { audio_uri = state.recording.getURI(); } catch { /* noop */ }
  return { audio_uri };
}

/**
 * Best-effort cleanup of the retained audio file. Call after the
 * server-side speed detection completes (or fails) so the cache
 * directory doesn't fill up.
 */
export async function cleanupImpactRecording(uri: string | null): Promise<void> {
  if (!uri) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FS = require('expo-file-system/legacy');
    await FS.deleteAsync(uri, { idempotent: true });
  } catch { /* noop */ }
}

/**
 * Discard any running recording without computing impact. Use in error
 * paths so we don't leak the AudioRecorder.
 */
export async function abortImpactRecording(): Promise<void> {
  if (!active) return;
  const state = active;
  active = null;
  if (state.metersInterval) {
    clearInterval(state.metersInterval);
    state.metersInterval = null;
  }
  try { await state.recording.stopAndUnloadAsync(); } catch { /* noop */ }
}
