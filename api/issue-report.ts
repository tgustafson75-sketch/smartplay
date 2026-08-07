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
 * 2026-08-06 — Owner delivery of tester issues via Resend (HTTP API, no SDK). Sends only when
 * RESEND_API_KEY is configured; otherwise a no-op (rows already stored in Supabase). Recipient/sender are
 * env-overridable. Short timeout so it can't hang the serverless invocation.
 *   RESEND_API_KEY            — Resend API key (required to enable email)
 *   ISSUE_REPORT_EMAIL_TO     — recipient (default t.gustafson75@gmail.com)
 *   ISSUE_REPORT_EMAIL_FROM   — sender (default onboarding@resend.dev for quick start; use a verified domain in prod)
 */
async function emailIssuesToOwner(rows: StoredRow[]): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  // 2026-08-07 (Tim) — default the server auto-forward to support@ (the same address the in-app mailto
  // prompts use), so ALL testers' logs land in one inbox once RESEND_API_KEY is set. Override via env.
  const to = process.env.ISSUE_REPORT_EMAIL_TO || 'support@smartplaycaddie.com';
  const from = process.env.ISSUE_REPORT_EMAIL_FROM || 'SmartPlay Issues <onboarding@resend.dev>';
  const reporter = rows[0]?.reporter || 'beta tester';
  const subject = `SmartPlay issue log — ${reporter} (${rows.length} new)`;
  const block = (r: StoredRow) => {
    const ctx = (r.context ?? {}) as { route?: string; persona?: string; isRoundActive?: boolean; currentHole?: number; courseId?: string };
    const where = ctx.isRoundActive ? `hole ${ctx.currentHole ?? '?'} @ ${ctx.courseId ?? '?'}` : 'no round';
    const det = r.details && typeof r.details === 'object' && Object.keys(r.details).length
      ? '\n  ' + Object.entries(r.details as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')
      : '';
    return `• ${r.text}\n  [${r.reported_at ?? ''} · ${ctx.persona ?? '—'} · ${ctx.route ?? '—'} · ${where}]${det}`;
  };
  const text = `Reporter: ${reporter}\nNew entries: ${rows.length}\nPlatform: ${rows[0]?.platform ?? '—'}\n\n${rows.map(block).join('\n\n')}\n\n— Auto-forwarded from the SmartPlay issue log`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
      signal: ctrl.signal,
    });
    return r.ok;
  } catch { return false; } finally { clearTimeout(t); }
}
