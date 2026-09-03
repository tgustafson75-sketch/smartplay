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
import { isTransientFailure, waitMs, RETRY_BACKOFF_MS } from '../../utils/transientRetry';
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
 * 2026-09-03 — BOTH CALLS WERE UNBOUNDED, on the one network this app is designed for.
 *
 * Neither the backup POST nor the restore GET carried a timeout. React Native's fetch has no
 * default one, so on a marginal course connection — the normal case, not the edge — the promise
 * simply never settles. The try/catch meant it could not crash; it meant it could hang instead.
 *
 * That surfaced as a stuck screen. CloudBackupCard does setServerBusy(true), awaits, then
 * setServerBusy(false) — so a request that never resolves leaves the button spinning forever with
 * no alert either way, on the screen a player opens precisely when they are anxious about their
 * data. And the payload can be megabytes: api/backup caps at 8 MB.
 *
 * 35s rather than something tighter because api/backup's own platform budget is 30s — the server
 * should always be the one to give up first, so a real answer (including its honest error) wins
 * over a client-side abort whenever one is coming. [[the-client-must-be-the-last-to-give-up]]
 */
const REQUEST_TIMEOUT_MS = 35_000;

function failureReason(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timed_out';
  return e instanceof Error ? e.message : 'network';
}

/**
 * 2026-09-03 (Tim: "don't build error states, make it work") — RETRY, don't report.
 *
 * The first version of this fix bounded the request and then wrote the player a nicer message about
 * having failed. Wrong instinct: a dropped connection on a golf course is the EXPECTED condition
 * here, not an exception, and the job is to get the data up anyway rather than to describe not
 * having done so.
 *
 * The policy itself now lives in utils/transientRetry, shared with the swing-review path. It was
 * duplicated here for about an hour, which is exactly long enough for two copies to disagree the
 * first time one is tightened — the defect this session has fixed in the privacy policy, the
 * handicap differential and the YouTube player already. The BROAD status form is right for this
 * call specifically: a backup POST is small and idempotent, so a handler 500 is worth one more go,
 * unlike a 45-second analysis route where repeating it just triples the cost.
 * [[two-owners-is-the-root-cause]]
 */
/** Run an attempt up to MAX_ATTEMPTS times while the failure looks like the connection, not the request. */
// Attempts are DERIVED from the shared backoff schedule rather than restated, so tightening the
// schedule in one place cannot leave a second constant disagreeing about how many tries there are.
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

async function withRetry<T extends { ok: boolean; reason?: string }>(attempt: () => Promise<T>): Promise<T> {
  let last = await attempt();
  for (let i = 0; last.ok !== true && i < MAX_ATTEMPTS - 1; i++) {
    if (!isTransientFailure(last.reason)) return last;
    await waitMs(RETRY_BACKOFF_MS[i] ?? 2400);
    last = await attempt();
  }
  return last;
}

/**
 * Back up the current snapshot to the server under the stored key + secret.
 * `force` bypasses the unchanged-fingerprint skip (used by the manual "Back up now").
 */
export async function serverBackupNow(opts?: { force?: boolean }): Promise<{ ok: boolean; reason?: string }> {
  return withRetry(() => serverBackupAttempt(opts));
}

async function serverBackupAttempt(opts?: { force?: boolean }): Promise<{ ok: boolean; reason?: string }> {
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (json.ok) { useServerBackupStore.getState()._setLast(Date.now(), fp); return { ok: true }; }
    return { ok: false, reason: json.error ?? `http_${res.status}` };
  } catch (e) {
    return { ok: false, reason: failureReason(e) };
  }
}

/** Restore the snapshot for a key from the server. Caller reloads the app after. */
export async function serverRestore(keyOverride?: string, secretOverride?: string): Promise<{ ok: boolean; restored: number; reason?: string }> {
  return withRetry(() => serverRestoreAttempt(keyOverride, secretOverride));
}

async function serverRestoreAttempt(keyOverride?: string, secretOverride?: string): Promise<{ ok: boolean; restored: number; reason?: string }> {
  const st = useServerBackupStore.getState();
  const key = (keyOverride ?? st.backupKey).trim().toLowerCase();
  const secret = (secretOverride ?? st.secret).trim();
  if (!key) return { ok: false, restored: 0, reason: 'no_key' };
  if (secret.length < 4) return { ok: false, restored: 0, reason: 'no_secret' };
  try {
    const res = await fetch(`${apiUrl()}?key=${encodeURIComponent(key)}&secret=${encodeURIComponent(secret)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; found?: boolean; data?: unknown; error?: string };
    if (!json.ok) return { ok: false, restored: 0, reason: json.error ?? `http_${res.status}` };
    if (!json.found || json.data == null || typeof json.data !== 'object') return { ok: false, restored: 0, reason: 'not_found' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restored = await applySnapshot(json.data as any);
    return { ok: true, restored };
  } catch (e) {
    return { ok: false, restored: 0, reason: failureReason(e) };
  }
}
