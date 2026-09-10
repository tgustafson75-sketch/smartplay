/**
 * 2026-09-10 — deriveHoleGeometry solved the green and nothing downstream could see it.
 *
 * api/hole-scan exists for courses golfcourseapi and OSM have no green for. It ran, it persisted,
 * SmartVision drew from it — but resolveGreenCoords stopped one tier short, and loadDerivedGeometry
 * had exactly one caller (SmartVision's mount). So on a course with no green a player who never
 * opened the map got no live yardage and no hole advance all round, while a solved green sat in
 * storage.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the derived green reaches every consumer', () => {
  const sf = code(read('services/smartFinderService.ts'));

  it('resolveGreenCoords consults the derived tier', () => {
    expect(sf).toContain('getDerivedHoleGeometry');
    expect(sf).toMatch(/source: 'derived'/);
  });

  it('the derived tier is LAST, so it can never outrank real geometry or a player mark', () => {
    // Scope to the function: from its declaration up to the next exported one.
    const start = sf.indexOf('export function resolveGreenCoords');
    const end = sf.indexOf('export function resolveTeeCoords');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = sf.slice(start, end);
    expect(body).toBeTruthy();
    for (const earlier of ["source: 'truth'", "source: 'override'", "source: 'courseHoles'", "source: 'geometryCache'"]) {
      expect(body.indexOf(earlier)).toBeGreaterThan(-1);
      expect(body.indexOf(earlier)).toBeLessThan(body.indexOf("source: 'derived'"));
    }
  });

  it('the derived store is hydrated at round start, not only by opening the map', () => {
    expect(code(read('services/roundPrefetch.ts'))).toContain('loadDerivedGeometry');
  });

  it('a green is derived for the hole the player is on, from hole detection', () => {
    const hd = code(read('services/holeDetection.ts'));
    expect(hd).toContain('ensureGreenForCurrentHole');
    expect(hd).toContain('deriveHoleGeometry');
    // The guards that keep it honest: once per course:hole, and only when nothing already answers.
    expect(hd).toMatch(/greenDeriveAttempts\.has\(key\)/);
    expect(hd).toMatch(/greenDeriveAttempts\.add\(key\)/);
    expect(hd).toMatch(/if \(greenForHole\(courseId, hole\)\) return;/);
  });

  it('SmartVision is no longer the only caller of either', () => {
    const callers = (needle: string) =>
      ['app/smartvision.tsx', 'services/holeDetection.ts', 'services/roundPrefetch.ts']
        .filter((f) => code(read(f)).includes(needle));
    expect(callers('loadDerivedGeometry').length).toBeGreaterThan(1);
    expect(callers('deriveHoleGeometry').length).toBeGreaterThan(1);
  });
});
