/**
 * Pre-beta — adaptive GPS polling.
 *
 * Single source of truth for the device GPS subscription during a round.
 * Replaces ad-hoc Location.watchPositionAsync / getCurrentPositionAsync
 * sites with one underlying watch whose poll rate adapts to context:
 *
 *   active     → user has shot intent in last 60s   · 1Hz  · BestForNavigation
 *   walking    → moved >5m in last 30s              · 10s  · Balanced
 *   stationary → no motion for 90s                  · 20s  · Low
 *
 * Round-end drops the subscription entirely. Round-start re-subscribes.
 *
 * One-shot reads (replaceing getCurrentPositionAsync) prefer the manager's
 * cached fix when it's <10s old to avoid redundant high-accuracy pulses.
 */

import * as Location from 'expo-location';
import * as Sentry from '@sentry/react-native';
import { useRoundStore } from '../store/roundStore';

export type GpsMode = 'active' | 'walking' | 'stationary';

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed: number | null;
  timestamp: number;
}

type Subscriber = (fix: GpsFix) => void;

const ACTIVE_HOLD_MS    = 60_000;
const STATIONARY_AFTER  = 90_000;
const STATIONARY_DELTA  = 5;     // meters
const CACHE_FRESH_MS    = 10_000;

const POLL_CONFIG: Record<GpsMode, { intervalMs: number; accuracy: Location.Accuracy }> = {
  active:     { intervalMs: 1_000,  accuracy: Location.Accuracy.BestForNavigation },
  walking:    { intervalMs: 10_000, accuracy: Location.Accuracy.Balanced },
  stationary: { intervalMs: 20_000, accuracy: Location.Accuracy.Low },
};

let subscription: Location.LocationSubscription | null = null;
let mode: GpsMode = 'walking';
let lastFix: GpsFix | null = null;
let lastBumpReason: string | null = null;
let lastBumpAt: number | null = null;
let lastActiveBumpAt = 0;
let lastMotionAt = 0;
let evalTimer: ReturnType<typeof setInterval> | null = null;
let batterySaverFloor: GpsMode | null = null;

const subscribers = new Set<Subscriber>();

function breadcrumb(message: string, data?: Record<string, unknown>) {
  try {
    Sentry.addBreadcrumb({ category: 'gps_mode', level: 'info', message, data });
  } catch {}
}

function haversineMeters(a: GpsFix, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function setMode(next: GpsMode, reason: string) {
  if (mode === next) return;
  // Battery-saver floor — never drop into 'active' if the user opted to save.
  if (batterySaverFloor === 'walking' && next === 'active') {
    breadcrumb('mode_active_blocked_by_saver', { wanted: next, reason });
    return;
  }
  const prev = mode;
  mode = next;
  breadcrumb('mode_change', { from: prev, to: next, reason });
  console.log(`[gps] ${prev} → ${next} (${reason})`);
  if (subscription) restartWatch();
}

async function restartWatch() {
  if (!subscription) return;
  try { subscription.remove(); } catch {}
  subscription = null;
  await startWatchInternal();
}

async function startWatchInternal() {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) {
      console.log('[gps] permission denied');
      return;
    }
    const cfg = POLL_CONFIG[mode];
    subscription = await Location.watchPositionAsync(
      {
        accuracy: cfg.accuracy,
        timeInterval: cfg.intervalMs,
        distanceInterval: 2,
      },
      (loc) => {
        const fix: GpsFix = {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          accuracy_m: loc.coords.accuracy ?? null,
          speed: loc.coords.speed ?? null,
          timestamp: loc.timestamp,
        };
        if (lastFix) {
          const moved = haversineMeters(lastFix, fix);
          if (moved >= STATIONARY_DELTA) lastMotionAt = Date.now();
        } else {
          lastMotionAt = Date.now();
        }
        lastFix = fix;
        for (const cb of subscribers) {
          try { cb(fix); } catch {}
        }
      },
    );
  } catch (err) {
    console.log('[gps] watch error:', err);
  }
}

function evaluateMode() {
  const now = Date.now();
  // Cool down from active 60s after the most recent bump
  if (mode === 'active' && now - lastActiveBumpAt > ACTIVE_HOLD_MS) {
    setMode('walking', 'active_hold_expired');
  }
  // Stationary if no motion for 90s
  if (mode !== 'stationary' && lastMotionAt > 0 && now - lastMotionAt > STATIONARY_AFTER) {
    if (mode !== 'active') setMode('stationary', 'no_motion_90s');
  }
}

/** Called by round-start. No-op if already running. */
export async function startGpsManager(): Promise<void> {
  if (subscription) return;
  mode = 'walking';
  lastMotionAt = Date.now();
  await startWatchInternal();
  if (!evalTimer) evalTimer = setInterval(evaluateMode, 5_000);
  breadcrumb('manager_start');
}

/** Called by round-end. Drops the underlying subscription. */
export function stopGpsManager(): void {
  if (subscription) {
    try { subscription.remove(); } catch {}
    subscription = null;
  }
  if (evalTimer) {
    clearInterval(evalTimer);
    evalTimer = null;
  }
  subscribers.clear();
  lastFix = null;
  batterySaverFloor = null;
  breadcrumb('manager_stop');
}

/** Subscribe to fixes. Returns an unsubscribe fn. */
export function subscribe(cb: Subscriber): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

/** Shot intent event — bump to active for 60s. */
export function bumpToActive(reason: string): void {
  lastActiveBumpAt = Date.now();
  lastBumpReason = reason;
  lastBumpAt = lastActiveBumpAt;
  setMode('active', reason);
}

export function getCurrentMode(): GpsMode {
  return mode;
}

export function getLastFix(): GpsFix | null {
  return lastFix;
}

export function getLastBump(): { reason: string | null; ts: number | null } {
  return { reason: lastBumpReason, ts: lastBumpAt };
}

/**
 * One-shot read. Returns the cached fix if it's <10s old (cuts redundant
 * high-accuracy pulses); otherwise refreshes via Location.getCurrentPositionAsync.
 */
export async function getOneShotFix(opts?: { maxAgeMs?: number }): Promise<GpsFix | null> {
  const maxAge = opts?.maxAgeMs ?? CACHE_FRESH_MS;
  if (lastFix && Date.now() - lastFix.timestamp < maxAge) return lastFix;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const fix: GpsFix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy ?? null,
      speed: pos.coords.speed ?? null,
      timestamp: pos.timestamp,
    };
    lastFix = fix;
    return fix;
  } catch (err) {
    console.log('[gps] one-shot error:', err);
    return lastFix;
  }
}

/** Battery-saver — clamps the floor mode so 'active' bumps are blocked. */
export function setBatterySaverFloor(floor: GpsMode | null): void {
  batterySaverFloor = floor;
  if (floor === 'walking' && mode === 'active') {
    setMode('walking', 'battery_saver_floor');
  }
}
