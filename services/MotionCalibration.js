/**
 * MotionCalibration.js
 *
 * Phone-based motion calibration for swing detection.
 *
 * RESPONSIBILITIES:
 *   1. Capture a 2-second baseline of stable sensor data and store as
 *      the device's "resting" orientation.
 *   2. Provide detectSwingMotion() to identify a swing impulse in a
 *      stream of accelerometer readings.
 *   3. Implement a simple 5-sample moving-average smoothing filter to
 *      eliminate micro-movements and pocket bumps.
 *   4. Expose low/high thresholds that VisionProcessor and practicescreen
 *      can read to gate processing.
 *
 * LOW POWER COMPATIBILITY:
 *   Call setLowPowerSampling(true) to reduce Accelerometer update interval
 *   from 50 ms to 200 ms while preserving calibration accuracy.
 *
 * FUTURE WATCH:
 *   WatchMotionBridge.js expects the same MotionSample shape; no changes
 *   needed here to support BLE / companion data.
 */

import { Accelerometer, Gyroscope } from 'expo-sensors';

// ─── Constants ────────────────────────────────────────────────────────────────

const CALIBRATION_DURATION_MS  = 2000;   // capture window for baseline
const SMOOTHING_WINDOW          = 5;      // number of samples to average
const DEFAULT_LOW_THRESHOLD     = 0.15;  // ignore micro-movement below this G
const DEFAULT_HIGH_THRESHOLD    = 2.2;   // swing impulse above this G
const NORMAL_INTERVAL_MS        = 50;    // 20 Hz — active mode
const LOW_POWER_INTERVAL_MS     = 200;   // 5 Hz — battery-save mode

// ─── Module state ─────────────────────────────────────────────────────────────

const _state = {
  baseline:            { x: 0, y: 0, z: 0 },  // resting orientation
  isCalibrated:        false,
  lowPower:            false,
  lowMotionThreshold:  DEFAULT_LOW_THRESHOLD,
  highMotionThreshold: DEFAULT_HIGH_THRESHOLD,
  smoothingBuffer:     [],  // last N magnitude readings
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function magnitude({ x, y, z }) {
  return Math.sqrt(x * x + y * y + z * z);
}

function addToBuffer(buf, value, maxLen) {
  buf.push(value);
  if (buf.length > maxLen) buf.shift();
}

function bufferAverage(buf) {
  if (!buf.length) return 0;
  return buf.reduce((a, b) => a + b, 0) / buf.length;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enable or disable low-power sampling rate.
 * @param {boolean} enabled
 */
export function setLowPowerSampling(enabled) {
  _state.lowPower = !!enabled;
  const interval  = enabled ? LOW_POWER_INTERVAL_MS : NORMAL_INTERVAL_MS;
  Accelerometer.setUpdateInterval(interval);
  Gyroscope.setUpdateInterval(interval);
}

/**
 * Override the motion thresholds.
 * Useful for clubs with very different swing speeds (e.g. putter vs driver).
 *
 * @param {number} low   - G-force below which readings are treated as noise
 * @param {number} high  - G-force above which a swing is registered
 */
export function setMotionThresholds(low, high) {
  _state.lowMotionThreshold  = low;
  _state.highMotionThreshold = high;
}

/** Returns current thresholds */
export function getMotionThresholds() {
  return {
    low:  _state.lowMotionThreshold,
    high: _state.highMotionThreshold,
  };
}

/** Whether calibration has been completed. */
export function isCalibrated() {
  return _state.isCalibrated;
}

/** Returns the stored baseline orientation */
export function getBaseline() {
  return { ..._state.baseline };
}

/**
 * Capture 2 seconds of still sensor data and compute the baseline
 * (average resting acceleration).
 *
 * Resolves with { success, baseline } — success false if no samples received.
 *
 * @returns {Promise<{ success: boolean, baseline: { x, y, z } }>}
 */
export function calibrateMotion() {
  return new Promise((resolve) => {
    const samples = [];
    Accelerometer.setUpdateInterval(NORMAL_INTERVAL_MS);

    const sub = Accelerometer.addListener((data) => {
      samples.push(data);
    });

    setTimeout(() => {
      sub.remove();
      if (samples.length === 0) {
        resolve({ success: false, baseline: _state.baseline });
        return;
      }
      const avgX = samples.reduce((s, d) => s + d.x, 0) / samples.length;
      const avgY = samples.reduce((s, d) => s + d.y, 0) / samples.length;
      const avgZ = samples.reduce((s, d) => s + d.z, 0) / samples.length;

      _state.baseline     = { x: avgX, y: avgY, z: avgZ };
      _state.isCalibrated = true;
      // Clear stale smoothing data after recalibration
      _state.smoothingBuffer = [];

      // Restore preferred sampling rate
      if (_state.lowPower) {
        Accelerometer.setUpdateInterval(LOW_POWER_INTERVAL_MS);
      }

      resolve({ success: true, baseline: _state.baseline });
    }, CALIBRATION_DURATION_MS);
  });
}

/**
 * Analyse a single accelerometer sample and return a swing assessment.
 *
 * Applies:
 *   1. Baseline subtraction (removes gravity offset)
 *   2. 5-sample moving-average smoothing
 *   3. Low / high threshold gating
 *
 * @param {{ x: number, y: number, z: number }} sample  - raw accelerometer reading
 * @returns {{
 *   smoothedG:    number,    - smoothed G-force magnitude
 *   rawG:         number,    - unsmoothed magnitude
 *   isSwing:      boolean,   - true when smoothedG >= highMotionThreshold
 *   isNoise:      boolean,   - true when smoothedG < lowMotionThreshold
 *   lateralBias:  'left' | 'right' | 'neutral',
 * }}
 */
export function detectSwingMotion(sample) {
  // Subtract baseline to isolate dynamic acceleration
  const adjusted = {
    x: sample.x - _state.baseline.x,
    y: sample.y - _state.baseline.y,
    z: sample.z - _state.baseline.z,
  };

  const rawG = magnitude(adjusted);

  // Smoothing
  addToBuffer(_state.smoothingBuffer, rawG, SMOOTHING_WINDOW);
  const smoothedG = bufferAverage(_state.smoothingBuffer);

  const isSwing = smoothedG >= _state.highMotionThreshold;
  const isNoise = smoothedG < _state.lowMotionThreshold;

  // Lateral X-axis bias — informs left/right shot tendency
  const lateralBias =
    adjusted.x >  0.35 ? 'right' :
    adjusted.x < -0.35 ? 'left'  : 'neutral';

  return { smoothedG, rawG, isSwing, isNoise, lateralBias };
}

/**
 * Reset calibration state (e.g. when switching clubs or users).
 */
export function resetCalibration() {
  _state.baseline      = { x: 0, y: 0, z: 0 };
  _state.isCalibrated  = false;
  _state.smoothingBuffer = [];
}
