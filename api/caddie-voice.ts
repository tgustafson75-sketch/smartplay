/**
 * 2026-07-30 (Tim — "analyze the photo for my caddie and assign a fitting OpenAI voice"). Given the
 * custom caddie's portrait, pick the best-fitting OpenAI gpt-4o-mini-tts voice (perceived gender,
 * apparent age, vibe). Uses OpenAI vision (same key/ecosystem as /api/voice). NEVER hard-fails —
 * returns a safe default on any error so the caller always gets a usable voice.
 *
 * Request:  POST { imageB64: string, mediaType?: string }
 * Response: 200 { voice: string, reason: string | null }
 */
import OpenAI from 'openai';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 });

// The gpt-4o-mini-tts voices, with a short character note to steer the pick.
const VOICES: { id: string; desc: string }[] = [
  { id: 'onyx', desc: 'deep, warm, mature male' },
  { id: 'echo', desc: 'calm, measured, steady male' },
  { id: 'ash', desc: 'confident, energetic male' },
  { id: 'verse', desc: 'expressive, characterful male' },
  { id: 'fable', desc: 'warm storyteller, British-leaning' },
  { id: 'alloy', desc: 'neutral, friendly, androgynous' },
  { id: 'sage', desc: 'calm, wise, soft-spoken' },
  { id: 'nova', desc: 'clear, bright female' },
  { id: 'coral', desc: 'warm, upbeat female' },
  { id: 'shimmer', desc: 'soft, gentle female' },
];
const IDS = VOICES.map((v) => v.id);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { imageB64, mediaType = 'image/jpeg' } = (req.body ?? {}) as { imageB64?: string; mediaType?: string };
    if (!imageB64 || typeof imageB64 !== 'string' || imageB64.length < 100) {
      return res.status(400).json({ error: 'imageB64 required' });
    }
    const voiceList = VOICES.map((v) => `${v.id} (${v.desc})`).join(', ');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 60,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `This is the portrait of a golf caddie. Pick the SINGLE best-fitting text-to-speech voice for them — ` +
                `match perceived gender, apparent age, and overall vibe. Choose ONLY from: ${voiceList}. ` +
                `Return ONLY JSON: {"voice":"<one id>","reason":"<max 6 words>"}.`,
            },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageB64}` } },
          ],
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? '{}';
    let parsed: { voice?: string; reason?: string } = {};
    try { parsed = JSON.parse(raw); } catch { /* fall through to default */ }
    const voice = typeof parsed.voice === 'string' && IDS.includes(parsed.voice) ? parsed.voice : 'alloy';
    const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 60) : null;
    return res.status(200).json({ voice, reason });
  } catch (e) {
    console.error('[caddie-voice] failed', e);
    // Never block the caller — hand back a safe, neutral default.
    return res.status(200).json({ voice: 'alloy', reason: null });
  }
}
