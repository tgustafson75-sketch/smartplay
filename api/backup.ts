/**
 * 2026-07-06 / hardened 2026-07-07 — Server-mediated data backup (the OTA way, no
 * client Supabase key). The client posts its snapshot to OUR API; the SERVER writes
 * it to Supabase with the service key it already has (api/_supabase.ts). No client
 * key, no Supabase auth/dashboard login.
 *
 *   POST /api/backup   { key, secret, data }   → upsert the snapshot
 *   GET  /api/backup?key=<email>&secret=<pass>  → fetch the snapshot
 *
 * SECURITY (2026-07-07 audit fix): the identity is a user's email PLUS a passphrase.
 * The row is keyed by sha256(email::secret), so email alone is useless — you cannot
 * enumerate, read, or overwrite anyone's data without their passphrase, and a wrong
 * passphrase is indistinguishable from "no backup" (different hash → no row). The
 * passphrase is never stored server-side, only its contribution to the row key.
 * Rows live in smartplay.device_backups (service-key only; RLS denies clients).
 * Requires migration 0004_device_backups.sql.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';
import { getSmartPlaySupabase } from './_supabase';

const TABLE = 'device_backups';
const MIN_SECRET_LEN = 4;
const MAX_DATA_BYTES = 8 * 1024 * 1024; // 8 MB — a structured snapshot is far smaller

function norm(v: unknown): string {
  return String(v ?? '').trim();
}

/** The storage key is a hash of the (lower-cased) email + the passphrase. Email
 *  alone can't derive it, so there's no enumeration/overwrite without the secret. */
function storageKey(email: string, secret: string): string {
  return createHash('sha256').update(`${email.toLowerCase()}::${secret}`).digest('hex');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = getSmartPlaySupabase();
  if (!db) return res.status(200).json({ ok: false, error: 'not_configured' });

  try {
    if (req.method === 'GET') {
      const email = norm(req.query.key);
      const secret = norm(req.query.secret);
      if (!email) return res.status(400).json({ ok: false, error: 'no_key' });
      if (secret.length < MIN_SECRET_LEN) return res.status(400).json({ ok: false, error: 'no_secret' });
      const { data, error } = await db
        .from(TABLE)
        .select('data, updated_at')
        .eq('backup_key', storageKey(email, secret))
        .maybeSingle();
      if (error) return res.status(200).json({ ok: false, error: error.message });
      if (!data) return res.status(200).json({ ok: true, found: false });
      return res.status(200).json({ ok: true, found: true, data: data.data, updated_at: data.updated_at });
    }

    if (req.method === 'POST') {
      const body = (req.body ?? {}) as { key?: unknown; secret?: unknown; data?: unknown };
      const email = norm(body.key);
      const secret = norm(body.secret);
      if (!email) return res.status(400).json({ ok: false, error: 'no_key' });
      if (secret.length < MIN_SECRET_LEN) return res.status(400).json({ ok: false, error: 'no_secret' });
      if (body.data == null || typeof body.data !== 'object') {
        return res.status(400).json({ ok: false, error: 'no_data' });
      }
      // Size cap — a malicious/over-large payload can't blow up storage.
      const serialized = JSON.stringify(body.data);
      if (serialized.length > MAX_DATA_BYTES) {
        return res.status(413).json({ ok: false, error: 'too_large' });
      }
      const { error } = await db
        .from(TABLE)
        .upsert(
          { backup_key: storageKey(email, secret), data: body.data, updated_at: new Date().toISOString() },
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
