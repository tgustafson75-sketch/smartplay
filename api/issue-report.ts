/**
 * 2026-07-23 — Consented issue-log auto-send.
 *
 * The auto-send half of the community-data consent toggle: a consenting tester's
 * user-reported issues POST here and land in smartplay.issue_reports so the team sees them
 * centrally, instead of relying on the manual mailto in services/issueLogExport.ts (which
 * stays as the explicit "Send" action). No email provider is wired server-side yet — this is
 * durable central storage the owner reads; email delivery can layer on later.
 *
 *   POST /api/issue-report
 *     { entries: [{ id, text, reporter?, platform?, context?, details?, timestamp? }, ...] }
 *
 * Idempotent: rows are keyed by the client entry id, so re-sending the same log upserts (no
 * duplicates). App-key gated like the other consented endpoints. Requires migration 0006.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';
import { applyCors } from './_cors';
import { getSmartPlaySupabase } from './_supabase';

const TABLE = 'issue_reports';
const APP_KEY = process.env.SPC_APP_KEY || 'spc_share_k1_2f8d61b4c07a49e3a1d5e9f60b3c7a29';
const MAX_ENTRIES = 200;
const MAX_TEXT = 4000;

function norm(v: unknown): string {
  return String(v ?? '').trim();
}

type Entry = {
  id?: unknown; text?: unknown; reporter?: unknown; platform?: unknown;
  context?: unknown; details?: unknown; timestamp?: unknown;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const provided = norm(req.headers['x-app-key']);
  const ok = provided.length === APP_KEY.length &&
    createHash('sha256').update(provided).digest('hex') === createHash('sha256').update(APP_KEY).digest('hex');
  if (!ok) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const db = getSmartPlaySupabase();
  if (!db) return res.status(200).json({ ok: false, error: 'not_configured' });

  const body = (req.body ?? {}) as { entries?: unknown };
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return res.status(400).json({ ok: false, error: 'no_entries' });
  }
  if (body.entries.length > MAX_ENTRIES) return res.status(413).json({ ok: false, error: 'too_many' });

  const rows = (body.entries as Entry[])
    .map((e) => {
      const text = norm(e.text).slice(0, MAX_TEXT);
      const id = norm(e.id);
      if (!text || !id) return null;
      const ts = Number(e.timestamp);
      // Guard the range: new Date(1e16).toISOString() throws RangeError, and this map runs OUTSIDE
      // the try below. Accept only a plausible epoch-ms (1970 … year 2100).
      const validTs = Number.isFinite(ts) && ts > 0 && ts < 4_102_444_800_000;
      return {
        id,
        reporter: norm(e.reporter) || null,
        platform: norm(e.platform) || null,
        text,
        context: e.context && typeof e.context === 'object' ? e.context : null,
        details: e.details && typeof e.details === 'object' ? e.details : null,
        reported_at: validTs ? new Date(ts).toISOString() : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  if (rows.length === 0) return res.status(400).json({ ok: false, error: 'no_valid_entries' });

  try {
    // 2026-08-06 (Tim — "I have not seen an issue log from anyone else"). Detect which entries are NEW
    // (not already stored) BEFORE the idempotent upsert, so we email only genuinely-new issues. Without
    // this, a tester re-opening the app re-sends its whole (already-stored) log and would re-email it every
    // boot. Best-effort: on a select failure, treat all as new (email once is better than never).
    let newRows = rows;
    try {
      const ids = rows.map((r) => r.id);
      const { data: existing } = await db.from(TABLE).select('id').in('id', ids);
      const seen = new Set((existing ?? []).map((e: { id: string }) => e.id));
      newRows = rows.filter((r) => !seen.has(r.id));
    } catch { /* treat all as new */ }

    const { error } = await db.from(TABLE).upsert(rows, { onConflict: 'id' });
    if (error) return res.status(200).json({ ok: false, error: error.message });

    // Email the owner the NEW entries (Tim's chosen delivery). Gated on RESEND_API_KEY: until it's set on
    // Vercel this is a no-op and the rows still live in Supabase. Best-effort, never fails the request.
    let emailed = false;
    if (newRows.length > 0) emailed = await emailIssuesToOwner(newRows).catch(() => false);

    return res.status(200).json({ ok: true, stored: rows.length, new: newRows.length, emailed });
  } catch (e) {
    console.error('[issue-report] failed:', e instanceof Error ? e.message : e);
    return res.status(200).json({ ok: false, error: 'write_failed' });
  }
}

type StoredRow = {
  id: string; reporter: string | null; platform: string | null; text: string;
  context: unknown; details: unknown; reported_at: string | null;
};

/**
 * 2026-08-09 (Tim — "f a Resend account, I'm over having so many accounts. Make it work with Google") —
 * owner delivery of tester issues via GMAIL SMTP (nodemailer + a Google App Password; no new account,
 * no domain verification). Resend kept ONLY as a fallback if its key happens to be configured.
 * Sends when either transport is configured; otherwise a no-op (rows are already stored in Supabase).
 *   GMAIL_USER                — the Gmail address to send FROM (e.g. t.gustafson75@gmail.com)
 *   GMAIL_APP_PASSWORD        — a Google App Password (Google Account → Security → 2-Step → App passwords)
 *   ISSUE_REPORT_EMAIL_TO     — recipient (default t.gustafson75@gmail.com)
 */
async function emailIssuesToOwner(rows: StoredRow[]): Promise<boolean> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  const resendKey = process.env.RESEND_API_KEY;
  if (!gmailUser || !gmailPass) {
    if (!resendKey) return false;
  }
  const to = process.env.ISSUE_REPORT_EMAIL_TO || 't.gustafson75@gmail.com';
  const from = gmailUser ? `SmartPlay Issues <${gmailUser}>` : (process.env.ISSUE_REPORT_EMAIL_FROM || 'SmartPlay Issues <onboarding@resend.dev>');
  const reporter = rows[0]?.reporter || 'beta tester';
  /**
   * 2026-08-13 — put the anonymous install id in the SUBJECT.
   *
   * Tim couldn't tell whether incoming reports were his own or a tester's, because the From/To are
   * always his Gmail (SMTP sends as the account) and every tester who skipped the email field arrives
   * as the same literal string, "beta tester". Two people and one person twice were indistinguishable.
   *
   * The id is the cheapest possible fix: distinct ids in the inbox = distinct installs, countable at a
   * glance without opening anything. Rides in `context` so it needed no schema change.
   */
  const installId = (() => {
    const ctx = rows[0]?.context as { installId?: unknown } | null | undefined;
    const v = ctx && typeof ctx === 'object' ? ctx.installId : null;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  })();
  const who = installId ? `${reporter} · ${installId}` : reporter;
  const subject = `SmartPlay issue log — ${who} (${rows.length} new)`;
  const block = (r: StoredRow) => {
    const ctx = (r.context ?? {}) as { route?: string; persona?: string; isRoundActive?: boolean; currentHole?: number; courseId?: string };
    const where = ctx.isRoundActive ? `hole ${ctx.currentHole ?? '?'} @ ${ctx.courseId ?? '?'}` : 'no round';
    const det = r.details && typeof r.details === 'object' && Object.keys(r.details).length
      ? '\n  ' + Object.entries(r.details as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')
      : '';
    return `• ${r.text}\n  [${r.reported_at ?? ''} · ${ctx.persona ?? '—'} · ${ctx.route ?? '—'} · ${where}]${det}`;
  };
  const text = `Reporter: ${reporter}\nInstall: ${installId ?? 'unknown (pre-2026-08-13 build)'}\nNew entries: ${rows.length}\nPlatform: ${rows[0]?.platform ?? '—'}\n\n${rows.map(block).join('\n\n')}\n\n— Auto-forwarded from the SmartPlay issue log`;

  // Primary: Gmail SMTP (Tim's Google account, App Password — no extra accounts).
  if (gmailUser && gmailPass) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = require('nodemailer') as typeof import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: gmailUser, pass: gmailPass },
        connectionTimeout: 6000,
        greetingTimeout: 6000,
        socketTimeout: 8000,
      });
      await transporter.sendMail({ from, to, subject, text });
      return true;
    } catch (e) {
      console.warn('[issue-report] gmail send failed', e instanceof Error ? e.message : e);
      // fall through to Resend if configured
    }
  }
  if (!resendKey) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
      signal: ctrl.signal,
    });
    return r.ok;
  } catch { return false; } finally { clearTimeout(t); }
}
