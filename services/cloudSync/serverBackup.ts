/**
 * 2026-07-06 — Server-mediated backup (client side). The OTA path around the empty
 * client Supabase key: we POST the snapshot to OUR API (/api/backup), and the server
 * writes it to Supabase with its service key. No client key, no sign-in flow — the
 * user just picks a Backup ID (their email) that identifies their data on any phone.
 *
 * Shares the exact gather/apply core as local + cloud backup (./snapshot.ts).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../ssrSafeStorage';
import { getApiBaseUrl } from '../apiBase';
import { gatherSnapshot, applySnapshot } from './snapshot';

interface ServerBackupState {
  /** User-owned identifier (their email, lower-cased). Same value restores on a new phone. */
  backupKey: string;
  /** Auto-backup on background / round-end when a key is set. Default on. */
  autoOn: boolean;
  lastBackupAt: number | null;
  setBackupKey: (v: string) => void;
  setAutoOn: (v: boolean) => void;
  _setLast: (t: number) => void;
}

export const useServerBackupStore = create<ServerBackupState>()(
  persist(
    (set) => ({
      backupKey: '',
      autoOn: true,
      lastBackupAt: null,
      setBackupKey: (v) => set({ backupKey: v.trim().toLowerCase() }),
      setAutoOn: (v) => set({ autoOn: v }),
      _setLast: (t) => set({ lastBackupAt: t }),
    }),
    { name: 'server-backup-v1', storage: createJSONStorage(() => getPersistStorage()), version: 1, migrate: (s) => s as never },
  ),
);

/** True when the user has set a Backup ID → auto-backup can run. */
export function serverBackupConfigured(): boolean {
  const s = useServerBackupStore.getState();
  return s.autoOn && s.backupKey.trim().length > 0;
}

function apiUrl(): string {
  return getApiBaseUrl().replace(/\/+$/, '') + '/api/backup';
}

/** Back up the current snapshot to the server under the given key (or the stored one). */
export async function serverBackupNow(keyOverride?: string): Promise<{ ok: boolean; reason?: string }> {
  const key = (keyOverride ?? useServerBackupStore.getState().backupKey).trim().toLowerCase();
  if (!key) return { ok: false, reason: 'no_key' };
  try {
    const snapshot = await gatherSnapshot();
    const res = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, data: snapshot }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (json.ok) { useServerBackupStore.getState()._setLast(Date.now()); return { ok: true }; }
    return { ok: false, reason: json.error ?? `http_${res.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'network' };
  }
}

/** Restore the snapshot for a key from the server. Caller reloads the app after. */
export async function serverRestore(keyOverride?: string): Promise<{ ok: boolean; restored: number; reason?: string }> {
  const key = (keyOverride ?? useServerBackupStore.getState().backupKey).trim().toLowerCase();
  if (!key) return { ok: false, restored: 0, reason: 'no_key' };
  try {
    const res = await fetch(`${apiUrl()}?key=${encodeURIComponent(key)}`, { method: 'GET' });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; found?: boolean; data?: unknown; error?: string };
    if (!json.ok) return { ok: false, restored: 0, reason: json.error ?? `http_${res.status}` };
    if (!json.found || json.data == null || typeof json.data !== 'object') return { ok: false, restored: 0, reason: 'not_found' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restored = await applySnapshot(json.data as any);
    return { ok: true, restored };
  } catch (e) {
    return { ok: false, restored: 0, reason: e instanceof Error ? e.message : 'network' };
  }
}
