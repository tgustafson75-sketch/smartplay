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
 * Why a Google key failed — the distinction the boolean below could not make.
 *
 * 2026-08-30. `isCapabilityMiss` folded four different failures into one `true`, and the walker
 * turned that into "no configured project has this API enabled". That sentence is FALSE for two of
 * them, and it is the sentence someone will read while debugging:
 *
 *   - not_enabled — the API genuinely is not on for that project. Try the next key. Correct.
 *   - billing     — billing is off. The key is configured perfectly; every other key will most
 *                   likely fail the same way, and walking past it hides exactly the problem this
 *                   file's own comment says must not be hidden behind a fallback.
 *   - restricted  — the key has an application restriction (IP / referer / bundle) that this caller
 *                   violates. Also a correct key, also not a missing API.
 *
 * This matters NOW: `eas.json` ships EXPO_PUBLIC_GOOGLE_MAPS_KEY with Application restrictions
 * NONE, and restricting it is on the Cowork list. The day that happens, Google starts returning
 * REQUEST_DENIED, and without this the app would report a missing API and send whoever is looking
 * to the wrong console page entirely.
 *
 * Order matters: billing and restriction messages both arrive as REQUEST_DENIED / 403, so they are
 * matched BEFORE the generic not-enabled phrases.
 */
export type GoogleFailureReason = 'not_enabled' | 'billing' | 'restricted' | 'unknown';

export function classifyGoogleFailure(input: {
  httpStatus?: number;
  status?: string | null;
  message?: string | null;
}): GoogleFailureReason {
  const status = (input.status ?? '').toUpperCase();
  const msg = (input.message ?? '').toLowerCase();

  if (status === 'BILLING_NOT_ACTIVE' || msg.includes('billing')) return 'billing';
  if (
    msg.includes('not authorized to use this api key') ||
    msg.includes('ip, site or mobile application') ||
    msg.includes('referer restrictions') ||
    msg.includes('api keys with referer restrictions')
  ) {
    return 'restricted';
  }
  if (status === 'REQUEST_DENIED' || status === 'PERMISSION_DENIED' || status === 'SERVICE_DISABLED') return 'not_enabled';
  if (
    msg.includes('has not been used in project') ||
    msg.includes('is not enabled') ||
    msg.includes('api not enabled') ||
    msg.includes('not authorized to use this api')
  ) {
    return 'not_enabled';
  }
  // A bare 401/403 with nothing to read. Treated as not_enabled below so the multi-key fallback
  // behaves exactly as it did before this change — but named 'unknown' so the log says so rather
  // than asserting something about the project.
  if (input.httpStatus === 401 || input.httpStatus === 403) return 'unknown';
  return 'unknown';
}

/**
 * Google's way of saying "this API is not enabled for the project behind this key" — the signal to
 * try the next project rather than give up.
 *
 * 2026-08-30 — now derived from classifyGoogleFailure, so BILLING and RESTRICTION failures are no
 * longer swallowed as capability misses. That was the behaviour this function's own comment already
 * forbade for OVER_QUERY_LIMIT ("a quota-exhausted key is CORRECTLY configured, and silently
 * spilling that load onto the other project would hide a billing problem behind a fallback") while
 * doing exactly that for billing itself.
 *
 * A bare 401/403 with no readable message still walks to the next key, so the existing fallback is
 * unchanged for every case that was working.
 */
export function isCapabilityMiss(input: { httpStatus?: number; status?: string | null; message?: string | null }): boolean {
  const reason = classifyGoogleFailure(input);
  return reason === 'not_enabled' || reason === 'unknown';
}

/** Build a walker failure that carries WHY, so the log can name it. */
export function keyFailure(input: {
  httpStatus?: number;
  status?: string | null;
  message?: string | null;
}): { ok: false; capabilityMiss: boolean; reason: GoogleFailureReason } {
  const reason = classifyGoogleFailure(input);
  return { ok: false, capabilityMiss: reason === 'not_enabled' || reason === 'unknown', reason };
}

/** What an attempt tells the walker: a usable answer, or "wrong project, try the next key". */
export type KeyAttempt<T> =
  | { ok: true; value: T }
  | { ok: false; capabilityMiss: boolean; reason?: GoogleFailureReason };

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
  const reasons: GoogleFailureReason[] = [];
  for (const ref of keys) {
    let res: KeyAttempt<T>;
    try {
      res = await attempt(ref.key, ref);
    } catch (e) {
      console.log(`[googleKeys] ${label}: key ${ref.name}(${ref.fp}) threw — ${e instanceof Error ? e.message : e}`);
      reasons.push('unknown');
      continue;
    }
    if (res.ok) {
      if (keys.length > 1) console.log(`[googleKeys] ${label}: served by ${ref.name}(${ref.fp})`);
      return res.value;
    }
    /**
     * Narrowed by hand rather than relying on the discriminant. The project tsconfig narrows this
     * union fine; ts-jest compiles with `strict: false`, where it does not — and this file had never
     * been type-checked by the test runner because nothing imported it until 2026-08-30. Two
     * compilers disagreeing about a union is not worth a runtime surprise on the error path.
     */
    const fail = res as { ok: false; capabilityMiss: boolean; reason?: GoogleFailureReason };
    if (!fail.capabilityMiss) {
      /**
       * 2026-08-30 — THIS RETURNED null IN SILENCE. A correctly-configured key failing for a real
       * reason produced no log line at all, which is the worst possible outcome for the one case
       * that most needs explaining. Billing off and key restricted both land here now.
       */
      console.log(
        `[googleKeys] ${label}: ${ref.name}(${ref.fp}) FAILED — ${fail.reason ?? 'unclassified'}`
        + (fail.reason === 'billing' ? ' (billing is off for this project — no other key will fix it)' : '')
        + (fail.reason === 'restricted' ? ' (this key has an application restriction this caller violates)' : ''),
      );
      return null; // a real failure on a correctly-configured key — don't mask it
    }
    reasons.push(fail.reason ?? 'not_enabled');
    console.log(`[googleKeys] ${label}: ${ref.name}(${ref.fp}) lacks this API (${fail.reason ?? 'not_enabled'}) — trying next project`);
  }
  /**
   * 2026-08-30 — REPORT WHAT ACTUALLY HAPPENED, not one assumption about all of it.
   *
   * This line used to be unconditional: whatever every key did, the walker signed off with "no
   * configured project has this API enabled". A bare 403 with nothing readable in it gets classified
   * 'unknown' and still walks to the next key — correct, and the behaviour that was already working —
   * but the summary then asserted a diagnosis nobody had checked, about a project nobody had looked
   * at. That is how a restricted key or an unpaid bill sends someone to the wrong console page.
   */
  const seen = [...new Set(reasons)];
  const onlyNotEnabled = seen.length === 1 && seen[0] === 'not_enabled';
  console.log(
    onlyNotEnabled
      ? `[googleKeys] ${label}: no configured project has this API enabled`
      : `[googleKeys] ${label}: every key failed — ${seen.join(', ')} (only 'not_enabled' means the API is actually off)`,
  );
  return null;
}
