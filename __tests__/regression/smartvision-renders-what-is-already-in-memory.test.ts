/**
 * 2026-09-05 (Tim, from the course) — "I did see the cart location move today in the primary caddie
 * tab view but when I tapped SmartVision got the loading green screen delay."
 *
 * The caddie tab was already rendering a moving cart, so the geometry was warm in memory. SmartVision
 * then showed its loading canvas anyway, because `loading` was not cleared until an entirely async
 * chain finished: a geometry fetch, an AsyncStorage read of previously-derived greens, and — the
 * expensive one — a live api/hole-scan VISION DERIVE for any hole whose geometry has no green. A
 * network round-trip to a vision model, with the player watching a blank canvas, for data the app
 * already had.
 *
 * Nothing on the fast path needs to wait: getHoleGeometry reads the warm cache synchronously,
 * getCenteredImageryUrl only builds a URL string, and the curated lookups are bundled-asset reads.
 *
 * THE OTHER HALF, and the reason this test exists rather than just the fix: clearing `loading`
 * early is gated on REAL GEOMETRY. The `{!loading && ...}` marker gate is Fix DJ (2026-05-26) —
 * without it the T/P/Y markers paint at default positions and snap to the right ones a moment
 * later, a flicker visible on every hole switch. A curated photo alone would drop the loading state
 * with no geometry behind it: right picture, wrong markers. Worse than waiting.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', 'smartvision.tsx'),
  'utf8',
);
// Strip comments first — this screen documents its own history heavily, and the prose names the
// very symbols a naive match would look for.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('SmartVision renders what is already in memory', () => {
  it('reads the warm geometry cache BEFORE the async block, not inside it', () => {
    // Scoped to this effect deliberately: `await` appears many times earlier in the file, so a
    // whole-file comparison would pass or fail for unrelated reasons.
    const effect = code.indexOf('setGeometry(null);');
    // Anchored on the assignment, not the prefix: 'const warmGeo' alone also matches
    // 'const warmGeoRemoved', so a break-test that deleted the fast path still passed.
    const fastPath = code.indexOf('const warmGeo = courseId ? getHoleGeometry(', effect);
    const asyncBlock = code.indexOf('void (async () =>', effect);
    expect(effect).toBeGreaterThan(-1);
    expect(fastPath).toBeGreaterThan(-1);
    expect(asyncBlock).toBeGreaterThan(-1);
    expect(fastPath).toBeLessThan(asyncBlock);
    // ...and it must actually consult the warm cache, not just declare a variable.
    expect(code.slice(effect, asyncBlock)).toMatch(/getHoleGeometry\(courseId, holeIndex\)/);
  });

  it('can clear the loading state without awaiting anything', () => {
    // The regression was that EVERY exit from loading sat behind the async IIFE.
    expect(code).toMatch(/const warmEnough = !!warmGeo\?\.green;/);
    expect(code).toMatch(/warmCurated && warmEnough[\s\S]{0,200}?setLoading\(false\)/);
  });

  it('but ONLY with real geometry — a curated photo alone must not drop the gate', () => {
    // Fix DJ. If this weakens, markers paint at default positions and snap.
    const curatedBranch = /if \(warmCurated( && warmEnough)?\)/.exec(code);
    expect(curatedBranch).not.toBeNull();
    expect(curatedBranch![1]).toBe(' && warmEnough');
  });

  it('the marker gate it protects is still in place', () => {
    expect(code).toMatch(/\{!loading && \(/);
  });

  it('the URL builder used on the fast path is synchronous', () => {
    // If getCenteredImageryUrl ever becomes async, the fast path silently stops being fast.
    const imagery = fs.readFileSync(
      path.join(__dirname, '..', '..', 'services', 'mapboxImagery.ts'),
      'utf8',
    );
    expect(imagery).toMatch(/export function getCenteredImageryUrl/);
    expect(imagery).not.toMatch(/export async function getCenteredImageryUrl/);
  });
});
