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

/**
 * 2026-08-17 (Tim — "if I say it's an eighteen three driver iron or a fifty two or a fifty six or a
 * fifty eight degree wedge or my driver… club logic, I don't know why we've had such issues with
 * it, but everything needs to be super super clean with it because it's the whole point of golf").
 *
 * The vocabulary a golfer actually speaks: lofts instead of names, spoken number-words above ten,
 * and possessives. None of it resolved. The number-word table stopped at "ten", so the loft
 * matchers that existed for exactly these phrases were unreachable by voice — the 2026-08-10 commit
 * that added driving-iron loft parsing quotes "eighteen degree driving iron" in its own header, and
 * that sentence returned null. Only the typed digits worked.
 */
describe('normalizeClub — the way a golfer actually says a club', () => {
  it.each([
    ['52', 'GW'], ['56', 'SW'], ['58', 'LW'], ['50', 'GW'], ['46', 'PW'], ['60', 'LW'],
  ])('a BARE wedge loft resolves: %s → %s', (raw, expected) => {
    expect(normalizeClub(raw)).toBe(expected);
  });

  it.each([
    ['fifty two', 'GW'], ['fifty-six', 'SW'], ['fifty eight', 'LW'], ['sixty', 'LW'],
  ])('spoken number-words above ten resolve: "%s" → %s', (raw, expected) => {
    expect(normalizeClub(raw)).toBe(expected);
  });

  it.each([
    ['58 degree wedge', 'LW'], ['52 degree', 'GW'], ['56 deg wedge', 'SW'],
  ])('loft with a degree cue: "%s" → %s', (raw, expected) => {
    expect(normalizeClub(raw)).toBe(expected);
  });

  it.each([
    ['driving iron', '3I'], ['utility iron', '3I'],
    ['18 degree driving iron', '3I'], ['eighteen degree driving iron', '3I'],
    ['eighteen three driver iron', '3I'],
  ])('driving / utility irons: "%s" → %s', (raw, expected) => {
    expect(normalizeClub(raw)).toBe(expected);
  });

  it('a driving iron is NOT the driver, even though it contains the word', () => {
    // "driver iron" contains "driver"; the bare-driver check must not claim it.
    expect(normalizeClub('eighteen three driver iron')).toBe('3I');
    expect(normalizeClub('driver')).toBe('Driver');
  });

  it.each([
    ['my driver', 'Driver'], ['my 7 iron', '7I'], ['the pitching wedge', 'PW'],
  ])('possessives and articles are stripped: "%s" → %s', (raw, expected) => {
    expect(normalizeClub(raw)).toBe(expected);
  });

  it.each([
    ['9.5 driver', 'Driver'], ['10.5', 'Driver'], ['9.5', 'Driver'],
  ])('driver lofts survive the decimal point: "%s" → %s', (raw, expected) => {
    // A separator collapse that ate "." turned "10.5" into "10 5" and lost the club entirely.
    expect(normalizeClub(raw)).toBe(expected);
  });

  it.each([
    ['19 degree hybrid', '3H'], ['nineteen hybrid', '3H'], ['15 degree wood', '3W'],
  ])('a loft stays in its own family: "%s" → %s', (raw, expected) => {
    expect(normalizeClub(raw)).toBe(expected);
  });

  it('still refuses to guess when it genuinely cannot tell', () => {
    // Guessing here would corrupt a specific club's learned distances.
    for (const a of ['wedge', 'iron', 'hybrid', 'wood', '', 'the ball']) {
      expect(normalizeClub(a)).toBeNull();
    }
  });

  it('a yardage is not a club', () => {
    // Bare two-digit loft parsing must not swallow three-digit distances.
    expect(normalizeClub('150')).toBeNull();
    expect(normalizeClub('215')).toBeNull();
  });
});
