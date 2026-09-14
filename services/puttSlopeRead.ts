/**
 * 2026-09-13 (Tim) — "with elevation dialed in, sometimes, the putting read has said uphill when its
 * down. A sure like me has the camera close to level but an expectation at level is not real."
 *
 * His diagnosis is right, and it is the second of two defects. ONE OWNER for turning a phone's tilt into
 * a putt slope, so both are fixed in one place and the limits are written down where the maths is.
 *
 * ── DEFECT 1: THE SIGN WAS THROWN AWAY ──────────────────────────────────────────────────────────────
 * The old line was `const deviation = Math.abs(p) - 90`. Taking |pitch| collapses the two hemispheres
 * onto one answer, and the sign is the ONLY thing that distinguishes uphill from downhill. It happens to
 * work while `rotation.beta` stays positive (a normal portrait hold reads ≈+90), and inverts silently the
 * moment it does not — an upside-down hold, or a platform that reports beta with the other sign. "Uphill
 * when it's down", exactly as reported.
 *
 * ── DEFECT 2: THE INSTRUMENT CANNOT RESOLVE WHAT IT CLAIMED ─────────────────────────────────────────
 * The verdict thresholds were ±2%. Work out what 2% IS in the unit actually measured — an angle:
 *
 *     2% slope  → atan(0.02) = 1.15° of camera angle, at ANY putt length
 *     5% slope  → 2.86°
 *    10% slope  → 5.71°
 *
 * A handheld phone varies by ±2-3° from tremor and hold alone. So the old ±2% verdict was decided
 * entirely inside the noise: a 1.2° difference in how he held it flipped "firm pace — it's uphill" to
 * "soft pace — downhill, let it die". That is not a miscalibration, it is a claim the instrument cannot
 * support, which is what "an expectation at level is not real" means.
 *
 * So there is a DEADBAND now, expressed in the measured unit. Inside it the honest answer is that it
 * cannot be called — not a direction chosen by rounding.
 *
 * ── WHY THERE IS NO GPS CROSS-CHECK, THOUGH IT WAS THE FIRST THING WE REACHED FOR ────────────────────
 * Tim: "Gps should be able to provide a hint right?" No — and it is worth recording the numbers so nobody
 * builds it later believing it helps. Against a 20 ft putt's 2% slope, which is 0.12 m of rise:
 *
 *     GPS horizontal              3-5 m       wrong axis; says nothing about rise
 *     GPS altitude                ±5-15 m     vertical error is 1.5-3x horizontal → 40-125x the signal
 *     terrain API (/api/elevation) 11 m grid  both ends of a 6 m putt land in ONE cell → delta is 0
 *
 * Even a whole-green tilt (30 yd, 3 ft of fall = 0.9 m over 27 m) is at or below that data's ~1 m
 * vertical resolution. A reconciliation against a source that cannot see the thing is false comfort, so
 * this module does not pretend to have one.
 */

/** Degrees of camera angle below which uphill and downhill cannot be told apart by a handheld phone. */
export const SLOPE_DEADBAND_DEG = 3;
/** Beyond this the hold is not a putting-read hold at all and tan() is noise. */
export const SLOPE_MAX_DEVIATION_DEG = 30;
/** Real greens do not exceed roughly this grade; anything past it is a bad read, not a steep green. */
export const SLOPE_MAX_PCT = 25;

export type SlopeCall = 'uphill' | 'downhill' | 'too_level_to_call' | 'unreadable_hold' | 'no_reading';

export interface PuttSlopeRead {
  /** Signed grade, + uphill. Null whenever no honest number exists. */
  pct: number | null;
  call: SlopeCall;
  /** Degrees off vertical, signed. Exposed so a surface can show the hold rather than guess at it. */
  deviationDeg: number | null;
}

/**
 * @param pitchDeg DeviceMotion `rotation.beta` in degrees. A portrait hold aimed level reads near ±90;
 *                 tilting the camera UP pushes |pitch| past 90, tilting DOWN pulls it under.
 */
export function readPuttSlope(pitchDeg: number | null): PuttSlopeRead {
  if (pitchDeg == null || !Number.isFinite(pitchDeg)) {
    return { pct: null, call: 'no_reading', deviationDeg: null };
  }

  /**
   * SIGNED, and no Math.abs anywhere — that is the whole fix. `rotation.beta` is 0 flat screen-up, +90
   * upright portrait facing the player, ±180 flat screen-down, −90 upright but inverted. So for the only
   * hold this read is meant for — upright, camera at the hole — the deviation from vertical is simply
   * beta − 90, and its sign IS the answer: camera tilted up (uphill) pushes beta past 90, tilted down
   * pulls it under.
   *
   * Everything else is REFUSED rather than interpreted. I first wrote a hemisphere-aware version that
   * mapped an upside-down hold onto a slope, and I could not verify that convention without a device —
   * inventing one would be the same class of error as the Math.abs it replaced, just harder to spot. A
   * phone flat on a table (beta 0 → deviation −90) or inverted (beta −90 → −180) falls outside the gate
   * and reads as an unreadable hold, which is true.
   */
  const deviationDeg = pitchDeg - 90;

  if (Math.abs(deviationDeg) > SLOPE_MAX_DEVIATION_DEG) {
    return { pct: null, call: 'unreadable_hold', deviationDeg };
  }

  if (Math.abs(deviationDeg) < SLOPE_DEADBAND_DEG) {
    // The honest answer, and the whole point of this rewrite: at this angle the phone cannot tell.
    return { pct: null, call: 'too_level_to_call', deviationDeg };
  }

  const raw = Math.tan((deviationDeg * Math.PI) / 180) * 100;
  if (!Number.isFinite(raw)) return { pct: null, call: 'no_reading', deviationDeg };
  const pct = Math.round(Math.max(-SLOPE_MAX_PCT, Math.min(SLOPE_MAX_PCT, raw)));
  return { pct, call: pct > 0 ? 'uphill' : 'downhill', deviationDeg };
}

/** What the read means for pace, or null when there is no honest call to make. */
export function paceHintFor(read: PuttSlopeRead): string | null {
  switch (read.call) {
    case 'uphill': return 'firm pace — it’s uphill';
    case 'downhill': return 'soft pace — downhill, let it die';
    default: return null;
  }
}

/** Why there is no number, in the player's language. Null when there IS one. */
export function whyNoSlope(read: PuttSlopeRead): string | null {
  switch (read.call) {
    case 'too_level_to_call':
      return 'Too close to level to call — a phone can’t tell 2% uphill from 2% down at this distance, so I won’t guess.';
    case 'unreadable_hold':
      return 'Hold it upright, facing the hole, and I’ll read the incline.';
    case 'no_reading':
      return 'No tilt reading yet.';
    default:
      return null;
  }
}
