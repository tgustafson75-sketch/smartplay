/**
 * Phase J — Acoustic ball speed.
 *
 * STATUS: stubbed (option b per the spec). Real-time audio impact detection
 * with peak-pair time-of-arrival math is genuinely real engineering — single-
 * peak detection alone needs careful onset detection, noise filtering, and
 * cage-acoustic calibration. Phase J ships a club-typical estimator instead
 * so the data shape is in place for Phase K consumers; the real detector
 * lands in a refinement bundle when reliable detection tech is in hand.
 *
 * Remains stub-shaped until the real DSP work happens. (Previous
 * sibling stub services/acousticEngine.ts was deleted 2026-05-17.)
 *
 * Output is clearly tagged `confidence: 0.3, source: 'club_typical_stub'`
 * so downstream consumers (and any future analytics) can distinguish
 * estimated values from real measurements when the detector ships.
 */

const CLUB_TYPICAL_BALL_SPEED_MPH: Record<string, number> = {
  D:    155,  // Driver
  '3W': 145,
  '5W': 138,
  H:    132,
  '3I': 128,
  '4I': 124,
  '5I': 120,
  '6I': 115,
  '7I': 108,
  '8I': 102,
  '9I':  95,
  PW:    88,
  GW:    80,
  SW:    72,
  LW:    62,
};

export type BallSpeedReading = {
  speed_mph: number;
  confidence: number;
  source: 'acoustic' | 'club_typical_stub';
};

/**
 * Returns an estimated ball-speed reading for a swing of the given club.
 * Today this is the club-typical lookup; real acoustic measurement replaces
 * the body when the DSP detector is ready (signature stays stable).
 */
export function estimateBallSpeed(club: string): BallSpeedReading | null {
  const typical = CLUB_TYPICAL_BALL_SPEED_MPH[club];
  if (typical == null) return null;
  return {
    speed_mph: typical,
    confidence: 0.3,
    source: 'club_typical_stub',
  };
}

/**
 * Real-time impact-pair detector. Stubbed; returns null. Real implementation
 * will subscribe to the audio stream, find the two impact peaks (front of
 * cage, back of cage), and compute speed = distance / time_delta.
 */
export async function measureBallSpeedAcoustic(
  _audioUri: string,
  _calibratedDistanceYards: number,
): Promise<BallSpeedReading | null> {
  // Real DSP work pending. Stubbed null preserves the call signature so
  // session lifecycle code can call this today and switch to populated
  // returns the moment the detector ships.
  return null;
}
