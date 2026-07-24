/**
 * 2026-07-24 — THE reason club logic kept breaking: a shot's club was written in one of four
 * vocabularies (ClubName "Driver", ClubId "DR", acoustic "D", words "driver") and read as one, so a
 * driver logged by voice ('DR') or quick-log ('driver') never registered in the bag. normalizeClub()
 * collapses all four to the canonical ClubName. These lock the mappings — especially the guaranteed
 * breakers (Driver / Putter, which differ across every vocabulary).
 */
import { normalizeClub, isFullSwingClub } from '../../services/clubNormalize';

describe('normalizeClub — the guaranteed breakers', () => {
  it('maps every Driver form to "Driver"', () => {
    for (const f of ['Driver', 'DR', 'D', 'driver', 'DRIVER']) expect(normalizeClub(f)).toBe('Driver');
  });
  it('maps every Putter form to "Putter"', () => {
    for (const f of ['Putter', 'PT', 'putter', 'PUTTER']) expect(normalizeClub(f)).toBe('Putter');
  });
});

describe('normalizeClub — irons / woods / hybrids / wedges across vocabularies', () => {
  it.each([
    ['7I', '7I'], ['7i', '7I'], ['7-iron', '7I'], ['7 iron', '7I'], ['9-IRON', '9I'],
    ['3W', '3W'], ['3-wood', '3W'], ['5 wood', '5W'],
    ['5H', '5H'], ['5-hybrid', '5H'], ['3 hybrid', '3H'], ['4 rescue', '4H'],
    ['PW', 'PW'], ['pitching wedge', 'PW'], ['pitching', 'PW'],
    ['GW', 'GW'], ['gap wedge', 'GW'],
    ['AW', 'AW'], ['approach wedge', 'AW'],
    ['SW', 'SW'], ['sand wedge', 'SW'], ['LW', 'LW'], ['lob wedge', 'LW'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeClub(input)).toBe(expected);
  });
});

describe('normalizeClub — honest nulls (never guess)', () => {
  it('returns null for a bare/ambiguous or unknown club', () => {
    for (const f of ['hybrid', 'wedge', 'iron', 'wood', 'the big dog', '', '  ', null, undefined]) {
      expect(normalizeClub(f as string)).toBeNull();
    }
  });
  it('isFullSwingClub excludes putter + unresolvable', () => {
    expect(isFullSwingClub('DR')).toBe(true);
    expect(isFullSwingClub('7-iron')).toBe(true);
    expect(isFullSwingClub('PT')).toBe(false);
    expect(isFullSwingClub('hybrid')).toBe(false);
  });
});
