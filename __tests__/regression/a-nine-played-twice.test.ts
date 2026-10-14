/**
 * 2026-10-13 (course sweep) — Echo Hills, Hemet: the course database lists the nine twice (holes 10-18
 * repeat 1-9 yard for yard on every tee). The build paired all 18, so the back nine had no green or
 * grabbed OTHER holes' greens. Now the build pairs the nine and holes 10-18 take its geometry.
 */
import { isRepeatedNine, expandRepeatedNine } from '../../api/course-geometry';

const WHITE = [274, 136, 216, 242, 269, 226, 257, 266, 258];   // Echo Hills, from the course database
const card = (ys: number[]) => ys.map((y, i) => ({ hole_number: i + 1, yardage: y, par: y < 200 ? 3 : 4 }));

describe('a nine played twice', () => {
  it('Echo Hills: 10-18 repeat 1-9 → a repeated nine', () => {
    expect(isRepeatedNine(card([...WHITE, ...WHITE]))).toBe(true);
  });
  it('a real 18, or a nine whose back tees differ, is not', () => {
    expect(isRepeatedNine(card([...WHITE, ...WHITE.map((y, i) => (i === 4 ? y + 12 : y))]))).toBe(false);
    expect(isRepeatedNine(card([...WHITE, 300, 140, 410, 380, 520, 170, 390, 400, 430]))).toBe(false);
    expect(isRepeatedNine(card(WHITE))).toBe(false);
  });
  it('the back nine takes the front nine\'s geometry and keeps its own card', () => {
    const tee = { lat: 33.7240, lng: -116.9650 }, green = { lat: 33.7250, lng: -116.9660 };
    const nine = card(WHITE).map((h) => ({ ...h, tee, green, green_polygon: [green, green, green] }));
    const back = card(WHITE).map((h) => ({ ...h, hole_number: h.hole_number + 9, tee: null, green: null, green_polygon: null, handicap: 18 }));
    const all = expandRepeatedNine(nine, back as unknown as typeof nine);
    expect(all).toHaveLength(18);
    const h10 = all.find((h) => h.hole_number === 10)!;
    expect(h10.green).toEqual(green);
    expect(h10.tee).toEqual(tee);
    expect(h10.yardage).toBe(274);
    expect((h10 as unknown as { handicap: number }).handicap).toBe(18);
  });
  it('the main build uses it', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../api/course-geometry.ts'), 'utf8');
    expect(src).toMatch(/const repeatedNine = isRepeatedNine\(holes\);/);
    expect(src).toMatch(/holes = holes\.slice\(0, 9\);/);
    expect(src).toMatch(/holesWithPolygons = expandRepeatedNine\(holesWithPolygons, backNine/);
  });
});
