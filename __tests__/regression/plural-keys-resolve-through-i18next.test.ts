/**
 * 2026-09-11 — THE GENERATED PLURAL KEYS MUST ACTUALLY RESOLVE.
 *
 * The third codemod pass replaced English pluralisation welded into JSX
 *
 *     <Text>{dayStreak} day{dayStreak === 1 ? '' : 's'}</Text>
 *
 * with i18next's own mechanism — `t('…day', { count })` against `day_one` / `day_other`. That is the
 * correct representation rather than a workaround: Japanese and Korean do not inflect for number, so
 * no per-branch translation of "" vs "s" could ever be right, and those locales supply `_other` only.
 *
 * Nothing verified the result. A generated `_one`/`_other` pair that i18next cannot select between
 * renders the raw key to the player, and the codemod's own output is exactly the kind of thing that
 * looks right in a diff and fails at runtime. One near-miss already happened in this pass: the
 * counted variable was written into the value under its DERIVED name (`{{day_streak}}`) while the
 * call supplied `{ count }`, leaving a placeholder nothing filled.
 *
 * So this resolves every generated pair through a real i18next instance.
 */
import fs from 'fs';
import path from 'path';
import i18n from 'i18next';

const en = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../i18n/locales/en.json'), 'utf8'),
) as Record<string, unknown>;

function flatten(o: Record<string, unknown>, prefix = '', out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}
const flat = flatten(en);
const pairs = Object.keys(flat).filter((k) => k.endsWith('_one')).map((k) => k.slice(0, -4));

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

describe('generated plural keys resolve through i18next', () => {
  it('found the pairs the codemod produced', () => {
    expect(pairs.length).toBeGreaterThan(20);
  });

  it('every _one has a matching _other', () => {
    const orphans = pairs.filter((base) => flat[`${base}_other`] === undefined);
    expect(orphans).toEqual([]);
  });

  it('selects the singular at count 1 and the plural otherwise — never the raw key', () => {
    const broken: string[] = [];
    for (const base of pairs) {
      const one = i18n.t(base, { count: 1 });
      const many = i18n.t(base, { count: 3 });
      if (one === base || many === base) { broken.push(`${base} (rendered the key)`); continue; }
      if (one === many && flat[`${base}_one`] !== flat[`${base}_other`]) {
        broken.push(`${base} (did not switch form)`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('leaves no unfilled {{placeholder}} when count is supplied', () => {
    // The near-miss: value written as {{day_streak}} while the call passes { count }.
    const unfilled: string[] = [];
    for (const base of pairs) {
      const rendered = i18n.t(base, { count: 2 });
      const names = [...String(flat[`${base}_other`] ?? '').matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      // `count` must always be consumed; any OTHER placeholder is supplied by its call site.
      if (names.includes('count') && rendered.includes('{{count}}')) unfilled.push(base);
    }
    expect(unfilled).toEqual([]);
  });
});
