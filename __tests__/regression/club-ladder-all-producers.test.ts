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
import { bagDistances } from '../../services/shotStrategy';
import { STANDARD_CARRY_YARDS } from '../../services/standardBag';
import { getLearnedCarryDistances } from '../../store/clubStatsStore';

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

/**
 * 2026-08-24 (club sweep, step 2 — ONE OWNER FOR A CLUB).
 *
 * The carry bag existed TWICE: shotStrategy.bagDistances() iterated the club list calling carryFor()
 * itself, and store/clubStatsStore.getLearnedCarryDistances() did the same thing — written the same
 * day, 07-24, and never called by anything. The app used the copy living in a strategy module rather
 * than the one in the data owner, and neither knew about the other.
 *
 * bagDistances() now delegates to the store. These cases exist so the delegation cannot silently be
 * un-done: if a future edit re-implements the loop here, the two answers drift and the second case
 * fails. Guarding the SHAPE (one owner) rather than a file list.
 */
describe('PRODUCER 5 — the carry bag has exactly one owner', () => {
  /** A club with a tracked TOTAL only (tee→rest, includes roll) and no measured carry. */
  const totalOnly7i = () => {
    useClubStatsStore.setState({
      carry: {}, manual: {}, reps: {},
      total: { '7I': { club: '7I', samples: 5, avgYards: 165, lastYards: 165, lastUsedAt: 1 } },
    } as never);
    useClubBagStore.setState({ clubs: {} });
  };

  it('reports CARRY, not the roll-inclusive total — the property that stops a green-lit carry into water', () => {
    totalOnly7i();
    const carry = bagDistances()['7I'];
    expect(carry).toBeGreaterThan(0);
    // Roll has been subtracted: the caddie must never be told he flies it the full tracked total.
    expect(carry).toBeLessThan(165);
    expect(carry).toBe(useClubStatsStore.getState().carryFor('7I'));
  });

  it('agrees exactly with the store, so a re-implemented loop here would fail', () => {
    totalOnly7i();
    const owner = Object.fromEntries(
      Object.entries(getLearnedCarryDistances()).filter(([, y]) => y > 0),
    );
    expect(bagDistances()).toEqual(owner);
  });

  it('still omits untracked clubs — the prompt calls this "real distances"', () => {
    totalOnly7i();
    expect(bagDistances()).not.toHaveProperty('Driver');
    expect(Object.keys(bagDistances())).toEqual(['7I']);
  });

  it('never includes the putter', () => {
    useClubStatsStore.setState({
      carry: {}, manual: {}, reps: {},
      total: {
        '7I': { club: '7I', samples: 5, avgYards: 165, lastYards: 165, lastUsedAt: 1 },
        Putter: { club: 'Putter', samples: 9, avgYards: 20, lastYards: 20, lastUsedAt: 1 },
      },
    } as never);
    expect(bagDistances()).not.toHaveProperty('Putter');
    expect(getLearnedCarryDistances()).not.toHaveProperty('Putter');
  });
});

/**
 * 2026-08-24 (club sweep, step 2 — ONE OWNER, second instance).
 *
 * clubStatsStore.carryFor returned the RAW chart for a club with no data, while cnsShotRead — the
 * read the player actually HEARS — has multiplied the same chart by personalBagScale() since 08-12
 * (Tim's Arccos bag: wedges 30 yards above our defaults, driver within 8). So the spoken number and
 * the Fit Profile / sim-round ladders answered "what do you carry your untracked 5 iron" differently.
 * services/standardBag.personalCarryFor already did this correctly and had zero callers.
 *
 * The blast radius is the point: only the CHART BRANCH changed, and every safety-critical consumer
 * gates on hasDistance() so it never reaches that branch. The last case pins exactly that.
 */
describe('PRODUCER 6 — the chart is calibrated to the player, in one place', () => {
  const clear = () => useClubStatsStore.setState({ carry: {}, manual: {}, reps: {}, total: {} } as never);

  it('an EMPTY bag is byte-identical to the raw chart — a new player sees no change', () => {
    clear();
    const st = useClubStatsStore.getState();
    for (const c of ['5I', '7I', 'PW', 'Driver'] as const) {
      expect(st.carryFor(c)).toBe(STANDARD_CARRY_YARDS[c]);
    }
  });

  it('ONE measured club is not enough to calibrate — still the raw chart', () => {
    useClubStatsStore.setState({
      carry: { Driver: { club: 'Driver', samples: 5, avgYards: 300, lastYards: 300, lastUsedAt: 1 } },
      manual: {}, reps: {}, total: {},
    } as never);
    // Below MIN_CLUBS_TO_CALIBRATE (2): one club cannot prove a bag.
    expect(useClubStatsStore.getState().carryFor('5I')).toBe(STANDARD_CARRY_YARDS['5I']);
  });

  it('a long hitter gets his untracked clubs scaled UP, not stock chart numbers', () => {
    useClubStatsStore.setState({
      carry: {
        Driver: { club: 'Driver', samples: 5, avgYards: Math.round(STANDARD_CARRY_YARDS.Driver * 1.2), lastYards: 1, lastUsedAt: 1 },
        '7I': { club: '7I', samples: 5, avgYards: Math.round(STANDARD_CARRY_YARDS['7I'] * 1.2), lastYards: 1, lastUsedAt: 1 },
      },
      manual: {}, reps: {}, total: {},
    } as never);
    const fiveIron = useClubStatsStore.getState().carryFor('5I');
    expect(fiveIron).toBeGreaterThan(STANDARD_CARRY_YARDS['5I']);
    // Clamped at SCALE_MAX 1.3 — a calibration can stretch the chart, never invent a different player.
    expect(fiveIron).toBeLessThanOrEqual(Math.round(STANDARD_CARRY_YARDS['5I'] * 1.3));
  });

  it('a SHORT hitter is scaled down, and the clamp holds at 0.8', () => {
    useClubStatsStore.setState({
      carry: {
        Driver: { club: 'Driver', samples: 5, avgYards: Math.round(STANDARD_CARRY_YARDS.Driver * 0.6), lastYards: 1, lastUsedAt: 1 },
        '7I': { club: '7I', samples: 5, avgYards: Math.round(STANDARD_CARRY_YARDS['7I'] * 0.6), lastYards: 1, lastUsedAt: 1 },
      },
      manual: {}, reps: {}, total: {},
    } as never);
    const fiveIron = useClubStatsStore.getState().carryFor('5I');
    expect(fiveIron).toBeLessThan(STANDARD_CARRY_YARDS['5I']);
    expect(fiveIron).toBeGreaterThanOrEqual(Math.round(STANDARD_CARRY_YARDS['5I'] * 0.8) - 1);
  });

  it('real data always beats the calibrated chart — scaling never overrides a measured club', () => {
    useClubStatsStore.setState({
      carry: {
        Driver: { club: 'Driver', samples: 5, avgYards: 300, lastYards: 1, lastUsedAt: 1 },
        '7I': { club: '7I', samples: 5, avgYards: 190, lastYards: 1, lastUsedAt: 1 },
        '5I': { club: '5I', samples: 5, avgYards: 205, lastYards: 1, lastUsedAt: 1 },
      },
      manual: {}, reps: {}, total: {},
    } as never);
    expect(useClubStatsStore.getState().carryFor('5I')).toBe(205);
  });

  it('BLAST RADIUS — the caddie\'s bag is untouched: it gates on hasDistance and never reaches the chart', () => {
    useClubStatsStore.setState({
      carry: {
        Driver: { club: 'Driver', samples: 5, avgYards: 300, lastYards: 1, lastUsedAt: 1 },
        '7I': { club: '7I', samples: 5, avgYards: 190, lastYards: 1, lastUsedAt: 1 },
      },
      manual: {}, reps: {}, total: {},
    } as never);
    // Only the two clubs with evidence. No calibrated chart numbers leak into what the brain is told
    // are the player's "real distances".
    expect(Object.keys(bagDistances()).sort()).toEqual(['7I', 'Driver']);
  });

  it('does not recurse — carryFor asking about the bag must not call itself', () => {
    useClubStatsStore.setState({
      carry: {
        Driver: { club: 'Driver', samples: 5, avgYards: 300, lastYards: 1, lastUsedAt: 1 },
        '7I': { club: '7I', samples: 5, avgYards: 190, lastYards: 1, lastUsedAt: 1 },
      },
      manual: {}, reps: {}, total: {},
    } as never);
    expect(() => {
      for (const c of ['3W', '5W', '4H', '3I', '6I', '8I', '9I', 'PW', 'GW', 'SW', 'LW'] as const) {
        useClubStatsStore.getState().carryFor(c);
      }
    }).not.toThrow();
  });
});
