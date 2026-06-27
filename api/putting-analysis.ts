/**
 * 2026-05-22 — Vercel handler: PuttingLab analysis.
 *
 * Phase 5 (2026-06-22) — Migrated off Anthropic. Provider chain:
 * Gemini 2.5 Flash (primary) → OpenAI gpt-4o (fallback).
 *
 * Receives frames + spoken read + course context + optional distance,
 * runs vision analysis tuned for PUTTING cues, and returns the
 * structured PuttingAnalysis JSON the client's normalize() expects.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, type Schema } from '@google/genai';
import OpenAI from 'openai';
import { getCaddieName } from '../lib/persona';

// ── Structured output contract ────────────────────────────────────────────────

export interface PuttingAnalysis {
  puttId: string;
  timestamp: string;
  holeNumber?: number;
  distanceFeet: number;
  greenSlope: {
    direction: 'left-to-right' | 'right-to-left' | 'uphill' | 'downhill' | 'flat';
    severity: 'mild' | 'moderate' | 'steep';
    breakInches: number;
    confidence: number;
  };
  setup: {
    alignment: 'open' | 'closed' | 'square';
    ballPosition: 'forward' | 'center' | 'back';
    stanceWidth: 'narrow' | 'normal' | 'wide';
    gripPressure: 'light' | 'medium' | 'firm';
    quality: number;
  };
  stroke: {
    path: 'inside-out' | 'outside-in' | 'straight';
    tempo: 'slow' | 'normal' | 'fast';
    faceAngleAtImpact: 'open' | 'closed' | 'square';
    deceleration: boolean;
    quality: number;
  };
  readAccuracy: {
    wasCorrect: boolean;
    suggestedAdjustment: string;
    confidence: number;
  };
  recommendation: {
    line: string;
    speedFeel: string;
    mentalCue: string;
    technicalCue: string;
  };
  overallScore: number;
  caddieComment: string;
}

// ── OpenAI json_schema ────────────────────────────────────────────────────────

const PUTTING_ANALYSIS_SCHEMA: OpenAI.ResponseFormatJSONSchema = {
  type: 'json_schema',
  json_schema: {
    name: 'PuttingAnalysis',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'puttId', 'timestamp', 'distanceFeet', 'greenSlope',
        'setup', 'stroke', 'readAccuracy', 'recommendation',
        'overallScore', 'caddieComment',
      ],
      properties: {
        puttId:       { type: 'string' },
        timestamp:    { type: 'string' },
        holeNumber:   { type: 'number' },
        distanceFeet: { type: 'number' },
        greenSlope: {
          type: 'object',
          additionalProperties: false,
          required: ['direction', 'severity', 'breakInches', 'confidence'],
          properties: {
            direction:   { type: 'string', enum: ['left-to-right', 'right-to-left', 'uphill', 'downhill', 'flat'] },
            severity:    { type: 'string', enum: ['mild', 'moderate', 'steep'] },
            breakInches: { type: 'number' },
            confidence:  { type: 'number' },
          },
        },
        setup: {
          type: 'object',
          additionalProperties: false,
          required: ['alignment', 'ballPosition', 'stanceWidth', 'gripPressure', 'quality'],
          properties: {
            alignment:    { type: 'string', enum: ['open', 'closed', 'square'] },
            ballPosition: { type: 'string', enum: ['forward', 'center', 'back'] },
            stanceWidth:  { type: 'string', enum: ['narrow', 'normal', 'wide'] },
            gripPressure: { type: 'string', enum: ['light', 'medium', 'firm'] },
            quality:      { type: 'number' },
          },
        },
        stroke: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'tempo', 'faceAngleAtImpact', 'deceleration', 'quality'],
          properties: {
            path:               { type: 'string', enum: ['inside-out', 'outside-in', 'straight'] },
            tempo:              { type: 'string', enum: ['slow', 'normal', 'fast'] },
            faceAngleAtImpact:  { type: 'string', enum: ['open', 'closed', 'square'] },
            deceleration:       { type: 'boolean' },
            quality:            { type: 'number' },
          },
        },
        readAccuracy: {
          type: 'object',
          additionalProperties: false,
          required: ['wasCorrect', 'suggestedAdjustment', 'confidence'],
          properties: {
            wasCorrect:          { type: 'boolean' },
            suggestedAdjustment: { type: 'string' },
            confidence:          { type: 'number' },
          },
        },
        recommendation: {
          type: 'object',
          additionalProperties: false,
          required: ['line', 'speedFeel', 'mentalCue', 'technicalCue'],
          properties: {
            line:         { type: 'string' },
            speedFeel:    { type: 'string' },
            mentalCue:    { type: 'string' },
            technicalCue: { type: 'string' },
          },
        },
        overallScore:   { type: 'number' },
        caddieComment:  { type: 'string' },
      },
    },
  },
};

// ── Gemini responseSchema ─────────────────────────────────────────────────────

const PUTTING_ANALYSIS_GEMINI_SCHEMA: Schema = {
  type: 'OBJECT' as never,
  properties: {
    puttId:       { type: 'STRING' as never },
    timestamp:    { type: 'STRING' as never },
    holeNumber:   { type: 'NUMBER' as never },
    distanceFeet: { type: 'NUMBER' as never },
    greenSlope: {
      type: 'OBJECT' as never,
      properties: {
        direction:   { type: 'STRING' as never, enum: ['left-to-right', 'right-to-left', 'uphill', 'downhill', 'flat'] },
        severity:    { type: 'STRING' as never, enum: ['mild', 'moderate', 'steep'] },
        breakInches: { type: 'NUMBER' as never },
        confidence:  { type: 'NUMBER' as never },
      },
      required: ['direction', 'severity', 'breakInches', 'confidence'],
    },
    setup: {
      type: 'OBJECT' as never,
      properties: {
        alignment:    { type: 'STRING' as never, enum: ['open', 'closed', 'square'] },
        ballPosition: { type: 'STRING' as never, enum: ['forward', 'center', 'back'] },
        stanceWidth:  { type: 'STRING' as never, enum: ['narrow', 'normal', 'wide'] },
        gripPressure: { type: 'STRING' as never, enum: ['light', 'medium', 'firm'] },
        quality:      { type: 'NUMBER' as never },
      },
      required: ['alignment', 'ballPosition', 'stanceWidth', 'gripPressure', 'quality'],
    },
    stroke: {
      type: 'OBJECT' as never,
      properties: {
        path:              { type: 'STRING' as never, enum: ['inside-out', 'outside-in', 'straight'] },
        tempo:             { type: 'STRING' as never, enum: ['slow', 'normal', 'fast'] },
        faceAngleAtImpact: { type: 'STRING' as never, enum: ['open', 'closed', 'square'] },
        deceleration:      { type: 'BOOLEAN' as never },
        quality:           { type: 'NUMBER' as never },
      },
      required: ['path', 'tempo', 'faceAngleAtImpact', 'deceleration', 'quality'],
    },
    readAccuracy: {
      type: 'OBJECT' as never,
      properties: {
        wasCorrect:          { type: 'BOOLEAN' as never },
        suggestedAdjustment: { type: 'STRING' as never },
        confidence:          { type: 'NUMBER' as never },
      },
      required: ['wasCorrect', 'suggestedAdjustment', 'confidence'],
    },
    recommendation: {
      type: 'OBJECT' as never,
      properties: {
        line:         { type: 'STRING' as never },
        speedFeel:    { type: 'STRING' as never },
        mentalCue:    { type: 'STRING' as never },
        technicalCue: { type: 'STRING' as never },
      },
      required: ['line', 'speedFeel', 'mentalCue', 'technicalCue'],
    },
    overallScore:  { type: 'NUMBER' as never },
    caddieComment: { type: 'STRING' as never },
  },
  required: [
    'puttId', 'timestamp', 'distanceFeet', 'greenSlope',
    'setup', 'stroke', 'readAccuracy', 'recommendation',
    'overallScore', 'caddieComment',
  ],
};

const gemini = process.env.GOOGLE_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  : null;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 0 });

function geminiWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms),
    ),
  ]);
}
const MAX_FRAMES = 6;

interface RequestBody {
  frames_base64?: string[];
  video_url?: string | null;
  spoken_read?: string | null;
  notes?: string | null;
  distance_feet?: number | null;
  hole_number?: number | null;
  course_id?: string | null;
  green_centroid?: { lat: number; lng: number } | null;
  green_front?: { lat: number; lng: number } | null;
  green_back?: { lat: number; lng: number } | null;
  ball_area_norm?: { x: number; y: number; r: number } | null;
  target_norm?: { x: number; y: number } | null;
  persona?: string | null;
  voiceGender?: 'male' | 'female';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
  }

  try {
    const body = (req.body ?? {}) as RequestBody;
    const persona = (body.persona ?? body.voiceGender ?? 'male') as string;
    const caddieName = getCaddieName(persona);

    const frames = (body.frames_base64 ?? []).slice(0, MAX_FRAMES);
    const hasFrames = frames.length > 0;
    const hasVideo = !!body.video_url;
    const hasRead = !!(body.spoken_read && body.spoken_read.trim().length > 0);

    console.log('[putting] received:', {
      frameCount: frames.length,
      hasVideo,
      hasRead,
      hole: body.hole_number,
      dist: body.distance_feet,
    });

    if (!hasFrames && !hasVideo && !hasRead) {
      return res.status(200).json(unknownShell(caddieName, body));
    }

    const ctx: string[] = [];
    if (hasRead) ctx.push(`Player's spoken read: "${body.spoken_read!.trim()}"`);
    if (body.notes) ctx.push(`Notes: ${body.notes}`);
    if (typeof body.distance_feet === 'number') ctx.push(`Stated putt distance: ${body.distance_feet} feet`);
    if (body.hole_number) ctx.push(`Hole: ${body.hole_number}`);
    if (body.video_url) ctx.push(`Video URL: ${body.video_url}`);
    if (body.green_centroid) ctx.push(`Green centroid: ${JSON.stringify(body.green_centroid)}`);
    if (body.ball_area_norm) ctx.push(`Ball position in frame (x,y,r normalized 0-1): ${JSON.stringify(body.ball_area_norm)} — this is where the ball sat.`);
    if (body.target_norm) ctx.push(`Player's aim target in frame (x,y normalized 0-1): ${JSON.stringify(body.target_norm)} — judge start line and face relative to this.`);
    const userText = (ctx.length ? ctx.join('\n') + '\n\n' : '') +
      'Return ONLY the JSON object described in the system prompt. No preamble.';

    const system = buildSystem(caddieName);
    let raw = '';
    let providerUsed: 'gemini' | 'openai' = 'gemini';
    let geminiError: string | null = null;
    let openaiError: string | null = null;

    // ── Stage 1: Gemini 2.5 Flash ────────────────────────────────
    if (gemini && frames.length > 0) {
      try {
        const parts = [
          { text: system + '\n\n' + userText },
          ...frames.map(b64 => ({ inlineData: { mimeType: 'image/jpeg', data: b64 } })),
        ];
        // 13 s cap: cold Lambda + vision frames can push Gemini to 15-25s;
        // cap fast-fails so OpenAI fallback fires on the now-warm instance.
        const gem = await geminiWithTimeout(gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts }],
          config: { temperature: 0.2, maxOutputTokens: 1000, responseMimeType: 'application/json', responseSchema: PUTTING_ANALYSIS_GEMINI_SCHEMA },
        }), 13_000);
        raw = (gem.text ?? '').trim();
        if (!raw) geminiError = 'empty_response';
      } catch (e) {
        geminiError = e instanceof Error ? e.message : 'unknown';
        console.warn('[putting] gemini primary failed:', geminiError);
      }
    } else if (!gemini) {
      geminiError = 'GOOGLE_API_KEY not configured';
    } else {
      geminiError = 'no_frames';
    }

    // ── Stage 2: OpenAI gpt-4o ───────────────────────────────────
    if (!raw && process.env.OPENAI_API_KEY) {
      try {
        const imageContent = frames.map(b64 => ({
          type: 'image_url' as const,
          image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' as const },
        }));
        const oai = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 1000,
          temperature: 0.2,
          response_format: PUTTING_ANALYSIS_SCHEMA,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                ...imageContent,
                { type: 'text' as const, text: userText },
              ],
            },
          ],
        });
        raw = (oai.choices[0]?.message?.content ?? '').trim();
        providerUsed = 'openai';
        if (!raw) openaiError = 'empty_response';
      } catch (e) {
        openaiError = e instanceof Error ? e.message : 'unknown';
        console.warn('[putting] openai fallback failed:', openaiError);
      }
    }

    if (!raw) {
      console.warn('[putting] all providers failed');
      return res.status(502).json({ error: 'All providers failed', gemini_error: geminiError, openai_error: openaiError });
    }

    const parsed = safeParse(raw);
    if (!parsed) {
      console.warn('[putting] parse failed. provider:', providerUsed);
      return res.status(502).json({ error: 'Model returned non-JSON', provider: providerUsed });
    }
    // 2026-06-27 — clamp out-of-range / non-finite numbers in place (keep-and-flag).
    const clamped = clampPuttingNumbers(parsed);
    if (clamped.length) console.warn('[putting] clamped out-of-range numbers:', clamped.join(', '));
    return res.status(200).json({
      ...parsed,
      _debug: {
        provider: providerUsed,
        gemini_error: geminiError,
        openai_error: openaiError,
        ...(clamped.length ? { clamped } : {}),
      },
    });
  } catch (err) {
    console.log('[putting] error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

function buildSystem(caddieName: string): string {
  return `You are ${caddieName}, a putting-specialist coach inside SmartPlay. You analyze PUTTS — not full swings. Frames are typically POV (Meta Ray-Ban glasses) showing hands, putter, ball, and green from the player's eye-line.

Read every visible cue:
  - Putter face angle (address + impact): square / open / slightly-open / closed
  - Stroke path: straight / slight-arc / outside-in / inside-out
  - Tempo: smooth / decelerating / jerky / accelerating (deceleration flag = true when present)
  - Ball position: center / forward / back (relative to stance)
  - Stance width: narrow / standard / wide
  - Grip pressure cues from knuckle whitening / wrist tension: light / medium / firm
  - Head + eye stability (informs setup.quality)
  - Green texture: grain direction, sheen, undulation → infer slope direction + severity
  - Combine visual with player's spoken read + provided course context

Return EXACTLY this JSON shape — no preamble, no code fences, no extra fields:

{
  "puttId": string,
  "timestamp": string,
  "holeNumber": integer | undefined,
  "distanceFeet": integer,

  "greenSlope": {
    "direction": "left-to-right" | "right-to-left" | "straight" | "uphill" | "downhill",
    "severity": "flat" | "subtle" | "moderate" | "severe",
    "breakInches": number,
    "confidence": integer 0..100
  },

  "setup": {
    "alignment": "square" | "open" | "closed" | "slightly-open" | "slightly-closed",
    "ballPosition": "center" | "forward" | "back",
    "stanceWidth": "narrow" | "standard" | "wide",
    "gripPressure": "light" | "medium" | "firm",
    "quality": integer 0..100
  },

  "stroke": {
    "path": "straight" | "slight-arc" | "outside-in" | "inside-out",
    "tempo": "smooth" | "decelerating" | "jerky" | "accelerating",
    "faceAngleAtImpact": "square" | "open" | "closed",
    "deceleration": boolean,
    "quality": integer 0..100
  },

  "readAccuracy": {
    "wasCorrect": boolean,
    "suggestedAdjustment": string,
    "confidence": integer 0..100
  },

  "recommendation": {
    "line": string,
    "speedFeel": string,
    "mentalCue": string,
    "technicalCue": string
  },

  "overallScore": integer 0..100,
  "caddieComment": string
}

Persona tone for caddieComment (prefix with "${caddieName} here — " when natural):
  - Kevin: calm, conversational, friendly
  - Serena: measured, professional, precise vocabulary
  - Tank: direct, intense, no fluff ("Roger that")
  - Harry: encouraging, light, brief

Confidence calibration (the four 0..100 numbers):
  - 80-100: clear frames + spoken read aligned with what you see
  - 50-79: one source strong, the other thin
  - 25-49: heavy inference from limited evidence
  - 0-24: not enough to call

Never invent numbers you can't see. If unsure on a category, pick the most conservative enum (e.g. "straight" slope, "smooth" tempo) and lower the corresponding confidence/quality score. The caddieComment should be honest about what was and wasn't visible.`;
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// 2026-06-27 — Numeric sanity clamp (additive / non-destructive). Structured
// output guarantees these fields are NUMBERS, but NOT that they're finite or in
// range — a model can still emit distanceFeet: 9999, breakInches: -3, or NaN.
// We CLAMP to sane bounds (degrade + flag) rather than discard a useful read,
// per the keep-and-flag principle. In-range values are left untouched (no
// mutation, no flag) so valid output is byte-identical to before. Clamped field
// paths surface in _debug.clamped so over-range models are diagnosable.
function clampOne(v: unknown, min: number, max: number): { value: number; changed: boolean } {
  // Non-number / NaN / ±Infinity → coerce to the floor and flag.
  if (typeof v !== 'number' || !Number.isFinite(v)) return { value: min, changed: true };
  if (v < min) return { value: min, changed: true };
  if (v > max) return { value: max, changed: true };
  return { value: v, changed: false };
}

export function clampPuttingNumbers(parsed: Record<string, unknown>): string[] {
  const clamped: string[] = [];
  const apply = (
    obj: Record<string, unknown> | undefined,
    key: string,
    min: number,
    max: number,
    path: string,
  ): void => {
    if (!obj || typeof obj !== 'object' || !(key in obj)) return;
    const r = clampOne(obj[key], min, max);
    obj[key] = r.value;
    if (r.changed) clamped.push(path);
  };
  apply(parsed, 'distanceFeet', 0, 100, 'distanceFeet');
  apply(parsed, 'overallScore', 0, 100, 'overallScore');
  const slope = parsed.greenSlope as Record<string, unknown> | undefined;
  apply(slope, 'breakInches', 0, 120, 'greenSlope.breakInches');
  apply(slope, 'confidence', 0, 100, 'greenSlope.confidence');
  apply(parsed.setup as Record<string, unknown> | undefined, 'quality', 0, 100, 'setup.quality');
  apply(parsed.stroke as Record<string, unknown> | undefined, 'quality', 0, 100, 'stroke.quality');
  apply(parsed.readAccuracy as Record<string, unknown> | undefined, 'confidence', 0, 100, 'readAccuracy.confidence');
  return clamped;
}

function unknownShell(caddieName: string, body: RequestBody | null): Record<string, unknown> {
  return {
    puttId: 'putt_' + Date.now().toString(36),
    timestamp: new Date().toISOString(),
    partialCapture: true,
    holeNumber: body?.hole_number ?? undefined,
    distanceFeet: body?.distance_feet ?? 0,
    greenSlope: { direction: 'straight', severity: 'subtle', breakInches: 0, confidence: 25 },
    setup: { alignment: 'square', ballPosition: 'center', stanceWidth: 'standard', gripPressure: 'medium', quality: 50 },
    stroke: { path: 'straight', tempo: 'smooth', faceAngleAtImpact: 'square', deceleration: false, quality: 50 },
    readAccuracy: { wasCorrect: true, suggestedAdjustment: 'Trust your read.', confidence: 25 },
    recommendation: {
      line: 'Trust your read.',
      speedFeel: 'Die it into the hole — smooth pendulum.',
      mentalCue: 'Smooth pendulum, eyes still through impact.',
      technicalCue: 'Accelerate gently — no deceleration.',
    },
    overallScore: 50,
    caddieComment: `${caddieName} here. Smooth pendulum, eyes still, trust the line.`,
  };
}
