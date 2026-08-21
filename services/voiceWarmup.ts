import { getApiBaseUrl, markEndpointWarmed, isEndpointWarmed } from './apiBase';
import { useSettingsStore } from '../store/settingsStore';
/**
 * 2026-06-04 — Pre-warm the FOUR voice-pipeline Vercel functions in
 * parallel after splash completes.
 *
 * 2026-06-21 — Fixed: warmup now sends X-AI-Provider header so it warms
 * the provider the user actually has selected (OpenAI or Gemini). Without
 * this, providerFromHeader() defaulted to Gemini, so switching to OpenAI
 * in Owner Tools left the OpenAI SDK cold → first tap paid full cold-start.
 *
 * 2026-06-21 — Fixed: warmup now waits for settingsStore hydration before
 * reading aiProvider. At app launch, the persist middleware hasn't yet loaded
 * AsyncStorage, so getState().aiProvider was undefined → defaulted to 'gemini'
 * even when the user had selected OpenAI. Now we block until hasHydrated is
 * true before making warmup requests.
 */

const WARMUP_DEDUPE_MS = 30_000;
let lastWarmupAt = 0;

const WARMUP_PATHS = [
  '/api/voice',
  '/api/transcribe',
  '/api/voice-intent',
  '/api/kevin',
  // 2026-06-24 — pipecat-turn is the DEFAULT brain since the v15 migration; it was
  // missing here, so the default conversational path hit a cold Lambda every first
  // turn (the "takes longer to think" lag). Warm it too.
  '/api/pipecat-turn',
] as const;

/**
 * Wait until settingsStore has finished loading from AsyncStorage, then
 * return the persisted aiProvider. If hydration completes within the
 * function (store.hasHydrated already true), resolves immediately.
 * Otherwise subscribes to state changes and resolves on the first update
 * where hasHydrated is true.
 */
async function getProvider(): Promise<'gemini' | 'openai'> {
  const store = useSettingsStore.getState();
  if (store.hasHydrated) {
    return store.aiProvider ?? 'gemini';
  }
  // Not yet hydrated — wait for the next state update that sets hasHydrated.
  return new Promise((resolve) => {
    const unsub = useSettingsStore.subscribe((state) => {
      if (state.hasHydrated) {
        unsub();
        resolve(state.aiProvider ?? 'gemini');
      }
    });
    // Safety: if hydration completes between the getState() check above and
    // the subscribe() call, check again so we don't hang.
    const current = useSettingsStore.getState();
    if (current.hasHydrated) {
      unsub();
      resolve(current.aiProvider ?? 'gemini');
    }
  });
}

/**
 * 2026-08-12 (Tim's field log — and he was right that "weak signal" was a lazy theory).
 *
 * THREE transcribe failures, minutes apart, on house WiFi with a demonstrably healthy server:
 *
 *   ping 5014ms / 5016ms / 5014ms   against our 5000ms budget
 *   get  6017ms / 6017ms / 6016ms   against our 6000ms budget
 *
 * Two milliseconds of variance across three attempts, each landing 14-17ms past OUR OWN timeout.
 * A network does not fail with that precision. That is a client-side timer counting down on a
 * request that never reached the network — and the reason it never reached it is us.
 *
 * React Native on Android uses OkHttp, whose Dispatcher caps concurrent requests per host at FIVE.
 * WARMUP_PATHS is exactly five POSTs to one host, each with a 15-SECOND budget. They saturate the
 * per-host limit on their own, and anything the user then does — the transcribe upload, the two
 * reachability probes — sits in the dispatcher queue while our AbortSignal counts wall-clock.
 *
 * Worse, `force` was firing ANOTHER five at the exact moment the user tapped the mic, to "heat the
 * chain overlapping the speech window". So the optimisation added to make the first turn fast was
 * starving the first turn. That is why it is always the FIRST turn, always ~11s, and why the second
 * attempt works: by then the warmups have drained.
 *
 * Fixed three ways: never saturate the pool (concurrency capped below OkHttp's limit), never
 * outlive usefulness (8s, not 15 — a warmup slower than that has warmed nothing in time), and
 * YIELD — a real user turn aborts warmups in flight to hand their connection slots straight back.
 */
const WARMUP_CONCURRENCY = 2;
/** Offline-clip rendering is housekeeping for a future outage. It must never compete with the
 *  player's first tap, so it waits until well past the cold-start window. */
const OFFLINE_CLIP_WARM_DELAY_MS = 45_000;
const WARMUP_TIMEOUT_MS = 8_000;
let warmupAbort: AbortController | null = null;

/**
 * A real turn is starting — release any warmup connections immediately.
 *
 * Called at every point the user actually asks for something. Warmups are opportunistic by
 * definition; the moment there is real work, they are pure competition for the same five slots.
 */
/**
 * A signal that aborts when EITHER the batch is cancelled or the per-request budget expires.
 *
 * Hand-rolled because AbortSignal.any() is absent in Hermes. Plain AbortController plus a listener
 * and a timer — all of which this engine has had for years.
 */
function linkedTimeoutSignal(outer: AbortSignal, ms: number): AbortSignal {
  const ctl = new AbortController();
  const timer = setTimeout(() => { try { ctl.abort(); } catch { /* already aborted */ } }, ms);
  const onOuter = () => { clearTimeout(timer); try { ctl.abort(); } catch { /* already aborted */ } };
  if (outer.aborted) onOuter();
  else outer.addEventListener('abort', onOuter, { once: true });
  // Stop the timer once the request settles either way, so a finished fetch leaves nothing pending.
  ctl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return ctl.signal;
}

export function abortVoiceWarmup(): void {
  if (!warmupAbort) return;
  try { warmupAbort.abort(); } catch { /* already settled */ }
  warmupAbort = null;
  console.log('[voiceWarmup] aborted in-flight warmups — a real turn needs the connections');
}

// `force` bypasses the 30s dedupe. NOTE: it must NOT be used at mic-tap time any more — see above.
export function prewarmVoice(force = false): void {
  const now = Date.now();
  if (!force && now - lastWarmupAt < WARMUP_DEDUPE_MS) return;
  lastWarmupAt = now;

  const apiUrl = getApiBaseUrl();
  if (!apiUrl) return;

  /**
   * 2026-08-21 — THIS NO LONGER RUNS AT BOOT, AND THAT IS THE POINT.
   *
   * Tim, on 5G with full bars: "every fucking time I'm on four bars at 4G at the worst… I think
   * you're stuck in error loop scaffolding at the front." He is right, and his log proves it: a
   * STATIC CDN file timed out at 3s. That cannot happen on 5G because of the network. It happens
   * because we cannot get a usable socket.
   *
   * Count what we aimed at one host before he ever tapped: five warmup endpoints (plus the retries
   * I added on 08-20), up to seven connection pings, AND this — a SERIAL loop that renders every
   * uncached fixed line as TTS through /api/voice, seconds per clip. I added four new lines to that
   * list on 08-20, so they were all uncached and all rendering at boot. Against OkHttp's five
   * connections per host, the player's transcribe queues behind our own housekeeping.
   *
   * These clips exist for going OFFLINE. There is no reason to build them in the first thirty
   * seconds of a launch — the one window where the player is most likely to tap the mic. Deferred
   * well past the cold-start window, and skipped entirely if a real turn is in progress.
   */
  setTimeout(() => {
    void import('./voiceService').then((m) => m.prewarmOfflineVoiceClips()).catch(() => {});
  }, OFFLINE_CLIP_WARM_DELAY_MS);

  // Wait for hydration so we read the user's actual persisted provider,
  // not the in-memory default that exists before AsyncStorage loads.
  void getProvider().then(async (aiProvider) => {
    warmupAbort = new AbortController();
    const signal = warmupAbort.signal;
    /**
     * 2026-08-20 — CRITICAL ENDPOINTS GET RETRIES; THE REST STAY OPPORTUNISTIC.
     *
     * warmBackendConnection retries its ping six times over ~20s because a cold launch is exactly
     * when a first request fails. This function — the ONLY thing that wakes /api/transcribe — took
     * one shot and swallowed the failure. So the boot path was robust for the endpoint that did not
     * need it (kevin) and fragile for the one the first voice turn depends on.
     *
     * A failed warmup here is invisible and costs the USER the retry instead: they tap the mic and
     * pay the cold start themselves, which is the "fails the first time" symptom.
     */
    /**
     * 2026-08-21 — RETRIES REMOVED. I added them on 08-20 to make warmup more reliable, and they
     * made the thing they were protecting worse: three attempts each on two endpoints is four extra
     * connections against a five-per-host ceiling, during the exact window the player taps.
     *
     * A warmup that has to fight the user for a socket is not a warmup. One attempt each; if it
     * misses, the real request pays its own way — and that path is now three escalating attempts on
     * fresh connections, which is the honest place for retry logic to live.
     */
    const attemptDelays = (_path: string) => [0];

    const warmup = async (path: string): Promise<void> => {
      for (const delay of attemptDelays(path)) {
        if (signal.aborted) return;
        if (delay) await new Promise(r => setTimeout(r, delay));
        // Already proven awake (another caller, or an earlier attempt) — nothing to do.
        if (isEndpointWarmed(path)) return;
        const ok = await warmupOnce(path);
        if (ok) {
          // Record WHICH function answered. This is what lets the voice path give a genuinely cold
          // transcribe its full cold budget instead of inferring warmth from a different Lambda.
          markEndpointWarmed(path);
          return;
        }
      }
    };

    const warmupOnce = (path: string): Promise<boolean> =>
      fetch(`${apiUrl}${path}?mode=warmup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Provider': aiProvider,
        },
        body: JSON.stringify({ mode: 'warmup' }),
        // 8s, not 15: a warmup that takes longer than the user's patience has warmed nothing in
        // time, and it holds one of only five per-host connection slots the whole while.
        // 2026-08-12 — NOT AbortSignal.any(): that is a recent API and Hermes does not have it, so
        // calling it threw "undefined is not a function" at BOOT (prewarmVoice runs from _layout).
        // AbortSignal.timeout IS present — it's used in 78 other places here — but `.any` was used
        // exactly once, by me, today. The lesson: an API used nowhere else in this codebase is
        // unproven on this engine, however standard it looks.
        signal: linkedTimeoutSignal(signal, WARMUP_TIMEOUT_MS),
      }).then(r => r.ok).catch(() => false);

    // Drain the list at limited concurrency so we can never occupy the whole per-host pool. A
    // Promise.all over all five is what let warmup starve the user's own request.
    const queue = [...WARMUP_PATHS];
    const workers = Array.from({ length: Math.min(WARMUP_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next || signal.aborted) return;
        await warmup(next);
      }
    });
    await Promise.all(workers);
    if (!signal.aborted) console.log('[voiceWarmup] endpoints warmed (provider:', aiProvider, ')');
  });
}
