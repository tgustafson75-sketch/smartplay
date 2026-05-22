/**
 * 2026-05-17 — Phase 413 / Component 4
 *
 * Determines if the player is currently walking, riding a cart, or at
 * rest by combining a short health-data window (steps from the last
 * few minutes via Health Connect / Galaxy Watch) with the GPS
 * movement signal from gpsManager.
 *
 * Decision matrix:
 *   steps moderate+ AND GPS moving  → walking
 *   steps minimal  AND GPS moving  → cart
 *   steps minimal  AND GPS stable  → at rest (between shots, on tee)
 *   no health data AND GPS moving  → fallback: respect the manual
 *                                    cartMode toggle from settings
 *
 * Output is advisory — the manual `cartMode` settings toggle stays as
 * the source of truth. This detector surfaces a `suggestedMode` that
 * the UI can use to nudge the user ("Looks like you're walking — turn
 * cart mode off?") and that the orchestrator can use as a soft signal
 * to enhance shot-detection accuracy.
 *
 * Graceful degradation: when Health Connect isn't available, all
 * `walking` callers fall through to the manual cartMode setting.
 * Nothing breaks; the suggestedMode just goes to null.
 */

import { readStepsBetween, isHealthAvailable } from './healthData';

export type ActivityMode = 'walking' | 'cart' | 'at_rest';

export interface DetectorReading {
  mode: ActivityMode;
  confidence: 'high' | 'medium' | 'low';
  /** Step count over the window we evaluated. */
  windowSteps: number;
  /** GPS m/s estimate over the window — passed in by the caller. */
  windowGpsSpeedMps: number;
  /** True if the watch contributed data (vs all-zero fallback). */
  hasHealthData: boolean;
}

const WINDOW_MS = 5 * 60 * 1000;            // 5-minute look-back
const STEPS_WALK_THRESHOLD = 200;           // ≥ 200 steps in 5 min = clearly walking
const STEPS_LIGHT_THRESHOLD = 40;           // some movement but not full walking
const GPS_MOVE_MPS = 0.3;                   // ~ 0.7 mph; below = stationary
const CART_MIN_MPS = 1.2;                   // ~ 2.7 mph; carts cruise faster than this

/**
 * One-shot read of the current activity mode. Caller passes the
 * window GPS speed because gpsManager is the GPS source-of-truth and
 * this module shouldn't reach into it directly (keeps the
 * dependency graph clean).
 *
 * @param windowGpsSpeedMps Avg GPS movement over the last WINDOW_MS,
 *   in meters/second. Caller computes this from their position
 *   history.
 */
export async function detectActivity(windowGpsSpeedMps: number): Promise<DetectorReading> {
  const end = Date.now();
  const start = end - WINDOW_MS;

  // 2026-05-21 — Fix N-3 — defensive guard. Health Connect native calls
  // (isHealthAvailable → hc.initialize, readStepsBetween → hc.readRecords)
  // can throw a NATIVE JNI fatal on devices where the HC binding is stubbed
  // or missing (observed on Samsung One UI / Z Fold). JS try/catch CANNOT
  // catch a native JNI throw, so we must not invoke HC native code at all
  // unless the user has explicitly granted permission via Settings → Health
  // Data → Connect Health Data. Until that opt-in is set, walking/cart
  // detection falls through to the GPS-only branch (no-health-data path
  // below) — which already produces a valid DetectorReading using
  // windowGpsSpeedMps + the manual cartMode toggle.
  let available = false;
  let steps = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const settingsMod = require('../store/settingsStore') as typeof import('../store/settingsStore');
    if (settingsMod.useSettingsStore.getState().hasAskedHealthPermission) {
      available = await isHealthAvailable();
      if (available) steps = await readStepsBetween(start, end);
    }
  } catch (e) {
    console.log('[walkingDetector] health read skipped:', e);
  }
  const hasHealthData = available && steps > 0;

  // Decision tree.
  const gpsMoving = windowGpsSpeedMps > GPS_MOVE_MPS;

  let mode: ActivityMode;
  let confidence: 'high' | 'medium' | 'low';

  if (!hasHealthData) {
    // No watch contribution: lean on GPS.
    if (windowGpsSpeedMps > CART_MIN_MPS) {
      mode = 'cart';            // moving fast, no step data → likely a cart
      confidence = 'low';
    } else if (gpsMoving) {
      mode = 'walking';         // moving at walking pace, no step data → assume walking
      confidence = 'low';
    } else {
      mode = 'at_rest';
      confidence = 'medium';
    }
  } else if (steps >= STEPS_WALK_THRESHOLD) {
    mode = 'walking';
    confidence = 'high';
  } else if (steps >= STEPS_LIGHT_THRESHOLD && gpsMoving) {
    // Light steps + GPS moving — likely walking slowly between shots,
    // or walking while in a cart (gets steps but not many).
    mode = windowGpsSpeedMps > CART_MIN_MPS ? 'cart' : 'walking';
    confidence = 'medium';
  } else if (gpsMoving) {
    mode = 'cart';              // GPS moving with few/no steps → cart
    confidence = 'high';
  } else {
    mode = 'at_rest';
    confidence = 'high';
  }

  return {
    mode,
    confidence,
    windowSteps: steps,
    windowGpsSpeedMps,
    hasHealthData,
  };
}

/**
 * Convenience: should we suggest the user flip cartMode based on the
 * detected activity? Returns:
 *   - 'enable_cart' when manual setting is off but we strongly detect cart
 *   - 'disable_cart' when manual setting is on but we strongly detect walking
 *   - null when no clear suggestion (low confidence, ambiguous, or
 *     manual setting already matches)
 */
export function cartModeSuggestion(
  currentCartMode: boolean,
  reading: DetectorReading,
): 'enable_cart' | 'disable_cart' | null {
  if (reading.confidence === 'low') return null;
  if (reading.mode === 'cart' && !currentCartMode) return 'enable_cart';
  if (reading.mode === 'walking' && currentCartMode) return 'disable_cart';
  return null;
}

// ─── Background ticker + sync cache ──────────────────────────────────────
//
// detectActivity() is async (Health Connect reads), but the shot-
// detection orchestrator is sync. We run a 30s periodic tick during
// round-active that refreshes a module-local cached reading, and
// expose a sync `getCachedReading()` for sync consumers. When the
// ticker hasn't run yet (cold start, no recent round, etc.), the
// cache is null and consumers fall through to manual-setting only.

let _cached: DetectorReading | null = null;
let _tickerHandle: ReturnType<typeof setInterval> | null = null;
const TICK_INTERVAL_MS = 30 * 1000;

export function getCachedReading(): DetectorReading | null {
  return _cached;
}

/** Start the periodic activity-mode tick. Idempotent. The first read
 *  fires immediately, then every TICK_INTERVAL_MS. The caller is
 *  expected to be the round-start path; stop with stopActivityTicker
 *  on round end. */
export function startActivityTicker(getGpsSpeedMps: () => number): void {
  if (_tickerHandle != null) return;
  const tick = async () => {
    try {
      _cached = await detectActivity(getGpsSpeedMps());
    } catch (e) {
      console.log('[walkingDetector] tick failed:', e);
    }
  };
  void tick();
  _tickerHandle = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
}

export function stopActivityTicker(): void {
  if (_tickerHandle != null) {
    clearInterval(_tickerHandle);
    _tickerHandle = null;
  }
  _cached = null;
}

/** Sync answer to "should the orchestrator treat this as cart mode?"
 *  TRUE when manual setting is on OR the cached detector reading
 *  strongly indicates cart (high confidence). Caller can use this
 *  as a single gate instead of branching on manual vs detector
 *  themselves. */
export function isEffectiveCartMode(manualCartMode: boolean): boolean {
  if (manualCartMode) return true;
  const r = _cached;
  return r != null && r.mode === 'cart' && r.confidence === 'high';
}
