/**
 * 2026-09-14 (Tim) — "User can add more than 14 clubs but 14 will load for the course
 * appropriately, or user can select which of the persisted clubs they keep."
 *
 * `carryLimitFor` returned null outside competition until today, on the 09-11 reasoning that
 * "outside competition nobody counts". That was reasoning about the PENALTY and it had quietly
 * become a statement about the BAG. Making the cap universal is right — and it introduced a defect
 * in the same change, which this test exists to pin.
 *
 * `setCarriedToday` enforces the cap by TRIMMING. That is correct where a round starts and wrong on
 * a per-tap edit. An eighteen-club owner tapping ONE club off the pack list handed the store
 * seventeen ids; the store kept the putter and sliced the rest in bag order, returning fourteen. He
 * removed one club and lost four — and the three the app chose for him were 9I, PW and SW, his
 * scoring clubs.
 *
 * The store keeps its guard (a voice path still cannot start a round with fifteen). The SCREEN is
 * what changed: an over-limit selection is held and shown as "take out N more", and nothing is
 * written until it is legal.
 */
import fs from 'fs';
import path from 'path';
import { useClubBagStore, carryLimitFor, USGA_CLUB_LIMIT, PUTTER_ID } from '../../store/clubBagStore';

const EIGHTEEN = ['DR','3W','5W','7W','2H','3H','4H','5H','3I','4I','5I','6I','7I','8I','9I','PW','SW','PT'] as const;
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf-8');

describe('the 14-club cap', () => {
  beforeEach(() => {
    const s = useClubBagStore.getState();
    s.clearBag();
    s.clearCarriedToday();
    for (const id of EIGHTEEN) s.registerClub(id as never, { source: 'manual' });
  });

  it('applies to every round, not only competition', () => {
    expect(carryLimitFor(false)).toBe(USGA_CLUB_LIMIT);
    expect(carryLimitFor(true)).toBe(USGA_CLUB_LIMIT);
  });

  it('still refuses to let any surface start a round with fifteen', () => {
    useClubBagStore.getState().setCarriedToday([...EIGHTEEN], { limit: carryLimitFor(false) });
    expect(useClubBagStore.getState().carriedToday).toHaveLength(USGA_CLUB_LIMIT);
    expect(useClubBagStore.getState().carriedToday).toContain(PUTTER_ID);
  });

  it('the pack screen holds an over-limit selection instead of handing the store a trim', () => {
    /**
     * The behaviour is in a screen, so this asserts the shape that makes it impossible: the toggle
     * must return BEFORE writing when the selection is over the limit. Without that early return,
     * the arithmetic below is what the player gets.
     */
    const src = read('app/practice/fit-profile.tsx');
    const toggle = src.slice(src.indexOf('const togglePacked'), src.indexOf('const autoPack'));
    expect(toggle).toMatch(/if \(next\.size > limit\) \{ setPackDraft\(next\); return; \}/);
    // and the write happens only after that gate
    expect(toggle.indexOf('setPackDraft(next); return;'))
      .toBeLessThan(toggle.indexOf('setCarriedToday'));
  });

  it('demonstrates what the held selection prevents', () => {
    // One club removed from eighteen. This is precisely the list the old toggle handed over.
    const seventeen = EIGHTEEN.filter((c) => c !== '7W');
    useClubBagStore.getState().setCarriedToday([...seventeen], { limit: carryLimitFor(false) });
    const got = useClubBagStore.getState().carriedToday;
    expect(got).toHaveLength(14);
    // Three MORE clubs than he touched are gone, and they are the ones he scores with.
    expect(got).not.toContain('9I');
    expect(got).not.toContain('PW');
    expect(got).not.toContain('SW');
  });

  it('never tells a casual round it is a competition', () => {
    const src = read('app/practice/fit-profile.tsx');
    // The competition sentence must be behind isCompetition, not behind "a limit exists" —
    // which is now always true.
    expect(src).not.toMatch(/\{limit != null && \([\s\S]{0,200}competition_14_club_cap/);
    expect(src).toMatch(/isCompetition\s*\?[\s\S]{0,120}competition_14_club_cap/);
    const pack = read('services/bagPack.ts');
    expect(pack).toMatch(/input\.competition\s*$|input\.competition\n/m);
    expect(pack).toMatch(/that is what a bag starts a round with/);
  });
});
