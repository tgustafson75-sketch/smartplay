/**
 * In-memory sliding-window rate limiter.
 *
 * 2026-07-21 (QA audit, H6) — the backup endpoint's only brute-force defense was a DB-backed
 * per-IP counter that fails OPEN whenever its table (migration 0005) is absent or the DB
 * hiccups, and is keyed on the spoofable X-Forwarded-For header. This adds a process-local
 * layer that (a) needs no migration, so throttling exists even when the table isn't there,
 * and (b) can be keyed on the requested EMAIL — which an attacker brute-forcing one victim's
 * passphrase cannot rotate — so it is not defeated by IP rotation / header spoofing.
 *
 * Caveat (documented, not hidden): serverless instances are ephemeral and there can be many,
 * so a single in-memory counter is not a global guarantee. It is a real added cost to an
 * attacker and a safety net when the DB layer is unavailable, used ALONGSIDE the DB limiter,
 * not as a replacement. Limits are generous so a legitimate restore is never blocked.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000; // hard cap so a flood of distinct keys can't grow memory unbounded

/**
 * Record one hit against `key` and report whether it now exceeds `limit` within `windowMs`.
 * @returns true when the caller should be throttled.
 */
export function hitInMemory(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    if (buckets.size >= MAX_KEYS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 1 > limit;
  }
  b.count += 1;
  return b.count > limit;
}

/** Drop expired buckets. Called opportunistically when the map hits its cap. */
function sweep(now: number): void {
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
  // If everything is still live (pathological), clear the oldest half to bound memory.
  if (buckets.size >= MAX_KEYS) {
    let i = 0;
    const half = Math.floor(buckets.size / 2);
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (++i >= half) break;
    }
  }
}

/** Test-only: reset all in-memory state. */
export function __resetInMemory(): void {
  buckets.clear();
}
