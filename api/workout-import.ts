import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeVision, type StructuredSchema } from './_aiProvider';

/**
 * 2026-07-07 (Tim — SmartPump third rail).
 *
 * SmartPump exports a date-stamped document (PDF or image) of the player's GOLF
 * workouts. The client can't parse a PDF on-device (no PDF text library, and
 * expo-print is generate-only), so it ships the file's base64 here and we AI-parse
 * it into structured, dated workout records — the same resilient pattern as
 * /api/round-import (Gemini 2.5 Flash → OpenAI gpt-4o).
 *
 * Format-agnostic BY DESIGN: an AI read handles whatever layout SmartPump emits
 * (table, list, per-day cards) without us hard-coding a schema for one export shape.
 *
 * Gemini accepts a PDF directly (inlineData mimeType application/pdf); OpenAI vision
 * does not, so for a PDF we only try Gemini. An IMAGE export can use both.
 *
 *   POST /api/workout-import  { file_b64, file_media_type }  → { workouts, confidence, warnings }
 *
 * The client confirms/dedupes before persisting, so false-negatives are recoverable;
 * the prompt is told to be conservative (never fabricate a date or a workout).
 */

const SYSTEM_PROMPT = `You are reading a document that a golfer exported from a workout-tracking app called SmartPump. It lists their GOLF-specific workouts / exercise sessions, each stamped with a DATE. The layout could be anything: a table, a bulleted list, per-day cards, or a summary page.

Your job: extract EVERY dated workout you can read into the SCHEMA below. Be CONSERVATIVE and literal — read what's on the page, never invent a date or a session. The user confirms before anything is saved, so a missed workout is recoverable; a fabricated one is not.

SCHEMA — output ONLY this JSON, no preamble, no code fences:

{
  "workouts": [
    {
      "date": "<YYYY-MM-DD — the date this workout was performed, exactly as dated on the page. REQUIRED; skip any entry you can't date.>",
      "title": "<short name of the session, e.g. 'Golf Strength - Lower Body', 'Mobility', 'Speed Training'. If none is given, use a sensible label from the exercises.>",
      "duration_min": <integer minutes if stated, else null>,
      "focus": "<one short word/phrase for the emphasis if discernible: 'power', 'strength', 'mobility', 'core', 'speed', 'recovery', else null>",
      "intensity": "<one of: light, moderate, hard — only if the page indicates effort/RPE, else null>",
      "exercises": ["<named exercise>", "..."]
    }
  ],
  "confidence": "<one of: high, medium, low>",
  "warnings": ["<short string per issue, e.g. 'two entries share a date', 'durations not listed'. Empty array if none.>"
}

Rules:
- Every workout MUST have a readable date. If you cannot determine the date for an entry, DROP it (do not guess).
- date must be YYYY-MM-DD. If the year is not on the page but is obvious from context, use it; otherwise drop the entry.
- Do NOT fabricate durations, intensities, or exercises — use null / [] when not shown.
- confidence reflects YOUR overall read quality: high = clean page, every field read; medium = dates solid, some detail iffy; low = the parse was a struggle.
- If the document is NOT a workout export at all (something else entirely), return: { "workouts": [], "confidence": "low", "warnings": ["This doesn't look like a SmartPump workout export."] }
- Output ONLY valid JSON. No code fences. No preamble.`;

const WORKOUT_PROPS = {
  workouts: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        title: { type: 'string' },
        duration_min: { type: ['integer', 'null'] },
        focus: { type: ['string', 'null'] },
        intensity: { type: ['string', 'null'] },
        exercises: { type: 'array', items: { type: 'string' } },
      },
      required: ['date', 'title', 'duration_min', 'focus', 'intensity', 'exercises'],
      additionalProperties: false,
    },
  },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  warnings: { type: 'array', items: { type: 'string' } },
};

const WORKOUT_SCHEMA: StructuredSchema = {
  name: 'workout_import',
  openai: {
    type: 'object',
    properties: WORKOUT_PROPS,
    required: ['workouts', 'confidence', 'warnings'],
    additionalProperties: false,
  },
  gemini: {
    type: 'object',
    properties: {
      workouts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            title: { type: 'string' },
            duration_min: { type: 'integer', nullable: true },
            focus: { type: 'string', nullable: true },
            intensity: { type: 'string', nullable: true },
            exercises: { type: 'array', items: { type: 'string' } },
          },
          required: ['date', 'title'],
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['workouts', 'confidence', 'warnings'],
  },
};

type ParsedWorkout = {
  date?: unknown;
  title?: unknown;
  duration_min?: unknown;
  focus?: unknown;
  intensity?: unknown;
  exercises?: unknown;
};

function safeParse(raw: string): { workouts?: ParsedWorkout[]; confidence?: string; warnings?: string[] } | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : raw);
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
    const fileB64 = typeof body.file_b64 === 'string' ? body.file_b64 : '';
    const mediaType = (typeof body.file_media_type === 'string' ? body.file_media_type : 'application/pdf');

    if (!fileB64) return res.status(400).json({ error: 'file_b64 required' });
    if (fileB64.length > 12_000_000) {
      return res.status(413).json({ error: 'file too large; export a shorter date range or a smaller file' });
    }

    const isPdf = /pdf/i.test(mediaType);
    const images = [{ b64: fileB64, mimeType: mediaType }];
    const userText = 'Extract every dated golf workout from this SmartPump export. Return JSON per the schema in your instructions.';
    const visionOpts = { maxTokens: 4000, temperature: 0.1, forceJSON: true, schema: WORKOUT_SCHEMA };

    let raw = '';
    let providerUsed: 'gemini' | 'openai' = 'gemini';
    let geminiError: string | null = null;
    let openaiError: string | null = null;

    if (process.env.GOOGLE_API_KEY) {
      try {
        raw = await completeVision('gemini', 'quality', SYSTEM_PROMPT, userText, images, visionOpts);
        if (!raw) geminiError = 'empty_response';
      } catch (e) {
        geminiError = e instanceof Error ? e.message : 'unknown';
        console.warn('[workout-import] gemini primary failed:', geminiError);
        raw = '';
      }
    } else {
      geminiError = 'GOOGLE_API_KEY not configured';
    }

    // OpenAI vision can't read a PDF — only fall back for image exports.
    if (!raw && !isPdf && process.env.OPENAI_API_KEY) {
      try {
        raw = await completeVision('openai', 'quality', SYSTEM_PROMPT, userText, images, visionOpts);
        providerUsed = 'openai';
        if (!raw) openaiError = 'empty_response';
      } catch (e) {
        openaiError = e instanceof Error ? e.message : 'unknown';
        console.warn('[workout-import] openai fallback failed:', openaiError);
        raw = '';
      }
    }

    if (!raw) {
      return res.status(502).json({
        error: isPdf ? 'Could not read the PDF. Try exporting as an image, or a JSON/CSV export.' : 'All providers failed',
        gemini_error: geminiError,
        openai_error: openaiError,
      });
    }

    const parsed = safeParse(raw);
    if (!parsed) {
      return res.status(502).json({ error: 'Model returned non-JSON', provider: providerUsed, raw: raw.slice(0, 400) });
    }

    // Normalize: keep only entries with a parseable YYYY-MM-DD date; coerce the rest.
    const cleaned = (parsed.workouts ?? [])
      .map((w) => {
        const dateStr = typeof w.date === 'string' ? w.date.trim() : '';
        const ms = /^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr) ? new Date(`${dateStr}T00:00:00`).getTime() : NaN;
        if (!Number.isFinite(ms)) return null;
        const durN = typeof w.duration_min === 'number' && Number.isFinite(w.duration_min) ? Math.round(w.duration_min) : null;
        const intensity = w.intensity === 'light' || w.intensity === 'moderate' || w.intensity === 'hard' ? w.intensity : null;
        return {
          date_ms: ms,
          date: dateStr,
          title: typeof w.title === 'string' && w.title.trim() ? w.title.trim().slice(0, 120) : 'Workout',
          duration_min: durN != null && durN > 0 && durN <= 600 ? durN : null,
          focus: typeof w.focus === 'string' && w.focus.trim() ? w.focus.trim().slice(0, 40) : null,
          intensity,
          exercises: Array.isArray(w.exercises) ? w.exercises.filter((e): e is string => typeof e === 'string').map((e) => e.trim()).filter(Boolean).slice(0, 20) : [],
        };
      })
      .filter((w): w is NonNullable<typeof w> => w != null);

    return res.status(200).json({
      workouts: cleaned,
      confidence: parsed.confidence ?? 'low',
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 8) : [],
      _debug: { provider: providerUsed },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return res.status(500).json({ error: msg });
  }
}
