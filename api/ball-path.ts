/**
 * Ball-path tracker — 2026-06-25 (Shot Tracing).
 *
 * Extends the single-frame ball-departure verifier into a MULTI-FRAME ball
 * locator: given several wide frames sampled across the post-impact window,
 * it reports the ball's normalized position IN EACH FRAME where it can
 * actually see it — and explicitly reports NULL where it can't. The client
 * stitches the non-null positions into the solid, MEASURED portion of a shot
 * trace (services/swing/ballPath + ballTrace.buildShotTrace).
 *
 * This is the honest core of shot tracing (Tim's law): the model returns ONLY
 * detected ball positions. It never invents a position to "complete" the path.
 * Frames where the ball has left the view, blurred out, or was never visible
 * come back null, and the client draws nothing there (or — clearly labelled —
 * a separate dashed PROJECTED continuation it computes itself from the measured
 * launch segment). Measured and projected never blend.
 *
 * Input (POST JSON):
 *   - frames:  base64 JPEG[] — ordered post-impact wide frames (2..8).
 *   - media_type?: defaults image/jpeg
 *
 * Output:
 *   { positions: ({ x:number, y:number } | null)[] }  // one per input frame
 *   or { error } / { configured:false } — never a fabricated path.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 1 });

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const MAX_FRAMES = 8;

const PROMPT = `You are tracking a golf ball across an ordered sequence of video frames captured JUST AFTER a strike. The frames are in time order (frame 1 is earliest).

For EACH frame, report whether you can CLEARLY see the golf ball in flight (or rolling), and if so, its position as fractions of that frame (x=0 left edge, x=1 right edge, y=0 top, y=1 bottom).

Rules:
- Report ONLY what you can actually see. The ball moves fast and will often be motion-blurred or already gone from the frame — that is expected.
- If you CANNOT clearly identify the ball in a frame, return null for that frame. Do NOT guess a position to fill a gap, and do NOT carry a position forward from a previous frame.
- A small white/bright streak in flight counts as the ball; pick the center of the streak.
- Return exactly one entry per frame, in the same order as the frames were given.`;

const BALL_PATH_TOOL: Anthropic.Tool = {
  name: 'report_ball_path',
  description: 'Report the ball position (or null) detected in each ordered frame.',
  input_schema: {
    type: 'object',
    properties: {
      positions: {
        type: 'array',
        description: 'One entry per input frame, in order. Each is the ball position in that frame, or null if not clearly visible.',
        items: {
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
        },
      },
    },
    required: ['positions'],
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    // Mirror ball-departure: honest "not configured" so the client collapses to
    // null and simply hides the trace rather than fabricating one.
    return res.status(200).json({ configured: false });
  }

  const body = (req.body ?? {}) as { frames?: string[]; media_type?: string };
  const frames = Array.isArray(body.frames) ? body.frames.filter((f): f is string => typeof f === 'string' && f.length > 0) : [];
  if (frames.length < 2) {
    return res.status(400).json({ error: 'frames (base64 image array, >=2) required' });
  }
  if (frames.length > MAX_FRAMES) {
    return res.status(400).json({ error: `too many frames (max ${MAX_FRAMES})` });
  }
  const mediaType = (body.media_type ?? 'image/jpeg') as MediaType;

  const img = (data: string) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data } });
  const content: Anthropic.MessageParam['content'] = [
    { type: 'text' as const, text: PROMPT },
    ...frames.map((f) => img(f)),
  ];

  try {
    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      tools: [BALL_PATH_TOOL],
      tool_choice: { type: 'tool', name: 'report_ball_path' },
      messages: [{ role: 'user', content }],
    });
    const toolUse = completion.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) return res.status(502).json({ error: 'no tool_use block in vision response' });
    const raw = (toolUse.input as { positions?: unknown }).positions;
    const list = Array.isArray(raw) ? raw : [];
    // Validate + align to the frame count. Anything not a clean in-range {x,y}
    // becomes null — we never coerce a junk value into a position.
    const positions: ({ x: number; y: number } | null)[] = frames.map((_, i) => {
      const p = list[i] as { x?: unknown; y?: unknown } | null | undefined;
      if (!p || typeof p !== 'object') return null;
      const x = (p as { x?: unknown }).x;
      const y = (p as { y?: unknown }).y;
      if (typeof x !== 'number' || typeof y !== 'number') return null;
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
      return { x, y };
    });
    return res.status(200).json({ positions });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'vision call failed' });
  }
}
