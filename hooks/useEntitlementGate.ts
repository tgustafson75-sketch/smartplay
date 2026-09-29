/**
 * 2026-09-29 (review) — A PAID SCREEN CHECKS ITS OWN DOOR.
 *
 * app/smartfinder.tsx and app/smartvision.tsx only checked the remote kill flag (useFlagGate). Every
 * in-app button to them asks canAccess first, but a deep link (smartplay://smartfinder), a notification
 * or any door added later arrives at the screen directly — so a lite player got the paid tool. The
 * same shape as cage_mode in app/swinglab/smartmotion.tsx: gate the screen, not each entry point.
 *
 * FAIL OPEN for anyone who may be paying:
 *   • never decides before the profile store has hydrated — before that the status is the 'free'
 *     default and every subscriber would look locked out;
 *   • the decision runs a tick after mount and re-reads the store, so the boot trial-lifecycle
 *     (owner → lifetime) that runs in the same hydration callback has landed first;
 *   • an owner email is never gated, whatever the status says;
 *   • 'active' / 'trial' / 'lifetime' pass canAccess by construction.
 *
 * A locked-out player goes through triggerPaywall (the one entry point), replacing this screen so Back
 * does not bounce them into it again. Mid-round the paywall is deferred by that guard, and the screen
 * still closes — they are sent back to the Caddie screen, as the in-app buttons do.
 */
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { canAccess, type FeatureKey } from '../services/featureAccess';
import { triggerPaywall } from '../services/paywallGuard';
import { usePlayerProfileStore, isOwnerEmail } from '../store/playerProfileStore';

const HOME = '/(tabs)/caddie';

function profileHydrated(): boolean {
  const p = usePlayerProfileStore.persist;
  return !p?.hasHydrated || p.hasHydrated();
}

/** Whether this player may use `feature` right now — the pure half, read from the store. */
export function mayOpenPaidScreen(feature: FeatureKey): boolean {
  const { subscription_status, email } = usePlayerProfileStore.getState();
  if (isOwnerEmail(email)) return true;
  return canAccess(feature, subscription_status);
}

export function useEntitlementGate(feature: FeatureKey): void {
  const status = usePlayerProfileStore((s) => s.subscription_status);
  const [hydrated, setHydrated] = useState(profileHydrated);

  useEffect(() => {
    if (hydrated) return;
    const unsub = usePlayerProfileStore.persist?.onFinishHydration?.(() => setHydrated(true));
    if (profileHydrated()) setHydrated(true);
    return () => { unsub?.(); };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (mayOpenPaidScreen(feature)) return;
    // Deferred a tick (navigating during the first commit breaks expo-router), then re-read: the
    // status may have been corrected in the meantime.
    const t = setTimeout(() => {
      if (mayOpenPaidScreen(feature)) return;
      void triggerPaywall(feature, () => {
        try { router.replace('/paywall' as never); } catch { /* navigator not ready */ }
      }).then((shown) => {
        if (shown) return;
        try { router.replace(HOME as never); } catch { /* navigator not ready */ }
      });
    }, 0);
    return () => clearTimeout(t);
  }, [hydrated, status, feature]);
}
