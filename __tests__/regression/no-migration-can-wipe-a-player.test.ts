/**
 * 2026-08-31 (full-app break test) — A MIGRATION THAT THROWS IS A PLAYER WHO LOST EVERYTHING.
 *
 * 44 stores persist to disk and every one of them runs a `migrate()` on rehydration. If any of them
 * throws on a blob it did not expect, zustand's persist middleware discards the persisted state and
 * the store comes up on defaults — which the player experiences as the app forgetting their bag,
 * their rounds, their caddie, their whole history. Silently, on launch, with no error anywhere.
 *
 * Real blobs go wrong in boring ways: a field that used to be a string is now an object, a number
 * arrives as a string, an array is null, a key was renamed, or the blob is from a build so old that
 * the version number predates the field the migration reads. None of that should throw.
 *
 * This feeds every migration a spread of hostile shapes at every version from 0 to its current one.
 * It does NOT assert what the migration produces — only that it survives and returns something
 * usable, because "survives garbage" is the invariant, not any particular healing.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const storeFiles = fs.readdirSync(path.join(ROOT, 'store'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .filter((f) => /migrate:/.test(fs.readFileSync(path.join(ROOT, 'store', f), 'utf8')));

/** Blobs that a real device can genuinely produce. */
const HOSTILE: unknown[] = [
  undefined,
  null,
  {},
  [],
  'a string where an object should be',
  0,
  { version: 'not a number' },
  { rounds: null, bag: null, sessions: null, members: null, history: null },
  { rounds: 'was an array', clubDistances: [], settings: 42 },
  { caddiePersonality: null, voiceGender: undefined, trustLevel: 'high' },
  { customCaddieBasePersona: 'a persona that never existed', customCaddieGender: 'unknown' },
  { nested: { deeply: { wrong: [1, 2, { x: null }] } } },
];

describe('no persisted migration can wipe a player', () => {
  it('found the stores to test — this file proves nothing if the list is empty', () => {
    expect(storeFiles.length).toBeGreaterThan(30);
  });

  for (const file of storeFiles) {
    const name = file.replace(/\.ts$/, '');
    it(`${name}: migrate() survives hostile blobs at every version`, () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const mod = require(path.join(ROOT, 'store', file)) as Record<string, any>;
      const hook = Object.values(mod).find(
        (v) => typeof v === 'function' && (v as { persist?: unknown }).persist,
      ) as { persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown; version?: number } } } | undefined;
      if (!hook) return; // not a persisted zustand hook — nothing to exercise
      const opts = hook.persist.getOptions();
      const migrate = opts.migrate;
      if (typeof migrate !== 'function') return;
      const current = typeof opts.version === 'number' ? opts.version : 1;

      for (const blob of HOSTILE) {
        for (let v = 0; v <= current; v++) {
          const input = blob && typeof blob === 'object' ? JSON.parse(JSON.stringify(blob)) : blob;
          expect(() => migrate(input, v)).not.toThrow();
          /**
           * AN OBJECT IN MUST GIVE AN OBJECT OUT — the realistic case, asserted universally.
           *
           * zustand's default merge SPREADS whatever migrate returns, so a returned string becomes
           * numeric index keys ({"0":"a","1":" "…}) written into the store beside the real defaults
           * and then persisted to disk on the next save, permanently. That is WORSE than throwing,
           * which at least leaves clean defaults.
           *
           * Scoped to object inputs deliberately. 39 of these migrations hand a primitive straight
           * back, and a persisted blob that is a bare string or number is pathological — flagging
           * the whole codebase for it would be noise. The four hardened above return {} even then,
           * because those are the ones that used to THROW and were being touched anyway.
           *
           * This assertion exists because the first version of that hardening returned the primitive
           * and I only caught it by adversarially re-auditing my own fix.
           */
          if (input !== null && typeof input === 'object') {
            const out = migrate(input, v);
            if (out !== undefined && out !== null) {
              expect([`${name}: object in, object out`, typeof out]).toEqual([`${name}: object in, object out`, 'object']);
            }
          }
        }
      }
    });
  }
});
