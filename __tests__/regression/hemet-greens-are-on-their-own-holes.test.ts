/**
 * 2026-10-13 (Tim — "I still get a course I am not near if I am standing on a course… we cannot be
 * casual"). Measured against OpenStreetMap's numbered hole ways — whose lengths match Hemet Golf Club's
 * scorecard to a few yards — the geometry our engine served for Hemet had 17 of 18 greens on OTHER
 * holes (hole 1's green was hole 9's; hole 3's was hole 18's). The numbered holes existed the whole time
 * and only the OSM-only build used them. This replays that exact day's data through the main build's
 * new merge (api/course-geometry mergeHoleWays) and requires every green on its own hole.
 */
import fx from '../fixtures/hemet-golf-club-2026-10-13.json';
import {
  chooseCoherentHoleWays, holeWaysToHoles, mergeHoleWays, wayLenYd, HOLEWAYS_MIN_COVERAGE,
  type OsmHoleWay, type OsmPolygon,
} from '../../api/course-geometry';
import { haversineYards } from '../../utils/geoDistance';

type L = { lat: number; lng: number };
const ways = fx.ways as OsmHoleWay[];
const rings: OsmPolygon[] = (fx.greens as L[][]).map((poly) => ({
  polygon: poly,
  centroid: { lat: poly.reduce((s, p) => s + p.lat, 0) / poly.length, lng: poly.reduce((s, p) => s + p.lng, 0) / poly.length },
  name: null,
}));
const served = fx.served as { hole_number: number; yardage: number; tee: L | null; green: L | null; green_front: L | null; green_back: L | null; bearing_deg: number | null }[];
const CLUBHOUSE = { lat: 33.7501, lng: -117.0511 };
const card = served.map((h) => h.yardage);

/** Where hole N's green really is: the end of its numbered way nearest a mapped green. */
function trueGreen(n: number): L {
  const w = ways.find((x) => x.ref === n)!;
  const ends = [w.pts[0], w.pts[w.pts.length - 1]];
  const near = (p: L) => Math.min(...rings.map((r) => haversineYards(p, r.centroid)));
  return near(ends[0]) <= near(ends[1]) ? ends[0] : ends[1];
}
const onOwnHole = (h: { hole_number: number; green: L | null }) => !!h.green && haversineYards(h.green, trueGreen(h.hole_number)) <= 30;

describe('Hemet Golf Club: every green on its own hole', () => {
  it('THE BUG, as served that day: 1 of 18 greens on its own hole', () => {
    expect(served.filter(onOwnHole).length).toBe(1);
  });

  it('the numbered OSM holes are coherent and agree with the scorecard', () => {
    const chosen = chooseCoherentHoleWays([...ways], CLUBHOUSE, 18, wayLenYd, card);
    expect(chosen.length).toBe(18);
  });

  it('the merge puts all 18 greens on their own holes, with the tee at the other end', () => {
    const wayHoles = holeWaysToHoles(chooseCoherentHoleWays([...ways], CLUBHOUSE, 18, wayLenYd, card), rings);
    const r = mergeHoleWays(served.map((h) => ({ ...h })), wayHoles);
    expect(r.applied).toBe(true);
    expect(r.replaced).toBe(18);
    expect(r.disagreed).toBe(17);
    expect(r.holes.filter(onOwnHole).length).toBe(18);
    for (const h of r.holes) {
      // each hole now measures close to its scorecard length (tee→green)
      const len = haversineYards(h.tee!, h.green!);
      expect(Math.abs(len - h.yardage) / h.yardage).toBeLessThan(0.15);
    }
  });

  it('too few numbered holes: the database pairing stands (no half-merge)', () => {
    const few = holeWaysToHoles(chooseCoherentHoleWays([...ways], CLUBHOUSE, 18, wayLenYd, card), rings).slice(0, 6);
    expect(6).toBeLessThan(Math.ceil(18 * HOLEWAYS_MIN_COVERAGE));
    const r = mergeHoleWays(served.map((h) => ({ ...h })), few);
    expect(r.applied).toBe(false);
    expect(r.holes).toEqual(served);
  });

  it('a hole the numbered holes miss loses a green that belongs to one of them', () => {
    const wayHoles = holeWaysToHoles(chooseCoherentHoleWays([...ways], CLUBHOUSE, 18, wayLenYd, card), rings).filter((w) => w.hole_number !== 2);
    const r = mergeHoleWays(served.map((h) => ({ ...h })), wayHoles);   // 17/18 ≥ coverage → applied
    const h2 = r.holes.find((h) => h.hole_number === 2)!;
    // served hole 2's green was hole 9's — hole 9 is numbered, so hole 2 is left honestly empty
    expect(h2.green).toBeNull();
    expect(r.cleared).toBe(1);
  });
});

describe('Overpass 504s the green rings (live, 2026-10-13) — the numbered holes still place every green', () => {
  it('no rings at all: tee→green by the way\'s own direction, all 18 on their own holes', () => {
    const wayHoles = holeWaysToHoles(chooseCoherentHoleWays([...ways], CLUBHOUSE, 18, wayLenYd, card), []);
    expect(wayHoles.length).toBe(18);
    const r = mergeHoleWays(served.map((h) => ({ ...h })), wayHoles);
    expect(r.holes.filter(onOwnHole).length).toBe(18);
    for (const h of r.holes) expect((h as { green_polygon?: unknown }).green_polygon).toBeNull();   // honest: no outline, F = M = B
  });

  it('one hole\'s ring missing: it does not borrow a neighbour\'s green', () => {
    const own3 = trueGreen(3);
    const fewer = rings.filter((r) => haversineYards(r.centroid, own3) > 40);
    expect(fewer.length).toBe(rings.length - 1);
    const wayHoles = holeWaysToHoles(chooseCoherentHoleWays([...ways], CLUBHOUSE, 18, wayLenYd, card), fewer);
    const h3 = wayHoles.find((w) => w.hole_number === 3)!;
    expect(haversineYards(h3.green, own3)).toBeLessThan(30);
  });
});

describe('the main database build runs it', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../api/course-geometry.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('fetches the numbered holes with the green rings, merges, and the proximity fill stands down', () => {
    expect(src).toMatch(/fetchOsmHoleWays\(centroid\)\.catch\(\(\) => \[\] as OsmHoleWay\[\]\),\s*fetchOsmPolygons\(centroid, 'green'\)/);
    expect(src).toMatch(/const merged = mergeHoleWays\(holes, wayHoles\);/);
    expect(src).toMatch(/if \(centroid && !pairedByHoleWays && \(nullGreens > 0 \|\| nullTees > 0\)\) \{/);
  });
  it('a hole it empties on purpose is withdrawn from Course Cloud too', () => {
    expect(src).toMatch(/const emptied = pairedByHoleWays \? holesWithPolygons\.filter\(h => !h\.green\)/);
    expect(src).toMatch(/forgetServerHoles\(db, cloudKey \?\? courseId, emptied\)/);
  });
});

describe('a way is drawn from tee to green (Wachusett hole 11, live 2026-10-13)', () => {
  it('a tee beside the previous hole\'s green does not turn the hole around', () => {
    const ring = (c: L) => [0, 1, 2, 3, 4, 5].map((k) => ({ lat: c.lat + 0.00008 * Math.cos(k), lng: c.lng + 0.0001 * Math.sin(k) }));
    const g10 = { lat: 42.3600, lng: -71.7900 };
    const g11 = { lat: 42.3640, lng: -71.7900 };                 // ~485 yd north
    const tee11 = { lat: 42.36009, lng: -71.7900 };              // 10 yd from green 10
    const end11 = { lat: 42.36375, lng: -71.7900 };              // ~27 yd short of green 11's centre (front edge)
    const way11: OsmHoleWay = { ref: 11, par: 4, pts: [tee11, end11] };
    const rings2: OsmPolygon[] = [g10, g11].map((c) => ({ polygon: ring(c), centroid: c, name: null }));
    const [h11] = holeWaysToHoles([way11], rings2);
    expect(haversineYards(h11.green, g11)).toBeLessThan(5);
    expect(haversineYards(h11.tee, tee11)).toBeLessThan(1);
  });
});
