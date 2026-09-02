/**
 * Scenario harness — assert helper.
 *
 * Lightweight PASS/FAIL accumulator for the in-app scenario runner at
 * `/app/harness.tsx`. Returns a list of `Check` rows the UI surfaces +
 * mirrors a console log line per check so logs survive when the UI
 * scrolls past.
 *
 * 2026-05-24 — Built per the harness expansion sketch. Owner-gated
 * runtime; never reachable from end-user surfaces.
 */

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface Check {
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface ScenarioReport {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  checks: Check[];
  /** Final error if the scenario threw before its asserts ran. */
  error?: string;
}

export class AssertCtx {
  readonly checks: Check[] = [];
  private readonly scenarioId: string;

  constructor(scenarioId: string) {
    this.scenarioId = scenarioId;
  }

  expect(label: string, predicate: boolean, detail?: string): void {
    const status: CheckStatus = predicate ? 'pass' : 'fail';
    const row: Check = { label, status, detail };
    this.checks.push(row);
    const tag = status === 'pass' ? 'PASS' : 'FAIL';
    const tail = detail ? `  ↳ ${detail}` : '';
    console.log(`[harness ${this.scenarioId}] ${tag}  ${label}${tail}`);
  }

  /** Convenience: equality check with a useful detail line on failure. */
  expectEqual<T>(label: string, actual: T, expected: T): void {
    const pass = actual === expected;
    this.expect(
      label,
      pass,
      pass ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }

  /** Convenience: substring presence check (case-insensitive). */
  expectContains(label: string, haystack: string | null | undefined, needle: string): void {
    const hay = (haystack ?? '').toLowerCase();
    const pass = hay.includes(needle.toLowerCase());
    this.expect(
      label,
      pass,
      pass ? undefined : `"${(haystack ?? '').slice(0, 80)}" did not include "${needle}"`,
    );
  }

  /** Mark a check skipped (e.g. native module not bundled). */
  skip(label: string, reason: string): void {
    this.checks.push({ label, status: 'skip', detail: reason });
    console.log(`[harness ${this.scenarioId}] SKIP  ${label}  ↳ ${reason}`);
  }

  hasFailed(): boolean {
    return this.checks.some(c => c.status === 'fail');
  }
}

export function rollupStatus(report: ScenarioReport): 'pass' | 'fail' | 'skip' {
  if (report.error) return 'fail';
  if (report.checks.some(c => c.status === 'fail')) return 'fail';
  if (report.checks.length === 0) return 'skip';
  if (report.checks.every(c => c.status === 'skip')) return 'skip';
  return 'pass';
}

/**
 * 2026-09-01 (Tim) — "anything you'd otherwise ask me to verify should go in the harness, so the SIM
 * can run on the phone and the issue log carries the result."
 *
 * Exactly right, and it closes the loop the harness was missing. It has always PRINTED its rows on
 * screen, which means the result only exists while someone is looking at it — so verifying anything
 * still meant me writing "Tim, please open X and check Y", and him reading rows back to me.
 *
 * A failing scenario now writes itself into the issue log, which he already emails with one tap. The
 * device becomes the thing that answers the question instead of the person holding it.
 *
 * Only FAILURES and errors are logged, with the failing check labels. A pass is not news, and filling
 * the log with green would bury the entries that matter. [[do-the-work-dont-delegate-to-tim]]
 */
export function logScenarioToIssueLog(report: ScenarioReport): void {
  if (report.status !== 'fail') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useIssueLogStore } = require('../../store/issueLogStore') as typeof import('../../store/issueLogStore');
    const failed = report.checks.filter((c) => c.status === 'fail');
    useIssueLogStore.getState().addAppEvent(
      `harness_fail:${report.id}`,
      {
        title: report.title,
        failed: failed.length,
        of: report.checks.length,
        durationMs: report.durationMs,
        // The labels are the whole diagnosis — they say WHICH assertion broke, in words.
        checks: failed.slice(0, 8).map((c) => (c.detail ? `${c.label} — ${c.detail}` : c.label)),
        ...(report.error ? { error: report.error } : {}),
      },
      'app_error',
    );
  } catch { /* telemetry must never break a harness run */ }
}
