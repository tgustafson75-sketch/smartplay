/**
 * 2026-10-13 (course-engine audit #6) — a missing par was `?? 4` (app and server) and a missing total
 * `?? 72`: a 520-yard hole with a blank par read par 4, and the caddie was told "par 72" for a par-70
 * course. One rule now (utils/parFromYards), marked estimated where it is used.
 */
import { parFromYards } from '../../utils/parFromYards';
import fs from 'fs';
import path from 'path';
const read = (f: string) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('par is measured or inferred from the hole, never assumed', () => {
  it('length bands', () => {
    expect(parFromYards(150)).toBe(3);
    expect(parFromYards(250)).toBe(3);
    expect(parFromYards(380)).toBe(4);
    expect(parFromYards(470)).toBe(4);
    expect(parFromYards(520)).toBe(5);
    expect(parFromYards(0)).toBe(4);     // no length either: the neutral value, still flagged estimated
  });
  it('no blanket default survives in the app or on the server', () => {
    const app = read('services/golfCourseApi.ts');
    expect(app).not.toMatch(/par: raw\.par \?\? 4/);
    expect(app).toMatch(/par: hasPar \? \(raw\.par as number\) : parFromYards\(yards\),\s*\.\.\.\(hasPar \? \{\} : \{ par_estimated: true \}\)/);
    expect(app).toMatch(/par_total: raw\.par_total \?\? raw\.par \?\? \(parSum > 0 \? parSum : 72\)/);
    const server = read('api/course-geometry.ts');
    expect(server).not.toMatch(/typeof raw\.par === 'number' \? raw\.par : 4/);
    expect(server).not.toMatch(/center <= 215 \? 3 : center >= 460 \? 5 : 4/);
  });
});
