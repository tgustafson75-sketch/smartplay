/**
 * 2026-08-31 (adversarial pass over the break test) — I removed glasses from the root banner. This
 * pins that I did not ALSO remove its actual job.
 *
 * Tim: "we need to remove the glasses related banner from the top." Glasses are not in this release,
 * so MetaWearablesFrame is missing for every player on every launch, and the root-mounted banner
 * told all of them a feature they had never heard of was "unavailable on this build".
 *
 * The risk in that change is over-correction: filtering too broadly, or deleting the banner, would
 * silence a REAL degradation. MediaPipe pose IS in the binary; if it fails to load the player is on
 * the slower cloud path and deserves to know.
 */
import * as fs from 'fs';
import * as path from 'path';
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'NativeFallbackBanner.tsx'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('the top banner only warns about things the player actually has', () => {
  it('never announces glasses — not in this release, so its absence is expected, not a fallback', () => {
    expect(code).toContain('MetaWearablesFrame');          // named...
    expect(code).toContain('NOT_IN_THIS_RELEASE');         // ...as excluded
    expect(code).not.toMatch(/'Glasses live stream'/);     // and never labelled for display
  });

  it('STILL warns about on-device pose, which is in the binary and is a real degradation', () => {
    expect(code).toMatch(/MediaPipePose/);
    expect(code).toMatch(/On-device pose/);
  });

  it('the exclusion is applied to the DECISION, not just the label — otherwise it renders empty', () => {
    // The filter must remove glasses before the "is anything missing?" test, or a glasses-only
    // miss would render a banner with no labels in it.
    expect(code).toMatch(/records\.filter\(\(r\) => !r\.loaded && !NOT_IN_THIS_RELEASE\.has\(r\.id\)\)/);
    expect(code).toMatch(/if \(missing\.length === 0\) return null;/);
  });

  it('still renders nothing before any probe has reported — no cold-boot flash', () => {
    expect(code).toMatch(/records\.length === 0\) return null/);
  });

  it('is still dismissable', () => {
    expect(code).toMatch(/setDismissed\(true\)/);
    expect(code).toMatch(/if \(dismissed\) return null;/);
  });
});
