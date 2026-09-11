/**
 * 2026-09-11 — WHAT THE CADDIE SAYS AND WHAT THE SCREEN SHOWS ARE ONE DECISION.
 *
 * Not two calls that happen to agree — the same object, rendered twice. That is the difference
 * between facts REACHING several deciders and the app having ONE decider.
 *
 * services/caddieDecision is entirely `safe(..., fallback)`, which is correct and is also the shape
 * that hides a typo forever: a wrong require path returns the fallback on every call and every
 * source-level assertion still passes. That trap cost a real bug earlier today. So this drives the
 * real stores and checks real values.
 */
import { decideShot } from '../../services/caddieDecision';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useClubStatsStore } from '../../store/clubStatsStore';

const BAG: Record<string, number> = {
  Driver: 220, '3W': 200, '5W': 185, '4H': 170, '5I': 160,
  '6I': 150, '7I': 140, '8I': 130, '9I': 118, PW: 105, GW: 92, SW: 78,
};

function onTheTee(over: Record<string, unknown> = {}) {
  useClubStatsStore.setState({ manual: { ...BAG }, carry: {}, total: {} } as never);
  usePlayerProfileStore.setState({
    distanceControl: 'full_swings', handicap: 20, dominantMiss: 'right', experienceContext: 'improving',
  } as never);
  useRoundStore.setState({
    isRoundActive: true, currentHole: 7, currentYardage: 370,
    activeCourse: 'Test GC', activeCourseId: 'test-gc', mode: 'break_90', riskMode: 'normal',
    courseHoles: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 370 })),
    scores: { 1: 5, 2: 6, 3: 5, 4: 5, 5: 6, 6: 5 },
    shots: [], pendingKevinRec: null, club: null, clubSetAt: null,
    ...over,
  } as never);
}

describe('one call returns the whole decision', () => {
  it('every part resolves — not a shell of nulls', () => {
    onTheTee();
    const d = decideShot({ rawYards: 370 });
    expect(d.shot).not.toBeNull();
    expect(d.shot!.club).toBeTruthy();
    expect(d.plan).not.toBeNull();
    expect(d.budget).not.toBeNull();
    expect(d.profile).not.toBeNull();
    expect(Array.isArray(d.cues)).toBe(true);
  });

  it('the profile knows the goal and the level', () => {
    onTheTee();
    const d = decideShot({ rawYards: 370 });
    expect(d.profile!.goal).toBe('break_90');
    expect(d.profile!.targetScore).toBe(89);
    expect(typeof d.profile!.level).toBe('string');
  });

  it('the plan is for the hole the player is on', () => {
    onTheTee();
    expect(decideShot({ rawYards: 370 }).plan!.hole).toBe(7);
  });

  it('the budget is phrased as shots IN HAND, never as a deficit', () => {
    onTheTee();
    expect(decideShot({ rawYards: 370 }).budget).toMatch(/in hand/i);
  });
});

describe('the screen and the caddie get the SAME decision', () => {
  it('the payload plan is identical to the one a screen would draw', () => {
    onTheTee();
    const body = buildCaddieRequestBody({ message: 'what should I hit', language: 'en' }) as Record<string, unknown>;
    expect(body.holePlan).toEqual(decideShot({ rawYards: 370 }).plan);
  });

  it('two asks with the same facts give the same club — no per-surface drift', () => {
    onTheTee();
    const a = decideShot({ rawYards: 158 });
    const b = decideShot({ rawYards: 158 });
    expect(a.shot!.club).toBe(b.shot!.club);
    expect(a.shot!.playsLikeYards).toBe(b.shot!.playsLikeYards);
  });

  it('a surface that knows its own target gets a decision for THAT target', () => {
    // SmartFinder's tapped point is not the middle of the green, and the brain must honour it.
    onTheTee();
    const mid = decideShot({ rawYards: 370 });
    const tapped = decideShot({ rawYards: 118 });
    expect(tapped.shot!.rawYards).toBe(118);
    expect(mid.shot!.rawYards).toBe(370);
    expect(tapped.shot!.club).not.toBe(mid.shot!.club);
  });
});

describe('it holds the override, so the club shown is the club being hit', () => {
  it('reads the override when the player has named their own club', () => {
    onTheTee({
      pendingKevinRec: { club: 'Driver', shape: null, aimPoint: null, at: Date.now(), kind: 'spoken' },
      club: '3W', clubSetAt: Date.now() + 1000,
    });
    const d = decideShot({ rawYards: 370 });
    expect(d.override).not.toBeNull();
    expect(d.override!.advisedClub).toBeTruthy();
    expect(d.override!.chosenClub).toBeTruthy();
  });

  it('and is silent when there is nothing to overrule', () => {
    onTheTee();
    expect(decideShot({ rawYards: 370 }).override).toBeNull();
  });
});

describe('it degrades by the part, never as a whole', () => {
  it('an unmapped hole costs the plan and keeps the club', () => {
    onTheTee({ courseHoles: [] });
    const d = decideShot({ rawYards: 158 });
    expect(d.plan).toBeNull();
    expect(d.shot).not.toBeNull();
    expect(d.shot!.club).toBeTruthy();
  });

  it('off the course it answers without throwing', () => {
    useRoundStore.setState({ isRoundActive: false, currentHole: null, activeCourseId: null } as never);
    expect(() => decideShot({ rawYards: 150 })).not.toThrow();
    expect(decideShot({ rawYards: 150 }).plan).toBeNull();
  });

  it('with no yardage at all it still returns the shape a surface can render', () => {
    onTheTee();
    const d = decideShot();
    expect(d.shot).toBeNull();
    expect(d).toHaveProperty('plan');
    expect(d).toHaveProperty('profile');
  });

  it('every field comes back present, so a surface can destructure it on first render', () => {
    useRoundStore.setState({ isRoundActive: false, currentHole: null, activeCourseId: null } as never);
    const d = decideShot();
    for (const k of ['shot', 'plan', 'budget', 'profile', 'override', 'cues']) {
      expect(Object.prototype.hasOwnProperty.call(d, k)).toBe(true);
    }
    // cues are NOT empty off the course, deliberately: they are seeded from the player's stated
    // level, which is real information before a single shot is logged. That is the cold-start fix.
    expect(Array.isArray(d.cues)).toBe(true);
  });
});
