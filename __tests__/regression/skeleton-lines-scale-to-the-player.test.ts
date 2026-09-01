/**
 * 2026-08-31 (Tim, after an on-course analysis: "the lines for body mechanics are a little thick —
 * they don't adjust to the size of the person or how far away you are. So if you're eight feet away
 * or six feet away, the line's kind of over the player").
 *
 * The stroke was a fixed 0.8% of the FRAME. Filmed close that reads as a fine line; filmed from six
 * or eight feet the player is half the size and the line is unchanged, so it stops tracing the body
 * and starts covering it. The thickness was never wrong — it was measured against the wrong thing.
 *
 * Shoulder width is the reference because it is the best available proxy for distance: nearly
 * constant through a swing (unlike a bounding box, which grows the moment the arms and club go
 * overhead) and it shrinks exactly as the player moves away.
 */
import * as fs from 'fs';
import * as path from 'path';
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components/swinglab/SwingBodyOverlay.tsx'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

/**
 * 2026-08-31, second pass — THE REAL FUNCTION, not a copy of it.
 *
 * The first version of this file mirrored the arithmetic here because the component is JSX and the
 * logic project cannot import it. That test would have passed even if the shipped component said
 * something different, which is the definition of a test proving nothing. The maths now lives in
 * services/swing/overlayScale, the component calls it, and so does this.
 */
import { strokeForSubject } from '../../services/swing/overlayScale';
const strokeFor = (shoulderPx: number | null, strokeBase: number) => strokeForSubject(shoulderPx, strokeBase);

describe('the skeleton is drawn at the scale of the player', () => {
  /** strokeBase is max(frameW, frameH) — a portrait 1080x1920 clip. */
  const FRAME = 1920;
  /** What the stroke used to be, at every distance, regardless of the player. */
  const OLD = FRAME * 0.008;

  it('THE REPORT: a player further away gets a thinner line', () => {
    const close = strokeFor(300, FRAME);   // typical framing
    const mid = strokeFor(200, FRAME);     // ~six feet
    const far = strokeFor(150, FRAME);     // ~eight feet — the case reported
    expect(close).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it('the line stays a constant FRACTION of the player between the clamps — which is the point', () => {
    for (const shoulder of [150, 200, 250, 300]) {
      const ratio = strokeFor(shoulder, FRAME) / shoulder;
      expect([shoulder, Math.abs(ratio - 0.04) < 0.0001]).toEqual([shoulder, true]);
    }
  });

  it('is NEVER thicker than the line he called too thick', () => {
    for (const shoulder of [90, 150, 200, 300, 500, 900]) {
      expect([shoulder, strokeFor(shoulder, FRAME) <= OLD + 1e-9]).toEqual([shoulder, true]);
    }
  });

  it('at eight feet it is roughly HALF what it was — the actual complaint', () => {
    expect(strokeFor(150, FRAME)).toBeLessThan(OLD * 0.55);
  });

  it('the old behaviour was the bug: a fixed fraction of the frame ignored the player entirely', () => {
    // At eight feet the old line covered twice the share of the player it did up close.
    expect(OLD / 150).toBeGreaterThan((OLD / 300) * 1.9);
    // The new one covers the same share at both.
    expect(strokeFor(150, FRAME) / 150).toBeCloseTo(strokeFor(300, FRAME) / 300, 4);
  });

  it('clamps at both ends so a bad pose read can never hide the swing or vanish', () => {
    expect(strokeFor(5, FRAME)).toBeGreaterThanOrEqual(FRAME * 0.0022);
    expect(strokeFor(100000, FRAME)).toBeLessThanOrEqual(FRAME * 0.008);
    expect(Number.isFinite(strokeFor(null, FRAME))).toBe(true);
  });

  it('falls back through shoulders → bbox → the old frame value, never to nothing', () => {
    expect(code).toMatch(/shoulderSpan/);
    expect(code).toMatch(/left_shoulder/);
    expect(code).toMatch(/right_shoulder/);
    expect(code).toMatch(/\?\? \(bbox \?/);
    expect(code).toMatch(/\?\? strokeBase \* 0\.06/);
    // The arithmetic itself lives in the shared module the component and this test BOTH call — so
    // the component must delegate rather than carry its own copy.
    expect(code).toMatch(/strokeForSubject\(subjectSpan, strokeBase\)/);
    expect(code).not.toMatch(/subjectSpan \* 0\.0\d/);
    const scale = fs.readFileSync(path.join(__dirname, '..', '..', 'services/swing/overlayScale.ts'), 'utf8');
    expect(scale).toMatch(/STROKE_PER_SHOULDER = 0\.04/);
    // The ceiling is the OLD constant on purpose: never thicker than the line he called too thick.
    expect(scale).toMatch(/MAX_FRACTION = 0\.008/);
  });

  it('joint dots shrink with the lines they sit on', () => {
    expect(code).toMatch(/const dotR = sw;/);
  });
});
