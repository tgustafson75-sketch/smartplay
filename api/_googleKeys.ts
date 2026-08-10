import { createHash } from 'crypto';

/**
 * api/_googleKeys.ts — MULTI-PROJECT Google key resolution (2026-08-10, Tim: "there are two
 * SmartPlay Caddie projects in my Google Cloud… I'm not sure which is which because one has
 * everything enabled — all the Places, the new, the old, all of it").
 *
 * THE PROBLEM this solves. Every Google-backed route pinned itself to ONE key via a module-level
 * `const KEY = process.env.GOOGLE_API_KEY || …`. If that key belongs to the Cloud project where a
 * given API isn't enabled, the call fails — even when the OTHER project's key would have worked
 * fine. That is exactly the state we shipped in this morning: course-locate falls back to LEGACY
 * Places because Places API (New) isn't enabled on the key that happens to be in Vercel, while a
 * second project sitting right there has it turned on.
 *
 * Asking Tim to work out which key is which is the wrong fix — it's a question the code can answer
 * for itself, per request, from the response Google already sends back.
 *
 * HOW IT WORKS. Collect every configured key (in preference order, deduped by value), then run the
 * caller's request against each in turn. A key that comes back "this API isn't enabled / you're not
 * authorized" is a CAPABILITY miss, not a failure — we move to the next key. Any other outcome
 * (success, or a genuine zero-result) stops the walk. So each API independently lands on whichever
 * project has it enabled, with no configuration and no guessing.
 *
 * SECURITY: keys are never returned, logged, or serialized. Diagnostics use `fp` — the first 8 hex
 * of a SHA-1 — which is stable enough to tell two keys apart in a log and useless as a credential.
 */

export type GoogleKeyRef = {
  /** The env var this key came from — tells you WHICH slot to change in Vercel. */
  name: string;
  /** The secret. Never log, never return over the wire. */
  key: string;
  /** Non-reversible short fingerprint, safe to log and to return in diagnostics. */
  fp: string;
};

/** Env vars checked, in preference order. Later entries act as additional projects/fallbacks. */
const KEY_ENV_NAMES = [
  'GOOGLE_MAPS_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_API_KEY_2',
  'GOOGLE_MAPS_KEY_2',
  'EXPO_PUBLIC_GOOGLE_MAPS_KEY',
] as const;

export function fingerprint(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 8);
}

/** Every configured Google key, in preference order, deduped by VALUE (two env names commonly hold
 *  the same key — trying it twice would just double the latency of a miss). */
export function googleKeys(): GoogleKeyRef[] {
  const out: GoogleKeyRef[] = [];
  const seen = new Set<string>();
  for (const name of KEY_ENV_NAMES) {
    const key = (process.env[name] ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, key, fp: fingerprint(key) });
  }
  return out;
}

/**
 * Google's way of saying "this API is not enabled for the project behind this key" — the signal to
 * try the next project rather than give up. Covers both API families:
 *   - Places (New) / other googleapis.com surfaces → HTTP 403 with PERMISSION_DENIED / SERVICE_DISABLED
 *   - Legacy Maps surfaces → HTTP 200 with status REQUEST_DENIED (the error lives in the body)
 * Deliberately does NOT include OVER_QUERY_LIMIT: a quota-exhausted key is CORRECTLY configured, and
 * silently spilling that load onto the other project would hide a billing problem behind a fallback.
 */
export function isCapabilityMiss(input: { httpStatus?: number; status?: string | null; message?: string | null }): boolean {
  const status = (input.status ?? '').toUpperCase();
  if (status === 'REQUEST_DENIED' || status === 'PERMISSION_DENIED' || status === 'SERVICE_DISABLED') return true;
  if (input.httpStatus === 401 || input.httpStatus === 403) return true;
  const msg = (input.message ?? '').toLowerCase();
  return (
    msg.includes('has not been used in project') ||
    msg.includes('is not enabled') ||
    msg.includes('api not enabled') ||
    msg.includes('not authorized to use this api')
  );
}

/** What an attempt tells the walker: a usable answer, or "wrong project, try the next key". */
export type KeyAttempt<T> = { ok: true; value: T } | { ok: false; capabilityMiss: boolean };

/**
 * Run `attempt` against each configured key until one produces a usable answer.
 *
 * Returns the first success, or null when every key was exhausted. `label` names the API in the log
 * line so a miss is diagnosable ("which project is missing Places New?") without exposing secrets.
 */
export async function withGoogleKeys<T>(
  label: string,
  attempt: (key: string, ref: GoogleKeyRef) => Promise<KeyAttempt<T>>,
): Promise<T | null> {
  const keys = googleKeys();
  if (keys.length === 0) {
    console.log(`[googleKeys] ${label}: no Google key configured`);
    return null;
  }
  for (const ref of keys) {
    let res: KeyAttempt<T>;
    try {
      res = await attempt(ref.key, ref);
    } catch (e) {
      console.log(`[googleKeys] ${label}: key ${ref.name}(${ref.fp}) threw — ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (res.ok) {
      if (keys.length > 1) console.log(`[googleKeys] ${label}: served by ${ref.name}(${ref.fp})`);
      return res.value;
    }
    if (!res.capabilityMiss) return null; // a real failure on a correctly-configured key — don't mask it
    console.log(`[googleKeys] ${label}: ${ref.name}(${ref.fp}) lacks this API — trying next project`);
  }
  console.log(`[googleKeys] ${label}: no configured project has this API enabled`);
  return null;
}
