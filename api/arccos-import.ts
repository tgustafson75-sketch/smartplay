/**
 * 2026-07-29 (Tim — Arccos Air trial) — read a golfer's per-club distances from a SCREENSHOT of
 * the Arccos app's "Smart Club Distances" (or club-averages) screen and return them structured.
 *
 * Why a screenshot, not an API: Arccos has no self-serve public API (its On-Course Data API is
 * partner-only, BD-gated). But the golfer's own club-average table is right there on their phone —
 * so we read the numbers they can already see. Zero fragile scraping, ToS-clean (their data, their
 * screen), and Arccos's numbers are already OUTLIER-STRIPPED averages — a clean seed for the bag.
 *
 * This is the sibling of api/bag-scan (bag ROSTER from a video) — same vision brain + honesty bar,
 * but it reads DISTANCES. The client (services/arccosImport) turns the rows into clubStatsStore
 * entries: an Arccos CARRY average → stated carry (My Bag), a TOTAL average → the total ladder.
 *
 * HONESTY: report ONLY clubs whose distance is actually legible; never pad to a full set, never
 * invent a number. distance_kind tells the client which UNIT Arccos is showing (carry vs total)
 * so we don't quote a tee→rest total as a carry the player must FLY a hazard.
 *
 * Input:  { frames: [{ b64, media_type? }, ...] }   (1–4 screenshots)
 * Output: { distance_kind: 'carry'|'total'|'unknown', clubs: [{ club_id, yards, confidence }] }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';
import { allowInference } from './_inferLimit';
import { completeVision, providerFromHeaderSafe, type StructuredSchema } from './_aiProvider';
import { FULL_SWING_CLUB_IDS } from '../services/clubBagReconcile';

// Catalog ids the client's normalizeClub understands. Putter carries no full-shot distance — the
// model is told to skip it, and the client drops it defensively too.
// Putter carries no full-shot distance, so this is the catalog MINUS 'PT' — derived from the one
// catalog rather than hand-maintained, so the exception is stated once and cannot drift.
const VALID_CLUB_IDS = FULL_SWING_CLUB_IDS;
const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;
const DISTANCE_KINDS = ['carry', 'total', 'unknown'] as const;
const MAX_FRAMES = 4;

const CLUB_OAI = {
  type: 'object',
  properties: {
    club_id: { type: 'string', enum: [...VALID_CLUB_IDS] },
    yards: { type: 'number' },
    confidence: { type: 'string', enum: [...CONFIDENCE_VALUES] },
  },
  required: ['club_id', 'yards', 'confidence'],
  additionalProperties: false,
};
const CLUB_GEM = {
  type: 'OBJECT',
  properties: {
    club_id: { type: 'STRING', enum: [...VALID_CLUB_IDS] },
    yards: { type: 'NUMBER' },
    confidence: { type: 'STRING', enum: [...CONFIDENCE_VALUES] },
  },
  required: ['club_id', 'yards', 'confidence'],
};

const SCHEMA: StructuredSchema = {
  name: 'arccos_import',
  strict: false,
  openai: {
    type: 'object',
    properties: {
      distance_kind: { type: 'string', enum: [...DISTANCE_KINDS] },
      clubs: { type: 'array', items: CLUB_OAI },
    },
    required: ['distance_kind', 'clubs'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      distance_kind: { type: 'STRING', enum: [...DISTANCE_KINDS] },
      clubs: { type: 'ARRAY', items: CLUB_GEM },
    },
    required: ['distance_kind', 'clubs'],
  },
  anthropic: {
    input_schema: {
      type: 'object',
      properties: {
        distance_kind: { type: 'string', enum: [...DISTANCE_KINDS] },
        clubs: { type: 'array', items: CLUB_OAI },
      },
      required: ['distance_kind', 'clubs'],
    },
  },
};

const SYSTEM_PROMPT = `You are reading a golfer's per-club distance table from a screenshot of the Arccos golf app (the "Smart Club Distances" / club averages screen). Return one entry per club that has a legible average distance.

For each club report:
- club_id: EXACT catalog string — DR (driver), 3W, 5W, 7W, 2H, 3H, 4H, 5H, 3I, 4I, 5I, 6I, 7I, 8I, 9I, PW, GW, AW, SW, LW. Map Arccos's label to the closest id (e.g. "Driver"→DR, "7 Iron"→7I, "Gap Wedge"→GW, "56°"→SW, "60°"→LW).
- yards: the club's AVERAGE distance shown, as a whole number in YARDS. If the app shows a range or "avg", use the average. If the screen is in meters, convert to yards (× 1.09361) and still return yards.
- confidence: high (clearly legible number), medium (small/partial), low (barely readable).

Also report distance_kind — which distance the table is showing for ALL clubs:
- "carry" if the screen is labeled Carry.
- "total" if labeled Total / Distance / (the Arccos default club-average is a TOTAL, tee-to-rest, including roll) — use "total" when unlabeled.
- "unknown" only if you genuinely cannot tell.

HONESTY (critical):
- Report ONLY clubs with a distance you can actually read. NEVER pad the list to a "typical" 14-club set. NEVER invent or estimate a number that isn't shown.
- Do NOT include the Putter.
- If a row shows a club but no distance, omit it.
- If the image is not an Arccos distances screen (or has no readable club distances), return an empty clubs array.`;

type FrameIn = { b64?: unknown; media_type?: unknown };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowInference(req, res, 'arccos-import')) return;
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
  }

  // 2026-07-30 (audit #28) — parse defensively; a non-JSON string body threw an UNHANDLED exception → 500.
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
      'Read every club distance in this Arccos screen. Return JSON { distance_kind, clubs: [...] }.',
      images,
      { maxTokens: 1200, temperature: 0.1, forceJSON: true, schema: SCHEMA },
    );
    if (!text) return res.status(502).json({ error: 'Empty model response', provider });

    let parsed: { distance_kind?: unknown; clubs?: unknown } | null = null;
    try {
      const cleaned = text.replace(/```json?|```/g, '').trim();
      const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
      parsed = JSON.parse(s >= 0 && e > s ? cleaned.slice(s, e + 1) : cleaned);
    } catch {
      return res.status(502).json({ error: 'Model returned non-JSON', provider, raw: text.slice(0, 200) });
    }

    const kind = parsed?.distance_kind;
    const distance_kind = kind === 'carry' || kind === 'total' ? kind : 'unknown';

    const validId = new Set<string>(VALID_CLUB_IDS);
    const seen = new Set<string>();
    const clubs = (Array.isArray(parsed?.clubs) ? parsed!.clubs : [])
      .map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const club_id = String(o.club_id ?? '');
        if (!validId.has(club_id) || seen.has(club_id)) return null; // drop invalid + dedupe by id
        const yards = Math.round(Number(o.yards));
        if (!Number.isFinite(yards) || yards <= 0) return null;      // no legible number → drop
        seen.add(club_id);
        const conf = o.confidence;
        return { club_id, yards, confidence: conf === 'high' || conf === 'medium' ? conf : 'low' };
      })
      .filter((c): c is NonNullable<typeof c> => c != null);

    return res.status(200).json({ distance_kind, clubs, provider });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'vision call failed', provider });
  }
}
