/**
 * 2026-09-01 (adversarial audit) — A CORRUPT WRITE MUST COST ONE STORE, NOT POISON IT FOREVER.
 *
 * zustand's persist MERGES what `migrate` returns by spreading it. Hand it a string and 'abc'
 * becomes {0:'a',1:'b',2:'c'} — and that shape is then written back to disk. So returning the raw
 * persisted value when it is a primitive is WORSE than throwing: throwing loses the store once and
 * it comes up on defaults, while spreading corrupts it permanently, on every subsequent launch.
 *
 * A truncated or cleared AsyncStorage write is exactly how a primitive gets there. Three stores were
 * still doing it — issueLogStore (which is how Tim reports every bug), clubStatsStore (the learned
 * bag) and smartFinderStore — after the same class was fixed elsewhere on 08-31.
 */
import fs from 'fs';
import path from 'path';

const storeDir = path.join(__dirname, '..', '..', 'store');

type Store = { name: string; src: string; body: string };

function storesWithMigrations(): Store[] {
  const out: Store[] = [];
  for (const name of fs.readdirSync(storeDir)) {
    if (!name.endsWith('.ts')) continue;
    const src = fs.readFileSync(path.join(storeDir, name), 'utf8');
    const i = src.indexOf('migrate:');
    if (i === -1) continue;
    out.push({ name, src, body: src.slice(i, i + 2600) });
  }
  return out;
}

describe('a migration never hands zustand a primitive', () => {
  const stores = storesWithMigrations();

  it('there are migrations to check', () => {
    expect(stores.length).toBeGreaterThan(3);
  });

  it('THE CLASS: any migration that returns the persisted value first checks it is an object', () => {
    const offenders = stores
      .filter((s) => /return\s+(s|state|prev|persisted)\s*(as never|as \w+)?;/.test(s.body))
      .filter((s) => !/typeof\s+(s|state|prev|persisted)\s*!==\s*'object'/.test(s.body))
      .map((s) => s.name);
    expect(offenders).toEqual([]);
  });

  it('the three found in this audit are guarded, and return {} rather than the value', () => {
    for (const name of ['issueLogStore.ts', 'clubStatsStore.ts', 'smartFinderStore.ts']) {
      const s = stores.find((x) => x.name === name);
      expect(s).toBeDefined();
      expect(s!.body).toMatch(/typeof\s+\w+\s*!==\s*'object'/);
      expect(s!.body).toMatch(/return \{\} as never;/);
    }
  });

  it('an array is refused too — spreading one yields index keys just the same', () => {
    for (const name of ['issueLogStore.ts', 'clubStatsStore.ts', 'smartFinderStore.ts']) {
      const s = stores.find((x) => x.name === name)!;
      expect(s.body).toMatch(/Array\.isArray\(\w+\)/);
    }
  });

  it('null is refused explicitly — typeof null is "object"', () => {
    for (const name of ['issueLogStore.ts', 'clubStatsStore.ts', 'smartFinderStore.ts']) {
      const s = stores.find((x) => x.name === name)!;
      expect(s.body).toMatch(/\w+ === null/);
    }
  });
});
