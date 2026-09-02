/**
 * services/harness/report.ts — THE RUN HAS TO LEAVE THE PHONE.
 *
 * 2026-09-02 (Tim, after running the updated harness: "we didn't export the findings from the
 * harness so that I can share it with you").
 *
 * The oversight, exactly. The harness gained timings, flow, swallowed errors and device facts on
 * 09-01, and all of it lands in two places that don't travel: pixels on the harness screen, and
 * `logScenarioToIssueLog` — which by design logs FAILURES only, so a run that is green-but-slow, or
 * one whose finding is a 4-second pass, produces nothing an inbox ever sees. Tim ran it and had no
 * way to hand the result to anyone.
 *
 * So the run gets a text form. Two exports, one formatter:
 *   - `formatRunReport` — the whole run as pasteable plain text: summary first, then every check of
 *     every scenario with its timings, then the device's own account (flow / swallowed / stalls).
 *   - `collectRunEnv` — what this device IS. Lifted out of assert.ts's run summary so the mailed
 *     summary and the shared report cannot drift into two different answers to the same question.
 *     [[two-owners-is-the-root-cause]]
 *
 * `formatRunReport` is pure and synchronous — no react-native, no expo — so it is testable under
 * jest and can never be the reason an export fails on device. Every native fact it prints arrives as
 * the `env` argument, gathered by `collectRunEnv`, which swallows its own failures.
 */

import type { ScenarioReport, Check } from './assert';

/** Hard cap on the shared string. Android's share intent is not a file transfer; a run that somehow
 *  produced a megabyte of trace should still arrive, truncated and honest about it. */
const MAX_REPORT_CHARS = 100_000;
const MAX_DETAIL = 400;

function clip(v: unknown, max = MAX_DETAIL): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const GLYPH: Record<Check['status'], string> = { pass: '✓', fail: '✗', skip: '·' };

/**
 * What this device IS, best-effort. Every one of these has silently changed an outcome at least
 * once, which is why a report without them is a puzzle rather than evidence.
 *
 * Never throws and never rejects: each fact is independently guarded, and a fact we could not read
 * is simply absent (or, for pose, present as `probe_failed` — "we asked and could not tell" is a
 * different thing from "we never asked"). [[a-field-that-is-sometimes-a-placeholder]]
 */
export async function collectRunEnv(): Promise<Record<string, unknown>> {
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
    // What pose ACTUALLY did most recently, as opposed to whether it could.
    const { describePoseTelemetry } = await import('../poseTelemetry');
    Object.assign(env, describePoseTelemetry() ?? {});
  } catch { /* telemetry is context, never a requirement */ }
  try {
    const { getApiBaseUrl } = await import('../apiBase');
    env.apiBase = getApiBaseUrl() || null;
  } catch { /* ignore */ }
  return env;
}

/**
 * The run, as text someone can paste.
 *
 * Summary first — the failures, the bottlenecks, the stalls and the swallowed errors are named at
 * the top, because a reader who never scrolls past the header should still have the findings.
 * [[adhd-overview-not-data-dump]] Everything below it is the evidence, in run order, with nothing
 * dropped: a slow PASS is a finding and it only exists in the full log.
 *
 * @param reports  every scenario that actually ran, in run order.
 * @param env      device facts from `collectRunEnv` (omit in tests — the report degrades to
 *                 "device: unknown" rather than lying about what it was run on).
 * @param notRunIds scenarios that were never run, so a partial export cannot read as a full pass.
 */
export function formatRunReport(
  reports: ScenarioReport[],
  env: Record<string, unknown> = {},
  notRunIds: string[] = [],
  now: Date = new Date(),
): string {
  const L: string[] = [];
  const pass = reports.filter(r => r.status === 'pass').length;
  const fail = reports.filter(r => r.status === 'fail');
  const skip = reports.filter(r => r.status === 'skip').length;
  const totalMs = reports.reduce((n, r) => n + r.durationMs, 0);

  L.push('SmartPlay Caddie — Scenario Harness');
  L.push(now.toISOString());
  L.push('');

  if (reports.length === 0) {
    L.push('No scenarios have been run in this session — nothing to export.');
    return L.join('\n');
  }

  L.push(`RESULT   ${pass} pass · ${fail.length} fail · ${skip} skip   (${reports.length} scenarios · ${(totalMs / 1000).toFixed(1)}s)`);
  if (fail.length) L.push(`FAILED   ${fail.map(r => r.id).join(', ')}`);
  // A partial run that reads as a clean sweep is the export lying by omission.
  if (notRunIds.length) L.push(`NOT RUN  ${notRunIds.length} scenario(s): ${notRunIds.join(', ')}`);

  const envKeys = Object.keys(env);
  if (envKeys.length) {
    L.push('');
    L.push('DEVICE');
    for (const k of envKeys) L.push(`  ${k}: ${clip(env[k], 200)}`);
  } else {
    L.push('DEVICE   unknown (env probe returned nothing)');
  }

  // The bottleneck view: what cost time, regardless of whether it passed.
  const timed = reports
    .flatMap(r => r.checks.map(c => ({ ...c, scenario: r.id })))
    .filter(c => typeof c.ms === 'number')
    .sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))
    .slice(0, 8);
  if (timed.length) {
    L.push('');
    L.push('SLOWEST STEPS');
    for (const c of timed) {
      L.push(`  ${c.ms}ms  ${c.scenario} · ${clip(c.label, 120)}${c.status === 'fail' ? '  FAIL' : ''}`);
    }
  }

  // Two signals that leave every check green and are findings anyway.
  const stalls = reports.filter(r => (r.trace?.maxLagMs ?? 0) > 0)
    .sort((a, b) => (b.trace?.maxLagMs ?? 0) - (a.trace?.maxLagMs ?? 0));
  if (stalls.length) {
    L.push('');
    L.push('JS THREAD STALLS');
    for (const r of stalls) L.push(`  ${r.trace?.maxLagMs}ms  ${r.id}`);
  }
  const swallowed = reports.flatMap(r => (r.trace?.logs ?? []).map(l => `  ${r.id}  ${clip(l, 220)}`));
  if (swallowed.length) {
    L.push('');
    L.push('SWALLOWED CONSOLE ERRORS');
    L.push(...swallowed.slice(0, 40));
  }

  L.push('');
  L.push('─'.repeat(52));
  L.push('FULL LOG');

  for (const r of reports) {
    L.push('');
    L.push(`${r.status.toUpperCase()} · ${r.id} — ${clip(r.title, 160)}  (${r.durationMs}ms)`);
    if (r.error) L.push(`  THROW · ${clip(r.error, 800)}`);
    if (r.checks.length === 0 && !r.error) L.push('  (no asserts ran)');
    for (const c of r.checks) {
      const g = GLYPH[c.status] ?? '·';
      const t = typeof c.ms === 'number' ? `  ${c.ms}ms` : '';
      const at = typeof c.atMs === 'number' ? `  @${c.atMs}ms` : '';
      L.push(`  ${g} ${clip(c.label, 200)}${t}${at}`);
      if (c.detail) L.push(`      ↳ ${clip(c.detail)}`);
    }
    if (r.trace?.maxLagMs) L.push(`  ⚠ JS thread blocked ${r.trace.maxLagMs}ms during this scenario`);
    if (r.trace?.flow?.length) {
      L.push('  FLOW · what the app logged, in order');
      for (const f of r.trace.flow) L.push(`    ${clip(f, 220)}`);
    }
    if (r.trace?.logs?.length) {
      L.push('  SWALLOWED · console errors during the run');
      for (const l of r.trace.logs) L.push(`    ${clip(l, 220)}`);
    }
  }

  const out = L.join('\n');
  return out.length > MAX_REPORT_CHARS
    ? `${out.slice(0, MAX_REPORT_CHARS)}\n\n[truncated at ${MAX_REPORT_CHARS} chars — ${out.length} total]`
    : out;
}
