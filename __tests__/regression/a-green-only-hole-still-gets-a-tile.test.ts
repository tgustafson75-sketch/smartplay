/**
 * 2026-09-20 (Tim, from Echo Hills) — "Echo hills hole views did not load in smartvision."
 *
 * Echo Hills has nine greens and, at runtime, ZERO tees — validateBundledTees drops all of them
 * because each measured ~150y to the green whatever the card said. buildTileInputs required BOTH a
 * tee and a green, so it returned an empty array, the caller logged "mapbox skipped", and not one
 * tile was ever cached for the course. On a weak signal that is a blank hole view.
 *
 * The prefetcher was STRICTER THAN THE RENDERER IT FEEDS. getHoleImageryUrl degrades a missing tee
 * to null and centres on the green; fetchHoleImagery caches exactly that. A green-only hole was
 * always renderable — it was only ever refused a cached copy. [[two-owners-is-the-root-cause]]
 *
 * These assert the PROPERTY (a green is sufficient) and the ABSENCE of the broken form (requiring a
 * tee), because pinning the new expression alone would go green on any rewrite.
 * [[a-guard-can-assert-the-broken-shape]]
 */
import * as fs from 'fs';
import * as path from 'path';
import { getHoleImageryUrl } from '../../services/mapboxImagery';
import { getBundledHoles } from '../../data/courses';

const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const prefetch = strip(
  fs.readFileSync(path.join(__dirname, '../../services/roundPrefetch.ts'), 'utf8'),
);

describe('a hole with a green but no tee still gets imagery', () => {
  it('the imagery layer builds a URL from a green alone', () => {
    const url = getHoleImageryUrl(
      { courseId: 'local:x', holeNumber: 1, par: 4, yardage: 350,
        tee: null, green: { lat: 33.725522, lng: -116.96312606 } },
      { width: 600, height: 600 },
    );
    expect(url).toBeTruthy();
    expect(url).toContain('api.mapbox.com');
  });

  it('a 0,0 green is still refused — the null-island regression stays fixed', () => {
    const url = getHoleImageryUrl(
      { courseId: 'local:x', holeNumber: 1, par: 4, yardage: 350, tee: null, green: { lat: 0, lng: 0 } },
      { width: 600, height: 600 },
    );
    expect(url).toBeNull();
  });

  it('the prefetcher does not require a tee', () => {
    expect(prefetch).not.toMatch(/if \(!tee \|\| !green\) return null;/);
    expect(prefetch).toMatch(/if \(!green \|\| !isValidGolfCoord\(green\.lat, green\.lng\)\) return null;/);
  });

  it('Echo Hills — the course that exposed this — has greens and no tees', () => {
    const holes = getBundledHoles('local:echo-hills');
    expect(holes.length).toBe(9);
    const greens = holes.filter((h) => Math.abs(h.middleLat) > 0.001 && Math.abs(h.middleLng) > 0.001);
    const tees = holes.filter((h) => Math.abs(h.teeLat) > 0.001 && Math.abs(h.teeLng) > 0.001);
    expect(greens.length).toBe(9);
    expect(tees.length).toBe(0);
    // ...and every one of those greens must now yield a tile URL, or the course is blank again.
    for (const h of holes) {
      const url = getHoleImageryUrl(
        { courseId: 'local:echo-hills', holeNumber: h.hole, par: h.par, yardage: h.distance,
          tee: null, green: { lat: h.middleLat, lng: h.middleLng } },
        { width: 600, height: 600 },
      );
      expect(url).toBeTruthy();
    }
  });
});
