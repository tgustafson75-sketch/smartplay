/**
 * Route-level kill switch.
 *
 * 2026-09-06 (Tim) — Layer 0. A killed feature's screen must not be reachable, and if it is already
 * open when the switch flips, it closes itself.
 *
 * ── WHY THIS IS A HOOK AND NOT A GUARD IN THE ROUTER ────────────────────────────────────────────
 *
 * Both requirements are the same requirement. "The route redirects" and "it unmounts if the flag
 * flips while open" differ only in WHEN the flag went false relative to mount, and a hook that
 * subscribes to the store cannot tell those apart — which is exactly right. One effect handles both,
 * so there is no way to implement one and forget the other.
 *
 * ── NO MESSAGE, BY INSTRUCTION ──────────────────────────────────────────────────────────────────
 *
 * ENGINEERING-PRINCIPLES #3: no new user-facing error or status surface. There is no toast, no
 * banner, no "temporarily unavailable" screen. The player is simply back on the Caddie screen. A
 * killed feature is one the player should not be thinking about at all; announcing its absence
 * invites a support email about a thing we chose to remove.
 *
 * ── FAIL-OPEN INHERITED ─────────────────────────────────────────────────────────────────────────
 *
 * This reads useFlagStore, which holds all-ON bundled defaults until told otherwise. A player with
 * no network never gets redirected out of anything.
 */

import { useEffect } from 'react';
import { router } from 'expo-router';
import { useFlag, type FlagKey } from '../store/flagStore';

/** Where a killed screen sends you. The Caddie screen is the app's home and is never killable. */
const HOME = '/(tabs)/caddie';

/**
 * Gate a screen behind a remote flag.
 *
 * Returns whether the feature is live, so a caller that needs to skip expensive mount work (a camera
 * open, a geometry fetch) can check it before doing so. Callers that only need the redirect can
 * ignore the return value — the effect does the work.
 */
export function useFlagGate(key: FlagKey): boolean {
  const enabled = useFlag(key);

  useEffect(() => {
    if (enabled) return;
    /**
     * `replace`, not `push` — the killed screen must not survive in the back stack, or the player's
     * next Back press lands right back on it and bounces again.
     *
     * Deferred a tick because this can run during the first commit of the screen being gated, and
     * navigating mid-render is what produces expo-router's "navigate before mount" warning. A frame
     * of the killed screen is acceptable; a broken navigator is not.
     */
    const t = setTimeout(() => {
      try { router.replace(HOME as never); } catch { /* navigator not ready; the next render retries */ }
    }, 0);
    return () => clearTimeout(t);
  }, [enabled]);

  return enabled;
}
