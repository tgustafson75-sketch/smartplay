import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { requireAppKey } from './_appKey';
import { allowInference } from './_inferLimit';

// 2026-09-01 (adversarial audit) — maxRetries 0: A RETRY THAT CANNOT FIT IS WORSE THAN NO RETRY.
// The SDK's retry starts AFTER the first attempt's timeout, and this route's provider budget is
// already most of its platform ceiling — so a retry is killed mid-flight and the caller gets nothing
// instead of either an answer or a clean error. Tim's `clubpath_arc_too_sparse points: 0` was this
// shape. Fail once, honestly, inside the budget. [[the-client-must-be-the-last-to-give-up]]
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 50_000 /* < 60s platform ceiling: a provider budget EQUAL to the ceiling cannot finish, because the response still has to be read and written */, maxRetries: 0 });

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
 * Client contract:
 *   POST /api/image-edit
 *   { imageBase64?: string, prompt: string }
 *   ->  { b64: string, provider: 'gemini'|'openai', mode: 'edit'|'generate' }   (success)
 *   ->  { error: string }                                                        (failure)
 *
 * 2026-09-20 (Tim's wife) — imageBase64 IS NOW OPTIONAL. Making a custom caddie used to demand a
 * selfie, and plenty of people will not take one — for their kids, or for themselves. With no image
 * this runs text-to-image on the same cost ladder instead of image-edit, so "a silver-haired caddie
 * in a flat cap" is a first-class way in rather than a lesser one.
 *
 * Image format: when sent, image/png base64 (no data: prefix), <= 4MB.
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_PROMPT_CHARS = 1_000;
// nano-banana — native image input+output. Default modality is IMAGE.
/**
 * 2026-09-23 — gemini-2.5-flash-image shuts down 2026-10-02 (ai.google.dev/gemini-api/docs/deprecations).
 * The stable successor is gemini-3.1-flash-image ("Nano Banana 2", no shutdown date announced). NOT the
 * `-preview` id the deprecations table lists as the replacement — that preview was itself retired 06-25.
 * gpt-image-1 is removed 2026-12-01; gpt-image-2 supports both images endpoints used below.
 */
const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';
const OPENAI_IMAGE_MODEL = 'gpt-image-2';

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
    model: OPENAI_IMAGE_MODEL,
    image: file,
    prompt,
    n: 1,
  } as Parameters<typeof openai.images.edit>[0]);
  const first = result.data?.[0];
  return first?.b64_json ?? first?.url ?? null;
}

/**
 * Text-to-image on the same ladder. Gemini's image model takes a parts array either way, so the only
 * difference from the edit path is the absence of an inlineData part — deliberately a separate
 * function rather than a conditional inside the edit one, so a future change to editing cannot
 * silently alter generation, or the reverse.
 */
async function geminiImageGenerate(prompt: string): Promise<string | null> {
  if (!process.env.GOOGLE_API_KEY) return null;
  try {
    const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    const res = await Promise.race([
      genai.models.generateContent({
        model: GEMINI_IMAGE_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini image timeout')), 22_000)),
    ]);
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const data = (p as { inlineData?: { data?: string } }).inlineData?.data;
      if (data) return data;
    }
    console.warn('[image-edit] gemini generate returned no image part — falling back to openai');
    return null;
  } catch (e) {
    console.warn('[image-edit] gemini generate failed — falling back to openai:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** OpenAI gpt-image-1 text-to-image fallback. images.generate, NOT images.edit — there is no image. */
async function openaiImageGenerate(prompt: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await openai.images.generate({
    model: OPENAI_IMAGE_MODEL,
    prompt,
    n: 1,
    size: '1024x1024',
  } as Parameters<typeof openai.images.generate>[0]);
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

    // An image is optional; a prompt never is. With no image there is nothing to describe the
    // subject but the words, so an empty prompt would generate an arbitrary picture.
    const mode: 'edit' | 'generate' = imageBase64 ? 'edit' : 'generate';
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    if (prompt.length > MAX_PROMPT_CHARS) {
      return res.status(400).json({ error: `prompt exceeds ${MAX_PROMPT_CHARS} chars` });
    }

    const buffer = imageBase64 ? Buffer.from(imageBase64, 'base64') : null;
    if (buffer && buffer.byteLength > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: `image exceeds ${MAX_IMAGE_BYTES} bytes; resize before upload` });
    }

    // Cost ladder: Gemini first, OpenAI fallback.
    // 2026-07-10 (audit A4) — guard EACH provider call. openaiImageEdit had no internal
    // try/catch, so an OpenAI error (billing hard-limit — the very reason for this ladder —
    // moderation, rate limit) propagated to the outer catch → raw 500, instead of the tidy
    // 502 "both providers returned no image" the exhausted-chain case intends.
    let b64: string | null = null;
    let provider: 'gemini' | 'openai' = 'gemini';
    try {
      b64 = mode === 'edit'
        ? await geminiImageEdit(imageBase64, prompt)
        : await geminiImageGenerate(prompt);
    } catch (e) { console.warn('[image-edit] gemini failed:', e instanceof Error ? e.message : e); }
    if (!b64) {
      provider = 'openai';
      try {
        b64 = mode === 'edit'
          ? await openaiImageEdit(buffer as Buffer, prompt)
          : await openaiImageGenerate(prompt);
      } catch (e) { console.warn('[image-edit] openai failed:', e instanceof Error ? e.message : e); }
    }
    if (!b64) {
      return res.status(502).json({ error: 'Both image providers returned no image' });
    }

    return res.status(200).json({ b64, provider, mode });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[image-edit] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
