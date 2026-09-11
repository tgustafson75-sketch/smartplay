/**
 * 2026-09-11 — AN ASYNC CALLBACK IN .filter() / .some() / .every() IS ALWAYS TRUE.
 *
 * services/intents/queryStatusHandler held:
 *
 *     const withSwings = teammates.filter(async (m) =>
 *       (await analyzer.getMemberSwingHistory(m.id)).length > 0).length;
 *
 * An `async` function returns a Promise, and every Promise is truthy, so that filter kept EVERY
 * teammate: `withSwings` was always `teammates.length`. Demonstrated directly —
 * `[a,b,c].filter(async () => false).length === 3`.
 *
 * The value happened to be dead, so no player ever saw it. That is the dangerous half: the code
 * reads as a correct count, it type-checks, it lints clean apart from being unused, and the first
 * person to actually USE it inherits a number that can never be wrong in a way that looks wrong.
 *
 * These predicates are synchronous by contract. An async one is never what the author meant: the
 * fix is `for await`, or resolving the promises first with Promise.all and filtering the results.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const DIRS = ['app', 'components', 'services', 'hooks', 'store', 'lib', 'api', 'utils'];

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Comments can legitimately discuss the pattern — this file's own header does. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('no synchronous predicate is given an async callback', () => {
  it('demonstrates why: a Promise is always truthy', () => {
    expect([1, 2, 3].filter((() => false) as () => boolean)).toHaveLength(0);
    // The bug shape, cast so TypeScript allows it here the way it allowed it at the call site.
    const alwaysKept = [1, 2, 3].filter((async () => false) as unknown as () => boolean);
    expect(alwaysKept).toHaveLength(3);
  });

  it('does not appear anywhere in shipped source', () => {
    const offenders: string[] = [];
    for (const d of DIRS) {
      for (const f of walk(path.join(ROOT, d))) {
        const src = code(fs.readFileSync(f, 'utf8'));
        if (/\.(filter|some|every|find|findIndex|sort)\s*\(\s*async\b/.test(src)) {
          offenders.push(path.relative(ROOT, f));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
