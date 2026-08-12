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

/**
 * 2026-08-12 (threshold audit) — 6.0 m/s is 13.4 mph SUSTAINED, which is at or above what most
 * golf carts are governed to (12-15 mph flat out) and far above what one averages in play, where
 * every leg ends in a stop, a turn, or a cart-path detour. Requiring three of five samples above
 * that meant a player riding all eighteen was usually classified as WALKING.
 *
 * That matters beyond a label: the caddie reads movement mode for pace and for how far it expects
 * you to be from your next shot, so a cart round was being reasoned about as a walking round.
 *
 * 3.0 m/s (6.7 mph) is the honest divider. Walking is 1.3-1.5 m/s even at a brisk clip, so this
 * sits at roughly twice walking pace — comfortably clear of a fast walker, comfortably below a
 * cart's real cruising speed, with margin on both sides rather than a ceiling almost nothing
 * reaches.
 */
const CART_SPEED_MS = 3.0;      // sustained > 3 m/s (~6.7 mph) = riding, not walking
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
// 2026-08-08 (wave-2 audit #6 — iOS never classifies 'stationary'). Entries carry a timestamp so stale
// samples decay (a parked cart no longer shows the cart icon forever), and invalid speeds are DERIVED
// from displacement instead of dropped (iOS CoreLocation reports speed −1 while standing still, so the
// buffer never filled and mode stayed 'unknown' — which silently disabled the tee-box auto-brief on
// TestFlight devices; Android reports real speeds, which is why Tim's preview phone worked).
const speedBuffer: { s: number; at: number }[] = [];
let lastFixForDerive: { lat: number; lng: number; at: number } | null = null;

function pushSpeed(s: number | null, fix?: { lat: number | null; lng: number | null }): void {
  let speed = (s != null && Number.isFinite(s) && s >= 0) ? s : null;
  // Derive from displacement when the OS speed is invalid (iOS −1/null while still).
  if (speed == null && fix && fix.lat != null && fix.lng != null) {
    const now = Date.now();
    if (lastFixForDerive && now - lastFixForDerive.at >= 1_000 && now - lastFixForDerive.at <= 30_000) {
      const dLat = (fix.lat - lastFixForDerive.lat) * 111_320;
      const dLng = (fix.lng - lastFixForDerive.lng) * 111_320 * Math.cos(fix.lat * Math.PI / 180);
      const meters = Math.hypot(dLat, dLng);
      speed = meters / ((now - lastFixForDerive.at) / 1000);
    }
    lastFixForDerive = { lat: fix.lat, lng: fix.lng, at: now };
  }
  if (speed == null || !Number.isFinite(speed) || speed < 0) return;
  speedBuffer.push({ s: speed, at: Date.now() });
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
  // 2026-08-08 (wave-2 audit #6) — evict stale samples (>30s) so a parked cart's old cart-speed
  // readings can't hold the cart classification indefinitely.
  const cutoff = Date.now() - 30_000;
  while (speedBuffer.length > 0 && speedBuffer[0].at < cutoff) speedBuffer.shift();
  if (speedBuffer.length === 0) return;
  const avg = speedBuffer.reduce((a, b) => a + b.s, 0) / speedBuffer.length;
  let cartCount = 0;
  let walkCount = 0;
  let stillCount = 0;
  for (const { s } of speedBuffer) {
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
    pushSpeed(fix.speed, { lat: fix.lat, lng: fix.lng });
  });
  // Seed with the current cached fix so a player who isn't moving yet
  // still gets 'stationary' classified within the first tick.
  const last = getLastFix();
  if (last) pushSpeed(last.speed, { lat: last.lat, lng: last.lng });
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
