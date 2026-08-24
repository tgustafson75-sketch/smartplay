/**
 * 2026-08-24 (club sweep, step 1 — inventory every representation of a club).
 *
 * Tim: *"something I thought was going to be the simpler aspect of the app has turned out to be the
 * most complicated missing part, and that's the clubs."*
 *
 * The ordered club catalog was declared SIX times: services/clubBagReconcile, store/clubBagStore
 * (whose own comment read "keep one canonical order everywhere" while declaring its own),
 * api/tutorial-analysis, api/bag-scan, api/club-recognition and api/arccos-import. Five were
 * byte-identical; the sixth dropped 'PT' deliberately. Nothing linked them — the only thing keeping
 * six copies in step was that nobody had edited one yet.
 *
 * These cases pin the catalog itself: its order (which drives every bag display and the brain's bag
 * context), its completeness, and the ONE derived exception.
 */
import { CLUB_SNAP_ORDER, FULL_SWING_CLUB_IDS } from '../../services/clubBagReconcile';

describe('one club catalog', () => {
  it('runs driver → putter, the order every bag surface sorts by', () => {
    expect(CLUB_SNAP_ORDER[0]).toBe('DR');
    expect(CLUB_SNAP_ORDER[CLUB_SNAP_ORDER.length - 1]).toBe('PT');
  });

  it('has no duplicates — a repeated id would put one club in the bag twice', () => {
    expect(new Set(CLUB_SNAP_ORDER).size).toBe(CLUB_SNAP_ORDER.length);
  });

  it('keeps GW before AW, the order the ClubId union and bag-scan already assumed', () => {
    const gw = CLUB_SNAP_ORDER.indexOf('GW');
    const aw = CLUB_SNAP_ORDER.indexOf('AW');
    expect(gw).toBeGreaterThan(-1);
    expect(aw).toBeGreaterThan(-1);
    expect(gw).toBeLessThan(aw);
  });

  it('covers every family — nothing silently missing from a scan enum', () => {
    for (const id of ['DR', '3W', '5W', '7W', '2H', '3H', '4H', '5H',
                      '3I', '4I', '5I', '6I', '7I', '8I', '9I',
                      'PW', 'GW', 'AW', 'SW', 'LW', 'PT']) {
      expect(CLUB_SNAP_ORDER).toContain(id);
    }
    expect(CLUB_SNAP_ORDER).toHaveLength(21);
  });

  it('the full-swing list is the catalog MINUS the putter — derived, so it cannot drift', () => {
    expect(FULL_SWING_CLUB_IDS).not.toContain('PT');
    expect(FULL_SWING_CLUB_IDS).toHaveLength(CLUB_SNAP_ORDER.length - 1);
    // Same order, same members, one omission — not a hand-typed rival list.
    expect([...FULL_SWING_CLUB_IDS]).toEqual(CLUB_SNAP_ORDER.filter((c) => c !== 'PT'));
  });

  it('every full-swing id is a real catalog id', () => {
    for (const id of FULL_SWING_CLUB_IDS) expect(CLUB_SNAP_ORDER).toContain(id);
  });
});
