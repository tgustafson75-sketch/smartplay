/**
 * Phase O.5 — Web stub for the native media-key bridge.
 *
 * react-native-track-player has no usable web entry (its web build pulls in
 * shaka-player for HLS, which we don't ship). This stub satisfies Metro's
 * static analysis on web bundles. Bluetooth media-key capture is irrelevant
 * on web anyway — earbud-tap-to-talk is a mobile feature.
 *
 * Metro's platform-specific extension resolution picks `.web.ts` here for
 * web bundles and falls back to `mediaKeyBridge.ts` for iOS/Android.
 */

export async function activateMediaSession(): Promise<void> {
  // no-op on web
}

export async function deactivateMediaSession(): Promise<void> {
  // no-op on web
}

export function isMediaSessionActive(): boolean {
  return false;
}
