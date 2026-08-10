import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors';
import { allowInference } from './_inferLimit';
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

/**
 * 2026-08-10 (Tim — "make sure we're using computer vision correctly, and we're locating the green,
 * the tee box, the fairway, hazards correctly and TIGHTLY. This needs to be an absolutely stunningly
 * elite polished product").
 *
 * What changed and why. This route used to return FOUR POINTS — green center/front/back and a tee.
 * Points can't be tight: a single (x,y) has no extent, so the green's real edge, the tee box's real
 * shape, the fairway corridor and every hazard were simply absent, and anything downstream that
 * wanted an outline had to invent one. Now the model traces OUTLINES, and the hole is described the
 * way a caddie actually reads it: green, tee, fairway corridor, bunkers, water.
 *
 * Tim's own framing is the key to making this reliable: greens, tee boxes and fairways each have
 * very distinctive visual characteristics from above. The prompt below spells those characteristics
 * out explicitly — texture, mowing pattern, edge quality, colour, typical shape, and the decoys each
 * one is confused with — because a model told WHAT TO LOOK FOR localizes far tighter than one merely
 * asked to find a green.
 */
const POLY_OAI = { type: ['array', 'null'], items: POINT_OAI };
const POLY_GEM = { type: 'ARRAY', nullable: true, items: POINT_GEM };
const HAZARD_OAI = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['bunker', 'water'] },
    polygon: { type: 'array', items: POINT_OAI },
    carry_side: { type: 'string', enum: ['left', 'right', 'center', 'unknown'] },
  },
  required: ['kind', 'polygon', 'carry_side'],
  additionalProperties: false,
};
const HAZARD_GEM = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['bunker', 'water'] },
    polygon: { type: 'ARRAY', items: POINT_GEM },
    carry_side: { type: 'STRING', enum: ['left', 'right', 'center', 'unknown'] },
  },
};

const HOLE_GEOMETRY_SCHEMA: StructuredSchema = {
  name: 'hole_geometry',
  openai: {
    type: 'object',
    properties: {
      found_green: { type: 'boolean' },
      green_center: POINT_OAI_NULLABLE,
      green_front: POINT_OAI_NULLABLE, // green edge nearest the tee/player
      green_back: POINT_OAI_NULLABLE, // green edge farthest from the tee/player
      green_polygon: POLY_OAI,        // TIGHT outline of the putting surface
      tee: POINT_OAI_NULLABLE,
      tee_polygon: POLY_OAI,          // TIGHT outline of the teeing ground
      fairway_centerline: POLY_OAI,   // tee → green down the middle of the mown corridor
      hazards: { type: 'array', items: HAZARD_OAI },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      notes: { type: 'string' },
    },
    required: ['found_green', 'green_center', 'green_front', 'green_back', 'green_polygon', 'tee', 'tee_polygon', 'fairway_centerline', 'hazards', 'confidence', 'notes'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      found_green: { type: 'BOOLEAN' },
      green_center: { ...POINT_GEM, nullable: true },
      green_front: { ...POINT_GEM, nullable: true },
      green_back: { ...POINT_GEM, nullable: true },
      green_polygon: POLY_GEM,
      tee: { ...POINT_GEM, nullable: true },
      tee_polygon: POLY_GEM,
      fairway_centerline: POLY_GEM,
      hazards: { type: 'ARRAY', items: HAZARD_GEM },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      notes: { type: 'STRING' },
    },
  },
};

const SYSTEM_PROMPT = `You are a golf-course aerial analyst reading a NORTH-UP satellite photo of one golf hole (or the area around a player on a hole). Coordinates are NORMALIZED: x = 0 at the LEFT edge to 1 at the RIGHT edge; y = 0 at the TOP (north) to 1 at the BOTTOM (south).

Each feature below has a DISTINCTIVE aerial signature. Identify it by that signature, not by where you expect it to be — then trace it TIGHTLY.

PUTTING GREEN — green_polygon, green_center, green_front, green_back
  Signature: the SMOOTHEST, most uniform turf in the frame. Very fine, even texture with no visible mowing stripes (cut far shorter than fairway), usually a slightly paler or yellower green. Oval, kidney or free-form. Look for the COLLAR: a thin ring of slightly darker/rougher grass following its outline — that ring is the most reliable edge cue on the whole hole. Often flanked by bunkers, sometimes a pin/flag dot and its thin shadow.
  Decoys: a light patch of fairway (has mowing stripes — greens do not); a practice putting green near the clubhouse (isolated, no fairway leading to it, often several flags); the apron/approach (coarser texture, continuous with the fairway).
  green_front = the point ON THE OUTLINE nearest the tee/approach. green_back = the point ON THE OUTLINE farthest from it. Both must lie on green_polygon, not inside it.

TEE BOX — tee_polygon, tee
  Signature: small, FLAT, sharply RECTANGULAR mown pad with unnaturally straight edges — the straightest lines on the hole. Usually raised slightly, often several pads in a stepped row along the hole's axis, and a cart path or steps almost always touches one corner.
  Decoys: cart-path junctions and maintenance pads (grey//tan, not turf); a green's flat apron.
  If several tee pads are visible, outline the one FARTHEST from the green (the back tee) and set tee to its centre.

FAIRWAY — fairway_centerline
  Signature: a broad MOWN CORRIDOR running tee → green, with alternating light/dark MOWING STRIPES (the single clearest fairway cue), bounded on both sides by darker, coarser, untextured rough.
  Return 3-6 points down the MIDDLE of that corridor, ordered tee → green, following its curve (a dogleg must bend, not cut the corner).

HAZARDS — hazards[]
  BUNKER: bright white/cream/tan, very high contrast against turf, sharply defined irregular or kidney edge, usually with a thin crescent shadow on one rim. Small and discrete.
  WATER: dark blue / near-black / brown-green, FLAT and textureless, often with a specular glare patch, with a natural irregular shoreline. Ponds, creeks, ditches.
  Decoys: bare dirt/waste ground (dull brown, soft edges, not bright); tree shadows on turf (soft-edged, match a tree's shape, always on the same side as other shadows); cart paths (thin, uniform-width, continuous ribbons).
  carry_side is relative to a player standing on the tee looking at the green.

TIGHTNESS — this is what the whole read is judged on:
- Trace polygons that HUG the feature's visible edge. A loose bounding box is a FAILURE, not an approximation.
- Use 8-14 points for a green, 4-6 for a tee box, 6-12 per hazard — enough to follow real curvature.
- Never let a polygon include the collar, the surrounding rough, the sand's grass lip, or the water's bank.
- Points must be ordered around the perimeter (either direction), never crossing over themselves.

RULES — honesty outranks completeness everywhere:
- If you cannot clearly see a putting green in THIS frame, set found_green=false, all point/polygon fields null, hazards [], confidence "low". Do NOT invent a green on a fairway, a lighter patch, or a practice area — a wrong green is worse than none.
- Return null for any individual feature you cannot see (tee, fairway, or all hazards) even when the green is clear. A partial honest read is correct; a padded one is not.
- Only list hazards you can actually SEE in this frame. Do not add hazards because a hole "should" have them. Return at most 8, nearest the green and the landing area first — those are the ones that change a club choice.
- confidence: "high" only when the green is unmistakable AND its outline is clearly resolvable; "medium" when the green is likely but its edge is soft; "low" when a guess.
- Keep notes to one short sentence (what you saw / why that confidence).
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
  if (!allowInference(req, res, 'hole-scan')) return;
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
    // 2026-08-10 — the tile's real-world span, when the client knows it, is the strongest possible
    // scale cue: it converts "is this blob a green?" into an arithmetic check the model can do.
    // A putting green is ~20-40 yards across; anything 3 yards or 120 yards across is not one.
    const spanYards = Number.isFinite(Number(body.tile_span_yards)) ? Number(body.tile_span_yards) : null;
    const userText =
      `Read this north-up satellite tile of a golf hole` +
      (hole ? ` (hole ${hole}${par ? `, par ${par}` : ''})` : '') +
      `. Locate and TIGHTLY outline the putting green, the tee box, the fairway corridor, and every visible bunker and water hazard.` +
      (spanYards
        ? ` SCALE: this image spans about ${Math.round(spanYards)} yards edge to edge, so 0.01 of normalized width ≈ ${Math.round(spanYards / 100)} yards. A putting green is typically 20-40 yards across (${(25 / spanYards).toFixed(3)}-${(40 / spanYards).toFixed(3)} normalized) and a tee box 8-20 yards — use this to reject anything of the wrong size.`
        : '') +
      ` Return normalized coordinates per your instructions.`;

    const provider = providerFromHeaderSafe(req.headers as Record<string, string | string[] | undefined>);
    const text = await completeVision(
      provider,
      'quality',
      SYSTEM_PROMPT,
      userText,
      [{ b64: image_b64, mimeType: image_media_type }],
      // 2026-08-10 — 500 tokens was sized for FOUR POINTS. This now returns a green outline
      // (8-14 pts), a tee outline, a fairway centerline and up to 8 hazard polygons — well over
      // 2k tokens of coordinates. Leaving the old budget would truncate the JSON mid-array and
      // every read would fail to parse, i.e. the feature would look "broken" rather than "capped".
      // Same failure mode course-ai-search hit when its description outgrew a 400-token budget.
      { maxTokens: 4_000, temperature: 0.1, forceJSON: true, schema: HOLE_GEOMETRY_SCHEMA },
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
    /**
     * 2026-08-10 — polygons are VERIFIED, never trusted. A model asked for a tight outline can
     * still hand back three points, a self-crossing ring, or a lazy full-frame box, and any of
     * those would render as a confidently wrong green. Each outline has to earn its place:
     *   - every vertex a finite point inside the frame;
     *   - enough vertices to describe a shape at all;
     *   - a plausible normalized EXTENT for what it claims to be — this is the check that kills the
     *     "outline = the whole tile" failure, which is the one that looks most convincing.
     * Anything failing is dropped to null rather than downgraded, per the app-wide honesty tenet:
     * a missing feature degrades cleanly, a wrong one silently misleads.
     */
    const poly = (v: unknown, minPts: number, maxExtent: number): { x: number; y: number }[] | null => {
      if (!Array.isArray(v)) return null;
      const pts = v.map(pt).filter((p): p is { x: number; y: number } => p != null);
      if (pts.length < minPts) return null;
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      if (w <= 0 && h <= 0) return null;                 // degenerate: every point identical
      if (w > maxExtent || h > maxExtent) return null;   // loose box masquerading as an outline
      return pts.slice(0, 24);
    };
    /** Centroid of a traced outline — a tighter centre than a separately-guessed point. */
    const centroid = (pts: { x: number; y: number }[] | null): { x: number; y: number } | null => {
      if (!pts || pts.length === 0) return null;
      const n = pts.length;
      return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
    };

    // Extents are generous vs. reality (a green is ~0.04-0.10 of a 1000-yard tile) but tight enough
    // that a full-frame or half-frame "outline" is rejected outright.
    const green_polygon = poly(parsed.green_polygon, 5, 0.45);
    const tee_polygon = poly(parsed.tee_polygon, 3, 0.30);
    const fairway_centerline = poly(parsed.fairway_centerline, 2, 1.0); // spans the hole by design
    const hazards = Array.isArray(parsed.hazards)
      ? (parsed.hazards as unknown[])
          .map((h) => {
            const o = (h ?? {}) as { kind?: unknown; polygon?: unknown; carry_side?: unknown };
            const kind = o.kind === 'water' ? 'water' : o.kind === 'bunker' ? 'bunker' : null;
            // Water can legitimately be large (a lake down one side); a bunker cannot.
            const polygon = kind ? poly(o.polygon, 3, kind === 'water' ? 0.8 : 0.35) : null;
            if (!kind || !polygon) return null;
            const side = o.carry_side;
            return {
              kind,
              polygon,
              carry_side: side === 'left' || side === 'right' || side === 'center' ? side : 'unknown',
            };
          })
          .filter((h): h is { kind: 'bunker' | 'water'; polygon: { x: number; y: number }[]; carry_side: string } => h != null)
          .slice(0, 12)
      : [];

    // Prefer the outline's centroid over the model's separately-stated centre: when we have a traced
    // green, its centroid is by construction consistent with the edge we're about to render.
    const green_center = centroid(green_polygon) ?? pt(parsed.green_center);
    const found_green = parsed.found_green === true && green_center != null;
    const rawConf = parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low';
    // An unverifiable outline caps confidence: "high" claims a resolvable edge, so without one the
    // honest ceiling is medium. Keeps the client's AI-ESTIMATE badging proportional to what we know.
    const confidence = !found_green ? 'low' : green_polygon ? rawConf : rawConf === 'high' ? 'medium' : rawConf;

    return res.status(200).json({
      found_green,
      green_center,
      green_front: pt(parsed.green_front),
      green_back: pt(parsed.green_back),
      green_polygon,
      tee: centroid(tee_polygon) ?? pt(parsed.tee),
      tee_polygon,
      fairway_centerline,
      hazards,
      confidence,
      notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 200) : '',
      provider,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[hole-scan] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
