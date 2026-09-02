/**
 * 2026-09-01 — I broke this myself and neither tsc nor a bundle caught it.
 *
 * Renaming app/cage/ to app/practice-session/ left `<Stack.Screen name="cage">` and
 * `name="cage/target-calibration"` in the root layout pointing at directories that no longer exist.
 * expo-router still routes by FILE, so the screens kept working — they just silently lost the options
 * registered for them (the slide animation), and a name that matches nothing produces no error at all.
 *
 * A route registration is a string, so the compiler cannot see it and a green bundle proves nothing.
 * This is the check that can.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');

/** Registered names, minus route groups and the ones expo-router provides itself. */
function registeredNames(): string[] {
  return [...layout.matchAll(/<Stack\.Screen[\s\S]{0,120}?name="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((n) => !n.startsWith('(') && n !== '+not-found');
}

function existsAsRoute(name: string): boolean {
  return [
    `app/${name}.tsx`,
    `app/${name}.ts`,
    `app/${name}/index.tsx`,
    `app/${name}/_layout.tsx`,
  ].some((p) => fs.existsSync(path.join(root, p)));
}

describe('every registered route resolves to a real screen', () => {
  const names = registeredNames();

  it('the layout registers routes at all — this is not vacuous', () => {
    expect(names.length).toBeGreaterThan(10);
  });

  it('THE CLASS: no Stack.Screen names a screen that does not exist', () => {
    const missing = names.filter((n) => !existsAsRoute(n));
    expect(missing).toEqual([]);
  });

  it('the renamed practice-session routes are registered under their new names', () => {
    expect(names).toContain('practice-session');
    expect(names).toContain('practice-session/target-calibration');
    expect(layout).not.toMatch(/name="cage"/);
    expect(layout).not.toMatch(/name="cage\/target-calibration"/);
  });

  it('and the route that KEPT its name is still registered', () => {
    // cage-review is a server-contract name that was deliberately not renamed.
    expect(names).toContain('cage-review');
    expect(existsAsRoute('cage-review')).toBe(true);
  });
});

describe('every route the app NAVIGATES to exists', () => {
  /**
   * The sibling blind spot. router.push('/somewhere') is a string too, so a renamed screen leaves a
   * dead push that compiles, bundles, and fails only when a player taps the thing. The rename that
   * prompted this touched six screens and every path that reached them.
   */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.expo', 'ios', 'android', '__tests__'].includes(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) sourceFiles(f, out);
      else if (/\.tsx?$/.test(e.name)) out.push(f);
    }
    return out;
  }

  const pushed = new Set<string>();
  for (const f of sourceFiles(root)) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/router\.(?:push|replace)\(\s*'(\/[a-z0-9\-/]+)'/g)) {
      pushed.add(m[1]);
    }
  }

  const resolves = (route: string) => {
    const n = route.replace(/^\//, '');
    return [`app/${n}.tsx`, `app/${n}.ts`, `app/${n}/index.tsx`, `app/(tabs)/${n}.tsx`]
      .some((p) => fs.existsSync(path.join(root, p)));
  };

  it('the sweep finds real navigation — not vacuous', () => {
    expect(pushed.size).toBeGreaterThan(30);
  });

  it('THE CLASS: no literal router.push targets a screen that does not exist', () => {
    expect([...pushed].filter((r) => !resolves(r)).sort()).toEqual([]);
  });
});
