/**
 * 2026-09-18 (Tim) — "We have a default mid handicapper bag like an off the rack set would have."
 *
 * The one-press starting bag. Three ways a hand-written list like this goes wrong quietly, all of
 * them invisible on the screen that offers it:
 *
 *   1. A club id that is not in the catalog. It registers, the rack renders nothing for it, and the
 *      player owns a club they cannot see or remove — the exact shape app/bag-scan's "other" section
 *      exists to surface.
 *   2. More than fourteen. The screen would hand a player a bag that breaks USGA 4.1b(1) before
 *      they have touched anything.
 *   3. A club the caddie has no default carry for. The whole point of putting clubs in the bag is
 *      that the caddie clubs off them; a slot with no number is a club it cannot recommend.
 */
import { STANDARD_SET, STANDARD_CARRY_YARDS } from '../../services/standardBag';
import { CLUB_SNAP_ORDER } from '../../services/clubBagReconcile';
import { USGA_CLUB_LIMIT, PUTTER_ID } from '../../store/clubBagStore';
import { normalizeClub } from '../../services/clubNormalize';

describe('the off-the-rack set is a bag a player could actually carry', () => {
  it('is exactly the legal fourteen, with no duplicates', () => {
    expect(STANDARD_SET).toHaveLength(USGA_CLUB_LIMIT);
    expect(new Set(STANDARD_SET).size).toBe(USGA_CLUB_LIMIT);
  });

  it('every club in it is a club the rest of the app knows', () => {
    for (const id of STANDARD_SET) expect(CLUB_SNAP_ORDER).toContain(id);
  });

  it('carries a putter, a driver and a wedge — it is a SET, not a list of irons', () => {
    expect(STANDARD_SET).toContain(PUTTER_ID);
    expect(STANDARD_SET).toContain('DR');
    expect(STANDARD_SET).toContain('SW');
  });

  it('the caddie can quote a distance for every club it just handed the player', () => {
    for (const id of STANDARD_SET) {
      if (id === PUTTER_ID) continue;                       // a putter carries nothing, by design
      const name = normalizeClub(id);
      expect(name).not.toBeNull();
      expect(STANDARD_CARRY_YARDS[name as keyof typeof STANDARD_CARRY_YARDS]).toBeGreaterThan(0);
    }
  });

  it('descends — no gap where a club is longer than the one above it', () => {
    const carries = STANDARD_SET
      .filter((id) => id !== PUTTER_ID)
      .map((id) => STANDARD_CARRY_YARDS[normalizeClub(id) as keyof typeof STANDARD_CARRY_YARDS]);
    for (let i = 1; i < carries.length; i++) expect(carries[i]).toBeLessThan(carries[i - 1]);
  });
});
