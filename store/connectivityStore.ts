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
 *
 * 2026-10-15 — failures are now a SUSPICION, not a verdict. The banner reads "No signal", and three
 * failed calls to OUR backend said nothing about the player's signal: a cold Lambda or a bad deploy
 * fails exactly the same way, and the banner then told a player on full 5G that their signal was the
 * problem. Reaching the threshold now asks services/reachability (hosts that are not ours); only a
 * proven 'offline' / 'captive' raises the banner.
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
  /** The reachability probe PROVED the phone has no internet — raise the banner now. */
  reportVerifiedOffline: () => void;
}

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  isOnline: true,
  consecutiveFailures: 0,
  reportNetworkFailure: () => {
    const n = get().consecutiveFailures + 1;
    set({ consecutiveFailures: n });
    if (n < OFFLINE_AFTER || !get().isOnline) return;
    void verifyOffline().then((offline) => {
      // A success that landed while the probe ran wins — it reset the count.
      if (offline && get().consecutiveFailures >= OFFLINE_AFTER) set({ isOnline: false });
    });
  },
  reportVerifiedOffline: () => {
    if (get().isOnline) set({ isOnline: false });
  },
  reportOnline: () => {
    if (get().consecutiveFailures !== 0 || !get().isOnline) {
      set({ consecutiveFailures: 0, isOnline: true });
    }
  },
}));

/** True only when the probe proved there is no internet. Lazy require: the store must not pull the
 *  service graph in at import time. */
async function verifyOffline(): Promise<boolean> {
  try {
    const { probeReachability, isProvenOffline } = require('../services/reachability') as typeof import('../services/reachability');
    return isProvenOffline((await probeReachability()).verdict);
  } catch {
    return false;
  }
}

/** Non-hook helpers for service-layer fetch sites (avoid importing the
 *  hook into non-React modules). */
export function reportNetworkFailure(): void {
  useConnectivityStore.getState().reportNetworkFailure();
}
export function reportOnline(): void {
  useConnectivityStore.getState().reportOnline();
}
export function reportVerifiedOffline(): void {
  useConnectivityStore.getState().reportVerifiedOffline();
}
