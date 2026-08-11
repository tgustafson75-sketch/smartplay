/**
 * 2026-08-11 (Tim) — "The caddie suggestion in SmartVision is STILL showing a gap wedge for a three
 * hundred and twenty four yard shot. What did you do to break this?"
 *
 * I DIDN'T BREAK IT — I FIXED ONE PRODUCER AND CALLED IT DONE. Yesterday's fix was to
 * clubStatsStore.inferClub, and it was correct. But SmartVision's club chip doesn't come from
 * inferClub; it comes through recommendClubFromEquipmentIntelligence, which had no notion of whether
 * the club it returns can actually REACH the target.
 *
 * pickClosestClub looks for a club carrying at least the target; when none does, it falls back to
 * "nearest by absolute difference" across whatever clubs we have EVIDENCE for. With sparse
 * evidence — say one logged gap wedge — the nearest (and only) candidate for a 324-yard shot IS
 * that gap wedge, returned with full confidence. The maths did exactly what it was told.
 *
 * A recommendation that cannot reach the target is not a recommendation. These lock that.
 */
import { recommendClubFromEquipmentIntelligence } from '../../services/distance/equipment_distance_modifier';

const gw = (carry: number) => [{ club: 'GW', carryYards: carry, tier: 'actual_shot_history' as const, sampleSize: 1 }];

describe("Tim's exact case: a wedge can never be the answer to 324 yards", () => {
  it('sparse evidence of ONLY a gap wedge → keeps the baseline Driver, not the wedge', () => {
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: 324,
      fallbackClub: 'Driver',
      actualShotHistory: gw(95),
      knownBagClubs: ['GW'],
    });
    expect(r.recommendedClub).toBe('Driver');
    expect(r.recommendedClub).not.toBe('GW');
  });

  it('even a poisoned wedge carry that is still far short cannot claim the shot', () => {
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: 324,
      fallbackClub: 'Driver',
      actualShotHistory: gw(164), // the poisoned ladder from yesterday's other bug
      knownBagClubs: ['GW'],
    });
    expect(r.recommendedClub).toBe('Driver');
  });

  it('explains that the evidence could not reach, rather than silently swapping', () => {
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: 324, fallbackClub: 'Driver', actualShotHistory: gw(95), knownBagClubs: ['GW'],
    });
    expect(r.rationale).toMatch(/reach/i);
  });
});

describe('real evidence still wins — the gate must not neuter the feature', () => {
  it('a club that genuinely carries the number is used', () => {
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: 150,
      fallbackClub: '8 iron',
      actualShotHistory: [{ club: '7I', carryYards: 152, tier: 'actual_shot_history', sampleSize: 4 }],
      knownBagClubs: ['7I'],
    });
    expect(r.recommendedClub).toBe('7I');
  });

  it('a slightly-short club within reach tolerance is still used', () => {
    // 145 of a 150 target — a real club choice a caddie would make.
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: 150,
      fallbackClub: '8 iron',
      actualShotHistory: [{ club: '7I', carryYards: 145, tier: 'actual_shot_history', sampleSize: 4 }],
      knownBagClubs: ['7I'],
    });
    expect(r.recommendedClub).toBe('7I');
  });
});

describe('the other direction: no comical over-club either', () => {
  it('a driver is not recommended for a 40-yard pitch just because it is the only evidence', () => {
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: 40,
      fallbackClub: 'SW',
      actualShotHistory: [{ club: 'Driver', carryYards: 265, tier: 'actual_shot_history', sampleSize: 9 }],
      knownBagClubs: ['Driver'],
    });
    expect(r.recommendedClub).toBe('SW');
  });
});

/**
 * 2026-08-11 (Tim) — "Why are we basing it on evidence? We know a standard golf yardage bag, and we
 * use that as the DEFAULT if we don't have an updated user-specific one. You are over-thinking the
 * shit out of the club issue."
 *
 * He was right and this was the real defect, not the symptom I first patched. The ladder was built
 * ONLY from clubs with evidence, so one logged gap wedge meant a ONE-CLUB ladder and every shot at
 * every distance resolved to it. The fix is the simple model: a complete standard bag is always the
 * baseline; the player's numbers override it club by club, only where we have them.
 */
describe('a complete standard bag is always the baseline', () => {
  it('one logged wedge does NOT collapse the ladder — 324y still finds a real club', () => {
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: 324,
      fallbackClub: 'Driver',
      actualShotHistory: [{ club: 'GW', carryYards: 95, tier: 'actual_shot_history', sampleSize: 3 }],
      // no knownBagClubs: the standard bag fills the ladder
    });
    expect(r.recommendedClub).not.toBe('GW');
  });

  it('mid-iron distances resolve sensibly with only wedge evidence present', () => {
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: 150,
      fallbackClub: '8 iron',
      actualShotHistory: [{ club: 'GW', carryYards: 95, tier: 'actual_shot_history', sampleSize: 3 }],
    });
    expect(r.recommendedClub).not.toBe('GW');
  });

  it("the player's OWN number still overrides the chart for that club", () => {
    // A 7-iron the player actually carries 165 (vs a ~148 chart) must win at 165.
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: 165,
      fallbackClub: '6 iron',
      actualShotHistory: [{ club: '7I', carryYards: 165, tier: 'actual_shot_history', sampleSize: 6 }],
    });
    expect(r.recommendedClub).toBe('7I');
    expect(r.sourceTier).toBe('actual_shot_history');
  });

  it('a registered bag still constrains the ladder to clubs he carries', () => {
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: 324,
      fallbackClub: 'Driver',
      knownBagClubs: ['Driver', '7I', 'PW'],
    });
    // Industry labels are lowercase ('driver'); compare case-insensitively.
    expect(['driver', '7i', 'pw']).toContain(r.recommendedClub.toLowerCase());
  });
});
