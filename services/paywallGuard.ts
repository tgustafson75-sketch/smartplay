/**
 * Pre-beta — paywall round-active guard.
 *
 * Paywalls must NEVER fire mid-active-round. Every paywall trigger goes
 * through triggerPaywall(), which:
 *   - If a round is active, writes a deferred-flag to AsyncStorage so we
 *     can show the paywall when the round finalizes (or on cold-resume).
 *   - Otherwise, invokes the navigate fn immediately.
 *
 * Sentry breadcrumbs (category 'paywall_timing') trace each path so we
 * can audit any complaints of paywalls interrupting play.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { useRoundStore } from '../store/roundStore';
import { SUBSCRIPTIONS_ENABLED } from './featureAccess';

const KEY = '@smartplay/paywall_deferred';

export interface DeferredPaywall {
  reason: string;
  ts: number;
}

export function selectIsRoundActive(): boolean {
  return useRoundStore.getState().isRoundActive;
}

function breadcrumb(message: string, data?: Record<string, unknown>) {
  try {
    Sentry.addBreadcrumb({
      category: 'paywall_timing',
      level: 'info',
      message,
      data,
    });
  } catch {}
}

/**
 * Single entry point for every paywall trigger in the app. If a round is
 * active we defer; otherwise we fire `navigate()` immediately.
 *
 * Returns true if the paywall was shown (caller need not do anything),
 * false if it was deferred.
 */
export async function triggerPaywall(
  reason: string,
  navigate: () => void,
): Promise<boolean> {
  // Subscriptions kill-switch (featureAccess.SUBSCRIPTIONS_ENABLED): when
  // disabled, no paywall ever fires from this entry point. Caller behavior
  // remains unchanged — they ask, we say "shown" but do nothing visible.
  if (!SUBSCRIPTIONS_ENABLED) {
    breadcrumb('paywall_suppressed_subscriptions_disabled', { reason });
    return true;
  }
  if (selectIsRoundActive()) {
    const payload: DeferredPaywall = { reason, ts: Date.now() };
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(payload));
    } catch {}
    breadcrumb('paywall_deferred', { ...payload });
    console.log('[paywall] deferred during active round —', reason);
    return false;
  }
  breadcrumb('paywall_shown', { reason });
  navigate();
  return true;
}

/** Read + clear any pending deferred paywall flag. */
export async function consumeDeferredPaywall(): Promise<DeferredPaywall | null> {
  // Same kill-switch — never resume a deferred paywall while subscriptions
  // are disabled. Also clear any stale flag so a future re-enable doesn't
  // surface an ancient deferral.
  if (!SUBSCRIPTIONS_ENABLED) {
    try { await AsyncStorage.removeItem(KEY); } catch {}
    return null;
  }
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as DeferredPaywall;
    breadcrumb('paywall_resumed', { ...parsed });
    return parsed;
  } catch {
    return null;
  }
}

/** Force-show the paywall, bypassing the round-active guard. Debug-only. */
export function forcePaywall(navigate: () => void): void {
  if (!SUBSCRIPTIONS_ENABLED) {
    breadcrumb('paywall_forced_suppressed', { source: 'debug' });
    return;
  }
  breadcrumb('paywall_forced', { source: 'debug' });
  navigate();
}
