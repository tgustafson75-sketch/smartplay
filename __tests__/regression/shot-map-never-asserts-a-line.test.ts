/**
 * 2026-08-26 (adversarial pass) — THE SHOT MAP DREW A STRAIGHT SHOT IT NEVER MEASURED.
 *
 * `lateral` collapsed two different states onto 0: a trace that measured ON LINE, and NO TRACE AT
 * ALL. The dot was plotted dead centre either way, so a swing whose launch direction was never read
 * appeared as a ball hit straight down the middle. The DIRECTION stat said "—" honestly while the
 * dot — the thing the eye actually reads — said the opposite.
 *
 * The file's own header promises exactly the reverse: "with no read the field shows an empty state,
 * never a fabricated dot" and "No fabricated data: every number traces to a real measurement". A
 * comment claiming the opposite of the code, which is the tell.
 *
 * Asserted on the SOURCE because the honest/dishonest cases differ only in which JSX branch renders
 * — a render test would have to distinguish a centred dot from a centred band, which is exactly the
 * ambiguity that let this sit.
 */
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

describe('the shot map never asserts a line it did not read', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../components/smartmotion/ShotMapPage.tsx'), 'utf-8',
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

  it('distinguishes "measured on line" from "never read"', () => {
    expect(code).toMatch(/const lateralKnown = trace != null/);
  });

  it('the dot is drawn ONLY when the line was actually read', () => {
    // the positioned marker (left: 50% + lateral) must sit inside the lateralKnown branch
    const at = code.indexOf('lateralKnown ? (');
    expect(at).toBeGreaterThan(-1);
    const branch = code.slice(at, code.indexOf(') : (', at));
    expect(branch).toContain('styles.ballDot');
    expect(branch).toMatch(/left: `\$\{50 \+ lateral \* 38\}%`/);
  });

  it('an unread line renders a band across the field, not a point on the centre', () => {
    const at = code.indexOf('styles.distanceBand');
    expect(at).toBeGreaterThan(-1);
    const window = code.slice(at, at + 400);
    expect(window).toContain('line not read');
    // a band spans the field; it must not carry a lateral offset
    expect(window).not.toContain('lateral * 38');
  });

  it('the DIRECTION stat says what it means rather than a bare dash', () => {
    expect(code).toContain("dirLabel ?? 'not read'");
  });
});
