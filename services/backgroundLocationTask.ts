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

export const BACKGROUND_LOCATION_TASK = 'smartplay-background-location';

let taskDefined = false;

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
    console.log('[bgLocation] task defined:', BACKGROUND_LOCATION_TASK);
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
    console.log('[bgLocation] updates started');
  } catch (e) {
    console.log('[bgLocation] start failed:', e);
  }
}

/** Stop the task. Idempotent. */
export async function stopBackgroundLocation(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (!running) return;
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    console.log('[bgLocation] updates stopped');
  } catch (e) {
    console.log('[bgLocation] stop failed:', e);
  }
}
