/**
 * 2026-09-29 (review) — A DEFERRED PAYWALL IS RE-ASKED, NOT REPLAYED.
 *
 * services/paywallGuard defers a paywall that would have interrupted a round and app/_layout.tsx shows
 * it when the round ends (or on the next cold start). It used to push /paywall unconditionally — so a
 * player who subscribed, restored, or redeemed a code in the meantime was still sold the thing they
 * had just bought. The deferral records WHY (the feature key, or a banner name); the question is asked
 * again against the status as it is NOW, after the profile store has hydrated (before that the status
 * is the 'free' default, which would look like a locked-out subscriber).
 *
 * Moved out of the layout effect so the decision is runnable in a test. The flag is always consumed:
 * a skipped paywall must not come back on the next launch either.
 */
import { consumeDeferredPaywall } from '../paywallGuard';
import { canAccess, editionFor, FEATURE_EDITION, type FeatureKey } from '../featureAccess';
import { usePlayerProfileStore, isOwnerEmail, type SubscriptionStatus } from '../../store/playerProfileStore';

/** Should a paywall deferred for `reason` still be shown to a player whose status is `status`? */
export function deferredPaywallStillWanted(reason: string, status: SubscriptionStatus): boolean {
  // Someone who already holds Pro is never re-sold it, whatever the paywall was deferred for.
  if (editionFor(status) === 'pro') return false;
  if (Object.prototype.hasOwnProperty.call(FEATURE_EDITION, reason)) {
    // A predicate, not a denial branch: the caller IS the upgrade offer (it shows the paywall).
    const allowed = canAccess(reason as FeatureKey, status);
    return !allowed;
  }
  return true; // a non-feature reason (e.g. the trial-expired banner) for a lite player
}

function profileHydrated(): Promise<void> {
  const persist = usePlayerProfileStore.persist;
  if (!persist?.hasHydrated || persist.hasHydrated()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const unsub = persist.onFinishHydration(() => { unsub?.(); resolve(); });
    if (persist.hasHydrated()) { unsub?.(); resolve(); }
  });
}

/** Consume any deferred paywall and show it only if the player still lacks what it sells. */
export async function resumeDeferredPaywall(show: () => void): Promise<'shown' | 'skipped' | 'none'> {
  const deferred = await consumeDeferredPaywall();
  if (!deferred) return 'none';
  await profileHydrated();
  const { subscription_status, email } = usePlayerProfileStore.getState();
  if (isOwnerEmail(email) || !deferredPaywallStillWanted(deferred.reason, subscription_status)) {
    console.log('[paywall] deferred paywall no longer needed —', deferred.reason, subscription_status);
    return 'skipped';
  }
  console.log('[paywall] resuming deferred paywall —', deferred.reason);
  try { show(); } catch { /* navigator not ready */ }
  return 'shown';
}
