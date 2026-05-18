/**
 * 2026-05-17 — Owner-only hot-path catch sentinel.
 *
 * Hot-path services (gpsManager, holeDetection, shotDetectionService,
 * conversationalLoggingOrchestrator, smartFinderService, mediaCapture)
 * are built with permissive try/catch around every subscription
 * callback / network call / state mutation so a single bad sample
 * can't tear down the round flow. That's the right call for production
 * users — but it also means Tim, on the course, watching shot detection
 * silently stop firing, has no signal that something failed.
 *
 * This sentinel lets those catches stay silent for end users while
 * surfacing a 30s-deduped toast to owner-email accounts. Every catch
 * still console.logs. The toast just adds an in-app signal for the
 * person who can actually act on it.
 *
 * Usage at a catch site:
 *
 *   } catch (e) {
 *     ownerSentinel('shotDetection.evaluate', e);
 *   }
 *
 * The `scope` is a short, dot-separated breadcrumb. It's also the
 * dedupe key — repeat firings of the same scope inside 30 seconds
 * collapse to one toast (the console log still fires every time).
 *
 * Lazy imports: keeps this module load-cycle-safe and means a missing
 * toast/profile store in test environments degrades to log-only.
 */

const DEDUPE_WINDOW_MS = 30_000;
const TOAST_MESSAGE_CAP = 80;

const lastFireAt: Map<string, number> = new Map();

export function ownerSentinel(scope: string, err: unknown, extra?: Record<string, unknown>): void {
  // Always log — that's the existing behavior we're preserving.
  console.log(`[sentinel:${scope}]`, err, extra ?? '');

  // The owner toast layer is best-effort. Any failure here must not
  // re-throw — we'd be in a catch already.
  try {
    // Dedupe per scope.
    const now = Date.now();
    const prev = lastFireAt.get(scope) ?? 0;
    if (now - prev < DEDUPE_WINDOW_MS) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const profileMod = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
    const email = profileMod.usePlayerProfileStore.getState().email;
    if (!profileMod.isOwnerEmail(email)) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const toastMod = require('../store/toastStore') as typeof import('../store/toastStore');
    const errText = err instanceof Error
      ? (err.message || err.name || 'error')
      : (typeof err === 'string' ? err : 'error');
    const truncated = errText.length > TOAST_MESSAGE_CAP
      ? errText.slice(0, TOAST_MESSAGE_CAP) + '…'
      : errText;
    toastMod.useToastStore.getState().show(`⚠ ${scope}: ${truncated}`);
    lastFireAt.set(scope, now);
  } catch (sentinelErr) {
    // Best-effort. If toast / profile store isn't available, log + move on.
    console.log('[sentinel] toast layer failed:', sentinelErr);
  }
}

/** Test-helper to clear dedupe state. Not exported in the public API. */
export function _resetSentinelDedupe(): void {
  lastFireAt.clear();
}
