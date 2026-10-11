/**
 * 2026-08-31 (adversarial pass over the break test) — I removed glasses from the root banner. This
 * pins that I did not ALSO remove its actual job.
 *
 * Tim: "we need to remove the glasses related banner from the top." Glasses are not in this release,
 * so the old glasses bridge was missing for every player on every launch (removed 2026-10-10), and the root-mounted banner
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
  it('never announces glasses — the bridge is gone, and no glasses module is probed or labelled', () => {
    expect(code).not.toMatch(/MetaWearables|glasses/i);
    expect(code).not.toMatch(/'Glasses live stream'/);
  });

  it('STILL warns about on-device pose, which is in the binary and is a real degradation', () => {
    expect(code).toMatch(/MediaPipePose/);
    expect(code).toMatch(/On-device pose/);
  });

  it('decides on what is missing, and renders nothing when nothing is', () => {
    expect(code).toMatch(/records\.filter\(\(r\) => !r\.loaded\)/);
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
