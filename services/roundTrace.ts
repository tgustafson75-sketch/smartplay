/**
 * 2026-08-12 — the round trace: one call site services can use freely, and the formatter that turns
 * a round into something readable in an email.
 *
 * Tim: "I want to watch this entire round go into the issue log… tick by tick… but find a way for us
 * to gather some MEANINGFUL diagnostics."
 *
 * That last word is the design. A raw dump of every event is not diagnostics — it's a haystack. So
 * the emailed trace leads with a SUMMARY (what resolved, what failed, how the voice turns performed,
 * whether the watch was heard from) and puts the tick-by-tick underneath. The summary is what
 * answers "did it work"; the timeline is what answers "why not".
 */
import { useRoundTraceStore, type TraceEvent, type TraceRow } from '../store/roundTraceStore';

/**
 * Record one tick. Safe to call from anywhere, including hot paths.
 *
 * Never throws and never awaits: a diagnostic that can break the thing it watches is worse than no
 * diagnostic. When no round is being traced this is a single boolean check.
 */
export function trace(event: TraceEvent, tag: string, data?: TraceRow['data']): void {
  try {
    useRoundTraceStore.getState().push(event, tag, data);
  } catch { /* tracing must never affect the app */ }
}

/** Begin tracing a round. */
export function startRoundTrace(label: string): void {
  try { useRoundTraceStore.getState().start(label); } catch { /* non-fatal */ }
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');
/** mm:ss.t — relative to trace start, which is how you read a round back. */
function stamp(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 60), 2)}:${pad(s % 60, 2)}.${Math.floor((ms % 1000) / 100)}`;
}

function fmtData(d?: TraceRow['data']): string {
  if (!d) return '';
  const parts = Object.entries(d)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? '  ' + parts.join(' ') : '';
}

/**
 * The email body: a summary that answers "did it work", then the full timeline.
 *
 * Built from the rows themselves rather than from counters kept alongside them, so the summary can
 * never disagree with the timeline underneath it.
 */
export function formatRoundTrace(): string {
  const s = useRoundTraceStore.getState();
  const rows = s.rows;
  if (rows.length === 0) return 'Round trace: no events recorded.';

  const by = (e: TraceEvent) => rows.filter(r => r.event === e);
  const tagged = (t: string) => rows.filter(r => r.tag === t);
  const errors = by('error');

  // Voice turns: pair each tap with its outcome so the summary can state a real success rate rather
  // than a count of attempts.
  const turnsStarted = tagged('turn_start').length;
  const turnsOk = tagged('turn_reply').length;
  const transcribeFails = rows.filter(r => r.tag === 'transcribe_fail').length;
  const firstTurn = rows.find(r => r.tag === 'turn_start');
  const firstReply = rows.find(r => r.tag === 'turn_reply');

  const swings = by('watch').filter(r => r.tag === 'swing').length;
  const holes = new Set(by('round').filter(r => r.tag === 'hole').map(r => String(r.data?.hole))).size;
  const geometry = rows.find(r => r.tag === 'geometry');

  const dur = rows.length ? rows[rows.length - 1].t : 0;

  const summary = [
    `ROUND TRACE — ${s.label ?? 'round'}`,
    `duration ${stamp(dur)} · ${rows.length} events${rows.length >= 2000 ? ' (buffer full — earliest rows dropped)' : ''}`,
    '',
    'SUMMARY',
    `  course geometry   ${geometry ? `${geometry.data?.holes ?? '?'} holes, ${geometry.data?.greens ?? '?'} greens, ${geometry.data?.tees ?? '?'} tees (${geometry.data?.source ?? 'unknown'})` : 'NEVER BUILT'}`,
    `  holes seen        ${holes}`,
    `  watch swings      ${swings}${swings === 0 ? '   ← watch never reported (was capture started?)' : ''}`,
    `  voice turns       ${turnsOk}/${turnsStarted} completed${transcribeFails ? ` · ${transcribeFails} transcribe failures` : ''}`,
    `  FIRST turn        ${firstTurn ? (firstReply ? `ok at ${stamp(firstReply.t)}` : 'STARTED BUT NEVER COMPLETED') : 'none attempted'}`,
    `  errors            ${errors.length}`,
    ...(errors.length
      ? ['', 'ERRORS', ...errors.slice(0, 20).map(e => `  ${stamp(e.t)}  ${e.tag}${fmtData(e.data)}`)]
      : []),
    '',
    'TIMELINE',
  ].join('\n');

  const timeline = rows
    .map(r => `${stamp(r.t)}  ${r.event.padEnd(7)} ${r.tag}${fmtData(r.data)}`)
    .join('\n');

  return `${summary}\n${timeline}\n`;
}

/**
 * Mail the finished trace, then clear it.
 *
 * Reuses /api/issue-report — the transport already wired to reach Tim's inbox — rather than adding a
 * second delivery path that could rot separately. Sent as ONE entry, not hundreds: a round's trace
 * is a single document, and splitting it across entries would interleave it with real errors in the
 * email and destroy the ordering that makes it readable.
 *
 * Best-effort by design. If it can't send (no signal walking off 18, most likely) the trace is
 * simply dropped — a diagnostic must never hold up the end of a round, and the round record itself
 * is already saved by this point.
 */
export async function sendRoundTrace(reporter: string): Promise<boolean> {
  const store = useRoundTraceStore.getState();
  if (store.rows.length === 0) { store.clear(); return false; }
  const body = formatRoundTrace();
  const label = store.label ?? 'round';
  store.stop();
  try {
    // Lazy requires: this runs once per round, and importing the whole API/platform surface at
    // module load for a once-per-round call is not worth it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getApiBaseUrl, appKeyHeaders } = require('./apiBase') as typeof import('./apiBase');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as typeof import('react-native');
    const base = getApiBaseUrl();
    if (!base) return false;
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/issue-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...appKeyHeaders() },
      body: JSON.stringify({
        entries: [{
          id: `trace_${Date.now()}`,
          text: `ROUND TRACE — ${label}`,
          reporter,
          platform: Platform.OS,
          context: { kind: 'round_trace' },
          details: body,
          timestamp: Date.now(),
        }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) { store.clear(); return true; }
    return false;
  } catch {
    return false; // walking off the course with no signal is the normal failure here
  }
}
