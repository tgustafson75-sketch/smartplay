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
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 28_000, maxRetries: 1 });

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const MAX_FRAMES = 16;

/** Minimum clearly-detected points before the set can be a real arc.
 *  2026-08-06 (Tim — the blue club never showed): lowered 4→3. Sonnet returns null through the blurred
 *  downswing, so a valid partial sweep frequently has only 3 confident points; the old 4-gate here PLUS the
 *  client gate double-rejected them into all-null. Still blob-guarded by the span test below. */
const MIN_ARC_POINTS = 3;

/**
 * 2026-07-22 (Tim — "the club is consistently off; trace it correctly") — validate that the
 * detected positions form a plausible clubhead SWEEP before returning them. A real swing arc
 * spans a meaningful fraction of the frame; a cluster is a mis-detection (the ball, the grip, or
 * a background object read as the head — the "off" club at address). Enforced SERVER-side so
 * EVERY client (native app + the SmartPlay Light web app, which share this endpoint) gets honest
 * data — an implausible set is returned as all-null so the client keeps its honest hand/tempo
 * trace instead of drawing a wrong club.
 */
function looksLikeClubArc(pts: { x: number; y: number }[]): boolean {
  if (pts.length < MIN_ARC_POINTS) return false;
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX, spanY = maxY - minY;
  // Forgiving (a partial arc is fine) but rejects a clustered blob: the sweep must cover a good
  // chunk of the frame in at least one axis, and not collapse to near a single point.
  if (Math.max(spanX, spanY) < 0.10) return false;
  if (spanX + spanY < 0.13) return false;
  // 2026-08-06 (analysis audit) — span alone (a wide box) is fooled by 3 UNRELATED confident detections
  // (grip + ball + a background object) that box-span wide but zig-zag. Gate on path EFFICIENCY (net
  // first→last distance ÷ total path length): a real quarter-to-half-circle sweep scores ~0.57–0.64, a
  // scatter ~0.26. Mirrors the client gate so both the app and SmartPlay Light reject garbage identically.
  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) {
    pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  if (pathLen <= 1e-6) return false;
  // 2026-08-08 (verification wave — "still don't see club trace" root #2) — whole-path efficiency
  // STRUCTURALLY rejects a COMPLETE swing: address→top→impact→finish doubles back on itself, so
  // netSpan/pathLen lands ~0.33 (< 0.45) and a perfect full-swing arc was thrown away as "scatter" —
  // deterministically, on every retry. The insight that survives: a real sweep is SMOOTH PER LEG while
  // scatter zig-zags at every scale. So: pass if the whole path is efficient (partial arcs, unchanged),
  // OTHERWISE split at the apex (farthest point from the start — the top of the swing) and require each
  // leg to be efficient, recursing one more level for legs that themselves double back (impact→finish).
  // Grip/ball/background scatter stays rejected: its legs zig-zag no matter how it's split.
  const eff = (a: number, b: number): boolean => {
    let len = 0;
    for (let i = a + 1; i <= b; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len <= 1e-6) return false;
    return Math.hypot(pts[b].x - pts[a].x, pts[b].y - pts[a].y) / len >= 0.45;
  };
  const smooth = (a: number, b: number, depth: number): boolean => {
    if (eff(a, b)) return true;
    if (depth <= 0 || b - a < 5) return false; // too few points to claim a doubled-back real arc
    let apex = a + 1, best = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.hypot(pts[i].x - pts[a].x, pts[i].y - pts[a].y);
      if (d > best) { best = d; apex = i; }
    }
    if (apex <= a + 1 || apex >= b - 1) return false; // apex at an end = no real turnaround
    return smooth(a, apex, depth - 1) && smooth(apex, b, depth - 1);
  };
  if (!smooth(0, pts.length - 1, 2)) return false;
  return true;
}

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
    if (!looksLikeClubArc(detected)) {
      return res.status(200).json({ positions: frames.map(() => null) });
    }
    return res.status(200).json({ positions });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'vision call failed' });
  }
}
