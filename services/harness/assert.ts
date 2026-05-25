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
