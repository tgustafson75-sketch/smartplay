/**
 * 2026-09-11 (Tim) — "The hole planner needs to account for user putt stats in strategy."
 *
 * services/holePlan declared `puttsAssumed` the day it was written, with a comment promising "two,
 * unless the player's own record says otherwise". NOTHING passed it. Every plan the app has ever
 * produced, for every player, budgeted exactly two putts — while the putt counts sat in the
 * scorecard the whole time. A reader with no writer, the same shape as distanceControl and
 * bagGapCount before it. [[sweep-the-missing-half-not-the-unused-export]]
 */
import { composePuttingRead, MIN_PUTT_HOLES } from '../../services/puttingRead';
import { planHole } from '../../services/holePlan';

const BAG: Record<string, number> = {
  Driver: 250, '3W': 225, '5W': 210, '4H': 195, '5I': 180, '6I': 168,
  '7I': 155, '8I': 142, '9I': 128, PW: 115, GW: 100, SW: 85, LW: 68,
};
const holes = (putts: number[]) => putts.map((p) => ({ par: 4, putts: p }));

describe('the putting read', () => {
  it('says nothing at all with no recorded putts', () => {
    const r = composePuttingRead([]);
    expect(r.holes).toBe(0);
    expect(r.line).toBeNull();
    expect(r.assumedPutts).toBe(2);
    expect(r.lean).toBe('neutral');
  });

  it('does not count a hole whose putts were never recorded', () => {
    // The failure this guards: treating an unrecorded hole as zero, which hands a casual scorer a
    // tour putting average and then plans his round off it.
    const r = composePuttingRead([{ par: 4, putts: 2 }, { par: 4, putts: null }, { par: 3, putts: null }]);
    expect(r.holes).toBe(1);
    expect(r.puttsPerHole).toBe(2);
  });

  it('will not plan off a thin sample, however bad it looks', () => {
    const r = composePuttingRead(holes([3, 3, 3, 3]));   // 3.0 a hole, and still not enough
    expect(r.holes).toBeLessThan(MIN_PUTT_HOLES);
    expect(r.confidence).toBe('forming');
    expect(r.assumedPutts).toBe(2);
    expect(r.lean).toBe('neutral');
  });

  it('reads a three-putter as proximity once there is a nine to go on', () => {
    const r = composePuttingRead(holes([3, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 2, 3, 2, 2, 2, 2, 2]));
    expect(r.confidence).toBe('measured');
    expect(r.lean).toBe('proximity');
    expect(r.threePuttRate).toBeGreaterThan(0.18);
  });

  it('reads a good putter as aggressive', () => {
    const r = composePuttingRead(holes([1, 2, 2, 1, 2, 2, 1, 2, 2, 1, 2, 2, 1, 2, 2, 1, 2, 2]));
    expect(r.confidence).toBe('measured');
    expect(r.lean).toBe('aggressive');
    expect(r.puttsPerRound).not.toBeNull();
  });

  it('rounds the budget TOWARDS two — a 2.28 average is not a three-putt plan', () => {
    const r = composePuttingRead(holes([3, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 2, 3, 2, 2, 2, 2, 2]));
    expect(r.puttsPerHole).toBeGreaterThan(2.2);
    expect(r.assumedPutts).toBe(2);
  });

  it('budgets three only for a man genuinely nearer three than two', () => {
    const r = composePuttingRead(holes([3, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3]));
    expect(r.assumedPutts).toBe(3);
  });
});

describe('the budget reaches the plan', () => {
  const hole = { par: 4, holeYards: 400, bag: BAG };

  it('a two-putt budget plans the par', () => {
    const p = planHole({ ...hole, puttsAssumed: 2 });
    expect(p?.playingFor).toBe('par');
    expect(p?.targetScore).toBe(4);
    expect(p?.say).toContain('2 putts');
  });

  it('a three-putt budget plans the SAME shots and a different score', () => {
    // The shots to the green do not change — that is the honest part. What changes is what the plan
    // is FOR, and a man who three-putts is playing this hole for bogey whether he is told so or not.
    const two = planHole({ ...hole, puttsAssumed: 2 });
    const three = planHole({ ...hole, puttsAssumed: 3 });
    expect(three?.steps.map((s) => s.club)).toEqual(two?.steps.map((s) => s.club));
    expect(three?.playingFor).toBe('bogey');
    expect(three?.targetScore).toBe(5);
    expect(three?.say).toContain('3 putts');
  });
});

describe('what putting changes about the advice', () => {
  it('tells a three-putter to get it close when the approach is a scoring club', () => {
    const p = planHole({ par: 4, holeYards: 330, bag: BAG, puttingLean: 'proximity' });
    expect(p?.say).toContain('Get it close');
  });

  it('tells him the opposite from long range — do not short-side a two-shot miss', () => {
    const p = planHole({ par: 4, holeYards: 400, bag: BAG, puttingLean: 'proximity' });
    expect(p?.say).toContain('short side');
    expect(p?.say).not.toContain('Get it close');
  });

  it('tells a good putter the middle of the green is plenty', () => {
    const p = planHole({ par: 3, holeYards: 210, bag: BAG, puttingLean: 'aggressive' });
    expect(p?.say).toContain('two-putt it');
  });

  it('says none of it to a neutral read — silence is the default, not a third opinion', () => {
    for (const yards of [505, 400, 330, 210]) {
      const par = yards > 480 ? 5 : yards < 250 ? 3 : 4;
      const say = planHole({ par, holeYards: yards, bag: BAG, puttingLean: 'neutral' })?.say ?? '';
      expect(say).not.toContain('Get it close');
      expect(say).not.toContain('short side');
      expect(say).not.toContain('two-putt it');
    }
  });

  it('an absent lean behaves exactly as the plan did before any of this existed', () => {
    const before = planHole({ par: 4, holeYards: 400, bag: BAG });
    const neutral = planHole({ par: 4, holeYards: 400, bag: BAG, puttingLean: 'neutral' });
    expect(before?.say).toBe(neutral?.say);
    expect(before?.targetScore).toBe(4);
  });
});

describe('the live plan actually passes it', () => {
  /**
   * The whole defect was a field nobody filled, so the guard that matters is that the composer
   * FILLS it. Asserted against the source because composeLiveHolePlan needs the round stores.
   */
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../services/holePlanLive.ts'), 'utf8',
  ) as string;

  it('reads the putting owner and hands the plan both halves', () => {
    expect(src).toMatch(/livePuttingRead\(\)/);
    expect(src).toMatch(/puttsAssumed: putting\?\.assumedPutts \?\? null/);
    expect(src).toMatch(/puttingLean: putting\?\.lean \?\? null/);
  });

  it('never lets a missing putting read take the plan down', () => {
    const at = src.indexOf('livePuttingRead');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 300), at + 200)).toMatch(/catch \{ return null; \}/);
  });
});

describe('the profile and the plan cannot disagree about his putting', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../services/caddieDecision.ts'), 'utf8',
  ) as string;

  it('the play profile takes puttsPerRound from the same owner', () => {
    // Before this it was the CURRENT round only, so on the first tee — where the plan is made — a
    // player with fifty rounds behind him had a null putting number.
    expect(src).toMatch(/livePuttingRead\(\)\.puttsPerRound/);
  });
});
