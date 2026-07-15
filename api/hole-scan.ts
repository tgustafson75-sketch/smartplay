import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';
import { completeVision, providerFromHeaderSafe, type StructuredSchema } from './_aiProvider';

/**
 * 2026-07-14 (Tim — "cheat the paid geometry DB") — AI-VISION hole geometry.
 *
 * Given a NORTH-UP satellite tile of a golf hole (Mapbox/Google static, bearing 0), our own
 * vision brain locates the PUTTING GREEN (front/center/back) and the TEE in NORMALIZED image
 * coordinates. The CLIENT converts those pixels to lat/lng using the tile's known center+zoom
 * projection (services/mapboxImagery pixel math) → a derived HoleGeometry with real F/M/B, for
 * ANY course the Golf Course API knows — no Golfbert-style paid database.
 *
 * HONESTY (app-wide tenet): the model MUST set found_green=false + low confidence when it can't
 * clearly see a green in the frame, rather than hallucinate one. The client flags all derived
 * geometry as ESTIMATED until live GPS confirms it, and only ever uses it as a FALLBACK when no
 * real geometry exists — so this can never override curated/API geometry (zero regression).
 *
 * Uses OUR provider (Anthropic/OpenAI/Gemini via completeVision) — no Google Maps key required.
 */

const POINT_OAI = {
  type: 'object',
  properties: {
    x: { type: 'number' }, // 0 (left) … 1 (right)
    y: { type: 'number' }, // 0 (top/north) … 1 (bottom/south)
  },
  required: ['x', 'y'],
  additionalProperties: false,
};
const POINT_OAI_NULLABLE = { type: ['object', 'null'], properties: POINT_OAI.properties, required: POINT_OAI.required, additionalProperties: false };
const POINT_GEM = { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } } };

const HOLE_GEOMETRY_SCHEMA: StructuredSchema = {
  name: 'hole_geometry',
  openai: {
    type: 'object',
    properties: {
      found_green: { type: 'boolean' },
      green_center: POINT_OAI_NULLABLE,
      green_front: POINT_OAI_NULLABLE, // green edge nearest the tee/player
      green_back: POINT_OAI_NULLABLE, // green edge farthest from the tee/player
      tee: POINT_OAI_NULLABLE,
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      notes: { type: 'string' },
    },
    required: ['found_green', 'green_center', 'green_front', 'green_back', 'tee', 'confidence', 'notes'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      found_green: { type: 'BOOLEAN' },
      green_center: { ...POINT_GEM, nullable: true },
      green_front: { ...POINT_GEM, nullable: true },
      green_back: { ...POINT_GEM, nullable: true },
      tee: { ...POINT_GEM, nullable: true },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      notes: { type: 'STRING' },
    },
  },
};

const SYSTEM_PROMPT = `You are a golf-course aerial analyst reading a NORTH-UP satellite photo of one golf hole (or the area around a player on a hole). Coordinates are NORMALIZED: x = 0 at the LEFT edge to 1 at the RIGHT edge; y = 0 at the TOP (north) to 1 at the BOTTOM (south).

Identify, as precisely as you can:
- The PUTTING GREEN: a smooth, evenly-manicured, usually oval/kidney shape, often a subtly different green tone than the fairway, frequently ringed by bunkers (light sand) or rough, sometimes with a flag/pin dot. Give green_center, and green_front (the green edge nearest the approach/tee) and green_back (the far edge).
- The TEE box if visible: a small rectangular manicured pad, usually at the opposite end of the fairway from the green.

RULES:
- Be HONEST. If you cannot clearly see a putting green in THIS frame, set found_green=false, set the point fields to null, and confidence "low". Do NOT invent a green on a fairway, a lighter patch, or a practice area — a wrong green is worse than none.
- If you see the green but not a distinct tee, return tee=null.
- confidence: "high" only when the green is unmistakable; "medium" when likely; "low" when a guess.
- Keep notes to one short sentence (what you saw / why the confidence).
Return ONLY the JSON.`;

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    return JSON.parse(s >= 0 && e > s ? cleaned.slice(s, e + 1) : cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
  }
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
    const image_b64 = String(body.image_b64 ?? '').trim();
    const image_media_type = String(body.image_media_type ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';
    if (!image_b64) return res.status(400).json({ error: 'image_b64 (base64 satellite tile) required' });
    if (image_b64.length > 7_000_000) return res.status(413).json({ error: 'Image too large; resize to ~1024px on long edge.' });

    const hole = Number.isFinite(Number(body.hole_number)) ? Number(body.hole_number) : null;
    const par = Number.isFinite(Number(body.par)) ? Number(body.par) : null;
    const userText =
      `Find the putting green (front/center/back) and tee in this north-up satellite tile of a golf hole` +
      (hole ? ` (hole ${hole}${par ? `, par ${par}` : ''})` : '') +
      `. Return normalized coordinates per your instructions.`;

    const provider = providerFromHeaderSafe(req.headers as Record<string, string | string[] | undefined>);
    const text = await completeVision(
      provider,
      'quality',
      SYSTEM_PROMPT,
      userText,
      [{ b64: image_b64, mimeType: image_media_type }],
      { maxTokens: 500, temperature: 0.1, forceJSON: true, schema: HOLE_GEOMETRY_SCHEMA },
    );
    if (!text) return res.status(502).json({ error: 'Empty model response', provider });

    const parsed = safeParse(text);
    if (!parsed) return res.status(502).json({ error: 'Model returned non-JSON', provider, raw: text.slice(0, 300) });

    // Guard every coordinate to a finite [0,1] point or null so the client never converts NaN.
    const pt = (v: unknown): { x: number; y: number } | null => {
      if (!v || typeof v !== 'object') return null;
      const o = v as { x?: unknown; y?: unknown };
      const x = Number(o.x), y = Number(o.y);
      return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
    };
    const green_center = pt(parsed.green_center);
    const found_green = parsed.found_green === true && green_center != null;
    return res.status(200).json({
      found_green,
      green_center,
      green_front: pt(parsed.green_front),
      green_back: pt(parsed.green_back),
      tee: pt(parsed.tee),
      confidence: found_green ? (parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low') : 'low',
      notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 200) : '',
      provider,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[hole-scan] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
