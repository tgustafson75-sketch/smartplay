/**
 * 2026-09-20 — THE PREFETCH WROTE TILES NOBODY COULD READ: the cache key embedded the request size,
 * round prep asked for 600x500 and SmartVision for its container, so no prefetched tile was ever
 * found. The fix then was "on an exact miss, serve any cached tile of the same hole".
 *
 * 2026-09-23 (Tim — "I get SmartVision images correctly every time") — that fallback was served IN
 * PLACE of the live tile, online or not, while SmartVision projected its markers and tapped yardages
 * with the frame of the tile it had asked for. A tile of another size or older geometry was drawn
 * under markers computed for a different picture. Now every tile carries its frame (in its file
 * name), the live tile leads, and a cached one is the fallback — projected with its OWN frame.
 *
 * Behavioural, through an in-memory file system.
 */
const mockFiles = new Map<string, Uint8Array>();
jest.mock('expo-file-system', () => {
  const join = (dir: string, name: string) => `${dir}/${name}`;
  class File {
    uri: string;
    constructor(dir: string, name: string) { this.uri = join(dir, name); }
    get exists() { return mockFiles.has(this.uri); }
    write(b: Uint8Array) { mockFiles.set(this.uri, b); }
    delete() { mockFiles.delete(this.uri); }
  }
  class Directory {
    constructor(private dir: string) {}
    list() { return [...mockFiles.keys()].filter((k) => k.startsWith(`${this.dir}/`)).map((uri) => ({ uri })); }
  }
  return { File, Directory, Paths: { cache: 'file:///cache' } };
});

import {
  fetchHoleImagery, frameForHole, tileFileName, frameFromFileName, displayFrame, prefetchHoles,
  rememberTileSize, type HoleImageryInput,
} from '../../services/mapboxImagery';

const HOLE: HoleImageryInput = {
  courseId: 'local:palms', holeNumber: 3, par: 4, yardage: 380,
  tee: { lat: 33.6800, lng: -117.1800 }, green: { lat: 33.6830, lng: -117.1790 },
};
const SCREEN = { width: 412, height: 700 };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockFiles.clear();
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
});

describe('a SmartVision tile always comes with the frame it was drawn in', () => {
  it('a tile\'s file name is its frame, and reads back exactly', () => {
    const f = frameForHole(HOLE, SCREEN)!;
    expect(frameFromFileName(tileFileName(HOLE.courseId, 3, f))).toEqual(f);
  });

  it('nothing cached: the live URL leads, with its frame, and the exact file is written for next time', async () => {
    const t = await fetchHoleImagery(HOLE, SCREEN);
    expect(t?.uri).toMatch(/^https:\/\/api\.mapbox\.com\//);
    expect(t?.frame).toEqual(frameForHole(HOLE, SCREEN));
    expect(t?.fallback).toBeNull();
    await flush(); await flush();
    const again = await fetchHoleImagery(HOLE, SCREEN);
    expect(again?.uri).toMatch(/^file:\/\/\/cache\//);
    expect(again?.frame).toEqual(t?.frame);
  });

  it('a prefetched tile of the same hole geometry at another size LEADS, with its own frame; live waits behind it', async () => {
    await prefetchHoles([HOLE]);               // round prep at the default 600x500
    await flush(); await flush();
    const t = await fetchHoleImagery(HOLE, SCREEN);
    expect(t?.uri).toMatch(/^file:/);           // on a weak link a correct picture now, not a blank canvas
    expect(t?.frame.width).toBe(600);           // ...projected with the frame it was drawn in
    expect(t?.frame.center).toEqual(frameForHole(HOLE, SCREEN)?.center);
    expect(t?.fallback?.uri).toMatch(/^https:/);
  });

  it('a cached tile that would crop the hole in THIS box (folded→unfolded, old scale) does not lead', async () => {
    // Cached for a tall portrait box, then asked for a wide one: cover would crop the hole's length.
    await fetchHoleImagery(HOLE, { width: 400, height: 900 });
    await flush(); await flush();
    const t = await fetchHoleImagery(HOLE, { width: 1200, height: 700 });
    expect(t?.uri).toMatch(/^https:/);
    expect(t?.fallback?.uri).toMatch(/^file:/);
  });

  it('fractional screen sizes (Android dp) still make readable, whole-pixel tiles', () => {
    const f = frameForHole(HOLE, { width: 411.42857142857144, height: 700.5 })!;
    expect([f.width, f.height]).toEqual([411, 701]);
    expect(frameFromFileName(tileFileName(HOLE.courseId, 3, f))).toEqual(f);
  });

  it('once SmartVision has measured itself, round prep caches the size it will ask for', async () => {
    rememberTileSize(SCREEN.width, SCREEN.height);
    await prefetchHoles([HOLE]);
    await flush(); await flush();
    const t = await fetchHoleImagery(HOLE, SCREEN);
    expect(t?.uri).toMatch(/^file:/);
  });

  it('a hole whose geometry changed is never served its old picture as current, and the old one goes', async () => {
    await fetchHoleImagery(HOLE, SCREEN);
    await flush(); await flush();
    const moved = { ...HOLE, green: { lat: 33.6840, lng: -117.1785 } };
    const t = await fetchHoleImagery(moved, SCREEN);
    expect(t?.uri).toMatch(/^https:/);                  // the new frame, live
    expect(t?.fallback?.uri).toMatch(/^file:/);         // the old picture only if the live one fails
    expect(t?.fallback?.frame.center).not.toEqual(t?.frame.center);
    await flush(); await flush();
    const names = [...mockFiles.keys()].filter((k) => k.includes('_h3_'));
    expect(names).toHaveLength(1);
    expect(frameFromFileName(names[0])?.center).toEqual(t?.frame.center);
  });

  it('one hole\'s tiles never serve another hole or another course', async () => {
    await fetchHoleImagery(HOLE, SCREEN);
    await flush(); await flush();
    expect((await fetchHoleImagery({ ...HOLE, holeNumber: 4 }, SCREEN))?.fallback).toBeNull();
    expect((await fetchHoleImagery({ ...HOLE, courseId: 'local:lakes' }, SCREEN))?.fallback).toBeNull();
  });

  it('drawn with cover, a tile projects at its own centre and bearing, zoomed by the cover scale', () => {
    const f = { center: { lat: 1, lng: 2 }, zoom: 16, bearing: 30, width: 600, height: 500 };
    expect(displayFrame(f, 600, 500)).toEqual({ center: f.center, zoom: 16, bearing: 30 });
    expect(displayFrame(f, 1200, 1000).zoom).toBeCloseTo(17, 6);
    expect(displayFrame(f, 600, 1000).zoom).toBeCloseTo(17, 6);   // taller box: cover scales by height
  });
});

describe('SmartVision projects with the frame of the tile on screen', () => {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  const sv = fs.readFileSync(path.join(__dirname, '../../app/smartvision.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('the projection is the displayed tile\'s frame, not one recomputed from coordinates', () => {
    const proj = sv.slice(sv.indexOf('const projection = useMemo'), sv.indexOf('const projection = useMemo') + 300);
    expect(proj).toMatch(/displayFrame\(tileFrame, imageW, imageH\)/);
    expect(sv).not.toMatch(/computeFitView\(/);
  });

  it('every tile SmartVision draws is set together with its frame', () => {
    expect(sv.match(/setImageUriState\(/g)).toHaveLength(1);   // only inside showTile
    expect(sv).toMatch(/setImageUriState\(uri\);\s*setTileFrame\(uri \? frame : null\);/);
    expect(sv).not.toMatch(/\bsetImageUri\(/);
  });

  it('a live tile that fails to load falls back to the cached one with ITS frame', () => {
    expect(sv).toMatch(/onError=\{onTileError\}/);
    expect(sv).toMatch(/if \(fb && fb\.uri !== imageUri\) \{ showTile\(fb\.uri, fb\.frame\); return; \}/);
    // then ONE retry of the live tile, then the honest no-signal state (Tim: "no error states ever")
    expect(sv).toMatch(/tileRetriedRef\.current !== imageUri/);
    expect(sv).toMatch(/setTileFailed\(true\);/);
  });

  it('with no hole coordinates, the aerial is centred on THIS course by its id — never a name guess', () => {
    const blk = sv.slice(sv.indexOf('const NEAR_COURSE_KM') - 1500, sv.indexOf('const NEAR_COURSE_KM'));
    expect(blk).toMatch(/const slug = localSlugFromCourseId\(courseId\);/);
    expect(blk).not.toMatch(/resolveLocalSlug\(courseId, courseName\)/);
  });

  it('tile mode (tapped yardages, voice marks read off the markers) needs a KNOWN tee and green', () => {
    expect(sv).toMatch(/const usingGpsTile = projection != null && !!imageUri && !!teeCoord && !!greenCoord;/);
  });

  it('the caddie preview forgets failures per hole and never retries a tile and fallback that both failed', () => {
    const l1 = fs.readFileSync(path.join(__dirname, '../../components/caddie/L1HolePreview.tsx'), 'utf8');
    expect(l1).toMatch(/setFailedTileUri\(new Set\(\)\); \}, \[activeCourseId, currentHole, previewCourseId_resolved\]\)/);
    expect(l1).toMatch(/t\.fallback && !failedTileUri\.has\(t\.fallback\.uri\) \? t\.fallback\.uri : null/);
  });
});
