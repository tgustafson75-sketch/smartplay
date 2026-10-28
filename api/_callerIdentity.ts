/**
 * 2026-10-27 (security audit Section 4) — WHO IS CALLING A PAID ROUTE.
 *
 * The app sends `x-rc-app-user-id` (its RevenueCat appUserID, services/callerIdentity.ts) on every
 * request to our API. This verifies that id holds the `smartplay_caddie_pro` entitlement via the
 * RevenueCat REST API (REVENUECAT_SECRET_KEY), caching each answer for 5 minutes per instance.
 *
 * PHASE 1 — LOG ONLY. Every verdict is logged (Vercel log line + a Sentry event carrying a breadcrumb
 * and tags), and the request is served regardless. `api/_inferLimit.allowInference` calls `checkCaller`
 * WITHOUT awaiting it while ENFORCE_CALLER_IDENTITY is false, so log-only adds no latency.
 *
 * TO ENFORCE: set ENFORCE_CALLER_IDENTITY below to true. allowInference then awaits the verdict and
 * answers 402 to anything that is not 'pro'.
 */
import type { VercelRequest } from '@vercel/node';
import { SENTRY_DSN } from '../services/sentryDsn';

export const ENFORCE_CALLER_IDENTITY = false;

export const PRO_ENTITLEMENT = 'smartplay_caddie_pro';
const CACHE_MS = 5 * 60_000;
const RC_TIMEOUT_MS = 2_500;

export type CallerVerdict =
  | 'pro'              // RevenueCat says the entitlement is active
  | 'no_entitlement'   // a real subscriber without it (every free player today)
  | 'missing_id'       // no header — an old build, a web-lite call, or a script
  | 'invalid_id'       // the header is not a plausible RevenueCat id
  | 'unverified';      // we could not ask (no secret key, RevenueCat down/timeout)

const cache = new Map<string, { verdict: CallerVerdict; at: number }>();

/** Plausible RevenueCat app user id: 1-100 chars, no whitespace or control chars, no slashes. */
function plausibleId(id: string): boolean {
  return id.length > 0 && id.length <= 100 && !/[\s/\\\u0000-\u001f]/.test(id);
}

export function readCallerId(req: VercelRequest): string | null {
  const raw = req.headers['x-rc-app-user-id'];
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return v ? v : null;
}

async function askRevenueCat(appUserId: string): Promise<CallerVerdict> {
  const key = process.env.REVENUECAT_SECRET_KEY;
  if (!key) return 'unverified';
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(RC_TIMEOUT_MS),
    });
    if (!res.ok) return res.status === 404 ? 'no_entitlement' : 'unverified';
    const body = (await res.json()) as { subscriber?: { entitlements?: Record<string, { expires_date?: string | null }> } };
    const ent = body.subscriber?.entitlements?.[PRO_ENTITLEMENT];
    if (!ent) return 'no_entitlement';
    const exp = ent.expires_date ? Date.parse(ent.expires_date) : null;
    return exp == null || exp > Date.now() ? 'pro' : 'no_entitlement';
  } catch {
    return 'unverified';
  }
}

/** The verdict for this request (cached 5 min per id). Never throws. */
export async function verifyCaller(req: VercelRequest): Promise<CallerVerdict> {
  const id = readCallerId(req);
  if (!id) return 'missing_id';
  if (!plausibleId(id)) return 'invalid_id';
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.verdict;
  const verdict = await askRevenueCat(id);
  // An 'unverified' answer is not cached, so the next call retries once RevenueCat is reachable.
  if (verdict !== 'unverified') cache.set(id, { verdict, at: Date.now() });
  return verdict;
}

/** One Sentry event per (route, verdict, id) per cache window per instance, so free traffic cannot flood it. */
const reported = new Map<string, number>();

function reportToSentry(route: string, verdict: CallerVerdict, idPresent: boolean): void {
  const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(SENTRY_DSN);
  if (!m) return;
  const [, publicKey, host, projectId] = m;
  const event = {
    event_id: Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: verdict === 'pro' ? 'info' : 'warning',
    logger: 'caller-identity',
    environment: process.env.VERCEL_ENV ?? 'unknown',
    message: `caller_identity ${verdict} on /api/${route}`,
    tags: { caller_identity: verdict, caller_route: route, caller_id_present: String(idPresent), enforce: String(ENFORCE_CALLER_IDENTITY) },
    breadcrumbs: [{ category: 'caller_identity', level: 'info', message: `${route}: ${verdict}`, timestamp: Date.now() / 1000 }],
  };
  void fetch(`https://${host}/api/${projectId}/store/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=smartplay-api/1.0, sentry_key=${publicKey}`,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(2_000),
  }).catch(() => { /* logging must never fail a request */ });
}

/** Verify and LOG the caller. Returns the verdict; the caller decides whether it matters. */
export async function checkCaller(req: VercelRequest, route: string): Promise<CallerVerdict> {
  const verdict = await verifyCaller(req);
  const id = readCallerId(req);
  console.log(`[caller-identity] ${route} verdict=${verdict} id=${id ? 'present' : 'absent'} enforce=${ENFORCE_CALLER_IDENTITY}`);
  const key = `${route}|${verdict}|${id ?? '-'}`;
  const last = reported.get(key);
  if (last == null || Date.now() - last > CACHE_MS) {
    reported.set(key, Date.now());
    reportToSentry(route, verdict, id != null);
  }
  return verdict;
}

export function __resetCallerIdentityForTest(): void {
  cache.clear();
  reported.clear();
}
