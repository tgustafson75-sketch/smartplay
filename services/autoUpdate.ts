import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

/**
 * Auto OTA update check. Ported from V3 services/updates/autoUpdate.ts.
 *
 * Boots quietly: on app start, asks EAS Update if a newer JS bundle
 * exists for the current runtime version. If yes, downloads in
 * background and notifies the listener (so the UI can prompt for a
 * reload at a non-disruptive moment instead of yanking the user
 * mid-shot).
 *
 * Failures swallowed — never block boot or surface error toasts. EAS
 * unreachable / no update available / dev mode all resolve to
 * { ready: false }.
 *
 * Runtime version policy is `appVersion` (set in app.json), which means
 * OTA only fires for matching app version. Native module changes still
 * require a new dev build, but JS bundles ship freely.
 */

export type UpdateStatus =
  | { ready: false; reason: 'dev' | 'no-update' | 'error' | 'pending' }
  | { ready: true };

let cached: UpdateStatus | null = null;
type Listener = (status: UpdateStatus) => void;
const listeners = new Set<Listener>();

function emit(status: UpdateStatus): void {
  cached = status;
  listeners.forEach((fn) => {
    try { fn(status); } catch { /* ignore listener errors */ }
  });
}

export function subscribeToUpdates(listener: Listener): () => void {
  listeners.add(listener);
  if (cached) listener(cached);
  return () => { listeners.delete(listener); };
}

export async function checkAndFetchUpdate(): Promise<UpdateStatus> {
  if (__DEV__ || Platform.OS === 'web' || !Updates.isEnabled) {
    const status: UpdateStatus = { ready: false, reason: 'dev' };
    emit(status);
    return status;
  }
  emit({ ready: false, reason: 'pending' });
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      const status: UpdateStatus = { ready: false, reason: 'no-update' };
      emit(status);
      return status;
    }
    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched.isNew) {
      const status: UpdateStatus = { ready: false, reason: 'no-update' };
      emit(status);
      return status;
    }
    const status: UpdateStatus = { ready: true };
    emit(status);
    return status;
  } catch {
    const status: UpdateStatus = { ready: false, reason: 'error' };
    emit(status);
    return status;
  }
}

export async function applyUpdate(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    /* swallow — reload from a non-update path will just no-op */
  }
}
