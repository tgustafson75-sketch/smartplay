/**
 * Safe back navigation.
 *
 * Many screens are reachable as deep links (push notifications, EAS
 * cold-start, voice intents) where the navigation stack is empty. Calling
 * router.back() in that state crashes Expo Router. This helper falls back
 * to a known-safe destination when there's nothing to pop to.
 */

import { router } from 'expo-router';

const FALLBACK = '/(tabs)/caddie';

export function safeBack(fallback: string = FALLBACK): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback as never);
}

/**
 * 2026-09-15 (Tim, from the phone — "home course loop is not fixed") — GOING TO A TAB FROM A SCREEN
 * THAT IS SITTING ON TOP OF THE TABS.
 *
 * `router.push('/(tabs)/play')` from a pushed screen does NOT switch tabs. Expo Router resolves the
 * divergence at the ROOT STACK — the focused route there is `profile`, the target is `(tabs)` — so a
 * PUSH dispatches to the root stack and mounts a SECOND copy of the whole tab navigator on top of
 * the profile screen. The stack becomes [(tabs), profile, (tabs)].
 *
 * That is the loop. Profile's "Choose home courses" jumped to Play; from that second tab bar the
 * dashboard's profile card pushed Profile again, which jumped to Play again, and so on — the back
 * button walks Play → Profile → Play → Profile without ever reaching the bottom, and each lap leaves
 * another live tab navigator behind it.
 *
 * `dismissTo` dispatches POP_TO instead: it pops back to the `(tabs)` entry already in the stack and
 * hands it the target tab in its params, which the tab navigator consumes and navigates to. One tab
 * navigator, and the back stack gets SHORTER rather than longer. React Navigation's POP_TO falls back
 * to replacing the current route when the target is not below (a deep link straight into a pushed
 * screen), so there is no state in which this strands the player.
 *
 * Call this from anywhere OUTSIDE app/(tabs)/. Inside the tab navigator a plain push is already
 * resolved as a tab jump and is fine.
 */
export function goToTab(tab: 'caddie' | 'dashboard' | 'play' | 'scorecard' | 'swinglab'): void {
  router.dismissTo(`/(tabs)/${tab}` as never);
}
