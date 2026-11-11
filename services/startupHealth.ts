/**
 * 2026-11-10 — SELF-HEAL v1: STARTUP HEALTH CHECK (smartplay-gate docs/SELF-HEAL-STANDARD.md).
 *
 * "On launch the app checks its own config and the services it needs, and reports a failure
 * instead of failing silently." Before this, each of the three things below could be broken on a
 * player's phone and nothing would ever say so:
 *
 *   build_identity  expoConfig has no version or build number, so Sentry's release/dist (set at
 *                   init in app/_layout.tsx) read "1.0.0+0" and every crash is unattributable.
 *   updates         a release build with expo-updates disabled can never receive an OTA fix —
 *                   the self-update half of the standard is dead on that install.
 *   backend         the host never answered the boot warm-up. warmBackendConnection gives up
 *                   silently by design ("the real request will find out for itself"); this is
 *                   where that silence becomes a report.
 *
 * It sends NO network request of its own: the backend check awaits the warm-up the root layout
 * already starts (deduped inside apiBase), and reads its result.
 *
 * Reports go through the existing error-reporting path — Sentry, which already carries release and
 * dist from init. One fingerprint per failure set, so the same failure on many launches is one
 * issue with a count. No user-facing UI. Never throws.
 */
import * as Sentry from '@sentry/react-native';
import { getApiBaseUrl, PROD_API_BASE_URL, warmBackendConnection, isConnectionWarmed } from './apiBase';

export type HealthCheckName = 'build_identity' | 'updates' | 'backend';

export async function runStartupHealthCheck(): Promise<HealthCheckName[]> {
  const failed: HealthCheckName[] = [];
  try {
    const Constants = (await import('expo-constants')).default;
    const cfg = Constants.expoConfig;
    const build = cfg?.ios?.buildNumber ?? cfg?.android?.versionCode;
    if (!cfg?.version || build == null || String(build) === '0') failed.push('build_identity');
  } catch { failed.push('build_identity'); }

  // expo-updates is disabled in a dev client by design; only a release build must have it.
  if (!(typeof __DEV__ !== 'undefined' && __DEV__)) {
    try {
      const Updates = await import('expo-updates');
      if (!Updates.isEnabled) failed.push('updates');
    } catch { failed.push('updates'); }
  }

  // A dev/preview EXPO_PUBLIC_API_URL pin makes warmBackendConnection return without probing, so
  // "never warmed" would be a false failure there. Production (no pin) is the one checked.
  if (getApiBaseUrl() === PROD_API_BASE_URL) {
    try { await warmBackendConnection(); } catch { /* result is read below */ }
    if (!isConnectionWarmed()) failed.push('backend');
  }

  if (failed.length > 0) {
    try {
      Sentry.captureMessage('startup_health_check_failed', {
        level: 'error',
        tags: { health_failed: failed.join(',') },
        fingerprint: ['startup-health', ...failed],
      });
    } catch { /* reporting must never affect the app */ }
  }
  return failed;
}
