import { getApiBaseUrl } from './apiBase';
/**
 * 2026-05-27 — Fix EK: pre-warm the swing-analysis Vercel function.
 *
 * Vercel serverless Lambdas pay a cold-start cost (~200-800ms) when
 * they haven't been hit recently. The first swing the user records
 * after opening SmartMotion / Cage / Library-upload otherwise eats
 * that cold-start into its wall-clock time.
 *
 * `prewarmSwingAnalysis()` fires a tiny fire-and-forget POST to
 * /api/swing-analysis with `{ mode: 'warmup' }`. The server short-
 * circuits in <50ms (no AI work), but the Lambda's runtime + provider
 * SDK clients (Anthropic / OpenAI) are now hot. By the time the user
 * actually records a swing 5-30s later, the real call lands on a warm
 * Lambda and the AI-model time IS the wall-clock time.
 *
 * Failure is silent. The warmup is opportunistic — if the network is
 * out, the warmup fails but the user's real analysis will hit the
 * same network anyway and surface its own error.
 *
 * Throttled so a user who taps in/out of SmartMotion repeatedly doesn't
 * send a flood of warmups. One warmup per 30s is the cap.
 */

// 2026-06-07 — Bumped 30s → 60s. Multi-shot Cage sessions can have
// 60-90s between swings; the prior 30s dedupe meant shot 2+ paid
// cold Lambda cost again. Cage Mode's handleSwingAgain also now
// calls prewarmSwingAnalysis (cage-mode.tsx:805) so the warmup
// re-fires the moment the user moves on. opts.force bypasses the
// dedupe entirely for the rare callers that want guaranteed warm.
const WARMUP_DEDUPE_MS = 60_000;
let lastWarmupAt = 0;

export function prewarmSwingAnalysis(opts?: { force?: boolean }): void {
  const now = Date.now();
  if (!opts?.force && now - lastWarmupAt < WARMUP_DEDUPE_MS) return;
  lastWarmupAt = now;

  const apiUrl = getApiBaseUrl();
  if (!apiUrl) return;

  // Fire and forget. Don't await; the user opening the screen shouldn't
  // be slowed by this. Failures are non-fatal — we'll just pay the
  // cold-start on the real call later.
  void fetch(`${apiUrl}/api/swing-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'warmup' }),
    // 2026-06-05 — Bumped 3s → 15s to match services/voiceWarmup.ts.
    // The prior 3s was ABORTING truly-cold Vercel Lambdas mid-init
    // (8-12s SDK init for Anthropic + OpenAI) before the warmup
    // completed — the warmup was firing without actually warming.
    // 15s lets the Lambda + SDK fully warm; cost of the extra budget
    // is zero (warmup is fire-and-forget).
    signal: AbortSignal.timeout(15_000),
  }).then(() => {
    console.log('[swingAnalysisWarmup] warmed');
  }).catch(() => {
    // Silent — pre-warm is opportunistic.
  });
}
