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
  /**
   * 2026-09-01 (Tim: the harness should surface "timestamps, flow issues, bottlenecks... as close to
   * the actual progress on the device as possible"). How long this step took, when it measured
   * something. A pass/fail alone cannot show a bottleneck — a check that passes in 4 seconds is a
   * finding, and without this it looked identical to one that passed in 4ms.
   */
  ms?: number;
  /** Milliseconds since the scenario started, so the ORDER and the gaps are readable. */
  atMs?: number;
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
  private readonly startedAt = Date.now();
  /** Set by time()/timeAsync so the check it wraps carries its own duration. */
  private pendingMs: number | null = null;

  constructor(scenarioId: string) {
    this.scenarioId = scenarioId;
  }

  expect(label: string, predicate: boolean, detail?: string): void {
    const status: CheckStatus = predicate ? 'pass' : 'fail';
    const ms = this.pendingMs;
    this.pendingMs = null;
    const row: Check = { label, status, detail, atMs: Date.now() - this.startedAt, ...(ms != null ? { ms } : {}) };
    this.checks.push(row);
    const tag = status === 'pass' ? 'PASS' : 'FAIL';
    const tail = detail ? `  ↳ ${detail}` : '';
    const dur = ms != null ? ` (${ms}ms)` : '';
    console.log(`[harness ${this.scenarioId}] +${row.atMs}ms ${tag}${dur}  ${label}${tail}`);
  }

  /**
   * Measure an async step and assert on how long it took. This is the bottleneck detector: the
   * budget is part of the assertion, so a step that still WORKS but got slow fails loudly instead of
   * passing quietly. Returns the value so the caller can keep using it.
   */
  async within<T>(label: string, budgetMs: number, fn: () => Promise<T>): Promise<T | null> {
    const t0 = Date.now();
    let value: T | null = null;
    let threw: string | null = null;
    try {
      value = await fn();
    } catch (e) {
      threw = e instanceof Error ? e.message.slice(0, 140) : String(e).slice(0, 140);
    }
    const took = Date.now() - t0;
    this.pendingMs = took;
    if (threw) {
      this.expect(label, false, `threw after ${took}ms: ${threw}`);
      return null;
    }
    this.pendingMs = took;
    this.expect(label, took <= budgetMs, `${took}ms (budget ${budgetMs}ms)`);
    return value;
  }

  /** Record a measurement without a pass/fail opinion — context the reader needs to interpret the rest. */
  note(label: string, detail: string): void {
    const row: Check = { label, status: 'skip', detail, atMs: Date.now() - this.startedAt };
    this.checks.push(row);
    console.log(`[harness ${this.scenarioId}] +${row.atMs}ms NOTE  ${label}  ↳ ${detail}`);
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


/**
 * 2026-09-01 (Tim: "give me as much diagnostic data as we need for this to be a useful exercise").
 *
 * THE RUN SUMMARY. Per-scenario failures say what broke; this says what the device was while it
 * broke, and where the time went. Both halves are needed to read a log cold: a failure without the
 * build, the runtime and whether pose is even linked is a puzzle, and a run where everything passes
 * but one step took nine seconds is a finding that no pass/fail row would ever show.
 *
 * Logged for EVERY run, pass or fail — this one is the context, not the alarm.
 */
export async function logRunSummaryToIssueLog(reports: ScenarioReport[]): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useIssueLogStore } = require('../../store/issueLogStore') as typeof import('../../store/issueLogStore');

    const failed = reports.filter((r) => r.status === 'fail');
    const allChecks = reports.flatMap((r) => r.checks.map((c) => ({ ...c, scenario: r.id })));
    // The bottleneck view: what actually cost time, regardless of whether it passed.
    const slowest = allChecks
      .filter((c) => typeof c.ms === 'number')
      .sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))
      .slice(0, 6)
      .map((c) => `${c.scenario}:${c.label} ${c.ms}ms${c.status === 'fail' ? ' FAIL' : ''}`);

    // What this device IS. Every one of these has silently changed an outcome at least once.
    const env: Record<string, unknown> = {};
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Platform } = require('react-native') as typeof import('react-native');
      env.os = `${Platform.OS} ${String(Platform.Version)}`;
    } catch { /* context is best-effort */ }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Updates = require('expo-updates') as typeof import('expo-updates');
      env.runtime = Updates.runtimeVersion ?? null;
      env.updateId = Updates.updateId ?? 'embedded';
      env.channel = Updates.channel ?? null;
    } catch { /* bare/dev builds have no updates module */ }
    try {
      const mp = await import('../mediaPipePoseService');
      const st = await mp.getMediaPipeStatus();
      // The single most consequential device fact: without this, every on-device locate silently
      // falls back to the network call it was built to replace.
      env.poseAvailable = st.available;
      env.poseModelLoaded = st.modelLoaded;
    } catch { env.poseAvailable = 'probe_failed'; }
    try {
      const { getApiBaseUrl } = await import('../apiBase');
      env.apiBase = getApiBaseUrl() || null;
    } catch { /* ignore */ }

    useIssueLogStore.getState().addAppEvent('harness_run', {
      scenarios: reports.length,
      failed: failed.length,
      failedIds: failed.map((r) => r.id),
      totalMs: reports.reduce((n, r) => n + r.durationMs, 0),
      slowestScenario: [...reports].sort((a, b) => b.durationMs - a.durationMs)[0]?.id ?? null,
      slowestSteps: slowest,
      ...env,
    }, failed.length > 0 ? 'app_error' : 'diag');
  } catch { /* a summary must never break a run */ }
}
