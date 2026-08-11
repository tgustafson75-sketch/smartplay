/**
 * 2026-08-11 — EVERY club-selection producer, tested together.
 *
 * Tim: "This is one of multiple issues you've come up and said that you've half done… I'm sick of
 * you getting half-ass things done and then giving me an oops."
 *
 * He is describing a real pattern in my work on this exact bug. The gap-wedge-for-a-long-shot defect
 * existed in THREE independent code paths, and I fixed them one at a time across three days, each
 * time reporting it as done:
 *
 *   1. clubStatsStore.inferClub                          (fixed 08-10)
 *   2. equipment_distance_modifier.pickClosestClub        (fixed 08-11, first pass)
 *   3. cnsShotRead.pickClub                               (fixed 08-11, third pass — the one on his
 *                                                          screen: "324y to pin · past you…")
 *
 * Same root cause in all three: the candidate ladder was built ONLY from clubs with evidence, so a
 * player with one logged club got a one-club ladder and every distance resolved to it.
 *
 * This file exists so the QUESTION "does a sparse bag break club selection?" is asked of every
 * producer at once, rather than of whichever one was reported. A fourth producer added later should
 * get a case here on the same day.
 */
import { useClubStatsStore } from '../../store/clubStatsStore';
import { useClubBagStore } from '../../store/clubBagStore';
import { recommendClubFromEquipmentIntelligence } from '../../services/distance/equipment_distance_modifier';
import { composeShotRead } from '../../services/cnsShotRead';

/** The pathological state behind every instance: ONE logged club, a wedge. */
const oneLoggedWedge = () => {
  useClubStatsStore.setState({
    carry: {}, manual: {}, reps: {},
    total: { GW: { club: 'GW', samples: 3, avgYards: 95, lastYards: 95, lastUsedAt: 1 } },
  } as never);
  useClubBagStore.setState({ clubs: {} });
};

beforeEach(oneLoggedWedge);

describe('PRODUCER 1 — clubStatsStore.inferClub', () => {
  it('does not return a wedge for 324 yards', () => {
    expect(useClubStatsStore.getState().inferClub(324)).not.toBe('GW');
  });
  it('does not return a wedge for 304 yards (his hole 5)', () => {
    expect(useClubStatsStore.getState().inferClub(304)).not.toBe('GW');
  });
  it('does not return a wedge for 485 yards (his hole 12)', () => {
    expect(useClubStatsStore.getState().inferClub(485)).not.toBe('GW');
  });
});

describe('PRODUCER 2 — equipment_distance_modifier', () => {
  it.each([324, 304, 485, 220, 165])('does not return a wedge for %iy', (yards) => {
    const r = recommendClubFromEquipmentIntelligence({
      targetYards: yards,
      fallbackClub: 'Driver',
      actualShotHistory: [{ club: 'GW', carryYards: 95, tier: 'actual_shot_history', sampleSize: 3 }],
    });
    expect(r.recommendedClub.toLowerCase()).not.toContain('gw');
    expect(r.recommendedClub.toLowerCase()).not.toContain('gap');
  });
});

describe('PRODUCER 3 — cnsShotRead (the one on his screen)', () => {
  const readFor = (yards: number) =>
    composeShotRead({ rawYards: yards, playsLikeYards: yards, bag: { GW: 95 } } as never);

  it.each([324, 304, 485])('does not put a gap wedge on a %iy shot', (yards) => {
    const club = (readFor(yards)?.club ?? '').toLowerCase();
    expect(club).not.toBe('gw');
    expect(club).not.toContain('gap');
  });

  it('does not claim a CHART number as the player\'s own carry', () => {
    const r = readFor(150);
    const why = (r?.why ?? []).join(' ').toLowerCase();
    // "your 6 iron carries ~165" must only appear for a club he has actually logged.
    if (why.includes('your ')) {
      expect(why).toMatch(/your gap wedge|your gw/);
    }
  });
});

describe('all producers agree on a long shot', () => {
  it('none of them says "wedge" for 324 yards', () => {
    const a = String(useClubStatsStore.getState().inferClub(324)).toLowerCase();
    const b = recommendClubFromEquipmentIntelligence({
      targetYards: 324, fallbackClub: 'Driver',
      actualShotHistory: [{ club: 'GW', carryYards: 95, tier: 'actual_shot_history', sampleSize: 3 }],
    }).recommendedClub.toLowerCase();
    const c = String(composeShotRead({ rawYards: 324, playsLikeYards: 324, bag: { GW: 95 } } as never)?.club ?? '').toLowerCase();
    for (const club of [a, b, c]) {
      expect(club).not.toContain('gw');
      expect(club).not.toContain('gap');
      expect(club).not.toContain('sw');
      expect(club).not.toContain('lw');
    }
  });
});

/**
 * 2026-08-11 (re-check, before moving on) — the two CLUB VOCABULARIES.
 *
 * Caught by re-reading my own fix rather than by a failure: bagDistances() keys are ClubName
 * ('7I', '3W'); STANDARD_LADDER is labelled ('7 Iron', '3 Wood'). Merging raw ADDED '7I':165 beside
 * the chart's '7 Iron':155 — the same club twice. That skews the bag extremes ("past your longest")
 * and lets the caddie speak a store key at the player. A measured club must REPLACE its chart
 * counterpart, which is what "override club by club" has to mean.
 */
describe('the two club vocabularies must not duplicate a club', () => {
  const readWith = (bag: Record<string, number>, yards: number) =>
    composeShotRead({ rawYards: yards, playsLikeYards: yards, bag } as never);

  it('a measured 7I replaces the chart 7 Iron rather than sitting beside it', () => {
    const r = readWith({ '7I': 165 }, 165);
    // The spoken club must be the readable LABEL, never the store key.
    expect(r?.club).toBe('7 Iron');
    expect(r?.club).not.toBe('7I');
  });

  it('speaks a readable club label, not a store key, at every distance', () => {
    for (const y of [95, 150, 165, 250, 324]) {
      const club = readWith({ '7I': 165, GW: 95 }, y)?.club ?? '';
      expect(club).not.toMatch(/^\d[IHW]$/); // '7I', '3W', '4H' are store keys
    }
  });

  it('the measured number is what gets used for that club', () => {
    // 7I measured at 165 must win at 165 over the chart's 7 Iron (155).
    const r = readWith({ '7I': 165 }, 165);
    expect(r?.why.some((w: string) => /carries ~165/.test(w))).toBe(true);
  });

  it('still never puts a wedge on a long shot with the vocabulary mapping in play', () => {
    expect((readWith({ GW: 95 }, 324)?.club ?? '').toLowerCase()).not.toContain('gw');
  });
});
