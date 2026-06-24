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

// `force` bypasses the 30s dedupe — used on explicit user tap so the chain
// heats up overlapping the user's speech window (see useVoiceCaddie openSession).
export function prewarmVoice(force = false): void {
  const now = Date.now();
  if (!force && now - lastWarmupAt < WARMUP_DEDUPE_MS) return;
  lastWarmupAt = now;

  const apiUrl = getApiBaseUrl();
  if (!apiUrl) return;

  // Wait for hydration so we read the user's actual persisted provider,
  // not the in-memory default that exists before AsyncStorage loads.
  void getProvider().then((aiProvider) => {
    const warmup = (path: string): Promise<unknown> =>
      fetch(`${apiUrl}${path}?mode=warmup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Provider': aiProvider,
        },
        body: JSON.stringify({ mode: 'warmup' }),
        // 15s: enough for a cold Lambda (2-5s) + provider SDK init + TLS (3-10s).
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {
        // Silent — warmup is opportunistic.
      });

    void Promise.all(WARMUP_PATHS.map(warmup))
      .then(() => { console.log('[voiceWarmup] all four endpoints warmed (provider:', aiProvider, ')'); })
      .catch(() => { /* Promise.all with .catch'd children won't reject — defensive */ });
  });
}
