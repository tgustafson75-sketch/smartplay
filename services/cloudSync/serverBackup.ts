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
import { gatherSnapshot, applySnapshot, snapshotFingerprint } from './snapshot';

interface ServerBackupState {
  /** User-owned identifier (their email, lower-cased). Same value restores on a new phone. */
  backupKey: string;
  /** Passphrase — the SECRET half of the identity (2026-07-07 security fix). Without
   *  it, email alone can't read/overwrite the backup. Stored locally so auto-backup
   *  runs unattended; only its hash contribution ever reaches the server. */
  secret: string;
  /** Auto-backup on background / round-end when a key + secret are set. Default on. */
  autoOn: boolean;
  lastBackupAt: number | null;
  /** Fingerprint of the last snapshot uploaded — skip re-upload when unchanged. */
  lastFingerprint: string | null;
  setBackupKey: (v: string) => void;
  setSecret: (v: string) => void;
  setAutoOn: (v: boolean) => void;
  _setLast: (t: number, fp: string | null) => void;
}

export const useServerBackupStore = create<ServerBackupState>()(
  persist(
    (set) => ({
      backupKey: '',
      secret: '',
      autoOn: true,
      lastBackupAt: null,
      lastFingerprint: null,
      setBackupKey: (v) => set({ backupKey: v.trim().toLowerCase() }),
      setSecret: (v) => set({ secret: v }),
      setAutoOn: (v) => set({ autoOn: v }),
      _setLast: (t, fp) => set({ lastBackupAt: t, lastFingerprint: fp }),
    }),
    { name: 'server-backup-v1', storage: createJSONStorage(() => getPersistStorage()), version: 1, migrate: (s) => s as never },
  ),
);

/** True when a Backup ID + passphrase are set → auto-backup can run. */
export function serverBackupConfigured(): boolean {
  const s = useServerBackupStore.getState();
  return s.autoOn && s.backupKey.trim().length > 0 && s.secret.trim().length >= 4;
}

function apiUrl(): string {
  return getApiBaseUrl().replace(/\/+$/, '') + '/api/backup';
}

/**
 * Back up the current snapshot to the server under the stored key + secret.
 * `force` bypasses the unchanged-fingerprint skip (used by the manual "Back up now").
 */
export async function serverBackupNow(opts?: { force?: boolean }): Promise<{ ok: boolean; reason?: string }> {
  const st = useServerBackupStore.getState();
  const key = st.backupKey.trim().toLowerCase();
  const secret = st.secret.trim();
  if (!key) return { ok: false, reason: 'no_key' };
  if (secret.length < 4) return { ok: false, reason: 'no_secret' };
  try {
    const snapshot = await gatherSnapshot();
    // Skip the round-trip when nothing changed since the last successful backup.
    const fp = snapshotFingerprint(snapshot);
    if (!opts?.force && fp === st.lastFingerprint) return { ok: true, reason: 'unchanged' };
    const res = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, secret, data: snapshot }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (json.ok) { useServerBackupStore.getState()._setLast(Date.now(), fp); return { ok: true }; }
    return { ok: false, reason: json.error ?? `http_${res.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'network' };
  }
}

/** Restore the snapshot for a key from the server. Caller reloads the app after. */
export async function serverRestore(keyOverride?: string, secretOverride?: string): Promise<{ ok: boolean; restored: number; reason?: string }> {
  const st = useServerBackupStore.getState();
  const key = (keyOverride ?? st.backupKey).trim().toLowerCase();
  const secret = (secretOverride ?? st.secret).trim();
  if (!key) return { ok: false, restored: 0, reason: 'no_key' };
  if (secret.length < 4) return { ok: false, restored: 0, reason: 'no_secret' };
  try {
    const res = await fetch(`${apiUrl()}?key=${encodeURIComponent(key)}&secret=${encodeURIComponent(secret)}`, { method: 'GET' });
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
