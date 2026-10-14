/**
 * 2026-10-13 (SmartVision/GPS audit #1) — the live GPS follow clamped every fix onto the hole image, so a
 * player off the hole (next tee, a parallel fairway, a different course than the one loaded) had the
 * cart pinned to the border and F/M/B, the spoken line and the club pick measured from where he was not.
 * Off the hole now clears the GPS-placed cart: the numbers fall back to the hole from the tee (SV-2).
 */
import fs from 'fs';
import path from 'path';

const sv = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'smartvision.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const follow = sv.slice(sv.indexOf('const clearFollowed = () =>'), sv.indexOf('const clearFollowed = () =>') + 2600);

describe('the GPS follow never pins the player to the edge of the picture', () => {
  it('satellite tile: an off-image fix clears the followed cart instead of clamping it', () => {
    expect(follow).toMatch(/if \(raw\.x < 0 \|\| raw\.x > imageW \|\| raw\.y < 0 \|\| raw\.y > imageH\) \{ clearFollowed\(\); return; \}/);
    expect(follow).not.toMatch(/canvasCoord = clampToCanvas\(\{ x: px\.x \+ imageW \/ 2/);
  });
  it('curated image: behind the tee, past the green or a parallel hole is not this hole', () => {
    expect(follow).toMatch(/if \(t < -0\.05 \|\| t > 1\.08 \|\| sideways > 70\) \{ clearFollowed\(\); return; \}/);
  });
  it('a cart he placed himself is never touched by the follow', () => {
    const effect = sv.slice(sv.lastIndexOf('useEffect(() => {', sv.indexOf('const clearFollowed')), sv.indexOf('const clearFollowed'));
    expect(effect).toMatch(/if \(userPlacedByHole\[holeKeyOf\(holeIndex\)\]\) return;/);
  });
});
