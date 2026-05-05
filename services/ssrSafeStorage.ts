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

export function getPersistStorage(): StateStorage {
  return isServer() ? noopStorage : (AsyncStorage as unknown as StateStorage);
}
