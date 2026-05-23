/**
 * 2026-05-23 — Native module health tracker.
 *
 * Records the LOAD outcome of each native bridge at module init
 * time. Drives:
 *   - A diagnostic Owner-Tools screen that lists which native
 *     modules are present + working
 *   - User-facing toasts when a glasses / pose action attempts to
 *     use an absent native module (so the player sees "Glasses
 *     unavailable — using cloud" instead of silent no-op)
 *   - Sentry breadcrumbs so future crash reports include which
 *     native paths were active at the time
 *
 * The tracker NEVER throws — all reads + writes are defensive.
 * Failure of the health tracker is itself logged but doesn't
 * compound the user-facing error.
 *
 * Why this matters: Tim's APK c84d023d crashed at launch and we
 * couldn't tell from the surface which native dep was responsible.
 * With the tracker in place, future crashes will at least include
 * a Sentry breadcrumb listing which modules loaded successfully
 * BEFORE the crash, narrowing the suspect list to those that
 * didn't.
 */

import { NativeModules, Platform } from 'react-native';
import { devLog } from './devLog';

export type NativeModuleId = 'MetaWearablesFrame' | 'MediaPipePose';

export interface NativeModuleHealth {
  id: NativeModuleId;
  /** True when NativeModules[id] is non-null at probe time. */
  loaded: boolean;
  /** Platform the probe ran on. */
  platform: 'ios' | 'android' | 'web';
  /** ms epoch the health record was captured. */
  probedAt: number;
  /** Optional free-text reason when loaded === false. */
  reason?: string;
}

const records: Record<string, NativeModuleHealth> = {};

function probe(id: NativeModuleId): NativeModuleHealth {
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  let loaded = false;
  let reason: string | undefined;
  try {
    const mod = (NativeModules as Record<string, unknown>)[id];
    loaded = mod != null && typeof mod === 'object';
    if (!loaded) reason = `NativeModules.${id} resolved to ${typeof mod}`;
  } catch (e) {
    reason = `probe threw: ${String(e)}`;
  }
  return { id, loaded, platform, probedAt: Date.now(), reason };
}

/**
 * Probe and record. Call once per module at JS bridge initialization
 * (services/metaWearablesBridge.ts + services/mediaPipePoseService.ts
 * both call this on their respective module imports). Returns the
 * health record so the caller can branch on it.
 */
export function recordNativeModuleHealth(id: NativeModuleId): NativeModuleHealth {
  const health = probe(id);
  records[id] = health;
  devLog(`[nativeModuleHealth] ${id}: loaded=${health.loaded} platform=${health.platform}${health.reason ? ` reason="${health.reason}"` : ''}`);
  // Sentry breadcrumb (best-effort — Sentry may not be initialized yet
  // at very early app start, so import lazily + swallow failures).
  try {
    void import('@sentry/react-native').then((Sentry) => {
      Sentry.addBreadcrumb({
        category: 'native_module',
        level: health.loaded ? 'info' : 'warning',
        message: `${id} loaded=${health.loaded}`,
        data: { platform: health.platform, reason: health.reason ?? null },
      });
    }).catch(() => undefined);
  } catch { /* non-fatal */ }
  return health;
}

/**
 * Get all recorded health records — sorted by id for stable diagnostic
 * display. Used by the Owner-Tools diagnostic screen.
 */
export function getAllNativeModuleHealth(): NativeModuleHealth[] {
  return Object.values(records).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Look up a specific record. Returns null when the module's bridge
 * hasn't been imported yet (so its health hasn't been recorded).
 */
export function getNativeModuleHealth(id: NativeModuleId): NativeModuleHealth | null {
  return records[id] ?? null;
}

/**
 * Pretty-print all records as a single multi-line string. Useful for
 * pasting into bug reports without screenshots.
 */
export function dumpNativeModuleHealth(): string {
  const all = getAllNativeModuleHealth();
  if (all.length === 0) return 'No native module health probes recorded yet.';
  return all.map((h) =>
    `${h.id}: ${h.loaded ? '✓ loaded' : '✗ MISSING'} (${h.platform}${h.reason ? `, ${h.reason}` : ''})`,
  ).join('\n');
}
