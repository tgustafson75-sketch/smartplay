/**
 * 2026-09-12 (Tim) — "We have 3 different bag surfaces… these all need to be the same function and
 * same bag truth."
 *
 * WHAT THE CHECK FOUND, and it was better than feared: there is ONE truth (clubBagStore) and ONE
 * editor (app/practice/fit-profile.tsx). The Dashboard card and the Play tab card are two DOORS to
 * that same editor, and "pack your bag" is a computation (services/bagPack) already wired into it as
 * autoPack — not a third bag.
 *
 * So the problem was presentation, not data. Three things made one feature look like three:
 *
 *   1. TWO NAMES. Dashboard said "MY BAG", Play said "YOUR BAG", same destination.
 *   2. NO LEGEND. The dots (green = tracked, cyan = you set, hollow = estimated) were unexplained.
 *      The confidence line ABOVE them reads like a key — it uses the exact words "tracked" and "you
 *      set" — but its single dot is coloured by CONFIDENCE, so on a low-confidence bag it showed GREY
 *      while the list showed green and cyan, appearing to explain something it contradicted.
 *   3. A LIVE BUG: the packed subset never cleared.
 *
 * The third is the one that mattered. carriedToday is PERSISTED and feeds the caddie payload through
 * carriedList(); `clearCarriedToday` had exactly one caller — a button on the fit-profile screen. So
 * packing a partial bag once made the caddie believe that subset was the bag forever, across every
 * later round, every other course, and app restarts.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('one bag, one editor, two doors', () => {
  it('both cards push to the SAME editor', () => {
    expect(code('app/(tabs)/dashboard.tsx')).toMatch(/router\.push\('\/practice\/fit-profile' as never\)/);
    expect(code('app/(tabs)/play.tsx')).toMatch(/router\.push\('\/practice\/fit-profile' as never\)/);
  });

  it('and call it the same thing — two names is how one feature looks like two', () => {
    const en = JSON.parse(read('i18n/locales/en.json')) as Record<string, Record<string, Record<string, string>>>;
    expect(en.play.play_tab.your_bag).toBe(en.dashboard.text.my_bag);
  });

  it('packing is a COMPUTATION against that one bag, not a third bag', () => {
    // autoPack writes the recommendation into the same carriedToday the manual toggles write.
    const fp = code('app/practice/fit-profile.tsx');
    expect(fp).toMatch(/liveBagPack\(\)/);
    expect(fp).toMatch(/setCarriedToday\(ids, \{ limit \}\)/);
  });
});

describe('the packed bag does not outlive the round', () => {
  it('clears when a round ends', () => {
    const rs = code('store/roundStore.ts');
    expect((rs.match(/clearCarriedToday\(\)/g) ?? []).length).toBe(2);
  });

  it('and when a round is discarded — an abandoned round must not leave it packed', () => {
    const rs = code('store/roundStore.ts');
    /**
     * The IMPLEMENTATION, not the type declaration — `discardRound:` appears first in the state
     * interface, ~26k chars earlier, and a window anchored there tests nothing.
     */
    const at = rs.indexOf('discardRound: () => {');
    expect(at).toBeGreaterThan(-1);
    expect(rs.slice(at, at + 700)).toMatch(/clearCarriedToday\(\)/);
  });

  it('a missed clear can never fail the round save', () => {
    const rs = code('store/roundStore.ts');
    const at = rs.indexOf('clearCarriedToday()');
    expect(rs.slice(Math.max(0, at - 200), at)).toMatch(/try \{/);
  });

  it('the full bag is the fallback, which is the SAFE direction', () => {
    /**
     * An empty carriedToday means "carrying everything". Falling back to the full bag can at worst
     * suggest a club left at home — noticed instantly. A stale partial bag silently removes clubs the
     * player IS holding, which they never see.
     */
    expect(code('store/clubBagStore.ts')).toMatch(/if \(!carried \|\| carried\.length === 0\) return all;/);
  });
});

describe('the dots have a key, and it cannot drift from the dots', () => {
  const fp = code('app/practice/fit-profile.tsx');

  it('there is ONE owner of what a dot looks like', () => {
    expect(fp).toMatch(/const dotStyleFor = \(measured/);
  });

  it('the list rows use it', () => {
    expect(fp).toMatch(/styles\.measuredDot, dotStyleFor\(c\.measured, c\.stated\)/);
  });

  it('and so does the legend — a separately-maintained legend is a legend that lies', () => {
    const at = fp.indexOf('styles.keyRow');
    expect(at).toBeGreaterThan(-1);
    expect(fp.slice(at, at + 600)).toMatch(/dotStyleFor\(m, st\)/);
  });

  it('the legend names all THREE states, not just the two coloured ones', () => {
    const en = JSON.parse(read('i18n/locales/en.json')) as Record<string, Record<string, Record<string, string>>>;
    expect(en.practice_fit_profile.key.tracked).toMatch(/measured/i);
    expect(en.practice_fit_profile.key.you_set).toBeTruthy();
    expect(en.practice_fit_profile.key.estimated).toMatch(/not yours yet/i);
  });

  /**
   * DELIBERATELY NOT ASSERTED: "these colour literals appear nowhere else."
   *
   * Two attempts at that failed, and both failures were the guard's fault rather than the code's —
   * #3FB950 also serves the CONFIDENCE dot (a different axis) and a checkmark icon, and #22d3ee also
   * labels the Shaft Flex card. Counting colour literals in a file measures palette reuse, not
   * ownership, so it would have failed on correct code forever.
   *
   * The three assertions above already pin the real invariant — one definition, and both the list and
   * the legend read from it. A brittle extra check is the "guard that pins the wrong thing" pattern
   * this repo keeps paying for. [[a-guard-can-assert-the-broken-shape]]
   */
});
