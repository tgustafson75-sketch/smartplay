import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeVision, type StructuredSchema } from './_aiProvider';

/**
 * 2026-07-01 (Tim — "load a course not in the DB from a scorecard photo"). Parses a scorecard
 * screenshot into a COURSE definition: par + yardage (+ stroke index) per hole for a chosen tee,
 * so a course that isn't in golfcourseapi can be added and played. Distinct from /api/round-import
 * (which reads SCORES). Gemini-first vision, OpenAI fallback — same chain as round-import.
 */

const SYSTEM_PROMPT = `You are reading a golf scorecard image to extract the COURSE LAYOUT (not scores). A scorecard lists holes 1-18 (or 1-9) with a PAR row and one or more TEE rows giving the YARDAGE per hole (e.g. BLACK / BLUE / WHITE / GOLD / RED). There is usually a HANDICAP / stroke-index row too.

Your job: extract the course NAME, the tee you are reading, and per-hole PAR + YARDAGE + HANDICAP. Be CONSERVATIVE — only return values you can actually read. The user confirms before saving, so skip anything unreadable (null) rather than guess.

Rules:
- Pick ONE tee to read yardages from. Prefer WHITE (or the middle / regular tee) when several are visible; report which tee in "tee_name".
- "hole" is 1-18. "par" is 3/4/5 (occasionally 6). "yardage" is the hole distance in yards for the chosen tee. "handicap" is the stroke index 1-18 if present.
- Do NOT invent holes. If only 9 holes are visible, return 9.
- Ignore the score columns entirely — this is about the course, not a played round.

Output ONLY this JSON, no preamble, no code fences:
{
  "course_name": "<name on the card or null>",
  "tee_name": "<the tee you read, e.g. White, or null>",
  "location": "<city/state if visible, else null>",
  "holes": [ { "hole": 1, "par": 4, "yardage": 410, "handicap": 5 } ],
  "confidence": "high|medium|low",
  "warnings": ["..."]
}`;

const SCHEMA: StructuredSchema = {
  name: 'imported_course',
  openai: {
    type: 'object',
    properties: {
      course_name: { type: ['string', 'null'] },
      tee_name: { type: ['string', 'null'] },
      location: { type: ['string', 'null'] },
      holes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            hole: { type: 'integer' },
            par: { type: ['integer', 'null'] },
            yardage: { type: ['integer', 'null'] },
            handicap: { type: ['integer', 'null'] },
          },
          required: ['hole', 'par', 'yardage', 'handicap'],
          additionalProperties: false,
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['course_name', 'tee_name', 'location', 'holes', 'confidence', 'warnings'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      course_name: { type: 'STRING', nullable: true },
      tee_name: { type: 'STRING', nullable: true },
      location: { type: 'STRING', nullable: true },
      holes: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            hole: { type: 'INTEGER' },
            par: { type: 'INTEGER', nullable: true },
            yardage: { type: 'INTEGER', nullable: true },
            handicap: { type: 'INTEGER', nullable: true },
          },
          required: ['hole', 'par', 'yardage', 'handicap'],
        },
      },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      warnings: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['course_name', 'tee_name', 'location', 'holes', 'confidence', 'warnings'],
  },
};

function toIntOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

function extractJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { /* try to strip fences */ }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; } }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const imageB64 = typeof body.image_b64 === 'string' ? body.image_b64 : '';
    const imageMediaType = (typeof body.image_media_type === 'string' ? body.image_media_type : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    if (!imageB64) return res.status(400).json({ error: 'image_b64 required' });
    if (imageB64.length > 9_000_000) return res.status(413).json({ error: 'image too large; resize to ~1280px on long edge' });

    const userText = 'Extract the COURSE LAYOUT (par + yardage + handicap per hole) from this scorecard. Return JSON per the schema in your instructions.';
    const visionOpts = { maxTokens: 2000, temperature: 0.1, forceJSON: true, schema: SCHEMA };
    const images = [{ b64: imageB64, mimeType: imageMediaType }];

    let raw = '';
    let providerUsed: 'gemini' | 'openai' = 'gemini';
    let geminiError: string | null = null;
    let openaiError: string | null = null;
    if (process.env.GOOGLE_API_KEY) {
      try { raw = await completeVision('gemini', 'quality', SYSTEM_PROMPT, userText, images, visionOpts); if (!raw) geminiError = 'empty_response'; }
      catch (e) { geminiError = e instanceof Error ? e.message : 'unknown'; raw = ''; }
    } else geminiError = 'GOOGLE_API_KEY not configured';
    if (!raw && process.env.OPENAI_API_KEY) {
      try { raw = await completeVision('openai', 'quality', SYSTEM_PROMPT, userText, images, visionOpts); providerUsed = 'openai'; if (!raw) openaiError = 'empty_response'; }
      catch (e) { openaiError = e instanceof Error ? e.message : 'unknown'; raw = ''; }
    }
    if (!raw) return res.status(502).json({ error: 'All providers failed', gemini_error: geminiError, openai_error: openaiError });

    const parsed = extractJson(raw);
    if (!parsed) return res.status(502).json({ error: 'Model returned non-JSON', provider: providerUsed, raw: raw.slice(0, 400) });

    const holesRaw = Array.isArray(parsed.holes) ? (parsed.holes as Record<string, unknown>[]) : [];
    const holes = holesRaw
      .map((h) => {
        const hole = toIntOrNull(h.hole);
        const par = toIntOrNull(h.par);
        const yardage = toIntOrNull(h.yardage);
        const handicap = toIntOrNull(h.handicap);
        return {
          hole,
          par: par != null && par >= 3 && par <= 6 ? par : null,
          yardage: yardage != null && yardage >= 30 && yardage <= 700 ? yardage : null,
          handicap: handicap != null && handicap >= 1 && handicap <= 18 ? handicap : null,
        };
      })
      .filter((h) => h.hole != null && h.hole >= 1 && h.hole <= 18);

    return res.status(200).json({
      course_name: typeof parsed.course_name === 'string' ? parsed.course_name : null,
      tee_name: typeof parsed.tee_name === 'string' ? parsed.tee_name : null,
      location: typeof parsed.location === 'string' ? parsed.location : null,
      holes,
      confidence: (parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low') ? parsed.confidence : 'low',
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      _debug: { provider: providerUsed },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
