/**
 * 2026-09-06 — the double-check that caught a bug I had already pushed.
 *
 * Wiring the ROI crop into pose detection (so the golfer is not a small subject in an acre of 4K
 * fairway) means detections come back in CROP space and have to be mapped to full frame. I wrote one
 * formula. There are two coordinate spaces.
 *
 * `normalizeKeypoints` in services/poseAnalysisApi.ts passes x/y through RAW — it does not normalise,
 * despite the name — so a pose backend may return 0..1 fractions OR pixels.
 * components/swinglab/SwingBodyOverlay carries `coordsAreNormalized()` for exactly that reason, which
 * is the evidence both occur in the field.
 *
 *   normalized → the crop is a sub-rectangle of the unit square:  x = roi.x + k.x * roi.w
 *   pixels     → the crop was CUT, not resized, so a crop pixel is offset from a full pixel:
 *                                                                 x = roi.x * width + k.x
 *
 * Applying the normalized formula to pixel coords gives 0.2 + 340*0.5 = 170.2 — off-frame nonsense,
 * and the skeleton would be drawn there with total confidence. A wrong skeleton is worse than none;
 * that is the whole reason the overlay refuses to draw outside its pose window in the first place.
 *
 * These lock the arithmetic, in both spaces, including the round trip.
 */

type Roi = { x: number; y: number; w: number; h: number };
type Kp = { x: number; y: number };

/** The mapping as implemented in poseAtTime. Mirrored here because the real one sits inside an async
 *  function that does native frame extraction and a network call — unreachable from a unit test. The
 *  structural assertions at the bottom are what keep this copy honest. */
function mapBack(kps: Kp[], roi: Roi, width: number, height: number): Kp[] {
  const maxCoord = kps.reduce((m, k) => Math.max(m, Math.abs(k.x), Math.abs(k.y)), 0);
  const isNormalized = maxCoord <= 1.5;
  return kps.map(k => (
    isNormalized
      ? { x: roi.x + k.x * roi.w, y: roi.y + k.y * roi.h }
      : { x: roi.x * width + k.x, y: roi.y * height + k.y }
  ));
}

const ROI: Roi = { x: 0.20, y: 0.10, w: 0.50, h: 0.60 };
const W = 2160, H = 3840;   // Tim's Fold clip, portrait after rotation

describe('normalized detections map back to full frame', () => {
  it('the centre of the crop lands at the centre of the crop rect', () => {
    const [p] = mapBack([{ x: 0.5, y: 0.5 }], ROI, W, H);
    expect(p.x).toBeCloseTo(0.20 + 0.5 * 0.50, 6);  // 0.45
    expect(p.y).toBeCloseTo(0.10 + 0.5 * 0.60, 6);  // 0.40
  });

  it('the crop corners land on the roi corners', () => {
    const [tl, br] = mapBack([{ x: 0, y: 0 }, { x: 1, y: 1 }], ROI, W, H);
    expect([tl.x, tl.y]).toEqual([0.20, 0.10]);
    expect(br.x).toBeCloseTo(0.70, 6);
    expect(br.y).toBeCloseTo(0.70, 6);
  });

  it('everything stays inside the frame', () => {
    for (const p of mapBack([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }], ROI, W, H)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('PIXEL detections map back too — the case that was wrong', () => {
  it('a crop pixel is offset by the crop origin, not scaled', () => {
    // A keypoint 340px into a crop whose origin is 0.20*2160 = 432px → 772px in the full frame.
    const [p] = mapBack([{ x: 340, y: 500 }], ROI, W, H);
    expect(p.x).toBeCloseTo(0.20 * W + 340, 6);   // 772
    expect(p.y).toBeCloseTo(0.10 * H + 500, 6);   // 884
  });

  it('the naive normalized formula would have put it off-frame', () => {
    // The bug, stated as a number: 0.2 + 340*0.5 = 170.2 in a space whose max is 1.
    const wrong = ROI.x + 340 * ROI.w;
    expect(wrong).toBeCloseTo(170.2, 3);
    const [right] = mapBack([{ x: 340, y: 500 }], ROI, W, H);
    expect(right.x).not.toBeCloseTo(wrong, 1);
    expect(right.x).toBeLessThanOrEqual(W);
  });

  it('pixel results stay inside the pixel frame', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1000, y: 2000 }];
    for (const p of mapBack(pts, ROI, W, H)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(H);
    }
  });

  it('the 1.5 threshold matches the overlay, so the two never disagree', () => {
    // A legitimately normalized coord of 1.0 must NOT be read as pixels.
    const [p] = mapBack([{ x: 1.0, y: 1.0 }], ROI, W, H);
    expect(p.x).toBeCloseTo(0.70, 6);
    // ...and a small pixel value above the threshold must be.
    const [q] = mapBack([{ x: 2, y: 2 }], ROI, W, H);
    expect(q.x).toBeCloseTo(0.20 * W + 2, 6);
  });
});

describe('the implementation still matches this mirror', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../services/poseAnalysisApi.ts'), 'utf8') as string;

  it('detects the coordinate space rather than assuming', () => {
    expect(src).toContain('const isNormalized = maxCoord <= 1.5;');
  });

  it('carries BOTH formulas', () => {
    expect(src).toContain('x: roi.x + k.x * roi.w');
    expect(src).toContain('x: roi.x * (width ?? 0) + k.x');
  });

  it('bounds detection also handles pixel coords instead of discarding them', () => {
    // The lifted helper dropped anything outside 0..1, which on a pixel backend rejected every
    // keypoint and silently disabled the zoom retry.
    expect(src).toContain('const px = maxCoord > 1.5;');
    expect(src).toContain('const nx = px ? k.x / fw : k.x;');
  });
});
