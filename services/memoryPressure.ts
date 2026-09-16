/**
 * Memory pressure — so the NEXT watchdog kill arrives with evidence.
 *
 * 2026-09-16 — Sentry issue 8ea87ebc (WatchdogTermination, iOS 27.0, build 26, route /scorecard).
 *
 * That event could not be diagnosed, and the reason is worth stating plainly: a watchdog
 * termination has NO STACK TRACE, by construction. The OS kills the process without giving it a
 * chance to report, so Sentry infers the whole thing on the NEXT launch — it sees a session that
 * ended without a crash, without a graceful exit, without an app or OS version change, and calls
 * that a watchdog kill. "Possibly because it overused RAM" is the SDK's wording for that inference,
 * not a measurement of anything. The `route` tag is simply the last route the scope held, which is
 * where the app WAS, not necessarily what allocated.
 *
 * So there was nothing to investigate: no trace, no footprint, and no record of whether the device
 * had been under memory pressure at all. iOS warns before it kills, and this app listened for that
 * warning nowhere — a repo-wide search for `memoryWarning` found zero handlers, and every hit for
 * "watchdog" was an unrelated timeout timer in SmartMotion.
 *
 * This module does not try to FIX memory. It makes the pressure visible:
 *
 *   1. A `memory_warnings` TAG on the Sentry scope, which the native layer persists. A watchdog
 *      termination is rebuilt from that persisted scope on the next launch, so the next one of
 *      these arrives already carrying how many warnings preceded it. `memory_warnings: 7` and
 *      `memory_warnings: 0` are different bugs, and today we cannot tell them apart.
 *   2. A breadcrumb per warning, so the sequence and timing are readable on any later event.
 *   3. ONE captured event per launch, on the first warning. Breadcrumbs and tags only ever surface
 *      attached to some OTHER event; without this, a device that thrashes and survives reports
 *      nothing at all. Capped at one because a device under real pressure can warn continuously,
 *      and a hundred identical events is not more information than one.
 *
 * THE TAG IS SET TO '0' AT STARTUP, DELIBERATELY. An absent tag and a zero tag mean different
 * things — absent means "this build had no instrumentation", zero means "we were watching and the
 * device never complained" — and the whole value here is telling those apart. Leaving the tag unset
 * until the first warning would have thrown away half the signal, which is the same mistake as an
 * honesty gate that returns null. [[silence-is-not-an-answer]]
 *
 * Everything here is wrapped: this is telemetry, and telemetry that can take the app down is worse
 * than no telemetry. It never throws, and a failure to subscribe leaves the app exactly as it was.
 */

import { AppState } from 'react-native';
import * as Sentry from '@sentry/react-native';

/** The scope tag every event carries once tracking is running. */
export const MEMORY_WARNINGS_TAG = 'memory_warnings';

let started = false;
let warnings = 0;
let startedAt = 0;
let subscription: { remove: () => void } | null = null;

/** How many memory warnings this app session has seen. Exported for tests and Owner Tools. */
export function memoryWarningCount(): number {
  return warnings;
}

function handleMemoryWarning(): void {
  warnings += 1;
  const sinceLaunchMs = Date.now() - startedAt;

  // The tag first: it is the piece that has to survive into a scope we will only read after the
  // process is already dead.
  try { Sentry.setTag(MEMORY_WARNINGS_TAG, String(warnings)); } catch { /* telemetry never throws */ }

  try {
    Sentry.addBreadcrumb({
      category: 'memory',
      level: 'warning',
      message: `memory warning #${warnings}`,
      // No route here on purpose — the scope already carries `route`, set on every navigation in
      // app/_layout.tsx. Copying it would be a second owner of the same fact.
      data: { count: warnings, sinceLaunchMs },
    });
  } catch { /* telemetry never throws */ }

  // Once per launch. See the header: a thrashing device that never gets killed would otherwise
  // report nothing, and an unthrottled capture would report the same thing hundreds of times.
  if (warnings === 1) {
    try {
      Sentry.captureMessage('Device memory warning', 'warning');
    } catch { /* telemetry never throws */ }
  }
}

/**
 * Begin listening. Idempotent — a second call while running is a no-op and returns the same stop
 * function, so a re-mounted root layout cannot double-count every warning.
 *
 * Returns a stop function suitable for a useEffect cleanup.
 */
export function startMemoryPressureTracking(): () => void {
  if (started) return stopMemoryPressureTracking;
  started = true;
  warnings = 0;
  startedAt = Date.now();

  // The explicit zero. See the header — this is what makes an uninstrumented build
  // distinguishable from a quiet one.
  try { Sentry.setTag(MEMORY_WARNINGS_TAG, '0'); } catch { /* telemetry never throws */ }

  try {
    subscription = AppState.addEventListener('memoryWarning', handleMemoryWarning) as unknown as { remove: () => void };
  } catch (e) {
    // An older AppState without this event, or a platform that does not emit it. Stay off rather
    // than half-on, so `started` reflects reality for the next caller.
    started = false;
    subscription = null;
    try { Sentry.addBreadcrumb({ category: 'memory', level: 'info', message: 'memory warning listener unavailable', data: { error: String(e) } }); } catch { /* telemetry never throws */ }
  }

  return stopMemoryPressureTracking;
}

/** Stop listening. Safe to call when not started. */
export function stopMemoryPressureTracking(): void {
  try { subscription?.remove(); } catch { /* telemetry never throws */ }
  subscription = null;
  started = false;
}

/** Test seam only — resets module state between cases. Never called by the app. */
export function __resetMemoryPressureForTest(): void {
  stopMemoryPressureTracking();
  warnings = 0;
  startedAt = 0;
}
