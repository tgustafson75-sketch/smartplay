/**
 * 2026-08-30 — STORES THAT MUST NEVER CROSS THE WIRE, in one place both sides can read.
 *
 * These hold OTHER PEOPLE'S data — family members (children among them), guests added to a round,
 * relationship notes, and team intelligence. Tim's call: back up the account holder's own data only.
 *
 * Removing them from the upload allowlist earlier today was necessary and NOT sufficient. The server
 * merges rather than replaces (`{ ...prev, ...next }` in api/backup.ts, deliberately, so a fresh
 * phone with a near-empty snapshot cannot wipe the cloud) — so a key already stored simply SURVIVES
 * every later snapshot that omits it. Beta backups would have kept that data indefinitely and handed
 * it back on every restore.
 *
 * So the list has to be enforced at three points, and this file is what stops those three drifting:
 *   1. services/cloudSync/snapshot.ts — never gathered for upload
 *   2. api/backup.ts POST            — stripped from what is stored, which PURGES on next backup
 *   3. api/backup.ts GET + applySnapshot — never handed back, so an old blob cannot re-seed a device
 *
 * ZERO IMPORTS, deliberately: api/* runs as a Node serverless function and cannot pull in
 * AsyncStorage or any zustand store, which is exactly why the same literals would otherwise have
 * been copied into the handler. [[two-owners-is-the-root-cause]]
 */
export const NEVER_SYNC_STORE_KEYS: readonly string[] = [
  'family-store-v1',
  'guest-profiles-v1',
  'relationship-store-v1',
  'team-intelligence-store-v1',
] as const;

/** Strip every never-sync key from a snapshot blob. Returns a new object; never mutates. */
export function stripNeverSyncKeys<T extends Record<string, unknown>>(blob: T): T {
  const out = { ...blob };
  for (const k of NEVER_SYNC_STORE_KEYS) delete out[k];
  return out;
}
