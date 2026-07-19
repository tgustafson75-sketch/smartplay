/**
 * Clubhead-path tracker — 2026-07-07 (Tim — real clubhead swing arc, not the wrist).
 *
 * The honest counterpart to api/ball-path: given ordered frames sampled ACROSS a
 * swing (address → top → downswing → impact → follow-through), it reports the
 * CLUBHEAD's normalized position IN EACH FRAME where it can actually see it — and
 * NULL where it can't (the head is small and, through the downswing/impact, heavily
 * motion-blurred at 30fps; that is expected and must NOT be guessed).
 *
 * Tim's law (memory smartmotion-metrics-honesty): the model returns ONLY detected
 * clubhead positions. It never invents one to "complete" the arc. The client draws
 * the arc through the real points and leaves gaps where detection failed, clearly as
 * a partial/estimated read — never a fabricated smooth club path.
 *
 * Input (POST JSON):
 *   - frames: base64 JPEG[] — ordered swing frames (4..16), full-frame (downscaled).
 *   - media_type?: defaults image/jpeg
 *
 * Output:
 *   { positions: ({ x:number, y:number } | null)[] }  // one per input frame
 *   or { error } / { configured:false } — never a fabricated arc.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 22_000, maxRetries: 1 });

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const MAX_FRAMES = 16;

const PROMPT = `You are tracking the CLUBHEAD of a golf club across an ordered sequence of video frames from a single golf swing (frame 1 is earliest — near address; later frames move through the backswing, downswing, impact, and follow-through).

The CLUBHEAD is the weighted head at the FAR end of the shaft from the hands — the part that strikes the ball (driver head, iron blade, wedge, etc.). It is NOT the grip, the hands, or the shaft; report the HEAD only.

For EACH frame, report whether you can CLEARLY identify the clubhead, and if so, its position as fractions of that frame (x=0 left edge, x=1 right edge, y=0 top, y=1 bottom).

The clubhead is LARGE and clearest at address, at the top of the backswing, and through the follow-through (it moves slowest there); it is smallest/most blurred through the downswing and impact.

The clubhead traces ONE SMOOTH CONTINUOUS ARC across the frames — it cannot jump to an unrelated spot in one frame and back in the next. Use the positions you find in the neighboring frames to stay consistent: a correct detection sits ON the arc formed by the clear detections around it.

Rules:
- Report ONLY what you can actually, clearly see. Through the downswing and impact the clubhead moves extremely fast and is usually a motion-blur streak or gone — returning null for those frames is CORRECT and expected. Do not force a position.
- If the clubhead is blurred beyond clear identification, ambiguous, off-frame, or hidden behind the body, return null for that frame. Do NOT guess, do NOT carry a previous frame's position forward, do NOT interpolate.
- When the head is a motion-blur streak, only report it if you can confidently pick the head end of the streak; otherwise null.
- Do NOT report the hands/grip/ball/shaft as the clubhead. If a candidate would sit FAR OFF the smooth arc formed by your other clear detections, it is almost certainly the hands, the shaft, or a background object — return null for that frame instead of a point off the arc.
- Return exactly one entry per frame, in the same order as the frames were given.`;

const CLUB_PATH_TOOL: Anthropic.Tool = {
  name: 'report_club_path',
  description: 'Report the clubhead position (or null) detected in each ordered frame.',
  input_schema: {
    type: 'object',
    properties: {
      positions: {
        type: 'array',
        description: 'One entry per input frame, in order. Each is the CLUBHEAD position in that frame, or null if not clearly visible.',
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
    // Honest "not configured" — client collapses to null and keeps the honest
    // hand/tempo trace rather than drawing a fabricated club arc.
    return res.status(200).json({ configured: false });
  }

  const body = (req.body ?? {}) as { frames?: string[]; media_type?: string };
  const frames = Array.isArray(body.frames) ? body.frames.filter((f): f is string => typeof f === 'string' && f.length > 0) : [];
  if (frames.length < 4) {
    return res.status(400).json({ error: 'frames (base64 image array, >=4) required' });
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
      max_tokens: 700,
      tools: [CLUB_PATH_TOOL],
      tool_choice: { type: 'tool', name: 'report_club_path' },
      messages: [{ role: 'user', content }],
    });
    const toolUse = completion.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) return res.status(502).json({ error: 'no tool_use block in vision response' });
    const raw = (toolUse.input as { positions?: unknown }).positions;
    const list = Array.isArray(raw) ? raw : [];
    // Validate + align to the frame count. Anything not a clean in-range {x,y} becomes
    // null — we never coerce a junk value into a clubhead position.
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
