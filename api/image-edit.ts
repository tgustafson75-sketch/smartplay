import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });

/**
 * Phase 7 — selfie image-edit endpoint.
 *
 * Accepts a base64 source image + a free-text prompt, runs OpenAI's
 * image-edit model, returns the edited image as base64 so the V3 client
 * can render it inline without depending on a CDN URL TTL.
 *
 * Why server-side: OPENAI_API_KEY stays out of the app bundle, the
 * Vercel function handles SDK bookkeeping, and we can swap models
 * (gpt-image-1 -> dall-e-2 -> something else) without an app-store
 * cycle.
 *
 * Client contract:
 *   POST /api/image-edit
 *   { imageBase64: string, prompt: string }
 *   ->  { b64: string }              (success)
 *   ->  { error: string }            (failure)
 *
 * Image format: caller sends image/png base64 (no data: prefix). PNG
 * is required by OpenAI's edits endpoint. Caller is responsible for
 * resizing to <= 4MB before sending; this endpoint enforces an upper
 * bound and rejects oversize payloads to protect the function memory
 * budget.
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_PROMPT_CHARS = 1_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as Record<string, unknown>);
    const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 required' });
    }
    if (!prompt) {
      return res.status(400).json({ error: 'prompt required' });
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return res.status(400).json({ error: `prompt exceeds ${MAX_PROMPT_CHARS} chars` });
    }

    const buffer = Buffer.from(imageBase64, 'base64');
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return res.status(413).json({
        error: `image exceeds ${MAX_IMAGE_BYTES} bytes; resize before upload`,
      });
    }

    // OpenAI's images.edit expects a File-like object. Construct one
    // from the buffer using the SDK's `toFile` helper.
    const file = await OpenAI.toFile(buffer, 'selfie.png', { type: 'image/png' });

    const result = await openai.images.edit({
      model: 'gpt-image-1',
      image: file,
      prompt,
      // n=1 — single edit per call. Caller can re-invoke for variants.
      n: 1,
      // size omitted to match the source image dimensions.
    });

    const first = result.data?.[0];
    const b64 = first?.b64_json;
    if (!b64) {
      return res.status(502).json({ error: 'Empty image-edit response' });
    }

    return res.status(200).json({ b64 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[image-edit] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
