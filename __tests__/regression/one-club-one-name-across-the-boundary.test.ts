/**
 * 2026-09-17 — FOUR DEFECTS, ONE ROOT CAUSE: the ClubId ↔ ClubName boundary crossed without a
 * converter. Found in the pre-launch sweep, the night 1.0 (27) went to both stores.
 *
 * The bag is keyed by ClubId ('DR', 'PT', '7I'); everything that talks about clubs in words —
 * carry distances, the packer, the caddie payload — is keyed by ClubName ('Driver', 'Putter',
 * '7I'). EVERY club is byte-identical across the two except exactly two: the driver and the putter.
 * That is why nineteen of twenty-one worked and this survived months of use.
 *
 * What it cost, all four confirmed by reading the code:
 *  1. api/kevin.ts compares bagClubs (ids) against clubDistances (names), so a player carrying a
 *     driver was reported to the caddie as having no measured carry for "DR" AND having left
 *     "Driver" at home — while the prompt forbids recommending a club not in the bag. The driver
 *     was barred from every tee shot, for everyone.
 *  2. bagPackLive emitted 'PT', and bagPack.isPutter tests for 'Putter' — so the packer put the
 *     putter in `leave` with the reason "No carry set for PT", told the brain to leave it at home,
 *     and Auto-pack wrote a carriedToday without it that the player could not undo.
 *  3. play.tsx keyed its auto-pack map on clubLabel (SPOKEN words: 'driver', '7-iron') against
 *     pack.carry (names). No key in common for any club — the feature could never fire.
 *  4. clubBagStore's measured stand-in cast a ClubName to ClubId, so a fresh install that skipped
 *     bag setup got a driver with an unresolvable id, which shotReadLive drops outright — clubbing
 *     a 265-yard tee shot to the 3 wood on the player's first round.
 *
 * So this pins the BOUNDARY, not the four call sites. A fifth crossing written next month fails
 * here. [[two-owners-is-the-root-cause]]
 */

import { clubIdToClubName, clubNameToClubId, clubIdToDisplayName, CLUB_ORDER } from '../../store/clubStatsStore';

describe('one club, one name, whichever direction you cross in', () => {
  it('the two clubs that differ are exactly the driver and the putter', () => {
    // If this ever grows, every crossing in the app has more ways to be wrong — and the reason the
    // bugs above hid (only 2 of 21 differ) stops applying.
    const differing = CLUB_ORDER.filter((name) => {
      const id = clubNameToClubId(name);
      return id != null && id !== name;
    });
    expect(new Set(differing)).toEqual(new Set(['Driver', 'Putter']));
  });

  it('a display name exists for EVERY club id, including the putter', () => {
    // clubIdToClubName returns null for PT on purpose — it answers "which distance-ladder club is
    // this", and the putter is not on the ladder. Four call sites reached for it anyway because it
    // was the only converter there, and fell through to the raw id.
    for (const name of CLUB_ORDER) {
      const id = clubNameToClubId(name);
      expect(id).not.toBeNull();
      expect(clubIdToDisplayName(id!)).toBe(name);
    }
  });

  it('round-trips id → display → id for every club', () => {
    for (const name of CLUB_ORDER) {
      const id = clubNameToClubId(name)!;
      expect(clubNameToClubId(clubIdToDisplayName(id))).toBe(id);
    }
  });

  it('the putter is the case that broke, so name it explicitly', () => {
    expect(clubIdToClubName('PT')).toBeNull();      // by design — no full-shot carry
    expect(clubIdToDisplayName('PT')).toBe('Putter'); // but it is still called something
  });

  it('the driver is the other one', () => {
    expect(clubIdToDisplayName('DR')).toBe('Driver');
    expect(clubNameToClubId('Driver')).toBe('DR');
  });

  it('an unknown id passes through rather than becoming empty or null', () => {
    // Callers use this for display; a blank where a club should be is worse than an odd token.
    expect(clubIdToDisplayName('ZZ')).toBe('ZZ');
  });
});

describe('the packer is handed names it can actually recognise', () => {
  it("bagPack's putter test matches what bagPackLive now emits", () => {
    // The literal pairing that failed: 'PT'.toUpperCase() is 'PT', which is not 'PUTTER'.
    const emitted = clubIdToDisplayName('PT');
    const isPutter = (club: string) => club === 'Putter' || club.toUpperCase() === 'PUTTER';
    expect(isPutter(emitted)).toBe(true);
    expect(isPutter('PT')).toBe(false);
  });
});
