/**
 * Ball-departure verifier — 2026-06-09.
 *
 * Cross-checks an acoustic "strike" against what the camera actually saw:
 * did the ball leave the spot it was placed on, at impact? This is the
 * single strongest defense against acoustic false positives (a TV / clap /
 * range neighbor that sounds like a strike can't make YOUR ball leave its
 * spot). It also yields a coarse departure direction that can later seed a
 * ball-flight trace.
 *
 * Input (POST JSON):
 *   - before_roi:  base64 JPEG, tight crop of the ball spot just BEFORE impact
 *   - after_roi:   base64 JPEG, SAME crop just AFTER impact
 *   - after_wide?: base64 JPEG, wider view just after impact (for direction)
 *   - media_type?: defaults image/jpeg
 *
 * Output:
 *   { departed, ball_present_before, ball_present_after, direction, confidence }
 *   or { error } / { configured:false } — never a fabricated "departed".
 *
 * Honesty: the model is told to report ONLY what it can see. If it can't
 * clearly see a ball in the BEFORE crop, confidence is forced low and we
 * don't claim a departure either way.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { allowInference } from './_inferLimit';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 13_000, maxRetries: 1 });

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

interface BallDepartureResult {
  /** ball_present_before && !ball_present_after. */
  departed: boolean;
  ball_present_before: boolean;
  ball_present_after: boolean;
  /** Coarse launch direction from the wide after-frame; 'unknown' when not
   *  provided or not confidently visible. */
  direction: 'left' | 'right' | 'toward' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  /** 2026-06-11 — the ball's normalized position WITHIN the wide after-frame
   *  (image 3), 0..1, when it's clearly visible mid-flight. Lets the client draw
   *  the REAL initial departure direction (mapped back to full-frame + measured
   *  against the aim line), not just a left/right label. Null when not seen. */
  ball_after_norm?: { x: number; y: number } | null;
}

const PROMPT = `You are verifying a golf ball strike from cropped video frames.
- Image 1: the exact spot where a golf ball was placed, captured JUST BEFORE impact.
- Image 2: the SAME spot, captured JUST AFTER impact.
- Image 3 (only if provided): a WIDER view just after impact, to judge which way the ball left.

Rules:
- Report ONLY what you can actually see. Do not assume a strike happened.
- If image 1 does NOT clearly show a golf ball, set ball_present_before=false and confidence="low".
- "direction" is relative to the player's view: "left"/"right" of the original spot, or "toward" (up the frame, toward the target). Use "unknown" unless image 3 clearly shows where the ball went.
- "ball_after_norm": ONLY if image 3 is given AND you can clearly see the ball in flight, give its position as fractions of image 3 (x=0 left edge, x=1 right edge, y=0 top, y=1 bottom). If you can't clearly see the departed ball, set it to null. Do NOT guess a position.`;

const BALL_DEPARTURE_TOOL: Anthropic.Tool = {
  name: 'report_ball_departure',
  description: 'Report the ball presence and departure direction from the provided video frame crops.',
  input_schema: {
    type: 'object',
    properties: {
      ball_present_before: {
        type: 'boolean',
        description: 'Is a golf ball CLEARLY visible in image 1 (before impact)?',
      },
      ball_present_after: {
        type: 'boolean',
        description: 'Is a golf ball still in that same spot in image 2 (after impact)?',
      },
      direction: {
        type: 'string',
        enum: ['left', 'right', 'toward', 'unknown'],
        description: 'Coarse departure direction from image 3 if provided; otherwise "unknown".',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Overall confidence in the assessment.',
      },
      ball_after_norm: {
        oneOf: [
          {
            type: 'object',
            properties: {
              x: { type: 'number', description: '0 = left edge, 1 = right edge of image 3.' },
              y: { type: 'number', description: '0 = top edge, 1 = bottom edge of image 3.' },
            },
            required: ['x', 'y'],
          },
          { type: 'null' },
        ],
        description: 'Normalized position of the ball in image 3 when clearly visible mid-flight; null otherwise.',
      },
    },
    required: ['ball_present_before', 'ball_present_after', 'direction', 'confidence', 'ball_after_norm'],
  },
};

const LOCATE_PROMPT = `You are locating a golf ball in a practice setup frame, BEFORE any swing.
The golfer is standing at address (or walking into position). Find the ball they are about to hit.

Rules:
- Report ONLY a ball you can actually SEE. Never infer one from where a ball "should" be relative to the stance or the club — the caller already has that guess and is asking you to do better.
- A golf ball is small, round, and usually pale, resting on the ground/turf/mat near the player's feet, roughly under or just ahead of their hands.
- If there are several balls (a range pile, a bucket spill), pick the ONE the golfer is addressing — the one closest to the club head / directly in their stance. If you cannot tell which, set found=false.
- Do NOT report: range buckets, alignment sticks, ball marks, cups, tee markers, or bright specks in the background.
- Set found=false with confidence "low" if the ball is hidden, out of frame, motion-blurred, or you are unsure. A refusal is CORRECT and expected — the caller has a safe fallback.
- "ball_norm" is the ball's CENTER as fractions of this image (x=0 left edge, x=1 right edge, y=0 top, y=1 bottom).`;

const BALL_LOCATE_TOOL: Anthropic.Tool = {
  name: 'report_ball_location',
  description: 'Report where the golf ball sits in the setup frame, or that none is clearly visible.',
  input_schema: {
    type: 'object',
    properties: {
      found: { type: 'boolean', description: 'Is a golf ball CLEARLY visible and identifiable as the one being addressed?' },
      ball_norm: {
        oneOf: [
          {
            type: 'object',
            properties: {
              x: { type: 'number', description: '0 = left edge, 1 = right edge.' },
              y: { type: 'number', description: '0 = top edge, 1 = bottom edge.' },
            },
            required: ['x', 'y'],
          },
          { type: 'null' },
        ],
        description: 'Ball centre, normalized to this image. Null when found=false.',
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence that this is the addressed ball.' },
    },
    required: ['found', 'ball_norm', 'confidence'],
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  if (!allowInference(req, res, 'ball-departure')) return;
  if (!process.env.ANTHROPIC_API_KEY) {
    // Mirror pose-analysis: honest "not configured" rather than a 500 so the
    // client collapses to null and simply hides the verification.
    return res.status(200).json({ configured: false });
  }

  const body = (req.body ?? {}) as {
    mode?: 'locate';
    setup_frame?: string;
    before_roi?: string;
    after_roi?: string;
    after_wide?: string;
    media_type?: string;
  };
  const mediaType = (body.media_type ?? 'image/jpeg') as MediaType;

  /**
   * 2026-08-19 (Tim — "we strengthen the ball detection and the ball detection area in the video, and
   * we make this smarter"). LOCATE mode: find the ball in a SETUP frame, before any swing.
   *
   * The client has only ever placed its ball box from the golfer's FEET — a proxy that is right about
   * where a ball usually sits relative to a stance, and wrong whenever it isn't. Everything downstream
   * keys off that box (the departure verifier crops to it, the trace starts from it), so a proxy at
   * the root propagates. This reads the actual ball.
   *
   * Deliberately a MODE on this route rather than a new endpoint: same deployed function, same
   * allowInference gate, same model client and key. Nothing new to configure or deploy separately.
   *
   * Honest by construction — "found: false" whenever it cannot see a ball, so the caller keeps its
   * feet proxy rather than moving the box somewhere invented.
   */
  if (body.mode === 'locate') {
    if (!body.setup_frame) {
      return res.status(400).json({ error: 'setup_frame (base64 image) required for mode=locate' });
    }
    try {
      const completion = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        tools: [BALL_LOCATE_TOOL],
        tool_choice: { type: 'tool', name: 'report_ball_location' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text' as const, text: LOCATE_PROMPT },
            { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: body.setup_frame } },
          ],
        }],
      });
      const tu = completion.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!tu) return res.status(200).json({ found: false });
      const q = tu.input as { found: boolean; ball_norm: { x: number; y: number } | null; confidence: string };
      const okConf = q.confidence === 'high' || q.confidence === 'medium';
      const pt = q.ball_norm;
      const inFrame = pt != null && pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1;
      if (!q.found || !okConf || !inFrame) return res.status(200).json({ found: false });
      return res.status(200).json({ found: true, ball_norm: pt, confidence: q.confidence });
    } catch (e) {
      console.log('[ball-departure] locate failed:', e);
      return res.status(200).json({ found: false });
    }
  }

  if (!body.before_roi || !body.after_roi) {
    return res.status(400).json({ error: 'before_roi and after_roi (base64 images) required' });
  }

  const img = (data: string) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data } });
  const content: Anthropic.MessageParam['content'] = [
    { type: 'text' as const, text: PROMPT },
    img(body.before_roi),
    img(body.after_roi),
    ...(body.after_wide ? [img(body.after_wide)] : []),
  ];

  try {
    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      tools: [BALL_DEPARTURE_TOOL],
      tool_choice: { type: 'tool', name: 'report_ball_departure' },
      messages: [{ role: 'user', content }],
    });
    const toolUse = completion.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) return res.status(502).json({ error: 'no tool_use block in vision response' });
    const p = toolUse.input as {
      ball_present_before: boolean;
      ball_present_after: boolean;
      direction: BallDepartureResult['direction'];
      confidence: BallDepartureResult['confidence'];
      ball_after_norm: { x: number; y: number } | null;
    };
    const before = p.ball_present_before === true;
    const after = p.ball_present_after === true;
    const direction: BallDepartureResult['direction'] =
      p.direction === 'left' || p.direction === 'right' || p.direction === 'toward' ? p.direction : 'unknown';
    const confidence: BallDepartureResult['confidence'] =
      p.confidence === 'high' || p.confidence === 'medium' || p.confidence === 'low' ? p.confidence : 'low';
    // Honesty guard: departure claim only means anything if we saw a ball to begin with.
    const departed = before && !after;
    const pos = p.ball_after_norm;
    const ball_after_norm =
      departed && pos && typeof pos.x === 'number' && typeof pos.y === 'number'
        && pos.x >= 0 && pos.x <= 1 && pos.y >= 0 && pos.y <= 1
        ? { x: pos.x, y: pos.y }
        : null;
    const result: BallDepartureResult = {
      departed,
      ball_present_before: before,
      ball_present_after: after,
      direction: departed ? direction : 'unknown',
      confidence: before ? confidence : 'low',
      ball_after_norm,
    };
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'vision call failed' });
  }
}
