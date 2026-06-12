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

Return ONLY a JSON object, no prose:
{
  "ball_present_before": boolean,  // is a golf ball CLEARLY visible in image 1?
  "ball_present_after": boolean,   // is a golf ball still in that same spot in image 2?
  "direction": "left" | "right" | "toward" | "unknown",  // from image 3 if given; else "unknown"
  "confidence": "high" | "medium" | "low",
  "ball_after_norm": { "x": number, "y": number } | null  // see rules
}

Rules:
- Report ONLY what you can actually see. Do not assume a strike happened.
- If image 1 does NOT clearly show a golf ball, set ball_present_before=false and confidence="low".
- "direction" is relative to the player's view: "left"/"right" of the original spot, or "toward" (up the frame, toward the target). Use "unknown" unless image 3 clearly shows where the ball went.
- "ball_after_norm": ONLY if image 3 is given AND you can clearly see the ball in flight, give its position as fractions of image 3 (x=0 left edge, x=1 right edge, y=0 top, y=1 bottom). If you can't clearly see the departed ball, set it to null. Do NOT guess a position.`;

function parse(raw: string): BallDepartureResult | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]) as Partial<BallDepartureResult>;
    const before = p.ball_present_before === true;
    const after = p.ball_present_after === true;
    const direction: BallDepartureResult['direction'] =
      p.direction === 'left' || p.direction === 'right' || p.direction === 'toward' ? p.direction : 'unknown';
    const confidence: BallDepartureResult['confidence'] =
      p.confidence === 'high' || p.confidence === 'medium' || p.confidence === 'low' ? p.confidence : 'low';
    // Honesty guard: a departure claim only means anything if we saw a ball
    // to begin with. No visible starting ball → not a confident verdict.
    const departed = before && !after;
    const pos = p.ball_after_norm;
    const ball_after_norm =
      departed && pos && typeof pos.x === 'number' && typeof pos.y === 'number'
        && pos.x >= 0 && pos.x <= 1 && pos.y >= 0 && pos.y <= 1
        ? { x: pos.x, y: pos.y }
        : null;
    return {
      departed,
      ball_present_before: before,
      ball_present_after: after,
      direction: departed ? direction : 'unknown',
      confidence: before ? confidence : 'low',
      ball_after_norm,
    };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    // Mirror pose-analysis: honest "not configured" rather than a 500 so the
    // client collapses to null and simply hides the verification.
    return res.status(200).json({ configured: false });
  }

  const body = (req.body ?? {}) as {
    before_roi?: string;
    after_roi?: string;
    after_wide?: string;
    media_type?: string;
  };
  if (!body.before_roi || !body.after_roi) {
    return res.status(400).json({ error: 'before_roi and after_roi (base64 images) required' });
  }
  const mediaType = (body.media_type ?? 'image/jpeg') as MediaType;

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
      messages: [{ role: 'user', content }],
    });
    const text = completion.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const result = parse(text);
    if (!result) return res.status(502).json({ error: 'unparseable vision response' });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'vision call failed' });
  }
}
