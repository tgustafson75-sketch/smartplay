/**
 * 2026-09-10 (Tim: "one universal truth for the yardage, one for the clubs, one for the brain, one
 * for the course engine").
 *
 * Every defect on the Hemet round was the same shape: two sources for one fact, and the consumer
 * reading the empty or stale one. This gate holds the line per fact.
 *
 *   YARDAGE — resolveYardage. Covered by one-yardage-one-owner.test.ts.
 *   THE HOLE — smartFinderService.holeData / holePar. Twenty-odd call sites did
 *              `courseHoles.find(h => h.hole === n)` themselves and skipped the bundled fallback, so
 *              pre-round (and any moment before courseHoles hydrates) they read undefined and
 *              defaulted par to 4 — a par 3 briefed, scored and posted as a par 4.
 *   THE CLUB — normalizeClub decides what a club string means; clubLabel turns a canonical club into
 *              words. clubLabel had grown its own regexes for '7' / '7I' / '5H' / '3W', a second
 *              opinion that only one of the two would ever learn a new spelling for.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

const FILES = ['app', 'components', 'hooks', 'services']
  .flatMap((d) => walk(d))
  .filter((f) => !f.includes('__tests__'));

describe('the hole is resolved in one place', () => {
  /**
   * roundStore owns the live array, so its own reads ARE the source — and importing the resolver
   * back into it would cycle. The simulator and the dev/truth screens author course data rather than
   * consume it. smartFinderService is the owner itself.
   */
  const OWNERS = [
    'services/smartFinderService.ts',
    'services/simulatedGPS.ts',
    'services/simRound.ts',
    'services/simRoundAuto.ts',
    'app/dev/CourseTruth.tsx',
  ];

  it('exposes holeData and holePar as the resolution, bundled fallback included', () => {
    const sf = code(read('services/smartFinderService.ts'));
    expect(sf).toContain('export function holeData');
    expect(sf).toContain('export function holePar');
    expect(sf).toContain('getBundledHoles');
  });

  it('holePar never fabricates a par', () => {
    const sf = code(read('services/smartFinderService.ts'));
    const body = sf.slice(sf.indexOf('export function holePar'), sf.indexOf('function resolveHoleDataWithFallback'));
    expect(body).not.toMatch(/\?\?\s*4/);
    expect(body).toContain('null');
  });

  it('no NEW surface re-implements the lookup', () => {
    const offenders = FILES.filter((f) => {
      if (OWNERS.includes(f)) return false;
      return /courseHoles\s*\.\s*find\s*\(/.test(code(read(f)));
    });
    // Two historical readers remain — app/smartvision.tsx and components/caddie/L1HolePreview.tsx.
    // The count must not GROW: every new one is another par 4 waiting to be reported as fact.
    expect(offenders.sort()).toEqual(['app/smartvision.tsx', 'components/caddie/L1HolePreview.tsx']);
  });
});

describe('a club string means one thing', () => {
  it('clubLabel normalises before labelling instead of re-parsing', () => {
    const cr = code(read('services/clubRecognition.ts'));
    expect(cr).toContain('normalizeClub');
    const label = cr.slice(cr.indexOf('export function clubLabel'));
    const body = label.slice(0, label.indexOf('\n}'));
    expect(body).toContain('normalizeClub(club_id)');
  });

  it('normalizeClub is still the one that decides', () => {
    expect(code(read('services/clubNormalize.ts'))).toContain('export function normalizeClub');
  });
});
