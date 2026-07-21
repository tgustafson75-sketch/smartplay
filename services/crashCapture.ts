/**
 * 2026-07-21 (BETA — Tim: "crashes still don't show up in the error log") — crash capture.
 *
 * Two gaps made crashes invisible in the Issue Log:
 *   1. The root ErrorBoundary caught RENDER crashes (white-screens) but only console.log'd them
 *      — nothing reached the Issue Log, so a tester's white-screen left no trace. (Wired now in
 *      components/ErrorBoundary.tsx via logCrash.)
 *   2. NOTHING caught async / event-handler / uncaught JS errors — React error boundaries by
 *      design don't. Those just crashed with no record.
 *
 * initCrashCapture() installs a global JS error handler (RN's ErrorUtils) that funnels EVERY
 * uncaught JS error into the Issue Log as an 'app_error', then chains to the previous handler so
 * the platform's normal behavior (dev red-box / prod fatal) is preserved. Idempotent + never
 * throws — logging a crash must never cause one.
 *
 * NOTE: this captures JS-level crashes. A hard NATIVE crash (e.g. a native module segfault) kills
 * the process before JS can run, so those still need native crash reporting — but the vast majority
 * of "the app crashed" reports on an Expo/RN app are JS errors, which this now records.
 */

/** Shared logging helper — used by both the global handler and the ErrorBoundary. Best-effort. */
export function logCrash(
  stage: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  try {
    const err = error as { message?: string; stack?: string } | null | undefined;
    const message = err?.message ?? (typeof error === 'string' ? error : String(error));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../store/issueLogStore').useIssueLogStore.getState().addAppEvent(
      stage,
      {
        error: message?.slice(0, 300),
        stack: (err?.stack ?? '').slice(0, 1500),
        ...extra,
      },
      'app_error',
    );
  } catch {
    /* logging a crash must NEVER throw */
  }
}

let installed = false;

/** Install the global uncaught-JS-error handler. Call once at boot. */
export function initCrashCapture(): void {
  if (installed) return;
  installed = true;
  try {
    const g = globalThis as unknown as {
      ErrorUtils?: {
        getGlobalHandler?: () => ((e: unknown, isFatal?: boolean) => void) | undefined;
        setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
      };
    };
    const EU = g.ErrorUtils;
    if (!EU?.setGlobalHandler) return;
    const prev = EU.getGlobalHandler?.();
    EU.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      logCrash('uncaught_js_error', error, { isFatal: !!isFatal });
      // Chain to the platform's original handler so dev red-box / prod fatal still happen.
      try { prev?.(error, isFatal); } catch { /* ignore */ }
    });
  } catch {
    /* if install fails, we simply have no global capture — never crash trying to add it */
  }
}
