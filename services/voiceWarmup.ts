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
 */

const WARMUP_DEDUPE_MS = 30_000;
let lastWarmupAt = 0;

const WARMUP_PATHS = [
  '/api/voice',
  '/api/transcribe',
  '/api/voice-intent',
  '/api/kevin',
] as const;

// `force` bypasses the 30s dedupe — used on explicit user tap so the chain
// heats up overlapping the user's speech window (see useVoiceCaddie openSession).
export function prewarmVoice(force = false): void {
  const now = Date.now();
  if (!force && now - lastWarmupAt < WARMUP_DEDUPE_MS) return;
  lastWarmupAt = now;

  const apiUrl = getApiBaseUrl();
  if (!apiUrl) return;

  // Read the user's current AI provider so the warmup pings the RIGHT
  // provider SDK. Defaults to 'gemini' to match server-side default.
  const aiProvider = useSettingsStore.getState().aiProvider ?? 'gemini';

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
}
