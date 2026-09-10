/**
 * 2026-09-10 (Tim: "a yard is supposed to be universal — why do we have multiple interpretations
 * and feeds and loops") — ONE NUMBER, ONE OWNER.
 *
 * Thirteen surfaces read a yardage from three different functions: yardageResolver.resolveYardage,
 * smartFinderService.getGreenYardagesSync, and smartFinderService.holeLengthYards. Only the resolver
 * applies the tier ladder (user-stated → live GPS → static card), so the caddie could club off a
 * number the watch, the cockpit and SmartFinder had never heard of, and a spoken correction moved
 * some surfaces and not others.
 *
 * getGreenYardagesSync is the ENGINE, not an answer. It belongs inside the resolver and nowhere
 * else. This gate keeps it there.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Where the engine legitimately lives: its own file, the resolver, and the GPS simulator harness. */
const ENGINE_OWNERS = new Set([
  'services/smartFinderService.ts',
  'services/yardageResolver.ts',
  'services/simulatedGPS.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe('one yardage, one owner', () => {
  const files = ['app', 'components', 'hooks', 'services', 'store']
    .flatMap((d) => walk(d))
    .filter((f) => !f.includes('__tests__'));

  it('nothing outside the resolver reads the raw green-yardage engine', () => {
    const offenders = files.filter((f) => {
      if (ENGINE_OWNERS.has(f)) return false;
      return /\bgetGreenYardages(Sync)?\s*\(/.test(code(read(f)));
    });
    expect(offenders).toEqual([]);
  });

  it('the resolver returns the whole triplet, so no surface needs to go around it', () => {
    const r = code(read('services/yardageResolver.ts'));
    expect(r).toMatch(/front: number \| null;/);
    expect(r).toMatch(/back: number \| null;/);
    expect(r).toContain('export function resolvedToFmb');
  });

  it('the F/M/B adapter exists once, not per screen', () => {
    const copies = files.filter((f) => /function\s+\w*[Tt]oFmb\s*\(/.test(code(read(f))));
    expect(copies).toEqual(['services/yardageResolver.ts']);
  });

  it('the surfaces that show a yardage all read the resolver', () => {
    for (const f of [
      'app/(tabs)/caddie.tsx',
      'app/smartfinder.tsx',
      'components/caddie/CockpitCaddieScreen.tsx',
      'services/watchCaddieBridge.ts',
      'services/caddieRequestBody.ts',
      'services/localStatusResponder.ts',
      'services/intents/queryStatusHandler.ts',
    ]) {
      expect(code(read(f))).toMatch(/resolveYardage|buildYardageInsight/);
    }
  });

  it('a stated correction is still the top tier, so it reaches every one of them', () => {
    const r = code(read('services/yardageResolver.ts'));
    const stated = r.indexOf("source: 'user_stated'");
    const live = r.indexOf("source: 'gps_live'");
    const card = r.indexOf("source: 'static_card'");
    expect(stated).toBeGreaterThan(-1);
    expect(stated).toBeLessThan(live);
    expect(live).toBeLessThan(card);
  });
});
