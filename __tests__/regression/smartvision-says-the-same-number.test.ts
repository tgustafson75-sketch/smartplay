/**
 * 2026-10-13 (SmartVision/GPS audit #5) — SmartVision measured its own F/M/B (no declared pin, no stated
 * yardage, its own edges), so the strip, SmartVision and the caddie's voice could give three numbers at
 * once. With the cart where GPS put him, it shows the resolver's answer; a cart he placed is a what-if.
 */
import fs from 'fs';
import path from 'path';
const sv = fs.readFileSync(path.join(__dirname, '../../app/smartvision.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('SmartVision says the same number as every other surface', () => {
  it('GPS-placed on his current hole → the resolver; placed by hand → the marker measurement', () => {
    expect(sv).toMatch(/const followedByGps = isRoundActive && holeIndex === currentHole && !userPlacedByHole\[holeKey\];/);
    expect(sv).toMatch(/if \(followedByGps\) \{\s*const f = resolvedToFmb\(resolveYardage\(currentHole\)\);[\s\S]{0,140}return \{ front: f\.front, middle: f\.middle, back: f\.back \};\s*\}\s*return markerYardages;/);
  });
  it('every readout and the spoken line read `yardages`, not the raw marker numbers', () => {
    const uses = sv.match(/markerYardages/g) ?? [];
    expect(uses.length).toBe(3);   // declaration, fallback return, deps
  });
});
