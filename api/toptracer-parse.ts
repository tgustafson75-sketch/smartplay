/**
 * TopTracer range session parser.
 *
 * Reads a screenshot of a TopTracer Range screen — either the side-view
 * with the per-club data table (Flat Carry / Total / R.Speed / Launch /
 * Height / Hang Time / Landing / Curve) or the overhead radar scatter view
 * (concentric distance rings + per-club landing dots).
 *
 * Returns structured per-club stats that the client merges into clubStatsStore
 * as manual carry entries, calibrating Kevin's distance recommendations to
 * the player's real Toptracer numbers.
 *
 * Provider: Gemini 2.5 Flash primary → OpenAI gpt-4o fallback.
 * Same resilience pattern as /api/round-import.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeVision, providerFromHeader, type StructuredSchema } from './_aiProvider';

const SYSTEM_PROMPT = `You are reading a screenshot from TopTracer Range — a ball-tracking system used at golf driving ranges. The image will be one of two views:

VIEW TYPE A — Side view with data table:
The bottom of the screen shows a multi-column table with rows for each club. Common columns:
  FLAT CARRY (yds), TOTAL (yds), R.SPEED (mph) or BALL SPEED, LAUNCH (deg),
  HEIGHT (ft), HANG TIME (sec), LANDING (deg), CURVE (yds + = left, - = right).
There may also be a CONSISTENCY % visible (like "CONSISTENCY 75%").

VIEW TYPE B — Overhead radar scatter view:
Shows concentric distance rings (e.g. 150, 180, 210, 240 yds) with colored dots showing where shots landed. A CONSISTENCY % is usually visible. Club color legend may or may not be shown.

Your job: extract every readable per-club data row.

CLUB NAME MAPPING — translate TopTracer display names to these EXACT SmartPlay club IDs (output only these strings in the club_id field):
  "Driver" (for DRIVER, DR, 1W)
  "3W" (for 3-WOOD, 3W, 3 WOOD)
  "5W" (for 5-WOOD, 5W, 5 WOOD)
  "7W" (for 7-WOOD, 7W)
  "2H" (for 2-HYBRID, 2H, 2-HYB)
  "3H" (for 3-HYBRID, 3H)
  "4H" (for 4-HYBRID, 4H)
  "5H" (for 5-HYBRID, 5H)
  "3I" (for 3-IRON, 3I)
  "4I" (for 4-IRON, 4I)
  "5I" (for 5-IRON, 5I)
  "6I" (for 6-IRON, 6I)
  "7I" (for 7-IRON, 7I)
  "8I" (for 8-IRON, 8I)
  "9I" (for 9-IRON, 9I)
  "PW" (for PW, PITCHING WEDGE, PITCHING)
  "GW" (for GW, AW, GAP WEDGE, APPROACH WEDGE)
  "SW" (for SW, SAND WEDGE)
  "LW" (for LW, LOB WEDGE)
  "Putter" (for PT, PUTTER)

Rules:
- Only return clubs you can actually read from the image. Don't fabricate data.
- The highlighted/bold row (the currently selected club) is still a valid row — include it.
- For radar view (VIEW TYPE B): clubs[] will usually be empty or have consistency_pct only — extract what you can from the legend if visible.
- If the image is NOT a TopTracer screen, return: { "view_type": "unknown", "clubs": [], "confidence": "low", "warnings": ["This doesn't look like a TopTracer screenshot."] }`;

const TOPTRACER_SCHEMA: StructuredSchema = {
  name: 'toptracer_parse',
  openai: {
    type: 'object',
    properties: {
      view_type: { type: 'string', enum: ['table', 'radar', 'unknown'] },
      consistency_pct: { type: ['integer', 'null'] },
      clubs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            display_name: { type: 'string' },
            club_id: { type: 'string' },
            flat_carry_yds: { type: ['number', 'null'] },
            total_yds: { type: ['number', 'null'] },
            ball_speed_mph: { type: ['number', 'null'] },
            launch_deg: { type: ['number', 'null'] },
            height_ft: { type: ['number', 'null'] },
            hang_time_sec: { type: ['number', 'null'] },
            landing_deg: { type: ['number', 'null'] },
            curve_yds: { type: ['number', 'null'] },
          },
          required: [
            'display_name', 'club_id',
            'flat_carry_yds', 'total_yds', 'ball_speed_mph', 'launch_deg',
            'height_ft', 'hang_time_sec', 'landing_deg', 'curve_yds',
          ],
          additionalProperties: false,
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['view_type', 'consistency_pct', 'clubs', 'confidence', 'warnings'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      view_type: { type: 'STRING', enum: ['table', 'radar', 'unknown'] },
      consistency_pct: { type: 'INTEGER', nullable: true },
      clubs: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            display_name: { type: 'STRING' },
            club_id: { type: 'STRING' },
            flat_carry_yds: { type: 'NUMBER', nullable: true },
            total_yds: { type: 'NUMBER', nullable: true },
            ball_speed_mph: { type: 'NUMBER', nullable: true },
            launch_deg: { type: 'NUMBER', nullable: true },
            height_ft: { type: 'NUMBER', nullable: true },
            hang_time_sec: { type: 'NUMBER', nullable: true },
            landing_deg: { type: 'NUMBER', nullable: true },
            curve_yds: { type: 'NUMBER', nullable: true },
          },
          required: [
            'display_name', 'club_id',
            'flat_carry_yds', 'total_yds', 'ball_speed_mph', 'launch_deg',
            'height_ft', 'hang_time_sec', 'landing_deg', 'curve_yds',
          ],
        },
      },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      warnings: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['view_type', 'consistency_pct', 'clubs', 'confidence', 'warnings'],
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
  }

  const body = (req.body ?? {}) as { image_b64?: string; media_type?: string };
  if (!body.image_b64) return res.status(400).json({ error: 'image_b64 required' });
  if (body.image_b64.length > 9_000_000) {
    return res.status(413).json({ error: 'Image too large; resize to ~1024px on long edge' });
  }

  const mimeType = (body.media_type ?? 'image/jpeg') as string;
  const userText = 'Extract all TopTracer club data from this screenshot.';

  // Primary: Gemini. Fallback: OpenAI (via X-AI-Provider header or explicit fallback).
  const requestedProvider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);
  const primaryProvider = process.env.GOOGLE_API_KEY ? 'gemini' : requestedProvider;

  let raw = '';
  let provider = primaryProvider;
  let geminiErr: string | null = null;

  try {
    raw = await completeVision(
      primaryProvider,
      'quality',
      SYSTEM_PROMPT,
      userText,
      [{ b64: body.image_b64, mimeType }],
      { maxTokens: 800, temperature: 0.1, timeoutMs: 20_000, schema: TOPTRACER_SCHEMA },
    );
  } catch (e) {
    geminiErr = e instanceof Error ? e.message : 'unknown';
    console.warn(`[toptracer-parse] ${primaryProvider} failed:`, geminiErr);
  }

  // Fallback to OpenAI if primary failed and it wasn't already OpenAI.
  if (!raw && primaryProvider !== 'openai' && process.env.OPENAI_API_KEY) {
    try {
      raw = await completeVision(
        'openai',
        'quality',
        SYSTEM_PROMPT,
        userText,
        [{ b64: body.image_b64, mimeType }],
        { maxTokens: 800, temperature: 0.1, schema: TOPTRACER_SCHEMA },
      );
      provider = 'openai';
    } catch (e) {
      console.warn('[toptracer-parse] openai fallback failed:', e instanceof Error ? e.message : e);
    }
  }

  if (!raw) {
    return res.status(502).json({ error: 'All providers failed', gemini_error: geminiErr });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return res.status(502).json({ error: 'Model returned non-JSON', provider, raw: raw.slice(0, 300) });
  }

  return res.status(200).json({ ...parsed, _debug: { provider, gemini_error: geminiErr } });
}
