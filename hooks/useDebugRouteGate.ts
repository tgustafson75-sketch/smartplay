/**
 * 2026-05-17 — Owner+__DEV__ gate for internal debug routes.
 *
 * The 11 *-debug.tsx routes (api, battery, cage, ghost, patterns, plan,
 * smartfinder, subscription, voice, etc.) leak diagnostic data that
 * normal users should never see and that Apple/Google reviewers will
 * reject if they're left deep-linkable. This hook gates the route at
 * the top: only owners (per isOwnerEmail) and dev builds (__DEV__) are
 * allowed in; everyone else is silently redirected to the home tab.
 *
 * Usage at the top of a debug route component:
 *
 *   const allowed = useDebugRouteGate();
 *   if (!allowed) return null;
 *
 * Returns true when allowed (render normally), false while redirecting.
 */

import { useEffect } from 'react';
import { router } from 'expo-router';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';

export function useDebugRouteGate(): boolean {
  const email = usePlayerProfileStore(s => s.email);
  const allowed = __DEV__ || isOwnerEmail(email);

  useEffect(() => {
    if (allowed) return;
    try { router.replace('/(tabs)/caddie' as never); } catch (e) {
      console.log('[debugRouteGate] redirect failed', e);
    }
  }, [allowed]);

  return allowed;
}
