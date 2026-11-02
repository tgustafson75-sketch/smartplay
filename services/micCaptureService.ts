/**
 * 2026-11-01 — Microphone foreground service, phone side (Android).
 *
 * Keeps android-native/MicCaptureService running for the life of a round, so an earbud tap with the
 * phone locked can still reach the caddie. ONE owner: this module subscribes to the round store and
 * starts/stops the service on the round's own transitions, so no screen or voice path calls it.
 *
 * Start is only attempted while the app is on screen (round start happens on a tap). Android 14+ refuses
 * a microphone foreground service started from the background, and the native side answers that with
 * `false`. A false is not an error here: the round runs as it did before, without the lock-screen
 * guarantee. An old binary without the module resolves false too, so this is safe on every build.
 */
import { NativeModules, Platform } from 'react-native';
import { useRoundStore } from '../store/roundStore';
import { devLog } from './devLog';

type MicCaptureNative = {
  startMicForeground(): Promise<boolean>;
  stopMicForeground(): Promise<boolean>;
};

/** Start or stop the service. Resolves false when unavailable or refused — never throws. */
export async function setMicForeground(on: boolean): Promise<boolean> {
  const mod = (NativeModules as { MicCapture?: MicCaptureNative }).MicCapture;
  if (Platform.OS !== 'android' || !mod) return false;
  try {
    return on ? await mod.startMicForeground() : await mod.stopMicForeground();
  } catch (e) {
    devLog(`[micCapture] ${on ? 'start' : 'stop'} failed: ${String(e)}`);
    return false;
  }
}

let unsubscribe: (() => void) | null = null;

/** Follow the round: on when a round is active, off when it ends. Idempotent. */
export function startMicCaptureOnRound(): void {
  if (unsubscribe) return;
  let last = !!useRoundStore.getState().isRoundActive;
  if (last) void setMicForeground(true);
  unsubscribe = useRoundStore.subscribe((s) => {
    const active = !!s.isRoundActive;
    if (active === last) return;
    last = active;
    void setMicForeground(active);
  });
}

export function stopMicCaptureOnRound(): void {
  try { unsubscribe?.(); } catch { /* non-fatal */ }
  unsubscribe = null;
}
