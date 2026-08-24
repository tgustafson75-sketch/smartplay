/**
 * 2026-08-24 (orphan sweep, root cause) — ONE ANSWER TO "WHERE IS THE GREEN".
 *
 * roundStore carried its own private green cascade (`greenForHole`) used ONLY when closing a hole's
 * last shot. Its own comment admitted the split — "(Mirrors shotLocationService.getGreenCentroid,
 * which does this right.)" — and the copy it mirrored was better in three ways:
 *
 *   1. It consults the canonical resolver (surveyed truth → Mark Green override → golfbert →
 *      courseHoles → geometryCache). The local copy went straight to the geometry cache, so a green
 *      the player had MARKED was ignored when their hole was closed out — while every surface they
 *      HEAR (wind, lie analysis, shot tracking, the caddie payload, distance-to-green) used the
 *      marked one. The recorded data disagreed with the spoken answer.
 *   2. It applies the full WGS84 guard. The local copy used loose `!== 0` checks — the pre-"Fix GM"
 *      shape — so a near-zero or out-of-range coordinate (metres leaking into degree slots) could
 *      become a hole's green centroid and corrupt every shot distance derived from it.
 *   3. It averages front/back on the geometry path too, not only the legacy path.
 *
 * These cases pin the guard property, which is the one with teeth: a coordinate the canonical
 * resolver rejects must never be written into a player's shot history.
 */
import { useRoundStore } from '../../store/roundStore';
import { getGreenCentroid } from '../../services/shotLocationService';

const holes = (middle: { lat: number; lng: number }) => ([
  { hole: 1, par: 4, distance: 380, middleLat: middle.lat, middleLng: middle.lng },
  { hole: 2, par: 4, distance: 400, middleLat: 37.7, middleLng: -122.5 },
]);

const seedWithGreen = (middle: { lat: number; lng: number }) => {
  useRoundStore.setState({
    isRoundActive: true, activeCourseId: 'test-course', currentHole: 1,
    roundStartHole: 1, nineHoleMode: false, scores: {},
    courseHoles: holes(middle) as never,
    shots: [{ id: 's1', hole: 1, shot_in_hole_index: 1, start_location: { lat: 37.71, lng: -122.51 } }] as never,
  } as never);
};

const endLocOfShot1 = () =>
  (useRoundStore.getState().shots.find((s) => s.id === 's1') as { end_location?: unknown } | undefined)?.end_location ?? null;

describe('one green per hole — the closer and the caddie cannot disagree', () => {
  it('a valid green closes the hole, and matches what every other surface would say', () => {
    seedWithGreen({ lat: 37.72, lng: -122.52 });
    useRoundStore.getState().setCurrentHole(2);
    const canonical = getGreenCentroid(1);
    expect(canonical).not.toBeNull();
    expect(endLocOfShot1()).toEqual(canonical);
  });

  it('an OUT-OF-RANGE coordinate never becomes a green — metres leaking into degree slots', () => {
    // 500/700 are impossible as lat/lng. roundStore's old `!== 0` check accepted them.
    seedWithGreen({ lat: 500, lng: 700 });
    useRoundStore.getState().setCurrentHole(2);
    expect(getGreenCentroid(1)).toBeNull();
    expect(endLocOfShot1()).toBeNull();
  });

  it('a NEAR-ZERO placeholder never becomes a green — the equator/Greenwich sentinel', () => {
    // Passes `!== 0`, fails the WGS84 guard (|val| < 0.001°).
    seedWithGreen({ lat: 0.0001, lng: 0.0001 });
    useRoundStore.getState().setCurrentHole(2);
    expect(getGreenCentroid(1)).toBeNull();
    expect(endLocOfShot1()).toBeNull();
  });

  it('the closer and the canonical resolver agree for every seeded hole', () => {
    seedWithGreen({ lat: 37.72, lng: -122.52 });
    useRoundStore.getState().setCurrentHole(2);
    // Whatever the resolver says for hole 1 is exactly what was recorded — no second cascade.
    expect(endLocOfShot1()).toEqual(getGreenCentroid(1));
  });
});
