import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 2026-07-10 (Tim — SmartPlay Light web app) — the browser web-lite is served from a
 * DIFFERENT origin (smartplaylight.vercel.app) than the API (api.smartplaycaddie.com),
 * so the browser enforces CORS on its fetches. The native app is unaffected (no CORS on
 * same-process fetch). We use no cookies/credentials, so a wildcard origin is safe and
 * simplest. Call this as the FIRST line of a handler; it returns true for an OPTIONS
 * preflight (handler should `return` immediately).
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AI-Provider, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
