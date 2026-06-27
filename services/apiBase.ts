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

/** Production backend — MUST be the custom domain, NOT *.vercel.app.
 *  PROVEN 2026-06-27 by an on-device browser test: Tim's network intercepts
 *  smartplay-beta.vercel.app with an invalid cert (ERR_CERT_AUTHORITY_INVALID
 *  + HSTS) → the app's TLS handshake fails → every voice call dies → robot
 *  voice. api.smartplaycaddie.com (same Vercel deployment, A 76.76.21.21)
 *  returned {"status":"ok"} from the SAME phone. Never ship the backend on a
 *  *.vercel.app host — it gets filtered/MITM'd on content-filtered networks. */
export const PROD_API_BASE_URL = 'https://api.smartplaycaddie.com';

function resolveApiBaseUrl(): string {
  const raw = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
  // Only an absolute http(s) URL is trustworthy. '', 'undefined', or a bare
  // path all fall back to production so we can NEVER fetch a relative/dead URL.
  if (/^https?:\/\/.+/i.test(raw)) return raw.replace(/\/+$/, '');
  return PROD_API_BASE_URL;
}

/**
 * Absolute backend base URL with no trailing slash, e.g.
 * "https://smartplay-beta.vercel.app". Resolved once at module load (the
 * EXPO_PUBLIC_* value is a build-time constant, so it can't change at runtime).
 */
export const API_BASE_URL: string = resolveApiBaseUrl();

/** Function form for call sites that prefer it. Always returns {@link API_BASE_URL}. */
export function getApiBaseUrl(): string {
  return API_BASE_URL;
}
