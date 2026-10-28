import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hitInMemory } from './_rateLimit';
import { checkCaller, ENFORCE_CALLER_IDENTITY } from './_callerIdentity';

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
 * Throttle a paid-inference route per client IP, and identify the caller. Resolves true when the
 * request may proceed; when it must not, it has already written the response (429, or 402 once caller
 * identity is enforced) and the caller must `return` immediately. Usage:
 *   if (!(await allowInference(req, res, 'bag-scan'))) return;
 *
 * Caller identity (api/_callerIdentity, 2026-10-27): LOG ONLY while ENFORCE_CALLER_IDENTITY is false —
 * the check is started and NOT awaited, so it adds no latency and never refuses a request.
 *
 * @param name    route label — buckets are namespaced per route so limits don't bleed across routes.
 * @param limit   max requests per window per IP (default 60 — generous for human-initiated capture).
 * @param windowMs sliding window (default 60s).
 */
export async function allowInference(
  req: VercelRequest,
  res: VercelResponse,
  name: string,
  limit = 60,
  windowMs = 60_000,
): Promise<boolean> {
  const throttled = hitInMemory(`infer:${name}:${clientKey(req)}`, limit, windowMs);
  if (throttled) {
    res.status(429).json({ error: 'rate_limited', retry_after_ms: windowMs });
    return false;
  }
  if (!ENFORCE_CALLER_IDENTITY) {
    void checkCaller(req, name).catch(() => {});   // log only: never awaited, never refuses
    return true;
  }
  const verdict = await checkCaller(req, name);
  if (verdict !== 'pro') {
    res.status(402).json({ error: 'entitlement_required', caller_identity: verdict });
    return false;
  }
  return true;
}
