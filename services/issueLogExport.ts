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
