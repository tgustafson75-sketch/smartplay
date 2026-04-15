/**
 * WatchMotionBridge.js
 *
 * Future-safe bridge for Apple Watch / wearable motion input.
 *
 * When a companion watch app or BLE peripheral sends motion data, call
 * receiveWatchMotion() to feed it into the same processing pipeline used
 * by the phone's MotionCalibration module.
 *
 * DATA FORMAT (same as phone motion — do NOT change this shape):
 * {
 *   acceleration: { x: number, y: number, z: number },   // G-force
 *   rotation:     { alpha: number, beta: number, gamma: number }, // rad/s
 *   timestamp:    number,                                 // Unix ms
 *   source?:      'watch' | 'phone',
 * }
 *
 * CURRENT STATUS: stub — no BLE / WatchConnectivity integration yet.
 *
 * TO IMPLEMENT:
 *   1. Use react-native-watch-connectivity (iOS) or a BLE library
 *   2. Subscribe to watch updates in your root component
 *   3. Forward each packet to receiveWatchMotion()
 *   4. Registered listeners will be called with the normalised data
 */

/** @typedef {{ acceleration: {x:number,y:number,z:number}, rotation: {alpha:number,beta:number,gamma:number}, timestamp: number, source?: string }} WatchMotionSample */

const _listeners = new Set();

/**
 * Register a callback to receive normalised watch motion samples.
 * Returns an unsubscribe function.
 *
 * @param {(sample: WatchMotionSample) => void} callback
 * @returns {() => void}
 */
export function addWatchMotionListener(callback) {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}

/**
 * Feed a raw motion packet from a watch / BLE peripheral into the bridge.
 * Validates the shape before fanning out to listeners.
 *
 * @param {WatchMotionSample} data
 */
export function receiveWatchMotion(data) {
  if (!data || typeof data !== 'object') return;

  // Normalise — ensure all required fields exist with safe defaults
  const sample = {
    acceleration: {
      x: data.acceleration?.x ?? 0,
      y: data.acceleration?.y ?? 0,
      z: data.acceleration?.z ?? 0,
    },
    rotation: {
      alpha: data.rotation?.alpha ?? 0,
      beta:  data.rotation?.beta  ?? 0,
      gamma: data.rotation?.gamma ?? 0,
    },
    timestamp: data.timestamp ?? Date.now(),
    source:    data.source    ?? 'watch',
  };

  _listeners.forEach((cb) => {
    try { cb(sample); } catch { /* listener errors must not crash the bridge */ }
  });
}

/**
 * Returns true when at least one listener is registered.
 * Useful for gating BLE subscription cost.
 */
export function hasWatchListeners() {
  return _listeners.size > 0;
}

/**
 * Remove all registered listeners (e.g. on app background).
 */
export function clearWatchListeners() {
  _listeners.clear();
}
