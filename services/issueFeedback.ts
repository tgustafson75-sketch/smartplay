/**
 * 2026-09-10 — ONE SENDER-SIDE OWNER FOR "THIS ENTRY ALSO GOES TO SENTRY".
 *
 * The 2026-09-06 refactor merged the issue log into Sentry so a crash Sentry caught on its own and
 * a tester's note about it land in one fingerprint space. It was wired into services/issueLogExport.
 *
 * THERE ARE TWO SENDERS TO /api/issue-report. services/roundTrace POSTs its own entry directly —
 * it never joins issueLogExport's `unsent` list — so the round trace, and with it the owner Field
 * Test report added 2026-09-10, went to Supabase and NOWHERE ELSE. Not Sentry, not email (the
 * server emailer was deleted in that same refactor). A diagnostic whose entire purpose is to leave
 * the device was landing in a table nobody opens.
 *
 * This is the THIRD time the second sender missed treatment the first one got:
 *   2026-08-29  the test-runner guard was private to issueLogExport → roundTrace mailed from jest
 *   2026-09-05  the shareDiagnostics CONSENT check, same shape
 *   2026-09-06  Sentry.captureFeedback, this one
 *
 * So the rule lives here and both senders call it, rather than a third hand-copy waiting to drift.
 * [[two-owners-is-the-root-cause]] [[no-half-fixes-enforce-every-surface]]
 */
import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

export interface FeedbackEntry {
  text: string;
  details?: unknown;
  kind?: string;
  context?: unknown;
}

/**
 * `details` is typed loose and IS an object on the round-trace path (`details: { trace: body }`).
 * Template-interpolating it yields "[object Object]" and silently loses the entire trace — the
 * regression the-issue-inbox-carries-only-real-issues.test.ts was written for. Stringify; never
 * interpolate.
 */
export function renderFeedbackMessage(text: string, details: unknown): string {
  if (details == null) return text;
  if (typeof details === 'string') return `${text}\n\n${details}`;
  try { return `${text}\n\n${JSON.stringify(details, null, 2)}`; } catch { return text; }
}

/**
 * Mirror one already-stored entry into Sentry as user feedback.
 *
 * Call AFTER the POST succeeds and only on the ok-branch: Supabase stays the durable record and a
 * Sentry outage must never cost an entry. Never throws — captureFeedback is fire-and-forget
 * telemetry and must not be able to fail a send that already succeeded.
 */
export function sendIssueFeedback(
  entry: FeedbackEntry,
  opts: { reporter: string; installId: string | null },
): void {
  /**
   * DO NOT SEND A CRASH AS FEEDBACK. Sentry's global handler already captured `uncaught_js_error`
   * as a fatal EXCEPTION with a real stack; sending the issue-log copy as feedback puts one event
   * in the project twice under two shapes — which is what Tim saw on 2026-09-06. The whole reason
   * to merge the log into Sentry was ONE fingerprint space.
   */
  if (entry.kind === 'app_error') return;
  try {
    const ctx = (entry.context && typeof entry.context === 'object' ? entry.context : {}) as Record<string, unknown>;
    Sentry.captureFeedback({
      message: renderFeedbackMessage(entry.text, entry.details),
      name: opts.reporter,
      source: 'issue-log',
      tags: {
        install_id: opts.installId ?? 'unknown',
        platform: Platform.OS,
        // The round context triage needs to reproduce: which course, which hole, mid-round or not.
        course_id: String(ctx.courseId ?? 'none'),
        hole: String(ctx.currentHole ?? 'none'),
        round_active: String(ctx.isRoundActive ?? false),
        route: String(ctx.route ?? 'unknown'),
        app_version: String(ctx.appVersion ?? 'unknown'),
        // 2026-09-10 — lets a field-test report be filtered out of the noise in one click.
        kind: String(ctx.kind ?? entry.kind ?? 'issue'),
      },
    });
  } catch { /* telemetry only; the entry is already stored server-side */ }
}
