/**
 * 2026-07-22 (Tim — SmartFinder auto-detect / "wrap SmartVision around it").
 *
 * The Measure mode (services/rangefinder.computeHeightRangedDistance) ranges off an object of
 * KNOWN height by its angular size — normally the user taps the object's top + base. This
 * endpoint does that tap automatically: given a camera frame, our vision brain finds the single
 * best KNOWN-SIZE reference (a golf flagstick/pin ≈ 2.13 m, or a standing person ≈ 1.75 m) and
 * returns its top + base in normalized image coords. The CLIENT feeds those to
 * computeHeightRangedDistance to get the distance — no tap, hands-free.
 *
 * HONESTY (app-wide tenet): the model MUST set found=false when it can't clearly see BOTH the top
 * and the ground-contact base of a real reference (partial, occluded, ambiguous, or unknown-size
 * object). No guessed box → the client keeps the manual two-tap. Uses OUR provider (completeVision).
 *
 * Input (POST JSON): { image_b64, image_media_type? }
 * Output: { found, kind, real_height_m, top:{x,y}|null, base:{x,y}|null, confidence, notes }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';
import { completeVision, providerFromHeaderSafe, type StructuredSchema } from './_aiProvider';

const POINT_OAI = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false };
const POINT_OAI_NULLABLE = { type: ['object', 'null'], properties: POINT_OAI.properties, required: POINT_OAI.required, additionalProperties: false };
const POINT_GEM = { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } } };

const SCHEMA: StructuredSchema = {
  name: 'measure_reference',
  strict: false,
  openai: {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      kind: { type: 'string', enum: ['flagstick', 'person', 'none'] },
      real_height_m: { type: 'number' },
      top: POINT_OAI_NULLABLE,
      base: POINT_OAI_NULLABLE,
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      notes: { type: 'string' },
    },
    required: ['found', 'kind', 'real_height_m', 'top', 'base', 'confidence', 'notes'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      found: { type: 'BOOLEAN' },
      kind: { type: 'STRING', enum: ['flagstick', 'person', 'none'] },
      real_height_m: { type: 'NUMBER' },
      top: { ...POINT_GEM, nullable: true },
      base: { ...POINT_GEM, nullable: true },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      notes: { type: 'STRING' },
    },
    required: ['found', 'kind', 'real_height_m', 'top', 'base', 'confidence', 'notes'],
  },
};

const SYSTEM_PROMPT = `You are a golf rangefinder's vision assist. You are given ONE photo taken by a golfer pointing their phone at a target. Find the single BEST reference object of KNOWN real-world height to range off, and report its exact TOP and BASE (ground-contact) points as fractions of the image (x: 0 left … 1 right, y: 0 top … 1 bottom).

Prefer, in order:
1. A golf FLAGSTICK / pin on a green — a thin pole with a flag. Real height ≈ 2.13 m (7 ft). The TOP is the very top of the flag/pole; the BASE is where the pole meets the green.
2. A standing PERSON, fully visible head to feet. Real height ≈ 1.75 m. TOP = top of head, BASE = feet on the ground.

Rules:
- Report ONLY a reference whose TOP and ground-contact BASE are BOTH clearly visible. If the base is hidden (behind a mound, out of frame, occluded) you cannot range it → found=false.
- The reference must be roughly VERTICAL and standing on the ground the golfer is on.
- If there is no clear flagstick or full standing person, set found=false, kind="none", top=null, base=null.
- Do NOT guess a box for a partially-visible or ambiguous object. A wrong box gives a wrong distance — returning found=false is CORRECT and expected.
- Set real_height_m to 2.13 for a flagstick, 1.75 for a person.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body ?? {}) as { image_b64?: string; image_media_type?: string };
  const image_b64 = String(body.image_b64 ?? '').trim();
  const image_media_type = String(body.image_media_type ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';
  if (!image_b64) return res.status(400).json({ error: 'image_b64 (base64 camera frame) required' });
  if (image_b64.length > 7_000_000) return res.status(413).json({ error: 'Image too large; resize to ~1024px on long edge.' });

  const provider = providerFromHeaderSafe(req.headers as Record<string, string | string[] | undefined>);
  try {
    const text = await completeVision(
      provider,
      'quality',
      SYSTEM_PROMPT,
      'Find the best known-size ranging reference and report its top + base in normalized image coordinates.',
      [{ b64: image_b64, mimeType: image_media_type }],
      { maxTokens: 400, temperature: 0.1, forceJSON: true, schema: SCHEMA },
    );
    if (!text) return res.status(502).json({ error: 'Empty model response', provider });

    let parsed: Record<string, unknown> | null = null;
    try {
      const cleaned = text.replace(/```json?|```/g, '').trim();
      const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
      parsed = JSON.parse(s >= 0 && e > s ? cleaned.slice(s, e + 1) : cleaned) as Record<string, unknown>;
    } catch { return res.status(502).json({ error: 'Model returned non-JSON', provider, raw: text.slice(0, 200) }); }

    // Guard each point to a finite [0,1] pair or null so the client never ranges off NaN.
    const pt = (v: unknown): { x: number; y: number } | null => {
      if (!v || typeof v !== 'object') return null;
      const o = v as { x?: unknown; y?: unknown };
      const x = Number(o.x), y = Number(o.y);
      return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
    };
    const top = pt(parsed.top);
    const base = pt(parsed.base);
    const kind = parsed.kind === 'flagstick' || parsed.kind === 'person' ? parsed.kind : 'none';
    // A usable read requires a real reference AND both endpoints AND a positive height.
    const heightM = Number(parsed.real_height_m);
    const found = parsed.found === true && kind !== 'none' && top != null && base != null && Number.isFinite(heightM) && heightM > 0;
    return res.status(200).json({
      found,
      kind: found ? kind : 'none',
      real_height_m: found ? heightM : 0,
      top: found ? top : null,
      base: found ? base : null,
      confidence: typeof parsed.confidence === 'string' ? parsed.confidence : 'low',
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      provider,
    });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'vision call failed', provider });
  }
}
