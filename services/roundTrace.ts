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
import { useRoundTraceStore, MAX_ROWS, MAX_ROWS_DEEP, type TraceEvent, type TraceRow } from '../store/roundTraceStore';
import { isTestRunner } from './isTestRunner';

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

/**
 * Record one tick ONLY during an owner field-test round.
 *
 * 2026-09-10 (Tim: "give me an owners tool toggle that will track a round I play for all key
 * touchpoints to look for errors and issues and opportunities through a full real test round").
 *
 * Every normal round is already traced. What a field test adds is the DECISION POINTS — not "the
 * yardage was 148" but "the yardage was 148 because tier 3 answered and tiers 1 and 2 were empty";
 * not "no shot was logged" but "a shot was detected and then dropped, here is the gate that dropped
 * it". Those are far too chatty for every round and are the entire point of one.
 *
 * Same contract as `trace`: never throws, never awaits, one boolean read when the mode is off.
 */
export function traceDeep(event: TraceEvent, tag: string, data?: TraceRow['data']): void {
  try {
    const s = useRoundTraceStore.getState();
    if (!s.deep) return;
    s.push(event, tag, data);
  } catch { /* tracing must never affect the app */ }
}

/** Begin tracing a round. `deep` turns on owner field-test instrumentation. */
export function startRoundTrace(label: string, deep = false): void {
  try { useRoundTraceStore.getState().start(label, deep); } catch { /* non-fatal */ }
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
  /**
   * 2026-09-05 — this counted `round/hole` rows, and hole 1 never emits one: the round OPENS on it,
   * so the first hole is announced by `round/start`. A nine-hole round therefore reported "holes
   * seen 8" above a timeline listing nine — the one thing this formatter's header promises cannot
   * happen ("built from the rows themselves… so the summary can never disagree with the timeline").
   * A summary that undercounts holes is worse than no summary: it reads as a hole-advance bug.
   *
   * Counting every hole number the trace mentions, wherever it appears, cannot drift from the
   * timeline again — a hole is "seen" exactly when a row names it. [[state-what-you-measured-not-what-you-intended]]
   */
  const holes = new Set(
    rows.map(r => r.data?.hole).filter(h => h !== undefined && h !== null && h !== '').map(String),
  ).size;
  const geometry = rows.find(r => r.tag === 'geometry');

  const dur = rows.length ? rows[rows.length - 1].t : 0;

  const summary = [
    `ROUND TRACE — ${s.label ?? 'round'}`,
    /**
     * 2026-09-10 — the "buffer full" note compared against a HARDCODED 2000 while the store owns
     * the ceiling, and field-test mode raised that ceiling to 20,000. Left as it was, a full
     * field-test buffer (which HAS dropped its earliest rows) would print no warning at all, and a
     * 2,000-row field-test trace that dropped nothing would claim it had. Ask the store.
     * [[two-owners-is-the-root-cause]]
     */
    `duration ${stamp(dur)} · ${rows.length} events${rows.length >= (s.deep ? MAX_ROWS_DEEP : MAX_ROWS) ? ' (buffer full — earliest rows dropped)' : ''}`,
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
 * 2026-09-04 — ONE SEND PER ROUND, however many times this is called.
 *
 * Tim received SEVEN identical "ROUND TRACE — Menifee Lakes Palms" emails stamped within 400ms of
 * each other, then seven more three minutes later for the next round. Each said "New entries: 1",
 * so the batching was working exactly as documented — the function was simply invoked seven times.
 *
 * The call sits in an IIFE spread into the RoundRecord literal in roundStore.endRound. Whatever
 * makes that literal evaluate more than once (a double-tapped End Round, a re-entrant save), the
 * fix does not belong in the caller: a fire-and-forget diagnostic must not depend on the discipline
 * of the code that fires it. A guard here is correct for every caller, present and future.
 *
 * Deduped on label + a 60s window rather than a plain in-flight flag, because the seven calls were
 * near-simultaneous AND the first would have completed before the last arrived. Both shapes are
 * covered: concurrent calls share the in-flight promise, later ones inside the window are dropped.
 * A genuinely new round more than a minute later still sends. [[a-call-nobody-asked-should-exist]]
 */
let inFlight: Promise<boolean> | null = null;
let lastSentKey: string | null = null;
let lastSentAt = 0;
const TRACE_DEDUPE_MS = 60_000;

/** Test seam — the guard is module state and would otherwise leak between cases. */
export function _resetRoundTraceSendGuard(): void {
  inFlight = null;
  lastSentKey = null;
  lastSentAt = 0;
}

/**
 * SEND the finished trace, then clear it.
 *
 * 2026-09-10 — this said "mail" and "reach Tim's inbox". The server emailer was deleted on
 * 2026-09-06 ("one inbox — issue log goes to Sentry, email path removed"), so for four days these
 * comments described a delivery mechanism that no longer existed. /api/issue-report now writes the
 * durable row to Supabase, and the CLIENT mirrors the entry into Sentry — which is where it is
 * actually read. Reuses that one transport rather than adding a second path that could rot
 * separately. Sent as ONE entry, not hundreds: a round's trace
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

  /**
   * 2026-09-05 — THE TWO GATES THIS SENDER NEVER HAD, both already enforced on the OTHER POST to
   * /api/issue-report (services/issueLogExport). This file was written 08-12 and predates them.
   *
   * isTestRunner: a jest run calls the real endRound(), which fire-and-forgets this. That is how
   * thirteen "ROUND TRACE — Menifee Lakes Palms" emails arrived overnight from a tester who does not
   * exist. __tests__/setupNoNetwork.ts now blocks the socket too; this is the same rule stated where
   * the send decision is actually made, so it holds under any runner, not just jest.
   *
   * shareDiagnostics: a CONSENT toggle in Settings, split out in the 2026-07-27 privacy audit
   * precisely so a player could refuse diagnostic uploads — with a persist migration written to keep
   * an existing opt-out from silently flipping true. This sender ignored it and mailed a full
   * tick-by-tick round timeline at the end of every round regardless. That is the more serious half
   * of today's find: the emails were noise for Tim, but for a player who said no it was a send that
   * should never have left the phone. [[no-half-fixes-enforce-every-surface]]
   */
  if (isTestRunner()) { store.clear(); return false; }
  try {
    const { useSettingsStore } = require('../store/settingsStore') as typeof import('../store/settingsStore');
    if (useSettingsStore.getState().shareDiagnostics === false) { store.clear(); return false; }
  } catch { /* a settings read must never strand the round */ }

  const key = store.label ?? 'round';
  if (inFlight) return inFlight;
  if (lastSentKey === key && Date.now() - lastSentAt < TRACE_DEDUPE_MS) return false;

  inFlight = sendRoundTraceOnce(reporter, key);
  try { return await inFlight; } finally { inFlight = null; }
}

async function sendRoundTraceOnce(reporter: string, key: string): Promise<boolean> {
  const store = useRoundTraceStore.getState();
  /**
   * 2026-09-10 — the FIELD REPORT leads, the timeline follows.
   *
   * Same principle the trace summary was built on and one level up: a field-test round produces
   * thousands of rows, and the finding is never the row you happen to scroll to. The analysis goes
   * at the TOP of the email so the first thing read is "hole 7 never resolved a green" rather than
   * hole 1's first GPS fix. The timeline stays underneath, because the summary answers "what broke"
   * and only the timeline answers "why".
   */
  const fieldReport = (() => {
    if (!store.deep) return '';
    try {
      const fr = require('./roundFieldReport') as typeof import('./roundFieldReport');
      return fr.formatFieldReport(store.rows) + '\n' + '='.repeat(60) + '\n\n';
    } catch { return ''; }
  })();
  const body = fieldReport + formatRoundTrace();
  const label = (store.deep ? 'FIELD TEST — ' : '') + (store.label ?? 'round');
  store.stop();
  try {
    // Lazy requires: this runs once per round, and importing the whole API/platform surface at
    // module load for a once-per-round call is not worth it.
    const { getApiBaseUrl, appKeyHeaders } = require('./apiBase') as typeof import('./apiBase');
    const { Platform } = require('react-native') as typeof import('react-native');
    const base = getApiBaseUrl();
    if (!base) return false;
    /**
     * 2026-09-05 — WITHOUT THIS, EVERY ROUND TRACE EMAIL LIED ABOUT THE BUILD.
     *
     * api/issue-report reads the install id out of `context` and otherwise prints
     * "Install: unknown (pre-2026-08-13 build)". This sender builds its own entry and never attached
     * one — only services/issueLogExport did — so a trace mailed from today's build was labelled as
     * coming from a build three weeks older than the trace format itself. Tim read that line and
     * reasonably concluded a stale tester install was the problem.
     *
     * Never throws and never blocks: getInstallId() returns null rather than failing, and an
     * unattributed trace still sends. [[a-stale-header-is-a-source-someone-trusts]]
     */
    const { getInstallId } = require('./installId') as typeof import('./installId');
    const installId = await getInstallId().catch(() => null);
    /**
     * 2026-09-10 — ONE context object, used by the POST and by the Sentry mirror below.
     *
     * These were briefly written out twice, and the two copies had already disagreed: the POST said
     * `kind: 'round_trace'` unconditionally while the mirror said `field_test` for a deep run, so
     * the same entry would have carried two different kinds in Supabase and in Sentry. That is the
     * very defect this change exists to close, one level down. Build it once.
     *
     * `kind` is what makes an owner field-test report filterable out of the ordinary trace noise,
     * so it has to be the DEEP-aware value — and `store.stop()` above clears only `active`, leaving
     * `deep` readable here.
     */
    const entryContext: Record<string, unknown> = { kind: store.deep ? 'field_test' : 'round_trace' };
    if (installId) entryContext.installId = installId;
    const entryText = `ROUND TRACE — ${label}`;
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/issue-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...appKeyHeaders() },
      body: JSON.stringify({
        entries: [{
          id: `trace_${Date.now()}`,
          text: entryText,
          reporter,
          platform: Platform.OS,
          context: entryContext,
          /**
           * 2026-09-04 — WAS `details: body`, a bare string, and the whole trace was discarded.
           *
           * api/issue-report's renderer prints details only when `typeof r.details === 'object'`.
           * A string fails that test, so `det` came out empty and every ROUND TRACE email Tim
           * received contained one line — the title — and none of the timeline it exists to carry.
           * The diagnostic was mailed and its entire contents thrown away.
           */
          details: { trace: body },
          timestamp: Date.now(),
        }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      /**
       * 2026-09-10 — THE TRACE ALSO GOES TO SENTRY, like every other issue entry.
       *
       * The 2026-09-06 refactor merged the issue log into Sentry and DELETED the server emailer.
       * It was wired into services/issueLogExport — and this is a SECOND sender that POSTs its own
       * entry and never joins that list, so the round trace (and the owner Field Test report built
       * on it) landed in Supabase and nowhere else. The comments in this file still said "mail"
       * and "emailed" four days after the email path stopped existing.
       *
       * Third time a second sender missed the first one's treatment (test-runner guard 08-29,
       * consent check 09-05, this). The rule now lives in services/issueFeedback and both call it.
       *
       * After the POST and inside the ok-branch on purpose: Supabase stays the durable record and a
       * Sentry outage must not cost the trace. [[a-finding-that-cannot-leave-the-device]]
       */
      try {
        const fb = require('./issueFeedback') as typeof import('./issueFeedback');
        fb.sendIssueFeedback(
          { text: entryText, details: { trace: body }, context: entryContext },
          { reporter, installId },
        );
      } catch { /* telemetry only; the trace is already stored server-side */ }
      lastSentKey = key;
      lastSentAt = Date.now();
      store.clear();
      return true;
    }
    return false;
  } catch {
    return false; // walking off the course with no signal is the normal failure here
  }
}
