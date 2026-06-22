/**
 * DEPRECATED — superseded by api/kevin.ts (Batch 61, 2026-05-26).
 * Returns 410 immediately. Kept deployed so any stale callers surface in Vercel logs.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  return res.status(410).json({ error: 'This endpoint is deprecated. Use /api/kevin.' });
}
