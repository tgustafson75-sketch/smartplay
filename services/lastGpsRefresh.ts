/**
 * Last GPS-refresh timestamp tracking. Lightweight singleton — no
 * Zustand store needed for a single integer. AsyncStorage-backed so the
 * value survives restart; rehydrates on first read.
 *
 * UI surfaces (Tools menu Refresh GPS row, settings if added) read via
 * useLastGpsRefresh() to display "Refreshed 2 min ago" subtitle.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = 'smartplay.lastGpsRefreshAt';
let cached: number | null = null;
let hydrated = false;
const listeners = new Set<(ts: number | null) => void>();

async function rehydrate(): Promise<void> {
  if (hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) cached = n;
    }
  } catch { /* noop */ }
  hydrated = true;
}

export function getLastGpsRefreshAt(): number | null {
  if (!hydrated) void rehydrate().then(() => notifyAll());
  return cached;
}

export async function markGpsRefreshNow(): Promise<void> {
  cached = Date.now();
  try { await AsyncStorage.setItem(KEY, String(cached)); } catch { /* noop */ }
  notifyAll();
}

function notifyAll() {
  for (const l of listeners) {
    try { l(cached); } catch { /* noop */ }
  }
}

/** React hook — returns the latest timestamp and re-renders on update. */
export function useLastGpsRefresh(): number | null {
  const [ts, setTs] = useState<number | null>(cached);
  useEffect(() => {
    if (!hydrated) void rehydrate().then(() => setTs(cached));
    listeners.add(setTs);
    return () => { listeners.delete(setTs); };
  }, []);
  return ts;
}

/** Format helper. "just now" / "2m ago" / "1h 12m ago" / "Mar 5 4:22 PM". */
export function formatRefreshAge(ts: number | null, now: number = Date.now()): string {
  if (ts == null) return 'never';
  const ageMs = now - ts;
  if (ageMs < 30_000) return 'just now';
  if (ageMs < 60 * 60_000) {
    const m = Math.round(ageMs / 60_000);
    return `${m}m ago`;
  }
  if (ageMs < 24 * 60 * 60_000) {
    const h = Math.floor(ageMs / (60 * 60_000));
    const m = Math.round((ageMs - h * 60 * 60_000) / 60_000);
    return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
