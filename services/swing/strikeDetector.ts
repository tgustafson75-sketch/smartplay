/**
 * Acoustic strike detector — pure function. Phase BO.1, ported verbatim
 * from SmartPlay Caddie V3 (services/swing/strikeDetector.ts).
 *
 * Takes a time-series of audio metering samples (peak dB at regular
 * intervals from expo-av's Audio.Recording metering callback) and
 * returns a list of detected club-on-ball strikes with timestamps and
 * confidence.
 *
 * Algorithm summary (full doc lives with V3 at
 * docs/phase-3-acoustic-strike-detection.md):
 *   1. Compute the noise floor as the median of all samples
 *   2. Find peaks above floor + STRIKE_THRESHOLD_DB
 *   3. Filter by attack time (golf strikes are sharp; talk is slower)
 *   4. Debounce so a single strike doesn't get counted twice
 *   5. Score confidence based on how cleanly the peak fits the profile
 *
 * Tunable constants are at the top so threshold tuning during real-range
 * testing doesn't require digging into the algorithm.
 */

const STRIKE_THRESHOLD_DB = 30;        // peak must exceed floor by this many dB
const MAX_ATTACK_MS = 100;             // peak must rise to threshold within this window
const MIN_DEBOUNCE_MS = 500;           // collapse peaks closer together than this
const REJECT_HEAD_MS = 300;            // ignore the first N ms (record-button transient)
const REJECT_TAIL_MS = 200;            // ignore the last N ms (stop-button transient)
const MIN_RECORDING_MS = 2_000;        // shorter recordings are rejected entirely
const NOISY_FLOOR_DB = -30;            // floor higher than this = environment too loud

export type MeterSample = {
  /** Milliseconds from recording start. */
  timeMs: number;
  /** Peak dB. expo-av reports values in [-160, 0] where 0 is digital max. */
  dB: number;
};

export type DetectedStrike = {
  timeMs: number;
  peakDb: number;
  attackMs: number;
  confidence: 'high' | 'medium' | 'low';
};

export type StrikeDetectionResult =
  | { kind: 'ok'; floorDb: number; strikes: DetectedStrike[] }
  | { kind: 'too-short'; floorDb: number }
  | { kind: 'noisy-environment'; floorDb: number };

/**
 * 2026-06-07 — Optional per-device calibration. When the user has run
 * the 10-strike calibration, the Smart Motion segmentation engine passes
 * `thresholdDb` (the calibration's transientThresholdDb — dB above floor)
 * so detection matches the user's actual mic distance / strike loudness
 * instead of the universal 30 dB default. `minRecordingMs` lets short
 * calibration captures through without the 2s full-session floor.
 */
export interface DetectStrikesOptions {
  /** dB above the noise floor a peak must exceed. Default 30. */
  thresholdDb?: number;
  /** Minimum recording length to accept. Default 2000ms. */
  minRecordingMs?: number;
}

export function detectStrikes(samples: MeterSample[], opts?: DetectStrikesOptions): StrikeDetectionResult {
  const thresholdDb = opts?.thresholdDb ?? STRIKE_THRESHOLD_DB;
  const minRecordingMs = opts?.minRecordingMs ?? MIN_RECORDING_MS;
  if (samples.length < 2) {
    return { kind: 'too-short', floorDb: -160 };
  }
  const first = samples[0];
  const lastSample = samples[samples.length - 1];
  if (!first || !lastSample) {
    return { kind: 'too-short', floorDb: -160 };
  }
  const totalMs = lastSample.timeMs - first.timeMs;
  const floorDb = median(samples.map((s) => s.dB));

  if (totalMs < minRecordingMs) {
    return { kind: 'too-short', floorDb };
  }
  if (floorDb > NOISY_FLOOR_DB) {
    return { kind: 'noisy-environment', floorDb };
  }

  const startMs = first.timeMs;
  const endMs = lastSample.timeMs;
  const peakThresholdDb = floorDb + thresholdDb;

  // First pass: find candidate peaks (local maxima above threshold,
  // outside head/tail rejection windows).
  type Candidate = { idx: number; timeMs: number; peakDb: number };
  const candidates: Candidate[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const s = samples[i];
    const prev = samples[i - 1];
    const next = samples[i + 1];
    if (!s || !prev || !next) continue;
    const relTime = s.timeMs - startMs;
    if (relTime < REJECT_HEAD_MS) continue;
    if (endMs - s.timeMs < REJECT_TAIL_MS) continue;
    if (s.dB < peakThresholdDb) continue;
    if (s.dB <= prev.dB) continue;
    if (s.dB <= next.dB) continue;
    candidates.push({ idx: i, timeMs: s.timeMs, peakDb: s.dB });
  }

  // Second pass: attack-time filter. Walk backward from each peak and
  // measure how long it took to rise from `floorDb` to the peak. Real
  // strikes have a sharp attack (<100ms); talking / claps are slower.
  type Sharp = Candidate & { attackMs: number };
  const sharp: Sharp[] = [];
  for (const c of candidates) {
    let attackStartIdx = c.idx;
    for (let j = c.idx - 1; j >= 0; j--) {
      const sj = samples[j];
      if (sj && sj.dB <= floorDb + 5) {
        attackStartIdx = j;
        break;
      }
    }
    const peakSample = samples[c.idx];
    const startSample = samples[attackStartIdx];
    if (!peakSample || !startSample) continue;
    const attackMs = peakSample.timeMs - startSample.timeMs;
    if (attackMs <= MAX_ATTACK_MS) {
      sharp.push({ ...c, attackMs });
    }
  }

  // Third pass: debounce. Walk in time order; when two sharp peaks are
  // within MIN_DEBOUNCE_MS, keep only the louder.
  const debounced: Sharp[] = [];
  for (const s of sharp) {
    const last = debounced[debounced.length - 1];
    if (last && s.timeMs - last.timeMs < MIN_DEBOUNCE_MS) {
      if (s.peakDb > last.peakDb) {
        debounced[debounced.length - 1] = s;
      }
      continue;
    }
    debounced.push(s);
  }

  const strikes: DetectedStrike[] = debounced.map((s) => {
    const headroom = s.peakDb - floorDb;
    let confidence: 'high' | 'medium' | 'low';
    if (headroom > 35 && s.attackMs < 60) confidence = 'high';
    else if (headroom >= 30 && s.attackMs <= 100) confidence = 'medium';
    else confidence = 'low';
    return { timeMs: s.timeMs - startMs, peakDb: s.peakDb, attackMs: s.attackMs, confidence };
  });

  return { kind: 'ok', floorDb, strikes };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1];
    const b = sorted[mid];
    if (a == null || b == null) return 0;
    return (a + b) / 2;
  }
  return sorted[mid] ?? 0;
}
