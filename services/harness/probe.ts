/**
 * 2026-09-01 — HARNESS PROBES: what the device did, not just what the harness asserted.
 *
 * Tim: "Make sure the harness is as robust as possible so that it would throw any time stamps, flow
 * issues, bottlenecks, yada yada yada that are as close to the actual progress on the device as
 * possible and gives you as much diagnostic data that we need."
 *
 * The gap this closes: until now a scenario could only see its OWN steps. It called a function, timed
 * it, and asserted on the return value. Everything the app did along the way — a caught error logged
 * and swallowed, a breadcrumb written to the issue log, three seconds where the JS thread never came
 * back — was invisible. A scenario could go green while the app screamed.
 *
 * Three probes, each aimed at one of the three things Tim named:
 *
 *   FLOW      — `IssueEventProbe` diffs the app's OWN issue-log breadcrumbs across a scenario. Zero
 *               new instrumentation: the pipelines already write their stages there, so this reads
 *               the real device progress rather than a re-enactment of it.
 *   ERRORS    — `ConsoleProbe` captures console.error/warn during the run. A swallowed catch that
 *               logs and returns null is the exact failure shape this app keeps finding in the field;
 *               it never fails an assert, and now it never escapes one either.
 *   BOTTLENECK— `LoopLagProbe` samples timer drift. If the JS thread is blocked for 900ms, every
 *               `within()` budget on that thread inherits the stall, and the check that happens to be
 *               running takes the blame. Measuring the thread separates "this step is slow" from
 *               "the device was busy" — two findings with completely different fixes.
 *
 * All three are best-effort and self-restoring: a probe that throws, or one that is left patched
 * because a scenario threw mid-run, would be worse than no probe at all.
 */

export interface ProbeTrace {
  /** console.error/warn seen during the scenario, newest last, truncated. */
  logs?: string[];
  /** Issue-log breadcrumbs the APP wrote during the scenario: `+123ms stage {detail}`. */
  flow?: string[];
  /** Worst JS-thread stall observed, in ms. The bottleneck number. */
  maxLagMs?: number;
}

/* ── ERRORS ──────────────────────────────────────────────────────────────────────────────────── */

type ConsoleFn = (...args: unknown[]) => void;

export class ConsoleProbe {
  private readonly lines: string[] = [];
  private restore: (() => void) | null = null;
  private readonly t0 = Date.now();
  /**
   * The self-test needs to observe a line it emits ITSELF, and every line the harness emits is
   * normally filtered as its own echo. Only the self-test passes true. [[break-test-every-guard-you-write]]
   */
  constructor(private readonly includeHarnessLines = false) {}

  start(): void {
    if (this.restore) return;
    const c = console as unknown as Record<string, ConsoleFn>;
    const origError = c.error;
    const origWarn = c.warn;
    const grab = (level: string, orig: ConsoleFn) => (...args: unknown[]) => {
      try {
        // The harness's own PASS/FAIL mirror lines are not findings — they are this file's echo.
        const text = args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeJson(a))).join(' ');
        if ((this.includeHarnessLines || !text.startsWith('[harness ')) && this.lines.length < 40) {
          this.lines.push(`+${Date.now() - this.t0}ms ${level} ${text.slice(0, 200)}`);
        }
      } catch { /* capture must never break the log it is watching */ }
      orig.apply(console, args as never[]);
    };
    c.error = grab('ERROR', origError);
    c.warn = grab('WARN', origWarn);
    this.restore = () => { c.error = origError; c.warn = origWarn; };
  }

  /** Always call this, including on the throw path — a leaked patch would follow the app around. */
  stop(): string[] {
    try { this.restore?.(); } catch { /* ignore */ }
    this.restore = null;
    return this.lines;
  }
}

/* ── FLOW ────────────────────────────────────────────────────────────────────────────────────── */

export class IssueEventProbe {
  private seen = new Set<string>();
  private readonly t0 = Date.now();
  /** Only the self-test wants the harness's own entries back; see ConsoleProbe. */
  constructor(private readonly includeHarnessEntries = false) {}

  start(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useIssueLogStore } = require('../../store/issueLogStore') as typeof import('../../store/issueLogStore');
      for (const e of useIssueLogStore.getState().entries) this.seen.add(e.id);
    } catch { /* no store, no flow trace */ }
  }

  /**
   * Everything the app logged that was NOT there when we started, oldest first — which is the order
   * it happened in, and the order it has to be read in to be a flow.
   */
  stop(): string[] {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useIssueLogStore } = require('../../store/issueLogStore') as typeof import('../../store/issueLogStore');
      const fresh = useIssueLogStore.getState().entries.filter(e => !this.seen.has(e.id));
      return fresh
        .slice(0, 20)
        .reverse()
        .filter(e => this.includeHarnessEntries || !String(e.stage ?? '').startsWith('harness_'))
        .map(e => {
          const at = Math.max(0, e.timestamp - this.t0);
          const detail = e.details ? safeJson(e.details).slice(0, 120) : '';
          return `+${at}ms ${e.stage ?? e.kind ?? 'entry'}${detail ? ' ' + detail : ''}`;
        });
    } catch {
      return [];
    }
  }
}

/* ── BOTTLENECK ──────────────────────────────────────────────────────────────────────────────── */

/** How often we look. 100ms is frequent enough to catch a stall, cheap enough to leave running. */
const LAG_SAMPLE_MS = 100;
/** Below this, drift is scheduler noise, not a stall worth naming. */
export const LAG_NOISE_FLOOR_MS = 60;

export class LoopLagProbe {
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private max = 0;

  start(): void {
    if (this.timer) return;
    this.last = Date.now();
    this.max = 0;
    this.timer = setInterval(() => {
      const now = Date.now();
      // Drift = how much LATER than scheduled we ran = how long the thread was unavailable.
      const drift = now - this.last - LAG_SAMPLE_MS;
      if (drift > this.max) this.max = drift;
      this.last = now;
    }, LAG_SAMPLE_MS);
  }

  /** Worst stall in ms, or 0 when the thread stayed responsive. Always clears the timer. */
  stop(): number {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    return this.max > LAG_NOISE_FLOOR_MS ? this.max : 0;
  }
}

/**
 * The one scenario whose console errors and thread stalls are DELIBERATE — it causes them to prove
 * the probes see them. The run summary excludes it, or every run would report a stall it created
 * itself and the signal would be worthless the day it mattered. [[three-ways-a-guard-is-worthless]]
 */
export const SELFTEST_SCENARIO_ID = 'C24';

function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}
