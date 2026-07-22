/**
 * 2026-06-30 — Minimal in-app messaging (Tim ↔ Tank to start; Tim: "minimal way…
 * not the full social integration"). Identity = account email. A REAL backend on the
 * existing SmartPlay Supabase (smartplay.messages), not a stub.
 *
 *   POST { from, to, body }                 → send a message
 *   GET  ?user=<email>[&with=<email>][&since=<ISO>] → fetch the user's thread
 *
 * Degrades gracefully (200 + ok:false) when Supabase isn't configured, so the app
 * never crashes on a missing data layer.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSmartPlaySupabase } from './_supabase';
import { getMessagingServerKey, keysMatch } from '../services/appAuth';

// Reject anything that isn't a plain email — also blocks the PostgREST .or() filter
// delimiters (comma/parens) so an interpolated `user` can't tunnel the filter.
const EMAIL_RE = /^[^,()\s@]+@[^,()\s@]+\.[^,()\s@]+$/;

// 2026-07-21 (QA audit, H4) — optional participant allow-list. When MESSAGING_ALLOWED_EMAILS
// is set (comma-separated), only those addresses may appear as user/from/to, bounding the
// feature to its intended participants (Tim ↔ Tank) even if the shared app-key leaks. Unset =
// no allow-list restriction (any valid email), so this never breaks an unconfigured deploy.
const ALLOWED_EMAILS = new Set(
  (process.env.MESSAGING_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);
const emailAllowed = (e: string): boolean => ALLOWED_EMAILS.size === 0 || ALLOWED_EMAILS.has(e);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sb = getSmartPlaySupabase();
  if (!sb) return res.status(200).json({ ok: false, reason: 'messaging_unconfigured', messages: [] });

  // 2026-07-21 (QA audit, H4) — require the shared app-key so this is no longer an open,
  // unauthenticated read/forge API for anyone who knows an email. The client sends it as
  // x-app-key (services/appAuth.ts); the server accepts MESSAGING_APP_SECRET or the shared
  // default. Rejecting here closes the IDOR at the door before any DB access.
  if (!keysMatch(req.headers['x-app-key'], getMessagingServerKey())) {
    return res.status(401).json({ ok: false, reason: 'unauthorized', messages: [] });
  }

  try {
    if (req.method === 'POST') {
      const { from, to, body } = (req.body ?? {}) as { from?: string; to?: string; body?: string };
      const f = (from ?? '').trim().toLowerCase();
      const t = (to ?? '').trim().toLowerCase();
      const text = (body ?? '').trim();
      if (!EMAIL_RE.test(f) || !EMAIL_RE.test(t)) return res.status(400).json({ ok: false, reason: 'bad_email' });
      if (!emailAllowed(f) || !emailAllowed(t)) return res.status(403).json({ ok: false, reason: 'not_a_participant' });
      if (!text) return res.status(400).json({ ok: false, reason: 'empty' });
      if (text.length > 2000) return res.status(400).json({ ok: false, reason: 'too_long' });
      const { data, error } = await sb
        .from('messages')
        .insert({ from_email: f, to_email: t, body: text })
        .select()
        .single();
      if (error) { console.error('[messages] insert:', error.message); return res.status(500).json({ ok: false, reason: 'insert_failed' }); }
      return res.status(200).json({ ok: true, message: data });
    }

    if (req.method === 'GET') {
      const user = String(req.query.user ?? '').trim().toLowerCase();
      const withUser = String(req.query.with ?? '').trim().toLowerCase();
      const since = String(req.query.since ?? '').trim();
      if (!EMAIL_RE.test(user)) return res.status(400).json({ ok: false, reason: 'bad_user' });
      if (!emailAllowed(user)) return res.status(403).json({ ok: false, reason: 'not_a_participant' });
      let q = sb
        .from('messages')
        .select('*')
        .or(`to_email.eq.${user},from_email.eq.${user}`)
        .order('created_at', { ascending: true })
        .limit(500);
      if (since) q = q.gt('created_at', since);
      const { data, error } = await q;
      if (error) { console.error('[messages] select:', error.message); return res.status(500).json({ ok: false, reason: 'select_failed' }); }
      let messages = data ?? [];
      // Optional: narrow to the 2-person thread with a specific other user.
      if (withUser && EMAIL_RE.test(withUser)) {
        messages = messages.filter((m: { from_email: string; to_email: string }) =>
          m.from_email === withUser || m.to_email === withUser);
      }
      return res.status(200).json({ ok: true, messages });
    }

    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  } catch (e) {
    console.error('[messages] exception:', e instanceof Error ? e.message : e);
    return res.status(200).json({ ok: false, reason: 'error', messages: [] });
  }
}
