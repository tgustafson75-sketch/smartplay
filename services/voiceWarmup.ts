import { getApiBaseUrl } from './apiBase';
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

  // [[feels-like-a-real-caddie]] — while we're online, cache the fixed offline lines in the persona's
  // real voice so the offline path never falls to the robotic device TTS. Idempotent + self-adapting to
  // persona/voice changes; a no-op once all clips are cached. Dynamic import avoids an import cycle.
  void import('./voiceService').then((m) => m.prewarmOfflineVoiceClips()).catch(() => {});

  // Wait for hydration so we read the user's actual persisted provider,
  // not the in-memory default that exists before AsyncStorage loads.
  void getProvider().then(async (aiProvider) => {
    warmupAbort = new AbortController();
    const signal = warmupAbort.signal;
    const warmup = (path: string): Promise<unknown> =>
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
      }).catch(() => {
        // Silent — warmup is opportunistic.
      });

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
