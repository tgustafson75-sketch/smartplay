/**
 * 2026-09-11 — A FIELD THAT DOES NOT PERSIST IS A FEATURE THAT RESETS EVERY LAUNCH.
 *
 * Deep audit. Several persisted stores gained fields today, and each one silently reverting on
 * relaunch would be invisible: the player sets "Full swings", closes the app, and every engine that
 * branches on it — the club gap logic, the override adjustment, the hole plan — quietly goes back to
 * treating them as `some_partials`. Nothing errors. Nothing logs. The feature is just wrong.
 *
 * The two stores use OPPOSITE persistence styles and that is the trap worth guarding:
 *
 *   playerProfileStore   SUBTRACTIVE — names what to DROP, keeps the rest. A new field persists
 *                        automatically, and one that must not persist has to be named.
 *   roundStore           ENUMERATIVE — names what to KEEP. A new field is silently NOT persisted
 *                        until someone adds it, which the file's own comments say has bitten twice:
 *                        "were missing from partialize, so a crash mid-round dropped them".
 *
 * Knowing which style a store uses is the difference between a field that works and one that looks
 * like it works.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the profile store keeps what it is not told to drop', () => {
  const src = code('store/playerProfileStore.ts');

  it('its partialize is SUBTRACTIVE, so a new field persists by default', () => {
    expect(src).toMatch(/const \{ ghin_number, selfieB64, customCaddiePortraitB64, \.\.\.rest \} = s;/);
    expect(src).toMatch(/return rest as Omit<PlayerProfileState/);
  });

  it('so distanceControl survives a relaunch', () => {
    // The setting added today. If this store ever flips to an enumerative partialize, this field has
    // to be named in it or the player's answer resets every launch.
    expect(src).toMatch(/distanceControl: 'full_swings' \| 'some_partials' \| 'dial_down'/);
    const at = src.indexOf('const { ghin_number');
    const dropped = src.slice(at, at + 200);
    expect(dropped).not.toMatch(/distanceControl/);
  });

  it('and the things deliberately NOT persisted are still named', () => {
    // ghin_number for privacy, the base64 blobs because they live in their own store now.
    for (const f of ['ghin_number', 'selfieB64', 'customCaddiePortraitB64']) {
      expect(src).toMatch(new RegExp(`${f}[,\\s]`));
    }
  });
});

describe('the round store keeps only what it names', () => {
  const src = code('store/roundStore.ts');

  it('its partialize is ENUMERATIVE', () => {
    expect(src).toMatch(/partialize: \(s\) => \(\{/);
  });

  it('so the noted penalties had to be named, and are', () => {
    // Added today. Enumerative means silence = data loss on a crash mid-round.
    const at = src.indexOf('partialize: (s) => ({');
    const block = src.slice(at, at + 3000);
    expect(block).toMatch(/notedPenalties: s\.notedPenalties/);
  });

  it('along with the round state a crash must not cost', () => {
    const at = src.indexOf('partialize: (s) => ({');
    const block = src.slice(at, at + 3000);
    for (const f of ['scores', 'putts', 'shots', 'penalties']) {
      expect(block).toMatch(new RegExp(`${f}: s\\.${f}`));
    }
  });
});

describe('the club stats store persists the whole tally', () => {
  const src = code('store/clubStatsStore.ts');

  it('has no partialize at all, so every field persists', () => {
    expect(src).not.toMatch(/partialize/);
  });

  it('which is how the new per-source use tally survives', () => {
    expect(src).toMatch(/repsBySource: Partial<Record<ClubName, Partial<Record<ClubUseSource, number>>>>/);
    expect(src).toMatch(/repsBySource: \{\},/);
  });

  /**
   * The migration is the other half. A player upgrading has persisted state with NO repsBySource,
   * and the migrate function must pass it through without touching the new key — zustand's shallow
   * merge then leaves the initial {} in place. Returning a primitive here would corrupt the store
   * permanently, which is the 2026-09-01 audit finding this guard also preserves.
   */
  it('and old persisted state migrates without losing it', () => {
    expect(src).toMatch(/if \(typeof persisted !== 'object' \|\| persisted === null \|\| Array\.isArray\(persisted\)\) return \{\} as never;/);
    expect(src).toMatch(/return s as never;/);
  });
});
