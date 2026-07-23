import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { requireAppKey } from './_appKey';
import { allowInference } from './_inferLimit';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });

// 2026-07-23 (QA — cost control) — this route invokes IMAGE GENERATION (gpt-image-1 fallback), the
// highest per-call cost in the app, and was fully unauthenticated. Gate on the shared public app key
// (requireAppKey / _appKey.ts) so a curl loop can't bill image-gen indefinitely. It's a low bar (the
// key ships in the bundle) but stops drive-by abuse; real auth is a broader decision.

/**
 * Image-edit endpoint — selfie / custom-caddie edits + course-image watermark
 * inpaint (scripts/inpaint-course-images.py).
 *
 * 2026-06-23 (Tim — cost control) — COST LADDER: Gemini 2.5 Flash Image first
 * (a fraction of gpt-image-1's price, and we already pay for Gemini), OpenAI
 * gpt-image-1 only as the fallback when Gemini is unavailable / returns no image.
 * This (a) slashes the per-image cost that hit the OpenAI billing hard limit and
 * (b) keeps a quality backstop so a Gemini hiccup never fails the whole call.
 *
 * Client contract (unchanged):
 *   POST /api/image-edit
 *   { imageBase64: string, prompt: string }
 *   ->  { b64: string, provider: 'gemini'|'openai' }   (success)
 *   ->  { error: string }                              (failure)
 *
 * Image format: caller sends image/png base64 (no data: prefix), <= 4MB.
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_PROMPT_CHARS = 1_000;
// nano-banana — native image input+output. Default modality is IMAGE.
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

/** Try Gemini image edit. Returns base64 (no data: prefix) or null to fall back. */
async function geminiImageEdit(imageBase64: string, prompt: string): Promise<string | null> {
  if (!process.env.GOOGLE_API_KEY) return null;
  try {
    const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    // 2026-06-23 (audit) — cap Gemini at 22s via Promise.race so a hang doesn't
    // burn the whole 60s function wall before the OpenAI fallback gets a turn.
    const res = await Promise.race([
      genai.models.generateContent({
        model: GEMINI_IMAGE_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/png', data: imageBase64 } },
            ],
          },
        ],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini image timeout')), 22_000)),
    ]);
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const data = (p as { inlineData?: { data?: string } }).inlineData?.data;
      if (data) return data;
    }
    console.warn('[image-edit] gemini returned no image part — falling back to openai');
    return null;
  } catch (e) {
    console.warn('[image-edit] gemini failed — falling back to openai:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** OpenAI gpt-image-1 fallback. Returns base64/url or null. */
async function openaiImageEdit(buffer: Buffer, prompt: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const file = await OpenAI.toFile(buffer, 'image.png', { type: 'image/png' });
  // gpt-image-1 always returns b64_json and does not accept response_format.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await openai.images.edit({
    model: 'gpt-image-1',
    image: file,
    prompt,
    n: 1,
  } as Parameters<typeof openai.images.edit>[0]);
  const first = result.data?.[0];
  return first?.b64_json ?? first?.url ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // App-key gate (constant-time). Both callers (golferAvatar, custom-caddie) send x-app-key.
  if (!requireAppKey(req, res)) return;
  if (!allowInference(req, res, 'image-edit', 10)) return;
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No image provider configured (need GOOGLE_API_KEY or OPENAI_API_KEY)' });
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as Record<string, unknown>);
    const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : '';
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    if (prompt.length > MAX_PROMPT_CHARS) {
      return res.status(400).json({ error: `prompt exceeds ${MAX_PROMPT_CHARS} chars` });
    }

    const buffer = Buffer.from(imageBase64, 'base64');
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: `image exceeds ${MAX_IMAGE_BYTES} bytes; resize before upload` });
    }

    // Cost ladder: Gemini first, OpenAI fallback.
    // 2026-07-10 (audit A4) — guard EACH provider call. openaiImageEdit had no internal
    // try/catch, so an OpenAI error (billing hard-limit — the very reason for this ladder —
    // moderation, rate limit) propagated to the outer catch → raw 500, instead of the tidy
    // 502 "both providers returned no image" the exhausted-chain case intends.
    let b64: string | null = null;
    let provider: 'gemini' | 'openai' = 'gemini';
    try { b64 = await geminiImageEdit(imageBase64, prompt); } catch (e) { console.warn('[image-edit] gemini failed:', e instanceof Error ? e.message : e); }
    if (!b64) {
      provider = 'openai';
      try { b64 = await openaiImageEdit(buffer, prompt); } catch (e) { console.warn('[image-edit] openai failed:', e instanceof Error ? e.message : e); }
    }
    if (!b64) {
      return res.status(502).json({ error: 'Both image providers returned no image' });
    }

    return res.status(200).json({ b64, provider });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[image-edit] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
