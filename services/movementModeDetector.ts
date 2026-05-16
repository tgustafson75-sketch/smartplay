/**
 * Phase 405 wave 3 — Movement mode detector.
 *
 * Lightweight rolling-average speed evaluator that classifies the
 * player's current movement as 'cart' | 'walking' | 'stationary'.
 * Subscribes to gpsManager fixes so it doesn't add a separate Location
 * subscription; ticks at 5s cadence during active rounds.
 *
 * Thresholds (mirror shotDetectionService.DEFAULT_CONFIG):
 *   - speed >= 1.8 m/s (4 mph) AND <= 6.0 m/s (13 mph) sustained =
 *     walking (the gait window for human golf walks)
 *   - speed >  6.0 m/s sustained = cart (typical cart speed 8–15 mph)
 *   - speed <  0.6 m/s sustained = stationary
 * "Sustained" = 3 of the last 5 samples above/below threshold so a
 * single noisy fix doesn't flip the mode.
 *
 * UI consumes via the Zustand store. The CaddieDataStrip surfaces a
 * small cart / walking icon so the user has a visible signal that the
 * app is reading their movement correctly (and the audit's stated gap
 * — speed data collected but never surfaced — is closed).
 */

import { create } from 'zustand';
import { useRoundStore } from '../store/roundStore';
import { subscribe as subscribeGps, getLastFix } from './gpsManager';

export type MovementMode = 'stationary' | 'walking' | 'cart' | 'unknown';

const CART_SPEED_MS = 6.0;      // sustained > 6 m/s = cart
const WALK_SPEED_MIN_MS = 1.0;  // sustained > 1 m/s but <= cart = walking
const SPEED_WINDOW = 5;         // rolling-sample window
const SUSTAIN_NEEDED = 3;       // 3 of 5 must agree to flip the mode

interface MovementState {
  mode: MovementMode;
  /** Last computed average speed in m/s. -1 when no samples yet. */
  avg_speed_mps: number;
  setMode: (mode: MovementMode, avg_speed_mps: number) => void;
}

export const useMovementModeStore = create<MovementState>((set) => ({
  mode: 'unknown',
  avg_speed_mps: -1,
  setMode: (mode, avg_speed_mps) => set({ mode, avg_speed_mps }),
}));

let gpsUnsub: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const speedBuffer: number[] = [];

function pushSpeed(s: number | null): void {
  if (s == null || !Number.isFinite(s) || s < 0) return;
  speedBuffer.push(s);
  while (speedBuffer.length > SPEED_WINDOW) speedBuffer.shift();
}

function evaluate(): void {
  const round = useRoundStore.getState();
  if (!round.isRoundActive) {
    if (useMovementModeStore.getState().mode !== 'unknown') {
      useMovementModeStore.getState().setMode('unknown', -1);
    }
    return;
  }
  if (speedBuffer.length === 0) return;
  const avg = speedBuffer.reduce((a, b) => a + b, 0) / speedBuffer.length;
  let cartCount = 0;
  let walkCount = 0;
  let stillCount = 0;
  for (const s of speedBuffer) {
    if (s > CART_SPEED_MS) cartCount++;
    else if (s > WALK_SPEED_MIN_MS) walkCount++;
    else stillCount++;
  }
  let next: MovementMode = 'unknown';
  if (cartCount >= SUSTAIN_NEEDED) next = 'cart';
  else if (walkCount >= SUSTAIN_NEEDED) next = 'walking';
  else if (stillCount >= SUSTAIN_NEEDED) next = 'stationary';
  const cur = useMovementModeStore.getState();
  if (cur.mode !== next || Math.abs(cur.avg_speed_mps - avg) > 0.1) {
    useMovementModeStore.getState().setMode(next, avg);
  }
}

export function startMovementModeDetector(): void {
  if (gpsUnsub) return;
  gpsUnsub = subscribeGps((fix) => {
    pushSpeed(fix.speed);
  });
  // Seed with the current cached fix so a player who isn't moving yet
  // still gets 'stationary' classified within the first tick.
  const last = getLastFix();
  if (last) pushSpeed(last.speed);
  if (!pollTimer) pollTimer = setInterval(evaluate, 5_000);
  console.log('[movementMode] detector started');
}

export function stopMovementModeDetector(): void {
  if (gpsUnsub) { gpsUnsub(); gpsUnsub = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  speedBuffer.length = 0;
  useMovementModeStore.getState().setMode('unknown', -1);
  console.log('[movementMode] detector stopped');
}
