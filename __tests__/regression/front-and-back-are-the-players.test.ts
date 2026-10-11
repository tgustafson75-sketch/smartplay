/**
 * 2026-10-10 (course audit P1) — front/back of the green were fixed points measured from the TEE, so
 * from a dogleg fairway they were the green's sides (150/150/150 on a 30-yard-deep green) and from
 * behind the green front read longer than back. They are now where the player's line to the middle
 * enters and leaves the green outline.
 */
import fs from 'fs';
import path from 'path';
import { edgesAlongLine } from '../../utils/greenDepth';

// A 30 yd (east-west) x 20 yd (north-south) green at the origin, as lat/lng around 33.7N.
const LAT0 = 33.7;
const k = Math.cos((LAT0 * Math.PI) / 180);
const at = (eastYds: number, northYds: number) => ({
  lat: LAT0 + (northYds * 0.9144) / 110540,
  lng: -117.1 + (eastYds * 0.9144) / (111320 * k),
});
const GREEN = [at(-15, -10), at(15, -10), at(15, 10), at(-15, 10)];
const MIDDLE = at(0, 0);

describe('front and back are where YOUR line enters and leaves the green', () => {
  it('approaching from the east (the dogleg case): 135 / 165 around a 150 middle', () => {
    expect(edgesAlongLine(at(150, 0), MIDDLE, GREEN)).toEqual({ front: 135, back: 165 });
  });
  it('approaching from the south: the 20-yard depth, not the 30-yard width', () => {
    expect(edgesAlongLine(at(0, -150), MIDDLE, GREEN)).toEqual({ front: 140, back: 160 });
  });
  it('from behind the green, front is still the nearer edge', () => {
    const r = edgesAlongLine(at(-100, 0), MIDDLE, GREEN)!;
    expect(r.front).toBeLessThan(r.back);
    expect(r).toEqual({ front: 85, back: 115 });
  });
  it('standing on the green: front is 0, back is the far edge', () => {
    expect(edgesAlongLine(at(5, 0), MIDDLE, GREEN)).toEqual({ front: 0, back: 20 });
  });
  it('no usable outline → null (the caller keeps its stored edges)', () => {
    expect(edgesAlongLine(at(150, 0), MIDDLE, [])).toBeNull();
    expect(edgesAlongLine(at(150, 0), MIDDLE, [at(0, 0), at(1, 0)])).toBeNull();
  });
});

describe('both yardage engines use it (async + sync — the one structure with two readers)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../services/smartFinderService.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('every live F/M/B goes through playerEdges', () => {
    expect((src.match(/const yards = playerEdges\(hole, /g) ?? []).length).toBe(2);
    expect(src).toMatch(/edgesAlongLine\(player, middle, outline\)/);
    // never a front beyond the back, even without an outline
    expect(src).toMatch(/if \(y\.front != null && y\.back != null && y\.front > y\.back\) return \{ \.\.\.y, front: y\.back, back: y\.front \};/);
  });
});
