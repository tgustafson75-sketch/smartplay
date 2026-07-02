/**
 * Cloud backup · auto-backup engine.
 *
 * Strategy (Simplified Sophistication — invisible): back up at natural, low-
 * frequency, high-value moments rather than on every keystroke —
 *   • when the app goes to the background (the user just finished doing a thing),
 *   • explicitly after a round ends (scheduleBackup() from endRound),
 * each debounced + fingerprint-gated so an unchanged snapshot never re-uploads.
 *
 * Fully inert until the cloud is configured AND the user is signed in.
 */

import { AppState, type AppStateStatus } from 'react-native';
import { isCloudConfigured } from './cloudClient';
import { backupNow, useCloudBackupStore, fetchCloudSnapshot } from './cloudBackup';

const DEBOUNCE_MS = 4000;
let timer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;

function canBackup(): boolean {
  if (!isCloudConfigured()) return false;
  const s = useCloudBackupStore.getState();
  return !!s.userId && s.autoBackupEnabled;
}

/** Debounced background backup. Safe to call often — coalesces + no-op gated. */
export function scheduleBackup(): void {
  if (!canBackup()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (canBackup()) void backupNow();
  }, DEBOUNCE_MS);
}

/** Fire a backup immediately (app backgrounding — don't wait out the debounce). */
function backupImmediate(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (canBackup()) void backupNow();
}

/** Install the AppState listener. Idempotent; call once at boot. */
export function initAutoBackup(): void {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'background' || next === 'inactive') backupImmediate();
  });
}

/**
 * Whether a restore should be OFFERED: the user is signed in, a cloud backup
 * exists, and the device looks freshly-installed (no rounds locally). Used to
 * prompt "Restore your data?" after sign-in on a new phone.
 */
export async function shouldOfferRestore(): Promise<{ offer: boolean; updatedAt: string | null }> {
  if (!canBackup() && !useCloudBackupStore.getState().userId) return { offer: false, updatedAt: null };
  try {
    const fetched = await fetchCloudSnapshot();
    if (!fetched) return { offer: false, updatedAt: null };
    // "Fresh device" heuristic: no rounds persisted locally yet.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
      getItem: (k: string) => Promise<string | null>;
    };
    const localRounds = await AsyncStorage.getItem('round-store-v1');
    let empty = true;
    if (localRounds) {
      try {
        const parsed = JSON.parse(localRounds);
        const hist = parsed?.state?.roundHistory;
        empty = !Array.isArray(hist) || hist.length === 0;
      } catch { empty = true; }
    }
    return { offer: empty, updatedAt: fetched.updatedAt };
  } catch {
    return { offer: false, updatedAt: null };
  }
}
