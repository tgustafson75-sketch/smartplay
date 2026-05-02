/**
 * Phase O — Earbud media-key event listener.
 *
 * KNOWN GAP: real Bluetooth earbud media-key event capture (single-tap
 * play/pause) is not available in Expo managed workflow without a native
 * module. The cross-platform options:
 *   - iOS: MPRemoteCommandCenter.shared().togglePlayPauseCommand
 *   - Android: MediaSession + PlaybackStateCompat key-event handling
 *   - react-native-track-player config plugin (most robust, requires dev-client rebuild)
 *
 * This module ships the EVENT-BUS shape that any of those backends will
 * fire into. Today: nothing fires `notifyEarbudTap()` from a real earbud,
 * but the listening-session orchestration is wired to it. A small on-screen
 * "Tap to talk" button provides a manual fallback for testing the orchestration
 * end-to-end (consumer surfaces can render the button when desired).
 *
 * When a native key-event detector lands, the only required change is
 * calling `notifyEarbudTap()` from that detector's callback. No consumer
 * site changes.
 */

type Listener = () => void;

const listeners: Set<Listener> = new Set();
let enabled = true;

/**
 * Subscribe to earbud-tap events. Returns an unsubscribe function.
 */
export function subscribeEarbudTap(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Invoked by the native key-event detector (when it ships) on every
 * single-tap. Today also invoked by the manual "Tap to talk" fallback
 * button so the listening-session orchestration is testable end-to-end.
 */
export function notifyEarbudTap(): void {
  if (!enabled) return;
  listeners.forEach(l => {
    try { l(); } catch (e) { console.log('[earbudControl] listener err', e); }
  });
}

/**
 * Settings toggle wires this. When disabled, taps are silently ignored
 * (no listener invocation). Default: enabled.
 */
export function setEnabled(value: boolean): void {
  enabled = value;
}

export function isEnabled(): boolean {
  return enabled;
}
