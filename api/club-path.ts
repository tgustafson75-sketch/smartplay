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
import { allowInference } from './_inferLimit';

// 2026-07-24 (Tim — "trace it correctly or not at all") — clubhead localization across a swing is a
// HARD vision task (small head, heavy motion blur through impact). Haiku 4.5 rarely locked it, so the
// arc almost never had enough real points and the client fell back to the (wrong) wrist path. Timeout
// widened to give a stronger model room; it stays UNDER the client's fetch timeout so a slow call
// degrades to an honest "no trace", never a hang.
// 2026-09-01 (adversarial audit) — maxRetries 0: A RETRY THAT CANNOT FIT IS WORSE THAN NO RETRY.
// The SDK's retry starts AFTER the first attempt's timeout, and this route's provider budget is
// already most of its platform ceiling — so a retry is killed mid-flight and the caller gets nothing
// instead of either an answer or a clean error. Tim's `clubpath_arc_too_sparse points: 0` was this
// shape. Fail once, honestly, inside the budget. [[the-client-must-be-the-last-to-give-up]]
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 28_000, maxRetries: 0 });

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const MAX_FRAMES = 16;

/**
 * 2026-09-19 — THE GATE MOVED TO services/swing/clubArcGate, AND THIS FILE STOPPED KEEPING ITS OWN COPY.
 *
 * `looksLikeClubArc` lived here AND in services/swing/clubPath, character for character, and the
 * client ran one step this side did not: it DEDUPES near-identical detections before counting them.
 * So a blurred downswing that makes the model report the same coordinates twice came out as "server
 * counts 3 and accepts, client dedupes to 2 and rejects" — and the field log reported a client/server
 * disagreement that the client's own comment says should never happen. A brand-new player's first
 * swing, on a Pixel 8a, read as a plumbing bug.
 *
 * Both sides now call the same function, dedupe included, so `detected` means one thing.
 * [[two-owners-is-the-root-cause]]
 */
import { classifyArc, type ArcRejection } from '../services/swing/clubArcGate';

export type { ArcRejection };

const PROMPT = `You are tracking the CLUBHEAD of a golf club across an ordered sequence of video frames from a single golf swing (frame 1 is earliest — near address; later frames move through the backswing, downswing, impact, and follow-through).

HOW TO FIND THE CLUBHEAD — anchor it to the SHAFT, do not free-hunt for the small head:
1. First locate the golfer's HANDS/GRIP (where both hands meet the top of the club). The hands are reliably visible almost every frame.
2. From the grip, follow the SHAFT — the long, thin, high-contrast straight line (or motion-blur streak) leading AWAY from the hands. The shaft is much easier to see than the head.
3. The CLUBHEAD is the weighted mass at the FAR END of that shaft line — the end opposite the hands (driver head, iron blade, wedge). Report THAT endpoint.

So the clubhead position = (grip point) + (shaft direction) × (shaft length). Use the shaft you can see to pin the head; this keeps the detection ON the actual club instead of floating near the body.

For EACH frame, report whether you can CLEARLY trace the shaft to its far end, and if so, the clubhead position as fractions of that frame (x=0 left edge, x=1 right edge, y=0 top, y=1 bottom).

The shaft + head are clearest at address, at the top of the backswing, and through the follow-through (they move slowest there); smallest/most blurred through the downswing and impact.

The clubhead traces ONE SMOOTH CONTINUOUS ARC across the frames — a large sweeping arc from the ball up to above the shoulders, NOT a tight loop around the torso (that would be the hands, not the head). Use neighboring frames to stay consistent: a correct detection sits ON the wide arc formed by the clear detections around it.

Rules:
- Report ONLY what you can actually trace. Through the downswing and impact the shaft/head is often a pure motion-blur streak or gone — returning null for those frames is CORRECT and expected. Do not force a position.
- If you cannot follow the shaft to a clear far end (blurred beyond identification, head off-frame, or hidden behind the body), return null for that frame. Do NOT guess, do NOT carry a previous frame's position forward, do NOT interpolate.
- CRITICAL — do NOT report the HANDS/GRIP as the clubhead. The head is always at the FAR end of the shaft from the hands, a real distance away. A point sitting right at the hands, or looping tightly around the torso, is WRONG — return null instead.
- Do NOT report the ball or a background object as the clubhead. If a candidate would sit FAR OFF the smooth wide arc formed by your other clear detections, return null for that frame.
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
  if (!allowInference(req, res, 'club-path')) return;
  if (!process.env.ANTHROPIC_API_KEY) {
    // Honest "not configured" — client collapses to null and keeps the honest
    // hand/tempo trace rather than drawing a fabricated club arc.
    return res.status(200).json({ configured: false });
  }

  const body = (req.body ?? {}) as { frames?: string[]; media_type?: string };
  const frames = Array.isArray(body.frames) ? body.frames.filter((f): f is string => typeof f === 'string' && f.length > 0) : [];
  if (frames.length < 3) {
    return res.status(400).json({ error: 'frames (base64 image array, >=3) required' });
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
      // 2026-07-24 — Haiku 4.5 → Sonnet 5 for the clubhead localization. Far stronger at picking a
      // small/blurred head out of a full frame and keeping detections ON the swing arc, which is what
      // makes the trace actually follow the CLUBHEAD (Tim's repeated ask) instead of coming back empty.
      model: 'claude-sonnet-5',
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
    // Gate the WHOLE set on arc plausibility: if the clearly-detected points don't form a real
    // sweep, they're a mis-detection — return all-null so no client draws a wrong "club" (Tim).
    const detected = positions.filter((p): p is { x: number; y: number } => p != null);
    const { rejection, points: kept } = classifyArc(detected);
    if (rejection) {
      /**
       * Still all-null — the client must not draw an implausible arc, and that behaviour is
       * unchanged. `rejected` is additive diagnosis: an older client ignores the extra key.
       */
      return res.status(200).json({
        positions: frames.map(() => null),
        /**
         * `detected` is the count the DECISION was made on (post-dedupe); `raw` is what the model
         * returned. Reporting only the raw number beside a decision made on the deduped one is how
         * the 09-19 field report came to describe a disagreement that was not happening.
         */
        rejected: { reason: rejection, detected: kept.length, raw: detected.length, frames: frames.length },
      });
    }
    return res.status(200).json({ positions });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'vision call failed' });
  }
}
