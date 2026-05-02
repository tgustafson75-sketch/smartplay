import * as Sentry from '@sentry/react-native';
import { AppState } from 'react-native';
import { useRoundStore } from '../store/roundStore';

const hasDsn = !!process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Pre-beta — event batching for non-critical analytics.
 *
 * Sentry breadcrumbs already buffer locally (they're not network events
 * until the next upload), so this batcher's primary job is to coalesce
 * any future network-bound analytics provider behind a single 30s flush
 * cadence, on app-background, on round-end, or when the buffer exceeds
 * 50 events. Critical errors (captureError) bypass the batch and fire
 * immediately.
 *
 * Today the only sink is Sentry breadcrumbs; the batch loop just flushes
 * console-logged events. The batching contract is in place so when a
 * network-bound provider lands, it inherits the discipline for free.
 */

interface QueuedEvent {
  event: string;
  properties?: Record<string, unknown>;
  ts: number;
}

const FLUSH_INTERVAL_MS = 30_000;
const MAX_BUFFER = 50;

let buffer: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let roundUnsub: (() => void) | null = null;
let initialized = false;

function flush(reason: string): void {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  if (hasDsn) {
    for (const ev of batch) {
      Sentry.addBreadcrumb({ message: ev.event, data: ev.properties, level: 'info' });
    }
  } else {
    console.log(`[analytics:flush:${reason}]`, batch.length, 'events');
  }
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  flushTimer = setInterval(() => flush('timer'), FLUSH_INTERVAL_MS);
  appStateSub = AppState.addEventListener('change', (next) => {
    if (next !== 'active') flush('background');
  });
  let active = useRoundStore.getState().isRoundActive;
  roundUnsub = useRoundStore.subscribe((s) => {
    if (s.isRoundActive === active) return;
    const wasActive = active;
    active = s.isRoundActive;
    if (wasActive && !active) flush('round_end');
  });
}

export function track(event: string, properties?: Record<string, unknown>): void {
  ensureInit();
  buffer.push({ event, properties, ts: Date.now() });
  if (buffer.length >= MAX_BUFFER) flush('overflow');
}

export function identify(userId: string, traits?: Record<string, unknown>): void {
  if (hasDsn) {
    Sentry.setUser({ id: userId, ...traits });
  }
}

/** Critical errors are NOT batched — they fire immediately. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (hasDsn) {
    Sentry.withScope(scope => {
      if (context) scope.setExtras(context);
      Sentry.captureException(err);
    });
  } else {
    console.error('[analytics:error]', err, context ?? '');
  }
}

export function teardownAnalytics(): void {
  flush('teardown');
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (appStateSub) { appStateSub.remove(); appStateSub = null; }
  if (roundUnsub) { roundUnsub(); roundUnsub = null; }
  initialized = false;
}
