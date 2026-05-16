/**
 * Phase 405 wave 4 — Background location task.
 *
 * Closes the audit's CRITICAL gap: today watchPositionAsync silently
 * stops when the OS suspends the app (Android Doze, iOS low-power
 * background). The user puts the phone in their pocket between holes
 * and GPS drops out; hole transitions and yardages freeze until they
 * pull the phone out and the app foregrounds again.
 *
 * Architecture: dual-source. The existing watchPositionAsync in
 * gpsManager remains the high-cadence foreground source (1Hz /
 * BestForNavigation during active mode). On top of that, we ALSO start
 * Location.startLocationUpdatesAsync with `foregroundService` config.
 * That:
 *   - Shows a persistent notification on Android ("SmartPlay tracking
 *     your round") so the OS keeps the location subsystem alive.
 *   - Holds the iOS UIBackgroundModes 'location' entitlement so iOS
 *     keeps delivering fixes when backgrounded.
 *   - Routes each fix through a TaskManager-registered handler that
 *     feeds the manager's subscribers — same data path as
 *     watchPositionAsync, so consumers see no difference.
 *
 * The two subscriptions can each fire fixes; the gpsManager outlier-
 * rejection + smoothing path handles dedup naturally (a near-identical
 * timestamp+location pair is discarded by the jump-distance check).
 *
 * TaskManager.defineTask MUST run at module load, before any update is
 * delivered, or updates are silently dropped. This file is imported
 * for side-effect from app/_layout.tsx at boot.
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';

export const BACKGROUND_LOCATION_TASK = 'smartplay-background-location';

// Module-load defineTask. Runs once per app process; idempotent.
// expo-task-manager throws if defineTask is called more than once for
// the same task name, so guard with isTaskDefined.
if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async (event) => {
    if (event.error) {
      console.log('[bgLocation] task error:', event.error.message);
      return;
    }
    const data = event.data as { locations?: Location.LocationObject[] } | undefined;
    const locs = data?.locations ?? [];
    if (locs.length === 0) return;
    // Feed each fix into gpsManager via the public ingest API. Lazy
    // import avoids a top-level cycle (gpsManager imports nothing from
    // this file, but defining the task at module load before
    // gpsManager has resolved its own subscribers would still race).
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
  console.log('[bgLocation] task defined:', BACKGROUND_LOCATION_TASK);
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
