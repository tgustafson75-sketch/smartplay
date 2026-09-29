/**
 * SmartPlay Caddie — usage telemetry client (off-device data layer · Phase A).
 *
 * Sends coarse, ANONYMOUS usage events to `${getApiBaseUrl()}/api/usage`,
 * which writes them into the isolated `smartplay` Supabase schema.
 *
 * Contract (honesty + safety):
 *   • ONE TOGGLE. Gated on settingsStore.analyticsOptIn — ON by default for installs from 1.0.2,
 *     unchanged for existing installs (2026-09-28). When off, track() is a no-op — nothing is
 *     buffered, nothing is sent. The Settings row says so.
 *   • WHAT A BATCH CARRIES: { events: [{ event, props, ts }], anonId }. Nothing else — no email
 *     (removed 2026-09-28), no device id, no location. The server stores anon_id, event, props, ts.
 *   • ANONYMOUS. We attach a random, locally-generated id persisted in
 *     AsyncStorage. It is NOT a device fingerprint — it's a throwaway opaque
 *     string that resets if the user clears app data.
 *   • FIRE-AND-FORGET. Every error is swallowed. Telemetry must never block the
 *     UI or surface a failure to the user.
 *   • BOUNDED. The in-memory buffer is capped so it can't grow unbounded while
 *     offline; the oldest events are dropped first.
 *
 * Flush triggers: ~15s timer, 20 buffered events, or app backgrounding.
 *
 * NOTE: this is distinct from services/analytics.ts (Sentry breadcrumb batcher).
 * This module is the off-device Supabase usage path specifically.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { getApiBaseUrl } from './apiBase';
import { useSettingsStore } from '../store/settingsStore';

const ANON_ID_KEY = 'smartplay.usage.anonId';
const FLUSH_INTERVAL_MS = 15_000;
const FLUSH_AT_COUNT = 20;
const MAX_BUFFER = 200; // hard cap so an offline session can't grow unbounded

interface BufferedEvent {
  event: string;
  props?: Record<string, unknown>;
  ts: number;
}

let buffer: BufferedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let initialized = false;
let anonId: string | null = null;
let anonIdLoading: Promise<string> | null = null;

/** True only when the user has explicitly opted in. */
function isOptedIn(): boolean {
  try {
    return useSettingsStore.getState().analyticsOptIn === true;
  } catch {
    return false;
  }
}

/** Generate a random, non-fingerprint anon id. */
function makeAnonId(): string {
  const rand = () => Math.random().toString(36).slice(2);
  return `a_${Date.now().toString(36)}_${rand()}${rand()}`.slice(0, 48);
}

/** Load (or lazily create + persist) the stable anonymous id. */
async function ensureAnonId(): Promise<string> {
  if (anonId) return anonId;
  if (anonIdLoading) return anonIdLoading;
  anonIdLoading = (async () => {
    try {
      const existing = await AsyncStorage.getItem(ANON_ID_KEY);
      if (existing) {
        anonId = existing;
        return existing;
      }
      const fresh = makeAnonId();
      await AsyncStorage.setItem(ANON_ID_KEY, fresh);
      anonId = fresh;
      return fresh;
    } catch {
      // Storage failed — use an in-memory id for this session so we still
      // attach *something* anonymous, but don't block telemetry on it.
      const fallback = makeAnonId();
      anonId = fallback;
      return fallback;
    } finally {
      anonIdLoading = null;
    }
  })();
  return anonIdLoading;
}

/** Profile user id (email), only if the user has set one. May be null. */
// 2026-09-28 (1.0.2) — getUserId() is gone. It attached the player's EMAIL as user_id to every batch,
// while the Settings row promised "never your name" — and with the toggle now on by default for new
// installs, that is an identifier the App Privacy / Data safety answers would have to declare as
// linked to the player. Usage is keyed by the random per-install anonId only.

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  flushTimer = setInterval(() => { void flushUsage(); }, FLUSH_INTERVAL_MS);
  appStateSub = AppState.addEventListener('change', (next) => {
    if (next !== 'active') void flushUsage();
  });
}

/**
 * Buffer a usage event. No-op unless the user has opted in. Fire-and-forget.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  try {
    if (!isOptedIn()) return;
    if (typeof event !== 'string' || !event.trim()) return;
    ensureInit();
    buffer.push({ event: event.trim().slice(0, 64), props, ts: Date.now() });
    // Bound the buffer: drop oldest if we somehow exceed the cap (offline).
    if (buffer.length > MAX_BUFFER) {
      buffer = buffer.slice(buffer.length - MAX_BUFFER);
    }
    if (buffer.length >= FLUSH_AT_COUNT) void flushUsage();
  } catch {
    /* telemetry must never throw into the caller */
  }
}

/**
 * Flush the buffer to /api/usage. Safe to call any time; swallows all errors.
 * No-op when opted out or the buffer is empty.
 */
export async function flushUsage(): Promise<void> {
  try {
    if (!isOptedIn()) {
      // Opted out (or opted back out) — discard anything buffered.
      buffer = [];
      return;
    }
    if (buffer.length === 0) return;

    const batch = buffer.slice(0, 50);
    buffer = buffer.slice(batch.length);

    const id = await ensureAnonId();

    const res = await fetch(`${getApiBaseUrl()}/api/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: batch,
        anonId: id,
      }),
      // 2026-07-06 (audit) — bound the wait (~1.5× the route's 10s maxDuration);
      // telemetry is best-effort, a stalled flush should die quietly, not hang.
      signal: AbortSignal.timeout(15_000),
    });
    // If the server rejected the batch outright (very rare), drop it rather
    // than retry forever — telemetry is best-effort, not durable.
    void res;
  } catch {
    // Network error — swallow. The dropped batch is acceptable for telemetry;
    // we never block the UI or retry aggressively.
  }
}

/** Test/teardown hook — clears timers + buffer. */
export function teardownUsageTelemetry(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (appStateSub) { appStateSub.remove(); appStateSub = null; }
  buffer = [];
  initialized = false;
}
