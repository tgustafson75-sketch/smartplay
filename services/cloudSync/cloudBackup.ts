/**
 * Cloud backup · auth (email OTP) + backup/restore service + status store.
 *
 * Identity = Supabase Auth email OTP (a 6-digit code / magic link, no password).
 * Data = one per-user row in smartplay.backups (RLS-scoped to auth.uid()), holding
 * the structured snapshot from ./snapshot.ts. v1 = structured data only.
 *
 * Everything degrades gracefully when the cloud isn't configured (isCloudConfigured
 * false) or the user isn't signed in — callers never crash, the UI shows honest state.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import Constants from 'expo-constants';
import { getPersistStorage } from '../ssrSafeStorage';
import { getCloudClient, isCloudConfigured } from './cloudClient';
import { gatherSnapshot, applySnapshot, snapshotFingerprint, SNAPSHOT_SCHEMA_VERSION, type Snapshot } from './snapshot';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKUPS_TABLE = 'backups';
const DEVICE_ID_KEY = 'cloud-backup-device-id';

type BackupStatus = 'idle' | 'sending_code' | 'verifying' | 'backing_up' | 'restoring' | 'error';

interface CloudBackupState {
  /** Signed-in account email (null = signed out). */
  email: string | null;
  userId: string | null;
  autoBackupEnabled: boolean;
  lastBackupAt: number | null;
  lastFingerprint: string | null;
  status: BackupStatus;
  lastError: string | null;
  setStatus: (status: BackupStatus, error?: string | null) => void;
  setAccount: (email: string | null, userId: string | null) => void;
  setAutoBackup: (on: boolean) => void;
  markBackedUp: (fingerprint: string, at: number) => void;
}

export const useCloudBackupStore = create<CloudBackupState>()(
  persist(
    (set) => ({
      email: null,
      userId: null,
      autoBackupEnabled: true,
      lastBackupAt: null,
      lastFingerprint: null,
      status: 'idle',
      lastError: null,
      setStatus: (status, error = null) => set({ status, lastError: error }),
      setAccount: (email, userId) => set({ email, userId }),
      setAutoBackup: (on) => set({ autoBackupEnabled: on }),
      markBackedUp: (fingerprint, at) => set({ lastFingerprint: fingerprint, lastBackupAt: at, status: 'idle', lastError: null }),
    }),
    {
      name: 'cloud-backup-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      version: 1,
      migrate: (p) => p as CloudBackupState,
      // Never persist transient status/error; keep account + sync bookkeeping.
      partialize: (s) => ({
        email: s.email,
        userId: s.userId,
        autoBackupEnabled: s.autoBackupEnabled,
        lastBackupAt: s.lastBackupAt,
        lastFingerprint: s.lastFingerprint,
      }),
    },
  ),
);

async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    // Stable-enough id; not security-sensitive (last-writer diagnostics only).
    const id = `dev_${Math.abs(hashStr(String(Constants.sessionId ?? '') + String(Constants.installationId ?? '') + String(Date.now()))).toString(36)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return 'dev_unknown';
  }
}
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}
function appVersion(): string {
  try {
    return String((Constants.expoConfig?.version as string | undefined) ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

export type CloudResult = { ok: true } | { ok: false; reason: string };

/** Step 1 — send a login code to the email. Creates the account on first use. */
export async function requestLoginCode(email: string): Promise<CloudResult> {
  const client = getCloudClient();
  if (!client) return { ok: false, reason: 'not_configured' };
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, reason: 'bad_email' };
  useCloudBackupStore.getState().setStatus('sending_code');
  try {
    const { error } = await client.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true } });
    if (error) { useCloudBackupStore.getState().setStatus('error', error.message); return { ok: false, reason: error.message }; }
    useCloudBackupStore.getState().setStatus('idle');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'send_failed';
    useCloudBackupStore.getState().setStatus('error', msg);
    return { ok: false, reason: msg };
  }
}

/** Step 2 — verify the 6-digit code → establishes the session. */
export async function verifyLoginCode(email: string, code: string): Promise<CloudResult> {
  const client = getCloudClient();
  if (!client) return { ok: false, reason: 'not_configured' };
  const clean = email.trim().toLowerCase();
  useCloudBackupStore.getState().setStatus('verifying');
  try {
    const { data, error } = await client.auth.verifyOtp({ email: clean, token: code.trim(), type: 'email' });
    if (error || !data.user) { const m = error?.message ?? 'verify_failed'; useCloudBackupStore.getState().setStatus('error', m); return { ok: false, reason: m }; }
    useCloudBackupStore.getState().setAccount(clean, data.user.id);
    useCloudBackupStore.getState().setStatus('idle');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'verify_failed';
    useCloudBackupStore.getState().setStatus('error', msg);
    return { ok: false, reason: msg };
  }
}

export async function signOutCloud(): Promise<void> {
  const client = getCloudClient();
  try { await client?.auth.signOut(); } catch { /* best-effort */ }
  useCloudBackupStore.getState().setAccount(null, null);
}

/** Re-hydrate account state from a persisted Supabase session (call at boot). */
export async function refreshCloudSession(): Promise<void> {
  const client = getCloudClient();
  if (!client) return;
  try {
    const { data } = await client.auth.getUser();
    if (data.user) useCloudBackupStore.getState().setAccount(data.user.email ?? null, data.user.id);
    else useCloudBackupStore.getState().setAccount(null, null);
  } catch { /* offline / no session — leave as-is */ }
}

/**
 * Push the current structured snapshot to the cloud. `force` uploads even when
 * the fingerprint is unchanged (used by the manual "Back up now" button); the
 * auto path skips a no-op upload.
 */
export async function backupNow(opts?: { force?: boolean }): Promise<CloudResult> {
  const client = getCloudClient();
  if (!client) return { ok: false, reason: 'not_configured' };
  const { userId, email } = useCloudBackupStore.getState();
  if (!userId) return { ok: false, reason: 'not_signed_in' };
  try {
    const snapshot = await gatherSnapshot();
    const fp = snapshotFingerprint(snapshot);
    if (!opts?.force && fp === useCloudBackupStore.getState().lastFingerprint) {
      return { ok: true }; // nothing changed
    }
    useCloudBackupStore.getState().setStatus('backing_up');
    const deviceId = await getDeviceId();
    const { error } = await client.from(BACKUPS_TABLE).upsert({
      user_id: userId,
      email,
      schema_version: SNAPSHOT_SCHEMA_VERSION,
      app_version: appVersion(),
      device_id: deviceId,
      payload: snapshot,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) { useCloudBackupStore.getState().setStatus('error', error.message); return { ok: false, reason: error.message }; }
    useCloudBackupStore.getState().markBackedUp(fp, Date.now());
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'backup_failed';
    useCloudBackupStore.getState().setStatus('error', msg);
    return { ok: false, reason: msg };
  }
}

/** Fetch the latest cloud snapshot for the signed-in user (does NOT apply it). */
export async function fetchCloudSnapshot(): Promise<{ snapshot: Snapshot; updatedAt: string | null } | null> {
  const client = getCloudClient();
  if (!client) return null;
  const { userId } = useCloudBackupStore.getState();
  if (!userId) return null;
  try {
    const { data, error } = await client.from(BACKUPS_TABLE).select('payload, updated_at').eq('user_id', userId).maybeSingle();
    if (error || !data?.payload) return null;
    return { snapshot: data.payload as Snapshot, updatedAt: (data.updated_at as string | null) ?? null };
  } catch {
    return null;
  }
}

/**
 * Restore the cloud snapshot onto the device. Writes AsyncStorage; the CALLER
 * must reload the app (or restart) so the stores rehydrate from the restored
 * values. Returns the number of stores restored.
 */
export async function restoreFromCloud(): Promise<{ ok: boolean; restored: number; reason?: string }> {
  if (!isCloudConfigured()) return { ok: false, restored: 0, reason: 'not_configured' };
  useCloudBackupStore.getState().setStatus('restoring');
  try {
    const fetched = await fetchCloudSnapshot();
    if (!fetched) { useCloudBackupStore.getState().setStatus('idle'); return { ok: false, restored: 0, reason: 'no_backup' }; }
    const restored = await applySnapshot(fetched.snapshot);
    // 2026-07-01 (re-audit) — after a restore the on-device data now EQUALS the cloud
    // snapshot, so record its fingerprint as the last-backed-up state. Prevents the
    // next auto-backup from redundantly re-uploading identical data post-reload.
    useCloudBackupStore.getState().markBackedUp(snapshotFingerprint(fetched.snapshot), Date.now());
    useCloudBackupStore.getState().setStatus('idle');
    return { ok: true, restored };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'restore_failed';
    useCloudBackupStore.getState().setStatus('error', msg);
    return { ok: false, restored: 0, reason: msg };
  }
}
