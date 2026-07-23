/**
 * 2026-07-23 (Tim — Bag Vision) — scan a golfer's bag from a short VIDEO.
 *
 * The client records a few seconds panning across the bag, extracts a handful of frames, and
 * posts them here. Our vision brain reads every DISTINCT club across the frames and returns it
 * with product specifics — club_id (catalog), type, brand, model, loft — plus an honest
 * confidence. Deduplicated: one entry per physical club, and it reports ONLY clubs actually
 * seen (never pads to a full set). The client populates the bag and lets the user confirm/edit.
 *
 * This is the sibling of api/club-recognition (single sole → which club am I hitting): same
 * catalog + honesty bar, but multi-club and brand/model-aware. The registered bag it produces
 * then sharpens club-recognition's live reads (constrain to the set the player actually owns).
 *
 * Input:  { frames: [{ b64, media_type? }, ...] }   (1–8 frames)
 * Output: { clubs: [{ club_id, club_type, brand, model, loft, confidence }, ...] }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';
import { completeVision, providerFromHeaderSafe, type StructuredSchema } from './_aiProvider';

const VALID_CLUB_IDS = [
  'DR', '3W', '5W', '7W',
  '2H', '3H', '4H', '5H',
  '3I', '4I', '5I', '6I', '7I', '8I', '9I',
  'PW', 'GW', 'AW', 'SW', 'LW',
  'PT',
] as const;
const VALID_CLUB_TYPES = ['iron', 'wedge', 'hybrid', 'wood', 'driver', 'putter', 'unknown'] as const;
const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;
const MAX_FRAMES = 8;

const CLUB_OAI = {
  type: 'object',
  properties: {
    club_id: { type: 'string', enum: [...VALID_CLUB_IDS] },
    club_type: { type: 'string', enum: [...VALID_CLUB_TYPES] },
    brand: { type: 'string' },
    model: { type: 'string' },
    loft: { type: 'string' },
    confidence: { type: 'string', enum: [...CONFIDENCE_VALUES] },
  },
  required: ['club_id', 'club_type', 'brand', 'model', 'loft', 'confidence'],
  additionalProperties: false,
};
const CLUB_GEM = {
  type: 'OBJECT',
  properties: {
    club_id: { type: 'STRING', enum: [...VALID_CLUB_IDS] },
    club_type: { type: 'STRING', enum: [...VALID_CLUB_TYPES] },
    brand: { type: 'STRING' },
    model: { type: 'STRING' },
    loft: { type: 'STRING' },
    confidence: { type: 'STRING', enum: [...CONFIDENCE_VALUES] },
  },
  required: ['club_id', 'club_type', 'brand', 'model', 'loft', 'confidence'],
};

const SCHEMA: StructuredSchema = {
  name: 'bag_scan',
  strict: false,
  openai: {
    type: 'object',
    properties: { clubs: { type: 'array', items: CLUB_OAI } },
    required: ['clubs'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: { clubs: { type: 'ARRAY', items: CLUB_GEM } },
    required: ['clubs'],
  },
  anthropic: {
    input_schema: {
      type: 'object',
      properties: { clubs: { type: 'array', items: CLUB_OAI } },
      required: ['clubs'],
    },
  },
};

const SYSTEM_PROMPT = `You are cataloguing a golfer's bag from several video frames panning across their clubs. Identify EVERY DISTINCT club visible across ALL the frames combined and return one entry per PHYSICAL club (deduplicate — the same club appears in multiple frames).

For each club report:
- club_id: EXACT catalog string — DR, 3W, 5W, 7W, 2H, 3H, 4H, 5H, 3I, 4I, 5I, 6I, 7I, 8I, 9I, PW, GW, AW, SW, LW, PT.
- club_type: iron | wedge | hybrid | wood | driver | putter | unknown.
- brand: the manufacturer if legible on the head (e.g. "TaylorMade", "Titleist", "Callaway", "Ping"). Empty string "" if you cannot read it — DO NOT GUESS.
- model: the model name/line if legible (e.g. "Stealth 2", "T100", "Apex"). Empty string "" if not legible — DO NOT GUESS.
- loft: if a loft is stamped/visible (e.g. "10.5°", "52°"). Empty string "" if not visible.
- confidence: high (clearly identified), medium (visible but partial/worn/angled), low (barely visible).

HONESTY (critical):
- Report ONLY clubs you actually see. NEVER pad the list to a "typical" 14-club set.
- brand/model are OFTEN not legible from a bag pan — that is EXPECTED. Return "" rather than inventing a brand or model. A wrong model is worse than a blank.
- If two clubs are genuinely indistinguishable and you can't tell if it's one or two, report the ones you're confident about and leave the rest out.
- Wedges: read the stamped loft to disambiguate (48/50=PW/GW area, 52/54=GW/SW, 56=SW, 58/60=LW). Map to the closest catalog id and put the exact loft in "loft".`;

type FrameIn = { b64?: unknown; media_type?: unknown };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as { frames?: unknown };
  if (!Array.isArray(body.frames) || body.frames.length === 0) {
    return res.status(400).json({ error: 'frames (array of {b64}) required' });
  }
  const images = (body.frames as FrameIn[])
    .slice(0, MAX_FRAMES)
    .map((f) => ({ b64: String(f.b64 ?? ''), mimeType: (String(f.media_type ?? 'image/jpeg')) as 'image/jpeg' | 'image/png' | 'image/webp' }))
    .filter((f) => f.b64.length > 0);
  if (images.length === 0) return res.status(400).json({ error: 'no valid frames' });
  const totalBytes = images.reduce((n, f) => n + f.b64.length, 0);
  if (totalBytes > 18_000_000) return res.status(413).json({ error: 'frames too large; send fewer / smaller frames' });

  const provider = providerFromHeaderSafe(req.headers as Record<string, string | string[] | undefined>);
  try {
    const text = await completeVision(
      provider,
      'quality',
      SYSTEM_PROMPT,
      'Catalogue every distinct club visible across these bag frames. Return JSON { clubs: [...] }.',
      images,
      { maxTokens: 1200, temperature: 0.1, forceJSON: true, schema: SCHEMA },
    );
    if (!text) return res.status(502).json({ error: 'Empty model response', provider });

    let parsed: { clubs?: unknown } | null = null;
    try {
      const cleaned = text.replace(/```json?|```/g, '').trim();
      const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
      parsed = JSON.parse(s >= 0 && e > s ? cleaned.slice(s, e + 1) : cleaned);
    } catch {
      return res.status(502).json({ error: 'Model returned non-JSON', provider, raw: text.slice(0, 200) });
    }

    const validId = new Set<string>(VALID_CLUB_IDS);
    const seen = new Set<string>();
    const clubs = (Array.isArray(parsed?.clubs) ? parsed!.clubs : [])
      .map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const club_id = String(o.club_id ?? '');
        if (!validId.has(club_id) || seen.has(club_id)) return null; // drop invalid + dedupe by id
        seen.add(club_id);
        const conf = o.confidence;
        return {
          club_id,
          club_type: typeof o.club_type === 'string' ? o.club_type : 'unknown',
          brand: typeof o.brand === 'string' ? o.brand.trim() : '',
          model: typeof o.model === 'string' ? o.model.trim() : '',
          loft: typeof o.loft === 'string' ? o.loft.trim() : '',
          confidence: conf === 'high' || conf === 'medium' ? conf : 'low',
        };
      })
      .filter((c): c is NonNullable<typeof c> => c != null);

    return res.status(200).json({ clubs, provider });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'vision call failed', provider });
  }
}
