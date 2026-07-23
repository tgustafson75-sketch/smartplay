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
    const { error } = await db.from(TABLE).upsert(rows, { onConflict: 'id' });
    if (error) return res.status(200).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, stored: rows.length });
  } catch (e) {
    console.error('[issue-report] failed:', e instanceof Error ? e.message : e);
    return res.status(200).json({ ok: false, error: 'write_failed' });
  }
}
