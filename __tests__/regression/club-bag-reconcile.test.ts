/**
 * Bag Vision → auto club detection "turn around": reconcileClubWithBag snaps an ambiguous
 * live read to the club the player actually owns. Conservative gates matter (don't override a
 * confident read, don't leap across the bag), so they're pinned here.
 */
import { reconcileClubWithBag } from '../../services/clubBagReconcile';

describe('reconcileClubWithBag', () => {
  it('snaps a medium read to an immediate owned neighbor (4I read → owns 4H)', () => {
    expect(reconcileClubWithBag('4I', 'medium', ['DR', '4H', '5I', '7I', 'PW'])).toBe('4H');
  });

  it('leaves the read alone when it is already owned', () => {
    expect(reconcileClubWithBag('7I', 'medium', ['7I', '8I'])).toBe('7I');
  });

  it('trusts a high-confidence read even if not in the bag', () => {
    expect(reconcileClubWithBag('4I', 'high', ['4H'])).toBe('4I');
  });

  it('does not leap across the bag (only immediate neighbors, distance 1)', () => {
    // 4I is 2 slots from the nearest owned (6I) → no snap.
    expect(reconcileClubWithBag('4I', 'low', ['DR', '6I', 'PT'])).toBe('4I');
  });

  it('no bag → no change', () => {
    expect(reconcileClubWithBag('4I', 'low', [])).toBe('4I');
  });

  it('unknown read is never snapped', () => {
    expect(reconcileClubWithBag('unknown', 'low', ['7I'])).toBe('unknown');
  });

  it('ignores owned ids not in the catalog', () => {
    expect(reconcileClubWithBag('4I', 'low', ['garbage', '5I'])).toBe('5I');
  });
});
