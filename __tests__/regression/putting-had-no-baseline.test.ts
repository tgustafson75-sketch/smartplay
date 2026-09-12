/**
 * 2026-09-12 (Tim) — "do the putting baseline, it's kind of fundamental to smart strategy."
 *
 * Below nine recorded holes, every player got NEUTRAL: a flat two-putt assumption and no lean,
 * identical for a scratch player and a 30-handicap. That is not neutrality — it is a guess that is
 * wrong for most people, and it is the same cold-start wall the club distances already solved by
 * baselining off the industry table scaled by handicap.
 *
 * WHAT THE BASELINE CAN AND CANNOT MOVE, because the honest scope matters:
 *   - THE BUDGET: no. Expected putting spans ~1.64 to ~2.04 per hole across the whole handicap
 *     range, and holePlan does Math.round on it, so every one of those is 2. The budget was never
 *     the place a handicap could help, and a fractional one would only be rounded away.
 *   - THE LEAN: yes, at the extremes. A good putter is not made to pay a stroke avoiding a long
 *     first putt; a player whose expected three-putt rate is already costly gets a proximity plan
 *     from his first hole instead of his tenth.
 *   - THE NUMBER THE CADDIE REASONS WITH: yes. puttsPerRound was null for a new player and is now a
 *     real expectation (services/caddieDecision reads it).
 */
import {
  baselinePuttingFromHandicap, composePuttingRead,
  MIN_PUTT_HOLES, POOR_PUTTS_PER_HOLE, GOOD_PUTTS_PER_HOLE, COSTLY_THREE_PUTT_RATE,
} from '../../services/puttingRead';

const holes = (n: number, putts: number) => Array.from({ length: n }, () => ({ par: 4, putts }));

describe('the expectation itself', () => {
  it('is null without a handicap — we do not invent one', () => {
    for (const h of [null, undefined, NaN]) expect(baselinePuttingFromHandicap(h as number)).toBeNull();
  });

  it('matches published putting-by-handicap at the anchors', () => {
    expect(baselinePuttingFromHandicap(0)!.puttsPerHole * 18).toBeCloseTo(29.5, 1);
    expect(baselinePuttingFromHandicap(18)!.puttsPerHole * 18).toBeCloseTo(33.1, 1);
    expect(baselinePuttingFromHandicap(30)!.puttsPerHole * 18).toBeCloseTo(35.5, 1);
    expect(baselinePuttingFromHandicap(0)!.threePuttRate).toBeCloseTo(0.03, 3);
    expect(baselinePuttingFromHandicap(30)!.threePuttRate).toBeCloseTo(0.18, 3);
  });

  it('rises monotonically — a higher handicap never putts better', () => {
    let prev = -1;
    for (let h = 0; h <= 36; h++) {
      const v = baselinePuttingFromHandicap(h)!.puttsPerHole;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('clamps a plus-handicap and an absurd one rather than extrapolating off the fit', () => {
    expect(baselinePuttingFromHandicap(-4)).toEqual(baselinePuttingFromHandicap(0));
    expect(baselinePuttingFromHandicap(80)).toEqual(baselinePuttingFromHandicap(36));
  });
});

describe('a player with no putts recorded', () => {
  it('gets a real expectation instead of a flat two', () => {
    const r = composePuttingRead([], { handicapIndex: 20 });
    expect(r.confidence).toBe('baseline');
    expect(r.puttsPerRound).toBeCloseTo(33.5, 1);
    expect(r.threePuttRate).toBeCloseTo(0.13, 2);
  });

  it('and is told plainly where it came from', () => {
    const r = composePuttingRead([], { handicapIndex: 20 });
    expect(r.line).toMatch(/going off your handicap/i);
    expect(r.line).not.toMatch(/not enough to plan off/i);
  });

  it('still gets NOTHING when we do not know the handicap either', () => {
    const r = composePuttingRead([], {});
    expect(r.confidence).toBe('none');
    expect(r.lean).toBe('neutral');
    expect(r.line).toBeNull();
  });

  it('a good putter is not made to play for proximity', () => {
    expect(composePuttingRead([], { handicapIndex: 2 }).lean).toBe('aggressive');
  });

  it('and a likely three-putter gets the proximity plan from hole one', () => {
    expect(composePuttingRead([], { handicapIndex: 32 }).lean).toBe('proximity');
  });

  it('the middle is left alone — an assumption moves the plan less than evidence does', () => {
    for (const h of [10, 15, 20, 25]) {
      expect(`${h}:${composePuttingRead([], { handicapIndex: h }).lean}`).toBe(`${h}:neutral`);
    }
  });
});

describe('the budget is honestly untouched', () => {
  it('stays two across the entire handicap range — the plan rounds it anyway', () => {
    for (let h = 0; h <= 36; h += 2) {
      expect(composePuttingRead([], { handicapIndex: h }).assumedPutts).toBe(2);
    }
  });
});

describe('his own putts take over smoothly', () => {
  it('a few holes blend toward the expectation, not away from it', () => {
    // 3 holes of 3-putts for a scratch player: real, but not yet his record.
    const blended = composePuttingRead(holes(3, 3), { handicapIndex: 0 });
    expect(blended.confidence).toBe('forming');
    // between the raw observation (3.0) and the expectation (1.64)
    expect(blended.puttsPerHole!).toBeGreaterThan(baselinePuttingFromHandicap(0)!.puttsPerHole);
    expect(blended.puttsPerHole!).toBeLessThan(3);
  });

  it('the blend weight reaches the observation exactly at the evidence bar', () => {
    const atBar = composePuttingRead(holes(MIN_PUTT_HOLES, 3), { handicapIndex: 0 });
    expect(atBar.confidence).toBe('measured');
    expect(atBar.puttsPerHole).toBeCloseTo(3, 6); // baseline has dropped out entirely
  });

  it('more of his own holes move it further from the assumption, every time', () => {
    let prev = baselinePuttingFromHandicap(0)!.puttsPerHole;
    for (let n = 1; n <= MIN_PUTT_HOLES; n++) {
      const v = composePuttingRead(holes(n, 3), { handicapIndex: 0 }).puttsPerHole!;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('says how many of his own holes it has seen while blending', () => {
    expect(composePuttingRead(holes(4, 2), { handicapIndex: 18 }).line).toMatch(/4 holes of your putting/);
  });

  it('a measured read never mentions the handicap', () => {
    const m = composePuttingRead(holes(MIN_PUTT_HOLES, 2), { handicapIndex: 18 });
    expect(m.confidence).toBe('measured');
    expect(m.line).not.toMatch(/handicap/i);
  });
});

describe('the baseline earns no softer thresholds than evidence', () => {
  it('runs through the SAME lean rules — one set, not two', () => {
    const b = baselinePuttingFromHandicap(32)!;
    // proximity because the expected three-putt rate clears the same bar measured data must clear
    expect(b.threePuttRate).toBeGreaterThanOrEqual(COSTLY_THREE_PUTT_RATE);
    const good = baselinePuttingFromHandicap(2)!;
    expect(good.puttsPerHole).toBeLessThanOrEqual(GOOD_PUTTS_PER_HOLE);
    // and no baseline is ever poor enough on average alone to force proximity
    expect(baselinePuttingFromHandicap(36)!.puttsPerHole).toBeLessThan(POOR_PUTTS_PER_HOLE);
  });
});

describe('a thin sample still never swings the strategy', () => {
  /**
   * This is the case that exposed a flaw in the first version of the baseline. I had let a 'forming'
   * read drive the lean from its BLENDED average, which meant four holes of three-putts flipped the
   * plan to proximity — exactly what the pre-existing guard ("will not plan off a thin sample,
   * however bad it looks") was written to prevent, and what MIN_PUTT_HOLES' own comment forbids.
   *
   * Blending does not make four holes less noisy. So the blend is reported as the best NUMBER, while
   * the LEAN comes only from a stable basis: the handicap expectation until there is enough of his
   * own putting, then his own record.
   */
  it('four disastrous holes do not flip a player to proximity', () => {
    expect(composePuttingRead(holes(4, 3), {}).lean).toBe('neutral');
  });

  it('...and do not flip a good putter either — his expectation still holds the strategy', () => {
    const r = composePuttingRead(holes(4, 3), { handicapIndex: 2 });
    expect(r.confidence).toBe('forming');
    expect(r.lean).toBe('aggressive');
    // but the NUMBER he is told has moved toward what he is actually doing
    expect(r.puttsPerHole!).toBeGreaterThan(baselinePuttingFromHandicap(2)!.puttsPerHole);
  });

  it('a likely three-putter keeps his proximity plan through the thin stretch, not just at hole zero', () => {
    // Without this, he would get proximity on hole 0, lose it on hole 1, and get it back on hole 9.
    for (let n = 0; n < MIN_PUTT_HOLES; n++) {
      const r = composePuttingRead(holes(n, 2), { handicapIndex: 32 });
      expect(`${n}:${r.lean}`).toBe(`${n}:proximity`);
    }
  });

  it('and his own record takes over the moment there is enough of it', () => {
    // Nine holes of tidy two-putts from a 32-handicap: his record now outranks the expectation.
    const r = composePuttingRead(holes(MIN_PUTT_HOLES, 2), { handicapIndex: 32 });
    expect(r.confidence).toBe('measured');
    expect(r.lean).not.toBe('proximity');
  });
});
