/**
 * 2026-05-22 — Vercel handler: PuttingLab analysis.
 *
 * Mirror of app/api/putting-analysis+api.ts (the Expo Router version
 * used in local dev) for the production Vercel deployment. The two
 * MUST stay in lockstep — when one changes, update the other.
 *
 * Receives frames + spoken read + course context + optional distance,
 * runs Claude Sonnet 4.5 vision tuned for PUTTING cues, and returns
 * the structured PuttingAnalysis JSON the client's normalize() expects.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName } from '../lib/persona';

// 2026-06-21 — maxRetries 3→1→0: 1 retry = 50s worst-case, which exceeds the
// client's 30s AbortSignal.timeout in puttingAnalysisService.ts. With 0 retries
// the server worst-case is 25s, well within the client's 30s budget. The client
// already catches transport failures and returns a graceful fallback analysis.
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
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
    // 2026-06-08 (audit #12) — user-marked ball + aim (normalized 0..1 frame
    // coords). Anchor the read to these: ball is where it sat, target is
    // where the player aimed; judge start line / face vs that target.
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

    const block = result.content.find((b) => b.type === 'text');
    const raw = block && block.type === 'text' ? block.text.trim() : '';
    const parsed = safeParse(raw);
    if (!parsed) {
      console.warn('[putting] parse failed, returning shell');
      return res.status(200).json(unknownShell(caddieName, body));
    }
    return res.status(200).json(parsed);
  } catch (err) {
    console.log('[putting] error:', err);
    return res.status(200).json(unknownShell('Kevin', null));
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
    // Honesty: this is a no-input fallback — every value below is a generic
    // default, NOT a measurement. partialCapture flags the UI to show the
    // "—"/caveat treatment instead of presenting these as real reads.
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
