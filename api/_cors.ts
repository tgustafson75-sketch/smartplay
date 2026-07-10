import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * CORS for the SmartPlay Light browser app.
 *
 * 2026-07-10 (audit S1) — was `Access-Control-Allow-Origin: *`, which let ANY website's
 * JavaScript call these paid-AI endpoints from a user's browser. Now we echo the Origin
 * ONLY when it's one of OUR web surfaces, so a random site can't drive inference on our
 * account. The NATIVE app is unaffected: it doesn't send an Origin header, so no ACAO is
 * needed and none is set (native fetch ignores CORS entirely). curl/no-Origin callers get
 * no ACAO either — the browser abuse vector is closed; the API is still same-origin/native.
 */
const ALLOWED_ORIGINS = new Set<string>([
  'https://smartplaylight.vercel.app',
  'https://smartplay-light.vercel.app',
  'https://smartplaycaddie-light.vercel.app',
  'https://smartplaycaddie.com',
  'https://www.smartplaycaddie.com',
  'http://localhost:8081',   // Expo web dev
  'http://localhost:3000',   // local web dev
]);

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const raw = req.headers.origin;
  const origin = Array.isArray(raw) ? raw[0] : raw;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AI-Provider, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    // Preflight from an allowed origin → 204; from a disallowed one → 403 (no ACAO set above).
    res.status(origin && ALLOWED_ORIGINS.has(origin) ? 204 : 403).end();
    return true;
  }
  return false;
}
