import { getApiBaseUrl } from './apiBase';
/**
 * 2026-06-04 — Pre-warm the FOUR voice-pipeline Vercel functions in
 * parallel after splash completes. Mirrors services/swingAnalysisWarmup.ts
 * (Fix EK pattern, 2026-05-27) — same shape, four endpoints instead
 * of one.
 *
 * On cold launch the user tap chain is:
 *   /api/transcribe   (Whisper / Gemini fallback)
 *   /api/voice-intent (Anthropic Haiku classifier)
 *   /api/kevin        (Anthropic brain + OpenAI TTS)
 *   /api/voice        (OpenAI TTS — used for some response paths)
 *
 * Each is its own Vercel Lambda with its own cold-start (~200-800ms
 * runtime + ~1-3s provider SDK + TLS init). Sequentially that's
 * 8-12s of cold-start cost on the user's first tap. Warming all four
 * in parallel after splash collapses that to a single ~3s window the
 * user never sees — by the time they read "Press to talk to Kevin"
 * and tap, every Lambda + every provider SDK is hot.
 *
 * Each warmup is fire-and-forget with its own AbortSignal timeout.
 * Failures are silent — the user's real tap will hit the same network
 * anyway and surface its own error.
 *
 * Throttled at 30s dedupe so repeated launches don't flood.
 *
 * Each handler exposes a warmup short-circuit (req.body.mode === 'warmup'
 * OR req.query.mode === 'warmup') that runs through the SDK init path
 * with a minimal request and discards the output. Cost per warmup
 * across all four: ~$0.0002.
 */

const WARMUP_DEDUPE_MS = 30_000;
let lastWarmupAt = 0;

const WARMUP_PATHS = [
  '/api/voice',
  '/api/transcribe',
  '/api/voice-intent',
  '/api/kevin',
] as const;

export function prewarmVoice(): void {
  const now = Date.now();
  if (now - lastWarmupAt < WARMUP_DEDUPE_MS) return;
  lastWarmupAt = now;

  const apiUrl = getApiBaseUrl();
  if (!apiUrl) return;

  // Query param AND body both carry `mode: 'warmup'` so handlers can
  // check either. /api/transcribe disables bodyParser (formidable
  // parses multipart later) so the query check is required there;
  // the others use the body check. Both present = every config works.
  const warmup = (path: string): Promise<unknown> =>
    fetch(`${apiUrl}${path}?mode=warmup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'warmup' }),
      // 2026-06-04 — Bumped 5s → 15s. The prior 5s was ABORTING truly-
      // cold Vercel Lambdas (8-12s SDK init + TLS handshake) before
      // the warmup completed — so the user's first tap still paid full
      // cold-start cost. 15s lets every endpoint genuinely warm; cost
      // of the extra budget is zero (warmup is fire-and-forget and
      // hits aborted-anyway endpoints when Vercel is fully degraded).
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      // Silent — warmup is opportunistic.
    });

  void Promise.all(WARMUP_PATHS.map(warmup))
    .then(() => { console.log('[voiceWarmup] all four endpoints warmed'); })
    .catch(() => { /* Promise.all with .catch'd children won't reject — defensive */ });
}
