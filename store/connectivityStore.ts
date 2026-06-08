/**
 * 2026-06-07 (audit) — reactive connectivity signal.
 *
 * The app had NO proactive online/offline state. Adding a native module
 * (NetInfo) would require a native rebuild and break OTA on existing
 * installs, so this infers connectivity REACTIVELY from network fetch
 * outcomes: repeated network-class failures → offline; any success →
 * online. Fed by the swing-analysis, voice/TTS, and brain fetch paths.
 *
 * Pure JS / Zustand — OTA-safe. A global banner reads `isOnline`.
 */

import { create } from 'zustand';

// Mark offline only after several consecutive network failures so a
// single blip doesn't flip the banner; clear instantly on first success.
const OFFLINE_AFTER = 3;

interface ConnectivityState {
  isOnline: boolean;
  consecutiveFailures: number;
  /** A network-class fetch failed (timeout / abort / no network). */
  reportNetworkFailure: () => void;
  /** Any network fetch succeeded → definitely online. */
  reportOnline: () => void;
}

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  isOnline: true,
  consecutiveFailures: 0,
  reportNetworkFailure: () => {
    const n = get().consecutiveFailures + 1;
    set({ consecutiveFailures: n, isOnline: n < OFFLINE_AFTER ? get().isOnline : false });
  },
  reportOnline: () => {
    if (get().consecutiveFailures !== 0 || !get().isOnline) {
      set({ consecutiveFailures: 0, isOnline: true });
    }
  },
}));

/** Non-hook helpers for service-layer fetch sites (avoid importing the
 *  hook into non-React modules). */
export function reportNetworkFailure(): void {
  useConnectivityStore.getState().reportNetworkFailure();
}
export function reportOnline(): void {
  useConnectivityStore.getState().reportOnline();
}
