/**
 * 2026-09-01 (Tim, on a Galaxy Z Fold: "qr code doesn't size on fold z").
 *
 * The QR was `width: '100%'` on an Image inside a ScrollView contentContainer that ALSO declared
 * `width: '100%'`. When that percentage fails to resolve, the Image falls back to the asset's
 * intrinsic size, so the code rendered several times the screen width and was cropped. A cropped QR
 * does not scan — and this screen exists for a stranger to scan.
 *
 * A foldable also changes width WHILE OPEN, which a percentage resolved once at mount never sees.
 */
import fs from 'fs';
import path from 'path';
import { qrSizeFor } from '../../services/ownerCard';

const CARD_MAX_W = 460;

describe('the QR is sized in pixels from the live window width', () => {
  it('never exceeds the screen, at any width a real device reports', () => {
    // Fold cover screen, Fold unfolded, small phone, large phone, tablet.
    for (const w of [280, 320, 344, 360, 390, 412, 673, 768, 834, 1024, 1280]) {
      expect(qrSizeFor(w)).toBeLessThanOrEqual(w);
    }
  });

  it('THE REPORT: the Fold cover screen gets a code that fits', () => {
    const w = 344; // Z Fold cover display, dp
    expect(qrSizeFor(w)).toBeLessThanOrEqual(w);
    expect(qrSizeFor(w)).toBeGreaterThan(200);
  });

  it('stops growing once the card hits its max width', () => {
    expect(qrSizeFor(1280)).toBe(qrSizeFor(CARD_MAX_W));
    expect(qrSizeFor(900)).toBe(qrSizeFor(CARD_MAX_W));
  });

  it('never collapses below a scannable floor, even on an absurd width', () => {
    for (const w of [0, 1, 60, 120]) expect(qrSizeFor(w)).toBeGreaterThanOrEqual(140);
  });

  it('grows with the screen up to the cap — it is responsive, not fixed', () => {
    expect(qrSizeFor(412)).toBeGreaterThan(qrSizeFor(320));
  });

  it('is always a whole number of pixels', () => {
    for (const w of [281, 333.5, 411.42]) expect(Number.isInteger(qrSizeFor(w))).toBe(true);
  });
});

describe('the screen actually uses it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app/owner-card.tsx'), 'utf8');

  it('reads the LIVE window width so folding re-lays-out', () => {
    expect(src).toMatch(/useWindowDimensions\(\)/);
    expect(src).toMatch(/qrSizeFor\(windowWidth\)/);
  });

  it('applies explicit pixels to the Image', () => {
    expect(src).toMatch(/style=\{\[styles\.qr, \{ width: qrSize, height: qrSize \}\]\}/);
  });

  it('no percentage width survives on the QR or the content container', () => {
    expect(src).not.toMatch(/qr: \{ width: '100%'/);
    expect(src).not.toMatch(/card: \{[^}]*width: '100%'/);
  });
});
