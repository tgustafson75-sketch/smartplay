import * as fs from 'fs';
import * as path from 'path';

/**
 * 2026-08-22 — forbids the SHAPE, not the instance.
 *
 * Reading `tees[0]` is how "Preferred Tee did nothing" kept coming back. Fixing it in courseToHoles
 * (08-19) missed courseSummaryForContext; fixing both (08-22) missed StartRoundCourseCard, which was
 * showing YARDS / PAR / RATING / SLOPE off the card's first tee and feeding those same numbers into
 * the course-content generator. Three passes, three survivors — so this asserts the rule instead.
 *
 * A player-facing surface resolves the tee through `playerTee` or `pickTeeSet`. Never index the raw
 * array. [[no-half-fixes-enforce-every-surface]] [[run-the-second-pass-yourself]]
 */
const ROOT = path.resolve(__dirname, '../../');

/**
 * Allowed, with the reason each one is not the defect:
 *   api-debug     — an owner screen that deliberately lists EVERY tee
 *   teeSelection  — the resolver itself; tees[0] is its documented "nothing to choose" fallback
 *
 * Everything else is judged by the RULE rather than by a file list: `tees[0]` is fine as a last
 * resort on a line that already consulted the resolver (`playerTee(c) ?? c.tees[0]`), and is the
 * defect anywhere else. A file-based exemption would have quietly excused the next new caller in an
 * exempt file, which is how this survived three passes.
 */
const ALLOW = [/app\/api-debug\.tsx$/, /services\/teeSelection\.ts$/];
const RESOLVED_FIRST = /(playerTee|pickTeeSet)\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Strip comments so a line explaining the bug never reads as the bug. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no player-facing surface reads the card’s first tee', () => {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))];

  it('scans a real set of files (the guard itself is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('finds no tees[0] that skipped the resolver', () => {
    const offenders: string[] = [];
    for (const f of [...files, path.join(ROOT, 'services/golfCourseApi.ts')]) {
      if (ALLOW.some((re) => re.test(f))) continue;
      const src = stripComments(fs.readFileSync(f, 'utf-8'));
      src.split('\n').forEach((line, i) => {
        if (!/tees\s*\[\s*0\s*\]/.test(line)) return;
        if (RESOLVED_FIRST.test(line)) return; // resolver consulted first — this is the safe form
        offenders.push(`${path.relative(ROOT, f)}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('would CATCH the defect it was written for', () => {
    // A guard that cannot fail is not a guard. This is the exact line StartRoundCourseCard had.
    const bad = '  const tee = course?.tees[0] ?? null;';
    expect(/tees\s*\[\s*0\s*\]/.test(bad) && !RESOLVED_FIRST.test(bad)).toBe(true);
    const good = '  const tee = playerTee(course) ?? course?.tees[0] ?? null;';
    expect(RESOLVED_FIRST.test(good)).toBe(true);
  });

  it('the resolver is what those surfaces actually use', () => {
    const card = fs.readFileSync(path.join(ROOT, 'components/course/StartRoundCourseCard.tsx'), 'utf-8');
    expect(card).toMatch(/playerTee\(/);
    // and the numbers it renders come from the resolved tee
    expect(card).toMatch(/value=\{tee\.total_yards\.toLocaleString\(\)\}/);
  });
});
