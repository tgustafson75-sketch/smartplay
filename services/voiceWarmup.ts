/**
 * 2026-06-04 — Pre-warm /api/voice. Mirrors services/swingAnalysisWarmup.ts
 * (Fix EK pattern, 2026-05-27) — same shape, different endpoint.
 *
 * Vercel serverless Lambdas pay a cold-start cost (~200-800ms) when
 * they haven't been hit recently. On cold app launch, the first user
 * tap to talk to Kevin otherwise eats that cold-start into wall-clock.
 *
 * `prewarmVoice()` fires a tiny fire-and-forget POST to /api/voice
 * with `{ mode: 'warmup' }`. The server short-circuits in <50ms (no
 * TTS work), but the Lambda's runtime + provider SDK clients (OpenAI /
 * ElevenLabs) are now hot. By the time the user actually taps the
 * mic, the real call lands on a warm Lambda and the TTS time IS the
 * wall-clock time.
 *
 * Failure is silent. The warmup is opportunistic — if the network is
 * out, the warmup fails but the user's real tap will hit the same
 * network anyway and surface its own error.
 *
 * Throttled so a user who launches the app repeatedly doesn't send a
 * flood of warmups. One warmup per 30s is the cap.
 */

const WARMUP_DEDUPE_MS = 30_000;
let lastWarmupAt = 0;

export function prewarmVoice(): void {
  const now = Date.now();
  if (now - lastWarmupAt < WARMUP_DEDUPE_MS) return;
  lastWarmupAt = now;

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (!apiUrl) return;

  // Fire and forget. Don't await; the user shouldn't be slowed by
  // this. Failures are non-fatal — we'll just pay the cold-start on
  // the real call later.
  void fetch(`${apiUrl}/api/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'warmup' }),
    // 3s is plenty for a warmup; if the server takes longer than that
    // it's already past the cold-start cost we were trying to mask.
    signal: AbortSignal.timeout(3_000),
  }).then(() => {
    console.log('[voiceWarmup] warmed');
  }).catch(() => {
    // Silent — pre-warm is opportunistic.
  });
}
