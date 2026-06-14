/**
 * 2026-06-14 (Tim — analysis speed) — pre-warm the swing-analysis lambda.
 *
 * The headline read already runs on the fast path (tier:'quick' — 3 frames, Haiku, no
 * Sonnet), so the biggest remaining delay is a COLD Vercel function: the first analysis
 * after idle pays the lambda spin-up. Firing a tiny no-frames request when the user
 * ENTERS record mode warms the function so the real swing analysis (a few seconds later)
 * lands hot. Mirrors warmVoice for /api/voice.
 *
 * Cheap + safe: an empty frames_base64 returns the server's fast no_frames path (no LLM
 * call), so warming costs ~nothing and can't affect analysis quality. Throttled; never
 * throws. Pure module.
 */

import { getApiBaseUrl } from './apiBase';

const WARM_THROTTLE_MS = 45_000;
let lastWarmAt = 0;

export function warmSwingAnalysis(): void {
  const now = Date.now();
  if (now - lastWarmAt < WARM_THROTTLE_MS) return;
  lastWarmAt = now;
  try {
    void fetch(`${getApiBaseUrl()}/api/swing-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // warmup: server hint; empty frames hits the fast no_frames return either way →
      // the lambda warms without doing (or paying for) any real analysis.
      body: JSON.stringify({ warmup: true, tier: 'quick', frames_base64: [] }),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => undefined);
  } catch { /* warmup is best-effort */ }
}
