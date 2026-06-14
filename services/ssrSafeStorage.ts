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
  getItem: (name) => (AsyncStorage as unknown as StateStorage).getItem(name),
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
