/**
 * 2026-09-13 — A t() KEY WITH NO VALUE RENDERS ITS OWN NAME TO THE PLAYER.
 *
 * Written while triple-checking the release-1.5 localization work, including the 72 strings closed
 * today. Three things can go wrong between a t() call and a rendered sentence, and none of them were
 * tested:
 *
 *   1. The key has no value in en.json. i18next falls back to the KEY, so the player reads
 *      "dashboard.text.no_shots_logged_yet_log" on the screen. Nothing catches it — tsc cannot,
 *      because the key is a string, and the i18n lint rule only checks the opposite direction
 *      (literals that should be keys).
 *   2. The VALUE carries a {{placeholder}} the call site does not supply, so the player reads a
 *      literal "{{count}}". The plural test caught one near-miss of this shape during 1.5 (a value
 *      written as {{day_streak}} while the call passed { count }); it only checks `count`, and only
 *      for plural pairs.
 *   3. The call site supplies a variable the value never uses — harmless to render, but it means one
 *      of the two was edited without the other, and it is usually the first half of (2).
 *
 * The scan deliberately reads CALL SITES rather than asserting a hand-written list of keys, so it
 * cannot go stale as screens are added. Keys built by concatenation (`t('play.mode_' + m)`) are
 * enumerated explicitly below, because a regex cannot resolve them and a missing one renders a raw
 * key exactly the same way.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/locales/en.json'), 'utf8')) as Record<string, unknown>;

function flatten(o: Record<string, unknown>, prefix = '', out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}
const FLAT = flatten(en);

/** Every value a key can resolve to: the exact key, or its plural forms. */
const valuesFor = (key: string): string[] => {
  if (FLAT[key] !== undefined) return [FLAT[key]];
  return (['_one', '_other', '_zero', '_two', '_few', '_many'] as const)
    .map((s) => FLAT[`${key}${s}`])
    .filter((v): v is string => v !== undefined);
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
};
const FILES = [...walk('app'), ...walk('components')];

/**
 * `(?<![\w$.])` keeps this off the tail of `import(`, `await(`, `setTimeout(` and `obj.t(` — without
 * it the scan reports `expo-updates` and `allowed` as missing translation keys.
 */
const CALL = /(?<![\w$.])t\(\s*['"]([\w.\-]+)['"]\s*(?:,\s*\{([\s\S]*?)\}\s*)?\)/g;

/** Top-level option names in a `{ a, b: expr(x), c }` literal — brace-depth aware. */
function suppliedNames(opts: string): Set<string> {
  const names = new Set<string>();
  let depth = 0;
  let cur = '';
  const flush = () => {
    const nm = cur.trim().split(':')[0].trim();
    if (/^\w+$/.test(nm)) names.add(nm);
    cur = '';
  };
  for (const ch of opts) {
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) flush();
    else cur += ch;
  }
  flush();
  return names;
}

type Site = { file: string; key: string; opts: string };
const SITES: Site[] = [];
for (const f of FILES) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of src.matchAll(CALL)) SITES.push({ file: f, key: m[1], opts: m[2] ?? '' });
}

describe('every translation key a screen asks for has something to render', () => {
  it('found the call sites (the scan itself must not silently match nothing)', () => {
    expect(SITES.length).toBeGreaterThan(2000);
  });

  it('no key renders as its own name', () => {
    /**
     * `defaultValue` is i18next's supported escape hatch and renders real English, so a key that
     * supplies one is fine without a locale entry. Seven of those exist (PLAY, SCORE TREND, …).
     */
    const missing = SITES
      .filter((s) => valuesFor(s.key).length === 0 && !/\bdefaultValue\s*:/.test(s.opts))
      .map((s) => `${s.file} :: ${s.key}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('no value carries a placeholder its call site does not fill', () => {
    const unfilled: string[] = [];
    for (const s of SITES) {
      const vals = valuesFor(s.key);
      if (vals.length === 0) continue;
      const placeholders = new Set(vals.flatMap((v) => [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])));
      const names = suppliedNames(s.opts);
      for (const p of placeholders) if (!names.has(p)) unfilled.push(`${s.file} :: ${s.key} needs {{${p}}}`);
    }
    expect([...new Set(unfilled)]).toEqual([]);
  });
});

describe('keys assembled at runtime resolve for every value the code can produce', () => {
  /**
   * A regex cannot follow `t('play.mode_' + m)`. These are the concatenations that exist, with the
   * value sets their call sites iterate — read off the code, and asserted so that adding a fifth
   * round mode or a fourth mental state without its copy fails here instead of on the screen.
   */
  const DYNAMIC: [string, string[], string[]][] = [
    ['play.mode_', ['break_100', 'break_90', 'break_80', 'free_play'], ['_title', '_desc']],
    ['play.mental_', ['fresh', 'neutral', 'tense'], ['']],
    ['swinglab.card_', ['library', 'drills', 'smartmotion', 'tempo', 'coach-mode'], ['_title', '_sub']],
  ];

  it.each(DYNAMIC)('%s resolves for each value', (prefix, values, suffixes) => {
    const missing: string[] = [];
    for (const v of values) for (const sfx of suffixes) {
      const key = `${prefix}${v}${sfx}`;
      if (valuesFor(key).length === 0) missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it('the enumerated value sets still match the code that iterates them', () => {
    // If play.tsx stops mapping exactly these, the list above is stale and the guard is a fiction.
    const play = fs.readFileSync(path.join(root, 'app/(tabs)/play.tsx'), 'utf8');
    expect(play).toContain("(['fresh', 'neutral', 'tense'] as const).map");
    expect(play).toMatch(/t\('play\.mental_' \+ m\)/);
    expect(play).toMatch(/t\('play\.mode_' \+ m \+ '_title'\)/);
  });
});
