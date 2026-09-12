/**
 * 2026-09-12 (Tim) — FIND THE BULLSEYE SO NOBODY HAS TO TAP IT.
 *
 * "Only ask to tap the bullseye if vision did not catch it verifiably."
 * "Not too much supervised — it was too much tap. We need to show what AI does in this space."
 *
 * The cage rig is a net with a canvas target and a printed bullseye at a known distance. Until now
 * the app asked the player to tap that target — a manual input for something the camera is pointed
 * directly at, in a setup whose whole purpose is measurement.
 *
 * Modelled on api/measure-scan, which already does exactly this shape for a flagstick: find a
 * KNOWN-SIZE reference, return it in normalized coords, and set found=false rather than guess so the
 * client keeps its manual tap. Same contract here.
 *
 * WHY IT RETURNS THREE POINTS AND NOT ONE. A centre alone cannot be checked. Centre + the outer
 * ring's left and right edge lets the CLIENT verify the detection instead of trusting a confidence
 * word: the centre must sit between the edges, the two radii must agree, and the recovered
 * pixels-per-inch must match the physical diameter it was told. That is the difference between
 * "verifiably" and "confidently" — a score is the model's opinion of itself, and a bullseye's
 * geometry is knowable, so a detection can be PROVED. See services/targetScan.verifyTarget.
 *
 * Input  (POST JSON): { image_b64, image_media_type? }
 * Output: { found, center|null, edge_left|null, edge_right|null, confidence, notes }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';
import { allowInference } from './_inferLimit';
import { completeVision, providerFromHeaderSafe, type StructuredSchema } from './_aiProvider';

const POINT_OAI_NULLABLE = {
  type: ['object', 'null'],
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
};
const POINT_GEM = { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } } };

const SCHEMA: StructuredSchema = {
  name: 'target_scan',
  strict: false,
  openai: {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      center: POINT_OAI_NULLABLE,
      edge_left: POINT_OAI_NULLABLE,
      edge_right: POINT_OAI_NULLABLE,
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      notes: { type: 'string' },
    },
    required: ['found', 'center', 'edge_left', 'edge_right', 'confidence', 'notes'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      found: { type: 'BOOLEAN' },
      center: { ...POINT_GEM, nullable: true },
      edge_left: { ...POINT_GEM, nullable: true },
      edge_right: { ...POINT_GEM, nullable: true },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      notes: { type: 'STRING' },
    },
    required: ['found', 'center', 'edge_left', 'edge_right', 'confidence', 'notes'],
  },
};

const SYSTEM_PROMPT = `You locate an AIMING TARGET in a golf practice cage or net.

The target is usually a canvas or fabric sheet with a printed BULLSEYE — concentric rings, often
contrasting colours, with a clear middle. It may also be a plain circular aiming dot or a taped X.

Report THREE points in NORMALIZED image coordinates (0..1, origin top-left):
  center      — the exact middle of the bullseye
  edge_left   — where the OUTERMOST ring meets its left extreme, on the horizontal through center
  edge_right  — the same on the right

HONESTY IS THE POINT. Set found=false, and all three points null, whenever you cannot clearly see a
real aiming target AND both extremes of its outer ring: partially out of frame, folded or draped
fabric, heavy shadow, motion blur, a net with no target on it, or anything you are merely guessing
at. A wrong box is far worse than no box — the client falls back to asking the player to tap, which
costs one tap; a wrong target silently corrupts every aim and dispersion number that follows.

Do NOT report a golf ball, a club, a logo, a light fixture, or a hole in the net as a target.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowInference(req, res, 'target-scan')) return;

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
      'Find the aiming target and report its centre and the left/right extremes of its outer ring, in normalized image coordinates.',
      [{ b64: image_b64, mimeType: image_media_type }],
      { maxTokens: 350, temperature: 0.1, forceJSON: true, schema: SCHEMA },
    );
    if (!text) return res.status(502).json({ error: 'Empty model response', provider });

    let parsed: Record<string, unknown> | null = null;
    try {
      const cleaned = text.replace(/```json?|```/g, '').trim();
      const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
      parsed = JSON.parse(s >= 0 && e > s ? cleaned.slice(s, e + 1) : cleaned) as Record<string, unknown>;
    } catch { return res.status(502).json({ error: 'Model returned non-JSON', provider, raw: text.slice(0, 200) }); }

    /** Every point clamped to a finite [0,1] pair or null, so the client never aims off NaN. */
    const pt = (v: unknown): { x: number; y: number } | null => {
      if (!v || typeof v !== 'object') return null;
      const o = v as { x?: unknown; y?: unknown };
      const x = Number(o.x), y = Number(o.y);
      return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
    };
    const center = pt(parsed.center);
    const edge_left = pt(parsed.edge_left);
    const edge_right = pt(parsed.edge_right);

    /**
     * A "found" with a missing point is not found. Collapsing that here means the client only ever
     * receives a complete geometry or an honest null — it never has to re-derive this rule.
     */
    const found = parsed.found === true && center != null && edge_left != null && edge_right != null;

    return res.status(200).json({
      found,
      center: found ? center : null,
      edge_left: found ? edge_left : null,
      edge_right: found ? edge_right : null,
      confidence: typeof parsed.confidence === 'string' ? parsed.confidence : 'low',
      notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 300) : '',
      provider,
    });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Vision call failed', provider });
  }
}
