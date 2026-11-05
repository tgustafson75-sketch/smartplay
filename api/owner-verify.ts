import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { getSmartPlaySupabase } from './_supabase';
import { isRateLimited, storageKey } from './backup';

/**
 * POST /api/owner-verify  { key: <backup email>, secret: <backup passphrase> }  →  { ok, owner }
 *
 * The owner is whoever holds the backup identity that OWNER_IDENTITY_HASH was made from:
 * sha256(email::passphrase), the same key the backup row uses. The passphrase is the secret half, so
 * typing the owner's email alone proves nothing. The hash lives in the server environment only; the
 * app never sees it. Unset → owner:false, never a default. Throttled per email/IP like the backup read.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const expected = (process.env.OWNER_IDENTITY_HASH ?? '').trim();
  if (!expected) return res.status(200).json({ ok: false, error: 'not_configured', owner: false });
  const body = (req.body ?? {}) as { key?: unknown; secret?: unknown };
  const email = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (!email || !secret) return res.status(400).json({ ok: false, error: 'missing_credentials', owner: false });
  const db = getSmartPlaySupabase();
  if (db && (await isRateLimited(db, req, email))) {
    return res.status(429).json({ ok: false, error: 'rate_limited', owner: false });
  }
  const got = Buffer.from(storageKey(email, secret));
  const want = Buffer.from(expected);
  const owner = got.length === want.length && timingSafeEqual(got, want);
  return res.status(200).json({ ok: true, owner });
}
