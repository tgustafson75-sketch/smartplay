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

/** THE backend host — the branded custom domain, never *.vercel.app.
 *  2026-06-27 (root-cause of the recurring "voice breaks again"): *.vercel.app is
 *  DNS-blocked by content filters (OpenDNS/Cisco Umbrella → block-page IP
 *  146.112.61.104 → every backend fetch "Network request failed" → voice/brain/
 *  transcribe dead, intermittently by the network's resolver). The Vercel SERVER
 *  was always healthy; only the *.vercel.app NAME was filtered. A branded custom
 *  domain isn't on those blocklists (verified: api.smartplaycaddie.com resolves +
 *  serves 200 through OpenDNS itself).
 *  2026-07-08: the *.vercel.app FALLBACK was REMOVED — failing over to the
 *  blocklisted name was the cause of the on-course voice death (see
 *  ensureBackendReachable). This is now the single host. */
const PRIMARY_HOST = 'https://api.smartplaycaddie.com';

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

/**
 * 2026-07-23 — the shared PUBLIC app key, single client-side source of truth (was copy-pasted as a
 * bare literal in golferAvatar / courseCloud / issueLogExport / custom-caddie). Mirrors the server
 * gate in api/_appKey.ts — keep the two in lockstep. Public by nature (ships in the bundle); it stops
 * drive-by abuse of paid inference endpoints, not a determined attacker.
 */
export const APP_KEY = 'spc_share_k1_2f8d61b4c07a49e3a1d5e9f60b3c7a29';

/** Header carrying the app-key gate for a request to a gated endpoint. Spread into fetch headers:
 *  `headers: { 'Content-Type': 'application/json', ...appKeyHeaders() }`. */
export function appKeyHeaders(): Record<string, string> {
  return { 'x-app-key': APP_KEY };
}

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
 * 2026-07-08 (Tim — Green Hill round: voice died on the course) — the old
 * self-healing failover was ACTIVELY HARMFUL and is now DISABLED. Root cause from
 * the field logs: on a weak course signal the 4s probe to the custom domain flaked,
 * a same-instant probe to the *.vercel.app alias happened to succeed, so the app
 * switched the whole session to *.vercel.app — the exact name Tim's network content-
 * filter INTERMITTENTLY blocks — and pinned there (healedThisSession=true). Real
 * requests then hit the block → 15s transcribe AbortErrors → on-device STT fallback,
 * which mangled "seven iron from 170" into "Kevin iron from January" → the classifier
 * failed → the caddie asked dumb clarifying questions. Failing OVER to the blocklisted
 * domain is never an upgrade; the custom domain is specifically the name that is NOT
 * filtered. So: ONE host (the custom domain). No cross-host failover to *.vercel.app.
 * A transient weak-signal blip on the custom domain is retried on the custom domain,
 * not swapped for a blocked alias. If we ever need a real second host it must be
 * another clean custom domain, never *.vercel.app. See [[voice-recurring-outage-root-cause-vercel-dns-filter]].
 * Kept as a best-effort probe (warms DNS/TLS, records reachability) that NEVER
 * switches hosts, so the many existing callers keep working unchanged.
 */
export async function ensureBackendReachable(opts?: { force?: boolean }): Promise<string> {
  if (isExplicitOverride()) return activeBase;             // dev/preview pin
  if (healedThisSession && !opts?.force) return activeBase;
  if (healInFlight) return healInFlight;                   // dedupe concurrent callers
  healInFlight = (async () => {
    try {
      // Best-effort probe only — warms the connection, but NEVER switches away from the
      // custom domain to the blocklisted *.vercel.app alias. activeBase is left as-is.
      if (await pingHost(activeBase)) healedThisSession = true;
      return activeBase;
    } finally {
      healInFlight = null;
    }
  })();
  return healInFlight;
}

let connectionWarmed = false;
let warmInFlight: Promise<void> | null = null;

/**
 * 2026-07-14 (Tim — "the first attempt to talk to the caddie errors every time") — the boot
 * voice warmup AND the single ensureBackendReachable ping both fire at ~86ms after launch, when
 * the OS network stack is coldest. On a slow/cold network that FIRST ping can fail (DNS + TLS to
 * the custom domain not yet established); the one-shot probe then never retries, so nothing warms
 * the connection before the user taps the mic. Their first real transcribe then pays the full
 * cold DNS/TLS cost and hits the 12s timeout → the recurring "first attempt failed" symptom.
 *
 * This retries the warm ping with backoff until the host actually answers (bounded ~20s budget),
 * so a real connection is pooled + DNS is cached BEFORE the first user turn — the retries the
 * user's first tap used to eat happen silently in the background instead. It also records
 * reachability (healedThisSession) for ensureBackendReachable's other callers.
 *
 * WARMING ONLY: it pings /api/kevin '__ping__' (server short-circuits it — cheap), NEVER switches
 * hosts (single custom domain, per ensureBackendReachable's root-cause note), and touches nothing
 * in the voice capture / STT / TTS pipeline. Idempotent + deduped; stops the instant it connects.
 */
/**
 * 2026-07-18 (Tim — "first couple of responses error, then it's good") — is the backend
 * connection confirmed warm this session? The first cold-boot turn races the warmup above; the
 * voice path reads this to decide whether to be PATIENT (cold: wait longer for a good cloud
 * transcript) or FAIL FAST to the offline caddie (warmed: a genuine mid-round dead zone).
 */
export function isConnectionWarmed(): boolean {
  return connectionWarmed;
}

/**
 * 2026-08-12 (Tim, testing on 5G) — "Shouldn't the very first thing be checking signal and adjusting
 * accordingly? If verified signal, guard error states."
 *
 * Right. The app cannot read the radio — NetInfo/expo-network are native modules and adding one
 * breaks OTA on every install in the field — but it does not need to. What matters isn't the number
 * of bars, it's whether OUR host answers, and every cloud round-trip already measures exactly that.
 * We just threw the measurement away, keeping a single boolean.
 *
 * So we keep the evidence: when the backend last answered, and how fast. That turns "are we online?"
 * from a guess into a recent observation, and it lets the failure copy stop blaming the user's
 * network when we have proof the network was fine seconds ago — which is the whole of his complaint:
 * five bars of 5G and the caddie saying it can't connect.
 */
let lastRoundTripOkAt = 0;
let lastRoundTripMs = -1;

/** Record a cloud round-trip that succeeded, and how long it took. */
export function noteRoundTripOk(ms?: number): void {
  lastRoundTripOkAt = Date.now();
  if (typeof ms === 'number' && ms >= 0) lastRoundTripMs = ms;
}

export type ConnectionEvidence = {
  /** ms since the backend last answered us, or null if it never has this session. */
  agoMs: number | null;
  /** Latency of that last successful round-trip, or -1 if unmeasured. */
  lastMs: number;
  /** The host answered recently enough that blaming the user's connection would be a lie. */
  provenRecently: boolean;
  /** Answered, but slowly — be patient with budgets rather than declaring failure. */
  slow: boolean;
};

/** How recent a success still counts as proof. A minute covers a normal turn plus think time. */
const PROOF_WINDOW_MS = 60_000;
/** Above this, the host is reachable but the link is weak — widen budgets, don't fail. */
const SLOW_MS = 2_500;

export function getConnectionEvidence(): ConnectionEvidence {
  const agoMs = lastRoundTripOkAt ? Date.now() - lastRoundTripOkAt : null;
  return {
    agoMs,
    lastMs: lastRoundTripMs,
    provenRecently: agoMs !== null && agoMs < PROOF_WINDOW_MS,
    slow: lastRoundTripMs > SLOW_MS,
  };
}

/**
 * 2026-08-20 (Tim: "I still test and get a failure at first most times… why are we leaving things
 * there") — WARMTH IS PER-LAMBDA, AND WE HAD ONE BOOLEAN FOR ALL OF THEM.
 *
 * warmBackendConnection pings `/api/kevin`. A voice turn calls `/api/transcribe`. On Vercel those
 * are SEPARATE functions with SEPARATE cold starts, so kevin answering says nothing about whether
 * transcribe is awake. But the voice path asked `isConnectionWarmed()` to choose its budget:
 *
 *     const coldFirstTurn = !isConnectionWarmed();
 *     doTranscribeFetch(coldFirstTurn ? 22s : 12s)
 *
 * So the boot ping warmed kevin, flipped the single flag, and the first real transcribe — against a
 * function that had never been touched — was handed the 12s WARM budget instead of 22s. A cold
 * Lambda plus an audio upload does not reliably finish in 12s, so it failed, and by the retry the
 * function was awake: "fails the first time, works on the third ask."
 *
 * The perverse part, and why this survived so many passes: the MORE successfully we warmed the
 * backend, the LESS patience the first voice turn got. Every previous fix made the boot ping more
 * reliable, which made this worse.
 *
 * So warmth is now tracked per endpoint. Marking one warm still implies the NETWORK is warm — a
 * round trip completed — but it no longer claims anything about the other functions.
 */
const warmedEndpoints = new Set<string>();

/** Record that a specific serverless function answered — it is awake, not just reachable. */
export function markEndpointWarmed(path: string): void {
  warmedEndpoints.add(path);
  markConnectionWarmed();
}

/** Has THIS function answered this session? Budgets for a given call must ask about THAT call. */
export function isEndpointWarmed(path: string): boolean {
  return warmedEndpoints.has(path);
}

/** Flip the warmed flag after any successful cloud round-trip (transcribe/brain), so subsequent
 *  turns take the fast path even if the background warm ping hadn't landed yet. */
export function markConnectionWarmed(): void {
  connectionWarmed = true;
  healedThisSession = true;
  noteRoundTripOk();
}

/**
 * 2026-08-20 — PRIME THE TRANSPORT BEFORE WAKING THE FUNCTION.
 *
 * A first request to a cold host pays two separate costs that everyone here has been treating as
 * one: establishing the TRANSPORT (DNS lookup, TCP, TLS handshake) and waking the FUNCTION (Lambda
 * cold start). Every warm attempt so far paid them together by pinging /api/kevin — so when the
 * combined cost blew the budget, we learned nothing about which half was slow and warmed neither.
 *
 * A static CDN file needs the identical DNS + TLS to the identical host, and has NO cold start. So
 * fetching it first buys the whole transport for ~250ms and leaves a pooled, TLS-negotiated socket
 * behind. The Lambda ping that follows reuses that socket and is then only paying for the function.
 *
 * Cheap, and it cannot make anything worse: if the CDN is unreachable the ping was never going to
 * succeed either, and we fall through to it unchanged.
 */
async function primeTransport(timeoutMs = 2500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${activeBase}/.well-known/assetlinks.json`, { method: 'GET', signal: ctrl.signal })
      .finally(() => clearTimeout(t));
    return res.ok;
  } catch { return false; }
}

export function warmBackendConnection(): Promise<void> {
  if (isExplicitOverride() || connectionWarmed) return Promise.resolve();
  if (warmInFlight) return warmInFlight;
  warmInFlight = (async () => {
    // Transport first — see primeTransport. Costs ~250ms and makes every ping below cheaper.
    await primeTransport();
    // Backoff schedule (ms before each attempt) — ~20s total, covering the gap between
    // cold launch and the user reaching the Caddie tab + tapping the mic.
    const delays = [0, 1500, 3000, 4000, 5500, 6000];
    for (const d of delays) {
      if (connectionWarmed) return;
      if (d) await new Promise((r) => setTimeout(r, d));
      try {
        // Time it: the boot warm-up is our FIRST look at the link, so this is where "adjust
        // accordingly" starts. A host that answers in 200ms and one that takes 4s are both
        // "reachable", and the voice path should not treat them the same.
        const t0 = Date.now();
        if (await pingHost(activeBase, 5000)) {
          connectionWarmed = true;
          healedThisSession = true;
          // This ping proves /api/kevin is awake — and ONLY that. Recording which function answered
          // is what stops the voice path inferring that transcribe is warm too.
          warmedEndpoints.add('/api/kevin');
          noteRoundTripOk(Date.now() - t0);
          return;
        }
      } catch { /* keep retrying */ }
    }
  })().finally(() => { warmInFlight = null; });
  return warmInFlight;
}
