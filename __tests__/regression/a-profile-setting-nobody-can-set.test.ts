/**
 * 2026-09-11 — A PROFILE FIELD WITH READERS AND NO WRITER, FOR THE FIFTH TIME.
 *
 * On 2026-09-10 four of them were found at once — missType, experienceContext, homeCourse and
 * default_mode — each with live consumers and no way for anyone to set it, so every consumer took
 * its null branch forever. settings.tsx still carries that note.
 *
 * `distanceControl` was the fifth, and the most expensive. It was added to the store with a default
 * and then wired into cnsShotRead's club gapping, the override adjustment and the hole plan. Three
 * features branched on a value nobody could set, so every player in the app was silently treated as
 * 'some_partials' — including Tim, who describes himself as the exact opposite ("all I do right now
 * is full swing and not good with dialing down yardages"). He would have got the wrong plan on
 * every hole of every round.
 *
 * The ORPHAN sweep did not catch it: it looks for unused EXPORTS, and a store action is reached
 * through a destructured bare name, not an import. That blind spot is named in
 * [[sweep-the-missing-half-not-the-unused-export]] — "grep BOTH `.name` and the destructured bare
 * name" — and this closes it for the one store where the miss costs a decision.
 *
 * It guards the SHAPE, derived from the store itself: whatever setters exist must be reachable. It
 * cannot go stale when a field is added, because it reads the list rather than restating it.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../..');
const STORE = path.join(ROOT, 'store/playerProfileStore.ts');

/** Every `setX` action the store declares, read off the source rather than hardcoded. */
const setters = (() => {
  const src = fs.readFileSync(STORE, 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/^\s{2}(set[A-Z][A-Za-z0-9]*)\s*:/gm)) names.add(m[1]);
  return [...names].sort();
})();

/** Files that could call one, excluding the store that declares it. */
const SEARCH_DIRS = ['app', 'components', 'hooks', 'services', 'scripts'];

function callers(name: string): string[] {
  try {
    const out = execFileSync(
      'grep', ['-rlw', '--include=*.ts', '--include=*.tsx', name, ...SEARCH_DIRS],
      { cwd: ROOT, encoding: 'utf8' },
    );
    return out.split('\n').filter(Boolean);
  } catch {
    return []; // grep exits 1 when nothing matches
  }
}

describe('the guard is actually looking at something', () => {
  it('found the store and a realistic number of setters', () => {
    expect(fs.existsSync(STORE)).toBe(true);
    expect(setters.length).toBeGreaterThan(20);
  });

  it('includes the field this was written for', () => {
    expect(setters).toContain('setDistanceControl');
  });

  it('includes the four found on 2026-09-10, so their fix cannot be undone quietly', () => {
    for (const s of ['setMissType', 'setExperienceContext', 'setHomeCourse', 'setDefaultMode']) {
      expect(setters).toContain(s);
    }
  });
});

describe('every player-profile setter can actually be reached', () => {
  it.each(setters)('%s has a caller outside the store', (name) => {
    expect(callers(name).length).toBeGreaterThan(0);
  });
});

describe('the ones a PLAYER owns are editable by the player', () => {
  /**
   * A setter reached only by a service is fine for a LEARNED field — dominantMiss and
   * persistentPatterns are observations, and a settings row for them would be wrong. These are the
   * ones only the player can answer, so only the player can set them, and each needs a real UI.
   */
  const PLAYER_OWNED = [
    'setMissType', 'setExperienceContext', 'setHomeCourse', 'setDefaultMode',
    'setDistanceControl', 'setHandedness', 'setPreferredTee', 'setPhysicalLimitation',
  ];

  it.each(PLAYER_OWNED)('%s is wired to a screen, not just to a service', (name) => {
    const ui = callers(name).filter((f) => f.startsWith('app/') || f.startsWith('components/'));
    expect(ui.length).toBeGreaterThan(0);
  });

  it('distanceControl is offered as the three answers the engines branch on', () => {
    // The values here ARE the branches in cnsShotRead, overrideLoop and holePlan. A fourth option
    // added to the screen without a branch would read as a setting that does nothing.
    const settings = fs.readFileSync(path.join(ROOT, 'app/settings.tsx'), 'utf8');
    const at = settings.indexOf('how_you_cover_a_number');
    expect(at).toBeGreaterThan(-1);
    const block = settings.slice(at, at + 600);
    for (const v of ['full_swings', 'some_partials', 'dial_down']) expect(block).toContain(v);
  });
});
