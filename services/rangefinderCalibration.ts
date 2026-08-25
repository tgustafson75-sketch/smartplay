/**
 * 2026-08-24 (Tim, after a round — "the moving around of the aperture to get yardage still isn't
 * very reactive in terms of accuracy") — LEARN THE PHONE HEIGHT INSTEAD OF ASSUMING IT.
 *
 * SmartFinder's tilt ranging is `distance = eyeHeight / tan(pitch)`, and `eyeHeight` was the
 * constant 1.6 m for every player, every time. Distance scales LINEARLY with it, so the assumption
 * is a straight multiplier on every read: hold the phone at 1.45 m and every number is ~10% long;
 * at 1.75 m every number is ~9% short. At 150 yards that is fifteen yards, which is exactly the
 * "not very accurate" the reticle keeps being reported for. Two previous passes at this complaint
 * widened a plausibility gate — a gate cannot fix a scale error.
 *
 * The app does not know the player's height and should not have to ask. It already has the answer
 * on any GPS-anchored read: if the green middle is a known 148 yards and the tilt says the same aim
 * point sits at angle A, then the phone height that makes those agree is
 *
 *     h = distanceMetres * tan(A)
 *
 * So every time the player aims somewhere we independently know the distance to, the app can solve
 * for their real phone height and stop guessing. [[the-app-usually-already-knows]]
 *
 * HONESTY RULES, each one a case in the tests:
 *  - a sample outside a plausible human range is DISCARDED, not clamped — an implausible height is
 *    the signature of aiming at something that is not the reference point, and clamping it would
 *    quietly fold that mistake into the average;
 *  - the estimate is a MEDIAN, so one bad sample cannot drag it (same discipline as personalBagScale);
 *  - nothing is learned until MIN_SAMPLES agree, and until then the read uses the old constant, so a
 *    new player's behaviour is byte-identical to before;
 *  - it is per-device, not per-course, and persists — this is a fact about how someone holds a phone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@smartplay/rangefinder_eye_height_v1';

/** The default every read used before anything is learned. Unchanged from services/rangefinder. */
export const DEFAULT_EYE_HEIGHT_M = 1.6;

/** A phone held for ranging sits between roughly waist and eye level. Outside this, the sample is
 *  not a phone height — it is a bad aim, a horizon read, or a GPS fix that was not what we thought. */
export const MIN_PLAUSIBLE_HEIGHT_M = 1.15;
export const MAX_PLAUSIBLE_HEIGHT_M = 1.90;

/** Below this we do not claim to know anything and the constant stands. */
export const MIN_SAMPLES = 5;
/** Rolling window — a player who changes how they hold the phone should be followed, not averaged
 *  against forever. */
const MAX_SAMPLES = 25;

let samples: number[] = [];
let hydrated = false;

/**
 * Solve for the phone height implied by one GPS-anchored read.
 * Returns null when the inputs cannot produce a plausible height — see the honesty rules above.
 */
export function impliedHeightM(knownDistanceMetres: number, pitchDegrees: number): number | null {
  if (!Number.isFinite(knownDistanceMetres) || knownDistanceMetres <= 0) return null;
  if (!Number.isFinite(pitchDegrees) || pitchDegrees >= 0) return null;   // must be tilted DOWN
  const rad = (Math.abs(pitchDegrees) * Math.PI) / 180;
  const t = Math.tan(rad);
  if (!Number.isFinite(t) || t <= 0) return null;
  const h = knownDistanceMetres * t;
  if (!Number.isFinite(h)) return null;
  if (h < MIN_PLAUSIBLE_HEIGHT_M || h > MAX_PLAUSIBLE_HEIGHT_M) return null;  // discard, never clamp
  return h;
}

/** Median of the accepted samples, or null until enough of them agree. */
export function learnedEyeHeightM(): number | null {
  if (samples.length < MIN_SAMPLES) return null;
  const s = [...samples].sort((a, b) => a - b);
  const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return Number.isFinite(mid) ? mid : null;
}

/** The height a read should actually use. */
export function effectiveEyeHeightM(): number {
  return learnedEyeHeightM() ?? DEFAULT_EYE_HEIGHT_M;
}

/** Feed one GPS-anchored observation. Silently ignores anything implausible. */
export function observeCalibration(knownDistanceMetres: number, pitchDegrees: number): void {
  const h = impliedHeightM(knownDistanceMetres, pitchDegrees);
  if (h == null) return;
  samples.push(h);
  if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
  void AsyncStorage.setItem(KEY, JSON.stringify(samples)).catch(() => { /* best-effort */ });
}

/** Boot hydration — same pattern as courseTruth's cache. Never throws. */
export async function hydrateRangefinderCalibration(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) {
      samples = parsed
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        .filter((n) => n >= MIN_PLAUSIBLE_HEIGHT_M && n <= MAX_PLAUSIBLE_HEIGHT_M)
        .slice(-MAX_SAMPLES);
    }
  } catch { /* a missing or corrupt cache just means we have not learned yet */ }
}

/** Test seam. */
export function _resetRangefinderCalibration(): void {
  samples = [];
  hydrated = false;
}
