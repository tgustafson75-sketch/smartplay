/**
 * BallTrackingEngine.js
 *
 * Analyses video frames to detect ball launch direction and speed estimate.
 *
 * Current implementation: mock logic that infers direction from frame-to-frame
 * positional delta using processFrame() from VisionProcessor.
 *
 * TODO: Replace with real optical-flow or ML-based ball-tracking once a CV
 * pipeline (e.g. react-native-fast-tflite, VisionCamera frame processor) is
 * integrated behind VisionProcessor.processFrame().
 */

import { processFrame } from './VisionProcessor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum confidence required on a frame before its position is used in
 * motion calculations.  Frames below this threshold are skipped.
 */
const MIN_CONFIDENCE = 0.50;

/**
 * Horizontal displacement (px) required between two consecutive accepted
 * frames before we call it a directional launch rather than noise.
 */
const DIRECTION_THRESHOLD_PX = 15;

/**
 * Pixel dimensions assumed for per-frame coordinate calculations (matches
 * VisionProcessor defaults).
 */
const FRAME_W = 1920;
const FRAME_H = 1080;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Filter frames by confidence and return their pixel positions.
 *
 * @param {Array} frames
 * @returns {Array<{ x: number, y: number, confidence: number, frameId: string }>}
 */
function extractPositions(frames) {
  return frames
    .map((f) => processFrame(f, { frameWidth: FRAME_W, frameHeight: FRAME_H }))
    .filter((r) => r.detected && r.confidence >= MIN_CONFIDENCE)
    .map((r) => ({ ...r.ballPosition, confidence: r.confidence, frameId: r.frameId }));
}

/**
 * Compute frame-to-frame deltas for a sequence of positions.
 *
 * @param {Array<{ x: number, y: number }>} positions
 * @returns {Array<{ dx: number, dy: number, speed: number }>}
 */
function computeDeltas(positions) {
  const deltas = [];
  for (let i = 1; i < positions.length; i++) {
    const dx = positions[i].x - positions[i - 1].x;
    const dy = positions[i].y - positions[i - 1].y;
    deltas.push({ dx, dy, speed: Math.sqrt(dx * dx + dy * dy) });
  }
  return deltas;
}

/**
 * Find the first delta that exceeds a minimum speed threshold — this is the
 * presumed ball-launch frame.
 *
 * @param {Array<{ dx: number, dy: number, speed: number }>} deltas
 * @param {number} minSpeed  Minimum pixel displacement to count as launch.
 * @returns {{ dx: number, dy: number, speed: number } | null}
 */
function findLaunchDelta(deltas, minSpeed = 10) {
  return deltas.find((d) => d.speed >= minSpeed) ?? null;
}

/**
 * Map a horizontal delta to a start direction.
 *
 * @param {number} dx
 * @returns {'left' | 'straight' | 'right'}
 */
function deltaToDirection(dx) {
  if (dx < -DIRECTION_THRESHOLD_PX) return 'left';
  if (dx >  DIRECTION_THRESHOLD_PX) return 'right';
  return 'straight';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyse a sequence of video frames to detect ball-launch direction and
 * estimate initial speed.
 *
 * @param {Array<object|string|number>} frames
 *   Frame descriptors as accepted by VisionProcessor.processFrame().
 *
 * @param {object} [options]
 * @param {number}  [options.minLaunchSpeed=10]  Min pixel delta to count as launch.
 * @param {string}  [options.shotResult]          Optional hint: 'left'|'straight'|'right'.
 *                                                Used as fallback when frame data is
 *                                                insufficient (< 2 high-confidence frames).
 *
 * @returns {{
 *   startDirection: 'left' | 'straight' | 'right',
 *   speedEstimate: number,
 *   launchFrameId: string | null,
 *   source: 'frames' | 'hint' | 'default'
 * }}
 */
export function detectBallStart(frames, options = {}) {
  const { minLaunchSpeed = 10, shotResult } = options;

  // ── Step 1: extract confident positions from frames ──────────────────
  const positions = Array.isArray(frames) ? extractPositions(frames) : [];

  // ── Step 2: compute motion deltas ────────────────────────────────────
  if (positions.length >= 2) {
    const deltas      = computeDeltas(positions);
    const launchDelta = findLaunchDelta(deltas, minLaunchSpeed);

    if (launchDelta) {
      return {
        startDirection: deltaToDirection(launchDelta.dx),
        speedEstimate:  Math.round(launchDelta.speed),
        launchFrameId:  positions[deltas.indexOf(launchDelta) + 1]?.frameId ?? null,
        source:         'frames',
      };
    }

    // Frames available but no clear launch impulse — use mean delta direction
    const meanDx = deltas.reduce((s, d) => s + d.dx, 0) / deltas.length;
    const meanSpeed = deltas.reduce((s, d) => s + d.speed, 0) / deltas.length;
    return {
      startDirection: deltaToDirection(meanDx),
      speedEstimate:  Math.round(meanSpeed),
      launchFrameId:  null,
      source:         'frames',
    };
  }

  // ── Step 3: fall back to shotResult hint ─────────────────────────────
  if (shotResult === 'left' || shotResult === 'right' || shotResult === 'straight') {
    // Infer a plausible speed range per direction (mock values)
    const hintSpeed = shotResult === 'straight' ? 82
                    : shotResult === 'right'    ? 74
                    : 68;
    return {
      startDirection: shotResult,
      speedEstimate:  hintSpeed,
      launchFrameId:  null,
      source:         'hint',
    };
  }

  // ── Step 4: absolute default ──────────────────────────────────────────
  return {
    startDirection: 'straight',
    speedEstimate:  0,
    launchFrameId:  null,
    source:         'default',
  };
}

/**
 * Convenience wrapper: run detectBallStart and return only the
 * startDirection string.  Useful for callers that only need the direction.
 *
 * @param {Array} frames
 * @param {object} [options]
 * @returns {'left' | 'straight' | 'right'}
 */
export function getBallStartDirection(frames, options = {}) {
  return detectBallStart(frames, options).startDirection;
}
