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
