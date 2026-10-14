/**
 * 2026-10-13 (Tim — "we have computer vision to find a tee's green and its tee box… correlate our own
 * information") — the vision cross-check of every hole the course engine pairs. Pure halves tested here;
 * the live check runs in api/course-verify against Mapbox + api/hole-scan.
 */
import { frameForHole, pointFromTile, judgeHole, GREEN_MATCH_YD, GREEN_MISMATCH_YD, CHECK_TILE_PX } from '../../services/holeVisionCheck';
import { projectToTilePixels } from '../../services/smartVisionOverlay';
import { haversineYards } from '../../utils/geoDistance';
import { parseHoles, storedStillApplies } from '../../api/course-verify';

// Hemet Golf Club neighbourhood; a ~400-yd hole and a ~150-yd par 3
const tee = { lat: 33.7501, lng: -117.0511 };
const green = { lat: 33.7534, lng: -117.0511 };          // ~400 yd north
const par3Green = { lat: 33.7513, lng: -117.0511 };      // ~145 yd

describe('the frame', () => {
  it('fits the tee, the green and a margin, and the hole is the centre', () => {
    for (const g of [green, par3Green]) {
      const f = frameForHole(tee, g);
      const hole = haversineYards(tee, g);
      expect(f.spanYards).toBeGreaterThan(hole * 1.2);
      expect(f.spanYards).toBeLessThan(Math.max(hole * 1.25 + 120, 220) * 2.05);   // never more than one zoom level loose
      for (const p of [tee, g]) {
        const px = projectToTilePixels(p, f.center, f.zoom, 0, CHECK_TILE_PX, CHECK_TILE_PX);
        expect(Math.abs(px.x - CHECK_TILE_PX / 2)).toBeLessThan(CHECK_TILE_PX / 2);
        expect(Math.abs(px.y - CHECK_TILE_PX / 2)).toBeLessThan(CHECK_TILE_PX / 2);
      }
    }
  });

  it('a par 3 gets a tighter look than a par 4', () => {
    expect(frameForHole(tee, par3Green).zoom).toBeGreaterThan(frameForHole(tee, green).zoom);
  });

  it('a point read off the tile comes back where it is on the ground (same projection as the app)', () => {
    const f = frameForHole(tee, green);
    const px = projectToTilePixels(green, f.center, f.zoom, 0, CHECK_TILE_PX, CHECK_TILE_PX);
    const back = pointFromTile({ x: px.x / CHECK_TILE_PX, y: px.y / CHECK_TILE_PX }, f);
    expect(haversineYards(back, green)).toBeLessThan(1);
  });
});

describe('the verdict is decided by the green', () => {
  const near = { lat: green.lat + 0.0001, lng: green.lng };                 // ~12 yd
  const far = { lat: green.lat - 0.0025, lng: green.lng + 0.002 };          // ~320 yd away
  const grey = { lat: green.lat + 0.0003, lng: green.lng };                 // ~36 yd

  it('verified: vision sees our green', () => {
    expect(judgeHole({ tee, green }, { found_green: true, green_center: near, tee: null, confidence: 'high' }).verdict).toBe('verified');
  });
  it('suspect: vision confidently sees this hole\'s green somewhere else', () => {
    const r = judgeHole({ tee, green }, { found_green: true, green_center: far, tee: null, confidence: 'medium' });
    expect(r.verdict).toBe('suspect');
    expect(r.greenOffYd).toBeGreaterThan(GREEN_MISMATCH_YD);
  });
  it('unconfirmed, never a guess: no green found, an unsure read, or the grey zone', () => {
    expect(judgeHole({ tee, green }, { found_green: false, green_center: null, tee: null, confidence: 'low' }).verdict).toBe('unconfirmed');
    expect(judgeHole({ tee, green }, { found_green: true, green_center: far, tee: null, confidence: 'low' }).verdict).toBe('unconfirmed');
    const g = judgeHole({ tee, green }, { found_green: true, green_center: grey, tee: null, confidence: 'high' });
    expect(g.greenOffYd).toBeGreaterThan(GREEN_MATCH_YD);
    expect(g.verdict).toBe('unconfirmed');
  });
});

describe('the route only pays for what it should', () => {
  it('drops holes without a green, impossible holes and duplicates', () => {
    const holes = parseHoles([
      { hole: 1, tee, green },
      { hole: 1, tee, green },                                   // duplicate
      { hole: 2, tee, green: null },                             // nothing to check
      { hole: 3, tee: { lat: 33.70, lng: -117.0511 }, green },   // 3.7 km "hole"
      { hole: 4, tee: { lat: 0, lng: 0 }, green },               // null island tee → no tee
      { hole: 99, tee, green },
    ]);
    expect(holes.map((h) => h.hole)).toEqual([1, 4]);
    expect(holes[1].tee).toBeNull();
  });

  it('a stored verdict is reused only for the same points, and not forever', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    const s = { hole: 1, verdict: 'verified' as const, tee, green, checkedAt: '2026-10-01T00:00:00Z' };
    const h = { hole: 1, par: 4, yardage: 400, tee, green };
    expect(storedStillApplies(s, h, now)).toBe(true);
    expect(storedStillApplies(s, { ...h, green: par3Green }, now)).toBe(false);          // rebuilt hole
    expect(storedStillApplies(s, { ...h, tee: null }, now)).toBe(false);
    expect(storedStillApplies({ ...s, checkedAt: '2026-01-01T00:00:00Z' }, h, now)).toBe(false);
  });
});
