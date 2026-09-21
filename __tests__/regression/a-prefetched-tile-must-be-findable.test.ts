/**
 * 2026-09-20 (found while triple-checking the Echo Hills fix) — THE PREFETCH WROTE TILES NOBODY
 * COULD READ, and it had been that way for every course, not just Echo Hills.
 *
 * The cache key embeds the requested WIDTH and HEIGHT plus a zoom computed from them:
 *   mapbox_holes_<course>_h<hole>_z<zoom>_<w>x<h>.png
 *
 * roundPrefetch calls `prefetchHoles(tileInputs)` with NO options, so every prefetched tile landed
 * at the 600x500 default. app/smartvision requests the CONTAINER size (screen width x available
 * height, capped 1280), which is never 600x500 on a real handset. The keys could not match, so the
 * whole offline imagery story was inert — tiles downloaded during round prep, written to disk, and
 * then looked for under a different name.
 *
 * That is the larger half of "hole views did not load in smartvision": the green-only prefetch fix
 * earlier the same day was necessary and, alone, still would not have put a tile on screen.
 *
 * The fix is in the LOOKUP, not in what either side requests, because smartvision's request size is
 * what keeps the tile aspect equal to the container's (Phase 401 — so `cover` cannot crop the
 * hole), and that screen is under a layout freeze.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const imagery = fs.readFileSync(path.join(ROOT, 'services/mapboxImagery.ts'), 'utf8');
const prefetch = fs.readFileSync(path.join(ROOT, 'services/roundPrefetch.ts'), 'utf8');
const smartvision = fs.readFileSync(path.join(ROOT, 'app/smartvision.tsx'), 'utf8');

describe('a prefetched tile must be findable by the screen that renders it', () => {
  it('the two sides really do request different sizes — the premise of this guard', () => {
    // If someone later makes them agree, these assertions should be revisited, not deleted:
    // the fallback would then be belt-and-braces rather than the only thing making prefetch work.
    expect(prefetch).toMatch(/prefetchHoles\(tileInputs\)/);          // no options → the default
    expect(imagery).toMatch(/options\.width \?\? 600/);
    expect(imagery).toMatch(/options\.height \?\? 500/);
    expect(smartvision).toMatch(/fetchHoleImagery\(holeInput, \{ width: reqW, height: reqH \}\)/);
  });

  it('an exact-size miss falls back to any cached tile of the same hole', () => {
    expect(imagery).toMatch(/function cachedTileForHole/);
    // ...and the fallback is actually RETURNED, not merely computed.
    expect(imagery).toMatch(/return alt \?\? url;/);
    const fn = imagery.slice(imagery.indexOf('export async function fetchHoleImagery'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toMatch(/const alt = cachedTileForHole\(input\.courseId, input\.holeNumber\)/);
    // The exact-size copy must still be written, or the next view is permanently reframed.
    expect(body).toMatch(/cacheFile\.write\(new Uint8Array\(buf\)\)/);
  });

  it('the lookup keys on course AND hole, so one hole cannot serve another', () => {
    const fn = imagery.slice(imagery.indexOf('function cachedTileForHole'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toMatch(/\$\{CACHE_DIR_NAME\}_\$\{safeCourseKey\(courseId\)\}_h\$\{holeNumber\}_z/);
    expect(body).toMatch(/startsWith\(prefix\)/);
  });

  it('a directory listing failure is a cache miss, never an exception', () => {
    const fn = imagery.slice(imagery.indexOf('function cachedTileForHole'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toMatch(/catch \{[\s\S]*return null;/);
  });

  it('a fresh write invalidates the memoized listing', () => {
    // Otherwise the first tile written in a session stays invisible for the TTL.
    expect(imagery).toMatch(/cacheListing = null;/);
  });
});
