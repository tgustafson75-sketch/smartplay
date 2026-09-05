/**
 * 2026-09-05 — ONE OWNER for "am I running under a test runner", because having none cost the same
 * bug twice.
 *
 * 2026-08-29: the Jest suite mailed its own passing assertions to Tim as a 12-entry field report.
 * The class fix put this check on `scheduleIssueAutoSend` and `autoSendIssues` — both in
 * services/issueLogExport, where the function lived as a private local.
 *
 * 2026-09-05: it happened again, thirteen emails overnight. services/roundTrace was written on
 * 08-12, before that fix, and POSTs to the SAME /api/issue-report endpoint through its own sender.
 * It never got the guard, because the guard was not reachable — it was a private function inside the
 * other transport. A rule that only one module can enforce is a rule the next module will miss.
 *
 * So it lives here, exported, and every sender to that endpoint imports it.
 * [[field-report-was-the-test-suite]] [[two-owners-is-the-root-cause]]
 * [[no-half-fixes-enforce-every-surface]]
 *
 * Inert in the app: React Native never sets JEST_WORKER_ID, and NODE_ENV is 'production' in a
 * release bundle. This costs one env read on a path that runs once per round.
 */
export function isTestRunner(): boolean {
  try {
    if (typeof process === 'undefined' || process.env == null) return false;
    return process.env.JEST_WORKER_ID != null || process.env.NODE_ENV === 'test';
  } catch {
    return false;
  }
}
