/**
 * Phase 405 wave 4 + Phase 411-hotfix — Background location task.
 *
 * Closes the audit's CRITICAL gap: today watchPositionAsync silently
 * stops when the OS suspends the app (Android Doze, iOS low-power
 * background). The user puts the phone in their pocket between holes
 * and GPS drops out; hole transitions and yardages freeze until they
 * pull the phone out and the app foregrounds again.
 *
 * # Hot-fix history
 *
 * The original Phase 405 wave 4 pattern called TaskManager.defineTask
 * at module load via a side-effect import in app/_layout.tsx. When the
 * native binding for expo-task-manager threw on Phase 405 wave 4's
 * first EAS build, the throw propagated through _layout.tsx's module
 * load and the entire app rendered a white screen at boot.
 *
 * # Current architecture — lazy defineTask
 *
 * defineTask is now called LAZILY inside startBackgroundLocation,
 * just before Location.startLocationUpdatesAsync. The native shell
 * delivers task data only AFTER startLocationUpdatesAsync is invoked
 * (which only happens on round-start), so registering the task at
 * that moment is sufficient. Tradeoff: if the OS resurrects the app
 * from a background task delivery while the JS bundle is unloaded,
 * defineTask isn't registered and the delivery is silently dropped.
 * For v1.1 beta that's acceptable — foreground GPS still works and
 * a user opening the app resumes the round normally.
 *
 * Every external surface is wrapped in try/catch so a native binding
 * failure CANNOT crash the boot path.
 */

import * as Location from 'expo-location';
import { Platform, PermissionsAndroid } from 'react-native';
// 2026-05-21 — Consolidation 4: routine lifecycle status logs gated.
import { devLog } from './devLog';
// 2026-06-01 — Fix GF.3: surface POST_NOTIFICATIONS denial via
// ownerSentinel so the silent foreground-service degradation is
// visible in owner-debug tools. Foreground GPS keeps working — the
// round still functions — but pocket-tracking is dark, and the user
// has no signal that's the case. Sentinel breadcrumb gives the owner
// a way to spot the pattern across testers.
import { ownerSentinel } from './ownerSentinel';
import { isValidGolfCoord } from '../utils/coordGuard';

export const BACKGROUND_LOCATION_TASK = 'smartplay-background-location';

let taskDefined = false;

/**
 * 2026-05-21 — Fix N: ensure POST_NOTIFICATIONS runtime permission on
 * Android 13+ (API 33+) before starting the foreground-location
 * service. The foreground service posts a persistent notification
 * ("SmartPlay tracking your round") and on Android 13+, posting any
 * notification requires this runtime permission. Without it, Samsung
 * One UI (and other stricter OEMs) throws SecurityException during
 * the native startForegroundService → process kill. Root cause of the
 * Z Fold "app closes on Start Round" crash.
 *
 * Returns true when posting notifications is allowed (granted, or
 * Android < 13 where it's implicit, or non-Android where this doesn't
 * apply). Returns false when the user denied — caller MUST skip the
 * foreground-service start so the round doesn't die.
 *
 * The whole probe is defensive: any throw from PermissionsAndroid
 * (very unlikely but possible on rooted / custom-ROM devices) is
 * treated as "permission unknown — skip foreground service" so we
 * NEVER let a permission-API failure crash the round.
 */
async function ensurePostNotificationsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  // Platform.Version on Android is the API level as a number.
  if (typeof Platform.Version !== 'number' || Platform.Version < 33) return true;
  try {
    // PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS exists on RN
    // 0.71+ as a string; fall back to the manifest constant if the
    // lookup is missing on some bundler / RN version.
    const PERM = (PermissionsAndroid.PERMISSIONS as Record<string, string>).POST_NOTIFICATIONS
      ?? 'android.permission.POST_NOTIFICATIONS';
    // Check first to avoid prompting again if already granted/denied.
    const already = await PermissionsAndroid.check(PERM as Parameters<typeof PermissionsAndroid.check>[0]);
    if (already) {
      devLog('[bgLocation] POST_NOTIFICATIONS already granted');
      return true;
    }
    const result = await PermissionsAndroid.request(
      PERM as Parameters<typeof PermissionsAndroid.request>[0],
      {
        title: 'Notifications during your round',
        message:
          'SmartPlay needs to show a small notification while you play so it can keep tracking your round when your phone is in your pocket.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      },
    );
    const granted = result === PermissionsAndroid.RESULTS.GRANTED;
    devLog('[bgLocation] POST_NOTIFICATIONS request result:', result, 'granted:', granted);
    return granted;
  } catch (e) {
    // PermissionsAndroid threw — treat as unknown and SKIP foreground
    // service to be safe. Round still works via foreground watch.
    console.log('[bgLocation] POST_NOTIFICATIONS probe failed (skipping foreground service):', e);
    return false;
  }
}

/**
 * Lazy registration. Called from startBackgroundLocation immediately
 * before startLocationUpdatesAsync. Idempotent — only registers once
 * per app process.
 *
 * Dynamic require of expo-task-manager so any native-binding failure
 * is caught and logged instead of throwing at module-load time. The
 * task body itself ingests fixes back into gpsManager via the public
 * ingestExternalFix path so the existing outlier + smoothing pipeline
 * handles background fixes identically to foreground.
 */
function ensureTaskDefined(): boolean {
  if (taskDefined) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
    if (TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
      taskDefined = true;
      return true;
    }
    TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async (event) => {
      if (event.error) {
        console.log('[bgLocation] task error:', event.error.message);
        return;
      }
      const data = event.data as { locations?: Location.LocationObject[] } | undefined;
      const locs = data?.locations ?? [];
      if (locs.length === 0) return;
      // Feed each fix into gpsManager via the public ingest API.
      void (async () => {
        try {
          const { ingestExternalFix } = await import('./gpsManager');
          for (const l of locs) {
            // 2026-06-01 — Fix GL: validate before ingest. processFix
            // also gates, but rejecting at the boundary saves the
            // dynamic import + per-fix overhead when the background
            // task emits garbage (Doze can deliver stale/synthetic
            // fixes on some Android OEMs after a long sleep).
            if (!isValidGolfCoord(l.coords.latitude, l.coords.longitude)) {
              continue;
            }
            ingestExternalFix({
              lat: l.coords.latitude,
              lng: l.coords.longitude,
              accuracy_m: l.coords.accuracy ?? null,
              speed: l.coords.speed ?? null,
              timestamp: l.timestamp,
            });
          }
        } catch (e) {
          console.log('[bgLocation] ingest failed:', e);
        }
      })();
    });
    taskDefined = true;
    devLog('[bgLocation] task defined:', BACKGROUND_LOCATION_TASK);
    return true;
  } catch (e) {
    console.log('[bgLocation] ensureTaskDefined failed (non-fatal):', e);
    return false;
  }
}

/**
 * Start the background location updates task. Idempotent. Requires
 * foreground location permission already granted (caller checks before
 * invoking). Background location permission is optional — without it,
 * the foreground service still runs on Android (keeps GPS alive while
 * the app is in the recents list) but iOS won't track when the app
 * is truly backgrounded.
 *
 * Android: shows the persistent notification configured below.
 * iOS: piggybacks on UIBackgroundModes:location entitlement.
 */
export async function startBackgroundLocation(): Promise<void> {
  try {
    const registered = ensureTaskDefined();
    if (!registered) {
      console.log('[bgLocation] task registration failed; skipping start');
      return;
    }
    const already = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (already) return;

    // 2026-05-21 — Fix N: gate the foreground-service start on the
    // POST_NOTIFICATIONS runtime permission for Android 13+. On
    // Samsung One UI (Tim's Z Fold), starting a foreground service
    // that posts a notification without this permission throws
    // SecurityException at the JVM level → uncaught native exception
    // → process kill. JS try/catch CAN'T catch it. The only safe
    // option is to NEVER call startLocationUpdatesAsync with a
    // foregroundService config until we know the permission is
    // granted. When denied, we skip the foreground service entirely
    // — the round still works via foreground watchPositionAsync (the
    // GPS manager's primary fix source); only phone-in-pocket Doze
    // coverage degrades.
    const canPostNotification = await ensurePostNotificationsPermission();
    if (!canPostNotification) {
      console.log(
        '[bgLocation] POST_NOTIFICATIONS not granted — skipping foreground service. ' +
        'Foreground GPS watch still provides fixes; phone-in-pocket Doze coverage is degraded.',
      );
      // 2026-06-01 — Fix GF.3: emit ownerSentinel breadcrumb so the
      // silent foreground-service skip is visible to owner-debug
      // tools. The console.log above is the user-facing-debug-only
      // path; the sentinel path persists the pattern across testers
      // for triage (e.g. "all 3 of Tim's beta testers have BG GPS
      // disabled because they denied the notification prompt").
      try {
        ownerSentinel(
          'bgLocation.skip_foreground_service',
          new Error('POST_NOTIFICATIONS not granted — BG GPS pocket-tracking disabled'),
        );
      } catch { /* sentinel itself must never crash the round */ }
      return;
    }

    // 2026-05-21 — Fix N: belt-and-suspenders try/catch around the
    // native startLocationUpdatesAsync call. The permission gate
    // above is the primary defense; this catches any OTHER native
    // throw from expo-location / expo-task-manager (e.g. a Samsung
    // OEM-specific service-binding refusal on a hardened build,
    // FOREGROUND_SERVICE_LOCATION type-mismatch on a future Android
    // version) so a single bad code path can't kill the round.
    try {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        // 10s cadence + 5m distance hysteresis. Keeps OS-level GPS warm
        // without burning battery; watchPositionAsync provides the
        // high-cadence foreground fixes when the app is open.
        timeInterval: 10_000,
        distanceInterval: 5,
        // showsBackgroundLocationIndicator is iOS-only; surfaces the blue
        // bar in the status row when location is being used.
        showsBackgroundLocationIndicator: true,
        // foregroundService config is Android-only. Required to keep
        // updates flowing when the app is backgrounded on modern Android
        // (Doze + battery-optimization profiles).
        foregroundService: {
          notificationTitle: 'SmartPlay tracking your round',
          notificationBody: 'Hole transitions + yardages stay current while your phone is in your pocket.',
          notificationColor: '#00C896',
        },
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.Fitness,
      });
      devLog('[bgLocation] updates started with foreground service');
    } catch (innerErr) {
      console.log(
        '[bgLocation] startLocationUpdatesAsync threw (foreground service unavailable; round continues with foreground watch only):',
        innerErr,
      );
      // Intentionally swallow — round-start MUST NOT crash because the
      // OS refused the foreground service. The GPS manager's
      // watchPositionAsync subscription is independent and provides
      // fixes whenever the app is in the foreground.
    }
  } catch (e) {
    console.log('[bgLocation] start failed (non-fatal):', e);
  }
}

/** Stop the task. Idempotent. */
export async function stopBackgroundLocation(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (!running) return;
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    devLog('[bgLocation] updates stopped');
  } catch (e) {
    console.log('[bgLocation] stop failed:', e);
  }
}
