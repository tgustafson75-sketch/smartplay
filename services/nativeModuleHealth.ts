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
  /**
   * 2026-09-19 — why an absence is EXPECTED on this platform, when it is.
   *
   * Tim read the Owner Tools card and asked about it, which is the right response to a red cross
   * and the wrong use of his evening: MetaWearablesFrame is absent from every Android build cut
   * without GITHUB_TOKEN, BY DESIGN, and the card gave no hint of that. A diagnostic that reports a
   * deliberate build decision in the same voice as a broken dependency makes the reader chase it.
   */
  expected?: string;
}

/**
 * Why a module is legitimately absent from THIS build, or null when its absence is a real fault.
 *
 * Kept beside the probe rather than in the screen, so every consumer — the card, the Sentry
 * breadcrumb, the pasted dump — tells the same story. [[two-owners-is-the-root-cause]]
 */
function expectedAbsence(id: NativeModuleId, platform: 'ios' | 'android' | 'web'): string | undefined {
  if (id === 'MetaWearablesFrame') {
    if (platform === 'android') {
      return 'expected unless this build had GITHUB_TOKEN — the Meta DAT SDK lives in GitHub Packages, and plugins/withMetaWearablesDAT skips the Android wiring without it (see docs/NEEDS-A-NATIVE-BUILD.md). Glasses features degrade to the phone; nothing else is affected';
    }
    if (platform === 'ios') {
      return 'expected unless this build used the `glasses` EAS profile (MWDAT_IOS_ENABLED=1). Glasses features degrade to the phone; nothing else is affected';
    }
  }
  // MediaPipePose ships in the standard plugin set, so its absence is NOT expected anywhere.
  return undefined;
}

const records: Record<string, NativeModuleHealth> = {};

/**
 * What the name actually resolved to, said in a way that cannot be misread.
 *
 * `null` and `undefined` mean different things and both are absences: undefined is "no module by
 * this name was registered", null is "something registered the name and left it empty". Reporting
 * either as its `typeof` is how a diagnostic ends up contradicting its own verdict.
 */
function describeMissing(mod: unknown): string {
  if (mod === undefined) return 'undefined — no native module registered under this name in this build';
  if (mod === null) return 'null — the name exists but the bridge registered nothing for it';
  return `a ${typeof mod}, not a module object`;
}

function probe(id: NativeModuleId): NativeModuleHealth {
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  let loaded = false;
  let reason: string | undefined;
  try {
    const mod = (NativeModules as Record<string, unknown>)[id];
    loaded = mod != null && typeof mod === 'object';
    /**
     * 2026-09-19 — `typeof mod` WAS THE WHOLE REASON STRING, AND IT LIED IN THE ONE CASE THAT
     * ACTUALLY HAPPENS. Tim's Owner Tools card read:
     *
     *     MetaWearablesFrame: ✗ MISSING (android, NativeModules.MetaWearablesFrame resolved to object)
     *
     * which says the module was found AND missing. `typeof null === 'object'` in JavaScript, so a
     * bridge that registered nothing under this name — `null`, the normal shape of an absent module
     * — printed as "object". The VERDICT was right; the explanation sent the reader to debug the
     * probe instead of the build. [[a-log-field-can-be-an-artefact]]
     */
    if (!loaded) reason = `NativeModules.${id} is ${describeMissing(mod)}`;
  } catch (e) {
    reason = `probe threw: ${String(e)}`;
  }
  return { id, loaded, platform, probedAt: Date.now(), reason, expected: loaded ? undefined : expectedAbsence(id, platform) };
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
  return all.map((h) => {
    const head = `${h.id}: ${h.loaded ? '\u2713 loaded' : h.expected ? '\u2014 not in this build' : '\u2717 MISSING'} (${h.platform}${h.reason ? `, ${h.reason}` : ''})`;
    // The expectation goes on its own line: a reader scanning for problems should be able to stop
    // at the first line, and only read on if it is one.
    return h.expected ? `${head}\n    ${h.expected}` : head;
  }).join('\n');
}

/**
 * The two pure decisions above, exposed for tests.
 *
 * `probe()` itself reads NativeModules, which a node test cannot populate — and a diagnostic whose
 * logic is unreachable from the suite is how `typeof null` survived here since May.
 */
export const __testing = { describeMissing, expectedAbsence };
