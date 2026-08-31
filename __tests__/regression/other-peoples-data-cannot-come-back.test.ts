/**
 * 2026-08-30 (audit, continued) — REMOVING THE KEYS FROM THE UPLOAD LIST WAS NOT ENOUGH.
 *
 * This morning family, guest, relationship and team stores were dropped from BACKED_UP_STORE_KEYS
 * so they stop leaving the device. Auditing outward from that change found the half it missed:
 *
 * api/backup.ts merges rather than replaces — `{ ...prev, ...next }` — and it does so DELIBERATELY,
 * so a fresh phone holding a near-empty snapshot cannot wipe the cloud. The consequence is that a
 * key already stored SURVIVES every later snapshot that omits it. Every beta backup taken before
 * today still held other people's data, and would keep holding it forever.
 *
 * Three points now enforce one list (services/cloudSync/neverSyncKeys.ts), because three copies of
 * these literals is how they would drift:
 *   1. not gathered for upload      (BACKED_UP_STORE_KEYS)
 *   2. stripped from what is STORED (purges the row on the next backup)
 *   3. stripped from what is SERVED (immediate, and protects clients too old to guard themselves)
 */

import { NEVER_SYNC_STORE_KEYS, stripNeverSyncKeys } from '../../services/cloudSync/neverSyncKeys';
import { BACKED_UP_STORE_KEYS, NOT_BACKED_UP_STORE_KEYS } from '../../services/cloudSync/snapshot';

describe('the list is real and covers the stores that hold other people', () => {
  it('names the four social stores', () => {
    expect([...NEVER_SYNC_STORE_KEYS].sort()).toEqual([
      'family-store-v1', 'guest-profiles-v1', 'relationship-store-v1', 'team-intelligence-store-v1',
    ]);
  });

  it('agrees with the allowlist — never-sync keys are never backed up', () => {
    // The two lists are maintained separately and must not drift apart; this is the assertion that
    // notices if someone re-adds one to the upload list.
    for (const k of NEVER_SYNC_STORE_KEYS) {
      expect(BACKED_UP_STORE_KEYS).not.toContain(k);
      expect(NOT_BACKED_UP_STORE_KEYS).toContain(k);
    }
  });
});

describe('stripping is total and non-destructive', () => {
  it('removes every never-sync key and keeps everything else', () => {
    const blob = {
      'round-store-v1': '{"rounds":[]}',
      'family-store-v1': '{"members":[{"name":"a child"}]}',
      'guest-profiles-v1': '{"guests":[{"name":"someone else"}]}',
      'relationship-store-v1': '{"notes":"private"}',
      'team-intelligence-store-v1': '{"team":"x"}',
      'settings-store-v2': '{"theme":"dark"}',
    };
    const out = stripNeverSyncKeys(blob);
    for (const k of NEVER_SYNC_STORE_KEYS) expect(out).not.toHaveProperty(k);
    expect(out['round-store-v1']).toBe('{"rounds":[]}');
    expect(out['settings-store-v2']).toBe('{"theme":"dark"}');
  });

  it('does not mutate the input', () => {
    const blob = { 'family-store-v1': 'x', 'round-store-v1': 'y' };
    stripNeverSyncKeys(blob);
    expect(blob).toHaveProperty('family-store-v1');
  });

  it('is a no-op on a blob that never had them', () => {
    const clean = { 'round-store-v1': 'y' };
    expect(stripNeverSyncKeys(clean)).toEqual(clean);
  });
});

describe('the server enforces it on BOTH directions', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../api/backup.ts'), 'utf8');

  it('strips what it STORES, applied to the merged result and not just the incoming blob', () => {
    // The data being purged lives in `prev`, so stripping `incoming` alone would purge nothing.
    expect(src).toMatch(/const toStore = stripNeverSyncKeys\(/);
    expect(src).toMatch(/mergeSnapshots\(existing\.data\.data as Record<string, unknown>, incoming\)/);
  });

  it('strips what it SERVES, so an old row cannot re-seed a device', () => {
    expect(src).toMatch(/stripNeverSyncKeys\(data\.data as Record<string, unknown>\)/);
  });

  it('imports the shared list rather than restating the keys', () => {
    // api/* is a Node serverless function and cannot import a store, which is exactly why these
    // literals would otherwise have been copy-pasted into the handler.
    expect(src).toMatch(/from '\.\.\/services\/cloudSync\/neverSyncKeys'/);
    for (const k of NEVER_SYNC_STORE_KEYS) {
      expect(src.includes(`'${k}'`)).toBe(false);
    }
  });
});
