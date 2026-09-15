/**
 * 2026-09-15 (Tim, from production on his phone):
 *   "Also there is no way to edit club distances especially if tracked."
 *   "No carry vs total toggle when setting club distances."
 *
 * THREE DEFECTS IN ONE ROW OF THE FIT PROFILE, all proved by execution before the fix.
 *
 *  1. THE STATED NUMBER DID NOTHING ON A TRACKED CLUB. `ownCarry` tested the measured ladder first,
 *     so setting a tracked 7 iron to 135 left `carryFor` answering 160 for ever. The player's own
 *     correction was accepted by the UI and discarded by the store.
 *
 *  2. A CLUB HE HAD SET COULD NEVER BE SET AGAIN. The row was tappable only when `!c.measured`, and
 *     `measured` was `hasCarry`, which is TRUE for a number he typed. So the first save locked the
 *     row — and the bin that clears the override rendered only inside the row he could no longer
 *     open. The control existed and was unreachable for exactly the clubs it was for.
 *
 *  3. THE DOT LIED AND THE HEADER COUNTED THE LIE. Same `hasCarry`: a club he typed painted the
 *     green "tracked from your shots" dot, the header read "1 tracked · 0 you set", and confidence
 *     climbed toward 'high' on a hand-filled bag — which fitProfile's own comment says must never
 *     happen on stated alone.
 *
 * AND THE UNIT. Every stated number was filed as a CARRY. Most golfers know their clubs as a TOTAL
 * ("my seven iron goes 150" is where it stopped), so a player entering the number he actually knows
 * was over-stating his carry by the rollout of every club in the bag — 28 yards of it on the driver,
 * with the caddie clubbing him over hazards on the strength of it. The default is TOTAL for the
 * reason the app already wrote down on 2026-09-12 for the spoken path: an over-stated carry loses a
 * ball, an under-stated one costs a few yards of club.
 *
 * These are BEHAVIOURAL assertions — they run the store rather than reading the file — because every
 * one of these bugs was a precedence bug, and precedence is not visible in a grep.
 */
import { useClubStatsStore, statedCarryFromEntry, statedEntryFromCarry, getLearnedClubDistances, getLearnedCarryDistances, CLUB_ORDER } from '../../store/clubStatsStore';
import { ROLL_YARDS } from '../../services/standardBag';
import { composeFitProfile } from '../../services/practice/fitProfile';

/**
 * `clearAll()` deliberately wipes only the MEASURED ladders — a bag the player typed is not a "stat"
 * and survives a stats reset. So a test that wants a truly empty store has to clear the stated bag
 * itself, for every club, not for the handful it happens to be thinking about.
 */
const reset = () => {
  const st = useClubStatsStore.getState();
  st.clearAll();
  for (const c of CLUB_ORDER) useClubStatsStore.getState().clearManual(c);
};

describe('the number he typed wins', () => {
  beforeEach(reset);

  it('a stated carry overrides a TRACKED carry — the bug he reported', () => {
    const st = () => useClubStatsStore.getState();
    st().recordCarry('7I', 160);
    st().recordCarry('7I', 160);
    expect(st().carryFor('7I')).toBe(160);

    st().setManual('7I', 135, 'carry');
    expect(st().carryFor('7I')).toBe(135);   // was 160 — the edit did nothing at all
  });

  it('and clearing it hands the club straight back to the measurement', () => {
    const st = () => useClubStatsStore.getState();
    st().recordCarry('7I', 160);
    st().setManual('7I', 135, 'carry');
    st().clearManual('7I');
    expect(st().carryFor('7I')).toBe(160);   // the measured ladder kept accruing underneath
  });

  it('carry and total tell the SAME story about which source won', () => {
    const st = () => useClubStatsStore.getState();
    st().recordTotal('7I', 200);             // a tracked tee-to-rest total
    st().setManual('7I', 150, 'carry');
    // Both must answer from his stated number, or one club reads two different ways on one screen.
    expect(st().carryFor('7I')).toBe(150);
    expect(st().totalFor('7I')).toBe(150 + ROLL_YARDS['7I']);
  });
});

describe('a stated number carries its unit', () => {
  beforeEach(reset);

  it('a stated TOTAL is stored as the carry it implies, not as a carry of the same size', () => {
    const st = () => useClubStatsStore.getState();
    st().setManual('7I', 165, 'total');
    expect(st().carryFor('7I')).toBe(165 - ROLL_YARDS['7I']);   // 159, not 165
    expect(st().totalFor('7I')).toBe(165);                      // and reads back exactly
  });

  it('the driver is where filing a total as a carry costs the most', () => {
    const st = () => useClubStatsStore.getState();
    st().setManual('Driver', 250, 'total');
    expect(ROLL_YARDS.Driver).toBe(28);
    expect(st().carryFor('Driver')).toBe(222);   // 28 yards of hazard, every tee shot
  });

  it('round-trips exactly in both units, for every club in the bag', () => {
    const st = () => useClubStatsStore.getState();
    for (const club of ['Driver', '7I', 'PW'] as const) {
      for (const unit of ['carry', 'total'] as const) {
        st().setManual(club, 140, unit);
        expect(st().statedUnitFor(club)).toBe(unit);
        expect(st().statedEntryFor(club)).toBe(140);   // shown back as he typed it
        st().clearManual(club);
      }
    }
  });

  it('the helpers are each other\'s inverse — the pair cannot drift', () => {
    for (const club of ['Driver', '5I', 'SW'] as const) {
      for (const unit of ['carry', 'total'] as const) {
        const carry = statedCarryFromEntry(club, 150, unit);
        expect(statedEntryFromCarry(club, carry, unit)).toBe(150);
      }
    }
  });

  it('carry is the default, and the default is never persisted as a value', () => {
    const st = () => useClubStatsStore.getState();
    st().setManual('9I', 130);
    expect(st().statedUnitFor('9I')).toBe('carry');
    expect(useClubStatsStore.getState().manualUnit['9I']).toBeUndefined();
  });
});

describe('the badge names the source of the number on the row', () => {
  beforeEach(reset);

  it('a number he typed is NOT tracked', () => {
    const st = () => useClubStatsStore.getState();
    st().setManual('7I', 150, 'carry');
    expect(st().hasTrackedCarry('7I')).toBe(false);   // the green dot's test
    expect(st().hasCarry('7I')).toBe(true);           // "we have an honest carry" — still true
    expect(st().hasManual('7I')).toBe(true);
  });

  it('a stated-only bag counts as STATED and cannot reach high confidence', () => {
    const st = () => useClubStatsStore.getState();
    const clubs = ['Driver', '3W', '5I', '6I', '7I', '8I', '9I', 'PW'] as const;
    for (const c of clubs) st().setManual(c, 150, 'carry');
    const p = composeFitProfile(clubs.map((c) => ({
      club: c, yards: st().carryFor(c), measured: st().hasTrackedCarry(c), stated: st().hasManual(c), uses: 0,
    })));
    expect(p.measuredCount).toBe(0);          // was 8 — the header said it had tracked them
    expect(p.statedCount).toBe(8);
    expect(p.confidence).not.toBe('high');    // fitProfile's own rule, finally enforced
  });

  it('a club with BOTH shows the tracked number too, so the override is not a trapdoor', () => {
    const st = () => useClubStatsStore.getState();
    st().recordCarry('7I', 158);
    st().setManual('7I', 135, 'carry');
    expect(st().carryFor('7I')).toBe(135);         // his number is the answer
    expect(st().trackedCarryFor('7I')).toBe(158);  // and the measurement is still legible
  });

  it('trackedCarryFor is null when nothing was ever tracked', () => {
    const st = () => useClubStatsStore.getState();
    st().setManual('PW', 110, 'carry');
    expect(st().trackedCarryFor('PW')).toBeNull();
  });
});

/**
 * 2026-09-15 — THE SECOND LADDER, caught re-reading the same day's work.
 *
 * `getLearnedClubDistances` carried its own copy of the precedence: measured-total → carry+roll →
 * stated+roll, in three lines of its own. It became wrong the hour `totalFor` started letting a
 * stated number win — and it is not a minor reader. It is the bag the BRAIN quotes
 * (caddieMemoryRetrieval) and the one the carry recommendation reads (bagRecommendation), so Tim
 * would have corrected a club, watched the Fit Profile agree with him, and then heard Kevin club him
 * off the number he had just replaced. The reported bug, moved one pipe to the left.
 *
 * Both helpers delegate to the store now. This asserts the AGREEMENT rather than the delegation,
 * because agreement is the thing that actually matters and a grep cannot see it.
 */
describe('the bag the caddie quotes is the bag the screen shows', () => {
  beforeEach(reset);

  it('a stated number reaches the learned TOTAL bag, not just the screen', () => {
    const st = () => useClubStatsStore.getState();
    st().recordTotal('7I', 200);                 // a tracked total the caddie used to quote
    st().setManual('7I', 150, 'carry');          // ...and his correction
    const learned = getLearnedClubDistances();
    expect(learned['7I']).toBe(150 + ROLL_YARDS['7I']);   // was 200 — his edit never reached the brain
    expect(learned['7I']).toBe(st().totalFor('7I'));
  });

  it('both learned bags agree with the store, club by club, however the evidence is mixed', () => {
    const st = () => useClubStatsStore.getState();
    st().recordCarry('9I', 130);                 // tracked carry only
    st().recordTotal('Driver', 250);             // tracked total only
    st().setManual('7I', 165, 'total');          // stated total only
    st().recordCarry('PW', 112);
    st().setManual('PW', 105, 'carry');          // both — the override case

    const totals = getLearnedClubDistances();
    const carries = getLearnedCarryDistances();
    for (const club of ['9I', 'Driver', '7I', 'PW'] as const) {
      expect(totals[club]).toBe(st().totalFor(club));
      expect(carries[club]).toBe(st().carryFor(club));
    }
  });

  it('a club with no evidence at all is in neither bag — no chart number quoted as his', () => {
    const totals = getLearnedClubDistances();
    const carries = getLearnedCarryDistances();
    expect(totals['5I']).toBeUndefined();
    expect(carries['5I']).toBeUndefined();
  });
});

/**
 * 2026-09-15, THE SAME-DAY AUDIT — A TYPO COULD WALL A CLUB OFF FROM ITS OWN MEASUREMENTS.
 *
 * A stated number is not only what the player is quoted: it is the CENTRE of the plausibility band
 * that decides which measured shots may enter the ladder. So a driver stated at 15 yards gave a band
 * of 8–22, and every real 240-yard drive he hit afterwards was rejected at ingest. One fat-finger,
 * silently, for ever — and nothing on any screen said why. Reproduced before the fix.
 *
 * Opening editing on all fourteen clubs (today's change) turned this from a corner into fourteen
 * chances to hit it, so it is fixed in two layers:
 *   - `setManual` REFUSES a number that is impossible for the club, and says so to its caller.
 *   - a stated number that is wildly out of line with the chart still ANSWERS (he said it) but stops
 *     acting as a gate on his shots, which heals a store already poisoned before this shipped.
 */
describe('a mistyped distance cannot wall a club off from its own shots', () => {
  beforeEach(reset);

  it('15 instead of 150 on the driver is refused outright, and the club still learns', () => {
    const st = () => useClubStatsStore.getState();
    expect(st().setManual('Driver', 15, 'carry')).toBe(false);
    expect(st().manual['Driver']).toBeUndefined();
    expect(st().recordCarry('Driver', 240)).toBe(true);     // was rejected — the band was 8–22
    expect(st().carryFor('Driver')).toBe(240);
  });

  it('30 yards of TOTAL on a driver is 2 yards of carry — refused on the stored value, not the typed one', () => {
    const st = () => useClubStatsStore.getState();
    expect(st().setManual('Driver', 30, 'total')).toBe(false);
    expect(st().manual['Driver']).toBeUndefined();
  });

  it('a 50 that survives the floor still answers, but never gates his shots', () => {
    const st = () => useClubStatsStore.getState();
    expect(st().setManual('Driver', 50, 'carry')).toBe(true);
    expect(st().recordCarry('Driver', 240)).toBe(true);   // the chart is the band centre, not his 50
    expect(st().carryFor('Driver')).toBe(50);             // he said it, so it is what he is quoted
    expect(st().trackedCarryFor('Driver')).toBe(240);     // ...and the row shows him the 240 beside it
  });

  it('a senior with a genuine 130-yard driver carry still widens his own band', () => {
    const st = () => useClubStatsStore.getState();
    expect(st().setManual('Driver', 130, 'carry')).toBe(true);
    // 138 is 1.06x HIS number but only 0.56x the chart. The whole point of centring on his number.
    expect(st().recordCarry('Driver', 138)).toBe(true);
  });

  it('a full lob wedge at the floor is still allowed', () => {
    expect(useClubStatsStore.getState().setManual('LW', 30, 'carry')).toBe(true);
  });

  it('clearing is never a refusal', () => {
    const st = () => useClubStatsStore.getState();
    st().setManual('7I', 150, 'carry');
    expect(st().setManual('7I', 0, 'carry')).toBe(true);
    expect(st().manual['7I']).toBeUndefined();
  });

  it('the writers report whether the sample was KEPT, so no screen can count a drop as a success', () => {
    const st = () => useClubStatsStore.getState();
    expect(st().recordCarry('PW', 110)).toBe(true);
    expect(st().recordCarry('PW', 900)).toBe(false);   // out of band → dropped, and it says so
    expect(st().recordTotal('PW', 5)).toBe(false);
  });
});

/**
 * 2026-09-15 — THE SCREEN AND THE CADDIE MUST COUNT THE SAME GAPS.
 *
 * `services/caddieDecision` builds the same Fit Profile input the screen builds, and used the wider
 * `hasCarry` for `measured` while the screen moved to `hasTrackedCarry`. It changes nothing today —
 * `evidenceRank` only breaks ties between DUPLICATE rows for one club, and both callers build one row
 * per CLUB_ORDER name — which is exactly why it would have gone unnoticed if it ever started to. The
 * caddie reasoning about a different bag from the one on screen is a split nobody would look for, so
 * this asserts the EQUALITY rather than the call.
 */
describe('the gaps the caddie reasons about are the gaps the screen draws', () => {
  beforeEach(reset);

  it('both ways of flagging evidence produce the identical gap list', () => {
    const st = () => useClubStatsStore.getState();
    st().setManual('Driver', 250, 'carry');   // stated only
    st().recordCarry('7I', 150);              // tracked only
    st().setManual('PW', 110, 'carry');
    st().recordCarry('PW', 118);              // both — the override case
    st().setManual('SW', 80, 'carry');

    const build = (measuredTest: (c: never) => boolean) => CLUB_ORDER
      .filter((c) => c !== 'Putter')
      .map((c) => ({ club: c, yards: st().carryFor(c), measured: measuredTest(c as never), stated: st().hasManual(c), uses: 0 }));

    const screenWay = composeFitProfile(build((c) => st().hasTrackedCarry(c)));
    const oldCaddieWay = composeFitProfile(build((c) => st().hasCarry(c)));

    expect(screenWay.gaps).toEqual(oldCaddieWay.gaps);
    expect(screenWay.overlaps).toEqual(oldCaddieWay.overlaps);
    expect(screenWay.ladder.map((r) => r.club)).toEqual(oldCaddieWay.ladder.map((r) => r.club));
  });
});
