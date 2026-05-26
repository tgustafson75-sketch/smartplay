import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/**
 * 2026-05-26 — Fix AA: Round screenshot import.
 *
 * Tim's roadmap item: the player takes a screenshot of an old round
 * (Golfshot, 18Birdies, GHIN, scorecard photo, USGA app, etc.) and
 * imports it into SmartPlay's roundHistory so the player's
 * statistics + handicap calc include past data the player has
 * accumulated on other platforms.
 *
 * Provider chain: Gemini 2.5 Flash → OpenAI gpt-4o → Anthropic Sonnet.
 * Same resilience pattern as /api/swing-analysis (Batch 23-24).
 * Gemini-first because scorecard OCR (mixed layout, varying labels,
 * occasional handwriting) is exactly the task Gemini's vision excels
 * at and is cheapest for.
 *
 * Output shape — defensive: every field nullable, parser drops bad
 * holes. Caller's confirmation UI is the truth-gate.
 */

const gemini = process.env.GOOGLE_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  : null;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 });

const SYSTEM_PROMPT = `You are reading a screenshot of a golf round scorecard. The image may come from any source: Golfshot, 18Birdies, GHIN, USGA Tournament Center, the player's own paper scorecard photographed in good light, a screenshot of a scorecard email, etc.

Your job: extract the structured round data into the SCHEMA below. Be CONSERVATIVE — only return values you can actually read from the image. Skip anything you can't read with confidence. The user will confirm the parse before it's saved, so false-negatives are recoverable; false-positives ("you played 7" when the photo is unreadable) are not.

SCHEMA — output ONLY this JSON, no preamble, no code fences:

{
  "course_name": "<full course name as it appears on the card, or null if not visible>",
  "played_date": "<YYYY-MM-DD if a date appears on the card, else null>",
  "tee_color": "<one of: black, blue, white, gold, red, green, gray, championship, unknown>",
  "holes_played": <number 9 or 18 if you can confirm; else null>,
  "total_score": <integer total strokes if visible, else null>,
  "total_par": <integer total par if visible, else null>,
  "score_vs_par": <integer over/under par, e.g. -2 / 4 / 0 — if visible OR derivable from total_score + total_par; else null>,
  "holes": [
    {
      "hole": <1-18>,
      "par": <3 | 4 | 5 if visible, else null>,
      "score": <strokes for the hole if visible, else null>,
      "putts": <putt count if visible, else null>,
      "fairway_hit": <true | false | null — only set when the card clearly shows fairway hit/miss, else null>,
      "gir": <true | false | null — only set when the card clearly shows green-in-regulation, else null>
    }
  ],
  "notes": "<short observation about anything else visible — '9-hole front nine only', 'tournament round', 'GHIN posted score' etc. Null if nothing notable.>",
  "confidence": "<one of: high, medium, low>",
  "warnings": [
    "<short string per issue you noticed: 'putts column blurry on holes 7-9', 'date partially obscured', etc. Empty array if no issues.>"
  ]
}

Rules:
- holes[] should have entries for every hole you can read. If only the back 9 is visible, return just those 9 entries (don't synthesize the front).
- Each hole entry's hole number MUST be the actual hole number on the card (1-18), not the array index.
- When score is null for a hole the player clearly didn't play (e.g. only 9 holes shown), DON'T fabricate it.
- When total_score is null but you have all 18 hole scores, leave it null — the parser will compute it. Same for total_par and score_vs_par.
- tee_color: pick from the allowlist; "unknown" when not visible.
- confidence reflects YOUR overall read quality: high = card is clean and you got every field; medium = main fields confident, a few holes/columns iffy; low = OCR was a struggle, expect errors.
- warnings[] surfaces ANY column or field you weren't 100% sure on. The user UI shows these so they know what to double-check.
- If the image is NOT a golf scorecard at all (screenshot of something else, glamour shot of the course, blank photo), return: { "course_name": null, "holes": [], "confidence": "low", "warnings": ["This doesn't look like a scorecard."], ... all other fields null }
- Output ONLY valid JSON. No code fences. No preamble.`;

interface ImportedRound {
  course_name: string | null;
  played_date: string | null;
  tee_color: string | null;
  holes_played: number | null;
  total_score: number | null;
  total_par: number | null;
  score_vs_par: number | null;
  holes: {
    hole: number;
    par: number | null;
    score: number | null;
    putts: number | null;
    fairway_hit: boolean | null;
    gir: boolean | null;
  }[];
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

function safeParse(text: string): ImportedRound | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
    return JSON.parse(cleaned) as ImportedRound;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const imageB64 = typeof body.image_b64 === 'string' ? body.image_b64 : '';
    const imageMediaType = (typeof body.image_media_type === 'string' ? body.image_media_type : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    if (!imageB64) {
      return res.status(400).json({ error: 'image_b64 required' });
    }
    if (imageB64.length > 9_000_000) {
      return res.status(413).json({ error: 'image too large; resize to ~1280px on long edge' });
    }

    const userText = 'Extract the structured round data from this scorecard screenshot. Return JSON per the schema in your instructions.';

    let raw = '';
    let providerUsed: 'gemini' | 'openai' | 'anthropic' = 'gemini';
    let geminiError: string | null = null;
    let openaiError: string | null = null;
    let anthropicError: string | null = null;

    if (gemini) {
      try {
        const gem = await gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{
            role: 'user',
            parts: [
              { text: SYSTEM_PROMPT + '\n\n' + userText },
              { inlineData: { mimeType: imageMediaType, data: imageB64 } },
            ],
          }],
          config: {
            temperature: 0.1,
            maxOutputTokens: 1200,
            responseMimeType: 'application/json',
          },
        });
        raw = (gem.text ?? '').trim();
        if (!raw) geminiError = 'empty_response';
      } catch (e) {
        geminiError = e instanceof Error ? e.message : 'unknown';
        console.warn('[round-import] gemini primary failed:', geminiError);
      }
    } else {
      geminiError = 'GOOGLE_API_KEY not configured';
    }

    if (!raw && process.env.OPENAI_API_KEY) {
      try {
        const oai = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 1500,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${imageMediaType};base64,${imageB64}`, detail: 'high' } },
                { type: 'text', text: userText },
              ],
            },
          ],
        });
        raw = (oai.choices[0]?.message?.content ?? '').trim();
        providerUsed = 'openai';
        if (!raw) openaiError = 'empty_response';
      } catch (e) {
        openaiError = e instanceof Error ? e.message : 'unknown';
        console.warn('[round-import] openai fallback failed:', openaiError);
      }
    }

    if (!raw && process.env.ANTHROPIC_API_KEY) {
      try {
        const completion = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          temperature: 0.1,
          system: SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: imageMediaType, data: imageB64 },
              },
              { type: 'text', text: userText },
            ],
          }],
        });
        const block = completion.content.find(c => c.type === 'text');
        raw = block && block.type === 'text' ? block.text.trim() : '';
        providerUsed = 'anthropic';
        if (!raw) anthropicError = 'empty_response';
      } catch (e) {
        anthropicError = e instanceof Error ? e.message : 'unknown';
        console.error('[round-import] anthropic last-resort failed:', anthropicError);
      }
    }

    if (!raw) {
      return res.status(502).json({
        error: 'All providers failed',
        gemini_error: geminiError,
        openai_error: openaiError,
        anthropic_error: anthropicError,
      });
    }

    const parsed = safeParse(raw);
    if (!parsed) {
      return res.status(502).json({
        error: 'Model returned non-JSON',
        provider: providerUsed,
        raw: raw.slice(0, 400),
      });
    }

    // Normalize: drop hole entries with non-integer hole numbers or
    // outside 1-18; coerce scores/putts to integers or null.
    const cleanedHoles = (parsed.holes ?? [])
      .filter(h => Number.isInteger(h?.hole) && h.hole >= 1 && h.hole <= 18)
      .map(h => ({
        hole: h.hole,
        par: Number.isInteger(h.par) && h.par! >= 3 && h.par! <= 6 ? h.par : null,
        score: Number.isInteger(h.score) && h.score! >= 1 && h.score! <= 15 ? h.score : null,
        putts: Number.isInteger(h.putts) && h.putts! >= 0 && h.putts! <= 10 ? h.putts : null,
        fairway_hit: typeof h.fairway_hit === 'boolean' ? h.fairway_hit : null,
        gir: typeof h.gir === 'boolean' ? h.gir : null,
      }));

    // Derive totals when the model left them null but we have all scores.
    let totalScore = parsed.total_score;
    let totalPar = parsed.total_par;
    let scoreVsPar = parsed.score_vs_par;
    const allScored = cleanedHoles.length >= 9 && cleanedHoles.every(h => h.score != null);
    const allParred = cleanedHoles.length >= 9 && cleanedHoles.every(h => h.par != null);
    if (totalScore == null && allScored) {
      totalScore = cleanedHoles.reduce((acc, h) => acc + (h.score ?? 0), 0);
    }
    if (totalPar == null && allParred) {
      totalPar = cleanedHoles.reduce((acc, h) => acc + (h.par ?? 0), 0);
    }
    if (scoreVsPar == null && totalScore != null && totalPar != null) {
      scoreVsPar = totalScore - totalPar;
    }

    return res.status(200).json({
      ...parsed,
      holes: cleanedHoles,
      total_score: totalScore,
      total_par: totalPar,
      score_vs_par: scoreVsPar,
      _debug: {
        provider: providerUsed,
        fallback_reason: providerUsed === 'gemini' ? null : { gemini: geminiError, openai: providerUsed === 'anthropic' ? openaiError : null },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[round-import] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
