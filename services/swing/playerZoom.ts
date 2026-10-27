/**
 * 2026-08-19 (Tim: "video does not auto zoom to player") — the review's auto-zoom onto the golfer, moved out
 * of app/swinglab/smartmotion.tsx on 2026-10-27 (audit R9) so it can be tested.
 *
 * Take the bounding box of every tracked joint across the whole swing (not one frame, or the zoom jitters),
 * pad it for golf (60% up for the club at the top, 35% down for the ball and turf, 35% across), and scale it
 * up to fill the view, capped at 2.2x. Null when there is no usable pose: the view stays as it is.
 *
 * The keypoints are FRAME-normalized; the clip is drawn CONTAIN inside the root view, so the frame occupies
 * a letterboxed content box, not the whole root (audit R9).
 */
import type { PoseFrame } from '../poseAnalysisApi';

export interface PlayerZoom { scale: number; tx: number; ty: number }

export function playerZoomFor(
  frames: readonly PoseFrame[] | null | undefined,
  root: { w: number; h: number },
  videoAR: number | null | undefined,
): PlayerZoom | null {
  if (!frames || frames.length === 0 || root.w <= 0 || root.h <= 0) return null;
  // The drawn clip: CONTAIN fits the frame inside the root. Without the clip's shape the fit is unknown, and a
  // zoom computed against the whole root slides the golfer off-centre (audit R9) — so no zoom.
  if (typeof videoAR !== 'number' || !Number.isFinite(videoAR) || videoAR <= 0) return null;
  const cw = Math.min(root.w, root.h * videoAR);
  const ch = Math.min(root.h, root.w / videoAR);
  // Keypoints arrive either normalized 0–1 or pixel-absolute; decide by magnitude, the same way
  // SwingBodyOverlay does, so the two never disagree about the space they are in.
  let maxCoord = 0;
  for (const f of frames) for (const k of f.keypoints) { if (k.score > 0.2) maxCoord = Math.max(maxCoord, k.x, k.y); }
  if (maxCoord <= 0) return null;
  const norm = maxCoord <= 1.5;
  const fw = frames.find(f => f.frameW)?.frameW ?? 0;
  const fh = frames.find(f => f.frameH)?.frameH ?? 0;
  if (!norm && (!fw || !fh)) return null; // pixel coords with no frame size — cannot normalize honestly

  let minX = 1, maxX = 0, minY = 1, maxY = 0, seen = 0;
  for (const f of frames) {
    for (const k of f.keypoints) {
      if (k.score <= 0.2) continue;
      const x = norm ? k.x : k.x / fw;
      const y = norm ? k.y : k.y / fh;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      seen++;
    }
  }
  if (seen < 8 || maxX <= minX || maxY <= minY) return null;

  // Golf padding: room for the club over the head and the ball under the hands.
  const h = maxY - minY, w = maxX - minX;
  const padTop = h * 0.60, padBottom = h * 0.35, padSide = w * 0.35;
  const bx0 = Math.max(0, minX - padSide), bx1 = Math.min(1, maxX + padSide);
  const by0 = Math.max(0, minY - padTop),  by1 = Math.min(1, maxY + padBottom);
  const bw = bx1 - bx0, bh = by1 - by0;
  if (bw <= 0.02 || bh <= 0.02) return null;

  // Scale so the padded box (in drawn pixels: bw·cw × bh·ch) fills the VIEW on its tighter axis; never crop
  // it on the other.
  const scale = Math.min(2.2, Math.max(1, Math.min(root.w / (bw * cw), root.h / (bh * ch))));
  if (scale <= 1.05) return null; // already filling the frame — leave it alone

  // Move the box centre to the view centre, in post-scale pixels. The content box is centred in the root, so
  // a frame point sits (x - 0.5)·cw from the view centre.
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const tx = (0.5 - cx) * cw * scale;
  const ty = (0.5 - cy) * ch * scale;
  return { scale, tx, ty };
}
