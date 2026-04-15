/**
 * VisionProcessor.js
 *
 * Processes video frames for ball detection.
 *
 * Battery-efficiency features:
 *   - Frame stride: only every Nth frame is processed (default 3 in normal
 *     mode, 6 in low-power mode) — skipped frames return the previous result.
 *   - Idle pause: processing is suspended after IDLE_TIMEOUT_MS of no new
 *     frames; resumes automatically on the next processFrame() call.
 *   - Low-power toggle: doubles the stride and halves the confidence floor,
 *     reducing CPU load at the cost of slightly lower accuracy.
 *
 * Current detection implementation: deterministic mock (see TODO below).
 *
 * TODO: Replace processFrame core with a real CV pipeline, e.g.:
 *   - expo-camera frame processor + VisionCamera runAtTargetFps
 *   - TensorFlow Lite object-detection model via react-native-fast-tflite
 *   - OpenCV via @technekey/react-native-opencv or a native module
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const MOCK_CONFIDENCE_MIN  = 0.35;
const MOCK_CONFIDENCE_MAX  = 0.97;

/** How many ms without a new frame before the processor enters idle. */
const IDLE_TIMEOUT_MS = 3000;

// ─── Module-level processor state ─────────────────────────────────────────────

const _state = {
  lowPower:       false,   // low-power mode flag
  burst:          false,   // active-shot burst mode (stride = 1)
  burstTimer:     null,    // auto-expire handle for burst mode
  paused:         false,   // true while idle
  frameCounter:   0,       // increments on every processFrame() call
  lastFrameTime:  0,       // timestamp of the most recent processFrame() call
  idleTimer:      null,    // setTimeout handle for idle transition
  lastResult:     null,    // cached result returned for skipped frames
};

/**
 * Stride: process 1-in-N frames.
 *   burst    → 1  (every frame — active shot window)
 *   lowPower → 6  (heavy throttle)
 *   normal   → 3  (default)
 */
function _stride() {
  if (_state.burst)    return 1;
  if (_state.lowPower) return 6;
  return 3;
}

/** Reset the idle timer; un-pause if currently paused. */
function _resetIdle() {
  if (_state.idleTimer) clearTimeout(_state.idleTimer);
  if (_state.paused) _state.paused = false;
  _state.idleTimer = setTimeout(() => {
    _state.paused = true;
    _state.idleTimer = null;
  }, IDLE_TIMEOUT_MS);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seededRandom(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) | 0) >>> 0;
  }
  return (h >>> 0) / 0xffffffff;
}

function seedFromFrame(frame) {
  if (frame === null || frame === undefined) return 'null';
  if (typeof frame === 'string') return frame;
  if (typeof frame === 'number') return String(frame);
  if (frame.uri)                 return String(frame.uri);
  if (frame.time !== undefined)  return String(frame.time);
  if (frame.index !== undefined) return String(frame.index);
  try { return JSON.stringify(frame); } catch { return 'unknown'; }
}

// ─── Power-management API ─────────────────────────────────────────────────────

/**
 * Enable or disable low-power mode.
 *
 * In low-power mode the frame stride doubles (1-in-6 vs 1-in-3) and the
 * idle timeout fires after the same 3 s window, keeping CPU usage minimal
 * during recovery shots or between holes.
 *
 * @param {boolean} enabled
 */
export function setLowPowerMode(enabled) {
  _state.lowPower = !!enabled;
  // Reset counter so the next frame is always processed after a mode change
  _state.frameCounter = 0;
}

/** Returns current low-power state. */
export function isLowPowerMode() {
  return _state.lowPower;
}

/**
 * Activate burst mode: process every frame for up to durationMs, then revert.
 * Use this when the user is actively mid-swing or has just logged a shot.
 *
 * @param {boolean} enabled      - true to start burst, false to stop immediately
 * @param {number}  [durationMs=10000] - max burst window; auto-cancels after this
 */
export function setBurstMode(enabled, durationMs = 10000) {
  // Clear any pending auto-expire
  if (_state.burstTimer) { clearTimeout(_state.burstTimer); _state.burstTimer = null; }
  _state.burst = !!enabled;
  _state.frameCounter = 0; // next frame is always processed fresh after a mode change
  if (_state.burst && durationMs > 0) {
    _state.burstTimer = setTimeout(() => {
      _state.burst     = false;
      _state.burstTimer = null;
    }, durationMs);
  }
}

/**
 * Manually pause frame processing (e.g. when the app goes to background).
 * Processing resumes automatically on the next processFrame() call.
 */
export function pauseProcessing() {
  _state.paused = true;
  if (_state.idleTimer) { clearTimeout(_state.idleTimer); _state.idleTimer = null; }
}

/**
 * Manually resume frame processing without waiting for the next frame call.
 */
export function resumeProcessing() {
  _state.paused = false;
  _state.frameCounter = 0;
}

/** Returns a snapshot of processor state (useful for diagnostics / UI). */
export function getProcessorStatus() {
  return {
    lowPower:     _state.lowPower,
    burst:        _state.burst,
    paused:       _state.paused,
    frameCounter: _state.frameCounter,
    stride:       _stride(),
    lastFrameMs:  _state.lastFrameTime,
  };
}

// ─── Core detection ───────────────────────────────────────────────────────────

/**
 * Process a single video frame and return ball-detection data.
 *
 * Battery optimisations applied here:
 *   1. If paused (idle), returns the last cached result immediately.
 *   2. Skipped frames (counter % stride !== 0) return the last cached result.
 *   3. Each call resets the idle timer.
 *
 * @param {object|string|number} frame
 * @param {object}  [options]
 * @param {number}  [options.frameWidth=1920]
 * @param {number}  [options.frameHeight=1080]
 * @param {boolean} [options.normalised=false]
 *
 * @returns {{
 *   ballPosition: { x: number, y: number },
 *   confidence:   number,
 *   frameId:      string,
 *   detected:     boolean,
 *   skipped:      boolean
 * }}
 */
export function processFrame(frame, options = {}) {
  const {
    frameWidth  = 1920,
    frameHeight = 1080,
    normalised  = false,
  } = options;

  _state.lastFrameTime = Date.now();
  _resetIdle();

  _state.frameCounter++;

  // ── Return cached result for skipped / paused frames ──────────────────
  const shouldSkip = _state.paused || (_state.frameCounter % _stride() !== 0);
  if (shouldSkip && _state.lastResult) {
    return { ..._state.lastResult, skipped: true };
  }

  // ── Run detection ─────────────────────────────────────────────────────
  const seed = seedFromFrame(frame);
  const rx   = seededRandom(seed + ':x');
  const ry   = seededRandom(seed + ':y');
  const rc   = seededRandom(seed + ':c');

  const normX = 0.25 + rx * 0.50;
  const normY = 0.20 + ry * 0.60;

  const confidence = MOCK_CONFIDENCE_MIN + rc * (MOCK_CONFIDENCE_MAX - MOCK_CONFIDENCE_MIN);
  const detected   = confidence >= 0.50;

  const ballPosition = normalised
    ? { x: normX, y: normY }
    : { x: Math.round(normX * frameWidth), y: Math.round(normY * frameHeight) };

  const result = {
    ballPosition,
    confidence: Math.round(confidence * 100) / 100,
    frameId:    seed,
    detected,
    skipped:    false,
  };

  _state.lastResult = result;
  return result;
}

/**
 * Process an array of frames with stride + idle optimisations applied.
 *
 * @param {Array<object|string|number>} frames
 * @param {object} [options]
 * @returns {Array}
 */
export function processFrames(frames, options = {}) {
  if (!Array.isArray(frames)) return [];
  return frames.map((f) => processFrame(f, options));
}

/**
 * From an array of frames, return the single result with the highest
 * confidence (skipped frames are excluded from the competition).
 *
 * @param {Array<object|string|number>} frames
 * @param {object} [options]
 * @returns {object | null}
 */
export function bestDetection(frames, options = {}) {
  const results = processFrames(frames, options).filter((r) => !r.skipped);
  if (!results.length) return null;
  return results.reduce((best, cur) => cur.confidence > best.confidence ? cur : best);
}
