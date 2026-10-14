/**
 * 2026-10-13 (course sweep) — with no tee to anchor it, the build gave each hole "the green nearest the
 * previous green": a walk of the routing from the clubhouse. Measured against OSM's numbered holes it put
 * 17 of 18 greens on the wrong hole at Hemet Golf Club AND at Green Hill (Worcester) — and it is what runs
 * whenever Overpass fails the numbered-holes query. No anchor now means no green (and no tee).
 */
import fs from 'fs';
import path from 'path';
const src = fs.readFileSync(path.join(__dirname, '../../api/course-geometry.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no anchor, no green', () => {
  it('a green is chosen from the tee by card yardage, or not at all', () => {
    expect(src).toMatch(/const idx = h\.tee \? bestByTargetYards\(h\.tee, osmGreens, usedGreens, h\.yardage\) : -1;/);
    expect(src).not.toMatch(/: nearestUnassigned\(anchor, osmGreens, usedGreens\)/);
  });
  it('a tee is chosen from the green by card yardage, or not at all', () => {
    expect(src).toMatch(/const idx = h\.green \? bestByTargetYards\(h\.green, osmTees, usedTees, h\.yardage\) : -1;/);
    expect(src).not.toMatch(/: nearestUnassigned\(teeAnchor, osmTees, usedTees\)/);
  });
});
