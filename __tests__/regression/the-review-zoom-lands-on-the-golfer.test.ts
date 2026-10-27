/**
 * 2026-10-27 (SmartMotion review audit R9) — the auto-zoom puts the GOLFER in the middle of the view.
 *
 * The pose keypoints are frame-normalized and the clip is drawn CONTAIN, so the frame is a letterboxed box
 * inside the view. The zoom translated as if the frame filled the whole view: on a portrait clip in a wider
 * view (a Fold open, a landscape review) the golfer was pushed off-centre, and the scale could crop him.
 * Behaviour, not shape: apply the returned transform to the golfer's padded box and see where it lands.
 */
import { playerZoomFor } from '../../services/swing/playerZoom';
import type { PoseFrame } from '../../services/poseAnalysisApi';

/** A golfer standing left of centre in a portrait frame: joints spanning x 0.25-0.35, y 0.45-0.75. */
function frames(): PoseFrame[] {
  const kps = [];
  for (let i = 0; i < 12; i++) {
    kps.push({ name: `k${i}`, x: 0.25 + (i % 3) * 0.05, y: 0.45 + Math.floor(i / 3) * 0.1, score: 0.9 });
  }
  return [{ timestampMs: 0, keypoints: kps } as unknown as PoseFrame];
}

/** Where a frame-normalized point is drawn once the CONTAIN fit and the RN transform [tx, ty, scale] apply. */
function drawn(p: { x: number; y: number }, root: { w: number; h: number }, ar: number, z: { scale: number; tx: number; ty: number }) {
  const cw = Math.min(root.w, root.h * ar), ch = Math.min(root.h, root.w / ar);
  const px = (root.w - cw) / 2 + p.x * cw, py = (root.h - ch) / 2 + p.y * ch;
  return { x: root.w / 2 + z.tx + z.scale * (px - root.w / 2), y: root.h / 2 + z.ty + z.scale * (py - root.h / 2) };
}

// The padded box the zoom frames (60% up, 35% down, 35% across the joint box).
const box = { x0: 0.25 - 0.1 * 0.35, x1: 0.35 + 0.1 * 0.35, y0: 0.45 - 0.3 * 0.6, y1: 0.75 + 0.3 * 0.35 };
const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };

describe('the review zoom centres the golfer in the drawn clip', () => {
  it('THE REPORT: a portrait clip in a wide view (Fold open) — the golfer lands on the view centre', () => {
    const root = { w: 900, h: 800 }, ar = 9 / 16;
    const z = playerZoomFor(frames(), root, ar)!;
    expect(z).not.toBeNull();
    const c = drawn(centre, root, ar, z);
    expect(c.x).toBeCloseTo(root.w / 2, 0);
    expect(c.y).toBeCloseTo(root.h / 2, 0);
  });

  it('the padded box stays inside the view (the club at the top and the ball are not cropped)', () => {
    const root = { w: 900, h: 800 }, ar = 9 / 16;
    const z = playerZoomFor(frames(), root, ar)!;
    const tl = drawn({ x: box.x0, y: box.y0 }, root, ar, z), br = drawn({ x: box.x1, y: box.y1 }, root, ar, z);
    expect(tl.x).toBeGreaterThanOrEqual(-0.5); expect(tl.y).toBeGreaterThanOrEqual(-0.5);
    expect(br.x).toBeLessThanOrEqual(root.w + 0.5); expect(br.y).toBeLessThanOrEqual(root.h + 0.5);
  });

  it('a clip that fills the view behaves as before', () => {
    const root = { w: 450, h: 800 }, ar = 450 / 800;
    const z = playerZoomFor(frames(), root, ar)!;
    const c = drawn(centre, root, ar, z);
    expect(c.x).toBeCloseTo(root.w / 2, 0);
    expect(c.y).toBeCloseTo(root.h / 2, 0);
  });

  it('an unknown clip shape is not zoomed (a guessed fit would slide the golfer away)', () => {
    expect(playerZoomFor(frames(), { w: 900, h: 800 }, null)).toBeNull();
  });
});
