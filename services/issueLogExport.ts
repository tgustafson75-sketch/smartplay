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

// App-key gate → shared appKeyHeaders() (services/apiBase.ts), mirrors api/_appKey.ts on the server.
const AUTOSEND_DEBOUNCE_MS = 4000;
const sentIds = new Set<string>();
let autoSendTimer: ReturnType<typeof setTimeout> | null = null;

function fmtTs(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function entryBlock(e: IssueLogEntry): string {
  const ctx = e.context;
  const ctxLine = `  [${fmtTs(e.timestamp)} · ${ctx.persona ?? '—'} · ${ctx.isRoundActive ? `hole ${ctx.currentHole ?? '?'} @ ${ctx.courseId ?? '?'}` : 'no round'}]`;
  const detailsLine = e.details && Object.keys(e.details).length > 0
    ? `\n  ${Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}`
    : '';
  return `• ${e.text}\n${ctxLine}${detailsLine}`;
}

/** Build the full email body (Reporter / Entries / Device + every entry w/ details). */
export function buildIssueLogBody(): { subject: string; body: string; count: number } {
  const entries = useIssueLogStore.getState().entries;
  const reporter = usePlayerProfileStore.getState().email || 'beta tester';
  const text = entries.map(entryBlock).join('\n\n');
  const subject = `SmartPlay Caddie issue log — ${reporter}`;
  const body = `Reporter: ${reporter}\nEntries: ${entries.length}\nDevice: ${Platform.OS}\n\n${text}\n\n— Sent from SmartPlay Caddie Issue Log`;
  return { subject, body, count: entries.length };
}

/**
 * 2026-07-23 — Consented auto-send: when the community-data toggle is ON, push unsent
 * issue entries to /api/issue-report so the team sees them centrally without the tester
 * having to tap "Send". Debounced + deduped by entry id. Best-effort; never throws, never
 * blocks. The mailto export below stays as the explicit manual action. Call schedule* from
 * the store's user-reported add path (NOT the high-volume diagnostic traces).
 */
export function scheduleIssueAutoSend(): void {
  if (useSettingsStore.getState().shareCommunityData === false) return;
  if (autoSendTimer) clearTimeout(autoSendTimer);
  autoSendTimer = setTimeout(() => { void autoSendIssues(); }, AUTOSEND_DEBOUNCE_MS);
}

export async function autoSendIssues(): Promise<boolean> {
  if (useSettingsStore.getState().shareCommunityData === false) return false;
  const base = getApiBaseUrl();
  if (!base) return false;
  const reporter = usePlayerProfileStore.getState().email || 'beta tester';
  const unsent = useIssueLogStore.getState().entries.filter(e => !sentIds.has(e.id));
  if (unsent.length === 0) return false;
  const payload = {
    entries: unsent.map(e => ({
      id: e.id,
      text: e.text,
      reporter,
      platform: Platform.OS,
      context: e.context,
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
  const mailto = `mailto:support@smartplaycaddie.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  try {
    if (await Linking.canOpenURL(mailto).catch(() => false)) {
      await Linking.openURL(mailto);
    } else {
      await Share.share({ message: `support@smartplaycaddie.com\n\n${body}`, title: subject });
    }
    useIssueLogStore.getState().markExported();
    return true;
  } catch {
    return false;
  }
}
