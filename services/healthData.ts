/**
 * 2026-05-17 — Phase 413 / Component 2-3
 *
 * Sensor-agnostic abstraction over Android Health Connect (and a stub
 * for iOS HealthKit). All consumers — walking detector, shot detection
 * enhancement, round-summary enrichment — call the surface here so we
 * never sprinkle platform-specific calls through the round flow.
 *
 * Android: backed by `react-native-health-connect`. Health Connect
 * itself is the OS-wide health data hub on modern Android; Samsung
 * Health syncs into it, so Galaxy Watch data flows through this same
 * pipe.
 *
 * iOS: stubbed. The HealthKit bridge needs `react-native-health` or a
 * custom native module + matching Info.plist usage strings. Deferred
 * until Tim greenlights an iOS build per his note: "don't send ios
 * build yet."
 *
 * Graceful degradation: every export resolves cleanly with empty/zero
 * values when the lib isn't initialized, the user denied permission,
 * or the platform isn't supported. Callers don't need defensive
 * try/catch around individual queries.
 */

import { Platform } from 'react-native';

export type HealthPermissionKey =
  | 'steps'
  | 'distance'
  | 'heartRate'
  | 'exercise'
  | 'activeCalories';

export interface HealthSnapshot {
  /** Step count over the window. */
  steps: number;
  /** Distance walked in meters over the window. */
  distanceMeters: number;
  /** Mean heart rate over the window, or null if no samples. */
  heartRateAvg: number | null;
  /** Peak heart rate, or null if no samples. */
  heartRateMax: number | null;
  /** Active calories burned (kcal) over the window. */
  activeCalories: number;
  /** True if any data was actually returned (vs all zeros because no
   *  permission / no data). Lets callers distinguish "watch confirms
   *  sedentary" from "no watch data available". */
  hasData: boolean;
}

const EMPTY_SNAPSHOT: HealthSnapshot = {
  steps: 0,
  distanceMeters: 0,
  heartRateAvg: null,
  heartRateMax: null,
  activeCalories: 0,
  hasData: false,
};

// Map our permission keys to Health Connect record types. Kept local
// so callers don't need to know the upstream string format.
const HC_RECORD_TYPE: Record<HealthPermissionKey, string> = {
  steps: 'Steps',
  distance: 'Distance',
  heartRate: 'HeartRate',
  exercise: 'ExerciseSession',
  activeCalories: 'ActiveCaloriesBurned',
};

let initialized = false;
let initFailed = false;
let cachedAvailable: boolean | null = null;

/** Initialize the native module once per process. Idempotent.
 *  Returns true when the platform is supported AND Health Connect is
 *  installed; false otherwise. iOS always false until HealthKit is
 *  wired. */
export async function initHealth(): Promise<boolean> {
  if (cachedAvailable != null) return cachedAvailable;
  if (Platform.OS !== 'android') {
    cachedAvailable = false;
    return false;
  }
  try {
    const hc = await import('react-native-health-connect');
    // 2026-07-08 (Tim — "Connect Health Data white-screens") — GATE on getSdkStatus
    // BEFORE initialize(). On devices where Health Connect isn't installed / needs a
    // provider update (common on some Samsung/older Android), calling initialize() or
    // requestPermission() directly can throw a NATIVE (JNI) fatal that JS try/catch
    // cannot catch — the app goes white. getSdkStatus() is the library's safe
    // availability probe; only proceed when it reports SDK_AVAILABLE (3).
    try {
      const status = await hc.getSdkStatus();
      if (status !== 3 /* SdkAvailabilityStatus.SDK_AVAILABLE */) {
        console.log('[healthData] Health Connect not available (sdkStatus=' + status + ') — skipping init');
        cachedAvailable = false;
        return false;
      }
    } catch (statusErr) {
      // Even the status probe failed — treat as unavailable rather than risk init.
      console.log('[healthData] getSdkStatus failed — treating HC as unavailable:', statusErr);
      cachedAvailable = false;
      initFailed = true;
      return false;
    }
    const ok = await hc.initialize();
    initialized = !!ok;
    cachedAvailable = !!ok;
    if (!ok) console.log('[healthData] Health Connect initialize returned false');
    return cachedAvailable;
  } catch (e) {
    initFailed = true;
    cachedAvailable = false;
    console.log('[healthData] init exception:', e);
    return false;
  }
}

/** Returns true when the platform supports health data AND the OS
 *  layer is initialized AND the user can grant permissions. Used as
 *  a gate for the permission flow + as a graceful-degradation check
 *  inside every reader. */
export async function isHealthAvailable(): Promise<boolean> {
  if (cachedAvailable != null) return cachedAvailable;
  return initHealth();
}

/** Asks the user for read access to the listed categories. Health
 *  Connect launches its own activity for permission grant; the
 *  returned object reports which categories landed. Calling this with
 *  permissions already granted is a no-op (Health Connect returns
 *  them as granted). */
export async function requestHealthPermissions(
  perms: HealthPermissionKey[],
): Promise<{ granted: HealthPermissionKey[]; denied: HealthPermissionKey[] }> {
  if (!(await isHealthAvailable())) {
    return { granted: [], denied: perms };
  }
  try {
    const hc = await import('react-native-health-connect');
    const requested = perms.map((p) => ({
      accessType: 'read' as const,
      recordType: HC_RECORD_TYPE[p],
    }));
    // Cast through unknown: the lib's Permission type uses a string-
    // literal union that we satisfy at runtime via HC_RECORD_TYPE
    // but can't prove at the type level without re-declaring every
    // record-type literal here.
    const grantedRaw = (await hc.requestPermission(requested as unknown as Parameters<typeof hc.requestPermission>[0])) as Array<{ recordType: string }>;
    const grantedTypes = new Set(grantedRaw.map((g) => g.recordType));
    const granted: HealthPermissionKey[] = [];
    const denied: HealthPermissionKey[] = [];
    for (const p of perms) {
      if (grantedTypes.has(HC_RECORD_TYPE[p])) granted.push(p);
      else denied.push(p);
    }
    console.log('[healthData] permissions granted:', granted, 'denied:', denied);
    return { granted, denied };
  } catch (e) {
    console.log('[healthData] requestPermissions exception:', e);
    return { granted: [], denied: perms };
  }
}

/** Returns the categories already granted. Empty when the user hasn't
 *  granted anything or the platform isn't supported. */
export async function getGrantedHealthPermissions(): Promise<HealthPermissionKey[]> {
  if (!(await isHealthAvailable())) return [];
  try {
    const hc = await import('react-native-health-connect');
    const granted = (await hc.getGrantedPermissions()) as Array<{ recordType: string }>;
    const grantedTypes = new Set(granted.map((g) => g.recordType));
    const out: HealthPermissionKey[] = [];
    for (const [key, type] of Object.entries(HC_RECORD_TYPE)) {
      if (grantedTypes.has(type)) out.push(key as HealthPermissionKey);
    }
    return out;
  } catch (e) {
    console.log('[healthData] getGrantedPermissions exception:', e);
    return [];
  }
}

interface TimeRange { start: number; end: number }

async function readRecords<T>(recordType: string, range: TimeRange): Promise<T[]> {
  if (!(await isHealthAvailable())) return [];
  try {
    const hc = await import('react-native-health-connect');
    // Lib's readRecords typing constrains recordType to a literal union;
    // we satisfy it at runtime via HC_RECORD_TYPE so the cast is safe.
    const res = (await (hc.readRecords as unknown as (rt: string, opts: unknown) => Promise<{ records: T[] } | T[]>)(recordType, {
      timeRangeFilter: {
        operator: 'between',
        startTime: new Date(range.start).toISOString(),
        endTime: new Date(range.end).toISOString(),
      },
    }));
    if (Array.isArray(res)) return res;
    return res.records ?? [];
  } catch (e) {
    console.log('[healthData] readRecords', recordType, 'exception:', e);
    return [];
  }
}

/** Total steps over the window. Combines all Steps records (multiple
 *  sources — phone pedometer, watch — get summed). */
export async function readStepsBetween(start: number, end: number): Promise<number> {
  const records = await readRecords<{ count: number }>('Steps', { start, end });
  return records.reduce((sum, r) => sum + (r.count ?? 0), 0);
}

/** Total distance in meters over the window. */
export async function readDistanceBetween(start: number, end: number): Promise<number> {
  const records = await readRecords<{ distance: { inMeters: number } }>('Distance', { start, end });
  return records.reduce((sum, r) => sum + (r.distance?.inMeters ?? 0), 0);
}

/** Heart-rate samples over the window. Each record carries multiple
 *  samples; we flatten them and return the BPM values. */
export async function readHeartRateBetween(start: number, end: number): Promise<number[]> {
  const records = await readRecords<{ samples: { beatsPerMinute: number }[] }>('HeartRate', { start, end });
  const bpms: number[] = [];
  for (const r of records) {
    if (Array.isArray(r.samples)) {
      for (const s of r.samples) {
        if (typeof s.beatsPerMinute === 'number') bpms.push(s.beatsPerMinute);
      }
    }
  }
  return bpms;
}

/** Active calories burned (kcal) over the window. */
export async function readActiveCaloriesBetween(start: number, end: number): Promise<number> {
  const records = await readRecords<{ energy: { inKilocalories: number } }>('ActiveCaloriesBurned', { start, end });
  return records.reduce((sum, r) => sum + (r.energy?.inKilocalories ?? 0), 0);
}

/** One-shot snapshot of activity over a window. Used by the round
 *  summary, walking detector, and Kevin's context. */
export async function readHealthSnapshot(start: number, end: number = Date.now()): Promise<HealthSnapshot> {
  if (!(await isHealthAvailable())) return EMPTY_SNAPSHOT;
  try {
    const [steps, distanceMeters, hrs, kcal] = await Promise.all([
      readStepsBetween(start, end),
      readDistanceBetween(start, end),
      readHeartRateBetween(start, end),
      readActiveCaloriesBetween(start, end),
    ]);
    const heartRateAvg = hrs.length > 0 ? Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length) : null;
    const heartRateMax = hrs.length > 0 ? Math.round(Math.max(...hrs)) : null;
    return {
      steps,
      distanceMeters: Math.round(distanceMeters),
      heartRateAvg,
      heartRateMax,
      activeCalories: Math.round(kcal),
      hasData: steps > 0 || hrs.length > 0 || distanceMeters > 0,
    };
  } catch (e) {
    console.log('[healthData] snapshot exception:', e);
    return EMPTY_SNAPSHOT;
  }
}

/** Debug helper for the audit screen. */
export function debugStatus(): { initialized: boolean; initFailed: boolean; cachedAvailable: boolean | null; platform: string } {
  return { initialized, initFailed, cachedAvailable, platform: Platform.OS };
}
