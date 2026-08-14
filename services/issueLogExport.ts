/**
 * services/issueLogExport.ts — one-tap issue-log export, shared by the /owner-logs
 * screen AND the owner auto-prompt (components/OwnerIssueLogPrompt).
 *
 * 2026-06-28 (Tim) — Tank doesn't dig through Owner Tools to export; he needs a
 * "5 issues piled up → tap Send" prompt that just opens the email. This centralizes
 * the body-building + mailto/share so both surfaces format identically (incl. the
 * details line) and both reset the auto-prompt count via markExported().
 */

import { Linking, Platform, Share } from 'react-native';
import { useIssueLogStore, type IssueLogEntry } from '../store/issueLogStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useSettingsStore } from '../store/settingsStore';
import { getApiBaseUrl, appKeyHeaders } from './apiBase';
import { getInstallId } from './installId';

// App-key gate → shared appKeyHeaders() (services/apiBase.ts), mirrors api/_appKey.ts on the server.
const AUTOSEND_DEBOUNCE_MS = 4000;
// 2026-07-30 (audit #17) — cap how long the debounce can keep deferring. A SUSTAINED sub-4s failure
// cadence (e.g. glasses DAT_START_FAILED firing every ~1s — see Tim's issue log) re-armed the 4s timer
// forever, so issues NEVER auto-sent while the failures continued. Once a send has been pending this long,
// fire immediately instead of re-arming.
const AUTOSEND_MAX_WAIT_MS = 20000;
const sentIds = new Set<string>();
let autoSendTimer: ReturnType<typeof setTimeout> | null = null;
let autoSendFirstArmedAt = 0;

function fmtTs(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function entryBlock(e: IssueLogEntry): string {
  const ctx = e.context;
  const ctxLine = `  [${fmtTs(e.timestamp)} · ${ctx.persona ?? '—'} · ${ctx.route ?? '—'} · ${ctx.isRoundActive ? `hole ${ctx.currentHole ?? '?'} @ ${ctx.courseId ?? '?'}` : 'no round'}]`;
  const detailsLine = e.details && Object.keys(e.details).length > 0
    ? `\n  ${Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}`
    : '';
  return `• ${e.text}\n${ctxLine}${detailsLine}`;
}

/** Build the full email body (Reporter / Entries / Device + every entry w/ details). */
// 2026-08-10 (Tim — "shut off the non-errors on the issue log"). The store also holds DIAGNOSTIC
// breadcrumbs — every voice turn (voice_turn), the sim-round trace (sim_round), and boot timing (boot).
// Those are for deep owner-log review, NOT issues. What we SEND/EXPORT as an issue report is real
// problems only: actual errors + the tester's own manual notes. (Everything stays in the store; this
// only filters what leaves the device as an "issue".)
const REPORTABLE_KINDS = new Set([
  'user', 'voice_error', 'voice_silent_fail', 'transcribe_error', 'gps_error', 'analysis_error',
  'voice_miss', 'app_error',
]);
function isReportable(e: { kind?: string }): boolean {
  // Legacy entries with no kind are manual user notes → keep.
  return e.kind == null || REPORTABLE_KINDS.has(e.kind);
}

export function buildIssueLogBody(): { subject: string; body: string; count: number } {
  const entries = useIssueLogStore.getState().entries.filter(isReportable);
  const reporter = usePlayerProfileStore.getState().email || 'beta tester';
  const text = entries.map(entryBlock).join('\n\n');
  const subject = `SmartPlay Caddie issue log — ${reporter}`;
  const body = `Reporter: ${reporter}\nEntries: ${entries.length}\nDevice: ${Platform.OS}\n\n${text}\n\n— Sent from SmartPlay Caddie Issue Log`;
  return { subject, body, count: entries.length };
}

/**
 * 2026-07-23 — Consented auto-send: push unsent issue entries to /api/issue-report so the team sees
 * them centrally without the tester tapping "Send". Debounced + deduped by entry id. Best-effort; never
 * throws, never blocks. The mailto export below stays as the explicit manual action.
 * 2026-07-26 (deep audit S3) — this ships the tester's EMAIL + diagnostics, so it's gated on the SEPARATE
 * `shareDiagnostics` consent (was `shareCommunityData`, which is really about course-map coords) so PII
 * no longer rides the course-sharing toggle silently.
 */
export function scheduleIssueAutoSend(): void {
  if (useSettingsStore.getState().shareDiagnostics === false) return;
  const now = Date.now();
  if (!autoSendTimer) autoSendFirstArmedAt = now;
  // Been deferring under a sustained failure cadence past the cap → flush now instead of re-arming.
  if (autoSendTimer && now - autoSendFirstArmedAt >= AUTOSEND_MAX_WAIT_MS) {
    clearTimeout(autoSendTimer); autoSendTimer = null; autoSendFirstArmedAt = 0;
    void autoSendIssues();
    return;
  }
  if (autoSendTimer) clearTimeout(autoSendTimer);
  autoSendTimer = setTimeout(() => { autoSendTimer = null; autoSendFirstArmedAt = 0; void autoSendIssues(); }, AUTOSEND_DEBOUNCE_MS);
}

export async function autoSendIssues(): Promise<boolean> {
  if (useSettingsStore.getState().shareDiagnostics === false) return false;
  const base = getApiBaseUrl();
  if (!base) return false;
  const reporter = usePlayerProfileStore.getState().email || 'beta tester';
  // 2026-08-10 — only real errors + manual notes auto-send; the voice_turn / sim_round / boot
  // breadcrumbs stay device-side for owner-log review and never clutter the issue email.
  const unsent = useIssueLogStore.getState().entries.filter(e => !sentIds.has(e.id) && isReportable(e));
  if (unsent.length === 0) return false;
  /**
   * 2026-08-13 — attach the anonymous install id HERE, at the single send point, rather than at each
   * of the ~10 places that write an issue entry. One place to be right, and every entry carries it
   * whichever subsystem logged it.
   *
   * It rides inside `context` deliberately: that is already a JSON column server-side, so this needs
   * no migration and cannot break the insert. The reporting path was verified working end-to-end today
   * and is not worth risking for a field.
   */
  const installId = await getInstallId();
  const payload = {
    entries: unsent.map(e => ({
      id: e.id,
      text: e.text,
      reporter,
      platform: Platform.OS,
      context: installId
        ? { ...(e.context && typeof e.context === 'object' ? e.context : {}), installId }
        : e.context,
      details: e.details ?? null,
      timestamp: e.timestamp,
    })),
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/issue-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...appKeyHeaders() },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      for (const e of unsent) sentIds.add(e.id);
      console.log('[issueLogExport] auto-sent', unsent.length, 'issues');
      return true;
    }
    return false;
  } catch (e) {
    console.log('[issueLogExport] auto-send failed (non-fatal):', e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * One-tap export: open the mail client pre-filled to support@ (or the share sheet
 * if no mail app), then mark the log exported so the auto-prompt count resets.
 * Returns false if there's nothing to send or the handoff failed.
 */
export async function exportAllIssues(): Promise<boolean> {
  const { subject, body, count } = buildIssueLogBody();
  if (count === 0) return false;
  const mailto = `mailto:tim@smartplaycaddie.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  try {
    if (await Linking.canOpenURL(mailto).catch(() => false)) {
      await Linking.openURL(mailto);
    } else {
      await Share.share({ message: `tim@smartplaycaddie.com\n\n${body}`, title: subject });
    }
    useIssueLogStore.getState().markExported();
    return true;
  } catch {
    return false;
  }
}
