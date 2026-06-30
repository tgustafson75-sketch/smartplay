/**
 * services/bootTrace.ts — TEMPORARY boot-timing breadcrumbs.
 *
 * 2026-06-28 (Tim) — to crack the month-long "first response is slow/fails" flow we
 * need a TIMELINE: when the JS bundle started, when the root mounts, when stores
 * hydrate, when voice warmup + triggers fire — all timestamped — so the first
 * transcribe failure (already logged with its own timestamp + elapsedMs) can be
 * placed ON that timeline.
 *
 * t0 = first execution of THIS module (≈ JS bundle load; the splash is still up).
 * bootMark(label) logs `+<ms> label` to the console for everyone, and (owner-email
 * only, so it never fills a beta tester's log) drops a 'boot' entry into the issue
 * log so the timeline EXPORTS alongside the failures.
 *
 * TEMPORARY: remove the bootMark() call sites (and this file) once the first-response
 * flow is understood. Pure additive instrumentation — no app logic depends on it.
 */

const t0 = Date.now();
// Milestones are one-time events; dedupe by label so an effect re-run can't
// double-log the same boot step.
const fired = new Set<string>();

/** Milliseconds since the JS bundle first executed (proxy for app start). */
export function bootElapsedMs(): number {
  return Date.now() - t0;
}

export function bootMark(label: string, extra?: Record<string, unknown>): void {
  if (fired.has(label)) return;
  fired.add(label);
  const sinceBootMs = Date.now() - t0;
  console.log(`[boot] +${sinceBootMs}ms ${label}`, extra ?? '');
  // 2026-06-30 (Tim — KEEP this; he uses the full timestamped timeline while playing +
  // testing). The boot breadcrumbs stay in the owner log on purpose; the owner-logs view
  // gains an "Errors" filter so real failures are separable from this benign tracking.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prof = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
    if (!prof.isOwnerEmail(prof.usePlayerProfileStore.getState().email)) return; // owner-only in the log
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const log = require('../store/issueLogStore') as typeof import('../store/issueLogStore');
    log.useIssueLogStore.getState().addBootEvent(label, { sinceBootMs, ...(extra ?? {}) });
  } catch {
    // best-effort — stores may be unavailable very early or in test envs.
  }
}
