/**
 * Cloud backup · auto-backup engine.
 *
 * Strategy (Simplified Sophistication — invisible): back up at natural, low-
 * frequency, high-value moments rather than on every keystroke —
 *   • when the app goes to the background (the user just finished doing a thing),
 *   • explicitly after a round ends (scheduleBackup() from endRound),
 * each debounced + fingerprint-gated so an unchanged snapshot never re-uploads.
 *
 * Fully inert until a Backup ID + passphrase are configured in Settings.
 */

import { AppState, type AppStateStatus } from 'react-native';
/**
 * 2026-08-12 — the Supabase email-account ("OTP") backup path was DELETED, not disabled.
 *
 * It was a complete second implementation of backup that could never run: signing in was the only
 * thing that could set a user id, and requestLoginCode/verifyLoginCode had zero callers anywhere in
 * the app — no screen ever read its store. So every call returned `not_signed_in`, forever.
 *
 * It also cost more than dead weight. During the readiness pass I read that code as if it were live
 * and reported an App Store BLOCKER (Apple 5.1.1(v) requires in-app account deletion for any app
 * offering account creation) — for accounts the app cannot create. Dead code that looks live is
 * worse than no code, because it makes you wrong about your own app.
 *
 * The working path stays: server-mediated backup keyed by a Backup ID + passphrase the user sets in
 * Settings → Backup & Restore, which needs no account at all. [[server-mediated-backup]]
 */
import { serverBackupConfigured, serverBackupNow } from './serverBackup';

const DEBOUNCE_MS = 4000;
let timer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;

/** True when backup can run — a Backup ID + passphrase are set and auto-backup is on. */
function anyBackupPossible(): boolean {
  return serverBackupConfigured();
}

/** Fire the backup if it's configured (a safe no-op otherwise). */
function runBackups(): void {
  if (serverBackupConfigured()) void serverBackupNow();
}

/** Debounced background backup. Safe to call often — coalesces + no-op gated. */
export function scheduleBackup(): void {
  if (!anyBackupPossible()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runBackups();
  }, DEBOUNCE_MS);
}

/** Fire a backup immediately (app backgrounding — don't wait out the debounce). */
function backupImmediate(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  runBackups();
}

/** Install the AppState listener. Idempotent; call once at boot. */
export function initAutoBackup(): void {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
    // 2026-07-07 (audit) — only real backgrounding, NOT iOS 'inactive' transients
    // (call banner, Control Center, app-switcher peek, permission sheets), which
    // otherwise fired a redundant upload on every interruption.
    if (next === 'background') backupImmediate();
  });
}

