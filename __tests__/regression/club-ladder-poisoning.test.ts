/**
 * 2026-08-10 (Tim, on his way to play Connecticut National — "it'll have, like, a hundred and
 * sixty four yard shot, and the caddie will default to gap wedge").
 *
 * THE BUG: clubStatsStore.recordInto() writes the FIRST sample verbatim as the club's average, with
 * no sanity check. One mis-attributed shot — a tracked GPS total tagged with the wrong club, a
 * cart-mark on the wrong hole, a bad import row — wrote GW = 164y. From that moment inferClub() was
 * behaving CORRECTLY by its own data: GW really was the closest club to 164y. And it compounds,
 * because every later GW shot averages against the poisoned anchor.
 *
 * THE FIX, locked here: a plausibility band applied at BOTH ends —
 *   - ingest, so a bad sample never enters the ladder;
 *   - read (inferClub), so a store ALREADY poisoned before the fix shipped heals itself without a
 *     migration. That second half is what made Tim's phone recover the same day.
 * Plus: only recommend clubs the player actually carries.
 */
import { useClubStatsStore } from '../../store/clubStatsStore';
import { useClubBagStore } from '../../store/clubBagStore';

const reset = () => {
  useClubStatsStore.setState({ carry: {}, total: {}, manual: {}, reps: {} });
  useClubBagStore.setState({ clubs: {} });
};

beforeEach(reset);

describe('the exact bug: 164 yards must not return a wedge', () => {
  it('picks a mid-iron for 164y on a clean store', () => {
    expect(useClubStatsStore.getState().inferClub(164)).toBe('6I');
  });

  it('REJECTS a 164y shot mis-attributed to the gap wedge at ingest', () => {
    const s = useClubStatsStore.getState();
    s.recordTotal('GW', 164);
    // Never entered the ladder — the ladder is not silently corrupted.
    expect(useClubStatsStore.getState().total.GW).toBeUndefined();
    expect(useClubStatsStore.getState().inferClub(164)).toBe('6I');
  });

  it('HEALS a ladder that was already poisoned before this shipped', () => {
    // Simulate Tim's persisted store: GW carrying a 164y "average" from the old code path.
    useClubStatsStore.setState({
      total: { GW: { club: 'GW', samples: 3, avgYards: 164, lastYards: 164, lastUsedAt: 1 } },
    });
    // Read-time band rejects the impossible value and infers from GW's expected distance instead.
    expect(useClubStatsStore.getState().inferClub(164)).toBe('6I');
  });

  it('still learns a genuinely long hitter — real data inside the band is kept', () => {
    const s = useClubStatsStore.getState();
    s.recordTotal('Driver', 305); // long but believable (chart total 273 → band 150-396)
    expect(useClubStatsStore.getState().total.Driver?.avgYards).toBe(305);
    s.recordTotal('9I', 150); // strong player's 9-iron (chart total 127 → band 70-184)
    expect(useClubStatsStore.getState().total['9I']?.avgYards).toBe(150);
  });

  it('centers the band on the player\'s OWN stated number when My Bag has one', () => {
    const s = useClubStatsStore.getState();
    s.setManual('GW', 130); // Tim states a very strong gap wedge: 130y carry
    // 164 total is now within band of 130 carry + roll, so it is accepted as real.
    useClubStatsStore.getState().recordTotal('GW', 164);
    expect(useClubStatsStore.getState().total.GW?.avgYards).toBe(164);
  });
});

describe('only recommend clubs the player actually carries', () => {
  it('never suggests a club that is not in the registered bag', () => {
    useClubBagStore.setState({
      clubs: {
        DR: { club_id: 'DR', source: 'manual', at: 1 },
        '7I': { club_id: '7I', source: 'manual', at: 1 },
        PW: { club_id: 'PW', source: 'manual', at: 1 },
      } as never,
    });
    // 164y: the 6I that would normally win is NOT in the bag, so the nearest carried club wins.
    expect(useClubStatsStore.getState().inferClub(164)).toBe('7I');
  });

  it('falls open to the full ladder when no bag is registered', () => {
    // inferClub matches a to-target yardage against TOTALS (carry + roll), so the Driver's slot is
    // its 245 chart carry + 28 roll = 273 — not 245, which lands on the 5-wood (242). Asserting the
    // total here keeps the test honest about which ladder inferClub actually reads.
    expect(useClubStatsStore.getState().inferClub(273)).toBe('Driver');
  });
});
