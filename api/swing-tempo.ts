/**
 * Meta-glasses video tempo analysis — server stub (2026-06-09).
 *
 * The client (services/metaGlasses/videoAudioService.ts) POSTs a glasses
 * video here for tempo analysis. The real pipeline (frame/audio extraction →
 * tempo) isn't deployed yet, so this returns HTTP 501 — which the client
 * treats as the honest "coming soon" path (not_implemented), rather than the
 * scary "Backend returned 404" the missing route produced before.
 *
 * There is a matching Expo Router placeholder at app/api/swing-tempo+api.ts
 * for local dev; production builds target the Vercel base URL, so this file +
 * its vercel.json route are what actually serve the request in the field.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  return res.status(501).json({
    message: 'Video tempo analysis is coming — the backend pipeline isn\'t deployed yet.',
  });
}
