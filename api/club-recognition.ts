import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeVision, providerFromHeaderSafe, type StructuredSchema } from './_aiProvider';

/**
 * Phase BL — Club recognition endpoint.
 *
 * OCR-style read of the number / letters stamped on the bottom (sole) of a
 * golf club. The player points the camera at the sole, snaps a still, and
 * we identify which club they're about to hit. Returns a structured
 * { club_id, club_type, confidence, reasoning } payload.
 *
 * High-confidence reads auto-register the club in the cage session. Medium
 * confidence triggers a "looks like X — confirm?" prompt. Low confidence
 * routes to the manual selector. The three-tier UX is intentional — every
 * read is honest about how sure it is.
 *
 * Why a separate endpoint vs extending /api/swing-analysis: swing-analysis
 * has its own canonical-issue catalog and prompt structure tuned for
 * 5-frame full-swing classification. Mixing club OCR into that prompt would
 * dilute both. Keeping a dedicated endpoint also means changes to the
 * club catalog don't risk regressing swing analysis.
 */

// Catalog matches the legacy CLUBS array in app/cage/index.tsx so values
// passed back to the client align with what's already stored in cageStore.
const VALID_CLUB_IDS = [
  'DR', '3W', '5W', '7W',
  '2H', '3H', '4H', '5H',
  '3I', '4I', '5I', '6I', '7I', '8I', '9I',
  'PW', 'GW', 'AW', 'SW', 'LW',
  'PT',
  'unknown',
] as const;

type ClubId = typeof VALID_CLUB_IDS[number];

const VALID_CLUB_TYPES = ['iron', 'wedge', 'hybrid', 'wood', 'driver', 'putter', 'unknown'] as const;
type ClubType = typeof VALID_CLUB_TYPES[number];

type ClubRecognitionResponse = {
  club_id: ClubId;
  club_type: ClubType;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
};

const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;

const CLUB_RECOGNITION_SCHEMA: StructuredSchema = {
  name: 'club_recognition',
  openai: {
    type: 'object',
    properties: {
      club_id:    { type: 'string', enum: [...VALID_CLUB_IDS] },
      club_type:  { type: 'string', enum: [...VALID_CLUB_TYPES] },
      confidence: { type: 'string', enum: [...CONFIDENCE_VALUES] },
      reasoning:  { type: 'string' },
    },
    required: ['club_id', 'club_type', 'confidence', 'reasoning'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      club_id:    { type: 'STRING', enum: [...VALID_CLUB_IDS] },
      club_type:  { type: 'STRING', enum: [...VALID_CLUB_TYPES] },
      confidence: { type: 'STRING', enum: [...CONFIDENCE_VALUES] },
      reasoning:  { type: 'STRING' },
    },
    required: ['club_id', 'club_type', 'confidence', 'reasoning'],
  },
  anthropic: {
    input_schema: {
      type: 'object',
      properties: {
        club_id:    { type: 'string', enum: [...VALID_CLUB_IDS] },
        club_type:  { type: 'string', enum: [...VALID_CLUB_TYPES] },
        confidence: { type: 'string', enum: [...CONFIDENCE_VALUES] },
        reasoning:  { type: 'string' },
      },
      required: ['club_id', 'club_type', 'confidence', 'reasoning'],
    },
  },
};

const SYSTEM_PROMPT = `You are reading the bottom (sole) of a golf club shown to a camera. The player wants to identify which club they are about to hit. Read the number or letters stamped on the sole — this is OCR-style reading, not visual classification of club type.

Return ONLY a JSON object:
{
  "club_id": "<the number/letters as shown — see catalog below>",
  "club_type": "iron | wedge | hybrid | wood | driver | putter | unknown",
  "confidence": "high | medium | low",
  "reasoning": "<one short sentence: what was visible on the sole>"
}

Club ID catalog (use these EXACT strings — no variations):
- "DR" = Driver
- "3W", "5W", "7W" = Fairway woods (number stamped + W)
- "2H", "3H", "4H", "5H" = Hybrids (number stamped + H)
- "3I", "4I", "5I", "6I", "7I", "8I", "9I" = Numbered irons (number stamped + I)
- "PW" = Pitching Wedge
- "GW" = Gap Wedge
- "AW" = Approach Wedge (some sets have AW vs GW — return whichever letters are stamped)
- "SW" = Sand Wedge
- "LW" = Lob Wedge
- "PT" = Putter (cage practice rarely sees a putter, but if shown — flat-bottom rectangular sole, no number)
- "unknown" = no number/letters readable

Disambiguation rules:
- A bare "P" stamped on the sole could be Putter or Pitching Wedge. Look at the sole shape: putter has a flat rectangular sole; PW has a wedge-shaped sole. When sole shape is ambiguous, prefer "PW" with medium confidence and explain in reasoning.
- A bare number with no I/W/H suffix — assume iron (e.g., "7" stamped → return "7I"). Modern irons sometimes only stamp the number.

Confidence scale (be honest):
- high: number/letters clearly visible, sharp focus, good lighting, no ambiguity
- medium: visible but worn / slight blur / partial occlusion / ambiguous letter
- low: barely visible, severe angle, dark, or markings absent

Rules:
- If you cannot read a number or letter on the sole, return club_id "unknown", club_type "unknown", confidence "low".
- Numbers stamped large near the heel are typically irons. Numbers + "W" = woods. Numbers + "H" = hybrids.
- Output ONLY valid JSON. No code fences, no preamble.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const image = body.image as { b64?: string; media_type?: string } | undefined;
    const b64 = image?.b64 ?? (body.b64 as string | undefined);
    const mediaType = (image?.media_type ?? body.media_type ?? 'image/jpeg') as
      'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    if (!b64 || typeof b64 !== 'string') {
      return res.status(400).json({ error: 'image.b64 (base64 club-sole photo) required' });
    }
    if (b64.length > 9_000_000) {
      return res.status(413).json({ error: 'image too large; resize to ~1024px on long edge' });
    }

    const provider = providerFromHeaderSafe(req.headers as Record<string, string | string[] | undefined>);
    const text = await completeVision(provider, 'quality', SYSTEM_PROMPT,
      'Read the number or letters stamped on the sole. Return JSON.',
      [{ b64, mimeType: mediaType }],
      { maxTokens: 200, temperature: 0.1, schema: CLUB_RECOGNITION_SCHEMA },
    );
    if (!text) {
      return res.status(502).json({ error: 'Empty model response' });
    }

    let parsed: ClubRecognitionResponse;
    try {
      parsed = JSON.parse(text) as ClubRecognitionResponse;
    } catch {
      return res.status(502).json({ error: 'Model returned non-JSON', raw: text.slice(0, 300) });
    }

    return res.status(200).json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[club-recognition] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
