/**
 * 2026-05-22 — PuttingLab analysis endpoint.
 *
 * Receives frames (or a video URL) + the player's spoken read + course
 * geometry, runs a Claude Sonnet multimodal call tuned for PUTTING
 * cues (NOT full-body swing — Phase K's swing analyzer handles that
 * separately), and returns a structured PuttingAnalysis JSON.
 *
 * Defensive:
 *   - No frames + no spoken_read → returns a baseline "unknown" shell
 *     the client's normalize() handles. We don't 4xx in that case
 *     because the player wants ANY feedback, not an error toast.
 *   - Frames cap: first 6 frames passed to the model. More than that
 *     burns vision tokens without adding signal — putting has at most
 *     setup, address, top-of-back, impact, follow-through, roll.
 *   - 25s timeout on the Anthropic call; longer than chat but shorter
 *     than the client's 30s so the client always gets a response.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName } from '../../lib/persona';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 });

const MAX_FRAMES = 6;

interface RequestBody {
  frames_base64?: string[];
  video_url?: string | null;
  spoken_read?: string | null;
  notes?: string | null;
  hole_number?: number | null;
  course_id?: string | null;
  green_centroid?: { lat: number; lng: number } | null;
  green_front?: { lat: number; lng: number } | null;
  green_back?: { lat: number; lng: number } | null;
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
      course: body.course_id,
    });

    // Defensive bootstrap path: with no frames AND no spoken read, return
    // an "unknown" shell — the client's normalize() turns this into a
    // useful fallback without erroring out. Anything is better than a
    // server 5xx the player has to recover from mid-round.
    if (!hasFrames && !hasVideo && !hasRead) {
      return Response.json(makeUnknownShell(caddieName));
    }

    // Build the multimodal content array.
    const userContent: Anthropic.Messages.ContentBlockParam[] = [];
    for (const b64 of frames) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
      });
    }
    const contextLines: string[] = [];
    if (hasRead) contextLines.push(`Player's spoken read: "${body.spoken_read!.trim()}"`);
    if (body.notes) contextLines.push(`Notes: ${body.notes}`);
    if (body.hole_number) contextLines.push(`Hole: ${body.hole_number}`);
    if (body.video_url) contextLines.push(`Video URL: ${body.video_url}`);
    userContent.push({
      type: 'text',
      text: contextLines.join('\n') + '\n\nReturn ONLY the JSON object described in the system prompt. No preamble.',
    });

    const system = buildSystemPrompt(caddieName);
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      temperature: 0.2,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });

    const block = result.content.find(b => b.type === 'text');
    const raw = block && block.type === 'text' ? block.text.trim() : '';
    const parsed = safeParse(raw);
    if (!parsed) {
      console.warn('[putting] parse failed, returning shell');
      return Response.json(makeUnknownShell(caddieName));
    }
    return Response.json(parsed);
  } catch (err) {
    console.log('[putting] error:', err);
    return Response.json(makeUnknownShell('Kevin'));
  }
}

function buildSystemPrompt(caddieName: string): string {
  return `You are ${caddieName}, a putting-specialist caddie inside SmartPlay. You are analyzing a PUTT — not a full swing. The video / frames are usually POV (Meta Ray-Ban glasses) showing the hands, putter, ball, and green from the player's eye-line.

What to look for:
  - Putter face angle at address (square / open / closed)
  - Stroke path (straight-back-straight-through, slight arc, strong arc)
  - Tempo and deceleration through impact
  - Ball position relative to stance (forward / center / back)
  - Head and eye stability
  - Green texture cues (grain direction, sheen, undulation) when visible

Combine the visual evidence with the player's spoken read and any course context provided.

Return EXACTLY this JSON shape — no preamble, no code fences:

{
  "alignment": "square" | "open" | "closed" | "unknown",
  "stroke_path": "straight" | "slight_arc" | "strong_arc" | "unknown",
  "speed": "firmer" | "softer" | "on_pace" | "unknown",
  "recommended_line": string (one sentence — "two ball-widths outside left edge"),
  "break_estimate": string | null ("~12 inches L→R" or null when unknown),
  "mental_cue": string (one short sentence the player can rehearse pre-shot),
  "alignment_note": string (one sentence about face/aim correction or confirmation),
  "stroke_note": string (one sentence about stroke path / tempo / acceleration),
  "confidence": integer 0..100 (your honest confidence, lower when frames are missing/poor),
  "voice_summary": string (15-25 words in ${caddieName}'s voice — calm/measured/intense per persona)
}

Tone:
  - Kevin: calm, conversational, friendly
  - Serena: measured, professional, precise vocabulary
  - Tank: direct, intense, no fluff
  - Harry: encouraging, light, brief

Confidence guide:
  - 80-100: clear frames + spoken read aligned with what you see
  - 50-79: one source strong, the other thin
  - 25-49: heavy inference from limited evidence
  - 0-24: not enough to call — recommend re-recording

Never invent geometric numbers you can't see. Use "unknown" liberally.`;
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

function makeUnknownShell(caddieName: string): Record<string, unknown> {
  return {
    alignment: 'unknown',
    stroke_path: 'unknown',
    speed: 'unknown',
    recommended_line: 'Trust your read.',
    break_estimate: null,
    mental_cue: 'Smooth pendulum, eyes still through impact.',
    alignment_note: 'Square the face to your line.',
    stroke_note: 'Accelerate gently — no deceleration.',
    confidence: 25,
    voice_summary: `${caddieName} here. Smooth pendulum. Eyes still. Trust your line.`,
  };
}
