/**
 * 2026-05-22 — PuttingLab analysis endpoint (v2 — structured schema).
 *
 * Receives frames + spoken read + course context + optional distance,
 * runs Claude Sonnet 4.5 vision tuned for PUTTING cues (not full-body
 * swing — that lives in cage-analysis), and returns the full structured
 * PuttingAnalysis JSON the client's normalize() expects.
 *
 * Defensive:
 *   - Empty inputs → "unknown" shell with low confidence. We never 5xx
 *     on missing media; the player wants ANY feedback, not an error.
 *   - MAX_FRAMES=6 cap. Putting has at most setup / address / top-of-back
 *     / impact / follow-through / roll.
 *   - 25s Anthropic timeout (< client's 30s) so the client always sees
 *     a response.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName } from '../../lib/persona';

// 2026-06-21 — maxRetries 1→0: 1 retry = 50s worst-case, which exceeds the
// client's 30s AbortSignal.timeout in puttingAnalysisService.ts. With 0 retries
// the server worst-case is 25s, well within the client's 30s budget.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 0 });
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
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
      return Response.json(unknownShell(caddieName, body));
    }

    // Multimodal user content: frames, then context text.
    const userContent: Anthropic.Messages.ContentBlockParam[] = [];
    for (const b64 of frames) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
      });
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
    userContent.push({
      type: 'text',
      text: (ctx.length ? ctx.join('\n') + '\n\n' : '') +
        'Return ONLY the JSON object described in the system prompt. No preamble.',
    });

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      temperature: 0.2,
      system: [{ type: 'text', text: buildSystem(caddieName), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });

    const block = result.content.find(b => b.type === 'text');
    const raw = block && block.type === 'text' ? block.text.trim() : '';
    const parsed = safeParse(raw);
    if (!parsed) {
      console.warn('[putting] parse failed, returning shell');
      return Response.json(unknownShell(caddieName, body));
    }
    return Response.json(parsed);
  } catch (err) {
    console.log('[putting] error:', err);
    return Response.json(unknownShell('Kevin', null));
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
  "puttId": string,                        // e.g. "putt_20260522_abcd" — generate fresh
  "timestamp": string,                     // ISO 8601 UTC, current moment
  "holeNumber": integer | undefined,       // copy from input if provided
  "distanceFeet": integer,                 // your best estimate; honor input if given

  "greenSlope": {
    "direction": "left-to-right" | "right-to-left" | "straight" | "uphill" | "downhill",
    "severity": "flat" | "subtle" | "moderate" | "severe",
    "breakInches": number,                 // best estimate of total side-break
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
    "wasCorrect": boolean,                 // was the spoken read consistent with green cues?
    "suggestedAdjustment": string,         // "Play 2-3 inches right of cup" etc
    "confidence": integer 0..100
  },

  "recommendation": {
    "line": string,                        // "Aim one ball outside right edge"
    "speedFeel": string,                   // "Die it into the hole — smooth pendulum"
    "mentalCue": string,                   // "Trust the subtle break. Breathe easy."
    "technicalCue": string                 // "Maintain slight acceleration through impact"
  },

  "overallScore": integer 0..100,          // weighted blend of setup + stroke + read
  "caddieComment": string                  // 25-45 word persona-aware spoken summary
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
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function unknownShell(caddieName: string, body: RequestBody | null): Record<string, unknown> {
  return {
    puttId: 'putt_' + Date.now().toString(36),
    timestamp: new Date().toISOString(),
    // Honesty: no-input fallback — generic defaults, not measurements.
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
