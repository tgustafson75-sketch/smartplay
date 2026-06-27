/**
 * 2026-05-26 — Batch 62: /api/health expansion.
 *
 * Was a static `{ status: 'ok', timestamp }`. Now probes every upstream
 * provider Tim's app depends on (Anthropic, OpenAI, Gemini, ElevenLabs)
 * in parallel and reports per-provider liveness so:
 *   • A degraded provider surfaces immediately (no need to wait for a
 *     real call to fail in the field)
 *   • Tim can hit /api/health from anywhere and know which lane is
 *     contributing to a "Kevin is silent" report
 *   • Future status pages can chart the trend
 *
 * Backwards-compat: legacy callers reading just `status === 'ok'` still
 * work — the top-level status flips to 'degraded' only when one of the
 * providers Tim relies on is configured AND failing. Unconfigured
 * providers (no API key) report `unconfigured` and don't pull status
 * down — they're a deployment choice, not a failure.
 *
 * Probes are TINY (max 1 output token, no real generation) so cost per
 * health check is < $0.001 total. Total budget: 4-5s wall-clock
 * (3s per-probe timeout, parallel).
 *
 * Legacy shape: pass ?lite=1 to skip probes and get the original
 * { status: 'ok', timestamp } response (for cron / cheap uptime checks).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

const PROBE_TIMEOUT_MS = 3_000;

type ProbeStatus = 'ok' | 'down' | 'unconfigured';
type ProbeResult = { status: ProbeStatus; latency_ms?: number; error?: string };

/** Race a promise against a timeout. Returns the timeout error if not resolved. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout >${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeAnthropic(): Promise<ProbeResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { status: 'unconfigured' };
  const startedAt = Date.now();
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 });
    await withTimeout(
      client.messages.create({
        // 2026-06-27 — was 'claude-haiku-4-5' (no date suffix → invalid id, probe
        // always failed). Match the real brain (api/_aiProvider anthropic.fast).
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      PROBE_TIMEOUT_MS,
      'anthropic',
    );
    return { status: 'ok', latency_ms: Date.now() - startedAt };
  } catch (e) {
    return {
      status: 'down',
      latency_ms: Date.now() - startedAt,
      error: e instanceof Error ? e.message.slice(0, 200) : 'unknown',
    };
  }
}

async function probeOpenAI(): Promise<ProbeResult> {
  if (!process.env.OPENAI_API_KEY) return { status: 'unconfigured' };
  const startedAt = Date.now();
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 });
    await withTimeout(
      client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      PROBE_TIMEOUT_MS,
      'openai',
    );
    return { status: 'ok', latency_ms: Date.now() - startedAt };
  } catch (e) {
    return {
      status: 'down',
      latency_ms: Date.now() - startedAt,
      error: e instanceof Error ? e.message.slice(0, 200) : 'unknown',
    };
  }
}

async function probeGemini(): Promise<ProbeResult> {
  if (!process.env.GOOGLE_API_KEY) return { status: 'unconfigured' };
  const startedAt = Date.now();
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    await withTimeout(
      client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'ping',
        config: { maxOutputTokens: 1 },
      }),
      PROBE_TIMEOUT_MS,
      'gemini',
    );
    return { status: 'ok', latency_ms: Date.now() - startedAt };
  } catch (e) {
    return {
      status: 'down',
      latency_ms: Date.now() - startedAt,
      error: e instanceof Error ? e.message.slice(0, 200) : 'unknown',
    };
  }
}

// 2026-06-04 — probeElevenLabs removed. ElevenLabs path was stripped
// from the entire runtime voice pipeline (api/voice.ts, api/kevin.ts,
// app/api/voice+api.ts) so the health probe has no provider to report
// on. Re-add if ElevenLabs is ever reintroduced as an active path.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Backwards-compat fast path: callers passing ?lite=1 get the legacy
  // { status, timestamp } shape with no probes (useful for cron checks
  // that just want to confirm the function is deployable and warm).
  if (req.query.lite === '1') {
    return res.status(200).json({ status: 'ok', timestamp: Date.now() });
  }

  const [anthropic, openai, gemini] = await Promise.all([
    probeAnthropic(),
    probeOpenAI(),
    probeGemini(),
  ]);

  const providers = { anthropic, openai, gemini };

  // Overall status: 'ok' if no configured provider is 'down'. A single
  // 'down' provider on a configured key flips overall to 'degraded'.
  const anyDown = Object.values(providers).some(p => p.status === 'down');
  const status: 'ok' | 'degraded' = anyDown ? 'degraded' : 'ok';

  res.status(200).json({
    status,
    timestamp: Date.now(),
    providers,
  });
}
