/**
 * 2026-09-09 — the third "Maximum update depth exceeded" on the recap screen.
 *
 * Zustand subscribes through useSyncExternalStore, which re-reads the snapshot in a passive effect
 * after every commit and compares it with Object.is against the value used during render. A selector
 * that BUILDS its result — `.filter()`, `.map()`, an object literal — returns a new reference every
 * call, so that comparison never matches, forceStoreRerender fires, and the screen loops until React
 * throws. The crash stack says so literally: commitHookEffectListMount → updateStoreInstance →
 * forceStoreRerender.
 *
 * It has now happened three times on one screen (courseHoles 07-01, round_photos Day 1, clip_uri
 * 09-03), and each fix repaired the one selector in front of it. useCallback does not help: it
 * stabilises the FUNCTION, and the loop is caused by the VALUE.
 *
 * So this is the gate the previous two fixes did not leave behind. A selector may only hand back
 * something the store already holds, or a primitive derived from it; anything that needs building is
 * built in a useMemo downstream.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'components', 'hooks'];

/** Methods that allocate. A selector returning one of these returns a fresh reference every call. */
const BUILDERS = ['.filter(', '.map(', '.sort(', '.slice(', '.concat(', '.flatMap(', '.reverse('];
/** Literal forms of the same mistake: `useStore(s => ({ a: s.a }))` / `useStore(s => [s.a, s.b])`,
 *  and the inline empty fallback that caused the Day 1 crash: `s.x?.photos ?? []`. */
const LITERALS = [/=>\s*\(\s*\{/, /=>\s*\[/, /\?\?\s*\[\s*\]/, /\?\?\s*\{\s*\}/];

/**
 * `useShallow` is the sanctioned way to return a fresh object: it memoises the snapshot behind a
 * shallow-equality check, so Object.is holds and the loop cannot start. Twelve call sites across the
 * Caddie, dashboard, cockpit and voice hook do exactly this and are correct. The bug is a BARE
 * selector that builds — with or without useCallback around it, which stabilises the function and
 * not the value.
 */
const MEMOISED = /^\s*useShallow\s*\(/;

/**
 * Verified-stable exceptions, each with the reason it cannot loop. An entry here is a claim that the
 * selector's RESULT is a primitive or an existing reference — not that the selector looks fine.
 */
const ALLOWED: Record<string, string> = {
  'app/family/[memberId].tsx': 'returns `.filter(...).length` — a number, so Object.is holds',
};

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The text of the first argument to a `useSomethingStore(` call starting at `open`. */
function argumentAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

describe('a Zustand selector never builds the value it returns', () => {
  const files = SCAN_DIRS.flatMap((d) => listFiles(path.join(root, d)));

  it('there are screens to check', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('THE CLASS: no selector allocates its result', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      const src = fs.readFileSync(file, 'utf8');
      // `useFooStore(` as a HOOK call. `useFooStore.getState()` is a plain read, not a subscription,
      // and building a value there is fine — the parenthesis check excludes it by construction.
      const call = /\buse[A-Z]\w*Store\(/g;
      let m: RegExpExecArray | null;
      while ((m = call.exec(src)) !== null) {
        const arg = argumentAt(src, m.index + m[0].length - 1);
        // Not a selector (e.g. `useStore()` subscribing to the whole state) → nothing to build.
        if (!arg.includes('=>')) continue;
        if (MEMOISED.test(arg)) continue;
        const builds =
          BUILDERS.some((b) => arg.includes(b)) || LITERALS.some((re) => re.test(arg));
        if (!builds) continue;
        if (ALLOWED[rel]) continue;
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${rel}:${line}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every allowance names a file that still exists', () => {
    for (const rel of Object.keys(ALLOWED)) {
      expect(fs.existsSync(path.join(root, rel))).toBe(true);
    }
  });
});
