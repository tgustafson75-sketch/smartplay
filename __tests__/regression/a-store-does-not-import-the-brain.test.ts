/**
 * 2026-09-01 (adversarial audit of my own change).
 *
 * Making the persona switch compose its own intro put a brain call inside settingsStore. The brain
 * reads stores to build its context, so that closes a loop: store -> brain -> store. It was
 * runtime-safe — a lazy require inside an async handler, nothing in the brain reads state at module
 * scope, and the bundle built — but the edge should not exist.
 *
 * Moving the brain's own settingsStore import to a lazy one did NOT fix it: the cycle simply took
 * the longer path through caddieBrain -> caddieRequestBody -> caddieHistoryContext -> store. The
 * lesson is that no amount of laziness removes a dependency that genuinely points both ways.
 *
 * So it is INVERTED. proactiveLineRegistry imports nothing; the app layer registers the composer at
 * boot and the store asks the registry. A store asks for a line; it does not know what answers.
 * Cycle count across services/app/store fell from 72 to 63.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const storeDir = path.join(root, 'store');

const BRAIN_MODULES = [
  'conversationalBrain',
  'caddieBrain',
  'caddieRequestBody',
  'caddieHistoryContext',
];

describe('a store never reaches the brain, statically or lazily', () => {
  const files = fs
    .readdirSync(storeDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(storeDir, f), 'utf8') }));

  it('there are stores to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('THE CLASS: no store imports or requires a brain module', () => {
    const offenders: string[] = [];
    for (const { name, src } of files) {
      for (const mod of BRAIN_MODULES) {
        if (new RegExp(`(from|require\\()\\s*['"][^'"]*${mod}['"]`).test(src)) {
          offenders.push(`${name} -> ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the registry it uses instead imports NOTHING, so it cannot be part of a cycle', () => {
    const reg = fs.readFileSync(path.join(root, 'services/proactiveLineRegistry.ts'), 'utf8');
    expect(reg).not.toMatch(/^\s*import\s/m);
    expect(reg).toMatch(/export function setProactiveLineComposer/);
    expect(reg).toMatch(/export async function composeProactiveLine/);
  });

  it('settingsStore asks the registry, and still has a fallback if nothing answers', () => {
    const s = fs.readFileSync(path.join(storeDir, 'settingsStore.ts'), 'utf8');
    expect(s).toMatch(/composeProactiveLine\(/);
    expect(s).toMatch(/if \(composed\) spokenText = composed;/);
  });

  it('the app layer registers the real composer', () => {
    const l = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
    expect(l).toMatch(/setProactiveLineComposer\(/);
    expect(l).toMatch(/generateProactiveLine\(directive, opts\)/);
  });

  it('an unregistered composer yields null rather than throwing', () => {
    const reg = fs.readFileSync(path.join(root, 'services/proactiveLineRegistry.ts'), 'utf8');
    expect(reg).toMatch(/if \(!composer\) return null;/);
    expect(reg).toMatch(/catch \{\s*return null;\s*\}/);
  });
});
