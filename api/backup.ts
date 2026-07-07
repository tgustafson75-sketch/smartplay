/**
 * 2026-07-06 — Server-mediated data backup (the OTA way, no client Supabase key).
 *
 * The Expo client can't hold a Supabase key (EXPO_PUBLIC_* are empty in OTA bundles),
 * and enabling Supabase email-auth is a dashboard step. This endpoint sidesteps both:
 * the CLIENT posts its data snapshot to OUR API, and the SERVER writes it to Supabase
 * using the service key it already has (api/_supabase.ts, from the Vercel↔Supabase
 * integration Tim connected). No client key, no client auth, no dashboard login.
 *
 *   POST /api/backup   { key, data }         → upsert the snapshot for `key`
 *   GET  /api/backup?key=<key>               → fetch the snapshot for `key`
 *
 * `key` is a user-owned identifier (their email, lower-cased) — the same value on a
 * new phone restores their data. Rows live in smartplay.device_backups (service-key
 * only; RLS default-denies any client). Requires migration 0004_device_backups.sql.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSmartPlaySupabase } from './_supabase';

const TABLE = 'device_backups';

function normKey(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = getSmartPlaySupabase();
  if (!db) return res.status(200).json({ ok: false, error: 'not_configured' });

  try {
    if (req.method === 'GET') {
      const key = normKey(req.query.key);
      if (!key) return res.status(400).json({ ok: false, error: 'no_key' });
      const { data, error } = await db
        .from(TABLE)
        .select('data, updated_at')
        .eq('backup_key', key)
        .maybeSingle();
      if (error) return res.status(200).json({ ok: false, error: error.message });
      if (!data) return res.status(200).json({ ok: true, found: false });
      return res.status(200).json({ ok: true, found: true, data: data.data, updated_at: data.updated_at });
    }

    if (req.method === 'POST') {
      const body = (req.body ?? {}) as { key?: unknown; data?: unknown };
      const key = normKey(body.key);
      if (!key) return res.status(400).json({ ok: false, error: 'no_key' });
      if (body.data == null || typeof body.data !== 'object') {
        return res.status(400).json({ ok: false, error: 'no_data' });
      }
      const { error } = await db
        .from(TABLE)
        .upsert(
          { backup_key: key, data: body.data, updated_at: new Date().toISOString() },
          { onConflict: 'backup_key' },
        );
      if (error) return res.status(200).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e instanceof Error ? e.message : 'unknown' });
  }
}
