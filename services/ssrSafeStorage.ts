/**
 * Phase 200 / F14 — SSR-safe AsyncStorage wrapper.
 *
 * The Vercel web target (app.json `web.output: "server"`) renders
 * Zustand-persisted stores during SSR. AsyncStorage's web shim reads
 * `window.localStorage`; SSR has no window → ReferenceError + the dreaded
 * `[roundStore] rehydrate error: ReferenceError: window is not defined`
 * line in Metro logs (audit-100-functional-state.md F14).
 *
 * This module returns a noop storage shim during SSR (no `window`) and
 * the real AsyncStorage during native + client-side web. Stores import
 * `getPersistStorage()` instead of AsyncStorage directly.
 *
 * The noop returns null for getItem (so Zustand uses the in-memory
 * default state during SSR) and silently swallows setItem/removeItem
 * (so the SSR render doesn't try to persist anything that wouldn't
 * survive the request).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

const isServer = (): boolean => {
  // 1. window is the React Native / browser global. SSR has no window.
  // 2. typeof guard handles undeclared-global ReferenceError on Hermes.
  return typeof window === 'undefined';
};

const noopStorage: StateStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

// 2026-06-14 (audit fix — "silent round-save loss") — zustand persist writes via
// AsyncStorage.setItem; a quota/disk/OS-denied rejection was swallowed, so a lost
// round (the documented round killer) left NO breadcrumb. Wrap the real storage so
// every write failure logs to the owner issue log + console. Best-effort: the log
// hop is itself try/caught, and we skip the issueLog store's own key to avoid a
// write→fail→log→write loop.
const ISSUE_LOG_KEY = 'issue-log-v1';
function reportPersistFailure(key: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.log('[persist] setItem FAILED for', key, '—', msg);
  if (key === ISSUE_LOG_KEY) return; // never recurse into the log we're writing to
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../store/issueLogStore').useIssueLogStore.getState().addAppEvent('persist_write_failed', {
      store_key: key,
      error: msg.slice(0, 200),
    }, 'app_error');
  } catch { /* logging is best-effort */ }
}

const guardedStorage: StateStorage = {
  /**
   * 2026-08-14 (Tim's round — app opened to a white screen, no splash greeting, and taps landed but
   * did nothing; rolling the bundle back changed nothing).
   *
   * READS were unguarded while writes were guarded, and that asymmetry is the whole bug. A single
   * corrupt or unparseable persisted value made rehydration reject, and _layout.tsx gates SEVEN
   * effects behind whenRoundStoreHydrated() — the greeting, the round lifecycle, GPS. When hydration
   * never reports finished, none of them ever run: the shell paints (so a text input still takes a
   * tap) and nothing behind it is alive. A white, dead app.
   *
   * It also explains why rolling back the OTA did nothing. The bad value is on the DEVICE, so every
   * bundle reads the same poison — the app could not recover itself, and there was no way out from
   * inside the UI because the UI was what died.
   *
   * A store that cannot read its saved state must start EMPTY, not take the app down with it. Losing
   * one store's history is a bad day; an app that will not open is a brick. Returning null makes
   * zustand fall back to initial state and re-persist cleanly on the next write.
   */
  getItem: async (name) => {
    try {
      const raw = await (AsyncStorage as unknown as StateStorage).getItem(name);
      if (raw == null) return null;
      /**
       * VALIDATE THE JSON HERE, not downstream. zustand's createJSONStorage runs JSON.parse on
       * whatever this returns, and a throw there happens OUTSIDE this try — which is exactly the hole
       * that let one truncated write take the whole app down. Parsing it ourselves means the value
       * either round-trips or never leaves this function.
       *
       * A partial write is the realistic cause: AsyncStorage is not atomic across a process kill, so
       * a round saved while Android was reclaiming memory can land as half a JSON object.
       */
      JSON.parse(raw);
      return raw;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('[persist] getItem FAILED for', name, '— starting this store EMPTY:', msg);
      try {
        // Best-effort: drop the unreadable value so it cannot poison every future launch.
        await (AsyncStorage as unknown as StateStorage).removeItem(name);
      } catch { /* nothing more we can do; null below still keeps the app alive */ }
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await (AsyncStorage as unknown as StateStorage).setItem(name, value);
    } catch (err) {
      reportPersistFailure(name, err);
      throw err; // preserve zustand's own awareness of the rejection
    }
  },
  removeItem: (name) => (AsyncStorage as unknown as StateStorage).removeItem(name),
};

export function getPersistStorage(): StateStorage {
  return isServer() ? noopStorage : guardedStorage;
}
