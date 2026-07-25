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
import { allowInference } from './_inferLimit';
import { completeVision, providerFromHeaderSafe, type StructuredSchema } from './_aiProvider';

const POINT_OAI = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false };
const POINT_OAI_NULLABLE = { type: ['object', 'null'], properties: POINT_OAI.properties, required: POINT_OAI.required, additionalProperties: false };
const POINT_GEM = { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } } };

// 2026-07-25 (Tim — "should auto detect everything else; picking person/flag modes makes no sense").
// The scan IDENTIFIES the object + estimates its real height, so the golfer never picks a reference.
const KIND_ENUM = ['flagstick', 'person', 'golf_cart', 'stand_bag', 'range_flag', 'tee_marker', 'bench', 'ball_washer', 'other', 'none'];

const SCHEMA: StructuredSchema = {
  name: 'measure_reference',
  strict: false,
  openai: {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      kind: { type: 'string', enum: KIND_ENUM },
      label: { type: 'string' },
      real_height_m: { type: 'number' },
      top: POINT_OAI_NULLABLE,
      base: POINT_OAI_NULLABLE,
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      notes: { type: 'string' },
    },
    required: ['found', 'kind', 'label', 'real_height_m', 'top', 'base', 'confidence', 'notes'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      found: { type: 'BOOLEAN' },
      kind: { type: 'STRING', enum: KIND_ENUM },
      label: { type: 'STRING' },
      real_height_m: { type: 'NUMBER' },
      top: { ...POINT_GEM, nullable: true },
      base: { ...POINT_GEM, nullable: true },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      notes: { type: 'STRING' },
    },
    required: ['found', 'kind', 'label', 'real_height_m', 'top', 'base', 'confidence', 'notes'],
  },
};

const SYSTEM_PROMPT = `You are a golf rangefinder's vision assist. You are given ONE photo taken by a golfer pointing their phone at a target. IDENTIFY the single BEST object in view whose real-world height you can confidently estimate, and report its TOP and BASE (ground-contact) points as fractions of the image (x: 0 left to 1 right, y: 0 top to 1 bottom), plus WHAT it is and its real height in metres. The golfer should NOT have to tell you what it is - you figure it out.

Good references and their typical real heights:
- golf FLAGSTICK / pin (thin pole with a flag on a green): 2.13 m. kind="flagstick".
- standing PERSON, head to feet: 1.75 m. kind="person".
- golf CART: 1.20 m tall at the roof. kind="golf_cart".
- stand / carry BAG standing upright: 0.90 m. kind="stand_bag".
- driving-range MARKER FLAG: 1.80 m. kind="range_flag".
- TEE MARKER block or ball: 0.15 m. kind="tee_marker".
- BENCH: 0.85 m. kind="bench".
- BALL WASHER on a post: 0.95 m. kind="ball_washer".
- anything else with a confidently known height: kind="other" and set real_height_m to your best estimate.

Set label to a short human name of the object (e.g. "the flagstick", "the golf cart", "that bench").

Rules:
- Report ONLY an object whose TOP and ground-contact BASE are BOTH clearly visible. If the base is hidden (behind a mound, out of frame, occluded) you cannot range it -> found=false.
- The object must be roughly VERTICAL / sitting on the same ground as the golfer, and be a discrete thing you can put a real height on (NOT a tree line, wall, or the horizon).
- Do NOT guess a box for a partially-visible or ambiguous object. A wrong box gives a wrong distance -> found=false is CORRECT and expected.
- real_height_m must be the object's TRUE height in the range 0.1 to 3.0 m; never 0 when found=true.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowInference(req, res, 'measure-scan')) return;

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
    const kindRaw = typeof parsed.kind === 'string' ? parsed.kind : 'none';
    const kind = KIND_ENUM.includes(kindRaw) ? kindRaw : 'other';
    const label = typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label.trim() : 'the object';
    // A usable read requires a real object AND both endpoints AND a PLAUSIBLE height (0.1-3.0 m).
    const heightM = Number(parsed.real_height_m);
    const found = parsed.found === true && kind !== 'none' && top != null && base != null && Number.isFinite(heightM) && heightM >= 0.1 && heightM <= 3.0;
    return res.status(200).json({
      found,
      kind: found ? kind : 'none',
      label: found ? label : '',
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
