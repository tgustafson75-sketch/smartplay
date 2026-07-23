import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hitInMemory } from './_rateLimit';

/**
 * 2026-07-23 (QA — inference cost control, zero-regression path) — a generous per-IP throttle for
 * PAID-inference endpoints (vision scans, swing/CV analysis, image gen). These shipped fully
 * unauthenticated, so a curl loop could bill them indefinitely.
 *
 * Why rate-limit instead of a hard app-key gate here: the app key is public (it ships in the bundle),
 * so it only stops drive-by abuse anyway — and flipping a hard 401 gate needs the client to send the
 * header FIRST, which means a propagation window where old bundles get 401'd (a regression). A per-IP
 * throttle needs NO client change and never 401s a legitimate user: the limits are far above any
 * human-initiated pace (a golfer scans a few clubs / analyzes a few swings a minute), but a hammering
 * loop trips them fast. Use it ALONGSIDE the app-key gate on the priciest routes (image-edit), not
 * as a replacement.
 *
 * Honest caveat (same as _rateLimit.ts): serverless instances are ephemeral and there can be many, so
 * a process-local counter is not a global guarantee — it's a real added cost to an abuser, not a wall.
 * A global guarantee needs a shared store (Redis/DB); that's a larger architectural change.
 */

/** Best-effort client key — the phone's IP as seen through Vercel's proxy headers. */
function clientKey(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : (xff ?? '').split(',')[0];
  const ip = (first || (req.headers['x-real-ip'] as string) || req.socket?.remoteAddress || 'unknown').trim();
  return ip || 'unknown';
}

/**
 * Throttle a paid-inference route per client IP. Returns true when the request may proceed; when it
 * must be throttled it has already written a 429 and the caller must `return` immediately. Usage:
 *   if (!allowInference(req, res, 'bag-scan')) return;
 *
 * @param name    route label — buckets are namespaced per route so limits don't bleed across routes.
 * @param limit   max requests per window per IP (default 60 — generous for human-initiated capture).
 * @param windowMs sliding window (default 60s).
 */
export function allowInference(
  req: VercelRequest,
  res: VercelResponse,
  name: string,
  limit = 60,
  windowMs = 60_000,
): boolean {
  const throttled = hitInMemory(`infer:${name}:${clientKey(req)}`, limit, windowMs);
  if (throttled) {
    res.status(429).json({ error: 'rate_limited', retry_after_ms: windowMs });
    return false;
  }
  return true;
}
