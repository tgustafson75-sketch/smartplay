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
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

const gemini = process.env.GOOGLE_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  : null;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

function geminiWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms),
    ),
  ]);
}

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

Output ONLY this JSON — no preamble, no code fences:

{
  "view_type": "table" | "radar" | "unknown",
  "consistency_pct": <integer 0-100 if visible, else null>,
  "clubs": [
    {
      "display_name": "<exactly as shown on screen, e.g. '9-IRON'>",
      "club_id": "<SmartPlay ID from mapping above, or null if no match>",
      "flat_carry_yds": <integer if readable, else null>,
      "total_yds": <integer if readable, else null>,
      "ball_speed_mph": <number if readable, else null>,
      "launch_deg": <number if readable, else null>,
      "height_ft": <integer if readable, else null>,
      "hang_time_sec": <number if readable, else null>,
      "landing_deg": <number if readable, else null>,
      "curve_yds": <number — positive=left, negative=right — if readable, else null>
    }
  ],
  "confidence": "high" | "medium" | "low",
  "warnings": ["<short string for each column or row you were uncertain about>"]
}

Rules:
- Only return clubs you can actually read from the image. Don't fabricate data.
- The highlighted/bold row (the currently selected club) is still a valid row — include it.
- For radar view (VIEW TYPE B): clubs[] will usually be empty or have consistency_pct only — extract what you can from the legend if visible.
- If the image is NOT a TopTracer screen, return: { "view_type": "unknown", "clubs": [], "confidence": "low", "warnings": ["This doesn't look like a TopTracer screenshot."] }
- Output ONLY valid JSON.`;

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

  const mimeType = (body.media_type ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';
  const userText = 'Extract all TopTracer club data from this screenshot. Return JSON only.';

  let raw = '';
  let provider: 'gemini' | 'openai' = 'gemini';
  let geminiErr: string | null = null;

  if (gemini) {
    try {
      const gem = await geminiWithTimeout(gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          role: 'user',
          parts: [
            { text: SYSTEM_PROMPT + '\n\n' + userText },
            { inlineData: { mimeType, data: body.image_b64 } },
          ],
        }],
        config: { temperature: 0.1, maxOutputTokens: 800, responseMimeType: 'application/json' },
      }), 20_000);
      raw = (gem.text ?? '').trim();
      if (!raw) geminiErr = 'empty_response';
    } catch (e) {
      geminiErr = e instanceof Error ? e.message : 'unknown';
      console.warn('[toptracer-parse] gemini failed:', geminiErr);
    }
  } else {
    geminiErr = 'GOOGLE_API_KEY not set';
  }

  if (!raw && process.env.OPENAI_API_KEY) {
    try {
      const oai = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 800,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${body.image_b64}`, detail: 'high' } },
              { type: 'text', text: userText },
            ],
          },
        ],
      });
      raw = (oai.choices[0]?.message?.content ?? '').trim();
      provider = 'openai';
    } catch (e) {
      console.warn('[toptracer-parse] openai failed:', e instanceof Error ? e.message : e);
    }
  }

  if (!raw) {
    return res.status(502).json({ error: 'All providers failed', gemini_error: geminiErr });
  }

  let parsed: Record<string, unknown>;
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('no JSON object');
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return res.status(502).json({ error: 'Model returned non-JSON', provider, raw: raw.slice(0, 300) });
  }

  return res.status(200).json({ ...parsed, _debug: { provider, gemini_error: geminiErr } });
}
