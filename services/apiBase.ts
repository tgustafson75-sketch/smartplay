/**
 * Single source of truth for the backend base URL.
 *
 * WHY THIS EXISTS (root-cause of the "Invalid URL: /api/voice" spine failure):
 * EXPO_PUBLIC_* vars are inlined into the JS bundle at build time. They ARE set
 * in eas.json's `build.*.env` — but `eas update` does NOT read eas.json, and
 * there is no committed .env (it's gitignored). So every OTA update bundle
 * shipped with EXPO_PUBLIC_API_URL EMPTY. ~85 call sites independently did
 *   process.env.EXPO_PUBLIC_API_URL ?? ''                -> '' + '/api/voice'
 *      => fetch('/api/voice') => "Invalid URL" (RN needs an ABSOLUTE url)
 *   process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081'
 *      => dead on a physical phone => "Network request failed"
 * (`??` doesn't even catch '', so a blank value sails straight through.)
 * Net effect: the client had no server address, so voice, the caddie brain, and
 * swing analysis all silently failed — for days — while the server was fine.
 *
 * THE FIX / how it's supposed to be: ONE resolver that can never emit a relative
 * or dead URL. It honors EXPO_PUBLIC_API_URL ONLY when it's a real absolute
 * http(s) URL (local dev against localhost, a Vercel preview, etc.) and
 * otherwise falls back to the production deployment. Every fetch in the app
 * routes through this — there is no other place the base URL is decided.
 */

/** Backend hosts. PRIMARY is the branded custom domain (NOT *.vercel.app).
 *  2026-06-27 (root-cause of the recurring "voice breaks again"): *.vercel.app is
 *  DNS-blocked by content filters (OpenDNS/Cisco Umbrella → block-page IP
 *  146.112.61.104 → every backend fetch "Network request failed" → voice/brain/
 *  transcribe dead, intermittently by the network's resolver). The Vercel SERVER
 *  was always healthy; only the *.vercel.app NAME was filtered. A branded custom
 *  domain isn't on those blocklists (verified: api.smartplaycaddie.com resolves +
 *  serves 200 through OpenDNS itself). FALLBACK is the old *.vercel.app alias (same
 *  backend) — kept so ensureBackendReachable() can fail OVER to it if the custom
 *  domain is ever unreachable, and vice versa. */
const PRIMARY_HOST = 'https://api.smartplaycaddie.com';
const FALLBACK_HOST = 'https://smartplay-beta.vercel.app';

/** @deprecated kept for back-compat; the LIVE value is getApiBaseUrl(). */
export const PROD_API_BASE_URL = PRIMARY_HOST;

function resolveInitialBase(): string {
  const raw = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
  // Only an absolute http(s) URL is trustworthy (local dev / preview override);
  // '', 'undefined', or a bare path fall back to PRIMARY so we NEVER fetch a
  // relative/dead URL. An explicit override also disables failover (see below).
  if (/^https?:\/\/.+/i.test(raw)) return raw.replace(/\/+$/, '');
  return PRIMARY_HOST;
}

// The LIVE base. Starts at the resolved initial host; the self-healing probe may
// switch it to the fallback for the session. ALWAYS read via getApiBaseUrl() at
// fetch time so a mid-session switch reaches every call site (don't cache it).
let activeBase = resolveInitialBase();

/** Absolute backend base URL, no trailing slash, e.g. "https://api.smartplaycaddie.com".
 *  Reads the LIVE host (may have failed over). Call at fetch time; don't cache. */
export function getApiBaseUrl(): string {
  return activeBase;
}

/** @deprecated initial snapshot only — use getApiBaseUrl() for the live value. */
export const API_BASE_URL: string = activeBase;

function isExplicitOverride(): boolean {
  return /^https?:\/\/.+/i.test((process.env.EXPO_PUBLIC_API_URL ?? '').trim());
}

async function pingHost(base: string, timeoutMs = 4000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}/api/kevin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '__ping__' }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    return res.ok;
  } catch {
    return false;
  }
}

let healInFlight: Promise<string> | null = null;
let healedThisSession = false;

/**
 * SELF-HEALING HOST FAILOVER (Tim 2026-06-27 — "the app should triage + self-repair").
 * If the active backend host is unreachable but the OTHER host responds, switch to
 * it for the rest of the session. Handles a content-filter block or outage on
 * EITHER host (the recurring *.vercel.app DNS block, or a future block on the
 * custom domain). Best-effort, deduped, never throws, never blocks the UI. Logs the
 * failover to the issue log so there's a triage / self-repair trail.
 * Call once at launch (before warmup) and again with {force:true} on a voice
 * network failure so the NEXT attempt uses the healthy host.
 */
export async function ensureBackendReachable(opts?: { force?: boolean }): Promise<string> {
  if (isExplicitOverride()) return activeBase;             // dev/preview pin — never failover
  if (healedThisSession && !opts?.force) return activeBase;
  if (healInFlight) return healInFlight;                   // dedupe concurrent callers
  healInFlight = (async () => {
    try {
      if (await pingHost(activeBase)) { healedThisSession = true; return activeBase; }
      const other = activeBase === FALLBACK_HOST ? PRIMARY_HOST : FALLBACK_HOST;
      if (await pingHost(other)) {
        const from = activeBase;
        activeBase = other;
        healedThisSession = true;
        console.log(`[apiBase] host failover: ${from} unreachable → ${other}`);
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { useIssueLogStore } = require('../store/issueLogStore') as typeof import('../store/issueLogStore');
          useIssueLogStore.getState().addAppEvent('host_failover', { from, to: other }, 'app_error');
        } catch { /* issue-log best-effort */ }
      }
      // both unreachable → leave activeBase; calls fail + surface the network notice.
      return activeBase;
    } finally {
      healInFlight = null;
    }
  })();
  return healInFlight;
}
