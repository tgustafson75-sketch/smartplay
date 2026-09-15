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
 * Input:  { frames: [{ b64, media_type? }, ...] }   (1–8 images — video frames or still photos)
 * Output: { clubs: [{ club_id, club_type, brand, model, loft, confidence }, ...],
 *            balls: [{ brand, model, confidence }, ...] }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';
import { allowInference } from './_inferLimit';
import { completeVision, providerFromHeaderSafe, type StructuredSchema } from './_aiProvider';
import { CLUB_SNAP_ORDER, CLUB_TYPES } from '../services/clubBagReconcile';

const VALID_CLUB_IDS = CLUB_SNAP_ORDER; // one catalog — services/clubBagReconcile
const VALID_CLUB_TYPES = CLUB_TYPES; // one vocabulary — services/clubBagReconcile
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

/**
 * 2026-09-14 (Tim — "I am going to include a couple of balls in the photo").
 *
 * The ball is a fitting fact the app already reasons over: `playerProfileStore.currentBall` feeds
 * services/ballPerformance ("which ball scores better for me") and the round record stamps it. Until
 * now it could only be SAID — typed on the ball-fit screen or declared out loud. A sleeve sitting in
 * the frame of a bag photo is the same fact, free. Same honesty bar as the clubs: a ball is reported
 * only when the model is legible, never inferred from a brand's usual line-up.
 */
const BALL_OAI = {
  type: 'object',
  properties: {
    brand: { type: 'string' },
    model: { type: 'string' },
    confidence: { type: 'string', enum: [...CONFIDENCE_VALUES] },
  },
  required: ['brand', 'model', 'confidence'],
  additionalProperties: false,
};
const BALL_GEM = {
  type: 'OBJECT',
  properties: {
    brand: { type: 'STRING' },
    model: { type: 'STRING' },
    confidence: { type: 'STRING', enum: [...CONFIDENCE_VALUES] },
  },
  required: ['brand', 'model', 'confidence'],
};

const SCHEMA: StructuredSchema = {
  name: 'bag_scan',
  strict: false,
  openai: {
    type: 'object',
    properties: { clubs: { type: 'array', items: CLUB_OAI }, balls: { type: 'array', items: BALL_OAI } },
    required: ['clubs', 'balls'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: { clubs: { type: 'ARRAY', items: CLUB_GEM }, balls: { type: 'ARRAY', items: BALL_GEM } },
    required: ['clubs', 'balls'],
  },
  anthropic: {
    input_schema: {
      type: 'object',
      properties: { clubs: { type: 'array', items: CLUB_OAI }, balls: { type: 'array', items: BALL_OAI } },
      required: ['clubs', 'balls'],
    },
  },
};

const SYSTEM_PROMPT = `You are cataloguing a golfer's bag from several images — frames of a video pan across the clubs, or still photographs of them, or both. Identify EVERY DISTINCT club visible across ALL the images combined and return one entry per PHYSICAL club (deduplicate — the same club appears in more than one image).

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
- Wedges: read the stamped loft to disambiguate (48/50=PW/GW area, 52/54=GW/SW, 56=SW, 58/60=LW). Map to the closest catalog id and put the exact loft in "loft".

BALLS. The player may deliberately place a golf ball or a sleeve in the frame. Return one entry in "balls" per DISTINCT ball model you can actually read:
- brand: the manufacturer printed on the ball or sleeve ("Titleist", "Callaway", "TaylorMade", "Bridgestone", "Srixon").
- model: the model line printed on it ("Pro V1", "Pro V1x", "Chrome Soft", "TP5x", "AVX"). This is the field that matters.
- confidence: high / medium / low, same meaning as for clubs.
- Return an EMPTY "balls" array when no ball is visible or no printing is legible. NEVER infer the model from the brand — "Titleist" alone is not a Pro V1, and a guessed ball would be recorded as the ball he plays and compared against his scores.`;

type FrameIn = { b64?: unknown; media_type?: unknown };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowInference(req, res, 'bag-scan')) return;
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
  }

  // 2026-07-30 (audit #27) — parse defensively; a non-JSON string body threw an UNHANDLED exception → 500.
  let body: { frames?: unknown };
  try { body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as { frames?: unknown }; }
  catch { return res.status(400).json({ error: 'invalid JSON body' }); }
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

    const seenBall = new Set<string>();
    const balls = (Array.isArray((parsed as { balls?: unknown })?.balls) ? (parsed as { balls: unknown[] }).balls : [])
      .map((b) => {
        const o = (b ?? {}) as Record<string, unknown>;
        const brand = typeof o.brand === 'string' ? o.brand.trim() : '';
        const model = typeof o.model === 'string' ? o.model.trim() : '';
        // A ball with no MODEL is not a usable fact — ballPerformance compares models, not brands.
        if (!model) return null;
        const key = `${brand}|${model}`.toLowerCase();
        if (seenBall.has(key)) return null;
        seenBall.add(key);
        const conf = o.confidence;
        return { brand, model, confidence: conf === 'high' || conf === 'medium' ? conf : 'low' };
      })
      .filter((b): b is NonNullable<typeof b> => b != null);

    return res.status(200).json({ clubs, balls, provider });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'vision call failed', provider });
  }
}
