import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../');
/** Comments AND string literals removed: a test title mentioning __DEV__ is not a read of it. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '')
   .replace(/^\s*\/\/.*$/gm, '')
   .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
   .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
   .replace(/`(?:[^`\\]|\\.)*`/g, '``');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.expo', 'android', 'ios', 'dist'].includes(e.name)) continue;
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 2026-08-23 — `__DEV__` is injected by the React Native bundler and does NOT exist anywhere else.
 * A BARE reference throws a ReferenceError under jest's logic project, in node scripts, and in any
 * api/* handler — so a shared module that reads it crashes the moment something non-RN imports it.
 * Found when a hole-clamp test hit devLog and blew up on a code path that works fine in the app.
 *
 * Non-UI modules are shared by definition. `typeof __DEV__ !== 'undefined' && __DEV__` never throws.
 */
describe('no shared module reads __DEV__ bare', () => {
  const shared = walk(path.join(ROOT, 'services'))
    .concat(walk(path.join(ROOT, 'store')))
    .concat(walk(path.join(ROOT, 'hooks')))
    .concat(walk(path.join(ROOT, 'utils')))
    .concat(walk(path.join(ROOT, 'api')))
    .filter((f) => !/\.test\.tsx?$/.test(f));

  it('scans a real set of files (not vacuous)', () => {
    expect(shared.length).toBeGreaterThan(80);
  });

  it('every __DEV__ read is typeof-guarded', () => {
    const offenders: string[] = [];
    for (const f of shared) {
      const src = strip(fs.readFileSync(f, 'utf-8'));
      const re = /(^|[^.\w'"`])__DEV__/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const before = src.slice(Math.max(0, m.index - 40), m.index + 8);
        if (/typeof\s+__DEV__/.test(before)) continue;
        if (/declare const __DEV__/.test(before)) continue;
        offenders.push(`${path.relative(ROOT, f)}: ${src.slice(m.index, m.index + 60).split('\n')[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('would CATCH the exact line that crashed', () => {
    const bad = '  if (__DEV__) {';
    expect(/(^|[^.\w'"`])__DEV__/.test(bad)).toBe(true);
    expect(/typeof\s+__DEV__/.test(bad)).toBe(false);
  });
});
