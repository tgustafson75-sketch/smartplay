/**
 * Phase BY-quick — Cage swing detection thresholds.
 *
 * Tunable constants for the audio-based swing detection in
 * components/CageSessionOverlay.tsx. Adjusted as a unit; calibration
 * notes in docs/cage-detection-tuning.md.
 *
 * Algorithm summary:
 * 1. Rolling 2-second buffer of dBFS samples (METER_BUFFER_SAMPLES at
 *    METER_INTERVAL_MS cadence).
 * 2. Noise floor = mean of the last NOISE_FLOOR_MIN_SAMPLES.
 * 3. Threshold = noise_floor + TRANSIENT_THRESHOLD_DB.
 * 4. When a sample exceeds threshold, it becomes a CANDIDATE peak —
 *    NOT immediately emitted as a detection.
 * 5. The next metering sample verifies the peak:
 *      - If next sample is also above threshold → SUSTAINED noise
 *        (voice, machinery). Reject.
 *      - If next sample shows ≥ DECAY_MIN_DB_PER_SAMPLE drop from peak
 *        → SHARP transient (golf impact). Emit (subject to debounce).
 *      - Otherwise (slight drop, ambiguous) → SLOW DECAY (clap, distant
 *        boom). Reject.
 * 6. Debounce window prevents double-counting a single impact.
 */

// ─── Sampling ────────────────────────────────────────────────────────────────

/** Audio meter callback cadence in milliseconds. */
export const METER_INTERVAL_MS = 100;

/** Rolling-buffer size in samples (2 seconds at METER_INTERVAL_MS). */
export const METER_BUFFER_SAMPLES = 20;

// ─── Detection threshold ─────────────────────────────────────────────────────

/**
 * Minimum samples required in the rolling buffer before noise-floor +
 * threshold logic engages. Bumped from 5 (Phase BU baseline) to 20 for
 * a more stable noise floor — a 500ms window let a single loud event
 * artificially raise the floor; 2s is steadier under varied ambient.
 */
export const NOISE_FLOOR_MIN_SAMPLES = 20;

/**
 * dB above the rolling noise floor a sample must exceed to be a
 * candidate detection. Bumped from 14 (Phase BU baseline) to 18 because
 * the multi-criterion verification below can afford a higher threshold
 * — most casual ambient now under-clears.
 */
export const TRANSIENT_THRESHOLD_DB = 18;

// ─── Multi-criterion verification ────────────────────────────────────────────

/**
 * Minimum dB drop from the candidate peak to the NEXT sample for the
 * candidate to be confirmed as a sharp transient. Real golf impact decays
 * fast (typical ~6-12 dB drop in 100ms). Voice / machinery / sustained
 * noise stays elevated → rejected. A clap can decay 4-6 dB in 100ms but
 * tends to be SLOWER than real impact; tune up if claps still slip.
 */
export const DECAY_MIN_DB_PER_SAMPLE = 5;

// ─── Debounce ────────────────────────────────────────────────────────────────

/**
 * Minimum milliseconds between two emitted detections. Prevents
 * double-counting a single impact when the audio system reports a peak
 * across multiple consecutive samples.
 */
export const DEBOUNCE_MS = 1500;
