/**
 * 2026-08-12 — every persisted store must be a DECISION, not an oversight.
 *
 * "A store was created after the backup allowlist was curated, so it was silently never backed up"
 * has now happened three times: coach-lesson-history and practice-plan (found 2026-07-24) and
 * green-reads (found today, created 08-06). Each was real device-swap data loss in the interim, and
 * each was found only because someone happened to audit.
 *
 * An allowlist alone cannot catch this, because forgetting to add a key looks exactly like deciding
 * not to. So every persisted store must now appear in EXACTLY ONE of two explicit lists, and this
 * test fails until a new one is placed. That turns a silent omission into a build failure — the only
 * thing that actually stops it recurring.
 */
import fs from 'fs';
import path from 'path';
import { BACKED_UP_STORE_KEYS, NOT_BACKED_UP_STORE_KEYS } from '../../services/cloudSync/snapshot';

const storeDir = path.join(__dirname, '../../store');

/** Every zustand persist key actually on disk. */
function persistedStoreKeys(): { key: string; file: string }[] {
  const out: { key: string; file: string }[] = [];
  for (const f of fs.readdirSync(storeDir)) {
    if (!f.endsWith('.ts')) continue;
    const raw = fs.readFileSync(path.join(storeDir, f), 'utf8');
    if (!raw.includes('persist(')) continue;
    // 2026-09-01 — strip comments before matching. The pattern below requires `{` immediately before
    // `name:`, so a doc comment written above the key made the store INVISIBLE to this sweep — and an
    // invisible store reads as "not persisted" rather than as an error. That is the same failure this
    // guard exists to prevent, arriving through the guard itself.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
    const m = /\{\s*name:\s*'([^']+)'/.exec(src);
    if (m) out.push({ key: m[1], file: f });
  }
  return out;
}

describe('the backup allowlist is complete by construction', () => {
  const stores = persistedStoreKeys();

  it('finds the persisted stores at all — this test must not pass vacuously', () => {
    expect(stores.length).toBeGreaterThanOrEqual(40);
  });

  it.each(stores.map(s => [s.key, s.file]))(
    '%s (%s) is explicitly backed up OR explicitly excluded',
    (key) => {
      const backed = BACKED_UP_STORE_KEYS.includes(key as string);
      const excluded = NOT_BACKED_UP_STORE_KEYS.includes(key as string);
      // Failing here means a new persisted store exists and nobody has said whether its data should
      // survive a device swap. Add it to one list or the other in services/cloudSync/snapshot.ts.
      expect(backed || excluded).toBe(true);
    },
  );

  it('no key claims to be both', () => {
    for (const k of BACKED_UP_STORE_KEYS) expect(NOT_BACKED_UP_STORE_KEYS).not.toContain(k);
  });

  it('neither list references a store that no longer exists', () => {
    // A stale key silently backs up nothing, and reads as coverage that isn't there.
    const live = new Set(stores.map(s => s.key));
    for (const k of NOT_BACKED_UP_STORE_KEYS) expect(live.has(k)).toBe(true);
  });

  it('green reads are backed up — the bug that prompted this guard', () => {
    // Tim asked for these by name: "the putting read worked fantastic but it doesn't go anywhere."
    // They're per-course, per-hole player data, and they were being lost on every device swap.
    expect(BACKED_UP_STORE_KEYS).toContain('green-reads-v1');
  });

  it('the crown jewels are still there', () => {
    for (const k of ['round-store-v1', 'club-stats-v1', 'caddie-memory-v1', 'player-profile-v2']) {
      expect(BACKED_UP_STORE_KEYS).toContain(k);
    }
  });
});
