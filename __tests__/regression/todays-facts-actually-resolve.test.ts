/**
 * 2026-09-11 — THE VALUES ACTUALLY RESOLVE, NOT JUST THE SOURCE LINES.
 *
 * Every store read in services/caddieRequestBody is wrapped in `safe(..., null)`. That is correct —
 * a missing course must not take down the caddie — and it is also the most dangerous shape in the
 * file, because a WRONG module path or a MISTYPED field name returns null forever and the payload
 * still looks complete from every angle. one-caddie-payload.test.ts says so outright: three bad
 * paths and six bad field names were caught exactly this way while it was being written.
 *
 * Everything shipped on 2026-09-11 — the play profile, the hole plan, the standing club call and
 * the override read — landed inside that same `safe()` wrapper, and every wiring test written for
 * them asserts SOURCE TEXT. Source text cannot tell a working require from a silently-failing one.
 *
 * So this drives the real stores and asserts real values come back. It is the only test of today's
 * work that would survive `require('./holePlanLiveTYPO')`.
 */
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useClubStatsStore } from '../../store/clubStatsStore';
import { composeLiveHolePlan } from '../../services/holePlanLive';

const BAG: Record<string, number> = {
  Driver: 220, '3W': 200, '5W': 185, '4H': 170, '5I': 160,
  '6I': 150, '7I': 140, '8I': 130, '9I': 118, PW: 105, GW: 92, SW: 78,
};

/** A player on the 7th tee of a 370-yard par 4, mid-round, with a real bag. */
function standOnTheTee(over: Record<string, unknown> = {}) {
  useClubStatsStore.setState({
    manual: { ...BAG },
    carry: {}, total: {},
  } as never);
  usePlayerProfileStore.setState({
    distanceControl: 'full_swings', handicap: 22, experienceContext: 'improving',
  } as never);
  useRoundStore.setState({
    isRoundActive: true,
    currentHole: 7,
    currentYardage: 370,
    activeCourse: 'Test GC',
    activeCourseId: 'test-gc',
    mode: 'break_90',
    // A real 18-hole card: the bogey budget needs pars for the holes already played, and a
    // one-hole course is not a round.
    courseHoles: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 370 })),
    scores: { 1: 5, 2: 6, 3: 5, 4: 4, 5: 6, 6: 5 },
    shots: [],
    pendingKevinRec: { club: 'Driver', shape: null, aimPoint: null, at: Date.now(), kind: 'spoken' },
    club: null,
    clubSetAt: null,
    ...over,
  } as never);
}

describe('the bag the test stands on is real', () => {
  it('resolves carries, or every assertion below is vacuous', () => {
    standOnTheTee();
    const { bagDistances } = require('../../services/shotStrategy');
    const bag = bagDistances();
    expect(Object.keys(bag).length).toBeGreaterThan(6);
    expect(bag.Driver).toBeGreaterThan(150);
  });
});

describe('the hole plan resolves to a real plan', () => {
  it('is not null, and plans the hole it was given', () => {
    standOnTheTee();
    const { plan } = composeLiveHolePlan();
    expect(plan).not.toBeNull();
    expect(plan!.par).toBe(4);
    expect(plan!.holeYards).toBe(370);
    expect(plan!.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('every leave is the hole minus what has been hit — the numbers are real arithmetic', () => {
    standOnTheTee();
    const { plan } = composeLiveHolePlan()!;
    let covered = 0;
    for (const s of plan!.steps) {
      covered += s.carryYards;
      expect(s.leavesYards).toBe(Math.max(0, Math.round(370 - covered)));
    }
  });

  it('leaves a FULL-SWING player a number that is in their bag', () => {
    standOnTheTee();
    const { plan } = composeLiveHolePlan();
    const approachFrom = plan!.steps[plan!.steps.length - 2].leavesYards;
    expect(Object.values(BAG).some((y) => Math.abs(y - approachFrom) <= 8)).toBe(true);
  });

  /**
   * 2026-09-11 — THE BUG THIS WHOLE FILE EXISTS FOR.
   *
   * With GPS not ready, buildYardageInsight falls back to `static_card` — the hole's length FROM THE
   * TEE. Handed that after one shot, the planner told a man with 150 yards left to hit DRIVER, and
   * the chip said so on screen: "Driver from here — leaving 150."
   *
   * The source-level test "plans from the working number, never from the scorecard length" passed
   * straight through it. The source WAS buildYardageInsight(). The value was the card.
   */
  it('says NOTHING rather than briefing a tee shot off the card to a man who has hit', () => {
    standOnTheTee({
      currentYardage: 150,   // GPS is not ready, so the resolver still answers static_card
      shots: [{ hole: 7, club: 'Driver', feel: 'flush', direction: 'straight', shape: 'straight', timestamp: Date.now(), acousticContact: null }],
    });
    const { buildYardageInsight } = require('../../services/yardageResolver');
    expect(buildYardageInsight()?.source).toBe('static_card');   // the state under test is real
    expect(composeLiveHolePlan().plan).toBeNull();
  });

  it('but the card IS a fair number on the tee, so the plan still stands there', () => {
    standOnTheTee();
    const { buildYardageInsight } = require('../../services/yardageResolver');
    expect(buildYardageInsight()?.source).toBe('static_card');
    expect(composeLiveHolePlan().plan).not.toBeNull();
  });

  it('re-plans from where he stands when the number is genuinely measured', () => {
    standOnTheTee({
      userStatedYardage: { value: 150, source: 'rangefinder', asOf: Date.now(), holeAtCapture: 7 },
      shots: [{ hole: 7, club: 'Driver', feel: 'flush', direction: 'straight', shape: 'straight', timestamp: Date.now(), acousticContact: null }],
    });
    const { plan } = composeLiveHolePlan();
    expect(plan).not.toBeNull();
    expect(plan!.holeYards).toBe(150);
    // One shot played: the plan is the approach, and the score counts the shot he hit.
    expect(plan!.steps[0].shot).toBe(2);
    expect(plan!.targetScore).toBe(4);
    expect(plan!.say).not.toMatch(/off the tee/);
  });

  it('the bogey budget resolves too, and says shots IN HAND', () => {
    // 2026-09-11 — the budget moved onto the brain's profile. holePlanLive used to compose its OWN
    // play profile for this one line, which was a second answer to "who is this golfer".
    standOnTheTee();
    const { decideShot } = require('../../services/caddieDecision');
    const budget = decideShot({ rawYards: 370 }).budget;
    expect(budget).not.toBeNull();
    expect(budget).toMatch(/in hand/i);
  });
});

describe('the payload carries what the composers produced', () => {
  it('holePlan is a real object on the wire, not a silent null', () => {
    standOnTheTee();
    const body = buildCaddieRequestBody({ message: 'what should I hit', language: 'en' }) as Record<string, unknown>;
    const hp = body.holePlan as { par?: number; steps?: unknown[] } | null;
    expect(hp).not.toBeNull();
    expect(hp!.par).toBe(4);
    expect(Array.isArray(hp!.steps)).toBe(true);
  });

  it('the payload plan and the SCREEN plan are the same plan', () => {
    // The split this design exists to prevent: a plan he can read differing from the plan he hears.
    standOnTheTee();
    const body = buildCaddieRequestBody({ message: 'x', language: 'en' }) as Record<string, unknown>;
    expect(body.holePlan).toEqual(composeLiveHolePlan().plan);
  });

  it('playProfile resolves, with a level and a real target for break_90', () => {
    standOnTheTee();
    const body = buildCaddieRequestBody({ message: 'x', language: 'en' }) as Record<string, unknown>;
    const pp = body.playProfile as { level?: string; goal?: string; targetScore?: number } | null;
    expect(pp).not.toBeNull();
    expect(pp!.goal).toBe('break_90');
    expect(pp!.targetScore).toBe(89);
    expect(typeof pp!.level).toBe('string');
  });
});

describe('the standing club call reaches the wire', () => {
  it('carries the caddie’s own outstanding recommendation', () => {
    standOnTheTee();
    const body = buildCaddieRequestBody({ message: 'x', language: 'en' }) as Record<string, unknown>;
    const cc = body.clubCall as { advised?: string; override?: unknown } | null;
    expect(cc).not.toBeNull();
    expect(cc!.advised).toBe('Driver');
    // He has named nothing yet, so there is no override to read — only the standing call.
    expect(cc!.override).toBeNull();
  });

  it('reads the override the moment he names a different club', () => {
    standOnTheTee({ club: '3W', clubSetAt: Date.now() + 1000 });
    const body = buildCaddieRequestBody({ message: 'x', language: 'en' }) as Record<string, unknown>;
    const cc = body.clubCall as {
      advised?: string; playerClub?: string;
      override?: { lean?: string; deltaYards?: number; adjustment?: string } | null;
    } | null;
    expect(cc!.advised).toBe('Driver');
    expect(cc!.playerClub).toBe('3W');
    expect(cc!.override).not.toBeNull();
    expect(cc!.override!.lean).toBe('less');
    expect(cc!.override!.deltaYards).toBe(-20);
    // A full-swing player taking LESS club has to commit to it.
    expect(cc!.override!.adjustment).toMatch(/commit/i);
  });

  it('an app INFERENCE is not a standing call — the caddie cannot be overruled on a guess', () => {
    standOnTheTee({
      pendingKevinRec: { club: '7I', shape: null, aimPoint: null, at: Date.now(), kind: 'inferred' },
      club: '3W', clubSetAt: Date.now() + 1000,
    });
    const body = buildCaddieRequestBody({ message: 'x', language: 'en' }) as Record<string, unknown>;
    expect(body.clubCall).toBeNull();
  });
});

describe('nothing is claimed off the course', () => {
  it('no round means no plan and no club call — not a plan for hole 1 of nowhere', () => {
    standOnTheTee({ isRoundActive: false });
    const body = buildCaddieRequestBody({ message: 'x', language: 'en' }) as Record<string, unknown>;
    expect(body.holePlan).toBeNull();
    expect(composeLiveHolePlan().plan).toBeNull();
  });

  it('an unknown par produces no plan rather than a guessed one', () => {
    standOnTheTee({ courseHoles: [] });
    expect(composeLiveHolePlan().plan).toBeNull();
  });
});
