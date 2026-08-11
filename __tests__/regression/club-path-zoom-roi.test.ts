/**
 * 2026-08-10 (Tim, from an on-course swing) — "swing trace does not work. The club trace does not
 * work. It is not showing at all… you can see the club as easily as you can see the body… maybe we
 * need to put a Zoom where you can see if I put it back that far, which could happen on the course,
 * how do we then zoom in and take advantage?"
 *
 * He identified the fix himself, and his screenshot proves the diagnosis. In that frame the club is
 * unmistakable — a dark shaft and head against bright fairway — and the pose skeleton draws cleanly
 * on his body. But he fills roughly 15% of the frame height, because the phone sat well back and
 * low. The tracker then DOWNSCALED the whole frame to 640px before asking the model to find the
 * clubhead, leaving the head about SIX PIXELS across. Nothing finds a 6px object; the arc-shape
 * gates that had been tuned repeatedly were never the binding constraint.
 *
 * Same resolution ceiling as the satellite tiles earlier today, same fix: crop to what matters and
 * spend the pixels there. These lock the crop maths — especially that it can never clip the arc or
 * fire when it isn't needed.
 */
import { roiFromBodyBounds } from '../../services/swing/clubPath';

/** Tim's clip: player small and high in the frame, camera low and far back. */
const smallDistantPlayer = { minX: 0.44, minY: 0.21, maxX: 0.58, maxY: 0.33 };

describe("Tim's on-course clip: the zoom engages and frames the whole arc", () => {
  const roi = roiFromBodyBounds(smallDistantPlayer)!;

  it('produces a crop', () => {
    expect(roi).not.toBeNull();
  });

  it('magnifies substantially — the whole point of the change', () => {
    // Body was ~12% of frame height; inside the crop it must be a large fraction of it.
    const bodyH = smallDistantPlayer.maxY - smallDistantPlayer.minY;
    expect(bodyH / roi.h).toBeGreaterThan(0.3);
    // And the crop is much smaller than the full frame, which is where the pixels are won back.
    expect(roi.w * roi.h).toBeLessThan(0.35);
  });

  it('leaves room ABOVE the head for the top of the backswing', () => {
    expect(roi.y).toBeLessThan(smallDistantPlayer.minY);
    const headroom = smallDistantPlayer.minY - roi.y;
    expect(headroom).toBeGreaterThan((smallDistantPlayer.maxY - smallDistantPlayer.minY) * 0.5);
  });

  it('leaves room BOTH SIDES for the sweep through impact and finish', () => {
    expect(roi.x).toBeLessThan(smallDistantPlayer.minX);
    expect(roi.x + roi.w).toBeGreaterThan(smallDistantPlayer.maxX);
  });

  it('stays inside the frame', () => {
    expect(roi.x).toBeGreaterThanOrEqual(0);
    expect(roi.y).toBeGreaterThanOrEqual(0);
    expect(roi.x + roi.w).toBeLessThanOrEqual(1.0001);
    expect(roi.y + roi.h).toBeLessThanOrEqual(1.0001);
  });
});

describe('it must not fire when it would not help — or would hurt', () => {
  it('a player already filling the frame gets NO crop (cropping could clip the arc)', () => {
    expect(roiFromBodyBounds({ minX: 0.2, minY: 0.1, maxX: 0.8, maxY: 0.95 })).toBeNull();
  });

  it('null / degenerate bounds return null rather than a bogus crop', () => {
    expect(roiFromBodyBounds(null)).toBeNull();
    expect(roiFromBodyBounds({ minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 })).toBeNull();
    expect(roiFromBodyBounds({ minX: 0.6, minY: 0.6, maxX: 0.4, maxY: 0.4 })).toBeNull();
  });

  it('a player at the frame edge still yields a valid in-bounds crop', () => {
    const roi = roiFromBodyBounds({ minX: 0.02, minY: 0.02, maxX: 0.14, maxY: 0.2 })!;
    expect(roi).not.toBeNull();
    expect(roi.x).toBeGreaterThanOrEqual(0);
    expect(roi.y).toBeGreaterThanOrEqual(0);
    expect(roi.x + roi.w).toBeLessThanOrEqual(1.0001);
  });
});

describe('crop-space detections map back to full-frame coordinates', () => {
  // The renderer and every arc gate reason in FULL-FRAME space. A detection returned relative to
  // the crop must be mapped back, or the drawn arc lands in the wrong part of the picture.
  const roi = roiFromBodyBounds(smallDistantPlayer)!;
  const toFull = (p: { x: number; y: number }) => ({ x: roi.x + p.x * roi.w, y: roi.y + p.y * roi.h });

  it('crop centre maps to the crop\'s centre in full-frame terms', () => {
    const c = toFull({ x: 0.5, y: 0.5 });
    expect(c.x).toBeCloseTo(roi.x + roi.w / 2, 6);
    expect(c.y).toBeCloseTo(roi.y + roi.h / 2, 6);
  });

  it('mapped points always land inside the frame', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.3, y: 0.8 }]) {
      const f = toFull(p);
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x).toBeLessThanOrEqual(1.0001);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeLessThanOrEqual(1.0001);
    }
  });
});
