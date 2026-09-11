/**
 * 2026-09-11 — THE HOLE PLAN, PLAYED BACKWARDS FROM THE GREEN.
 *
 * Tim: "We're gonna start with the three wood here. It's gonna leave us this… avoid hazards and
 * play smart bogey… par as a bonus."
 *
 * The thing being pinned is not that the engine produces a plan — it is WHICH plan, and that every
 * number in the sentence is one the previous shot actually produces. A plan that says "3 wood leaves
 * you 145" when the 3 wood leaves 160 is the fabricated-yardage defect with a nicer voice, and it
 * would be spoken on the tee as fact.
 */
import { planHole } from '../../services/holePlan';

/** A mid-handicap bag: driver 220, and a full ladder down. */
const BAG = {
  driver: 220, '3 wood': 200, '5 wood': 185, hybrid: 170,
  '5 iron': 160, '6 iron': 150, '7 iron': 140, '8 iron': 130,
  '9 iron': 118, 'pitching wedge': 105, 'gap wedge': 92, 'sand wedge': 78,
};

describe('it refuses to invent a plan', () => {
  it('says nothing without a hole length', () => {
    expect(planHole({ par: 4, holeYards: 0, bag: BAG })).toBeNull();
  });

  it('says nothing on a par it does not recognise', () => {
    expect(planHole({ par: 7, holeYards: 600, bag: BAG })).toBeNull();
  });

  it('says nothing with an empty bag — a plan needs real numbers', () => {
    expect(planHole({ par: 4, holeYards: 370, bag: {} })).toBeNull();
    expect(planHole({ par: 4, holeYards: 370, bag: { driver: 220 } })).toBeNull();
  });
});

describe('every number in the plan is one the shot before it produces', () => {
  const plan = planHole({ par: 4, holeYards: 370, bag: BAG, hole: 7 })!;

  it('plans the hole in the number of shots it claims', () => {
    expect(plan.steps.length + 2).toBe(plan.targetScore);
  });

  it('the yards left after each shot equal the hole minus everything hit so far', () => {
    let covered = 0;
    for (const s of plan.steps) {
      covered += s.carryYards;
      expect(s.leavesYards).toBe(Math.max(0, Math.round(370 - covered)));
    }
  });

  it('the last shot reaches the green', () => {
    expect(plan.steps[plan.steps.length - 1].leavesYards).toBe(0);
  });

  it('the spoken sentence quotes the same number the plan computed', () => {
    expect(plan.say).toContain(String(plan.steps[0].leavesYards));
  });
});

describe('smart bogey: it does not force par onto a hole that will not give it', () => {
  it('a 480-yard par 4 is played for bogey, in three', () => {
    const plan = planHole({ par: 4, holeYards: 480, bag: BAG })!;
    expect(plan.playingFor).toBe('bogey');
    expect(plan.steps.length).toBe(3);
    expect(plan.targetScore).toBe(5);
    expect(plan.say).toMatch(/for bogey/);
  });

  it('a 330-yard par 4 is there for par, in two', () => {
    const plan = planHole({ par: 4, holeYards: 330, bag: BAG })!;
    expect(plan.playingFor).toBe('par');
    expect(plan.steps.length).toBe(2);
    expect(plan.targetScore).toBe(4);
  });

  it('a par 3 is one shot, and names the club that covers it', () => {
    const plan = planHole({ par: 3, holeYards: 150, bag: BAG })!;
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].club).toBe('6 iron');
    expect(plan.targetScore).toBe(3);
  });
});

describe('the tee club is a CONSEQUENCE of the approach, not a preference', () => {
  /**
   * This is the sentence the product is built on: "3 wood, because it leaves 145, and 145 is your
   * 8 iron." If the engine ever just reaches for the driver first, this is what catches it.
   */
  it('leaves a full-swing player a number that is actually in their bag', () => {
    const plan = planHole({
      par: 4, holeYards: 370, bag: BAG, distanceControl: 'full_swings',
    })!;
    const approachFrom = plan.steps[plan.steps.length - 2].leavesYards;
    const onANumber = Object.values(BAG).some((y) => Math.abs(y - approachFrom) <= 8);
    expect(onANumber).toBe(true);
    expect(plan.steps[plan.steps.length - 1].why).toMatch(/your number, not an in-between one/);
  });

  it('does not hold a player who dials down to the same constraint', () => {
    // They have a swing for an in-between number; planning around one they do not need is worse.
    const plan = planHole({
      par: 4, holeYards: 370, bag: BAG, distanceControl: 'dial_down',
    })!;
    expect(plan.steps[plan.steps.length - 1].why).not.toMatch(/in-between/);
  });

  it('the same hole and the same bag can produce two different plans', () => {
    const full = planHole({ par: 5, holeYards: 505, bag: BAG, distanceControl: 'full_swings' })!;
    const dial = planHole({ par: 5, holeYards: 505, bag: BAG, distanceControl: 'dial_down' })!;
    // Not asserting WHICH differs — asserting the player is actually an input to the plan.
    const sig = (p: typeof full) => p.steps.map((s) => `${s.club}@${s.carryYards}`).join('|');
    expect([sig(full), sig(dial), full.say, dial.say].length).toBe(4);
    expect(sig(full) !== sig(dial) || full.say !== dial.say).toBe(true);
  });
});

describe('it plans around trouble rather than into it', () => {
  const WATER = [{ label: 'Water', startsAt: 195, carryToClear: 240 }];

  it('will not finish a shot in the hazard', () => {
    const plan = planHole({ par: 4, holeYards: 400, bag: BAG, hazards: WATER })!;
    const tee = plan.steps[0];
    const wet = tee.carryYards >= 195 && tee.carryYards < 240;
    expect(wet).toBe(false);
  });

  it('says WHY the shorter club, by name and by number', () => {
    const plan = planHole({ par: 4, holeYards: 400, bag: BAG, hazards: WATER })!;
    expect(plan.steps[0].why).toMatch(/short of the water at 195/);
    expect(plan.say).toMatch(/short of the water at 195/);
  });

  it('the driver IS the club when there is nothing in the way', () => {
    // The hazard rule must not quietly make it a lay-up engine.
    const plan = planHole({ par: 5, holeYards: 520, bag: BAG })!;
    expect(plan.steps[0].club).toBe('driver');
  });
});

describe('the plan is spoken the way a caddie speaks it', () => {
  it('leads with the shape, names the tee club, and ends on the score', () => {
    const plan = planHole({ par: 4, holeYards: 370, bag: BAG })!;
    expect(plan.say).toMatch(/off the tee/);
    expect(plan.say).toMatch(/2 putts and we move on/);
  });

  it('never reads back a zero or a negative yardage', () => {
    for (const yards of [120, 155, 190, 240, 305, 370, 420, 480, 520, 610]) {
      for (const par of [3, 4, 5]) {
        const plan = planHole({ par, holeYards: yards, bag: BAG });
        if (!plan) continue;
        expect(plan.say).not.toMatch(/-\d/);
        expect(plan.say).not.toMatch(/\b0 yards|leaving 0\b/);
        for (const s of plan.steps) expect(s.leavesYards).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('the plans it produced before these two rules were written', () => {
  /**
   * Both of these came out of the engine's own first runs. Neither could fail a type check or an
   * arithmetic check — every number was correct. They were simply not golf.
   */
  it('never hits a driver off the deck — not as the approach, not as the second shot', () => {
    // First run on a 480-yard par 4: "Driver off the tee, leaving 260. Then Driver to 40."
    for (const [par, yards] of [[4, 480], [5, 560], [5, 505], [4, 400], [5, 620]] as [number, number][]) {
      const plan = planHole({ par, holeYards: yards, bag: BAG });
      if (!plan) continue;
      for (const s of plan.steps.slice(1)) {
        expect(s.club.toLowerCase()).not.toBe('driver');
      }
    }
  });

  it('will not lay up to a touch shot when a full swing is available', () => {
    // First run on the 400-yard water hole: "5 wood, then 3 wood to 15, then sand wedge."
    const plan = planHole({
      par: 4, holeYards: 400, bag: BAG,
      hazards: [{ label: 'Water', startsAt: 195, carryToClear: 240 }],
    })!;
    const shortest = Math.min(...Object.values(BAG));
    const approachFrom = plan.steps[plan.steps.length - 2].leavesYards;
    expect(approachFrom).toBeGreaterThanOrEqual(shortest - 8);
  });

  it('still finds a plan on a hole that genuinely forces a partial', () => {
    // The full-swing preference is a PREFERENCE. A 95-yard par 3 for a player whose shortest club
    // goes 78 has to be a partial, and refusing to plan it would be worse than planning it.
    const plan = planHole({ par: 4, holeYards: 255, bag: { Driver: 220, '7I': 140, SW: 78 } });
    expect(plan).not.toBeNull();
  });
});

describe('it plans from where they are standing, not from the tee they left', () => {
  /**
   * The caddie talks mid-hole far more than it talks on a tee. Offering "par in two" to a player
   * lying two is not a plan, it is a wrong answer — and "off the tee" said to a man in the rough is
   * the small wrongness that tells him nobody is actually watching.
   */
  it('counts the strokes already played into the score it promises', () => {
    const plan = planHole({ par: 4, holeYards: 180, bag: BAG, strokesPlayed: 2 })!;
    expect(plan.steps.length).toBe(1);
    expect(plan.targetScore).toBe(5);
    expect(plan.playingFor).toBe('bogey');
  });

  it('numbers the remaining shots from where the hole actually is', () => {
    const plan = planHole({ par: 5, holeYards: 300, bag: BAG, strokesPlayed: 1 })!;
    expect(plan.steps[0].shot).toBe(2);
  });

  it('does not say "off the tee" to a player who has already hit', () => {
    const plan = planHole({ par: 5, holeYards: 300, bag: BAG, strokesPlayed: 1 })!;
    expect(plan.say).not.toMatch(/off the tee/);
    expect(plan.say).toMatch(/from here/);
  });

  it('still says it on the tee', () => {
    expect(planHole({ par: 4, holeYards: 370, bag: BAG })!.say).toMatch(/off the tee/);
  });
});

describe('it is wired to the caddie, not left as an island', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const kevin = fs.readFileSync(path.join(__dirname, '../../api/kevin.ts'), 'utf8');
  const body = fs.readFileSync(path.join(__dirname, '../../services/caddieRequestBody.ts'), 'utf8');

  it('the payload composes the plan', () => {
    expect(body).toMatch(/holePlan: safe\(/);
    expect(body).toMatch(/planHole\(\{/);
  });

  it('plans from the working number, never from the scorecard length', () => {
    const at = body.indexOf('holePlan: safe(');
    const block = body.slice(at, at + 1800);
    expect(block).toMatch(/const yards = workingYards;/);
    expect(block).toMatch(/holeYards: yards,/);
  });

  it('counts strokes from the SAME place the prompt announces them', () => {
    // Two answers to "which shot is he on" is how the caddie promises a par he can no longer make.
    const at = body.indexOf('holePlan: safe(');
    expect(body.slice(at, at + 1800)).toMatch(/const strokesPlayed = Math\.max\(0, currentStroke - 1\);/);
    expect(body).toMatch(/const currentStroke: number = safe\(/);
    // and the payload field is the same value, not a second computation
    expect(body).toMatch(/\n {4}currentStroke,\n/);
  });

  it('refuses to plan a hole whose par it does not know', () => {
    // parForHole returns null rather than inventing a par; the plan must stop there too.
    const at = body.indexOf('holePlan: safe(');
    expect(body.slice(at, at + 1800)).toMatch(/if \(par == null\) return null;/);
  });

  it('the brain renders it and is told NOT to recompute the numbers', () => {
    const at = kevin.indexOf('THE PLAN FOR THIS HOLE');
    expect(at).toBeGreaterThan(-1);
    const block = kevin.slice(at, at + 900);
    expect(block).toMatch(/do NOT recompute them/);
    expect(block).toMatch(/PLAN, not an instruction/);
    // The plan must never override the override — agreeing with the player still wins.
    expect(block).toMatch(/If he wants a different club, agree with him/);
  });
});
