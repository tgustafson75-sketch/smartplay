/**
 * 2026-09-11 — THE COMPOSER RESOLVES REAL VALUES, NOT SILENT NULLS.
 *
 * services/shotReadLive wraps every store read in `safe(..., fallback)`. That is correct — a cold
 * weather cache or an unmapped hole must cost that ONE fact, never the whole read — and it is also
 * the shape that hides a typo forever: a wrong require path returns the fallback on every call, the
 * payload looks complete, and every source-level assertion still passes.
 *
 * That exact trap cost a real bug earlier today: the hole plan's source said buildYardageInsight()
 * and the VALUE it got was the scorecard, so the caddie briefed a tee shot to a man in the fairway.
 * Source text cannot tell a working require from a silently-failing one.
 *
 * So this drives the real stores and asserts real values come back. It is the only test of the
 * composer that would survive `require('./weatherServiceTYPO')`.
 */
import { liveShotReadInputs } from '../../services/shotReadLive';
import { composeShotRead } from '../../services/cnsShotRead';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useClubStatsStore } from '../../store/clubStatsStore';

const BAG: Record<string, number> = {
  Driver: 220, '3W': 200, '5W': 185, '4H': 170, '5I': 160,
  '6I': 150, '7I': 140, '8I': 130, '9I': 118, PW: 105, GW: 92, SW: 78,
};

function onCourse(over: Record<string, unknown> = {}) {
  useClubStatsStore.setState({ manual: { ...BAG }, carry: {}, total: {} } as never);
  usePlayerProfileStore.setState({
    distanceControl: 'full_swings', handicap: 18, dominantMiss: 'right',
  } as never);
  useRoundStore.setState({
    isRoundActive: true, currentHole: 7, currentYardage: 158,
    activeCourse: 'Test GC', activeCourseId: 'test-gc', riskMode: 'aggressive',
    isCompetition: true, mode: 'break_90',
    courseHoles: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 370 })),
    shots: [],
    ...over,
  } as never);
}

describe('the facts that were measurably missing now arrive filled in', () => {
  it('the bag resolves — without it every assertion here is vacuous', () => {
    onCourse();
    const i = liveShotReadInputs({ rawYards: 158 });
    expect(Object.keys(i.bag ?? {}).length).toBeGreaterThan(6);
    expect((i.bag as Record<string, number>).Driver).toBeGreaterThan(150);
  });

  it('risk posture — SmartVision and the sims had it, the composer must not lose it', () => {
    onCourse();
    expect(liveShotReadInputs({ rawYards: 158 }).risk).toBe('aggressive');
  });

  it('dominant miss — SmartVision never got this', () => {
    onCourse();
    expect(liveShotReadInputs({ rawYards: 158 }).dominantMiss).toBe('right');
  });

  it('distance control — without it every player is treated as some_partials', () => {
    onCourse();
    expect(liveShotReadInputs({ rawYards: 158 }).distanceControl).toBe('full_swings');
  });

  it('competition flag — the gate on past-score talk', () => {
    onCourse();
    expect(liveShotReadInputs({ rawYards: 158 }).isCompetition).toBe(true);
  });

  it('elevation resolves to a NUMBER, never undefined', () => {
    // undefined would make composeShotRead silently default to flat with no way to tell.
    onCourse();
    expect(typeof liveShotReadInputs({ rawYards: 158 }).elevationDeltaFeet).toBe('number');
  });
});

describe('a caller still wins on what it knows better', () => {
  it('its own bearing, target and measured slope override the composed ones', () => {
    onCourse();
    const i = liveShotReadInputs({
      rawYards: 212, shotBearingDeg: 271, elevationDeltaFeet: -18,
      greenFrontYards: 200, greenBackYards: 224,
    });
    expect(i.rawYards).toBe(212);
    expect(i.shotBearingDeg).toBe(271);
    expect(i.elevationDeltaFeet).toBe(-18);
    expect(i.greenFrontYards).toBe(200);
    expect(i.greenBackYards).toBe(224);
  });

  it('an explicit null from a caller is respected — "I know there is no hazard" is an answer', () => {
    onCourse();
    expect(liveShotReadInputs({ rawYards: 158, nearestHazard: null }).nearestHazard).toBeNull();
  });

  it('but an omitted field is filled, not left undefined', () => {
    onCourse();
    const i = liveShotReadInputs({ rawYards: 158 });
    expect(i.risk).toBeDefined();
    expect(i.bag).toBeDefined();
    expect('dominantMiss' in i).toBe(true);
  });
});

describe('it survives the states a golfer is actually in', () => {
  it('off the course it still returns a usable object rather than throwing', () => {
    useRoundStore.setState({ isRoundActive: false, currentHole: null, activeCourseId: null } as never);
    const i = liveShotReadInputs({ rawYards: 150 });
    expect(i.rawYards).toBe(150);
    expect(i.risk).toBeDefined();
    expect(() => composeShotRead(i)).not.toThrow();
  });

  it('an unmapped hole costs the hazard and the green depth, not the whole read', () => {
    onCourse({ activeCourseId: null });
    const i = liveShotReadInputs({ rawYards: 158 });
    expect(i.nearestHazard).toBeNull();
    // the player facts do NOT depend on the course being mapped
    expect(i.distanceControl).toBe('full_swings');
    expect(i.dominantMiss).toBe('right');
    expect(Object.keys(i.bag ?? {}).length).toBeGreaterThan(6);
  });

  it('and the engine still produces a read from what it was given', () => {
    onCourse();
    const read = composeShotRead(liveShotReadInputs({ rawYards: 158 }));
    expect(read).not.toBeNull();
    expect(read!.club).toBeTruthy();
    expect(read!.playsLikeYards).toBeGreaterThan(0);
  });
});
